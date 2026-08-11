/**
 * ReAct 循环的纯逻辑：流式 tool_calls 分片归并与本轮工具调用定型。
 *
 * 这两段没有副作用，但埋在 ChatService.streamMessage 里就只能连着 OpenAI client、Prisma
 * 和一串 service 一起才能跑到，改一行静默坏掉且只有线上暴露。抽成模块级纯函数后可直接单测。
 */

/** 流式下发的 tool_call 分片（结构上兼容 OpenAI SDK 的 ChatCompletionChunk delta.tool_calls） */
export type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/** 归并中的工具调用累加器 */
export type PendingToolCall = { id: string; name: string; args: string };

/** 定型后的工具调用：id 必定非空，与回给模型的 tool 消息一一对应 */
export type ResolvedToolCall = PendingToolCall;

/**
 * 统一注入到每个工具定义里的「思考」参数名。
 *
 * ReAct 的核心是显式推理与行动交替。用工具参数承载 Thought 而不是靠模型在调用前"说句话"：
 * 后者在流式下无法可靠区分——一段文字究竟是 Thought 还是正文开头，要等本轮结束看有没有
 * tool_calls 才知道，只能靠缓冲或事后回抽，都会闪。作为参数则是结构化数据、随 tool_call
 * 一起到达、天然进入对话轨迹参与后续推理，且每次调用各自带理由，粒度比每轮一句更细。
 */
export const THOUGHT_PARAM = 'thought';

/** Thought 展示长度上限：要求就是一句话，超了截断 */
export const THOUGHT_CHARS = 120;

/**
 * 从工具调用的原始 arguments JSON 里取出 thought。
 * 参数串可能是坏 JSON（模型偶发输出残缺）或压根没填，取不到就返回 undefined，不影响调用本身。
 */
export function extractThought(rawArgs: string | undefined | null): string | undefined {
  if (!rawArgs) return undefined;
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[THOUGHT_PARAM];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > THOUGHT_CHARS ? `${trimmed.slice(0, THOUGHT_CHARS)}…` : trimmed;
  } catch {
    return undefined;
  }
}

/** 步骤展开面板里单段文本的长度上限：够看清查了什么、返回了什么，又不至于把消息行撑爆 */
export const TOOL_STEP_ARGS_CHARS = 400;
export const TOOL_STEP_OUTPUT_CHARS = 2000;

/**
 * 随 assistant 消息落库的工具步骤终态（ChatMessage.toolSteps）。
 * 与 SSE 的 tool_step 事件同形（去掉中间态 running），前端历史回放直接复用同一渲染。
 *
 * args/output supports 前端把步骤条展开看「这次到底查了什么、返回了什么」。
 * 只有会话本人能看到：工具本身按权限裁剪、数据按 workspace 归属过滤，
 * 且分享给同事时只发回答正文（不含 toolSteps），展开面板不扩大任何可见范围。
 */
export type PersistedToolStep = {
  callId: string;
  tool: string;
  label: string;
  status: 'ok' | 'error';
  detail?: string;
  /** 模型调用这个工具的理由（ReAct 的 Thought），由 THOUGHT_PARAM 参数承载 */
  thought?: string;
  /** 模型传给工具的参数（原样 JSON，超长截断） */
  args?: string;
  /** 工具回给模型的观察值（超长截断） */
  output?: string;
};

/**
 * 截断展示文本，超长时留一个明确的省略标记。
 * 不做"智能"截断（按行/按句）：工具输出格式各异，截错位比截生硬更误导人。
 */
export function clipToolText(text: string | undefined | null, max: number): string | undefined {
  const value = (text ?? '').trim();
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…（已截断）` : value;
}

/**
 * 本轮是否把工具挂给模型。
 *
 * 循环跑 round = 0..maxToolRounds（共 maxToolRounds+1 轮），最后一轮刻意不挂工具，
 * 强制模型收敛出文字回答——这是防死循环烧钱的唯一保证，边界写错（`<=` 写成 `<`）
 * 会让模型可以无限续调工具，且只在线上暴露。
 */
export function shouldMountTools(round: number, maxToolRounds: number, agentEnabled: boolean): boolean {
  return agentEnabled && round < maxToolRounds;
}

/**
 * 把一批 tool_call 分片按 index 归并进累加器（就地修改）。
 *
 * 上游按 index 分片下发 name/arguments，同一个调用的 arguments 会拆成多个 chunk；
 * index 可能跳号或缺省，故按需补空位保证下标对齐。
 */
export function mergeToolCallDeltas(
  pending: PendingToolCall[],
  deltas: ToolCallDelta[] | undefined | null,
): void {
  for (const tc of deltas ?? []) {
    const idx = tc.index ?? pending.length;
    if (!Number.isInteger(idx) || idx < 0) continue; // 上游给了坏 index：丢弃该分片，不炸数组
    while (pending.length <= idx) pending.push({ id: '', name: '', args: '' });
    const cur = pending[idx];
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name += tc.function.name;
    if (tc.function?.arguments) cur.args += tc.function.arguments;
  }
}

/**
 * 把归并结果定型为本轮实际要执行的工具调用。
 *
 * 丢掉只有分片没有名字的空位，按上限截断（防模型单轮爆调），
 * 并给缺 id 的调用补一个轮内稳定 id——tool 消息必须靠 id 与 assistant.tool_calls 配对。
 */
export function finalizeToolCalls(
  pending: PendingToolCall[],
  maxPerRound: number,
  round: number,
): ResolvedToolCall[] {
  return pending
    .filter((c) => c.name)
    .slice(0, maxPerRound)
    .map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` }));
}
