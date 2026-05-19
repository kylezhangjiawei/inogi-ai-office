/**
 * 审批流配置 - 数据层
 *
 * 设计原则：
 * 1. 审核流是「节点序列」，每个节点关联一个权限码（permission code）
 * 2. 拥有该权限码的所有用户自动入池（由「角色权限」页面分配）
 * 3. 每个节点可独立选择审核模式：单人 / 或签 / 会签
 * 4. SLA 字段已预留，本期不接催办逻辑
 *
 * 持久化：通过研发模块 API；localStorage 仅作为离线编辑回显。
 */

import { fetchRdApprovalFlows, fetchRdApprovalPools, saveRdApprovalFlows } from "./rdApi";

export type ApprovalMode = "single" | "any" | "all";

export type ApprovalNode = {
  /** Stable node id (uuid-like) */
  id: string;
  /** Display order (1, 2, 3...) */
  level: number;
  /** Display name, e.g. "一审" / "终审" */
  label: string;
  /** Linked permission code — pool is everyone who has this perm */
  permission_code: string;
  /** Approval mode */
  mode: ApprovalMode;
  /** Optional notes shown next to the node */
  description?: string;
  /** SLA in hours (reserved — not enforced yet) */
  sla_hours?: number;
  /** Whether to escalate after SLA timeout (reserved) */
  escalate_on_timeout?: boolean;
};

export type ApprovalFlow = {
  id: string;
  /** Human-readable name, e.g. "立项审批 · 默认流程" */
  name: string;
  /** Which business scenario it applies to */
  scope: "project_proposal" | "task_archive";
  /** Ordered list of approval nodes */
  nodes: ApprovalNode[];
  /** Whether this flow is the active default for the scope */
  is_default: boolean;
  /** Audit */
  created_at: string;
  updated_at: string;
};

// ─── Default flow (seeded on first load) ─────────────────────────────────────

export const DEFAULT_PROJECT_FLOW: ApprovalFlow = {
  id: "flow-project-default",
  name: "立项审批 · 默认流程",
  scope: "project_proposal",
  is_default: true,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-14T00:00:00Z",
  nodes: [
    {
      id: "node-l1",
      level: 1,
      label: "一审",
      permission_code: "rd-project:review-l1",
      mode: "any",
      description: "研发管理员审核可行性，任一人通过即转下一级",
      sla_hours: 48,
      escalate_on_timeout: true,
    },
    {
      id: "node-l2",
      level: 2,
      label: "终审",
      permission_code: "rd-project:review-l2",
      mode: "any",
      description: "研发主管/总监终审，任一人通过即生效",
      sla_hours: 24,
      escalate_on_timeout: true,
    },
  ],
};

// ─── Mock user pool by permission code ───────────────────────────────────────

export type PoolMember = {
  id: string;
  name: string;
  position: string;
  email?: string;
};

/**
 * Mock data: permission code → users who hold it.
 * In production this should be a backend query:
 *   GET /api/users?permission=rd-project:review-l1
 */
export const MOCK_USERS_BY_PERMISSION: Record<string, PoolMember[]> = {};

/** Helper: get the user pool for a given permission code */
export function getPoolForPermission(permissionCode: string): PoolMember[] {
  return MOCK_USERS_BY_PERMISSION[permissionCode] ?? [];
}

/** All approval-related permission codes that can be wired to a node */
export const APPROVAL_PERMISSION_OPTIONS: { code: string; label: string }[] = [
  { code: "rd-project:review-l1", label: "立项一审 (rd-project:review-l1)" },
  { code: "rd-project:review-l2", label: "立项终审 (rd-project:review-l2)" },
  { code: "rd-project:direct", label: "直接立项 (rd-project:direct)" },
  { code: "rd-task:reassign", label: "任务转派审批 (rd-task:reassign)" },
  { code: "rd-task:archive", label: "任务封存审批 (rd-task:archive)" },
];

export const APPROVAL_MODE_OPTIONS: { value: ApprovalMode; label: string; helper: string }[] = [
  { value: "single", label: "单人", helper: "池里第一位被指定的人审批（按规则选择）" },
  { value: "any", label: "或签", helper: "任一池成员通过即终结此节点（最常用）" },
  { value: "all", label: "会签", helper: "池里全部成员都需通过（关键决策）" },
];

// ─── Storage layer (localStorage now, API later) ─────────────────────────────

const STORAGE_KEY = "rd-approval-flows-v1";

export function loadFlows(): ApprovalFlow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApprovalFlow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFlows(flows: ApprovalFlow[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
  void saveFlowsApi(flows).catch(() => {});
}

export function getActiveFlow(scope: ApprovalFlow["scope"] = "project_proposal"): ApprovalFlow {
  const flows = loadFlows();
  return flows.find((f) => f.scope === scope && f.is_default) ?? DEFAULT_PROJECT_FLOW;
}

export function fetchFlowsApi(): Promise<ApprovalFlow[]> {
  return fetchRdApprovalFlows<ApprovalFlow>();
}

export function fetchApprovalPoolsApi(permissionCodes: string[]): Promise<Record<string, PoolMember[]>> {
  return fetchRdApprovalPools<PoolMember>(permissionCodes);
}

export function saveFlowsApi(flows: ApprovalFlow[]): Promise<ApprovalFlow[]> {
  return saveRdApprovalFlows(flows);
}
