import React, { useCallback, useDeferredValue, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Battery,
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  CopyCheck,
  Cpu,
  FileUp,
  Flame,
  FolderPlus,
  Gauge,
  GitBranch,
  Image as ImageIcon,
  LayoutGrid,
  Layers3,
  ListChecks,
  Loader2,
  Lock,
  Minimize2,
  MoreVertical,
  Paperclip,
  FileText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  UserCog,
  UserPlus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Target,
  TimerReset,
  Users,
  Wind,
  X,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { inferAttachmentMime } from "./components/AttachmentPreviewDialog";
import { MobileZoomableImage } from "./components/MobileZoomableImage";
import { formatTraceDateTime } from "./RDProgressEvidence";
import { CollapseTransition } from "./components/CollapseTransition";
import { useAuth } from "./auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { usePermission, useAnyPermission } from "./hooks/usePermission";
import { AuditLog } from "./lib/auditLog";
import { daysUntilDue, taskOverdueDays, isTaskOverdue, todayLocalDateStr } from "./lib/taskDue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { PERMISSIONS, isSuperAdmin } from "./lib/permissions";
import { useLayoutChromeActions } from "./lib/layoutChrome";
import {
  backfillRdTaskCompletionScores,
  backfillRdTaskProgressNoteExtraction,
  fetchRdAiSettings,
  fetchRdPeople,
  fetchRdTaskCategories,
  fetchRdMemberTaskCategories,
  fetchRdCockpitTaskCategories,
  fetchRdTaskCompletionScore,
  fetchRdTaskCompletionScores,
  fetchRdTaskCompletionScoreDebug,
  fetchRdTaskAttachmentPreviews,
  fetchRdTaskAttachments,
  fetchRdTaskProgressNotes,
  fetchRdProductionTaskSyncs,
  buildRdTaskAttachmentPayload,
  createRdTask,
  deleteRdTask,
  extractRdTasksFromFile,
  extractRdTasksFromText,
  saveRdTaskCategories,
  moveRdTasks,
  clearRdAllTaskData,
  classifyRdProject,
  attachRdTasksToParent,
  updateRdTask,
  fetchRdProducts,
  saveRdProducts,
  fetchProductTaskCategories,
  saveProductTaskCategories,
  revokeRdTaskProductionSync,
  syncRdTaskToProduction,
  type RdAiPersonContext,
  type RdAiProjectClassificationResult,
  type RdAiSettingsPayload,
  type RdAiTaskDraft,
  type RdCategory,
  type RdCollaborator,
  type RdPersonLoad,
  type RdPriority,
  type RdSubProject,
  type RdTask,
  type RdWorkspaceTask,
  type RdTaskCompletionScore,
  type RdTaskCompletionScoreDebug,
  type RdTaskAttachmentPreview,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
  type RdWorkItem,
  isUsCollabWorkspace,
  isProductionWorkspace,
  isProductionMirrorTask,
  workItemsFeatureEnabled,
  blockedDaysOf,
  type RdTaskStatus,
  type RdProductDef,
  type RdProductStatus,
  getAttachmentUrl,
  getAttachmentThumbUrl,
  isDefaultSubProject,
  RD_DEFAULT_SUBPROJECT_LABEL,
} from "./lib/rdApi";
import { RDReportsPanel } from "./RDReportsPanel";
import { SubsystemOperationsPanel } from "./procurement/components/SubsystemOperationsPanel";
import { ProgressAttachmentGrid } from "./RDProgressEvidence";
import { fetchRdDailyReports, fetchRdTaskNoteReceipts, markRdTaskNotesRead, type RdDailyReport, type RdTaskNoteReceipt } from "./lib/rdApi";
import { getGradeTone } from "./lib/taskCompletionScore";
import { openTaskCompletionReport, openBatchCompletionReport } from "./lib/taskCompletionReport";
import { useAvatarDirectory } from "./lib/userAvatar";
import { currentI18nLang, i18nLocale, t, useI18n } from "./lib/i18n";
import { rdTaskMatchesAllText } from "./lib/rdTaskTextSearch";
import { rootTasksFromCategories } from "./lib/rdTaskTreeVisibility";
import { isNonPersonTaskOwner, isTaskOwnerMember, memberIdentityKey } from "./lib/rdMemberIdentity";
// 驾驶舱指标只保留一份实现（移动端 useRDCockpitData 用的是同一份），避免修一处漏一处。
import {
  buildCatStats,
  computePersonLoads,
  computeRisks,
  flattenTasks,
  getTaskRiskReason,
  type CatStat,
  type PersonLoad,
  type Risk,
} from "./lib/rdCockpitMetrics";
// 保留原有对外导出面：两个任务详情页引用 flattenTasks。
export { buildCatStats, computePersonLoads, computeRisks, flattenTasks };
export type { CatStat, PersonLoad, Risk };

// 研发执行提示 KPI 卡片筛选：点击 KPI 卡片可筛选下方任务列表
type KpiFilter = "all" | "in_progress" | "completed" | "blocked" | "risk";

const KPI_FILTER_LABEL: Record<KpiFilter, string> = {
  all: "全部",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "阻塞 / 待派",
  risk: "风险任务",
};

// AI 全量归纳暂不对外开放：保留完整分析与人工确认流程，后续评审通过后只需恢复此开关。
const AI_FULL_CLASSIFICATION_VISIBLE = false;

/**
 * 「已归档」的统一判定，与后端 isArchivedTask 完全一致：archived 标志 **或** status==='archived'。
 * 只认 archived 标志会漏判——虽然当前唯一的归档写入路径（applyTaskMerge）两个字段都会写，
 * 但历史/导入数据未必，统计口径按两者取或才不会被歪掉。
 */
export function isArchivedTask(task: Pick<Task, "archived" | "status">): boolean {
  return task.archived === true || task.status === "archived";
}

type TaskActivityActor = { id?: string | null; name: string };
type SystemHealth = "healthy" | "watch" | "alert" | "idle";

const HEALTH_CONFIG: Record<
  SystemHealth,
  { border: string; dot: string; text: string; label: string; tint: string }
> = {
  healthy: {
    border: "border-slate-200/80",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    label: "健康",
    tint: "bg-gradient-to-br from-white via-white to-emerald-50/60",
  },
  watch: {
    border: "border-slate-200/80",
    dot: "bg-amber-500",
    text: "text-amber-700",
    label: "注意",
    tint: "bg-gradient-to-br from-white via-white to-amber-50/60",
  },
  alert: {
    border: "border-slate-200/80",
    dot: "bg-rose-500",
    text: "text-rose-700",
    label: "警报",
    tint: "bg-gradient-to-br from-white via-white to-rose-50/65",
  },
  idle: {
    border: "border-slate-200/80",
    dot: "bg-slate-300",
    text: "text-slate-500",
    label: "空闲",
    tint: "bg-gradient-to-br from-white via-white to-slate-50",
  },
};


import { AutoTranslatedText, fetchContentTranslation } from "./components/TranslatableText";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { RdTaskExportButton } from "./components/RdTaskExportButton";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Calendar } from "./components/ui/calendar";

const RD_MOTION_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const RD_FAST_TRANSITION = { duration: 0.18, ease: RD_MOTION_EASE };
const RD_LIST_TRANSITION = { duration: 0.2, ease: RD_MOTION_EASE };
const RD_PANEL_TRANSITION = { duration: 0.24, ease: RD_MOTION_EASE };

// ─── Types (aliased from rdApi shared types) ─────────────────────────────────

type TaskStatus = RdTaskStatus;
type Priority = RdPriority;
type Collaborator = RdCollaborator;
type Task = RdTask;
type SubProject = RdSubProject;
// 带并发上限地映射数组，避免批量导出时一次性发起成百上千个请求压垮浏览器/后端。
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
type Category = RdCategory;
type ProductDef = RdProductDef;
export type PersonProfile = {
  id: string;
  user_id?: string | null;
  name: string;
  position: string;
  department?: string;
  email?: string;
  phone?: string;
  max_tasks?: number;
  on_leave?: boolean;
  status?: string;
  /** 账号状态（ACTIVE / INVITED / DISABLED）：@ 候选据此排除已停用账号 */
  user_status?: string | null;
  joined_at?: string;
};

// ─── Today ───────────────────────────────────────────────────────────────────
// 取值规则统一收敛到 lib/taskDue.ts：每次调用重新求值（不能存成模块级常量，否则页面
// 跨零点后逾期判定全部错），且取本地日历日（不能用 toISOString，UTC+8 每天 0–8 点会错一天）。
const todayStr = () => todayLocalDateStr();

// ─── Demo data ────────────────────────────────────────────────────────────────

const POC_BOM_STRUCTURE = [
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

type CategoryTheme = {
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

const DEFAULT_THEME: CategoryTheme = { iconColor: "text-slate-400", dot: "bg-slate-400", Icon: LayoutGrid };

function getTheme(id: string): CategoryTheme {
  return CATEGORY_THEME[id] ?? DEFAULT_THEME;
}

// ─── Status / Priority config ────────────────────────────────────────────────

export const STATUS_CONFIG: Record<TaskStatus, { label: string; dot: string; text: string; bg: string }> = {
  draft: { label: "草稿", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100" },
  in_progress: { label: "进行中", dot: "bg-indigo-500", text: "text-indigo-700", bg: "bg-indigo-50" },
  paused_leave: { label: "暂停·请假", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  paused_blocked: { label: "暂停·阻塞", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  completed: { label: "已完成", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  pending_assign: { label: "待指派", dot: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50" },
  pending_review: { label: "待审核", dot: "bg-purple-500", text: "text-purple-700", bg: "bg-purple-50" },
  on_hold: { label: "已挂起", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100" },
  archived: { label: "已封存", dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-100" },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; text: string; bg: string }> = {
  high: { label: "高", text: "text-white", bg: "border-red-600 bg-red-600" },
  medium: { label: "中", text: "text-amber-700", bg: "border-amber-200 bg-amber-50" },
  low: { label: "低", text: "text-slate-500", bg: "border-slate-200 bg-slate-50" },
};

// 行内纯文字（无徽章背景）场景的优先级文字色：高优先不能复用 PRIORITY_CONFIG.high.text
// 的 text-white —— 白字需配合红底徽章，单独用会在浅色卡片上隐形（优先级"消失"）。
const PRIORITY_INLINE_TEXT: Record<Priority, string> = {
  high: "text-red-600",
  medium: "text-amber-700",
  low: "text-slate-500",
};

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

export function resolveDeleteDialogTargetAfterSuccess<T extends { task_id: string }>(
  currentTarget: T | null,
  requestedTaskId: string,
) {
  return currentTarget?.task_id === requestedTaskId ? null : currentTarget;
}

function taskVisibleTitle(task: Pick<Task, "task_id" | "title">) {
  const title = typeof task.title === "string" ? task.title.trim() : "";
  if (title) return title;
  const taskId = typeof task.task_id === "string" ? task.task_id.trim() : "";
  return taskId
    ? t("未命名任务（{id}）", { id: taskId })
    : t("未命名任务");
}

function daysUntil(dateStr?: string): number | null {
  return daysUntilDue(dateStr);
}

/** 「最近更新」的时效档位：越新越亮，越旧越淡。 */
type RelativeUpdateTone = "fresh" | "recent" | "aging" | "stale" | "cold";

/**
 * 时效档位 → 字色与字重。大屏上一眼扫过去，靠颜色深浅和字重区分"刚动过"和"很久没动"。
 * 最淡的一档停在 slate-400（= 改造前所有条目的统一颜色），保证没有任何条目比原来更难读。
 */
const RELATIVE_UPDATE_TONE_CLASS: Record<RelativeUpdateTone, string> = {
  fresh: "font-semibold text-emerald-600",
  recent: "font-medium text-sky-600",
  aging: "text-slate-600",
  stale: "text-slate-500",
  cold: "text-slate-400",
};

/**
 * 把 ISO 时间戳格式化成"最近更新"的相对短语 + 配色 tone：
 *   今天 HH:MM / N 分钟前 (绿 + 加粗，最新)
 *   昨天      (蓝)
 *   2-7 天前  (深灰)
 *   8-30 天前 (中灰)
 *   N 个月前 / N 年前 (浅灰，最淡)
 */
function formatRelativeUpdate(iso?: string | null): {
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

function collectTaskIds(tasks: Task[]): Set<string> {
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

/**
 * 父子索引：子任务 task_id → 其父任务。以「结构位置」为准（谁在谁的 subtasks 里），
 * 不看 parent_task_id 字段——存量子任务没有该字段，只认字段会把它们误判成顶层任务。
 */
export function buildSubtaskParentIndex(categories: Category[]): Map<string, Task> {
  const index = new Map<string, Task>();
  const walk = (tasks: Task[], parent: Task | null) => {
    for (const task of tasks) {
      if (parent) index.set(task.task_id, parent);
      if (task.subtasks?.length) walk(task.subtasks, task);
    }
  };
  for (const cat of categories) for (const sub of cat.children) walk(sub.tasks, null);
  return index;
}

/** 顶层任务（不在任何任务的 subtasks 里）。用于「并入已有任务」的候选列表与统计口径标注。 */
export function collectTopLevelTasks(categories: Category[]): Task[] {
  return categories.flatMap((cat) => cat.children.flatMap((sub) => sub.tasks));
}

function calcCategoryProgress(cat: Category): number {
  const tasks = rootTasksFromCategories([cat]).filter((t) => !isArchivedTask(t));
  if (tasks.length === 0) return 0;
  return Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length);
}

function calcSubProgress(sub: SubProject): number {
  const tasks = sub.tasks.filter((t) => !isArchivedTask(t));
  if (tasks.length === 0) return 0;
  return Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length);
}

function hashColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

// ─── Atomic UI ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TaskStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", cfg.dot)}
      title={t(cfg.label)}
      aria-label={t(cfg.label)}
    />
  );
}

function PriorityPill({ priority, aiPriority }: { priority: Priority; aiPriority?: Priority }) {
  const cfg = PRIORITY_CONFIG[priority];
  const adjusted = aiPriority !== undefined && priority !== aiPriority;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none",
        cfg.bg,
        cfg.text,
        adjusted && "ring-1 ring-amber-300",
      )}
      title={adjusted && aiPriority ? t("AI 建议: {priority}，已被组长调整", { priority: t(PRIORITY_CONFIG[aiPriority].label) }) : t("优先级 {priority}", { priority: t(cfg.label) })}
    >
      {t(cfg.label)}
      {adjusted && <span className="ml-px text-[8px] opacity-70">·</span>}
    </span>
  );
}

/** 只翻译系统占位名（待指派等），真人名原样返回——防止人名恰好撞上字典 key 被误翻（如单字名「高」→High）。 */
export function displayPersonName(name: string): string {
  const raw = name ?? "";
  return /^待指派$|^未指派$|^外部机构$|已离职/.test(raw) ? t(raw) : raw;
}

export function OwnerAvatar({
  name,
  size = "sm",
  userId,
}: {
  name: string;
  size?: "sm" | "xs";
  userId?: string | null;
}) {
  useI18n(); // 占位名（待指派）经 t() 显示，须订阅语言切换
  const resolveAvatar = useAvatarDirectory();
  const avatarUrl = resolveAvatar(name, userId);
  const [imgFailed, setImgFailed] = useState(false);
  // 头像 URL 变化（目录加载完成 / 失效重取）时重置失败态，允许新 URL 重新尝试
  useEffect(() => { setImgFailed(false); }, [avatarUrl]);

  // 系统占位名（待指派等）走字典翻译后再显示/取首字，英文态头像显示 "U" 而非 "待"
  const displayName = displayPersonName(name);
  const initial = displayName.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "xs" ? "h-5 w-5" : "h-6 w-6";
  const textSize = size === "xs" ? "text-[10px]" : "text-xs";

  // 有真实头像 → 渲染图片；无头像或加载失败 → 回退文字首字母（原行为）
  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        title={displayName}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={cn("inline-block shrink-0 rounded-full object-cover ring-2 ring-white", dim)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white",
        dim,
        textSize,
        hashColor(name),
      )}
      title={displayName}
    >
      {initial}
    </span>
  );
}

function ProgressBar({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "muted" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          tone === "muted" ? "bg-slate-300" : value === 100 ? "bg-emerald-500" : "bg-indigo-500",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// ─── Risk Banner ──────────────────────────────────────────────────────────────

const RISK_ICON: Record<Risk["type"], React.ComponentType<{ className?: string }>> = {
  overdue: AlertTriangle,
  due_soon: TimerReset,
  blocked: AlertTriangle,
  pending: CircleDot,
  slow: Flame,
};

const RISK_LABEL: Record<Risk["type"], string> = {
  overdue: "已逾期",
  due_soon: "即将到期",
  blocked: "阻塞",
  pending: "待指派",
  slow: "进度滞后",
};

const RISK_DOT_COLOR: Record<Risk["type"], string> = {
  overdue: "bg-red-500",
  due_soon: "bg-orange-500",
  blocked: "bg-orange-500",
  pending: "bg-violet-500",
  slow: "bg-amber-500",
};

/**
 * Tooltip content listing risk tasks. Used by AlertTriangle hover affordances.
 * Shows up to `max` items, with type label + task title + risk reason.
 */
function RiskListTooltip({
  title,
  risks,
  max = 6,
}: {
  title: string;
  risks: Risk[];
  max?: number;
}) {
  const shown = risks.slice(0, max);
  const hidden = Math.max(0, risks.length - max);
  return (
    <div className="max-w-xs space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
        <span>{title}</span>
      </div>
      <ul className="space-y-1 text-[11px]">
        {shown.map((r) => (
          <li key={r.task.task_id + r.type} className="flex items-start gap-1.5">
            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", RISK_DOT_COLOR[r.type])} />
            <span className="min-w-0 flex-1">
              <span className="font-medium opacity-95">{t(RISK_LABEL[r.type])}</span>
              <span className="opacity-60"> · {r.reason}</span>
              <div className="truncate opacity-80">{r.task.title}</div>
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="text-[11px] opacity-60">{t("…还有 {count} 项", { count: hidden })}</li>}
      </ul>
    </div>
  );
}

function RiskCard({ risk, onClick }: { risk: Risk; onClick: () => void }) {
  const Icon = RISK_ICON[risk.type];
  const isCritical = risk.severity === "critical";
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-[280px] shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/70",
      )}
    >
      <span className={cn("h-8 w-1 shrink-0 rounded-full", isCritical ? "bg-red-500" : "bg-amber-400")} />
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", isCritical ? "text-red-600" : "text-amber-600")}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <AutoTranslatedText as="div" className="truncate text-sm font-semibold text-slate-900" text={risk.task.title} />
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <span className={cn("font-semibold", isCritical ? "text-red-600" : "text-amber-600")}>{t(risk.reason)}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{risk.task.primary_owner}</span>
        </div>
      </div>
    </button>
  );
}

function RiskBanner({ risks, onOpen }: { risks: Risk[]; onOpen: (t: Task) => void }) {
  if (risks.length === 0) return null;
  const critCount = risks.filter((r) => r.severity === "critical").length;
  return (
    <div className="rounded-[8px] bg-red-50/55 px-3 py-2.5 ring-1 ring-red-100/80">
      <div className="mb-2.5 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <h3 className="text-[15px] font-semibold text-slate-800">{t("需要立刻关注")}</h3>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-red-600">{critCount}</span> {t("紧急")} ·{" "}
          <span className="font-semibold text-amber-600">{risks.length - critCount}</span> {t("警告")}
        </span>
        <span className="ml-auto hidden text-xs font-medium text-slate-500 sm:inline">{t("逾期 / 阻塞 / 高优滞后")}</span>
      </div>
      <div className="-mb-1 flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
        {risks.map((r) => (
          <RiskCard key={r.task.task_id + r.type} risk={r} onClick={() => onOpen(r.task)} />
        ))}
      </div>
    </div>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function DueDateChip({ task }: { task: Task }) {
  const dateStr = task.due_date;
  if (!dateStr) return null;
  const dleft = daysUntil(dateStr);
  if (dleft === null) return null;
  const overdueDays = taskOverdueDays(task);
  const isOverdue = overdueDays > 0;
  // 过了截止日但不算逾期（如按时提交、正待审核的任务）→ 中性显示日期，不标红"逾期"（方案B）。
  const tone = isOverdue
    ? "bg-red-50 text-red-700 border-red-200"
    : dleft < 0
      ? "bg-slate-50 text-slate-600 border-slate-200"
      : dleft <= 2
        ? "bg-orange-50 text-orange-700 border-orange-200"
        : dleft <= 7
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-slate-50 text-slate-600 border-slate-200";
  const label = isOverdue
    ? `逾期 ${overdueDays}d`
    : dleft < 0
      ? dateStr.slice(5)
      : dleft === 0 ? t("今日") : dleft <= 7 ? t("{days}天后", { days: dleft }) : dateStr.slice(5);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold", tone)}>
      <TimerReset className="h-3 w-3" />
      {label}
    </span>
  );
}

function taskNeedsAttention(task: Task): boolean {
  const dleft = daysUntil(task.due_date);
  const ownRisk =
    !task.archived &&
    task.status !== "completed" &&
    (task.status === "paused_blocked" ||
      task.status === "pending_assign" ||
      (dleft !== null && dleft <= 2) ||
      (task.final_priority === "high" && task.progress < 30));

  return ownRisk || Boolean(task.subtasks?.some((sub) => taskNeedsAttention(sub)));
}

function taskAccentClass(task: Task) {
  if (task.archived) return "bg-slate-400";
  if (task.status === "paused_blocked") return "bg-red-500";
  if (task.status === "pending_assign") return "bg-violet-500";
  if (task.final_priority === "high") return "bg-red-500";
  if (task.status === "completed") return "bg-emerald-400";
  if (task.status === "paused_leave") return "bg-amber-400";
  return "bg-indigo-500";
}

// ─── Dual-signal: category frame + priority bar ──────────────────────────────

type Frame = {
  border: string;       // outer card border color
  tintedBg: string;     // subtask container bg
  softBg: string;       // even softer for deeper levels
};

const CATEGORY_FRAME: Record<string, Frame> = {};
const DEFAULT_FRAME: Frame = { border: "border-slate-200", tintedBg: "bg-slate-50", softBg: "bg-white" };

// Infer category id from task.category_path's first segment (system label)
const CATEGORY_LABEL_TO_ID: Record<string, string> = Object.fromEntries(
  POC_BOM_STRUCTURE.map((system) => [system.label, system.id]),
);

function isReservedBomSystem(categoryId: string) {
  return POC_BOM_RESERVED_IDS.has(categoryId);
}

function splitCategoryPath(path?: string) {
  return (path ?? "")
    .split(/[\/／>＞]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getTaskCategoryId(task: Task): string | null {
  const first = splitCategoryPath(task.category_path)[0];
  return first ? CATEGORY_LABEL_TO_ID[first] ?? null : null;
}

function getTaskFrame(task: Task): Frame {
  const id = getTaskCategoryId(task);
  return id ? CATEGORY_FRAME[id] ?? DEFAULT_FRAME : DEFAULT_FRAME;
}

// Pure priority weight — independent of status, used for left bar
function getPriorityBarClass(task: Task): string {
  if (task.archived) return "bg-slate-300";
  if (task.status === "completed") return "bg-emerald-400";
  switch (task.final_priority) {
    case "high":
      return "bg-red-500";
    case "medium":
      return "bg-amber-400";
    case "low":
      return "bg-slate-300";
  }
}

function TaskItem({
  task,
  onOpen,
  depth = 0,
}: {
  task: Task;
  onOpen: (t: Task) => void;
  depth?: number;
}) {
  const statusCfg = STATUS_CONFIG[task.status];
  const dleft = daysUntil(task.due_date);
  const isHot =
    !task.archived &&
    dleft !== null &&
    dleft <= 2 &&
    task.status !== "completed" &&
    task.status !== "paused_leave";
  useI18n(); // 状态徽标/标题等经 t()，须订阅语言切换
  const hasSubtasks = !!task.subtasks && task.subtasks.length > 0;
  const attention = taskNeedsAttention(task);
  const [expanded, setExpanded] = useState(depth === 0 && hasSubtasks && attention);
  const indent = depth === 0 ? 14 : depth * 24 + 26;

  return (
    <>
      <div
        onClick={() => onOpen(task)}
        className={cn(
          "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-md py-2 pr-3 text-left transition-colors",
          depth === 0
            ? "min-h-10 border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:border-slate-300 hover:bg-slate-50"
            : "min-h-9 rounded-none hover:bg-white/80",
          task.archived && "opacity-50",
          depth > 0 && "text-sm",
        )}
        style={{ paddingLeft: `${indent}px` }}
        title={t(statusCfg.label)}
      >
        {depth === 0 ? (
          <span className={cn("absolute bottom-1.5 left-0 top-1.5 w-1 rounded-full", taskAccentClass(task))} />
        ) : (
          <span
            className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-slate-300"
            style={{ left: `${Math.max(10, indent - 16)}px`, width: 10 }}
          />
        )}

        {/* Expand chevron */}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors",
            hasSubtasks ? "bg-slate-200 text-slate-700 hover:bg-slate-300 hover:text-slate-900" : "text-transparent",
          )}
          onClick={(e) => {
            if (hasSubtasks) {
              e.stopPropagation();
              setExpanded((v) => !v);
            }
          }}
        >
          {hasSubtasks ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-slate-600 hover:text-slate-900" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-600 hover:text-slate-900" />
            )
          ) : null}
        </span>

        {/* Status */}
        <span className="flex w-3 shrink-0 justify-center">
          {task.archived ? <Lock className="h-3.5 w-3.5 text-slate-500" /> : <StatusDot status={task.status} />}
        </span>

        {/* Priority */}
        <PriorityPill priority={task.final_priority} aiPriority={task.ai_priority} />

        {/* Title + latest progress summary */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            {/* depth>0 即处于父任务的 subtasks 里 → 打子任务身份徽标 */}
            {depth > 0 && <SubtaskBadge task={task} />}
            <span
              className={cn(
                "truncate",
                "line-clamp-2 break-words", // 长标题最多两行，超过省略
                task.archived
                  ? "text-slate-400 line-through"
                  : task.status === "completed"
                    ? "text-slate-400"
                    : depth === 0
                      ? "text-[15px] font-semibold text-slate-950"
                      : "text-sm font-medium text-slate-700",
              )}
              title={task.title}
            >
              <AutoTranslatedText text={task.title} />
            </span>
            {hasSubtasks && (
              <span className="shrink-0 rounded bg-slate-200 px-1.5 text-xs font-semibold text-slate-600">
                {task.subtasks!.length}
              </span>
            )}
            <span
              className={cn(
                "shrink-0 font-mono text-xs text-slate-500",
                depth === 0 ? "hidden group-hover:inline" : "inline",
              )}
            >
              {depth === 0 ? task.task_id : task.task_id.replace("RD-2026-", "")}
            </span>
            {task.ai_modified && (
              <span className="inline-flex shrink-0 text-amber-500" title={t("AI 输出已被人工修改")}>
                <Pencil className="h-3 w-3" />
              </span>
            )}
            {task.attachments > 0 && (
              <span className="hidden shrink-0 items-center gap-0.5 text-xs text-slate-500 group-hover:inline-flex">
                <Paperclip className="h-3 w-3" />
                {task.attachments}
              </span>
            )}
          </div>
          {task.latest_progress_summary?.text ? (
            <div className="line-clamp-1 text-[11px] leading-4 text-slate-500">
              {t("最新进度：")}<AutoTranslatedText text={task.latest_progress_summary.text} />
            </div>
          ) : null}
        </div>

        {/* Owners */}
        <div className="hidden shrink-0 items-center -space-x-1.5 xl:flex">
          <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="xs" />
          {task.collaborators.slice(0, 1).map((c) => (
            <OwnerAvatar key={c.id} name={c.name} userId={c.user_id} size="xs" />
          ))}
          {task.collaborators.length > 1 && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 ring-2 ring-white">
              +{task.collaborators.length - 1}
            </span>
          )}
        </div>

        {/* Due date */}
        <div className="w-16 shrink-0 text-right">
          {task.due_date ? (
            isHot || (dleft !== null && dleft < 0) ? (
              <DueDateChip task={task} />
            ) : (
              <span className="text-xs font-medium text-slate-500">{task.due_date.slice(5)}</span>
            )
          ) : null}
        </div>

        {/* Progress */}
        <div className="hidden w-24 shrink-0 items-center gap-2 2xl:flex">
          <ProgressBar value={task.progress} tone={task.archived ? "muted" : "neutral"} />
          <span className="w-7 text-right text-xs font-medium tabular-nums text-slate-600">{task.progress}%</span>
        </div>
      </div>

      {/* Subtasks (recursive) */}
      {hasSubtasks && expanded && (
        <div
          className={cn(
            "relative border-l-2 border-slate-300",
            depth === 0
              ? "mb-2 ml-4 mt-1.5 rounded-[8px] border border-slate-300 bg-slate-100/80 shadow-[inset_3px_0_0_rgba(79,70,229,0.18)]"
              : "ml-4 bg-slate-100/70 py-1.5",
          )}
          style={{ marginLeft: depth === 0 ? 18 : 22 }}
        >
          {depth === 0 && (
            <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", taskAccentClass(task))} />
                <span className="text-sm font-semibold text-slate-800">{t("子任务")}</span>
                <span className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                  {t("{n} 项", { n: task.subtasks!.length })}
                </span>
              </div>
              <span className="hidden text-xs font-medium text-slate-500 sm:inline">
                {t("隶属于 {taskId}", { taskId: task.task_id })}
              </span>
            </div>
          )}
          <div className={cn(depth === 0 ? "py-1.5" : "")}>
            {task.subtasks!.map((sub) => (
              <TaskItem key={sub.task_id} task={sub} onOpen={onOpen} depth={depth + 1} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tree sections ────────────────────────────────────────────────────────────

type TaskDueFilter = "all" | "overdue" | "today" | "3d" | "7d" | "no_due";

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

function taskMatches(
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

// Rollup stats helper — walks recursively through all descendants
function rollupSubtaskStats(tasks: Task[]): { total: number; done: number; blocked: number; avg: number } {
  let total = 0;
  let done = 0;
  let blocked = 0;
  let sum = 0;
  function walk(arr: Task[]) {
    for (const t of arr) {
      total++;
      sum += t.progress;
      if (t.status === "completed") done++;
      if (t.status === "paused_blocked" || t.status === "pending_assign") blocked++;
      if (t.subtasks) walk(t.subtasks);
    }
  }
  walk(tasks);
  return { total, done, blocked, avg: total > 0 ? Math.round(sum / total) : 0 };
}

// Depth-based container background — deeper = darker
function subtaskContainerBg(depth: number): string {
  if (depth === 1) return "bg-slate-50";
  if (depth === 2) return "bg-slate-100";
  if (depth === 3) return "bg-slate-200/70";
  return "bg-slate-300/60";
}

/**
 * 子任务身份徽标：一眼区分「这不是独立任务」，并区分来源。
 * - created：在父任务下直建
 * - attached：由已有独立任务并入
 * - 缺省（存量子任务无 subtask_origin）：只显示中性「子」，不猜来源
 */
export function SubtaskBadge({ task, className }: {
  // 只取子任务身份三字段（结构型），使任务树 Task 与个人工作台 RdWorkspaceTask 都能直接传入
  task: Pick<Task, "subtask_origin" | "subtask_attached_by" | "subtask_attached_at">;
  className?: string;
}) {
  useI18n();
  const origin = task.subtask_origin;
  const cfg =
    origin === "attached"
      ? { label: t("并入"), cls: "bg-amber-50 text-amber-700 ring-amber-200" }
      : origin === "created"
        ? { label: t("子建"), cls: "bg-sky-50 text-sky-700 ring-sky-200" }
        : { label: t("子"), cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  const title =
    origin === "attached"
      ? [
          t("由已有任务并入为子任务"),
          task.subtask_attached_by ? t("操作人：{name}", { name: task.subtask_attached_by }) : "",
          task.subtask_attached_at ? t("时间：{time}", { time: formatTraceDateTime(task.subtask_attached_at) }) : "",
        ].filter(Boolean).join("\n")
      : origin === "created"
        ? t("在父任务下直接创建的子任务")
        : t("子任务");
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-tight ring-1 ring-inset",
        cfg.cls,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}

function SubtaskBlock({
  tasks,
  depth,
  onOpen,
}: {
  tasks: Task[];
  depth: number;
  onOpen: (t: Task) => void;
}) {
  if (tasks.length === 0) return null;
  const stats = rollupSubtaskStats(tasks);

  return (
    <div className="border-l border-slate-200/90 pl-3">
      <div className="mb-1 flex items-center justify-between px-0.5 text-[10px] font-medium text-slate-500">
        <span>
          <span className="font-bold text-slate-600">
            L{depth}
          </span>
          <span className="ml-1.5">{t("{count} 项", { count: stats.total })}</span>
          {stats.done > 0 && <span className="ml-1 text-emerald-600">· {t("{count} 完成", { count: stats.done })}</span>}
          {stats.blocked > 0 && <span className="ml-1 text-orange-600">· {t("{count} 阻塞", { count: stats.blocked })}</span>}
        </span>
        <span className="tabular-nums text-slate-400">avg {stats.avg}%</span>
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <SubtaskRow key={t.task_id} task={t} depth={depth} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function SubtaskRow({
  task,
  depth,
  onOpen,
}: {
  task: Task;
  depth: number;
  onOpen: (t: Task) => void;
}) {
  const hasChildren = Boolean(task.subtasks?.length);
  const [expanded, setExpanded] = useState(hasChildren && taskNeedsAttention(task));
  const dleft = daysUntil(task.due_date);
  const isHot =
    !task.archived &&
    dleft !== null &&
    dleft <= 2 &&
    task.status !== "completed" &&
    task.status !== "paused_leave";

  const offsetClass = depth === 1 ? "" : depth === 2 ? "ml-3" : "ml-5";

  return (
    <div className={offsetClass}>
      <article
        onClick={() => onOpen(task)}
        className={cn(
          "group relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2.5 pr-2 transition-colors hover:bg-white/80",
          task.archived && "opacity-50",
        )}
      >
        <span className={cn("h-5 w-1 shrink-0 rounded-full", getPriorityBarClass(task))} />

        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors duration-150",
            hasChildren && "hover:bg-slate-200/60",
          )}
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              setExpanded((v) => !v);
            }
          }}
        >
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "h-3 w-3 text-slate-500 transition-transform duration-200 ease-out",
                expanded && "rotate-90",
              )}
            />
          ) : null}
        </span>

        <span className="flex w-3 shrink-0 justify-center">
          {task.archived ? <Lock className="h-3 w-3 text-slate-400" /> : <StatusDot status={task.status} />}
        </span>

        <SubtaskBadge task={task} />

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            task.archived ? "text-slate-400 line-through" : "font-medium text-slate-700",
          )}
        >
          <AutoTranslatedText text={task.title} />
        </span>

        {/* Child count badge */}
        {hasChildren && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          {t("{count} 项", { count: task.subtasks!.length })}
          </span>
        )}

        <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="xs" />

        <div className="shrink-0 text-right">
          {task.due_date ? (
            isHot || (dleft !== null && dleft < 0) ? (
              <DueDateChip task={task} />
            ) : (
              <span className="text-[11px] text-slate-500">{task.due_date.slice(5)}</span>
            )
          ) : null}
        </div>

        <div className="hidden w-20 shrink-0 items-center gap-1.5 sm:flex">
          <ProgressBar value={task.progress} tone={task.archived ? "muted" : "neutral"} />
          <span className="w-7 text-right text-[11px] tabular-nums font-medium text-slate-600">
            {task.progress}%
          </span>
        </div>
      </article>

      {/* Recursive nested children with grid-rows animation */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          hasChildren && expanded ? "mt-1 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "ml-5 transition-all duration-300 ease-out",
              hasChildren && expanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-0.5",
            )}
          >
            {hasChildren && <SubtaskBlock tasks={task.subtasks!} depth={depth + 1} onOpen={onOpen} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 备注回执 map：驾驶舱深层卡片经 context 读取（管理视角：他人给任务留的备注是否被目标人查看/跟进）。 */
const NoteReceiptContext = React.createContext<Record<string, RdTaskNoteReceipt>>({});

function TaskCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  useI18n();
  const receiptMap = React.useContext(NoteReceiptContext);
  const receipt = task.source_workspace === "us-collab" ? undefined : receiptMap[task.task_id];
  const hasSubtasks = Boolean(task.subtasks?.length);
  const attention = taskNeedsAttention(task);
  const [expanded, setExpanded] = useState(attention && hasSubtasks);
  const statusCfg = STATUS_CONFIG[task.status];
  const ownRisk = getTaskRiskReason(task);

  return (
    <article
      className={cn(
        "rd-board-task-row group relative rounded-md px-3 py-2.5 transition-colors hover:bg-white/85",
        attention ? "bg-white/70" : "bg-white/45",
        task.archived && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={cn("rd-board-task-priority-rail mt-1 h-9 w-1 shrink-0 rounded-full", getPriorityBarClass(task))} />

        <button type="button" onClick={() => onOpen(task)} className="rd-board-task-open min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-semibold text-slate-500">{task.task_id}</span>
            <h4
              className={cn(
                "min-w-[180px] flex-1 truncate text-[15px] font-semibold leading-5",
                task.archived ? "text-slate-500 line-through" : "text-slate-950",
              )}
            >
              <AutoTranslatedText text={task.title} />
            </h4>
            <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold", statusCfg.bg, statusCfg.text)}>
              <StatusDot status={task.status} />
              {t(statusCfg.label)}
            </span>
            {task.source_workspace === "us-collab" && (
              <span className="inline-flex shrink-0 rounded-md bg-cyan-50 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700 ring-1 ring-cyan-100">
                {t("协同")}
              </span>
            )}
            <PriorityPill priority={task.final_priority} aiPriority={task.ai_priority} />
          </div>

          {/* 备注回执状态条（与瀑布流卡片同款配色：待查看浅红 / 已查看浅琥珀） */}
          {receipt && (
            <div
              className={cn(
                "rd-board-task-note mt-1 flex items-center gap-1.5 rounded-md border-l-[3px] px-2 py-1 text-[11px] font-medium",
                receipt.state === "unread" ? "border-red-400 bg-red-50 text-red-700" : "border-amber-400 bg-amber-50 text-amber-700",
              )}
              title={`${receipt.author_name}${t("的备注")}：${receipt.excerpt}`}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", receipt.state === "unread" ? "bg-red-500" : "bg-amber-500")} />
              <span className="truncate">
                {receipt.author_name}{t("的备注")} · {receipt.state === "unread" ? t("待查看") : t("已查看")} · {t("给")}{receipt.target_name}
              </span>
            </div>
          )}

          {task.description && (
            <AutoTranslatedText as="p" className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500" text={task.description} />
          )}

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="xs" />
              <span className="truncate font-medium text-slate-600">{task.primary_owner}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TimerReset className="h-3.5 w-3.5 text-slate-400" />
              {task.due_date ? <DueDateChip task={task} /> : <span className="font-medium text-slate-500">{t("未设截止")}</span>}
            </span>
            {task.attachments > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-slate-500">
                <Paperclip className="h-3.5 w-3.5" />
                {task.attachments}
              </span>
            )}
            {attention && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "inline-flex cursor-help items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold",
                      ownRisk?.type === "overdue" || ownRisk?.type === "blocked" || task.status === "paused_blocked"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700",
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t(ownRisk?.reason ?? "子任务风险")}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  <div className="max-w-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                      {t("需要立刻关注")}
                    </div>
                    {ownRisk ? (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT_COLOR[ownRisk.type])} />
                        <span className="font-medium">{t(RISK_LABEL[ownRisk.type])}</span>
                        <span className="opacity-70">· {t(ownRisk.reason)}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] opacity-70">{t("下级任务存在逾期、阻塞或待指派问题。")}</div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </button>

        <div className="hidden w-28 shrink-0 items-center gap-2 pt-1.5 xl:flex">
          <ProgressBar value={task.progress} tone={task.archived ? "muted" : "neutral"} />
          <span className="w-8 text-right text-xs font-semibold tabular-nums text-slate-600">{task.progress}%</span>
        </div>

        {hasSubtasks && (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-all duration-200 hover:bg-white hover:text-slate-800 active:scale-90"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? t("收起子任务") : t("展开子任务")}
            aria-expanded={expanded}
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200 ease-out",
                expanded && "rotate-90",
              )}
            />
          </button>
        )}
      </div>

      {hasSubtasks && !expanded && (() => {
        const stats = rollupSubtaskStats(task.subtasks!);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            className="rd-board-subtask-summary ml-3 mt-1.5 flex w-[calc(100%-0.75rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1 text-xs text-slate-500 transition-colors hover:bg-white/75"
          >
            <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
            <span className="font-semibold text-slate-700">{t("{n} 个子任务", { n: task.subtasks!.length })}</span>
            <span className="text-slate-400">·</span>
            <span>{t("共")} <span className="font-semibold tabular-nums text-slate-700">{stats.total}</span> {t("项")}</span>
            {stats.done > 0 && (
              <span className="text-emerald-600">
                · <span className="tabular-nums">{stats.done}</span> {t("完成")}
              </span>
            )}
            {stats.blocked > 0 && (
              <span className="text-orange-600">
                · <span className="tabular-nums">{stats.blocked}</span> {t("阻塞")}
              </span>
            )}
            <span className="ml-auto tabular-nums text-slate-500">avg {stats.avg}%</span>
          </button>
        );
      })()}

      {/* Expanded: nested subtask block with smooth grid-rows animation */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          hasSubtasks && expanded ? "mt-2 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "ml-5 transition-all duration-300 ease-out",
              hasSubtasks && expanded ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1",
            )}
          >
            {hasSubtasks && <SubtaskBlock tasks={task.subtasks!} depth={1} onOpen={onOpen} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function SubProjectSection({
  sub,
  categoryLabel,
  keyword,
  statusFilter,
  priorityFilter,
  dueFilter,
  onOpen,
}: {
  sub: SubProject;
  /** 父分类名：sub 是自动补出的默认子项时用它作标题，避免界面上出现一层「默认」 */
  categoryLabel?: string;
  keyword: string;
  statusFilter: TaskStatus | "all";
  priorityFilter: Priority | "all";
  dueFilter: TaskDueFilter;
  onOpen: (t: Task) => void;
}) {
  useI18n();
  const [open, setOpen] = useState(true);
  const filteredTasks = useMemo(
    () => sub.tasks.filter((t) => taskMatches(t, keyword, statusFilter, priorityFilter, dueFilter)),
    [sub.tasks, keyword, statusFilter, priorityFilter, dueFilter],
  );

  if (filteredTasks.length === 0 && (keyword || statusFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all")) return null;
  const progress = calcSubProgress(sub);
  // 纯一级分类的任务落在自动补出的默认子项里；标题显示分类名，不显示「默认」
  const displayLabel = isDefaultSubProject(sub) ? (categoryLabel || sub.label) : sub.label;
  const subRiskCategory: Category = {
    id: "",
    label: displayLabel,
    children: [{ ...sub, tasks: filteredTasks }],
  };
  const subRisks = computeRisks([subRiskCategory]);
  const riskCount = subRisks.length;
  const activeCount = filteredTasks.filter((task) => !task.archived).length;

  return (
    <section className="rd-board-subproject rounded-[8px] bg-slate-100/55 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-slate-800 active:scale-90"
                  aria-label={open ? t("收起 {name}", { name: displayLabel }) : t("展开 {name}", { name: displayLabel })}
          aria-expanded={open}
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform duration-200 ease-out",
              open && "rotate-90",
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{displayLabel}</h3>
            <span className="text-xs font-semibold text-slate-500">
              {t("{count} 个活跃任务", { count: activeCount })}
            </span>
            {riskCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t("{n} 个风险", { n: riskCount })}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start">
                  <RiskListTooltip title={t("{name} · {count} 个风险任务", { name: displayLabel, count: riskCount })} risks={subRisks} />
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-1.5 flex max-w-sm items-center gap-2">
            <ProgressBar value={progress} />
            <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-700">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Animated content area using grid-rows trick */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "mt-2 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "rd-board-subproject-body overflow-hidden rounded-[8px] bg-white/35 transition-all duration-300 ease-out",
              open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1",
            )}
          >
            {filteredTasks.length > 0 ? (
              <div className="divide-y divide-slate-200/65">
                {filteredTasks.map((task) => (
                  <TaskCard key={task.task_id} task={task} onOpen={onOpen} />
                ))}
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-slate-300 bg-white/45 px-4 py-8 text-center text-sm font-medium text-slate-500">
                {t("当前部件暂无任务")}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Category Sidebar ─────────────────────────────────────────────────────────

function getSystemHealth(stat: CatStat): SystemHealth {
  if (stat.total === 0) return "idle";
  if (stat.progress < 40 || stat.risks >= 3 || stat.blocked >= 3) return "alert";
  if (stat.progress >= 70 && stat.risks === 0) return "healthy";
  return "watch";
}

/**
 * Aggregate active load for tasks scoped to a single category (or sub-project).
 * Used in the detail view to show "who's working on this system".
 */
function computeScopedPersonLoads(
  scope: Category | SubProject | null,
  maxPerPerson = 8,
): PersonLoad[] {
  if (!scope) return [];
  // 同上，按身份主键聚合，同名同事不再合成一条。
  const rows = new Map<string, { name: string; userId: string | null; count: number; onLeave: boolean }>();
  const bump = (name: string, userId: string | null | undefined, weight: number, onLeave: boolean) => {
    const key = memberIdentityKey(name, userId);
    const row = rows.get(key);
    if (row) {
      row.count += weight;
      if (onLeave) row.onLeave = true;
      if (!row.userId && userId) row.userId = userId;
    } else {
      rows.set(key, { name, userId: userId ?? null, count: weight, onLeave });
    }
  };
  for (const task of collectRootActiveTasks(scope)) {
    if (task.status === "completed") continue;
    // 与驾驶舱共用同一份占位值黑名单。历史实现是子串正则，漏掉了
    // 未分配/未指派/暂无/外部机构/采购/研发团队/系统，这些会被当成真人显示在成员列表里。
    if (!isNonPersonTaskOwner(task.primary_owner)) {
      bump(task.primary_owner, task.primary_owner_user_id, 1, task.status === "paused_leave");
    }
    for (const collaborator of task.collaborators) {
      if (isNonPersonTaskOwner(collaborator.name)) continue;
      bump(collaborator.name, collaborator.user_id, 0.5, false);
    }
  }
  return Array.from(rows.entries())
    .map(([key, row]) => ({
      key,
      name: row.name,
      count: Math.ceil(row.count),
      max: maxPerPerson,
      onLeave: row.onLeave,
      user_id: row.userId,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate active load per person across all categories.
 */
function buildAiPeopleProfiles(
  people: PersonProfile[],
  loads: PersonLoad[],
  categories: Category[],
): RdAiPersonContext[] {
  const loadByName = new Map(loads.map((load) => [load.name, load]));
  const tasksByOwner = new Map<string, string[]>();
  const blockedByOwner = new Map<string, number>();
  const completedThisMonthByOwner = new Map<string, number>();

  const collect = (tasks: Task[]) => {
    for (const task of tasks) {
      if (task.archived) continue;
      const owner = task.primary_owner?.trim();
      // 同上，共用占位值黑名单：否则「采购/研发团队/系统」会被当成真人喂给 AI 生成人员建议。
      if (owner && !isNonPersonTaskOwner(owner)) {
        if (task.status !== "completed") {
          const titles = tasksByOwner.get(owner) ?? [];
          if (titles.length < 6) titles.push(task.title);
          tasksByOwner.set(owner, titles);
        }
        if (task.status === "paused_blocked" || task.risk_flag) {
          blockedByOwner.set(owner, (blockedByOwner.get(owner) ?? 0) + 1);
        }
        if (task.status === "completed" && task.updated_at?.startsWith(todayStr().slice(0, 7))) {
          completedThisMonthByOwner.set(owner, (completedThisMonthByOwner.get(owner) ?? 0) + 1);
        }
      }
      if (task.subtasks) collect(task.subtasks);
    }
  };

  for (const category of categories) {
    for (const child of category.children) collect(child.tasks);
  }

  return people
    .filter((person) => person.name.trim())
    .map((person) => {
      const load = loadByName.get(person.name);
      return {
        id: person.id,
        user_id: person.user_id ?? undefined,
        name: person.name,
        position: person.position,
        department: person.department,
        task_count: load?.count ?? 0,
        max_tasks: person.max_tasks ?? load?.max,
        on_leave: person.on_leave === true || person.status === "on_leave" || load?.onLeave === true,
        blocked_count: blockedByOwner.get(person.name) ?? 0,
        completed_this_month: completedThisMonthByOwner.get(person.name) ?? 0,
        tasks: tasksByOwner.get(person.name) ?? [],
      };
    });
}

type SystemTreeEditorRequest =
  | { mode: "add-system" }
  | { mode: "edit-system"; category: Category }
  | { mode: "delete-system"; category: Category }
  | { mode: "add-sub"; category: Category }
  | { mode: "edit-sub"; category: Category; sub: SubProject }
  | { mode: "delete-sub"; category: Category; sub: SubProject }
  | { mode: "move-tasks"; fromCategory: Category; fromSub: SubProject };

function CategorySidebar({
  catStats,
  selectedId,
  onSelect,
  totalRisks,
  allRisks,
  canManageTree = false,
  onRequestEditor,
}: {
  catStats: CatStat[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalActive: number;
  totalRisks: number;
  allRisks: Risk[];
  canManageTree?: boolean;
  onRequestEditor?: (req: SystemTreeEditorRequest) => void;
}) {
  const productionWorkspace = isProductionWorkspace();
  const { user } = useAuth();
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canReassignTasks = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  // 全局移动会影响任意任务结构，只对专职移动/转派角色开放；普通编辑权限仍由工作台按本人任务处理。
  const canMoveTasks = useAnyPermission(PERMISSIONS.RD_TASK_MOVE, PERMISSIONS.RD_TASK_REASSIGN);
  const shouldReduceMotion = useReducedMotion();
  const selectedParentCatId = useMemo(() => {
    const id = selectedId;
    if (!id) return null;
    return catStats.find(({ cat }) => cat.id === id || cat.children.some((sub) => sub.id === id))?.cat.id ?? null;
  }, [catStats, selectedId]);
  const [expandedId, setExpandedId] = useState<string | null>(() => selectedParentCatId);

  useEffect(() => {
    setExpandedId(selectedParentCatId);
  }, [selectedParentCatId]);

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <motion.aside
      initial={shouldReduceMotion ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rd-board-sidebar flex w-[292px] shrink-0 flex-col border-r border-slate-200/70 bg-[#edf3f8] shadow-[8px_0_24px_rgba(15,23,42,0.025)]"
    >
      <div className="rd-board-sidebar-head border-b border-slate-200/70 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Navigation</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-balance text-sm font-semibold text-slate-950">
            {productionWorkspace ? t("生产系统树") : t("研发系统树")}
          </h2>
          <div className="flex items-center gap-2">
            {totalRisks > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{t("{count} 个风险", { count: totalRisks })}</span>
            )}
            {canManageTree && onRequestEditor && (
              <button
                type="button"
                onClick={() => onRequestEditor({ mode: "add-system" })}
                className="rd-board-brand-control inline-flex h-7 items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                title={t("新增一级系统")}
              >
                <Plus className="h-3 w-3" />
                {t("新增")}
              </button>
            )}
          </div>
        </div>
      </div>

      <nav className="rd-board-tree flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                setExpandedId(null);
                onSelect(null);
              }}
              data-active={selectedId === null}
              className={cn(
                "rd-board-tree-root",
                "flex h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 active:scale-[0.99]",
                selectedId === null ? "bg-white text-indigo-700 shadow-[0_8px_20px_rgba(79,70,229,0.08)] ring-1 ring-indigo-100" : "text-slate-600 hover:bg-white/80 hover:text-slate-900 hover:shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
              )}
              aria-label={t("全部系统")}
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t("全部系统")}</span>
              {totalRisks > 0 && (
                <span className="flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white">
                  {totalRisks}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="start">
            <RiskListTooltip title={t("全部系统 · {count} 个风险任务", { count: totalRisks })} risks={allRisks} />
          </TooltipContent>
        </Tooltip>

        {catStats.map(({ cat, risks, riskItems }) => {
          const theme = getTheme(cat.id);
          const active = selectedId === cat.id;
          const activeWithin = active || cat.children.some((sub) => sub.id === selectedId);
          const expanded = expandedId === cat.id;

          const isReserved = isReservedBomSystem(cat.id);
          const subTaskCount = cat.children.reduce((sum, sub) => sum + collectTaskIds(sub.tasks).size, 0);
          return (
            <motion.div
              key={cat.id}
              layout
              transition={RD_LIST_TRANSITION}
              data-active={activeWithin}
              className={cn(
                "rd-board-tree-group",
                "group/cat rounded-[8px] transition-all",
                activeWithin ? "bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80" : "hover:bg-white/65 hover:shadow-[0_8px_18px_rgba(15,23,42,0.035)]",
              )}
            >
              <div className="flex items-center gap-1 px-1 py-1">
                <button
                  type="button"
                  onClick={() => toggleExpanded(cat.id)}
                  className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-95"
                  aria-label={expanded ? t("收起 {name}", { name: cat.label }) : t("展开 {name}", { name: cat.label })}
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200 ease-out",
                      expanded && "rotate-90",
                    )}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(cat.id);
                    onSelect(cat.id);
                  }}
                  className="rd-board-tree-node flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]"
                >
                  <span
                    className={cn(
                      "rd-board-tree-indicator h-5 w-1 shrink-0 rounded-full bg-indigo-600 transition-all duration-300 ease-out",
                      activeWithin ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                    )}
                  />
                  <theme.Icon className={cn("h-4 w-4 shrink-0 transition-colors", theme.iconColor)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{cat.label}</span>
                </button>

                {canManageTree && onRequestEditor && (
                  <div className="mr-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/cat:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "add-sub", category: cat }); }}
                      className="rounded p-1 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                      title={t("新增子项")}
                      aria-label={t("为 {name} 新增子项", { name: cat.label })}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-system", category: cat }); }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title={t("重命名")}
                      aria-label={t("重命名 {name}", { name: cat.label })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {!isReserved && (
                      <button
                        type="button"
                        aria-disabled={subTaskCount > 0}
                        aria-label={subTaskCount > 0 ? t("不能删除：含 {count} 个任务，请先移空", { count: subTaskCount }) : t("删除 {name}", { name: cat.label })}
                        onClick={(e) => { e.stopPropagation(); if (subTaskCount === 0) onRequestEditor({ mode: "delete-system", category: cat }); }}
                        className={cn(
                          "rounded p-1 transition-colors",
                          subTaskCount > 0
                            ? "cursor-not-allowed text-slate-300"
                            : "text-slate-400 hover:bg-red-50 hover:text-red-600",
                        )}
                        title={subTaskCount > 0 ? t("含 {count} 个任务，请先移空后再删除", { count: subTaskCount }) : t("删除")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {risks > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mr-1 flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white transition-transform duration-150 hover:scale-110">
                        {risks}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start">
                      <RiskListTooltip title={t("{name} · {count} 个风险任务", { name: cat.label, count: risks })} risks={riskItems} />
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              {/* Animated expand using CSS grid-rows trick */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out",
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <div
                    className={cn(
                      "ml-[34px] mr-2 space-y-1 border-l border-slate-300/70 pl-3 transition-all duration-300 ease-out",
                      expanded ? "translate-y-0 pb-2 pt-1 opacity-100" : "-translate-y-1 py-0 opacity-0",
                    )}
                  >
                    {cat.children.filter((sub) => !isDefaultSubProject(sub)).map((sub) => {
                      // 自动补出的默认子项不进导航树：它不是用户建的层级，
                      // 露出来会让人以为自己多建了一层，而且删掉下次读取还会补回来。
                      const subIds = collectTaskIds(sub.tasks);
                      const subRisks = riskItems.filter((risk) => subIds.has(risk.task.task_id));
                      const selected = selectedId === sub.id;
                      const subTaskTotal = collectTaskIds(sub.tasks).size;

                      return (
                        <div
                          key={sub.id}
                          data-active={selected}
                          className={cn(
                            "rd-board-tree-sub",
                            "group/sub flex h-8 w-full items-center gap-1 rounded-md pr-1 transition-all duration-200",
                            selected
                              ? "bg-indigo-50 shadow-[0_6px_14px_rgba(79,70,229,0.08)]"
                              : "hover:bg-slate-50",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedId(cat.id);
                              onSelect(sub.id);
                            }}
                            className={cn(
                              "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]",
                              selected ? "text-indigo-800" : "text-slate-600 hover:translate-x-0.5 hover:text-slate-900",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200",
                                subRisks.length > 0 ? "bg-red-500" : "bg-slate-300",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{sub.label}</span>
                          </button>
                          {(canManageTree || (canMoveTasks && subTaskTotal > 0)) && onRequestEditor && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/sub:opacity-100 focus-within:opacity-100">
                              {canManageTree && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-sub", category: cat, sub }); }}
                                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  title={t("重命名")}
                                  aria-label={t("重命名 {name}", { name: sub.label })}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                              {canMoveTasks && subTaskTotal > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "move-tasks", fromCategory: cat, fromSub: sub }); }}
                                  className="rounded p-1 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                                  title={t("移动任务")}
                                  aria-label={t("移动 {name} 中的任务", { name: sub.label })}
                                >
                                  <ArrowRight className="h-3 w-3" />
                                </button>
                              )}
                              {canManageTree && (
                                <button
                                  type="button"
                                  aria-disabled={subTaskTotal > 0}
                                  aria-label={subTaskTotal > 0 ? t("不能删除：含 {count} 个任务，请先移空", { count: subTaskTotal }) : t("删除 {name}", { name: sub.label })}
                                  onClick={(e) => { e.stopPropagation(); if (subTaskTotal === 0) onRequestEditor({ mode: "delete-sub", category: cat, sub }); }}
                                  className={cn(
                                    "rounded p-1 transition-colors",
                                    subTaskTotal > 0
                                      ? "cursor-not-allowed text-slate-300"
                                      : "text-slate-400 hover:bg-red-50 hover:text-red-600",
                                  )}
                                  title={subTaskTotal > 0 ? t("含 {count} 个任务，请先移空后再删除", { count: subTaskTotal }) : t("删除")}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </nav>
    </motion.aside>
  );
}

function SystemTreeEditorDialog({
  request,
  onClose,
  onSubmit,
}: {
  request: SystemTreeEditorRequest;
  onClose: () => void;
  onSubmit: (label: string) => Promise<void> | void;
}) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const initialLabel =
    request.mode === "edit-system" ? request.category.label
    : request.mode === "edit-sub" ? request.sub.label
    : "";
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);

  const isDelete = request.mode === "delete-system" || request.mode === "delete-sub";
  const isEdit = request.mode === "edit-system" || request.mode === "edit-sub";
  const isAdd = request.mode === "add-system" || request.mode === "add-sub";

  const title =
    request.mode === "add-system" ? t("新增一级系统")
    : request.mode === "edit-system" ? t("重命名一级系统")
    : request.mode === "delete-system" ? t("删除一级系统")
    : request.mode === "add-sub" ? t("在「{name}」下新增子项", { name: request.category.label })
    : request.mode === "edit-sub" ? t("重命名子项")
    : t("删除子项");

  const taskCount =
    request.mode === "delete-system"
      ? request.category.children.reduce((s, ch) => s + ch.tasks.length, 0)
      : request.mode === "delete-sub"
      ? request.sub.tasks.length
      : 0;

  const handleConfirm = async () => {
    if (isDelete) {
      setSaving(true);
      try {
        await onSubmit("");
      } finally {
        setSaving(false);
      }
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error(t("名称不能为空"));
      return;
    }
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={RD_FAST_TRANSITION}
      className="rd-task-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={RD_PANEL_TRANSITION}
        className="rd-task-overlay-surface w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          "flex items-center justify-between gap-3 border-b px-6 py-4",
          isDelete ? "border-red-100 bg-red-50/60" : "border-slate-100",
        )}>
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              isDelete ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-600",
            )}>
              {isDelete ? <Trash2 className="h-4 w-4" /> : isEdit ? <Pencil className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
            </div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {isDelete ? (
            <>
              <p className="text-sm text-slate-700">
                {t("确认删除「{name}」？", { name: request.mode === "delete-system" ? request.category.label : (request as { sub: SubProject }).sub.label })}
              </p>
              {taskCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("该节点下还有 {count} 个任务，删除后会一并清除，操作不可恢复。", { count: taskCount })}</span>
                </div>
              )}
              {taskCount === 0 && (
                <p className="text-xs text-slate-500">{t("该节点下没有任务，删除安全。")}</p>
              )}
            </>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("名称")}</label>
              <Input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                placeholder={isAdd ? (request.mode === "add-system" ? t("例：新型动力系统") : t("例：主控板")) : t("新名称")}
                disabled={saving}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
              />
              {request.mode === "add-system" && (
                <p className="mt-1.5 text-pretty text-[11px] text-slate-400">
                  {productionWorkspace
                    ? t("将作为生产系统树的一级节点；可在保存后添加子项。")
                    : t("将作为研发系统树的一级节点；可在保存后添加子项。")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60",
              isDelete ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700",
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isDelete ? t("确认删除") : isEdit ? t("保存") : t("新增")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ExecutiveSignal({
  label,
  value,
  helper,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  helper: string;
  tone: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 rounded-[8px] bg-slate-50 px-3 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.035)] ring-1 ring-slate-200/75 transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_14px_28px_rgba(15,23,42,0.07)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <Icon className={cn("h-4 w-4 shrink-0", tone)} />
      </div>
      <div className="text-2xl font-semibold leading-none tabular-nums text-slate-950">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function ExecutiveRiskList({ risks, onOpen }: { risks: Risk[]; onOpen: (task: Task) => void }) {
  const shown = risks.slice(0, 4);
  return (
    <section className="rounded-[8px] bg-white px-4 py-4 shadow-[0_14px_35px_rgba(15,23,42,0.045)] ring-1 ring-slate-200/75">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{t("需要决策")}</h2>
          <p className="sr-only">{t("只列最需要领导关注的事项")}</p>
        </div>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{t("{count} 项", { count: risks.length })}</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[8px] bg-emerald-50 px-3 py-4 text-sm font-medium text-emerald-700">
          {t("当前没有需要升级处理的风险。")}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {shown.map((risk, index) => {
            const isCritical = risk.severity === "critical";
            return (
              <button
                key={risk.task.task_id + risk.type}
                type="button"
                onClick={() => onOpen(risk.task)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md py-3 pl-2 pr-1 text-left transition-all hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.995]"
              >
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", isCritical ? "bg-red-600 text-white" : "bg-amber-100 text-amber-700")}>
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-950">{risk.task.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn("font-semibold", isCritical ? "text-red-600" : "text-amber-600")}>{risk.reason}</span>
                    <span>·</span>
                    <span>{risk.task.primary_owner}</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SystemHealthGrid({
  catStats,
  selectedId,
  onSelect,
}: {
  catStats: CatStat[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ranked = [...catStats]
    .sort((a, b) => b.risks - a.risks || a.progress - b.progress || b.blocked - a.blocked)
    .slice(0, 4);
  const stableCount = Math.max(0, catStats.length - ranked.length);

  return (
    <section className="rounded-[8px] bg-white px-4 py-4 shadow-[0_14px_35px_rgba(15,23,42,0.045)] ring-1 ring-slate-200/75">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{t("系统健康")}</h2>
          <p className="sr-only">{t("按风险和进度自动排序")}</p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        >
          {t("全局")}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ranked.map(({ cat, progress, risks }) => {
          const theme = getTheme(cat.id);
          const selected = selectedId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.id)}
              className={cn(
                "cursor-pointer rounded-[8px] px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]",
                selected ? "bg-indigo-50 shadow-[0_8px_18px_rgba(79,70,229,0.08)] ring-1 ring-indigo-200" : "bg-slate-50 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_24px_rgba(15,23,42,0.06)]",
              )}
            >
              <div className="flex items-center gap-2">
                <theme.Icon className={cn("h-4 w-4 shrink-0", theme.iconColor)} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{cat.label}</span>
                {risks > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white">{risks}</span>}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full", risks > 0 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${progress}%` }} />
                </div>
                <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-600">{progress}%</span>
              </div>
            </button>
          );
        })}
      </div>

      {stableCount > 0 && (
        <div className="mt-3 rounded-[8px] bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          {t("其余 {count} 个系统暂未进入领导关注列表。", { count: stableCount })}
        </div>
      )}
    </section>
  );
}

function SelectedScopePanel({
  selectedLabel,
  selectedStat,
  visibleRisks,
  onOpen,
}: {
  selectedLabel?: string;
  selectedStat: { total: number; progress: number } | CatStat | null | undefined;
  visibleRisks: Risk[];
  onOpen: (task: Task) => void;
}) {
  if (!selectedLabel || !selectedStat) return null;
  const highlighted = visibleRisks.slice(0, 4);

  return (
    <section className="rounded-[8px] bg-white px-4 py-4 shadow-[0_14px_35px_rgba(15,23,42,0.045)] ring-1 ring-slate-200/75">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-slate-950">{selectedLabel}</h2>
          <p className="sr-only">{t("点击左侧图标切换系统，点击事项查看详情")}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-slate-700">{t("{count} 项", { count: selectedStat.total })}</span>
          <span className="font-semibold text-indigo-700">{selectedStat.progress}%</span>
        </div>
      </div>

      {highlighted.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {highlighted.map((risk) => (
            <button
              key={risk.task.task_id + risk.type}
              type="button"
              onClick={() => onOpen(risk.task)}
              className="cursor-pointer rounded-[8px] bg-slate-50 px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_22px_rgba(15,23,42,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]"
            >
              <div className="truncate text-sm font-semibold text-slate-950">{risk.task.title}</div>
              <div className="mt-1 text-xs font-semibold text-red-600">{risk.reason}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-[8px] bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-700">
          {t("当前系统暂无升级风险。")}
        </div>
      )}
    </section>
  );
}

// ─── AI Create Panel (unchanged from previous) ────────────────────────────────

type AiInputState = "idle" | "processing" | "review";

const AI_SAMPLE_RESULT: Omit<Task, "task_id"> = {
  title: "电磁阀耐压测试方案制定",
  description: "依据 IEC 60601 标准，制定电磁阀 100kPa 耐压测试规程，记录测试数据并出具报告。",
  primary_owner: "王磊",
  collaborators: [{ id: "cx1", name: "陈静", role: "质检员" }],
  status: "draft",
  progress: 0,
  ai_priority: "high",
  final_priority: "high",
  final_duration: 4,
  category_path: "硬件/电磁阀/测试类",
  archived: false,
  attachments: 0,
  due_date: "2026-05-28",
};

function findRdAiScene(settings: RdAiSettingsPayload | null, sceneId: string) {
  return settings?.scenes.find((scene) => scene.id === sceneId) ?? null;
}

function describeRdAiModel(settings: RdAiSettingsPayload | null, modelId?: string) {
  if (!modelId) return t("跟随默认模型");
  const model = settings?.runtime?.models?.find((item) => item.id === modelId);
  if (!model) return modelId;
  return `${model.name || model.model} / ${model.model}`;
}

function fileExtension(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}

const RD_ATTACHMENT_ACCEPT = [
  "csv",
  "xlsx",
  "xls",
  "tsv",
  "doc",
  "docx",
  "txt",
  "md",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
].map((item) => `.${item}`).join(",");

function rdFileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeRdFiles(current: File[], incoming: File[]) {
  const byKey = new Map(current.map((file) => [rdFileKey(file), file]));
  for (const file of incoming) {
    if (file.size > 0) byKey.set(rdFileKey(file), file);
  }
  return Array.from(byKey.values());
}

function describeFileRule(settings: RdAiSettingsPayload | null, filename: string) {
  const extension = fileExtension(filename);
  const rule = settings?.file_policy.rules.find((item) => item.extensions.includes(extension));
  if (!rule) return t("未知文件 / 文本抽取 / OCR 兜底");
  const parts = [rule.label, rule.strategy];
  if (rule.ocr_fallback) parts.push("OCR 兜底");
  if (rule.ai_after_parse) parts.push("AI 结构化");
  return parts.join(" / ");
}

function normalizeRdPathSegment(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function aiDraftToTask(draft: RdAiTaskDraft): Omit<Task, "task_id"> {
  return {
    title: draft.title,
    description: draft.description,
    primary_owner: draft.owner || "待指派",
    collaborators: [],
    status: "draft",
    progress: 0,
    ai_priority: draft.priority,
    final_priority: draft.priority,
    final_duration: draft.estimated_days,
    category_path: draft.category_path,
    archived: false,
    attachments: 0,
    start_date: draft.start_date,
    due_date: draft.due_date,
  };
}

function resolveAiCreateTarget(categories: Category[], categoryPath: string) {
  const segments = categoryPath.split(/[\/／>＞|]/).map((item) => item.trim()).filter(Boolean);
  const systemKey = normalizeRdPathSegment(segments[0] ?? "");
  const partKey = normalizeRdPathSegment(segments[1] ?? "");
  const category =
    categories.find((item) => normalizeRdPathSegment(item.label) === systemKey) ??
    categories.find((item) => systemKey && normalizeRdPathSegment(item.label).includes(systemKey)) ??
    categories[0];
  if (!category) return null;
  const child =
    category.children.find((item) => normalizeRdPathSegment(item.label) === partKey) ??
    category.children.find((item) => partKey && normalizeRdPathSegment(item.label).includes(partKey)) ??
    category.children[0];
  return { category, child };
}

function AiCreatePanel({
  onClose,
  categories,
  peopleProfiles,
  personLoads,
  onCreated,
  productId = MAIN_PRODUCT_ID,
}: {
  onClose: () => void;
  categories: Category[];
  peopleProfiles: PersonProfile[];
  personLoads: PersonLoad[];
  onCreated: () => void;
  productId?: string; // 立项目标产品（board 中为当前产品，overview 为主产品）
}) {
  const productionWorkspace = isProductionWorkspace();
  const [text, setText] = useState("");
  const [aiState, setAiState] = useState<AiInputState>("idle");
  const [draft, setDraft] = useState<Omit<Task, "task_id"> | null>(null);
  const [originalDraft, setOriginalDraft] = useState<Omit<Task, "task_id"> | null>(null);
  const [aiSummary, setAiSummary] = useState("");
  const [modifiedFields, setModifiedFields] = useState<Set<string>>(new Set());
  const [aiSettings, setAiSettings] = useState<RdAiSettingsPayload | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileDropActive, setFileDropActive] = useState(false);
  const textScene = useMemo(() => findRdAiScene(aiSettings, "text_task_extract"), [aiSettings]);
  const fileScene = useMemo(() => findRdAiScene(aiSettings, "file_task_extract"), [aiSettings]);
  const activeScene = selectedFiles.length > 0 ? fileScene : textScene;

  useEffect(() => {
    let cancelled = false;
    fetchRdAiSettings()
      .then((payload) => {
        if (!cancelled) setAiSettings(payload);
      })
      .catch(() => {
        if (!cancelled) setAiSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleProcess() {
    if (!text.trim() && selectedFiles.length === 0) return;
    setAiState("processing");
    try {
      // 给 AI 的可选分类路径。自动补出的默认子项不作为一段暴露——只给分类名即可，
      // 服务端解析时会自己落到该分类的默认子项。
      const categoryLabels = categories.flatMap((category) => [
        category.label,
        ...category.children
          .filter((child) => !isDefaultSubProject(child))
          .map((child) => `${category.label} / ${child.label}`),
      ]);
      const aiPeopleProfiles = buildAiPeopleProfiles(peopleProfiles, personLoads, categories);
      const result = selectedFiles.length > 0
        ? await extractRdTasksFromFile({
            file: selectedFiles[0]!,
            peopleNames: aiPeopleProfiles.map((person) => person.name),
            peopleProfiles: aiPeopleProfiles,
            categoryLabels,
            proposalTitle: text.trim().slice(0, 80) || selectedFiles[0]!.name,
          })
        : await extractRdTasksFromText({
            text: text.trim(),
            peopleNames: aiPeopleProfiles.map((person) => person.name),
            peopleProfiles: aiPeopleProfiles,
            categoryLabels,
            proposalTitle: text.trim().slice(0, 80) || undefined,
          });
      const firstTask = result.tasks[0];
      if (!firstTask) {
        throw new Error(productionWorkspace ? "AI 未解析出可创建的生产任务" : "AI 未解析出可创建的研发任务");
      }
      const nextDraft = aiDraftToTask(firstTask);
      setDraft(nextDraft);
      setOriginalDraft(nextDraft);
      setAiSummary(result.summary ?? `已解析 ${result.tasks.length} 个任务，当前展示第 1 个`);
      setModifiedFields(new Set());
      setAiState("review");
      toast.success(t("AI 已解析 {count} 个任务", { count: result.tasks.length }));
    } catch (error) {
      setAiState("idle");
      toast.error(error instanceof Error ? error.message : t("AI 解析失败"));
    }
  }

  function addSelectedFiles(incoming: FileList | File[]) {
    const incomingFiles = Array.from(incoming).filter((file) => file.size > 0);
    if (!incomingFiles.length) return;
    setSelectedFiles((current) => mergeRdFiles(current, incomingFiles));
    setFileDropActive(false);
  }

  function handleFileDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    addSelectedFiles(event.dataTransfer.files);
  }

  function handleFileDrag(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setFileDropActive(true);
  }

  function patchDraft<K extends keyof Omit<Task, "task_id">>(key: K, value: Omit<Task, "task_id">[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setModifiedFields((prev) => new Set(prev).add(key));
  }

  function resetField<K extends keyof Omit<Task, "task_id">>(key: K) {
    const orig = (originalDraft ?? AI_SAMPLE_RESULT)[key];
    setDraft((prev) => (prev ? { ...prev, [key]: orig } : prev));
    setModifiedFields((prev) => {
      const next = new Set(prev);
      next.delete(key as string);
      return next;
    });
  }

  async function handleCreate() {
    if (!draft) return;
    const target = resolveAiCreateTarget(categories, draft.category_path);
    if (!target) {
      toast.error(productionWorkspace ? t("请先配置生产系统树，再创建任务") : t("请先配置研发系统树，再创建任务"));
      return;
    }
    let created: Task;
    try {
      created = await createRdTask({
        product_id: productId,
        category_id: target.category.id,
        sub_project_id: target.child?.id,
        title: draft.title,
        primary_owner: draft.primary_owner,
        status: draft.status,
        progress: Math.max(0, Math.min(100, draft.progress ?? 0)),
        ai_priority: draft.ai_priority,
        final_priority: draft.final_priority,
        due_date: draft.due_date,
        description: draft.description,
        category_path: draft.category_path,
      } as Parameters<typeof createRdTask>[0]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("任务创建失败"));
      return;
    }
    const taskId = created.task_id;
    if (modifiedFields.size > 0) {
    }
    toast.success(t("任务已创建，关键字段已留痕"));
    onCreated();
    onClose();
  }

  return (
    <div className="rd-task-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="rd-task-overlay-surface w-full max-w-2xl rounded-[8px] border border-white bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <span className="font-semibold text-slate-800">{t("AI 任务解析 · 新建任务")}</span>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6">
          {aiState !== "review" && (
            <div className="space-y-3">
              <div className="grid gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 md:grid-cols-2">
                <div>
                  <div className="font-semibold text-slate-900">{t("当前场景")}</div>
                  <div className="mt-1">{activeScene?.name ?? t("未配置")}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{t("当前模型")}</div>
                  <div className="mt-1">{describeRdAiModel(aiSettings, activeScene?.model_id)}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{t("Prompt 版本")}</div>
                  <div className="mt-1">{activeScene?.prompt_version || t("未指定")}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{t("OCR 兜底")}</div>
                  <div className="mt-1">
                    {aiSettings?.file_policy.ocr_provider ?? "tencent_ocr"} / {t("阈值")} {aiSettings?.file_policy.ocr_confidence_threshold ?? 0.85}
                  </div>
                </div>
              </div>
              <label className="text-sm font-medium text-slate-700">{t("粘贴会议纪要、邮件正文或需求描述")}</label>
              <Textarea
                className="w-full resize-none rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                rows={5}
                placeholder={t("例：电磁阀耐压测试需要在本月底前完成，由王磊负责，陈静配合质检……")}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors",
                    fileDropActive
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-500",
                  )}
                  onDragEnter={handleFileDrag}
                  onDragOver={handleFileDrag}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setFileDropActive(false);
                  }}
                  onDrop={handleFileDrop}
                >
                  <FileUp className="h-4 w-4" />
                  {t("拖入 Excel / Word / PDF / 图片 / 压缩包")}
                  <Input
                    type="file"
                    className="hidden"
                    accept={RD_ATTACHMENT_ACCEPT}
                    multiple
                    onChange={(event) => {
                      addSelectedFiles(event.target.files ?? []);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleProcess}
                  disabled={(!text.trim() && selectedFiles.length === 0) || aiState === "processing"}
                  className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiState === "processing" ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      {t("AI 解析中…")}
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      {t("AI 解析")}
                    </>
                  )}
                </button>
              </div>
              {selectedFiles.length > 0 && (
                <div className="space-y-2 rounded-[8px] border border-slate-200 bg-white px-4 py-3">
                  {selectedFiles.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-slate-700">{file.name}</span>
                      <span className="shrink-0 text-slate-400">{describeFileRule(aiSettings, file.name)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {aiState === "review" && draft && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-indigo-100 bg-indigo-50/50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-indigo-600">
                  <Pencil className="h-3 w-3" />
                  {t("AI 已解析完成。所有字段均可就地编辑，修改后字段会高亮标记。")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-indigo-700">
                  <span>{t("模型：")}{describeRdAiModel(aiSettings, activeScene?.model_id)}</span>
                  <span>Prompt：{activeScene?.prompt_version || t("未指定")}</span>
                  <span>{t("阈值：")}{activeScene?.confidence_threshold ?? 0.8}</span>
                  {selectedFiles.length > 0 && <span>{t("文件数：{n}", { n: selectedFiles.length })}</span>}
                </div>
              </div>

              {aiSummary && <p className="-mt-2 text-xs text-indigo-700">{aiSummary}</p>}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    {t("任务标题")}
                    {modifiedFields.has("title") && (
                      <button type="button" onClick={() => resetField("title")} className="ml-1 inline-flex cursor-pointer items-center gap-1 text-amber-500 hover:underline">
                        <RotateCcw className="h-3 w-3" />
                        {t("还原")}
                      </button>
                    )}
                  </label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100",
                      modifiedFields.has("title") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.title}
                    onChange={(e) => patchDraft("title", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("主责人")}</label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100",
                      modifiedFields.has("primary_owner") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.primary_owner}
                    onChange={(e) => patchDraft("primary_owner", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    {t("最终优先级")}
                    <span className="ml-auto text-slate-400">{t("AI 建议:")} {t(PRIORITY_CONFIG[draft.ai_priority].label)}</span>
                  </label>
                  <NativeSelect
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100",
                      modifiedFields.has("final_priority") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.final_priority}
                    onChange={(e) => patchDraft("final_priority", e.target.value as Priority)}
                  >
                    <option value="high">{t("高")}</option>
                    <option value="medium">{t("中")}</option>
                    <option value="low">{t("低")}</option>
                  </NativeSelect>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("分类路径")}</label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100",
                      modifiedFields.has("category_path") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.category_path}
                    onChange={(e) => patchDraft("category_path", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("预估工期（天）")}</label>
                  <Input
                    type="number"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                    value={draft.final_duration ?? ""}
                    onChange={(e) => patchDraft("final_duration", Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("起始日期")}</label>
                  <Input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                    value={draft.start_date ?? ""}
                    onChange={(e) => patchDraft("start_date", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("截止日期")}</label>
                  <Input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                    value={draft.due_date ?? ""}
                    onChange={(e) => patchDraft("due_date", e.target.value)}
                  />
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-slate-500">{t("任务描述")}</label>
                  <Textarea
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                    rows={3}
                    value={draft.description ?? ""}
                    onChange={(e) => patchDraft("description", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAiState("idle");
                    setDraft(null);
                    setOriginalDraft(null);
                    setAiSummary("");
                    setModifiedFields(new Set());
                  }}
                  className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("重新解析")}
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} className="cursor-pointer rounded-[8px] border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    {t("取消")}
                  </button>
                  <button type="button" onClick={handleCreate} className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                    {t("确认创建")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Task Detail Drawer ───────────────────────────────────────────────────────

type TimelineStepState = "done" | "current" | "todo" | "attention";

function getTaskTimelineCurrentIndex(task: Task): number {
  if (task.archived || task.status === "archived") return 4;
  if (task.status === "completed") return 3;
  if (task.status === "in_progress" || task.status === "paused_blocked" || task.status === "paused_leave") return 2;
  if (task.status === "pending_assign") return 1;
  return 0;
}

function TaskLifecycleTimeline({ task }: { task: Task }) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const currentIndex = getTaskTimelineCurrentIndex(task);
  const attentionCurrent =
    task.status === "paused_blocked" || task.status === "paused_leave" || task.status === "pending_assign";
  const steps: {
    label: string;
    helper: string;
    Icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>;
  }[] = [
    {
      label: t("创建"),
      helper: productionWorkspace ? t("任务已进入生产任务池") : t("任务已进入研发任务池"),
      Icon: CircleDot,
    },
    {
      label: t("指派"),
      helper: task.status === "pending_assign" ? t("等待组长确认负责人") : t("主责人：{name}", { name: task.primary_owner }),
      Icon: Users,
    },
    {
      label: task.status === "paused_blocked" ? t("执行受阻") : task.status === "paused_leave" ? t("暂停中") : t("执行"),
      helper:
        task.status === "paused_blocked"
          ? t("当前存在阻塞，需优先处理")
          : task.status === "paused_leave"
            ? t("主责人请假，周期顺延")
            : t("当前进度 {progress}%", { progress: task.progress }),
      Icon: Target,
    },
    {
      label: t("完成"),
      helper: task.due_date ? t("截止 {date}", { date: task.due_date }) : t("等待完成确认"),
      Icon: CheckCircle2,
    },
    { label: t("封存"), helper: task.archived || task.status === "archived" ? t("任务已归档") : t("完成后可封存"), Icon: Archive },
  ];

  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t("任务时间轴")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("当前节点已高亮显示")}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
          {steps[currentIndex].label}
        </span>
      </div>
      <div className="space-y-0">
        {steps.map((step, index) => {
          const state: TimelineStepState =
            index < currentIndex ? "done" : index === currentIndex ? (attentionCurrent ? "attention" : "current") : "todo";
          const isLast = index === steps.length - 1;
          return (
            <motion.div
              key={step.label}
              initial={shouldReduceMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { ...RD_LIST_TRANSITION, delay: index * 0.03 }}
              className="relative flex gap-3"
            >
              {!isLast && (
                <span
                  className={cn(
                    "absolute left-[15px] top-8 h-[calc(100%-24px)] w-px",
                    index < currentIndex ? "bg-emerald-200" : "bg-slate-200",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white",
                  state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-600",
                  state === "current" && "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_0_0_4px_rgba(59,130,246,0.10)]",
                  state === "attention" && "border-amber-200 bg-amber-50 text-amber-700 shadow-[0_0_0_4px_rgba(245,158,11,0.10)]",
                  state === "todo" && "border-slate-200 text-slate-300",
                )}
              >
                <step.Icon className="h-4 w-4" />
              </span>
              <div className={cn("min-w-0 pb-4", isLast && "pb-0")}>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    state === "done" && "text-emerald-700",
                    state === "current" && "text-indigo-800",
                    state === "attention" && "text-amber-800",
                    state === "todo" && "text-slate-400",
                  )}
                >
                  {step.label}
                </div>
                <div className={cn("mt-0.5 text-xs", state === "todo" ? "text-slate-400" : "text-slate-500")}>
                  {step.helper}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

// ─── SubmitConfirmDialog ──────────────────────────────────────────────────────

function TaskActionDialogFrame({
  busy,
  onCancel,
  children,
  className,
}: {
  busy: boolean;
  onCancel: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        className={cn("rd-task-overlay-surface gap-0 overflow-hidden p-0 sm:max-w-md", className)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SubmitConfirmDialog({
  taskTitle,
  onConfirm,
  onCancel,
  submitting,
}: {
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <Send className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t("提交任务审核")}</DialogTitle>
        </div>
        <div className="space-y-3 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t("确认提交「") }<span className="font-semibold text-slate-900">{taskTitle}</span>{t("」进入待审核状态？")}
          </DialogDescription>
          <p className="text-xs text-slate-500">{t("提交将任务进入待审核状态，请确认成果已准备好。")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t("确认提交")}
          </button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── HandoverDialog ───────────────────────────────────────────────────────────
export function CompleteConfirmDialog({
  taskTitle,
  onConfirm,
  onCancel,
  submitting,
}: {
  taskTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t("标记任务完成")}</DialogTitle>
        </div>
        <div className="space-y-3 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t("确认将「")}<span className="font-semibold text-slate-900">{taskTitle}</span>{t("」直接标记为已完成？")}
          </DialogDescription>
          <p className="text-xs text-slate-500">{t("管理员/主管操作会跳过提交审核，任务进度将设为 100%。")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {t("确认完成")}
          </button>
        </div>
    </TaskActionDialogFrame>
  );
}

export function HandoverDialog({
  taskTitle,
  currentOwner,
  people,
  onConfirm,
  onCancel,
  horizonVariant = false,
}: {
  taskId: string;
  taskTitle: string;
  currentOwner: string;
  people: { name: string }[];
  onConfirm: (newOwner: string) => Promise<void>;
  onCancel: () => void;
  horizonVariant?: boolean;
}) {
  const [newOwner, setNewOwner] = useState("");
  const [saving, setSaving] = useState(false);

  const options = people.filter((p) => p.name !== currentOwner);

  const handleConfirm = async () => {
    if (!newOwner) { toast.error(t("请选择新责任人")); return; }
    if (newOwner === currentOwner) { toast.error(t("新责任人与当前负责人相同")); return; }
    setSaving(true);
    try {
      await onConfirm(newOwner);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskActionDialogFrame busy={saving} onCancel={onCancel}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <ArrowRight className="h-4 w-4" />
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">{t("移交任务")}</DialogTitle>
        </div>
        <div className="space-y-4 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {t("将「")}<span className="font-semibold text-slate-900">{taskTitle}</span>{t("」移交给新责任人")}
          </DialogDescription>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("当前负责人")}</label>
            <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500">{currentOwner}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("新责任人")}</label>
            <Select value={newOwner} onValueChange={setNewOwner} disabled={saving}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("请选择新责任人")} />
              </SelectTrigger>
              <SelectContent className={cn(horizonVariant && "rd-horizon-detail-select")}>
                {options.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">{t("暂无可选人员")}</div>
                ) : (
                  options.map((p) => (
                    <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || !newOwner}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移交")}
          </button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── AddCollaboratorsDialog（管理员专用：直接添加，不走审核流程）──────────────
export function AddCollaboratorsDialog({
  taskTitle,
  currentOwner,
  existingCollaborators,
  people,
  onConfirm,
  onCancel,
}: {
  taskTitle: string;
  currentOwner: string;
  existingCollaborators: RdCollaborator[];
  people: PersonProfile[];
  onConfirm: (newCollaborators: RdCollaborator[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const existingNames = useMemo(
    () => new Set(existingCollaborators.map((c) => c.name).concat([currentOwner])),
    [existingCollaborators, currentOwner],
  );

  // 候选人 = 全部人员 - 主责人 - 已有协作人
  const candidates = useMemo(
    () => people.filter((p) => p.name && !existingNames.has(p.name)),
    [people, existingNames],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) { toast.error(t("请至少选择一位协作人")); return; }
    const additions: RdCollaborator[] = candidates
      .filter((p) => selected.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.position || "协作人",
        user_id: p.user_id ?? null,
      }));
    setSaving(true);
    try {
      await onConfirm(additions);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskActionDialogFrame busy={saving} onCancel={onCancel} className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-indigo-100 bg-indigo-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <UserPlus className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-900">{t("添加协作人")}</DialogTitle>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{taskTitle}</p>
          </div>
        </div>
        <div className="space-y-3 px-6 py-4">
          <DialogDescription className="text-xs leading-relaxed text-slate-500">
            {t("管理员直接添加将")}<span className="font-semibold text-indigo-700">{t("立即生效")}</span>{t("，不需要走审核流程。")}
            {t("已选")} <span className="font-semibold text-slate-700 tabular-nums">{selected.size}</span> / {candidates.length}
          </DialogDescription>
          <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
            {candidates.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">{t("无可添加的人员（其他人都已在协作或主责）")}</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {candidates.map((p) => {
                  const isSelected = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                          isSelected ? "bg-indigo-50 text-indigo-800" : "hover:bg-slate-50 text-slate-700",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            isSelected ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 bg-white",
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <OwnerAvatar name={p.name} userId={p.user_id} size="xs" />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {p.position && <span className="shrink-0 text-[11px] text-slate-400">{p.position}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || selected.size === 0}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
            {t("确认添加")} {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
    </TaskActionDialogFrame>
  );
}

// ─── ApprovalActionDialog ─────────────────────────────────────────────────────
export function ApprovalActionDialog({
  mode,
  task,
  onConfirm,
  onCancel,
  submitting,
}: {
  mode: "approve" | "reject";
  task: Task;
  onConfirm: (reason?: string, rollbackProgress?: number) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  const [rollbackProgress, setRollbackProgress] = useState(Math.max(0, task.progress - 10));

  const isApprove = mode === "approve";

  const handleConfirm = async () => {
    if (!isApprove && !reason.trim()) { toast.error(t("请填写打回原因")); return; }
    await onConfirm(reason.trim() || undefined, isApprove ? undefined : rollbackProgress);
  };

  return (
    <TaskActionDialogFrame busy={submitting} onCancel={onCancel}>
        <div className={cn(
          "flex items-center gap-3 border-b px-6 py-4",
          isApprove ? "border-emerald-100 bg-emerald-50/60" : "border-red-100 bg-red-50/60",
        )}>
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            isApprove ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600",
          )}>
            {isApprove ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          </div>
          <DialogTitle className="text-base font-semibold text-slate-900">
            {isApprove ? t("审核通过") : t("打回修改")}
          </DialogTitle>
        </div>
        <div className="space-y-4 px-6 py-5">
          <DialogDescription className="text-sm text-slate-700">
            {isApprove
              ? task.pending_review_type === "proposal"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的立项审核？通过后任务将正式立项并进入进行中状态。")}</>
                : task.pending_review_type === "collaboration"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的协作变更审核？通过后协同人变更将生效，任务回到进行中。")}</>
                : task.pending_review_type === "due_date"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的截止日期变更审核？通过后任务的截止日期将更新为申请值，并回到进行中。")}</>
                : task.pending_review_type === "merge"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的合并审核？通过后本任务的子任务、进展留痕、附件与协作人将并入目标任务，本任务随即归档。")}</>
                : task.pending_review_type === "abandon"
                ? <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的放弃审核？通过后本任务及其子任务将被彻底移除，不可恢复。")}</>
                : <>{t("确认通过「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」的审核？任务将标记为已完成，进度设为 100%。")}</>
              : <>{t("将「")}<span className="font-semibold text-slate-900">{task.title}</span>{t("」打回给负责人重新修改。")}</>
            }
          </DialogDescription>
          {!isApprove && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("打回原因")} <span className="text-red-500">*</span></label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={t("请说明需要修改的原因…")}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("回退进度（%）")}</label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={rollbackProgress}
                  onChange={(e) => setRollbackProgress(Math.min(99, Math.max(0, Number(e.target.value))))}
                  className="w-24"
                />
                <span className="ml-2 text-xs text-slate-400">{t("当前进度")} {task.progress}%</span>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={submitting || (!isApprove && !reason.trim())}
            onClick={handleConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60",
              isApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : isApprove ? <CheckCircle2 className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
            {isApprove ? t("确认通过") : t("确认打回")}
          </button>
        </div>
    </TaskActionDialogFrame>
  );
}

export function TaskCompletionScoreCard({
  task,
  notes,
  loading,
  canView,
}: {
  task: Task;
  notes: RdTaskProgressNote[];
  loading: boolean;
  canView: boolean;
}) {
  const { user } = useAuth();
  const isSuper = isSuperAdmin(user?.permissions);
  const [aiScore, setAiScore] = useState<RdTaskCompletionScore | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFetched, setAiFetched] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<RdTaskCompletionScoreDebug | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const openDebug = useCallback(async () => {
    setDebugOpen(true);
    if (debugData) return; // 已经拉过
    setDebugLoading(true);
    try {
      const d = await fetchRdTaskCompletionScoreDebug(task.task_id);
      setDebugData(d);
    } finally {
      setDebugLoading(false);
    }
  }, [debugData, task.task_id]);

  // 拉取 AI 评分（接口已做权限过滤；未授权时返回 null）
  useEffect(() => {
    if (!canView) {
      setAiScore(null);
      setAiFetched(true);
      return;
    }
    const controller = new AbortController();
    setAiLoading(true);
    fetchRdTaskCompletionScore(task.task_id, controller.signal)
      .then((score) => { if (!controller.signal.aborted) setAiScore(score); })
      .catch(() => { if (!controller.signal.aborted) setAiScore(null); })
      .finally(() => {
        if (!controller.signal.aborted) {
          setAiLoading(false);
          setAiFetched(true);
        }
      });
    return () => { controller.abort(); };
  }, [task.task_id, canView]);

  if (!canView) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-400">
        {t("完成质量评分仅对该任务关联人员和管理员可见")}
      </div>
    );
  }

  if (loading || aiLoading || !aiFetched) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-400">
        {t("正在读取 AI 完成质量评分…")}
      </div>
    );
  }

  // AI 评分未生成 → 展示等待生成的空状态（不再使用规则估算填充，避免误导）
  if (!aiScore) {
    return (
      <div className="rounded-[8px] border border-dashed border-indigo-200 bg-indigo-50/40 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
          <Sparkles className="h-4 w-4" />
          {t("完成质量评分")}
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          {t("AI 评分尚未生成。审核通过的任务会自动触发评分（每条 5-20 秒）；历史已完成任务可在驾驶舱「完成」筛选条点击「AI 复盘评分」批量生成。")}
        </p>
      </div>
    );
  }

  const total = aiScore.total;
  const grade = aiScore.grade;
  const gradeLabel = aiScore.grade_label;
  const dimensions = aiScore.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    score: d.score,
    max: d.max,
    detail: d.comment,
  }));
  const tone = getGradeTone(grade);
  const useAi = !aiScore.fallback_reason;

  return (
    <div className={cn("rounded-[8px] border bg-white p-4 space-y-3", tone.border)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className={cn("h-4 w-4 shrink-0", tone.text)} />
            <div className="text-sm font-semibold text-slate-800">{t("完成质量评分")}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                useAi
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-slate-50 text-slate-500",
              )}
              title={useAi ? `${t("AI 模型：")}${aiScore!.provider}/${aiScore!.model}` : t("AI 评分未生成")}
            >
              {useAi ? t("AI 复盘") : t("规则估算")}
            </span>
            {!useAi && (
              <span
                className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                title={aiScore.fallback_reason}
              >
                {t("AI 不可用·兜底")}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-baseline justify-end gap-1">
            <span className={cn("text-2xl font-bold tabular-nums", tone.text)}>{total}</span>
            <span className="text-xs text-slate-400">/ 100</span>
          </div>
          <span
            className={cn(
              "mt-1 inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold ring-1",
              tone.bg,
              tone.text,
              tone.border,
              tone.ring,
            )}
            title={t(gradeLabel)}
          >
            {grade} · {t(gradeLabel)}
          </span>
        </div>
      </div>

      {aiScore.summary && (
        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Sparkles className="h-3 w-3 text-indigo-500" />
            {t("AI 综合点评")}
          </div>
          <p className="text-xs leading-6 text-slate-700">{aiScore.summary}</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {dimensions.map((d) => {
          const pct = Math.round((d.score / d.max) * 100);
          return (
            <li key={d.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-700">{t(d.label)}</span>
                <span className="tabular-nums text-slate-500">
                  <span className="font-semibold text-slate-700">{d.score}</span>
                  <span className="text-slate-400"> / {d.max}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} />
              </div>
              {/* 维度评语完整展示（此前用 w-40 truncate 截断导致"看不全"，改为整行换行） */}
              {d.detail && (
                <p className="text-[11px] leading-5 text-slate-500">{d.detail}</p>
              )}
            </li>
          );
        })}
      </ul>

      {(aiScore.highlights.length > 0 || aiScore.improvements.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {aiScore.highlights.length > 0 && (
            <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                {t("亮点")}
              </div>
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-emerald-800">
                {aiScore.highlights.map((h, i) => (
                  <li key={i}>· {h}</li>
                ))}
              </ul>
            </div>
          )}
          {aiScore.improvements.length > 0 && (
            <div className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {t("改进建议")}
              </div>
              <ul className="space-y-0.5 text-[11px] leading-relaxed text-amber-800">
                {aiScore.improvements.map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">
        <p className="min-w-0 flex-1">
          {useAi ? (
            <>
              {t("AI 复盘基于时效性、过程透明度、交付证据、协作与风险管理 4 维度评分。模型：")}
              <span className="font-mono">{aiScore.provider}/{aiScore.model}</span> · {t("生成于")}
              <span className="tabular-nums"> {new Date(aiScore.computed_at).toLocaleString(i18nLocale())}</span>
            </>
          ) : (
            <>
              {t("AI 模型调用失败或未配置，使用规则估算兜底（仅时效/留痕/附件/协作 4 指标，无 AI 推理）。")}
              {t("原因：")}<span className="font-mono">{aiScore.fallback_reason ?? t("未知")}</span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const ok = openTaskCompletionReport(task, aiScore, notes);
              if (!ok) toast.error(t("报告窗口被浏览器拦截，请允许本站弹出窗口后重试"));
            }}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            title={t("生成正式的完成质量评估报告，在弹出的打印对话框中选择「另存为 PDF」即可下载")}
          >
            <FileText className="h-3 w-3" />
            {t("生成报告")}
          </button>
          {isSuper && (
            <button
              type="button"
              onClick={openDebug}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              title={t("超级管理员专属：查看 AI 评分的原始 prompt 和 AI 响应（用于审查抽取/RAG 是否真的传到 AI）")}
            >
              <Settings2 className="h-3 w-3" />
              {t("调试")}
            </button>
          )}
        </div>
      </div>
      {debugOpen && (
        <CompletionScoreDebugDialog
          loading={debugLoading}
          data={debugData}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  );
}

function CompletionScoreDebugDialog({
  loading,
  data,
  onClose,
}: {
  loading: boolean;
  data: RdTaskCompletionScoreDebug | null;
  onClose: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const debug = data?._debug;
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("{label}已复制", { label })),
      () => toast.error(t("复制{label}失败", { label })),
    );
  };
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={RD_PANEL_TRANSITION}
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">{t("AI 评分调试 · 原始 prompt + AI 响应")}</h3>
            <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              {t("仅超管可见")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("正在拉取调试数据…")}
            </div>
          ) : !data || !debug ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <p>{t("该任务尚无 AI 评分数据，或调试信息未保存（仅新评分会带 _debug 字段）")}</p>
              <p className="text-[11px] text-slate-400">{t("让管理员重新触发一次 AI 评分即可。")}</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* 元数据条 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <span>
                    {t("模型：")}<span className="font-mono font-semibold text-slate-900">{data.provider}/{data.model}</span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>
                    {t("耗时：")}<span className="font-semibold tabular-nums">{debug.duration_ms} ms</span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>
                    {t("开始：")}<span className="tabular-nums">{new Date(debug.request_started_at).toLocaleString(i18nLocale())}</span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>
                    {t("结束：")}<span className="tabular-nums">{new Date(debug.request_finished_at).toLocaleString(i18nLocale())}</span>
                  </span>
                  {data.fallback_reason && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        {t("兜底：")}{data.fallback_reason}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 1. System Prompt */}
              <DebugSection
                title={t("1. System Prompt（评分员角色 + 规则）")}
                content={debug.system_prompt}
                onCopy={() => copyToClipboard(debug.system_prompt, "System Prompt")}
              />

              {/* 2. User Message */}
              <DebugSection
                title={t("2. User Message（任务数据 + 附件抽取内容 + RAG 上下文）")}
                content={debug.user_message}
                onCopy={() => copyToClipboard(debug.user_message, "User Message")}
                highlightLength
              />

              {/* 3. Raw AI Response */}
              <DebugSection
                title={t("3. AI 原始响应（JSON 字符串）")}
                content={prettyJsonOrText(debug.raw_response)}
                onCopy={() => copyToClipboard(debug.raw_response, t("AI 原始响应"))}
              />

              {/* 4. Parsed result */}
              <DebugSection
                title={t("4. 解析后的评分结果（持久化到 rd.taskCompletionScores）")}
                content={JSON.stringify(
                  {
                    total: data.total,
                    grade: data.grade,
                    grade_label: data.grade_label,
                    summary: data.summary,
                    dimensions: data.dimensions,
                    highlights: data.highlights,
                    improvements: data.improvements,
                  },
                  null,
                  2,
                )}
                onCopy={() =>
                  copyToClipboard(
                    JSON.stringify(
                      {
                        total: data.total,
                        grade: data.grade,
                        dimensions: data.dimensions,
                        highlights: data.highlights,
                        improvements: data.improvements,
                      },
                      null,
                      2,
                    ),
                    t("解析后结果"),
                  )
                }
              />
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function DebugSection({
  title,
  content,
  onCopy,
  highlightLength = false,
}: {
  title: string;
  content: string;
  onCopy: () => void;
  highlightLength?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold text-slate-700 hover:text-indigo-700"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")} />
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-[10px] font-normal text-slate-400">
            ({t("{count} 字符", { count: content.length.toLocaleString() })}{highlightLength && content.length > 12000 ? ` ${t("· ⚠️ 较长")}` : ""})
          </span>
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
        >
          {t("复制")}
        </button>
      </header>
      {!collapsed && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
          {content || t("(空)")}
        </pre>
      )}
    </section>
  );
}

function prettyJsonOrText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Blob → dataURL（生成问题时把留痕附件字节转 dataURL，喂给问题模块的 uploadAttachment）。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取附件失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 单任务过程报告导出（协同模块）：任务概要 + 工作项 + 完整留痕时间线（含附件清单）
 * 生成 Word 兼容 HTML 并下载为 .doc——跨团队交接/领导汇报直接可发。
 */
export async function downloadUsCollabTaskReport(
  task: Task,
  logs: AuditLog[],
  noteOf: (logId: string) => RdTaskProgressNote | undefined,
) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isEn = currentI18nLang() === "en";
  // 英文态：动态中文内容（标题/描述/留痕/时间线动作）走翻译通道——详情页浏览过的内容已有
  // 服务端缓存基本秒回，未缓存的单条 10s 超时回退原文，不让导出卡死
  const tr = async (text: string | null | undefined): Promise<string> => {
    const raw = (text ?? "").trim();
    if (!raw || !isEn) return raw;
    // 30s 上限：超时计时含 4 并发队列排队时间，留痕多的报告排队较长（超时静默回退原文）
    return (await fetchContentTranslation(raw, 30_000)) ?? raw;
  };
  if (isEn) toast.info(t("正在生成报告，动态内容翻译中…"));

  const workItems = task.work_items ?? [];
  const doneCount = workItems.filter((it) => it.done).length;
  const locale = i18nLocale();
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? esc(iso) : `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  };
  const statusLabel = t(STATUS_CONFIG[task.status]?.label ?? task.status);
  const blockedDays = blockedDaysOf(task);

  // 并发预翻译（fetchContentTranslation 内部有缓存/去重/限流）
  const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const [trTitle, trDescription, trComments, trWorkItems] = await Promise.all([
    tr(task.title),
    tr(task.description),
    Promise.all(sortedLogs.map((log) => tr(log.comment ?? ""))),
    Promise.all(workItems.map((it) => tr(it.title))),
  ]);

  const timelineRows = sortedLogs
    .map((log, i) => {
      const note = noteOf(log.id);
      const attachments = note?.attachments?.length
        ? `<div style="color:#64748b;font-size:12px;">${t("附件：")}${note.attachments.map((a) => esc(a.name)).join("、")}</div>`
        : "";
      return `<tr>
        <td style="white-space:nowrap;vertical-align:top;color:#64748b;">${fmtTime(log.timestamp)}</td>
        <td style="white-space:nowrap;vertical-align:top;">${esc(displayPersonName(log.actor?.name ?? ""))}</td>
        <td>${esc(trComments[i])}${attachments}</td>
      </tr>`;
    })
    .join("");

  const workItemsBlock = workItems.length
    ? `<h2>${t("工作项")}（${doneCount}/${workItems.length}）</h2>
       <ul>${workItems.map((it, i) => `<li>${it.done ? "☑" : "☐"} ${esc(trWorkItems[i])}${it.owner_name ? `（${esc(it.owner_name)}）` : ""}</li>`).join("")}</ul>`
    : "";

  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(trTitle)}</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;font-size:13px;color:#0f172a;line-height:1.7;}h1{font-size:20px;}h2{font-size:15px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:18px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left;}</style></head><body>
<h1>${esc(trTitle)}</h1>
<p style="color:#64748b;">${t("任务过程报告")} · ${t("生成于")} ${new Date().toLocaleString(locale)} · ${esc(task.task_id)}</p>
<h2>${t("任务概要")}</h2>
<table>
<tr><th>${t("状态")}</th><td>${esc(statusLabel)}${blockedDays != null ? `（${t("已阻塞 {n} 天", { n: blockedDays })}）` : ""}</td><th>${t("进度")}</th><td>${task.progress}%</td></tr>
<tr><th>${t("主责人")}</th><td>${esc(displayPersonName(task.primary_owner))}</td><th>${t("优先级")}</th><td>${esc(t(PRIORITY_CONFIG[task.final_priority]?.label ?? task.final_priority))}</td></tr>
<tr><th>${t("协作人")}</th><td>${esc((task.collaborators ?? []).map((c) => c.name).join("、") || "—")}</td><th>${t("截止日期")}</th><td>${esc(task.due_date || "—")}</td></tr>
</table>
${trDescription ? `<h2>${t("任务描述")}</h2><p>${esc(trDescription).replace(/\n/g, "<br/>")}</p>` : ""}
${workItemsBlock}
<h2>${t("过程时间线（{n} 条）", { n: logs.length })}</h2>
<table><tr><th style="width:130px;">${t("时间")}</th><th style="width:80px;">${t("操作人")}</th><th>${t("内容")}</th></tr>${timelineRows || `<tr><td colspan="3">${t("暂无记录")}</td></tr>`}</table>
</body></html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const namePrefix = isEn ? "Task-Report" : "任务过程报告";
  a.download = `${namePrefix}-${trTitle.slice(0, 40).replace(/[\\/:*?"<>|]/g, "_")}-${new Date().toISOString().slice(0, 10)}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 工作项清单（任务详情内）：任务内部的轻量拆分——如文档类任务的各个文件。
 * 工作项不是任务：无独立审批/优先级/截止日，不进任务树，驾驶舱/统计/负载/AI 立项对其零感知。
 * 数据存于任务对象的 work_items 字段（PATCH 持久化）；进度留痕可关联工作项，留痕区按 Tab 分组查看。
 */
export function WorkItemsSection({
  task,
  canEdit,
  noteCountByItem,
  onTaskPatched,
  onTaskMutated,
}: {
  task: Task;
  canEdit: boolean;
  /** 各工作项已关联的留痕数（work_item_id → count），来自主任务 progressNotes */
  noteCountByItem: Map<string, number>;
  onTaskPatched?: (taskId: string, patch: Partial<Task>) => void;
  onTaskMutated?: () => void;
}) {
  const items = task.work_items ?? [];
  const doneCount = items.filter((it) => it.done).length;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  /** 工作项动作 → 操作留痕（带 work_item_id，留痕区按工作项 Tab 呈现完整时间线：创建→进展→完成） */
  const auditWorkItem = (comment: string, workItemId?: string) => {
  };

  const persist = async (next: RdWorkItem[], successText?: string) => {
    setSaving(true);
    try {
      await updateRdTask(task.task_id, { work_items: next } as Partial<Task>);
      if (successText) toast.success(successText);
      onTaskPatched?.(task.task_id, { work_items: next } as Partial<Task>);
      onTaskMutated?.();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("保存工作项失败"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const titles = draft.split("\n").map((t) => t.trim()).filter(Boolean);
    if (titles.length === 0) {
      toast.error(t("请每行输入一个工作项标题"));
      return;
    }
    const stamp = Date.now();
    const created: RdWorkItem[] = titles.map((title, index) => ({
      id: `wi-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      done: false,
    }));
    if (await persist([...items, ...created], `已添加 ${created.length} 个工作项`)) {
      created.forEach((it) => auditWorkItem(`添加了工作项《${it.title}》`, it.id));
      setDraft("");
      setAdding(false);
    }
  };

  const toggleDone = async (id: string) => {
    if (!canEdit || saving) return;
    const target = items.find((it) => it.id === id);
    if (!target) return;
    if (await persist(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)))) {
      auditWorkItem(target.done ? `重新打开了工作项《${target.title}》` : `完成了工作项《${target.title}》`, id);
    }
  };

  const removeItem = async (id: string) => {
    if (!canEdit || saving) return;
    const target = items.find((it) => it.id === id);
    if (await persist(items.filter((it) => it.id !== id))) {
      // 删除记录不带 work_item_id：该工作项 Tab 已不存在，归入「未关联」保证可见
      auditWorkItem(`删除了工作项《${target?.title ?? id}》`);
    }
  };

  if (items.length === 0 && !canEdit) return null;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">
          {t("工作项")}{items.length > 0 ? ` ${doneCount}/${items.length}` : ""}
        </span>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <Plus className="h-2.5 w-2.5" />
            {t("添加工作项")}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className={cn("cockpit-scroll max-h-52 overflow-y-auto", canEdit ? "space-y-1.5" : "space-y-0.5")}>
          {items.map((it) => {
            const noteCount = noteCountByItem.get(it.id) ?? 0;
            return (
              // 只读展示（驾驶舱/详情页）用无框简洁行（美式 checklist）；编辑态（工作台入口）保留框行
              <li
                key={it.id}
                className={cn(
                  "group flex items-center gap-2.5 text-sm",
                  canEdit ? "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5" : "px-1 py-1",
                )}
              >
                <Checkbox
                  checked={it.done}
                  disabled={!canEdit || saving}
                  onCheckedChange={() => void toggleDone(it.id)}
                  className="border-slate-300"
                />
                <span className={cn("min-w-0 flex-1 truncate", it.done ? "text-slate-400 line-through" : "text-slate-700")}>{it.title}</span>
                {it.owner_name && <span className="shrink-0 text-[11px] text-slate-400">{it.owner_name}</span>}
                {noteCount > 0 && (
                  <span className="rd-work-item-note-count shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500">{t("{n} 条留痕", { n: noteCount })}</span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void removeItem(it.id)}
                    className="shrink-0 cursor-pointer rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
                    title={t("删除工作项（已关联的留痕保留在主任务）")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="mt-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder={t("每行一个工作项，例如：\n用户手册（英文版）\nFDA 提交材料 · 附录B\n装配 SOP 文档")}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            autoFocus
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft(""); }}
              className="cursor-pointer rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-200"
            >
              {t("取消")}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex cursor-pointer items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
              {t("批量添加")}
            </button>
          </div>
        </div>
      ) : (
        items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
            {t("暂无工作项，可把任务拆成几个小块（如不同类型文档各一项），进度留痕可关联到工作项分组查看")}
          </div>
        )
      )}
    </div>
  );
}

// ─── Command Center ──────────────────────────────────────────────────────────

type CommandMetricProps = {
  label: string;
  value: string;
  helper: string;
  tone: string;
  Icon: React.ComponentType<{ className?: string }>;
};

function CommandMetric({ label, value, helper, tone, Icon }: CommandMetricProps) {
  return (
    <div className="rd-board-command-metric flex min-w-[128px] items-center gap-2 rounded-[8px] bg-slate-50 px-2.5 py-2 text-slate-900 ring-1 ring-slate-200/80">
      <Icon className={cn("h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold leading-none tabular-nums">{value}</span>
          <span className="truncate text-[11px] font-semibold text-slate-600">{label}</span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-slate-500">{helper}</div>
      </div>
    </div>
  );
}

function CommandCenter({
  totalActive,
  risks,
  pendingAssign,
  averageProgress,
  onCreate,
}: {
  totalActive: number;
  risks: Risk[];
  pendingAssign: number;
  averageProgress: number;
  onCreate?: () => void;
}) {
  const criticalRisks = risks.filter((risk) => risk.severity === "critical").length;

  return (
    <section className="rd-board-command-bar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 py-3">
      <div className="flex flex-1 flex-wrap gap-2">
        <CommandMetric
          label={t("活跃任务")}
          value={String(totalActive)}
          helper={t("当前根任务池")}
          tone="text-indigo-500"
          Icon={Target}
        />
        <CommandMetric label={t("平均进度")} value={`${averageProgress}%`} helper={t("全部活跃任务")} tone="text-emerald-500" Icon={Gauge} />
        <CommandMetric label={t("高风险")} value={String(criticalRisks)} helper={t("需要优先处理")} tone="text-red-500" Icon={AlertTriangle} />
        <CommandMetric label={t("待指派")} value={String(pendingAssign)} helper={t("等待确认负责人")} tone="text-violet-500" Icon={Users} />
      </div>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="rd-board-primary-control inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("新建任务")}
        </button>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── EXECUTIVE OVERVIEW (Leadership Dashboard) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function KpiStrip({
  totalActive,
  inProgress,
  done,
  blocked,
  totalRisks,
  rate,
}: {
  totalActive: number;
  inProgress: number;
  done: number;
  blocked: number;
  totalRisks: number;
  rate: number;
}) {
  const shouldReduceMotion = useReducedMotion();
  const items: {
    label: string;
    value: string | number;
    tone: string;
    iconTone: string;
    Icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>;
  }[] = [
    { label: "活跃任务", value: totalActive, tone: "text-slate-900", iconTone: "text-slate-400", Icon: Target },
    { label: "完成率", value: `${rate}%`, tone: "text-slate-900", iconTone: "text-slate-400", Icon: Gauge },
    { label: "进行中", value: inProgress, tone: "text-indigo-600", iconTone: "text-indigo-400", Icon: CircleDot },
    { label: "已完成", value: done, tone: "text-emerald-600", iconTone: "text-emerald-400", Icon: CheckCircle2 },
    {
      label: "阻塞/待派",
      value: blocked,
      tone: blocked > 0 ? "text-orange-600" : "text-slate-300",
      iconTone: blocked > 0 ? "text-orange-400" : "text-slate-300",
      Icon: Users,
    },
    {
      label: "风险任务",
      value: totalRisks,
      tone: totalRisks > 0 ? "text-red-600" : "text-slate-300",
      iconTone: totalRisks > 0 ? "text-red-400" : "text-slate-300",
      Icon: AlertTriangle,
    },
  ];

  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rd-board-surface rd-board-kpi-strip overflow-hidden rounded-xl border border-indigo-100/80 bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_58%,#eff6ff_100%)] shadow-[0_12px_30px_rgba(79,70,229,0.06)]"
    >
      <div className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex min-w-[150px] items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-indigo-100 shadow-[0_8px_18px_rgba(79,70,229,0.08)]">
            <Gauge className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-950">{t("执行统计")}</h2>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("今日实时")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {items.map((it, idx) => (
            <motion.div
              key={it.label}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { ...RD_LIST_TRANSITION, delay: idx * 0.025 }}
              whileHover={shouldReduceMotion ? undefined : { y: -1 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
              className="rd-board-kpi group flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-white/82 px-3 py-2 shadow-[0_6px_16px_rgba(79,70,229,0.045)] transition-all duration-200 hover:border-indigo-200 hover:bg-white hover:shadow-[0_10px_20px_rgba(79,70,229,0.08)]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-slate-50 to-indigo-50 ring-1 ring-slate-100 transition-all duration-200 group-hover:ring-indigo-100">
                <it.Icon
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110",
                    it.iconTone,
                  )}
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-lg font-bold leading-none tabular-nums tracking-tight transition-colors",
                    it.tone,
                  )}
                >
                  {it.value}
                </div>
                <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{t(it.label)}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function RiskHotspot({
  risks,
  onSelectTask,
  className,
  title = t("决策焦点 · 风险任务"),
  subtitle = t("仅显示风险任务；全部任务在任务清单中"),
  totalTasks,
}: {
  risks: Risk[];
  onSelectTask: (t: Task) => void;
  className?: string;
  title?: string;
  subtitle?: string;
  totalTasks?: number;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [riskFilter, setRiskFilter] = useState<Risk["type"] | "all">("all");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const buckets: { type: Risk["type"]; label: string }[] = [
    { type: "overdue", label: "已逾期" },
    { type: "due_soon", label: "即将到期" },
    { type: "blocked", label: "阻塞" },
    { type: "pending", label: "待指派" },
    { type: "slow", label: "进度滞后" },
  ];
  const counts: Record<string, number> = {};
  for (const r of risks) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const filteredRisks = riskFilter === "all" ? risks : risks.filter((risk) => risk.type === riskFilter);
  const totalPages = Math.max(1, Math.ceil(filteredRisks.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const shownRisks = filteredRisks.slice((safePage - 1) * pageSize, safePage * pageSize);
  const filterOptions: { type: Risk["type"] | "all"; label: string; count: number }[] = [
    { type: "all", label: "全部", count: risks.length },
    ...buckets.map((bucket) => ({ ...bucket, count: counts[bucket.type] ?? 0 })),
  ];

  const changeFilter = (next: Risk["type"] | "all") => {
    setRiskFilter(next);
    setPage(1);
  };

  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className={cn(
        "rd-board-surface flex h-full min-h-[410px] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)]",
        className,
      )}
      data-surface="risk"
    >
      <header className="rd-board-panel-head flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-white via-white to-slate-50/70 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
            <AlertTriangle className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-950">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-slate-100 bg-white px-3 py-2 text-right shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {riskFilter === "all" ? risks.length : `${filteredRisks.length}/${risks.length}`}
          </div>
          {typeof totalTasks === "number" && (
            <div className="mt-0.5 text-[11px] font-medium text-slate-400">
              {t("共 {count} 个任务", { count: totalTasks })}
            </div>
          )}
        </div>
      </header>

      <div className="rd-board-filter-strip flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3 sm:px-6">
        {filterOptions.map((b) => {
          const active = riskFilter === b.type;
          const disabled = b.count === 0;
          return (
            <motion.button
              key={b.type}
              type="button"
              onClick={() => changeFilter(b.type)}
              disabled={disabled}
              data-active={active}
              whileHover={!disabled && !shouldReduceMotion ? { y: -1 } : undefined}
              whileTap={!disabled && !shouldReduceMotion ? { scale: 0.97 } : undefined}
              className={cn(
                "rd-board-filter-chip flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                active
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_8px_18px_rgba(79,70,229,0.10)] ring-1 ring-indigo-100"
                  : disabled
                    ? "cursor-not-allowed border-slate-100 text-slate-400"
                    : "cursor-pointer border-slate-200 bg-slate-50 shadow-[0_4px_10px_rgba(15,23,42,0.025)] hover:bg-white hover:shadow-[0_8px_16px_rgba(15,23,42,0.05)]",
              )}
            >
              {b.type !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT_COLOR[b.type])} />}
              {b.type === "all" && <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-indigo-500" : "bg-slate-400")} />}
              <span className={cn("font-medium", active ? "text-indigo-700" : disabled ? "text-slate-400" : "text-slate-700")}>{t(b.label)}</span>
              <span className={cn("tabular-nums", active ? "font-semibold text-indigo-700" : disabled ? "text-slate-400" : "font-semibold text-slate-900")}>
                {b.count}
              </span>
            </motion.button>
          );
        })}
      </div>

      <ul className="flex-1 divide-y divide-slate-100 overflow-hidden">
        {shownRisks.length === 0 ? (
          <li className="px-6 py-10 text-center text-sm text-slate-400">
            {totalTasks ? t("暂无风险任务，全部任务请查看任务清单") : t("暂无风险任务")}
          </li>
        ) : (
          shownRisks.map((r) => (
          <li
              key={r.task.task_id + r.type}
              onClick={() => onSelectTask(r.task)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTask(r.task);
                }
              }}
              role="button"
              tabIndex={0}
              className="rd-board-data-row group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-3 transition-all hover:bg-slate-50/80 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", RISK_DOT_COLOR[r.type])} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                  {r.task.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span
                    className={cn(r.severity === "critical" ? "font-semibold text-red-600" : "text-amber-600")}
                  >
                    {t(RISK_LABEL[r.type])} · {t(r.reason)}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>{r.task.primary_owner}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono text-[11px] text-slate-400">{r.task.task_id}</span>
                </div>
              </div>
              <div className="hidden sm:block">
                <OwnerAvatar name={r.task.primary_owner} userId={r.task.primary_owner_user_id} size="xs" />
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </li>
          ))
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-2.5">
          <span className="text-[11px] tabular-nums text-slate-400">
            {shownRisks.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
            {" - "}
            {Math.min(safePage * pageSize, filteredRisks.length)}
            <span className="mx-1 text-slate-300">/</span>
            {filteredRisks.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t("上一页")}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {/* Numeric page indicators (max 5) */}
            {Array.from({ length: totalPages }).map((_, i) => {
              const page = i + 1;
              const active = page === safePage;
              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => setPage(page)}
                  className={cn(
                    "h-7 min-w-7 cursor-pointer rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-all duration-150 active:scale-90",
                    active
                      ? "bg-indigo-50 text-indigo-700 shadow-[0_6px_14px_rgba(79,70,229,0.08)] ring-1 ring-indigo-200"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {page}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t("下一页")}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function PersonLoadPanel({
  loads,
  className,
  onManage,
  onSelectPerson,
}: {
  loads: PersonLoad[];
  className?: string;
  onManage?: () => void;
  onSelectPerson?: (person: PersonLoad) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(loads.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const shownLoads = loads.slice((safePage - 1) * pageSize, safePage * pageSize);
  const onLeaveCount = loads.filter((l) => l.onLeave).length;
  const heavy = loads.filter((l) => l.count / l.max >= 0.8).length;

  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className={cn(
        "rd-board-surface flex h-full min-h-[410px] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)]",
        className,
      )}
      data-surface="people"
    >
      <header className="rd-board-panel-head flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-white via-white to-slate-50/70 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{t("人员负载")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("活跃任务分布")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="flex items-baseline gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-xs shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
            {heavy > 0 && (
              <span className="text-red-600">
                <span className="font-semibold tabular-nums">{heavy}</span> {t("高负载")}
              </span>
            )}
            {onLeaveCount > 0 && (
              <span className="text-amber-600">
                <span className="font-semibold tabular-nums">{onLeaveCount}</span> {t("请假")}
              </span>
            )}
          </div>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="rd-board-secondary-control group inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-[0_6px_14px_rgba(15,23,42,0.06)] active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              title={t("进入人员管理")}
            >
              <UserPlus className="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-slate-700" />
              <span>{t("人员管理")}</span>
              <ChevronRight className="h-3 w-3 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </header>

      <ul className="flex-1 space-y-1.5 overflow-hidden px-5 py-3 sm:px-6">
        {shownLoads.length === 0 ? (
          <li className="py-6 text-center text-sm text-slate-400">{t("暂无负载数据")}</li>
        ) : (
          shownLoads.map((p) => {
            const ratio = p.count / p.max;
            const tone =
              ratio >= 1
                ? "bg-red-500"
                : ratio >= 0.8
                  ? "bg-orange-500"
                  : ratio >= 0.6
                    ? "bg-amber-400"
                    : "bg-emerald-400";
            return (
              <li
                key={p.key}
                onClick={() => onSelectPerson?.(p)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPerson?.(p);
                  }
                }}
                role="button"
                tabIndex={0}
                className="rd-board-data-row flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition-all hover:border-slate-100 hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <OwnerAvatar name={p.name} userId={p.user_id} size="xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
                    {p.onLeave && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        {t("请假")}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-slate-500">
                      {p.count}
                      <span className="text-slate-300"> / {p.max}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full transition-all", tone, p.onLeave && "opacity-50")}
                      style={{ width: `${Math.min(100, ratio * 100)}%` }}
                    />
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              </li>
            );
          })
        )}
      </ul>

      {loads.length > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-2.5">
          <span className="text-[11px] tabular-nums text-slate-400">
            {(safePage - 1) * pageSize + 1}
            {" - "}
            {Math.min(safePage * pageSize, loads.length)}
            <span className="mx-1 text-slate-300">/</span>
            {loads.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t("上一页")}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {Array.from({ length: totalPages }).map((_, i) => {
              const page = i + 1;
              const active = page === safePage;
              return (
                <button
                  key={page}
                  type="button"
                  onClick={() => setPage(page)}
                  className={cn(
                    "h-7 min-w-7 cursor-pointer rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-all duration-150 active:scale-90",
                    active
                      ? "bg-indigo-50 text-indigo-700 shadow-[0_6px_14px_rgba(79,70,229,0.08)] ring-1 ring-indigo-200"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {page}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t("下一页")}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

/**
 * 人员抽屉是「摘要」面：只列主责任务，与头像角标严格同口径。
 * 协助任务不在这里铺开（那是成员页签里可展开的协助段），但必须露出数量，
 * 否则领导会以为这个人只有这些活。
 */
function PersonDetailDrawer({
  name,
  profile,
  load,
  tasks,
  collaboratingCount = 0,
  onClose,
  onOpenTask,
}: {
  name: string;
  profile?: PersonProfile;
  load?: PersonLoad;
  tasks: Task[];
  collaboratingCount?: number;
  onClose: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const activeTasks = tasks.filter((task) => !task.archived && task.status !== "completed");
  const maxTasks = profile?.max_tasks ?? load?.max ?? 8;
  const count = load?.count ?? activeTasks.length;
  const ratio = maxTasks > 0 ? Math.min(100, Math.round((count / maxTasks) * 100)) : 0;
  const statusLabel = profile?.status === "on_leave" || load?.onLeave ? "请假中" : profile?.status === "resigned" ? "已离职" : "在岗";
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <motion.div
      className="rd-task-overlay rd-task-overlay-drawer fixed inset-0 z-50 flex justify-end bg-slate-900/25 backdrop-blur-sm"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
      role="dialog"
      aria-modal="true"
      aria-label={t("人员任务详情")}
    >
      {/* 点击面板外空白处关闭（人员详情为只读，无需脏检查） */}
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <motion.div
        className="rd-task-overlay-surface relative z-10 flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:w-[min(620px,92vw)]"
        initial={shouldReduceMotion ? false : { opacity: 0, x: 36 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 28 }}
        transition={RD_PANEL_TRANSITION}
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <OwnerAvatar name={name} userId={profile?.user_id} />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-slate-900">{name}</h3>
              <p className="mt-0.5 text-pretty text-xs text-slate-500">
                {profile?.position ?? (productionWorkspace ? t("生产成员") : t("研发成员"))} · {profile?.department ?? t("未设置部门")}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("关闭人员任务详情")} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{count}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{t("当前负载")}</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums text-indigo-600">{maxTasks}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{t("容量上限")}</div>
              </div>
              <div>
                <div className={cn("text-2xl font-semibold", statusLabel === "在岗" ? "text-emerald-600" : "text-amber-600")}>{t(statusLabel)}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{t("人员状态")}</div>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
              <div
                className={cn("h-full rounded-full", ratio >= 100 ? "bg-red-500" : ratio >= 80 ? "bg-orange-500" : "bg-emerald-400")}
                style={{ width: `${ratio}%` }}
              />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-100 bg-white p-3">
              <div className="text-[11px] text-slate-400">{t("邮箱")}</div>
              <div className="mt-1 truncate font-medium text-slate-700">{profile?.email ?? "-"}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-white p-3">
              <div className="text-[11px] text-slate-400">{t("电话")}</div>
              <div className="mt-1 font-medium text-slate-700">{profile?.phone ?? "-"}</div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              {/* 此处只列主责，与头像角标同口径；协助任务在成员页签里可展开查看 */}
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("主责任务")}</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{t("{count} 项", { count: tasks.length })}</span>
            </div>
            {collaboratingCount > 0 && (
              <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {t("另协助 {count} 个任务（在成员页签的「协助」分段中查看）", { count: collaboratingCount })}
              </div>
            )}
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center text-sm text-slate-400">{t("暂无主责任务")}</div>
            ) : (
              <ul className="space-y-2">
                {tasks.slice(0, 12).map((task) => (
                  <li key={task.task_id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all hover:border-indigo-100 hover:bg-indigo-50/40"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", taskAccentClass(task))} />
                      <div className="min-w-0 flex-1">
                        <AutoTranslatedText as="div" text={task.title} className="truncate text-sm font-medium text-slate-800" />
                        <div className="mt-0.5 text-[11px] text-slate-400">{task.task_id} · {task.progress}%</div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SystemHealthCard({
  stat,
  onClick,
  horizonVariant = false,
}: {
  stat: CatStat;
  onClick?: () => void;
  horizonVariant?: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  const theme = getTheme(stat.cat.id);
  const health = getSystemHealth(stat);
  const hConfig = HEALTH_CONFIG[health];
  const isIdle = health === "idle";
  const reserved = isReservedBomSystem(stat.cat.id);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      className={cn(
        "rd-horizon-system-card group relative flex min-h-11 flex-col gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left transition-[border-color,box-shadow,opacity] duration-300 ease-out active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 focus-visible:ring-offset-2",
        !horizonVariant && "hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]",
        hConfig.border,
        isIdle && "opacity-55 hover:opacity-100",
      )}
    >
      {/* Top accent stripe — colored by health */}
      <span
        className={cn(
          "rd-horizon-system-accent absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100",
          hConfig.dot,
        )}
      />

      {/* 徽章必须 shrink-0：只有标题带 flex-1 min-w-0，不锁住徽章的话挤压会全压到标题上，
          实测 1024 下标题被压到 34px，同时挂「预留」+ 健康度两个徽章时直接压成 0（名字完全看不见）。
          标题再给一个最小宽度保底，宁可徽章换行也不让名字消失。 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <theme.Icon className={cn("h-4 w-4 shrink-0 transition-colors", theme.iconColor)} />
        <AutoTranslatedText
          as="span"
          className="min-w-[4.5rem] flex-1 truncate text-sm font-semibold text-slate-900"
          text={t(stat.cat.label.trim())}
        />
        {reserved && (
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            {t("预留")}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
                health === "alert" && "bg-red-50 text-red-700",
                health === "watch" && "bg-amber-50 text-amber-700",
                health === "healthy" && "bg-emerald-50 text-emerald-700",
                health === "idle" && "bg-slate-100 text-slate-500",
              )}
            >
              <span className={cn("h-1 w-1 rounded-full", hConfig.dot)} />
              {t(hConfig.label)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="text-xs">
              <div className="font-semibold">{t(hConfig.label)}</div>
              <div className="opacity-70">
                {t("完成")} {stat.progress}% · {t("风险")} {stat.risks} · {t("阻塞")} {stat.blocked}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-baseline justify-between">
        <span
          className={cn(
            "text-3xl font-semibold tabular-nums",
            isIdle ? "text-slate-400" : "text-slate-900",
          )}
        >
          {stat.progress}
          <span className="text-base font-medium text-slate-400">%</span>
        </span>
        {stat.risks > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600">
                <AlertTriangle className="h-3 w-3" />
                {stat.risks}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <RiskListTooltip
                title={t("{name} · {count} 个风险任务", { name: t(stat.cat.label.trim()), count: stat.risks })}
                risks={stat.riskItems}
              />
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            isIdle ? "bg-slate-200" : hConfig.dot,
          )}
          initial={shouldReduceMotion ? false : { width: 0 }}
          animate={{ width: `${Math.max(stat.progress, isIdle ? 0 : 2)}%` }}
          transition={shouldReduceMotion ? { duration: 0 } : { ...RD_PANEL_TRANSITION, delay: 0.08 }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">
          <span
            className={cn(
              "font-semibold tabular-nums",
              isIdle ? "text-slate-400" : "text-slate-800",
            )}
          >
            {stat.total}
          </span>{" "}
          {t("任务")}
        </span>
        <span className="text-slate-400">
          <span className="font-semibold tabular-nums text-slate-500">{stat.cat.children.length}</span> {t("部件")}
        </span>
        {stat.inProgress > 0 && (
          <span className="text-slate-500">
            <span className="rd-horizon-brand-text font-semibold tabular-nums text-[#002fa7]">{stat.inProgress}</span> {t("进行中")}
          </span>
        )}
        {stat.total === 0 && <span className="text-slate-400">{t("无活跃")}</span>}
      </div>

      {/* Hover hint */}
      <div className="pointer-events-none flex items-center justify-end text-[11px] font-medium text-slate-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {t("进入详情")}
        <ChevronRight className="rd-horizon-system-arrow ml-0.5 h-3 w-3" />
      </div>
    </motion.button>
  );
}

// ─── Product status constants ─────────────────────────────────────────────────

const PRODUCT_STATUS_LABEL: Record<RdProductStatus, string> = {
  active: "活跃",
  developing: "研发中",
  paused: "暂停",
  archived: "归档",
};

const PRODUCT_STATUS_STYLE: Record<RdProductStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-100",
  developing: "bg-blue-50 text-[#002fa7] border-blue-100",
  paused: "bg-amber-50 text-amber-700 border-amber-100",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
};

const PRODUCT_STATUS_DOT: Record<RdProductStatus, string> = {
  active: "bg-emerald-500",
  developing: "bg-[#002fa7]",
  paused: "bg-amber-500",
  archived: "bg-slate-400",
};

// ─── SystemPanorama ───────────────────────────────────────────────────────────

/** prod-portable-o2 的任务数据存在主 rd.taskCategories 里，直接用全局 catStats */
const MAIN_PRODUCT_ID = "prod-portable-o2";

function SystemPanorama({
  mainCatStats,
  products,
  onSelectSystem,
  onManageProducts,
  canManage,
  reloadToken = 0,
  horizonVariant = false,
}: {
  mainCatStats: CatStat[];          // 便携式制氧机的全局 catStats
  products: ProductDef[];
  onSelectSystem: (catId: string, productId: string) => void; // 进入该产品的完整驾驶舱
  onManageProducts: () => void;
  canManage: boolean;
  reloadToken?: number;             // 跨产品移动后 +1，强制刷新受影响产品的统计
  horizonVariant?: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [activeProdId, setActiveProdId] = useState(() => products[0]?.id ?? "");

  // 缓存其他产品的已加载分类数据 { productId → CatStat[] }
  const [productCatStatsCache, setProductCatStatsCache] = useState<Record<string, CatStat[]>>({});
  const [loadingProdId, setLoadingProdId] = useState<string | null>(null);
  const [productLoadErrorId, setProductLoadErrorId] = useState<string | null>(null);
  const [productReloadNonce, setProductReloadNonce] = useState(0);
  // 记录每个产品最近一次加载时的 reloadToken，token 变化即视为缓存失效
  const loadedTokenRef = useRef<Record<string, number>>({});

  const activeProd = useMemo(
    () => products.find((product) => product.id === activeProdId) ?? products[0] ?? null,
    [activeProdId, products],
  );

  // 产品列表异步到达或当前产品被移除时，自动落到首个真实产品；否则 activeProdId
  // 仍为空会让首个产品看似选中、统计却取到空缓存，必须等用户再点一次才显示。
  useEffect(() => {
    if (products.length === 0) return;
    if (!products.some((product) => product.id === activeProdId)) {
      setActiveProdId(products[0].id);
    }
  }, [activeProdId, products]);

  // 当切换到非主产品（或移动后 token 变化）时，按需加载该产品的分类数据
  useEffect(() => {
    if (!activeProdId || activeProdId === MAIN_PRODUCT_ID) return;
    if (loadedTokenRef.current[activeProdId] === reloadToken) return; // 已按当前 token 缓存
    let cancelled = false;
    setLoadingProdId(activeProdId);
    setProductLoadErrorId((current) => current === activeProdId ? null : current);
    fetchProductTaskCategories(activeProdId)
      .then((cats) => {
        if (cancelled) return;
        const risks = computeRisks(cats);
        const stats = buildCatStats(cats, risks);
        loadedTokenRef.current[activeProdId] = reloadToken;
        setProductCatStatsCache((prev) => ({ ...prev, [activeProdId]: stats }));
      })
      .catch(() => {
        if (cancelled) return;
        loadedTokenRef.current[activeProdId] = reloadToken;
        setProductCatStatsCache((prev) => ({ ...prev, [activeProdId]: [] }));
        setProductLoadErrorId(activeProdId);
      })
      .finally(() => {
        if (!cancelled) setLoadingProdId((current) => current === activeProdId ? null : current);
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProdId, productReloadNonce, reloadToken]);

  // 当前产品对应的 catStats
  const activeCatStats: CatStat[] =
    activeProdId === MAIN_PRODUCT_ID
      ? mainCatStats
      : (productCatStatsCache[activeProdId] ?? []);

  const isLoadingActive = loadingProdId === activeProdId;

  // 健康图例计数单次遍历生成，避免每次渲染对相同数组重复筛选四遍。
  const healthCounts = useMemo(() => {
    const counts: Record<SystemHealth, number> = { healthy: 0, watch: 0, alert: 0, idle: 0 };
    for (const stat of activeCatStats) counts[getSystemHealth(stat)] += 1;
    return counts;
  }, [activeCatStats]);
  const activeProductLoadFailed = productLoadErrorId === activeProdId;

  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rd-horizon-panorama rounded-xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]"
    >
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-balance text-sm font-semibold text-slate-950">{t("子系统全景")}</h3>
          <p className="mt-0.5 text-pretty text-xs text-slate-500">
            {activeProd ? (
              <>
                <AutoTranslatedText text={t(activeProd.name.trim())} /> · {t("{count} 个子系统", { count: activeCatStats.length })}
              </>
            ) : t("当前研发分类树 · {count} 个子系统", { count: mainCatStats.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Health legend */}
          {activeCatStats.length > 0 && !isLoadingActive && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {(["healthy", "watch", "alert", "idle"] as const).map((h) => {
                const count = healthCounts[h];
                const cfg = HEALTH_CONFIG[h];
                return (
                  <span key={h} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                    {t(cfg.label)}
                    <span className={cn("font-semibold tabular-nums", cfg.text)}>{count}</span>
                  </span>
                );
              })}
            </div>
          )}
          {/* Manage button */}
          {canManage && (
            <button
              type="button"
              onClick={onManageProducts}
              className="rd-horizon-secondary-control flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t("管理产品")}
            </button>
          )}
        </div>
      </header>

      {/* Product tabs */}
      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
          <Settings2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">{t("暂无产品线")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("请点击“管理产品”添加产品线和子系统")}</p>
        </div>
      ) : (
        <>
          {/* Tab strip */}
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-100 pb-0">
            {products.map((prod) => {
              const isActive = prod.id === activeProd?.id;
              const pStatus: RdProductStatus = prod.status ?? "developing";
              const dot = PRODUCT_STATUS_DOT[pStatus];
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setActiveProdId(prod.id)}
                  data-active={isActive}
                  aria-pressed={isActive}
                  className={cn(
                    "rd-horizon-product-tab flex min-h-11 shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                    isActive
                      ? "border-b-2 border-[#002fa7] text-[#002fa7]"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                  )}
                >
                  <span className={cn("rd-horizon-product-status-dot h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                  <AutoTranslatedText text={t(prod.name.trim())} />
                </button>
              );
            })}
          </div>

          {/* Loading state */}
          {isLoadingActive ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("加载中…")}
            </div>
          ) : activeProd && activeCatStats.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {activeCatStats.map((stat) => (
                <SystemHealthCard
                  key={stat.cat.id}
                  stat={stat}
                  onClick={() => onSelectSystem(stat.cat.id, activeProdId)}
                  horizonVariant={horizonVariant}
                />
              ))}
            </div>
          ) : activeProd ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center" role={activeProductLoadFailed ? "alert" : "status"}>
              <Settings2 className="h-7 w-7 text-slate-300" aria-hidden="true" />
              <h4 className="mt-3 text-balance text-sm font-semibold text-slate-800">
                {activeProductLoadFailed ? t("子系统数据加载失败") : t("当前产品暂无子系统")}
              </h4>
              <p className="mt-1 max-w-md text-pretty text-xs leading-5 text-slate-500">
                {activeProductLoadFailed
                  ? t("请重新读取该产品的任务树，其他产品数据不受影响。")
                  : t("可通过产品管理补充子系统，或切换到其他产品继续查看。")}
              </p>
              {activeProductLoadFailed && (
                <button
                  type="button"
                  onClick={() => {
                    delete loadedTokenRef.current[activeProdId];
                    setProductReloadNonce((value) => value + 1);
                  }}
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-[#002fa7] transition-colors hover:bg-blue-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("重新读取")}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </motion.section>
  );
}

// ─── DETAIL VIEW components (board mode) ─────────────────────────────────────

/** 驾驶舱范围内的活跃根任务；子任务只在父任务详情中展开。 */
function collectRootActiveTasks(scope: Category | SubProject | null): Task[] {
  if (!scope) return [];
  const tasks = "children" in scope ? rootTasksFromCategories([scope]) : [...scope.tasks];
  return tasks.filter((task) => !isArchivedTask(task));
}

/** Compact hero with status distribution bar */
function SystemDetailHero({
  category,
  sub,
  totalActive,
  rate,
  riskCount,
  criticalCount,
  blockedCount,
}: {
  category: Category | null;
  sub: SubProject | null;
  totalActive: number;
  rate: number;
  riskCount: number;
  criticalCount: number;
  blockedCount: number;
}) {
  if (!category) return null;
  const theme = getTheme(category.id);
  const label = sub ? sub.label : category.label;
  const breadcrumbAbove = sub ? category.label : null;

  // Status distribution
  const scope: Category | SubProject = sub ?? category;
  const allTasks = collectRootActiveTasks(scope);
  const total = allTasks.length;
  const statusBreakdown: { key: TaskStatus; label: string; count: number; color: string }[] = [
    {
      key: "completed",
      label: "已完成",
      count: allTasks.filter((t) => t.status === "completed").length,
      color: "bg-emerald-400",
    },
    {
      key: "in_progress",
      label: "进行中",
      count: allTasks.filter((t) => t.status === "in_progress").length,
      color: "bg-indigo-400",
    },
    {
      key: "paused_blocked",
      label: "阻塞",
      count: allTasks.filter((t) => t.status === "paused_blocked").length,
      color: "bg-orange-400",
    },
    {
      key: "paused_leave",
      label: "请假",
      count: allTasks.filter((t) => t.status === "paused_leave").length,
      color: "bg-amber-400",
    },
    {
      key: "pending_assign",
      label: "待指派",
      count: allTasks.filter((t) => t.status === "pending_assign").length,
      color: "bg-violet-400",
    },
    {
      key: "draft",
      label: "草稿",
      count: allTasks.filter((t) => t.status === "draft").length,
      color: "bg-slate-300",
    },
  ];

  return (
    <section className="rd-board-surface rd-board-system-hero rounded-xl border border-slate-100 bg-white px-6 py-5" data-surface="hero">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          {breadcrumbAbove && (
            <div className="mb-1 text-xs font-medium text-slate-400">{breadcrumbAbove}</div>
          )}
          <div className="flex items-center gap-2.5">
            <theme.Icon className={cn("rd-board-system-icon h-5 w-5", theme.iconColor)} />
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{label}</h2>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {sub ? t("部件维度") : t("子系统维度")} · {t("今日")} {todayStr()}
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
          <Metric label={t("活跃任务")} value={totalActive} />
          <Metric label={t("完成率")} value={`${rate}%`} />
          <Metric label={t("风险")} value={riskCount} tone={riskCount > 0 ? "text-red-600" : undefined} />
          {criticalCount > 0 && <Metric label={t("紧急")} value={criticalCount} tone="text-red-600" />}
          {blockedCount > 0 && <Metric label={t("阻塞")} value={blockedCount} tone="text-orange-600" />}
        </div>
      </div>

      {/* Status distribution */}
      {total > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">{t("状态分布")}</span>
            <span className="text-slate-400">{t("共 {count} 项", { count: total })}</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            {statusBreakdown.map(
              (s) =>
                s.count > 0 && (
                  <Tooltip key={s.key}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn("h-full transition-opacity hover:opacity-80", s.color)}
                        style={{ width: `${(s.count / total) * 100}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <span className="text-xs">
                        {t(s.label)} · <span className="font-semibold tabular-nums">{s.count}</span> {t("项")} ·{" "}
                        {Math.round((s.count / total) * 100)}%
                      </span>
                    </TooltipContent>
                  </Tooltip>
                ),
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
            {statusBreakdown
              .filter((s) => s.count > 0)
              .map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
                  <span className="text-slate-600">{t(s.label)}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{s.count}</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Upcoming milestones strip — next 30 days grouped by week */
function UpcomingMilestonesSection({
  scope,
  tasks,
  onOpen,
}: {
  scope: Category | SubProject | null;
  tasks?: Task[];
  onOpen: (t: Task) => void;
}) {
  const [windowFilter, setWindowFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const allTasks = tasks ?? collectRootActiveTasks(scope);
  const upcoming = allTasks
    .filter((t) => t.due_date && t.status !== "completed")
    // 按时提交、正待审核的任务不算"逾期/即将到期"，不进时间线（方案B）
    .filter((t) => !(t.status === "pending_review" && !isTaskOverdue(t)))
    .map((t) => ({ task: t, dleft: daysUntil(t.due_date)! }))
    .filter((it) => it.dleft >= -7 && it.dleft <= 30) // include 1 week overdue too
    .sort((a, b) => a.dleft - b.dleft);

  useEffect(() => {
    setPage(1);
  }, [windowFilter, upcoming.length]);

  if (!scope && !tasks) return null;
  if (upcoming.length === 0) return null;

  const buckets: {
    key: string;
    label: string;
    range: [number, number];
    tone: string;
    dot: string;
  }[] = [
    { key: "overdue", label: "已逾期", range: [-Infinity, -1], tone: "text-red-600", dot: "bg-red-500" },
    { key: "today", label: "今日", range: [0, 0], tone: "text-orange-600", dot: "bg-orange-500" },
    { key: "next-3", label: "3 天内", range: [1, 3], tone: "text-amber-600", dot: "bg-amber-500" },
    { key: "this-week", label: "本周", range: [4, 7], tone: "text-indigo-600", dot: "bg-indigo-500" },
    { key: "next-week", label: "下周", range: [8, 14], tone: "text-slate-600", dot: "bg-slate-400" },
    { key: "later", label: "15-30 天", range: [15, 30], tone: "text-slate-500", dot: "bg-slate-300" },
  ];

  const grouped = buckets
    .map((b) => ({
      ...b,
      items: upcoming.filter((it) => it.dleft >= b.range[0] && it.dleft <= b.range[1]),
    }));
  const activeBucket = grouped.find((bucket) => bucket.key === windowFilter);
  const filteredItems = windowFilter === "all" ? upcoming : activeBucket?.items ?? [];
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const within7 = upcoming.filter((it) => it.dleft >= 0 && it.dleft <= 7).length;
  const overdue = upcoming.filter((it) => it.dleft < 0).length;
  const activeWindowLabel = windowFilter === "all" ? t("全部窗口") : t(activeBucket?.label ?? "全部窗口");

  return (
    <section className="rd-board-surface rd-board-milestones overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]" data-surface="milestone">
      <header className="rd-board-panel-head flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t("里程碑预报")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("未来 30 天 · {total} 个截止日 · {within} 个 7 天内到期", { total: upcoming.length, within: within7 })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {overdue > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600">
              {t("逾期")} {overdue}
            </span>
          )}
          <span className="rounded-full bg-slate-50 px-2 py-0.5 font-medium text-slate-500 ring-1 ring-slate-200">
            {t("点击任务查看详情")}
          </span>
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t("时间窗口")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={() => setWindowFilter("all")}
              data-active={windowFilter === "all"}
              className={cn(
                "rd-board-filter-chip flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 active:scale-[0.99]",
                windowFilter === "all"
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_8px_18px_rgba(79,70,229,0.10)]"
                  : "border-slate-200 bg-white hover:border-indigo-100 hover:bg-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.035)]",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", windowFilter === "all" ? "bg-indigo-500" : "bg-slate-400")} />
                <span className="truncate text-xs font-semibold">{t("全部窗口")}</span>
              </span>
              <span className="text-xs font-semibold tabular-nums">{upcoming.length}</span>
            </button>
            {grouped.map((b) => {
              const active = b.items.length > 0;
              const selected = windowFilter === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => {
                    if (active) setWindowFilter(b.key);
                  }}
                  disabled={!active}
                  data-active={selected}
                  className={cn(
                    "rd-board-filter-chip flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 active:scale-[0.99]",
                    selected
                      ? "border-indigo-200 bg-indigo-50 shadow-[0_8px_18px_rgba(79,70,229,0.10)]"
                      : active
                        ? "cursor-pointer border-slate-200 bg-white hover:border-indigo-100 hover:bg-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.035)]"
                        : "cursor-not-allowed border-slate-100 bg-white/55",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", b.dot, !active && "opacity-30")} />
                    <span className={cn("truncate text-xs font-medium", selected ? "text-indigo-700" : active ? b.tone : "text-slate-400")}>{t(b.label)}</span>
                  </span>
                  <span className={cn("text-xs font-semibold tabular-nums", selected ? "text-indigo-700" : active ? "text-slate-900" : "text-slate-300")}>
                    {b.items.length}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-500">
              {t("当前筛选：")}<span className="font-semibold text-slate-800">{activeWindowLabel}</span>
              <span className="mx-1 text-slate-300">·</span>
              <span className="font-semibold tabular-nums text-slate-800">{filteredItems.length}</span> {t("项")}
            </div>
            <div className="text-xs tabular-nums text-slate-400">
              {filteredItems.length === 0 ? "0 / 0" : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filteredItems.length)} / ${filteredItems.length}`}
            </div>
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {visibleItems.map(({ task, dleft }) => {
              const dayLabel =
                dleft < 0 ? t("逾期 {count}d", { count: -dleft }) : dleft === 0 ? t("今日") : t("{count}天后", { count: dleft });
              const bucket =
                grouped.find((b) => dleft >= b.range[0] && dleft <= b.range[1]) ?? grouped[grouped.length - 1];
              const path = splitCategoryPath(task.category_path).slice(0, 2).join(" / ");
              const progressTone =
                task.progress >= 80 ? "bg-emerald-500" : task.progress >= 50 ? "bg-indigo-500" : task.progress > 0 ? "bg-amber-500" : "bg-slate-300";
              return (
                <button
                  key={task.task_id}
                  type="button"
                  onClick={() => onOpen(task)}
                  className="rd-board-milestone-row group flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-left transition-all hover:border-indigo-100 hover:bg-indigo-50/30 hover:shadow-[0_8px_18px_rgba(15,23,42,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 active:scale-[0.995]"
                >
                  <span className={cn("mt-0.5 w-14 shrink-0 text-xs font-semibold tabular-nums", bucket?.tone ?? "text-slate-500")}>
                    {dayLabel}
                  </span>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", bucket?.dot ?? "bg-slate-300")} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-5 text-slate-800 group-hover:text-slate-950">
                      <AutoTranslatedText text={task.title} />
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                      {/* 协同池无分类概念，不显示路径段 */}
                      {!isUsCollabWorkspace() && (
                        <>
                          <span className="max-w-[180px] truncate text-slate-500">{path || t("未分类")}</span>
                          <span className="text-slate-300">·</span>
                        </>
                      )}
                      <span>{task.primary_owner}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono">{task.task_id}</span>
                    </span>
                    <span className="mt-2 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className={cn("block h-full rounded-full", progressTone)} style={{ width: `${Math.max(3, task.progress)}%` }} />
                      </span>
                      <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-slate-500">{task.progress}%</span>
                    </span>
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </button>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">
                {t("每页 10 条 · 第")} <span className="font-semibold tabular-nums text-slate-800">{safePage}</span> / {totalPages} {t("页")}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage <= 1}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all hover:bg-white hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("上一页")}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                {Array.from({ length: totalPages }).map((_, index) => {
                  const nextPage = index + 1;
                  const current = nextPage === safePage;
                  return (
                    <button
                      key={nextPage}
                      type="button"
                      onClick={() => setPage(nextPage)}
                      className={cn(
                        "h-7 min-w-7 cursor-pointer rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-all active:scale-90",
                        current ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" : "text-slate-500 hover:bg-white hover:text-slate-700",
                      )}
                      aria-current={current ? "page" : undefined}
                    >
                      {nextPage}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage >= totalPages}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all hover:bg-white hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("下一页")}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Tasks list grouped by part — reuses SubProjectSection for consistency */
function TasksByPartSection({
  category,
  sub,
  onOpen,
}: {
  category: Category | null;
  sub: SubProject | null;
  onOpen: (t: Task) => void;
}) {
  useI18n();
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [dueFilter, setDueFilter] = useState<TaskDueFilter>("all");
  if (!category) return null;
  // If a sub-project is explicitly selected, show only that one. Otherwise list all parts with tasks.
  const parts = sub ? [sub] : category.children.filter((c) => c.tasks.some((task) => !isArchivedTask(task)));
  if (parts.length === 0) return null;

  const totalCount = parts.reduce((s, p) => s + p.tasks.filter((task) => !isArchivedTask(task)).length, 0);
  const normalizedKeyword = keyword.trim();
  const filtersActive = Boolean(normalizedKeyword) || statusFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all";
  const filteredTotal = parts.reduce(
    (sum, part) => sum + part.tasks.filter((task) => taskMatches(task, normalizedKeyword, statusFilter, priorityFilter, dueFilter)).length,
    0,
  );

  return (
    <section className="rd-board-task-list space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t("全部任务清单")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {sub ? `${sub.label} · ` : <>{t("按部件分组 · {count} 个部件", { count: parts.length })} · </>}
            {filtersActive ? `${filteredTotal} / ${totalCount}` : totalCount} {t("个活跃任务")}
          </p>
        </div>
        <span className="text-xs text-slate-400">{t("点击展开部件 / 卡片查看子任务")}</span>
      </header>

      <div className="rd-board-task-filters grid gap-2 rounded-[8px] border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(150px,1fr)_auto_auto_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-9 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-50"
            placeholder={t("搜索任务、编号、负责人、路径")}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "all")}
        >
          <option value="all">{t("状态")}</option>
          {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((status) => (
            <option key={status} value={status}>{t(STATUS_CONFIG[status].label)}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as Priority | "all")}
        >
          <option value="all">{t("优先级")}</option>
          <option value="high">{t("高")}</option>
          <option value="medium">{t("中")}</option>
          <option value="low">{t("低")}</option>
        </NativeSelect>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
          value={dueFilter}
          onChange={(event) => setDueFilter(event.target.value as TaskDueFilter)}
        >
          <option value="all">{t("时间")}</option>
          <option value="overdue">{t("已逾期")}</option>
          <option value="today">{t("今天到期")}</option>
          <option value="3d">{t("3 天内")}</option>
          <option value="7d">{t("7 天内")}</option>
          <option value="no_due">{t("无截止日")}</option>
        </NativeSelect>
        <button
          type="button"
          onClick={() => {
            setKeyword("");
            setStatusFilter("all");
            setPriorityFilter("all");
            setDueFilter("all");
          }}
          disabled={!filtersActive}
          className="h-9 cursor-pointer rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("清空")}
        </button>
      </div>

      <div className="space-y-3">
        {parts.map((part) => (
          <SubProjectSection
            key={part.id}
            sub={part}
            categoryLabel={category.label}
            keyword={normalizedKeyword}
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            dueFilter={dueFilter}
            onOpen={onOpen}
          />
        ))}
        {filteredTotal === 0 && filtersActive && (
          <div className="rounded-[8px] border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
            {t("当前筛选条件下暂无任务")}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className={cn("text-2xl font-semibold tabular-nums tracking-tight text-slate-900", tone)}>
        {value}
      </span>
      <span className="mt-0.5 text-xs text-slate-500">{label}</span>
    </div>
  );
}

/** Grid of sub-projects (parts) under a selected system */
function PartHealthGrid({
  category,
  selectedSubId,
  onSelectSub,
}: {
  category: Category;
  selectedSubId: string | null;
  onSelectSub: (subId: string) => void;
}) {
  const parts = category.children.map((sub) => {
    const tasks = sub.tasks;
    const active = tasks.filter((task) => !isArchivedTask(task)).length;
    const progress = calcSubProgress(sub);
    const riskTasks = tasks.filter((t) => taskNeedsAttention(t)).length;
    const blocked = tasks.filter(
      (t) => t.status === "paused_blocked" || t.status === "pending_assign",
    ).length;
    return { sub, active, progress, risks: riskTasks, blocked };
  });

  return (
    <section className="rd-board-surface rd-board-part-health rounded-xl border border-slate-100 bg-white p-5" data-surface="health">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t("部件健康")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {category.label} · {t("{count} 个部件", { count: parts.length })} · {t("点击切换聚焦范围")}
          </p>
        </div>
        <span className="text-xs text-slate-400">{t("按风险数排序")}</span>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {parts
          .sort((a, b) => b.risks - a.risks || b.active - a.active)
          .map(({ sub, active, progress, risks, blocked }) => {
            const isSelected = selectedSubId === sub.id;
            const isIdle = active === 0;
            const tone: "alert" | "watch" | "healthy" | "idle" = isIdle
              ? "idle"
              : risks >= 2 || blocked >= 2
                ? "alert"
                : risks >= 1 || progress < 40
                  ? "watch"
                  : "healthy";
            const config = HEALTH_CONFIG[tone];
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onSelectSub(sub.id)}
                data-active={isSelected}
                className={cn(
                  "rd-board-part-card group flex flex-col gap-2 rounded-lg border bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]",
                  config.border,
                  isSelected && "ring-2 ring-slate-900 ring-offset-1",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                    {isDefaultSubProject(sub) ? category.label : sub.label}
                  </span>
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dot)}
                    title={t(config.label)}
                  />
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                    {progress}
                    <span className="text-sm font-medium text-slate-400">%</span>
                  </span>
                  {risks > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-red-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {risks}
                    </span>
                  )}
                </div>

                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full", isIdle ? "bg-slate-200" : config.dot)}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    <span className="font-semibold tabular-nums text-slate-700">{active}</span> {t("活跃")}
                  </span>
                  {isIdle && <span className="text-slate-400">{t("空闲")}</span>}
                  {blocked > 0 && (
                    <span className="text-orange-600">
                      <span className="font-semibold tabular-nums">{blocked}</span> {t("阻塞")}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── PEOPLE MANAGEMENT (hidden sub-page, drill-down from dashboard) ─────────
// ═══════════════════════════════════════════════════════════════════════════

type PersonStatus = "active" | "on_leave" | "resigned";
type Person = {
  id: string;
  name: string;
  position: string;
  department: string;
  email?: string;
  phone?: string;
  status: PersonStatus;
  max_tasks: number;
  joined_at?: string;
};

const INITIAL_PEOPLE: Person[] = [
  { id: "p1", name: "王磊", position: "硬件测试工程师", department: "硬件组", email: "wanglei@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-03-12" },
  { id: "p2", name: "陈静", position: "质检员", department: "质量组", email: "chenjing@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-06-01" },
  { id: "p3", name: "李静", position: "法规工程师", department: "法规组", email: "lijing@inogi.com", status: "on_leave", max_tasks: 8, joined_at: "2023-11-20" },
  { id: "p4", name: "张越", position: "嵌入式工程师", department: "软件组", email: "zhangyue@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-08-15" },
  { id: "p5", name: "赵强", position: "工艺工程师", department: "工艺组", email: "zhaoqiang@inogi.com", status: "active", max_tasks: 8, joined_at: "2023-09-08" },
  { id: "p6", name: "刘华", position: "项目工程师", department: "项目组", email: "liuhua@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-01-10" },
  { id: "p7", name: "李明", position: "嵌入式工程师", department: "软件组", email: "liming@inogi.com", status: "active", max_tasks: 8, joined_at: "2024-05-22" },
];

const PERSON_STATUS_CONFIG: Record<PersonStatus, { label: string; dot: string; text: string; bg: string }> = {
  active: { label: "在岗", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  on_leave: { label: "请假中", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  resigned: { label: "已离职", dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-100" },
};

const DEPARTMENTS = ["硬件组", "软件组", "质量组", "项目组", "工艺组", "法规组", "其他"];

function emptyPerson(): Person {
  return {
    id: "",
    name: "",
    position: "",
    department: "硬件组",
    email: "",
    phone: "",
    status: "active",
    max_tasks: 8,
  };
}

/** Form modal for creating / editing a person */
function PersonFormModal({
  person,
  onSave,
  onClose,
}: {
  person: Person | null;
  onSave: (p: Person) => void;
  onClose: () => void;
}) {
  const isEdit = person !== null;
  const [form, setForm] = useState<Person>(person ?? emptyPerson());
  const [errors, setErrors] = useState<{ name?: string; position?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!form.name.trim()) newErrors.name = t("姓名不能为空");
    if (!form.position.trim()) newErrors.position = t("职位不能为空");
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSave(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {isEdit ? t("编辑成员") : t("新增成员")}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEdit ? t("修改 {name} 的信息", { name: person!.name }) : t("创建一个新的团队成员")}
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("姓名")} required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100",
                  errors.name ? "border-red-300" : "border-slate-200",
                )}
                placeholder={t("例: 王磊")}
                autoFocus
              />
            </Field>
            <Field label={t("职位")} required error={errors.position}>
              <Input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100",
                  errors.position ? "border-red-300" : "border-slate-200",
                )}
                placeholder={t("硬件测试工程师")}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("所属部门")}>
              <NativeSelect
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("状态")}>
              <NativeSelect
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PersonStatus }))}
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="active">{t("在岗")}</option>
                <option value="on_leave">{t("请假中")}</option>
                <option value="resigned">{t("已离职")}</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label={t("邮箱")}>
            <Input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="user@inogi.com"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("联系电话")}>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                placeholder="13800000000"
              />
            </Field>
            <Field label={t("任务上限")}>
              <Input
                type="number"
                min={1}
                max={20}
                value={form.max_tasks}
                onChange={(e) => setForm((f) => ({ ...f, max_tasks: Math.max(1, Number(e.target.value) || 1) }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </Field>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
            >
              {t("取消")}
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all duration-150 hover:bg-slate-800 active:scale-[0.98]"
            >
              {isEdit ? t("保存修改") : t("创建成员")}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-1 text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {error && <span className="ml-auto text-[11px] font-normal text-red-500">{error}</span>}
      </div>
      {children}
    </label>
  );
}

/** Delete confirmation dialog */
function ConfirmDeleteDialog({
  person,
  onConfirm,
  onCancel,
}: {
  person: Person;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
      >
        <div className="px-6 pt-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">{t("删除 {name}?", { name: person.name })}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            {t("此操作将永久删除该成员的档案，关联任务将转为待指派状态。删除后无法撤销。")}
          </p>
        </div>
        <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.25)] transition-all duration-150 hover:bg-red-700 active:scale-[0.98]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("确认删除")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** People management page — full CRUD, hidden from main nav */
function PeopleManagementPage({ onBack }: { onBack: () => void }) {
  const shouldReduceMotion = useReducedMotion();
  const [people, setPeople] = useState<Person[]>(INITIAL_PEOPLE);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<PersonStatus | "all">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (deptFilter !== "all" && p.department !== deptFilter) return false;
      if (!keyword) return true;
      const k = keyword.toLowerCase();
      return (
        p.name.toLowerCase().includes(k) ||
        p.position.toLowerCase().includes(k) ||
        p.department.toLowerCase().includes(k) ||
        (p.email?.toLowerCase().includes(k) ?? false)
      );
    });
  }, [people, keyword, statusFilter, deptFilter]);

  const stats = useMemo(() => {
    return {
      total: people.length,
      active: people.filter((p) => p.status === "active").length,
      onLeave: people.filter((p) => p.status === "on_leave").length,
      resigned: people.filter((p) => p.status === "resigned").length,
      departments: new Set(people.map((p) => p.department)).size,
    };
  }, [people]);

  const handleSave = (p: Person) => {
    if (editing) {
      setPeople((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      setEditing(null);
    } else {
      const newPerson = { ...p, id: `p${Date.now()}` };
      setPeople((prev) => [...prev, newPerson]);
      setCreating(false);
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      setPeople((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={RD_FAST_TRANSITION}
      className="flex min-h-full flex-col overflow-hidden rounded-[8px] border border-slate-200/80 bg-[#f4f7fb] shadow-[0_24px_60px_rgba(15,23,42,0.08)]"
    >
      {/* Breadcrumb top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-5 py-2.5 animate-rd-fade-in">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.96]"
          >
            <ChevronLeft className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
            {t("返回总览")}
          </button>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-sm text-slate-500">{t("详情视图")}</span>
          <span className="text-xs text-slate-300">›</span>
          <span className="text-sm font-medium text-slate-800">{t("人员管理")}</span>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_12px_24px_rgba(15,23,42,0.22)] active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("新增成员")}
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-slate-50/40 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-5 rd-stagger-children">
          {/* Stats strip */}
          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
            <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-4">
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {stats.total}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("总成员数")}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-emerald-600">
                  {stats.active}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("在岗")}</div>
              </div>
              <div className="px-6 py-4">
                <div
                  className={cn(
                    "text-3xl font-semibold tabular-nums tracking-tight",
                    stats.onLeave > 0 ? "text-amber-600" : "text-slate-300",
                  )}
                >
                  {stats.onLeave}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("请假中")}</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {stats.departments}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">{t("所属部门")}</div>
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 transition-all focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("搜索姓名 / 职位 / 部门 / 邮箱…")}
                className="flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={t("清除搜索")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
              {(["all", "active", "on_leave", "resigned"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-95",
                    statusFilter === s
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                >
                  {s === "all" ? t("全部") : t(PERSON_STATUS_CONFIG[s].label)}
                </button>
              ))}
            </div>

            <NativeSelect
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">{t("全部部门")}</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>

            <span className="ml-auto text-xs tabular-nums text-slate-400">
              {t("共 {filtered} / {total} 人", { filtered: filtered.length, total: people.length })}
            </span>
          </section>

          {/* Table */}
          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-6 py-3 text-left">{t("成员")}</th>
                  <th className="px-4 py-3 text-left">{t("职位")}</th>
                  <th className="px-4 py-3 text-left">{t("部门")}</th>
                  <th className="px-4 py-3 text-left">{t("状态")}</th>
                  <th className="px-4 py-3 text-left">{t("入职日期")}</th>
                  <th className="px-4 py-3 text-right">{t("操作")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="text-sm font-medium text-slate-400">{t("没有匹配的成员")}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setKeyword("");
                          setStatusFilter("all");
                          setDeptFilter("all");
                        }}
                        className="mt-3 text-xs font-medium text-indigo-600 hover:underline"
                      >
                        {t("重置筛选")}
                      </button>
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const cfg = PERSON_STATUS_CONFIG[p.status];
                    return (
                      <tr
                        key={p.id}
                        className="group transition-colors duration-150 hover:bg-slate-50/60"
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <OwnerAvatar name={p.name} size="xs" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900">{p.name}</div>
                              {p.email && (
                                <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                  {p.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-slate-700">{p.position}</td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {p.department}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              cfg.bg,
                              cfg.text,
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                            {t(cfg.label)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs tabular-nums text-slate-500">
                          {p.joined_at ?? "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => setEditing(p)}
                              className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-indigo-50 hover:text-indigo-600 active:scale-90"
                              aria-label={t("编辑 {name}", { name: p.name })}
                              title={t("编辑")}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(p)}
                              className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-red-50 hover:text-red-600 active:scale-90"
                              aria-label={t("删除 {name}", { name: p.name })}
                              title={t("删除")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      {/* Modals */}
      {(editing || creating) && (
        <PersonFormModal
          person={editing}
          onSave={handleSave}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          person={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </motion.div>
  );
}

// ─── PersonTaskCockpit ────────────────────────────────────────────────────────
// 决策焦点：风险任务 + 人员负载合并为顶部 Tab 导航
// 负载环只使用单一状态色，避免渐变装饰干扰领导快速识别负载等级。
function loadRingColor(ratio: number, onLeave: boolean) {
  if (onLeave) return "#64748b"; // slate
  if (ratio >= 1) return "#dc2626"; // red
  if (ratio >= 0.8) return "#ea580c"; // orange
  if (ratio >= 0.6) return "#d97706"; // amber
  return "#059669"; // emerald
}

/** 返回成员页签标识（身份主键），不是姓名 —— 同名同事必须能分开选中。 */
function resolveActivityPersonTab(personLoads: PersonLoad[], actor?: TaskActivityActor | null) {
  if (!actor) return "all";
  const matchedById = actor.id
    ? personLoads.find((person) => person.user_id === actor.id)
    : undefined;
  if (matchedById) return matchedById.key;
  return personLoads.find((person) => person.name === actor.name)?.key ?? "all";
}

const TASK_PAGE_SIZE = 6; // 首批 6 个，后续滚动每批再加载 6 个
const MAX_ATTACHMENT_PREVIEW = 5;

// ─── Image lightbox (gallery preview) ─────────────────────────────────────────
function ImageGallery({
  images,
  startIndex,
  onClose,
}: {
  images: RdTaskProgressAttachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const prev = useCallback(() => setIdx((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % images.length), [images.length]);

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    const thumbnail = strip?.children[idx] as HTMLElement | undefined;
    if (!strip || !thumbnail) return;
    // Only move the thumbnail viewport; do not scroll the page behind the gallery.
    const left = thumbnail.offsetLeft;
    const right = left + thumbnail.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [idx]);

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    if (!strip) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft += event.deltaY * unit;
    };
    strip.addEventListener("wheel", handleWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleWheel);
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onClose]);

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/92 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("任务附件预览")}
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/20"
        aria-label={t("关闭附件预览")}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Counter */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur-sm">
        {idx + 1} / {images.length}
      </div>

      {/* Main image */}
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.15, ease: RD_MOTION_EASE }}
          className="h-[78vh] w-[82vw] max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <MobileZoomableImage
            src={getAttachmentUrl(images[idx])}
            alt={images[idx].name}
            className="h-full w-full"
            imageClassName="rounded-2xl shadow-2xl"
            controlsClassName={images.length > 1 ? "!bottom-20" : undefined}
            stopPropagation={false}
          />
        </motion.div>
      </AnimatePresence>

      {/* Prev / Next */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/25 active:scale-95"
            aria-label={t("上一张附件")}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:bg-white/25 active:scale-95"
            aria-label={t("下一张附件")}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div
          ref={thumbnailStripRef}
          className="rd-attachment-scroll rd-attachment-scroll-dark absolute bottom-5 flex w-max max-w-[calc(100%-2rem)] gap-2 overflow-x-auto overscroll-x-contain rounded-xl border border-white/15 bg-slate-900 px-2 pt-2 pb-3"
          aria-label={t("附件缩略图")}
          onClick={(event) => event.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
              aria-label={t("查看第 {index} 张附件：{name}", { index: i + 1, name: img.name })}
              aria-current={i === idx ? "true" : undefined}
              title={img.name}
              className={cn(
                "relative flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-16 sm:w-20",
                i === idx ? "border-white" : "border-white/20 opacity-60 hover:opacity-100",
              )}
            >
              <img src={getAttachmentThumbUrl(img)} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" />
              <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[10px] leading-4 tabular-nums text-white">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Task image strip inside card ─────────────────────────────────────────────
function TaskAttachmentStrip({
  attachments,
  totalCount,
  onOpenGallery,
  onOpenAll,
  loadingFull,
  priority = false,
}: {
  attachments: RdTaskProgressAttachment[];
  totalCount: number;
  onOpenGallery: (startIdx: number) => void;
  onOpenAll: () => void;
  loadingFull: boolean;
  priority?: boolean;
}) {
  const images = attachments.filter((attachment) => attachment.mime.startsWith("image/"));
  const files = attachments.filter((attachment) => !attachment.mime.startsWith("image/"));
  const cardPreviewSlots = 4;
  const visibleImages = images.slice(0, cardPreviewSlots);
  const visibleFiles = files.slice(0, Math.max(0, cardPreviewSlots - visibleImages.length));
  const extraCount = Math.max(0, totalCount - visibleImages.length - visibleFiles.length);

  return (
    <div className="rd-attachment-scroll flex min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain px-1 pt-1 pb-2" aria-label={t("附件预览")}>
        {visibleImages.map((img, imageIndex) => (
          <button
            key={img.id}
            type="button"
            disabled={loadingFull}
            className="group/att relative h-12 w-[68px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-100 transition-all hover:border-indigo-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-wait disabled:opacity-60"
            onClick={(e) => { e.stopPropagation(); onOpenGallery(imageIndex); }}
            title={img.name}
          >
            <img
              src={getAttachmentThumbUrl(img)}
              alt={img.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover/att:scale-[1.04]"
              loading={priority && imageIndex === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </button>
        ))}

        {visibleFiles.map((file) => (
          <button
            key={file.id}
            type="button"
            disabled={loadingFull}
            onClick={(event) => { event.stopPropagation(); onOpenAll(); }}
            className="flex h-12 w-[86px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
            title={file.name}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-indigo-600 ring-1 ring-slate-200">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="line-clamp-2 min-w-0 text-[9px] font-medium leading-snug text-slate-600">
              {file.name}
            </span>
          </button>
        ))}

        {extraCount > 0 && (
          <button
            type="button"
            disabled={loadingFull}
            onClick={(event) => { event.stopPropagation(); onOpenAll(); }}
            aria-label={t("查看其余 {count} 个附件", { count: extraCount })}
            className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-indigo-200 bg-indigo-50/70 px-2 text-xs font-bold tabular-nums text-indigo-600 transition-colors hover:border-indigo-400 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
          >
            +{extraCount}
          </button>
        )}
    </div>
  );
}

function TaskAttachmentCollectionDialog({
  taskTitle,
  attachments,
  onClose,
}: {
  taskTitle: string;
  attachments: RdTaskProgressAttachment[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/72 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("全部附件")}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{taskTitle}</div>
            <div className="mt-0.5 text-xs text-slate-500">{t("全部附件")} · {attachments.length}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label={t("关闭附件列表")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ProgressAttachmentGrid attachments={attachments} />
        </div>
      </div>
    </div>
  );
}

// 任务「最近活动」排序键：与卡片标签 lastUpdateIso 同一兜底链
//   last_activity_at(后端派生 = max(updated_at, 最新留痕时间)) → 最新留痕时间 → updated_at。
// 排序与显示共用此键，保证「列表里越靠前 = 标签显示越新」，不会出现标签新却排在后面的逆序。
function taskActivityKey(t: Task): string {
  return t.last_activity_at || t.latest_progress_summary?.created_at || t.updated_at || "";
}

// ── Masonry (瀑布流) helpers for the task feed ──
// 把已排序的任务按轮转 (round-robin) 分配到 N 个独立列：第 i 个任务进入第 i % N 列。
// 每列各自纵向堆叠、互不影响高度，所以带附件的高卡片只撑高自己所在列，不会像 CSS grid
// 那样把同一行里的矮卡片拉出大片空白。轮转对前缀稳定：滚动加载追加新任务时已有卡片位置不变。
function distributeIntoColumns<T>(items: T[], columnCount: number): T[][] {
  const columns: T[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, index) => columns[index % columnCount].push(item));
  return columns;
}

// 响应式列数：
//   - 触摸设备(移动端手机 / 平板竖屏，pointer: coarse)且未达桌面宽(<1024)：强制「1 列」。
//     原因：多列瀑布流各列高度独立，带图卡片更高，相邻的新旧任务在纵向上必然错位——即便数据
//     已严格按 last_activity_at 倒序，视觉上仍会出现「右上是更旧的、左下反而更新」，让人误以为
//     排序乱了。移动端单列可保证任务从上到下严格「最新优先」，所见即排序。
//     （注意：此页是桌面驾驶舱、非 /m 移动路由，受全局 min-width 影响手机上常被测成 ≥640 而误判多列，
//      故这里用 pointer: coarse 这一「是否触摸设备」的语义信号兜底，而非单纯依赖宽度断点。）
//   - 桌面(鼠标)：按可用宽度分档，让单卡稳定落在约 300–420px 的可读区间。
//     此前 ≥1024 一律 3 列，两端都不可用：实测 1024 时单卡只有 199px（标签、更新时间全被
//     压断），2560 时单卡宽达 703px（描述被拉成长条、空间大量浪费）。
//     注意 <1024 的档位保持原样不动——那是平板与触控设备的区间，手机走的是独立的
//     MobileRDCockpit，本组件根本不渲染。
// 阈值由实测反推：可用内容宽 ≈ 视口 - 412px，取每档换列时单卡仍 ≥300px。
// 1024→2 列(300px)、1280→3 列(281px)、1730→4 列(320px)、2050→5 列(318px)、2400→6 列(321px)。
const MASONRY_BREAKPOINTS: Array<{ query: string; columns: number }> = [
  { query: "(min-width: 2400px)", columns: 6 },
  { query: "(min-width: 2050px)", columns: 5 },
  { query: "(min-width: 1730px)", columns: 4 },
  { query: "(min-width: 1280px)", columns: 3 },
  { query: "(min-width: 640px)", columns: 2 },
];
const MASONRY_LG_QUERY = "(min-width: 1024px)";
const MASONRY_COARSE_QUERY = "(pointer: coarse)";

function useMasonryColumns(): number {
  const resolve = () => {
    if (typeof window === "undefined") return 3;
    // 触控且未达 lg 一律单列：见上方说明，宽度断点在手机上不可靠，用触摸语义兜底
    if (
      window.matchMedia(MASONRY_COARSE_QUERY).matches
      && !window.matchMedia(MASONRY_LG_QUERY).matches
    ) {
      return 1;
    }
    return MASONRY_BREAKPOINTS.find((step) => window.matchMedia(step.query).matches)?.columns ?? 1;
  };
  const [columns, setColumns] = useState(resolve);
  useEffect(() => {
    const queries = [
      ...MASONRY_BREAKPOINTS.map((step) => step.query),
      MASONRY_LG_QUERY,
      MASONRY_COARSE_QUERY,
    ].map((query) => window.matchMedia(query));
    const update = () => setColumns(resolve());
    update();
    queries.forEach((query) => query.addEventListener("change", update));
    return () => queries.forEach((query) => query.removeEventListener("change", update));
  }, []);
  return columns;
}

function useCockpitSearchKeyword(keyword?: string, onKeywordChange?: (value: string) => void) {
  const [value, setValue] = useState(keyword ?? "");
  const [committedKeyword, setCommittedKeyword] = useState(keyword ?? "");
  const composingRef = useRef(false);
  const lastPublishedRef = useRef(keyword ?? "");

  useEffect(() => {
    if (keyword === undefined) return;
    lastPublishedRef.current = keyword;
    // URL 回传不能覆盖正在由输入法编辑的草稿。
    if (!composingRef.current) {
      setValue(keyword);
      setCommittedKeyword(keyword);
    }
  }, [keyword]);

  const setKeyword = useCallback((next: string) => {
    setValue(next);
    if (composingRef.current) return;
    setCommittedKeyword(next);
    if (lastPublishedRef.current !== next) {
      lastPublishedRef.current = next;
      onKeywordChange?.(next);
    }
  }, [onKeywordChange]);

  return {
    value,
    committedKeyword,
    setKeyword,
    composingRef,
    onCompositionStart: () => { composingRef.current = true; },
    onCompositionEnd: (next: string) => {
      composingRef.current = false;
      setKeyword(next);
    },
  };
}

function PersonTaskCockpit({
  risks,
  personLoads,
  allTasks,
  initialActivityActor,
  keyword,
  onKeywordChange,
  onSelectTask,
  onSelectPerson,
  canReassign,
  onReassignTask,
  canDelete,
  canDeleteAny,
  onDeleteTask,
  canSyncProduction,
  syncedProductionTaskIds,
  syncingProductionTaskId,
  onToggleProductionSync,
  kpiFilter = "all",
  onClearKpiFilter,
  headerCollapsed = false,
  onHeaderCollapseChange,
}: {
  risks: Risk[];
  personLoads: PersonLoad[];
  allTasks: Task[];
  initialActivityActor?: TaskActivityActor | null;
  keyword?: string;
  onKeywordChange?: (value: string) => void;
  onSelectTask: (t: Task, activityActor?: TaskActivityActor) => void;
  onSelectPerson: (person: PersonLoad) => void;
  canReassign?: boolean;
  onReassignTask?: (task: Task) => void;
  canDelete?: boolean;
  canDeleteAny?: boolean;
  onDeleteTask?: (task: Task) => void;
  canSyncProduction?: boolean;
  syncedProductionTaskIds?: Set<string>;
  syncingProductionTaskId?: string | null;
  onToggleProductionSync?: (task: Task) => void;
  kpiFilter?: KpiFilter;
  onClearKpiFilter?: () => void;
  /** 顶部模块当前是否收起：收起时把任务 feed 增高到 ~84vh 以最大化可视区 */
  headerCollapsed?: boolean;
  /** 任务 feed 下滑时请求收起顶部；进入沉浸模式后由顶部控制条显式退出，避免上滑时丢失整屏视野 */
  onHeaderCollapseChange?: (collapsed: boolean) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  useI18n(); // 订阅语言切换（卡片流文案已 t() 化）
  const { user } = useAuth();
  const noteReceipts = React.useContext(NoteReceiptContext); // 备注回执 map（父级驾驶舱下发）
  const masonryColumns = useMasonryColumns();
  // 协同侧信息密度降一档：卡片内边距与卡片间距放宽（欧美工具风的呼吸感）；研发侧维持紧凑
  const spaciousCards = isUsCollabWorkspace();
  // 跨用户头像解析（人员 Stories 头像 = 文字 → 真实头像，按姓名兜底匹配）
  const resolveAvatar = useAvatarDirectory();

  // ── Tab state (with prev-tab for slide direction) ──
  const initialActivityTab = resolveActivityPersonTab(personLoads, initialActivityActor);
  const [activeTab, setActiveTab] = useState(() => resolveActivityPersonTab(personLoads, initialActivityActor));
  const [prevTab, setPrevTab] = useState(() => resolveActivityPersonTab(personLoads, initialActivityActor));
  const activityRestorePendingRef = useRef(Boolean(initialActivityActor && initialActivityTab === "all"));
  const tabOrder = useMemo(() => ["all", ...personLoads.map((p) => p.key)], [personLoads]);
  const direction = tabOrder.indexOf(activeTab) >= tabOrder.indexOf(prevTab) ? 1 : -1;

  // 跨产品合并树可能比主库稍晚返回：若首次挂载时尚未找到目标成员，等人员数据补齐后恢复一次。
  // 用户若已主动切换页签，则取消这次延迟恢复，避免异步响应覆盖用户的新选择。
  useEffect(() => {
    if (!activityRestorePendingRef.current || !initialActivityActor) return;
    const restoredTab = resolveActivityPersonTab(personLoads, initialActivityActor);
    if (restoredTab === "all") return;
    activityRestorePendingRef.current = false;
    setActiveTab(restoredTab);
    setPrevTab(restoredTab);
  }, [initialActivityActor, personLoads]);

  const handleTabChange = useCallback((v: string) => {
    activityRestorePendingRef.current = false;
    setPrevTab(activeTab);
    setActiveTab(v);
  }, [activeTab]);

  // ── 任务搜索（头像行右端图标态收纳，展开为小输入框）──
  // 关键字与 KPI 筛选走同一管线（直接揉进 allActiveTasks / personTasksMap 两个 memo），
  // 懒加载留痕/AI 评分、无限滚动、批量导出等所有下游自动同口径。
  const {
    value: cockpitKeyword,
    committedKeyword,
    setKeyword: setCockpitKeyword,
    composingRef: searchComposingRef,
    onCompositionStart: startSearchComposition,
    onCompositionEnd: endSearchComposition,
  } = useCockpitSearchKeyword(keyword, onKeywordChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cockpitSearch = committedKeyword.trim();
  const deferredCockpitSearch = useDeferredValue(cockpitSearch);
  const searchPending = deferredCockpitSearch !== cockpitSearch;
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  const closeSearchAndRestoreFocus = useCallback(() => {
    setCockpitKeyword("");
    setSearchOpen(false);
    requestAnimationFrame(() => searchTriggerRef.current?.focus());
  }, [setCockpitKeyword]);

  // 异步刷新后（如删除了某人最后一个任务），该成员会从 personLoads 中消失。
  // 此时停留在已不存在的人员 tab 上会让内容区空白，回退到「全部」。
  // 其余刷新（成员仍有任务）保持当前选中人员不变。
  useEffect(() => {
    if (activeTab !== "all" && !personLoads.some((p) => p.key === activeTab)) {
      setActiveTab("all");
      setPrevTab("all");
    }
  }, [activeTab, personLoads]);

  // Full notes are reserved for reports/details; cockpit cards use a dedicated lightweight batch map.
  const [notesMap, setNotesMap] = useState<Record<string, RdTaskProgressNote[]>>({});
  const [attachmentPreviewMap, setAttachmentPreviewMap] = useState<Record<string, RdTaskAttachmentPreview>>({});
  const [loadingNotes, setLoadingNotes] = useState(false);
  // ── AI 完成质量评分 lazy fetch（已完成任务，按需拉取）──
  // 值为 null 表示已请求但后端尚未生成评分（或当前用户无权查看）
  const [aiScoreMap, setAiScoreMap] = useState<Record<string, RdTaskCompletionScore | null>>({});
  // 一次性补跑全部已完成任务 AI 评分的进行中标记
  const [backfillBusy, setBackfillBusy] = useState(false);
  // 批量补抽取历史附件的进行中标记
  const [extractionBackfillBusy, setExtractionBackfillBusy] = useState(false);
  // 批量导出报告的进行中标记
  const [batchExportBusy, setBatchExportBusy] = useState(false);

  const handleBackfillScores = useCallback(async (force = false) => {
    if (backfillBusy) return;
    setBackfillBusy(true);
    const toastId = toast.loading(t("[1/2] 正在抽取历史附件文本（OCR/文档/视觉）…"));

    // Step 1：先做附件抽取，让评分时 AI 能"看到"附件内容
    let extractionSummary = "";
    let extractionHasMore = false;
    try {
      const extractResult = await backfillRdTaskProgressNoteExtraction({ max_items: 50 });
      if (extractResult.processed === 0) {
        extractionSummary = t("附件全部已抽取");
      } else {
        extractionSummary = t("附件抽取 {succeeded} 成功{failed}", {
          succeeded: extractResult.succeeded,
          failed: extractResult.failed > 0 ? ` ${t("/ {count} 失败", { count: extractResult.failed })}` : "",
        });
        if (extractResult.has_more) {
          extractionHasMore = true;
          extractionSummary += t("（剩 {count} 个待处理）", { count: extractResult.total_pending - extractResult.processed });
        }
      }
    } catch (err) {
      extractionSummary = t("附件抽取失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") });
      // 抽取失败不阻塞评分，AI 依然能基于元数据评分
    }

    // Step 2：AI 评分
    toast.loading(t("[2/2] {summary} → 生成 AI 评分中…", { summary: extractionSummary }), { id: toastId });
    try {
      const result = await backfillRdTaskCompletionScores({ force });
      const scoreSummary = force
        ? t("AI 重新评分：{scored} 个已按新标准更新{failed}", {
            scored: result.scored,
            failed: result.failed > 0 ? ` ${t("/ {count} 失败", { count: result.failed })}` : "",
          })
        : t("AI 评分：{scored} 新评分 / {skipped} 已存在{failed}", {
            scored: result.scored,
            skipped: result.skipped,
            failed: result.failed > 0 ? ` ${t("/ {count} 失败", { count: result.failed })}` : "",
          });
      const finalMsg = [extractionSummary, scoreSummary, extractionHasMore ? t("提示：附件仍有未抽取项，可再次点击继续完善评分") : ""]
        .filter(Boolean)
        .join("\n");
      if (result.failed > 0 || extractionHasMore) {
        toast.warning(finalMsg, { id: toastId, duration: 8000 });
      } else {
        toast.success(finalMsg, { id: toastId, duration: 6000 });
      }
      // 清空两个 map，触发可见任务重新拉取
      setAiScoreMap({});
      setNotesMap({});
    } catch (err) {
      toast.error(t("AI 评分失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setBackfillBusy(false);
    }
  }, [backfillBusy]);

  const handleBackfillExtraction = useCallback(async () => {
    if (extractionBackfillBusy) return;
    setExtractionBackfillBusy(true);
    const toastId = toast.loading(t("正在批量抽取历史附件文本（OCR/文档/视觉，每个 5-30 秒）…"));
    try {
      const result = await backfillRdTaskProgressNoteExtraction({ max_items: 50 });
      const lines = [
        t("本次处理 {processed} / 待处理 {pending}", { processed: result.processed, pending: result.total_pending }),
        t("成功 {succeeded}{failed}", { succeeded: result.succeeded, failed: result.failed > 0 ? ` ${t("· 失败 {count}", { count: result.failed })}` : "" }),
      ];
      if (result.has_more) {
        lines.push(t("（剩余附件较多，可再次点击继续）"));
      }
      const msg = lines.join("，");
      if (result.failed > 0) toast.warning(msg, { id: toastId, duration: 6000 });
      else if (result.processed === 0) toast.info(t("没有待抽取的附件，全部已处理过"), { id: toastId });
      else toast.success(msg, { id: toastId, duration: 6000 });
      // 清空 notesMap，触发可见任务重新拉取（这样新的 extracted_text 会反映出来）
      setNotesMap({});
      // 评分也清空，因为下次评分能用上新抽取的内容
      setAiScoreMap({});
    } catch (err) {
      toast.error(t("批量抽取失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setExtractionBackfillBusy(false);
    }
  }, [extractionBackfillBusy]);

  // ── Per-tab visible counts (for infinite scroll pagination) ──
  // 研发与协同驾驶舱统一：首批只渲染 6 条，后续按滚动增量加载。
  const taskPageSize = TASK_PAGE_SIZE;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  // 协助段折叠态（按成员身份主键记）。默认折叠：驾驶舱给领导看的是「谁负责什么」，
  // 协助是下钻上下文；折叠标题上仍带数量，不看也知道他还搭了几件事。
  const [expandedCollabTabs, setExpandedCollabTabs] = useState<Set<string>>(() => new Set());
  const toggleCollabSegment = useCallback((tabKey: string) => {
    setExpandedCollabTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabKey)) next.delete(tabKey);
      else next.add(tabKey);
      return next;
    });
  }, []);
  // 当前激活 tab 的滚动容器。用 callback-ref 把节点存进 state，而不是 useRef：
  // AnimatePresence mode="wait" 下切 tab 时旧容器会先退场动画(~220ms)再卸载、新容器随后才挂载；
  // 用 useRef + 仅依赖 activeTab 的 effect 会在退场期测到旧容器、且新容器挂载后不再重跑 effect，
  // 导致少卡片的新 tab 永不自动填充。把节点放进 state 后，节点挂载/卸载即触发 effect 重跑，时序正确。
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  // 协同侧卡片流高度实测（视口内布局）：页头三层 + 固定 65vh 会超出视口产生页面滚动、
  // 底部被裁。按滚动容器到视口顶的真实距离精确锁高；研发侧维持 65vh/84vh 不变。
  // ⚠️ 必须声明在 scrollEl 之后（const TDZ）。
  const [collabFlowHeight, setCollabFlowHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!spaciousCards || !scrollEl) {
      setCollabFlowHeight(null);
      return;
    }
    const measure = () => {
      const top = scrollEl.getBoundingClientRect().top + window.scrollY;
      setCollabFlowHeight(Math.max(320, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl, spaciousCards]);
  const flowHeightStyle = (collapsed: boolean): React.CSSProperties => ({
    height: spaciousCards && collabFlowHeight ? collabFlowHeight : collapsed ? "84vh" : "65vh",
  });
  const setScrollRef = useCallback((node: HTMLDivElement | null) => setScrollEl(node), []);
  // 上一次滚动位置：用于识别下滑并自动进入沉浸模式，带滞回阈值防抖动
  const lastScrollTopRef = useRef(0);
  // 自动收起后的短暂冷却：feed 高度变化会让浏览器把超出新范围的 scrollTop 夹紧、回弹出一串
  // 滚动事件；锁定窗口内只同步基准，避免高度动画干扰后续方向判断。
  const collapseLockUntilRef = useRef(0);
  const loadNextTaskPage = useCallback((tabKey: string, totalTasks: number) => {
    setVisibleCounts((prev) => {
      const current = prev[tabKey] ?? taskPageSize;
      if (current >= totalTasks) return prev;
      return { ...prev, [tabKey]: Math.min(current + TASK_PAGE_SIZE, totalTasks) };
    });
  }, [taskPageSize]);

  // 固定高度容器内的 onScroll 触发分页
  const handleTaskScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>, tabKey: string, totalTasks: number) => {
      const el = e.currentTarget;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (nearBottom) {
        loadNextTaskPage(tabKey, totalTasks);
      }
      // 顶部模块「下滑收起」：滞回阈值（累计 > 6px、且越过 80px）避免抖动。
      // 进入沉浸模式后不再因上滑自动展开，让用户能在整屏状态回到第一排；退出交给顶部控制条。
      // 冷却锁继续吸收高度变化引发的滚动回弹。父级在「钉住」时忽略该信号。
      if (onHeaderCollapseChange) {
        const top = el.scrollTop;
        if (Date.now() < collapseLockUntilRef.current) {
          lastScrollTopRef.current = top;
          return;
        }
        const lock = () => {
          collapseLockUntilRef.current = Date.now() + 420;
          lastScrollTopRef.current = top;
        };
        if (top <= 8) {
          lastScrollTopRef.current = top;
        } else {
          const delta = top - lastScrollTopRef.current;
          if (delta > 6 && top > 80 && !headerCollapsed) {
            onHeaderCollapseChange(true);
            lock();
          } else if (Math.abs(delta) > 6) {
            // 状态无需变化：仅推进基准，保持滞回灵敏度
            lastScrollTopRef.current = top;
          }
        }
      }
    },
    [headerCollapsed, loadNextTaskPage, onHeaderCollapseChange],
  );

  // ── Gallery lightbox ──
  const [galleryState, setGalleryState] = useState<{ images: RdTaskProgressAttachment[]; startIndex: number } | null>(null);
  const [attachmentCollectionState, setAttachmentCollectionState] = useState<{
    taskTitle: string;
    attachments: RdTaskProgressAttachment[];
  } | null>(null);
  const [attachmentLoadingTaskId, setAttachmentLoadingTaskId] = useState<string | null>(null);
  const fullAttachmentCacheRef = useRef(new Map<string, RdTaskAttachmentPreview>());
  const fullAttachmentInflightRef = useRef(new Map<string, Promise<RdTaskAttachmentPreview>>());
  const attachmentOpenSequenceRef = useRef(0);

  const loadAllTaskAttachments = useCallback(async (taskId: string, expectedCount: number) => {
    const cached = fullAttachmentCacheRef.current.get(taskId);
    if (cached && (expectedCount <= 0 || cached.attachment_count === expectedCount)) return cached;
    const inflight = fullAttachmentInflightRef.current.get(taskId);
    if (inflight) return inflight;
    const request = fetchRdTaskAttachments(taskId);
    fullAttachmentInflightRef.current.set(taskId, request);
    try {
      const result = await request;
      fullAttachmentCacheRef.current.set(taskId, result);
      return result;
    } finally {
      if (fullAttachmentInflightRef.current.get(taskId) === request) {
        fullAttachmentInflightRef.current.delete(taskId);
      }
    }
  }, []);

  const openCompleteImageGallery = useCallback(async (
    task: Task,
    previewImages: RdTaskProgressAttachment[],
    startIndex: number,
    expectedCount: number,
  ) => {
    const requestSequence = ++attachmentOpenSequenceRef.current;
    setAttachmentLoadingTaskId(task.task_id);
    try {
      const result = await loadAllTaskAttachments(task.task_id, expectedCount);
      if (requestSequence !== attachmentOpenSequenceRef.current) return;
      const images = result.attachments.filter((attachment) => inferAttachmentMime(attachment).startsWith("image/"));
      if (images.length === 0) {
        toast.info(t("该任务暂无图片附件"));
        return;
      }
      const startAttachmentId = previewImages[startIndex]?.id;
      const resolvedIndex = startAttachmentId
        ? images.findIndex((attachment) => attachment.id === startAttachmentId)
        : 0;
      setGalleryState({ images, startIndex: Math.max(0, resolvedIndex) });
    } catch (error) {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        toast.error(error instanceof Error ? error.message : t("完整附件加载失败"));
      }
    } finally {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        setAttachmentLoadingTaskId(null);
      }
    }
  }, [loadAllTaskAttachments]);

  const openCompleteAttachmentCollection = useCallback(async (task: Task, expectedCount: number) => {
    const requestSequence = ++attachmentOpenSequenceRef.current;
    setAttachmentLoadingTaskId(task.task_id);
    try {
      const result = await loadAllTaskAttachments(task.task_id, expectedCount);
      if (requestSequence !== attachmentOpenSequenceRef.current) return;
      setAttachmentCollectionState({ taskTitle: task.title, attachments: result.attachments });
    } catch (error) {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        toast.error(error instanceof Error ? error.message : t("完整附件加载失败"));
      }
    } finally {
      if (requestSequence === attachmentOpenSequenceRef.current) {
        setAttachmentLoadingTaskId(null);
      }
    }
  }, [loadAllTaskAttachments]);

  // ── Sort helper: newest activity first ──
  // 排序键用后端派生的 last_activity_at（= max(updated_at, 最新留痕时间)），与卡片「最近更新」
  // 显示同一口径。进度留痕不刷新 updated_at，单用 updated_at 排序会让刚留痕的任务沉底、出现逆序。
  // 关键：兜底链必须与卡片标签 lastUpdateIso 完全一致（last_activity_at → 最新留痕时间 → updated_at），
  // 否则当 last_activity_at 缺失时，标签按留痕时间显示「N 分钟前」、排序却退回 updated_at，
  // 会出现「刚留痕的任务标签很新但排在很后面」的逆序观感。统一走模块级 taskActivityKey。
  const sortByUpdatedDesc = useCallback((arr: Task[]): Task[] => {
    return arr.slice().sort((a, b) => {
      const at = taskActivityKey(a);
      const bt = taskActivityKey(b);
      if (at === bt) return 0;
      return at < bt ? 1 : -1;
    });
  }, []);

  // Risk task IDs for quick lookup (to show risk indicator in "全部" tab)
  const riskTaskIds = useMemo(() => new Set(risks.map((r) => r.task.task_id)), [risks]);

  // KPI 卡片筛选谓词：与顶部 KPI 计数口径保持一致
  // - 阻塞/待派 与 catStat.blocked 保持一致（paused_blocked || pending_assign）
  const matchesKpiFilter = useCallback(
    (t: Task): boolean => {
      switch (kpiFilter) {
        case "in_progress":
          return t.status === "in_progress";
        case "completed":
          return t.status === "completed";
        case "blocked":
          return t.status === "paused_blocked" || t.status === "pending_assign";
        case "risk":
          return riskTaskIds.has(t.task_id);
        case "all":
        default:
          return true;
      }
    },
    [kpiFilter, riskTaskIds],
  );

  // ── Derived data ──
  // "全部" tab — 默认包含所有非归档任务（含已完成），按更新时间倒序；如有 KPI 筛选则再过滤
  const filteredTasks = useMemo(() => {
    return sortByUpdatedDesc(
      allTasks.filter((task) =>
        !task.archived
        && matchesKpiFilter(task)
        && taskMatches(task, deferredCockpitSearch, "all", "all", "all"),
      ),
    );
  }, [allTasks, deferredCockpitSearch, matchesKpiFilter, sortByUpdatedDesc]);

  const allActiveTasks = filteredTasks;

  // Per-person — 同步包含已完成任务并应用 KPI 筛选与搜索关键字
  // 驾驶舱是给领导看「谁在负责什么」的，所以主责与协助必须分开：
  // 主责段占第一屏，协助段作为下钻上下文默认折叠。两段应用同一套 KPI 筛选与搜索。
  const personTasksMap = useMemo(() => {
    const map = new Map<string, { primary: Task[]; collaborating: Task[] }>();
    for (const person of personLoads) {
      map.set(person.key, { primary: [], collaborating: [] });
    }
    // filteredTasks 已按最后活动时间排序；单次遍历即可保持各成员分组同序，
    // 避免原先“人员 × 任务”的嵌套扫描。同一任务的重复协作者用 Set 去重。
    for (const task of filteredTasks) {
      const ownerKey = memberIdentityKey(task.primary_owner, task.primary_owner_user_id);
      map.get(ownerKey)?.primary.push(task);

      const collaboratorKeys = new Set(
        task.collaborators.map((collaborator) => memberIdentityKey(collaborator.name, collaborator.user_id)),
      );
      collaboratorKeys.delete(ownerKey);
      for (const collaboratorKey of collaboratorKeys) {
        map.get(collaboratorKey)?.collaborating.push(task);
      }
    }
    return map;
  }, [filteredTasks, personLoads]);

  /** 分页、导出等下游只关心「该成员页签下的全部任务」，主责在前、协助在后。 */
  const personScopeTasks = useCallback(
    (tabKey: string): Task[] => {
      const segments = personTasksMap.get(tabKey);
      return segments ? [...segments.primary, ...segments.collaborating] : [];
    },
    [personTasksMap],
  );

  // 当前 tab 的搜索命中数（展示在搜索框内）
  const activePersonSegments = activeTab === "all" ? undefined : personTasksMap.get(activeTab);
  const cockpitHitCount = activePersonSegments
    ? activePersonSegments.primary.length + activePersonSegments.collaborating.length
    : allActiveTasks.length;

  // 批量导出报告：把当前范围（"全部" / 某成员）已完成且已评分的任务，汇总成一份多页 PDF。
  // 注意：依赖 allActiveTasks / personTasksMap，必须定义在它们的 useMemo 之后，否则触发 TDZ。
  const handleBatchExportReports = useCallback(async () => {
    if (batchExportBusy) return;
    const scopeTasks = (activeTab === "all" ? allActiveTasks : personScopeTasks(activeTab))
      .filter((t) => t.status === "completed");
    if (scopeTasks.length === 0) {
      toast.info(t("当前范围没有已完成任务可导出"));
      return;
    }
    if (
      scopeTasks.length > 50 &&
      !window.confirm(t("当前范围有 {count} 个已完成任务，将逐个拉取评分与留痕并生成多页报告，可能较慢。确定继续？", { count: scopeTasks.length }))
    ) {
      return;
    }
    setBatchExportBusy(true);
    const toastId = toast.loading(t("正在汇总 {count} 个任务的评分…", { count: scopeTasks.length }));
    try {
      // 1) 评分接口每批最多 60 个；批量导出不再按任务放大成 N 个请求。
      const missingScoreIds = scopeTasks
        .filter((task) => aiScoreMap[task.task_id] === undefined)
        .map((task) => task.task_id);
      const scoreBatches = Array.from(
        { length: Math.ceil(missingScoreIds.length / 60) },
        (_, index) => missingScoreIds.slice(index * 60, (index + 1) * 60),
      );
      const fetchedScoreMaps = await mapWithConcurrency(scoreBatches, 2, async (batch) => {
        try {
          return await fetchRdTaskCompletionScores(batch);
        } catch {
          // Rolling deploy compatibility for an older API instance.
          const entries = await mapWithConcurrency(batch, 4, async (taskId) => [
            taskId,
            await fetchRdTaskCompletionScore(taskId).catch(() => null),
          ] as const);
          return Object.fromEntries(entries);
        }
      });
      const fetchedScores = Object.assign({}, ...fetchedScoreMaps) as Record<string, RdTaskCompletionScore | null>;
      const scoreEntries = scopeTasks.map((task) => [
        task,
        aiScoreMap[task.task_id] !== undefined ? aiScoreMap[task.task_id] : fetchedScores[task.task_id] ?? null,
      ] as const);
      const scored = scoreEntries.filter(
        (e): e is readonly [Task, RdTaskCompletionScore] => e[1] != null,
      );
      if (scored.length === 0) {
        toast.error(t("这些任务尚未生成 AI 评分，请先点击「AI 复盘评分」"), { id: toastId });
        return;
      }
      // 2) 拉进度留痕（并发上限 6），优先用 notesMap 缓存
      toast.loading(t("正在汇总 {count} 个任务的进度留痕…", { count: scored.length }), { id: toastId });
      const items = await mapWithConcurrency(scored, 6, async ([t, score]) => {
        const cachedNotes = notesMap[t.task_id];
        const noteList = cachedNotes !== undefined ? cachedNotes : await fetchRdTaskProgressNotes(t.task_id).catch(() => []);
        return { task: t, score, notes: noteList };
      });
      const scopeLabel = activeTab === "all"
        ? t("管理员视角")
        : (personLoads.find((person) => person.key === activeTab)?.name ?? activeTab);
      const ok = openBatchCompletionReport(scopeLabel, items);
      if (!ok) {
        toast.error(t("报告窗口被浏览器拦截，请允许本站弹出窗口后重试"), { id: toastId });
        return;
      }
      const skipped = scopeTasks.length - scored.length;
      toast.success(
        t("已生成 {count} 份报告{skipped}", { count: items.length, skipped: skipped > 0 ? t("，跳过 {count} 个未评分任务", { count: skipped }) : "" }),
        { id: toastId, duration: 6000 },
      );
    } catch (err) {
      toast.error(t("批量导出失败：{error}", { error: err instanceof Error ? err.message : t("未知错误") }), { id: toastId });
    } finally {
      setBatchExportBusy(false);
    }
  }, [activeTab, aiScoreMap, allActiveTasks, batchExportBusy, notesMap, personLoads, personScopeTasks]);

  // 切换 KPI 筛选 / 搜索关键字时重置分页计数，避免旧偏移导致空白
  useEffect(() => {
    setVisibleCounts({});
  }, [deferredCockpitSearch, kpiFilter]);

  // One card-summary request per visible page. The previous implementation emitted one full-notes
  // request per task and repeated the backend's full JSON scans, which scaled poorly with task count.
  useEffect(() => {
    const visibleCount = visibleCounts[activeTab] ?? taskPageSize;
    const sourceTasks = activeTab === "all"
      ? allActiveTasks
      : personScopeTasks(activeTab);
    const toFetch = sourceTasks
      .slice(0, visibleCount)
      .filter((task) => task.attachments > 0 && !(task.task_id in attachmentPreviewMap));
    if (toFetch.length === 0) {
      setLoadingNotes(false);
      return;
    }
    const controller = new AbortController();
    setLoadingNotes(true);
    fetchRdTaskAttachmentPreviews(
      toFetch.map((task) => task.task_id),
      { signal: controller.signal },
    )
      .catch(async (error) => {
        if (controller.signal.aborted) return null;
        // Rolling deploy/dev compatibility: a newer frontend can briefly run against an API that
        // does not have the batch-summary route yet. Fall back to the established per-task notes
        // endpoint instead of translating an integration error into "this task has no attachments".
        const entries = await mapWithConcurrency(toFetch, 3, async (task) => {
          try {
            const notes = await fetchRdTaskProgressNotes(task.task_id, controller.signal);
            return [task.task_id, buildRdTaskAttachmentPayload(notes, MAX_ATTACHMENT_PREVIEW)] as const;
          } catch {
            return [
              task.task_id,
              { attachment_count: task.attachments, attachments: [] as RdTaskProgressAttachment[] },
            ] as const;
          }
        });
        return Object.fromEntries(entries);
      })
      .then((previews) => {
        if (!controller.signal.aborted && previews) {
          setAttachmentPreviewMap((prev) => ({ ...prev, ...previews }));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingNotes(false); });
    return () => { controller.abort(); };
  }, [activeTab, allActiveTasks, personTasksMap, visibleCounts, attachmentPreviewMap]);

  // Lazy-fetch AI completion scores — 仅针对可见的已完成任务
  useEffect(() => {
    const visibleCount = activeTab === "all"
      ? (visibleCounts["all"] ?? taskPageSize)
      : (visibleCounts[activeTab] ?? taskPageSize);
    const sourceTasks = activeTab === "all"
      ? allActiveTasks
      : personScopeTasks(activeTab);
    const visibleCompleted = sourceTasks
      .slice(0, visibleCount)
      .filter((t) => t.status === "completed" && !(t.task_id in aiScoreMap));
    if (visibleCompleted.length === 0) return;
    const controller = new AbortController();
    fetchRdTaskCompletionScores(
      visibleCompleted.map((task) => task.task_id),
      controller.signal,
    )
      .catch(async () => {
        if (controller.signal.aborted) return null;
        // Rolling deploy compatibility for an older API instance.
        const entries = await mapWithConcurrency(visibleCompleted, 4, (task) =>
          fetchRdTaskCompletionScore(task.task_id, controller.signal)
            .then((score) => [task.task_id, score] as const)
            .catch(() => [task.task_id, null] as const),
        );
        return Object.fromEntries(entries);
      })
      .then((scores) => {
        if (!controller.signal.aborted && scores) {
          setAiScoreMap((prev) => ({ ...prev, ...scores }));
        }
      });
    return () => { controller.abort(); };
  }, [activeTab, allActiveTasks, personTasksMap, visibleCounts]);

  // 三列瀑布流在首批 6 张卡片较矮时可能没有滚动条，onScroll 因而永远不会触发。
  // 内容不足时自动追加一批，直到产生可滚动空间或全部展示；底部按钮仍保留手动兜底。
  useEffect(() => {
    if (!scrollEl) return;
    // 分页只驱动主责段（协助段展开后一次给完），补页判断必须用同一口径，
    // 否则合计数大于主责数时会一直认为「还有下一页」，反复触发补页。
    const totalTasks = activeTab === "all"
      ? allActiveTasks.length
      : (personTasksMap.get(activeTab)?.primary.length ?? 0);
    const visibleCount = visibleCounts[activeTab] ?? taskPageSize;
    if (visibleCount >= totalTasks) return;
    if (scrollEl.scrollHeight - scrollEl.clientHeight >= 120) return;
    loadNextTaskPage(activeTab, totalTasks);
  }, [
    activeTab,
    allActiveTasks,
    attachmentPreviewMap,
    headerCollapsed,
    loadNextTaskPage,
    masonryColumns,
    personTasksMap,
    scrollEl,
    taskPageSize,
    visibleCounts,
  ]);

  // Slide variants for tab content transitions
  const slideVariants = {
    enter: (dir: number) => ({
      x: shouldReduceMotion ? 0 : dir > 0 ? 36 : -36,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({
      x: shouldReduceMotion ? 0 : dir > 0 ? -36 : 36,
      opacity: 0,
    }),
  };

  const activeMember = useMemo(
    () => activeTab === "all" ? undefined : personLoads.find((person) => person.key === activeTab),
    [activeTab, personLoads],
  );
  const activityActor = useMemo(
    () => activeMember ? { id: activeMember.user_id, name: activeMember.name } : undefined,
    [activeMember],
  );

  // ── Shared task card renderer (used by both "全部" and per-person tabs) ──
  const renderTaskCard = (
    task: Task,
    taskIdx: number,
    accentColor: string,
  ) => {
    const visibleTaskTitle = taskVisibleTitle(task);
    // 协助段的卡片必须标明主责人，领导才知道这件事到底归谁
    const isSelectedPersonCollaborator = Boolean(
      activeMember && memberIdentityKey(task.primary_owner, task.primary_owner_user_id) !== activeMember.key,
    );
    const priorityKey: Priority = task.final_priority ?? task.ai_priority ?? "medium";
    const pCfg = PRIORITY_CONFIG[priorityKey] ?? PRIORITY_CONFIG.medium;
    const attachmentPreview = attachmentPreviewMap[task.task_id];
    const taskAttachments: RdTaskProgressAttachment[] = attachmentPreview?.attachments ?? [];
    // 按扩展名兜底判定：存成 application/octet-stream 的图片此前既不进图片位、也不算文档
    const taskImages = taskAttachments.filter((a) => inferAttachmentMime(a).startsWith("image/"));
    const taskAttachmentCount = attachmentPreview?.attachment_count ?? task.attachments;
    const hasLoadedAttachments = Boolean(attachmentPreview && attachmentPreview.attachment_count > 0);
    const isRisk = riskTaskIds.has(task.task_id);
    const productionMirror = isProductionMirrorTask(task);
    const isCurrentUserParticipant = Boolean(user && (
      matchesCurrentTaskParticipant(
        task.primary_owner_user_id,
        task.primary_owner,
        user.id,
        user.name,
      )
      || task.collaborators.some((collaborator) => matchesCurrentTaskParticipant(
        collaborator.user_id,
        collaborator.name,
        user.id,
        user.name,
      ))
    ));
    const showDeleteTaskAction = Boolean(canDelete && (canDeleteAny || isCurrentUserParticipant));
    const productionSynced = syncedProductionTaskIds?.has(task.task_id) ?? false;
    const showProductionSyncAction = Boolean(canSyncProduction && onToggleProductionSync && !productionMirror);
    // 最近更新时间：用后端派生的 last_activity_at（= max(updated_at, 最新留痕时间)），与列表排序同口径。
    // 兜底依次回退到留痕时间 / updated_at，保证后端字段缺失时仍能显示。
    const lastUpdateIso =
      task.last_activity_at ?? task.latest_progress_summary?.created_at ?? task.updated_at ?? null;
    const relativeUpdate = formatRelativeUpdate(lastUpdateIso);
    // 已完成任务的质量评分：仅展示 AI 评分；未生成时显示"评分待生成"占位，不再用规则估算误导
    const aiScore = task.status === "completed" ? aiScoreMap[task.task_id] ?? null : null;
    const aiScoreFetched = task.status === "completed" && task.task_id in aiScoreMap;
    const completionScore = aiScore
      ? {
          total: aiScore.total,
          grade: aiScore.grade,
          gradeLabel: aiScore.grade_label,
          dimensions: aiScore.dimensions.map((d) => ({
            key: d.key,
            label: d.label,
            score: d.score,
            max: d.max,
            detail: d.comment,
          })),
          summary: aiScore.summary,
          isFallback: Boolean(aiScore.fallback_reason),
        }
      : null;
    const gradeTone = completionScore ? getGradeTone(completionScore.grade) : null;
    const showPendingScoreBadge = task.status === "completed" && !aiScore;
    // 存储里的 category_path 对纯一级分类是「系统 / 默认 / 类型」三段（格式刻意不变，
    // 改成两段会让按位置解析的消费方把类型段误当子项）。展示时把「默认」那段剔掉。
    const hierarchySegments = splitCategoryPath(task.category_path)
      .filter((seg) => seg !== RD_DEFAULT_SUBPROJECT_LABEL)
      .slice(-2);
    const directSubtaskCount = task.subtasks?.length ?? 0;
    const hierarchyRoleLabel = task.parent_task_id
      ? t("子任务")
      : directSubtaskCount > 0
        ? t("主任务 · {count} 个下级", { count: directSubtaskCount })
        : null;
    const cardSummary =
      task.latest_progress_summary?.text?.trim()
      || task.description?.trim()
      || t("暂无进展摘要");
    const workItems = task.work_items ?? [];
    const completedWorkItemCount = workItems.reduce((count, item) => count + (item.done ? 1 : 0), 0);

    return (
      <motion.div
        key={task.task_id}
        style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
        // 协同侧：筛选/切换泳道时卡片平滑重排归位（layout 动画）；研发侧维持原进场行为
        layout={spaciousCards && !shouldReduceMotion ? "position" : undefined}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...RD_LIST_TRANSITION, delay: taskIdx * 0.03 }}
        onClick={() => onSelectTask(task, activityActor)}
        role="button"
        tabIndex={0}
        aria-label={t("打开任务：{title}", { title: visibleTaskTitle })}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectTask(task, activityActor);
          }
        }}
        className={cn(
          "rd-horizon-task-card group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] duration-200 hover:border-blue-200 hover:shadow-[0_10px_24px_-14px_rgba(0,47,167,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
        )}
      >
        <div className={cn("rd-horizon-task-card-body flex min-h-[220px] min-w-0 flex-col", spaciousCards ? "gap-3 px-5 py-4" : "gap-2.5 px-4 py-3.5")}>
          {/* 参考卡片第一行：分类标签在左，附件数量与操作菜单在右。 */}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
              {hierarchySegments.map((segment) => (
                <span
                  key={segment}
                  className="rd-horizon-task-path max-w-[138px] truncate rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#002fa7]"
                  title={segment}
                >
                  {segment}
                </span>
              ))}
              {hierarchyRoleLabel && (
                <span className="rd-horizon-structure-tag inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                  <GitBranch className="h-3 w-3" />
                  {hierarchyRoleLabel}
                </span>
              )}
              {isSelectedPersonCollaborator && (
                <span className="rd-horizon-structure-tag inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">
                  <Users className="h-3 w-3" />
                  {t("协助")}
                </span>
              )}
              {productionMirror && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">
                  <Lock className="h-3 w-3" />
                  {t("研发同步 · 只读")}
                </span>
              )}
              {completionScore && gradeTone && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      onClick={(event) => event.stopPropagation()}
                      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold", gradeTone.bg, gradeTone.border, gradeTone.text)}
                    >
                      <Sparkles className="h-3 w-3" />
                      AI {completionScore.total}/100 · {completionScore.grade}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-xs text-xs">
                    {completionScore.summary || t("AI 复盘评分")}
                  </TooltipContent>
                </Tooltip>
              )}
              {showPendingScoreBadge && (
                <span
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-400"
                  title={aiScoreFetched ? t("评分待生成") : t("评分加载中")}
                >
                  <Sparkles className="h-3 w-3" />
                  {aiScoreFetched ? t("评分待生成") : t("评分加载中")}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {taskAttachmentCount > 0 && (
                <button
                  type="button"
                  disabled={attachmentLoadingTaskId === task.task_id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openCompleteAttachmentCollection(task, taskAttachmentCount);
                  }}
                  className="rd-horizon-attachment-action inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-50 px-2 text-[10px] font-semibold text-[#002fa7] transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                  aria-label={t("查看全部附件")}
                >
                  {attachmentLoadingTaskId === task.task_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                  {t("附件")} <span className="tabular-nums">{taskAttachmentCount}</span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="rd-horizon-more-action flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                    aria-label={t("更多操作")}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => onSelectTask(task, activityActor)}>
                    <ArrowRight className="h-4 w-4" />
                    {t("查看任务")}
                  </DropdownMenuItem>
                  {!productionMirror && showProductionSyncAction && onToggleProductionSync && (
                    <DropdownMenuItem
                      disabled={syncingProductionTaskId === task.task_id}
                      onSelect={() => onToggleProductionSync(task)}
                    >
                      {syncingProductionTaskId === task.task_id
                        ? <RefreshCw className="h-4 w-4 animate-spin" />
                        : productionSynced
                          ? <RotateCcw className="h-4 w-4" />
                          : <RefreshCw className="h-4 w-4" />}
                      {productionSynced ? t("撤销同步") : t("同步到生产驾驶舱")}
                    </DropdownMenuItem>
                  )}
                  {!productionMirror && canReassign && onReassignTask && task.status !== "completed" && (
                    <DropdownMenuItem onSelect={() => onReassignTask(task)}>
                      <UserCog className="h-4 w-4" />
                      {t("转派")}
                    </DropdownMenuItem>
                  )}
                  {!productionMirror && showDeleteTaskAction && onDeleteTask && (
                    <DropdownMenuItem variant="destructive" onSelect={() => onDeleteTask(task)}>
                      <Trash2 className="h-4 w-4" />
                      {t("删除")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <h3 className="line-clamp-2 break-words text-balance text-[15px] font-bold leading-snug text-slate-900">
            <AutoTranslatedText text={visibleTaskTitle} />
          </h3>

          {/* ─── 备注回执状态条（管理视角：他人给任务留的备注是否被目标人查看/跟进） ─── */}
          {(() => {
            const receipt = noteReceipts[task.task_id];
            if (!receipt) return null;
            const unread = receipt.state === "unread";
            return (
              <div
                className={cn(
                  "rd-horizon-note-receipt flex items-center gap-1.5 rounded-md border-l-[3px] px-2.5 py-1.5 text-xs font-medium",
                  unread ? "border-red-400 bg-red-50 text-red-700" : "border-amber-400 bg-amber-50 text-amber-700",
                )}
                title={`${receipt.author_name}${t("的备注")}：${receipt.excerpt}`}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", unread ? "bg-red-500" : "bg-amber-500")} />
                <span className="truncate">
                  {receipt.author_name}{t("的备注")} · {unread ? t("待查看") : t("已查看")} · {t("给")}{receipt.target_name}
                </span>
              </div>
            );
          })()}

          {/* 摘要优先使用最新进度，其次使用下一步与任务描述。 */}
          <AutoTranslatedText
            as="p"
            text={cardSummary}
            className="rd-horizon-task-summary line-clamp-2 min-h-10 break-words text-pretty text-xs leading-5 text-slate-500"
          />

          {hasLoadedAttachments && (
            <TaskAttachmentStrip
              attachments={taskAttachments}
              totalCount={taskAttachmentCount}
              loadingFull={attachmentLoadingTaskId === task.task_id}
              priority={taskIdx < 2}
              onOpenGallery={(startIdx) => {
                void openCompleteImageGallery(
                  task,
                  taskImages,
                  startIdx,
                  taskAttachmentCount,
                );
              }}
              onOpenAll={() => {
                void openCompleteAttachmentCollection(
                  task,
                  taskAttachmentCount,
                );
              }}
            />
          )}

          {/* ─── 进度条：与参考卡片一致，放在执行信息之前 ─── */}
          <div className="mt-auto flex items-center gap-2 pt-0.5">
            <div className="rd-horizon-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <motion.div
                className={cn("rd-horizon-task-progress h-full rounded-full", task.progress === 100 && "rd-horizon-task-progress--complete")}
                initial={shouldReduceMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: task.progress / 100 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.28, ease: RD_MOTION_EASE, delay: taskIdx * 0.02 }}
                style={{
                  width: "100%",
                  transformOrigin: "left center",
                  background: task.progress === 100 ? "#10b981" : accentColor,
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">
              {task.progress}%
            </span>
          </div>

          {/* 参考卡片尾部：优先级 / 截止 / 风险在左，更新人与头像在右。 */}
          <div className="rd-horizon-task-footer flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <span
              data-priority={priorityKey}
              className={cn("rd-horizon-priority inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", pCfg.bg, pCfg.text)}
            >
              <Flame className="h-3 w-3" />
              {t(`${pCfg.label}优先`)}
            </span>
            {task.due_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3 text-slate-400" />
                {t("截止：")}{task.due_date.slice(5)}
              </span>
            )}
            {isRisk && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-600">
                <AlertTriangle className="h-3 w-3" />
                {t("风险")}
              </span>
            )}
            {/* 协同专属：阻塞时长显性化（其他驾驶舱不显示） */}
            {isUsCollabWorkspace() && task.status === "paused_blocked" && blockedDaysOf(task) != null && (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                {t("已阻塞 {n} 天", { n: blockedDaysOf(task) })}
              </span>
            )}
            {workItemsFeatureEnabled() && workItems.length > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                title={t("工作项 {done}/{total}", { done: completedWorkItemCount, total: workItems.length })}
              >
                <ListChecks className="h-3 w-3" />
                {completedWorkItemCount}/{workItems.length}
              </span>
            )}
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-slate-400">
              {relativeUpdate && (
                // shrink-0 + nowrap：这行与头像、姓名共享空间，不锁住就会被挤成
                // 「更新：19 天 / 前」这样的折行。空间不足时让姓名去截断（它有 truncate）。
                <span className={cn("shrink-0 whitespace-nowrap", RELATIVE_UPDATE_TONE_CLASS[relativeUpdate.tone])}>
                  {t("更新：")}{relativeUpdate.label}
                </span>
              )}
              <OwnerAvatar
                name={task.latest_progress_summary?.actor_name || task.primary_owner}
                userId={task.latest_progress_summary
                  ? task.latest_progress_summary.actor_user_id
                  : task.primary_owner_user_id}
                size="xs"
              />
              <span
                className="min-w-0 max-w-[72px] truncate font-medium text-slate-600 xl:max-w-[8rem]"
                title={displayPersonName(task.latest_progress_summary?.actor_name || task.primary_owner)}
              >
                {displayPersonName(task.latest_progress_summary?.actor_name || task.primary_owner)}
              </span>
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <>
      {/* ── Gallery Lightbox ──
          必须真的 portal 到 body：就地渲染时 z-[90] 会被祖先的 motion 动画
          （transform / opacity 都会新建层叠上下文）关在里面，于是同样 portal 到
          body 的「退出大屏」按钮（z-40）反而画在上层，盖住右上角的关闭按钮 ——
          大屏模式下看图就关不掉。层级数值维持本文件既有阶梯（弹窗 60/70/80 →
          附件集合 85 → 看图 90），无需抬高。
          AnimatePresence 连同子组件整体搬进 portal，退场动画的父子关系不变。 */}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {galleryState && (
            <ImageGallery
              images={galleryState.images}
              startIndex={galleryState.startIndex}
              onClose={() => setGalleryState(null)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
      {attachmentCollectionState && (
        <TaskAttachmentCollectionDialog
          taskTitle={attachmentCollectionState.taskTitle}
          attachments={attachmentCollectionState.attachments}
          onClose={() => setAttachmentCollectionState(null)}
        />
      )}

      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={RD_PANEL_TRANSITION}
        className="rd-horizon-task-stream overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]"
      >
        <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-0">

          {/* ── INS Stories-style 人员导航栏 (with visible horizontal scrollbar) ──
              外层 flex 承载底边框/底色：头像区可横向滚动，右端搜索控件钉死不随之滚走。 */}
          <div className="rd-horizon-people-nav flex w-full min-w-0 flex-col items-stretch border-b border-blue-100 bg-slate-50/50 sm:flex-row sm:items-center sm:pr-4">
          <TabsList className="rd-horizon-people-list flex h-auto min-w-0 flex-1 snap-x snap-proximity justify-start gap-0 overflow-x-auto overscroll-x-contain rounded-none border-none bg-transparent px-4 pt-4 pb-2 touch-pan-x [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/70 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400">

            {/* 管理员视角 — 所有活跃任务入口；详情沿用原权限规则，不附加成员筛选 */}
            <TabsTrigger
              value="all"
              className="rd-horizon-person-tab flex min-h-11 min-w-24 shrink-0 snap-start flex-col items-center gap-1.5 rounded-none border-none bg-transparent px-3 py-0 shadow-none outline-none ring-0 transition-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 data-[state=active]:bg-transparent"
            >
              <div className="relative">
                <div
                  className="rd-horizon-admin-ring rd-horizon-avatar-ring flex h-[54px] w-[54px] items-center justify-center rounded-full p-[2.5px] transition-colors duration-200"
                  style={{
                    background: activeTab === "all"
                      ? "#002fa7"
                      : risks.length > 0
                        ? "#dc2626"
                        : "#94a3b8",
                  }}
                >
                  <div className={cn(
                    "flex h-full w-full items-center justify-center rounded-full bg-white transition-[padding]",
                    activeTab === "all" ? "p-[2px]" : "p-0",
                  )}>
                    <div className="rd-horizon-avatar-core flex h-full w-full items-center justify-center rounded-full bg-blue-50">
                      <ListChecks className={cn("h-5 w-5 transition-colors", activeTab === "all" ? "text-[#002fa7]" : "text-slate-500")} />
                    </div>
                  </div>
                </div>
                {/* Total tasks badge */}
                {allActiveTasks.length > 0 && (
                  <span className="rd-horizon-total-count absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#002fa7] px-0.5 text-[9px] font-black text-white">
                    {allActiveTasks.length > 99 ? "99+" : allActiveTasks.length}
                  </span>
                )}
                {/* Risk indicator dot top-right */}
                {risks.length > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-black text-white"
                    title={t("{count} 个风险任务", { count: risks.length })}
                  >
                    {risks.length > 99 ? "99+" : risks.length}
                  </span>
                )}
              </div>
              <span className={cn("rd-horizon-person-name text-[10px] font-semibold leading-none", activeTab === "all" ? "text-[#002fa7]" : "text-slate-500")}>
                {t("管理员视角")}
              </span>
            </TabsTrigger>

            {/* Per-person Stories avatars */}
            {personLoads.map((p) => {
              const ratio = p.max > 0 ? p.count / p.max : 0;
              const accentColor = loadRingColor(ratio, p.onLeave);
              const isActive = activeTab === p.key;
              const initial = p.name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
              const avatarUrl = resolveAvatar(p.name, p.user_id);
              return (
                <TabsTrigger
                  key={p.key}
                  value={p.key}
                  className="rd-horizon-person-tab flex min-h-11 min-w-24 shrink-0 snap-start flex-col items-center gap-1.5 rounded-none border-none bg-transparent px-3 py-0 shadow-none outline-none ring-0 transition-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 data-[state=active]:bg-transparent"
                >
                  <div className="relative">
                    <div
                      className="rd-horizon-avatar-ring flex h-[54px] w-[54px] items-center justify-center rounded-full transition-[padding] duration-200"
                      style={{
                        background: p.onLeave ? "#e2e8f0" : accentColor,
                        padding: isActive ? "2.5px" : "2px",
                      }}
                    >
                      <div className={cn("flex h-full w-full items-center justify-center rounded-full bg-white", isActive ? "p-[2px]" : "p-[1.5px]")}>
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={p.name}
                            loading="lazy"
                            className={cn("h-full w-full rounded-full object-cover", p.onLeave && "opacity-50")}
                          />
                        ) : (
                          <div className={cn("flex h-full w-full items-center justify-center rounded-full text-sm font-bold text-white select-none", hashColor(p.name), p.onLeave && "opacity-50")}>
                            {initial}
                          </div>
                        )}
                      </div>
                    </div>
                    {p.count > 0 && (
                      <span
                        className="rd-horizon-load-count absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-black text-white"
                        style={{ background: accentColor }}
                      >
                        {p.count}
                      </span>
                    )}
                    {p.onLeave && (
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-sm bg-amber-400 px-1 text-[8px] font-black text-white leading-none py-0.5">
                        {t("假")}
                      </span>
                    )}
                  </div>
                  <span className={cn("rd-horizon-person-name max-w-[56px] truncate text-[10px] font-semibold leading-none", isActive ? "text-[#002fa7]" : "text-slate-500")}>
                    {p.name}
                  </span>
                  {isActive && (
                    <motion.span
                      layoutId="cockpit-tab-dot"
                      className="rd-horizon-person-indicator mt-0 h-1 w-4 rounded-full"
                      style={{ background: accentColor }}
                      transition={{ duration: 0.22, ease: RD_MOTION_EASE }}
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* 任务搜索：默认仅一枚圆形图标，点击展开为小输入框；为空失焦自动缩回 */}
          <div className="rd-horizon-search flex w-full shrink-0 items-center px-4 pb-3 sm:ml-2 sm:w-auto sm:px-0 sm:pb-0">
            {searchOpen || cockpitSearch ? (
              <label className="relative block w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={cockpitKeyword}
                  onChange={(e) => setCockpitKeyword(e.target.value)}
                  onCompositionStart={startSearchComposition}
                  onCompositionEnd={(e) => endSearchComposition(e.currentTarget.value)}
                  onBlur={() => { if (!searchComposingRef.current && !cockpitKeyword.trim()) setSearchOpen(false); }}
                  onKeyDown={(e) => {
                    if (searchComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeSearchAndRestoreFocus();
                    }
                  }}
                  placeholder={t("搜索任务全部内容")}
                  aria-label={t("搜索任务全部内容")}
                  aria-describedby="rd-cockpit-search-results"
                  className="min-h-11 w-full rounded-full border border-slate-200 bg-white pl-8 pr-16 text-xs text-slate-700 shadow-sm outline-none transition-[border-color,box-shadow] focus:border-[#002fa7]/50 focus:ring-2 focus:ring-blue-100 sm:w-52"
                />
                <span
                  id="rd-cockpit-search-results"
                  className={cn(
                    "rd-horizon-search-count pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-[#002fa7]",
                    !cockpitSearch && "sr-only",
                  )}
                  aria-live="polite"
                >
                  {searchPending ? t("筛选中…") : t("{n} 条", { n: cockpitHitCount })}
                </span>
                {cockpitKeyword ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCockpitKeyword("");
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                    aria-label={t("清空搜索")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>
            ) : (
              <button
                ref={searchTriggerRef}
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                title={t("搜索任务全部内容（描述、人员、进度、工作项等）")}
                aria-label={t("搜索任务")}
              >
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>
          </div>

          {/* ── 当前 KPI 筛选条 ── */}
          {kpiFilter !== "all" && (
            <div className="rd-horizon-filter-bar flex flex-col items-stretch justify-between gap-3 border-b border-blue-100 bg-blue-50/50 px-4 py-2 text-xs sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rd-horizon-filter-label inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#002fa7] ring-1 ring-blue-200">
                  <ListChecks className="h-3 w-3" />
                  {t("当前筛选：")}
                  <span className="ml-0.5">{t(KPI_FILTER_LABEL[kpiFilter])}</span>
                </span>
                <span className="truncate text-slate-500">
                  {t("共 {count} 个任务符合此筛选", { count: allActiveTasks.length })}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {kpiFilter === "completed" && canReassign && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleBackfillScores(false)}
                      disabled={backfillBusy}
                      className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-white px-2 text-[11px] font-semibold text-[#002fa7] transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("一键执行：① 自动抽取附件文本（OCR/文档/视觉） → ② 调 AI 评分。已抽取/已评分的会跳过（幂等）。")}
                    >
                      {backfillBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {backfillBusy ? t("抽取+评分中…") : t("AI 复盘评分")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            t("将对【所有已完成任务】按最新评分标准重新评分，并覆盖现有分数（消耗 AI 额度、耗时较长）。\n通常仅在评分标准调整后执行一次。确定继续？"),
                          )
                        ) {
                          void handleBackfillScores(true);
                        }
                      }}
                      disabled={backfillBusy}
                      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-white px-2 text-[11px] font-semibold text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("强制重算：对所有已完成任务按最新评分标准重新评分并覆盖旧分。用于评分标准升级后统一刷新历史分。")}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t("按新标准重算")}
                    </button>
                    <button
                      type="button"
                      onClick={handleBatchExportReports}
                      disabled={batchExportBusy}
                      className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-white px-2 text-[11px] font-semibold text-[#002fa7] transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title={t("把当前范围（管理员视角 / 选中成员）已完成且已评分的任务，汇总成一份多页正式报告，可在打印对话框中选择「另存为 PDF」下载。")}
                    >
                      {batchExportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                      {batchExportBusy ? t("汇总中…") : t("批量导出报告")}
                    </button>
                  </>
                )}
                {canReassign && (
                  <button
                    type="button"
                    onClick={handleBackfillExtraction}
                    disabled={extractionBackfillBusy}
                    className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7] disabled:cursor-not-allowed disabled:opacity-60"
                    title={t("仅抽取附件文本（不触发评分）。用于进行中/暂停任务的附件抽取，便于知识库 RAG 检索；已完成任务请直接用 AI 复盘评分（已包含抽取）。")}
                  >
                    {extractionBackfillBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {extractionBackfillBusy ? t("抽取中…") : t("仅抽取附件")}
                  </button>
                )}
                {onClearKpiFilter && (
                  <button
                    type="button"
                    onClick={onClearKpiFilter}
                    className="rd-horizon-brand-control inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    <X className="h-3 w-3" />
                    {t("清除筛选")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Animated tab content area ── */}
          <div className="rd-horizon-task-feed relative min-w-0 overflow-hidden bg-slate-50/40" aria-busy={searchPending}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeTab}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: RD_MOTION_EASE }}
              >

                {/* ── "全部" Tab — 全部活跃任务，按更新时间倒序 ── */}
                {activeTab === "all" && (() => {
                  const visibleCount = visibleCounts["all"] ?? taskPageSize;
                  const shownTasks = allActiveTasks.slice(0, visibleCount);
                  const hasMore = visibleCount < allActiveTasks.length;
                  const allAccentColor = "#002fa7";

                  return (
                    <div>
                      <AnimatePresence>
                        {loadingNotes && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={RD_FAST_TRANSITION}
                            className="rd-horizon-loading-strip flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] text-[#002fa7]"
                            role="status"
                            aria-live="polite"
                          >
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            {t("正在加载任务附件图片…")}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {allActiveTasks.length === 0 ? (
                        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-slate-500" role="status">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-[#002fa7]">
                            <Search className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <h3 className="text-balance text-base font-semibold text-slate-900">
                            {cockpitSearch
                              ? t("没有匹配「{keyword}」的任务", { keyword: cockpitSearch })
                              : kpiFilter === "all"
                                ? t("暂无任务")
                                : t("当前筛选「{filter}」下暂无任务", { filter: t(KPI_FILTER_LABEL[kpiFilter]) })}
                          </h3>
                          <p className="max-w-md text-pretty text-xs leading-5 text-slate-500">
                            {cockpitSearch
                              ? t("请调整关键词，或清除搜索查看当前范围内的全部任务。")
                              : kpiFilter === "all"
                                ? t("当前工作区还没有可展示的非归档任务。")
                                : t("请清除筛选，或切换其他决策指标继续查看。")}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                          {cockpitSearch && (
                            <button
                              type="button"
                              onClick={closeSearchAndRestoreFocus}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                            >
                              <X className="h-3 w-3" />
                              {t("清除搜索")}
                            </button>
                          )}
                          {kpiFilter !== "all" && onClearKpiFilter && (
                            <button
                              type="button"
                              onClick={onClearKpiFilter}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                            >
                              <X className="h-3 w-3" />
                              {t("清除筛选")}
                            </button>
                          )}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={setScrollRef}
                          className="cockpit-scroll overflow-y-auto transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                          style={flowHeightStyle(headerCollapsed)}
                          onScroll={(e) => handleTaskScroll(e, "all", allActiveTasks.length)}
                        >
                          <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 py-4" : "gap-2.5 px-4 py-3")}>
                            {distributeIntoColumns(shownTasks, masonryColumns).map((column, colIdx) => (
                              <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                <AnimatePresence>
                                  {column.map((task, rowIdx) =>
                                    renderTaskCard(task, colIdx + rowIdx * masonryColumns, allAccentColor),
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>

                          {hasMore ? (
                            <button
                              type="button"
                              onClick={() => loadNextTaskPage("all", allActiveTasks.length)}
                              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 py-3.5 text-[11px] text-slate-400 transition-colors hover:bg-blue-50/50 hover:text-[#002fa7]"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>{t("继续向下滚动 · 已显示")} <span className="font-semibold tabular-nums text-slate-500">{shownTasks.length}</span> / {t("共")} <span className="font-semibold tabular-nums text-slate-500">{allActiveTasks.length}</span> {t("个任务")}</span>
                            </button>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5 py-3.5 text-[11px] text-slate-400">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              <span>
                                {t("已显示全部")} <span className="font-semibold tabular-nums text-slate-500">{allActiveTasks.length}</span> {t("个任务")}
                                {kpiFilter === "all" && !cockpitSearch && risks.length > 0 && (
                                  <> · <span className="text-red-500 font-semibold">{t("{n} 个风险", { n: risks.length })}</span></>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Per-person Tab ── */}
                {activeTab !== "all" && (() => {
                  const p = personLoads.find((x) => x.key === activeTab);
                  if (!p) return null;
                  const segments = personTasksMap.get(p.key) ?? { primary: [], collaborating: [] };
                  const primaryTasks = segments.primary;
                  const collabTasks = segments.collaborating;
                  const tasks = [...primaryTasks, ...collabTasks];
                  // 分页只驱动主责段：协助段是下钻上下文，展开后一次给完。
                  const visibleCount = visibleCounts[p.key] ?? taskPageSize;
                  const shownTasks = primaryTasks.slice(0, visibleCount);
                  const hasMore = visibleCount < primaryTasks.length;
                  const collabExpanded = expandedCollabTabs.has(p.key);
                  const ratio = p.max > 0 ? p.count / p.max : 0;
                  const accentColor = loadRingColor(ratio, p.onLeave);
                  const initial = p.name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
                  return (
                    <div>
                      {/* 附件图片加载中提示 */}
                      <AnimatePresence>
                        {loadingNotes && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={RD_FAST_TRANSITION}
                            className="rd-horizon-loading-strip flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-[11px] text-[#002fa7]"
                            role="status"
                            aria-live="polite"
                          >
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            {t("正在加载任务附件图片…")}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Task list — 与"全部"相同的 INS 风格滚动 feed */}
                      {tasks.length === 0 ? (
                        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-slate-500" role="status">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-[#002fa7]">
                            <Users className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <h3 className="text-balance text-base font-semibold text-slate-900">
                            {cockpitSearch
                              ? t("该成员下没有匹配「{keyword}」的任务", { keyword: cockpitSearch })
                              : kpiFilter === "all" ? t("该成员当前暂无任务") : t("该成员当前筛选「{filter}」下暂无任务", { filter: t(KPI_FILTER_LABEL[kpiFilter]) })}
                          </h3>
                          <p className="max-w-md text-pretty text-xs leading-5 text-slate-500">
                            {cockpitSearch
                              ? t("请调整关键词，或清除搜索查看该成员的主责与协助任务。")
                              : kpiFilter === "all"
                                ? t("该成员当前没有符合工作区范围的任务。")
                                : t("请清除筛选，或切换其他人员继续查看。")}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                          {cockpitSearch && (
                            <button
                              type="button"
                              onClick={closeSearchAndRestoreFocus}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                            >
                              <X className="h-3 w-3" />
                              {t("清除搜索")}
                            </button>
                          )}
                          {kpiFilter !== "all" && onClearKpiFilter && (
                            <button
                              type="button"
                              onClick={onClearKpiFilter}
                              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                            >
                              <X className="h-3 w-3" />
                              {t("清除筛选")}
                            </button>
                          )}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={setScrollRef}
                          className="cockpit-scroll overflow-y-auto transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                          style={flowHeightStyle(headerCollapsed)}
                          onScroll={(e) => handleTaskScroll(e, p.key, primaryTasks.length)}
                        >
                          {/* ── 主责段：领导最关心「这个人负责什么」，占第一屏 ── */}
                          <div className="flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold text-slate-500">
                            <span className="h-3 w-0.5 rounded-full bg-[#002fa7]" />
                            <span>{t("主责")}</span>
                            <span className="tabular-nums text-slate-400">{primaryTasks.length}</span>
                          </div>
                          {primaryTasks.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[12px] text-slate-400">{t("该成员当前没有主责任务")}</div>
                          ) : (
                            <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 py-4" : "gap-2.5 px-4 py-3")}>
                              {distributeIntoColumns(shownTasks, masonryColumns).map((column, colIdx) => (
                                <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                  <AnimatePresence>
                                    {column.map((task, rowIdx) =>
                                      renderTaskCard(task, colIdx + rowIdx * masonryColumns, accentColor),
                                    )}
                                  </AnimatePresence>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* ── 协助段：默认折叠，但折叠态也要露出数量，一眼知道他还搭了几件事 ── */}
                          {collabTasks.length > 0 && (
                            <div className="border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => toggleCollabSegment(p.key)}
                                aria-expanded={collabExpanded}
                                className="flex w-full items-center gap-2 px-4 py-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                              >
                                <span className="h-3 w-0.5 rounded-full bg-slate-300" />
                                <span>{t("协助")}</span>
                                <span className="tabular-nums text-slate-400">{collabTasks.length}</span>
                                <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", collabExpanded && "rotate-180")} />
                              </button>
                              {collabExpanded && (
                                <div className={cn("rd-horizon-masonry flex items-start", spaciousCards ? "gap-4 px-4 pb-4" : "gap-2.5 px-4 pb-3")}>
                                  {distributeIntoColumns(collabTasks, masonryColumns).map((column, colIdx) => (
                                    <div key={colIdx} className={cn("rd-horizon-masonry-column flex min-w-0 flex-1 flex-col", spaciousCards ? "gap-4" : "gap-2.5")}>
                                      <AnimatePresence>
                                        {column.map((task, rowIdx) =>
                                          renderTaskCard(task, colIdx + rowIdx * masonryColumns, accentColor),
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 底部状态 */}
                          {hasMore ? (
                            <button
                              type="button"
                              onClick={() => loadNextTaskPage(p.key, primaryTasks.length)}
                              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 py-3.5 text-[11px] text-slate-400 transition-colors hover:bg-blue-50/50 hover:text-[#002fa7]"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>{t("继续向下滚动 · 已显示主责")} <span className="font-semibold tabular-nums text-slate-500">{shownTasks.length}</span> / {t("共")} <span className="font-semibold tabular-nums text-slate-500">{primaryTasks.length}</span> {t("个任务")}</span>
                            </button>
                          ) : tasks.length > 0 ? (
                            <div className="flex items-center justify-center gap-1.5 py-3.5 text-[11px] text-slate-400">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              <span>
                                {t("已显示全部主责")} <span className="font-semibold tabular-nums text-slate-500">{primaryTasks.length}</span> {t("个任务")}
                                {/* 角标 = 主责且活跃；本段是其超集（另含已完成），故两数可以不同 */}
                                {kpiFilter === "all" && !cockpitSearch && (
                                  <> · {t("其中活跃 {count} 个（= 头像角标）", { count: p.count })}</>
                                )}
                                {collabTasks.length > 0 && <> · {t("另协助 {count} 个", { count: collabTasks.length })}</>}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </motion.div>
            </AnimatePresence>
          </div>
        </Tabs>
      </motion.div>
    </>
  );
}

// ─── Local helper functions (shared with migrated modals) ────────────────────
function rdPersonOptionValue(person: RdPersonLoad): string {
  return person.user_id ? `uid:${person.user_id}` : `name:${person.name}`;
}
function findRdPersonByOptionValue(people: RdPersonLoad[], value: string): RdPersonLoad | undefined {
  return people.find((p) => rdPersonOptionValue(p) === value);
}
function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── ReassignableTask type ────────────────────────────────────────────────────
type ReassignableTask = { task_id: string; title: string; owner: string; priority: Priority };

// ─── TaskReassignModal ────────────────────────────────────────────────────────
function TaskReassignModal({
  onClose,
  initialTaskId,
  allTasks,
  onUpdated,
  horizonVariant = false,
}: {
  onClose: () => void;
  initialTaskId?: string | null;
  allTasks: Task[];
  onUpdated?: () => void;
  horizonVariant?: boolean;
}) {
  const assignableTasks: ReassignableTask[] = allTasks
    .filter((t) => !isProductionMirrorTask(t) && !t.archived && t.status !== "completed")
    .map((t) => ({ task_id: t.task_id, title: taskVisibleTitle(t), owner: t.primary_owner, priority: t.final_priority }));
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(
    () => new Set(initialTaskId ? [initialTaskId] : []),
  );
  const [targetPerson, setTargetPerson] = useState<RdPersonLoad | null>(null);
  const [people, setPeople] = useState<RdPersonLoad[]>([]);
  const [peopleError, setPeopleError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  // 任务过滤：关键字 + 当前负责人 + 优先级（任务多时可快速定位）；已勾选项不受过滤影响
  const [taskKeyword, setTaskKeyword] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const taskOwners = Array.from(new Set(assignableTasks.map((t) => t.owner))).sort((a, b) =>
    a === "待指派" ? -1 : b === "待指派" ? 1 : a.localeCompare(b, "zh-CN"),
  );
  const keyword = taskKeyword.trim().toLowerCase();
  const visibleTasks = assignableTasks.filter(
    (t) =>
      (!keyword || t.title.toLowerCase().includes(keyword)) &&
      (ownerFilter === "all" || t.owner === ownerFilter) &&
      (priorityFilter === "all" || t.priority === priorityFilter),
  );
  const allVisibleSelected = visibleTasks.length > 0 && visibleTasks.every((t) => selectedTasks.has(t.task_id));
  const toggleSelectVisible = () =>
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleTasks.forEach((t) => next.delete(t.task_id));
      else visibleTasks.forEach((t) => next.add(t.task_id));
      return next;
    });

  useEffect(() => {
    fetchRdPeople()
      .then((data) => { setPeople(data); setPeopleError(false); })
      .catch(() => { setPeople([]); setPeopleError(true); });
  }, []);

  const selectedAssignable = assignableTasks.filter((t) => selectedTasks.has(t.task_id));
  const targetIsCurrentOwner =
    Boolean(targetPerson) &&
    selectedAssignable.length > 0 &&
    selectedAssignable.every((t) => t.owner === targetPerson?.name);
  const hasPendingAssign = selectedAssignable.some((t) => t.owner === "待指派");

  const toggleTask = (id: string) =>
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleConfirm = async () => {
    if (selectedTasks.size === 0 || !targetPerson || targetIsCurrentOwner) return;
    setSaving(true);
    try {
      const results = await Promise.allSettled(
        selectedAssignable.map((t) =>
          updateRdTask(t.task_id, {
            primary_owner: targetPerson.name,
            primary_owner_user_id: targetPerson.user_id ?? null,
            status: "in_progress",
          }),
        ),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.warning(t("{succeeded} 个任务转派成功，{failed} 个失败，请检查后重试", { succeeded, failed }));
      } else {
        onUpdated?.();
        setConfirmed(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("转派失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="rd-task-overlay-surface gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl sm:max-w-lg [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <DialogTitle className="font-semibold text-slate-800">{t("批量转派任务")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("选择一个或多个任务，并指定新的负责人。")}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label={t("关闭批量转派任务")}
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {!confirmed ? (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">{t("选择任务")}</span>
                  {selectedTasks.size > 0 && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">{t("已选 {n} 个", { n: selectedTasks.size })}</span>
                  )}
                </div>
                {/* 过滤工具行：任务多时按关键字/负责人/优先级快速定位；勾选状态不随过滤丢失 */}
                {assignableTasks.length > 5 && (
                  <div className="mb-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={taskKeyword}
                          onChange={(e) => setTaskKeyword(e.target.value)}
                          placeholder={t("搜索任务标题…")}
                          className="h-8 rounded-lg pl-8 text-sm"
                        />
                      </div>
                      <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                        <SelectTrigger
                          size="sm"
                          aria-label={t("按负责人筛选")}
                          className="h-8 w-auto max-w-[160px] shrink-0 rounded-lg text-sm text-slate-600"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={cn("rounded-xl border border-slate-200 bg-white p-1 shadow-lg", horizonVariant && "rd-horizon-detail-select")}>
                          <SelectItem value="all">{t("全部负责人")}</SelectItem>
                          {taskOwners.map((name) => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {([
                        { key: "all", label: "全部" },
                        { key: "high", label: "高优先" },
                        { key: "medium", label: "中优先" },
                        { key: "low", label: "低优先" },
                      ] as const).map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          aria-pressed={priorityFilter === p.key}
                          onClick={() => setPriorityFilter(p.key)}
                          className={cn(
                            "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                            priorityFilter === p.key
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                          )}
                        >
                          {t(p.label)}
                        </button>
                      ))}
                      <span className="ml-auto text-[11px] text-slate-400">{visibleTasks.length} / {assignableTasks.length} {t("个")}</span>
                      <button
                        type="button"
                        onClick={toggleSelectVisible}
                        disabled={visibleTasks.length === 0}
                        className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {allVisibleSelected ? t("取消全选") : t("全选当前")}
                      </button>
                    </div>
                  </div>
                )}
                <div className="cockpit-scroll space-y-2 overflow-y-auto" style={{ maxHeight: "min(280px, 40vh)" }}>
                  {assignableTasks.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">{t("暂无可转派任务")}</p>
                  ) : visibleTasks.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">{t("没有匹配的任务，试试调整筛选条件")}</p>
                  ) : visibleTasks.map((taskItem) => (
                    <label key={taskItem.task_id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                      <Checkbox
                        checked={selectedTasks.has(taskItem.task_id)}
                        onCheckedChange={() => toggleTask(taskItem.task_id)}
                        className="border-slate-300"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <AutoTranslatedText as="div" className="truncate text-sm text-slate-800" text={taskItem.title} />
                          <PriorityPill priority={taskItem.priority} />
                        </div>
                        <div className="text-xs text-slate-400">
                          {taskItem.owner === "待指派" ? t("待指派") : t("当前负责人 {name}", { name: taskItem.owner })}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("选择目标负责人")}</div>
                {peopleError && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {t("人员数据加载失败，请关闭后重试")}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {people.filter((p) => !p.on_leave).map((p) => {
                    const isNoop = selectedAssignable.length > 0 && selectedAssignable.every((t) => t.owner === p.name);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={targetPerson?.id === p.id}
                        disabled={isNoop}
                        onClick={() => !isNoop && setTargetPerson(p)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          isNoop && "cursor-not-allowed opacity-45",
                          targetPerson?.id === p.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50",
                        )}
                      >
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{t(p.position)}</span>
                          <span className={cn("font-semibold", p.max_tasks > 0 && p.task_count / p.max_tasks >= 0.75 ? "text-orange-500" : "text-emerald-600")}>
                            {t("{n} 个任务", { n: p.task_count })}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { if (!saving) onClose(); }}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  {t("取消")}
                </button>
                <button
                  type="button"
                  disabled={selectedTasks.size === 0 || !targetPerson || targetIsCurrentOwner || saving}
                  onClick={handleConfirm}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.20)] transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {saving ? t("处理中...") : hasPendingAssign ? t("确认指派") : t("确认转派")}
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
              <p className="font-semibold text-slate-800">{t("操作成功")}</p>
              <p className="mt-1 text-sm text-slate-500">
                {t("已将 {n} 个任务转派给 {name}，操作已记录。", { n: selectedAssignable.length, name: targetPerson?.name ?? "" })}
              </p>
              <button type="button" onClick={onClose} className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">{t("关闭")}</button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ClearDataDialog ──────────────────────────────────────────────────────────
function ClearDataDialog({ onClose, onCleared }: { onClose: () => void; onCleared: () => void }) {
  const usCollab = isUsCollabWorkspace();
  const productionWorkspace = isProductionWorkspace();
  const moduleName = usCollab
    ? t("协同任务模块")
    : productionWorkspace
      ? t("生产任务模块")
      : t("研发任务模块");
  const workspaceName = usCollab ? t("协同") : productionWorkspace ? t("生产") : t("研发");
  const shouldReduceMotion = useReducedMotion();
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [cooldown, setCooldown] = useState(0); // 关键词输入正确后的 3 秒冷却
  const KEYWORD = t("确认清空");
  const keywordMatched = confirmText.trim() === KEYWORD;
  const ready = keywordMatched && cooldown === 0;

  // 关键词刚输完整时启动 3 秒冷却，给用户后悔窗口
  useEffect(() => {
    if (!keywordMatched) {
      setCooldown(0);
      return;
    }
    setCooldown(3);
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [keywordMatched]);

  const handleClear = async () => {
    // 多防线：keyword + cooldown + clearing 状态都校验
    if (!keywordMatched || cooldown > 0 || clearing) return;
    setClearing(true);
    try {
      await clearRdAllTaskData();
      toast.success(t("{moduleName}数据已全部清空", { moduleName: t(moduleName) }));
      onCleared();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("清空失败"));
      setConfirmText("");
      setClearing(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
      className="rd-task-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={RD_PANEL_TRANSITION}
        className="rd-task-overlay-surface w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-task-data-title"
      >
        <div className="flex items-center gap-3 border-b border-red-100 bg-red-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <div id="clear-task-data-title" className="font-semibold text-red-800">{t("清空{moduleName}数据", { moduleName: t(moduleName) })}</div>
            <div className="text-xs text-red-600">{t("此操作不可恢复，需拥有数据清空权限")}</div>
          </div>
        </div>
        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 leading-relaxed">
            <p className="font-semibold mb-1">{t("将被清空的数据：")}</p>
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              <li>{t("所有{workspaceName}任务分类、子项目及任务", { workspaceName: t(workspaceName) })}</li>
              <li>{t("{workspaceName}工作台任务数据与进展留痕", { workspaceName: t(workspaceName) })}</li>
              <li>{t("{workspaceName}驾驶舱看板、日报与立项草稿", { workspaceName: t(workspaceName) })}</li>
            </ul>
            <p className="mt-2 text-xs text-red-500">
              {t("注：消息历史保留，相关审核待办会自动标记为已处理；人员档案、审批流、AI 策略和操作审计日志不受影响。")}
            </p>
          </div>
          <div>
            <label htmlFor="clear-task-data-confirm" className="mb-1.5 block text-sm font-medium text-slate-700">
              {t("请输入「")}<span className="font-bold text-red-600">{KEYWORD}</span>{t("」以继续")}
            </label>
            <Input
              id="clear-task-data-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={KEYWORD}
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={clearing}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">
            {t("取消")}
          </button>
          <button type="button" onClick={handleClear} disabled={!ready || clearing}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.20)] transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">
            {clearing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {clearing ? t("清空中…") : cooldown > 0 ? t("{n} 秒后可执行", { n: cooldown }) : t("确认清空")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── ProductManageDialog ──────────────────────────────────────────────────────

type ProductFormState = {
  id: string;
  name: string;
  description: string;
  status: RdProductStatus;
};

function ProductManageDialog({
  open,
  products,
  onClose,
  onSave,
  horizonVariant = false,
}: {
  open: boolean;
  products: ProductDef[];
  onClose: () => void;
  onSave: (products: ProductDef[]) => Promise<void>;
  horizonVariant?: boolean;
}) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProductFormState>({
    id: "",
    name: "",
    description: "",
    status: "developing",
  });

  const openNew = () => {
    setEditingId(null);
    setForm({ id: "", name: "", description: "", status: "developing" });
    setView("form");
  };

  const openEdit = (prod: ProductDef) => {
    setEditingId(prod.id);
    setForm({
      id: prod.id,
      name: prod.name,
      description: prod.description ?? "",
      status: prod.status ?? "developing",
    });
    setView("form");
  };

  const handleSaveForm = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      let next: ProductDef[];
      if (editingId) {
        next = products.map((p) =>
          p.id === editingId
            ? { ...p, name: form.name.trim(), description: form.description.trim() || undefined, status: form.status, updatedAt: now }
            : p,
        );
      } else {
        const newProd: ProductDef = {
          id: crypto.randomUUID(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          status: form.status,
          createdAt: now,
          updatedAt: now,
        };
        next = [...products, newProd];
      }
      await onSave(next);
      setView("list");
      toast.success(editingId ? t("产品已更新") : t("产品已创建"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (products.length <= 1) return;
    const next = products.filter((p) => p.id !== id);
    try {
      await onSave(next);
      toast.success(t("产品已删除"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("删除失败，请重试"));
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="product-manage-backdrop"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={RD_FAST_TRANSITION}
          className="rd-task-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            key="product-manage-panel"
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={RD_PANEL_TRANSITION}
            className="rd-task-overlay-surface w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                {view === "list" ? t("产品线管理") : editingId ? t("编辑产品") : t("新增产品")}
              </h2>
              <button
                type="button"
                onClick={view === "list" ? onClose : () => setView("list")}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List view */}
            {view === "list" && (
              <div className="flex flex-col">
                <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
                  {products.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">{t("暂无产品线，请点击下方添加")}</div>
                  ) : (
                    products.map((prod) => {
                      const pStatus: RdProductStatus = prod.status ?? "developing";
                      const style = PRODUCT_STATUS_STYLE[pStatus];
                      const dot = PRODUCT_STATUS_DOT[pStatus];
                      const label = productionWorkspace && pStatus === "developing" ? "生产中" : PRODUCT_STATUS_LABEL[pStatus];
                      return (
                        <div key={prod.id} className="flex items-center gap-3 px-6 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{prod.name}</span>
                              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", style)}>
                                <span className={cn("h-1 w-1 rounded-full", dot)} />
                                {t(label)}
                              </span>
                            </div>
                            {prod.description && <div className="mt-0.5 truncate text-xs text-slate-400">{prod.description}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() => openEdit(prod)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(prod.id)}
                            disabled={products.length <= 1}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-slate-100 px-6 py-4">
                  <button
                    type="button"
                    onClick={openNew}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <Plus className="h-4 w-4" />
                    {t("新增产品")}
                  </button>
                </div>
              </div>
            )}

            {/* Form view */}
            {view === "form" && (
              <div className="flex flex-col gap-4 px-6 py-5 max-h-[560px] overflow-y-auto">
                {/* Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">{t("产品名称")} *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("请输入产品名称")}
                    className="text-sm"
                  />
                </div>
                {/* Description */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">{t("产品描述")}</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder={t("可选，简要描述产品用途")}
                    className="text-sm resize-none"
                    rows={2}
                  />
                </div>
                {/* Status */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    {productionWorkspace ? t("生产状态") : t("研发状态")}
                  </Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as RdProductStatus }))}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={cn(horizonVariant && "rd-horizon-detail-select")}>
                      <SelectItem value="active">{t("活跃")}</SelectItem>
                      <SelectItem value="developing">{productionWorkspace ? t("生产中") : t("研发中")}</SelectItem>
                      <SelectItem value="paused">{t("暂停")}</SelectItem>
                      <SelectItem value="archived">{t("归档")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    {t("取消")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveForm}
                    disabled={!form.name.trim() || saving}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.20)] transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t("保存")}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 数字滚动（count-up）：进场时从 0 缓动到目标值，带 % 等后缀的字符串自动保留后缀 */
function AnimatedNumber({ value }: { value: number | string }) {
  const shouldReduceMotion = useReducedMotion();
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  const suffix = typeof value === "string" && Number.isFinite(num) ? value.slice(String(num).length) : "";
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(num) || shouldReduceMotion) return;
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(num * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [num, shouldReduceMotion]);
  if (!Number.isFinite(num)) return <>{value}</>;
  return <>{shouldReduceMotion ? num : display}{suffix}</>;
}

/**
 * 协同驾驶舱专用：日报/月报摘要条（渐进披露）。
 * 常驻一行（今日日报关键数字 + 成员胶囊），点击才展开完整报表面板——
 * 把页头高度还给任务区，报表只在需要时占屏。
 */
function UsCollabReportsDigest({ canRegenerate }: { canRegenerate: boolean }) {
  useI18n(); // 订阅语言切换（文案已 t() 化）
  const [expanded, setExpanded] = useState(false);
  const [reports, setReports] = useState<RdDailyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const d = new Date();
    const today = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    fetchRdDailyReports({ date: today })
      .then((data) => { if (!cancelled) setReports(data); })
      .catch(() => { if (!cancelled) setReports([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 当日任务级聚合（与日报面板同口径：按 summary.tasks 的分组计数）
  const agg = useMemo(() => {
    const counts = { completed: 0, progressed: 0, stalled: 0, blocked: 0 };
    for (const report of reports) {
      for (const t of report.summary.tasks ?? []) {
        if (t.group === "completed_today") counts.completed += 1;
        else if (t.group === "progressed") counts.progressed += 1;
        else if (t.group === "stalled") counts.stalled += 1;
        else if (t.group === "blocked") counts.blocked += 1;
      }
    }
    return counts;
  }, [reports]);

  const chips = [
    { label: t("完成"), value: agg.completed, cls: "bg-emerald-50 text-emerald-700" },
    { label: t("推进"), value: agg.progressed, cls: "bg-blue-50 text-blue-700" },
    { label: t("停滞"), value: agg.stalled, cls: "bg-amber-50 text-amber-700" },
    { label: t("阻塞"), value: agg.blocked, cls: "bg-red-50 text-red-700" },
  ].filter((c) => c.value > 0);

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#002fa7] ring-1 ring-blue-100">
          <CalendarDays className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold text-slate-700">{t("今日日报")}</span>
        {loading ? (
          <span className="text-xs text-slate-400">{t("读取中…")}</span>
        ) : reports.length > 0 ? (
          <>
            <span className="text-xs text-slate-400">{t("{n} 位成员已生成", { n: reports.length })}</span>
            {chips.map((c) => (
              <span key={c.label} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", c.cls)}>
                {c.label}
                <span className="tabular-nums">{c.value}</span>
              </span>
            ))}
            <span className="hidden items-center gap-1 text-xs text-slate-400 md:inline-flex">
              {reports.slice(0, 4).map((r) => r.user_name).join("、")}
              {reports.length > 4 ? ` ${t("等 {n} 人", { n: reports.length })}` : ""}
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-400">{t("今日暂无日报")}{canRegenerate ? ` · ${t("展开后可立即汇总")}` : ""}</span>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#002fa7]">
          {expanded ? t("收起报表") : t("展开报表")}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </span>
      </button>
      <CollapseTransition open={expanded}>
        <div className="border-t border-slate-100 p-4">
          <RDReportsPanel canRegenerate={canRegenerate} spacious />
        </div>
      </CollapseTransition>
    </div>
  );
}

function ExecutiveOverview({
  catStats,
  kpiStats,
  products,
  risks,
  personLoads,
  peopleDirectory,
  allTasks,
  initialActivityActor,
  searchKeyword,
  onSearchKeywordChange,
  onSelectSystem,
  onSelectTask,
  onSelectPerson,
  onOpenPeople,
  loading,
  loadError,
  onRefresh,
  onCreateTask,
  onReassign,
  onClearData,
  onAiProject,
  canCreateTask,
  canReassign,
  canClearData,
  canDirectProject,
  onReassignTask,
  canDelete,
  canDeleteAny,
  onDeleteTask,
  canSyncProduction,
  syncedProductionTaskIds,
  syncingProductionTaskId,
  onToggleProductionSync,
  onManageProducts,
  canManageProducts,
  onAiClassifyTasks,
  panoramaReloadToken,
  hideSystemPanorama,
  horizonVariant = false,
}: {
  catStats: CatStat[];
  /** KPI 数字专用统计（概览模式跨全部产品库）。只求和，不可用于渲染分类卡或跳转。 */
  kpiStats: CatStat[];
  products: ProductDef[];
  /** 与 allTasks 同范围的风险集（概览下跨库）：KPI「风险」计数与风险筛选据此，二者才对得上。 */
  risks: Risk[];
  personLoads: PersonLoad[];
  peopleDirectory: readonly PersonProfile[];
  allTasks: Task[];
  initialActivityActor?: TaskActivityActor | null;
  searchKeyword?: string;
  onSearchKeywordChange?: (value: string) => void;
  onSelectSystem: (catId: string, productId: string) => void;
  onSelectTask: (t: Task, activityActor?: TaskActivityActor) => void;
  onSelectPerson: (person: PersonLoad) => void;
  onOpenPeople?: () => void;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => void;
  onCreateTask?: () => void;
  onReassign?: () => void;
  onClearData?: () => void;
  onAiProject?: () => void;
  canCreateTask?: boolean;
  canReassign?: boolean;
  canClearData?: boolean;
  canDirectProject?: boolean;
  onReassignTask?: (t: Task) => void;
  canDelete?: boolean;
  canDeleteAny?: boolean;
  onDeleteTask?: (t: Task) => void;
  canSyncProduction?: boolean;
  syncedProductionTaskIds?: Set<string>;
  syncingProductionTaskId?: string | null;
  onToggleProductionSync?: (task: Task) => void;
  onManageProducts?: () => void;
  canManageProducts?: boolean;
  /** 管理员专用：跨产品库扫描全部线上任务，生成 AI 归纳与合并候选。 */
  onAiClassifyTasks?: () => void;
  panoramaReloadToken?: number;
  /** 中美协同驾驶舱：隐藏「子系统全景」模块 */
  hideSystemPanorama?: boolean;
  /** 研发与生产驾驶舱共用的 Horizon / Klein Blue 视觉变体。 */
  horizonVariant?: boolean;
}) {
  const productionWorkspace = isProductionWorkspace();
  const shouldReduceMotion = useReducedMotion();
  // i18n 试点（P0 验证链路）：订阅语言切换；t() 中文态原样返回，研发侧零影响
  const { lang } = useI18n();
  // KPI 一律用 kpiStats（概览跨库、board 内为本库），与下方按当前库渲染的分类卡刻意不同源
  const { totalActive, inProgress, done, blocked } = useMemo(() => {
    const totals = { totalActive: 0, inProgress: 0, done: 0, blocked: 0 };
    for (const stat of kpiStats) {
      totals.totalActive += stat.total;
      totals.inProgress += stat.inProgress;
      totals.done += stat.done;
      totals.blocked += stat.blocked;
    }
    return totals;
  }, [kpiStats]);
  const rate = totalActive > 0 ? Math.round((done / totalActive) * 100) : 0;

  // KPI 卡片筛选：点击切换；再点一次取消。
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>("all");
  const toggleKpiFilter = useCallback((key: KpiFilter) => {
    setKpiFilter((prev) => (prev === key ? "all" : key));
  }, []);

  // KPI 定义（Horizon 格子卡与协同 stat strip 共享同一份数据与筛选交互）
  const kpiItems = useMemo(() => [
    { label: t("总任务"), value: totalActive, hint: t("未归档根任务数；已并入父任务的子任务不重复统计"), Icon: Target, tone: "text-[#002fa7]", filterKey: null, activeRing: "ring-blue-300" },
    { label: t("完成率"), value: `${rate}%`, hint: t("已完成 ÷ 总任务（{n}）", { n: totalActive }), Icon: Gauge, tone: "text-slate-900", filterKey: null, activeRing: "ring-slate-300" },
    { label: t("进行中"), value: inProgress, hint: "", Icon: CircleDot, tone: "text-[#002fa7]", filterKey: "in_progress" as KpiFilter, activeRing: "ring-blue-400" },
    { label: t("完成"), value: done, hint: "", Icon: CheckCircle2, tone: "text-emerald-700", filterKey: "completed" as KpiFilter, activeRing: "ring-emerald-400" },
    { label: t("阻塞/待派"), value: blocked, hint: "", Icon: Users, tone: blocked > 0 ? "text-amber-700" : "text-slate-400", filterKey: "blocked" as KpiFilter, activeRing: "ring-amber-400" },
    { label: t("风险"), value: risks.length, hint: "", Icon: AlertTriangle, tone: risks.length > 0 ? "text-red-700" : "text-slate-400", filterKey: "risk" as KpiFilter, activeRing: "ring-red-400" },
  ] as const, [blocked, done, inProgress, lang, rate, risks.length, totalActive]);

  const decisionSummary = useMemo(() => {
    if (risks.length > 0) {
      return t("当前有 {riskCount} 个风险任务、{blockedCount} 个阻塞或待派任务。建议先处理风险，再推进进行中工作。", {
        riskCount: risks.length,
        blockedCount: blocked,
      });
    }
    if (blocked > 0) {
      return t("当前有 {count} 个阻塞或待派任务，建议先明确责任人与下一步。", { count: blocked });
    }
    if (inProgress > 0) {
      return t("当前 {count} 个任务正在推进，暂无已识别风险。", { count: inProgress });
    }
    return totalActive > 0
      ? t("当前任务均未进入执行或已完成，可从人员任务区继续核对状态。")
      : t("当前工作区暂无任务数据。读取或创建任务后，这里会生成真实决策摘要。");
  }, [blocked, inProgress, lang, risks.length, totalActive]);

  // 协同侧页头采用三层结构（页头条 / stat strip / 报表全宽），研发与生产侧维持 Horizon 两卡布局
  const usCollabLayout = isUsCollabWorkspace();

  // 沉浸模式（整屏看任务）：把顶部概览的收起信号上报给 Root，联动隐藏全局顶栏 + 滑出侧边栏。
  const { setImmersive } = useLayoutChromeActions();

  // 顶部模块（执行提示 + 日报/月报）随任务流滚动自动收起；「钉住」后常显、忽略滚动信号。
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [headerPinned, setHeaderPinned] = useState(false);
  // 来自 PersonTaskCockpit 的下滑收起信号：钉住时丢弃；展开由沉浸模式控制条显式触发。
  const handleHeaderCollapseChange = useCallback(
    (collapsed: boolean) => {
      if (headerPinned) return;
      // 协同页头只有两行矮条（Stat Strip + 日报摘要），滚动收起收益为零，机制整体停用
      if (usCollabLayout) return;
      setHeaderCollapsed(collapsed);
    },
    [headerPinned, usCollabLayout],
  );

  // 顶部概览收起（滚动下滑且未钉住）即进入沉浸模式：Root 据此隐藏全局顶栏 + 滑出侧边栏，整屏看任务。
  useEffect(() => {
    setImmersive(headerCollapsed);
  }, [headerCollapsed, setImmersive]);
  // 离开驾驶舱时复位，避免顶栏/侧栏在其他页面残留隐藏。
  useEffect(() => () => setImmersive(false), [setImmersive]);

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={RD_FAST_TRANSITION}
      className={cn("min-h-full min-w-0 bg-slate-50/30", horizonVariant && "horizon-theme hz-page rd-horizon-cockpit")}
      style={{ background: "transparent" }}
      role="region"
      aria-busy={loading}
      aria-label={productionWorkspace ? t("生产任务核心驾驶舱") : t("研发任务核心驾驶舱")}
    >
      <div className="rd-horizon-layout mx-auto space-y-6 rd-stagger-children">
        {/* 顶部并排区：执行提示（占 3）+ 今日日报速览（占 2）。窄屏（< xl）自动上下堆叠，
            宽屏并排可省下一整块纵向高度，留给下方的人员任务驾驶舱。
            随任务流下滑自动收起以最大化任务可视区；进入沉浸模式后由控制条显式展开。 */}
        <div className="rd-horizon-overview-top relative">
        {/* Horizon 驾驶舱提供沉浸模式控制：收起后通过 portal 固定到视口右上角，不占布局且不受面板层级遮挡。 */}
        {!usCollabLayout && headerCollapsed && typeof document !== "undefined" && createPortal(
            <motion.button
              type="button"
              onClick={() => setHeaderCollapsed(false)}
              aria-label={t("退出任务大屏并展开顶部概览")}
              title={t("退出任务大屏并展开顶部概览")}
              initial={shouldReduceMotion ? false : { opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={RD_FAST_TRANSITION}
              className={cn(
                "horizon-portal fixed right-4 top-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-blue-200 bg-white px-3.5 text-xs font-semibold text-[#002fa7] shadow-[0_10px_28px_-16px_rgba(0,47,167,0.30)] transition-[border-color,background-color,box-shadow] hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2 motion-reduce:transition-none sm:right-6",
                horizonVariant && "rd-horizon-immersive-control",
              )}
            >
              <Minimize2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("退出大屏")}</span>
            </motion.button>,
            document.body,
        )}
        {!usCollabLayout && !headerCollapsed && (
          <div className="mb-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => { const next = !headerPinned; setHeaderPinned(next); if (next) setHeaderCollapsed(false); }}
                aria-pressed={headerPinned}
                aria-label={headerPinned ? t("已钉住顶部模块，点击恢复滚动自动收起") : t("顶部模块随任务滚动自动收起，点击钉住常显")}
                title={headerPinned ? t("已钉住：滚动时保持展开 · 点击恢复自动收起") : t("滚动任务时自动收起 · 点击钉住常显")}
                className={cn(
                  "rd-horizon-pin-toggle inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                  headerPinned
                    ? "border-[#002fa7] bg-[#002fa7] text-white hover:bg-[#002782]"
                    : "border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]",
                )}
              >
                {headerPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                {headerPinned ? t("已钉住") : t("自动收起")}
              </button>
          </div>
        )}
        <div
          hidden={headerCollapsed}
          className={headerCollapsed ? "overflow-hidden" : "overflow-visible"}
          aria-hidden={headerCollapsed}
          {...(headerCollapsed ? { inert: "" } : {})}
        >
        {usCollabLayout ? (
          /* ══ 协同页头：三层信息架构（页头条=身份+动作 / Stat Strip=纯数据 / 报表=独占全宽），
             动作、数据、报表各归其位，替代原来两张大杂烩卡 ══ */
          <div className="flex flex-col gap-5">
            {/* ① 页头条（无卡片框）：标题+日期 在左，全局动作按钮组 在右 */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-balance text-xl font-bold text-slate-900">{t("协同任务驾驶舱")}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {/* 与下方 KPI 首格同源：页头再报一个不同口径的任务数只会让人对不上账 */}
                  {new Date().toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", { month: "long", day: "numeric", weekday: "long" })} · {t("{n} 个任务", { n: totalActive })}
                  {risks.length > 0 && <span className="ml-2 font-semibold text-red-500">{t("{n} 个风险", { n: risks.length })}</span>}
                </p>
                <p className="mt-2 max-w-2xl text-pretty text-xs leading-5 text-slate-600">{decisionSummary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RdTaskExportButton allTasks={allTasks} peopleDirectory={peopleDirectory} />
                {canReassign && onReassign && (
                  <button
                    type="button"
                    onClick={onReassign}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    <UserCog className="h-3.5 w-3.5" />
                    {t("批量转派")}
                  </button>
                )}
                {onOpenPeople && (
                  <button
                    type="button"
                    onClick={onOpenPeople}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {t("人员管理")}
                  </button>
                )}
                {canClearData && onClearData && (
                  <button
                    type="button"
                    onClick={onClearData}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-red-600 transition-colors hover:border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("清空数据")}
                  </button>
                )}
                {canDirectProject && onAiProject && (
                  <button
                    type="button"
                    onClick={onAiProject}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[#002fa7] px-3.5 text-xs font-semibold text-white shadow-[0_6px_14px_-8px_rgba(0,47,167,0.35)] transition-colors hover:bg-[#002782]"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("AI 立项")}
                  </button>
                )}
              </div>
            </div>

            {/* ② Stat Strip：一行大数字，竖分隔线，点击即筛选（去掉每格的小盒子，数字本身是主体） */}
            <div className="grid grid-cols-3 divide-slate-100 rounded-2xl border border-slate-200/70 bg-white py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:grid-cols-6 sm:divide-x">
              {kpiItems.map((item) => {
                const clickable = item.filterKey !== null;
                const active = clickable && kpiFilter === item.filterKey;
                const Wrapper: React.ElementType = clickable ? "button" : "div";
                return (
                  <Wrapper
                    key={item.label}
                    {...(clickable
                      ? {
                          type: "button" as const,
                          onClick: () => toggleKpiFilter(item.filterKey as KpiFilter),
                          "aria-pressed": active,
                          title: active ? t("已筛选「{label}」· 再次点击取消", { label: item.label }) : t("按「{label}」筛选任务列表", { label: item.label }),
                        }
                      // 不可点的格子（总任务/完成率）用 hint 说明统计口径
                      : item.hint
                        ? { title: item.hint }
                        : {})}
                    className={cn(
                      "flex flex-col items-start px-5 py-1 text-left transition-colors",
                      clickable && "cursor-pointer hover:bg-slate-50/80",
                    )}
                  >
                    <span className={cn("text-2xl font-bold leading-none tabular-nums", active ? "text-[#002fa7]" : item.tone)}>
                      <AnimatedNumber value={item.value} />
                    </span>
                    <span className={cn("mt-1.5 text-xs font-medium", active ? "font-semibold text-[#002fa7]" : "text-slate-400")}>
                      {item.label}
                      {active && ` · ${t("筛选中")}`}
                    </span>
                  </Wrapper>
                );
              })}
            </div>

            {/* ③ 日报/月报：常驻一行摘要条，点击才展开完整面板——页头高度还给任务区 */}
            {catStats.length > 0 && (
              <UsCollabReportsDigest canRegenerate={(canReassign ?? false) || (canCreateTask ?? false)} />
            )}
          </div>
        ) : (
        <div className={cn("rd-horizon-overview-grid", catStats.length > 0 && "grid items-stretch gap-6 min-[1500px]:grid-cols-5")}>
        <section className={cn("rd-horizon-command rounded-2xl border border-slate-200/70 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]", catStats.length > 0 && "min-w-0 min-[1500px]:col-span-3")}>
          <div className="rd-horizon-command-layout grid gap-4 lg:grid-cols-[minmax(280px,1fr)_auto]">
            <div className="rd-horizon-command-heading order-1 flex min-w-0 items-center gap-3">
              <span className="rd-horizon-command-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#002fa7] text-white shadow-[0_6px_16px_-8px_rgba(0,47,167,0.35)]">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="rd-horizon-command-copy min-w-0">
                <h2 className="truncate text-balance text-base font-bold text-slate-900">
                  {productionWorkspace ? t("生产执行提示") : t("研发执行提示")}
                </h2>
                <p className="mt-1 max-w-xl text-pretty text-xs leading-5 text-slate-600">{decisionSummary}</p>
              </div>
            </div>

            <div className="rd-horizon-kpi-grid order-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3 min-[1800px]:grid-cols-6">
              {kpiItems.map((item, index) => {
                const clickable = item.filterKey !== null;
                const active = clickable && kpiFilter === item.filterKey;
                const Wrapper: React.ElementType = clickable ? "button" : "div";
                return (
                  <Wrapper
                    key={item.label}
                    data-active={active}
                    data-kpi-index={index}
                    {...(clickable
                      ? {
                          type: "button" as const,
                          onClick: () => toggleKpiFilter(item.filterKey as KpiFilter),
                          "aria-pressed": active,
                          title: active ? t("已筛选「{label}」· 再次点击取消", { label: item.label }) : t("按「{label}」筛选任务列表", { label: item.label }),
                        }
                      // 不可点的格子（总任务/完成率）用 hint 说明统计口径
                      : item.hint
                        ? { title: item.hint }
                        : {})}
                    className={cn(
                      "rd-horizon-kpi flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 transition-[border-color,box-shadow]",
                      active
                        ? cn("border-transparent ring-2 ring-offset-1 shadow-[0_10px_24px_-14px_rgba(0,47,167,0.24)]", item.activeRing)
                        : "border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
                      clickable && !active && "cursor-pointer hover:border-blue-200 hover:shadow-[0_8px_18px_-12px_rgba(0,47,167,0.20)]",
                      clickable && "text-left",
                    )}
                  >
                    <span className="rd-horizon-kpi-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 ring-1 ring-slate-100">
                      <item.Icon className={cn("h-3.5 w-3.5", item.tone)} />
                    </span>
                    <div className="min-w-0">
                      <div className={cn("rd-horizon-kpi-value text-base font-bold leading-none tabular-nums", item.tone)}>{item.value}</div>
                      <div className="rd-horizon-kpi-label mt-0.5 flex items-center gap-1 truncate text-[10px] font-semibold text-slate-500">
                        <span className="truncate">{item.label}</span>
                        {active && <span className="rd-horizon-kpi-filter-badge shrink-0 rounded-sm bg-blue-100 px-1 py-px text-[9px] font-bold leading-none text-[#002fa7]">{t("筛选中")}</span>}
                      </div>
                    </div>
                  </Wrapper>
                );
              })}
            </div>

            {(
              <div className="rd-horizon-actions order-2 flex flex-wrap justify-start gap-2 lg:justify-end">
                {/* 导出：按时间段导出当前工作区配置人员的任务完成情况。 */}
                <RdTaskExportButton allTasks={allTasks} peopleDirectory={peopleDirectory} />
                {onAiClassifyTasks && (
                  <button
                    type="button"
                    onClick={onAiClassifyTasks}
                    className="group flex min-h-11 flex-none items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-2.5 text-left text-xs font-semibold text-white shadow-[0_8px_18px_-10px_rgba(15,23,42,0.35)] transition-colors hover:bg-slate-800"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-300/15 text-amber-300 ring-1 ring-amber-300/25">
                      <Layers3 className="h-4 w-4 transition-transform group-hover:-rotate-6" />
                    </span>
                    <span className="min-w-0">AI 全量归纳</span>
                  </button>
                )}
                {canDirectProject && onAiProject && (
                  <button
                    type="button"
                    onClick={onAiProject}
                    className="rd-horizon-primary-action group flex min-h-11 flex-none items-center gap-2 rounded-xl bg-[#002fa7] px-2.5 text-left text-xs font-semibold text-white shadow-[0_8px_18px_-10px_rgba(0,47,167,0.35)] transition-colors hover:bg-[#002782]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/18">
                      <Sparkles className="h-4 w-4 transition-transform group-hover:rotate-12" />
                    </span>
                    <span className="min-w-0">{t("AI 立项")}</span>
                  </button>
                )}
                {onCreateTask && (
                  <button
                    type="button"
                    onClick={onCreateTask}
                    className="group flex min-h-11 flex-none items-center gap-2 rounded-xl border border-emerald-100 bg-white px-2.5 text-left text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">{t("新建任务")}</span>
                  </button>
                )}
                {canReassign && onReassign && (
                  <button
                    type="button"
                    onClick={onReassign}
                    className="group flex min-h-11 flex-none items-center gap-2 rounded-xl border border-blue-100 bg-white px-2.5 text-left text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#002fa7] ring-1 ring-blue-100">
                      <UserCog className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">{t("批量转派")}</span>
                  </button>
                )}
                {onOpenPeople && (
                  <button
                    type="button"
                    onClick={onOpenPeople}
                    className="group flex min-h-11 flex-none items-center gap-2 rounded-xl border border-blue-100 bg-white px-2.5 text-left text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#002fa7] ring-1 ring-blue-100">
                      <UserPlus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">{t("人员管理")}</span>
                  </button>
                )}
                {canClearData && onClearData && (
                  <button
                    type="button"
                    onClick={onClearData}
                    className="rd-horizon-danger-action group flex min-h-11 flex-none items-center gap-2 rounded-xl border border-red-100 bg-white px-2.5 text-left text-xs font-semibold text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
                      <Trash2 className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">{t("清空数据")}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        {catStats.length > 0 && (
          <div className="rd-horizon-reports min-w-0 min-[1500px]:col-span-2">
            <RDReportsPanel canRegenerate={(canReassign ?? false) || (canCreateTask ?? false)} />
          </div>
        )}
        </div>
        )}
        </div>
        </div>

        {/* 骨架屏只在「尚无数据可显示」时出现（首次加载 / 真空数据）。刷新（如删除任务后的
            loadCategories）虽然把 loading 置 true，但旧 catStats 仍在 —— 此时保持下方面板挂载，
            避免 PersonTaskCockpit 被卸载重挂导致 activeTab（当前人员）等内部状态被重置回「全部」。 */}
        {catStats.length === 0 ? (
          <section
            className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.10)]"
            role={loadError ? "alert" : "status"}
            aria-live={loadError ? "assertive" : "polite"}
          >
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-[#002fa7] text-white">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : loadError ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <LayoutGrid className="h-5 w-5" aria-hidden="true" />}
            </span>
            <h2 className="mt-4 text-balance text-lg font-semibold text-slate-950">
              {loadError
                ? productionWorkspace ? t("生产任务数据加载失败") : t("研发任务数据加载失败")
                : loading
                ? productionWorkspace ? t("正在加载生产任务数据") : t("正在加载研发任务数据")
                : productionWorkspace ? t("暂无生产任务数据") : t("暂无研发任务数据")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-500">
              {loadError
                ? t("本次请求未完成。请检查连接后重新读取，现有工作区与权限设置不会受到影响。")
                : loading
                ? productionWorkspace
                  ? t("正在读取生产任务树、风险和人员负载。")
                  : t("正在从后端接口读取任务树、风险和人员负载。")
                : productionWorkspace
                  ? t("当前没有生产任务树或任务记录。创建任务或导入数据后，这里会展示真实的生产系统全景、风险和负载。")
                  : t("后端当前没有任务树或任务记录。创建任务或导入数据后，这里会展示真实的系统全景、风险和负载。")}
            </p>
            {loadError && (
              <p className="mx-auto mt-3 max-w-md break-words rounded-md border border-red-100 bg-red-50 px-3 py-2 text-pretty text-xs text-red-700">
                {loadError}
              </p>
            )}
            {!loading && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-[#002fa7] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("重新读取")}
                </button>
                {onCreateTask && (
                  <button
                    type="button"
                    onClick={onCreateTask}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[#002fa7] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#002782] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] focus-visible:ring-offset-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("新建任务")}
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            {loadError && (
              <div className="flex flex-col gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
                <p className="min-w-0 break-words text-pretty">
                  <span className="font-semibold">{t("刷新失败：")}</span>{loadError}
                </p>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("重新读取")}
                </button>
              </div>
            )}
            <PersonTaskCockpit
              risks={risks}
              personLoads={personLoads}
              allTasks={allTasks}
              initialActivityActor={initialActivityActor}
              keyword={searchKeyword}
              onKeywordChange={onSearchKeywordChange}
              onSelectTask={onSelectTask}
              onSelectPerson={onSelectPerson}
              canReassign={canReassign}
              onReassignTask={onReassignTask}
              canDelete={canDelete}
              canDeleteAny={canDeleteAny}
              onDeleteTask={onDeleteTask}
              canSyncProduction={canSyncProduction}
              syncedProductionTaskIds={syncedProductionTaskIds}
              syncingProductionTaskId={syncingProductionTaskId}
              onToggleProductionSync={onToggleProductionSync}
              kpiFilter={kpiFilter}
              onClearKpiFilter={() => setKpiFilter("all")}
              headerCollapsed={headerCollapsed}
              onHeaderCollapseChange={handleHeaderCollapseChange}
            />

            {!hideSystemPanorama && (
              <SystemPanorama
                mainCatStats={catStats}
                products={products}
                onSelectSystem={onSelectSystem}
                onManageProducts={onManageProducts ?? (() => {})}
                canManage={canManageProducts ?? false}
                reloadToken={panoramaReloadToken}
                horizonVariant={horizonVariant}
              />
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── 移动目标产品树（产品→系统→子项）─────────────────────────────────────────
// 任务源始终是主产品(驾驶舱展示的便携式制氧机)；目标可切换到任意产品。
// 主产品树用传入的 categories；其他产品按需经 fetchProductTaskCategories 懒加载并缓存。
function useMoveTargetTree(mainCategories: Category[], _products: ProductDef[]) {
  const [targetProductId, setTargetProductId] = useState<string>(MAIN_PRODUCT_ID);
  const [treeCache, setTreeCache] = useState<Record<string, Category[]>>({});
  const [loadingTree, setLoadingTree] = useState(false);

  useEffect(() => {
    if (targetProductId === MAIN_PRODUCT_ID) return;
    if (treeCache[targetProductId]) return;
    let cancelled = false;
    setLoadingTree(true);
    fetchProductTaskCategories(targetProductId)
      .then((cats) => {
        if (!cancelled) setTreeCache((prev) => ({ ...prev, [targetProductId]: cats }));
      })
      .catch(() => {
        if (!cancelled) {
          setTreeCache((prev) => ({ ...prev, [targetProductId]: [] }));
          toast.error(t("目标产品分类加载失败，请重试"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProductId]);

  const targetCategories =
    targetProductId === MAIN_PRODUCT_ID ? mainCategories : (treeCache[targetProductId] ?? []);

  return { targetProductId, setTargetProductId, targetCategories, loadingTree };
}

// ─── MoveTaskDialog (single task) ────────────────────────────────────────────
export function MoveTaskDialog({
  task,
  categories,
  products,
  onConfirm,
  onClose,
}: {
  task: Task;
  categories: Category[];
  products: ProductDef[];
  onConfirm: (targetProductId: string, targetCatId: string, targetSubId: string) => Promise<void>;
  onClose: () => void;
}) {
  const visibleTaskTitle = taskVisibleTitle(task);
  const [targetCatId, setTargetCatId] = useState<string>("");
  const [targetSubId, setTargetSubId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { targetProductId, setTargetProductId, targetCategories, loadingTree } =
    useMoveTargetTree(categories, products);
  const isCrossProduct = targetProductId !== MAIN_PRODUCT_ID;
  // Find which sub the task currently lives in (源始终是主产品)
  const currentSubId = useMemo(() => {
    for (const cat of categories) {
      for (const sub of cat.children) {
        if (sub.tasks.some((t) => t.task_id === task.task_id)) return sub.id;
      }
    }
    return null;
  }, [categories, task.task_id]);

  const allTargetOptions = useMemo(() => {
    const opts: { cat: Category; sub: SubProject }[] = [];
    for (const cat of targetCategories) {
      for (const sub of cat.children) {
        // 仅在「目标=主产品(同源)」时排除任务当前所在子项；跨产品时全部可选
        if (!isCrossProduct && sub.id === currentSubId) continue;
        opts.push({ cat, sub });
      }
    }
    return opts;
  }, [targetCategories, isCrossProduct, currentSubId]);

  // 切换产品时清空系统/子项；切换系统时清空子项
  useEffect(() => { setTargetCatId(""); setTargetSubId(""); }, [targetProductId]);
  useEffect(() => { setTargetSubId(""); }, [targetCatId]);

  const targetSubOptions = useMemo(
    () => targetCatId ? allTargetOptions.filter((o) => o.cat.id === targetCatId) : allTargetOptions,
    [allTargetOptions, targetCatId],
  );

  const handleConfirm = async () => {
    if (!targetSubId) { toast.error(t("请选择目标子项")); return; }
    const chosen = allTargetOptions.find((o) => o.sub.id === targetSubId);
    if (!chosen) { toast.error(t("目标子项无效，请重新选择")); return; }
    setSaving(true);
    try {
      await onConfirm(targetProductId, chosen.cat.id, targetSubId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="rd-task-overlay-surface z-[60] gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl sm:max-w-md [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">{t("移动任务")}</DialogTitle>
              <DialogDescription className="max-w-[260px] truncate text-xs text-slate-500">
                {visibleTaskTitle}
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("关闭移动任务")}
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {t("当前位置：")}<span className="font-medium text-slate-700">{task.category_path || t("未分类")}</span>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{t("目标位置")}</label>
            <div className="mb-2">
              <label htmlFor="move-task-product" className="mb-1 block text-xs text-slate-500">{t("产品")}</label>
              <NativeSelect
                id="move-task-product"
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                className="w-full text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.id === MAIN_PRODUCT_ID ? t("（当前）") : ""}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="move-task-category" className="mb-1 block text-xs text-slate-500">{t("一级系统")}</label>
                <NativeSelect
                  id="move-task-category"
                  value={targetCatId}
                  onChange={(e) => setTargetCatId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{t("全部系统")}</option>
                  {targetCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="move-task-subproject" className="mb-1 block text-xs text-slate-500">{t("子项")}</label>
                <NativeSelect
                  id="move-task-subproject"
                  value={targetSubId}
                  onChange={(e) => setTargetSubId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{loadingTree ? t("加载中…") : t("请选择子项")}</option>
                  {targetSubOptions.map(({ cat, sub }) => (
                    <option key={sub.id} value={sub.id}>{cat.label} / {sub.label}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {isCrossProduct && (
              <p className="mt-2 text-xs text-amber-600">
                {t("跨产品移动：任务将从当前产品移出，归入所选产品。")}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || loadingTree || !targetSubId}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移动")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MoveTasksDialog ─────────────────────────────────────────────────────────
function MoveTasksDialog({
  fromCategory,
  fromSub,
  categories,
  products,
  onConfirm,
  onClose,
}: {
  fromCategory: Category;
  fromSub: SubProject;
  categories: Category[];
  products: ProductDef[];
  onConfirm: (taskIds: string[], targetProductId: string, targetCatId: string, targetSubId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetCatId, setTargetCatId] = useState<string>("");
  const [targetSubId, setTargetSubId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { targetProductId, setTargetProductId, targetCategories, loadingTree } =
    useMoveTargetTree(categories, products);
  const isCrossProduct = targetProductId !== MAIN_PRODUCT_ID;
  const movableTasks = useMemo(
    () => fromSub.tasks.filter((task) => !isProductionMirrorTask(task)),
    [fromSub.tasks],
  );

  // All subs except the source（跨产品时不排除任何子项）
  const allTargetOptions = useMemo(() => {
    const opts: { cat: Category; sub: SubProject }[] = [];
    for (const cat of targetCategories) {
      for (const sub of cat.children) {
        if (!isCrossProduct && sub.id === fromSub.id) continue;
        opts.push({ cat, sub });
      }
    }
    return opts;
  }, [targetCategories, isCrossProduct, fromSub.id]);

  // 切换产品时清空系统/子项；切换系统时清空子项
  useEffect(() => { setTargetCatId(""); setTargetSubId(""); }, [targetProductId]);
  useEffect(() => { setTargetSubId(""); }, [targetCatId]);

  const targetSubOptions = useMemo(() => {
    if (!targetCatId) return allTargetOptions;
    return allTargetOptions.filter((o) => o.cat.id === targetCatId);
  }, [allTargetOptions, targetCatId]);

  const toggleTask = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === movableTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(movableTasks.map((t) => t.task_id)));
    }
  };

  const handleConfirm = async () => {
    if (selectedIds.size === 0) { toast.error(t("请选择要移动的任务")); return; }
    if (!targetSubId) { toast.error(t("请选择目标子项")); return; }
    const chosen = allTargetOptions.find((o) => o.sub.id === targetSubId);
    if (!chosen) { toast.error(t("目标子项无效，请重新选择")); return; }
    setSaving(true);
    try {
      await onConfirm(Array.from(selectedIds), targetProductId, chosen.cat.id, targetSubId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="rd-task-overlay-surface gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl sm:max-w-lg [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">{t("移动任务")}</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {t("从「{path}」移动任务到其他子项", { path: `${fromCategory.label} / ${fromSub.label}` })}
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("关闭批量移动任务")}
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-lg p-1.5 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-700">
              <span>{t("选择任务")} ({selectedIds.size}/{movableTasks.length})</span>
              <button type="button" onClick={toggleAll} className="text-xs text-indigo-600 hover:underline">
                {selectedIds.size === movableTasks.length && movableTasks.length > 0 ? t("取消全选") : t("全选")}
              </button>
            </div>
            <div className="cockpit-scroll space-y-2 overflow-y-auto" style={{ maxHeight: "min(240px, 35vh)" }}>
              {movableTasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">{t("该子项下暂无可移动任务")}</p>
              ) : movableTasks.map((taskItem) => (
                <label key={taskItem.task_id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                  <Checkbox
                    checked={selectedIds.has(taskItem.task_id)}
                    onCheckedChange={() => toggleTask(taskItem.task_id)}
                    className="border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800">{taskVisibleTitle(taskItem)}</div>
                    <div className="text-xs text-slate-400">{taskItem.primary_owner} · {STATUS_CONFIG[taskItem.status] ? t(STATUS_CONFIG[taskItem.status].label) : taskItem.status}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{t("目标位置")}</label>
            <div className="mb-2">
              <label htmlFor="move-tasks-product" className="mb-1 block text-xs text-slate-500">{t("产品")}</label>
              <NativeSelect
                id="move-tasks-product"
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                className="w-full text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.id === MAIN_PRODUCT_ID ? t("（当前）") : ""}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="move-tasks-category" className="mb-1 block text-xs text-slate-500">{t("一级系统")}</label>
                <NativeSelect
                  id="move-tasks-category"
                  value={targetCatId}
                  onChange={(e) => setTargetCatId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{t("全部系统")}</option>
                  {targetCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="move-tasks-subproject" className="mb-1 block text-xs text-slate-500">{t("子项")}</label>
                <NativeSelect
                  id="move-tasks-subproject"
                  value={targetSubId}
                  onChange={(e) => setTargetSubId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingTree}
                >
                  <option value="">{loadingTree ? t("加载中…") : t("请选择子项")}</option>
                  {targetSubOptions.map(({ cat, sub }) => (
                    <option key={sub.id} value={sub.id}>{cat.label} / {sub.label}</option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {isCrossProduct && (
              <p className="mt-2 text-xs text-amber-600">
                {t("跨产品移动：所选任务将从当前产品移出，归入所选产品。")}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => { if (!saving) onClose(); }}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={saving || loadingTree || selectedIds.size === 0 || !targetSubId}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移动")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── TaskCompletedCelebration ─────────────────────────────────────────────────
function TaskCompletedCelebration({ task, onClose }: { task: Task; onClose: () => void }) {
  const shouldReduceMotion = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={RD_PANEL_TRANSITION}
        className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
        </div>
        <h3 className="mb-2 text-xl font-bold text-slate-900">{t("太棒了！")}</h3>
        <p className="mb-1 font-semibold text-slate-700">{taskVisibleTitle(task)}</p>
        <p className="mb-6 text-sm text-slate-500">{t("任务已审核通过并完成")}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          {t("好的")}
        </button>
      </motion.div>
    </motion.div>
  );
}

type ProjectClassificationDialogProps = {
  productId?: string;
  categoryId?: string;
  subProjectId?: string;
  scopeLabel: string;
  tasks: Task[];
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onMerged: () => void | Promise<void>;
};

type ProjectClassificationMergeDraft = {
  id: string;
  kind: "duplicate" | "homogeneous";
  label: string;
  reason: string;
  confidence?: number;
  taskIds: string[];
  primaryTaskId: string;
  sourceTaskIds: string[];
  enabled: boolean;
};

const PROJECT_CLASSIFICATION_MAX_FILES = 5;
const PROJECT_CLASSIFICATION_MAX_FILE_BYTES = 25 * 1024 * 1024;
const PROJECT_CLASSIFICATION_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const PROJECT_CLASSIFICATION_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp";
const PROJECT_CLASSIFICATION_FILE_EXTENSIONS = new Set(
  PROJECT_CLASSIFICATION_FILE_ACCEPT.split(",").map((extension) => extension.slice(1)),
);

function flattenClassificationTasks(tasks: Task[]): Task[] {
  const output: Task[] = [];
  const visit = (items: Task[]) => {
    for (const task of items) {
      if (isArchivedTask(task)) continue;
      output.push(task);
      visit(task.subtasks ?? []);
    }
  };
  visit(tasks);
  return output;
}

function ProjectClassificationDialog({
  productId,
  categoryId,
  subProjectId,
  scopeLabel,
  tasks,
  onClose,
  onOpenTask,
  onMerged,
}: ProjectClassificationDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [instruction, setInstruction] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [result, setResult] = useState<RdAiProjectClassificationResult | null>(null);
  const [mergeDrafts, setMergeDrafts] = useState<ProjectClassificationMergeDraft[]>([]);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopedTasks = useMemo(() => flattenClassificationTasks(tasks), [tasks]);
  const taskById = useMemo(() => new Map(scopedTasks.map((task) => [task.task_id, task])), [scopedTasks]);
  const rootTaskIds = useMemo(() => new Set(tasks.map((task) => task.task_id)), [tasks]);

  const addFiles = useCallback((incoming: File[]) => {
    const accepted: File[] = [];
    const existing = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existing.has(key)) continue;
      if (files.length + accepted.length >= PROJECT_CLASSIFICATION_MAX_FILES) {
        toast.error(`一次最多上传 ${PROJECT_CLASSIFICATION_MAX_FILES} 个附件`);
        break;
      }
      const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
      if (!PROJECT_CLASSIFICATION_FILE_EXTENSIONS.has(extension)) {
        toast.error(`${file.name} 的文件类型暂不支持`);
        continue;
      }
      if (file.size > PROJECT_CLASSIFICATION_MAX_FILE_BYTES) {
        toast.error(`${file.name} 超过 25 MB，未加入分析`);
        continue;
      }
      if (totalBytes + file.size > PROJECT_CLASSIFICATION_MAX_TOTAL_BYTES) {
        toast.error("附件总大小不能超过 50 MB");
        continue;
      }
      accepted.push(file);
      existing.add(key);
      totalBytes += file.size;
    }
    if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
  }, [files]);

  const resetFileDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  useEffect(() => {
    window.addEventListener("dragend", resetFileDragState);
    window.addEventListener("drop", resetFileDragState);
    return () => {
      window.removeEventListener("dragend", resetFileDragState);
      window.removeEventListener("drop", resetFileDragState);
    };
  }, [resetFileDragState]);

  const handleFileDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleFileDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = analyzing ? "none" : "copy";
  }, [analyzing]);

  const handleFileDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const handleFileDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (!Array.from(event.dataTransfer.types).includes("Files") && droppedFiles.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    resetFileDragState();
    if (!analyzing && droppedFiles.length > 0) addFiles(droppedFiles);
  }, [addFiles, analyzing, resetFileDragState]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const next = await classifyRdProject({
        productId,
        categoryId,
        subProjectId,
        instruction,
        files,
      });
      setResult(next);
      const duplicateDrafts = next.duplicate_groups.map((group, index): ProjectClassificationMergeDraft => {
        const primaryTaskId = group.recommended_primary_task_id && group.task_ids.includes(group.recommended_primary_task_id)
          ? group.recommended_primary_task_id
          : group.task_ids[0] ?? "";
        return {
          id: `duplicate-${index}`,
          kind: "duplicate",
          label: group.title,
          reason: group.reason,
          confidence: group.confidence,
          taskIds: group.task_ids,
          primaryTaskId,
          sourceTaskIds: group.task_ids.filter((taskId) => taskId !== primaryTaskId && rootTaskIds.has(taskId)),
          // 高置信组默认勾选：AI 已逐组判定并选好主任务，用户扫一眼点一次「应用」即可。
          // 合并只是父子挂接（内容与留痕完整保留、可批量拆回），误判的代价远低于逐组手动勾选的成本。
          enabled: true,
        };
      });
      const homogeneousDrafts = next.homogeneous_clusters.map((group, index): ProjectClassificationMergeDraft => {
        const primaryTaskId = group.recommended_primary_task_id && group.task_ids.includes(group.recommended_primary_task_id)
          ? group.recommended_primary_task_id
          : group.task_ids[0] ?? "";
        return {
          id: `homogeneous-${index}`,
          kind: "homogeneous",
          label: group.label,
          reason: group.reason,
          taskIds: group.task_ids,
          primaryTaskId,
          sourceTaskIds: group.task_ids.filter((taskId) => taskId !== primaryTaskId && rootTaskIds.has(taskId)),
          enabled: false,
        };
      });
      setMergeDrafts([...duplicateDrafts, ...homogeneousDrafts]);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI 全量任务归纳失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  };

  const approvedMergeDrafts = useMemo(
    () => mergeDrafts.filter((draft) => draft.enabled && draft.primaryTaskId && draft.sourceTaskIds.length > 0),
    [mergeDrafts],
  );
  const approvedMergeTaskCount = useMemo(
    () => approvedMergeDrafts.reduce((sum, draft) => sum + draft.sourceTaskIds.length, 0),
    [approvedMergeDrafts],
  );
  const memberTaskLinesByOwner = useMemo(() => {
    const grouped = new Map<string, RdAiProjectClassificationResult["member_task_lines"]>();
    for (const line of result?.member_task_lines ?? []) {
      const owner = line.primary_owner || "待指派";
      grouped.set(owner, [...(grouped.get(owner) ?? []), line]);
    }
    return [...grouped.entries()];
  }, [result]);

  const updateMergeDraft = useCallback((draftId: string, update: (draft: ProjectClassificationMergeDraft) => ProjectClassificationMergeDraft) => {
    setMergeDrafts((current) => current.map((draft) => (draft.id === draftId ? update(draft) : draft)));
  }, []);

  const chooseMergePrimary = useCallback((draftId: string, primaryTaskId: string) => {
    updateMergeDraft(draftId, (draft) => {
      if (!draft.taskIds.includes(primaryTaskId)) return draft;
      const nextSources = new Set(draft.sourceTaskIds);
      nextSources.delete(primaryTaskId);
      if (draft.primaryTaskId && rootTaskIds.has(draft.primaryTaskId)) nextSources.add(draft.primaryTaskId);
      return { ...draft, primaryTaskId, sourceTaskIds: [...nextSources] };
    });
  }, [rootTaskIds, updateMergeDraft]);

  const toggleMergeSource = useCallback((draftId: string, taskId: string) => {
    if (!rootTaskIds.has(taskId)) return;
    updateMergeDraft(draftId, (draft) => {
      if (draft.primaryTaskId === taskId) return draft;
      const nextSources = new Set(draft.sourceTaskIds);
      if (nextSources.has(taskId)) nextSources.delete(taskId);
      else nextSources.add(taskId);
      return { ...draft, sourceTaskIds: [...nextSources] };
    });
  }, [rootTaskIds, updateMergeDraft]);

  const requestMergeConfirmation = useCallback(() => {
    if (approvedMergeDrafts.length === 0) {
      toast.error("请先勾选至少一组，并选择要并入的任务");
      return;
    }
    const usedTaskIds = new Set<string>();
    for (const draft of approvedMergeDrafts) {
      for (const taskId of [draft.primaryTaskId, ...draft.sourceTaskIds]) {
        if (usedTaskIds.has(taskId)) {
          toast.error("同一任务不能同时出现在多个待合并组，请先调整分析结果");
          return;
        }
        usedTaskIds.add(taskId);
      }
    }
    setShowMergeConfirm(true);
  }, [approvedMergeDrafts]);

  const executeApprovedMerges = useCallback(async () => {
    if (merging || approvedMergeDrafts.length === 0) return;
    setMerging(true);
    setError(null);
    let completedGroups = 0;
    try {
      for (const draft of approvedMergeDrafts) {
        await attachRdTasksToParent(draft.sourceTaskIds, draft.primaryTaskId);
        const primaryTask = taskById.get(draft.primaryTaskId);
        for (const sourceTaskId of draft.sourceTaskIds) {
          const sourceTask = taskById.get(sourceTaskId);
        }
        completedGroups += 1;
      }
      await onMerged();
      toast.success(`已确认 ${completedGroups} 组主任务线，并入 ${approvedMergeTaskCount} 条任务`);
      setShowMergeConfirm(false);
      onClose();
    } catch (mergeError) {
      if (completedGroups > 0) await onMerged();
      setShowMergeConfirm(false);
      setResult(null);
      setMergeDrafts([]);
      setError(
        `${completedGroups > 0 ? `已完成 ${completedGroups} 组；` : ""}${mergeError instanceof Error ? mergeError.message : "任务合并失败，请重新分析后重试"}`,
      );
    } finally {
      setMerging(false);
    }
  }, [approvedMergeDrafts, approvedMergeTaskCount, merging, onClose, onMerged, taskById]);

  const renderTaskLinks = (taskIds: string[], primaryTaskId?: string | null) => (
    <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
      {taskIds.map((taskId) => {
        const task = taskById.get(taskId);
        if (!task) return null;
        return (
          <button
            key={taskId}
            type="button"
            onClick={() => onOpenTask(task)}
            className={cn(
              "group inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
              primaryTaskId === taskId
                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
            )}
          >
            <span className="max-w-[260px] truncate">{task.title}</span>
            {primaryTaskId === taskId && <span className="shrink-0 text-[10px] text-amber-700">建议保留</span>}
            <ArrowRight className="h-3 w-3 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />
          </button>
        );
      })}
    </div>
  );

  const renderMergeDraftEditor = (draft: ProjectClassificationMergeDraft, advice: string) => (
    <article
      key={draft.id}
      className={cn(
        "rounded-xl border p-4 transition-colors",
        draft.enabled
          ? draft.kind === "duplicate" ? "border-amber-300 bg-amber-50/60" : "border-blue-300 bg-blue-50/60"
          : "border-slate-200 bg-slate-50/50",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={draft.sourceTaskIds.length === 0}
          onChange={(event) => updateMergeDraft(draft.id, (current) => ({ ...current, enabled: event.target.checked }))}
          className="mt-1 h-4 w-4 shrink-0 accent-slate-950"
          aria-label={`纳入合并：${draft.label}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Input
              value={draft.label}
              onChange={(event) => updateMergeDraft(draft.id, (current) => ({ ...current, label: event.target.value.slice(0, 120) }))}
              className="h-8 min-w-0 border-transparent bg-transparent px-1 text-sm font-semibold text-slate-900 shadow-none hover:border-slate-200 focus-visible:border-slate-300 focus-visible:bg-white focus-visible:ring-0"
              aria-label="调整任务组名称"
            />
            {draft.confidence !== undefined && (
              <span className="mt-1 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                {Math.round(draft.confidence * 100)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">{draft.reason}</p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {draft.taskIds.map((taskId) => {
          const task = taskById.get(taskId);
          if (!task) return null;
          const isPrimary = draft.primaryTaskId === taskId;
          const canAttach = rootTaskIds.has(taskId);
          const selectedAsSource = draft.sourceTaskIds.includes(taskId);
          return (
            <div key={taskId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <input
                  type="radio"
                  name={`classification-primary-${draft.id}`}
                  checked={isPrimary}
                  onChange={() => chooseMergePrimary(draft.id, taskId)}
                  className="h-3.5 w-3.5 accent-slate-950"
                />
                保留
              </label>
              {!isPrimary && (
                <label
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
                    canAttach ? "cursor-pointer text-slate-600" : "cursor-not-allowed text-slate-300",
                  )}
                  title={canAttach ? "确认后作为完整子任务并入" : "已有父任务，只能保留为目标，不能再次并入"}
                >
                  <input
                    type="checkbox"
                    checked={selectedAsSource}
                    disabled={!canAttach}
                    onChange={() => toggleMergeSource(draft.id, taskId)}
                    className="h-3.5 w-3.5 accent-slate-950"
                  />
                  并入
                </label>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800">{task.title}</p>
                <p className="mt-0.5 truncate text-[10px] text-slate-400">
                  {task.primary_owner || "待指派"}{task.category_path ? ` · ${task.category_path}` : ""}
                </p>
              </div>
              {!canAttach && !isPrimary && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">已有上级</span>
              )}
              <button
                type="button"
                onClick={() => onOpenTask(task)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={`查看任务 ${task.title}`}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs leading-5">
        <p className={draft.kind === "duplicate" ? "text-amber-900" : "text-blue-900"}>
          <span className="font-semibold">建议：</span>{advice}
        </p>
        <span className="shrink-0 text-slate-400">已选 {draft.sourceTaskIds.length} 条</span>
      </div>
    </article>
  );

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-classification-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={RD_PANEL_TRANSITION}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f7f8fa] shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-amber-300 shadow-sm">
              <Layers3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="project-classification-title" className="text-lg font-semibold tracking-tight text-slate-950">
                  AI 全量任务归纳
                </h2>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  人工确认后执行
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">
                {scopeLabel} · {scopedTasks.length} 条未归档任务
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={analyzing || merging}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="关闭全量任务归纳"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {!result ? (
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[0.78fr_1.22fr]">
            <aside className="border-b border-slate-200 bg-slate-950 px-6 py-7 text-white lg:border-b-0 lg:border-r lg:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Analysis brief</p>
              <h3 className="mt-3 max-w-sm text-2xl font-semibold leading-tight tracking-tight">
                先把任务看成一个组合，再判断哪些应该合并。
              </h3>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
                系统会结合任务标题、描述、主责人、进度和父子层级，识别真正重复与“相似但应并行”的任务。
              </p>
              <div className="mt-7 space-y-3">
                {[
                  [CopyCheck, "疑似重复", "给出置信度、保留建议和人工复核动作"],
                  [Layers3, "同质聚类", "把目标相近的任务集中呈现，避免重复投入"],
                  [ShieldCheck, "确认前不改数据", "可调整保留任务与并入项，只有二次确认后才执行"],
                ].map(([Icon, title, description]) => {
                  const ItemIcon = Icon as React.ComponentType<{ className?: string }>;
                  return (
                    <div key={String(title)} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                      <ItemIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <p className="text-sm font-medium text-white">{String(title)}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-400">{String(description)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>

            <main className="flex flex-col p-5 sm:p-7">
              <label htmlFor="project-classification-instruction" className="text-sm font-semibold text-slate-900">
                本次分析重点 <span className="font-normal text-slate-400">（选填）</span>
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                可补充产品阶段、交付边界或你特别担心的重复方向；留空则执行完整检查。
              </p>
              <Textarea
                id="project-classification-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value.slice(0, 8000))}
                placeholder="例如：重点检查测试验证类任务是否重复；同一物料的打样、验证和问题关闭应视为一个交付链路，不要误判为重复。"
                className="mt-3 min-h-[150px] resize-y rounded-xl border-slate-200 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus-visible:ring-slate-400"
              />
              <div className="mt-2 text-right text-[11px] text-slate-400">{instruction.length} / 8000</div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">补充附件 <span className="font-normal text-slate-400">（选填）</span></p>
                  <p className="mt-1 text-xs text-slate-500">最多 5 个，每个不超过 25 MB</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={analyzing || files.length >= PROJECT_CLASSIFICATION_MAX_FILES}
                  className="h-9 rounded-lg border-slate-300 bg-white text-slate-700"
                >
                  <Paperclip className="mr-1.5 h-4 w-4" />
                  选择附件
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  disabled={analyzing}
                  className="hidden"
                  accept={PROJECT_CLASSIFICATION_FILE_ACCEPT}
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </div>

              <div
                onDragEnter={handleFileDragEnter}
                onDragOver={handleFileDragOver}
                onDragLeave={handleFileDragLeave}
                onDrop={handleFileDrop}
                data-drag-active={isDraggingFiles ? "true" : "false"}
                aria-label="附件拖拽上传区域"
                aria-live="polite"
                className={cn(
                  "relative mt-3 min-h-[76px] rounded-xl border border-dashed p-3 transition-[border-color,background-color,box-shadow] duration-150",
                  isDraggingFiles
                    ? "border-amber-400 bg-amber-50 shadow-[0_0_0_4px_rgba(251,191,36,0.13)]"
                    : "border-slate-300 bg-white/70",
                )}
              >
                {isDraggingFiles && (
                  <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-lg bg-amber-50/95 text-sm font-semibold text-amber-800 backdrop-blur-[1px]">
                    <FileUp className="h-4 w-4 animate-bounce" />
                    松开即可添加附件
                  </div>
                )}
                <div className={cn("transition-opacity", isDraggingFiles && "opacity-20")}>
                  {files.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={analyzing}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      <FileUp className="h-4 w-4" />
                      拖拽附件到此处，或点击选择
                    </button>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {files.map((file) => (
                        <div key={`${file.name}-${file.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-slate-800">{file.name}</p>
                            <p className="text-[10px] text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label={`移除 ${file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-auto flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-md text-xs leading-5 text-slate-500">
                  AI 只生成分析草稿，不会自动改任务；结果页可人工调整并在二次确认后执行合并。
                </p>
                <Button
                  type="button"
                  onClick={runAnalysis}
                  disabled={analyzing}
                  className="h-10 shrink-0 rounded-lg bg-slate-950 px-5 text-white shadow-sm hover:bg-slate-800"
                >
                  {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4 text-amber-300" />}
                  {analyzing ? "正在分批分析线上任务…" : "生成全量归纳分析"}
                </Button>
              </div>
            </main>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500">已分析任务</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{result.scope.analyzed_task_count}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
                <p className="text-xs font-medium text-amber-700">疑似重复组</p>
                <p className="mt-1 text-2xl font-semibold text-amber-950">{result.duplicate_groups.length}</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm">
                <p className="text-xs font-medium text-blue-700">同质任务组</p>
                <p className="mt-1 text-2xl font-semibold text-blue-950">{result.homogeneous_clusters.length}</p>
              </div>
            </div>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                全量任务概览
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{result.provider === "local" ? "本地初筛" : "AI 语义分析"}</span>
                {result.scope.attachment_count > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1">参考 {result.scope.attachment_count} 个附件</span>}
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">确认前不修改任务</span>
              </div>
            </section>

            {result.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                {result.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
              </div>
            )}

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <GitBranch className="h-4 w-4 text-indigo-600" />成员主任务线
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">按主责人整理根任务，已存在的子任务不会被重复计算。</p>
                </div>
                <span className="text-xs text-slate-400">{result.member_task_lines.length} 条主任务线</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {memberTaskLinesByOwner.map(([owner, lines]) => (
                  <article key={owner} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{owner}</span>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">{lines.length} 条</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {lines.map((line, index) => (
                        <div key={`${line.line_title}-${index}`}>
                          <p className="text-xs font-semibold text-slate-800">{line.line_title}</p>
                          {line.rationale && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{line.rationale}</p>}
                          {renderTaskLinks(line.task_ids, line.recommended_primary_task_id)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {memberTaskLinesByOwner.length === 0 && (
                  <p className="text-sm text-slate-500">本次没有生成成员主任务线。</p>
                )}
              </div>
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><CopyCheck className="h-4 w-4 text-amber-600" />疑似重复</h3>
                  <span className="text-xs text-slate-400">{result.duplicate_groups.length} 组</span>
                </div>
                <div className="mt-4 space-y-3">
                  {result.duplicate_groups.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">未发现需要优先复核的重复任务。</p>
                  ) : result.duplicate_groups.map((group, index) => {
                    const draft = mergeDrafts.find((item) => item.id === `duplicate-${index}`);
                    return draft ? renderMergeDraftEditor(draft, group.action) : null;
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Layers3 className="h-4 w-4 text-blue-600" />同质任务聚类</h3>
                  <span className="text-xs text-slate-400">{result.homogeneous_clusters.length} 组</span>
                </div>
                <div className="mt-4 space-y-3">
                  {result.homogeneous_clusters.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">未发现明显的同质任务集中现象。</p>
                  ) : result.homogeneous_clusters.map((cluster, index) => {
                    const draft = mergeDrafts.find((item) => item.id === `homogeneous-${index}`);
                    return draft ? renderMergeDraftEditor(draft, cluster.consolidation_advice) : null;
                  })}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">建议分类</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {result.categories.map((category, index) => (
                  <article key={`${category.label}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">{category.label}</h4>
                      <span className="text-[11px] text-slate-400">{category.task_ids.length} 条</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">{category.rationale}</p>
                    {renderTaskLinks(category.task_ids)}
                  </article>
                ))}
                {result.categories.length === 0 && <p className="text-sm text-slate-500">本次没有生成新的分类建议。</p>}
              </div>
            </section>

            {result.recommendations.length > 0 && (
              <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-5 text-white shadow-sm">
                <h3 className="text-sm font-semibold text-white">下一步治理建议</h3>
                <ol className="mt-3 space-y-2">
                  {result.recommendations.map((recommendation, index) => (
                    <li key={`${recommendation}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-300">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-[10px] font-semibold text-amber-300">{index + 1}</span>
                      {recommendation}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}

        {result && (
          <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-xs text-slate-500">结果生成于 {new Date(result.generated_at).toLocaleString("zh-CN")}，合并后源任务将作为完整子任务保留。</p>
              {approvedMergeTaskCount > 0 && (
                <p className="mt-1 text-xs font-medium text-slate-800">已选择 {approvedMergeDrafts.length} 组，共 {approvedMergeTaskCount} 条任务待并入</p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={merging}
                onClick={() => {
                  setResult(null);
                  setMergeDrafts([]);
                }}
                className="rounded-lg border-slate-300"
              >
                调整条件并重算
              </Button>
              <Button type="button" variant="outline" disabled={merging} onClick={onClose} className="rounded-lg border-slate-300">关闭</Button>
              <Button
                type="button"
                disabled={merging || approvedMergeTaskCount === 0}
                onClick={requestMergeConfirmation}
                className="rounded-lg bg-slate-950 text-white hover:bg-slate-800"
              >
                <GitBranch className="mr-1.5 h-4 w-4 text-amber-300" />
                确认合并 {approvedMergeTaskCount > 0 ? `${approvedMergeTaskCount} 条` : ""}
              </Button>
            </div>
          </footer>
        )}
      </motion.div>

      <AlertDialog open={showMergeConfirm} onOpenChange={(open) => { if (!merging) setShowMergeConfirm(open); }}>
        <AlertDialogContent overlayClassName="z-[90]" className="z-[91] sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>确认整理为主任务线？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left">
              <span className="block">
                将执行 {approvedMergeDrafts.length} 组合并，把 {approvedMergeTaskCount} 条独立任务挂到选定主任务下。任务标题、描述、主责人、日期、评分、审批状态、进展留痕、讨论、附件和操作记录均保留。
              </span>
              <span className="block rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {approvedMergeDrafts.slice(0, 5).map((draft) => {
                  const primary = taskById.get(draft.primaryTaskId);
                  return `${draft.label}：${draft.sourceTaskIds.length} 条 → ${primary?.title ?? draft.primaryTaskId}`;
                }).join("\n")}
                {approvedMergeDrafts.length > 5 ? `\n另有 ${approvedMergeDrafts.length - 5} 组` : ""}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>返回调整</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(event) => {
                event.preventDefault();
                void executeApprovedMerges();
              }}
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              {merging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {merging ? "正在合并…" : "确认并执行"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDTaskManagementPage({ hideSystemPanorama = false }: { hideSystemPanorama?: boolean } = {}) {
  useI18n(); // 根组件订阅：切语言带动整棵任务树重渲染
  const shouldReduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const initialActivityActor = useMemo<TaskActivityActor | null>(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("activity_user_id")?.trim() ?? "";
    const name = params.get("activity_user_name")?.trim() ?? "";
    return id || name ? { id: id || null, name } : null;
  }, [location.search]);
  const { lang } = useI18n();
  const usCollab = location.pathname.startsWith("/us-collab");
  const productionWorkspace = isProductionWorkspace();
  // 视觉层：研发、协同与生产驾驶舱统一使用 Horizon；各工作区仍保留自己的信息结构与数据边界。
  const horizonCockpit = true;
  // 行为层：URL 搜索仅属于原生研发驾驶舱，不能随视觉接入一并放开到生产。
  const nativeRdCockpit = !usCollab && !productionWorkspace;
  const cockpitSearchKeyword = useMemo(
    () => (nativeRdCockpit ? new URLSearchParams(location.search).get("q") ?? "" : undefined),
    [location.search, nativeRdCockpit],
  );
  const handleCockpitSearchKeywordChange = useCallback((value: string) => {
    if (!nativeRdCockpit) return;
    const params = new URLSearchParams(location.search);
    if (value.trim()) {
      params.set("q", value);
      params.delete("view");
      params.delete("category");
    } else {
      params.delete("q");
    }
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, nativeRdCockpit, navigate]);
  // 协同路由下人员管理跳协同入口（rdApi 按 /us-collab 前缀路由到独立人员池）
  const peopleManagementPath = usCollab
    ? "/us-collab-people-management"
    : productionWorkspace
      ? "/production-people-management"
      : "/rd-people-management";
  const canCreateTask = usePermission(PERMISSIONS.RD_TASK_CREATE);
  const canOpenProcurement = usePermission('page:proc-cockpit');
  const [productionActualsOpen, setProductionActualsOpen] = useState(false);
  const [productionActualsProductId, setProductionActualsProductId] = useState<string | null>(null);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canReassignTasks = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canClearData = usePermission(PERMISSIONS.RD_DATA_CLEAR);
  const canDeleteTasks = usePermission(PERMISSIONS.RD_TASK_EDIT);
  const canDeleteAnyTask = useAnyPermission(
    PERMISSIONS.RD_TASK_REASSIGN,
    PERMISSIONS.RD_PROJECT_DIRECT,
    PERMISSIONS.RD_PROJECT_REVIEW_L1,
    PERMISSIONS.RD_PROJECT_REVIEW_L2,
    PERMISSIONS.RD_PEOPLE_MANAGE,
  );
  // 驾驶舱是全局任务树，移动入口只对专职移动/转派角色开放（与后端 canMoveAny 一致）。
  const canMoveTask = useAnyPermission(PERMISSIONS.RD_TASK_MOVE, PERMISSIONS.RD_TASK_REASSIGN);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  // 管理员成员视角严格跟随任务转派权限；立项终审/直接立项本身不授予全员任务读取能力。
  const canViewCombinedMemberTasks = !usCollab && !productionWorkspace && canReassignTasks;
  const canSyncProductionPermission = usePermission(PERMISSIONS.RD_TASK_SYNC_PRODUCTION);
  const canSyncProduction = canSyncProductionPermission && !usCollab && !productionWorkspace;
  const [showCreate, setShowCreate] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [reassignTaskId, setReassignTaskId] = useState<string | null>(null);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [deleteTaskPendingId, setDeleteTaskPendingId] = useState<string | null>(null);
  const deleteTaskRequestSequenceRef = useRef(0);
  const deleteTaskPendingRequestRef = useRef<{ sequence: number; taskId: string } | null>(null);
  const [showClearData, setShowClearData] = useState(false);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [showProjectClassification, setShowProjectClassification] = useState(false);
  const [syncedProductionTaskIds, setSyncedProductionTaskIds] = useState<Set<string>>(() => new Set());
  const [syncingProductionTaskId, setSyncingProductionTaskId] = useState<string | null>(null);
  useEffect(() => {
    if (!canSyncProduction) {
      setSyncedProductionTaskIds(new Set());
      return;
    }
    let cancelled = false;
    fetchRdProductionTaskSyncs()
      .then((records) => {
        if (!cancelled) setSyncedProductionTaskIds(new Set(records.filter((record) => record.active).map((record) => record.task_id)));
      })
      .catch(() => { if (!cancelled) setSyncedProductionTaskIds(new Set()); });
    return () => { cancelled = true; };
  }, [canSyncProduction]);
  const handleToggleProductionSync = useCallback(async (task: Task) => {
    if (!canSyncProduction || syncingProductionTaskId) return;
    const currentlySynced = syncedProductionTaskIds.has(task.task_id);
    setSyncingProductionTaskId(task.task_id);
    try {
      const next = currentlySynced
        ? await revokeRdTaskProductionSync(task.task_id)
        : await syncRdTaskToProduction(task.task_id);
      setSyncedProductionTaskIds((previous) => {
        const updated = new Set(previous);
        if (next.active) updated.add(task.task_id);
        else updated.delete(task.task_id);
        return updated;
      });
      toast.success(next.active ? t("已同步到生产驾驶舱") : t("已撤销生产驾驶舱同步"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("同步操作失败，请重试"));
    } finally {
      setSyncingProductionTaskId(null);
    }
  }, [canSyncProduction, syncedProductionTaskIds, syncingProductionTaskId]);
  // 驾驶舱备注回执（管理视角）：他人给任务留的备注是否被目标人查看/跟进，经 NoteReceiptContext 下发。
  const [noteReceipts, setNoteReceipts] = useState<Record<string, RdTaskNoteReceipt>>({});
  const reloadReceipts = useCallback(() => {
    fetchRdTaskNoteReceipts().then(setNoteReceipts).catch(() => {});
  }, []);
  useEffect(() => { reloadReceipts(); }, [reloadReceipts]);
  // 打开任务详情的统一入口：协同/研发驾驶舱均进各自的全屏双栏详情页（不走抽屉）。
  // 任务对象随 location.state 带给详情页 → 秒开渲染（详情页后台再拉最新覆盖）
  const openTaskDetail = useCallback(
    (task: Task, activityActor?: TaskActivityActor) => {
      const activitySearch = (() => {
        if (!activityActor?.name && !activityActor?.id) return "";
        const params = new URLSearchParams();
        if (activityActor.id) params.set("activity_user_id", activityActor.id);
        if (activityActor.name) params.set("activity_user_name", activityActor.name);
        const query = params.toString();
        return query ? `?${query}` : "";
      })();
      if (task.source_workspace === "us-collab") {
        navigate(`/us-collab-task/${encodeURIComponent(task.task_id)}${activitySearch}`, { state: { task } });
        return;
      }
      // 打开即上报已读：若当前用户正是备注目标人，回执会从「待查看」转「已查看」。
      // 乐观本地更新该任务回执为已读（服务端下次拉取校正）。
      setNoteReceipts((prev) => {
        const r = prev[task.task_id];
        if (!r || r.state === "read") return prev;
        return { ...prev, [task.task_id]: { ...r, state: "read" } };
      });
      void markRdTaskNotesRead(task.task_id).catch(() => {});
      if (isUsCollabWorkspace()) {
        navigate(`/us-collab-task/${encodeURIComponent(task.task_id)}${activitySearch}`, { state: { task } });
        return;
      }
      if (isProductionWorkspace()) {
        navigate(`/production-task/${encodeURIComponent(task.task_id)}${activitySearch}`, { state: { task } });
        return;
      }
      navigate(`/rd-task/${encodeURIComponent(task.task_id)}${activitySearch}`, { state: { task } });
    },
    [navigate],
  );
  const [moveTaskTarget, setMoveTaskTarget] = useState<Task | null>(null);
  // 存身份主键而非姓名：同名同事必须能分开选中，下游也才能拿到正确的 user_id。
  const [selectedPerson, setSelectedPerson] = useState<{
    key: string;
    name: string;
    user_id: string | null;
  } | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // 概览「人员任务」专用：主库 + 所有产品库合并的分类树（跨产品聚合，与个人工作台主责同源）。
  // null = 尚未加载/加载失败，此时回退到当前 `categories`（主库），保证不空白、不崩溃。
  const [mergedCategories, setMergedCategories] = useState<Category[] | null>(null);
  // 管理员人员视角专用：研发任务 + 协同任务。KPI 与 AI 分析仍只读上面的研发合并树。
  const [memberTaskCategories, setMemberTaskCategories] = useState<Category[] | null>(null);
  const [peopleProfiles, setPeopleProfiles] = useState<PersonProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductDef[]>([]);
  const [showProductManage, setShowProductManage] = useState(false);
  // 每次跨产品/跨系统移动后 +1，用于让子系统全景重新拉取受影响产品的统计
  const [panoramaReloadToken, setPanoramaReloadToken] = useState(0);
  const [completedTaskNotice, setCompletedTaskNotice] = useState<Task | null>(null);
  // Page view mode:
  //   "overview" = leadership dashboard (landing)
  //   "board"    = detailed system work view
  //   "people"   = hidden people management page (drill-down only)
  const [mode, setMode] = useState<"overview" | "board" | "people">("overview");
  // 当前驾驶舱正在操作的产品。overview 永远是主产品；进入某产品的 board 后切到该产品，
  // 此时 `categories` 装载的是该产品的独立任务树，全板块（统计/树/增删改查）都作用于它。
  const [boardProductId, setBoardProductId] = useState<string>(MAIN_PRODUCT_ID);
  const categoriesLoadSeqRef = useRef(0);
  const categoriesLoadProductRef = useRef(MAIN_PRODUCT_ID);

  // 按产品加载分类树到 `categories`：主产品走主库端点，其余走对应产品库端点。
  const loadCategoriesFor = (productId: string) => {
    const requestSeq = ++categoriesLoadSeqRef.current;
    categoriesLoadProductRef.current = productId;
    const isCurrentRequest = () => requestSeq === categoriesLoadSeqRef.current && categoriesLoadProductRef.current === productId;
    setLoading(true);
    setLoadError(null);
    const fetcher =
      productId === MAIN_PRODUCT_ID
        ? fetchRdTaskCategories()
        : fetchProductTaskCategories(productId);
    fetcher
      .then((nextCategories) => {
        if (!isCurrentRequest()) return;
        setCategories(nextCategories);
        setSelectedCatId((current) => {
          if (!current) return null;
          const stillExists = nextCategories.some((cat) => cat.id === current || cat.children.some((sub) => sub.id === current));
          return stillExists ? current : null;
        });
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        setCategories([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : productionWorkspace
              ? t("生产任务接口加载失败")
              : t("研发任务接口加载失败"),
        );
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });
  };
  // 零参刷新当前 board 产品。所有既有 `loadCategories()` 调用点（任务变更/创建/删除后刷新）
  // 因此自动作用于当前产品；即便被当作事件处理器(带 event 实参)调用也安全——这里忽略实参。
  const loadCategories = () => loadCategoriesFor(boardProductId);

  const handleDeleteTaskConfirm = async () => {
    const target = deleteTaskTarget;
    // ref 锁在同一事件循环内立即生效，避免双击在 React state 提交前发起两次删除。
    if (!target || deleteTaskPendingRequestRef.current) return;
    const requestedTaskId = target.task_id;
    const request = {
      sequence: ++deleteTaskRequestSequenceRef.current,
      taskId: requestedTaskId,
    };
    deleteTaskPendingRequestRef.current = request;
    setDeleteTaskPendingId(requestedTaskId);
    try {
      await deleteRdTask(requestedTaskId);
      // 仅当前请求可以发布结果；功能性更新同时保证旧请求不会关闭后来打开的任务。
      if (deleteTaskPendingRequestRef.current !== request) return;
      toast.success(t("任务已删除"));
      setDeleteTaskTarget((current) => resolveDeleteDialogTargetAfterSuccess(current, requestedTaskId));
      void loadCategories();
    } catch (err) {
      if (deleteTaskPendingRequestRef.current === request) {
        toast.error(err instanceof Error ? err.message : t("删除失败"));
      }
    } finally {
      // 若未来有更新的删除请求接管锁，旧请求不得清理它的 pending 状态。
      if (deleteTaskPendingRequestRef.current === request) {
        deleteTaskPendingRequestRef.current = null;
        setDeleteTaskPendingId((current) => current === requestedTaskId ? null : current);
      }
    }
  };

  // 拉取「所有产品库合并」的分类树，供概览人员负载跨产品聚合。失败则回退到主库(mergedCategories=null)。
  const loadMergedCategories = useCallback(() => {
    fetchRdCockpitTaskCategories()
      .then((merged) => setMergedCategories(merged))
      .catch(() => setMergedCategories(null));
  }, []);

  const loadMemberTaskCategories = useCallback(() => {
    if (!canViewCombinedMemberTasks) {
      setMemberTaskCategories(null);
      return;
    }
    fetchRdMemberTaskCategories()
      .then((combined) => setMemberTaskCategories(combined))
      .catch(() => setMemberTaskCategories(null));
  }, [canViewCombinedMemberTasks]);

  useEffect(() => {
    loadCategories();
    fetchRdProducts().then(setProducts).catch(() => {
      toast.error(t("产品线数据加载失败，部分功能可能不可用"));
    });
  }, []);

  // 概览模式下保持「合并树」新鲜：进入概览、跨产品移动(panoramaReloadToken)、或本地任务变更
  // 触发 categories 刷新时一并重拉。board 模式不拉(用单库 categories 即可，省一次请求)。
  useEffect(() => {
    // 等当前单库任务树稳定后再拉聚合树，避免首次挂载先以空 categories 请求一次、
    // 主树返回后又请求一次；任务变更完成后仍会随 categories / loading 重新刷新。
    if (mode !== "overview" || loading) return;
    loadMergedCategories();
    loadMemberTaskCategories();
  }, [mode, categories, loading, panoramaReloadToken, loadMergedCategories, loadMemberTaskCategories]);

  const handleSaveProducts = async (next: ProductDef[]) => {
    await saveRdProducts(next);
    setProducts(next);
  };

  // ── System tree CRUD ─────────────────────────────────────────────────────
  const [treeEditor, setTreeEditor] = useState<SystemTreeEditorRequest | null>(null);
  const [moveTasks, setMoveTasks] = useState<{ fromCat: Category; fromSub: SubProject } | null>(null);

  const handleTreeEditorSubmit = async (label: string) => {
    if (!treeEditor) return;
    const safeLabel = label.trim();
    let nextCategories: Category[] = categories;
    let auditAction: "category.created" | "category.edited" | "category.deleted" | "sub_project.created" | "sub_project.edited" | "sub_project.deleted" = "category.created";
    let auditResourceId = "";
    let auditResourceName = "";

    if (treeEditor.mode === "add-system") {
      const dup = categories.find((c) => c.label.trim() === safeLabel);
      if (dup) { toast.error(t("已存在同名系统：{name}", { name: safeLabel })); return; }
      const newCat: Category = {
        id: `rd-cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: safeLabel,
        children: [],
      };
      nextCategories = [...categories, newCat];
      auditAction = "category.created";
      auditResourceId = newCat.id;
      auditResourceName = newCat.label;
    } else if (treeEditor.mode === "edit-system") {
      const target = treeEditor.category;
      if (categories.some((c) => c.id !== target.id && c.label.trim() === safeLabel)) {
        toast.error(t("已存在同名系统：{name}", { name: safeLabel })); return;
      }
      nextCategories = categories.map((c) => (c.id === target.id ? { ...c, label: safeLabel } : c));
      auditAction = "category.edited";
      auditResourceId = target.id;
      auditResourceName = safeLabel;
    } else if (treeEditor.mode === "delete-system") {
      const target = treeEditor.category;
      nextCategories = categories.filter((c) => c.id !== target.id);
      auditAction = "category.deleted";
      auditResourceId = target.id;
      auditResourceName = target.label;
    } else if (treeEditor.mode === "add-sub") {
      const target = treeEditor.category;
      if (target.children.some((s) => s.label.trim() === safeLabel)) {
        toast.error(t("「{parent}」下已存在同名子项：{name}", { parent: target.label, name: safeLabel })); return;
      }
      const newSub: SubProject = {
        id: `rd-sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: safeLabel,
        tasks: [],
      };
      nextCategories = categories.map((c) =>
        c.id === target.id ? { ...c, children: [...c.children, newSub] } : c,
      );
      auditAction = "sub_project.created";
      auditResourceId = newSub.id;
      auditResourceName = `${target.label} / ${newSub.label}`;
    } else if (treeEditor.mode === "edit-sub") {
      const { category, sub } = treeEditor;
      if (category.children.some((s) => s.id !== sub.id && s.label.trim() === safeLabel)) {
        toast.error(t("「{parent}」下已存在同名子项：{name}", { parent: category.label, name: safeLabel })); return;
      }
      nextCategories = categories.map((c) =>
        c.id === category.id
          ? { ...c, children: c.children.map((s) => (s.id === sub.id ? { ...s, label: safeLabel } : s)) }
          : c,
      );
      auditAction = "sub_project.edited";
      auditResourceId = sub.id;
      auditResourceName = `${category.label} / ${safeLabel}`;
    } else if (treeEditor.mode === "delete-sub") {
      // delete-sub
      const { category, sub } = treeEditor;
      nextCategories = categories.map((c) =>
        c.id === category.id
          ? { ...c, children: c.children.filter((s) => s.id !== sub.id) }
          : c,
      );
      auditAction = "sub_project.deleted";
      auditResourceId = sub.id;
      auditResourceName = `${category.label} / ${sub.label}`;
    } else {
      // move-tasks — handled separately via handleTreeEditorRequest, should not reach here
      return;
    }

    try {
      // 系统树保存按当前 board 产品路由：主产品→主库；其余→对应产品库。
      let saved: Category[];
      if (boardProductId === MAIN_PRODUCT_ID) {
        saved = await saveRdTaskCategories(nextCategories);
      } else {
        const result = await saveProductTaskCategories(boardProductId, nextCategories);
        // 滚动发布期间旧 API 只返回 { ok: true }；缺失服务端树时立即重读，不回退到本地乐观快照。
        saved = result.categories ?? await fetchProductTaskCategories(boardProductId);
      }
      setCategories(saved);
      setPanoramaReloadToken((n) => n + 1);
      toast.success(
        treeEditor.mode.startsWith("add") ? t("新增成功")
        : treeEditor.mode.startsWith("edit") ? t("已更新")
        : t("已删除"),
      );
      setTreeEditor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("保存失败"));
    }
  };

  const handleTreeEditorRequest = (req: SystemTreeEditorRequest) => {
    if (req.mode === "move-tasks") {
      setMoveTasks({ fromCat: req.fromCategory, fromSub: req.fromSub });
    } else {
      setTreeEditor(req);
    }
  };

  const handleMoveTasksConfirm = async (
    taskIds: string[],
    targetProductId: string,
    targetCatId: string,
    targetSubId: string,
  ) => {
    try {
      const result = await moveRdTasks({ taskIds, targetProductId, targetCategoryId: targetCatId, targetSubId });
      // 后端返回主产品最新树。当前在主产品 board 直接用它；在非主产品 board 则重拉该产品树
      // （移入/移出都会改变当前产品树，必须重取而非套用主产品树）。
      if (boardProductId === MAIN_PRODUCT_ID) {
        setCategories(result.categories);
      } else {
        loadCategoriesFor(boardProductId);
      }
      setPanoramaReloadToken((n) => n + 1);
      const crossProduct = targetProductId !== boardProductId;
      const productLabel = products.find((p) => p.id === targetProductId)?.name ?? "";
      const movedPath = `${result.targetCategoryLabel} / ${result.targetSubLabel}`;
      toast.success(
        crossProduct
          ? `已移动 ${result.movedCount} 个任务到 ${productLabel} · ${movedPath}`
          : `已移动 ${result.movedCount} 个任务`,
      );
      setMoveTasks(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("移动失败，请重试"));
    }
  };

  const handleSingleMoveTaskConfirm = async (
    targetProductId: string,
    targetCatId: string,
    targetSubId: string,
  ) => {
    const task = moveTaskTarget;
    if (!task) return;
    try {
      const result = await moveRdTasks({
        taskIds: [task.task_id],
        targetProductId,
        targetCategoryId: targetCatId,
        targetSubId,
      });
      if (boardProductId === MAIN_PRODUCT_ID) {
        setCategories(result.categories);
      } else {
        loadCategoriesFor(boardProductId);
      }
      setPanoramaReloadToken((n) => n + 1);
      const crossProduct = targetProductId !== boardProductId;
      const productLabel = products.find((p) => p.id === targetProductId)?.name ?? "";
      const movedPath = `${result.targetCategoryLabel} / ${result.targetSubLabel}`;
      toast.success(crossProduct ? t("任务已移动到 {product} · {path}", { product: productLabel, path: movedPath }) : t("任务已移动到 {path}", { path: movedPath }));
      setMoveTaskTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("移动失败，请重试"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchRdPeople()
      .then((people) => {
        if (!cancelled) setPeopleProfiles(people as PersonProfile[]);
      })
      .catch(() => {
        if (!cancelled) setPeopleProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get("q")?.trim();
    const view = params.get("view");
    const categoryId = params.get("category");
    if (nativeRdCockpit && query) {
      setMode("overview");
      setSelectedCatId(null);
      if (boardProductId !== MAIN_PRODUCT_ID) {
        setBoardProductId(MAIN_PRODUCT_ID);
        loadCategoriesFor(MAIN_PRODUCT_ID);
      }
      return;
    }
    if (view === "board" || categoryId) {
      setMode("board");
      setSelectedCatId(categoryId);
    }
  }, [location.search]);

  // 分类卡片 / 风险列表 / enterBoard 跳转一律用「当前产品库」——合并树是跨库拼接，
  // 各库带着同一套 id 的 POC/BOM 分类，喂给 buildCatStats 会让分类卡重复渲染、跳转选错库。
  const risks = useMemo(() => computeRisks(categories), [categories]);
  const catStats = useMemo(() => buildCatStats(categories, risks), [categories, risks]);
  /**
   * KPI 数字的统计范围：概览模式跨所有产品库，进入某产品库 board 后回到该库。
   * 只用于「求和」，所以合并树里 id 重复的分类不会造成问题（本就是不同库的不同分类，各自带各自的任务）；
   * 但正因为会重复，它绝不能拿去渲染分类卡片或参与跳转——那两件事仍走上面的 catStats。
   * mergedCategories 仅在概览模式拉取，未就绪时回退主库 categories，避免空窗。
   */
  const kpiCategories = mode === "overview" ? (mergedCategories ?? categories) : categories;
  const kpiRisks = useMemo(
    () => (kpiCategories === categories ? risks : computeRisks(kpiCategories)),
    [kpiCategories, categories, risks],
  );
  const kpiStats = useMemo(
    () => (kpiCategories === categories ? catStats : buildCatStats(kpiCategories, kpiRisks)),
    [kpiCategories, categories, catStats, kpiRisks],
  );
  // 「人员任务」与 KPI 同范围；子任务只在父任务详情/合并关系中展示。
  const peopleCategories = mode === "overview" ? (memberTaskCategories ?? kpiCategories) : categories;
  const personLoads = useMemo(
    () => computePersonLoads(peopleCategories, 8, peopleProfiles),
    [peopleCategories, peopleProfiles],
  );
  // 概览模式只向「人员任务驾驶舱」提供跨产品库根任务，避免子任务重复显示为独立卡片。
  const peopleAllTasks = useMemo(() => {
    const tasks = rootTasksFromCategories(peopleCategories);
    // 用与卡片标签同口径的 taskActivityKey 倒序（最新活动在前），保证人员抽屉等不再二次排序的
    // 消费方也是「最新优先」，与 PersonTaskCockpit 内部 sortByUpdatedDesc 完全一致。
    return tasks.sort((a, b) => {
      const ta = taskActivityKey(a);
      const tb = taskActivityKey(b);
      if (tb > ta) return 1;
      if (tb < ta) return -1;
      return 0;
    });
  }, [peopleCategories]);
  const classificationTasks = useMemo(
    () => rootTasksFromCategories(mode === "overview" ? (mergedCategories ?? categories) : categories),
    [categories, mergedCategories, mode],
  );

  const enterBoard = (catId: string, productId: string = MAIN_PRODUCT_ID) => {
    const params = new URLSearchParams(location.search);
    if (nativeRdCockpit && params.has("q")) {
      params.delete("q");
      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
          hash: location.hash,
        },
        { replace: true },
      );
    }
    // 切换产品时把该产品的独立任务树装载进 `categories`；同产品（含主产品）无需重载。
    if (productId !== boardProductId) {
      setBoardProductId(productId);
      loadCategoriesFor(productId);
    }
    setSelectedCatId(catId);
    setMode("board");
  };
  const allTasks = useMemo(() => {
    const tasks = rootTasksFromCategories(categories);
    // 按「最后活动时间」倒序，最新变更/留痕的任务排最前。last_activity_at = max(updated_at, 最新留痕时间)，
    // 与卡片「最近更新」显示同口径——只用 updated_at 会让刚留痕的任务沉底、与显示打架出现逆序。
    return tasks.sort((a, b) => {
      const ta = a.last_activity_at ?? a.updated_at ?? "";
      const tb = b.last_activity_at ?? b.updated_at ?? "";
      if (tb > ta) return 1;
      if (tb < ta) return -1;
      return 0;
    });
  }, [categories]);
  // 「活跃」= 非归档且未完成，与个人工作台的 activeRoleTasks 同口径。
  // 「非归档」仅用作完成率的分母（分母含已完成，否则完成率无意义）。
  const nonArchivedTasks = useMemo(() => allTasks.filter((task) => !isArchivedTask(task)), [allTasks]);
  const activeTasks = useMemo(
    () => nonArchivedTasks.filter((task) => task.status !== "completed"),
    [nonArchivedTasks],
  );
  const totalActive = activeTasks.length;
  const pendingAssign = useMemo(() => allTasks.filter((t) => t.status === "pending_assign").length, [allTasks]);
  const averageProgress = useMemo(() => {
    if (activeTasks.length === 0) return 0;
    return Math.round(activeTasks.reduce((sum, task) => sum + task.progress, 0) / activeTasks.length);
  }, [activeTasks]);
  const allSystemSummary = useMemo(() => {
    const done = nonArchivedTasks.filter((task) => task.status === "completed").length;
    return {
      inProgress: activeTasks.filter((task) => task.status === "in_progress").length,
      done,
      blocked: activeTasks.filter((task) => task.status === "paused_blocked" || task.status === "pending_assign").length,
      rate: nonArchivedTasks.length > 0 ? Math.round((done / nonArchivedTasks.length) * 100) : 0,
    };
  }, [activeTasks, nonArchivedTasks]);
  const openPersonDetail = (person: PersonLoad) => {
    if (!isTaskOwnerMember(person.name, person.user_id, peopleProfiles)) return;
    setSelectedPerson({ key: person.key, name: person.name, user_id: person.user_id ?? null });
  };
  // 档案按 user_id 精确命中；无 user_id 的存量成员才回退姓名（同名时不会张冠李戴）。
  const selectedPersonProfile = useMemo(() => {
    if (!selectedPerson) return undefined;
    return peopleProfiles.find(
      (person) => memberIdentityKey(person.name, person.user_id) === selectedPerson.key,
    );
  }, [peopleProfiles, selectedPerson]);
  const selectedPersonLoad = useMemo(
    () => personLoads.find((load) => load.key === selectedPerson?.key),
    [personLoads, selectedPerson],
  );
  const selectedPersonTasks = useMemo(() => {
    if (!selectedPerson) return [];
    // 与头像角标严格同口径：peopleAllTasks 同范围（概览=跨所有产品库；board=当前库），
    // 且同样只取「该成员主责」的「活跃（非归档且未完成）」根任务 ——
    // 角标数 = 抽屉条数。协助任务与已完成/归档任务不进来，否则两个数字永远对不上。
    return peopleAllTasks.filter(
      (task) =>
        memberIdentityKey(task.primary_owner, task.primary_owner_user_id) === selectedPerson.key &&
        !isArchivedTask(task) &&
        task.status !== "completed",
    );
  }, [peopleAllTasks, selectedPerson]);
  // 抽屉不铺开协助任务，但要露出数量，否则领导会以为这个人只有主责这些活。
  const selectedPersonCollaboratingCount = useMemo(() => {
    if (!selectedPerson) return 0;
    return peopleAllTasks.filter(
      (task) =>
        memberIdentityKey(task.primary_owner, task.primary_owner_user_id) !== selectedPerson.key &&
        task.collaborators.some((c) => memberIdentityKey(c.name, c.user_id) === selectedPerson.key) &&
        !isArchivedTask(task) &&
        task.status !== "completed",
    ).length;
  }, [peopleAllTasks, selectedPerson]);

  const selectedCategory = selectedCatId
    ? categories.find((c) => c.id === selectedCatId || c.children.some((sub) => sub.id === selectedCatId))
    : null;
  const selectedSub = selectedCategory?.children.find((sub) => sub.id === selectedCatId) ?? null;
  const selectedLabel = selectedSub ? `${selectedCategory?.label} / ${selectedSub.label}` : selectedCategory?.label;
  const boardProductName =
    boardProductId === MAIN_PRODUCT_ID
      ? null
      : products.find((p) => p.id === boardProductId)?.name ?? null;

  // Visible risks (depend on selection)
  const visibleRisks = useMemo(() => {
    if (selectedCatId === null) return risks;
    if (selectedSub) {
      const subTaskIds = collectTaskIds(selectedSub.tasks);
      return risks.filter((risk) => subTaskIds.has(risk.task.task_id));
    }
    return risks.filter((r) => r.category.id === selectedCatId);
  }, [risks, selectedCatId, selectedSub]);

  const selectedStat = selectedSub
    ? {
        total: selectedSub.tasks.filter((task) => !isArchivedTask(task)).length,
        progress: calcSubProgress(selectedSub),
      }
    : selectedCatId
      ? catStats.find((s) => s.cat.id === selectedCatId)
      : null;
  const scopedRisks = selectedCatId === null ? risks : visibleRisks;
  const primaryRisk = scopedRisks[0] ?? null;
  const criticalCount = scopedRisks.filter((risk) => risk.severity === "critical").length;
  const scopeTitle = selectedLabel ?? (productionWorkspace ? t("全部生产系统") : t("全部研发系统"));
  const detailScope = selectedSub ?? selectedCategory ?? null;
  const detailActiveTasks = useMemo(
    () => (detailScope ? collectRootActiveTasks(detailScope) : allTasks.filter((task) => !isArchivedTask(task))),
    [allTasks, detailScope],
  );
  const detailBlockedCount = detailActiveTasks.filter(
    (task) => task.status === "paused_blocked" || task.status === "pending_assign",
  ).length;

  const actualsProductId = productionActualsProductId ?? boardProductId;
  const productionViewSwitch = productionWorkspace ? (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <Tabs value={productionActualsOpen ? 'actuals' : 'tasks'} onValueChange={(value) => { if (value === 'actuals') setProductionActualsProductId(boardProductId); setProductionActualsOpen(value === 'actuals'); }}>
        <TabsList aria-label={t('生产驾驶舱视图')}>
          <TabsTrigger value="tasks">{t('任务驾驶舱')}</TabsTrigger>
          <TabsTrigger value="actuals">{t('生产实绩')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {productionActualsOpen && <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">{t('产品')}
          <select value={actualsProductId} className="h-8 max-w-64 rounded-md border border-slate-200 bg-white px-2 text-xs" onChange={(event) => setProductionActualsProductId(event.target.value)}>
            {!products.some((product) => product.id === actualsProductId) && <option value={actualsProductId}>{t('当前产品')}</option>}
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        {canOpenProcurement && <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/proc-cockpit?${new URLSearchParams({ view: 'systems', product: actualsProductId, line: 'production' })}`)}>{t('进入子系统登记')}<ArrowRight aria-hidden="true" className="ml-1 size-3.5" /></Button>}
      </div>}
    </div>
  ) : null;

  if (productionWorkspace && productionActualsOpen) {
    return <div className="rd-horizon-module mx-auto w-full max-w-[1600px] px-1 sm:px-3">{productionViewSwitch}<SubsystemOperationsPanel key={actualsProductId} productId={actualsProductId} /></div>;
  }

  // ───── Overview mode (leadership landing) ────────────────────────────────
  if (mode === "overview") {
    return (
      <NoteReceiptContext.Provider value={noteReceipts}>
      <TooltipProvider delayDuration={150}>
        {/* 协同驾驶舱维持独立信息布局，三套驾驶舱共用 Horizon 外壳。 */}
        <div className={cn(horizonCockpit && "rd-horizon-module", isUsCollabWorkspace() && "mx-auto w-full max-w-[1200px] px-1 sm:px-3 2xl:px-0")}>
        {productionViewSwitch}
        <ExecutiveOverview
          catStats={catStats}
          // KPI 数字跨产品库（概览），分类卡与跳转仍按当前库的 catStats
          kpiStats={kpiStats}
          products={products}
          // 风险集与 allTasks 同范围，否则概览下其他产品库的任务永远不显示风险标记、
          // 且 KPI「风险」数与点开后筛出的条数对不上
          risks={kpiRisks}
          personLoads={personLoads}
          peopleDirectory={peopleProfiles}
          // 概览「人员任务」用跨所有产品库的任务全集（与 personLoads 角标同范围）
          allTasks={peopleAllTasks}
          initialActivityActor={initialActivityActor}
          searchKeyword={cockpitSearchKeyword}
          onSearchKeywordChange={nativeRdCockpit ? handleCockpitSearchKeywordChange : undefined}
          onSelectSystem={enterBoard}
          onSelectTask={openTaskDetail}
          onSelectPerson={openPersonDetail}
          onOpenPeople={canManagePeople ? () => navigate(peopleManagementPath) : undefined}
          loading={loading}
          loadError={loadError}
          onRefresh={loadCategories}
          onCreateTask={undefined}
          onReassign={canReassignTasks ? () => { setReassignTaskId(null); setShowReassign(true); } : undefined}
          onClearData={canClearData ? () => setShowClearData(true) : undefined}
          onAiProject={canDirectProject ? () => setShowProposalDialog(true) : undefined}
          canCreateTask={canCreateTask}
          canReassign={canReassignTasks}
          canClearData={canClearData}
          canDirectProject={canDirectProject}
          onReassignTask={(task) => { setReassignTaskId(task.task_id); setShowReassign(true); }}
          canDelete={canDeleteTasks}
          canDeleteAny={canDeleteAnyTask}
          onDeleteTask={(task) => setDeleteTaskTarget(task)}
          canSyncProduction={canSyncProduction}
          syncedProductionTaskIds={syncedProductionTaskIds}
          syncingProductionTaskId={syncingProductionTaskId}
          onToggleProductionSync={handleToggleProductionSync}
          onManageProducts={canCreateTask ? () => setShowProductManage(true) : undefined}
          canManageProducts={canCreateTask}
          onAiClassifyTasks={AI_FULL_CLASSIFICATION_VISIBLE && canDirectProject && !usCollab && !productionWorkspace
            ? () => setShowProjectClassification(true)
            : undefined}
          panoramaReloadToken={panoramaReloadToken}
          hideSystemPanorama={hideSystemPanorama}
          horizonVariant={horizonCockpit}
        />
        <AlertDialog
          open={!!deleteTaskTarget}
          onOpenChange={(open) => {
            if (!open && !deleteTaskPendingRequestRef.current) setDeleteTaskTarget(null);
          }}
        >
          <AlertDialogContent
            className={cn(horizonCockpit && "rd-horizon-module-dialog")}
            onEscapeKeyDown={(event) => { if (deleteTaskPendingRequestRef.current) event.preventDefault(); }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{t("删除任务？")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("确认删除「{title}」？该操作不可恢复", {
                  title: deleteTaskTarget ? taskVisibleTitle(deleteTaskTarget) : t("未命名任务"),
                })}
                {(deleteTaskTarget?.subtasks?.length ?? 0) > 0
                  ? t("，且会一并删除其 {n} 个子任务", { n: deleteTaskTarget?.subtasks?.length ?? 0 })
                  : ""}
                {lang === "zh" ? "。" : "."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteTaskPendingId !== null}>{t("取消")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                disabled={deleteTaskPendingId !== null}
                onClick={(event) => {
                  // Radix Action 默认立即关闭；删除完成前保持确认框并锁定重复提交。
                  event.preventDefault();
                  void handleDeleteTaskConfirm();
                }}
              >
                {deleteTaskPendingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleteTaskPendingId !== null ? t("删除中…") : t("确认删除")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AnimatePresence>
          {completedTaskNotice && (
            <TaskCompletedCelebration
              key="completed-notice"
              task={completedTaskNotice}
              onClose={() => setCompletedTaskNotice(null)}
            />
          )}
          {selectedPerson && (
            <PersonDetailDrawer
              name={selectedPerson.name}
              profile={selectedPersonProfile}
              load={selectedPersonLoad}
              tasks={selectedPersonTasks}
              collaboratingCount={selectedPersonCollaboratingCount}
              onClose={() => setSelectedPerson(null)}
              onOpenTask={(task) => {
                setSelectedPerson(null);
                openTaskDetail(task, { id: selectedPerson.user_id ?? undefined, name: selectedPerson.name });
              }}
            />
          )}
          {showReassign && (
            <TaskReassignModal
              initialTaskId={reassignTaskId}
              allTasks={allTasks}
              horizonVariant={horizonCockpit}
              onClose={() => { setShowReassign(false); setReassignTaskId(null); }}
              onUpdated={loadCategories}
            />
          )}
          {showClearData && (
            <ClearDataDialog
              onClose={() => setShowClearData(false)}
              onCleared={() => { setShowClearData(false); loadCategories(); }}
            />
          )}
          {moveTaskTarget && (
            <MoveTaskDialog
              key={`move-task-${moveTaskTarget.task_id}`}
              task={moveTaskTarget}
              categories={categories}
              products={products}
              onConfirm={handleSingleMoveTaskConfirm}
              onClose={() => setMoveTaskTarget(null)}
            />
          )}
          {AI_FULL_CLASSIFICATION_VISIBLE && showProjectClassification ? (
            <ProjectClassificationDialog
              key="all-online-task-classification"
              scopeLabel="全部线上任务（跨产品库）"
              tasks={classificationTasks}
              onClose={() => setShowProjectClassification(false)}
              onOpenTask={(task) => {
                setShowProjectClassification(false);
                openTaskDetail(task);
              }}
              onMerged={() => {
                loadCategories();
                setPanoramaReloadToken((token) => token + 1);
              }}
            />
          ) : null}
        </AnimatePresence>
        {showProposalDialog && (
          <RDProjectProposalDialog
            open={showProposalDialog}
            onClose={() => setShowProposalDialog(false)}
            onCompleted={() => { setShowProposalDialog(false); loadCategories(); }}
            userRole="admin"
          />
        )}
        {showCreate && canCreateTask && (
          <AiCreatePanel
            categories={categories}
            peopleProfiles={peopleProfiles}
            personLoads={personLoads}
            productId={MAIN_PRODUCT_ID}
            onCreated={loadCategories}
            onClose={() => setShowCreate(false)}
          />
        )}
        <ProductManageDialog
          open={showProductManage}
          products={products}
          horizonVariant={horizonCockpit}
          onClose={() => setShowProductManage(false)}
          onSave={handleSaveProducts}
        />
        </div>
      </TooltipProvider>
      </NoteReceiptContext.Provider>
    );
  }

  // ───── People management mode (hidden drill-down) ────────────────────────
  if (mode === "people" && canManagePeople) {
    return (
      <TooltipProvider delayDuration={150}>
        <div className={cn(horizonCockpit && "rd-horizon-module rd-horizon-people-page")}>
          <PeopleManagementPage onBack={() => setMode("overview")} />
        </div>
      </TooltipProvider>
    );
  }

  // ───── Board mode (detailed work view) ───────────────────────────────────
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn(
        "flex min-h-full flex-col overflow-hidden rounded-[8px] border border-slate-200/80 bg-[#f4f7fb] shadow-[0_24px_60px_rgba(15,23,42,0.08)]",
        horizonCockpit && "rd-horizon-module rd-horizon-board",
      )}>
        {/* Breadcrumb / back to overview */}
        <div className="rd-board-breadcrumb flex min-w-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-2.5 animate-rd-fade-in">
          <button
            type="button"
            onClick={() => {
              setMode("overview");
              setSelectedCatId(null);
              if (boardProductId !== MAIN_PRODUCT_ID) {
                setBoardProductId(MAIN_PRODUCT_ID);
                loadCategoriesFor(MAIN_PRODUCT_ID);
              }
            }}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.96]"
          >
            <ChevronLeft className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
            {t("返回总览")}
          </button>
          <span className="text-xs text-slate-300">·</span>
          {boardProductName && (
            <>
              <span className="rd-board-brand-chip rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 ring-1 ring-inset ring-indigo-100">
                {boardProductName}
              </span>
              <span className="text-xs text-slate-300">›</span>
            </>
          )}
          <span className="text-sm text-slate-500">{t("详情视图")}</span>
          {selectedLabel && (
            <>
              <span className="text-xs text-slate-300">›</span>
              <span className="min-w-0 truncate text-sm font-medium text-slate-800">{selectedLabel}</span>
            </>
          )}
        </div>

        <div className="rd-board-body flex min-h-0 flex-1 overflow-hidden">
        <CategorySidebar
          catStats={catStats}
          selectedId={selectedCatId}
          onSelect={setSelectedCatId}
          totalActive={totalActive}
          totalRisks={risks.length}
          allRisks={risks}
          canManageTree={canCreateTask}
          onRequestEditor={handleTreeEditorRequest}
        />

        <div className="rd-board-main flex min-h-0 flex-1 flex-col overflow-hidden">
          {productionViewSwitch}
          <CommandCenter
            totalActive={totalActive}
            risks={risks}
            pendingAssign={pendingAssign}
            averageProgress={averageProgress}
            onCreate={undefined}
          />

          <div className="rd-board-canvas flex-1 overflow-auto bg-slate-50/40 px-5 py-5">
            <motion.div
              key={selectedCatId ?? "all"}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={RD_PANEL_TRANSITION}
              className="rd-board-content mx-auto max-w-7xl space-y-5 rd-stagger-children"
            >
              {selectedCatId === null ? (
                <>
                  <KpiStrip
                    totalActive={totalActive}
                    inProgress={allSystemSummary.inProgress}
                    done={allSystemSummary.done}
                    blocked={allSystemSummary.blocked}
                    totalRisks={risks.length}
                    rate={allSystemSummary.rate}
                  />

                  <UpcomingMilestonesSection
                    scope={null}
                    tasks={allTasks.filter((task) => !task.archived)}
                    onOpen={openTaskDetail}
                  />

                  <div className="rd-board-decision-grid grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
                    <RiskHotspot
                      risks={risks}
                      totalTasks={totalActive}
                      onSelectTask={openTaskDetail}
                      className="min-w-0"
                      title={t("需要决策")}
                      subtitle={t("按严重度排序 · 点击查看详情")}
                    />
                    <PersonLoadPanel
                      loads={personLoads}
                      className="min-w-0"
                      onManage={canManagePeople ? () => navigate(peopleManagementPath) : undefined}
                      onSelectPerson={openPersonDetail}
                    />
                  </div>

                </>
              ) : (
                <>
                  {/* Hero: compact scope summary */}
                  <SystemDetailHero
                    category={selectedCategory ?? null}
                    sub={selectedSub}
                    totalActive={selectedStat?.total ?? 0}
                    rate={selectedStat?.progress ?? 0}
                    riskCount={scopedRisks.length}
                    criticalCount={criticalCount}
                    blockedCount={detailBlockedCount}
                  />

                  {/* Part health - only when viewing a system (not a specific part) */}
                  {selectedCategory && !selectedSub && selectedCategory.children.length > 1 && (
                    <PartHealthGrid
                      category={selectedCategory}
                      selectedSubId={selectedCatId}
                      onSelectSub={setSelectedCatId}
                    />
                  )}

                  {/* Decision focus: risks + scoped people */}
                  <div className="rd-board-decision-grid grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
                    <RiskHotspot
                      risks={scopedRisks}
                      totalTasks={detailActiveTasks.length}
                      onSelectTask={openTaskDetail}
                      className="min-w-0"
                      title={selectedLabel ? `${selectedLabel} · ${t("需要决策")}` : t("需要决策")}
                      subtitle={t("按严重度排序 · 点击查看详情")}
                    />
                    <PersonLoadPanel
                      loads={computeScopedPersonLoads(selectedSub ?? selectedCategory)}
                      className="min-w-0"
                      onSelectPerson={openPersonDetail}
                    />
                  </div>

                  {/* Upcoming milestones */}
                  <UpcomingMilestonesSection
                    scope={selectedSub ?? selectedCategory}
                    onOpen={openTaskDetail}
                  />

                  {/* Full task list: show every task in the selected system */}
                  <TasksByPartSection
                    category={selectedCategory ?? null}
                    sub={selectedSub}
                    onOpen={openTaskDetail}
                  />
                </>
              )}
            </motion.div>
          </div>
        </div>

        {showCreate && canCreateTask && (
          <AiCreatePanel
            categories={categories}
            peopleProfiles={peopleProfiles}
            personLoads={personLoads}
            productId={boardProductId}
            onCreated={loadCategories}
            onClose={() => setShowCreate(false)}
          />
        )}
        <AnimatePresence>
          {treeEditor && (
            <SystemTreeEditorDialog
              request={treeEditor}
              onClose={() => setTreeEditor(null)}
              onSubmit={handleTreeEditorSubmit}
            />
          )}
          {moveTasks && (
            <MoveTasksDialog
              key="move-tasks"
              fromCategory={moveTasks.fromCat}
              fromSub={moveTasks.fromSub}
              categories={categories}
              products={products}
              onConfirm={handleMoveTasksConfirm}
              onClose={() => setMoveTasks(null)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {completedTaskNotice && (
            <TaskCompletedCelebration
              key="completed-notice-board"
              task={completedTaskNotice}
              onClose={() => setCompletedTaskNotice(null)}
            />
          )}
          {selectedPerson && (
            <PersonDetailDrawer
              name={selectedPerson.name}
              profile={selectedPersonProfile}
              load={selectedPersonLoad}
              tasks={selectedPersonTasks}
              collaboratingCount={selectedPersonCollaboratingCount}
              onClose={() => setSelectedPerson(null)}
              onOpenTask={(task) => {
                setSelectedPerson(null);
                openTaskDetail(task, { id: selectedPerson.user_id ?? undefined, name: selectedPerson.name });
              }}
            />
          )}
          {moveTaskTarget && (
            <MoveTaskDialog
              key={`move-task-${moveTaskTarget.task_id}`}
              task={moveTaskTarget}
              categories={categories}
              products={products}
              onConfirm={handleSingleMoveTaskConfirm}
              onClose={() => setMoveTaskTarget(null)}
            />
          )}
        </AnimatePresence>
        </div>
      </div>
    </TooltipProvider>
  );
}
