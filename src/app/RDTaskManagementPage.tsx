import React, { useEffect, useState, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Battery,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  Cpu,
  FileUp,
  Flame,
  FolderPlus,
  Gauge,
  LayoutGrid,
  Loader2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
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
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { usePermission } from "./hooks/usePermission";
import { AuditTimeline } from "./RDAuditTimeline";
import { AuditActor, AuditChange, recordAudit, useAuditActor, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  fetchRdAiSettings,
  fetchRdPeople,
  fetchRdTaskCategories,
  fetchRdTaskProgressNotes,
  createRdTask,
  extractRdTasksFromFile,
  extractRdTasksFromText,
  saveRdTaskCategories,
  type RdAiSettingsPayload,
  type RdAiTaskDraft,
  type RdCategory,
  type RdCollaborator,
  type RdPriority,
  type RdSubProject,
  type RdTask,
  type RdTaskProgressNote,
  type RdTaskStatus,
} from "./lib/rdApi";
import { ProgressNoteList } from "./RDProgressEvidence";

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
type Category = RdCategory;
type PersonProfile = {
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
  joined_at?: string;
};

// ─── Today ───────────────────────────────────────────────────────────────────
const TODAY_STR = new Date().toISOString().split("T")[0]!;
const TODAY = new Date(TODAY_STR);

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

const POC_BOM_RESERVED_IDS = new Set(
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

const STATUS_CONFIG: Record<TaskStatus, { label: string; dot: string; text: string; bg: string }> = {
  draft: { label: "草稿", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100" },
  in_progress: { label: "进行中", dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" },
  paused_leave: { label: "暂停·请假", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  paused_blocked: { label: "暂停·阻塞", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  completed: { label: "已完成", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  pending_assign: { label: "待指派", dot: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50" },
  archived: { label: "已封存", dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-100" },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; text: string; bg: string }> = {
  high: { label: "高", text: "text-white", bg: "border-red-600 bg-red-600" },
  medium: { label: "中", text: "text-amber-700", bg: "border-amber-200 bg-amber-50" },
  low: { label: "低", text: "text-slate-500", bg: "border-slate-200 bg-slate-50" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24));
}

type Risk = {
  task: Task;
  category: Category;
  type: "overdue" | "due_soon" | "blocked" | "pending" | "slow";
  severity: "critical" | "warning";
  reason: string;
};

// Returns the primary risk reason for a single task, or null if no risk.
function getTaskRiskReason(task: Task): { type: Risk["type"]; reason: string } | null {
  if (task.archived || task.status === "completed") return null;
  const dleft = daysUntil(task.due_date);
  if (dleft !== null && dleft < 0) return { type: "overdue", reason: `已逾期 ${-dleft} 天` };
  if (task.status === "paused_blocked") return { type: "blocked", reason: "阻塞中" };
  if (dleft !== null && dleft <= 2)
    return { type: "due_soon", reason: dleft === 0 ? "今日到期" : `${dleft} 天内到期` };
  if (task.status === "pending_assign") return { type: "pending", reason: "待人工指派" };
  if (task.final_priority === "high" && task.progress < 30 && task.status === "in_progress")
    return { type: "slow", reason: "高优先级·进度偏低" };
  return null;
}

function getTaskRiskSeverity(task: Task, type: Risk["type"]): Risk["severity"] {
  if (type === "overdue" || type === "blocked") return "critical";
  if (type === "due_soon") {
    const dleft = daysUntil(task.due_date);
    return dleft !== null && dleft <= 1 ? "critical" : "warning";
  }
  return "warning";
}

function collectTaskRisks(task: Task, category: Category): Risk[] {
  const ownRisk = getTaskRiskReason(task);
  const risks: Risk[] = ownRisk
    ? [
        {
          task,
          category,
          type: ownRisk.type,
          severity: getTaskRiskSeverity(task, ownRisk.type),
          reason: ownRisk.reason,
        },
      ]
    : [];

  if (task.subtasks) {
    for (const subtask of task.subtasks) risks.push(...collectTaskRisks(subtask, category));
  }
  return risks;
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

function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  function walk(items: Task[]) {
    for (const task of items) {
      result.push(task);
      if (task.subtasks) walk(task.subtasks);
    }
  }
  walk(tasks);
  return result;
}

function computeRisks(categories: Category[]): Risk[] {
  const risks = categories.flatMap((cat) =>
    cat.children.flatMap((sub) => sub.tasks.flatMap((task) => collectTaskRisks(task, cat))),
  );
  // critical first, then by overdue/due_soon
  return risks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

function calcCategoryProgress(cat: Category): number {
  const tasks = flattenTasks(cat.children.flatMap((s) => s.tasks)).filter((t) => !t.archived);
  if (tasks.length === 0) return 0;
  return Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length);
}

function calcSubProgress(sub: SubProject): number {
  const tasks = flattenTasks(sub.tasks).filter((t) => !t.archived);
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
      title={cfg.label}
      aria-label={cfg.label}
    />
  );
}

function PriorityPill({ priority, aiPriority }: { priority: Priority; aiPriority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority];
  const adjusted = priority !== aiPriority;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none",
        cfg.bg,
        cfg.text,
        adjusted && "ring-1 ring-amber-300",
      )}
      title={adjusted ? `AI 建议: ${PRIORITY_CONFIG[aiPriority].label}，已被组长调整` : `优先级 ${cfg.label}`}
    >
      {cfg.label}
      {adjusted && <span className="ml-px text-[8px] opacity-70">·</span>}
    </span>
  );
}

function OwnerAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "xs" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white",
        dim,
        hashColor(name),
      )}
      title={name}
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
          tone === "muted" ? "bg-slate-300" : value === 100 ? "bg-emerald-500" : "bg-blue-500",
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
              <span className="font-medium opacity-95">{RISK_LABEL[r.type]}</span>
              <span className="opacity-60"> · {r.reason}</span>
              <div className="truncate opacity-80">{r.task.title}</div>
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="text-[11px] opacity-60">…还有 {hidden} 项</li>}
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
        <div className="truncate text-sm font-semibold text-slate-900">{risk.task.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          <span className={cn("font-semibold", isCritical ? "text-red-600" : "text-amber-600")}>{risk.reason}</span>
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
        <h3 className="text-[15px] font-semibold text-slate-800">需要立刻关注</h3>
        <span className="text-xs text-slate-500">
          <span className="font-semibold text-red-600">{critCount}</span> 紧急 ·{" "}
          <span className="font-semibold text-amber-600">{risks.length - critCount}</span> 警告
        </span>
        <span className="ml-auto hidden text-xs font-medium text-slate-500 sm:inline">逾期 / 阻塞 / 高优滞后</span>
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

function DueDateChip({ dateStr }: { dateStr: string }) {
  const dleft = daysUntil(dateStr);
  if (dleft === null) return null;
  const tone =
    dleft < 0
      ? "bg-red-50 text-red-700 border-red-200"
      : dleft <= 2
        ? "bg-orange-50 text-orange-700 border-orange-200"
        : dleft <= 7
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-slate-50 text-slate-600 border-slate-200";
  const label =
    dleft < 0 ? `逾期 ${-dleft}d` : dleft === 0 ? "今日" : dleft <= 7 ? `${dleft}天后` : dateStr.slice(5);
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
  return "bg-blue-500";
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
        title={statusCfg.label}
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

        {/* Title (single line, ID on hover) */}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className={cn(
              "truncate",
              task.archived
                ? "text-slate-400 line-through"
                : task.status === "completed"
                  ? "text-slate-400"
                  : depth === 0
                    ? "text-[15px] font-semibold text-slate-950"
                    : "text-sm font-medium text-slate-700",
            )}
          >
            {task.title}
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
            <span className="inline-flex shrink-0 text-amber-500" title="AI 输出已被人工修改">
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

        {/* Owners */}
        <div className="hidden shrink-0 items-center -space-x-1.5 xl:flex">
          <OwnerAvatar name={task.primary_owner} size="xs" />
          {task.collaborators.slice(0, 1).map((c) => (
            <OwnerAvatar key={c.id} name={c.name} size="xs" />
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
              <DueDateChip dateStr={task.due_date} />
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
              ? "mb-2 ml-4 mt-1.5 rounded-[8px] border border-slate-300 bg-slate-100/80 shadow-[inset_3px_0_0_rgba(30,64,175,0.18)]"
              : "ml-4 bg-slate-100/70 py-1.5",
          )}
          style={{ marginLeft: depth === 0 ? 18 : 22 }}
        >
          {depth === 0 && (
            <div className="flex items-center justify-between border-b border-slate-300 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", taskAccentClass(task))} />
                <span className="text-sm font-semibold text-slate-800">子任务</span>
                <span className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                  {task.subtasks!.length} 项
                </span>
              </div>
              <span className="hidden text-xs font-medium text-slate-500 sm:inline">
                隶属于 {task.task_id}
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
  if (dueFilter === "overdue") return days < 0;
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
  if (!keyword) return true;
  return (
    task.title.includes(keyword) ||
    task.task_id.includes(keyword) ||
    task.primary_owner.includes(keyword) ||
    task.category_path.includes(keyword)
  );
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
          <span className="ml-1.5">{stats.total} 项</span>
          {stats.done > 0 && <span className="ml-1 text-emerald-600">· {stats.done} 完成</span>}
          {stats.blocked > 0 && <span className="ml-1 text-orange-600">· {stats.blocked} 阻塞</span>}
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

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            task.archived ? "text-slate-400 line-through" : "font-medium text-slate-700",
          )}
        >
          {task.title}
        </span>

        {/* Child count badge */}
        {hasChildren && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          {task.subtasks!.length} 项
          </span>
        )}

        <OwnerAvatar name={task.primary_owner} size="xs" />

        <div className="shrink-0 text-right">
          {task.due_date ? (
            isHot || (dleft !== null && dleft < 0) ? (
              <DueDateChip dateStr={task.due_date} />
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

// Backwards-compatible alias
function SubtaskCardRow({
  task,
  depth,
  onOpen,
}: {
  task: Task;
  depth: number;
  onOpen: (t: Task) => void;
  isLast?: boolean;
}) {
  return <SubtaskRow task={task} depth={depth} onOpen={onOpen} />;
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const hasSubtasks = Boolean(task.subtasks?.length);
  const attention = taskNeedsAttention(task);
  const [expanded, setExpanded] = useState(attention && hasSubtasks);
  const statusCfg = STATUS_CONFIG[task.status];
  const ownRisk = getTaskRiskReason(task);

  return (
    <article
      className={cn(
        "group relative rounded-md px-3 py-2.5 transition-colors hover:bg-white/85",
        attention ? "bg-white/70" : "bg-white/45",
        task.archived && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={cn("mt-1 h-9 w-1 shrink-0 rounded-full", getPriorityBarClass(task))} />

        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-semibold text-slate-500">{task.task_id}</span>
            <h4
              className={cn(
                "min-w-[180px] flex-1 truncate text-[15px] font-semibold leading-5",
                task.archived ? "text-slate-500 line-through" : "text-slate-950",
              )}
            >
              {task.title}
            </h4>
            <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold", statusCfg.bg, statusCfg.text)}>
              <StatusDot status={task.status} />
              {statusCfg.label}
            </span>
            <PriorityPill priority={task.final_priority} aiPriority={task.ai_priority} />
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <OwnerAvatar name={task.primary_owner} size="xs" />
              <span className="truncate font-medium text-slate-600">{task.primary_owner}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TimerReset className="h-3.5 w-3.5 text-slate-400" />
              {task.due_date ? <DueDateChip dateStr={task.due_date} /> : <span className="font-medium text-slate-500">未设截止</span>}
            </span>
            {task.description && <span className="min-w-[180px] flex-1 truncate text-slate-500">{task.description}</span>}
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
                    {ownRisk?.reason ?? "子任务风险"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  <div className="max-w-xs space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                      需要立刻关注
                    </div>
                    {ownRisk ? (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT_COLOR[ownRisk.type])} />
                        <span className="font-medium">{RISK_LABEL[ownRisk.type]}</span>
                        <span className="opacity-70">· {ownRisk.reason}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] opacity-70">下级任务存在逾期、阻塞或待指派问题。</div>
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
            aria-label={expanded ? "收起子任务" : "展开子任务"}
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
            className="ml-3 mt-1.5 flex w-[calc(100%-0.75rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1 text-xs text-slate-500 transition-colors hover:bg-white/75"
          >
            <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
            <span className="font-semibold text-slate-700">{task.subtasks!.length} 个子任务</span>
            <span className="text-slate-400">·</span>
            <span>共 <span className="font-semibold tabular-nums text-slate-700">{stats.total}</span> 项</span>
            {stats.done > 0 && (
              <span className="text-emerald-600">
                · <span className="tabular-nums">{stats.done}</span> 完成
              </span>
            )}
            {stats.blocked > 0 && (
              <span className="text-orange-600">
                · <span className="tabular-nums">{stats.blocked}</span> 阻塞
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
  keyword,
  statusFilter,
  priorityFilter,
  dueFilter,
  onOpen,
}: {
  sub: SubProject;
  keyword: string;
  statusFilter: TaskStatus | "all";
  priorityFilter: Priority | "all";
  dueFilter: TaskDueFilter;
  onOpen: (t: Task) => void;
}) {
  const [open, setOpen] = useState(true);
  const filteredTasks = useMemo(
    () => sub.tasks.filter((t) => taskMatches(t, keyword, statusFilter, priorityFilter, dueFilter)),
    [sub.tasks, keyword, statusFilter, priorityFilter, dueFilter],
  );

  if (filteredTasks.length === 0 && (keyword || statusFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all")) return null;
  const progress = calcSubProgress(sub);
  const riskCount = filteredTasks.filter((task) => taskNeedsAttention(task)).length;
  const activeCount = filteredTasks.filter((task) => !task.archived).length;

  return (
    <section className="rounded-[8px] bg-slate-100/55 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-slate-800 active:scale-90"
          aria-label={open ? `收起${sub.label}` : `展开${sub.label}`}
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
            <h3 className="text-base font-semibold text-slate-900">{sub.label}</h3>
            <span className="text-xs font-semibold text-slate-500">
              {activeCount} 个活跃任务
            </span>
            {riskCount > 0 &&
              (() => {
                const subRisks: Risk[] = [];
                const subRiskCategory: Category = { id: "", label: sub.label, children: [] };
                for (const t of filteredTasks) {
                  subRisks.push(...collectTaskRisks(t, subRiskCategory));
                }
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {riskCount} 个风险
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start">
                      <RiskListTooltip title={`${sub.label} · ${riskCount} 个风险任务`} risks={subRisks} />
                    </TooltipContent>
                  </Tooltip>
                );
              })()}
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
              "overflow-hidden rounded-[8px] bg-white/35 transition-all duration-300 ease-out",
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
                当前部件暂无任务
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Category Sidebar ─────────────────────────────────────────────────────────

type CatStat = {
  cat: Category;
  total: number;
  inProgress: number;
  done: number;
  blocked: number;
  progress: number;
  risks: number;
  riskItems: Risk[];
};

function buildCatStats(categories: Category[], risks: Risk[]): CatStat[] {
  return categories.map((cat) => {
    const tasks = flattenTasks(cat.children.flatMap((s) => s.tasks));
    const active = tasks.filter((t) => !t.archived);
    const catRisks = risks.filter((r) => r.category.id === cat.id);
    return {
      cat,
      total: active.length,
      inProgress: active.filter((t) => t.status === "in_progress").length,
      done: active.filter((t) => t.status === "completed").length,
      blocked: active.filter((t) => t.status === "paused_blocked" || t.status === "pending_assign").length,
      progress: calcCategoryProgress(cat),
      risks: catRisks.length,
      riskItems: catRisks,
    };
  });
}

// ─── Executive Overview helpers ──────────────────────────────────────────────

type PersonLoad = { name: string; count: number; max: number; onLeave: boolean };
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
  const counts = new Map<string, number>();
  const onLeave = new Set<string>();
  function walk(tasks: Task[]) {
    for (const t of tasks) {
      if (t.archived || t.status === "completed") continue;
      if (!/已离职|待指派/.test(t.primary_owner)) {
        counts.set(t.primary_owner, (counts.get(t.primary_owner) ?? 0) + 1);
        if (t.status === "paused_leave") onLeave.add(t.primary_owner);
      }
      for (const c of t.collaborators) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 0.5);
      }
      if (t.subtasks) walk(t.subtasks);
    }
  }
  if ("children" in scope) {
    for (const sub of scope.children) walk(sub.tasks);
  } else {
    walk(scope.tasks);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count: Math.ceil(count),
      max: maxPerPerson,
      onLeave: onLeave.has(name),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate active load per person across all categories.
 */
function computePersonLoads(categories: Category[], maxPerPerson = 8): PersonLoad[] {
  const counts = new Map<string, number>();
  const onLeave = new Set<string>();

  function walk(tasks: Task[]) {
    for (const t of tasks) {
      if (t.archived || t.status === "completed") continue;
      // Skip placeholder owners like "待指派" and "(已离职)"
      if (!/已离职|待指派/.test(t.primary_owner)) {
        counts.set(t.primary_owner, (counts.get(t.primary_owner) ?? 0) + 1);
        if (t.status === "paused_leave") onLeave.add(t.primary_owner);
      }
      for (const c of t.collaborators) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 0.5);
      }
      if (t.subtasks) walk(t.subtasks);
    }
  }
  for (const cat of categories) for (const sub of cat.children) walk(sub.tasks);

  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count: Math.ceil(count),
      max: maxPerPerson,
      onLeave: onLeave.has(name),
    }))
    .sort((a, b) => b.count - a.count);
}

type SystemTreeEditorRequest =
  | { mode: "add-system" }
  | { mode: "edit-system"; category: Category }
  | { mode: "delete-system"; category: Category }
  | { mode: "add-sub"; category: Category }
  | { mode: "edit-sub"; category: Category; sub: SubProject }
  | { mode: "delete-sub"; category: Category; sub: SubProject };

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
      className="flex w-[292px] shrink-0 flex-col border-r border-slate-200/70 bg-[#edf3f8] shadow-[8px_0_24px_rgba(15,23,42,0.025)]"
    >
      <div className="border-b border-slate-200/70 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Navigation</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-950">研发系统树</h2>
          <div className="flex items-center gap-2">
            {totalRisks > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{totalRisks} 风险</span>
            )}
            {canManageTree && onRequestEditor && (
              <button
                type="button"
                onClick={() => onRequestEditor({ mode: "add-system" })}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                title="新增一级系统"
              >
                <Plus className="h-3 w-3" />
                新增
              </button>
            )}
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                setExpandedId(null);
                onSelect(null);
              }}
              className={cn(
                "flex h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 active:scale-[0.99]",
                selectedId === null ? "bg-white text-blue-700 shadow-[0_8px_20px_rgba(37,99,235,0.08)] ring-1 ring-blue-100" : "text-slate-600 hover:bg-white/80 hover:text-slate-900 hover:shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
              )}
              aria-label="全部系统"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">全部系统</span>
              {totalRisks > 0 && (
                <span className="flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white">
                  {totalRisks}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="start">
            <RiskListTooltip title={`全部系统 · ${totalRisks} 个风险任务`} risks={allRisks} />
          </TooltipContent>
        </Tooltip>

        {catStats.map(({ cat, risks, riskItems }) => {
          const theme = getTheme(cat.id);
          const active = selectedId === cat.id;
          const activeWithin = active || cat.children.some((sub) => sub.id === selectedId);
          const expanded = expandedId === cat.id;

          const isReserved = isReservedBomSystem(cat.id);
          const subTaskCount = cat.children.reduce((sum, sub) => sum + sub.tasks.length, 0);
          return (
            <motion.div
              key={cat.id}
              layout
              transition={RD_LIST_TRANSITION}
              className={cn(
                "group/cat rounded-[8px] transition-all",
                activeWithin ? "bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80" : "hover:bg-white/65 hover:shadow-[0_8px_18px_rgba(15,23,42,0.035)]",
              )}
            >
              <div className="flex items-center gap-1 px-1 py-1">
                <button
                  type="button"
                  onClick={() => toggleExpanded(cat.id)}
                  className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-95"
                  aria-label={expanded ? `收起 ${cat.label}` : `展开 ${cat.label}`}
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
                  className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.99]"
                >
                  <span
                    className={cn(
                      "h-5 w-1 shrink-0 rounded-full bg-blue-600 transition-all duration-300 ease-out",
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
                      className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      title="新增子项"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-system", category: cat }); }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="重命名"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {!isReserved && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "delete-system", category: cat }); }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title={subTaskCount > 0 ? `删除（含 ${subTaskCount} 个任务，将一并删除）` : "删除"}
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
                      <RiskListTooltip title={`${cat.label} · ${risks} 个风险任务`} risks={riskItems} />
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
                    {cat.children.map((sub) => {
                      const subIds = collectTaskIds(sub.tasks);
                      const subRisks = riskItems.filter((risk) => subIds.has(risk.task.task_id));
                      const selected = selectedId === sub.id;
                      const subTaskTotal = sub.tasks.length;

                      return (
                        <div
                          key={sub.id}
                          className={cn(
                            "group/sub flex h-8 w-full items-center gap-1 rounded-md pr-1 transition-all duration-200",
                            selected
                              ? "bg-blue-50 shadow-[0_6px_14px_rgba(37,99,235,0.08)]"
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
                              selected ? "text-blue-800" : "text-slate-600 hover:translate-x-0.5 hover:text-slate-900",
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
                          {canManageTree && onRequestEditor && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/sub:opacity-100 focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "edit-sub", category: cat, sub }); }}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                title="重命名"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRequestEditor({ mode: "delete-sub", category: cat, sub }); }}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title={subTaskTotal > 0 ? `删除（含 ${subTaskTotal} 个任务，将一并删除）` : "删除"}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
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
    request.mode === "add-system" ? "新增一级系统"
    : request.mode === "edit-system" ? "重命名一级系统"
    : request.mode === "delete-system" ? "删除一级系统"
    : request.mode === "add-sub" ? `在「${request.category.label}」下新增子项`
    : request.mode === "edit-sub" ? "重命名子项"
    : "删除子项";

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
      toast.error("名称不能为空");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={RD_PANEL_TRANSITION}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          "flex items-center justify-between gap-3 border-b px-6 py-4",
          isDelete ? "border-red-100 bg-red-50/60" : "border-slate-100",
        )}>
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              isDelete ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600",
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
                确认删除「<span className="font-semibold text-slate-900">{request.mode === "delete-system" ? request.category.label : (request as { sub: SubProject }).sub.label}</span>」？
              </p>
              {taskCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>该节点下还有 <b>{taskCount}</b> 个任务，删除后会一并清除，操作不可恢复。</span>
                </div>
              )}
              {taskCount === 0 && (
                <p className="text-xs text-slate-500">该节点下没有任务，删除安全。</p>
              )}
            </>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">名称</label>
              <Input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                placeholder={isAdd ? (request.mode === "add-system" ? "例：新型动力系统" : "例：主控板") : "新名称"}
                disabled={saving}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              />
              {request.mode === "add-system" && (
                <p className="mt-1.5 text-[11px] text-slate-400">将作为研发系统树的一级节点；可在保存后添加子项。</p>
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
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60",
              isDelete ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isDelete ? "确认删除" : isEdit ? "保存" : "新增"}
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
          <h2 className="text-base font-semibold text-slate-950">需要决策</h2>
          <p className="sr-only">只列最需要领导关注的事项</p>
        </div>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{risks.length} 项</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[8px] bg-emerald-50 px-3 py-4 text-sm font-medium text-emerald-700">
          当前没有需要升级处理的风险。
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
          <h2 className="text-base font-semibold text-slate-950">系统健康</h2>
          <p className="sr-only">按风险和进度自动排序</p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        >
          全局
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
                selected ? "bg-blue-50 shadow-[0_8px_18px_rgba(37,99,235,0.08)] ring-1 ring-blue-200" : "bg-slate-50 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_24px_rgba(15,23,42,0.06)]",
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
          其余 {stableCount} 个系统暂未进入领导关注列表。
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
          <p className="sr-only">点击左侧图标切换系统，点击事项查看详情</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-slate-700">{selectedStat.total} 项</span>
          <span className="font-semibold text-blue-700">{selectedStat.progress}%</span>
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
          当前系统暂无升级风险。
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
  if (!modelId) return "跟随默认模型";
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
  if (!rule) return "未知文件 / 文本抽取 / OCR 兜底";
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
  onCreated,
}: {
  onClose: () => void;
  categories: Category[];
  onCreated: () => void;
}) {
  const RD_AUDIT_ACTOR = useAuditActor("研发成员");
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
    recordAudit({
      actor: RD_AUDIT_ACTOR,
      action: "ai.parse_triggered",
      resource: { type: "system", id: "rd-ai-create", name: "AI 任务解析" },
      comment: "发起 AI 任务解析",
      metadata: {
        input_length: text.trim().length,
        file_count: selectedFiles.length,
        ai_scene_id: activeScene?.id,
        model_id: activeScene?.model_id,
        model_label: describeRdAiModel(aiSettings, activeScene?.model_id),
        fallback_model_id: activeScene?.fallback_model_id,
        prompt_version: activeScene?.prompt_version,
        ocr_provider: aiSettings?.file_policy.ocr_provider,
        ocr_confidence_threshold: aiSettings?.file_policy.ocr_confidence_threshold,
      },
      source: "web",
    });
    setAiState("processing");
    try {
      const categoryLabels = categories.flatMap((category) => [
        category.label,
        ...category.children.map((child) => `${category.label} / ${child.label}`),
      ]);
      const result = selectedFiles.length > 0
        ? await extractRdTasksFromFile({
            file: selectedFiles[0]!,
            categoryLabels,
            proposalTitle: text.trim().slice(0, 80) || selectedFiles[0]!.name,
          })
        : await extractRdTasksFromText({
            text: text.trim(),
            categoryLabels,
            proposalTitle: text.trim().slice(0, 80) || undefined,
          });
      const firstTask = result.tasks[0];
      if (!firstTask) {
        throw new Error("AI 未解析出可创建的研发任务");
      }
      const nextDraft = aiDraftToTask(firstTask);
      setDraft(nextDraft);
      setOriginalDraft(nextDraft);
      setAiSummary(result.summary ?? `已解析 ${result.tasks.length} 个任务，当前展示第 1 个`);
      setModifiedFields(new Set());
      setAiState("review");
      toast.success(`AI 已解析 ${result.tasks.length} 个任务`);
    } catch (error) {
      setAiState("idle");
      toast.error(error instanceof Error ? error.message : "AI 解析失败");
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
      toast.error("请先配置研发系统树，再创建任务");
      return;
    }
    let created: Task;
    try {
      created = await createRdTask({
        category_id: target.category.id,
        sub_project_id: target.child?.id,
        title: draft.title,
        primary_owner: draft.primary_owner,
        status: draft.status,
        progress: draft.progress,
        ai_priority: draft.ai_priority,
        final_priority: draft.final_priority,
        due_date: draft.due_date,
        description: draft.description,
        category_path: draft.category_path,
      } as Parameters<typeof createRdTask>[0]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任务创建失败");
      return;
    }
    const taskId = created.task_id;
    recordAudit({
      actor: RD_AUDIT_ACTOR,
      action: "task.created",
      resource: { type: "task", id: taskId, name: draft.title },
      changes: [
        { field: "primary_owner", before: undefined, after: draft.primary_owner },
        { field: "priority", before: undefined, after: draft.final_priority },
        { field: "due_date", before: undefined, after: draft.due_date },
      ],
      comment: "通过 AI 解析创建任务",
      metadata: {
        modified_fields: Array.from(modifiedFields),
        category_path: draft.category_path,
        ai_scene_id: activeScene?.id,
        model_id: activeScene?.model_id,
        model_label: describeRdAiModel(aiSettings, activeScene?.model_id),
        prompt_version: activeScene?.prompt_version,
      },
      source: "web",
    });
    if (modifiedFields.size > 0) {
      recordAudit({
        actor: RD_AUDIT_ACTOR,
        action: "ai.suggestion_accepted",
        resource: { type: "task", id: taskId, name: draft.title },
        comment: "采纳 AI 建议并人工修正字段",
        metadata: { modified_fields: Array.from(modifiedFields) },
        source: "web",
      });
    }
    toast.success("任务已创建，关键字段已留痕");
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[8px] border border-white bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            <span className="font-semibold text-slate-800">AI 任务解析 · 新建任务</span>
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
                  <div className="font-semibold text-slate-900">当前场景</div>
                  <div className="mt-1">{activeScene?.name ?? "未配置"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">当前模型</div>
                  <div className="mt-1">{describeRdAiModel(aiSettings, activeScene?.model_id)}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Prompt 版本</div>
                  <div className="mt-1">{activeScene?.prompt_version || "未指定"}</div>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">OCR 兜底</div>
                  <div className="mt-1">
                    {aiSettings?.file_policy.ocr_provider ?? "tencent_ocr"} / 阈值 {aiSettings?.file_policy.ocr_confidence_threshold ?? 0.85}
                  </div>
                </div>
              </div>
              <label className="text-sm font-medium text-slate-700">粘贴会议纪要、邮件正文或需求描述</label>
              <Textarea
                className="w-full resize-none rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                rows={5}
                placeholder="例：电磁阀耐压测试需要在本月底前完成，由王磊负责，陈静配合质检……"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors",
                    fileDropActive
                      ? "border-blue-400 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-500",
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
                  拖入 Excel / Word / PDF / 图片 / 压缩包
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
                  className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiState === "processing" ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      AI 解析中…
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      AI 解析
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
              <div className="rounded-[8px] border border-blue-100 bg-blue-50/50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-blue-600">
                  <Pencil className="h-3 w-3" />
                  AI 已解析完成。所有字段均可就地编辑，修改后字段会高亮标记。
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-blue-700">
                  <span>模型：{describeRdAiModel(aiSettings, activeScene?.model_id)}</span>
                  <span>Prompt：{activeScene?.prompt_version || "未指定"}</span>
                  <span>阈值：{activeScene?.confidence_threshold ?? 0.8}</span>
                  {selectedFiles.length > 0 && <span>文件数：{selectedFiles.length}</span>}
                </div>
              </div>

              {aiSummary && <p className="-mt-2 text-xs text-blue-700">{aiSummary}</p>}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    任务标题
                    {modifiedFields.has("title") && (
                      <button type="button" onClick={() => resetField("title")} className="ml-1 inline-flex cursor-pointer items-center gap-1 text-amber-500 hover:underline">
                        <RotateCcw className="h-3 w-3" />
                        还原
                      </button>
                    )}
                  </label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100",
                      modifiedFields.has("title") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.title}
                    onChange={(e) => patchDraft("title", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">主责人</label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100",
                      modifiedFields.has("primary_owner") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.primary_owner}
                    onChange={(e) => patchDraft("primary_owner", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    最终优先级
                    <span className="ml-auto text-slate-400">AI 建议: {PRIORITY_CONFIG[draft.ai_priority].label}</span>
                  </label>
                  <NativeSelect
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100",
                      modifiedFields.has("final_priority") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.final_priority}
                    onChange={(e) => patchDraft("final_priority", e.target.value as Priority)}
                  >
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </NativeSelect>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">分类路径</label>
                  <Input
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100",
                      modifiedFields.has("category_path") ? "border-amber-300 bg-amber-50" : "border-slate-200",
                    )}
                    value={draft.category_path}
                    onChange={(e) => patchDraft("category_path", e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">预估工期（天）</label>
                  <Input
                    type="number"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    value={draft.final_duration ?? ""}
                    onChange={(e) => patchDraft("final_duration", Number(e.target.value))}
                  />
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-slate-500">截止日期</label>
                  <Input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    value={draft.due_date ?? ""}
                    onChange={(e) => patchDraft("due_date", e.target.value)}
                  />
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-slate-500">任务描述</label>
                  <Textarea
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
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
                  重新解析
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={onClose} className="cursor-pointer rounded-[8px] border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    取消
                  </button>
                  <button type="button" onClick={handleCreate} className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                    确认创建
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
  const shouldReduceMotion = useReducedMotion();
  const currentIndex = getTaskTimelineCurrentIndex(task);
  const attentionCurrent =
    task.status === "paused_blocked" || task.status === "paused_leave" || task.status === "pending_assign";
  const steps: {
    label: string;
    helper: string;
    Icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { label: "创建", helper: "任务已进入研发任务池", Icon: CircleDot },
    {
      label: "指派",
      helper: task.status === "pending_assign" ? "等待组长确认负责人" : `主责人：${task.primary_owner}`,
      Icon: Users,
    },
    {
      label: task.status === "paused_blocked" ? "执行受阻" : task.status === "paused_leave" ? "暂停中" : "执行",
      helper:
        task.status === "paused_blocked"
          ? "当前存在阻塞，需优先处理"
          : task.status === "paused_leave"
            ? "主责人请假，周期顺延"
            : `当前进度 ${task.progress}%`,
      Icon: Target,
    },
    {
      label: "完成",
      helper: task.due_date ? `截止 ${task.due_date}` : "等待完成确认",
      Icon: CheckCircle2,
    },
    { label: "封存", helper: task.archived || task.status === "archived" ? "任务已归档" : "完成后可封存", Icon: Archive },
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
          <h3 className="text-sm font-semibold text-slate-900">任务时间轴</h3>
          <p className="mt-0.5 text-xs text-slate-500">当前节点已高亮显示</p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
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
                <motion.span
                  initial={shouldReduceMotion ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { ...RD_LIST_TRANSITION, delay: index * 0.04 }}
                  className={cn(
                    "absolute left-[15px] top-8 h-[calc(100%-24px)] w-px origin-top",
                    index < currentIndex ? "bg-emerald-200" : "bg-slate-200",
                  )}
                />
              )}
              <motion.span
                initial={shouldReduceMotion ? false : { scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={shouldReduceMotion ? { duration: 0 } : { ...RD_FAST_TRANSITION, delay: index * 0.03 }}
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white transition-all",
                  state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-600",
                  state === "current" && "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_0_0_4px_rgba(59,130,246,0.10)]",
                  state === "attention" && "border-amber-200 bg-amber-50 text-amber-700 shadow-[0_0_0_4px_rgba(245,158,11,0.10)]",
                  state === "todo" && "border-slate-200 text-slate-300",
                )}
              >
                <step.Icon className="h-4 w-4" />
              </motion.span>
              <div className={cn("min-w-0 pb-4", isLast && "pb-0")}>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    state === "done" && "text-emerald-700",
                    state === "current" && "text-blue-800",
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

function TaskDetailDrawer({
  task,
  onClose,
  onOpenPerson,
}: {
  task: Task;
  onClose: () => void;
  onOpenPerson?: (name: string) => void;
}) {
  const RD_ADMIN_AUDIT_ACTOR = useAuditActor("研发管理员");
  const shouldReduceMotion = useReducedMotion();
  const statusCfg = STATUS_CONFIG[task.status];
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const [progressNotes, setProgressNotes] = useState<RdTaskProgressNote[]>([]);
  const [progressNotesLoading, setProgressNotesLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setProgressNotesLoading(true);
    fetchRdTaskProgressNotes(task.task_id)
      .then((notes) => {
        if (!cancelled) setProgressNotes(notes);
      })
      .catch(() => {
        if (!cancelled) setProgressNotes([]);
      })
      .finally(() => {
        if (!cancelled) setProgressNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task.task_id]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
    >
      <motion.div
        className="flex h-full w-full max-w-[620px] flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl sm:w-[min(620px,92vw)]"
        initial={shouldReduceMotion ? false : { opacity: 0, x: 36 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 28 }}
        transition={RD_PANEL_TRANSITION}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 z-[100]">
          <div>
            <div className="text-xs font-mono text-slate-400">{task.task_id}</div>
            <div className="text-base font-semibold text-slate-800">{task.title}</div>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-6">
          {task.archived && (
            <div className="flex items-center gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
              <Lock className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-500">此任务已封存（只读），全部历史记录已保留</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-1 text-xs text-slate-400">状态</div>
              <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", statusCfg.bg, statusCfg.text)}>
                <StatusDot status={task.status} />
                {statusCfg.label}
              </span>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">优先级</div>
              <PriorityPill priority={task.final_priority} aiPriority={task.ai_priority} />
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">主责人</div>
              <button
                type="button"
                onClick={() => onOpenPerson?.(task.primary_owner)}
                disabled={/已离职|待指派|外部机构/.test(task.primary_owner)}
                className="flex items-center gap-2 rounded-md py-0.5 font-medium text-slate-700 transition-colors enabled:cursor-pointer enabled:hover:text-blue-600 disabled:cursor-default"
              >
                <OwnerAvatar name={task.primary_owner} />
                {task.primary_owner}
                {!/已离职|待指派|外部机构/.test(task.primary_owner) && <ChevronRight className="h-3 w-3 text-slate-300" />}
              </button>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-400">截止日期</div>
              <div className="font-medium text-slate-700">{task.due_date ?? "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="mb-1 text-xs text-slate-400">协作人</div>
              {task.collaborators.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {task.collaborators.map((c) => (
                    <span key={c.id} className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      <OwnerAvatar name={c.name} size="xs" />
                      {c.name} · {c.role}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </div>
            <div className="col-span-2">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>完成进度</span>
                <span className="font-semibold text-slate-600">{task.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                    className={cn("h-full rounded-full", task.progress === 100 ? "bg-emerald-500" : "bg-blue-500")}
                    style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
            <div className="col-span-2">
              <div className="mb-1 text-xs text-slate-400">分类路径</div>
              <div className="font-medium text-slate-700">{task.category_path}</div>
            </div>
          </div>

          <TaskLifecycleTimeline task={task} />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">进度留痕附件</div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {progressNotesLoading ? "加载中" : `${progressNotes.reduce((sum, note) => sum + note.attachments.length, 0)} 个附件`}
              </span>
            </div>
            <ProgressNoteList
              notes={progressNotes}
              loading={progressNotesLoading}
              emptyText="暂无进度留痕附件"
              compact
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">操作留痕</div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {taskLogs.length} 条
              </span>
            </div>
            <AuditTimeline logs={taskLogs} showResource={false} emptyText="暂无此任务的操作记录" />
          </div>

          {task.description && (
            <div>
              <div className="mb-1 text-xs text-slate-400">任务描述</div>
              <p className="rounded-[8px] border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">{task.description}</p>
            </div>
          )}

          {task.status === "paused_leave" && (
            <div className="flex items-start gap-2 rounded-[8px] border border-amber-100 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-sm text-amber-700">主责人请假中，任务周期已顺延。复岗后自动恢复为"进行中"。</div>
            </div>
          )}

          {task.status === "pending_assign" && (
            <div className="flex items-start gap-2 rounded-[8px] border border-violet-100 bg-violet-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <div className="text-sm text-violet-700">规则未能自动匹配责任人，请组长手动指派。</div>
            </div>
          )}

        </div>
      </motion.div>
    </motion.div>
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
    <div className="flex min-w-[128px] items-center gap-2 rounded-[8px] bg-slate-50 px-2.5 py-2 text-slate-900 ring-1 ring-slate-200/80">
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

  return ;
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
    Icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { label: "活跃任务", value: totalActive, tone: "text-slate-900", iconTone: "text-slate-400", Icon: Target },
    { label: "完成率", value: `${rate}%`, tone: "text-slate-900", iconTone: "text-slate-400", Icon: Gauge },
    { label: "进行中", value: inProgress, tone: "text-blue-600", iconTone: "text-blue-400", Icon: CircleDot },
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
      className="overflow-hidden rounded-xl border border-slate-100 bg-white"
    >
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">执行统计</h2>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          今日实时
        </span>
      </div>

      {/* KPI cells — flat layout with vertical dividers */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-3 xl:grid-cols-6">
        {items.map((it, idx) => (
          <motion.div
            key={it.label}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { ...RD_LIST_TRANSITION, delay: idx * 0.035 }}
            whileHover={shouldReduceMotion ? undefined : { y: -2 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
            className={cn(
              "group flex items-center gap-3 px-5 py-4 transition-colors duration-200 hover:bg-slate-50/70",
              idx >= 3 && "border-t border-slate-100 xl:border-t-0",
            )}
          >
            <it.Icon
              className={cn(
                "h-5 w-5 shrink-0 transition-all duration-200 group-hover:scale-110",
                it.iconTone,
              )}
              strokeWidth={1.5}
            />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-3xl font-semibold leading-none tabular-nums tracking-tight transition-colors",
                  it.tone,
                )}
              >
                {it.value}
              </div>
              <div className="mt-1 truncate text-[11px] font-medium text-slate-500">{it.label}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

function RiskHotspot({
  risks,
  onSelectTask,
  className,
  title = "决策焦点 · 风险任务",
  subtitle = "仅显示风险任务；全部任务在任务清单中",
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
      className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)]", className)}
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {riskFilter === "all" ? risks.length : `${filteredRisks.length}/${risks.length}`}
          </div>
          {typeof totalTasks === "number" && (
            <div className="mt-0.5 text-[11px] font-medium text-slate-400">
              共 {totalTasks} 个任务
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-3">
        {filterOptions.map((b) => {
          const active = riskFilter === b.type;
          const disabled = b.count === 0;
          return (
            <motion.button
              key={b.type}
              type="button"
              onClick={() => changeFilter(b.type)}
              disabled={disabled}
              whileHover={!disabled && !shouldReduceMotion ? { y: -1 } : undefined}
              whileTap={!disabled && !shouldReduceMotion ? { scale: 0.97 } : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                active
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_8px_18px_rgba(37,99,235,0.10)] ring-1 ring-blue-100"
                  : disabled
                    ? "cursor-not-allowed border-slate-100 text-slate-400"
                    : "cursor-pointer border-slate-200 bg-slate-50 shadow-[0_4px_10px_rgba(15,23,42,0.025)] hover:bg-white hover:shadow-[0_8px_16px_rgba(15,23,42,0.05)]",
              )}
            >
              {b.type !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT_COLOR[b.type])} />}
              {b.type === "all" && <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-blue-500" : "bg-slate-400")} />}
              <span className={cn("font-medium", active ? "text-blue-700" : disabled ? "text-slate-400" : "text-slate-700")}>{b.label}</span>
              <span className={cn("tabular-nums", active ? "font-semibold text-blue-700" : disabled ? "text-slate-400" : "font-semibold text-slate-900")}>
                {b.count}
              </span>
            </motion.button>
          );
        })}
      </div>

      <ul className="flex-1 divide-y divide-slate-100">
        {shownRisks.length === 0 ? (
          <li className="px-6 py-10 text-center text-sm text-slate-400">
            {totalTasks ? "暂无风险任务，全部任务请查看任务清单" : "暂无风险任务"}
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
              className="group flex cursor-pointer items-center gap-3 px-6 py-3 transition-all hover:bg-slate-50/80 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", RISK_DOT_COLOR[r.type])} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                  {r.task.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span
                    className={cn(r.severity === "critical" ? "font-semibold text-red-600" : "text-amber-600")}
                  >
                    {RISK_LABEL[r.type]} · {r.reason}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>{r.task.primary_owner}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono text-[11px] text-slate-400">{r.task.task_id}</span>
                </div>
              </div>
              <OwnerAvatar name={r.task.primary_owner} size="xs" />
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
              aria-label="上一页"
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
                      ? "bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.08)] ring-1 ring-blue-200"
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
              aria-label="下一页"
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
  onSelectPerson?: (name: string) => void;
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
      className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.05)]", className)}
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">人员负载</h3>
          <p className="mt-0.5 text-xs text-slate-500">活跃任务分布</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-3 text-xs">
            {heavy > 0 && (
              <span className="text-red-600">
                <span className="font-semibold tabular-nums">{heavy}</span> 高负载
              </span>
            )}
            {onLeaveCount > 0 && (
              <span className="text-amber-600">
                <span className="font-semibold tabular-nums">{onLeaveCount}</span> 请假
              </span>
            )}
          </div>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="group inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-[0_6px_14px_rgba(15,23,42,0.06)] active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              title="进入人员管理"
            >
              <UserPlus className="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-slate-700" />
              <span>人员管理</span>
              <ChevronRight className="h-3 w-3 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </header>

      <ul className="flex-1 space-y-2 px-6 py-3">
        {shownLoads.length === 0 ? (
          <li className="py-6 text-center text-sm text-slate-400">暂无负载数据</li>
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
                key={p.name}
                onClick={() => onSelectPerson?.(p.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPerson?.(p.name);
                  }
                }}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <OwnerAvatar name={p.name} size="xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-700">{p.name}</span>
                    {p.onLeave && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        请假
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
              aria-label="上一页"
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
                      ? "bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.08)] ring-1 ring-blue-200"
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
              aria-label="下一页"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function PersonDetailDrawer({
  name,
  profile,
  load,
  tasks,
  onClose,
  onOpenTask,
}: {
  name: string;
  profile?: PersonProfile;
  load?: PersonLoad;
  tasks: Task[];
  onClose: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const activeTasks = tasks.filter((task) => !task.archived && task.status !== "completed");
  const maxTasks = profile?.max_tasks ?? load?.max ?? 8;
  const count = load?.count ?? activeTasks.length;
  const ratio = maxTasks > 0 ? Math.min(100, Math.round((count / maxTasks) * 100)) : 0;
  const statusLabel = profile?.status === "on_leave" || load?.onLeave ? "请假中" : profile?.status === "resigned" ? "已离职" : "在岗";
  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/25 backdrop-blur-sm"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RD_FAST_TRANSITION}
    >
      <motion.div
        className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:w-[min(620px,92vw)]"
        initial={shouldReduceMotion ? false : { opacity: 0, x: 36 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 28 }}
        transition={RD_PANEL_TRANSITION}
      >
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <OwnerAvatar name={name} />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-slate-900">{name}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{profile?.position ?? "研发成员"} · {profile?.department ?? "未设置部门"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-2xl font-semibold tabular-nums text-slate-900">{count}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">当前负载</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums text-blue-600">{maxTasks}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">容量上限</div>
              </div>
              <div>
                <div className={cn("text-2xl font-semibold", statusLabel === "在岗" ? "text-emerald-600" : "text-amber-600")}>{statusLabel}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">人员状态</div>
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
              <div className="text-[11px] text-slate-400">邮箱</div>
              <div className="mt-1 truncate font-medium text-slate-700">{profile?.email ?? "-"}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-white p-3">
              <div className="text-[11px] text-slate-400">电话</div>
              <div className="mt-1 font-medium text-slate-700">{profile?.phone ?? "-"}</div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">负责/协作任务</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{tasks.length} 项</span>
            </div>
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center text-sm text-slate-400">暂无关联任务</div>
            ) : (
              <ul className="space-y-2">
                {tasks.slice(0, 12).map((task) => (
                  <li key={task.task_id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(task)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all hover:border-blue-100 hover:bg-blue-50/40"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", taskAccentClass(task))} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">{task.title}</div>
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
}: {
  stat: CatStat;
  onClick: () => void;
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
      whileHover={shouldReduceMotion ? undefined : { y: -3, scale: 1.01 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2",
        hConfig.border,
        isIdle && "opacity-55 hover:opacity-100",
      )}
    >
      {/* Top accent stripe — colored by health */}
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100",
          hConfig.dot,
        )}
      />

      <div className="flex items-center gap-2">
        <theme.Icon className={cn("h-4 w-4 shrink-0 transition-colors", theme.iconColor)} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {stat.cat.label}
        </span>
        {reserved && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            预留
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
                health === "alert" && "bg-red-50 text-red-700",
                health === "watch" && "bg-amber-50 text-amber-700",
                health === "healthy" && "bg-emerald-50 text-emerald-700",
                health === "idle" && "bg-slate-100 text-slate-500",
              )}
            >
              <span className={cn("h-1 w-1 rounded-full", hConfig.dot)} />
              {hConfig.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="text-xs">
              <div className="font-semibold">{hConfig.label}</div>
              <div className="opacity-70">
                完成 {stat.progress}% · 风险 {stat.risks} · 阻塞 {stat.blocked}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-baseline justify-between">
        <span
          className={cn(
            "text-3xl font-semibold tabular-nums tracking-tight",
            isIdle ? "text-slate-400" : "text-slate-900",
          )}
        >
          {stat.progress}
          <span className="text-base font-medium text-slate-400">%</span>
        </span>
        {stat.risks > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600 transition-transform duration-150 hover:scale-105">
                <AlertTriangle className="h-3 w-3" />
                {stat.risks}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <RiskListTooltip
                title={`${stat.cat.label} · ${stat.risks} 个风险任务`}
                risks={stat.riskItems}
              />
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
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
          任务
        </span>
        <span className="text-slate-400">
          <span className="font-semibold tabular-nums text-slate-500">{stat.cat.children.length}</span> 部件
        </span>
        {stat.inProgress > 0 && (
          <span className="text-slate-500">
            <span className="font-semibold tabular-nums text-blue-600">{stat.inProgress}</span> 进行中
          </span>
        )}
        {stat.total === 0 && <span className="text-slate-400">无活跃</span>}
      </div>

      {/* Hover hint */}
      <div className="pointer-events-none flex items-center justify-end text-[11px] font-medium text-slate-400 opacity-0 transition-all duration-200 group-hover:opacity-100">
        进入详情
        <ChevronRight className="ml-0.5 h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  );
}

function SystemPanorama({
  catStats,
  onSelectSystem,
}: {
  catStats: CatStat[];
  onSelectSystem: (catId: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const reservedCount = catStats.filter((stat) => isReservedBomSystem(stat.cat.id)).length;
  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RD_PANEL_TRANSITION}
      className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-[0_22px_55px_rgba(15,23,42,0.06)]"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">子系统全景</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            当前研发分类树 · {catStats.length} 个子系统 · 预留 {reservedCount} 个管理节点
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {(["healthy", "watch", "alert", "idle"] as const).map((h) => {
            const count = catStats.filter((s) => getSystemHealth(s) === h).length;
            const cfg = HEALTH_CONFIG[h];
            return (
              <span key={h} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                {cfg.label}
                <span className={cn("font-semibold tabular-nums", cfg.text)}>{count}</span>
              </span>
            );
          })}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {catStats.map((stat) => (
          <SystemHealthCard key={stat.cat.id} stat={stat} onClick={() => onSelectSystem(stat.cat.id)} />
        ))}
      </div>
    </motion.section>
  );
}

// ─── DETAIL VIEW components (board mode) ─────────────────────────────────────

/** Collect all active (non-archived) tasks recursively from a scope. */
function collectAllActiveTasks(scope: Category | SubProject | null): Task[] {
  if (!scope) return [];
  const result: Task[] = [];
  function walk(tasks: Task[]) {
    for (const t of tasks) {
      if (!t.archived) result.push(t);
      if (t.subtasks) walk(t.subtasks);
    }
  }
  if ("children" in scope) {
    for (const sub of scope.children) walk(sub.tasks);
  } else {
    walk(scope.tasks);
  }
  return result;
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
  const allTasks = collectAllActiveTasks(scope);
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
      color: "bg-blue-400",
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
    <section className="rounded-xl border border-slate-100 bg-white px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          {breadcrumbAbove && (
            <div className="mb-1 text-xs font-medium text-slate-400">{breadcrumbAbove}</div>
          )}
          <div className="flex items-center gap-2.5">
            <theme.Icon className={cn("h-5 w-5", theme.iconColor)} />
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{label}</h2>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {sub ? "部件维度" : "子系统维度"} · 今日 {TODAY_STR}
          </p>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
          <Metric label="活跃任务" value={totalActive} />
          <Metric label="完成率" value={`${rate}%`} />
          <Metric label="风险" value={riskCount} tone={riskCount > 0 ? "text-red-600" : undefined} />
          {criticalCount > 0 && <Metric label="紧急" value={criticalCount} tone="text-red-600" />}
          {blockedCount > 0 && <Metric label="阻塞" value={blockedCount} tone="text-orange-600" />}
        </div>
      </div>

      {/* Status distribution */}
      {total > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">状态分布</span>
            <span className="text-slate-400">共 {total} 项</span>
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
                        {s.label} · <span className="font-semibold tabular-nums">{s.count}</span> 项 ·{" "}
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
                  <span className="text-slate-600">{s.label}</span>
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
  const allTasks = tasks ?? collectAllActiveTasks(scope);
  const upcoming = allTasks
    .filter((t) => t.due_date && t.status !== "completed")
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
    { key: "this-week", label: "本周", range: [4, 7], tone: "text-blue-600", dot: "bg-blue-500" },
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
  const activeWindowLabel = windowFilter === "all" ? "全部窗口" : activeBucket?.label ?? "全部窗口";

  return (
    <section className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">里程碑预报</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            未来 30 天 · {upcoming.length} 个截止日 · {within7} 个 7 天内到期
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {overdue > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600">
              逾期 {overdue}
            </span>
          )}
          <span className="rounded-full bg-slate-50 px-2 py-0.5 font-medium text-slate-500 ring-1 ring-slate-200">
            点击任务查看详情
          </span>
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">时间窗口</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={() => setWindowFilter("all")}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 active:scale-[0.99]",
                windowFilter === "all"
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_8px_18px_rgba(37,99,235,0.10)]"
                  : "border-slate-200 bg-white hover:border-blue-100 hover:bg-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.035)]",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", windowFilter === "all" ? "bg-blue-500" : "bg-slate-400")} />
                <span className="truncate text-xs font-semibold">全部窗口</span>
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
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 active:scale-[0.99]",
                    selected
                      ? "border-blue-200 bg-blue-50 shadow-[0_8px_18px_rgba(37,99,235,0.10)]"
                      : active
                        ? "cursor-pointer border-slate-200 bg-white hover:border-blue-100 hover:bg-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.035)]"
                        : "cursor-not-allowed border-slate-100 bg-white/55",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", b.dot, !active && "opacity-30")} />
                    <span className={cn("truncate text-xs font-medium", selected ? "text-blue-700" : active ? b.tone : "text-slate-400")}>{b.label}</span>
                  </span>
                  <span className={cn("text-xs font-semibold tabular-nums", selected ? "text-blue-700" : active ? "text-slate-900" : "text-slate-300")}>
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
              当前筛选：<span className="font-semibold text-slate-800">{activeWindowLabel}</span>
              <span className="mx-1 text-slate-300">·</span>
              <span className="font-semibold tabular-nums text-slate-800">{filteredItems.length}</span> 项
            </div>
            <div className="text-xs tabular-nums text-slate-400">
              {filteredItems.length === 0 ? "0 / 0" : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filteredItems.length)} / ${filteredItems.length}`}
            </div>
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {visibleItems.map(({ task, dleft }) => {
              const dayLabel =
                dleft < 0 ? `逾期 ${-dleft}d` : dleft === 0 ? "今日" : `${dleft}天后`;
              const bucket =
                grouped.find((b) => dleft >= b.range[0] && dleft <= b.range[1]) ?? grouped[grouped.length - 1];
              const path = splitCategoryPath(task.category_path).slice(0, 2).join(" / ");
              const progressTone =
                task.progress >= 80 ? "bg-emerald-500" : task.progress >= 50 ? "bg-blue-500" : task.progress > 0 ? "bg-amber-500" : "bg-slate-300";
              return (
                <button
                  key={task.task_id}
                  type="button"
                  onClick={() => onOpen(task)}
                  className="group flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-left transition-all hover:border-blue-100 hover:bg-blue-50/30 hover:shadow-[0_8px_18px_rgba(15,23,42,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 active:scale-[0.995]"
                >
                  <span className={cn("mt-0.5 w-14 shrink-0 text-xs font-semibold tabular-nums", bucket?.tone ?? "text-slate-500")}>
                    {dayLabel}
                  </span>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", bucket?.dot ?? "bg-slate-300")} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-5 text-slate-800 group-hover:text-slate-950">
                      {task.title}
                    </span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                      <span className="max-w-[180px] truncate text-slate-500">{path || "未分类"}</span>
                      <span className="text-slate-300">·</span>
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
                每页 10 条 · 第 <span className="font-semibold tabular-nums text-slate-800">{safePage}</span> / {totalPages} 页
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage <= 1}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all hover:bg-white hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="上一页"
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
                        current ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-slate-500 hover:bg-white hover:text-slate-700",
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
                  aria-label="下一页"
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
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [dueFilter, setDueFilter] = useState<TaskDueFilter>("all");
  if (!category) return null;
  // If a sub-project is explicitly selected, show only that one. Otherwise list all parts with tasks.
  const parts = sub ? [sub] : category.children.filter((c) => flattenTasks(c.tasks).some((task) => !task.archived));
  if (parts.length === 0) return null;

  const totalCount = parts.reduce((s, p) => s + flattenTasks(p.tasks).filter((t) => !t.archived).length, 0);
  const normalizedKeyword = keyword.trim();
  const filtersActive = Boolean(normalizedKeyword) || statusFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all";
  const filteredTotal = parts.reduce(
    (sum, part) => sum + flattenTasks(part.tasks).filter((task) => taskMatches(task, normalizedKeyword, statusFilter, priorityFilter, dueFilter)).length,
    0,
  );

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">全部任务清单</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {sub ? `${sub.label} · ` : `按部件分组 · ${parts.length} 个部件 · `}
            {filtersActive ? `${filteredTotal} / ${totalCount}` : totalCount} 个活跃任务
          </p>
        </div>
        <span className="text-xs text-slate-400">点击展开部件 / 卡片查看子任务</span>
      </header>

      <div className="grid gap-2 rounded-[8px] border border-slate-200 bg-white p-3 md:grid-cols-[minmax(180px,1fr)_140px_120px_120px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-9 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-50"
            placeholder="搜索任务、编号、负责人、路径"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "all")}
        >
          <option value="all">全部状态</option>
          {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((status) => (
            <option key={status} value={status}>{STATUS_CONFIG[status].label}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as Priority | "all")}
        >
          <option value="all">全部优先级</option>
          <option value="high">高优先级</option>
          <option value="medium">中优先级</option>
          <option value="low">低优先级</option>
        </NativeSelect>
        <NativeSelect
          className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
          value={dueFilter}
          onChange={(event) => setDueFilter(event.target.value as TaskDueFilter)}
        >
          <option value="all">全部时间</option>
          <option value="overdue">已逾期</option>
          <option value="today">今天到期</option>
          <option value="3d">3 天内</option>
          <option value="7d">7 天内</option>
          <option value="no_due">无截止日</option>
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
          className="h-9 cursor-pointer rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          清空
        </button>
      </div>

      <div className="space-y-3">
        {parts.map((part) => (
          <SubProjectSection
            key={part.id}
            sub={part}
            keyword={normalizedKeyword}
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            dueFilter={dueFilter}
            onOpen={onOpen}
          />
        ))}
        {filteredTotal === 0 && filtersActive && (
          <div className="rounded-[8px] border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
            当前筛选条件下暂无任务
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
    const tasks = flattenTasks(sub.tasks);
    const active = tasks.filter((t) => !t.archived).length;
    const progress = calcSubProgress(sub);
    const riskTasks = tasks.filter((t) => taskNeedsAttention(t)).length;
    const blocked = tasks.filter(
      (t) => t.status === "paused_blocked" || t.status === "pending_assign",
    ).length;
    return { sub, active, progress, risks: riskTasks, blocked };
  });

  return (
    <section className="rounded-xl border border-slate-100 bg-white p-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">部件健康</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {category.label} · {parts.length} 个部件 · 点击切换聚焦范围
          </p>
        </div>
        <span className="text-xs text-slate-400">按风险数排序</span>
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
                className={cn(
                  "group flex flex-col gap-2 rounded-lg border bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]",
                  config.border,
                  isSelected && "ring-2 ring-slate-900 ring-offset-1",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                    {sub.label}
                  </span>
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dot)}
                    title={config.label}
                  />
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                    {progress}
                    <span className="text-sm font-medium text-slate-400">%</span>
                  </span>
                  {risks > 0 && (
                    <span className="text-xs font-semibold tabular-nums text-red-600">⚠ {risks}</span>
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
                    <span className="font-semibold tabular-nums text-slate-700">{active}</span> 活跃
                  </span>
                  {isIdle && <span className="text-slate-400">空闲</span>}
                  {blocked > 0 && (
                    <span className="text-orange-600">
                      <span className="font-semibold tabular-nums">{blocked}</span> 阻塞
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

function getPersonChanges(before: Person, after: Person): AuditChange[] {
  const fields: Array<keyof Person> = ["name", "position", "department", "email", "phone", "status", "max_tasks"];
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
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
    if (!form.name.trim()) newErrors.name = "姓名不能为空";
    if (!form.position.trim()) newErrors.position = "职位不能为空";
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
              {isEdit ? "编辑成员" : "新增成员"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEdit ? `修改 ${person!.name} 的信息` : "创建一个新的团队成员"}
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100",
                  errors.name ? "border-red-300" : "border-slate-200",
                )}
                placeholder="例: 王磊"
                autoFocus
              />
            </Field>
            <Field label="职位" required error={errors.position}>
              <Input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100",
                  errors.position ? "border-red-300" : "border-slate-200",
                )}
                placeholder="硬件测试工程师"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="所属部门">
              <NativeSelect
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="状态">
              <NativeSelect
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PersonStatus }))}
                className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                <option value="active">在岗</option>
                <option value="on_leave">请假中</option>
                <option value="resigned">已离职</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label="邮箱">
            <Input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              placeholder="user@inogi.com"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="联系电话">
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                placeholder="13800000000"
              />
            </Field>
            <Field label="任务上限">
              <Input
                type="number"
                min={1}
                max={20}
                value={form.max_tasks}
                onChange={(e) => setForm((f) => ({ ...f, max_tasks: Math.max(1, Number(e.target.value) || 1) }))}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </Field>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
            >
              取消
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all duration-150 hover:bg-slate-800 active:scale-[0.98]"
            >
              {isEdit ? "保存修改" : "创建成员"}
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
          <h3 className="text-base font-semibold text-slate-900">删除 {person.name}?</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            此操作将永久删除该成员的档案，关联任务将转为待指派状态。删除后无法撤销。
          </p>
        </div>
        <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.25)] transition-all duration-150 hover:bg-red-700 active:scale-[0.98]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            确认删除
          </button>
        </footer>
      </div>
    </div>
  );
}

/** People management page — full CRUD, hidden from main nav */
function PeopleManagementPage({ onBack }: { onBack: () => void }) {
  const RD_ADMIN_AUDIT_ACTOR = useAuditActor("研发管理员");
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
      const changes = getPersonChanges(editing, p);
      setPeople((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      recordAudit({
        actor: RD_ADMIN_AUDIT_ACTOR,
        action: changes.some((change) => change.field === "status") ? "person.status_changed" : "person.edited",
        resource: { type: "person", id: p.id, name: p.name },
        changes,
        comment: "维护研发成员信息",
        source: "web",
      });
      setEditing(null);
    } else {
      const newPerson = { ...p, id: `p${Date.now()}` };
      setPeople((prev) => [...prev, newPerson]);
      recordAudit({
        actor: RD_ADMIN_AUDIT_ACTOR,
        action: "person.created",
        resource: { type: "person", id: newPerson.id, name: newPerson.name },
        metadata: { department: newPerson.department, position: newPerson.position },
        source: "web",
      });
      setCreating(false);
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      setPeople((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      recordAudit({
        actor: RD_ADMIN_AUDIT_ACTOR,
        action: "person.deleted",
        resource: { type: "person", id: deleteTarget.id, name: deleteTarget.name },
        comment: "删除研发成员档案，关联任务需重新指派",
        metadata: { department: deleteTarget.department, position: deleteTarget.position },
        source: "web",
      });
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
            返回总览
          </button>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-sm text-slate-500">详情视图</span>
          <span className="text-xs text-slate-300">›</span>
          <span className="text-sm font-medium text-slate-800">人员管理</span>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[0_12px_24px_rgba(15,23,42,0.22)] active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          新增成员
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
                <div className="mt-1 text-[11px] font-medium text-slate-500">总成员数</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-emerald-600">
                  {stats.active}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">在岗</div>
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
                <div className="mt-1 text-[11px] font-medium text-slate-500">请假中</div>
              </div>
              <div className="px-6 py-4">
                <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {stats.departments}
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500">所属部门</div>
              </div>
            </div>
          </section>

          {/* Filters */}
          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索姓名 / 职位 / 部门 / 邮箱…"
                className="flex-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="清除搜索"
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
                  {s === "all" ? "全部" : PERSON_STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>

            <NativeSelect
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">全部部门</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </NativeSelect>

            <span className="ml-auto text-xs tabular-nums text-slate-400">
              共 <span className="font-semibold text-slate-700">{filtered.length}</span> /{" "}
              {people.length} 人
            </span>
          </section>

          {/* Table */}
          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-6 py-3 text-left">成员</th>
                  <th className="px-4 py-3 text-left">职位</th>
                  <th className="px-4 py-3 text-left">部门</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">入职日期</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="text-sm font-medium text-slate-400">没有匹配的成员</div>
                      <button
                        type="button"
                        onClick={() => {
                          setKeyword("");
                          setStatusFilter("all");
                          setDeptFilter("all");
                        }}
                        className="mt-3 text-xs font-medium text-blue-600 hover:underline"
                      >
                        重置筛选
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
                            {cfg.label}
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
                              className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-blue-50 hover:text-blue-600 active:scale-90"
                              aria-label={`编辑 ${p.name}`}
                              title="编辑"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(p)}
                              className="rounded-md p-1.5 text-slate-400 transition-all duration-150 hover:bg-red-50 hover:text-red-600 active:scale-90"
                              aria-label={`删除 ${p.name}`}
                              title="删除"
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

function ExecutiveOverview({
  catStats,
  risks,
  personLoads,
  onSelectSystem,
  onSelectTask,
  onSelectPerson,
  onOpenPeople,
  loading,
  loadError,
  onRefresh,
}: {
  catStats: CatStat[];
  risks: Risk[];
  personLoads: PersonLoad[];
  onSelectSystem: (catId: string) => void;
  onSelectTask: (t: Task) => void;
  onSelectPerson: (name: string) => void;
  onOpenPeople?: () => void;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const totalActive = catStats.reduce((s, c) => s + c.total, 0);
  const inProgress = catStats.reduce((s, c) => s + c.inProgress, 0);
  const done = catStats.reduce((s, c) => s + c.done, 0);
  const blocked = catStats.reduce((s, c) => s + c.blocked, 0);
  const rate = totalActive > 0 ? Math.round((done / totalActive) * 100) : 0;

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={RD_FAST_TRANSITION}
      className="min-h-full bg-slate-50/30 px-6 py-6 lg:px-8 lg:py-8"
      style={{ background: "transparent" }}
    >
      <div className="mx-auto max-w-[1400px] space-y-6 rd-stagger-children">
        <KpiStrip
          totalActive={totalActive}
          inProgress={inProgress}
          done={done}
          blocked={blocked}
          totalRisks={risks.length}
          rate={rate}
        />

        {loading || catStats.length === 0 ? (
          <section className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-white">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-950">
              {loading ? "正在加载研发任务数据" : "暂无研发任务数据"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {loading
                ? "正在从后端接口读取任务树、风险和人员负载。"
                : "后端当前没有任务树或任务记录。创建任务或导入数据后，这里会展示真实的系统全景、风险和负载。"}
            </p>
            {loadError && (
              <p className="mx-auto mt-3 max-w-md rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {loadError}
              </p>
            )}
            {!loading && (
              <button
                type="button"
                onClick={onRefresh}
                className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:scale-[0.98]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新读取
              </button>
            )}
          </section>
        ) : (
          <>
            <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-5">
              <RiskHotspot
                risks={risks}
                totalTasks={totalActive}
                onSelectTask={onSelectTask}
                className="lg:col-span-3"
              />
              <PersonLoadPanel loads={personLoads} className="lg:col-span-2" onManage={onOpenPeople} onSelectPerson={onSelectPerson} />
            </div>

            <SystemPanorama catStats={catStats} onSelectSystem={onSelectSystem} />
          </>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDTaskManagementPage() {
  const shouldReduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const canCreateTask = usePermission(PERMISSIONS.RD_TASK_CREATE);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const RD_ADMIN_AUDIT_ACTOR = useAuditActor("研发管理员");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [peopleProfiles, setPeopleProfiles] = useState<PersonProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Page view mode:
  //   "overview" = leadership dashboard (landing)
  //   "board"    = detailed system work view
  //   "people"   = hidden people management page (drill-down only)
  const [mode, setMode] = useState<"overview" | "board" | "people">("overview");

  const loadCategories = () => {
    setLoading(true);
    setLoadError(null);
    fetchRdTaskCategories()
      .then((nextCategories) => {
        setCategories(nextCategories);
        setSelectedCatId((current) => {
          if (!current) return null;
          const stillExists = nextCategories.some((cat) => cat.id === current || cat.children.some((sub) => sub.id === current));
          return stillExists ? current : null;
        });
      })
      .catch((error) => {
        setCategories([]);
        setLoadError(error instanceof Error ? error.message : "研发任务接口加载失败");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories();
  }, []);

  // ── System tree CRUD ─────────────────────────────────────────────────────
  const [treeEditor, setTreeEditor] = useState<SystemTreeEditorRequest | null>(null);

  const handleTreeEditorSubmit = async (label: string) => {
    if (!treeEditor) return;
    const safeLabel = label.trim();
    let nextCategories: Category[] = categories;
    let auditAction: "category.created" | "category.edited" | "category.deleted" | "sub_project.created" | "sub_project.edited" | "sub_project.deleted" = "category.created";
    let auditResourceId = "";
    let auditResourceName = "";

    if (treeEditor.mode === "add-system") {
      const dup = categories.find((c) => c.label.trim() === safeLabel);
      if (dup) { toast.error(`已存在同名系统：${safeLabel}`); return; }
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
        toast.error(`已存在同名系统：${safeLabel}`); return;
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
        toast.error(`「${target.label}」下已存在同名子项：${safeLabel}`); return;
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
        toast.error(`「${category.label}」下已存在同名子项：${safeLabel}`); return;
      }
      nextCategories = categories.map((c) =>
        c.id === category.id
          ? { ...c, children: c.children.map((s) => (s.id === sub.id ? { ...s, label: safeLabel } : s)) }
          : c,
      );
      auditAction = "sub_project.edited";
      auditResourceId = sub.id;
      auditResourceName = `${category.label} / ${safeLabel}`;
    } else {
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
    }

    try {
      const saved = await saveRdTaskCategories(nextCategories);
      setCategories(saved);
      recordAudit({
        actor: RD_ADMIN_AUDIT_ACTOR,
        action: auditAction,
        resource: { type: "category", id: auditResourceId, name: auditResourceName },
        comment: `通过研发系统树管理${treeEditor.mode.startsWith("add") ? "新增" : treeEditor.mode.startsWith("edit") ? "重命名" : "删除"}节点`,
        source: "web",
      });
      toast.success(
        treeEditor.mode.startsWith("add") ? "新增成功"
        : treeEditor.mode.startsWith("edit") ? "已更新"
        : "已删除",
      );
      setTreeEditor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
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
    const view = params.get("view");
    const categoryId = params.get("category");
    if (view === "board" || categoryId) {
      setMode("board");
      setSelectedCatId(categoryId);
    }
  }, [location.search]);

  const risks = useMemo(() => computeRisks(categories), [categories]);
  const catStats = useMemo(() => buildCatStats(categories, risks), [categories, risks]);
  const personLoads = useMemo(() => computePersonLoads(categories), [categories]);

  const enterBoard = (catId: string) => {
    setSelectedCatId(catId);
    setMode("board");
  };
  const allTasks = useMemo(() => flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks))), [categories]);
  const totalActive = useMemo(() => allTasks.filter((t) => !t.archived).length, [allTasks]);
  const pendingAssign = useMemo(() => allTasks.filter((t) => t.status === "pending_assign").length, [allTasks]);
  const averageProgress = useMemo(() => {
    const activeTasks = allTasks.filter((t) => !t.archived);
    if (activeTasks.length === 0) return 0;
    return Math.round(activeTasks.reduce((sum, task) => sum + task.progress, 0) / activeTasks.length);
  }, [allTasks]);
  const allSystemSummary = useMemo(() => {
    const activeTasks = allTasks.filter((task) => !task.archived);
    return {
      inProgress: activeTasks.filter((task) => task.status === "in_progress").length,
      done: activeTasks.filter((task) => task.status === "completed").length,
      blocked: activeTasks.filter((task) => task.status === "paused_blocked" || task.status === "pending_assign").length,
      rate: activeTasks.length > 0 ? Math.round((activeTasks.filter((task) => task.status === "completed").length / activeTasks.length) * 100) : 0,
    };
  }, [allTasks]);
  const openPersonDetail = (name: string) => {
    if (!name || /已离职|待指派|外部机构/.test(name)) return;
    setSelectedPersonName(name);
  };
  const selectedPersonProfile = useMemo(
    () => peopleProfiles.find((person) => person.name === selectedPersonName),
    [peopleProfiles, selectedPersonName],
  );
  const selectedPersonLoad = useMemo(
    () => personLoads.find((load) => load.name === selectedPersonName),
    [personLoads, selectedPersonName],
  );
  const selectedPersonTasks = useMemo(() => {
    if (!selectedPersonName) return [];
    return allTasks.filter(
      (task) =>
        task.primary_owner === selectedPersonName ||
        task.collaborators.some((collaborator) => collaborator.name === selectedPersonName),
    );
  }, [allTasks, selectedPersonName]);

  const selectedCategory = selectedCatId
    ? categories.find((c) => c.id === selectedCatId || c.children.some((sub) => sub.id === selectedCatId))
    : null;
  const selectedSub = selectedCategory?.children.find((sub) => sub.id === selectedCatId) ?? null;
  const selectedLabel = selectedSub ? `${selectedCategory?.label} / ${selectedSub.label}` : selectedCategory?.label;

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
        total: flattenTasks(selectedSub.tasks).filter((task) => !task.archived).length,
        progress: calcSubProgress(selectedSub),
      }
    : selectedCatId
      ? catStats.find((s) => s.cat.id === selectedCatId)
      : null;
  const scopedRisks = selectedCatId === null ? risks : visibleRisks;
  const primaryRisk = scopedRisks[0] ?? null;
  const criticalCount = scopedRisks.filter((risk) => risk.severity === "critical").length;
  const scopeTitle = selectedLabel ?? "全部研发系统";
  const detailScope = selectedSub ?? selectedCategory ?? null;
  const detailActiveTasks = useMemo(
    () => (detailScope ? collectAllActiveTasks(detailScope) : allTasks.filter((task) => !task.archived)),
    [allTasks, detailScope],
  );
  const detailBlockedCount = detailActiveTasks.filter(
    (task) => task.status === "paused_blocked" || task.status === "pending_assign",
  ).length;

  // ───── Overview mode (leadership landing) ────────────────────────────────
  if (mode === "overview") {
    return (
      <TooltipProvider delayDuration={150}>
        <ExecutiveOverview
          catStats={catStats}
          risks={risks}
          personLoads={personLoads}
          onSelectSystem={enterBoard}
          onSelectTask={setSelectedTask}
          onSelectPerson={openPersonDetail}
          onOpenPeople={canManagePeople ? () => navigate("/rd-people-management") : undefined}
          loading={loading}
          loadError={loadError}
          onRefresh={loadCategories}
        />
        <AnimatePresence>
          {selectedTask && (
            <TaskDetailDrawer
              key={selectedTask.task_id}
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
              onOpenPerson={(name) => {
                setSelectedTask(null);
                openPersonDetail(name);
              }}
            />
          )}
          {selectedPersonName && (
            <PersonDetailDrawer
              name={selectedPersonName}
              profile={selectedPersonProfile}
              load={selectedPersonLoad}
              tasks={selectedPersonTasks}
              onClose={() => setSelectedPersonName(null)}
              onOpenTask={(task) => {
                setSelectedPersonName(null);
                setSelectedTask(task);
              }}
            />
          )}
        </AnimatePresence>
      </TooltipProvider>
    );
  }

  // ───── People management mode (hidden drill-down) ────────────────────────
  if (mode === "people" && canManagePeople) {
    return (
      <TooltipProvider delayDuration={150}>
        <PeopleManagementPage onBack={() => setMode("overview")} />
      </TooltipProvider>
    );
  }

  // ───── Board mode (detailed work view) ───────────────────────────────────
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-full flex-col overflow-hidden rounded-[8px] border border-slate-200/80 bg-[#f4f7fb] shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        {/* Breadcrumb / back to overview */}
        <div className="flex items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-2.5 animate-rd-fade-in">
          <button
            type="button"
            onClick={() => {
              setMode("overview");
              setSelectedCatId(null);
            }}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 active:scale-[0.96]"
          >
            <ChevronLeft className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
            返回总览
          </button>
          <span className="text-xs text-slate-300">·</span>
          <span className="text-sm text-slate-500">详情视图</span>
          {selectedLabel && (
            <>
              <span className="text-xs text-slate-300">›</span>
              <span className="text-sm font-medium text-slate-800">{selectedLabel}</span>
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
        <CategorySidebar
          catStats={catStats}
          selectedId={selectedCatId}
          onSelect={setSelectedCatId}
          totalActive={totalActive}
          totalRisks={risks.length}
          allRisks={risks}
          canManageTree={canCreateTask}
          onRequestEditor={setTreeEditor}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CommandCenter
            totalActive={totalActive}
            risks={risks}
            pendingAssign={pendingAssign}
            averageProgress={averageProgress}
            onCreate={canCreateTask ? () => setShowCreate(true) : undefined}
          />

          <div className="flex-1 overflow-auto bg-slate-50/40 px-5 py-5">
            <motion.div
              key={selectedCatId ?? "all"}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={RD_PANEL_TRANSITION}
              className="mx-auto max-w-7xl space-y-5 rd-stagger-children"
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
                    onOpen={setSelectedTask}
                  />

                  <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-5">
                    <RiskHotspot
                      risks={risks}
                      totalTasks={totalActive}
                      onSelectTask={setSelectedTask}
                      className="lg:col-span-3"
                      title="需要决策"
                      subtitle="按严重度排序 · 点击查看详情"
                    />
                    <PersonLoadPanel
                      loads={personLoads}
                      className="lg:col-span-2"
                      onManage={canManagePeople ? () => navigate("/rd-people-management") : undefined}
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
                  <div className="grid gap-5 lg:grid-cols-5">
                    <RiskHotspot
                      risks={scopedRisks}
                      totalTasks={detailActiveTasks.length}
                      onSelectTask={setSelectedTask}
                      className="lg:col-span-3"
                      title={selectedLabel ? `${selectedLabel} · 需要决策` : "需要决策"}
                      subtitle="按严重度排序 · 点击查看详情"
                    />
                    <PersonLoadPanel
                      loads={computeScopedPersonLoads(selectedSub ?? selectedCategory)}
                      className="lg:col-span-2"
                      onSelectPerson={openPersonDetail}
                    />
                  </div>

                  {/* Upcoming milestones */}
                  <UpcomingMilestonesSection
                    scope={selectedSub ?? selectedCategory}
                    onOpen={setSelectedTask}
                  />

                  {/* Full task list: show every task in the selected system */}
                  <TasksByPartSection
                    category={selectedCategory ?? null}
                    sub={selectedSub}
                    onOpen={setSelectedTask}
                  />
                </>
              )}
            </motion.div>
          </div>
        </div>

        {showCreate && canCreateTask && (
          <AiCreatePanel
            categories={categories}
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
        </AnimatePresence>
        <AnimatePresence>
          {selectedTask && (
            <TaskDetailDrawer
              key={selectedTask.task_id}
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
              onOpenPerson={(name) => {
                setSelectedTask(null);
                openPersonDetail(name);
              }}
            />
          )}
          {selectedPersonName && (
            <PersonDetailDrawer
              name={selectedPersonName}
              profile={selectedPersonProfile}
              load={selectedPersonLoad}
              tasks={selectedPersonTasks}
              onClose={() => setSelectedPersonName(null)}
              onOpenTask={(task) => {
                setSelectedPersonName(null);
                setSelectedTask(task);
              }}
            />
          )}
        </AnimatePresence>
        </div>
      </div>
    </TooltipProvider>
  );
}
