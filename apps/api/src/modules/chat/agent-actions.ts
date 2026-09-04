/**
 * MateChat Agent 可执行的系统操作注册表（第一批：研发任务域）。
 *
 * 这里**只声明「做什么」，不声明「谁能做」**——权限码一律由 agent-permission 从目标控制器
 * 方法上反射得到。控制器改了权限码，Agent 自动跟随；注册表里没有可以抄错的东西。
 *
 * 分级说明：
 * - direct：可逆、且不改变对外承诺的字段（优先级、描述），直接执行并在步骤条里留痕
 * - confirm：影响他人工作安排或交付承诺的字段（负责人、截止日期），出确认卡由用户点确认
 *
 * 目标任务一律经 findTaskById 定位，而它只覆盖研发池（主库 + 产品库）。
 * 协同池任务在这一层就定位不到，跨池写在结构上不可能发生。
 *
 * 两种形态：
 * - field：单任务改单字段，参数固定 `{ task_id, <字段> }`，出口固定 rdService.updateTask
 * - custom：自带参数 schema，可多目标、可走 updateTask 以外的服务方法。执行体不在本文件
 *   （本文件不碰 service），由 ChatToolsService 按工具名提供，那里对 AgentCustomActionTool
 *   做穷尽检查——加了工具却没配执行体，编译期就报错。
 */
import { ResearchDevelopmentController } from '../research-development/research-development.controller';
import type { ControllerClass } from './agent-permission';

export type AgentActionRisk = 'direct' | 'confirm';

/**
 * 注册表工具名。收成字面量联合而不是 string，才能让 AGENT_ACTION_PAYLOAD_KEY（field 型）
 * 与 ChatToolsService 的执行体表（custom 型）做穷尽检查：新增操作却忘了配套时编译期就报错，
 * 而不是运行时拼出 `{ undefined: value }` 写进库、或调用一个不存在的执行体。
 */
export const AGENT_FIELD_ACTION_TOOLS = [
  'set_task_priority',
  'set_task_description',
  'reassign_task',
  'set_task_due_date',
] as const;
export const AGENT_CUSTOM_ACTION_TOOLS = [
  'request_task_merge',
  'move_tasks_category',
  'attach_tasks_to_parent',
  'request_task_abandon',
] as const;
export const AGENT_ACTION_TOOLS = [...AGENT_FIELD_ACTION_TOOLS, ...AGENT_CUSTOM_ACTION_TOOLS] as const;
export type AgentFieldActionTool = (typeof AGENT_FIELD_ACTION_TOOLS)[number];
export type AgentCustomActionTool = (typeof AGENT_CUSTOM_ACTION_TOOLS)[number];
export type AgentActionTool = AgentFieldActionTool | AgentCustomActionTool;

/**
 * 单次调用能带的任务数上限。
 *
 * 存在的理由不是性能，是「误操作面」：模型把 60 条任务一次并进某个父任务，用户在确认卡上
 * 只看得到前几条，等于闭眼确认。上限逼模型分批，每批都要单独确认。
 */
export const AGENT_BATCH_MAX_TASKS = 20;

/** 两种形态共有的声明部分 */
type AgentActionCommon = {
  /** 步骤条上显示的动作名 */
  label: string;
  risk: AgentActionRisk;
  /** 权限从这个控制器方法上反射；注册表不写权限码 */
  controller: ControllerClass;
  handler: string;
  /** 给模型看的工具说明 */
  description: string;
};

/** 单个字段的改写意图：把工具参数翻成 rdService.updateTask 的 payload 片段 */
export type AgentFieldActionDef = AgentActionCommon & {
  kind: 'field';
  /** 工具名，同时是模型看到的函数名 */
  tool: AgentFieldActionTool;
  /** 该操作要改的字段名（除 task_id 外的那一个参数） */
  field: string;
  fieldSchema: Record<string, unknown>;
  /** 确认卡/步骤条上这个字段的中文名 */
  fieldLabel: string;
  /**
   * 把模型给的原始值归一化成写库值。返回 null 表示参数非法，调用方据此拒绝并让模型纠偏。
   * 归一化放在这里而不是散落在执行处，是为了让「模型能传什么」有唯一定义。
   */
  normalize: (raw: unknown) => { ok: true; value: unknown; display: string } | { ok: false; message: string };
};

/**
 * 自定义形态：只声明模型看到的参数长什么样，参数校验与执行由 ChatToolsService 的执行体负责。
 * 声明与执行分家，是为了让本文件保持「不 import 任何 service」——否则注册表会把整个
 * 研发服务拖进依赖图，测试里也就没法单独加载它。
 */
export type AgentCustomActionDef = AgentActionCommon & {
  kind: 'custom';
  tool: AgentCustomActionTool;
  /** JSON Schema 的 properties（thought 参数由 withThoughtParam 统一注入，此处不写） */
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

export type AgentActionDef = AgentFieldActionDef | AgentCustomActionDef;

/** 收窄到 field 型：调用方据此决定走 updateTask 出口还是自定义执行体 */
export function isFieldAction(action: AgentActionDef): action is AgentFieldActionDef {
  return action.kind === 'field';
}

const PRIORITY_MAP: Record<string, string> = {
  高: 'high',
  中: 'medium',
  低: 'low',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const PRIORITY_DISPLAY: Record<string, string> = { high: '高', medium: '中', low: '低' };

/** YYYY-MM-DD，且必须是真实存在的日期（排除 2026-02-31 这类） */
function normalizeDate(raw: unknown): { ok: true; value: unknown; display: string } | { ok: false; message: string } {
  const text = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, message: '截止日期必须是 YYYY-MM-DD 格式，例如 2026-09-30。' };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return { ok: false, message: `${text} 不是一个真实存在的日期，请核对后重新提供。` };
  }
  return { ok: true, value: text, display: text };
}

export const AGENT_ACTIONS: AgentActionDef[] = [
  {
    kind: 'field',
    tool: 'set_task_priority',
    label: '调整任务优先级',
    risk: 'direct',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '调整一个研发任务的优先级。用户明确要求「把某任务提高/降低优先级」时调用。可逆操作，无需确认，调用后直接生效。',
    field: 'priority',
    fieldSchema: { type: 'string', enum: ['高', '中', '低'], description: '目标优先级' },
    fieldLabel: '优先级',
    normalize: (raw) => {
      const key = String(raw ?? '').trim();
      const value = PRIORITY_MAP[key];
      if (!value) return { ok: false, message: '优先级只能是「高」「中」「低」之一。' };
      return { ok: true, value, display: PRIORITY_DISPLAY[value] };
    },
  },
  {
    kind: 'field',
    tool: 'set_task_description',
    label: '修改任务描述',
    risk: 'direct',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '改写一个研发任务的描述文字。用户要求「把某任务的描述改成…」时调用。可逆操作，无需确认。注意这会整体替换原描述，不是追加。',
    field: 'description',
    fieldSchema: { type: 'string', description: '新的任务描述全文（会整体替换原描述）' },
    fieldLabel: '描述',
    normalize: (raw) => {
      const text = String(raw ?? '').trim();
      if (!text) return { ok: false, message: '描述不能为空。要清空描述请让用户在页面上操作。' };
      if (text.length > 2000) return { ok: false, message: '描述过长（超过 2000 字），请精简后重试。' };
      return { ok: true, value: text, display: text.length > 60 ? `${text.slice(0, 60)}…` : text };
    },
  },
  {
    kind: 'field',
    tool: 'reassign_task',
    label: '改派任务负责人（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '把一个研发任务改派给另一个人。影响他人工作安排，调用后会生成待确认卡，用户点确认才生效——绝不要说「已改派」，只说「已生成确认卡」。',
    field: 'owner',
    fieldSchema: { type: 'string', description: '新负责人姓名' },
    fieldLabel: '新负责人',
    normalize: (raw) => {
      const name = String(raw ?? '').trim();
      if (!name) return { ok: false, message: '需要提供新负责人姓名。' };
      if (name.length > 40) return { ok: false, message: '负责人姓名过长，请核对。' };
      return { ok: true, value: name, display: name };
    },
  },
  {
    kind: 'field',
    tool: 'set_task_due_date',
    label: '修改任务截止日期（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '修改一个研发任务的截止日期。影响交付承诺，调用后会生成待确认卡，用户点确认才生效——绝不要说「已修改」，只说「已生成确认卡」。',
    field: 'due_date',
    fieldSchema: { type: 'string', description: '新的截止日期，格式 YYYY-MM-DD' },
    fieldLabel: '新截止日期',
    normalize: normalizeDate,
  },
  {
    kind: 'custom',
    tool: 'request_task_merge',
    label: '合并任务（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '把一个研发任务并入另一个任务：源任务的子任务、进展留痕、附件、协作人都会并入目标任务，源任务归档保留。' +
      '整理重复/高度重叠的任务时用它。调用后生成确认卡，用户确认后直接合并。' +
      '确认前绝不要说「已合并」，只说「已生成确认卡」。源任务与目标任务必须在同一个任务库。',
    properties: {
      source_task_id: { type: 'string', description: '被并入方（合并后归档）的任务编号' },
      target_task_id: { type: 'string', description: '保留方（合并去向）的任务编号' },
      reason: { type: 'string', description: '合并原因，用于记录变更依据，必填' },
    },
    required: ['source_task_id', 'target_task_id', 'reason'],
  },
  {
    kind: 'custom',
    tool: 'move_tasks_category',
    label: '移动任务归类（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'moveTasks',
    description:
      '把一个或多个研发任务移动到另一个分类 / 子项目下——只改归属位置，不改任务的任何内容。' +
      `支持一次传多个任务编号（最多 ${AGENT_BATCH_MAX_TASKS} 个），要移动多条时**一次调用传完**，不要逐条调用。` +
      '调用后生成确认卡，用户确认才生效。目标分类只能是主产品库的分类。',
    properties: {
      task_ids: {
        type: 'array',
        items: { type: 'string' },
        description: `要移动的任务编号列表，一次最多 ${AGENT_BATCH_MAX_TASKS} 个`,
      },
      target_category: {
        type: 'string',
        description: '目标分类，格式为「分类」或「分类/子项目」，如「电源部分/电池」',
      },
    },
    required: ['task_ids', 'target_category'],
  },
  {
    kind: 'custom',
    tool: 'attach_tasks_to_parent',
    label: '并入父任务（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'attachTasksAsSubtasks',
    description:
      '把一个或多个顶层任务挂到某个父任务下成为它的子任务——任务本身都保留，只改层级关系。' +
      '把同一主题下零散的任务归拢时用它（区别于 request_task_merge：那个会归档源任务）。' +
      `支持一次传多个任务编号（最多 ${AGENT_BATCH_MAX_TASKS} 个），要归拢多条时**一次调用传完**。` +
      '调用后生成确认卡，用户确认才生效。',
    properties: {
      task_ids: {
        type: 'array',
        items: { type: 'string' },
        description: `要并入的任务编号列表，一次最多 ${AGENT_BATCH_MAX_TASKS} 个`,
      },
      parent_task_id: { type: 'string', description: '目标父任务编号' },
    },
    required: ['task_ids', 'parent_task_id'],
  },
  {
    kind: 'custom',
    tool: 'request_task_abandon',
    label: '申请放弃任务（待确认）',
    risk: 'confirm',
    controller: ResearchDevelopmentController,
    handler: 'updateTask',
    description:
      '为一个研发任务提交「放弃」申请。用户要求「删除任务」时用这个工具——这是任务下线的唯一路径，' +
      '你没有直接删除任务的能力，要向用户说明走的是放弃审核流程。审核通过后任务会被彻底移除且不可恢复。' +
      '调用后生成确认卡，用户确认后也只是「提交申请」，仍需管理员审核。绝不要说「已删除」「已放弃」，只说「已生成确认卡」。',
    properties: {
      task_id: { type: 'string', description: '要申请放弃的任务编号' },
      reason: { type: 'string', description: '放弃原因，审核人据此判断，必填' },
    },
    required: ['task_id', 'reason'],
  },
];

/**
 * field 型操作对应的 updateTask payload 字段名：与控制器接受的 payload 键一致。
 * custom 型不进这张表——它们的 payload 由各自的执行体拼装。
 */
export const AGENT_ACTION_PAYLOAD_KEY: Record<AgentFieldActionTool, string> = {
  set_task_priority: 'final_priority',
  set_task_description: 'description',
  reassign_task: 'primary_owner',
  set_task_due_date: 'due_date',
};
