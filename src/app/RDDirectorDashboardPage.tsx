import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LayoutGrid,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Calendar } from "./components/ui/calendar";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { AuditTimeline } from "./RDAuditTimeline";
import { recordAudit, useAuditActor, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  clearRdAllTaskData,
  createRdTask,
  deleteRdTask,
  fetchRdDailyReports,
  fetchRdDirectorDashboard,
  fetchRdPeople,
  fetchRdTaskCategories,
  fetchRdTaskProgressNotes,
  recomputeRdDirectorDashboard,
  regenerateAllRdDailyReports,
  saveRdTaskCategories,
  sendRdMessage,
  updateRdPerson,
  updateRdTask,
  type RdBlockedTask,
  type RdCategory,
  type RdCategoryProgress,
  type RdDailyReport,
  type RdDirectorDashboardPayload,
  type RdPendingAssignTask,
  type RdPersonLoad,
  type RdPriority,
  type RdSubProject,
  type RdTask,
  type RdTaskProgressNote,
  type RdTaskStatus,
} from "./lib/rdApi";
import { ProgressAttachmentGrid } from "./RDProgressEvidence";

const DIRECTOR_MOTION_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const DIRECTOR_FAST_TRANSITION = { duration: 0.18, ease: DIRECTOR_MOTION_EASE };
const DIRECTOR_PANEL_TRANSITION = { duration: 0.24, ease: DIRECTOR_MOTION_EASE };
const POC_BOM_CATEGORY_IDS = new Set([
  "cat-power",
  "cat-base",
  "cat-compression",
  "cat-valve-310",
  "cat-cooling",
  "cat-air-storage",
  "cat-valve-210",
  "cat-top",
  "cat-molecular-sieve",
  "cat-exterior",
  "cat-accessories",
  "cat-tube",
  "cat-harness",
  "cat-fastener",
  "cat-sealing",
]);

// ─── Types (aliased from rdApi shared types) ─────────────────────────────────

type CategoryProgress = RdCategoryProgress;
type PersonLoad = RdPersonLoad;
type BlockedTask = RdBlockedTask;
type PendingAssignTask = RdPendingAssignTask;
type TaskStatus = RdTaskStatus;
type Priority = RdPriority;
type ReassignableTask = {
  task_id: string;
  title: string;
  owner: string;
  reason?: string;
  days_blocked?: number;
};

// TaskDetail: derived from RdTask, augmented with blocked info for the detail drawer
type TaskDetail = {
  task_id: string;
  title: string;
  status: TaskStatus;
  owner: string;
  owner_user_id?: string | null;
  priority: Priority;
  progress: number;
  due_date?: string;
  category_path: string;
  description?: string;
  blocked_reason?: string;
  blocked_days?: number;
  attachments?: number;
  collaborators?: string[];
  recent_activities?: { date: string; action: string; actor?: string }[];
};

type DirectorDashboardPayload = RdDirectorDashboardPayload<
  CategoryProgress,
  PersonLoad,
  BlockedTask,
  PendingAssignTask
>;

const EMPTY_DIRECTOR_DASHBOARD: DirectorDashboardPayload = {
  categoryProgress: [],
  personLoads: [],
  blockedTasks: [],
  pendingAssign: [],
};

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function normalizeDirectorDashboard(payload: Partial<DirectorDashboardPayload> | null | undefined): DirectorDashboardPayload {
  return {
    categoryProgress: Array.isArray(payload?.categoryProgress) ? payload.categoryProgress : [],
    personLoads: Array.isArray(payload?.personLoads) ? payload.personLoads : [],
    blockedTasks: Array.isArray(payload?.blockedTasks) ? payload.blockedTasks : [],
    pendingAssign: Array.isArray(payload?.pendingAssign) ? payload.pendingAssign : [],
  };
}

// ─── Task detail helpers ──────────────────────────────────────────────────────

/** Convert an RdTask from the categories API into a TaskDetail for the drawer. */
function rdTaskToDetail(task: RdTask, blocked?: BlockedTask): TaskDetail {
  return {
    task_id: task.task_id,
    title: task.title,
    status: task.status,
    owner: task.primary_owner,
    owner_user_id: task.primary_owner_user_id ?? null,
    priority: task.final_priority,
    progress: task.progress,
    due_date: task.due_date,
    category_path: task.category_path,
    description: task.description,
    blocked_reason: blocked?.reason,
    blocked_days: blocked?.days_blocked,
    attachments: task.attachments,
    collaborators: task.collaborators.map((c) => c.name),
    recent_activities: [],
  };
}

function collectRdTasks(tasks: RdTask[]): RdTask[] {
  const output: RdTask[] = [];
  tasks.forEach((task) => {
    output.push(task);
    if (task.subtasks?.length) output.push(...collectRdTasks(task.subtasks));
  });
  return output;
}

function collectCategoryTasks(category: RdCategory | null | undefined): RdTask[] {
  if (!category) return [];
  return category.children.flatMap((child) => collectRdTasks(child.tasks));
}

function categoryTaskCount(category: RdCategory | null | undefined): number {
  return collectCategoryTasks(category).filter((task) => !task.archived).length;
}

function isPresetBomCategory(category: RdCategory | CategoryProgress | null | undefined): boolean {
  return Boolean(category && POC_BOM_CATEGORY_IDS.has(category.id));
}

function getCategoryColorClass(color?: string, fallback = "bg-slate-700"): string {
  const normalized = color?.trim();
  if (!normalized || normalized === "bg-white" || normalized === "bg-transparent") return fallback;
  return normalized;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "研发分类";
}

function rdPersonOptionValue(person: RdPersonLoad): string {
  return person.user_id ? `user:${person.user_id}` : `person:${person.id}`;
}

function findRdPersonByOptionValue(people: RdPersonLoad[], value: string): RdPersonLoad | undefined {
  return people.find((person) => rdPersonOptionValue(person) === value);
}

function downloadTextFile(filename: string, content: string, type: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

function parseLocalDate(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toReassignableTask(task: RdTask): ReassignableTask {
  return {
    task_id: task.task_id,
    title: task.title,
    owner: task.primary_owner,
    reason: task.category_path,
    days_blocked: task.status === "paused_blocked" ? 1 : 0,
  };
}

/** Synthesize a minimal TaskDetail for tasks not yet in the registry. */
function makePlaceholderDetail(idOrTitle: string, ownerHint?: string): TaskDetail {
  return {
    task_id: idOrTitle.startsWith("RD-") ? idOrTitle : `TMP-${idOrTitle.slice(0, 8)}`,
    title: idOrTitle.startsWith("RD-") ? `任务 ${idOrTitle}` : idOrTitle,
    status: "in_progress",
    owner: ownerHint ?? "—",
    priority: "medium",
    progress: 50,
    category_path: "—",
    description: "暂无详细描述。",
    attachments: 0,
    recent_activities: [],
  };
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

// Reusable mini pagination — used by blocked / pending / person lists
function MiniPagination({
  page,
  totalPages,
  onChange,
  className,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="上一页"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {Array.from({ length: totalPages }).map((_, i) => {
        const p = i + 1;
        const active = p === page;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "h-7 min-w-7 cursor-pointer rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-all duration-150 active:scale-90",
              active
                ? "bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.08)] ring-1 ring-blue-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
            )}
            aria-current={active ? "page" : undefined}
          >
            {p}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DashboardEmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function loadColor(count: number, max: number): string {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 1) return "bg-red-400";
  if (ratio >= 0.75) return "bg-orange-400";
  if (ratio >= 0.5) return "bg-amber-400";
  return "bg-emerald-400";
}

function loadBg(count: number, max: number): string {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 1) return "border-red-100 bg-red-50";
  if (ratio >= 0.75) return "border-orange-100 bg-orange-50";
  if (ratio >= 0.5) return "border-amber-100 bg-amber-50";
  return "border-emerald-100 bg-emerald-50";
}

const PRIORITY_CONFIG = {
  high: { label: "高", color: "bg-red-50 text-red-600 border-red-100" },
  medium: { label: "中", color: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  low: { label: "低", color: "bg-slate-50 text-slate-500 border-slate-100" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PersonCard({
  person,
  selected,
  onSelect,
}: {
  person: PersonLoad;
  selected: boolean;
  onSelect: (p: PersonLoad | null) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const ratio = person.max_tasks > 0 ? person.task_count / person.max_tasks : 0;
  return (
    <motion.div
      onClick={() => onSelect(selected ? null : person)}
      whileHover={shouldReduceMotion ? undefined : { y: -3, scale: 1.01 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className={cn(
        "cursor-pointer rounded-xl border p-3 transition-all hover:shadow-[0_14px_28px_rgba(15,23,42,0.08)]",
        selected ? "border-blue-300 bg-blue-50 shadow-[0_14px_32px_rgba(37,99,235,0.12)]" : loadBg(person.task_count, person.max_tasks),
        person.on_leave && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            {person.name}
            {person.on_leave && (
              <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">请假中</span>
            )}
          </div>
          <div className="text-xs text-slate-400">{person.position}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-xl font-bold", ratio >= 1 ? "text-red-600" : ratio >= 0.75 ? "text-orange-600" : "text-slate-700")}>
            {person.task_count}
          </div>
          <div className="text-[10px] text-slate-400">/ {person.max_tasks}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
        <div
          className={cn("h-full rounded-full transition-all", loadColor(person.task_count, person.max_tasks))}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </motion.div>
  );
}

// ─── Batch Reassign Modal ─────────────────────────────────────────────────────

// ─── Task Detail Drawer ──────────────────────────────────────────────────────

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string; dot: string }> = {
  draft:          { label: "草稿",     bg: "bg-slate-50",   text: "text-slate-500",   dot: "bg-slate-400" },
  in_progress:    { label: "进行中",   bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500" },
  pending_review: { label: "待审核",   bg: "bg-cyan-50",    text: "text-cyan-700",    dot: "bg-cyan-500" },
  paused_leave:   { label: "暂停/休假", bg: "bg-amber-50",  text: "text-amber-600",   dot: "bg-amber-400" },
  paused_blocked: { label: "阻塞",     bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-500" },
  on_hold:        { label: "暂停",     bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-500" },
  completed:      { label: "已完成",   bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  pending_assign: { label: "待指派",   bg: "bg-violet-50",  text: "text-violet-700",  dot: "bg-violet-500" },
  archived:       { label: "已归档",   bg: "bg-slate-50",   text: "text-slate-400",   dot: "bg-slate-300" },
};

const TASK_PRIORITY_CONFIG = {
  high: { label: "高", color: "bg-red-50 text-red-600 border-red-100" },
  medium: { label: "中", color: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  low: { label: "低", color: "bg-slate-50 text-slate-500 border-slate-100" },
};

function hashColor(name: string): string {
  const colors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function MiniAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", dim, hashColor(name))} title={name}>
      {initial}
    </span>
  );
}

function TaskDetailDrawer({
  task,
  onClose,
  onOpenPerson,
  onUpdate,
  onDelete,
}: {
  task: TaskDetail;
  onClose: () => void;
  onOpenPerson?: (name: string) => void;
  onUpdate?: () => void;
  onDelete?: () => void;
}) {
  const DIRECTOR_AUDIT_ACTOR = useAuditActor("研发主管");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: task.title,
    status: task.status,
    priority: task.priority,
    progress: task.progress,
    due_date: task.due_date ?? "",
    description: task.description ?? "",
    owner: task.owner,
  });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progressNotes, setProgressNotes] = useState<RdTaskProgressNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotesLoading(true);
    fetchRdTaskProgressNotes(task.task_id)
      .then((list) => { if (!cancelled) setProgressNotes(list); })
      .catch(() => { if (!cancelled) setProgressNotes([]); })
      .finally(() => { if (!cancelled) setNotesLoading(false); });
    return () => { cancelled = true; };
  }, [task.task_id]);

  const sCfg = TASK_STATUS_CONFIG[isEditing ? editForm.status : task.status];
  const pCfg = TASK_PRIORITY_CONFIG[isEditing ? editForm.priority : task.priority];
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const canEditTask = usePermission(PERMISSIONS.RD_TASK_EDIT);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);

  const handleSave = async () => {
    if (!canEditTask) return;
    setSaving(true);
    try {
      await updateRdTask(task.task_id, {
        title: editForm.title.trim() || task.title,
        status: editForm.status,
        final_priority: editForm.priority,
        progress: Math.max(0, Math.min(100, editForm.progress)),
        due_date: editForm.due_date || undefined,
        description: editForm.description || undefined,
        primary_owner: editForm.owner || task.owner,
      });
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action: "task.edited",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: "从研发主管驾驶舱编辑并保存任务",
        source: "web",
      });
      toast.success("任务已保存");
      setIsEditing(false);
      onUpdate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEditTask) return;
    setDeleting(true);
    try {
      await deleteRdTask(task.task_id);
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action: "task.edited",
        resource: { type: "task", id: task.task_id, name: task.title },
        comment: "从研发主管驾驶舱删除任务",
        source: "web",
      });
      toast.success("任务已删除");
      onDelete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
      setDeleting(false);
    }
  };

  const recordDirectorTaskAction = async (action: "task.handoff_requested" | "task.status_changed") => {
    if (action === "task.handoff_requested" && !canReassignTask) {
      toast.error("当前账号没有转派任务权限");
      return;
    }
    if (action !== "task.handoff_requested" && !canEditTask) {
      toast.error("当前账号没有编辑任务权限");
      return;
    }
    setSaving(true);
    try {
      if (action === "task.handoff_requested") {
        await updateRdTask(task.task_id, { primary_owner: "待指派", primary_owner_user_id: null, status: "pending_assign" });
      } else {
        await updateRdTask(task.task_id, { status: "completed", progress: 100 });
      }
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action,
        resource: { type: "task", id: task.task_id, name: task.title },
        changes:
          action === "task.status_changed"
            ? [
                { field: "status", before: task.status, after: "completed" },
                { field: "progress", before: task.progress, after: 100 },
              ]
            : [
                { field: "owner", before: task.owner, after: "待指派" },
                { field: "status", before: task.status, after: "pending_assign" },
              ],
        comment: action === "task.handoff_requested" ? "从研发主管驾驶舱发起任务转派" : "从研发主管驾驶舱标记任务完成",
        source: "web",
      });
      toast.success(action === "task.handoff_requested" ? "任务已转入待指派" : "任务已标记完成");
      onUpdate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300 sm:w-[min(620px,92vw)]"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-6 py-4 z-[100]">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", sCfg.bg, sCfg.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
                {sCfg.label}
              </span>
              <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-bold", pCfg.color)}>{pCfg.label}</span>
            </div>
            <h3 className="text-base font-semibold leading-snug text-slate-900">{task.title}</h3>
            <p className="mt-1 text-xs text-slate-400">{task.category_path}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canEditTask && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                aria-label="编辑任务"
                title="编辑任务"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {canEditTask && !isEditing && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                aria-label="删除任务"
                title="删除任务"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={isEditing ? () => setIsEditing(false) : onClose}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label={isEditing ? "取消编辑" : "关闭"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Delete confirmation banner */}
        {showDeleteConfirm && (
          <div className="flex items-center gap-3 border-b border-red-100 bg-red-50 px-6 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
            <span className="flex-1 text-sm text-red-700">确认删除任务「{task.title}」？此操作不可恢复。</span>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
              确认删除
            </button>
          </div>
        )}

        {/* Inline edit form */}
        {isEditing && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-4 space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">任务标题</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">状态</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                >
                  {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>{TASK_STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">优先级</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">进度 %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editForm.progress}
                  onChange={(e) => setEditForm((f) => ({ ...f, progress: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">截止日期</label>
                <input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">主责人</label>
              <input
                type="text"
                value={editForm.owner}
                onChange={(e) => setEditForm((f) => ({ ...f, owner: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">任务描述</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-[0_6px_14px_rgba(37,99,235,0.18)] transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Blocked banner */}
          {task.status === "paused_blocked" && task.blocked_reason && (
            <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-orange-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                阻塞中 {task.blocked_days && <span>· 已 {task.blocked_days} 天</span>}
              </div>
              <p className="mt-1 text-xs text-orange-600">{task.blocked_reason}</p>
            </div>
          )}
          {task.status === "pending_assign" && (
            <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-700">
                <Loader2 className="h-3.5 w-3.5" />
                等待人工指派
              </div>
              <p className="mt-1 text-xs text-violet-600">规则未能自动匹配责任人，请手动选择。</p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">主责人</div>
              <button
                type="button"
                onClick={() => task.owner !== "待指派" && task.owner !== "外部机构" && onOpenPerson?.(task.owner)}
                disabled={task.owner === "待指派" || task.owner === "外部机构"}
                className="mt-1 flex items-center gap-2 rounded-md py-0.5 text-sm font-medium text-slate-800 transition-colors enabled:cursor-pointer enabled:hover:text-blue-600 disabled:cursor-default"
              >
                <MiniAvatar name={task.owner} size="sm" />
                {task.owner}
                {task.owner !== "待指派" && task.owner !== "外部机构" && <ChevronRight className="h-3 w-3 opacity-50" />}
              </button>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">截止日期</div>
              <div className="mt-1 text-sm font-medium tabular-nums text-slate-800">
                {task.due_date ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">进度</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full", sCfg.dot)} style={{ width: `${task.progress}%` }} />
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-800">{task.progress}%</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">附件</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{task.attachments ?? 0} 个</div>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">任务描述</h4>
              <p className="rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700">
                {task.description}
              </p>
            </section>
          )}

          {/* Collaborators */}
          {task.collaborators && task.collaborators.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">协作人</h4>
              <div className="flex flex-wrap gap-2">
                {task.collaborators.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onOpenPerson?.(c)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <MiniAvatar name={c} size="sm" />
                    {c}
                    <ChevronRight className="h-3 w-3 opacity-0 transition-all group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Activity timeline */}
          {task.recent_activities && task.recent_activities.length > 0 && (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">最近动态</h4>
              <ul className="relative space-y-3 border-l border-slate-200 pl-4">
                {task.recent_activities.map((a, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
                    <div className="text-xs tabular-nums text-slate-400">{a.date}</div>
                    <div className="mt-0.5 text-sm text-slate-700">
                      {a.action}
                      {a.actor && <span className="ml-1.5 text-xs text-slate-400">· {a.actor}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Progress notes from workspace updates */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">进度记录</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {notesLoading ? "加载中" : `${progressNotes.length} 条`}
              </span>
            </div>
            {notesLoading ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-400">
                读取中…
              </div>
            ) : progressNotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-400">
                暂无进度记录
              </div>
            ) : (
              <ul className="space-y-3">
                {progressNotes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="font-medium text-slate-700">
                        {note.actor.name}
                        {note.actor.role ? <span className="ml-1 text-slate-400">· {note.actor.role}</span> : null}
                      </span>
                      <span className="tabular-nums">{new Date(note.created_at).toLocaleString("zh-CN")}</span>
                    </div>
                    {typeof note.progress === "number" && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        进度更新至 {note.progress}%
                      </div>
                    )}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{note.text}</p>
                    {note.attachments.length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {note.attachments.map((att) => {
                          const isImage = att.mime.startsWith("image/");
                          return isImage ? (
                            <a
                              key={att.id}
                              href={att.data_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                              title={`${att.name} · ${formatBytes(att.size)}`}
                            >
                              <img src={att.data_url} alt={att.name} className="h-32 w-full object-cover transition-transform group-hover:scale-105" />
                              <div className="truncate px-2 py-1 text-[10px] text-slate-500">{att.name}</div>
                            </a>
                          ) : (
                            <a
                              key={att.id}
                              href={att.data_url}
                              download={att.name}
                              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="min-w-0 flex-1 truncate">{att.name}</span>
                              <span className="shrink-0 text-[10px] text-slate-400">{formatBytes(att.size)}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">操作留痕</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {taskLogs.length} 条
              </span>
            </div>
            <AuditTimeline logs={taskLogs} showResource={false} emptyText="暂无此任务的操作记录" />
          </section>
        </div>

        {!isEditing && (canReassignTask || (canEditTask && task.status !== "completed")) && (
          <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
            {canReassignTask && (
              <button disabled={saving} onClick={() => recordDirectorTaskAction("task.handoff_requested")} className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50">
                转派
              </button>
            )}
            {canEditTask && task.status !== "completed" && (
              <button disabled={saving} onClick={() => recordDirectorTaskAction("task.status_changed")} className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(5,150,105,0.2)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
                标记完成
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Person Detail Drawer ────────────────────────────────────────────────────

function PersonDetailDrawer({
  person,
  onClose,
  onOpenTask,
  taskMap,
  onEditPerson,
  onSendMessage,
  onReassignPerson,
}: {
  person: PersonLoad;
  onClose: () => void;
  onOpenTask: (taskId: string, ownerHint?: string) => void;
  taskMap: Map<string, RdTask>;
  onEditPerson?: (person: PersonLoad) => void;
  onSendMessage?: (person: PersonLoad) => void;
  onReassignPerson?: (person: PersonLoad) => void;
}) {
  const ratio = person.max_tasks > 0 ? person.task_count / person.max_tasks : 0;
  const ratioPct = Math.round(ratio * 100);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const tone =
    ratio >= 1 ? { label: "超负荷", text: "text-red-600", bg: "bg-red-50", dot: "bg-red-500" } :
    ratio >= 0.75 ? { label: "高负载", text: "text-orange-600", bg: "bg-orange-50", dot: "bg-orange-500" } :
    ratio >= 0.5 ? { label: "中等", text: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-500" } :
    { label: "轻负载", text: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-500" };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300 sm:w-[min(620px,92vw)]"
      >
        {/* Header */}
        <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/30 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white ring-4 ring-white", hashColor(person.name))}>
              {person.name.replace(/\(.+?\)/g, "").trim().slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">{person.name}</h3>
                {person.on_leave && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">请假中</span>
                )}
              </div>
              <p className="text-xs text-slate-500">{person.position}</p>
              {person.department && <p className="mt-0.5 text-[11px] text-slate-400">{person.department}</p>}
            </div>
          </div>

          {/* Load indicator */}
          <div className={cn("mt-4 rounded-xl border px-3 py-2.5", tone.bg.replace("bg-", "border-").replace("50", "100"), tone.bg)}>
            <div className="flex items-center justify-between text-xs">
              <span className={cn("font-semibold", tone.text)}>{tone.label} · {person.task_count} / {person.max_tasks}</span>
              <span className={cn("tabular-nums font-bold", tone.text)}>{ratioPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
              <div className={cn("h-full rounded-full", tone.dot, person.on_leave && "opacity-50")} style={{ width: `${Math.min(100, ratioPct)}%` }} />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Stats */}
          <section className="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div className="text-center">
              <div className="text-xl font-semibold tabular-nums text-emerald-600">{person.completed_this_month ?? 0}</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">本月完成</div>
            </div>
            <div className="border-x border-slate-200 text-center">
              <div className={cn("text-xl font-semibold tabular-nums", (person.blocked_count ?? 0) > 0 ? "text-orange-600" : "text-slate-300")}>
                {person.blocked_count ?? 0}
              </div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">阻塞中</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold tabular-nums text-slate-800">{person.avg_completion ?? 0}%</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">平均完成率</div>
            </div>
          </section>

          {/* Contact */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">联系方式</h4>
            <div className="space-y-2 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-sm">
              {person.email && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">邮箱</span>
                  <span className="font-mono text-xs text-slate-700">{person.email}</span>
                </div>
              )}
              {person.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">电话</span>
                  <span className="font-mono text-xs text-slate-700">{person.phone}</span>
                </div>
              )}
              {person.joined_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">入职日期</span>
                  <span className="text-xs tabular-nums text-slate-700">{person.joined_at}</span>
                </div>
              )}
            </div>
          </section>

          {/* Tasks */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">当前任务</h4>
              <span className="text-[11px] tabular-nums text-slate-400">{person.tasks.length} 项</span>
            </div>
            <ul className="space-y-1.5">
              {person.tasks.map((taskTitle, idx) => {
                const taskId = person.task_ids?.[idx];
                const task = taskId ? taskMap.get(taskId) : undefined;
                const sCfg = task ? TASK_STATUS_CONFIG[task.status] : null;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(taskId ?? taskTitle, person.name)}
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)] active:translate-y-0"
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sCfg?.dot ?? "bg-slate-300")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                          {task?.title ?? taskTitle}
                        </div>
                        {task && (
                          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                            <span className={cn("font-semibold", sCfg?.text)}>{sCfg?.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className="tabular-nums text-slate-500">{task.progress}%</span>
                            {task.due_date && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="tabular-nums text-slate-500">{task.due_date}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Activity */}
          {person.recent_activities && person.recent_activities.length > 0 && (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">最近动态</h4>
              <ul className="relative space-y-3 border-l border-slate-200 pl-4">
                {person.recent_activities.map((a, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
                    <div className="text-xs tabular-nums text-slate-400">{a.date}</div>
                    <div className="mt-0.5 text-sm text-slate-700">{a.action}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
          {canManagePeople && onEditPerson && (
            <button
              type="button"
              onClick={() => onEditPerson(person)}
              className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
            >
              编辑信息
            </button>
          )}
          {onSendMessage && (
            <button
              type="button"
              onClick={() => onSendMessage(person)}
              className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
            >
              发消息
            </button>
          )}
          {canReassignTask && onReassignPerson && (
            <button
              type="button"
              onClick={() => onReassignPerson(person)}
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.2)] transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]"
            >
              重分配
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Category Detail Drawer ──────────────────────────────────────────────────

function CategoryDetailDrawer({
  category,
  onClose,
  onOpenTask,
  onOpenPerson,
  onViewFullList,
  relatedTasks,
}: {
  category: CategoryProgress;
  onClose: () => void;
  onOpenTask: (taskId: string, owner?: string) => void;
  onOpenPerson: (name: string) => void;
  onViewFullList: (category: CategoryProgress) => void;
  relatedTasks: TaskDetail[];
}) {
  const completedRate = category.total > 0 ? Math.round((category.completed / category.total) * 100) : 0;
  const inProgressRate = category.total > 0 ? Math.round((category.in_progress / category.total) * 100) : 0;
  const notStarted = category.total - category.completed - category.in_progress - category.blocked;

  // Compute top contributors from related tasks
  const contributorCounts = new Map<string, number>();
  for (const t of relatedTasks) {
    if (t.owner && t.owner !== "待指派" && t.owner !== "外部机构") {
      contributorCounts.set(t.owner, (contributorCounts.get(t.owner) ?? 0) + 1);
    }
    for (const c of t.collaborators ?? []) {
      contributorCounts.set(c, (contributorCounts.get(c) ?? 0) + 0.5);
    }
  }
  const topContributors = Array.from(contributorCounts.entries())
    .map(([name, count]) => ({ name, count: Math.ceil(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const categoryColor = getCategoryColorClass(category.color);

  const handleExportReport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows: unknown[][] = [
      ["分类进度报表"],
      ["导出日期", today],
      ["分类", category.label],
      ["任务总数", category.total],
      ["已完成", category.completed],
      ["进行中", category.in_progress],
      ["阻塞", category.blocked],
      ["完成率", `${completedRate}%`],
      [],
      ["任务ID", "任务标题", "状态", "进度", "负责人", "优先级", "截止日期", "分类路径", "描述"],
      ...relatedTasks.map((task) => [
        task.task_id,
        task.title,
        TASK_STATUS_CONFIG[task.status]?.label ?? task.status,
        `${task.progress}%`,
        task.owner,
        TASK_PRIORITY_CONFIG[task.priority]?.label ?? task.priority,
        task.due_date ?? "",
        task.category_path,
        task.description ?? "",
      ]),
      [],
      ["主要贡献人", "任务数"],
      ...topContributors.map((person) => [person.name, person.count]),
    ];
    const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const ok = downloadTextFile(
      `研发分类报表-${safeFileName(category.label)}-${today}.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
    if (ok) {
      toast.success("报表已导出", {
        description: `${category.label} · ${relatedTasks.length} 项任务`,
      });
    } else {
      toast.error("当前环境不支持导出报表");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300 sm:w-[min(620px,92vw)]"
      >
        {/* Header */}
        <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/30 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]", categoryColor)}>
              <LayoutGrid className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-slate-900">{category.label}</h3>
              <p className="text-xs text-slate-500">{category.total} 个任务 · 完成率 {completedRate}%</p>
            </div>
          </div>

          {/* Stacked progress */}
          <div className="mt-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-400 transition-all" style={{ width: `${completedRate}%` }} />
              <div className="bg-blue-300 transition-all" style={{ width: `${inProgressRate}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-slate-500">已完成</span>
                <span className="font-semibold tabular-nums text-emerald-700">{category.completed}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                <span className="text-slate-500">进行中</span>
                <span className="font-semibold tabular-nums text-blue-700">{category.in_progress}</span>
              </span>
              {category.blocked > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="text-slate-500">阻塞</span>
                  <span className="font-semibold tabular-nums text-red-700">{category.blocked}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                <span className="text-slate-500">未开始</span>
                <span className="font-semibold tabular-nums text-slate-700">{notStarted}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Stats summary */}
          <section className="grid grid-cols-4 gap-2 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            {[
              { label: "总数", value: category.total, tone: "text-slate-900" },
              { label: "完成率", value: `${completedRate}%`, tone: "text-emerald-600" },
              { label: "进行", value: category.in_progress, tone: "text-blue-600" },
              { label: "阻塞", value: category.blocked, tone: category.blocked > 0 ? "text-red-600" : "text-slate-300" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className={cn("text-xl font-semibold tabular-nums tracking-tight", s.tone)}>{s.value}</div>
                <div className="mt-0.5 text-[10px] font-medium text-slate-500">{s.label}</div>
              </div>
            ))}
          </section>

          {/* Key tasks */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">关键任务</h4>
              <span className="text-[11px] tabular-nums text-slate-400">
                显示 {relatedTasks.length} 项 · 共 {category.total} 项
              </span>
            </div>
            {relatedTasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/40 py-6 text-center text-xs text-slate-400">
                暂无关键任务录入
              </div>
            ) : (
              <ul className="space-y-1.5">
                {relatedTasks.map((t) => {
                  const sCfg = TASK_STATUS_CONFIG[t.status];
                  return (
                    <li key={t.task_id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(t.task_id, t.owner)}
                        className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)] active:translate-y-0"
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sCfg.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-400">{t.task_id}</span>
                            <span className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                            <span className={cn("font-semibold", sCfg.text)}>{sCfg.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className="tabular-nums text-slate-500">{t.progress}%</span>
                            {t.owner && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="text-slate-500">{t.owner}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Top contributors */}
          {topContributors.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">主要贡献人</h4>
              <ul className="space-y-1.5">
                {topContributors.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => onOpenPerson(c.name)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 active:translate-y-0"
                    >
                      <MiniAvatar name={c.name} size="sm" />
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                        {c.name}
                      </span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                        {c.count} 项
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
          <button
            type="button"
            onClick={handleExportReport}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
          >
            <Download className="h-4 w-4" />
            导出报表
          </button>
          <button
            type="button"
            onClick={() => onViewFullList(category)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]"
          >
            <ListChecks className="h-4 w-4" />
            查看完整清单
          </button>
        </footer>
      </div>
    </div>
  );
}

function BatchReassignModal({
  onClose,
  tasks,
  personLoads,
  initialTaskId,
  initialTaskIds,
  onUpdated,
}: {
  onClose: () => void;
  tasks: ReassignableTask[];
  personLoads: PersonLoad[];
  initialTaskId?: string | null;
  initialTaskIds?: string[];
  onUpdated?: () => void;
}) {
  const DIRECTOR_AUDIT_ACTOR = useAuditActor("研发主管");
  const shouldReduceMotion = useReducedMotion();
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(() => new Set(initialTaskIds?.length ? initialTaskIds : initialTaskId ? [initialTaskId] : []));
  const [targetPerson, setTargetPerson] = useState<PersonLoad | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const ASSIGNABLE_TASKS = tasks;
  const PERSON_LOADS = personLoads;

  const toggleTask = (id: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirmReassign = async () => {
    if (selectedTasks.size === 0 || !targetPerson) return;
    const selected = ASSIGNABLE_TASKS.filter((task) => selectedTasks.has(task.task_id));
    if (selected.length === 0) return;

    setSaving(true);
    try {
      await Promise.all(
        selected.map((task) =>
          updateRdTask(task.task_id, {
            primary_owner: targetPerson.name,
            primary_owner_user_id: targetPerson.user_id ?? null,
            status: "in_progress",
          }),
        ),
      );
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action: "system.bulk_reassign",
        resource: { type: "system", id: `batch-${Date.now()}`, name: "批量重分配任务" },
        comment: `批量转派 ${selected.length} 个任务给 ${targetPerson.name}`,
        metadata: {
          to: targetPerson.name,
          task_count: selected.length,
          task_ids: selected.map((task) => task.task_id),
        },
        source: "web",
      });
      selected.forEach((task) => {
        recordAudit({
          actor: DIRECTOR_AUDIT_ACTOR,
          action: "task.reassigned",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [
            { field: "owner", before: task.owner, after: targetPerson.name },
            { field: "status", before: task.owner === "待指派" ? "pending_assign" : undefined, after: "in_progress" },
          ],
          comment: "批量重分配中转派任务",
          metadata: { blocked_days: task.days_blocked, reason: task.reason },
          source: "web",
        });
      });
      onUpdated?.();
      setConfirmed(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "转派失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <span className="font-semibold text-slate-800">批量重分配任务</span>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!confirmed ? (
            <>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">选择要转派的任务</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {ASSIGNABLE_TASKS.length === 0 ? (
                    <DashboardEmptyPanel title="暂无可转派任务" description="当前没有阻塞或待指派任务，无法执行批量转派。" />
                  ) : (
                    ASSIGNABLE_TASKS.map((t) => (
                      <label key={t.task_id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedTasks.has(t.task_id)}
                          onChange={() => toggleTask(t.task_id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-800">{t.title}</div>
                          <div className="text-xs text-slate-400">
                            {t.task_id}{t.days_blocked ? ` · 阻塞 ${t.days_blocked} 天` : " · 待指派"}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">选择目标负责人</div>
                <div className="grid grid-cols-2 gap-2">
                  {PERSON_LOADS.filter((p) => !p.on_leave).length === 0 ? (
                    <div className="col-span-2">
                      <DashboardEmptyPanel title="暂无可用负责人" description="请先在人员管理中维护研发成员后再执行转派。" />
                    </div>
                  ) : (
                    PERSON_LOADS.filter((p) => !p.on_leave).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setTargetPerson(p)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          targetPerson?.id === p.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50",
                        )}
                      >
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{p.position}</span>
                          <span className={cn(
                            "font-semibold",
                            p.max_tasks > 0 && p.task_count / p.max_tasks >= 0.75 ? "text-orange-500" : "text-emerald-600",
                          )}>
                            {p.task_count} 个任务
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  取消
                </button>
                <button
                  disabled={selectedTasks.size === 0 || !targetPerson || saving}
                  onClick={confirmReassign}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  {saving ? "转派中..." : "确认转派"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
              <p className="font-semibold text-slate-800">转派成功</p>
              <p className="mt-1 text-sm text-slate-500">
                已将 {selectedTasks.size} 个任务转派给 {targetPerson?.name}，痕迹已记录。
              </p>
              <button onClick={onClose} className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
                关闭
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

type CategoryEditorState = {
  mode: "create" | "edit";
  category?: RdCategory;
};

function CategoryEditorModal({
  state,
  onClose,
  onSave,
}: {
  state: CategoryEditorState;
  onClose: () => void;
  onSave: (label: string, childrenText: string) => void | Promise<void>;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [label, setLabel] = useState(state.category?.label ?? "");
  const [childrenText, setChildrenText] = useState(state.category?.children.map((child) => child.label).join("\n") ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(label, childrenText);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <span className="font-semibold text-slate-800">{state.mode === "create" ? "新增分类" : "编辑分类"}</span>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-500">分类名称</label>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              placeholder="例如：分子筛系统"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-500">子项/部件</label>
            <textarea
              value={childrenText}
              onChange={(event) => setChildrenText(event.target.value)}
              rows={8}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              placeholder="每行一个子项，也可以用逗号分隔"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              取消
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存分类"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CategoryDeleteDialog({
  category,
  taskCount,
  onClose,
  onConfirm,
}: {
  category: RdCategory;
  taskCount: number;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="border-b border-red-100 bg-red-50 px-6 py-4">
          <div className="flex items-center gap-2 font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" />
            删除分类
          </div>
        </div>
        <div className="space-y-4 p-6">
          <p className="text-sm leading-6 text-slate-600">
            确认删除「{category.label}」？该分类下有 {taskCount} 条未归档任务，删除后分类和其中任务都会从驾驶舱移除。
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              取消
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.20)] transition-all hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? "删除中..." : "确认删除"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CreateTaskModal({
  categories,
  onClose,
  onCreate,
}: {
  categories: RdCategory[];
  onClose: () => void;
  onCreate: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const firstCategory = categories[0];
  const [form, setForm] = useState({
    title: "",
    categoryId: firstCategory?.id ?? "",
    subProjectId: firstCategory?.children[0]?.id ?? "",
    ownerKey: "",
    priority: "medium" as Priority,
    status: "draft" as TaskStatus,
    due_date: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<RdPersonLoad[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const subProjects: RdSubProject[] = selectedCategory?.children ?? [];
  const selectedDate = parseLocalDate(form.due_date);
  const selectedOwner = findRdPersonByOptionValue(people, form.ownerKey);

  useEffect(() => {
    let cancelled = false;
    setPeopleLoading(true);
    fetchRdPeople()
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error("请填写任务标题"); return; }
    if (!form.categoryId) { toast.error("请选择所属分类"); return; }
    if (!form.subProjectId) { toast.error("请选择子项目"); return; }
    setSaving(true);
    try {
      const subLabel = subProjects.find((s) => s.id === form.subProjectId)?.label;
      const categoryPath = [selectedCategory?.label, subLabel].filter(Boolean).join(" / ");
      await createRdTask({
        category_id: form.categoryId,
        sub_project_id: form.subProjectId,
        title: form.title.trim(),
        primary_owner: selectedOwner?.name ?? "待指派",
        primary_owner_user_id: selectedOwner?.user_id ?? null,
        status: form.status,
        final_priority: form.priority,
        ai_priority: form.priority,
        due_date: form.due_date || undefined,
        description: form.description.trim() || undefined,
        category_path: categoryPath,
      });
      toast.success("任务已创建");
      onCreate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <span className="font-semibold text-slate-800">新建任务</span>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">任务标题 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="输入任务标题"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">所属分类 *</label>
              <select
                value={form.categoryId}
                onChange={(e) => {
                  const categoryId = e.target.value;
                  const nextCategory = categories.find((c) => c.id === categoryId);
                  setForm((f) => ({ ...f, categoryId, subProjectId: nextCategory?.children[0]?.id ?? "" }));
                }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">子项目</label>
              <select
                value={form.subProjectId}
                onChange={(e) => setField("subProjectId", e.target.value)}
                disabled={subProjects.length === 0}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:opacity-50"
              >
                <option value="" disabled>请选择子项目</option>
                {subProjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">优先级</label>
              <select
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value as Priority)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">初始状态</label>
              <select
                value={form.status}
                onChange={(e) => setField("status", e.target.value as TaskStatus)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{TASK_STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">主责人</label>
              <select
                value={form.ownerKey || "待指派"}
                onChange={(e) => setField("ownerKey", e.target.value === "待指派" ? "" : e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                <option value="待指派">待指派</option>
                {people.map((person) => (
                  <option key={person.id} value={rdPersonOptionValue(person)}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">截止日期</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setField("due_date", e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">任务描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={3}
              placeholder="可选"
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建任务
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Clear Data Dialog ────────────────────────────────────────────────────────

function CreateTaskModalV2({
  categories,
  onClose,
  onCreate,
}: {
  categories: RdCategory[];
  onClose: () => void;
  onCreate: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const firstCategory = categories[0];
  const [form, setForm] = useState({
    title: "",
    categoryId: firstCategory?.id ?? "",
    subProjectId: firstCategory?.children[0]?.id ?? "",
    ownerKey: "",
    priority: "medium" as Priority,
    status: "draft" as TaskStatus,
    due_date: "",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [people, setPeople] = useState<RdPersonLoad[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const subProjects: RdSubProject[] = selectedCategory?.children ?? [];
  const selectedDate = parseLocalDate(form.due_date);
  const selectedOwner = findRdPersonByOptionValue(people, form.ownerKey);

  useEffect(() => {
    let cancelled = false;
    setPeopleLoading(true);
    fetchRdPeople()
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error("请填写任务标题"); return; }
    if (!form.categoryId) { toast.error("请选择所属分类"); return; }
    if (!form.subProjectId) { toast.error("请选择子项目"); return; }
    setSaving(true);
    try {
      const subLabel = subProjects.find((s) => s.id === form.subProjectId)?.label;
      const categoryPath = [selectedCategory?.label, subLabel].filter(Boolean).join(" / ");
      await createRdTask({
        category_id: form.categoryId,
        sub_project_id: form.subProjectId,
        title: form.title.trim(),
        primary_owner: selectedOwner?.name ?? "待指派",
        primary_owner_user_id: selectedOwner?.user_id ?? null,
        status: form.status,
        final_priority: form.priority,
        ai_priority: form.priority,
        due_date: form.due_date || undefined,
        description: form.description.trim() || undefined,
        category_path: categoryPath,
      });
      toast.success("任务已创建");
      onCreate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <span className="font-semibold text-slate-800">新建任务</span>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4 text-slate-500" />
          </Button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <Label className="mb-1 block text-xs font-semibold text-slate-600">任务标题 *</Label>
            <Input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="输入任务标题" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">所属分类 *</Label>
              <Select
                value={form.categoryId}
                onValueChange={(categoryId) => {
                  const nextCategory = categories.find((c) => c.id === categoryId);
                  setForm((f) => ({ ...f, categoryId, subProjectId: nextCategory?.children[0]?.id ?? "" }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">子项目</Label>
              <Select value={form.subProjectId} onValueChange={(value) => setField("subProjectId", value)} disabled={subProjects.length === 0}>
                <SelectTrigger><SelectValue placeholder="选择子项目" /></SelectTrigger>
                <SelectContent>
                  {subProjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">优先级</Label>
              <Select value={form.priority} onValueChange={(value) => setField("priority", value as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">初始状态</Label>
              <Select value={form.status} onValueChange={(value) => setField("status", value as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{TASK_STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">主责人</Label>
              <Select value={form.ownerKey || "待指派"} onValueChange={(value) => setField("ownerKey", value === "待指派" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder={peopleLoading ? "正在读取人员" : "待指派"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="待指派" description="暂不指定负责人">待指派</SelectItem>
                  {people.map((person) => (
                    <SelectItem key={person.id} value={rdPersonOptionValue(person)} description={`${person.position} · 当前 ${person.task_count}/${person.max_tasks}${person.user_id ? " · 已绑定账号" : " · 未绑定账号"}`}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs font-semibold text-slate-600">截止日期</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className={cn("h-9 w-full justify-between rounded-md px-3 text-left font-normal", !form.due_date && "text-slate-400")}>
                    <span>{form.due_date ? form.due_date.replace(/-/g, "/") : "年 / 月 / 日"}</span>
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto rounded-xl border-slate-200 bg-white p-0 shadow-xl">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) setField("due_date", formatLocalDate(date));
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <Label className="mb-1 block text-xs font-semibold text-slate-600">任务描述</Label>
            <Textarea value={form.description} onChange={(e) => setField("description", e.target.value)} rows={3} placeholder="可选" className="resize-none" />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="flex-1 rounded-md">取消</Button>
          <Button type="button" onClick={handleCreate} disabled={saving} className="flex-1 rounded-md bg-blue-600 text-white hover:bg-blue-700">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建任务
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ClearDataDialog({ onClose, onCleared }: { onClose: () => void; onCleared: () => void }) {
  const DIRECTOR_AUDIT_ACTOR = useAuditActor("研发主管");
  const shouldReduceMotion = useReducedMotion();
  const [confirm, setConfirm] = useState("");
  const [clearing, setClearing] = useState(false);
  const CONFIRM_KEYWORD = "确认清空";
  const ready = confirm.trim() === CONFIRM_KEYWORD;

  const handleClear = async () => {
    if (!ready) return;
    setClearing(true);
    try {
      await clearRdAllTaskData();
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action: "task.data.cleared",
        resource: { type: "system", id: "rd-task-data", name: "研发任务模块数据" },
        comment: "清空研发任务模块全部数据",
        source: "web",
      });
      toast.success("研发任务模块数据已全部清空");
      onCleared();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
      setClearing(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-red-100 bg-red-50/60 px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
            <Trash2 className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <div className="font-semibold text-red-800">清空研发任务模块数据</div>
            <div className="text-xs text-red-600">此操作需要清空数据权限，且不可恢复</div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 leading-relaxed">
            <p className="font-semibold mb-1">将被清空的数据：</p>
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              <li>所有研发任务分类、子项目及任务（含子任务）</li>
              <li>个人工作台任务数据</li>
              <li>研发主管驾驶舱看板数据（分类进度、人员负载、阻塞、待指派）</li>
            </ul>
            <p className="mt-2 text-xs text-red-500">注：人员档案、审批流、AI 策略、操作留痕不受影响。</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              请输入「<span className="font-bold text-red-600">{CONFIRM_KEYWORD}</span>」以继续
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_KEYWORD}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
            />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={clearing}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleClear}
            disabled={!ready || clearing}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(220,38,38,0.20)] transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {clearing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认清空
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Person edit + send message modals ──────────────────────────────────────

function PersonEditModal({
  person,
  onClose,
  onSaved,
}: {
  person: RdPersonLoad;
  onClose: () => void;
  onSaved: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [form, setForm] = useState({
    name: person.name ?? "",
    position: person.position ?? "",
    department: person.department ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    max_tasks: person.max_tasks ?? 8,
    on_leave: Boolean(person.on_leave),
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("姓名不能为空"); return; }
    if (!form.position.trim()) { toast.error("岗位不能为空"); return; }
    setSaving(true);
    try {
      await updateRdPerson({
        ...person,
        name: form.name.trim(),
        position: form.position.trim(),
        department: form.department.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        max_tasks: Math.max(1, Math.min(50, Math.round(form.max_tasks))),
        on_leave: form.on_leave,
      });
      toast.success("已保存");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <Pencil className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">编辑研发成员信息</h3>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 py-5">
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium text-slate-700">姓名</span>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">岗位</span>
            <input
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">部门</span>
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">邮箱</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">电话</span>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">最大任务数</span>
            <input
              type="number"
              min={1}
              max={50}
              value={form.max_tasks}
              onChange={(e) => setForm({ ...form, max_tasks: Number(e.target.value) || 1 })}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.on_leave}
              onChange={(e) => setForm({ ...form, on_leave: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            请假中
          </label>
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
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SendMessageModal({
  recipient,
  onClose,
  onSent,
}: {
  recipient: RdPersonLoad;
  onClose: () => void;
  onSent: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) { toast.error("消息内容不能为空"); return; }
    setSending(true);
    try {
      await sendRdMessage({
        recipient_id: recipient.user_id ?? undefined,
        recipient_person_id: recipient.id,
        recipient_name: recipient.name,
        subject: subject.trim() || undefined,
        body: trimmedBody,
      });
      toast.success(`已发送给 ${recipient.name}`);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              发消息给 <span className="text-violet-700">{recipient.name}</span>
            </h3>
          </div>
          <button type="button" disabled={sending} onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">标题（可选）</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="例：本周阻塞跟进"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">消息内容</span>
            <textarea
              autoFocus
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="写下要发送的内容…"
              className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <p className="text-[11px] text-slate-400">
            收件人：{recipient.name}{recipient.position ? ` · ${recipient.position}` : ""}{recipient.email ? ` · ${recipient.email}` : ""}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={handleSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            发送
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDDirectorDashboardPage() {
  const shouldReduceMotion = useReducedMotion();
  const navigate = useNavigate();
  const [selectedPerson, setSelectedPerson] = useState<PersonLoad | null>(null);
  const [editingPerson, setEditingPerson] = useState<PersonLoad | null>(null);
  const [messageTarget, setMessageTarget] = useState<PersonLoad | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryProgress | null>(null);
  const [showReassign, setShowReassign] = useState(false);
  const [reassignInitialTaskId, setReassignInitialTaskId] = useState<string | null>(null);
  const [categoryReassignTasks, setCategoryReassignTasks] = useState<ReassignableTask[] | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<CategoryEditorState | null>(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<RdCategory | null>(null);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showClearData, setShowClearData] = useState(false);
  const [dashboard, setDashboard] = useState<DirectorDashboardPayload>(EMPTY_DIRECTOR_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canReassignTasks = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canCreateTask = usePermission(PERMISSIONS.RD_TASK_CREATE);
  const canClearData = usePermission(PERMISSIONS.RD_DATA_CLEAR);

  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchRdDirectorDashboard()
      .then(async (payload) => {
        if (!isMountedRef.current) return;
        const normalized = normalizeDirectorDashboard(payload);
        // Auto-recompute if dashboard is empty (stale or never computed)
        if (normalized.personLoads.length === 0) {
          try {
            const categories = await fetchRdTaskCategories();
            if (categories.length === 0) {
              if (isMountedRef.current) setDashboard(normalized);
              return;
            }
            await recomputeRdDirectorDashboard();
            const fresh = await fetchRdDirectorDashboard();
            if (isMountedRef.current) setDashboard(normalizeDirectorDashboard(fresh));
          } catch {
            if (isMountedRef.current) setDashboard(normalized);
          }
        } else {
          setDashboard(normalized);
        }
      })
      .catch((error) => {
        if (!isMountedRef.current) return;
        setDashboard(EMPTY_DIRECTOR_DASHBOARD);
        setLoadError(error instanceof Error ? error.message : "负责人看板数据读取失败");
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Fetch task categories separately so the TaskDetail drawer shows real data
  const [allCategories, setAllCategories] = useState<RdCategory[]>([]);
  const loadCategories = useCallback(() => {
    fetchRdTaskCategories()
      .then((cats) => { if (isMountedRef.current) setAllCategories(cats); })
      .catch(() => { /* drawer falls back to placeholder */ });
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Daily reports — list + history filters
  const [dailyReports, setDailyReports] = useState<RdDailyReport[]>([]);
  const [dailyReportsLoading, setDailyReportsLoading] = useState(false);
  const [regeneratingReports, setRegeneratingReports] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [reportDateFilter, setReportDateFilter] = useState<string>(""); // YYYY-MM-DD or empty for all
  const [reportUserFilter, setReportUserFilter] = useState<string>(""); // user_id or empty for all
  const [progressNoteMap, setProgressNoteMap] = useState<Record<string, RdTaskProgressNote[]>>({});

  const loadDailyReports = useCallback(() => {
    setDailyReportsLoading(true);
    fetchRdDailyReports({
        date: reportDateFilter || undefined,
        user_id: reportUserFilter || undefined,
        limit: reportDateFilter || reportUserFilter ? 500 : 50,
      })
      .then(async (list) => {
        const taskIds = Array.from(
          new Set(list.flatMap((report) => report.summary.note_refs.map((ref) => ref.task_id)).filter(Boolean)),
        );
        const noteEntries = await Promise.all(
          taskIds.map(async (taskId) => [taskId, await fetchRdTaskProgressNotes(taskId)] as const),
        );
        const noteMap = Object.fromEntries(noteEntries);
        return { list, noteMap };
      })
      .then(({ list, noteMap }) => {
        if (!isMountedRef.current) return;
        setDailyReports(list);
        setProgressNoteMap(noteMap);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        setDailyReports([]);
        setProgressNoteMap({});
      })
      .finally(() => { if (isMountedRef.current) setDailyReportsLoading(false); });
  }, [reportDateFilter, reportUserFilter]);

  useEffect(() => { loadDailyReports(); }, [loadDailyReports]);

  // Build user options for the filter from current person loads
  const reportUserOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const p of dashboard.personLoads) {
      const id = p.user_id ?? p.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: p.name });
    }
    return opts;
  }, [dashboard.personLoads]);

  // Group reports by date for history view
  const reportsByDate = useMemo(() => {
    const map = new Map<string, RdDailyReport[]>();
    for (const r of dailyReports) {
      const arr = map.get(r.date) ?? [];
      arr.push(r);
      map.set(r.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [dailyReports]);
  const progressNoteById = useMemo(() => {
    const map = new Map<string, RdTaskProgressNote>();
    for (const notes of Object.values(progressNoteMap)) {
      for (const note of notes) map.set(note.id, note);
    }
    return map;
  }, [progressNoteMap]);

  const reloadAll = useCallback(() => {
    loadDashboard();
    loadCategories();
    loadDailyReports();
  }, [loadDashboard, loadCategories, loadDailyReports]);

  // Flat task map: task_id → RdTask (includes subtasks)
  const taskMap = useMemo(() => {
    const map = new Map<string, RdTask>();
    function addTask(task: RdTask) {
      map.set(task.task_id, task);
      task.subtasks?.forEach(addTask);
    }
    allCategories.forEach((cat) => cat.children.forEach((sub) => sub.tasks.forEach(addTask)));
    return map;
  }, [allCategories]);

  const CATEGORY_PROGRESS = dashboard.categoryProgress;
  const PERSON_LOADS = dashboard.personLoads;
  const BLOCKED_TASKS = dashboard.blockedTasks;
  const PENDING_ASSIGN = dashboard.pendingAssign;
  const REASSIGNABLE_TASKS = useMemo<ReassignableTask[]>(
    () => [
      ...BLOCKED_TASKS.map((task) => ({ ...task })),
      ...PENDING_ASSIGN.map((task) => ({
        task_id: task.task_id,
        title: task.title,
        owner: "待指派",
        reason: "待指派",
        days_blocked: 0,
      })),
    ],
    [BLOCKED_TASKS, PENDING_ASSIGN],
  );

  // Pagination state for the three lists
  const [categoryPage, setCategoryPage] = useState(1);
  const [blockedPage, setBlockedPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [personPage, setPersonPage] = useState(1);
  const CATEGORY_PAGE_SIZE = 10;
  const BLOCKED_PAGE_SIZE = 3;
  const PENDING_PAGE_SIZE = 3;
  const PERSON_PAGE_SIZE = 6;

  // KPI filter for the task list
  type TaskKpiFilter = "all" | "completed" | "in_progress" | "blocked";
  const [kpiFilter, setKpiFilter] = useState<TaskKpiFilter>("all");
  const [taskListPage, setTaskListPage] = useState(1);
  const TASK_LIST_PAGE_SIZE = 10;

  const allTasksFlat = useMemo<RdTask[]>(() => {
    const out: RdTask[] = [];
    const walk = (tasks: RdTask[] | undefined) => {
      if (!Array.isArray(tasks)) return;
      for (const t of tasks) {
        out.push(t);
        if (t.subtasks?.length) walk(t.subtasks);
      }
    };
    allCategories.forEach((cat) => cat.children.forEach((sub) => walk(sub.tasks)));
    return out;
  }, [allCategories]);

  const filteredTasks = useMemo(() => {
    if (kpiFilter === "completed") return allTasksFlat.filter((t) => t.status === "completed");
    if (kpiFilter === "in_progress") return allTasksFlat.filter((t) => t.status === "in_progress");
    if (kpiFilter === "blocked") return allTasksFlat.filter((t) => t.status === "paused_blocked");
    return allTasksFlat;
  }, [allTasksFlat, kpiFilter]);

  useEffect(() => { setTaskListPage(1); }, [kpiFilter]);
  const taskListTotalPages = Math.max(1, Math.ceil(filteredTasks.length / TASK_LIST_PAGE_SIZE));
  const taskListSafePage = Math.min(taskListPage, taskListTotalPages);
  const taskListRangeStart = filteredTasks.length === 0 ? 0 : (taskListSafePage - 1) * TASK_LIST_PAGE_SIZE + 1;
  const taskListPaged = filteredTasks.slice(
    (taskListSafePage - 1) * TASK_LIST_PAGE_SIZE,
    taskListSafePage * TASK_LIST_PAGE_SIZE,
  );

  const categoryTotalPages = Math.max(1, Math.ceil(CATEGORY_PROGRESS.length / CATEGORY_PAGE_SIZE));
  const blockedTotalPages = Math.max(1, Math.ceil(BLOCKED_TASKS.length / BLOCKED_PAGE_SIZE));
  const pendingTotalPages = Math.max(1, Math.ceil(PENDING_ASSIGN.length / PENDING_PAGE_SIZE));
  const personTotalPages = Math.max(1, Math.ceil(PERSON_LOADS.length / PERSON_PAGE_SIZE));

  const categorySafePage = Math.min(categoryPage, categoryTotalPages);
  const blockedSafePage = Math.min(blockedPage, blockedTotalPages);
  const pendingSafePage = Math.min(pendingPage, pendingTotalPages);
  const personSafePage = Math.min(personPage, personTotalPages);
  const categoryRangeStart = CATEGORY_PROGRESS.length === 0 ? 0 : (categorySafePage - 1) * CATEGORY_PAGE_SIZE + 1;
  const blockedRangeStart = BLOCKED_TASKS.length === 0 ? 0 : (blockedSafePage - 1) * BLOCKED_PAGE_SIZE + 1;
  const pendingRangeStart = PENDING_ASSIGN.length === 0 ? 0 : (pendingSafePage - 1) * PENDING_PAGE_SIZE + 1;
  const personRangeStart = PERSON_LOADS.length === 0 ? 0 : (personSafePage - 1) * PERSON_PAGE_SIZE + 1;

  const categoryPaged = CATEGORY_PROGRESS.slice(
    (categorySafePage - 1) * CATEGORY_PAGE_SIZE,
    categorySafePage * CATEGORY_PAGE_SIZE,
  );
  const blockedPaged = BLOCKED_TASKS.slice(
    (blockedSafePage - 1) * BLOCKED_PAGE_SIZE,
    blockedSafePage * BLOCKED_PAGE_SIZE,
  );
  const pendingPaged = PENDING_ASSIGN.slice(
    (pendingSafePage - 1) * PENDING_PAGE_SIZE,
    pendingSafePage * PENDING_PAGE_SIZE,
  );
  const personPaged = PERSON_LOADS.slice(
    (personSafePage - 1) * PERSON_PAGE_SIZE,
    personSafePage * PERSON_PAGE_SIZE,
  );

  // Open a person by name (used from task collaborators / owner links)
  const openPersonByName = (name: string) => {
    const p = PERSON_LOADS.find((x) => x.name === name);
    if (p) {
      setSelectedTask(null);
      setSelectedPerson(p);
    }
  };

  // Open a task by id or title (used from person tasks list, blocked, pending)
  const openTask = (idOrTitle: string, ownerHint?: string) => {
    const rdTask = taskMap.get(idOrTitle);
    const blockedInfo = BLOCKED_TASKS.find((b) => b.task_id === idOrTitle);
    setSelectedTask(rdTask ? rdTaskToDetail(rdTask, blockedInfo) : makePlaceholderDetail(idOrTitle, ownerHint));
  };

  // Build task list for the selected category drawer (uses live task data)
  const categoryRelatedTasks = useMemo((): TaskDetail[] => {
    if (!selectedCategory) return [];
    const category = allCategories.find((cat) => cat.id === selectedCategory.id || cat.label === selectedCategory.label);
    return collectCategoryTasks(category).map((task) =>
      rdTaskToDetail(task, BLOCKED_TASKS.find((blocked) => blocked.task_id === task.task_id)),
    );
  }, [allCategories, selectedCategory, BLOCKED_TASKS]);

  const saveCategoryEditor = async (labelInput: string, childrenInput: string) => {
    const label = labelInput.trim();
    if (!label) {
      toast.error("请填写分类名称");
      return;
    }
    const childLabels = Array.from(
      new Set(
        childrenInput
          .split(/[\n,，;；]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    const labels = childLabels.length > 0 ? childLabels : ["默认子项"];

    const updated =
      categoryEditor?.mode === "edit" && categoryEditor.category
        ? allCategories.map((category) => {
            if (category.id !== categoryEditor.category?.id) return category;
            const nextChildren = labels.map((childLabel, index) => {
              const existing = category.children.find((child) => child.label === childLabel);
              return existing ?? { id: `${category.id}-child-${Date.now()}-${index}`, label: childLabel, tasks: [] };
            });
            const retainedWithTasks = category.children.filter((child) => {
              return !labels.includes(child.label) && collectRdTasks(child.tasks).some((task) => !task.archived);
            });
            return { ...category, label, children: [...nextChildren, ...retainedWithTasks] };
          })
        : [
            ...allCategories,
            {
              id: `rd-cat-${Date.now()}`,
              label,
              children: labels.map((childLabel, index) => ({
                id: `rd-sub-${Date.now()}-${index}`,
                label: childLabel,
                tasks: [],
              })),
            },
          ];

    await saveRdTaskCategories(updated);
    await recomputeRdDirectorDashboard().catch(() => {});
    setCategoryEditor(null);
    toast.success(categoryEditor?.mode === "edit" ? "分类已更新" : "分类已新增");
    reloadAll();
  };

  const deleteCategory = async (category: RdCategory) => {
    const updated = allCategories.filter((item) => item.id !== category.id);
    await saveRdTaskCategories(updated);
    await recomputeRdDirectorDashboard().catch(() => {});
    setCategoryDeleteTarget(null);
    toast.success("分类已删除");
    reloadAll();
  };

  const openCategoryReassign = (cat: CategoryProgress) => {
    const category = allCategories.find((item) => item.id === cat.id || item.label === cat.label);
    const tasks = collectCategoryTasks(category)
      .filter((task) => !task.archived && task.status !== "completed")
      .map(toReassignableTask);
    if (tasks.length === 0) {
      toast.info("该分类下暂无可转派任务");
      return;
    }
    setCategoryReassignTasks(tasks);
    setReassignInitialTaskId(null);
    setShowReassign(true);
  };

  const totalTasks = CATEGORY_PROGRESS.reduce((s, c) => s + c.total, 0);
  const totalCompleted = CATEGORY_PROGRESS.reduce((s, c) => s + c.completed, 0);
  const totalInProgress = CATEGORY_PROGRESS.reduce((s, c) => s + c.in_progress, 0);
  const totalBlocked = CATEGORY_PROGRESS.reduce((s, c) => s + c.blocked, 0);
  const overallRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;
  const isDashboardEmpty =
    !loading &&
    CATEGORY_PROGRESS.length === 0 &&
    PERSON_LOADS.length === 0 &&
    BLOCKED_TASKS.length === 0 &&
    PENDING_ASSIGN.length === 0;

  // ───── People management drill-down (hidden sub-page) ─────────────────────
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={DIRECTOR_PANEL_TRANSITION}
      className="min-h-full p-8"
    >
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">研发主管驾驶舱</h1>
            <p className="mt-0.5 text-sm text-slate-500">全局视图 · 高级权限专属 · 实时同步</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在同步
              </span>
            )}
            {loadError && !loading && (
              <button
                type="button"
                onClick={loadDashboard}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
              >
                接口读取失败，点击重试
              </button>
            )}
            {canReassignTasks && (
              <button
                onClick={() => {
                  setReassignInitialTaskId(null);
                  setCategoryReassignTasks(null);
                  setShowReassign(true);
                }}
                className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700 hover:shadow-[0_12px_24px_rgba(37,99,235,0.08)] active:translate-y-0 active:scale-[0.98]"
              >
                <Users className="h-4 w-4" />
                批量重分配
              </button>
            )}
            {canCreateTask && (
              <button
                onClick={() => setShowCreateTask(true)}
                className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_12px_24px_rgba(5,150,105,0.08)] active:translate-y-0 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                新建任务
              </button>
            )}
            {canClearData && (
              <button
                onClick={() => setShowClearData(true)}
                className="flex items-center gap-2 rounded-xl border border-red-100 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50/60 hover:shadow-[0_12px_24px_rgba(220,38,38,0.08)] active:translate-y-0 active:scale-[0.98]"
                title="需要清空研发任务数据权限"
              >
                <Trash2 className="h-4 w-4" />
                清空数据
              </button>
            )}
            {canDirectProject && (
              <button
                onClick={() => setShowProposalDialog(true)}
                className="group flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(99,102,241,0.28)] transition-all duration-150 hover:-translate-y-0.5 hover:from-violet-700 hover:to-blue-700 hover:shadow-[0_14px_28px_rgba(99,102,241,0.32)] active:translate-y-0 active:scale-[0.98]"
                title="拥有直接立项权限时可绕过审核流程"
              >
                <Sparkles className="h-4 w-4 transition-transform group-hover:rotate-12" />
                AI 立项
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
            {canManagePeople && (
              <button
                onClick={() => navigate("/rd-people-management")}
                className="group flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.24)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-[0_14px_28px_rgba(37,99,235,0.28)] active:translate-y-0 active:scale-[0.98]"
              >
                <UserCog className="h-4 w-4" />
                人员管理
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </div>

        {/* KPI Row — click to filter the task list below */}
        <div className="mb-5 grid grid-cols-4 gap-4">
          {([
            { key: "all", label: "总任务数", value: totalTasks, sub: "全部分类", color: "text-slate-800", ring: "ring-slate-300" },
            { key: "completed", label: "完成率", value: `${overallRate}%`, sub: `${totalCompleted} 已完成`, color: "text-emerald-600", ring: "ring-emerald-400" },
            { key: "in_progress", label: "进行中", value: totalInProgress, sub: "正常执行", color: "text-blue-600", ring: "ring-blue-400" },
            { key: "blocked", label: "阻塞/异常", value: totalBlocked, sub: "需要关注", color: "text-red-500", ring: "ring-red-400" },
          ] as const).map((kpi) => {
            const active = kpiFilter === kpi.key;
            return (
              <motion.button
                type="button"
                key={kpi.label}
                onClick={() => setKpiFilter(kpi.key)}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={DIRECTOR_PANEL_TRANSITION}
                whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                className={cn(
                  "rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-[0_14px_30px_rgba(15,23,42,0.07)]",
                  active
                    ? cn("border-transparent ring-2 ring-offset-1", kpi.ring)
                    : "border-white",
                )}
              >
                <div className={cn("text-3xl font-bold", kpi.color)}>{kpi.value}</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  {kpi.label}
                  {active && <span className="text-[10px] font-semibold text-blue-600">· 已筛选</span>}
                </div>
                <div className="text-xs text-slate-400">{kpi.sub}</div>
              </motion.button>
            );
          })}
        </div>

        {(loading || isDashboardEmpty) && (
          <div className="mb-5 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-center shadow-sm">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BarChart2 className="h-5 w-5" />}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-800">
              {loading ? "正在读取研发负责人看板" : "暂无负责人看板数据"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-400">
              {loading
                ? "正在从后端接口同步分类进度、人员负载、阻塞任务和待指派任务。"
                : "后端当前返回空数据，页面已保留完整结构，新增任务或导入研发数据后会自动呈现看板内容。"}
            </p>
            {loadError && (
              <p className="mt-2 text-xs text-amber-600">{loadError}</p>
            )}
            {!loading && (
              <button
                type="button"
                onClick={loadDashboard}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                重新读取
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-5">
          {/* Left: Category Progress + Bottlenecks */}
          <div className="col-span-2 space-y-5">
            {/* Task list — filterable by KPI cards above */}
            <div className="rounded-2xl border border-white bg-white/70 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <ListChecks className="h-4 w-4 text-blue-500" />
                    任务列表
                    <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-slate-600">
                      {filteredTasks.length}
                    </span>
                    {kpiFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setKpiFilter("all")}
                        className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        {kpiFilter === "completed" ? "已完成" : kpiFilter === "in_progress" ? "进行中" : "阻塞"}
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    点击上方 KPI 卡片可筛选 · 点击任意任务行查看详情
                  </p>
                </div>
                {/*<div className="flex items-center gap-2">*/}
                {/*  {canCreateTask && (*/}
                {/*    <button*/}
                {/*      type="button"*/}
                {/*      onClick={() => setCategoryEditor({ mode: "create" })}*/}
                {/*      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"*/}
                {/*    >*/}
                {/*      <Plus className="h-3.5 w-3.5" />*/}
                {/*      新增分类*/}
                {/*    </button>*/}
                {/*  )}*/}
                {/*</div>*/}
              </div>
              {filteredTasks.length === 0 ? (
                <DashboardEmptyPanel
                  title={loading ? "正在读取任务列表" : kpiFilter === "all" ? "暂无任务" : "该筛选下暂无任务"}
                  description={
                    loading
                      ? "请稍候，系统正在同步任务数据。"
                      : kpiFilter === "all"
                      ? "通过「AI 立项」或「新建任务」开始创建研发任务。"
                      : "尝试切换 KPI 卡片，或选择「总任务数」查看全部。"
                  }
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">任务</th>
                          <th className="px-3 py-2.5">负责人</th>
                          <th className="px-3 py-2.5">状态</th>
                          <th className="px-3 py-2.5">优先级</th>
                          <th className="px-3 py-2.5">进度</th>
                          <th className="px-3 py-2.5">截止</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white/70">
                        {taskListPaged.map((rdTask) => {
                          const sCfg = TASK_STATUS_CONFIG[rdTask.status] ?? TASK_STATUS_CONFIG.in_progress;
                          const pCfg = TASK_PRIORITY_CONFIG[rdTask.final_priority] ?? TASK_PRIORITY_CONFIG.medium;
                          return (
                            <tr
                              key={rdTask.task_id}
                              onClick={() => openTask(rdTask.task_id, rdTask.primary_owner)}
                              className="cursor-pointer transition-colors hover:bg-slate-50/80"
                            >
                              <td className="px-3 py-3">
                                <div className="max-w-[300px] truncate font-medium text-slate-800">{rdTask.title}</div>
                                <div className="mt-0.5 truncate text-[11px] text-slate-400">{rdTask.category_path}</div>
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-700">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openPersonByName(rdTask.primary_owner); }}
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {rdTask.primary_owner}
                                </button>
                              </td>
                              <td className="px-3 py-3">
                                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", sCfg.bg, sCfg.text)}>
                                  <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
                                  {sCfg.label}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", pCfg.bg, pCfg.text)}>
                                  {pCfg.label}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex min-w-[110px] items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.max(0, Math.min(100, rdTask.progress))}%` }} />
                                  </div>
                                  <span className="w-9 text-right text-xs tabular-nums text-slate-500">{rdTask.progress}%</span>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-[11px] tabular-nums text-slate-500">{rdTask.due_date || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white/80 px-3 py-2.5">
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {taskListRangeStart}
                      {" - "}
                      {Math.min(taskListSafePage * TASK_LIST_PAGE_SIZE, filteredTasks.length)}
                      <span className="mx-1 text-slate-300">/</span>
                      {filteredTasks.length}
                    </span>
                    <MiniPagination page={taskListSafePage} totalPages={taskListTotalPages} onChange={setTaskListPage} />
                  </div>
                </div>
              )}
            </div>

            {/* Bottlenecks */}
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  瓶颈识别 · 阻塞任务
                  <span className="rounded-full bg-orange-100 px-1.5 text-xs text-orange-700">{BLOCKED_TASKS.length}</span>
                </h2>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {blockedRangeStart}
                  {" - "}
                  {Math.min(blockedSafePage * BLOCKED_PAGE_SIZE, BLOCKED_TASKS.length)}
                  <span className="mx-1 text-slate-300">/</span>
                  {BLOCKED_TASKS.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {blockedPaged.length === 0 ? (
                  <DashboardEmptyPanel
                    title={loading ? "正在读取阻塞任务" : "暂无阻塞任务"}
                    description={loading ? "请稍候，系统正在同步异常任务。" : "当前没有阻塞或异常任务。"}
                  />
                ) : blockedPaged.map((t) => (
                    <div
                      key={t.task_id}
                      onClick={() => openTask(t.task_id, t.owner)}
                      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-orange-100 bg-white px-4 py-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_8px_20px_rgba(234,88,12,0.08)] active:translate-y-0"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-xs font-bold text-red-600 transition-transform group-hover:scale-105">
                        {t.days_blocked}天
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400">{t.task_id}</span>
                          <span className="text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          负责人: {t.owner} · 阻塞原因: {t.reason}
                        </div>
                      </div>
                      {canReassignTasks && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReassignInitialTaskId(t.task_id);
                            setCategoryReassignTasks(null);
                            setShowReassign(true);
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700 transition-all hover:bg-orange-100 active:scale-95"
                        >
                          转派
                          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              {BLOCKED_TASKS.length > 0 && (
                <MiniPagination
                  page={blockedSafePage}
                  totalPages={blockedTotalPages}
                  onChange={setBlockedPage}
                  className="mt-3 justify-end"
                />
              )}
            </div>

            {/* Daily reports */}
            <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <CalendarDays className="h-4 w-4 text-violet-500" />
                    研发日报
                    <span className="rounded-full bg-violet-100 px-1.5 text-xs text-violet-700">{dailyReports.length}</span>
                    {(reportDateFilter || reportUserFilter) && (
                      <button
                        type="button"
                        onClick={() => { setReportDateFilter(""); setReportUserFilter(""); }}
                        className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-200"
                      >
                        清除筛选
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    研发成员手动生成或每日 18:30 自动汇总 · 历史保存最近 1000 条
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={loadDailyReports}
                    disabled={dailyReportsLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:border-blue-200 hover:text-blue-600 disabled:opacity-50"
                  >
                    {dailyReportsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    刷新
                  </button>
                  {(canReassignTasks || canCreateTask) && (
                    <button
                      type="button"
                      disabled={regeneratingReports}
                      onClick={async () => {
                        setRegeneratingReports(true);
                        try {
                          const result = await regenerateAllRdDailyReports();
                          toast.success(`已为 ${result.count} 位成员生成 ${result.date} 日报`);
                          loadDailyReports();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "批量生成失败");
                        } finally {
                          setRegeneratingReports(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-all hover:bg-violet-700 disabled:opacity-60"
                    >
                      {regeneratingReports ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      立即汇总
                    </button>
                  )}
                </div>
              </div>

              {/* History filters */}
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-white/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <CalendarDays className="h-3 w-3" />
                  日期
                </div>
                <input
                  type="date"
                  value={reportDateFilter}
                  onChange={(e) => setReportDateFilter(e.target.value)}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
                <div className="ml-2 flex items-center gap-1 text-[10px]">
                  {[
                    { label: "今天", value: new Date().toISOString().slice(0, 10) },
                    {
                      label: "昨天",
                      value: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
                    },
                    {
                      label: "近 7 天",
                      value: "",
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        if (preset.label === "近 7 天") setReportDateFilter("");
                        else setReportDateFilter(preset.value);
                      }}
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium transition-colors",
                        reportDateFilter === preset.value
                          ? "bg-violet-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-700",
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-500">成员</span>
                  <select
                    value={reportUserFilter}
                    onChange={(e) => setReportUserFilter(e.target.value)}
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="">全部成员</option>
                    {reportUserOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {dailyReportsLoading ? (
                <DashboardEmptyPanel title="正在读取日报" description="请稍候，系统正在同步日报数据。" />
              ) : dailyReports.length === 0 ? (
                <DashboardEmptyPanel
                  title={reportDateFilter || reportUserFilter ? "该筛选下暂无日报" : "暂无日报"}
                  description={
                    reportDateFilter || reportUserFilter
                      ? "请尝试切换日期或成员；或点击「清除筛选」查看全部。"
                      : "研发成员点击「生成日报」或等待 18:30 自动生成后，会在这里展示。"
                  }
                />
              ) : (
                <div className="space-y-3">
                  {reportsByDate.map(([date, reportsInDate]) => (
                    <div key={date}>
                      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                        <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-violet-700">{date}</span>
                        <span className="text-slate-400">{reportsInDate.length} 份日报</span>
                      </div>
                      <ul className="space-y-2">
                        {reportsInDate.map((report) => {
                          const expanded = expandedReportId === report.id;
                          const s = report.summary.stats;
                          return (
                            <li
                              key={report.id}
                              className="overflow-hidden rounded-xl border border-violet-100 bg-white transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => setExpandedReportId(expanded ? null : report.id)}
                                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-violet-50/40"
                              >
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-bold text-violet-700">
                                  {report.user_name.slice(0, 1)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-sm font-semibold text-slate-800">{report.user_name}</span>
                                    <span className="text-xs tabular-nums text-slate-500">{report.date}</span>
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                        report.trigger === "cron"
                                          ? "bg-slate-100 text-slate-600"
                                          : "bg-blue-100 text-blue-700",
                                      )}
                                    >
                                      {report.trigger === "cron" ? "自动" : "手动"}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                    <span>任务 {s.total_tasks}</span>
                                    <span className="text-blue-600">进行中 {s.in_progress}</span>
                                    <span className="text-emerald-600">已完成 {s.completed}</span>
                                    {s.blocked > 0 && <span className="text-red-600">阻塞 {s.blocked}</span>}
                                    <span className="text-slate-400">·</span>
                                    <span>进度记录 {s.notes_count}</span>
                                  </div>
                                </div>
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                                    expanded && "rotate-90",
                                  )}
                                />
                              </button>
                        {expanded && (
                          <div className="border-t border-violet-100 bg-violet-50/30 px-4 py-3">
                            <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-6 text-slate-700">
                              {report.summary.text}
                            </pre>
                            {report.summary.note_refs.length > 0 && (
                              <div className="mt-3">
                                <div className="mb-1.5 text-[11px] font-semibold text-slate-500">关联进度记录</div>
                                <ul className="space-y-1">
                                  {report.summary.note_refs.map((ref) => {
                                    const note = progressNoteById.get(ref.note_id);
                                    const attachments = note?.attachments ?? [];
                                    return (
                                    <li key={ref.note_id} className="rounded-md bg-white px-2.5 py-1.5 text-[11px] text-slate-600 ring-1 ring-violet-100">
                                      <span className="font-mono text-slate-400">{ref.task_id}</span>
                                      <span className="mx-1.5 text-slate-300">·</span>
                                      {ref.progress != null && <span className="mr-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">进度 {ref.progress}%</span>}
                                      <span className="text-slate-700">{ref.excerpt || "—"}</span>
                                      {ref.attachments_count > 0 && (
                                        <span className="ml-1.5 text-[10px] text-violet-600">+{ref.attachments_count} 附件</span>
                                      )}
                                      {attachments.length > 0 && (
                                        <ProgressAttachmentGrid attachments={attachments} compact className="mt-2" />
                                      )}
                                    </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending Assign */}
            {(PENDING_ASSIGN.length > 0 || loading || isDashboardEmpty) && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Loader2 className="h-4 w-4 text-blue-500" />
                    待人工指派
                    <span className="rounded-full bg-blue-100 px-1.5 text-xs text-blue-700">{PENDING_ASSIGN.length}</span>
                  </h2>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {pendingRangeStart}
                    {" - "}
                    {Math.min(pendingSafePage * PENDING_PAGE_SIZE, PENDING_ASSIGN.length)}
                    <span className="mx-1 text-slate-300">/</span>
                    {PENDING_ASSIGN.length}
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">以下任务规则未能自动匹配责任人，请手动指派并补充映射规则</p>
                <div className="space-y-2">
                  {pendingPaged.length === 0 ? (
                    <DashboardEmptyPanel
                      title={loading ? "正在读取待指派任务" : "暂无待指派任务"}
                      description={loading ? "请稍候，系统正在同步任务分配状态。" : "当前没有需要人工指派的研发任务。"}
                    />
                  ) : pendingPaged.map((t) => {
                    const pCfg = PRIORITY_CONFIG[t.ai_priority] ?? PRIORITY_CONFIG.medium;
                    return (
                      <div
                        key={t.task_id}
                        onClick={() => openTask(t.task_id, "待指派")}
                        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_8px_20px_rgba(37,99,235,0.08)] active:translate-y-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-400">{t.task_id}</span>
                            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", pCfg.color)}>{pCfg.label}</span>
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</div>
                          <div className="text-xs text-slate-400">{t.category_path}</div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReassignInitialTaskId(t.task_id);
                            setCategoryReassignTasks(null);
                            setShowReassign(true);
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_16px_rgba(37,99,235,0.18)] transition-all hover:bg-blue-700 active:scale-95"
                        >
                          手动指派
                        </button>
                      </div>
                    );
                  })}
                </div>
                {PENDING_ASSIGN.length > 0 && (
                  <MiniPagination
                    page={pendingSafePage}
                    totalPages={pendingTotalPages}
                    onChange={setPendingPage}
                    className="mt-3 justify-end"
                  />
                )}
              </div>
            )}
          </div>

          {/* Right: Personnel Heatmap */}
          <div className="space-y-5">
            <div className="rounded-2xl border border-white bg-white/70 p-5 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Users className="h-4 w-4 text-slate-500" />
                  人员负载热力图
                  <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{PERSON_LOADS.length}</span>
                </h2>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {personRangeStart}
                  {" - "}
                  {Math.min(personSafePage * PERSON_PAGE_SIZE, PERSON_LOADS.length)}
                  <span className="mx-1 text-slate-300">/</span>
                  {PERSON_LOADS.length}
                </span>
              </div>
              <p className="mb-4 text-xs text-slate-400">点击查看个人详情和当前任务</p>
              <div className="space-y-2.5">
                {personPaged.length === 0 ? (
                  <DashboardEmptyPanel
                    title={loading ? "正在读取人员负载" : "暂无人员负载数据"}
                    description={loading ? "请稍候，系统正在同步研发成员任务负载。" : "请先维护研发成员，或等待任务数据同步后生成负载热力图。"}
                  />
                ) : personPaged.map((p) => (
                    <PersonCard key={p.id} person={p} selected={selectedPerson?.id === p.id} onSelect={setSelectedPerson} />
                  ))}
              </div>
              {PERSON_LOADS.length > 0 && (
                <MiniPagination
                  page={personSafePage}
                  totalPages={personTotalPages}
                  onChange={setPersonPage}
                  className="mt-3 justify-end"
                />
              )}

              <div className="mt-4 flex flex-wrap gap-2 text-[10px]">
                {[
                  { color: "bg-emerald-400", label: "< 50% 负载" },
                  { color: "bg-amber-400", label: "50–75%" },
                  { color: "bg-orange-400", label: "75–100%" },
                  { color: "bg-red-400", label: "超负荷" },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1 text-slate-400">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", l.color)} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Hint card: prompt user to click a person */}
            {!selectedPerson && PERSON_LOADS.length > 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/40 p-4 text-center">
                <p className="text-xs text-slate-400">点击左侧任意人员卡片，查看详细档案和任务列表</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals & Drawers */}
      {showReassign && canReassignTasks && (
        <BatchReassignModal
          tasks={categoryReassignTasks ?? REASSIGNABLE_TASKS}
          personLoads={PERSON_LOADS}
          initialTaskId={reassignInitialTaskId}
          initialTaskIds={categoryReassignTasks?.map((task) => task.task_id)}
          onUpdated={reloadAll}
          onClose={() => {
            setShowReassign(false);
            setReassignInitialTaskId(null);
            setCategoryReassignTasks(null);
          }}
        />
      )}
      {categoryEditor && (
        <CategoryEditorModal
          state={categoryEditor}
          onClose={() => setCategoryEditor(null)}
          onSave={saveCategoryEditor}
        />
      )}
      {categoryDeleteTarget && (
        <CategoryDeleteDialog
          category={categoryDeleteTarget}
          taskCount={categoryTaskCount(categoryDeleteTarget)}
          onClose={() => setCategoryDeleteTarget(null)}
          onConfirm={() => categoryDeleteTarget ? deleteCategory(categoryDeleteTarget) : undefined}
        />
      )}
      {selectedPerson && (
        <PersonDetailDrawer
          person={selectedPerson}
          onClose={() => setSelectedPerson(null)}
          onOpenTask={(id, hint) => openTask(id, hint)}
          taskMap={taskMap}
          onEditPerson={(p) => setEditingPerson(p)}
          onSendMessage={(p) => setMessageTarget(p)}
          onReassignPerson={(p) => {
            // Filter reassignable tasks down to this person and open the modal
            const personTasks = REASSIGNABLE_TASKS.filter((t) => t.owner === p.name);
            if (personTasks.length === 0) {
              toast.info(`${p.name} 当前没有可重分配的任务`);
              return;
            }
            setCategoryReassignTasks(personTasks);
            setReassignInitialTaskId(null);
            setSelectedPerson(null);
            setShowReassign(true);
          }}
        />
      )}
      {editingPerson && (
        <PersonEditModal
          person={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={() => {
            setEditingPerson(null);
            reloadAll();
          }}
        />
      )}
      {messageTarget && (
        <SendMessageModal
          recipient={messageTarget}
          onClose={() => setMessageTarget(null)}
          onSent={() => setMessageTarget(null)}
        />
      )}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onOpenPerson={openPersonByName}
          onUpdate={() => { setSelectedTask(null); reloadAll(); }}
          onDelete={() => { setSelectedTask(null); reloadAll(); }}
        />
      )}
      {selectedCategory && (
        <CategoryDetailDrawer
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
          onOpenTask={(id, hint) => {
            setSelectedCategory(null);
            openTask(id, hint);
          }}
          onOpenPerson={(name) => {
            setSelectedCategory(null);
            openPersonByName(name);
          }}
          onViewFullList={(category) => {
            setSelectedCategory(null);
            navigate(`/rd-task-management?view=board&category=${encodeURIComponent(category.id)}`);
          }}
          relatedTasks={categoryRelatedTasks}
        />
      )}

      {showCreateTask && canCreateTask && (
        <CreateTaskModalV2
          categories={allCategories}
          onClose={() => setShowCreateTask(false)}
          onCreate={() => { setShowCreateTask(false); reloadAll(); }}
        />
      )}
      {showClearData && canClearData && (
        <ClearDataDialog
          onClose={() => setShowClearData(false)}
          onCleared={() => {
            setShowClearData(false);
            setSelectedPerson(null);
            setSelectedTask(null);
            setSelectedCategory(null);
            reloadAll();
          }}
        />
      )}

      <RDProjectProposalDialog
        open={showProposalDialog && canDirectProject}
        onClose={() => setShowProposalDialog(false)}
        onCompleted={reloadAll}
        userRole="director"
      />
    </motion.div>
  );
}
