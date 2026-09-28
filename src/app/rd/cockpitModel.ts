import {
  type TaskStatus,
  type Priority,
  type Task,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "./taskModel";
import React from "react";
import {
  Battery,
  CarFront,
  CircleDot,
  Code2,
  Cpu,
  Gauge,
  LayoutGrid,
  Lock,
  Wind,
} from "lucide-react";
import { daysUntilDue, isTaskOverdue } from "../lib/taskDue";
import { type RdTaskNoteReceipt } from "../lib/rdApi";
import { t } from "../lib/i18n";
import { rdTaskMatchesAllText } from "../lib/rdTaskTextSearch";
import { type Risk } from "../lib/rdCockpitMetrics";

// 研发执行提示 KPI 卡片筛选：点击 KPI 卡片可筛选下方任务列表
export type KpiFilter = "all" | "in_progress" | "completed" | "blocked" | "risk";

export const KPI_FILTER_LABEL: Record<KpiFilter, string> = {
  all: "全部",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "阻塞 / 待派",
  risk: "风险任务",
};

export type TaskActivityActor = { id?: string | null; name: string };

// ─── Demo data ────────────────────────────────────────────────────────────────

export const POC_BOM_STRUCTURE = [
  { id: "cat-power", label: "电源部分", parts: ["电池", "电池PCB"] },
  { id: "cat-base", label: "底部结构", parts: ["底座", "底座减震器", "底座进气隔板", "底座过滤棉"] },
  { id: "cat-compression", label: "压缩系统", parts: ["压缩机", "压缩机罩"] },
  { id: "cat-valve-310", label: "310阀系统", parts: ["310阀组", "310电磁阀"] },
  { id: "cat-cooling", label: "风冷系统", parts: ["电风扇"] },
  { id: "cat-air-storage", label: "储气系统", parts: ["储气罐", "储气罐进气隔板"] },
  { id: "cat-valve-210", label: "210阀系统", parts: ["210阀组", "210电磁阀"] },
  { id: "cat-top", label: "Top结构", parts: ["Top板", "成孔螺丝", "显示屏"] },
  { id: "cat-molecular-sieve", label: "分子筛系统", parts: ["分子筛转接板", "分子筛", "分子筛衬板", "分子筛隔板", "分子筛筛料", "分子筛弹簧", "分子筛上密封圈", "分子筛下密封圈"] },
  { id: "cat-exterior", label: "外观结构", parts: ["外罩", "隔热贴"] },
  { id: "cat-accessories", label: "配件系统", parts: ["车充", "快充", "普充"] },
  { id: "cat-tube", label: "气管系统", parts: ["硅胶管", "接头", "卡箍"], reserved: true },
  { id: "cat-harness", label: "线束系统", parts: ["主线束", "电池线", "风扇线", "屏线"], reserved: true },
  { id: "cat-fastener", label: "紧固件系统", parts: ["螺丝", "铜柱", "螺母"], reserved: true },
  { id: "cat-sealing", label: "密封系统", parts: ["O-ring", "泡棉", "密封胶"], reserved: true },
] as const;

const POC_BOM_RESERVED_IDS = new Set<string>(
  POC_BOM_STRUCTURE.filter((system) => "reserved" in system && system.reserved).map((system) => system.id),
);

// ─── Theme: per-category accent (kept minimal — only icon color + dot) ───────

export type CategoryTheme = {
  iconColor: string;
  dot: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const CATEGORY_THEME: Record<string, CategoryTheme> = {
  "cat-power": { iconColor: "text-amber-500", dot: "bg-amber-500", Icon: Battery },
  "cat-base": { iconColor: "text-slate-600", dot: "bg-slate-500", Icon: LayoutGrid },
  "cat-compression": { iconColor: "text-blue-500", dot: "bg-blue-500", Icon: Cpu },
  "cat-valve-310": { iconColor: "text-cyan-600", dot: "bg-cyan-500", Icon: Wind },
  "cat-cooling": { iconColor: "text-sky-500", dot: "bg-sky-500", Icon: Wind },
  "cat-air-storage": { iconColor: "text-emerald-500", dot: "bg-emerald-500", Icon: Gauge },
  "cat-valve-210": { iconColor: "text-teal-600", dot: "bg-teal-500", Icon: Wind },
  "cat-top": { iconColor: "text-violet-500", dot: "bg-violet-500", Icon: Code2 },
  "cat-molecular-sieve": { iconColor: "text-indigo-500", dot: "bg-indigo-500", Icon: Cpu },
  "cat-exterior": { iconColor: "text-rose-500", dot: "bg-rose-500", Icon: CarFront },
  "cat-accessories": { iconColor: "text-orange-500", dot: "bg-orange-500", Icon: Battery },
  "cat-tube": { iconColor: "text-lime-600", dot: "bg-lime-500", Icon: Wind },
  "cat-harness": { iconColor: "text-purple-500", dot: "bg-purple-500", Icon: Code2 },
  "cat-fastener": { iconColor: "text-stone-600", dot: "bg-stone-500", Icon: Lock },
  "cat-sealing": { iconColor: "text-pink-500", dot: "bg-pink-500", Icon: CircleDot },
};

const DEFAULT_THEME: CategoryTheme = { iconColor: "text-muted-foreground", dot: "bg-slate-400", Icon: LayoutGrid };

export function getTheme(id: string): CategoryTheme {
  return CATEGORY_THEME[id] ?? DEFAULT_THEME;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeIdentity(value?: string | null) {
  return (value ?? "")
    .trim()
    .replace(/[（(].*?[）)]/g, "")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "");
}

/**
 * 与服务端 isTaskParticipant 保持同一口径：已有 user_id 时只按 id 严格匹配，
 * 仅历史未绑定 id 的参与者才允许使用规范化姓名兜底。
 */
export function matchesCurrentTaskParticipant(
  participantUserId: string | null | undefined,
  participantName: string | null | undefined,
  currentUserId: string | null | undefined,
  currentUserName: string | null | undefined,
) {
  const boundUserId = (participantUserId ?? "").trim();
  if (boundUserId) return Boolean((currentUserId ?? "").trim()) && boundUserId === (currentUserId ?? "").trim();
  const currentNameKey = normalizeIdentity(currentUserName);
  return Boolean(currentNameKey) && normalizeIdentity(participantName) === currentNameKey;
}

export function daysUntil(dateStr?: string): number | null {
  return daysUntilDue(dateStr);
}

/** 「最近更新」的时效档位：越新越亮，越旧越淡。 */
type RelativeUpdateTone = "fresh" | "recent" | "aging" | "stale" | "cold";

/**
 * 时效档位 → 字色与字重。大屏上一眼扫过去，靠颜色深浅和字重区分"刚动过"和"很久没动"。
 * 最淡的一档停在 slate-400（= 改造前所有条目的统一颜色），保证没有任何条目比原来更难读。
 */
export const RELATIVE_UPDATE_TONE_CLASS: Record<RelativeUpdateTone, string> = {
  fresh: "font-semibold text-emerald-600",
  recent: "font-medium text-sky-600",
  aging: "text-slate-600",
  stale: "text-slate-500",
  cold: "text-muted-foreground",
};

/**
 * 把 ISO 时间戳格式化成"最近更新"的相对短语 + 配色 tone：
 *   今天 HH:MM / N 分钟前 (绿 + 加粗，最新)
 *   昨天      (蓝)
 *   2-7 天前  (深灰)
 *   8-30 天前 (中灰)
 *   N 个月前 / N 年前 (浅灰，最淡)
 */
export function formatRelativeUpdate(iso?: string | null): {
  label: string;
  tone: RelativeUpdateTone;
} | null {
  if (!iso) return null;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const now = Date.now();
  const diffMs = now - timestamp;
  if (diffMs < 0) {
    // 未来时间（数据脏）按"刚刚"处理
    return { label: t("刚刚"), tone: "fresh" };
  }
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return { label: t("刚刚"), tone: "fresh" };
  if (min < 60) return { label: t("{n} 分钟前", { n: min }), tone: "fresh" };

  // 按"自然日"计算今天/昨天，不是 24 小时
  const dt = new Date(iso);
  const todayNow = new Date();
  const dtDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const todayDay = new Date(todayNow.getFullYear(), todayNow.getMonth(), todayNow.getDate());
  const dayDiff = Math.floor((todayDay.getTime() - dtDay.getTime()) / 86_400_000);

  const hhmm = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return { label: t("今天 {time}", { time: hhmm }), tone: "fresh" };
  if (dayDiff === 1) return { label: t("昨天 {time}", { time: hhmm }), tone: "recent" };
  if (dayDiff <= 30) return { label: t("{n} 天前", { n: dayDiff }), tone: dayDiff <= 7 ? "aging" : "stale" };
  if (dayDiff <= 365) return { label: t("{n} 个月前", { n: Math.floor(dayDiff / 30) }), tone: "cold" };
  return { label: t("{n} 年前", { n: Math.floor(dayDiff / 365) }), tone: "cold" };
}

export function collectTaskIds(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  function walk(items: Task[]) {
    for (const task of items) {
      ids.add(task.task_id);
      if (task.subtasks) walk(task.subtasks);
    }
  }
  walk(tasks);
  return ids;
}

export const RISK_LABEL: Record<Risk["type"], string> = {
  overdue: "已逾期",
  due_soon: "即将到期",
  blocked: "阻塞",
  pending: "待指派",
  slow: "进度滞后",
};

export const RISK_DOT_COLOR: Record<Risk["type"], string> = {
  overdue: "bg-red-500",
  due_soon: "bg-orange-500",
  blocked: "bg-orange-500",
  pending: "bg-violet-500",
  slow: "bg-amber-500",
};

export function isReservedBomSystem(categoryId: string) {
  return POC_BOM_RESERVED_IDS.has(categoryId);
}

export function splitCategoryPath(path?: string) {
  return (path ?? "")
    .split(/[\/／>＞]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// ─── Tree sections ────────────────────────────────────────────────────────────

export type TaskDueFilter = "all" | "overdue" | "today" | "3d" | "7d" | "no_due";

function taskDueMatches(task: Task, dueFilter: TaskDueFilter): boolean {
  if (dueFilter === "all") return true;
  const days = daysUntil(task.due_date);
  if (dueFilter === "no_due") return days === null;
  if (days === null) return false;
  if (dueFilter === "overdue") return isTaskOverdue(task);
  if (dueFilter === "today") return days === 0;
  if (dueFilter === "3d") return days >= 0 && days <= 3;
  if (dueFilter === "7d") return days >= 0 && days <= 7;
  return true;
}

export function taskMatches(
  task: Task,
  keyword: string,
  statusFilter: TaskStatus | "all",
  priorityFilter: Priority | "all" = "all",
  dueFilter: TaskDueFilter = "all",
): boolean {
  if (statusFilter !== "all" && task.status !== statusFilter) return false;
  if (priorityFilter !== "all" && task.final_priority !== priorityFilter) return false;
  if (!taskDueMatches(task, dueFilter)) return false;
  return rdTaskMatchesAllText(task, keyword, [
    STATUS_CONFIG[task.status]?.label ?? "",
    PRIORITY_CONFIG[task.final_priority]?.label ?? "",
    PRIORITY_CONFIG[task.ai_priority]?.label ?? "",
  ]);
}

/** 备注回执 map：驾驶舱深层卡片经 context 读取（管理视角：他人给任务留的备注是否被目标人查看/跟进）。 */
export const NoteReceiptContext = React.createContext<Record<string, RdTaskNoteReceipt>>({});

// 任务「最近活动」排序键：与卡片标签 lastUpdateIso 同一兜底链
//   last_activity_at(后端派生 = max(updated_at, 最新留痕时间)) → 最新留痕时间 → updated_at。
// 排序与显示共用此键，保证「列表里越靠前 = 标签显示越新」，不会出现标签新却排在后面的逆序。
export function taskActivityKey(t: Task): string {
  return t.last_activity_at || t.latest_progress_summary?.created_at || t.updated_at || "";
}
