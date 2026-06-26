# 问题记录与 AI 定位（issue-ai）— 详情页 AI 交互重构 · 对话记录文档

> 整理自一次完整开发会话。聚焦「问题详情页」重构为**左 AI 结论 / 右多用户沟通**的 AI 工作台。
> 全程 **mock 实现 + 预留真实 AI 接入点**（真实 AI 接口就绪后只替换 `IssueService` 实现，界面不变）。
> 提交：`feat(issue-ai): 详情重构…`（commit `7c1f9c2`，5 files，+805/−482）。

---

## 一、需求演进（按对话顺序）

最初用户提了 6 条需求，经过多轮澄清，最终确定如下：

| # | 需求 | 状态 |
|---|---|---|
| 1 | 问题列表只展示 **状态 / 标题 / 描述 / 时间** | 已做 |
| 2 | 分页默认 **10 条** + 列表在固定区域内滚动 | 已做 |
| 3 | 详情页**左右两栏**：左=AI 总结的**最终结论**；右=用户与 AI 的**沟通记录**，可继续聊 | 本次 |
| 4 | 聊天**一对多**：多用户参与，但对 AI 是**同一个用户、连续不可中断的上下文**；展示沟通用户头像/姓名 | 本次 |
| 5 | **AI 配置**功能 | 本次 |
| 6 | 沟通中可上传**图片/文本/表单**附件，AI 识别并作答；附件处理**适配**（AI 或 OCR 都可） | 本次 |

### 关键澄清（用户进一步明确）
- **左右分工不是"右聊天、左自动结论"**，而是把对话两端拆到左右、最终结论由人钦定：
  - **右侧 = 沟通过程**：用户提问 + AI **简短对话回应**（"结论放左侧了 →"）。
  - **左侧 = AI 的回答区**：AI 把**正式 markdown 回答**输出到左侧，**一条条往下累加**（最新在下、流式逐字吐）。
  - **最终结论 = 用户钦定**：左侧每条回答带「**设为最终结论**」，单选、可重设。
- **左侧"最终结论"是一条论证链**：多轮论证 → 一个/多个根因 → 每个根因多个方案 → 采纳 → 定性。
- **右侧 B 方案**：保留完整对话气泡（用户问 + AI 简短回应），AI 的正式分析进左侧。
- **左侧 AI 输出要做成"流式打字机 + markdown"**：像聊天 AI 一样一个字一个字吐，内容是 markdown。
- **列表顺序**：AI 回答最新在下 + 自动滚底。
- **左右联动**：点左侧「回应第 N 问」→ 右侧对应消息高亮滚动（本版就做）。
- **权限**：「设为最终结论」和「定性已解决」都受 `issue:resolve` 权限控制。
- **定性两步**：先选最终结论 → 才能定性"已解决"。

---

## 二、最终确定的设计

### 数据流（一次提问产出"右 2 左 1"）
你在右侧问一句，`sendChat` 产出 3 条：
- 右侧：① 你的提问气泡 ② AI 的**简短对话回应**
- 左侧：③ 一条 **AnalysisVersion**，其 `markdown` = AI 的正式 markdown 回答，`replyToSeq` = 你这次提问的序号

左侧累加的就是 `analyses` 数组（它本就是"AI 一条条产出的累加"）。

### 左栏「AI 结论」结构
```
AI 结论（标题固定）
├─ ⭐最终结论区（仅当钦定了某条才出现，置顶高亮）
│    <那条的 markdown> + [定性已解决]
├─ AI 回答 #3 · 回应第2问 · 14:20   ← 最新这条流式打字
│    <markdown>            [设为最终结论]
├─ AI 回答 #2 · 回应第1问（静态）
└─ AI 回答 #1 …
```
- 只有"挂载后新增的最新一条"流式吐字，历史静态（否则满屏打字很乱）。

### 右栏「沟通记录」
- AI 回答靠左（白气泡）、用户提问靠右（靛蓝气泡）；多用户各自头像+姓名区分（对 AI 仍单线程）。
- 图片内嵌缩略图预览、支持粘贴截图、多行 textarea。

### 改动范围（仅 issue-ai 模块）
- `src/app/lib/issue/types.ts`
- `src/app/lib/issue/issueService.ts`
- `src/app/issue-ai/DetailView.tsx`
- `src/app/issue-ai/ListView.tsx`、`src/app/IssueAiModule.tsx`（列表精简 + 高度）

---

## 三、数据层核心代码

### 3.1 `types.ts` — 新增/扩展的契约

```ts
/**
 * 参与沟通的用户。
 * 多用户场景：不同用户围绕同一问题与 AI 的消息，都记录在同一会话里；
 * 页面按「一对多」展示（带各自头像/姓名），但对 AI 仍是单线程、连续上下文。
 */
export interface ChatUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** 对话留痕 = 审计流水，只增不改。 */
export interface IssueMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  /** user 消息的发送者；多用户沟通时据此展示头像与姓名。 */
  author?: ChatUser;
  operator?: string; // 兼容旧字段
  /** 本条消息附带的附件（图片/文本/表单等），AI 会识别其内容后作答。 */
  attachments?: Attachment[];
  analysisVersionId?: string;
  createdAt: string;
}

/** 问题定性：判定是否已解决（由具备 issue:resolve 权限的人操作）。 */
export interface IssueResolution {
  resolved: boolean;
  by: ChatUser;
  at: string;
  note?: string;
}

/** AI 配置（对话与附件处理）。本期 mock；真实接入时由后端集成管理提供。 */
export interface AiConfig {
  model: string;
  temperature?: number;
  systemPrompt?: string;
  /** 附件处理方式适配：ai=多模态理解；ocr=先 OCR 提取文本再喂给 AI。 */
  attachmentMode: "ai" | "ocr";
}

// AnalysisVersion 新增字段：
//   markdown?: string;     AI 以 markdown 形式输出的完整回答（左侧直接渲染；真实接入由 AI 返回）
//   replyToSeq?: number;   关联右侧第几次用户提问（消息 seq），用于左右联动

// Issue 新增字段：
//   resolution?: IssueResolution;   问题定性结果
//   finalConclusionId?: string;     用户钦定的「最终结论」→ 某条 AnalysisVersion 的 id（单选可重设）

/** 发送一条沟通消息的输入。 */
export interface SendChatInput {
  content: string;
  author: ChatUser;          // 多用户协作；对 AI 仍是单线程连续上下文
  attachments?: Attachment[];
}
export interface SendChatResult {
  userMessage: IssueMessage;
  aiMessage: IssueMessage;
  analysis?: AnalysisVersion; // 本轮沟通推进的根因论证（左侧据此更新）
}
export interface UploadFileInput {
  fileName: string;
  fileType: string;
  dataUrl?: string;          // mock 用 base64 dataURL；真实接入对接 OSS
  size?: number;
}
```

`IssueService` 接口新增 6 个方法（均标注【真实 AI 接入点】）：
```ts
  /** 发送沟通消息（多用户共用同一会话、连续上下文；可带附件）。【真实 AI 接入点】 */
  sendChat(id: string, input: SendChatInput): Promise<SendChatResult>;
  /** 对问题定性（是否已解决）。调用方须先校验 issue:resolve 权限。 */
  resolveIssue(id: string, input: { resolved: boolean; by: ChatUser; note?: string }): Promise<Issue>;
  /** 上传附件。mock 返回占位 URL；【真实接入点】对接 OSS/文件服务。 */
  uploadAttachment(file: UploadFileInput): Promise<Attachment>;
  /** 处理附件：按 mode 用 AI（多模态）或 OCR 识别内容，回填 extractedText。【真实 AI/OCR 接入点】 */
  processAttachment(att: Attachment, mode: AiConfig["attachmentMode"]): Promise<Attachment>;
  getAiConfig(): Promise<AiConfig>;
  setAiConfig(cfg: AiConfig): Promise<AiConfig>;
  /** 把某条 AI 回答钦定为最终结论（单选，可重设）。需 issue:resolve 权限（调用方校验）。 */
  setFinalConclusion(id: string, versionId: string): Promise<Issue>;
}
```

### 3.2 `issueService.ts` — markdown 回答生成 + sendChat 改造

```ts
const LIKELIHOOD_CN: Record<string, string> = { high: "高", medium: "中", low: "低" };

/** 把一次根因分析组装成 AI 风格的 markdown 回答（左侧直接渲染；真实接入由 AI 返回）。 */
function buildAnswerMarkdown(question: string, causes: PossibleCause[], attachNote: string): string {
  const lines: string[] = [];
  lines.push(`### 针对你的问题，我的分析`);
  if (attachNote) lines.push(`> ${attachNote}，已纳入本轮判断。`);
  lines.push(`从 **6M（人机料法环测）** 维度看，当前识别出 **${causes.length}** 个可能方向：`);
  causes.slice(0, 6).forEach((c, i) => {
    lines.push(`${i + 1}. **${c.cause}** \`${c.dimension}\` · 可能性${LIKELIHOOD_CN[c.likelihood] ?? c.likelihood}`);
    if (c.solutions[0]) lines.push(`   - 建议：${c.solutions[0].action}`);
  });
  lines.push("");
  lines.push(`**建议处理步骤：**`);
  lines.push(`1. 优先排查可能性最高的方向，现场复核证据`);
  lines.push(`2. 按上述方案逐条验证并记录数据`);
  lines.push(`3. 确认根因后落实长期纠正与预防`);
  lines.push("");
  lines.push(`> 若认可此结论，可点本条的「设为最终结论」。`);
  return lines.join("\n");
}
```

`sendChat`（改造后核心逻辑：每次提问都产出一条带 markdown 的 AI 回答累加 + 右侧简短引导）：
```ts
const sendChat = async (id, input) => {
  const issue = store.find((i) => i.id === id);
  if (!issue) throw new Error(`Issue not found: ${id}`);

  // 右侧：用户提问（带 author/附件）
  const userMessage = { id: nextId("msg"), seq: issue.messages.length + 1, role: "user",
    content: input.content, author: input.author, operator: input.author.name,
    attachments: input.attachments, createdAt: nextTimestamp() };
  issue.messages.push(userMessage);

  const attachNote = input.attachments?.length ? `已结合你上传的 ${input.attachments.length} 个附件` : "";

  // 左侧：每次提问都产出一条 AI 回答（AnalysisVersion + markdown），累加到 analyses
  const prev = latestAnalysis(issue);
  const base = prev ? prev.content.possibleCauses : buildCauses(issue);
  const added = [{ id: nextId("pc"), cause: "结合本轮沟通进一步确认", dimension: "法",
    likelihood: "medium", evidence: `「${input.author.name}」提出：「${input.content}」…`,
    solutions: [{ id: nextId("sol"), action: "按本轮沟通要点复核并采集数据", type: "contain" }] }];
  const merged = [...base, ...added];
  const analysis = {
    id: nextId("av"), version: issue.analyses.length + 1,
    content: { possibleCauses: merged, summary: summarize(merged), referencedCases: prev?.content.referencedCases ?? [] },
    summary: summarize(merged),
    markdown: buildAnswerMarkdown(input.content, merged, attachNote),  // ← AI 的 markdown 回答
    replyToSeq: userMessage.seq,                                       // ← 关联右侧提问
    model: aiConfig.model, triggerType: prev ? "adjustment" : "initial",
    basedOnVersion: prev?.version, createdBy: "AI", createdAt: nextTimestamp(), isAdopted: false,
  };
  issue.analyses.push(analysis);

  // 右侧：AI 简短对话回应，引导去左侧看正式结论
  const aiMessage = { id: nextId("msg"), seq: issue.messages.length + 1, role: "assistant",
    content: `好的${attachNote ? "，" + attachNote : ""}。我从 6M 维度分析了，结论已放到左侧（第 ${analysis.version} 条回答）→ 你看是否采纳为最终结论。`,
    analysisVersionId: analysis.id, createdAt: nextTimestamp() };
  issue.messages.push(aiMessage);

  return { userMessage: deepClone(userMessage), aiMessage: deepClone(aiMessage), analysis: deepClone(analysis) };
};
```

`setFinalConclusion`：
```ts
const setFinalConclusion = async (id, versionId) => {
  const issue = store.find((i) => i.id === id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  const v = issue.analyses.find((a) => a.id === versionId);
  if (!v) throw new Error(`Analysis version not found: ${versionId}`);
  issue.finalConclusionId = versionId;
  issue.messages.push({ id: nextId("msg"), seq: issue.messages.length + 1, role: "user",
    content: `已将第 ${v.version} 条 AI 回答设为最终结论`, createdAt: nextTimestamp() });
  return deepClone(issue);
};
```

---

## 四、详情页（DetailView.tsx）核心代码

### 4.1 打字机 hook（逐字吐字）

```tsx
/** 打字机：逐字吐出 full，返回当前已吐文本与是否完成。 */
function useTypewriter(full: string, speed = 14) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    setN(0);
    if (!full) return;
    const id = window.setInterval(() => {
      setN((x) => {
        if (x >= full.length) { window.clearInterval(id); return x; }
        return x + 1;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [full, speed]);
  return { text: full.slice(0, n), done: !full || n >= full.length };
}
```

### 4.2 轻量 markdown 渲染（容错，配合流式）

```tsx
/** 行内 markdown：**加粗** 与 `代码`。 */
function renderInline(s: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold …">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={`${keyBase}-c${i}`} className="rounded bg-indigo-100/70 …">{m[2]}</code>);
    last = m.index + m[0].length; i++;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** 轻量 markdown 渲染（标题/列表/引用/加粗/代码），容错以配合流式输出。 */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: string) => {
    if (list.length) {
      const cur = list;
      blocks.push(<ul key={`ul-${k}`} className="my-1 space-y-1">
        {cur.map((li, i) => <li key={i} className="flex gap-1.5">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-indigo-400" />
          <span>{renderInline(li, `li-${k}-${i}`)}</span></li>)}
      </ul>);
      list = [];
    }
  };
  lines.forEach((ln, i) => {
    const k = String(i);
    if (/^#{1,3}\s/.test(ln)) { flush(k); blocks.push(<div key={`h-${i}`} className="… font-semibold …">{renderInline(ln.replace(/^#{1,3}\s/, ""), `h-${i}`)}</div>); }
    else if (/^>\s/.test(ln)) { flush(k); blocks.push(<div key={`q-${i}`} className="… border-l-2 border-indigo-300 …">{renderInline(ln.replace(/^>\s/, ""), `q-${i}`)}</div>); }
    else if (/^(-|\d+\.)\s/.test(ln)) { list.push(ln.replace(/^(-|\d+\.)\s/, "")); }
    else if (ln.trim() === "") { flush(k); }
    else { flush(k); blocks.push(<p key={`p-${i}`} className="leading-relaxed">{renderInline(ln, `p-${i}`)}</p>); }
  });
  flush("end");
  return <div className="space-y-1 text-sm …">{blocks}</div>;
}
```

### 4.3 左栏 ConclusionPanel（流式只给最新一条 + 最终结论 + 设为最终结论）

```tsx
function ConclusionPanel({ issue, canResolve, analyzing, scrollRef, onAnalyze, onSetFinal, onResolve, onJumpToMsg }) {
  const analyses = issue.analyses;
  const finalId = issue.finalConclusionId;
  const finalAv = finalId ? analyses.find((a) => a.id === finalId) : undefined;

  // 流式只给"挂载后新增的最新一条"；进页面已有的、历史的都静态
  const [mountedIds] = React.useState(() => new Set(analyses.map((a) => a.id)));
  const streamedRef = React.useRef<Set<string>>(new Set());
  const latest = analyses.length ? analyses[analyses.length - 1] : undefined;
  const shouldStream = !!latest && !mountedIds.has(latest.id) && !streamedRef.current.has(latest.id);
  const { text: streamText, done: streamDone } = useTypewriter(shouldStream ? latest?.markdown ?? "" : "");
  React.useEffect(() => { if (latest && shouldStream && streamDone) streamedRef.current.add(latest.id); }, [latest, shouldStream, streamDone]);
  React.useEffect(() => { if (shouldStream && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [streamText, shouldStream, scrollRef]);

  return (
    <div className={cn(card, "flex min-h-0 min-w-0 flex-col")}>
      <div className={panelHeader}> <Sparkles/> <h2>AI 结论</h2>
        <span className="ml-auto …">{analyses.length} 条回答 <StatusBadge value={issue.status}/></span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* 最终结论置顶高亮 + 定性已解决（权限） */}
        {finalAv ? (<div className="rounded-xl border-2 border-indigo-300 …">
          <CheckCircle2/> 最终结论（第 {finalAv.version} 条回答）
          <Button onClick={onResolve} disabled={!canResolve}>{canResolve ? <CheckCircle2/> : <Lock/>} 定性已解决</Button>
          <MarkdownLite text={finalAv.markdown ?? finalAv.summary} />
        </div>) : (<div className="… border-dashed …">尚未选定最终结论——从下方挑一条「设为最终结论」。</div>)}

        {/* AI 回答累加（最新在下；最新一条流式） */}
        {analyses.map((av, idx) => {
          const isFinal = av.id === finalId;
          const streaming = idx === analyses.length - 1 && shouldStream;
          const mdText = streaming ? streamText : av.markdown ?? av.summary;
          return (<div key={av.id} className={cn("rounded-xl border p-3.5", isFinal ? "border-indigo-300 …" : "…")}>
            <div className="… text-xs">
              回答 #{av.version}
              {av.replyToSeq ? <button onClick={() => onJumpToMsg(av.replyToSeq!)} className="text-indigo-600 hover:underline">回应第 {av.replyToSeq} 问 →</button> : null}
              {fmtTime(av.createdAt)}
              {isFinal ? <span>… 当前最终结论</span>
                       : <button onClick={() => onSetFinal(av.id)} disabled={!canResolve}>{canResolve ? null : <Lock/>} 设为最终结论</button>}
            </div>
            <MarkdownLite text={mdText} />
            {streaming && !streamDone ? <span className="… animate-pulse … bg-indigo-500" /> : null}
          </div>);
        })}
      </div>
    </div>
  );
}
```

### 4.4 右栏气泡（左右分 + 图片内嵌 + 高亮联动）

```tsx
function MessageBubble({ msg, highlighted }) {
  const isAi = msg.role === "assistant";
  const images = msg.attachments?.filter((a) => a.fileType.startsWith("image")) ?? [];
  return (
    <div data-seq={msg.seq}
      className={cn("flex items-end gap-2 rounded-xl transition-colors",
        isAi ? "flex-row" : "flex-row-reverse",
        highlighted ? "bg-amber-100/70 ring-2 ring-amber-300 …" : "")}>
      <Avatar user={msg.author} ai={isAi} />
      <div className={cn("flex max-w-[80%] flex-col", isAi ? "items-start" : "items-end")}>
        <div>{isAi ? "AI 定位助手" : msg.author?.name} · 第 {msg.seq} 条 · {fmtTime(msg.createdAt)}</div>
        <div className={cn("rounded-2xl px-3.5 py-2.5 …",
          isAi ? "bg-white ring-1 ring-slate-200" : "bg-indigo-600 text-white")}>
          {/* 图片内嵌缩略图（点开大图） */}
          {images.map((a) => <a key={a.id} href={a.fileUrl} target="_blank"><img src={a.fileUrl} className="max-h-44 …" /></a>)}
          {msg.content && <div className="whitespace-pre-wrap break-words">{msg.content}</div>}
        </div>
      </div>
    </div>
  );
}
```

右栏输入区（多行 textarea + 粘贴截图）与左右联动滚动：
```tsx
// ChatPanel 内：左侧点"回应第 N 问" → 滚动到该消息并高亮
React.useEffect(() => {
  if (highlightSeq == null) return;
  scrollRef.current?.querySelector(`[data-seq="${highlightSeq}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}, [highlightSeq]);

// textarea 支持粘贴截图
onPaste={(e) => {
  for (const it of e.clipboardData?.items ?? []) {
    if (it.type.startsWith("image")) { const f = it.getAsFile(); if (f) onPickFile(f); }
  }
}}
```

### 4.5 主组件接线（onSetFinal / onJumpToMsg / 高亮 / 上传读 dataURL）

```tsx
const [highlightSeq, setHighlightSeq] = React.useState<number | null>(null);
const leftScrollRef = React.useRef<HTMLDivElement>(null);
const canResolve = hasPermission(user?.permissions ?? [], "issue:resolve");

const onSetFinal = async (versionId) => {
  if (!canResolve) { toast.error("你没有『问题定性』权限"); return; }
  await service.setFinalConclusion(issueId, versionId); toast.success("已设为最终结论"); load();
};
const onJumpToMsg = (seq) => { setHighlightSeq(seq); window.setTimeout(() => setHighlightSeq(null), 1800); };

// 上传：图片读成 dataURL 才能在气泡里预览
const onPickFile = async (file) => {
  const dataUrl = await new Promise((resolve) => {
    if (!file.type.startsWith("image")) return resolve(undefined);
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(undefined); r.readAsDataURL(file);
  });
  let att = await service.uploadAttachment({ fileName: file.name, fileType: file.type, size: file.size, dataUrl });
  att = await service.processAttachment(att, aiCfg?.attachmentMode ?? "ai");  // AI/OCR 适配
  setPending((p) => [...p, att]);
};

// 双栏：充满内容区，两栏各自是 card 面板（标题固定 + 内部滚动）
<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
  <ConclusionPanel issue={issue} canResolve={canResolve} scrollRef={leftScrollRef}
    onAnalyze={onAnalyze} onSetFinal={onSetFinal} onResolve={onResolve} onJumpToMsg={onJumpToMsg} />
  <ChatPanel issue={issue} highlightSeq={highlightSeq} … />
</div>
```

---

## 五、过程中的关键问题与解决

| 问题 | 现象 | 根因 / 解决 |
|---|---|---|
| **看到的一直是旧版** | 强刷也没用、看到旧的"对话调整/版本与留痕" | 源码已是新版（grep 验证旧词全项目 0 命中），但 **dev 模块缓存卡在旧编译**；强刷只刷浏览器，刷不掉 dev 服务器模块缓存 → **重启前端 dev 进程** |
| **左右两栏高度不撑满** | 内容区没占满 | 高度链断在 `IssueAiModule` 详情容器（`overflow-y-auto` + 无固定高度 div）→ 改成 `flex min-h-0 flex-1 flex-col` 撑满；`DetailView` 根从 `h-full` 改 `flex-1` |
| **顶部重复面包屑** | 两条返回 | DetailView 自带顶部条后，外层 IssueAiModule 的 `<nav>` 冗余 → 删外层 nav |
| **气泡"怪"** | 都靠左、不分 | 改成 AI 左白气泡 / 用户右靛蓝气泡，多用户各自头像 |
| **本会话文件读取不可靠** | Read/grep/sed 输出乱码、截断、Windows 报错泄漏 | **写入（Write/Edit）可靠、只读取乱** → 改用整文件 Write + 基于自己掌握的版本，不依赖反复读 |

---

## 六、提交记录

```
commit 7c1f9c2
feat(issue-ai): 详情重构为 AI 结论累加(流式markdown)+多用户沟通+最终结论定性+左右联动
5 files changed, 805 insertions(+), 482 deletions(-)
  - src/app/lib/issue/types.ts
  - src/app/lib/issue/issueService.ts
  - src/app/issue-ai/DetailView.tsx
  - src/app/issue-ai/ListView.tsx
  - src/app/IssueAiModule.tsx
```

---

## 七、待办 / 注意事项

1. **真实 AI 接入**：service 的 `sendChat`/`processAttachment`/`getAiConfig` 等已预留【真实 AI 接入点】，真实接口就绪后**只替换 `IssueService` 实现**，`MarkdownLite` 流式渲染直接复用（把 AI 回复换成真实流即可）。
2. **权限点 `issue:resolve`**：mock 阶段超管 `'*'` 通过；需在后端 `permission-catalog.defaults.ts` 注册并分配给相应角色。
3. **第 6 点的"最终结论可微调"**：本期留了入口/数据，未实现编辑。
4. **本会话 git 输出不可靠**：commit 用**精确 `git add` 指定文件**完成；工作区另有 `App.tsx`/`theme.css`/`package.json`/`lockfile`/后端等改动（疑似更早会话遗留）**未提交**。**push 前请自行核对** `git log`/`git status`/`git show 7c1f9c2 --stat`，并本地 `pnpm build` 验证。
```
