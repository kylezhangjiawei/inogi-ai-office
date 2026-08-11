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
 */
import { ResearchDevelopmentController } from '../research-development/research-development.controller';
import type { ControllerClass } from './agent-permission';

export type AgentActionRisk = 'direct' | 'confirm';

/**
 * 注册表工具名。收成字面量联合而不是 string，才能让 AGENT_ACTION_PAYLOAD_KEY 做穷尽检查：
 * 新增操作却忘了配 payload 字段名时编译期就报错，而不是运行时拼出 `{ undefined: value }` 写进库。
 */
export const AGENT_ACTION_TOOLS = [
  'set_task_priority',
  'set_task_description',
  'reassign_task',
  'set_task_due_date',
] as const;
export type AgentActionTool = (typeof AGENT_ACTION_TOOLS)[number];

/** 单个字段的改写意图：把工具参数翻成 rdService.updateTask 的 payload 片段 */
export type AgentActionDef = {
  /** 工具名，同时是模型看到的函数名 */
  tool: AgentActionTool;
  /** 步骤条上显示的动作名 */
  label: string;
  risk: AgentActionRisk;
  /** 权限从这个控制器方法上反射；注册表不写权限码 */
  controller: ControllerClass;
  handler: string;
  /** 给模型看的工具说明 */
  description: string;
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
];

/** updateTask 的 payload 字段名：与控制器接受的 payload 键一致 */
export const AGENT_ACTION_PAYLOAD_KEY: Record<AgentActionTool, string> = {
  set_task_priority: 'final_priority',
  set_task_description: 'description',
  reassign_task: 'primary_owner',
  set_task_due_date: 'due_date',
};
