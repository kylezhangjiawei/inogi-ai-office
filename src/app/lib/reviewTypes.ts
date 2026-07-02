// 研发审核类型「单一事实源」(前端)
// 四种审核类型的中文标签、类型 badge 样式、对应审计动作集中在此定义。
// 各审核入口（消息中心 / 个人工作台 / 任务管理驾驶舱 / 主管驾驶舱）一律引用本表，
// 不再各写各的，避免不同类型的文案/流程互相污染。后端有一份等价定义。
import type { PersistedAuditAction } from "./auditLog";

export type ReviewType = "proposal" | "result" | "collaboration" | "due_date" | "abandon" | "merge";

export type ReviewTypeMeta = {
  key: ReviewType;
  /** 中文标签：立项 / 成果 / 协作变更 / 截止日期变更 */
  label: string;
  /** 类型 badge 的 tailwind 配色（待审核列表、审核卡、通知等统一使用） */
  badgeClass: string;
  /** 通过 / 驳回 对应的审计动作（决定留痕显示什么文案，不再一律"立项"） */
  approveAction: PersistedAuditAction;
  rejectAction: PersistedAuditAction;
};

export const REVIEW_TYPE_META: Record<ReviewType, ReviewTypeMeta> = {
  proposal: {
    key: "proposal",
    label: "立项",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    approveAction: "proposal.approved",
    rejectAction: "proposal.rejected",
  },
  result: {
    key: "result",
    label: "成果",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    approveAction: "result.approved",
    rejectAction: "result.rejected",
  },
  collaboration: {
    key: "collaboration",
    label: "协作变更",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    approveAction: "collaboration.approved",
    rejectAction: "collaboration.rejected",
  },
  due_date: {
    key: "due_date",
    label: "截止日期变更",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    approveAction: "due_date.approved",
    rejectAction: "due_date.rejected",
  },
  abandon: {
    key: "abandon",
    label: "放弃任务",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    approveAction: "abandon.approved",
    rejectAction: "abandon.rejected",
  },
  merge: {
    key: "merge",
    label: "任务合并",
    badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200",
    approveAction: "merge.approved",
    rejectAction: "merge.rejected",
  },
};

/** 取审核类型元数据；类型缺失/未知返回 null（调用方据此拒绝或提示刷新）。 */
export function getReviewTypeMeta(type: string | null | undefined): ReviewTypeMeta | null {
  if (!type) return null;
  return (REVIEW_TYPE_META as Record<string, ReviewTypeMeta>)[type] ?? null;
}

/** 取审核类型中文标签；未知返回"审核"。仅用于展示。 */
export function reviewTypeLabel(type: string | null | undefined): string {
  return getReviewTypeMeta(type)?.label ?? "审核";
}
