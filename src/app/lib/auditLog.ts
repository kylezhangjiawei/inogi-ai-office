/**
 * 留痕（审计日志）基础设施
 *
 * 设计原则：
 * 1. 留痕由服务端在业务方法里写（见 RD service 的 recordServerAudit）——
 *    前端不再自行落审计，绕开界面直调接口同样留得下记录
 * 2. 同一份日志可在「全局操作留痕页」「资源详情时间轴」复用
 * 3. 本模块只负责读取与展示：拉取、缓存回显、按需刷新
 * 4. 通过 CustomEvent 让任意 `useAuditLogs()` 实时刷新
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { authFetch, getStoredUser, readErrorMessage } from "./authSession";
import { hasAnyPermission, PERMISSIONS } from "./permissions";
import { addRdAuditLogNote, fetchRdAuditLogs, isUsCollabWorkspace, RD_MUTATED_EVENT } from "./rdApi";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "task"
  | "proposal"
  | "approval_flow"
  | "person"
  | "role"
  | "ai"
  | "knowledge"
  | "system";

export type AuditAction =
  // Task lifecycle
  | "task.created"
  | "task.updated"
  | "task.edited"
  | "task.status_changed"
  | "task.priority_changed"
  | "task.assigned"
  | "task.reassigned"
  | "task.deleted"
  | "task.archived"
  | "task.unarchived"
  | "task.progress_updated"
  | "task.work_item_updated"
  | "task.comment_added"
  | "task.attachment_added"
  | "task.attachment_removed"
  | "task.attachment_replaced"
  | "task.evidence_uploaded"
  | "task.handoff_requested"
  | "task.abandon_requested"
  | "task.merge_requested"
  | "task.submitted"
  | "task.collaboration_updated"
  | "task.collaboration_requested"
  | "task.due_date_requested"
  | "task.review_approved"
  | "task.review_rejected"
  // Proposal lifecycle
  | "proposal.created"
  | "proposal.draft_saved"
  | "proposal.submitted"
  | "proposal.approved"
  | "proposal.rejected"
  | "proposal.direct_dispatched"
  | "proposal.recalled"
  | "proposal.escalated"
  | "proposal.resubmitted"
  // Review actions (result / collaboration / due_date) — 各类型独立，避免一律记成"立项"
  | "result.approved"
  | "result.rejected"
  | "collaboration.approved"
  | "collaboration.rejected"
  | "due_date.approved"
  | "due_date.rejected"
  | "abandon.approved"
  | "abandon.rejected"
  | "merge.approved"
  | "merge.rejected"
  // Approval flow config
  | "flow.saved"
  | "flow.node_added"
  | "flow.node_removed"
  | "flow.node_edited"
  | "flow.mode_changed"
  | "flow.reset"
  // Personnel
  | "person.created"
  | "person.edited"
  | "person.deleted"
  | "person.status_changed"
  // Role / Permission
  | "role.permissions_changed"
  // AI
  | "ai.parse_triggered"
  | "ai.suggestion_accepted"
  | "ai.suggestion_rejected"
  | "ai.regenerated"
  | "ai.proposal_refined"
  | "ai.proposal_refine_applied"
  // Category / sub-project tree
  | "category.created"
  | "category.edited"
  | "category.deleted"
  | "sub_project.created"
  | "sub_project.edited"
  | "sub_project.deleted"
  // System
  | "system.bulk_reassign"
  | "notification.handled"
  | "daily_report.generated"
  | "daily_progress.synced"
  | "task.data.cleared"
  // Knowledge Base
  | "kb.entry.uploaded"
  | "kb.entry.edited"
  | "kb.entry.moved"
  | "kb.entry.deleted"
  | "kb.category.created"
  | "kb.category.edited"
  | "kb.category.deleted";

export type PersistedAuditAction =
  | AuditAction
  | (string & { readonly __persistedAuditActionBrand: unique symbol });

export type AuditActor = {
  id: string;
  name: string;
  role?: string;
};

export type AuditResource = {
  type:
    | "task"
    | "proposal"
    | "project"
    | "person"
    | "role"
    | "flow"
    | "category"
    | "knowledge"
    | "system";
  id: string;
  name?: string;
};

export type AuditChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

/** 研发管理员对某条留痕追加的「备注」，内嵌在该留痕记录里，跟着留痕走。 */
export type AuditLogNote = {
  id: string;
  text: string;
  actor: AuditActor;
  created_at: string;
};

export type AuditLog = {
  id: string;
  timestamp: string;
  actor: AuditActor;
  action: PersistedAuditAction;
  resource: AuditResource;
  changes?: AuditChange[];
  comment?: string;
  metadata?: Record<string, unknown>;
  notes?: AuditLogNote[];
  source: "web" | "api" | "ai" | "system";
};

export type AuditActorIdentity = {
  id?: string | null;
  name?: string | null;
};

export type AuditLogViewer = AuditActorIdentity & {
  permissions?: string[] | null;
};

const AUDIT_LOG_MANAGER_PERMISSIONS = [
  PERMISSIONS.RD_TASK_REASSIGN,
  PERMISSIONS.RD_PROJECT_DIRECT,
  PERMISSIONS.RD_PROJECT_REVIEW_L1,
  PERMISSIONS.RD_PROJECT_REVIEW_L2,
  PERMISSIONS.RD_PEOPLE_MANAGE,
];

export function canReadAllAuditLogs(permissions: string[] | null | undefined): boolean {
  return hasAnyPermission(permissions ?? [], AUDIT_LOG_MANAGER_PERMISSIONS);
}

function auditActorNameKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[（(].*?[）)]/g, "")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "");
}

export function auditActorMatchesIdentity(
  actor: { id?: string | null; name?: string | null } | null | undefined,
  identity: AuditActorIdentity | null | undefined,
): boolean {
  const identityId = String(identity?.id ?? "").trim();
  const identityNameKey = auditActorNameKey(identity?.name);
  if (!identityId && !identityNameKey) return false;

  const actorId = String(actor?.id ?? "").trim();
  if (actorId) return Boolean(identityId) && actorId === identityId;
  return Boolean(identityNameKey) && auditActorNameKey(actor?.name) === identityNameKey;
}

export function filterAuditLogsByActor(logs: AuditLog[], identity: AuditActorIdentity): AuditLog[] {
  return logs.filter((log) => auditActorMatchesIdentity(log.actor, identity));
}

/**
 * Mirrors the API's audit visibility rule. Besides normal rendering, this also
 * prevents a full administrator cache from flashing after another user signs in
 * on the same browser.
 */
export function filterAuditLogsForViewer(logs: AuditLog[], viewer: AuditLogViewer | null | undefined): AuditLog[] {
  if (canReadAllAuditLogs(viewer?.permissions)) return logs;
  return logs.filter((log) => auditActorMatchesIdentity(log.actor, viewer));
}

// ─── Action metadata (icon hint, label, verb) ────────────────────────────────

export type AuditActionMeta = {
  category: AuditCategory;
  label: string;
  verb: string;
  tone: "blue" | "emerald" | "amber" | "red" | "violet" | "slate";
};

const UNKNOWN_AUDIT_ACTION_META: AuditActionMeta = {
  category: "system",
  label: "未知动作",
  verb: "记录了操作",
  tone: "slate",
};

export const AUDIT_ACTION_META: Record<AuditAction, AuditActionMeta> = {
  // Task
  "task.created": { category: "task", label: "新建任务", verb: "创建了任务", tone: "blue" },
  "task.updated": { category: "task", label: "更新任务", verb: "更新了任务", tone: "blue" },
  "task.edited": { category: "task", label: "编辑任务", verb: "修改了任务", tone: "blue" },
  "task.status_changed": { category: "task", label: "状态变更", verb: "变更了任务状态", tone: "amber" },
  "task.priority_changed": { category: "task", label: "优先级变更", verb: "调整了任务优先级", tone: "amber" },
  "task.assigned": { category: "task", label: "指派任务", verb: "指派了任务", tone: "violet" },
  "task.reassigned": { category: "task", label: "转派任务", verb: "转派了任务", tone: "violet" },
  "task.deleted": { category: "task", label: "删除任务", verb: "删除了任务", tone: "red" },
  "task.archived": { category: "task", label: "封存任务", verb: "封存了任务", tone: "slate" },
  "task.unarchived": { category: "task", label: "解封任务", verb: "解封了任务", tone: "emerald" },
  "task.progress_updated": { category: "task", label: "进度更新", verb: "更新了任务进度", tone: "blue" },
  "task.work_item_updated": { category: "task", label: "工作项", verb: "更新了工作项", tone: "blue" },
  "task.comment_added": { category: "task", label: "添加评论", verb: "评论了任务", tone: "slate" },
  "task.attachment_added": { category: "task", label: "添加附件", verb: "上传了附件", tone: "slate" },
  "task.attachment_removed": { category: "task", label: "删除附件", verb: "删除了附件", tone: "red" },
  "task.attachment_replaced": { category: "task", label: "替换附件", verb: "替换了附件", tone: "amber" },
  "task.evidence_uploaded": { category: "task", label: "上传依据", verb: "上传了任务依据", tone: "slate" },
  "task.handoff_requested": { category: "task", label: "提交移交", verb: "提交了任务移交流程", tone: "violet" },
  "task.abandon_requested": { category: "task", label: "申请放弃", verb: "申请放弃了任务", tone: "amber" },
  "task.merge_requested": { category: "task", label: "申请合并", verb: "申请合并任务", tone: "blue" },
  "task.submitted": { category: "task", label: "提交审核", verb: "提交了任务结果审核", tone: "blue" },
  "task.collaboration_updated": { category: "task", label: "更新协作人", verb: "更新了任务协作人", tone: "violet" },
  "task.collaboration_requested": { category: "task", label: "申请协作变更", verb: "提交了协作变更申请", tone: "violet" },
  "task.due_date_requested": { category: "task", label: "申请截止变更", verb: "提交了截止日期变更申请", tone: "amber" },
  "task.review_approved": { category: "task", label: "任务审核通过", verb: "审核通过了任务", tone: "emerald" },
  "task.review_rejected": { category: "task", label: "任务审核驳回", verb: "驳回了任务", tone: "red" },
  // Proposal
  "proposal.created": { category: "proposal", label: "立项创建", verb: "创建了立项", tone: "blue" },
  "proposal.draft_saved": { category: "proposal", label: "保存草稿", verb: "保存了立项草稿", tone: "slate" },
  "proposal.submitted": { category: "proposal", label: "提交审核", verb: "提交了立项审核", tone: "blue" },
  "proposal.approved": { category: "proposal", label: "立项通过", verb: "审核通过了立项", tone: "emerald" },
  "proposal.rejected": { category: "proposal", label: "立项驳回", verb: "驳回了立项", tone: "red" },
  "proposal.direct_dispatched": { category: "proposal", label: "直接立项", verb: "直接立项并分配", tone: "violet" },
  "proposal.recalled": { category: "proposal", label: "撤回立项", verb: "撤回了立项", tone: "amber" },
  "proposal.escalated": { category: "proposal", label: "升级审批", verb: "升级了审批", tone: "amber" },
  "proposal.resubmitted": { category: "proposal", label: "重提立项", verb: "重新提交了立项", tone: "blue" },
  // Review actions — 成果 / 协作变更 / 截止日期变更，各自独立文案
  "result.approved": { category: "task", label: "成果通过", verb: "验收通过了成果", tone: "emerald" },
  "result.rejected": { category: "task", label: "成果驳回", verb: "驳回了成果", tone: "red" },
  "collaboration.approved": { category: "task", label: "协作通过", verb: "通过了协作变更", tone: "violet" },
  "collaboration.rejected": { category: "task", label: "协作驳回", verb: "驳回了协作变更", tone: "red" },
  "due_date.approved": { category: "task", label: "截止变更通过", verb: "通过了截止日期变更", tone: "amber" },
  "due_date.rejected": { category: "task", label: "截止变更驳回", verb: "驳回了截止日期变更", tone: "red" },
  "abandon.approved": { category: "task", label: "放弃通过", verb: "通过了放弃任务申请", tone: "red" },
  "abandon.rejected": { category: "task", label: "放弃驳回", verb: "驳回了放弃任务申请", tone: "slate" },
  "merge.approved": { category: "task", label: "合并通过", verb: "通过了任务合并申请", tone: "emerald" },
  "merge.rejected": { category: "task", label: "合并驳回", verb: "驳回了任务合并申请", tone: "slate" },
  // Flow
  "flow.saved": { category: "approval_flow", label: "保存配置", verb: "保存了审批流配置", tone: "blue" },
  "flow.node_added": { category: "approval_flow", label: "新增节点", verb: "新增了审批节点", tone: "emerald" },
  "flow.node_removed": { category: "approval_flow", label: "删除节点", verb: "删除了审批节点", tone: "red" },
  "flow.node_edited": { category: "approval_flow", label: "编辑节点", verb: "修改了审批节点", tone: "blue" },
  "flow.mode_changed": { category: "approval_flow", label: "切换模式", verb: "切换了审核模式", tone: "amber" },
  "flow.reset": { category: "approval_flow", label: "恢复默认", verb: "恢复了默认审批流", tone: "amber" },
  // Person
  "person.created": { category: "person", label: "成员新增", verb: "新增了成员", tone: "emerald" },
  "person.edited": { category: "person", label: "成员编辑", verb: "修改了成员信息", tone: "blue" },
  "person.deleted": { category: "person", label: "删除成员", verb: "删除了成员", tone: "red" },
  "person.status_changed": { category: "person", label: "状态变更", verb: "变更了成员状态", tone: "amber" },
  // Role
  "role.permissions_changed": { category: "role", label: "权限变更", verb: "调整了角色权限", tone: "violet" },
  // AI
  "ai.parse_triggered": { category: "ai", label: "AI 解析", verb: "触发了 AI 解析", tone: "violet" },
  "ai.suggestion_accepted": { category: "ai", label: "采纳 AI 建议", verb: "采纳了 AI 建议", tone: "emerald" },
  "ai.suggestion_rejected": { category: "ai", label: "拒绝 AI 建议", verb: "拒绝了 AI 建议", tone: "red" },
  "ai.regenerated": { category: "ai", label: "重新生成", verb: "重新生成了 AI 输出", tone: "blue" },
  "ai.proposal_refined": { category: "ai", label: "AI 优化立项", verb: "使用 AI 优化了立项", tone: "violet" },
  "ai.proposal_refine_applied": { category: "ai", label: "应用 AI 优化", verb: "应用了 AI 立项优化结果", tone: "emerald" },
  // Category / sub-project tree
  "category.created": { category: "system", label: "新建分类", verb: "新建了分类", tone: "emerald" },
  "category.edited": { category: "system", label: "编辑分类", verb: "修改了分类", tone: "blue" },
  "category.deleted": { category: "system", label: "删除分类", verb: "删除了分类", tone: "red" },
  "sub_project.created": { category: "system", label: "新建子项目", verb: "新建了子项目", tone: "emerald" },
  "sub_project.edited": { category: "system", label: "编辑子项目", verb: "修改了子项目", tone: "blue" },
  "sub_project.deleted": { category: "system", label: "删除子项目", verb: "删除了子项目", tone: "red" },
  // System
  "system.bulk_reassign": { category: "system", label: "批量转派", verb: "执行了批量转派", tone: "violet" },
  "notification.handled": { category: "system", label: "通知处理", verb: "处理了通知", tone: "slate" },
  "daily_report.generated": { category: "system", label: "生成日报", verb: "生成了研发日报", tone: "blue" },
  "daily_progress.synced": { category: "system", label: "同步进展", verb: "同步了今日研发进展", tone: "emerald" },
  "task.data.cleared": { category: "system", label: "清理任务数据", verb: "清理了研发任务数据", tone: "amber" },
  // Knowledge Base
  "kb.entry.uploaded": { category: "knowledge", label: "上传知识库文件", verb: "上传了知识库文件", tone: "blue" },
  "kb.entry.edited": { category: "knowledge", label: "编辑知识库文件", verb: "修改了知识库文件信息", tone: "blue" },
  "kb.entry.moved": { category: "knowledge", label: "移动知识库文件", verb: "移动了知识库文件分类", tone: "violet" },
  "kb.entry.deleted": { category: "knowledge", label: "删除知识库文件", verb: "删除了知识库文件", tone: "red" },
  "kb.category.created": { category: "knowledge", label: "新建知识库分类", verb: "新建了知识库分类", tone: "emerald" },
  "kb.category.edited": { category: "knowledge", label: "编辑知识库分类", verb: "修改了知识库分类", tone: "blue" },
  "kb.category.deleted": { category: "knowledge", label: "删除知识库分类", verb: "删除了知识库分类", tone: "red" },
};

export function getAuditActionMeta(action: unknown): AuditActionMeta {
  if (typeof action === "string" && Object.prototype.hasOwnProperty.call(AUDIT_ACTION_META, action)) {
    return AUDIT_ACTION_META[action as AuditAction];
  }

  if (typeof action === "string" && action.trim()) {
    return { ...UNKNOWN_AUDIT_ACTION_META, label: action };
  }

  return UNKNOWN_AUDIT_ACTION_META;
}

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  task: "任务",
  proposal: "立项",
  approval_flow: "审批流",
  person: "人员",
  role: "角色权限",
  ai: "AI",
  knowledge: "知识库",
  system: "系统",
};

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * 离线回显缓存键同时按工作区和登录用户分开。服务端负责最终权限隔离，用户维度的
 * 本地键则避免同一浏览器切换账号时，普通成员短暂读取到管理员留下的完整缓存。
 */
function storageKey(userId: string | null | undefined = getStoredUser()?.id): string {
  const workspaceKey = isUsCollabWorkspace() ? "rd-audit-logs-v1.us-collab" : "rd-audit-logs-v1";
  const identityKey = userId ? encodeURIComponent(userId) : "anonymous";
  return `${workspaceKey}.user.${identityKey}`;
}
const AUDIT_EVENT = "rd-audit-log-changed";
const MAX_LOGS = 1000;

/**
 * ⚠️ 异步回调里必须传 key 快照，不能让它重新求值。
 * storageKey() 依赖当前 location.pathname 和已登录用户：请求在途时切换工作区或账号，
 * 响应回来后重新求值会把留痕写进错误缓存。同步路径不传即可（此刻上下文仍是发起方）。
 */
function loadRaw(key: string = storageKey()): AuditLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(logs: AuditLog[], emit = true, key: string = storageKey()): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(logs));
  if (emit) {
    window.dispatchEvent(new CustomEvent(AUDIT_EVENT));
  }
}

/**
 * 从服务端拉取最新审计流并广播刷新（供「服务端落审计」的操作在成功后调用，
 * 让当前页面的时间线立即看到服务端新写入的记录，无需等下次挂载）。
 */
export async function syncAuditLogsFromRemote(): Promise<void> {
  const key = storageKey(); // await 之前取，防响应回来时用户已切池（见 loadRaw 注释）
  try {
    const remoteLogs = await fetchRdAuditLogs<AuditLog>();
    saveRaw(remoteLogs.slice(0, MAX_LOGS), true, key);
  } catch {
    // 拉取失败不打扰用户：下次组件挂载会自然刷新
  }
}

/**
 * 给某条留痕追加一条备注。成功后把更新后的留痕写回本地缓存并广播 AUDIT_EVENT，
 * 让所有 `useAuditLogs()` 立即刷新看到新备注。返回更新后的留痕。
 * 写入失败时会抛出异常（不再静默吞错），由调用方捕获并提示用户——
 * 否则备注其实没写进后端，UI 却「假装成功」，会导致谁都看不到。
 */
export async function addAuditLogNote(logId: string, note: { text: string }): Promise<AuditLog> {
  const key = storageKey(); // await 之前取，防响应回来时用户已切池
  const updated = await addRdAuditLogNote<AuditLog>(logId, note);
  const current = loadRaw(key).map((log) => (log.id === updated.id ? updated : log));
  saveRaw(current, true, key); // emit=true → 广播事件，触发各处 useAuditLogs 从本地刷新
  return updated;
}

/**
 * Returns the current logged-in user as an `AuditActor`. Use this in components
 * that record audit entries so the actor name reflects who actually triggered
 * the action (e.g. "刘致远") instead of a placeholder like "我".
 */
export function useAuditActor(roleFallback?: string): AuditActor {
  const { user } = useAuth();
  return useMemo<AuditActor>(() => {
    if (!user) {
      return { id: "anonymous", name: "未登录用户", role: roleFallback ?? "未知" };
    }
    return {
      id: user.id,
      name: user.name?.trim() || user.email || "未命名用户",
      role: user.roleName ?? roleFallback ?? "研发成员",
    };
  }, [user, roleFallback]);
}

// ─── Query ───────────────────────────────────────────────────────────────────

export type AuditFilter = {
  category?: AuditCategory | "all";
  actorId?: string;
  resourceType?: AuditResource["type"];
  resourceId?: string;
  action?: AuditAction;
  /** ISO string lower bound (inclusive) */
  since?: string;
  /** ISO string upper bound (exclusive) */
  until?: string;
  /** Free text matched against actor name / resource name / comment */
  keyword?: string;
};

function filterLogs(logs: AuditLog[], filter: AuditFilter = {}): AuditLog[] {
  return logs.filter((log) => {
    if (filter.category && filter.category !== "all") {
      if (getAuditActionMeta(log.action).category !== filter.category) return false;
    }
    if (filter.actorId && log.actor.id !== filter.actorId) return false;
    if (filter.resourceType && log.resource.type !== filter.resourceType) return false;
    if (filter.resourceId && log.resource.id !== filter.resourceId) return false;
    if (filter.action && log.action !== filter.action) return false;
    if (filter.since && log.timestamp < filter.since) return false;
    if (filter.until && log.timestamp >= filter.until) return false;
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      const hay = `${log.actor.name} ${log.resource.name ?? ""} ${log.comment ?? ""}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/** 写操作后重新拉取留痕的防抖窗口：一次界面操作往往连发数个写请求。 */
const AUDIT_REFRESH_DEBOUNCE_MS = 400;

// ─── React hook ──────────────────────────────────────────────────────────────

/** Subscribe to audit logs with optional filter. Re-renders on AUDIT_EVENT. */
export function useAuditLogs(filter?: AuditFilter): AuditLog[] {
  const { user } = useAuth();
  const filterKey = useMemo(() => JSON.stringify(filter ?? {}), [filter]);
  const viewerKey = useMemo(
    () => JSON.stringify([user?.id ?? "", user?.name ?? "", [...(user?.permissions ?? [])].sort()]),
    [user?.id, user?.name, user?.permissions],
  );
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    const key = storageKey(user?.id);
    const visibleLogs = (items: AuditLog[]) => filterLogs(filterAuditLogsForViewer(items, user), filter);
    const refreshLocal = () => setLogs(visibleLogs(loadRaw(key)));
    // 指定了资源就让服务端按资源过滤：留痕由服务端随每次变更写入，条数远多于从前，
    // 「拉最新一批再本地筛」会让稍早任务的时间线整段落到上限之外。
    const scoped = Boolean(filter?.resourceId || filter?.resourceType);
    const refreshRemote = async () => {
      try {
        const remoteLogs = await fetchRdAuditLogs<AuditLog>(
          scoped ? { resourceType: filter?.resourceType, resourceId: filter?.resourceId } : undefined,
        );
        if (cancelled) return;
        // 只有全量拉取才回写共享缓存：把某个任务的子集写进去会让其它订阅者看到残缺数据
        if (!scoped) saveRaw(remoteLogs.slice(0, MAX_LOGS), false, key);
        setLogs(visibleLogs(remoteLogs));
      } catch {
        if (!cancelled) {
          refreshLocal();
        }
      }
    };

    void refreshRemote();
    if (typeof window === "undefined") return;
    // 写操作后重新拉取：留痕在服务端写，本地缓存里不会凭空出现新记录。
    // 一次操作常连着发好几个写请求，防抖合并成一次拉取。
    let pending: number | undefined;
    const refreshAfterMutation = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        // 标签页在后台时没人在看时间线，等回到前台再拉
        if (document.visibilityState === "hidden") return;
        void refreshRemote();
      }, AUDIT_REFRESH_DEBOUNCE_MS);
    };
    // AUDIT_EVENT 表示共享缓存被更新，只对全量订阅者有意义；
    // 按资源过滤的订阅者从缓存回填会看到别的任务的记录，只跟着写操作重新拉取
    if (!scoped) window.addEventListener(AUDIT_EVENT, refreshLocal);
    window.addEventListener(RD_MUTATED_EVENT, refreshAfterMutation);
    return () => {
      cancelled = true;
      window.clearTimeout(pending);
      window.removeEventListener(AUDIT_EVENT, refreshLocal);
      window.removeEventListener(RD_MUTATED_EVENT, refreshAfterMutation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, viewerKey]);

  return logs;
}

// ─── Demo seed (only on first load) ──────────────────────────────────────────

function offsetDate(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function generateDemoLogs(): AuditLog[] {
  const wangzy: AuditActor = { id: "u-wang-zy", name: "王志远", role: "研发主管" };
  const lili: AuditActor = { id: "u-li-li", name: "李立", role: "研发管理员" };
  const wanglei: AuditActor = { id: "u1", name: "王磊", role: "硬件测试工程师" };
  const chenjing: AuditActor = { id: "u2", name: "陈静", role: "质检员" };
  const zhangyue: AuditActor = { id: "u4", name: "张越", role: "嵌入式工程师" };
  const ai: AuditActor = { id: "ai-system", name: "AI 助手", role: "系统" };

  const seeds: Omit<AuditLog, "id">[] = [
    // === 最近 1 小时 ===
    {
      timestamp: offsetDate(0.2),
      actor: wangzy,
      action: "proposal.approved",
      resource: { type: "proposal", id: "PRJ-2026-001", name: "电磁阀工艺升级 v2.1" },
      comment: "已与硬件组确认资源，可推进。",
      source: "web",
    },
    {
      timestamp: offsetDate(0.5),
      actor: lili,
      action: "proposal.approved",
      resource: { type: "proposal", id: "PRJ-2026-001", name: "电磁阀工艺升级 v2.1" },
      comment: "一审通过，转交终审。",
      source: "web",
    },
    {
      timestamp: offsetDate(0.8),
      actor: wanglei,
      action: "task.progress_updated",
      resource: { type: "task", id: "RD-2026-001", name: "电磁阀温升测试" },
      changes: [{ field: "progress", before: 45, after: 62 }],
      source: "web",
    },
    // === 最近 3 小时 ===
    {
      timestamp: offsetDate(2),
      actor: wanglei,
      action: "task.status_changed",
      resource: { type: "task", id: "RD-2026-003", name: "Station 温升整机测试" },
      changes: [{ field: "status", before: "in_progress", after: "blocked" }],
      comment: "测试夹具未到位，等待采购。",
      source: "web",
    },
    {
      timestamp: offsetDate(2.5),
      actor: ai,
      action: "ai.parse_triggered",
      resource: { type: "proposal", id: "PRJ-2026-001", name: "电磁阀工艺升级 v2.1" },
      metadata: { tasks_generated: 3, confidence: 0.88 },
      source: "ai",
    },
    {
      timestamp: offsetDate(3),
      actor: wanglei,
      action: "proposal.submitted",
      resource: { type: "proposal", id: "PRJ-2026-001", name: "电磁阀工艺升级 v2.1" },
      comment: "本立项已与研发主管口头对齐，请尽快推进。",
      source: "web",
    },
    // === 今天早些 ===
    {
      timestamp: offsetDate(6),
      actor: lili,
      action: "flow.saved",
      resource: { type: "flow", id: "flow-project-default", name: "立项审批 · 默认流程" },
      changes: [
        { field: "node[终审].mode", before: "single", after: "any" },
      ],
      comment: "改为或签，避免研发主管出差时审批堵塞。",
      source: "web",
    },
    {
      timestamp: offsetDate(7),
      actor: wangzy,
      action: "system.bulk_reassign",
      resource: { type: "system", id: "batch-001" },
      metadata: { from: "李静(请假)", to: "周华", task_count: 4 },
      comment: "李静请假期间，转派 4 个任务给周华。",
      source: "web",
    },
    {
      timestamp: offsetDate(8),
      actor: chenjing,
      action: "task.comment_added",
      resource: { type: "task", id: "RD-2026-001", name: "电磁阀温升测试" },
      comment: "建议增加 -10°C 工况测试。",
      source: "web",
    },
    // === 昨天 ===
    {
      timestamp: offsetDate(28),
      actor: zhangyue,
      action: "task.status_changed",
      resource: { type: "task", id: "RD-2026-024", name: "串口握手协议联调" },
      changes: [{ field: "status", before: "in_progress", after: "blocked" }],
      comment: "对接设备 SDK 缺失，等供应商提供。",
      source: "web",
    },
    {
      timestamp: offsetDate(30),
      actor: lili,
      action: "person.created",
      resource: { type: "person", id: "u8", name: "周明" },
      metadata: { position: "电源工程师", department: "硬件组" },
      source: "web",
    },
    {
      timestamp: offsetDate(36),
      actor: wanglei,
      action: "task.priority_changed",
      resource: { type: "task", id: "RD-2026-001", name: "电磁阀温升测试" },
      changes: [{ field: "priority", before: "medium", after: "high" }],
      comment: "组长要求提升优先级。",
      source: "web",
    },
    // === 2 天前 ===
    {
      timestamp: offsetDate(52),
      actor: ai,
      action: "ai.suggestion_accepted",
      resource: { type: "task", id: "RD-2026-006", name: "电池循环寿命测试" },
      metadata: { suggestion: "建议增加低温放电曲线对比", confidence: 0.76 },
      source: "ai",
    },
    {
      timestamp: offsetDate(60),
      actor: lili,
      action: "role.permissions_changed",
      resource: { type: "role", id: "role-rd-admin", name: "研发管理员" },
      changes: [
        { field: "permissions", before: ["rd-task:edit"], after: ["rd-task:edit", "rd-project:review-l1"] },
      ],
      comment: "新增立项一审权限。",
      source: "web",
    },
    {
      timestamp: offsetDate(70),
      actor: wangzy,
      action: "proposal.direct_dispatched",
      resource: { type: "proposal", id: "PRJ-2025-018", name: "车充 EMC 整改" },
      metadata: { tasks_created: 6 },
      comment: "紧急整改，跳过审核直接分配。",
      source: "web",
    },
    // === 3-7 天前 ===
    {
      timestamp: offsetDate(80),
      actor: chenjing,
      action: "task.attachment_added",
      resource: { type: "task", id: "RD-2026-006", name: "电池循环寿命测试" },
      metadata: { filename: "循环寿命数据_第3轮.xlsx" },
      source: "web",
    },
    {
      timestamp: offsetDate(100),
      actor: lili,
      action: "flow.node_added",
      resource: { type: "flow", id: "flow-project-default", name: "立项审批 · 默认流程" },
      metadata: { node_label: "终审", permission: "rd-project:review-l2" },
      source: "web",
    },
    {
      timestamp: offsetDate(120),
      actor: wanglei,
      action: "task.created",
      resource: { type: "task", id: "RD-2026-014", name: "电磁阀寿命测试夹具阻塞" },
      metadata: { category: "硬件/电磁阀/工艺类" },
      source: "web",
    },
    {
      timestamp: offsetDate(140),
      actor: wangzy,
      action: "person.status_changed",
      resource: { type: "person", id: "u3", name: "李静" },
      changes: [{ field: "status", before: "active", after: "on_leave" }],
      comment: "李静请假至 5-22。",
      source: "web",
    },
    {
      timestamp: offsetDate(168),
      actor: lili,
      action: "proposal.rejected",
      resource: { type: "proposal", id: "PRJ-2025-016", name: "外观结构二期升级" },
      comment: "方案中部件依赖未理清，请补充后重提。",
      source: "web",
    },
  ];

  return seeds.map((s, idx) => ({
    ...s,
    id: `log-seed-${idx}`,
  }));
}

// ─── Future API surface (commented stubs) ────────────────────────────────────
//
// export async function recordAuditApi(entry: Omit<AuditLog, 'id'|'timestamp'>): Promise<AuditLog> {
//   const res = await authFetch("/audit-logs", { method: "POST", body: JSON.stringify(entry) });
//   if (!res.ok) throw new Error(await readErrorMessage(res));
//   return res.json();
// }
//
// export async function queryLogsApi(filter: AuditFilter): Promise<AuditLog[]> {
//   const qs = new URLSearchParams(filter as any).toString();
//   const res = await authFetch(`/audit-logs?${qs}`);
//   if (!res.ok) throw new Error(await readErrorMessage(res));
//   return res.json();
// }

// ─── 统一操作留痕（全站合并页）────────────────────────────────────────────────
//
// 研发 / 中美协同 / 采购三个留痕页合并为 /audit-log 后，读取一律走 /api/audit/logs：
// 筛选、分页、可见范围都在服务端收口，前端不再把全量日志拉到内存里自己算。
// 上面的 useAuditLogs 保留不动 —— 那是任务详情时间轴的既有读取通路。

/** 服务端返回的留痕。比 AuditLog 宽松：跨模块后 resource.type 是任意业务段名，操作人可能已注销。 */
export type UnifiedAuditLog = Omit<AuditLog, "actor" | "resource"> & {
  module: string;
  actor: { id: string | null; name: string; role?: string; deleted?: boolean };
  resource: { type: string; id: string | null; name?: string | null };
  ip?: string | null;
};

export type UnifiedAuditQuery = {
  module?: string;
  source?: string;
  /** 动作码列表。类目 → 动作码的展开在前端做，服务端不复制 AUDIT_ACTION_META。 */
  actions?: string[];
  resource?: string;
  resourceId?: string;
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
  snapshotAt?: string;
  /**
   * 手上这份统计是基于哪个筛选指纹算出来的，原样回带即可。
   * 指纹由服务端按实际生效的筛选（含可见范围）生成，一致就跳过重算——
   * 前端不必自己判断「筛选条件变了没有」，将来加筛选维度也不会漏。
   */
  statsSignature?: string;
};

export type AuditStats = {
  uniqueActors: number;
  uniqueResources: number;
  /** 去重统计到达取数上限：真实值更大，显示成 “N+”。 */
  actorsCapped: boolean;
  resourcesCapped: boolean;
  aiCount: number;
  riskCount: number;
};

export type UnifiedAuditPage = {
  total: number;
  page: number;
  pageSize: number;
  snapshotAt: string;
  canViewAll: boolean;
  /** 本次筛选条件的服务端指纹；下次请求原样回带即可跳过统计重算。 */
  filterSignature: string;
  /** 只在请求了统计时返回；翻页时为 null，调用方沿用上一次的结果。 */
  stats: AuditStats | null;
  items: UnifiedAuditLog[];
};

export type AuditFacets = {
  modules: Array<{ value: string; count: number }>;
  actions: Array<{ value: string; count: number }>;
  resources: Array<{ value: string; count: number }>;
  actors: Array<{ id: string | null; name: string; count: number }>;
};

/** 模块展示名。查不到就显示原始 module 值——新模块接入时页面不会因为漏加词条而显示空白。 */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  rd: "研发任务管理",
  "us-collab": "中美协同",
  production: "生产",
  procurement: "供应链管理",
  auth: "登录与账号",
  chat: "智能助手",
  chat_tool: "智能助手工具",
  chat_pending_action: "智能助手待确认动作",
  files: "文件",
  "image-generation": "图片生成",
  image_generation_upstream: "图片生成上游",
  "video-generation": "视频生成",
  "integration-management": "集成管理",
  "electronic-gate": "电子闸门",
  i18n: "多语言",
  rag: "知识检索",
  other: "其他",
};

export function auditModuleLabel(module: string): string {
  return AUDIT_MODULE_LABELS[module] ?? module;
}

/** 某个类目下的全部动作码。映射只存在 AUDIT_ACTION_META 一处，服务端按结果做 IN 过滤。 */
export function actionsForCategory(category: AuditCategory): string[] {
  return Object.entries(AUDIT_ACTION_META)
    .filter(([, meta]) => meta.category === category)
    .map(([action]) => action);
}

/** UnifiedAuditLog → AuditLog：把宽松字段收回严格类型，供既有的 AuditTimeline 直接渲染。 */
export function toTimelineLog(log: UnifiedAuditLog): AuditLog {
  return {
    ...log,
    actor: { id: log.actor.id ?? "", name: log.actor.name, role: log.actor.role },
    resource: {
      type: log.resource.type as AuditResource["type"],
      id: log.resource.id ?? "",
      name: log.resource.name ?? undefined,
    },
  };
}

function buildAuditQuery(query: UnifiedAuditQuery): string {
  const params = new URLSearchParams();
  const put = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "" ) return;
    params.set(key, String(value));
  };
  put("module", query.module);
  put("source", query.source);
  put("resource", query.resource);
  put("resourceId", query.resourceId);
  put("actorUserId", query.actorUserId);
  put("dateFrom", query.dateFrom);
  put("dateTo", query.dateTo);
  put("keyword", query.keyword);
  put("sort", query.sort);
  put("page", query.page);
  put("pageSize", query.pageSize);
  put("snapshotAt", query.snapshotAt);
  put("statsSignature", query.statsSignature);
  if (query.actions && query.actions.length > 0) params.set("actions", query.actions.join(","));
  return params.toString();
}

async function auditRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `操作留痕请求失败：${response.status}`));
  }
  return response.json() as Promise<T>;
}

export function fetchAuditLogPage(query: UnifiedAuditQuery): Promise<UnifiedAuditPage> {
  const qs = buildAuditQuery(query);
  return auditRequest<UnifiedAuditPage>(`/api/audit/logs${qs ? `?${qs}` : ""}`);
}

export function fetchAuditFacets(module?: string): Promise<AuditFacets> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  return auditRequest<AuditFacets>(`/api/audit/facets${qs}`);
}
