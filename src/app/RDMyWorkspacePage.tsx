import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  FileText,
  GitBranch,
  Info,
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
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { AuditTimeline } from "./RDAuditTimeline";
import { ProgressNoteList } from "./RDProgressEvidence";
import { AuditActor, recordAudit, useAuditActor, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  assessRdTaskProgress,
  createRdTaskProgressNote,
  fetchRdPeople,
  fetchRdTaskProgressNotes,
  fetchRdWorkspace,
  patchRdMessage,
  updateRdTask,
  type RdAiProgressAssessment,
  type RdCollaborator,
  type RdPersonLoad,
  type RdPriority,
  type RdTaskProgressNote,
  type RdTaskStatus,
  type RdWorkspacePayload,
  type RdWorkspaceTask,
  type RdAiSuggestion,
  type RdWorkspaceNotification,
} from "./lib/rdApi";
import { toast } from "sonner";

type Priority = RdPriority;
type TaskStatus = RdTaskStatus;
type TaskRole = "primary" | "collaborator";
type OperationTab = "detail" | "progress" | "handoff" | "submit";
type WorkspaceTask = RdWorkspaceTask;
type AiSuggestion = RdAiSuggestion;
type WorkspaceNotification = RdWorkspaceNotification;

type ActivePanel =
  | { kind: "task"; task: WorkspaceTask; tab: OperationTab; openedAt: number }
  | { kind: "ai"; suggestion: AiSuggestion; regenerated?: boolean }
  | { kind: "notification"; notification: WorkspaceNotification };

type UploadedEvidence = {
  name: string;
  size: number;
  type: string;
};

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
const NOTE_ATTACHMENT_MAX_FILES = 5;
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
  if (due === "overdue" && (days === null || days >= 0)) return false;
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
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold", cfg.className)}>
      {cfg.label}
    </span>
  );
}

function StatusPill({ task }: { task: WorkspaceTask }) {
  const cfg = STATUS_CONFIG[task.status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", cfg.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {task.status_label}
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        variant === "primary" && "bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] hover:bg-blue-700",
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
      toast.error(error instanceof Error ? error.message : "操作失败，请重试");
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
              isDanger ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600",
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
            aria-label="关闭确认弹窗"
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
          <ActionButton onClick={onCancel}>{config.cancelLabel ?? "取消"}</ActionButton>
          <button
            type="button"
            onClick={confirm}
            disabled={confirming}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
              isDanger
                ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-200"
                : "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-200",
            )}
          >
            {confirming ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {confirming ? "处理中..." : config.confirmLabel}
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
                  AI 待确认
                </span>
              )}
            </div>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-900">{task.title}</h3>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{task.next_action}</p>
          </div>
          <PriorityBadge priority={task.priority} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            {task.role === "primary" ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
            {task.role === "primary" ? "我主责" : `协作 / ${task.collab_role}`}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {task.due_date}
          </span>
          <span className="min-w-0 truncate text-slate-400">{task.category_path}</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500">{task.progress}%</span>
        </div>
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
        <ActionButton onClick={() => onOpen(task, "detail")} variant="ghost">
          <Info className="h-3.5 w-3.5" />
          详情
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "progress")}>
          <RefreshCw className="h-3.5 w-3.5" />
          更新进度
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "handoff")}>
          <GitBranch className="h-3.5 w-3.5" />
          移交
        </ActionButton>
        <ActionButton onClick={() => onOpen(task, "submit")} variant="primary" className="ml-auto">
          <Send className="h-3.5 w-3.5" />
          提交结果
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
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
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
            aria-label="关闭"
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
}: {
  task: WorkspaceTask;
  initialTab: OperationTab;
  onClose: () => void;
  onProgressSave: (taskId: string, progress: number) => void | Promise<void>;
  onLog: (message: string) => void;
  onRequestConfirm: (config: ConfirmDialogConfig) => void;
  onSubmittedForReview: (taskId: string) => void | Promise<void>;
  onCollaborationChanged: (taskId: string, collaborators: RdCollaborator[], status?: TaskStatus) => void | Promise<void>;
}) {
  const WORKSPACE_AUDIT_ACTOR = useAuditActor("研发成员");
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const [tab, setTab] = useState<OperationTab>(initialTab);
  const [draftProgress, setDraftProgress] = useState(() => clampProgressValue(task.progress));
  const [note, setNote] = useState("");
  const [uploadedEvidence, setUploadedEvidence] = useState<UploadedEvidence[]>([]);
  const [aiAssessment, setAiAssessment] = useState<ProgressAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [noteAttachments, setNoteAttachments] = useState<File[]>([]);
  const [savingNote, setSavingNote] = useState(false);
  const [peopleOptions, setPeopleOptions] = useState<RdPersonLoad[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState(false);
  const [handoffReason, setHandoffReason] = useState(task.pending_collaboration_reason ?? "");
  const [selectedCollaboratorKeys, setSelectedCollaboratorKeys] = useState<Set<string>>(
    () => new Set((task.pending_review_type === "collaboration" ? task.pending_collaborators : task.collaborators ?? []).map(collaboratorOptionValue)),
  );
  const [receipt, setReceipt] = useState<string | null>(null);
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const canApplyCollaborationDirectly = canDirectProject || canReviewProjectL1 || canReviewProjectL2 || canReassignTask || canManagePeople;

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
    { key: "detail", label: "任务详情", icon: FileText },
    { key: "progress", label: "更新进度", icon: RefreshCw },
    { key: "handoff", label: "移交协作", icon: GitBranch },
    { key: "submit", label: "提交结果", icon: Send },
  ];

  const flowSteps =
    tab === "progress"
      ? [
          { label: "上传依据", helper: "上传方案、记录或数据", state: uploadedEvidence.length > 0 ? "done" as const : "current" as const },
          { label: "AI 判断", helper: "识别当前节点和建议进度", state: aiAssessment ? "done" as const : "todo" as const },
          { label: "人工确认", helper: "采用 AI 或手动重设", state: aiAssessment ? "current" as const : "todo" as const },
        ]
      : tab === "handoff"
      ? [
          { label: "选择协同人", helper: "可选择多个执行人", state: selectedCollaboratorKeys.size > 0 ? "done" as const : "current" as const },
          { label: "说明影响", helper: "补充协作范围和风险", state: handoffReason.trim() ? "done" as const : "todo" as const },
          { label: canApplyCollaborationDirectly ? "直接生效" : "提交审批", helper: canApplyCollaborationDirectly ? "主管权限直接写入任务" : "流转给主管审核", state: "todo" as const },
        ]
      : tab === "submit"
        ? [
            { label: "整理交付物", helper: "确认资料完整", state: "current" as const },
            { label: "风险自检", helper: "检查阻塞和遗漏", state: "todo" as const },
            { label: "提交审核", helper: "流转给上级", state: "todo" as const },
          ]
        : [
            { label: "填写进展", helper: "更新百分比和说明", state: tab === "progress" ? "current" as const : "done" as const },
            { label: "同步风险", helper: "确认阻塞项", state: "todo" as const },
            { label: "生成记录", helper: "沉淀操作日志", state: "todo" as const },
          ];

  const submitProgress = async () => {
    // Validation: attachments require text
    if (noteAttachments.length > 0 && !note.trim()) {
      toast.error("已选择附件，进展说明文本必填");
      return;
    }
    const oversized = noteAttachments.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      toast.error(`${oversized.name} 超过单文件 25MB 限制`);
      return;
    }
    const totalAttachmentSize = noteAttachments.reduce((sum, file) => sum + file.size, 0);
    if (totalAttachmentSize > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
      toast.error("附件总大小不能超过 50MB");
      return;
    }
    let assessmentForSave = aiAssessment;
    const progressToSave = clampProgressValue(draftProgress);
    if (note.trim()) {
      setAiLoading(true);
      setReceipt(null);
      try {
        const result: RdAiProgressAssessment = await assessRdTaskProgress({
          text: note.trim(),
          task: {
            task_id: task.task_id,
            title: task.title,
            description: task.description,
            category_path: task.category_path,
            current_progress: task.progress,
            current_status: task.status_label,
          },
        });
        assessmentForSave = {
          progress: result.progress,
          stage: result.stage,
          confidence: result.confidence,
          basis: result.basis,
          recommendation: result.recommendation,
        };
        setAiAssessment(assessmentForSave);
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "ai.parse_triggered",
          resource: { type: "task", id: task.task_id, name: task.title },
          comment: "AI 根据进展说明文本判断当前任务进度",
          metadata: {
            confidence: assessmentForSave.confidence,
            stage: assessmentForSave.stage,
            provider: result.provider,
            model: result.model,
            source: result.source,
            note_attachment_count: noteAttachments.length,
          },
          source: "ai",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI 进度判断失败";
        toast.error(`AI 解析失败：${message}`);
        return;
      } finally {
        setAiLoading(false);
      }
    }
    const source = assessmentForSave && assessmentForSave.progress === progressToSave ? "AI 判断" : "人工设置";
    const evidenceText = uploadedEvidence.length > 0 ? `，依据 ${uploadedEvidence.length} 个上传文件` : "";
    const message = `${task.task_id} 已通过${source}更新到 ${progressToSave}%${evidenceText}`;
    onRequestConfirm({
      title: "确认保存进度",
      message: `将把 ${task.task_id} 的进度更新为 ${progressToSave}%。`,
      confirmLabel: "确认保存",
      details: [
        `最终写入进度：${progressToSave}%（以本次确认值为准，不做累加）`,
        `进度来源：${source}`,
        uploadedEvidence.length > 0 ? `上传依据：${uploadedEvidence.length} 个文件` : "上传依据：无，按人工判断保存",
        assessmentForSave ? `AI 判断：${assessmentForSave.stage} / 置信度 ${assessmentForSave.confidence}%` : "AI 判断：未触发",
        note ? `已填写进展说明${noteAttachments.length > 0 ? `（含 ${noteAttachments.length} 个附件）` : ""}` : "未填写进展说明",
      ],
      onConfirm: async () => {
        setSavingNote(true);
        try {
          if (note.trim() || noteAttachments.length > 0) {
            await createRdTaskProgressNote({
              task_id: task.task_id,
              text: note.trim(),
              progress: progressToSave,
              files: noteAttachments,
            });
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
              evidence_count: uploadedEvidence.length,
              note_attachment_count: noteAttachments.length,
            },
            source: "web",
          });
          setReceipt(message);
          onLog(message);
          // 重置所有提交相关状态，避免重开对话框还看到旧附件 / 说明 / AI 判断残影
          setNoteAttachments([]);
          setUploadedEvidence([]);
          setAiAssessment(null);
          setNote("");
          setDraftProgress(progressToSave);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "进度记录保存失败";
          toast.error(msg);
        } finally {
          setSavingNote(false);
        }
      },
    });
  };

  const handleEvidenceUpload = async (files: FileList | null) => {
    const fileList = Array.from(files ?? []);
    if (fileList.length === 0) return;

    const evidenceMeta: UploadedEvidence[] = fileList.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "unknown",
    }));
    const merged = [...evidenceMeta, ...uploadedEvidence].slice(0, 5);
    setUploadedEvidence(merged);
    setReceipt(null);

    // Send the most recent file to AI for analysis. If user uploads multiple, we
    // analyze the first one (the dialog is single-task scoped anyway).
    const firstFile = fileList[0];
    setAiLoading(true);
    setAiAssessment(null);
    try {
      const result: RdAiProgressAssessment = await assessRdTaskProgress({
        file: firstFile,
        task: {
          task_id: task.task_id,
          title: task.title,
          description: task.description,
          category_path: task.category_path,
          current_progress: task.progress,
          current_status: task.status_label,
        },
      });
      const assessment: ProgressAssessment = {
        progress: result.progress,
        stage: result.stage,
        confidence: result.confidence,
        basis: result.basis,
        recommendation: result.recommendation,
      };
      setAiAssessment(assessment);
      setNote((current) => current || `AI 识别：${assessment.stage}。${assessment.recommendation}`);

      recordAudit({
        actor: WORKSPACE_AUDIT_ACTOR,
        action: "task.evidence_uploaded",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: "上传任务进度依据并触发 AI 判断",
        metadata: {
          evidence_count: fileList.length,
          filenames: fileList.map((file) => file.name),
          suggested_progress: assessment.progress,
          ai_provider: result.provider,
          ai_model: result.model,
          ai_source: result.source,
        },
        source: "web",
      });
      recordAudit({
        actor: WORKSPACE_AUDIT_ACTOR,
        action: "ai.parse_triggered",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: "AI 根据上传依据判断当前任务进度",
        metadata: {
          confidence: assessment.confidence,
          stage: assessment.stage,
          provider: result.provider,
          model: result.model,
        },
        source: "ai",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI 进度判断失败";
      toast.error(`AI 解析失败：${message}`);
      // Fallback to the local filename-based heuristic so the user still gets some feedback
      const fallback = buildProgressAssessment(task, merged);
      setAiAssessment(fallback);
      setNote((current) => current || `本地推断：${fallback.stage}。${fallback.recommendation}`);
    } finally {
      setAiLoading(false);
    }
  };

  const submitHandoff = () => {
    if (selectedCollaborators.length === 0) {
      toast.error("请选择至少一名协同人");
      return;
    }
    if (!canApplyCollaborationDirectly && !handoffReason.trim()) {
      toast.error("请填写协作原因和影响说明");
      return;
    }
    const collaboratorNames = selectedCollaborators.map((collaborator) => collaborator.name).join("、");
    onRequestConfirm({
      title: canApplyCollaborationDirectly ? "确认更新协同人" : "确认提交协作审批",
      message: canApplyCollaborationDirectly
        ? `将把 ${collaboratorNames} 设置为 ${task.task_id} 的协同执行人。`
        : `将把 ${task.task_id} 的协作变更提交给研发主管审核。`,
      confirmLabel: canApplyCollaborationDirectly ? "直接生效" : "提交审批",
      details: [
        `协同人：${collaboratorNames}`,
        canApplyCollaborationDirectly ? "当前角色可直接更新任务协同人" : "审批通过后才会写入任务协同人",
        handoffReason.trim() ? `说明：${handoffReason.trim()}` : "未填写补充说明",
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
      title: "确认提交审核",
      message: `将把 ${task.task_id} 提交给上级审核。`,
      confirmLabel: "确认提交",
      details: ["请确认交付物、风险说明和测试记录已补齐", "提交后会进入审核流转", "审核人会看到本次提交说明"],
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
          comment: "提交任务结果审核，进度自动置为 100%",
          metadata: { progress: 100 },
          source: "web",
        });
        toast.success(`${task.task_id} 已提交结果审核`);
        onLog(`${task.task_id} 已提交结果审核`);
        window.dispatchEvent(new CustomEvent('rd:review-submitted'));
        await onSubmittedForReview(task.task_id);
        onClose();
      },
    });
  };

  return (
    <DrawerShell
      title={task.title}
      subtitle={`${task.task_id} / ${task.category_path}`}
      icon={ClipboardCheck}
      onClose={onClose}
    >
      <div className="space-y-5">
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
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-[0_8px_18px_rgba(37,99,235,0.08)]"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <FlowSteps steps={flowSteps} />

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
                <div className="text-xs text-slate-400">状态</div>
                <div className="mt-1"><StatusPill task={task} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">优先级</div>
                <div className="mt-1"><PriorityBadge priority={task.priority} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">截止日期</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.due_date}</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">任务说明</div>
              <p className="text-sm leading-6 text-slate-600">{task.description}</p>
              <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{task.next_action}</div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">交付物</div>
                <ul className="space-y-2">
                  {task.deliverables.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">阻塞项</div>
                {task.blockers.length === 0 ? (
                  <p className="text-sm text-slate-400">暂无阻塞</p>
                ) : (
                  <ul className="space-y-2">
                    {task.blockers.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">任务时间线</div>
              <div className="space-y-0">
                {task.timeline.map((item, index) => (
                  <div key={item.label} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < task.timeline.length - 1 && (
                      <span className="absolute left-[7px] top-5 h-[calc(100%-16px)] w-px bg-slate-200" />
                    )}
                    <span
                      className={cn(
                        "relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-2 bg-white",
                        item.state === "done" && "border-emerald-400",
                        item.state === "current" && "border-blue-500 shadow-[0_0_0_4px_rgba(37,99,235,0.10)]",
                        item.state === "todo" && "border-slate-300",
                      )}
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-800">{item.label}</div>
                      <div className="text-xs text-slate-400">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">操作留痕</div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {taskLogs.length} 条
                </span>
              </div>
              <AuditTimeline logs={taskLogs} showResource={false} emptyText="暂无此任务的操作记录" />
            </div>
          </div>
        )}

        {tab === "progress" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/60 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    上传依据，AI 判断当前进度
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    支持方案、测试记录、实验数据、评审纪要等文件；AI 只给建议，最终进度由人工确认。
                  </p>
                </div>
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.18)] transition-colors",
                    aiLoading
                      ? "cursor-not-allowed bg-blue-400"
                      : "cursor-pointer bg-blue-600 hover:bg-blue-700",
                  )}
                >
                  {aiLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="h-3.5 w-3.5" />
                  )}
                  {aiLoading ? "AI 解析中…" : "上传文件"}
                  <Input
                    type="file"
                    multiple
                    className="sr-only"
                    disabled={aiLoading}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg"
                    onChange={(event) => {
                      handleEvidenceUpload(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>

              {uploadedEvidence.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {uploadedEvidence.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-blue-100">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-slate-400">{formatFileSize(file.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              {aiLoading && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-blue-700 ring-1 ring-blue-100">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  AI 正在阅读文件并判断当前任务阶段…
                </div>
              )}
            </div>

            {aiAssessment && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-emerald-900">{aiAssessment.stage}</div>
                    <p className="mt-1 text-xs text-emerald-700">
                      AI 建议进度 {aiAssessment.progress}% / 置信度 {aiAssessment.confidence}%
                    </p>
                  </div>
                  <ActionButton
                    variant="primary"
                    onClick={() => {
                      setDraftProgress(clampProgressValue(aiAssessment.progress));
                      setReceipt(null);
                      recordAudit({
                        actor: WORKSPACE_AUDIT_ACTOR,
                        action: "ai.suggestion_accepted",
                        resource: { type: "task", id: task.task_id, name: task.title },
                        changes: [{ field: "draft_progress", before: draftProgress, after: aiAssessment.progress }],
                        comment: "采纳 AI 进度建议",
                        metadata: { confidence: aiAssessment.confidence, stage: aiAssessment.stage },
                        source: "web",
                      });
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    采用 AI 进度
                  </ActionButton>
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
                <span className="font-semibold text-slate-900">人工确认进度</span>
                <span className="font-semibold tabular-nums text-blue-700">{draftProgress}%</span>
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
                className="w-full accent-blue-600"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>未开始</span>
                <span>方案</span>
                <span>验证</span>
                <span>待评审</span>
                <span>完成</span>
              </div>
            </div>
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">
                  进展说明
                  {noteAttachments.length > 0 && (
                    <span className="ml-1 text-xs font-normal text-rose-500">（已选附件，文本必填）</span>
                  )}
                </span>
                <span className="text-[10px] text-slate-400">仅文本会被 AI 分析；附件用于留档展示</span>
              </div>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                placeholder="说明本次进度变化、上传文件依据、产出内容、仍需支持的事项"
                className={cn(
                  "mt-2 w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-2",
                  noteAttachments.length > 0 && !note.trim()
                    ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                    : "border-slate-200 focus:border-blue-300 focus:ring-blue-100",
                )}
              />
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">附件（可选）</span>
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    savingNote
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "cursor-pointer border border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700",
                  )}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  添加文件/图片
                  <Input
                    type="file"
                    multiple
                    disabled={savingNote}
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.zip,.rar,.png,.jpg,.jpeg,.webp,.bmp"
                    onChange={(event) => {
                      const incoming = Array.from(event.target.files ?? []);
                      if (incoming.length === 0) return;
                      const oversized = incoming.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
                      if (oversized) {
                        toast.error(`${oversized.name} 超过单文件 25MB 限制`);
                        event.target.value = "";
                        return;
                      }
                      const merged = [...noteAttachments, ...incoming].slice(0, NOTE_ATTACHMENT_MAX_FILES);
                      const totalSize = merged.reduce((sum, file) => sum + file.size, 0);
                      if (totalSize > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
                        toast.error("附件总大小不能超过 50MB");
                        event.target.value = "";
                        return;
                      }
                      setNoteAttachments(merged);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {noteAttachments.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-400">最多 5 个，单文件 25MB 以内，总计不超过 50MB。</p>
              ) : (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {noteAttachments.map((file, idx) => (
                    <div
                      key={`${file.name}-${file.size}-${idx}`}
                      className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-slate-400">{formatFileSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => setNoteAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="移除附件"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose} disabled={savingNote}>取消</ActionButton>
              <ActionButton onClick={submitProgress} variant="primary" disabled={savingNote || aiLoading}>
                {savingNote || aiLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {aiLoading ? "AI 判断中…" : savingNote ? "保存中…" : "保存进度"}
              </ActionButton>
            </div>
          </div>
        )}

        {tab === "handoff" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">协同人</span>
                <span className="text-xs text-slate-400">已选 {selectedCollaboratorKeys.size} 人</span>
              </div>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                {peopleLoading ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-slate-400">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    正在读取研发人员
                  </div>
                ) : peopleError ? (
                  <div className="rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-600">研发人员加载失败，请稍后重试。</div>
                ) : collaboratorCandidates.length === 0 ? (
                  <div className="rounded-lg bg-white px-3 py-3 text-xs text-slate-400">暂无可选择的协同人。</div>
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
                            checked ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-blue-100 hover:bg-blue-50/50",
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
                            className="mt-0.5 rounded border-slate-300 text-blue-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{person.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-400">
                              {[person.position, person.department].filter(Boolean).join(" · ") || "研发成员"}
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
              <span className="text-sm font-semibold text-slate-900">协作原因和影响</span>
              <Textarea
                value={handoffReason}
                onChange={(event) => setHandoffReason(event.target.value)}
                rows={4}
                placeholder="说明为什么需要协同、当前进展、未解决风险和期望协同人下一步动作"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className={cn(
              "rounded-lg px-3 py-2 text-xs leading-5",
              canApplyCollaborationDirectly ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
            )}>
              {canApplyCollaborationDirectly
                ? "当前角色可直接更新协同人，保存后协同任务立即生效。"
                : "提交后会进入研发主管审核，通过后才会写入任务协同人。"}
            </div>
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose}>取消</ActionButton>
              <ActionButton onClick={submitHandoff} variant="primary" disabled={peopleLoading || selectedCollaborators.length === 0}>
                <GitBranch className="h-3.5 w-3.5" />
                {canApplyCollaborationDirectly ? "保存协同人" : "提交审批"}
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
                  <div className="text-sm font-semibold text-violet-700">审核申请已提交，等待处理</div>
                  <div className="mt-0.5 text-xs text-violet-500">如审核人未收到通知，可点击「重新发送通知」再次提醒。</div>
                </div>
                <ActionButton
                  onClick={submitResult}
                  className="shrink-0 text-violet-700 ring-violet-200 hover:bg-violet-100"
                >
                  <Send className="h-3.5 w-3.5" />
                  重新发送通知
                </ActionButton>
              </div>
            )}
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">提交前检查</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {["交付物已上传", "风险已说明", "测试记录已补齐", "关联人员已同步"].map((item) => (
                  <label key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                    <Checkbox className="rounded border-slate-300 text-blue-600" />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">提交说明</span>
              <Textarea
                rows={4}
                placeholder="补充本次提交的结论、已知风险和需要审核人关注的重点"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <ActionButton>
                <UploadCloud className="h-3.5 w-3.5" />
                上传附件
              </ActionButton>
              {task.status !== "pending_review" && (
                <ActionButton onClick={submitResult} variant="primary">
                  <Send className="h-3.5 w-3.5" />
                  提交审核
                </ActionButton>
              )}
            </div>
          </div>
        )}
      </div>
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
      subtitle={`来源：${suggestion.source}`}
      icon={Sparkles}
      onClose={onClose}
    >
      <div className="space-y-5">
        <FlowSteps
          steps={[
            { label: "解析来源", helper: "识别会议或记录中的动作", state: "done" },
            { label: "人工校验", helper: "确认任务、责任人和时间", state: "current" },
            { label: "写入任务池", helper: "确认后生成操作记录", state: "todo" },
          ]}
        />

        <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-violet-800">AI 建议摘要</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-violet-700">
              置信度 {regenerated ? Math.min(96, suggestion.confidence + 6) : suggestion.confidence}%
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-violet-700">
            {regenerated ? "已根据更保守的拆解原则重新生成，请重点确认责任人和截止日期。" : suggestion.preview}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">待生成内容</div>
          <div className="divide-y divide-slate-100">
            {suggestion.generated_tasks.map((task) => (
              <div key={task.title} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_90px_80px_54px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{task.title}</div>
                  <div className="mt-0.5 text-xs text-slate-400">建议责任人：{task.owner}</div>
                </div>
                <span className="text-xs text-slate-500">截止 {task.due}</span>
                <PriorityBadge priority={task.priority} />
                <ActionButton variant="ghost">调整</ActionButton>
              </div>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-slate-900">调整意见</span>
          <Textarea
            rows={3}
            placeholder="例如：拆得更细、责任人改为赵强、截止日期顺延到下周三"
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton onClick={onDismiss} variant="ghost">忽略</ActionButton>
          <ActionButton onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新生成
          </ActionButton>
          <ActionButton onClick={onConfirm} variant="primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            确认写入
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
}: {
  notification: WorkspaceNotification;
  relatedTask?: WorkspaceTask;
  onClose: () => void;
  onDismiss: () => void;
  onOpenTask: (task: WorkspaceTask, tab: OperationTab) => void;
  canReview?: boolean;
  onApprove?: () => void | Promise<void>;
  onReject?: (reason: string) => Promise<void>;
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

  // review_request fields
  const reviewType = isReviewRequest ? String(parsedBody!.review_type ?? "") : "";
  const reviewTaskId = isReviewRequest ? String(parsedBody!.task_id ?? "") : "";
  const reviewTaskTitle = isReviewRequest ? String(parsedBody!.task_title ?? "") : "";
  const reviewSubmitterName = isReviewRequest ? String(parsedBody!.submitter_name ?? "") : "";
  const reviewNote = isReviewRequest ? String(parsedBody!.note ?? "") : "";

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
      subtitle={`${notification.time} / 通知处理`}
      icon={Bell}
      onClose={onClose}
    >
      <div className="space-y-5">

        {/* ── Review request card ── */}
        {isReviewRequest && (
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {isHandled ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">已审核</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">待审核</span>
              )}
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                {reviewType === "result" ? "成果审核" : "协作变更审核"}
              </span>
            </div>
            <div>
              <div className="font-mono text-xs text-slate-400 mb-0.5">{reviewTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{reviewTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">提交人：<span className="font-medium text-slate-700">{reviewSubmitterName}</span></div>
            {reviewNote && (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                <span className="font-medium text-slate-500">备注：</span>{reviewNote}
              </div>
            )}
            {isHandled && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                审核已处理
              </div>
            )}
          </div>
        )}

        {/* ── 审核参考依据：进度时间线（仅审核类通知展示） ── */}
        {isReviewRequest && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Clock className="h-4 w-4 text-blue-500" />
                进度时间线
                <span className="text-xs font-normal text-slate-400">（审核参考依据）</span>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {progressNotesLoading ? "加载中" : `${progressNotes.length} 条`}
              </span>
            </div>
            <ProgressNoteList
              notes={progressNotes}
              loading={progressNotesLoading}
              emptyText="此任务暂无进度留痕记录"
              compact
            />
          </div>
        )}

        {/* ── Review result card ── */}
        {isReviewResult && (
          <div className={`rounded-xl border p-4 space-y-3 ${resultApproved ? "border-emerald-100 bg-emerald-50/60" : "border-red-100 bg-red-50/60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${resultApproved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {resultApproved ? "✓ 审核通过" : "✕ 被打回"}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">审核结果</span>
            </div>
            <div>
              <div className="font-mono text-xs text-slate-400 mb-0.5">{resultTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{resultTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">审核人：<span className="font-medium text-slate-700">{resultReviewerName}</span></div>
            {resultApproved ? (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-100">
                任务已通过审核，恭喜完成！
              </div>
            ) : (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
                <span className="font-medium">打回原因：</span>{resultReason || "请联系审核人了解详情"}
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
              <ActionButton onClick={() => onOpenTask(relatedTask, "detail")}>查看详情</ActionButton>
              <ActionButton onClick={() => onOpenTask(relatedTask, notification.type === "due_soon" ? "handoff" : "progress")}>
                推荐处理
                <ArrowRight className="h-3.5 w-3.5" />
              </ActionButton>
            </div>
          </div>
        )}

        {/* ── Sender info (non-review messages) ── */}
        {notification.type === "message" && !isReviewRequest && !isReviewResult && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-blue-700">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-semibold">{notification.sender_name ?? "未知发件人"}</span>
              {notification.sender_role && <span className="text-blue-500">· {notification.sender_role}</span>}
              <span className="ml-auto text-blue-400">{notification.time}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{notification.message}</p>
          </div>
        )}

        {/* ── System suggestion (non-message notifications) ── */}
        {notification.type !== "message" && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-blue-800">
              <ShieldCheck className="h-4 w-4" />
              系统建议
            </div>
            <p className="text-sm leading-6 text-blue-700">
              {notification.type === "due_soon" && "建议先确认是否需要顺延；如果仍由你处理，请更新下一步动作和风险说明。"}
              {notification.type === "blocked" && "建议补充协作反馈，并把上游阻塞同步给主责人和上级。"}
              {notification.type === "pending_ai" && "建议进入 AI 建议审核，确认后再写入任务池，避免自动生成不准确任务。"}
              {notification.type === "transfer" && "建议确认接收人和影响范围后再提交移交流程。"}
            </p>
          </div>
        )}

        {/* ── Inline reject dialog ── */}
        {rejectOpen && (
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-4 space-y-3">
            <div className="text-sm font-semibold text-red-700">填写驳回原因</div>
            <Textarea
              rows={3}
              placeholder="请说明驳回原因，申请人将收到通知…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="bg-white text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={() => { setRejectOpen(false); setRejectReason(""); }} disabled={isActing}>
                取消
              </ActionButton>
              <ActionButton variant="danger" onClick={doReject} disabled={!rejectReason.trim() || isActing}>
                {isActing ? "处理中…" : "确认驳回"}
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
                {isActing ? "处理中…" : "批准"}
              </ActionButton>
              <ActionButton variant="danger" onClick={() => setRejectOpen(true)} disabled={isActing}>
                驳回
              </ActionButton>
            </>
          )}
          <ActionButton onClick={onClose} className="ml-auto">稍后处理</ActionButton>
          {!isReviewRequest && !isReviewResult && (
            <ActionButton onClick={onDismiss} variant="primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              标记已处理
            </ActionButton>
          )}
          {isReviewResult && (
            <ActionButton onClick={onDismiss} variant="primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              知道了
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

function markTaskSubmittedForReviewList(tasks: WorkspaceTask[], taskId: string) {
  return tasks.map((task) =>
    task.task_id === taskId
      ? { ...task, status: "pending_review", status_label: "待审核", next_action: "等待上级审核", progress: 100 }
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

function buildProgressAssessment(_task: WorkspaceTask, evidence: UploadedEvidence[]): ProgressAssessment {
  const names = evidence.map((file) => file.name.toLowerCase()).join(" ");
  const hasReview = /评审|审核|review|submit|提交|final/.test(names);
  const hasTest = /测试|试验|实验|数据|记录|test|report|log/.test(names);
  const hasPlan = /方案|计划|说明|ecn|plan|spec|需求/.test(names);

  if (hasReview) {
    return {
      progress: 88,
      stage: "结果已形成，待审核关闭",
      confidence: evidence.length > 1 ? 92 : 88,
      basis: ["文件名包含评审/提交类线索", "可作为提交审核前的完成依据", "建议同步风险和交付物清单"],
      recommendation: "可采用 AI 进度，并进入“提交结果”流程完成审核。",
    };
  }

  if (hasTest) {
    return {
      progress: 68,
      stage: "验证数据已产出，处于测试收敛阶段",
      confidence: evidence.length > 1 ? 86 : 82,
      basis: ["文件名包含测试、实验、记录或数据线索", "说明任务已从方案阶段进入验证阶段", "仍需要补充结论或异常说明"],
      recommendation: "建议采用 AI 进度后补充进展说明，再视情况提交评审。",
    };
  }

  if (hasPlan) {
    return {
      progress: 52,
      stage: "方案资料已形成，待验证推进",
      confidence: evidence.length > 1 ? 82 : 78,
      basis: ["文件名包含方案、计划、ECN 或规格说明线索", "说明基础资料已经具备", "下一步应进入验证或跨部门确认"],
      recommendation: "建议将进度调整到方案完成节点，并说明下一步验证计划。",
    };
  }

  return {
    progress: 45,
    stage: "资料已上传，需人工补充判断",
    confidence: evidence.length > 1 ? 76 : 70,
    basis: ["文件已上传但名称未体现明确阶段", "AI 只能判断为已有阶段性输入", "需要人工补充进展说明降低误判"],
    recommendation: "建议先人工确认真实节点，再保存进度。",
  };
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

function WorkspaceTaskCard({
  task,
  onOpen,
}: {
  task: WorkspaceTask;
  onOpen: (task: WorkspaceTask, tab: OperationTab) => void;
}) {
  const grad = WS_PRIORITY_GRAD[task.priority] ?? WS_PRIORITY_GRAD.medium!;
  const sCfg = WS_STATUS_CONFIG[task.status] ?? WS_STATUS_CONFIG.draft!;
  const pCfg = WS_PRIORITY_CONFIG[task.priority] ?? WS_PRIORITY_CONFIG.medium!;
  const days = workspaceDaysUntil(task.due_date);
  const isOverdue = days !== null && days < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => onOpen(task, "detail")}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(task, "detail"); } }}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
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
              {sCfg.label}
            </span>
            <span className={cn("inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", pCfg.bg, pCfg.text)}>
              {pCfg.label}
            </span>
            <span className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              task.role === "primary" ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
            )}>
              {task.role === "primary" ? "主责" : `协作${task.collab_role ? ` · ${task.collab_role}` : ""}`}
            </span>
            {task.ai_pending && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                <Sparkles className="h-2.5 w-2.5" />
                AI待确认
              </span>
            )}
          </div>

          {/* Title */}
          <div className="truncate text-[13px] font-semibold leading-snug text-slate-800 group-hover:text-slate-900">
            {task.title}
          </div>
          {task.latest_progress_summary?.text ? (
            <div className="line-clamp-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] leading-4 text-slate-600 ring-1 ring-slate-100">
              最新进度：{task.latest_progress_summary.text}
            </div>
          ) : null}

          {/* Dates + category */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
            {task.due_date && (
              <span className={cn("flex items-center gap-0.5", isOverdue && "text-red-400 font-semibold")}>
                <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                {isOverdue ? `逾期 ${Math.abs(days!)} 天` : days === 0 ? "今天到期" : `止 ${task.due_date}`}
              </span>
            )}
            {task.category_path && (
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

        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
    </motion.div>
  );
}

export function RDMyWorkspacePage() {
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

  const averageProgress = useMemo(() => {
    if (allTasks.length === 0) return 0;
    return Math.round(allTasks.reduce((sum, task) => sum + task.progress, 0) / allTasks.length);
  }, [allTasks]);
  const dueStats = useMemo(
    () =>
      allTasks.reduce(
        (stats, task) => {
          const days = workspaceDaysUntil(task.due_date);
          if (days !== null && days < 0) stats.overdue += 1;
          if (days === 0) stats.today += 1;
          return stats;
        },
        { overdue: 0, today: 0 },
      ),
    [allTasks],
  );
  const overdueCount = dueStats.overdue;
  const dueTodayCount = dueStats.today;

  // Combined + filtered tasks in one list
  const filteredAllTasks = useMemo(
    () => [...filteredMyTasks, ...filteredCollabTasks],
    [filteredMyTasks, filteredCollabTasks],
  );
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
  const openTask = (task: WorkspaceTask, tab: OperationTab) => setActivePanel({ kind: "task", task, tab, openedAt: Date.now() });

  const approveNotificationReview = React.useCallback((notification: WorkspaceNotification) => {
    if (!notification.raw_body) {
      toast.error("通知内容缺少审核任务信息");
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(notification.raw_body) as Record<string, unknown>;
    } catch {
      toast.error("通知内容解析失败，无法审核");
      return;
    }

    const taskId = String(body.task_id ?? "").trim();
    const taskTitle = String(body.task_title ?? "").trim() || notification.title;
    const reviewType = String(body.review_type ?? "result");
    const submitterName = String(body.submitter_name ?? "").trim();
    const reviewTypeLabel = reviewType === "collaboration" ? "协作变更审核" : "成果审核";
    if (!taskId) {
      toast.error("通知内容缺少任务 ID，无法审核");
      return;
    }

    setConfirmDialog({
      title: "确认审核通过",
      message: `确认通过「${taskTitle}」的${reviewTypeLabel}？`,
      confirmLabel: "确认通过",
      cancelLabel: "再看看",
      details: [
        `任务编号：${taskId}`,
        submitterName ? `提交人：${submitterName}` : "提交人：未识别",
        reviewType === "collaboration"
          ? "通过后协作人变更会立即生效，任务回到进行中。"
          : "通过后任务会进入审核通过状态，并通知对应申请人员。",
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
              <h1 className="text-base font-semibold text-slate-950 shrink-0">个人工作台</h1>
              <span className="text-xs text-slate-400 shrink-0">今日 {TODAY_LABEL}</span>
              {/* Stat chips — always shown */}
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                主责 {myTasks.length}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                协作 {collabTasks.length}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                完成率 {averageProgress}%
              </span>
              {/* Conditional chips */}
              {overdueCount > 0 && (
                <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                  逾期 {overdueCount}
                </span>
              )}
              {dueTodayCount > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  今日到期 {dueTodayCount}
                </span>
              )}
              {visibleNotifications.length + visibleSuggestions.length > 0 && (
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  待处理 {visibleNotifications.length + visibleSuggestions.length}
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
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(99,102,241,0.25)] transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-violet-700 hover:shadow-[0_12px_24px_rgba(99,102,241,0.32)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                title="AI 立项 · 上传文档或写描述，自动拆任务"
              >
                <Sparkles className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
                AI 立项
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
              <div className="flex items-center gap-2">
                {/* Search — grows to fill spare space */}
                <label className="relative block min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="h-8 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-50"
                    placeholder="搜索任务、负责人…"
                    value={taskKeyword}
                    onChange={(event) => setTaskKeyword(event.target.value)}
                  />
                </label>

                {/* Selects + 清空 + count — always one row, never wrap */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                    value={taskPriorityFilter}
                    onChange={(event) => setTaskPriorityFilter(event.target.value as Priority | "all")}
                  >
                    <option value="all">优先级</option>
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </NativeSelect>
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                    value={taskStatusFilter}
                    onChange={(event) => setTaskStatusFilter(event.target.value as TaskStatus | "all")}
                  >
                    <option value="all">状态</option>
                    <option value="in_progress">进行中</option>
                    <option value="pending_review">待评审</option>
                    <option value="paused_blocked">阻塞</option>
                    <option value="paused_leave">请假暂停</option>
                    <option value="completed">已完成</option>
                  </NativeSelect>
                  <NativeSelect
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                    value={taskDueFilter}
                    onChange={(event) => setTaskDueFilter(event.target.value as WorkspaceDueFilter)}
                  >
                    <option value="all">时间</option>
                    <option value="overdue">已逾期</option>
                    <option value="today">今天到期</option>
                    <option value="3d">3 天内</option>
                    <option value="7d">7 天内</option>
                    <option value="no_due">无截止日</option>
                  </NativeSelect>
                  <button
                    type="button"
                    onClick={() => {
                      setTaskKeyword("");
                      setTaskPriorityFilter("all");
                      setTaskStatusFilter("all");
                      setTaskDueFilter("all");
                    }}
                    disabled={!taskFiltersActive}
                    className="h-8 cursor-pointer rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    清空
                  </button>
                  <span className="whitespace-nowrap pl-1 text-[11px] text-slate-400">
                    {loading ? "加载中…" : `${filteredAllTasks.length} / ${allTasks.length} 个`}
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
                    {taskFiltersActive ? "没有匹配的任务" : "当前没有分配给我的任务"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {shownTasks.map((task) => (
                        <WorkspaceTaskCard key={task.task_id} task={task} onOpen={openTask} />
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Infinite scroll sentinel */}
                  <div ref={taskSentinelRef}>
                    {hasMoreTasks ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-400">
                        <ChevronDown className="h-3 w-3 animate-bounce" />
                        <span>滚动加载更多 · 已显示 <span className="tabular-nums">{shownTasks.length}</span> / 共 <span className="tabular-nums">{filteredAllTasks.length}</span> 个</span>
                      </div>
                    ) : filteredAllTasks.length > WORKSPACE_PAGE_SIZE ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-400">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        <span>已显示全部 <span className="font-semibold tabular-nums text-slate-500">{filteredAllTasks.length}</span> 个任务</span>
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
            <SectionCard title="通知中心" icon={Bell} count={visibleNotifications.length}>
              {visibleNotifications.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">暂无新通知</p>
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
                                  <span className="truncate text-xs font-semibold text-slate-800">{notification.title}</span>
                                  {isMessage ? (
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                        notification.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600 ring-1 ring-red-100",
                                      )}
                                    >
                                      {notification.read ? "已读" : "未读"}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-600">{notification.message}</span>
                                <span className="mt-1 block text-[10px] text-slate-400">{notification.time}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDialog({
                                  title: "确认关闭通知",
                                  message: `将关闭「${notification.title}」这条通知。`,
                                  confirmLabel: "确认关闭",
                                  details: ["关闭后会从通知中心移除", "不会影响关联任务本身"],
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
                              aria-label="关闭通知"
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
                        加载更多
                      </button>
                      <span>· 已显示 {shownNotifications.length} / 共 {visibleNotifications.length} 条</span>
                    </div>
                  ) : visibleNotifications.length > NOTIF_PAGE_SIZE ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-400">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span>已显示全部 <span className="font-semibold tabular-nums text-slate-500">{visibleNotifications.length}</span> 条通知</span>
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>

            {/* AI 建议 */}
            {visibleSuggestions.length > 0 && (
              <SectionCard title="待审核 AI 建议" icon={Sparkles} count={visibleSuggestions.length} helper="确认后才写入任务池">
                <div className="space-y-3">
                  {visibleSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-blue-50 p-3">
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
                          审核
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
                          重新生成
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            setConfirmDialog({
                              title: "确认忽略 AI 建议",
                              message: `将忽略「${suggestion.title}」，该建议不会写入任务池。`,
                              confirmLabel: "确认忽略",
                              tone: "danger",
                              details: ["忽略后会从待审核列表移除", "如需恢复，需要重新生成建议"],
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
                          忽略
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
          onSubmittedForReview={async (taskId) => {
            setWorkspace((prev) => ({
              ...prev,
              myTasks: markTaskSubmittedForReviewList(prev.myTasks, taskId),
              collabTasks: markTaskSubmittedForReviewList(prev.collabTasks, taskId),
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
              title: "确认写入任务池",
              message: `将把「${activePanel.suggestion.title}」生成的内容写入任务池。`,
              confirmLabel: "确认写入",
              details: [`生成任务数：${activePanel.suggestion.generated_tasks.length}`, `来源：${activePanel.suggestion.source}`, "写入后会从待审核列表移除"],
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
              title: "确认忽略 AI 建议",
              message: `将忽略「${activePanel.suggestion.title}」，该建议不会写入任务池。`,
              confirmLabel: "确认忽略",
              tone: "danger",
              details: ["忽略后会从待审核列表移除", "如需恢复，需要重新生成建议"],
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
              title: "确认标记已处理",
              message: `将把「${activePanel.notification.title}」标记为已处理。`,
              confirmLabel: "确认处理",
              details: ["通知会从通知中心移除", "会在操作记录中留下处理记录"],
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
              toast.success(`已驳回「${taskTitle}」`);
              setDismissedNotifs((prev) => new Set(prev).add(notif.id));
              window.dispatchEvent(new CustomEvent("rd:review-submitted"));
              setActivePanel(null);
              await loadWorkspace({ silent: true });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "操作失败");
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
    </div>
  );
}
