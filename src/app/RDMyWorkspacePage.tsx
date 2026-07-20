import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  FileText,
  FolderInput,
  GitBranch,
  Info,
  Layers,
  List,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  User,
  Users,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Calendar } from "./components/ui/calendar";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { AuditTimeline } from "./RDAuditTimeline";
import { ProgressAttachmentGrid, ProgressNoteList } from "./RDProgressEvidence";
import { AuditActor, recordAudit, syncAuditLogsFromRemote, useAuditActor, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import { isTaskOverdue, taskOverdueDays } from "./lib/taskDue";
import {
  addRdNoteAttachments,
  assessRdTaskProgress,
  createRdTaskProgressNote,
  deleteRdNoteAttachment,
  fetchRdNoteUnreadSummary,
  markRdTaskNotesRead,
  replaceRdNoteAttachment,
  fetchProductTaskCategories,
  fetchRdPeople,
  fetchRdProducts,
  fetchRdTaskCategories,
  fetchMergedTaskCategories,
  fetchRdPerformanceReports,
  fetchRdTaskProgressNotes,
  fetchRdWorkspace,
  moveRdTasks,
  patchRdMessage,
  updateRdTask,
  type RdAiProgressAssessment,
  type RdCategory,
  type RdCollaborator,
  type RdPersonLoad,
  type RdPriority,
  type RdProductDef,
  type RdSubProject,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
  type RdWorkItem,
  isUsCollabWorkspace,
  workItemsFeatureEnabled,
  blockedDaysOf,
  type RdTaskStatus,
  type RdWorkspacePayload,
  type RdWorkspaceTask,
  type RdAiSuggestion,
  type RdWorkspaceNotification,
  type RdPerformanceReport,
} from "./lib/rdApi";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { MentionSuggestionPanel, useMentions, type MentionCandidate } from "./components/MentionInput";
import { AutoTranslatedText } from "./components/TranslatableText";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import { toast } from "sonner";

type Priority = RdPriority;
type TaskStatus = RdTaskStatus;
type TaskRole = "primary" | "collaborator";
type OperationTab = "detail" | "progress" | "handoff" | "submit";
type WorkspaceTask = RdWorkspaceTask;
type AiSuggestion = RdAiSuggestion;
type WorkspaceNotification = RdWorkspaceNotification;

type ActivePanel =
  | { kind: "task"; task: WorkspaceTask; tab: OperationTab; openedAt: number; abandon?: boolean }
  | { kind: "ai"; suggestion: AiSuggestion; regenerated?: boolean }
  | { kind: "notification"; notification: WorkspaceNotification };

type ProgressAssessment = {
  progress: number;
  stage: string;
  confidence: number;
  basis: string[];
  recommendation: string;
};

type ConfirmDialogConfig = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  details?: string[];
  onConfirm: () => void | Promise<void>;
};

const TODAY_LABEL = new Date().toISOString().split("T")[0]!;
/** 附件操作类审计动作（时间线上归位展示到所属进展条目下，不再顶层平铺） */
const ATTACHMENT_OP_ACTIONS: ReadonlySet<string> = new Set([
  "task.attachment_added",
  "task.attachment_removed",
  "task.attachment_replaced",
]);

const NOTE_ATTACHMENT_MAX_FILES = 10;
const NOTE_ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const NOTE_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
type WorkspaceDueFilter = "all" | "overdue" | "today" | "3d" | "7d" | "no_due";

function workspaceDaysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${TODAY_LABEL}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function clampProgressValue(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

/** 把任意日期字符串归一化为 <input type="date"> 需要的 YYYY-MM-DD 格式；解析失败返回空串。 */
function toDateInputValue(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD 字符串 → 本地 Date（按本地时区零点，避免 UTC 解析差一天）；非法返回 undefined。 */
function parseDateInputValue(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 本地 Date → YYYY-MM-DD 字符串（与 toDateInputValue 输出一致，供后续审核流程沿用）。 */
function formatDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function workspaceTaskMatches(
  task: WorkspaceTask,
  keyword: string,
  priority: Priority | "all",
  status: TaskStatus | "all",
  due: WorkspaceDueFilter,
) {
  if (priority !== "all" && task.priority !== priority) return false;
  if (status !== "all" && task.status !== status) return false;
  const days = workspaceDaysUntil(task.due_date);
  if (due === "no_due" && days !== null) return false;
  if (due === "overdue" && !isTaskOverdue(task)) return false;
  if (due === "today" && days !== 0) return false;
  if (due === "3d" && (days === null || days < 0 || days > 3)) return false;
  if (due === "7d" && (days === null || days < 0 || days > 7)) return false;
  if (!keyword) return true;
  return [
    task.task_id,
    task.title,
    task.owner,
    task.category_path,
    task.description,
    task.status_label,
    task.next_action,
  ].some((value) => value?.toLowerCase().includes(keyword));
}

/** 列表分组沉底序：普通任务 → 待审核 → 已完成。 */
function workspaceTaskGroupRank(task: WorkspaceTask): number {
  if (task.status === "completed") return 2;
  if (task.status === "pending_review") return 1;
  return 0;
}

/** 立项时间排序键：创建时刻（created_at）优先，立项开始日期（start_date）兜底；均为可字典序比较的时间串。 */
function workspaceTaskStartKey(task: WorkspaceTask): string {
  return task.created_at || task.start_date || "";
}

/** 排序：先按分组（待审核沉底、已完成最底），组内按立项时间正序；缺失立项时间的存量任务排组尾、保持原有顺序。 */
function compareWorkspaceTasks(a: WorkspaceTask, b: WorkspaceTask): number {
  const rank = workspaceTaskGroupRank(a) - workspaceTaskGroupRank(b);
  if (rank !== 0) return rank;
  const aStart = workspaceTaskStartKey(a);
  const bStart = workspaceTaskStartKey(b);
  if (aStart && bStart) return aStart.localeCompare(bStart);
  if (aStart) return -1;
  if (bStart) return 1;
  return 0;
}

function rdPersonOptionValue(person: RdPersonLoad): string {
  return person.user_id ? `user:${person.user_id}` : `person:${person.id}`;
}

function collaboratorOptionValue(collaborator: RdCollaborator): string {
  return collaborator.user_id ? `user:${collaborator.user_id}` : `person:${collaborator.id || collaborator.name}`;
}

function personToCollaborator(person: RdPersonLoad): RdCollaborator {
  return {
    id: person.user_id ?? person.id,
    name: person.name,
    user_id: person.user_id ?? null,
    role: "协作人",
  };
}

const EMPTY_WORKSPACE: RdWorkspacePayload<WorkspaceTask, AiSuggestion, WorkspaceNotification> = {
  myTasks: [],
  collabTasks: [],
  todayTodos: [],
  aiSuggestions: [],
  notifications: [],
};

/** 语言感知的相对时间（后端 time 字段是拼好的中文，英文态用 created_at 重算） */
function relativeTimeLabel(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  const thenMs = new Date(iso).getTime();
  if (!Number.isFinite(thenMs)) return fallback;
  const diff = Date.now() - thenMs;
  if (diff < 60_000) return t("刚刚");
  if (diff < 3_600_000) return t("{n} 分钟前", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("{n} 小时前", { n: Math.floor(diff / 3_600_000) });
  if (diff < 30 * 86_400_000) return t("{n} 天前", { n: Math.floor(diff / 86_400_000) });
  return iso.slice(0, 10);
}

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
  high: { label: "高", className: "border-red-100 bg-red-50 text-red-600" },
  medium: { label: "中", className: "border-amber-100 bg-amber-50 text-amber-700" },
  low: { label: "低", className: "border-slate-100 bg-slate-50 text-slate-500" },
};

const STATUS_CONFIG: Record<TaskStatus, { className: string; dot: string }> = {
  draft:          { className: "bg-slate-50 text-slate-500",   dot: "bg-slate-400" },
  in_progress:    { className: "bg-blue-50 text-blue-700",     dot: "bg-blue-500" },
  pending_review: { className: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  paused_leave:   { className: "bg-amber-50 text-amber-700",   dot: "bg-amber-500" },
  paused_blocked: { className: "bg-red-50 text-red-700",       dot: "bg-red-500" },
  on_hold:        { className: "bg-amber-50 text-amber-600",   dot: "bg-amber-400" },
  completed:      { className: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  pending_assign: { className: "bg-violet-50 text-violet-600", dot: "bg-violet-400" },
  archived:       { className: "bg-slate-50 text-slate-400",   dot: "bg-slate-300" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold", cfg.className)}>
      {t(cfg.label)}
    </span>
  );
}

function StatusPill({ task }: { task: WorkspaceTask }) {
  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.draft;
  // 协同专属：阻塞状态直接显示已阻塞天数（跨时区协作里阻塞最容易被静默拖着）；其他工作台不变
  const blockedDays = isUsCollabWorkspace() ? blockedDaysOf(task) : null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", cfg.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {/* status_label 是后端下发的中文文案：中文即 key，直接过 t() 本地化 */}
      {t(task.status_label)}
      {blockedDays != null && <span className="font-semibold">· {t("{n} 天", { n: blockedDays })}</span>}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          value >= 80 ? "bg-emerald-400" : value >= 45 ? "bg-blue-400" : value > 0 ? "bg-amber-400" : "bg-slate-300",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  count,
  helper,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number | string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white bg-white/75 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.045)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon className="h-4 w-4 text-slate-500" />
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-500">{count}</span>
          )}
        </h2>
        {helper && <span className="hidden text-xs text-slate-400 md:inline">{helper}</span>}
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  variant = "secondary",
  className,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        variant === "primary" && "bg-indigo-600 text-white shadow-[0_8px_18px_rgba(79,70,229,0.20)] hover:bg-indigo-700",
        variant === "secondary" && "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        variant === "ghost" && "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        variant === "danger" && "border border-red-100 bg-red-50 text-red-600 hover:bg-red-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ConfirmActionModal({
  config,
  onCancel,
}: {
  config: ConfirmDialogConfig;
  onCancel: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const isDanger = config.tone === "danger";
  const Icon = isDanger ? AlertTriangle : ShieldCheck;
  const [confirming, setConfirming] = useState(false);

  const confirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await config.onConfirm();
      onCancel();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("操作失败，请重试"));
      setConfirming(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-workspace-confirm-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              isDanger ? "bg-red-50 text-red-600" : "bg-indigo-50 text-indigo-600",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="rd-workspace-confirm-title" className="text-base font-semibold text-slate-950">
              {config.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{config.message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭确认弹窗")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {config.details && config.details.length > 0 && (
          <div className="px-5 pt-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <ul className="space-y-1.5">
                {config.details.map((detail) => (
                  <li key={detail} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                    <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <ActionButton onClick={onCancel}>{config.cancelLabel ?? t("取消")}</ActionButton>
          <button
            type="button"
            onClick={confirm}
            disabled={confirming}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
              isDanger
                ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-200"
                : "bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-200",
            )}
          >
            {confirming ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {confirming ? t("处理中...") : config.confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TaskCardUI({
  task,
  onOpen,
}: {
  task: WorkspaceTask;
  onOpen: (task: WorkspaceTask, tab: OperationTab) => void;
}) {
  return (
    <article
      className={cn(
        "group rounded-xl border bg-white px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.07)]",
        task.on_leave ? "border-amber-100 bg-amber-50/40" : task.status === "paused_blocked" ? "border-red-100 bg-red-50/30" : "border-slate-200/80",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(task, "detail")}
        className="block w-full cursor-pointer text-left focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
              <StatusPill task={task} />
              {task.ai_pending && (
                <span className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
                  <Sparkles className="h-2.5 w-2.5" />
                  {t("AI 待确认")}
                </span>
              )}
            </div>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-900"><AutoTranslatedText text={task.title} /></h3>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{task.next_action}</p>
          </div>
          <PriorityBadge priority={task.priority} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            {task.role === "primary" ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
            {task.role === "primary" ? t("我主责") : `${t("协作")} / ${task.collab_role}`}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {task.due_date}
          </span>
          {/* 协同任务没有「分类路径」概念（复用研发数据结构的残留字段），协同工作台不展示 */}
          {!isUsCollabWorkspace() && (
            <span className="min-w-0 truncate text-slate-400">{task.category_path}</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500">{task.progress}%</span>
        </div>
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
        <ActionButton onClick={() => onOpen(task, "detail")} variant="ghost">
          <Info className="h-3.5 w-3.5" />
          {t("详情")}
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "progress")}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("更新进度")}
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "handoff")}>
          <GitBranch className="h-3.5 w-3.5" />
          {t("移交")}
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "submit")} variant="primary" className="ml-auto">
          <Send className="h-3.5 w-3.5" />
          {t("提交结果")}
        </ActionButton>
      </div>
    </article>
  );
}

function FlowSteps({
  steps,
}: {
  steps: { label: string; helper: string; state: "done" | "current" | "todo" }[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={cn(
            "rounded-lg border px-3 py-2",
            step.state === "current" && "border-blue-200 bg-blue-50",
            step.state === "done" && "border-emerald-100 bg-emerald-50",
            step.state === "todo" && "border-slate-200 bg-slate-50",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                step.state === "current" && "bg-blue-600 text-white",
                step.state === "done" && "bg-emerald-500 text-white",
                step.state === "todo" && "bg-slate-200 text-slate-500",
              )}
            >
              {step.state === "done" ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span className="text-xs font-semibold text-slate-800">{step.label}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">{step.helper}</p>
        </div>
      ))}
    </div>
  );
}

function DrawerShell({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 backdrop-blur-[1px]">
      <aside
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950">{title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

function TaskOperationDrawer({
  task,
  initialTab,
  onClose,
  onProgressSave,
  onLog,
  onRequestConfirm,
  onSubmittedForReview,
  onCollaborationChanged,
  autoAbandon,
}: {
  task: WorkspaceTask;
  initialTab: OperationTab;
  onClose: () => void;
  onProgressSave: (taskId: string, progress: number) => void | Promise<void>;
  onLog: (message: string) => void;
  onRequestConfirm: (config: ConfirmDialogConfig) => void;
  onSubmittedForReview: (taskId: string, options?: { progress?: number }) => void | Promise<void>;
  onCollaborationChanged: (taskId: string, collaborators: RdCollaborator[], status?: TaskStatus) => void | Promise<void>;
  autoAbandon?: boolean;
}) {
  useI18n(); // 订阅语言切换（抽屉 Tab/流程步骤/表单文案已 t() 化）
  const WORKSPACE_AUDIT_ACTOR = useAuditActor("研发成员");
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  // 已完成任务只读：仅保留「任务详情」页签，屏蔽进度/移交/提交等会改状态的操作。
  const isTaskCompleted = task.status === "completed";
  const [tab, setTab] = useState<OperationTab>(isTaskCompleted ? "detail" : initialTab);
  const [draftProgress, setDraftProgress] = useState(() => clampProgressValue(task.progress));
  const [note, setNote] = useState("");
  const [aiAssessment, setAiAssessment] = useState<ProgressAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [noteAttachments, setNoteAttachments] = useState<File[]>([]);
  // 工作项清单（任务内部轻量拆分）：本地镜像即时反映增删勾选，父级数据下次刷新自然同步。
  // 参与人（主责/协作）可直接增删勾选，无需审批——工作项不是任务、不走立项审批流。
  const [workItems, setWorkItems] = useState<RdWorkItem[]>(task.work_items ?? []);
  const [workItemDraft, setWorkItemDraft] = useState("");
  const [savingWorkItems, setSavingWorkItems] = useState(false);
  useEffect(() => {
    setWorkItems(task.work_items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.task_id]);
  const persistWorkItems = async (next: RdWorkItem[], auditComment?: string, workItemId?: string) => {
    // 乐观更新：先立即反映到 UI（跨太平洋网络延迟下勾选零等待），失败回滚并提示
    const prev = workItems;
    setWorkItems(next);
    setSavingWorkItems(true);
    try {
      await updateRdTask(task.task_id, { work_items: next });
      // 工作项动作写入操作留痕（带 work_item_id），驾驶舱详情按工作项 Tab 可见完整时间线
      if (auditComment) {
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.work_item_updated",
          resource: { type: "task", id: task.task_id, name: task.title },
          comment: auditComment,
          metadata: workItemId ? { work_item_id: workItemId } : {},
          source: "web",
        });
      }
      return true;
    } catch (error) {
      setWorkItems(prev);
      toast.error(error instanceof Error ? error.message : "保存工作项失败，已还原");
      return false;
    } finally {
      setSavingWorkItems(false);
    }
  };
  /** 添加工作项（回车与按钮共用同一实现，避免两处构造代码分叉） */
  const addWorkItem = () => {
    const title = workItemDraft.trim();
    if (!title) return;
    const item = { id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, done: false };
    void persistWorkItems([...workItems, item], `添加了工作项《${title}》`, item.id)
      .then((ok) => { if (ok) setWorkItemDraft(""); });
  };
  // 本次进展关联的工作项（任务内部轻量拆分）；空串 = 不关联（挂主任务）
  const [noteWorkItemId, setNoteWorkItemId] = useState("");
  const [noteDragOver, setNoteDragOver] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [peopleOptions, setPeopleOptions] = useState<RdPersonLoad[]>([]);
  // ── 评论 @ 提及：候选 = 任务参与人置顶 + 本池全员；一套逻辑（useMentions）+ 桌面下拉呈现 ──
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const out: MentionCandidate[] = [];
    const push = (name?: string | null, userId?: string | null, hint?: string) => {
      const n = (name ?? "").trim();
      if (!n || seen.has(n)) return;
      seen.add(n);
      out.push({ user_id: userId ?? null, name: n, hint });
    };
    push(task.primary_owner, task.primary_owner_user_id, t("主责人"));
    for (const c of task.collaborators ?? []) push(c.name, c.user_id, t("协作人"));
    for (const p of peopleOptions) push(p.name, p.user_id ?? null);
    return out;
  }, [task.primary_owner, task.primary_owner_user_id, task.collaborators, peopleOptions]);
  const mention = useMentions({ value: note, setValue: setNote, inputRef: noteInputRef, candidates: mentionCandidates });
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState(false);
  const [handoffReason, setHandoffReason] = useState(task.pending_collaboration_reason ?? "");
  const [selectedCollaboratorKeys, setSelectedCollaboratorKeys] = useState<Set<string>>(
    () => new Set((task.pending_review_type === "collaboration" ? task.pending_collaborators : task.collaborators ?? []).map(collaboratorOptionValue)),
  );
  const [receipt, setReceipt] = useState<string | null>(null);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [draftDueDate, setDraftDueDate] = useState(() => toDateInputValue(task.due_date));
  const [dueDateReason, setDueDateReason] = useState("");
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");
  const [abandonSubmitting, setAbandonSubmitting] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<Array<{ task_id: string; title: string; primary_owner: string }>>([]);
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const [progressNotes, setProgressNotes] = useState<RdTaskProgressNote[]>([]);
  const [progressNotesReloadKey, setProgressNotesReloadKey] = useState(0);
  // 拉取本任务的进度留痕，把其中的附件/照片挂到「操作留痕」对应记录下展示。
  useEffect(() => {
    let cancelled = false;
    fetchRdTaskProgressNotes(task.task_id)
      .then((notes) => { if (!cancelled) setProgressNotes(notes); })
      .catch(() => { if (!cancelled) setProgressNotes([]); });
    return () => { cancelled = true; };
  }, [task.task_id, progressNotesReloadKey]);
  // 进度留痕并入操作留痕：把每条「更新了任务进度」的留痕附件挂到对应操作记录下。
  // 关联优先用 metadata.note_id（新数据精确）；老数据回退「同进度值 + 2 分钟内」启发式，保证一条留痕只挂一处。
  const logNoteMatches = useMemo(() => {
    const map = new Map<string, RdTaskProgressNote>();
    const used = new Set<string>();
    const progressLogs = taskLogs.filter((log) => log.action === "task.progress_updated");
    for (const log of progressLogs) {
      const noteId = typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "";
      if (!noteId) continue;
      const note = progressNotes.find((n) => n.id === noteId);
      if (note && !used.has(note.id)) {
        map.set(log.id, note);
        used.add(note.id);
      }
    }
    for (const log of progressLogs) {
      if (map.has(log.id)) continue;
      const after = log.changes?.find((c) => c.field === "progress")?.after;
      const logTime = new Date(log.timestamp).getTime();
      let best: RdTaskProgressNote | undefined;
      let bestDelta = Infinity;
      for (const note of progressNotes) {
        if (used.has(note.id)) continue;
        if (typeof after === "number" && typeof note.progress === "number" && note.progress !== after) continue;
        const delta = Math.abs(new Date(note.created_at).getTime() - logTime);
        if (delta > 120_000 || delta >= bestDelta) continue;
        best = note;
        bestDelta = delta;
      }
      if (best) {
        map.set(log.id, best);
        used.add(best.id);
      }
    }
    return map;
  }, [taskLogs, progressNotes]);
  const taskAttachmentTotal = useMemo(
    () => progressNotes.reduce((sum, note) => sum + note.attachments.length, 0),
    [progressNotes],
  );

  // ── 留痕附件管理（新增/替换/删除）──────────────────────────────────────────
  // 权限完全以服务端随留痕下发的 note.can_edit_attachments 为准（作者/主责人/管理员
  // + 任务未完成未归档，与写接口锁内校验同一实现），前端不再自行推断，杜绝口径漂移。
  const canEditNoteAttachments = useCallback(
    (note: RdTaskProgressNote) => note.can_edit_attachments === true,
    [],
  );

  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [deleteAttTarget, setDeleteAttTarget] = useState<{ note: RdTaskProgressNote; att: RdTaskProgressAttachment } | null>(null);
  const addFilesInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  /** 隐藏文件选择器共享的目标留痕/附件（打开选择器前设置） */
  const attachmentTargetRef = useRef<{ note: RdTaskProgressNote; att?: RdTaskProgressAttachment } | null>(null);

  /**
   * 变更成功后的统一收尾：原位更新留痕（写接口返回的留痕不带可编辑标记，沿用旧值），
   * 并从服务端拉取审计流刷新时间线——审计由服务端随变更写入，前端不再另记一份。
   */
  const applyUpdatedNote = (updated: RdTaskProgressNote) => {
    setProgressNotes((prev) => prev.map((n) => (
      n.id === updated.id
        ? { ...updated, can_edit_attachments: updated.can_edit_attachments ?? n.can_edit_attachments }
        : n
    )));
    void syncAuditLogsFromRemote();
  };

  const handleAddAttachmentFiles = async (note: RdTaskProgressNote, files: File[]) => {
    if (files.length === 0 || attachmentBusy) return;
    if (note.attachments.length + files.length > NOTE_ATTACHMENT_MAX_FILES) {
      toast.error(t("单条留痕附件最多 {n} 个", { n: NOTE_ATTACHMENT_MAX_FILES }));
      return;
    }
    const oversized = files.find((f) => f.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(t("附件 {name} 超过单文件 25MB 限制", { name: oversized.name }));
      return;
    }
    const totalBytes = note.attachments.reduce((sum, a) => sum + (a.size ?? 0), 0) + files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
      toast.error(t("附件总大小超过单条留痕 50MB 限制"));
      return;
    }
    setAttachmentBusy(true);
    try {
      const updated = await addRdNoteAttachments(task.task_id, note.id, files);
      applyUpdatedNote(updated);
      toast.success(t("已新增 {n} 个附件", { n: files.length }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件新增失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleReplaceAttachmentFile = async (note: RdTaskProgressNote, att: RdTaskProgressAttachment, file: File) => {
    if (attachmentBusy) return;
    if (file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES) {
      toast.error(t("附件 {name} 超过单文件 25MB 限制", { name: file.name }));
      return;
    }
    setAttachmentBusy(true);
    try {
      const updated = await replaceRdNoteAttachment(task.task_id, note.id, att.id, file);
      applyUpdatedNote(updated);
      toast.success(t("附件已替换"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件替换失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const confirmDeleteAttachment = async () => {
    const target = deleteAttTarget;
    if (!target || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const updated = await deleteRdNoteAttachment(task.task_id, target.note.id, target.att.id);
      applyUpdatedNote(updated);
      toast.success(t("附件已删除"));
      setDeleteAttTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件删除失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  // ── 附件操作记录「归位」：不在时间线平铺，而是嵌到所属进展条目的附件区下方。
  //    审计数据本身不动（操作留痕页仍是完整流），只改任务视角的展示归组；
  //    找不到所属进展的附件操作（note 被裁剪等边缘情况）仍平铺，不丢记录。──
  const attachmentOpsByNoteId = useMemo(() => {
    const map = new Map<string, typeof taskLogs>();
    for (const log of taskLogs) {
      if (!ATTACHMENT_OP_ACTIONS.has(log.action)) continue;
      const noteId = typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "";
      if (!noteId) continue;
      const list = map.get(noteId) ?? [];
      list.push(log);
      map.set(noteId, list);
    }
    return map;
  }, [taskLogs]);
  /** 时间线顶层过滤：已归位到某条进展下的附件操作不再平铺 */
  const timelineTaskLogs = useMemo(() => {
    const renderedNoteIds = new Set(Array.from(logNoteMatches.values()).map((n) => n.id));
    return taskLogs.filter((log) => {
      if (!ATTACHMENT_OP_ACTIONS.has(log.action)) return true;
      const noteId = typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "";
      return !(noteId && renderedNoteIds.has(noteId));
    });
  }, [taskLogs, logNoteMatches]);

  const canApplyCollaborationDirectly = canDirectProject || canReviewProjectL1 || canReviewProjectL2 || canReassignTask || canManagePeople;
  const dueDateChangePending = task.status === "pending_review" && task.pending_review_type === "due_date";

  useEffect(() => {
    let cancelled = false;
    setPeopleLoading(true);
    fetchRdPeople()
      .then((people) => {
        if (cancelled) return;
        setPeopleOptions(people);
        setPeopleError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPeopleOptions([]);
        setPeopleError(true);
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const collaboratorCandidates = peopleOptions.filter((person) => {
    if (!person.name.trim()) return false;
    if (person.user_id && task.owner_user_id && person.user_id === task.owner_user_id) return false;
    return person.name.trim() !== task.owner.trim();
  });
  const selectedCollaborators = collaboratorCandidates
    .filter((person) => selectedCollaboratorKeys.has(rdPersonOptionValue(person)))
    .map(personToCollaborator);

  const tabConfig: { key: OperationTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "detail", label: t("任务详情"), icon: FileText },
    { key: "progress", label: t("更新进度"), icon: RefreshCw },
    { key: "handoff", label: t("移交协作"), icon: GitBranch },
    { key: "submit", label: t("提交结果"), icon: Send },
  ];

  const flowSteps =
    tab === "progress"
      ? [
          { label: t("填写依据"), helper: t("进展说明 + 附件均可"), state: note.trim() || noteAttachments.length > 0 ? "done" as const : "current" as const },
          { label: t("AI 判断"), helper: t("综合文本与附件给出建议"), state: aiAssessment ? "done" as const : "todo" as const },
          { label: t("人工确认"), helper: t("采用 AI 或手动重设"), state: aiAssessment ? "current" as const : "todo" as const },
        ]
      : tab === "handoff"
      ? [
          { label: t("选择协同人"), helper: t("可选择多个执行人"), state: selectedCollaboratorKeys.size > 0 ? "done" as const : "current" as const },
          { label: t("说明影响"), helper: t("补充协作范围和风险"), state: handoffReason.trim() ? "done" as const : "todo" as const },
          { label: canApplyCollaborationDirectly ? t("直接生效") : t("提交审批"), helper: canApplyCollaborationDirectly ? t("主管权限直接写入任务") : t("流转给主管审核"), state: "todo" as const },
        ]
      : tab === "submit"
        ? [
            { label: t("整理交付物"), helper: t("确认资料完整"), state: "current" as const },
            { label: t("风险自检"), helper: t("检查阻塞和遗漏"), state: "todo" as const },
            { label: t("提交审核"), helper: t("流转给上级"), state: "todo" as const },
          ]
        : [
            { label: t("填写进展"), helper: t("更新百分比和说明"), state: tab === "progress" ? "current" as const : "done" as const },
            { label: t("同步风险"), helper: t("确认阻塞项"), state: "todo" as const },
            { label: t("生成记录"), helper: t("沉淀操作日志"), state: "todo" as const },
          ];

  const submitProgress = async () => {
    const oversized = noteAttachments.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name} 超过单文件 25MB 限制`);
      return;
    }
    const totalAttachmentSize = noteAttachments.reduce((sum, file) => sum + file.size, 0);
    if (totalAttachmentSize > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
      toast.error(t("附件总大小不能超过 50MB"));
      return;
    }
    // 纯保存：直接写入「人工确认进度」滑块的当前值，绝不再跑 AI 覆盖。AI 解析请点「AI 解析」按钮。
    const assessmentForSave = aiAssessment;
    const progressToSave = clampProgressValue(draftProgress);
    const hasNote = note.trim().length > 0;
    const hasFiles = noteAttachments.length > 0;
    const source = assessmentForSave && assessmentForSave.progress === progressToSave ? t("AI 判断") : t("人工设置");
    const evidenceText = hasFiles ? t("，依据 {n} 个上传文件", { n: noteAttachments.length }) : "";
    const message = t("{taskId} 已通过{source}更新到 {progress}%{evidence}", { taskId: task.task_id, source, progress: progressToSave, evidence: evidenceText });
    onRequestConfirm({
      title: t("确认保存进度"),
      message: t("将把 {taskId} 的进度更新为 {progress}%。", { taskId: task.task_id, progress: progressToSave }),
      confirmLabel: t("确认保存"),
      details: [
        t("最终写入进度：{progress}%（以本次确认值为准，不做累加）", { progress: progressToSave }),
        t("进度来源：{source}", { source }),
        hasFiles ? t("上传附件：{n} 个（已与文本一起送 AI）", { n: noteAttachments.length }) : t("上传附件：无"),
        assessmentForSave ? t("AI 判断：{stage} / 置信度 {confidence}%", { stage: assessmentForSave.stage, confidence: assessmentForSave.confidence }) : t("AI 判断：未触发"),
        hasNote ? t("已填写进展说明") : t("未填写进展说明"),
      ],
      onConfirm: async () => {
        setSavingNote(true);
        try {
          let savedNoteId: string | undefined;
          if (note.trim() || noteAttachments.length > 0) {
            const savedNote = await createRdTaskProgressNote({
              task_id: task.task_id,
              text: note.trim(),
              progress: progressToSave,
              files: noteAttachments,
              work_item_id: noteWorkItemId || undefined,
              // @ 提及：仅正文仍包含 @姓名 的才生效（手动删除即不通知）
              mentions: mention.mentionsForSubmit(note),
            });
            savedNoteId = savedNote?.id;
            mention.resetMentions();
          }
          await onProgressSave(task.task_id, progressToSave);
          recordAudit({
            actor: WORKSPACE_AUDIT_ACTOR,
            action: "task.progress_updated",
            resource: { type: "task", id: task.task_id, name: task.title },
            changes: [{ field: "progress", before: task.progress, after: progressToSave }],
            comment: note || "更新任务进度",
            metadata: {
              source,
              note_attachment_count: noteAttachments.length,
              // 留痕 id 作为关联键，操作留痕据此精确挂出该次进度的附件缩略图。
              ...(savedNoteId ? { note_id: savedNoteId } : {}),
            },
            source: "web",
          });
          setReceipt(message);
          onLog(message);
          // 重置所有提交相关状态，避免重开对话框还看到旧附件 / 说明 / AI 判断残影
          setNoteAttachments([]);
          setAiAssessment(null);
          setNote("");
          setNoteWorkItemId("");
          setDraftProgress(progressToSave);
          // 刷新进度留痕，让本次上传的附件/照片立即出现在操作留痕里（无需重开任务）。
          setProgressNotesReloadKey((k) => k + 1);
        } catch (err) {
          const msg = err instanceof Error ? err.message : t("进度记录保存失败");
          toast.error(msg);
        } finally {
          setSavingNote(false);
        }
      },
    });
  };

  // 综合文本与附件触发一次 AI 判断；附件变更和保存时复用
  // 「AI 解析」按钮：综合进展说明 + 附件跑一次 AI → 弹窗展示结果 → 人工确认后仅把进度
  // 回显到进度条（不保存）；AI 分析本身记入操作留痕。是否采用、最终存多少，由人在进度条上拍板。
  const aiParseProgress = async () => {
    const hasNote = note.trim().length > 0;
    const hasFiles = noteAttachments.length > 0;
    if (!hasNote && !hasFiles) {
      toast.error(t("请先填写进展说明或上传附件，再用 AI 解析"));
      return;
    }
    const oversized = noteAttachments.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name} 超过单文件 25MB 限制`);
      return;
    }
    if (noteAttachments.reduce((sum, file) => sum + file.size, 0) > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
      toast.error(t("附件总大小不能超过 50MB"));
      return;
    }
    setAiLoading(true);
    setReceipt(null);
    try {
      const result: RdAiProgressAssessment = await assessRdTaskProgress({
        files: hasFiles ? noteAttachments : undefined,
        text: hasNote ? note.trim() : undefined,
        task: {
          task_id: task.task_id,
          title: task.title,
          description: task.description,
          category_path: task.category_path,
          current_progress: task.progress,
          current_status: task.status_label,
          // 带上工作项清单：AI 顺带判断本次进展归属哪个工作项（预选，人工可改）；功能未启用时不传
          work_items: workItemsFeatureEnabled() && workItems.length > 0 ? workItems : undefined,
        },
      });
      // AI 归属建议 → 预选「关联工作项」下拉（人工可改）；返回 null 保持用户当前选择
      const suggestedItem = result.work_item_id ? workItems.find((it) => it.id === result.work_item_id) : undefined;
      if (suggestedItem) setNoteWorkItemId(suggestedItem.id);
      const assessment: ProgressAssessment = {
        progress: result.progress,
        stage: result.stage,
        confidence: result.confidence,
        basis: result.basis,
        recommendation: result.recommendation,
      };
      setAiAssessment(assessment);
      // AI 分析记入留痕（无论最终是否采用，AI 确实跑过）
      recordAudit({
        actor: WORKSPACE_AUDIT_ACTOR,
        action: "ai.parse_triggered",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: "AI 综合进展说明与附件判断当前任务进度",
        metadata: {
          confidence: assessment.confidence,
          stage: assessment.stage,
          provider: result.provider,
          model: result.model,
          source: result.source,
          note_attachment_count: noteAttachments.length,
          has_note_text: hasNote,
        },
        source: "ai",
      });
      const aiProgress = clampProgressValue(assessment.progress);
      onRequestConfirm({
        title: t("AI 解析结果"),
        message: t("AI 判断当前进度为 {progress}%（阶段：{stage} · 置信度 {confidence}%）。", { progress: aiProgress, stage: assessment.stage, confidence: assessment.confidence }),
        confirmLabel: t("回显到进度条"),
        details: [
          assessment.recommendation ? t("AI 建议：{recommendation}", { recommendation: assessment.recommendation }) : "",
          suggestedItem ? t("AI 判断本次进展属于工作项《{title}》，已预选关联（可在表单中修改）。", { title: suggestedItem.title }) : "",
          t("确认后只把该进度填入下方进度条，你可再手动微调；点「保存进度」才真正写入。"),
        ].filter(Boolean),
        onConfirm: () => {
          setDraftProgress(aiProgress);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("AI 进度判断失败");
      toast.error(t("AI 解析失败：{message}", { message }));
    } finally {
      setAiLoading(false);
    }
  };

  const submitHandoff = () => {
    if (selectedCollaborators.length === 0) {
      toast.error(t("请选择至少一名协同人"));
      return;
    }
    if (!canApplyCollaborationDirectly && !handoffReason.trim()) {
      toast.error(t("请填写协作原因和影响说明"));
      return;
    }
    const collaboratorNames = selectedCollaborators.map((collaborator) => collaborator.name).join("、");
    onRequestConfirm({
      title: canApplyCollaborationDirectly ? t("确认更新协同人") : t("确认提交协作审批"),
      message: canApplyCollaborationDirectly
        ? t("将把 {names} 设置为 {taskId} 的协同执行人。", { names: collaboratorNames, taskId: task.task_id })
        : t("将把 {taskId} 的协作变更提交给研发主管审核。", { taskId: task.task_id }),
      confirmLabel: canApplyCollaborationDirectly ? t("直接生效") : t("提交审批"),
      details: [
        t("协同人：{names}", { names: collaboratorNames }),
        canApplyCollaborationDirectly ? t("当前角色可直接更新任务协同人") : t("审批通过后才会写入任务协同人"),
        handoffReason.trim() ? t("说明：{reason}", { reason: handoffReason.trim() }) : t("未填写补充说明"),
      ],
      onConfirm: async () => {
        if (canApplyCollaborationDirectly) {
          await updateRdTask(task.task_id, {
            collaborators: selectedCollaborators,
            pending_review_type: null,
            pending_collaborators: [],
            pending_collaboration_reason: null,
            pending_collaboration_requested_at: null,
          });
          recordAudit({
            actor: WORKSPACE_AUDIT_ACTOR,
            action: "task.collaboration_updated",
            resource: { type: "task", id: task.task_id, name: task.title },
            changes: [{ field: "collaborators", before: (task.collaborators ?? []).map((item) => item.name).join("、"), after: collaboratorNames }],
            comment: handoffReason.trim() || "主管直接更新任务协同人",
            metadata: { collaborators: selectedCollaborators },
            source: "web",
          });
          toast.success(`${task.task_id} 协同人已更新`);
          await onCollaborationChanged(task.task_id, selectedCollaborators);
          onClose();
          return;
        }

        await updateRdTask(task.task_id, {
          status: "pending_review",
          pending_review_type: "collaboration",
          pending_collaborators: selectedCollaborators,
          pending_collaboration_reason: handoffReason.trim(),
          pending_collaboration_requested_at: new Date().toISOString(),
        });
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.collaboration_requested",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [{ field: "pending_collaborators", before: (task.collaborators ?? []).map((item) => item.name).join("、"), after: collaboratorNames }],
          comment: handoffReason.trim(),
          metadata: { current_progress: task.progress, collaborators: selectedCollaborators },
          source: "web",
        });
        toast.success(`${task.task_id} 已提交协作审批`);
        onLog(`${task.task_id} 已提交协作审批`);
        window.dispatchEvent(new CustomEvent('rd:review-submitted'));
        await onCollaborationChanged(task.task_id, selectedCollaborators, "pending_review");
        onClose();
      },
    });
  };

  const submitResult = () => {
    onRequestConfirm({
      title: t("确认提交成果验收"),
      message: t("将把 {taskId} 提交上级进行成果验收。", { taskId: task.task_id }),
      confirmLabel: t("确认提交"),
      details: [t("请确认交付物、风险说明和测试记录已补齐"), t("进度将标记为 100%（待验收，非完成）"), t("验收通过后任务才标记完成；被驳回则退回继续")],
      onConfirm: async () => {
        await updateRdTask(task.task_id, { status: "pending_review", pending_review_type: "result", progress: 100 });
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.submitted",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [
            { field: "status", before: task.status, after: "pending_review" },
            { field: "progress", before: String(task.progress), after: "100" },
          ],
          comment: "提交成果验收，进度标记为 100%（待验收，非完成）",
          metadata: { progress: 100 },
          source: "web",
        });
        toast.success(`${task.task_id} 已提交成果验收`);
        onLog(`${task.task_id} 已提交成果验收`);
        window.dispatchEvent(new CustomEvent('rd:review-submitted'));
        await onSubmittedForReview(task.task_id, { progress: 100 });
        onClose();
      },
    });
  };

  // 截止日期变更：仅走审核流程（不直接生效），审核通过后管理员侧才写入 due_date。
  const submitDueDateChange = () => {
    const next = draftDueDate.trim();
    const current = toDateInputValue(task.due_date);
    if (!next) {
      toast.error(t("请选择新的截止日期"));
      return;
    }
    if (next === current) {
      toast.error(t("新的截止日期与当前一致，无需提交"));
      return;
    }
    if (!dueDateReason.trim()) {
      toast.error(t("请填写修改原因，便于管理员审核"));
      return;
    }
    onRequestConfirm({
      title: t("确认提交截止日期变更审核"),
      message: t("将把 {taskId} 的截止日期变更提交给管理员审核。", { taskId: task.task_id }),
      confirmLabel: t("提交审核"),
      details: [
        t("当前截止日期：{date}", { date: current || t("未设置") }),
        t("申请变更为：{date}", { date: next }),
        t("审核通过后截止日期才会更新，任务回到进行中"),
        t("修改原因：{reason}", { reason: dueDateReason.trim() }),
      ],
      onConfirm: async () => {
        await updateRdTask(task.task_id, {
          status: "pending_review",
          pending_review_type: "due_date",
          pending_due_date: next,
          pending_due_date_reason: dueDateReason.trim(),
          pending_due_date_requested_at: new Date().toISOString(),
        });
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.due_date_requested",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [{ field: "due_date", before: current || "未设置", after: next }],
          comment: dueDateReason.trim(),
          metadata: { current_due_date: current, pending_due_date: next },
          source: "web",
        });
        toast.success(`${task.task_id} 已提交截止日期变更审核`);
        onLog(`${task.task_id} 已提交截止日期变更审核`);
        window.dispatchEvent(new CustomEvent('rd:review-submitted'));
        await onSubmittedForReview(task.task_id);
        onClose();
      },
    });
  };

  // 请求放弃任务：仅主责人、且任务处于活跃状态（进行中/请假/阻塞/挂起）时可发起。
  // 一律走审批（无直接生效路径）；审核通过后任务被硬删除（等同管理员删除），故文案强调不可恢复。
  const canAbandon =
    task.role === "primary" &&
    ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);

  const submitAbandon = async () => {
    const reason = abandonReason.trim();
    if (!reason) {
      toast.error(t("请填写放弃原因，便于管理员审核"));
      return;
    }
    setAbandonSubmitting(true);
    try {
      await updateRdTask(task.task_id, {
        status: "pending_review",
        pending_review_type: "abandon",
        pending_abandon_reason: reason,
        pending_abandon_requested_at: new Date().toISOString(),
      });
      recordAudit({
        actor: WORKSPACE_AUDIT_ACTOR,
        action: "task.abandon_requested",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "status", before: task.status, after: "pending_review" }],
        comment: reason,
        metadata: { current_progress: task.progress },
        source: "web",
      });
      toast.success(t("{taskId} 已提交放弃申请", { taskId: task.task_id }));
      onLog(`${task.task_id} 已提交放弃申请`);
      window.dispatchEvent(new CustomEvent("rd:review-submitted"));
      await onSubmittedForReview(task.task_id);
      setAbandonOpen(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("提交失败，请重试"));
      setAbandonSubmitting(false);
    }
  };

  // 申请合并：与放弃同门控（主责人 + 活跃状态）。一律走审批；通过后本任务并入目标并归档保留。
  const canMerge =
    task.role === "primary" &&
    ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);

  // 打开合并弹窗时拉取候选目标任务（全部产品库展平，排除本任务/已归档/已完成）。同库校验由后端在审核通过时执行。
  useEffect(() => {
    if (!mergeOpen) return;
    let alive = true;
    setMergeLoading(true);
    fetchMergedTaskCategories()
      .then((cats) => {
        const out: Array<{ task_id: string; title: string; primary_owner: string }> = [];
        const walk = (tasks: unknown): void => {
          for (const t of Array.isArray(tasks) ? tasks : []) {
            const rec = t as { task_id?: string; title?: string; primary_owner?: string; archived?: boolean; status?: string; subtasks?: unknown };
            if (rec?.task_id && rec.task_id !== task.task_id && !rec.archived && rec.status !== "completed") {
              out.push({ task_id: rec.task_id, title: rec.title ?? t("(无标题)"), primary_owner: rec.primary_owner ?? "" });
            }
            if (Array.isArray(rec?.subtasks)) walk(rec.subtasks);
          }
        };
        for (const c of Array.isArray(cats) ? cats : []) {
          for (const ch of Array.isArray((c as { children?: unknown }).children) ? (c as { children: unknown[] }).children : []) {
            walk((ch as { tasks?: unknown }).tasks);
          }
        }
        if (alive) setMergeCandidates(out);
      })
      .catch(() => {
        if (alive) setMergeCandidates([]);
      })
      .finally(() => {
        if (alive) setMergeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mergeOpen, task.task_id]);

  const submitMergeRequest = async () => {
    if (!mergeTargetId) {
      toast.error(t("请选择要合并到的目标任务"));
      return;
    }
    setMergeSubmitting(true);
    try {
      await updateRdTask(task.task_id, {
        status: "pending_review",
        pending_review_type: "merge",
        pending_merge_target: mergeTargetId,
        pending_merge_reason: mergeReason.trim(),
        pending_merge_requested_at: new Date().toISOString(),
        pending_merge_requested_by: WORKSPACE_AUDIT_ACTOR.name,
        pending_merge_requested_by_id: WORKSPACE_AUDIT_ACTOR.id,
      } as Parameters<typeof updateRdTask>[1]);
      recordAudit({
        actor: WORKSPACE_AUDIT_ACTOR,
        action: "task.merge_requested",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "status", before: task.status, after: "pending_review" }],
        comment: mergeReason.trim() || `申请合并到 ${mergeTargetId}`,
        metadata: { merge_target: mergeTargetId },
        source: "web",
      });
      toast.success(t("{taskId} 已提交合并申请", { taskId: task.task_id }));
      onLog(`${task.task_id} 已提交合并申请`);
      window.dispatchEvent(new CustomEvent("rd:review-submitted"));
      await onSubmittedForReview(task.task_id);
      setMergeOpen(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("提交合并申请失败，请重试"));
      setMergeSubmitting(false);
    }
  };

  // ── 进度附件入列：文件选择 / 拖拽 / 粘贴三处共用同一套校验，避免重复 ──
  const addNoteFiles = (incoming: File[]) => {
    const files = incoming.filter((f) => f.size > 0);
    if (files.length === 0) return;
    if (noteAttachments.length >= NOTE_ATTACHMENT_MAX_FILES) {
      toast.error(`最多上传 ${NOTE_ATTACHMENT_MAX_FILES} 个附件`);
      return;
    }
    const oversized = files.find((f) => f.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name || "文件"} 超过单文件 25MB 限制`);
      return;
    }
    const merged = [...noteAttachments, ...files].slice(0, NOTE_ATTACHMENT_MAX_FILES);
    if (merged.reduce((sum, f) => sum + f.size, 0) > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
      toast.error(t("附件总大小不能超过 50MB"));
      return;
    }
    const added = merged.length - noteAttachments.length;
    setNoteAttachments(merged);
    if (added > 0) toast.success(`已添加 ${added} 个附件`);
    if (added < files.length) toast.error(`超出 ${NOTE_ATTACHMENT_MAX_FILES} 个上限，部分文件未添加`);
  };

  // 从剪贴板/拖拽数据里抽出文件；截图粘贴通常无有意义文件名（Chrome 给 "image.png"），
  // 补一个带时间戳的名字避免多张截图互相覆盖。
  const extractDataTransferFiles = (items: DataTransferItemList | null | undefined): File[] => {
    if (!items) return [];
    const out: File[] = [];
    Array.from(items).forEach((item, i) => {
      if (item.kind !== "file") return;
      const f = item.getAsFile();
      if (!f) return;
      if (f.type.startsWith("image/") && (!f.name || f.name === "image.png")) {
        const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
        out.push(new File([f], `粘贴图片-${Date.now()}-${i}.${ext}`, { type: f.type }));
      } else {
        out.push(f);
      }
    });
    return out;
  };

  const handleNotePaste = (e: React.ClipboardEvent) => {
    if (savingNote || aiLoading) return;
    const files = extractDataTransferFiles(e.clipboardData?.items);
    if (files.length > 0) {
      e.preventDefault(); // 仅在含文件时拦截，纯文本粘贴保持默认行为
      addNoteFiles(files);
    }
  };

  // 从任务列表卡片「申请放弃」进入时，挂载即自动弹出原因弹窗（复用同一套提交/审批逻辑）。
  // activePanel 以 openedAt 作 key，每次打开都会重新挂载，故空依赖只在本次打开触发一次。
  useEffect(() => {
    if (autoAbandon && canAbandon) {
      setAbandonReason("");
      setAbandonOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DrawerShell
      title={task.title}
      subtitle={isUsCollabWorkspace() ? task.task_id : `${task.task_id} / ${task.category_path}`}
      icon={ClipboardCheck}
      onClose={onClose}
    >
      <div className="space-y-5">
        {isTaskCompleted ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t("任务已完成，以下内容仅供回看。")}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tabConfig.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(item.key);
                    setReceipt(null);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all",
                    tab === item.key
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_8px_18px_rgba(79,70,229,0.08)]"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              ))}
            </div>

            <FlowSteps steps={flowSteps} />
          </>
        )}

        {receipt && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{receipt}</span>
          </div>
        )}

        {tab === "detail" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">{t("状态")}</div>
                <div className="mt-1"><StatusPill task={task} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">{t("优先级")}</div>
                <div className="mt-1"><PriorityBadge priority={task.priority} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">{t("截止日期")}</div>
                  {isTaskCompleted ? null : dueDateChangePending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("变更审核中")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftDueDate(toDateInputValue(task.due_date));
                        setDueDateReason("");
                        setEditingDueDate((prev) => !prev);
                      }}
                      className="cursor-pointer text-[11px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
                    >
                      {editingDueDate ? t("取消") : t("修改")}
                    </button>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.due_date}</div>
              </div>
            </div>

            {editingDueDate && !dueDateChangePending && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CalendarClock className="h-4 w-4 text-indigo-600" />
                  {t("修改截止日期")}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t("提交后任务进入待审核状态，管理员审核通过后截止日期才会更新；审核期间任务不可继续操作。")}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-500">{t("新的截止日期")}</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "mt-1 w-full justify-start text-left font-normal",
                            !draftDueDate && "text-muted-foreground",
                          )}
                        >
                          <CalendarDays className="mr-2 h-4 w-4" />
                          {draftDueDate || t("选择日期")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={parseDateInputValue(draftDueDate)}
                          onSelect={(date) => setDraftDueDate(date ? formatDateInputValue(date) : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                    <div className="text-xs text-slate-400">{t("当前截止日期")}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">{task.due_date || t("未设置")}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs font-medium text-slate-500">{t("修改原因")}</label>
                  <Textarea
                    value={dueDateReason}
                    onChange={(event) => setDueDateReason(event.target.value)}
                    rows={3}
                    placeholder={t("请说明调整截止日期的原因，便于管理员审核")}
                    className="mt-1"
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDueDate(false);
                      setDueDateReason("");
                      setDraftDueDate(toDateInputValue(task.due_date));
                    }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    {t("取消")}
                  </button>
                  <button
                    type="button"
                    onClick={submitDueDateChange}
                    className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    {t("提交审核")}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">{t("任务说明")}</div>
              <AutoTranslatedText as="p" className="text-sm leading-6 text-slate-600" text={task.description} />
              <AutoTranslatedText as="div" className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700" text={task.next_action} />
            </div>

            {/* 工作项清单：任务内部轻量拆分（如不同类型文档各一项）。参与人直接增删勾选，无需审批。
                受 workItemsFeatureEnabled 开关控制（当前仅协同模块），其他工作台隐藏、数据保留 */}
            {workItemsFeatureEnabled() && (workItems.length > 0 || !isTaskCompleted) && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">
                    {t("工作项")}{workItems.length > 0 ? ` ${workItems.filter((it) => it.done).length}/${workItems.length}` : ""}
                  </span>
                  <span className="text-[10px] text-slate-400">{t("拆分任务的小块，进展留痕可关联到工作项")}</span>
                </div>
                {workItems.length > 0 && (
                  <ul className="space-y-1.5">
                    {workItems.map((it) => (
                      <li key={it.id} className="group flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-sm">
                        <Checkbox
                          checked={it.done}
                          disabled={isTaskCompleted}
                          onCheckedChange={() =>
                            void persistWorkItems(
                              workItems.map((w) => (w.id === it.id ? { ...w, done: !w.done } : w)),
                              it.done ? `重新打开了工作项《${it.title}》` : `完成了工作项《${it.title}》`,
                              it.id,
                            )
                          }
                          className="border-slate-300"
                        />
                        <span className={cn("min-w-0 flex-1 truncate", it.done ? "text-slate-400 line-through" : "text-slate-700")}>{it.title}</span>
                        {it.owner_name && <span className="shrink-0 text-[11px] text-slate-400">{it.owner_name}</span>}
                        {!isTaskCompleted && (
                          <button
                            type="button"
                            onClick={() =>
                              void persistWorkItems(
                                workItems.filter((w) => w.id !== it.id),
                                `删除了工作项《${it.title}》`,
                              )
                            }
                            className="shrink-0 cursor-pointer rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-500 group-hover:opacity-100"
                            title={t("删除工作项（已关联的留痕保留在主任务）")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!isTaskCompleted && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={workItemDraft}
                      onChange={(event) => setWorkItemDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addWorkItem();
                      }}
                      placeholder={t("输入工作项标题，回车添加（如：用户手册 · 英文版）")}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    />
                    <button
                      type="button"
                      disabled={savingWorkItems || !workItemDraft.trim()}
                      onClick={addWorkItem}
                      className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {t("添加")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/*<div className="grid gap-4 sm:grid-cols-2">*/}
            {/*  <div className="rounded-xl border border-slate-200 p-4">*/}
            {/*    <div className="mb-3 text-sm font-semibold text-slate-900">交付物</div>*/}
            {/*    <ul className="space-y-2">*/}
            {/*      {task.deliverables.map((item) => (*/}
            {/*        <li key={item} className="flex items-center gap-2 text-sm text-slate-600">*/}
            {/*          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />*/}
            {/*          {item}*/}
            {/*        </li>*/}
            {/*      ))}*/}
            {/*    </ul>*/}
            {/*  </div>*/}
            {/*  <div className="rounded-xl border border-slate-200 p-4">*/}
            {/*    <div className="mb-3 text-sm font-semibold text-slate-900">阻塞项</div>*/}
            {/*    {task.blockers.length === 0 ? (*/}
            {/*      <p className="text-sm text-slate-400">暂无阻塞</p>*/}
            {/*    ) : (*/}
            {/*      <ul className="space-y-2">*/}
            {/*        {task.blockers.map((item) => (*/}
            {/*          <li key={item} className="flex items-center gap-2 text-sm text-red-600">*/}
            {/*            <AlertTriangle className="h-3.5 w-3.5" />*/}
            {/*            {item}*/}
            {/*          </li>*/}
            {/*        ))}*/}
            {/*      </ul>*/}
            {/*    )}*/}
            {/*  </div>*/}
            {/*</div>*/}

            {/*<div className="rounded-xl border border-slate-200 p-4">*/}
            {/*  <div className="mb-3 text-sm font-semibold text-slate-900">任务时间线</div>*/}
            {/*  <div className="space-y-0">*/}
            {/*    {task.timeline.map((item, index) => (*/}
            {/*      <div key={item.label} className="relative flex gap-3 pb-4 last:pb-0">*/}
            {/*        {index < task.timeline.length - 1 && (*/}
            {/*          <span className="absolute left-[7px] top-5 h-[calc(100%-16px)] w-px bg-slate-200" />*/}
            {/*        )}*/}
            {/*        <span*/}
            {/*          className={cn(*/}
            {/*            "relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-2 bg-white",*/}
            {/*            item.state === "done" && "border-emerald-400",*/}
            {/*            item.state === "current" && "border-blue-500 shadow-[0_0_0_4px_rgba(37,99,235,0.10)]",*/}
            {/*            item.state === "todo" && "border-slate-300",*/}
            {/*          )}*/}
            {/*        />*/}
            {/*        <div>*/}
            {/*          <div className="text-sm font-medium text-slate-800">{item.label}</div>*/}
            {/*          <div className="text-xs text-slate-400">{item.time}</div>*/}
            {/*        </div>*/}
            {/*      </div>*/}
            {/*    ))}*/}
            {/*  </div>*/}
            {/*</div>*/}

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">{t("操作留痕")}</div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {taskLogs.length}{taskAttachmentTotal > 0 ? ` · ${t("{n} 个附件", { n: taskAttachmentTotal })}` : ""}
                </span>
              </div>
              <AuditTimeline
                logs={timelineTaskLogs}
                showResource={false}
                emptyText={t("暂无此任务的操作记录")}
                renderExtra={(log) => {
                  const note = logNoteMatches.get(log.id);
                  if (!note) return null;
                  const editable = canEditNoteAttachments(note);
                  const noteOps = attachmentOpsByNoteId.get(note.id) ?? [];
                  if (note.attachments.length === 0 && !editable && noteOps.length === 0) return null;
                  return (
                    <div className="space-y-1.5">
                      {note.attachments.length > 0 && (
                        <ProgressAttachmentGrid
                          attachments={note.attachments}
                          compact
                          {...(editable
                            ? {
                                onDeleteAttachment: (att: RdTaskProgressAttachment) => setDeleteAttTarget({ note, att }),
                                onReplaceAttachment: (att: RdTaskProgressAttachment) => {
                                  attachmentTargetRef.current = { note, att };
                                  replaceFileInputRef.current?.click();
                                },
                              }
                            : {})}
                        />
                      )}
                      {editable && (
                        <button
                          type="button"
                          disabled={attachmentBusy}
                          onClick={() => {
                            attachmentTargetRef.current = { note };
                            addFilesInputRef.current?.click();
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <UploadCloud className="h-3 w-3" />
                          {attachmentBusy ? t("处理中…") : t("添加附件")}
                        </button>
                      )}
                      {/* 附件变更历史（归位展示）：谁在什么时候增/删/换了本条进展的附件 */}
                      {noteOps.length > 0 && (
                        <div className="space-y-0.5 border-l-2 border-slate-100 pl-2">
                          {[...noteOps]
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map((op) => (
                              <div key={op.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-5 text-slate-400">
                                <AutoTranslatedText
                                  as="span"
                                  text={op.comment || "变更了附件"}
                                  className={cn(
                                    "font-medium",
                                    op.action === "task.attachment_removed" && "text-red-500/80",
                                    op.action === "task.attachment_replaced" && "text-amber-600/90",
                                    op.action === "task.attachment_added" && "text-slate-500",
                                  )}
                                />
                                <span>· {op.actor.name}</span>
                                <span className="tabular-nums">
                                  · {new Date(op.timestamp).toLocaleString(i18nLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              {/* 隐藏文件选择器：新增（多选）/ 替换（单选），目标留痕存于 attachmentTargetRef */}
              <input
                ref={addFilesInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  const target = attachmentTargetRef.current;
                  if (target && files.length > 0) void handleAddAttachmentFiles(target.note, files);
                }}
              />
              <input
                ref={replaceFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  const target = attachmentTargetRef.current;
                  if (target?.att && file) void handleReplaceAttachmentFile(target.note, target.att, file);
                }}
              />
            </div>

            {/* 删除附件确认弹层 */}
            {deleteAttTarget && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 px-4" role="dialog" aria-modal="true">
                <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
                  <div className="text-sm font-semibold text-slate-900">{t("删除附件")}</div>
                  <p className="mt-2 break-all text-sm leading-6 text-slate-600">
                    {t("确认删除附件「{name}」吗？删除后 AI 解析与知识检索将不再包含此文件。", { name: deleteAttTarget.att.name })}
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeleteAttTarget(null)} disabled={attachmentBusy}>
                      {t("取消")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void confirmDeleteAttachment()}
                      disabled={attachmentBusy}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {attachmentBusy ? t("删除中…") : t("确认删除")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 方案2：低强调的次级文字按钮，置于详情底部，点击打开聚焦的放弃原因弹窗。
                仅主责人 + 活跃状态可见（待审核/已完成等不显示）。 */}
            {(canAbandon || canMerge) && (
              <div className="flex justify-center gap-4 pt-1">
                {canMerge && (
                  <button
                    type="button"
                    onClick={() => { setMergeReason(""); setMergeTargetId(""); setMergeSearch(""); setMergeOpen(true); }}
                    className="cursor-pointer text-xs font-medium text-slate-400 underline-offset-4 transition-colors hover:text-cyan-600 hover:underline"
                  >
                    {t("申请合并到其他任务")}
                  </button>
                )}
                {canAbandon && (
                  <button
                    type="button"
                    onClick={() => { setAbandonReason(""); setAbandonOpen(true); }}
                    className="cursor-pointer text-xs font-medium text-slate-400 underline-offset-4 transition-colors hover:text-rose-600 hover:underline"
                  >
                    {t("请求放弃此任务")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "progress" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                {t("AI 综合判断当前进度")}
              </div>
              <p className="mt-1">
                {t("在下方填写进展说明并/或上传附件（方案、测试记录、实验数据、评审纪要等），AI 会一起读取后给出建议；最终进度由人工确认。")}
              </p>
              {aiLoading && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-indigo-700 ring-1 ring-indigo-100">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t("AI 正在阅读依据并判断当前任务阶段…")}
                </div>
              )}
            </div>

            {aiAssessment && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-emerald-900">{t(aiAssessment.stage)}</div>
                    <p className="mt-1 text-xs text-emerald-700">
                      {t("AI 建议进度 {p}% / 置信度 {c}%", { p: aiAssessment.progress, c: aiAssessment.confidence })}
                    </p>
                  </div>
                  {draftProgress !== clampProgressValue(aiAssessment.progress) && (
                    <ActionButton
                      variant="ghost"
                      onClick={() => {
                        const before = draftProgress;
                        setDraftProgress(clampProgressValue(aiAssessment.progress));
                        setReceipt(null);
                        recordAudit({
                          actor: WORKSPACE_AUDIT_ACTOR,
                          action: "ai.suggestion_accepted",
                          resource: { type: "task", id: task.task_id, name: task.title },
                          changes: [{ field: "draft_progress", before, after: aiAssessment.progress }],
                          comment: "恢复 AI 进度建议",
                          metadata: { confidence: aiAssessment.confidence, stage: aiAssessment.stage },
                          source: "web",
                        });
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("恢复 AI 进度")}
                    </ActionButton>
                  )}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {aiAssessment.basis.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs leading-5 text-emerald-700">
                      <Check className="mt-0.5 h-3 w-3 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs leading-5 text-emerald-800">
                  {aiAssessment.recommendation}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{t("人工确认进度")}</span>
                  {aiAssessment && (
                    draftProgress === clampProgressValue(aiAssessment.progress) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        <Check className="h-3 w-3" />
                        {t("已采用 AI 建议")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {t("已手动调整")}
                      </span>
                    )
                  )}
                </div>
                <span className="font-semibold tabular-nums text-indigo-700">{draftProgress}%</span>
              </div>
              <Input
                type="range"
                min={0}
                max={100}
                value={draftProgress}
                disabled={savingNote || aiLoading}
                onChange={(event) => {
                  setDraftProgress(clampProgressValue(Number(event.target.value)));
                  setReceipt(null);
                }}
                className="w-full accent-indigo-600"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>{t("未开始")}</span>
                <span>{t("方案")}</span>
                <span>{t("验证")}</span>
                <span>{t("待评审")}</span>
                <span>{t("完成")}</span>
              </div>
            </div>
            {workItemsFeatureEnabled() && workItems.length > 0 && (
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{t("关联工作项")}</span>
                  <span className="text-[10px] text-slate-400">{t("可选，本条进展归属到任务的哪个子块")}</span>
                </div>
                <Select value={noteWorkItemId || "none"} onValueChange={(v) => setNoteWorkItemId(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-2 w-full rounded-xl border-slate-200 text-sm text-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    <SelectItem value="none">{t("不关联（记到主任务）")}</SelectItem>
                    {workItems.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.done ? "✓ " : ""}{it.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{t("进展说明")}</span>
                <span className="text-[10px] text-slate-400">{t("输入 @ 可提及成员 · 文本与附件均会送 AI 分析")}</span>
              </div>
              <div className="relative">
                <MentionSuggestionPanel
                  open={mention.open}
                  candidates={mention.filtered}
                  highlightIndex={mention.highlightIndex}
                  onPick={mention.pick}
                  variant="desktop"
                />
                <Textarea
                  ref={noteInputRef}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    mention.syncActiveQuery();
                  }}
                  onKeyDown={(event) => { mention.handleKeyDown(event); }}
                  onKeyUp={mention.syncActiveQuery}
                  onClick={mention.syncActiveQuery}
                  onPaste={handleNotePaste}
                  rows={4}
                  placeholder={t("说明本次进度变化、上传文件依据、产出内容、仍需支持的事项（可直接 Ctrl/⌘+V 粘贴截图）")}
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </label>

            <div
              tabIndex={0}
              onPaste={handleNotePaste}
              onDragOver={(e) => { e.preventDefault(); if (!savingNote && !aiLoading) setNoteDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setNoteDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setNoteDragOver(false);
                if (savingNote || aiLoading) return;
                addNoteFiles(extractDataTransferFiles(e.dataTransfer.items));
              }}
              className={cn(
                "rounded-xl border px-3 py-3 outline-none transition-colors",
                noteDragOver
                  ? "border-dashed border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-slate-50/60 focus-visible:border-indigo-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{t("附件（AI 判断依据 + 留档）")}</span>
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    savingNote || aiLoading
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "cursor-pointer border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700",
                  )}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  {t("添加文件/图片")}
                  <Input
                    type="file"
                    multiple
                    disabled={savingNote || aiLoading}
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.zip,.rar,.png,.jpg,.jpeg,.webp,.bmp"
                    onChange={(event) => {
                      addNoteFiles(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {noteDragOver ? (
                <p className="mt-2 text-[11px] font-medium text-indigo-600">{t("松开鼠标即可上传到此任务")}</p>
              ) : noteAttachments.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-400">{t("最多 10 个，单文件 25MB 以内，总计 50MB。可点上方按钮、把文件拖到此处、或直接 Ctrl/⌘+V 粘贴截图。填写说明 / 上传附件后点「AI 解析」获取进度建议。")}</p>
              ) : (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {noteAttachments.map((file, idx) => (
                    <div
                      key={`${file.name}-${file.size}-${idx}`}
                      className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-slate-400">{formatFileSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = noteAttachments.filter((_, i) => i !== idx);
                          setNoteAttachments(next);
                          // 证据全部移除则清空 AI 建议；AI 解析改为显式点「AI 解析」按钮触发
                          if (next.length === 0 && !note.trim()) setAiAssessment(null);
                        }}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={t("移除附件")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose} disabled={savingNote}>{t("取消")}</ActionButton>
              <ActionButton onClick={aiParseProgress} disabled={savingNote || aiLoading}>
                {aiLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiLoading ? t("AI 解析中…") : t("AI 解析")}
              </ActionButton>
              <ActionButton onClick={submitProgress} variant="primary" disabled={savingNote || aiLoading}>
                {savingNote ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {savingNote ? t("保存中…") : t("保存进度")}
              </ActionButton>
            </div>
          </div>
        )}

        {tab === "handoff" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">{t("协同人")}</span>
                <span className="text-xs text-slate-400">{t("已选")} {selectedCollaboratorKeys.size}</span>
              </div>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                {peopleLoading ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-slate-400">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {t("正在读取研发人员")}
                  </div>
                ) : peopleError ? (
                  <div className="rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-600">{t("研发人员加载失败，请稍后重试。")}</div>
                ) : collaboratorCandidates.length === 0 ? (
                  <div className="rounded-lg bg-white px-3 py-3 text-xs text-slate-400">{t("暂无可选择的协同人。")}</div>
                ) : (
                  <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {collaboratorCandidates.map((person) => {
                      const value = rdPersonOptionValue(person);
                      const checked = selectedCollaboratorKeys.has(value);
                      return (
                        <label
                          key={value}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors",
                            checked ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-100 hover:bg-indigo-50/50",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) => {
                              setSelectedCollaboratorKeys((current) => {
                                const copy = new Set(current);
                                if (next === true) copy.add(value);
                                else copy.delete(value);
                                return copy;
                              });
                            }}
                            className="mt-0.5 rounded border-slate-300 text-indigo-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{person.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-400">
                              {[person.position, person.department].filter(Boolean).join(" · ") || t("研发成员")}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">{t("协作原因和影响")}</span>
              <Textarea
                value={handoffReason}
                onChange={(event) => setHandoffReason(event.target.value)}
                rows={4}
                placeholder={t("说明为什么需要协同、当前进展、未解决风险和期望协同人下一步动作")}
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <div className={cn(
              "rounded-lg px-3 py-2 text-xs leading-5",
              canApplyCollaborationDirectly ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
            )}>
              {canApplyCollaborationDirectly
                ? t("当前角色可直接更新协同人，保存后协同任务立即生效。")
                : t("提交后会进入研发主管审核，通过后才会写入任务协同人。")}
            </div>
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose}>{t("取消")}</ActionButton>
              <ActionButton onClick={submitHandoff} variant="primary" disabled={peopleLoading || selectedCollaborators.length === 0}>
                <GitBranch className="h-3.5 w-3.5" />
                {canApplyCollaborationDirectly ? t("保存协同人") : t("提交审批")}
              </ActionButton>
            </div>
          </div>
        )}

        {tab === "submit" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            {/* Already-submitted banner */}
            {task.status === "pending_review" && (
              <div className="flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-violet-700">{t("审核申请已提交，等待处理")}</div>
                  <div className="mt-0.5 text-xs text-violet-500">{t("如审核人未收到通知，可点击「重新发送通知」再次提醒。")}</div>
                </div>
                <ActionButton
                  onClick={submitResult}
                  className="shrink-0 text-violet-700 ring-violet-200 hover:bg-violet-100"
                >
                  <Send className="h-3.5 w-3.5" />
                  {t("重新发送通知")}
                </ActionButton>
              </div>
            )}
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">{t("提交前检查")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[t("交付物已上传"), t("风险已说明"), t("测试记录已补齐"), t("关联人员已同步")].map((item) => (
                  <label key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                    <Checkbox className="rounded border-slate-300 text-indigo-600" />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">{t("提交说明")}</span>
              <Textarea
                rows={4}
                placeholder={t("补充本次提交的结论、已知风险和需要审核人关注的重点")}
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <ActionButton>
                <UploadCloud className="h-3.5 w-3.5" />
                {t("上传附件")}
              </ActionButton>
              {task.status !== "pending_review" && (
                <ActionButton onClick={submitResult} variant="primary">
                  <Send className="h-3.5 w-3.5" />
                  {t("提交审核")}
                </ActionButton>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 请求放弃任务：聚焦弹窗（自含确认）。填写原因 → 提交，一律进入待审核走审批。
          z-[80] 盖在抽屉(z-50)之上。弹窗本身即审慎确认面，故不再二次确认。 */}
      {abandonOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-[2px]"
          onClick={abandonSubmitting ? undefined : () => setAbandonOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-abandon-title"
          >
            <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/70 px-6 py-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h3 id="workspace-abandon-title" className="text-base font-bold text-slate-900">{t("请求放弃任务")}</h3>
                <p className="mt-1 text-sm text-slate-500">{t("提交后将流转给研发主管审核")}</p>
              </div>
            </div>
            <div className="space-y-3 px-6 py-5">
              <div className="rounded-xl bg-rose-50/60 px-4 py-3 text-xs leading-5 text-rose-700 ring-1 ring-rose-100">
                {t("审核通过后，任务「")}{task.title}{t("」将被移除（等同删除），不可恢复；审核期间任务进入待审核状态，不可继续操作。")}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900">
                  {t("放弃原因")}<span className="ml-0.5 text-rose-500">{t("（必填）")}</span>
                </label>
                <Textarea
                  value={abandonReason}
                  onChange={(event) => setAbandonReason(event.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={t("请说明放弃该任务的原因，便于管理员审核判断")}
                  className="mt-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                disabled={abandonSubmitting}
                onClick={() => setAbandonOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                disabled={abandonSubmitting || !abandonReason.trim()}
                onClick={submitAbandon}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {abandonSubmitting ? t("提交中…") : t("提交放弃申请")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 申请合并到其他任务：选目标 + 原因，提交给主管审核；通过后本任务并入目标并归档。 */}
      {mergeOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-[2px]"
          onClick={mergeSubmitting ? undefined : () => setMergeOpen(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-merge-title"
          >
            <div className="flex items-start gap-3 border-b border-cyan-100 bg-cyan-50/70 px-6 py-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h3 id="workspace-merge-title" className="text-base font-bold text-slate-900">{t("申请合并到其他任务")}</h3>
                <p className="mt-1 text-sm text-slate-500">{t("提交后将流转给研发主管审核")}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
              <div className="rounded-xl bg-cyan-50/60 px-4 py-3 text-xs leading-5 text-cyan-800 ring-1 ring-cyan-100">
                {t("审核通过后，本任务「{title}」将并入所选目标任务（进度留痕/附件/协作人一并迁移，子任务随迁），本任务归档保留；合并后由你担任目标任务的主责人。仅支持同一产品库内的任务合并。", { title: task.title })}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900">{t("选择目标任务")}<span className="ml-0.5 text-rose-500">{t("（必选）")}</span></label>
                <input
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  placeholder={t("搜索任务标题 / 编号")}
                  className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                />
                <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                  {mergeLoading ? (
                    <div className="px-3 py-6 text-center text-sm text-slate-400">{t("加载候选任务…")}</div>
                  ) : (() => {
                    const kw = mergeSearch.trim().toLowerCase();
                    const list = mergeCandidates.filter(
                      (c) => !kw || c.title.toLowerCase().includes(kw) || c.task_id.toLowerCase().includes(kw),
                    );
                    if (list.length === 0) {
                      return <div className="px-3 py-6 text-center text-sm text-slate-400">{t("没有可选的目标任务")}</div>;
                    }
                    return list.slice(0, 100).map((c) => (
                      <button
                        key={c.task_id}
                        type="button"
                        onClick={() => setMergeTargetId(c.task_id)}
                        className={cn(
                          "flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50",
                          mergeTargetId === c.task_id && "bg-cyan-50",
                        )}
                      >
                        <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full border", mergeTargetId === c.task_id ? "border-cyan-500 bg-cyan-500" : "border-slate-300")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{c.title}</span>
                          <span className="block truncate text-[11px] text-slate-400">{c.task_id}{c.primary_owner ? ` · ${c.primary_owner}` : ""}</span>
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900">{t("合并原因")}<span className="ml-1 text-xs font-normal text-slate-400">{t("（选填）")}</span></label>
                <Textarea
                  value={mergeReason}
                  onChange={(event) => setMergeReason(event.target.value)}
                  rows={3}
                  placeholder={t("简述为何要合并这两个任务，便于主管审核")}
                  className="mt-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                disabled={mergeSubmitting}
                onClick={() => setMergeOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                disabled={mergeSubmitting || !mergeTargetId}
                onClick={submitMergeRequest}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mergeSubmitting ? t("提交中…") : t("提交合并申请")}
              </button>
            </div>
          </div>
        </div>
      )}
    </DrawerShell>
  );
}

function AISuggestionDrawer({
  suggestion,
  regenerated,
  onClose,
  onConfirm,
  onDismiss,
  onRegenerate,
}: {
  suggestion: AiSuggestion;
  regenerated?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  return (
    <DrawerShell
      title={suggestion.title}
      subtitle={t("来源：{source}", { source: suggestion.source })}
      icon={Sparkles}
      onClose={onClose}
    >
      <div className="space-y-5">
        <FlowSteps
          steps={[
            { label: t("解析来源"), helper: t("识别会议或记录中的动作"), state: "done" },
            { label: t("人工校验"), helper: t("确认任务、责任人和时间"), state: "current" },
            { label: t("写入任务池"), helper: t("确认后生成操作记录"), state: "todo" },
          ]}
        />

        <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-violet-800">{t("AI 建议摘要")}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-violet-700">
              {t("置信度")} {regenerated ? Math.min(96, suggestion.confidence + 6) : suggestion.confidence}%
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-violet-700">
            {regenerated ? t("已根据更保守的拆解原则重新生成，请重点确认责任人和截止日期。") : <AutoTranslatedText text={suggestion.preview} />}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{t("待生成内容")}</div>
          <div className="divide-y divide-slate-100">
            {suggestion.generated_tasks.map((task) => (
              <div key={task.title} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_90px_80px_54px] sm:items-center">
                <div className="min-w-0">
                  <AutoTranslatedText as="div" className="truncate text-sm font-medium text-slate-800" text={task.title} />
                  <div className="mt-0.5 text-xs text-slate-400">{t("建议责任人：{owner}", { owner: task.owner })}</div>
                </div>
                <span className="text-xs text-slate-500">{t("截止")} {task.due}</span>
                <PriorityBadge priority={task.priority} />
                <ActionButton variant="ghost">{t("调整")}</ActionButton>
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-900">{t("调整意见")}</span>
          <Textarea
            rows={3}
            placeholder={t("例如：拆得更细、责任人改为赵强、截止日期顺延到下周三")}
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton onClick={onDismiss} variant="ghost">{t("忽略")}</ActionButton>
          <ActionButton onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("重新生成")}
          </ActionButton>
          <ActionButton onClick={onConfirm} variant="primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("确认写入")}
          </ActionButton>
        </div>
      </div>
    </DrawerShell>
  );
}

function NotificationDrawer({
  notification,
  relatedTask,
  onClose,
  onDismiss,
  onOpenTask,
  canReview,
  onApprove,
  onReject,
  onSelfAssess,
}: {
  notification: WorkspaceNotification;
  relatedTask?: WorkspaceTask;
  onClose: () => void;
  onDismiss: () => void;
  onOpenTask: (task: WorkspaceTask, tab: OperationTab) => void;
  canReview?: boolean;
  onApprove?: () => void | Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  onSelfAssess?: () => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isActing, setIsActing] = useState(false);
  const [progressNotes, setProgressNotes] = useState<RdTaskProgressNote[]>([]);
  const [progressNotesLoading, setProgressNotesLoading] = useState(false);

  // Parse JSON body if available
  let parsedBody: Record<string, unknown> | null = null;
  try {
    if (notification.raw_body) parsedBody = JSON.parse(notification.raw_body) as Record<string, unknown>;
  } catch { /* plain text */ }

  const msgBodyType = parsedBody?.type ?? "";
  const isReviewRequest = msgBodyType === "review_request";
  const isReviewResult = msgBodyType === "review_result";
  const isPerfSelfAssessment = msgBodyType === "perf_self_assessment";

  // review_request fields
  const reviewType = isReviewRequest ? String(parsedBody!.review_type ?? "") : "";
  const reviewTaskId = isReviewRequest ? String(parsedBody!.task_id ?? "") : "";
  const reviewTaskTitle = isReviewRequest ? String(parsedBody!.task_title ?? "") : "";
  const reviewSubmitterName = isReviewRequest ? String(parsedBody!.submitter_name ?? "") : "";
  const reviewNote = isReviewRequest ? String(parsedBody!.note ?? "") : "";
  const reviewPendingDueDate = isReviewRequest ? String(parsedBody!.pending_due_date ?? "") : "";
  const reviewCurrentDueDate = isReviewRequest ? String(parsedBody!.current_due_date ?? "") : "";

  // 拉取审核任务的进度记录，作为审核参考依据
  useEffect(() => {
    if (!isReviewRequest || !reviewTaskId) {
      setProgressNotes([]);
      return;
    }
    let cancelled = false;
    setProgressNotesLoading(true);
    fetchRdTaskProgressNotes(reviewTaskId)
      .then((list) => { if (!cancelled) setProgressNotes(list); })
      .catch(() => { if (!cancelled) setProgressNotes([]); })
      .finally(() => { if (!cancelled) setProgressNotesLoading(false); });
    return () => { cancelled = true; };
  }, [isReviewRequest, reviewTaskId]);

  // review_result fields
  const resultApproved = isReviewResult ? String(parsedBody!.result ?? "") === "approved" : false;
  const resultTaskTitle = isReviewResult ? String(parsedBody!.task_title ?? "") : "";
  const resultTaskId = isReviewResult ? String(parsedBody!.task_id ?? "") : "";
  const resultReviewerName = isReviewResult ? String(parsedBody!.reviewer_name ?? "管理员") : "";
  const resultReason = isReviewResult ? String(parsedBody!.reason ?? "") : "";

  const isHandled = Boolean(notification.handled);
  const showReviewButtons = isReviewRequest && canReview && !isHandled && !rejectOpen;

  const doApprove = async () => {
    if (!onApprove) return;
    setIsActing(true);
    try { await onApprove(); } finally { setIsActing(false); }
  };

  const doReject = async () => {
    if (!onReject || !rejectReason.trim()) return;
    setIsActing(true);
    try {
      await onReject(rejectReason.trim());
      setRejectOpen(false);
      setRejectReason("");
    } finally { setIsActing(false); }
  };

  return (
    <DrawerShell
      title={notification.title}
      subtitle={`${relativeTimeLabel((notification as { created_at?: string }).created_at, notification.time)} / ${t("通知处理")}`}
      icon={Bell}
      onClose={onClose}
    >
      <div className="space-y-5">

        {/* ── Review request card ── */}
        {isReviewRequest && (
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {isHandled ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{t("已审核")}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{t("待审核")}</span>
              )}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                {reviewType === "collaboration" ? t("协作变更审核") : reviewType === "proposal" ? t("立项审核") : reviewType === "due_date" ? t("截止日期变更审核") : reviewType === "abandon" ? t("放弃任务审核") : t("成果审核")}
              </span>
            </div>
            <div>
              <div className="font-mono text-xs text-slate-400 mb-0.5">{reviewTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{reviewTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">{t("提交人：")}<span className="font-medium text-slate-700">{reviewSubmitterName}</span></div>
            {reviewType === "due_date" && reviewPendingDueDate && (
              <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                <CalendarClock className="h-4 w-4 shrink-0 text-indigo-500" />
                <span className="text-slate-500">{reviewCurrentDueDate || t("未设置")}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="font-semibold text-indigo-700">{reviewPendingDueDate}</span>
              </div>
            )}
            {reviewNote && (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                <span className="font-medium text-slate-500">{reviewType === "due_date" ? t("修改原因：") : reviewType === "abandon" ? t("放弃原因：") : t("备注：")}</span><AutoTranslatedText text={reviewNote} />
              </div>
            )}
            {isHandled && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("审核已处理")}
              </div>
            )}
          </div>
        )}

        {/* ── 审核参考依据：进度时间线（仅审核类通知展示） ── */}
        {isReviewRequest && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Clock className="h-4 w-4 text-indigo-500" />
                {t("进度时间线")}
                <span className="text-xs font-normal text-slate-400">{t("（审核参考依据）")}</span>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {progressNotesLoading ? t("加载中") : t("{n} 条", { n: progressNotes.length })}
              </span>
            </div>
            <ProgressNoteList
              notes={progressNotes}
              loading={progressNotesLoading}
              emptyText={t("此任务暂无进度留痕记录")}
              compact
            />
          </div>
        )}

        {/* ── Review result card ── */}
        {isReviewResult && (
          <div className={`rounded-xl border p-4 space-y-3 ${resultApproved ? "border-emerald-100 bg-emerald-50/60" : "border-red-100 bg-red-50/60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${resultApproved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {resultApproved ? t("✓ 审核通过") : t("✕ 被打回")}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">{t("审核结果")}</span>
            </div>
            <div>
              <div className="font-mono text-xs text-slate-400 mb-0.5">{resultTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{resultTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">{t("审核人：")}<span className="font-medium text-slate-700">{resultReviewerName}</span></div>
            {resultApproved ? (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-100">
                {t("任务已通过审核，恭喜完成！")}
              </div>
            ) : (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                <span className="font-medium">{t("打回原因：")}</span>{resultReason ? <AutoTranslatedText text={resultReason} /> : t("请联系审核人了解详情")}
              </div>
            )}
          </div>
        )}

        {/* ── Plain message (fallback) ── */}
        {!isReviewRequest && !isReviewResult && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm leading-6 text-slate-700">{notification.message}</p>
          </div>
        )}

        {/* ── 绩效自评入口 ── */}
        {isPerfSelfAssessment && onSelfAssess && (
          <button
            type="button"
            onClick={onSelfAssess}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700"
          >
            {isHandled ? t("查看 / 修改自评") : t("去自评")}
          </button>
        )}

        {/* ── Related task block ── */}
        {relatedTask && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-xs text-slate-400">{relatedTask.task_id}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{relatedTask.title}</div>
              </div>
              <StatusPill task={relatedTask} />
            </div>
            <ProgressBar value={relatedTask.progress} />
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton onClick={() => onOpenTask(relatedTask, "detail")}>{t("查看详情")}</ActionButton>
              <ActionButton onClick={() => onOpenTask(relatedTask, notification.type === "due_soon" ? "handoff" : "progress")}>
                {t("推荐处理")}
                <ArrowRight className="h-3.5 w-3.5" />
              </ActionButton>
            </div>
          </div>
        )}

        {/* ── Sender info (non-review messages) ── */}
        {notification.type === "message" && !isReviewRequest && !isReviewResult && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-indigo-700">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-semibold">{notification.sender_name ?? t("未知发件人")}</span>
              {notification.sender_role && <span className="text-indigo-500">· {notification.sender_role}</span>}
              <span className="ml-auto text-indigo-400">{relativeTimeLabel((notification as { created_at?: string }).created_at, notification.time)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{notification.message}</p>
          </div>
        )}

        {/* ── System suggestion (non-message notifications) ── */}
        {notification.type !== "message" && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-indigo-800">
              <ShieldCheck className="h-4 w-4" />
              {t("系统建议")}
            </div>
            <p className="text-sm leading-6 text-indigo-700">
              {notification.type === "due_soon" && t("建议先确认是否需要顺延；如果仍由你处理，请更新下一步动作和风险说明。")}
              {notification.type === "blocked" && t("建议补充协作反馈，并把上游阻塞同步给主责人和上级。")}
              {notification.type === "pending_ai" && t("建议进入 AI 建议审核，确认后再写入任务池，避免自动生成不准确任务。")}
              {notification.type === "transfer" && t("建议确认接收人和影响范围后再提交移交流程。")}
            </p>
          </div>
        )}

        {/* ── Inline reject dialog ── */}
        {rejectOpen && (
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-4 space-y-3">
            <div className="text-sm font-semibold text-red-700">{t("填写驳回原因")}</div>
            <Textarea
              rows={3}
              placeholder={t("请说明驳回原因，申请人将收到通知…")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="bg-white text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={() => { setRejectOpen(false); setRejectReason(""); }} disabled={isActing}>
                {t("取消")}
              </ActionButton>
              <ActionButton variant="danger" onClick={doReject} disabled={!rejectReason.trim() || isActing}>
                {isActing ? t("处理中…") : t("确认驳回")}
              </ActionButton>
            </div>
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {showReviewButtons && (
            <>
              <ActionButton variant="primary" onClick={doApprove} disabled={isActing}>
                <Check className="h-3.5 w-3.5" />
                {isActing ? t("处理中…") : t("批准")}
              </ActionButton>
              <ActionButton variant="danger" onClick={() => setRejectOpen(true)} disabled={isActing}>
                {t("驳回")}
              </ActionButton>
            </>
          )}
          <ActionButton onClick={onClose} className="ml-auto">{t("稍后处理")}</ActionButton>
          {!isReviewRequest && !isReviewResult && (
            <ActionButton onClick={onDismiss} variant="primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("标记已处理")}
            </ActionButton>
          )}
          {isReviewResult && (
            <ActionButton onClick={onDismiss} variant="primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("知道了")}
            </ActionButton>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}

function applyProgressOverrides(tasks: WorkspaceTask[], overrides: Record<string, number>) {
  return tasks.map((task) => ({
    ...task,
    progress: overrides[task.task_id] ?? task.progress,
  }));
}

function updateTaskProgressList(tasks: WorkspaceTask[], taskId: string, progress: number) {
  return tasks.map((task) =>
    task.task_id === taskId
      ? { ...task, progress }
      : task,
  );
}

function markTaskSubmittedForReviewList(tasks: WorkspaceTask[], taskId: string, progress?: number) {
  return tasks.map((task) =>
    task.task_id === taskId
      ? {
          ...task,
          status: "pending_review" as TaskStatus,
          status_label: "待审核",
          next_action: "等待上级审核",
          // 仅成果审核会把进度置满；截止日期等其它审核保持原进度，避免误显示 100%。
          ...(typeof progress === "number" ? { progress } : {}),
        }
      : task,
  );
}

function updateTaskCollaboratorsList(tasks: WorkspaceTask[], taskId: string, collaborators: RdCollaborator[], status?: TaskStatus) {
  return tasks.map((task) =>
    task.task_id === taskId
      ? {
          ...task,
          ...(status
            ? {
                status,
                status_label: status === "pending_review" ? "待审核" : task.status_label,
                next_action: status === "pending_review" ? "等待主管审核协同变更" : task.next_action,
                pending_review_type: status === "pending_review" ? "collaboration" : task.pending_review_type,
                pending_collaborators: status === "pending_review" ? collaborators : task.pending_collaborators,
              }
            : { collaborators }),
        }
      : task,
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}


const WORKSPACE_PAGE_SIZE = 8;
const NOTIF_PAGE_SIZE = 5;

const WS_PRIORITY_GRAD: Record<string, { from: string; to: string }> = {
  high:   { from: "#f87171", to: "#dc2626" },
  medium: { from: "#fb923c", to: "#ea580c" },
  low:    { from: "#34d399", to: "#059669" },
};

const WS_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft:          { label: "草稿",   bg: "bg-slate-100",   text: "text-slate-500" },
  in_progress:    { label: "进行中", bg: "bg-blue-50",     text: "text-blue-700" },
  pending_review: { label: "待审核", bg: "bg-violet-50",   text: "text-violet-700" },
  paused_leave:   { label: "请假暂停", bg: "bg-amber-50",  text: "text-amber-700" },
  paused_blocked: { label: "阻塞",   bg: "bg-red-50",      text: "text-red-700" },
  on_hold:        { label: "挂起",   bg: "bg-slate-100",   text: "text-slate-500" },
  completed:      { label: "已完成", bg: "bg-emerald-50",  text: "text-emerald-700" },
  pending_assign: { label: "待指派", bg: "bg-orange-50",   text: "text-orange-700" },
  archived:       { label: "已归档", bg: "bg-slate-100",   text: "text-slate-400" },
};

const WS_PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  high:   { label: "高",  bg: "bg-red-50",    text: "text-red-700"    },
  medium: { label: "中",  bg: "bg-amber-50",  text: "text-amber-700"  },
  low:    { label: "低",  bg: "bg-slate-100", text: "text-slate-500"  },
};

// 个人工作台「移动归类」：与研发任务驾驶舱共用同一套移动目标（产品 → 一级系统 → 子项）。
// 主产品(prod-portable-o2)的分类树存于主库，用 fetchRdTaskCategories 取；其余产品用
// fetchProductTaskCategories 按需加载（切勿对主产品调用，否则后端会误种空 BOM）。
const RD_MAIN_PRODUCT_ID = "prod-portable-o2";

/** 选择移动目标产品并按需加载其分类树（镜像驾驶舱 useMoveTargetTree，自带产品列表 + 主树加载）。 */
function useWorkspaceMoveTargetTree() {
  const [products, setProducts] = useState<RdProductDef[]>([]);
  const [mainTree, setMainTree] = useState<RdCategory[]>([]);
  const [targetProductId, setTargetProductId] = useState<string>(RD_MAIN_PRODUCT_ID);
  const [treeCache, setTreeCache] = useState<Record<string, RdCategory[]>>({});
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);

  // 初始化：产品列表 + 主产品分类树
  useEffect(() => {
    let cancelled = false;
    setLoadingBase(true);
    Promise.all([fetchRdProducts(), fetchRdTaskCategories()])
      .then(([prods, mainCats]) => {
        if (cancelled) return;
        setProducts(prods);
        setMainTree(mainCats);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("移动目标加载失败，请重试"));
      })
      .finally(() => {
        if (!cancelled) setLoadingBase(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 切到非主产品时按需加载其分类树（缓存）
  useEffect(() => {
    if (targetProductId === RD_MAIN_PRODUCT_ID) return;
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProductId]);

  const targetCategories =
    targetProductId === RD_MAIN_PRODUCT_ID ? mainTree : treeCache[targetProductId] ?? [];

  return { products, targetProductId, setTargetProductId, targetCategories, loadingBase, loadingTree };
}

/** 移动归类弹窗：支持单个 / 批量。目标按 产品→一级系统→子项 三段选择，跨产品可选。 */
function WorkspaceMoveDialog({
  tasks,
  onConfirm,
  onClose,
}: {
  tasks: WorkspaceTask[];
  onConfirm: (
    taskIds: string[],
    targetProductId: string,
    targetCatId: string,
    targetSubId: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const { products, targetProductId, setTargetProductId, targetCategories, loadingBase, loadingTree } =
    useWorkspaceMoveTargetTree();
  const [targetCatId, setTargetCatId] = useState<string>("");
  const [targetSubId, setTargetSubId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const isCrossProduct = targetProductId !== RD_MAIN_PRODUCT_ID;
  const isBatch = tasks.length > 1;

  const allTargetOptions = useMemo(() => {
    const opts: { cat: RdCategory; sub: RdSubProject }[] = [];
    for (const cat of targetCategories) {
      for (const sub of cat.children) opts.push({ cat, sub });
    }
    return opts;
  }, [targetCategories]);

  // 切换产品时清空系统/子项；切换系统时清空子项
  useEffect(() => {
    setTargetCatId("");
    setTargetSubId("");
  }, [targetProductId]);
  useEffect(() => {
    setTargetSubId("");
  }, [targetCatId]);

  const targetSubOptions = useMemo(
    () => (targetCatId ? allTargetOptions.filter((o) => o.cat.id === targetCatId) : allTargetOptions),
    [allTargetOptions, targetCatId],
  );

  const handleConfirm = async () => {
    if (!targetSubId) {
      toast.error(t("请选择目标子项"));
      return;
    }
    const chosen = allTargetOptions.find((o) => o.sub.id === targetSubId);
    if (!chosen) {
      toast.error(t("目标子项无效，请重新选择"));
      return;
    }
    setSaving(true);
    try {
      await onConfirm(tasks.map((t) => t.task_id), targetProductId, chosen.cat.id, targetSubId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <FolderInput className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{t("移动任务归类")}</h3>
              <p className="max-w-[260px] truncate text-xs text-slate-500">
                {isBatch ? t("已选 {n} 个任务", { n: tasks.length }) : tasks[0]?.title}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {!isBatch && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("当前位置：")}<span className="font-medium text-slate-700">{tasks[0]?.category_path || t("未分类")}</span>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">{t("目标位置")}</label>
            <div className="mb-2">
              <label className="mb-1 block text-xs text-slate-500">{t("产品")}</label>
              <NativeSelect
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                className="w-full text-sm"
                disabled={loadingBase}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === RD_MAIN_PRODUCT_ID ? t("（主产品）") : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">{t("一级系统")}</label>
                <NativeSelect
                  value={targetCatId}
                  onChange={(e) => setTargetCatId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingBase || loadingTree}
                >
                  <option value="">{t("全部系统")}</option>
                  {targetCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">{t("子项")}</label>
                <NativeSelect
                  value={targetSubId}
                  onChange={(e) => setTargetSubId(e.target.value)}
                  className="w-full text-sm"
                  disabled={loadingBase || loadingTree}
                >
                  <option value="">{loadingTree ? t("加载中…") : t("请选择子项")}</option>
                  {targetSubOptions.map(({ cat, sub }) => (
                    <option key={sub.id} value={sub.id}>
                      {cat.label} / {sub.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {isCrossProduct && (
              <p className="mt-2 text-xs text-amber-600">{t("跨产品移动：任务将移出当前产品，归入所选产品。")}</p>
            )}
          </div>
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
            disabled={saving || loadingBase || loadingTree || !targetSubId}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移动")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function WorkspaceTaskCard({
  task,
  onOpen,
  moveEnabled = false,
  selected = false,
  onToggleSelect,
  onMove,
  unreadCount = 0,
}: {
  task: WorkspaceTask;
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean }) => void;
  /** 子系统全景视图下、且为自己主责的任务才允许移动/勾选。 */
  moveEnabled?: boolean;
  selected?: boolean;
  onToggleSelect?: (task: WorkspaceTask) => void;
  onMove?: (task: WorkspaceTask) => void;
  /** 未读评论数（微信式红点，>0 才显示） */
  unreadCount?: number;
}) {
  const grad = WS_PRIORITY_GRAD[task.priority] ?? WS_PRIORITY_GRAD.medium!;
  const sCfg = WS_STATUS_CONFIG[task.status] ?? WS_STATUS_CONFIG.draft!;
  const pCfg = WS_PRIORITY_CONFIG[task.priority] ?? WS_PRIORITY_CONFIG.medium!;
  const days = workspaceDaysUntil(task.due_date);
  const isOverdue = isTaskOverdue(task);
  // 待审核任务默认置灰且不可点击：等待管理员审核期间不允许成员进入操作详情。
  const isPendingReview = task.status === "pending_review";
  // 列表卡片直接发起「申请放弃」：仅主责人 + 活跃状态可见（与详情抽屉内 canAbandon 口径一致）。
  const canAbandon =
    task.role === "primary" &&
    ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={isPendingReview ? undefined : () => onOpen(task, "detail")}
      role={isPendingReview ? undefined : "button"}
      tabIndex={isPendingReview ? undefined : 0}
      aria-disabled={isPendingReview || undefined}
      title={isPendingReview ? t("待审核任务，管理员审核通过后方可操作") : undefined}
      onKeyDown={isPendingReview ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(task, "detail"); } }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-all duration-200 focus-visible:outline-none",
        isPendingReview
          ? "cursor-not-allowed select-text bg-slate-50 opacity-60 grayscale"
          : "cursor-pointer hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] focus-visible:ring-2 focus-visible:ring-slate-300",
        selected && "ring-2 ring-indigo-400/70",
      )}
    >
      {/* Left gradient stripe */}
      <div
        className="absolute left-0 top-0 h-full w-1 rounded-l-2xl"
        style={{ background: `linear-gradient(to bottom, ${grad.from}, ${grad.to})` }}
      />

      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", sCfg.bg, sCfg.text)}>
              {t(sCfg.label)}
            </span>
            <span className={cn("inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", pCfg.bg, pCfg.text)}>
              {t(pCfg.label)}
            </span>
            <span className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              task.role === "primary" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
            )}>
              {task.role === "primary" ? t("主责") : `${t("协作")}${task.collab_role ? ` · ${task.collab_role}` : ""}`}
            </span>
            {task.ai_pending && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                <Sparkles className="h-2.5 w-2.5" />
                {t("AI待确认")}
              </span>
            )}
            {unreadCount > 0 && (
              <span
                className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-sm"
                title={t("有 {n} 条未读评论", { n: unreadCount })}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>

          {/* Title */}
          <div className="truncate text-[13px] font-semibold leading-snug text-slate-800 group-hover:text-slate-900">
            <AutoTranslatedText text={task.title} />
          </div>
          {task.latest_progress_summary?.text ? (
            <div className="line-clamp-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] leading-4 text-slate-600 ring-1 ring-slate-100">
              {t("最新进度：")}<AutoTranslatedText text={task.latest_progress_summary.text} />
            </div>
          ) : null}

          {/* Dates + category */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
            {task.due_date && (
              <span className={cn("flex items-center gap-0.5", isOverdue && "text-red-400 font-semibold")}>
                <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                {isOverdue ? t("逾期 {n} 天", { n: taskOverdueDays(task) }) : days === 0 ? t("今天到期") : `${t("止")} ${task.due_date}`}
              </span>
            )}
            {!isUsCollabWorkspace() && task.category_path && (
              <span className="truncate">{task.category_path}</span>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-0.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${task.progress}%`,
                  background: task.progress === 100 ? "#10b981" : `linear-gradient(90deg, ${grad.from}, ${grad.to})`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-500">
              {task.progress}%
            </span>
          </div>
        </div>

        {!isPendingReview && (
          <div className="flex shrink-0 items-center gap-1">
            {moveEnabled && onMove && (
              <button
                type="button"
                title={t("移动到其它系统 / 子项")}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(task);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-lg border border-transparent px-2 py-1 text-[11px] font-medium text-indigo-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <FolderInput className="h-3 w-3" />
                {t("移动")}
              </button>
            )}
            {canAbandon && (
              <button
                type="button"
                title={t("申请放弃此任务（需管理员审核）")}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(task, "detail", { abandon: true });
                }}
                className="cursor-pointer rounded-lg border border-transparent px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                {t("申请放弃")}
              </button>
            )}
            {moveEnabled && onToggleSelect ? (
              <button
                type="button"
                title={selected ? t("取消选择") : t("勾选以批量移动")}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(task);
                }}
                className={cn(
                  "ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  selected
                    ? "border-indigo-500 bg-indigo-500 text-white"
                    : "border-slate-300 bg-white text-transparent hover:border-indigo-300",
                )}
              >
                <Check className="h-3 w-3" />
              </button>
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-300 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** 子系统全景：把"我的任务"按 category_path 的一级系统归类，区分进行中/已完成。 */
type SubsystemGroup = {
  key: string;
  active: WorkspaceTask[];
  done: WorkspaceTask[];
  total: number;
  avgProgress: number;
};

/** 从 category_path（形如「一级系统 / 子项 / 任务类型」）中取出一级系统名；空值兜底为「未分类」。 */
function subsystemOf(task: WorkspaceTask): string {
  const head = (task.category_path ?? "").split(" / ")[0]?.trim();
  return head && head.length > 0 ? head : "未分类";
}

/** 全景视图的移动归类能力（仅对自己主责的任务开放）。传入即开启「移动 / 批量勾选」。 */
type PanoramaMoveProps = {
  selectedIds: Set<string>;
  onToggleSelect: (task: WorkspaceTask) => void;
  onMoveTask: (task: WorkspaceTask) => void;
};

function SubsystemGroupBlock({
  group,
  onOpen,
  move,
  unreadByTask,
}: {
  group: SubsystemGroup;
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean }) => void;
  move?: PanoramaMoveProps;
  unreadByTask?: Record<string, number>;
}) {
  // 没有进行中任务时（整组都已完成），默认展开已完成，避免分组看起来空白。
  const [doneOpen, setDoneOpen] = useState(group.active.length === 0);
  return (
    <section className="rounded-2xl border border-slate-100 bg-white/70 p-3 shadow-[0_1px_4px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers className="h-4 w-4 shrink-0 text-indigo-500" />
          <h3 className="truncate text-sm font-semibold text-slate-800" title={group.key}>{group.key}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{t("进行中")} {group.active.length}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("已完成")} {group.done.length}</span>
        </div>
      </div>

      <div className="mb-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600 transition-all duration-500"
            style={{ width: `${group.avgProgress}%` }}
          />
        </div>
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{group.avgProgress}%</span>
      </div>

      {group.active.length > 0 && (
        <div className="space-y-2">
          {group.active.map((task) => (
            <WorkspaceTaskCard
              key={task.task_id}
              task={task}
              onOpen={onOpen}
              moveEnabled={Boolean(move) && task.role === "primary"}
              selected={move?.selectedIds.has(task.task_id) ?? false}
              onToggleSelect={move?.onToggleSelect}
              onMove={move?.onMoveTask}
            unreadCount={unreadByTask?.[task.task_id] ?? 0}
            />
          ))}
        </div>
      )}

      {group.done.length > 0 && (
        <div className={group.active.length > 0 ? "mt-2" : ""}>
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", doneOpen ? "" : "-rotate-90")} />
            {t("已完成")} {group.done.length}
          </button>
          {doneOpen && (
            <div className="mt-1.5 space-y-2">
              {group.done.map((task) => (
                <WorkspaceTaskCard
                  key={task.task_id}
                  task={task}
                  onOpen={onOpen}
                  moveEnabled={Boolean(move) && task.role === "primary"}
                  selected={move?.selectedIds.has(task.task_id) ?? false}
                  onToggleSelect={move?.onToggleSelect}
                  onMove={move?.onMoveTask}
                unreadCount={unreadByTask?.[task.task_id] ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SubsystemPanorama({
  groups,
  onOpen,
  move,
  unreadByTask,
}: {
  groups: SubsystemGroup[];
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean }) => void;
  move?: PanoramaMoveProps;
  unreadByTask?: Record<string, number>;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <SubsystemGroupBlock key={group.key} group={group} onOpen={onOpen} move={move} unreadByTask={unreadByTask} />
      ))}
    </div>
  );
}

export function RDMyWorkspacePage() {
  useI18n(); // 订阅语言切换（页头/过滤条/任务卡/通知中心文案已 t() 化）
  const { user } = useAuth();
  const canProposeProject = usePermission(PERMISSIONS.RD_PROJECT_PROPOSE);
  const WORKSPACE_AUDIT_ACTOR = useAuditActor("研发成员");
  const canReview = user
    ? user.permissions.includes("*") || user.permissions.includes("rd-task:edit") || user.permissions.includes("rd-task:reassign")
    : false;
  const [workspace, setWorkspace] = useState<RdWorkspacePayload<WorkspaceTask, AiSuggestion, WorkspaceNotification>>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closedSuggestions, setClosedSuggestions] = useState<Set<string>>(new Set());
  const [regeneratedSuggestions, setRegeneratedSuggestions] = useState<Set<string>>(new Set());
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set());
  const [notifVisibleCount, setNotifVisibleCount] = useState(NOTIF_PAGE_SIZE);
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  // 绩效自评弹窗状态（从通知抽屉「去自评」打开）
  const [perfSelfReport, setPerfSelfReport] = useState<RdPerformanceReport | null>(null);
  const [perfSelfNotifId, setPerfSelfNotifId] = useState<string | null>(null);
  const [taskVisibleCount, setTaskVisibleCount] = useState(WORKSPACE_PAGE_SIZE);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const taskScrollRef = React.useRef<HTMLDivElement>(null);
  const taskSentinelRef = React.useRef<HTMLDivElement>(null);
  const filteredAllTasksLengthRef = React.useRef(0);

  const loadWorkspace = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchRdWorkspace();
      setWorkspace({ ...EMPTY_WORKSPACE, ...payload });
    } catch (error) {
      if (!options?.silent) setWorkspace(EMPTY_WORKSPACE);
      setLoadError(error instanceof Error ? error.message : "个人工作台接口加载失败");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const refreshSilently = () => {
      void loadWorkspace({ silent: true });
    };
    const interval = window.setInterval(refreshSilently, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSilently();
    };

    window.addEventListener("focus", refreshSilently);
    window.addEventListener("rd:messages-updated", refreshSilently);
    window.addEventListener("rd:review-submitted", refreshSilently);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshSilently);
      window.removeEventListener("rd:messages-updated", refreshSilently);
      window.removeEventListener("rd:review-submitted", refreshSilently);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadWorkspace]);

  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<Priority | "all">("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | "all">("all");
  const [taskDueFilter, setTaskDueFilter] = useState<WorkspaceDueFilter>("all");
  // 任务区视图：list = 现有平铺列表；panorama = 子系统全景（按一级系统归类，仅看自己的任务）。
  const [taskViewRaw, setTaskView] = useState<"list" | "panorama">("list");
  // 协同下全景无意义（任务无 category_path，全塌进「未分类」），切换器已隐藏。
  // 这里再把值钉死：光藏按钮挡不住状态残留——同一组件实例在研发/协同路由间复用时，
  // 之前选的 panorama 会带过来，导致协同用户看到一个只有「未分类」的空壳视图。
  const taskView = isUsCollabWorkspace() ? "list" : taskViewRaw;
  // 子系统全景的「移动归类」：勾选集合 + 移动弹窗目标任务（单个 / 批量共用同一弹窗）。
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [moveDialogTasks, setMoveDialogTasks] = useState<WorkspaceTask[] | null>(null);
  const myTasks = useMemo(() => applyProgressOverrides(workspace.myTasks, progressOverrides), [workspace.myTasks, progressOverrides]);
  const collabTasks = useMemo(() => applyProgressOverrides(workspace.collabTasks, progressOverrides), [workspace.collabTasks, progressOverrides]);
  const allTasks = useMemo(() => [...myTasks, ...collabTasks], [myTasks, collabTasks]);
  const normalizedTaskKeyword = taskKeyword.trim().toLowerCase();
  const taskFiltersActive = Boolean(normalizedTaskKeyword) || taskPriorityFilter !== "all" || taskStatusFilter !== "all" || taskDueFilter !== "all";
  const filteredMyTasks = useMemo(
    () => myTasks.filter((task) => workspaceTaskMatches(task, normalizedTaskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter)),
    [myTasks, normalizedTaskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter],
  );
  const filteredCollabTasks = useMemo(
    () => collabTasks.filter((task) => workspaceTaskMatches(task, normalizedTaskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter)),
    [collabTasks, normalizedTaskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter],
  );
  const visibleSuggestions = useMemo(
    () => workspace.aiSuggestions.filter((suggestion) => !closedSuggestions.has(suggestion.id)),
    [closedSuggestions, workspace.aiSuggestions],
  );
  const visibleNotifications = useMemo(
    () => workspace.notifications.filter((notification) => !dismissedNotifs.has(notification.id)),
    [dismissedNotifs, workspace.notifications],
  );
  const shownNotifications = visibleNotifications.slice(0, notifVisibleCount);
  const hasMoreNotifs = visibleNotifications.length > notifVisibleCount;

  const markNotificationRead = React.useCallback((notification: WorkspaceNotification) => {
    setWorkspace((prev) => ({
      ...prev,
      notifications: prev.notifications.map((item) => (item.id === notification.id ? { ...item, read: true } : item)),
    }));
    if (notification.id.startsWith("msg-")) {
      void patchRdMessage(notification.id, { read: true })
        .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
        .catch(() => {});
    }
  }, []);

  // Reset notification page when the list changes (e.g. on workspace reload)
  useEffect(() => {
    setNotifVisibleCount(NOTIF_PAGE_SIZE);
  }, [workspace.notifications]);

  // 已完成任务进入列表后，头部统计仍维持原「活跃任务」口径：完成的不计入主责/协作/完成率/到期。
  const activeAllTasks = useMemo(() => allTasks.filter((task) => task.status !== "completed"), [allTasks]);
  const completedCount = allTasks.length - activeAllTasks.length;
  const activeMyCount = useMemo(
    () => myTasks.reduce((count, task) => count + (task.status === "completed" ? 0 : 1), 0),
    [myTasks],
  );
  const activeCollabCount = activeAllTasks.length - activeMyCount;
  const averageProgress = useMemo(() => {
    if (activeAllTasks.length === 0) return 0;
    return Math.round(activeAllTasks.reduce((sum, task) => sum + task.progress, 0) / activeAllTasks.length);
  }, [activeAllTasks]);
  const dueStats = useMemo(
    () =>
      activeAllTasks.reduce(
        (stats, task) => {
          const days = workspaceDaysUntil(task.due_date);
          if (isTaskOverdue(task)) stats.overdue += 1;
          if (days === 0) stats.today += 1;
          return stats;
        },
        { overdue: 0, today: 0 },
      ),
    [activeAllTasks],
  );
  const overdueCount = dueStats.overdue;
  const dueTodayCount = dueStats.today;

  // Combined + filtered tasks in one list（按立项时间正序；待审核沉底、已完成最底）
  const filteredAllTasks = useMemo(
    () => [...filteredMyTasks, ...filteredCollabTasks].sort(compareWorkspaceTasks),
    [filteredMyTasks, filteredCollabTasks],
  );
  // 子系统全景分组：基于已筛选的「我的任务」（主责+协作），按一级系统归类，已完成与进行中分桶。
  const subsystemGroups = useMemo<SubsystemGroup[]>(() => {
    const map = new Map<string, { active: WorkspaceTask[]; done: WorkspaceTask[]; progressSum: number; count: number }>();
    for (const task of filteredAllTasks) {
      const key = subsystemOf(task);
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { active: [], done: [], progressSum: 0, count: 0 };
        map.set(key, bucket);
      }
      if (task.status === "completed") bucket.done.push(task);
      else bucket.active.push(task);
      bucket.progressSum += task.progress;
      bucket.count += 1;
    }
    const groups = Array.from(map.entries()).map<SubsystemGroup>(([key, bucket]) => ({
      key,
      active: bucket.active,
      done: bucket.done,
      total: bucket.count,
      avgProgress: bucket.count > 0 ? Math.round(bucket.progressSum / bucket.count) : 0,
    }));
    groups.sort((a, b) => {
      // 「未分类」恒排最后
      const au = a.key === "未分类" ? 1 : 0;
      const bu = b.key === "未分类" ? 1 : 0;
      if (au !== bu) return au - bu;
      // 进行中多的子系统排前面，其次按总数，最后按名称
      if (b.active.length !== a.active.length) return b.active.length - a.active.length;
      if (b.total !== a.total) return b.total - a.total;
      return a.key.localeCompare(b.key, "zh-Hans-CN");
    });
    return groups;
  }, [filteredAllTasks]);
  const shownTasks = filteredAllTasks.slice(0, taskVisibleCount);
  const hasMoreTasks = taskVisibleCount < filteredAllTasks.length;
  // Keep ref in sync so the IntersectionObserver callback always has the latest value
  filteredAllTasksLengthRef.current = filteredAllTasks.length;

  // Reset pagination when filters change
  const prevFiltersRef = React.useRef({ taskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter });
  useEffect(() => {
    prevFiltersRef.current = { taskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter };
    setTaskVisibleCount(WORKSPACE_PAGE_SIZE);
  }, [taskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter]);

  // Infinite scroll: load more tasks when sentinel enters the task scroll area.
  useEffect(() => {
    const el = taskSentinelRef.current;
    const root = taskScrollRef.current;
    if (!el || !root || !hasMoreTasks) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setTaskVisibleCount((prev) => {
            const total = filteredAllTasksLengthRef.current;
            return prev >= total ? prev : Math.min(prev + WORKSPACE_PAGE_SIZE, total);
          });
        }
      },
      { root, rootMargin: "180px 0px 240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredAllTasks.length, hasMoreTasks, loading]);

  const findTask = (taskId?: string) => allTasks.find((task) => task.task_id === taskId);

  // ── 评论未读红点（微信式）：任务级未读数，打开任务即标记已读（全端同步消失）──
  const [noteUnread, setNoteUnread] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    fetchRdNoteUnreadSummary()
      .then((summary) => { if (!cancelled) setNoteUnread(summary); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openTask = (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean }) => {
    setActivePanel({ kind: "task", task, tab, openedAt: Date.now(), abandon: opts?.abandon });
    // 点开即读：乐观清除本地红点 + 上报服务端位点（失败不打扰，下次拉取自然校正）
    if (noteUnread[task.task_id]) {
      setNoteUnread((prev) => {
        const next = { ...prev };
        delete next[task.task_id];
        return next;
      });
    }
    void markRdTaskNotesRead(task.task_id).catch(() => {});
  };

  // 离开全景视图时清空勾选，避免切回列表后残留选择态。
  useEffect(() => {
    if (taskView !== "panorama") setSelectedTaskIds(new Set());
  }, [taskView]);

  // 仅「自己主责 + 当前已筛选可见」的任务可参与批量移动（防止移动到不可见 / 协作任务）。
  const selectedTasks = useMemo(
    () => filteredAllTasks.filter((task) => task.role === "primary" && selectedTaskIds.has(task.task_id)),
    [filteredAllTasks, selectedTaskIds],
  );

  const toggleTaskSelected = React.useCallback((task: WorkspaceTask) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.task_id)) next.delete(task.task_id);
      else next.add(task.task_id);
      return next;
    });
  }, []);

  const openSingleMove = React.useCallback((task: WorkspaceTask) => {
    setMoveDialogTasks([task]);
  }, []);

  const openBatchMove = React.useCallback(() => {
    if (selectedTasks.length === 0) {
      toast.error(t("请先勾选要移动的任务"));
      return;
    }
    setMoveDialogTasks(selectedTasks);
  }, [selectedTasks]);

  const handleWorkspaceMoveConfirm = React.useCallback(
    async (taskIds: string[], targetProductId: string, targetCatId: string, targetSubId: string) => {
      try {
        const result = await moveRdTasks({ taskIds, targetProductId, targetCategoryId: targetCatId, targetSubId });
        const movedPath = `${result.targetCategoryLabel} / ${result.targetSubLabel}`;
        const firstTask = (moveDialogTasks ?? []).find((task) => task.task_id === taskIds[0]);
        // 审计：操作者 = 当前研发成员本人（自助归类的同时保留可追溯）。
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.updated",
          resource:
            taskIds.length === 1 && firstTask
              ? { type: "task", id: firstTask.task_id, name: firstTask.title }
              : { type: "system", id: targetSubId, name: "移动任务归类" },
          changes:
            taskIds.length === 1 && firstTask
              ? [{ field: "category_path", before: firstTask.category_path, after: movedPath }]
              : undefined,
          comment:
            taskIds.length === 1
              ? `个人工作台移动任务 → ${movedPath}`
              : `个人工作台批量移动 ${result.movedCount} 个任务 → ${movedPath}`,
          metadata: { taskIds, targetProductId, targetSubId },
          source: "web",
        });
        toast.success(`已移动 ${result.movedCount} 个任务到 ${movedPath}`);
        setMoveDialogTasks(null);
        setSelectedTaskIds(new Set());
        await loadWorkspace({ silent: true });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "移动失败，请重试");
      }
    },
    [WORKSPACE_AUDIT_ACTOR, loadWorkspace, moveDialogTasks],
  );

  // 从「绩效自评」通知打开自评弹窗：按通知携带的月份拉取本人当月绩效。
  const openWorkspaceSelfAssess = React.useCallback(
    async (notification: WorkspaceNotification) => {
      if (!user?.id) return;
      let month = "";
      try {
        const body = notification.raw_body ? (JSON.parse(notification.raw_body) as Record<string, unknown>) : null;
        month = body ? String(body.month ?? "") : "";
      } catch {
        month = "";
      }
      if (!month) {
        toast.error(t("通知缺少月份信息"));
        return;
      }
      try {
        const list = await fetchRdPerformanceReports({ user_id: user.id, month, limit: 1 });
        const r = list[0] ?? null;
        if (!r) {
          toast.error(t("未找到对应的绩效报表，可能已被重新生成"));
          return;
        }
        setPerfSelfNotifId(notification.id);
        setPerfSelfReport(r);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "读取绩效失败，请稍后重试");
      }
    },
    [user?.id],
  );

  const approveNotificationReview = React.useCallback((notification: WorkspaceNotification) => {
    if (!notification.raw_body) {
      toast.error(t("通知内容缺少审核任务信息"));
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(notification.raw_body) as Record<string, unknown>;
    } catch {
      toast.error(t("通知内容解析失败，无法审核"));
      return;
    }

    const taskId = String(body.task_id ?? "").trim();
    const taskTitle = String(body.task_title ?? "").trim() || notification.title;
    const reviewType = String(body.review_type ?? "result");
    const submitterName = String(body.submitter_name ?? "").trim();
    const pendingDueDate = String(body.pending_due_date ?? "").trim();
    const currentDueDate = String(body.current_due_date ?? "").trim();
    const reviewTypeLabel =
      reviewType === "collaboration"
        ? t("协作变更审核")
        : reviewType === "proposal"
        ? t("立项审核")
        : reviewType === "due_date"
        ? t("截止日期变更审核")
        : reviewType === "abandon"
        ? t("放弃任务审核")
        : t("成果审核");
    if (!taskId) {
      toast.error(t("通知内容缺少任务 ID，无法审核"));
      return;
    }

    setConfirmDialog({
      title: t("确认审核通过"),
      message: t("确认通过「{title}」的{reviewType}？", { title: taskTitle, reviewType: reviewTypeLabel }),
      confirmLabel: t("确认通过"),
      cancelLabel: t("再看看"),
      details: [
        t("任务编号：{taskId}", { taskId }),
        submitterName ? t("提交人：{name}", { name: submitterName }) : t("提交人：未识别"),
        ...(reviewType === "due_date" && pendingDueDate
          ? [t("截止日期：{current} → {next}", { current: currentDueDate || t("未设置"), next: pendingDueDate })]
          : []),
        reviewType === "collaboration"
          ? t("通过后协作人变更会立即生效，任务回到进行中。")
          : reviewType === "proposal"
          ? t("通过后任务将正式立项并进入进行中状态，同时通知发起人。")
          : reviewType === "due_date"
          ? t("通过后任务的截止日期将更新为申请值，并回到进行中状态。")
          : reviewType === "abandon"
          ? t("通过后该任务将被移除（等同删除），不可恢复，并通知申请人。")
          : t("通过后任务会进入审核通过状态，并通知对应申请人员。"),
      ],
      onConfirm: async () => {
        await updateRdTask(taskId, {
          _review_action: "approve",
          _reviewer_name: user?.name,
        } as Parameters<typeof updateRdTask>[1]);
        await patchRdMessage(notification.id, { handled: true, read: true });
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.review_approved",
          resource: { type: "task", id: taskId, name: taskTitle },
          comment: "批准任务审核",
          metadata: { notification_id: notification.id, reviewer: user?.name },
          source: "web",
        });
        toast.success(`已批准「${taskTitle}」`);
        setDismissedNotifs((prev) => new Set(prev).add(notification.id));
        window.dispatchEvent(new CustomEvent("rd:review-submitted"));
        setActivePanel(null);
        await loadWorkspace({ silent: true });
      },
    });
  }, [WORKSPACE_AUDIT_ACTOR, loadWorkspace, user?.name]);

  const closeSuggestion = (id: string) => {
    setClosedSuggestions((prev) => new Set(prev).add(id));
    setActivePanel(null);
  };

  return (
    <div className="flex h-full min-h-0 px-5 py-6 lg:px-7">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1680px] flex-col gap-4">
        {/* ── Compact header ── */}
        <header className="rounded-2xl border border-white bg-white/75 px-5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left group: title + date + stat chips */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-slate-950 shrink-0">
                {t(isUsCollabWorkspace() ? "协同工作台" : "个人工作台")}
              </h1>
              <span className="text-xs text-slate-400 shrink-0">{t("今日")} {TODAY_LABEL}</span>
              {/* Stat chips — always shown */}
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {t("主责")} {activeMyCount}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {t("协作")} {activeCollabCount}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                {t("完成率")} {averageProgress}%
              </span>
              {completedCount > 0 && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {t("已完成")} {completedCount}
                </span>
              )}
              {/* Conditional chips */}
              {overdueCount > 0 && (
                <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                  {t("逾期")} {overdueCount}
                </span>
              )}
              {dueTodayCount > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {t("今日到期")} {dueTodayCount}
                </span>
              )}
              {visibleNotifications.length + visibleSuggestions.length > 0 && (
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  {t("待处理")} {visibleNotifications.length + visibleSuggestions.length}
                </span>
              )}
              {/* Inline error */}
              {loadError && (
                <span className="inline-flex items-center rounded-md border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-700">
                  {loadError}
                </span>
              )}
            </div>
            {/* Right: AI 立项 button */}
            {canProposeProject && (
              <button
                type="button"
                onClick={() => setShowProposalDialog(true)}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,0.20)] transition-all hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-[0_12px_24px_rgba(79,70,229,0.26)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                title={t("AI 立项 · 上传文档或写描述，自动拆任务")}
              >
                <Sparkles className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
                {t("AI 立项")}
                <ChevronRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </header>

        {/* ── Body: 2-column grid ── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden 2xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.65fr)]">
          {/* ── LEFT column ── */}
          <main className="flex min-h-0 flex-col gap-3">
            {/* Sticky filter bar */}
            <div className="shrink-0 rounded-2xl border border-white bg-white/90 p-3 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                {/* Search — grows up to a sensible cap so the right-side filters always keep their room */}
                <label className="relative block min-w-0 flex-1 max-w-[360px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-8 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-50"
                    placeholder={t("搜索任务、负责人…")}
                    value={taskKeyword}
                    onChange={(event) => setTaskKeyword(event.target.value)}
                  />
                </label>

                {/* Selects + 清空 + count — always one row, never wrap */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 视图切换：列表 / 子系统全景（仅看自己的任务）。
                      协同下隐藏：全景按 category_path 的一级系统分组，而协同任务的
                      category_path 恒为空串（立项时刻意不写，见 RDProjectProposalDialog
                      的 resolveUsCollabTarget），所有任务会塌进同一个「未分类」组 ——
                      比列表严格更差。同一理由下「移动归类」在协同也已关闭（见下方 move）。
                      驾驶舱走的是 hideSystemPanorama prop，这里没有 prop 可传，直接按工作区判。 */}
                  {!isUsCollabWorkspace() && (
                  <div className="flex items-center gap-0.5 rounded-[8px] border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setTaskView("list")}
                      className={cn(
                        "w-[4vw] flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs font-medium transition-colors",
                        taskView === "list" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                      title={t("平铺列表")}
                    >
                      <List className="h-3.5 w-3.5" />
                      {t("列表")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskView("panorama")}
                      className={cn(
                        "w-[4vw] flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs font-medium transition-colors",
                        taskView === "panorama" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                      title={t("按子系统归类查看（仅我的任务）")}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {t("全景")}
                    </button>
                  </div>
                  )}
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                    value={taskPriorityFilter}
                    onChange={(event) => setTaskPriorityFilter(event.target.value as Priority | "all")}
                  >
                    <option value="all">{t("优先级")}</option>
                    <option value="high">{t("高")}</option>
                    <option value="medium">{t("中")}</option>
                    <option value="low">{t("低")}</option>
                  </NativeSelect>
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                    value={taskStatusFilter}
                    onChange={(event) => setTaskStatusFilter(event.target.value as TaskStatus | "all")}
                  >
                    <option value="all">{t("状态")}</option>
                    <option value="in_progress">{t("进行中")}</option>
                    <option value="pending_review">{t("待评审")}</option>
                    <option value="paused_blocked">{t("阻塞")}</option>
                    <option value="paused_leave">{t("请假暂停")}</option>
                    <option value="completed">{t("已完成")}</option>
                  </NativeSelect>
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
                    value={taskDueFilter}
                    onChange={(event) => setTaskDueFilter(event.target.value as WorkspaceDueFilter)}
                  >
                    <option value="all">{t("时间")}</option>
                    <option value="overdue">{t("已逾期")}</option>
                    <option value="today">{t("今天到期")}</option>
                    <option value="3d">{t("3 天内")}</option>
                    <option value="7d">{t("7 天内")}</option>
                    <option value="no_due">{t("无截止日")}</option>
                  </NativeSelect>
                  {/*<button*/}
                  {/*  type="button"*/}
                  {/*  onClick={() => {*/}
                  {/*    setTaskKeyword("");*/}
                  {/*    setTaskPriorityFilter("all");*/}
                  {/*    setTaskStatusFilter("all");*/}
                  {/*    setTaskDueFilter("all");*/}
                  {/*  }}*/}
                  {/*  disabled={!taskFiltersActive}*/}
                  {/*  className="h-8 cursor-pointer rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"*/}
                  {/*>*/}
                  {/*  清空*/}
                  {/*</button>*/}
                  <span className="whitespace-nowrap pl-1 text-[11px] text-slate-400">
                    {loading ? t("加载中…") : `${filteredAllTasks.length} / ${allTasks.length}`}
                  </span>
                </div>
              </div>
            </div>

            <div ref={taskScrollRef} className="material-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
              {/* Task list */}
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-slate-100" />
                  ))}
                </div>
              ) : filteredAllTasks.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">
                    {taskFiltersActive ? t("没有匹配的任务") : t("当前没有分配给我的任务")}
                  </p>
                </div>
              ) : taskView === "panorama" ? (
                <SubsystemPanorama
                  groups={subsystemGroups}
                  onOpen={openTask}
                  unreadByTask={noteUnread}
                  // 协同池无分类概念：移动归类（勾选/单移/批量）整体不提供
                  move={isUsCollabWorkspace() ? undefined : { selectedIds: selectedTaskIds, onToggleSelect: toggleTaskSelected, onMoveTask: openSingleMove }}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {shownTasks.map((task) => (
                        <WorkspaceTaskCard key={task.task_id} task={task} onOpen={openTask} unreadCount={noteUnread[task.task_id] ?? 0} />
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Infinite scroll sentinel */}
                  <div ref={taskSentinelRef}>
                    {hasMoreTasks ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-400">
                        <ChevronDown className="h-3 w-3 animate-bounce" />
                        <span>{t("滚动加载更多 · 已显示")} <span className="tabular-nums">{shownTasks.length}</span> / {t("共")} <span className="tabular-nums">{filteredAllTasks.length}</span> {t("个")}</span>
                      </div>
                    ) : filteredAllTasks.length > WORKSPACE_PAGE_SIZE ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-400">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        <span>{t("已显示全部 {n} 个任务", { n: filteredAllTasks.length })}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </main>

          {/* ── RIGHT column ── */}
          <aside className="material-scrollbar min-h-0 space-y-4 overflow-y-auto pr-1">
            {/* 通知中心 */}
            <SectionCard title={t("通知中心")} icon={Bell} count={visibleNotifications.length}>
              {visibleNotifications.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">{t("暂无新通知")}</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {shownNotifications.map((notification) => {
                      const isMessage = notification.type === "message";
                      return (
                        <li key={notification.id}>
                          <div
                            className={cn(
                              "group flex w-full cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
                              isMessage
                                ? "border-blue-100 bg-blue-50/60"
                                : notification.type === "blocked" || notification.type === "due_soon"
                                  ? "border-amber-100 bg-amber-50"
                                  : "border-slate-100 bg-slate-50",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const openedNotification = { ...notification, read: true };
                                markNotificationRead(notification);
                                setActivePanel({ kind: "notification", notification: openedNotification });
                              }}
                              className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left focus-visible:outline-none"
                            >
                              {isMessage ? (
                                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                              ) : (
                                <AlertTriangle
                                  className={cn(
                                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                                    notification.type === "blocked" ? "text-red-500" : "text-amber-500",
                                  )}
                                />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-2">
                                  <AutoTranslatedText className="truncate text-xs font-semibold text-slate-800" text={notification.title} />
                                  {isMessage ? (
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                        notification.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600 ring-1 ring-red-100",
                                      )}
                                    >
                                      {notification.read ? t("已读") : t("未读")}
                                    </span>
                                  ) : null}
                                </span>
                                <AutoTranslatedText as="div" className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600" text={notification.message} />
                                <span className="mt-1 block text-[10px] text-slate-400">{relativeTimeLabel((notification as { created_at?: string }).created_at, notification.time)}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDialog({
                                  title: t("确认关闭通知"),
                                  message: t("将关闭「{title}」这条通知。", { title: notification.title }),
                                  confirmLabel: t("确认关闭"),
                                  details: [t("关闭后会从通知中心移除"), t("不会影响关联任务本身")],
                                  onConfirm: () => {
                                    recordAudit({
                                      actor: WORKSPACE_AUDIT_ACTOR,
                                      action: "notification.handled",
                                      resource: { type: "system", id: notification.id, name: notification.title },
                                      comment: "关闭通知中心提醒",
                                      metadata: { related_task_id: notification.related_task_id, notification_type: notification.type },
                                      source: "web",
                                    });
                                    // Persist handled state to backend so it survives page refresh
                                    if (notification.id.startsWith("msg-")) {
                                      void patchRdMessage(notification.id, { handled: true, read: true }).catch(() => {});
                                    }
                                    setDismissedNotifs((prev) => new Set(prev).add(notification.id));
                                  },
                                })
                              }
                              className="rounded p-1 text-slate-300 transition-colors hover:bg-white hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                              aria-label={t("关闭通知")}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Pagination */}
                  {hasMoreNotifs ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-400">
                      <ChevronDown className="h-3 w-3" />
                      <button
                        type="button"
                        onClick={() => setNotifVisibleCount((prev) => prev + NOTIF_PAGE_SIZE)}
                        className="font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-700"
                      >
                        {t("加载更多")}
</button>
                      <span>· {t("已显示 {shown} / 共 {total} 条", { shown: shownNotifications.length, total: visibleNotifications.length })}</span>
                    </div>
                  ) : visibleNotifications.length > NOTIF_PAGE_SIZE ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-400">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span>{t("已显示全部 {n} 条通知", { n: visibleNotifications.length })}</span>
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>

            {/* AI 建议 */}
            {visibleSuggestions.length > 0 && (
              <SectionCard title={t("待审核 AI 建议")} icon={Sparkles} count={visibleSuggestions.length} helper={t("确认后才写入任务池")}>
                <div className="space-y-3">
                  {visibleSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold text-slate-900">{suggestion.title}</h3>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-slate-500">{suggestion.preview}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-violet-700">
                          {regeneratedSuggestions.has(suggestion.id) ? suggestion.confidence + 6 : suggestion.confidence}%
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ActionButton
                          onClick={() => setActivePanel({ kind: "ai", suggestion, regenerated: regeneratedSuggestions.has(suggestion.id) })}
                          variant="primary"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {t("审核")}
                        </ActionButton>
                        <ActionButton
                          onClick={() => {
                            setRegeneratedSuggestions((prev) => new Set(prev).add(suggestion.id));
                            recordAudit({
                              actor: WORKSPACE_AUDIT_ACTOR,
                              action: "ai.regenerated",
                              resource: { type: "system", id: suggestion.id, name: suggestion.title },
                              comment: "重新生成 AI 建议",
                              metadata: { source: suggestion.source },
                              source: "web",
                            });
                            setActivePanel({ kind: "ai", suggestion, regenerated: true });
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t("重新生成")}
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            setConfirmDialog({
                              title: t("确认忽略 AI 建议"),
                              message: t("将忽略「{title}」，该建议不会写入任务池。", { title: suggestion.title }),
                              confirmLabel: t("确认忽略"),
                              tone: "danger",
                              details: [t("忽略后会从待审核列表移除"), t("如需恢复，需要重新生成建议")],
                              onConfirm: () => {
                                recordAudit({
                                  actor: WORKSPACE_AUDIT_ACTOR,
                                  action: "ai.suggestion_rejected",
                                  resource: { type: "system", id: suggestion.id, name: suggestion.title },
                                  comment: "忽略 AI 生成建议",
                                  metadata: { source: suggestion.source },
                                  source: "web",
                                });
                                closeSuggestion(suggestion.id);
                              },
                            })
                          }
                          variant="ghost"
                          className="ml-auto"
                        >
                          {t("忽略")}
                        </ActionButton>
                      </div>
                    </article>
                  ))}
                </div>
              </SectionCard>
            )}
          </aside>
        </div>
      </div>

      {activePanel?.kind === "task" && (
        <TaskOperationDrawer
          key={`panel-task-${activePanel.openedAt}`}
          task={activePanel.task}
          initialTab={activePanel.tab}
          autoAbandon={activePanel.abandon}
          onClose={() => setActivePanel(null)}
          onProgressSave={async (taskId, progress) => {
            await updateRdTask(taskId, { progress });
            setWorkspace((prev) => ({
              ...prev,
              myTasks: updateTaskProgressList(prev.myTasks, taskId, progress),
              collabTasks: updateTaskProgressList(prev.collabTasks, taskId, progress),
            }));
            setProgressOverrides((prev) => ({
              ...prev,
              [taskId]: progress,
            }));
            setActivePanel(null);
            await loadWorkspace({ silent: true });
          }}
          onLog={() => {}}
          onRequestConfirm={setConfirmDialog}
          onSubmittedForReview={async (taskId, options) => {
            setWorkspace((prev) => ({
              ...prev,
              myTasks: markTaskSubmittedForReviewList(prev.myTasks, taskId, options?.progress),
              collabTasks: markTaskSubmittedForReviewList(prev.collabTasks, taskId, options?.progress),
            }));
            setActivePanel(null);
            await loadWorkspace({ silent: true });
          }}
          onCollaborationChanged={async (taskId, collaborators, status) => {
            setWorkspace((prev) => ({
              ...prev,
              myTasks: updateTaskCollaboratorsList(prev.myTasks, taskId, collaborators, status),
              collabTasks: updateTaskCollaboratorsList(prev.collabTasks, taskId, collaborators, status),
            }));
            setActivePanel(null);
            await loadWorkspace({ silent: true });
          }}
        />
      )}

      {activePanel?.kind === "ai" && (
        <AISuggestionDrawer
          key={activePanel.suggestion.id}
          suggestion={activePanel.suggestion}
          regenerated={activePanel.regenerated}
          onClose={() => setActivePanel(null)}
          onRegenerate={() => {
            setRegeneratedSuggestions((prev) => new Set(prev).add(activePanel.suggestion.id));
            recordAudit({
              actor: WORKSPACE_AUDIT_ACTOR,
              action: "ai.regenerated",
              resource: { type: "system", id: activePanel.suggestion.id, name: activePanel.suggestion.title },
              comment: "重新生成 AI 建议",
              metadata: { source: activePanel.suggestion.source },
              source: "web",
            });
            setActivePanel({ kind: "ai", suggestion: activePanel.suggestion, regenerated: true });
          }}
          onConfirm={() =>
            setConfirmDialog({
              title: t("确认写入任务池"),
              message: t("将把「{title}」生成的内容写入任务池。", { title: activePanel.suggestion.title }),
              confirmLabel: t("确认写入"),
              details: [t("生成任务数：{n}", { n: activePanel.suggestion.generated_tasks.length }), t("来源：{source}", { source: activePanel.suggestion.source }), t("写入后会从待审核列表移除")],
              onConfirm: () => {
                recordAudit({
                  actor: WORKSPACE_AUDIT_ACTOR,
                  action: "ai.suggestion_accepted",
                  resource: { type: "system", id: activePanel.suggestion.id, name: activePanel.suggestion.title },
                  comment: "确认 AI 建议写入任务池",
                  metadata: {
                    source: activePanel.suggestion.source,
                    generated_tasks: activePanel.suggestion.generated_tasks.length,
                  },
                  source: "web",
                });
                activePanel.suggestion.generated_tasks.forEach((task, index) => {
                  recordAudit({
                    actor: WORKSPACE_AUDIT_ACTOR,
                    action: "task.created",
                    resource: { type: "task", id: `${activePanel.suggestion.id}-task-${index + 1}`, name: task.title },
                    changes: [
                      { field: "owner", before: undefined, after: task.owner },
                      { field: "priority", before: undefined, after: task.priority },
                      { field: "due_date", before: undefined, after: task.due },
                    ],
                    comment: "由 AI 建议确认后写入任务池",
                    metadata: { suggestion_id: activePanel.suggestion.id },
                    source: "web",
                  });
                });
                closeSuggestion(activePanel.suggestion.id);
              },
            })
          }
          onDismiss={() =>
            setConfirmDialog({
              title: t("确认忽略 AI 建议"),
              message: t("将忽略「{title}」，该建议不会写入任务池。", { title: activePanel.suggestion.title }),
              confirmLabel: t("确认忽略"),
              tone: "danger",
              details: [t("忽略后会从待审核列表移除"), t("如需恢复，需要重新生成建议")],
              onConfirm: () => {
                recordAudit({
                  actor: WORKSPACE_AUDIT_ACTOR,
                  action: "ai.suggestion_rejected",
                  resource: { type: "system", id: activePanel.suggestion.id, name: activePanel.suggestion.title },
                  comment: "忽略 AI 生成建议",
                  metadata: { source: activePanel.suggestion.source },
                  source: "web",
                });
                closeSuggestion(activePanel.suggestion.id);
              },
            })
          }
        />
      )}

      {activePanel?.kind === "notification" && (
        <NotificationDrawer
          key={activePanel.notification.id}
          notification={activePanel.notification}
          relatedTask={findTask(activePanel.notification.related_task_id)}
          onClose={() => setActivePanel(null)}
          onDismiss={() =>
            setConfirmDialog({
              title: t("确认标记已处理"),
              message: t("将把「{title}」标记为已处理。", { title: activePanel.notification.title }),
              confirmLabel: t("确认处理"),
              details: [t("通知会从通知中心移除"), t("会在操作记录中留下处理记录")],
              onConfirm: () => {
                recordAudit({
                  actor: WORKSPACE_AUDIT_ACTOR,
                  action: "notification.handled",
                  resource: { type: "system", id: activePanel.notification.id, name: activePanel.notification.title },
                  comment: "标记通知已处理",
                  metadata: {
                    related_task_id: activePanel.notification.related_task_id,
                    notification_type: activePanel.notification.type,
                  },
                  source: "web",
                });
                // Persist handled state so the message doesn't reappear after page refresh
                if (activePanel.notification.id.startsWith("msg-")) {
                  void patchRdMessage(activePanel.notification.id, { handled: true, read: true }).catch(() => {});
                }
                setDismissedNotifs((prev) => new Set(prev).add(activePanel.notification.id));
                setActivePanel(null);
              },
            })
          }
          onOpenTask={(task, tab) => setActivePanel({ kind: "task", task, tab, openedAt: Date.now() })}
          canReview={canReview}
          onSelfAssess={() => {
            const notif = activePanel!.kind === "notification" ? activePanel!.notification : null;
            if (notif) void openWorkspaceSelfAssess(notif);
          }}
          onApprove={() => {
            const notif = activePanel!.kind === "notification" ? activePanel!.notification : null;
            if (notif) approveNotificationReview(notif);
          }}
          onReject={async (reason) => {
            const notif = activePanel!.kind === "notification" ? activePanel!.notification : null;
            if (!notif?.raw_body) return;
            try {
              const body = JSON.parse(notif.raw_body) as Record<string, unknown>;
              const taskId = String(body.task_id ?? "");
              const taskTitle = String(body.task_title ?? "");
              await updateRdTask(taskId, {
                _review_action: "reject",
                _reviewer_name: user?.name,
                _reject_reason: reason,
              } as Parameters<typeof updateRdTask>[1]);
              await patchRdMessage(notif.id, { handled: true, read: true });
              recordAudit({
                actor: WORKSPACE_AUDIT_ACTOR,
                action: "task.review_rejected",
                resource: { type: "task", id: taskId, name: taskTitle },
                comment: `驳回任务审核：${reason}`,
                metadata: { notification_id: notif.id, reviewer: user?.name, reason },
                source: "web",
              });
              toast.success(t("已驳回「{title}」", { title: taskTitle }));
              setDismissedNotifs((prev) => new Set(prev).add(notif.id));
              window.dispatchEvent(new CustomEvent("rd:review-submitted"));
              setActivePanel(null);
              await loadWorkspace({ silent: true });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t("操作失败"));
            }
          }}
        />
      )}

      <AnimatePresence>
        {confirmDialog && (
          <ConfirmActionModal
            key="rd-workspace-confirm"
            config={confirmDialog}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
      </AnimatePresence>

      <RDProjectProposalDialog
        open={showProposalDialog && canProposeProject}
        onClose={() => setShowProposalDialog(false)}
        userRole="user"
        forceOwnerToCurrentUser
      />

      {/* 绩效自评弹窗（从通知抽屉打开） */}
      <RDPerformanceScoreDialog
        open={!!perfSelfReport}
        onClose={() => {
          setPerfSelfReport(null);
          setPerfSelfNotifId(null);
        }}
        report={perfSelfReport}
        mode="self"
        onSubmitted={() => {
          if (perfSelfNotifId) {
            const notifId = perfSelfNotifId;
            void patchRdMessage(notifId, { handled: true, read: true }).catch(() => {});
            setDismissedNotifs((prev) => new Set(prev).add(notifId));
            setActivePanel(null);
          }
        }}
      />

      {/* 批量移动浮条：仅子系统全景视图且已勾选任务时出现 */}
      <AnimatePresence>
        {taskView === "panorama" && selectedTasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-xl backdrop-blur"
          >
            <span className="text-xs font-semibold text-slate-600">
              {t("已选")} <span className="tabular-nums text-indigo-600">{selectedTasks.length}</span> {t("个任务")}
            </span>
            <button
              type="button"
              onClick={openBatchMove}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <FolderInput className="h-3.5 w-3.5" />
              {t("批量移动")}
            </button>
            <button
              type="button"
              onClick={() => setSelectedTaskIds(new Set())}
              className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
            >
              {t("取消选择")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 移动归类弹窗（单个 / 批量共用） */}
      <AnimatePresence>
        {moveDialogTasks && (
          <WorkspaceMoveDialog
            tasks={moveDialogTasks}
            onConfirm={handleWorkspaceMoveConfirm}
            onClose={() => setMoveDialogTasks(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
