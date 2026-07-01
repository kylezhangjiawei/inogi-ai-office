/**
 * 问题模块的中文标签映射 + 语义化徽标样式配置。
 * 颜色一律走 Tailwind 语义色阶（含 dark: 变体），不硬编码 hex（规格 §7）。
 * 整体对齐项目 Material 风：冷中性 slate 底 + 项目主色 indigo + 各维度语义色。
 */
import type {
  CauseDimension,
  IssueSource,
  IssueStatus,
  Likelihood,
  Severity,
  SolutionType,
} from "./types";

export type BadgeStyle = { label: string; className: string };

// ── 来源 ───────────────────────────────────────────────────────────────────────
export const SOURCE_LABEL: Record<IssueSource, string> = { rd: "研发", production: "生产" };

// ── 严重度 ─────────────────────────────────────────────────────────────────────
export const SEVERITY_CONFIG: Record<Severity, BadgeStyle> = {
  fatal: { label: "致命", className: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" },
  major: { label: "严重", className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300" },
  normal: { label: "一般", className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300" },
  minor: { label: "轻微", className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-300" },
};
/** 严重度排序权重（高→低），用于排序展示。 */
export const SEVERITY_WEIGHT: Record<Severity, number> = { fatal: 4, major: 3, normal: 2, minor: 1 };

// ── 状态 ───────────────────────────────────────────────────────────────────────
export const STATUS_CONFIG: Record<IssueStatus, BadgeStyle & { dot: string }> = {
  pending: { label: "待分析", dot: "bg-slate-400", className: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-300" },
  analyzing: { label: "分析中", dot: "bg-blue-500 animate-pulse", className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300" },
  adjusting: { label: "调整中", dot: "bg-amber-500", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  adopted: { label: "已采纳", dot: "bg-emerald-500", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" },
  archived: { label: "已完结", dot: "bg-indigo-500", className: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300" },
};

/** 状态 → 分段筛选组。 */
export function statusGroupOf(status: IssueStatus): "pending" | "processing" | "solved" {
  if (status === "pending") return "pending";
  if (status === "analyzing" || status === "adjusting") return "processing";
  return "solved"; // adopted | archived
}

export const STATUS_GROUP_LABEL: Record<"all" | "pending" | "processing" | "solved" | "reusable", string> = {
  all: "全部",
  pending: "待分析",
  processing: "处理中",
  solved: "已解决",
  reusable: "可复用",
};

// ── 方案类型 ───────────────────────────────────────────────────────────────────
export const SOLUTION_TYPE_CONFIG: Record<SolutionType, BadgeStyle> = {
  contain: { label: "临时遏制", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
  correct: { label: "长期纠正", className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300" },
  prevent: { label: "预防", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" },
};

// ── 可能性 ─────────────────────────────────────────────────────────────────────
export const LIKELIHOOD_CONFIG: Record<Likelihood, BadgeStyle & { dot: string }> = {
  high: { label: "高", dot: "bg-red-500", className: "text-red-600 dark:text-red-400" },
  medium: { label: "中", dot: "bg-amber-500", className: "text-amber-600 dark:text-amber-400" },
  low: { label: "低", dot: "bg-slate-400", className: "text-slate-500 dark:text-slate-400" },
};

// ── 6M 维度（固定封闭集，各一套语义色）──────────────────────────────────────────
export const DIMENSION_CONFIG: Record<CauseDimension, { label: string; full: string; chip: string; bar: string; swatch: string }> = {
  人: { label: "人", full: "人 人员/操作", chip: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300", bar: "bg-indigo-500", swatch: "bg-indigo-500" },
  机: { label: "机", full: "机 设备/机构", chip: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300", bar: "bg-sky-500", swatch: "bg-sky-500" },
  料: { label: "料", full: "料 物料/元器件", chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300", bar: "bg-amber-500", swatch: "bg-amber-500" },
  法: { label: "法", full: "法 方法/工艺", chip: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300", bar: "bg-violet-500", swatch: "bg-violet-500" },
  环: { label: "环", full: "环 环境", chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300", bar: "bg-emerald-500", swatch: "bg-emerald-500" },
  测: { label: "测", full: "测 测量/检测", chip: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300", bar: "bg-rose-500", swatch: "bg-rose-500" },
};
