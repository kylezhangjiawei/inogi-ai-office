/**
 * 留痕（审计日志）基础设施
 *
 * 设计原则：
 * 1. 每个关键操作都通过 `recordAudit()` 记录
 * 2. 同一份日志可在「全局审计日志」「资源详情时间轴」复用
 * 3. 通过研发模块 API 持久化；localStorage 仅作为离线乐观回显
 * 4. 通过 CustomEvent 让任意 `useAuditLogs()` 实时刷新
 */

import { useEffect, useMemo, useState } from "react";
import { clearRdAuditLogs, createRdAuditLog, fetchRdAuditLogs } from "./rdApi";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "task"
  | "proposal"
  | "approval_flow"
  | "person"
  | "role"
  | "ai"
  | "system";

export type AuditAction =
  // Task lifecycle
  | "task.created"
  | "task.edited"
  | "task.status_changed"
  | "task.priority_changed"
  | "task.assigned"
  | "task.reassigned"
  | "task.archived"
  | "task.unarchived"
  | "task.progress_updated"
  | "task.comment_added"
  | "task.attachment_added"
  | "task.evidence_uploaded"
  | "task.handoff_requested"
  | "task.submitted"
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
  // System
  | "system.bulk_reassign"
  | "notification.handled"
  | "daily_report.generated"
  | "daily_progress.synced";

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
    | "system";
  id: string;
  name?: string;
};

export type AuditChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

export type AuditLog = {
  id: string;
  timestamp: string;
  actor: AuditActor;
  action: AuditAction;
  resource: AuditResource;
  changes?: AuditChange[];
  comment?: string;
  metadata?: Record<string, unknown>;
  source: "web" | "api" | "ai" | "system";
};

// ─── Action metadata (icon hint, label, verb) ────────────────────────────────

export const AUDIT_ACTION_META: Record<
  AuditAction,
  { category: AuditCategory; label: string; verb: string; tone: "blue" | "emerald" | "amber" | "red" | "violet" | "slate" }
> = {
  // Task
  "task.created": { category: "task", label: "新建任务", verb: "创建了任务", tone: "blue" },
  "task.edited": { category: "task", label: "编辑任务", verb: "修改了任务", tone: "blue" },
  "task.status_changed": { category: "task", label: "状态变更", verb: "变更了任务状态", tone: "amber" },
  "task.priority_changed": { category: "task", label: "优先级变更", verb: "调整了任务优先级", tone: "amber" },
  "task.assigned": { category: "task", label: "指派任务", verb: "指派了任务", tone: "violet" },
  "task.reassigned": { category: "task", label: "转派任务", verb: "转派了任务", tone: "violet" },
  "task.archived": { category: "task", label: "封存任务", verb: "封存了任务", tone: "slate" },
  "task.unarchived": { category: "task", label: "解封任务", verb: "解封了任务", tone: "emerald" },
  "task.progress_updated": { category: "task", label: "进度更新", verb: "更新了任务进度", tone: "blue" },
  "task.comment_added": { category: "task", label: "添加评论", verb: "评论了任务", tone: "slate" },
  "task.attachment_added": { category: "task", label: "添加附件", verb: "上传了附件", tone: "slate" },
  "task.evidence_uploaded": { category: "task", label: "上传依据", verb: "上传了任务依据", tone: "slate" },
  "task.handoff_requested": { category: "task", label: "提交移交", verb: "提交了任务移交流程", tone: "violet" },
  "task.submitted": { category: "task", label: "提交审核", verb: "提交了任务结果审核", tone: "blue" },
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
  // Flow
  "flow.saved": { category: "approval_flow", label: "保存配置", verb: "保存了审批流配置", tone: "blue" },
  "flow.node_added": { category: "approval_flow", label: "新增节点", verb: "新增了审批节点", tone: "emerald" },
  "flow.node_removed": { category: "approval_flow", label: "删除节点", verb: "删除了审批节点", tone: "red" },
  "flow.node_edited": { category: "approval_flow", label: "编辑节点", verb: "修改了审批节点", tone: "blue" },
  "flow.mode_changed": { category: "approval_flow", label: "切换模式", verb: "切换了审核模式", tone: "amber" },
  "flow.reset": { category: "approval_flow", label: "恢复默认", verb: "恢复了默认审批流", tone: "amber" },
  // Person
  "person.created": { category: "person", label: "新增成员", verb: "新增了成员", tone: "emerald" },
  "person.edited": { category: "person", label: "编辑成员", verb: "修改了成员信息", tone: "blue" },
  "person.deleted": { category: "person", label: "删除成员", verb: "删除了成员", tone: "red" },
  "person.status_changed": { category: "person", label: "状态变更", verb: "变更了成员状态", tone: "amber" },
  // Role
  "role.permissions_changed": { category: "role", label: "权限变更", verb: "调整了角色权限", tone: "violet" },
  // AI
  "ai.parse_triggered": { category: "ai", label: "AI 解析", verb: "触发了 AI 解析", tone: "violet" },
  "ai.suggestion_accepted": { category: "ai", label: "采纳 AI 建议", verb: "采纳了 AI 建议", tone: "emerald" },
  "ai.suggestion_rejected": { category: "ai", label: "拒绝 AI 建议", verb: "拒绝了 AI 建议", tone: "red" },
  "ai.regenerated": { category: "ai", label: "重新生成", verb: "重新生成了 AI 输出", tone: "blue" },
  // System
  "system.bulk_reassign": { category: "system", label: "批量重分配", verb: "执行了批量重分配", tone: "violet" },
  "notification.handled": { category: "system", label: "通知处理", verb: "处理了通知", tone: "slate" },
  "daily_report.generated": { category: "system", label: "生成日报", verb: "生成了研发日报", tone: "blue" },
  "daily_progress.synced": { category: "system", label: "同步进展", verb: "同步了今日研发进展", tone: "emerald" },
};

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  task: "任务",
  proposal: "立项",
  approval_flow: "审批流",
  person: "人员",
  role: "角色权限",
  ai: "AI",
  system: "系统",
};

// ─── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "rd-audit-logs-v1";
const AUDIT_EVENT = "rd-audit-log-changed";
const MAX_LOGS = 1000;

function loadRaw(): AuditLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(logs: AuditLog[], emit = true): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  if (emit) {
    window.dispatchEvent(new CustomEvent(AUDIT_EVENT));
  }
}

/** Record a new audit entry. Returns the saved entry with id and timestamp. */
export function recordAudit(entry: Omit<AuditLog, "id" | "timestamp">): AuditLog {
  const full: AuditLog = {
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  const logs = loadRaw();
  logs.unshift(full); // newest first
  saveRaw(logs.slice(0, MAX_LOGS));
  void createRdAuditLog<AuditLog>(full)
    .then((saved) => {
      const current = loadRaw().filter((log) => log.id !== saved.id);
      saveRaw([saved, ...current].slice(0, MAX_LOGS));
    })
    .catch(() => {
      // Keep optimistic local copy; the next successful API read will reconcile.
    });
  return full;
}

/** Load all logs (newest first). */
export function loadLogs(): AuditLog[] {
  return loadRaw();
}

/** Clear all logs (admin only). */
export function clearLogs(): void {
  saveRaw([]);
  void clearRdAuditLogs().catch(() => {});
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
      if (AUDIT_ACTION_META[log.action].category !== filter.category) return false;
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

export function queryLogs(filter: AuditFilter = {}): AuditLog[] {
  return filterLogs(loadLogs(), filter);
}

// ─── React hook ──────────────────────────────────────────────────────────────

/** Subscribe to audit logs with optional filter. Re-renders on `recordAudit()`. */
export function useAuditLogs(filter?: AuditFilter): AuditLog[] {
  const filterKey = useMemo(() => JSON.stringify(filter ?? {}), [filter]);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refreshLocal = () => setLogs(queryLogs(filter));
    const refreshRemote = async () => {
      try {
        const remoteLogs = await fetchRdAuditLogs<AuditLog>();
        if (cancelled) return;
        saveRaw(remoteLogs.slice(0, MAX_LOGS), false);
        setLogs(filterLogs(remoteLogs, filter));
      } catch {
        if (!cancelled) {
          refreshLocal();
        }
      }
    };

    void refreshRemote();
    if (typeof window === "undefined") return;
    window.addEventListener(AUDIT_EVENT, refreshLocal);
    return () => {
      cancelled = true;
      window.removeEventListener(AUDIT_EVENT, refreshLocal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return logs;
}

// ─── Demo seed (only on first load) ──────────────────────────────────────────

function offsetDate(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function generateDemoLogs(): AuditLog[] {
  const wangzy: AuditActor = { id: "u-wang-zy", name: "王志远", role: "厂长" };
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
      comment: "本立项已与厂长口头对齐，请尽快推进。",
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
      comment: "改为或签，避免厂长出差时审批堵塞。",
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
