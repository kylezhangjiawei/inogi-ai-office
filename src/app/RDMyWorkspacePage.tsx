import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
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
  Flame,
  Folder,
  FolderOpen,
  FolderInput,
  GitBranch,
  Info,
  MessageSquare,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { MateChatStreakCardConnected } from "./components/matechat/MateChatStreakCardConnected";
import { RdCategoryTaskTable } from "./components/RdCategoryTaskTable";
import { RenewableImage } from "./components/RenewableImage";
import { refreshRdAttachment } from "./lib/attachmentAccess";
import { usePermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { RDTaskConversation } from "./RDTaskConversation";
import { AuditTimeline } from "./RDAuditTimeline";
import { ProgressAttachmentGrid, ProgressNoteList, formatTraceDateTime } from "./RDProgressEvidence";
import { syncAuditLogsFromRemote, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import { daysUntilDue, isTaskOverdue, taskOverdueDays, todayLocalDateStr } from "./lib/taskDue";
import { buildTaskTree, collectTaskTreeIds, filterTaskTree, type TaskTreeNode } from "./lib/taskTree";
import { workspaceTaskPreview } from "./lib/workspaceTaskPreview";
import {
  addRdNoteAttachments,
  assessRdTaskProgress,
  attachRdTaskToParent,
  detachRdSubtask,
  createRdTaskProgressNote,
  deleteRdNoteAttachment,
  fetchRdNoteUnreadSummary,
  markRdTaskNotesRead,
  replaceRdNoteAttachment,
  fetchProductTaskCategories,
  fetchRdPeople,
  isMentionablePerson,
  fetchRdProducts,
  fetchRdTaskCategories,
  fetchRdTaskAttachmentPreviews,
  fetchMergedTaskCategories,
  fetchRdPerformanceReports,
  fetchRdTaskProgressNotes,
  fetchRdWorkspace,
  parseRdDiscussionMention,
  patchRdMessage,
  prepareRdProgressNoteFiles,
  rdDiscussionMentionHref,
  updateRdTask,
  type RdAiProgressAssessment,
  type RdCategory,
  type RdCollaborator,
  type RdPersonLoad,
  type RdPriority,
  type RdProductDef,
  type RdSubProject,
  type RdTaskProgressAttachment,
  type RdTaskAttachmentPreview,
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
  getAttachmentThumbUrl,
  getAttachmentUrl,
  RD_DEFAULT_SUBPROJECT_LABEL,
  isProductionWorkspace,
} from "./lib/rdApi";
import { approveRdProcurementTransfer, rejectRdProcurementTransfer } from "./lib/procurementApi";
import { announceProcurementRefresh } from "./procurement/data";
import { ProcurementLinkChip, TransferToProcurementModal, useProcurementTaskLink } from "./procurement/components/rdInsertion";
import { SubtaskBadge } from "./RDTaskManagementPage";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { MentionSuggestionPanel, useMentions, type MentionCandidate } from "./components/MentionInput";
import { AutoTranslatedText } from "./components/TranslatableText";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import { toast } from "sonner";
import { ProcSampleTestMessageCard } from "./components/ProcSampleTestMessageCard";
import { ProcTransferReturnedMessageCard } from "./components/ProcTransferReturnedMessageCard";
import { parseProcurementTransferReturnedMessage, transferReturnedMessageSummary } from "./lib/procurementTransferReturnedMessage";
import { parseProcurementSampleTestMessage, sampleTestMessageSummary, withoutSampleTestQuery } from "./lib/procurementSampleTestMessage";
import { ProcSampleTestDialog } from "./procurement/components/ProcSampleTestDialog";

type Priority = RdPriority;
type TaskStatus = RdTaskStatus;
type WorkspaceRoleTab = "primary" | "collaborator";
type OperationTab = "detail" | "discussion" | "progress" | "handoff" | "submit";
type WorkspaceTask = RdWorkspaceTask;
type AiSuggestion = RdAiSuggestion;
type WorkspaceNotification = RdWorkspaceNotification;

type ActivePanel =
  | { kind: "task"; task: WorkspaceTask; tab: OperationTab; openedAt: number; abandon?: boolean; transfer?: boolean }
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

const WORKSPACE_MODAL_FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const WORKSPACE_NESTED_PORTAL_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(",");

type WorkspaceModalLayer = {
  token: symbol;
  element: HTMLElement;
  initialFocus: HTMLElement | null;
  restoreFocus: HTMLElement | null;
};

type WorkspaceInertState = {
  count: number;
  inert: boolean;
  ariaHidden: string | null;
};

type WorkspaceScrollLockState = {
  count: number;
  overflowY: string;
};

/**
 * Drawer 与确认弹窗可以嵌套出现。共享栈与引用计数可确保：
 * - 只有最上层响应 Tab / Escape；
 * - 下层弹层与全局外壳在上层关闭前保持 inert；
 * - 任意关闭顺序都不会提前解除滚动锁或把焦点送回已经卸载的节点。
 */
const workspaceModalLayers: WorkspaceModalLayer[] = [];
const workspaceInertStates = new Map<HTMLElement, WorkspaceInertState>();
const workspaceScrollLockStates = new Map<HTMLElement, WorkspaceScrollLockState>();

function workspaceFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(WORKSPACE_MODAL_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[inert]") || element.getAttribute("aria-hidden") === "true") return false;
    return element.getClientRects().length > 0;
  });
}

function canRestoreWorkspaceFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element
      && element.isConnected
      && !element.closest("[inert]")
      && !element.hasAttribute("disabled")
      && element.getClientRects().length > 0,
  );
}

function workspaceBackgroundBranches(layer: HTMLElement): HTMLElement[] {
  const branches = new Set<HTMLElement>();
  let activeBranch: HTMLElement = layer;

  while (activeBranch.parentElement) {
    const parent = activeBranch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== activeBranch && sibling instanceof HTMLElement) branches.add(sibling);
    }
    if (parent === document.body) break;
    activeBranch = parent;
  }

  return Array.from(branches);
}

function retainWorkspaceInert(element: HTMLElement) {
  const current = workspaceInertStates.get(element);
  if (current) {
    current.count += 1;
  } else {
    workspaceInertStates.set(element, {
      count: 1,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    });
  }
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}

function releaseWorkspaceInert(element: HTMLElement) {
  const current = workspaceInertStates.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;

  element.inert = current.inert;
  if (current.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", current.ariaHidden);
  workspaceInertStates.delete(element);
}

function workspaceScrollContainers(layer: HTMLElement): HTMLElement[] {
  const containers = new Set<HTMLElement>([document.documentElement, document.body]);
  let ancestor = layer.parentElement;
  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor);
    if (/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)) containers.add(ancestor);
    ancestor = ancestor.parentElement;
  }
  return Array.from(containers);
}

function retainWorkspaceScrollLock(element: HTMLElement) {
  const current = workspaceScrollLockStates.get(element);
  if (current) {
    current.count += 1;
  } else {
    workspaceScrollLockStates.set(element, { count: 1, overflowY: element.style.overflowY });
  }
  element.style.overflowY = "hidden";
}

function releaseWorkspaceScrollLock(element: HTMLElement) {
  const current = workspaceScrollLockStates.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;
  element.style.overflowY = current.overflowY;
  workspaceScrollLockStates.delete(element);
}

function focusBelongsToNestedWorkspacePortal(layer: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || layer.contains(active)) return false;
  const modal = active.closest<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
  if (modal && modal !== layer) return true;
  return Boolean(active.closest(WORKSPACE_NESTED_PORTAL_SELECTOR));
}

function hasExternalModalDialog(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')).some(
    (dialog) => dialog.isConnected && dialog.getClientRects().length > 0,
  );
}

function useWorkspaceModalLayer<TLayer extends HTMLElement, TInitial extends HTMLElement>(
  layerRef: React.RefObject<TLayer | null>,
  initialFocusRef: React.RefObject<TInitial | null>,
  onDismiss: () => void,
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  React.useLayoutEffect(() => {
    const element = layerRef.current;
    if (!element) return undefined;

    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = initialFocusRef.current ?? workspaceFocusableElements(element)[0] ?? element;
    const layer: WorkspaceModalLayer = {
      token: Symbol("rd-workspace-modal-layer"),
      element,
      initialFocus,
      restoreFocus,
    };
    workspaceModalLayers.push(layer);

    // 先移动焦点，再隐藏原焦点所在背景，避免 aria-hidden 包含当前焦点的浏览器警告。
    initialFocus.focus({ preventScroll: true });

    const inerted = workspaceBackgroundBranches(element);
    inerted.forEach(retainWorkspaceInert);
    const locked = workspaceScrollContainers(element);
    locked.forEach(retainWorkspaceScrollLock);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (workspaceModalLayers.at(-1)?.token !== layer.token || event.defaultPrevented) return;
      if (focusBelongsToNestedWorkspacePortal(element)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = workspaceFocusableElements(element);
      if (focusable.length === 0) {
        event.preventDefault();
        element.focus({ preventScroll: true });
        return;
      }

      const active = document.activeElement;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (active === first || !element.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !element.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      const layerIndex = workspaceModalLayers.findIndex((item) => item.token === layer.token);
      const wasTopLayer = layerIndex === workspaceModalLayers.length - 1;
      if (layerIndex >= 0) {
        // 若底层抽屉先被业务动作关闭，把焦点归还链交给仍在其上方的确认弹窗。
        for (const upperLayer of workspaceModalLayers.slice(layerIndex + 1)) {
          if (!upperLayer.restoreFocus?.isConnected || element.contains(upperLayer.restoreFocus)) {
            upperLayer.restoreFocus = layer.restoreFocus;
          }
        }
        workspaceModalLayers.splice(layerIndex, 1);
      }

      inerted.forEach(releaseWorkspaceInert);
      locked.forEach(releaseWorkspaceScrollLock);

      if (!wasTopLayer) return;
      window.requestAnimationFrame(() => {
        const currentLayer = workspaceModalLayers.at(-1);
        if (currentLayer) {
          const target = canRestoreWorkspaceFocus(layer.restoreFocus) && currentLayer.element.contains(layer.restoreFocus)
            ? layer.restoreFocus
            : canRestoreWorkspaceFocus(currentLayer.initialFocus)
              ? currentLayer.initialFocus
              : workspaceFocusableElements(currentLayer.element)[0] ?? currentLayer.element;
          target.focus({ preventScroll: true });
          return;
        }

        // 让同时打开的 Radix 等外部模态层自行接管焦点，不把焦点抢回背景。
        if (!hasExternalModalDialog() && canRestoreWorkspaceFocus(layer.restoreFocus)) {
          layer.restoreFocus.focus({ preventScroll: true });
        }
      });
    };
  }, [initialFocusRef, layerRef]);
}

/** 「今日」标签。函数而非常量：跨零点要跟着变，且必须取本地日历日（详见 lib/taskDue.ts）。 */
const todayLabel = () => todayLocalDateStr();
/** 附件操作类审计动作（时间线上归位展示到所属进展条目下，不再顶层平铺） */
const ATTACHMENT_OP_ACTIONS: ReadonlySet<string> = new Set([
  "task.attachment_added",
  "task.attachment_removed",
  "task.attachment_replaced",
]);

const NOTE_ATTACHMENT_MAX_FILES = 10;
const NOTE_ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const NOTE_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const RD_TASK_TREE_MAX_DEPTH = 5;
type WorkspaceDueFilter = "all" | "overdue" | "today" | "3d" | "7d" | "no_due";

function workspaceTaskIdentity(task: Pick<WorkspaceTask, "task_id" | "source_workspace">): string {
  return `${task.source_workspace ?? (isUsCollabWorkspace() ? "us-collab" : "rd")}:${task.task_id}`;
}

/** 与 isTaskOverdue 同源，避免同一行 KPI 里两个「今天」互相矛盾。 */
function workspaceDaysUntil(dateStr?: string): number | null {
  return daysUntilDue(dateStr);
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

const REVIEW_NOTIFICATION_PATCH_RETRY_DELAYS = [0, 250, 750] as const;

function isReviewAlreadySettledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /不是待审核状态|不处于待审核状态|没有待处理的审核|请勿重复审核|已被其他审核人处理|仅「待研发审核」的转采购申请可(?:审核通过|打回)|(?:研发|采购)?任务不存在|未找到.*采购任务/.test(message);
}

async function patchReviewNotificationHandled(notificationId: string): Promise<boolean> {
  for (const delayMs of REVIEW_NOTIFICATION_PATCH_RETRY_DELAYS) {
    if (delayMs > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    try {
      await patchRdMessage(notificationId, { handled: true, read: true });
      return true;
    } catch {
      // 审核结果已生效时，通知回写是独立的收尾步骤；短暂网络失败继续有限重试。
    }
  }
  return false;
}

function retryReviewNotificationHandledLater(notificationId: string): void {
  window.setTimeout(() => {
    void patchReviewNotificationHandled(notificationId).then((synced) => {
      if (synced) window.dispatchEvent(new CustomEvent("rd:messages-updated"));
    });
  }, 3_000);
}

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
  high: { label: "高", className: "border-rose-100 bg-rose-50 text-rose-600" },
  medium: { label: "中", className: "border-amber-100 bg-amber-50 text-amber-700" },
  low: { label: "低", className: "border-slate-100 bg-slate-50 text-slate-500" },
};

const STATUS_CONFIG: Record<TaskStatus, { className: string; dot: string }> = {
  draft:          { className: "bg-slate-50 text-slate-500",   dot: "bg-slate-400" },
  in_progress:    { className: "bg-accent text-primary-hover",     dot: "bg-primary" },
  pending_review: { className: "bg-accent text-primary-hover", dot: "bg-primary" },
  paused_leave:   { className: "bg-amber-50 text-amber-700",   dot: "bg-amber-500" },
  paused_blocked: { className: "bg-rose-50 text-rose-700",       dot: "bg-rose-500" },
  on_hold:        { className: "bg-amber-50 text-amber-600",   dot: "bg-amber-400" },
  completed:      { className: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  pending_assign: { className: "bg-accent text-primary", dot: "bg-[#5f7fd3]" },
  archived:       { className: "bg-slate-50 text-muted-foreground",   dot: "bg-slate-300" },
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
          value >= 80 ? "bg-emerald-400" : value >= 45 ? "bg-[#5f7fd3]" : value > 0 ? "bg-amber-400" : "bg-slate-300",
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
    <section className="rd-horizon-workspace-section rounded-2xl border border-white bg-white/75 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.045)]">
      <div className="rd-horizon-workspace-section-heading mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon className="h-4 w-4 text-slate-500" />
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-500">{count}</span>
          )}
        </h2>
        {helper && <span className="hidden text-xs text-muted-foreground md:inline">{helper}</span>}
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
  buttonRef,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Button variant="unstyled"
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        variant === "primary" && "bg-primary text-white shadow-[0_8px_18px_rgba(var(--primary-rgb),0.20)] hover:bg-primary-hover",
        variant === "secondary" && "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        variant === "ghost" && "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        variant === "danger" && "border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100",
        className,
      )}
    >
      {children}
    </Button>
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const requestClose = () => {
    if (!confirming) onCancel();
  };
  useWorkspaceModalLayer(surfaceRef, cancelButtonRef, requestClose);

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
      className="rd-horizon-workspace-confirm-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 px-4"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-busy={confirming}
        aria-labelledby="rd-workspace-confirm-title"
        aria-describedby="rd-workspace-confirm-description"
        tabIndex={-1}
        className="rd-horizon-workspace-confirm-surface w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]"
        initial={shouldReduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              isDanger ? "bg-rose-50 text-rose-600" : "bg-accent text-primary",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="rd-workspace-confirm-title" className="text-base font-semibold text-slate-950">
              {config.title}
            </h2>
            <p id="rd-workspace-confirm-description" className="mt-1 text-sm leading-6 text-slate-600">{config.message}</p>
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={requestClose}
            disabled={confirming}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("关闭确认弹窗")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {config.details && config.details.length > 0 && (
          <div className="px-5 pt-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <ul className="space-y-1.5">
                {config.details.map((detail) => (
                  <li key={detail} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                    <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <ActionButton buttonRef={cancelButtonRef} onClick={requestClose} disabled={confirming}>{config.cancelLabel ?? t("取消")}</ActionButton>
          <Button variant="unstyled"
            type="button"
            onClick={confirm}
            disabled={confirming}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
              isDanger
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-200"
                : "bg-primary hover:bg-primary-hover focus-visible:ring-[#cbd8f6]",
            )}
          >
            {confirming ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {confirming ? t("处理中...") : config.confirmLabel}
          </Button>
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
        "group rounded-xl border bg-white px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.035)] transition-colors duration-200 hover:shadow-[0_16px_34px_rgba(15,23,42,0.07)]",
        task.on_leave ? "border-amber-100 bg-amber-50/40" : task.status === "paused_blocked" ? "border-rose-100 bg-rose-50/30" : "border-slate-200/80",
      )}
    >
      <Button variant="unstyled"
        type="button"
        onClick={() => onOpen(task, "detail")}
        className="block w-full cursor-pointer text-left focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{task.task_id}</span>
              <StatusPill task={task} />
              {task.ai_pending && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#dce5fa] bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
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
            <span className="min-w-0 truncate text-muted-foreground">{task.category_path}</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500">{task.progress}%</span>
        </div>
      </Button>

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
            step.state === "current" && "border-[#cbd8f6] bg-accent",
            step.state === "done" && "border-emerald-100 bg-emerald-50",
            step.state === "todo" && "border-slate-200 bg-slate-50",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                step.state === "current" && "bg-primary text-white",
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
  const surfaceRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  useWorkspaceModalLayer(surfaceRef, closeButtonRef, onClose);

  return (
    <div className="rd-horizon-workspace-drawer-backdrop fixed inset-0 z-50 flex justify-end bg-slate-950/20">
      <aside
        ref={surfaceRef}
        className="rd-horizon-workspace-drawer-surface flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="rd-horizon-workspace-drawer-header flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-semibold text-slate-950">{title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <Button variant="unstyled"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("关闭")}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="rd-horizon-workspace-drawer-body flex-1 overflow-y-auto px-6 py-5">{children}</div>
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
  onTaskChanged,
  onSubtaskChanged,
  autoAbandon,
  autoTransfer,
}: {
  task: WorkspaceTask;
  initialTab: OperationTab;
  onClose: () => void;
  onProgressSave: (taskId: string, progress: number) => void | Promise<void>;
  onLog: (message: string) => void;
  onRequestConfirm: (config: ConfirmDialogConfig) => void;
  onSubmittedForReview: (taskId: string, options?: { progress?: number }) => void | Promise<void>;
  onCollaborationChanged: (taskId: string, collaborators: RdCollaborator[], status?: TaskStatus) => void | Promise<void>;
  onTaskChanged: () => void | Promise<void>;
  /** 并入/取消子任务后：任务在树中的位置变了，只能整表重拉（无法局部乐观更新）。 */
  onSubtaskChanged: (taskId: string) => void | Promise<void>;
  autoAbandon?: boolean;
  autoTransfer?: boolean;
}) {
  useI18n(); // 订阅语言切换（抽屉 Tab/流程步骤/表单文案已 t() 化）
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const directTaskChanges = !isUsCollabWorkspace() && !isProductionWorkspace();
  const directChangePending = directTaskChanges && task.status === "pending_review"
    && ["proposal", "collaboration", "due_date", "merge"].includes(task.pending_review_type ?? "");
  // 已完成任务只读：仅保留「任务详情」页签，屏蔽进度/移交/提交等会改状态的操作。
  const isTaskCompleted = task.status === "completed";
  const [tab, setTab] = useState<OperationTab>(isTaskCompleted || directChangePending ? "detail" : initialTab);
  const [draftProgress, setDraftProgress] = useState(() => clampProgressValue(task.progress));
  const [note, setNote] = useState("");
  const [aiAssessment, setAiAssessment] = useState<ProgressAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [noteAttachments, setNoteAttachments] = useState<File[]>([]);
  const [preparingNoteFiles, setPreparingNoteFiles] = useState(false);
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
    push(task.owner, task.owner_user_id, t("主责人"));
    for (const c of task.collaborators ?? []) push(c.name, c.user_id, t("协作人"));
    // 只在 @ 候选里排除离职/停用；协作人选择等其他用途仍用完整名单
    for (const p of peopleOptions.filter(isMentionablePerson)) push(p.name, p.user_id ?? null);
    return out;
  }, [task.owner, task.owner_user_id, task.collaborators, peopleOptions]);
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
  // 并入为子任务（免审批直接生效）。命名保留 attach 前缀，与后端 attach-parent / 详情页同语义。
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachReason, setAttachReason] = useState("");
  const [attachTargetId, setAttachTargetId] = useState("");
  const [attachSearch, setAttachSearch] = useState("");
  const [attachSubmitting, setAttachSubmitting] = useState(false);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachCandidates, setAttachCandidates] = useState<Array<{ task_id: string; title: string; primary_owner: string }>>([]);
  const [detaching, setDetaching] = useState(false);
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const [progressNotes, setProgressNotes] = useState<RdTaskProgressNote[]>([]);
  const [progressNotesReloadKey, setProgressNotesReloadKey] = useState(0);
  const [discussionUnread, setDiscussionUnread] = useState(0);
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
    setAttachmentBusy(true);
    try {
      const prepared = await prepareRdProgressNoteFiles(files);
      const oversized = prepared.files.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
      if (oversized) throw new Error(t("附件 {name} 超过单文件 25MB 限制", { name: oversized.name }));
      const totalBytes = note.attachments.reduce((sum, a) => sum + (a.size ?? 0), 0)
        + prepared.files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
        throw new Error(t("附件总大小超过单条留痕 50MB 限制"));
      }
      const updated = await addRdNoteAttachments(task.task_id, note.id, prepared.files);
      applyUpdatedNote(updated);
      toast.success(prepared.compressedCount > 0
        ? t("已新增 {n} 个附件，其中 {count} 张图片已自动压缩", { n: files.length, count: prepared.compressedCount })
        : t("已新增 {n} 个附件", { n: files.length }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件新增失败");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleReplaceAttachmentFile = async (note: RdTaskProgressNote, att: RdTaskProgressAttachment, file: File) => {
    if (attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const prepared = await prepareRdProgressNoteFiles([file]);
      const nextFile = prepared.files[0]!;
      if (nextFile.size > NOTE_ATTACHMENT_MAX_FILE_BYTES) {
        throw new Error(t("附件 {name} 超过单文件 25MB 限制", { name: nextFile.name }));
      }
      const updated = await replaceRdNoteAttachment(task.task_id, note.id, att.id, nextFile);
      applyUpdatedNote(updated);
      toast.success(prepared.compressedCount > 0 ? t("附件已替换，图片已自动压缩") : t("附件已替换"));
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

  const canApplyCollaborationDirectly = directTaskChanges || canDirectProject || canReviewProjectL1 || canReviewProjectL2 || canReassignTask || canManagePeople;
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

  const tabConfig: { key: OperationTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { key: "detail", label: t("任务详情"), icon: FileText },
    { key: "discussion", label: t("任务讨论"), icon: MessageSquare, count: discussionUnread },
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
          { label: canApplyCollaborationDirectly ? t("直接生效") : t("提交审批"), helper: canApplyCollaborationDirectly ? t("保存后更新协同人") : t("流转给主管审核"), state: "todo" as const },
        ]
      : tab === "submit"
        ? [
            { label: t("整理交付物"), helper: t("确认资料完整"), state: "current" as const },
            { label: t("风险自检"), helper: t("检查阻塞和遗漏"), state: "todo" as const },
            { label: t("提交审核"), helper: t("流转给上级"), state: "todo" as const },
          ]
        : [
            { label: t("填写进展"), helper: t("更新百分比和说明"), state: "done" as const },
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
            ...(!directTaskChanges ? {
              pending_review_type: null,
              pending_collaborators: [],
              pending_collaboration_reason: null,
              pending_collaboration_requested_at: null,
            } : {}),
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
        toast.success(`${task.task_id} 已提交成果验收`);
        onLog(`${task.task_id} 已提交成果验收`);
        window.dispatchEvent(new CustomEvent('rd:review-submitted'));
        await onSubmittedForReview(task.task_id, { progress: 100 });
        onClose();
      },
    });
  };

  // 研发直接保存截止日期；协同与生产工作区保留原审核流程。
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
    if (!directTaskChanges && !dueDateReason.trim()) {
      toast.error(t("请填写修改原因，便于管理员审核"));
      return;
    }
    onRequestConfirm({
      title: t(directTaskChanges ? "确认修改截止日期" : "确认提交截止日期变更审核"),
      message: t(directTaskChanges ? "将更新 {taskId} 的截止日期。" : "将把 {taskId} 的截止日期变更提交给管理员审核。", { taskId: task.task_id }),
      confirmLabel: t(directTaskChanges ? "保存日期" : "提交审核"),
      details: [
        t("当前截止日期：{date}", { date: current || t("未设置") }),
        t("申请变更为：{date}", { date: next }),
        t(directTaskChanges ? "保存后截止日期立即更新" : "审核通过后截止日期才会更新，任务回到进行中"),
        ...(dueDateReason.trim() ? [t("修改原因：{reason}", { reason: dueDateReason.trim() })] : []),
      ],
      onConfirm: async () => {
        if (directTaskChanges) {
          await updateRdTask(task.task_id, { due_date: next });
          toast.success(t("截止日期已更新"));
          onLog(`${task.task_id} 截止日期已更新`);
          await onTaskChanged();
          onClose();
          return;
        }
        await updateRdTask(task.task_id, {
          status: "pending_review",
          pending_review_type: "due_date",
          pending_due_date: next,
          pending_due_date_reason: dueDateReason.trim(),
          pending_due_date_requested_at: new Date().toISOString(),
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

  // 转采购：与任务详情页同一套权限（proc-task:transfer 操作码）与弹窗。提交后先经
  // 研发管理员审核（rd-procurement:review），通过才流转采购并分配采购负责人。仅研发工作台可见。
  const navigate = useNavigate();
  const canTransferProcPermission = usePermission("proc-task:transfer");
  const { task: procTask, setTask: setProcTask } = useProcurementTaskLink(isUsCollabWorkspace() ? undefined : task.task_id);
  // 已取消的关联（含审核驳回落 cancelled 的）不挡重提，与详情页口径一致。
  const procTaskBlocksTransfer = Boolean(procTask) && procTask?.status !== "cancelled";
  const canTransferProc = !isUsCollabWorkspace() && canTransferProcPermission && !isTaskCompleted;
  const [transferOpen, setTransferOpen] = useState(false);
  /** 转采购弹窗默认带入的任务附件（全部进度留痕附件拍平），与详情页同源。 */
  const transferAttachments = useMemo(
    () => progressNotes.flatMap((note) => note.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mime,
      fileUrl: getAttachmentUrl(a),
      fileKey: a.object_key,
    }))).filter((attachment) => Boolean(attachment.fileUrl)),
    [progressNotes],
  );
  // 关联晚到时由弹窗阻止重复生成，保留正在填写的需求并沿用关闭确认。

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

  // ── 子任务树关系（免审批直接生效） ──────────────────────────────────────
  // 本任务是否已是子任务 / 是否带子任务。父子关系由服务端按结构位置下发，不回读字段。
  const isSubtask = Boolean(task.parent_task_id);
  const childSubtasks = task.subtasks ?? [];
  const isTaskActive = ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);
  /**
   * 可并入：主责人 + 活跃状态（与放弃同门控），且本任务当前是顶层任务。
   * 本任务可以自带完整子任务树；并入后原层级保持不变。
   */
  const canAttachSubtask = task.role === "primary" && isTaskActive && !isSubtask;
  /** 可取消关系：主责人 + 本任务确实是子任务（已完成/归档任务不再改结构）。 */
  const canDetachSubtask = task.role === "primary" && isTaskActive && isSubtask;

  // 打开并入弹窗时拉取候选父任务（全部产品库展平）。
  // 候选父任务允许已有子任务，但自身必须仍是顶层；源任务也必须是顶层，因此不会形成循环。
  // 此处只排除：本任务自身 / 已归档 / 已完成。子任务不会出现在候选里——只遍历顶层。
  useEffect(() => {
    if (!attachOpen) return;
    let alive = true;
    setAttachLoading(true);
    fetchMergedTaskCategories()
      .then((cats) => {
        const out: Array<{ task_id: string; title: string; primary_owner: string }> = [];
        // 仅遍历顶层任务、不下钻 subtasks：当前入口只允许选择顶层目标，避免形成循环挂载。
        const collectTopLevel = (tasks: unknown): void => {
          for (const item of Array.isArray(tasks) ? tasks : []) {
            const rec = item as { task_id?: string; title?: string; primary_owner?: string; archived?: boolean; status?: string };
            if (!rec?.task_id || rec.task_id === task.task_id) continue;
            if (rec.archived || rec.status === "completed" || rec.status === "archived") continue;
            out.push({ task_id: rec.task_id, title: rec.title ?? t("(无标题)"), primary_owner: rec.primary_owner ?? "" });
          }
        };
        for (const c of Array.isArray(cats) ? cats : []) {
          for (const ch of Array.isArray((c as { children?: unknown }).children) ? (c as { children: unknown[] }).children : []) {
            collectTopLevel((ch as { tasks?: unknown }).tasks);
          }
        }
        if (alive) setAttachCandidates(out);
      })
      .catch(() => {
        if (alive) setAttachCandidates([]);
      })
      .finally(() => {
        if (alive) setAttachLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attachOpen, task.task_id]);

  /** 并入为子任务：直接生效，不再提交审批。留痕口径与详情页 handleAttachSubtasks 一致。 */
  const submitAttachSubtask = async () => {
    if (!attachTargetId) {
      toast.error(t("请选择要并入的目标任务"));
      return;
    }
    setAttachSubmitting(true);
    try {
      await attachRdTaskToParent(task.task_id, attachTargetId);
      const target = attachCandidates.find((c) => c.task_id === attachTargetId);
      toast.success(t("已并入目标任务，成为其子任务"));
      onLog(`${task.task_id} 已并入 ${attachTargetId} 成为子任务`);
      setAttachOpen(false);
      await onSubtaskChanged(task.task_id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("并入失败，请重试"));
      setAttachSubmitting(false);
    }
  };

  /** 取消子任务关系：提升为顶层任务（落在原父任务所在子项目，与父任务同级）。 */
  const handleDetachSubtask = async () => {
    if (detaching) return;
    setDetaching(true);
    try {
      await detachRdSubtask(task.task_id);
      toast.success(t("已取消子任务关系，该任务已提升为独立任务"));
      onLog(`${task.task_id} 已取消子任务关系`);
      await onSubtaskChanged(task.task_id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("取消子任务关系失败，请重试"));
      setDetaching(false);
    }
  };

  // ── 进度附件入列：文件选择 / 拖拽 / 粘贴三处共用同一套校验，避免重复 ──
  const addNoteFiles = async (incoming: File[]) => {
    const files = incoming.filter((f) => f.size > 0);
    if (files.length === 0 || preparingNoteFiles) return;
    if (noteAttachments.length >= NOTE_ATTACHMENT_MAX_FILES) {
      toast.error(`最多上传 ${NOTE_ATTACHMENT_MAX_FILES} 个附件`);
      return;
    }
    setPreparingNoteFiles(true);
    try {
      const prepared = await prepareRdProgressNoteFiles(files);
      const oversized = prepared.files.find((file) => file.size > NOTE_ATTACHMENT_MAX_FILE_BYTES);
      if (oversized) {
        toast.error(`${oversized.name || "文件"} 超过单文件 25MB 限制`);
        return;
      }
      const merged = [...noteAttachments, ...prepared.files].slice(0, NOTE_ATTACHMENT_MAX_FILES);
      if (merged.reduce((sum, file) => sum + file.size, 0) > NOTE_ATTACHMENT_MAX_TOTAL_BYTES) {
        toast.error(t("附件总大小不能超过 50MB"));
        return;
      }
      const added = merged.length - noteAttachments.length;
      setNoteAttachments(merged);
      if (added > 0) {
        toast.success(prepared.compressedCount > 0
          ? t("已添加 {n} 个附件，其中 {count} 张图片已自动压缩", { n: added, count: prepared.compressedCount })
          : `已添加 ${added} 个附件`);
      }
      if (added < prepared.files.length) toast.error(`超出 ${NOTE_ATTACHMENT_MAX_FILES} 个上限，部分文件未添加`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("图片压缩失败"));
    } finally {
      setPreparingNoteFiles(false);
    }
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
    if (savingNote || aiLoading || preparingNoteFiles) return;
    const files = extractDataTransferFiles(e.clipboardData?.items);
    if (files.length > 0) {
      e.preventDefault(); // 仅在含文件时拦截，纯文本粘贴保持默认行为
      void addNoteFiles(files);
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

  // 从任务卡片「转采购」进入：挂载即弹出转采购弹窗（与「申请放弃」同一联动模式）。
  // 此刻采购关联可能尚未查回；若稍后查到在途关联，上方 effect 会自动收起弹窗。
  useEffect(() => {
    if (autoTransfer && canTransferProc) setTransferOpen(true);
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
        ) : !directChangePending && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
              {tabConfig.map((item) => (
                <Button variant="unstyled"
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(item.key);
                    setReceipt(null);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                    tab === item.key
                      ? "border-[#cbd8f6] bg-accent text-primary-hover shadow-[0_8px_18px_rgba(var(--primary-rgb),0.08)]"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                  {item.count != null && item.count > 0 && (
                    <span className="min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] leading-4 text-white">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  )}
                </Button>
              ))}
            </div>

            {tab !== "discussion" && <FlowSteps steps={flowSteps} />}
          </>
        )}

        {receipt && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{receipt}</span>
          </div>
        )}

        {directChangePending && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#cbd8f6] bg-accent px-4 py-3">
            <p className="text-sm text-primary-hover">{t("此变更已无需审核，可直接应用此前提交的申请。")}</p>
            <ActionButton variant="primary" onClick={() => onRequestConfirm({
              title: t("应用变更"),
              message: t("将应用 {taskId} 此前提交的变更。", { taskId: task.task_id }),
              confirmLabel: t("应用变更"),
              onConfirm: async () => {
                await updateRdTask(task.task_id, { _review_action: "approve" } as Parameters<typeof updateRdTask>[1]);
                toast.success(t("变更已应用"));
                await onTaskChanged();
                onClose();
              },
            })}>{t("应用变更")}</ActionButton>
          </div>
        )}

        {tab === "detail" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-muted-foreground">{t("状态")}</div>
                <div className="mt-1"><StatusPill task={task} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-muted-foreground">{t("优先级")}</div>
                <div className="mt-1"><PriorityBadge priority={task.priority} /></div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">{t("截止日期")}</div>
                  {isTaskCompleted || directChangePending ? null : dueDateChangePending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("变更审核中")}</span>
                  ) : (
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => {
                        setDraftDueDate(toDateInputValue(task.due_date));
                        setDueDateReason("");
                        setEditingDueDate((prev) => !prev);
                      }}
                      className="cursor-pointer text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover"
                    >
                      {editingDueDate ? t("取消") : t("修改")}
                    </Button>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.due_date}</div>
              </div>
            </div>

            {!isUsCollabWorkspace() && task.source_workspace !== "us-collab" && (
              <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1.5 text-xs" onClick={() => navigate(`/rd-task/${encodeURIComponent(task.task_id)}`, { state: { task } })}>
                <FileText className="size-3.5" />{t("技术资料与任务详情")}
              </Button>
            )}
            {/* 转采购入口 / 已转状态：已有关联展示流转芯片（含「待研发审核」等状态；无采购
                驾驶舱权限的成员自动降级为只读芯片），可转时展示按钮，弹窗与详情页共用。 */}
            {(procTask || (canTransferProc && !procTaskBlocksTransfer)) && (
              <div className="flex flex-wrap items-center gap-2">
                {procTask && (
                  <ProcurementLinkChip
                    task={procTask}
                    onJump={(procTaskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(procTaskId)}`)}
                  />
                )}
                {canTransferProc && !procTaskBlocksTransfer && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTransferOpen(true)}
                    title={t("把本任务转为采购任务（需携带图纸附件）")}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {procTask ? t("重新转采购") : t("转采购")}
                  </Button>
                )}
              </div>
            )}

            {editingDueDate && !dueDateChangePending && (
              <div className="rounded-xl border border-[#cbd8f6] bg-accent/50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  {t("修改截止日期")}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t(directTaskChanges ? "保存后截止日期立即更新，任务状态保持不变。" : "提交后任务进入待审核状态，管理员审核通过后截止日期才会更新；审核期间任务不可继续操作。")}
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
                    <div className="text-xs text-muted-foreground">{t("当前截止日期")}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">{task.due_date || t("未设置")}</div>
                  </div>
                </div>
                {!directTaskChanges && <div className="mt-3">
                  <label className="text-xs font-medium text-slate-500">{t("修改原因")}</label>
                  <Textarea
                    value={dueDateReason}
                    onChange={(event) => setDueDateReason(event.target.value)}
                    rows={3}
                    placeholder={t("请说明调整截止日期的原因，便于管理员审核")}
                    className="mt-1"
                  />
                </div>}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => {
                      setEditingDueDate(false);
                      setDueDateReason("");
                      setDraftDueDate(toDateInputValue(task.due_date));
                    }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    {t("取消")}
                  </Button>
                  <Button
                    type="button"
                    onClick={submitDueDateChange}
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    {t(directTaskChanges ? "保存日期" : "提交审核")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">{t("任务说明")}</div>
              <AutoTranslatedText as="p" className="text-sm leading-6 text-slate-600" text={task.description} />
              <AutoTranslatedText as="div" className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm text-primary-hover" text={task.next_action} />
            </div>

            {/* 工作项清单：任务内部轻量拆分（如不同类型文档各一项）。参与人直接增删勾选，无需审批。
                受 workItemsFeatureEnabled 开关控制（当前仅协同模块），其他工作台隐藏、数据保留 */}
            {workItemsFeatureEnabled() && (workItems.length > 0 || !isTaskCompleted) && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">
                    {t("工作项")}{workItems.length > 0 ? ` ${workItems.filter((it) => it.done).length}/${workItems.length}` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{t("拆分任务的小块，进展留痕可关联到工作项")}</span>
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
                        <span className={cn("min-w-0 flex-1 truncate", it.done ? "text-muted-foreground line-through" : "text-slate-700")}>{it.title}</span>
                        {it.owner_name && <span className="shrink-0 text-[11px] text-muted-foreground">{it.owner_name}</span>}
                        {!isTaskCompleted && (
                          <Button variant="unstyled"
                            type="button"
                            onClick={() =>
                              void persistWorkItems(
                                workItems.filter((w) => w.id !== it.id),
                                `删除了工作项《${it.title}》`,
                              )
                            }
                            className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-500 group-hover:opacity-100"
                            title={t("删除工作项（已关联的留痕保留在主任务）")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!isTaskCompleted && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={workItemDraft}
                      onChange={(event) => setWorkItemDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addWorkItem();
                      }}
                      placeholder={t("输入工作项标题，回车添加（如：用户手册 · 英文版）")}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none placeholder:text-muted-foreground focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                    />
                    <Button
                      type="button"
                      disabled={savingWorkItems || !workItemDraft.trim()}
                      onClick={addWorkItem}
                      className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
                    >
                      {t("添加")}
                    </Button>
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
            {/*          <li key={item} className="flex items-center gap-2 text-sm text-rose-600">*/}
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
            {/*            item.state === "current" && "border-primary shadow-[0_0_0_4px_rgba(37,99,235,0.10)]",*/}
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
                          imageDisplay="clipped-cards"
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
                        <Button variant="unstyled"
                          type="button"
                          disabled={attachmentBusy}
                          onClick={() => {
                            attachmentTargetRef.current = { note };
                            addFilesInputRef.current?.click();
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-500 transition-colors hover:border-[#8fa9e8] hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <UploadCloud className="h-3 w-3" />
                          {attachmentBusy ? t("处理中…") : t("添加附件")}
                        </Button>
                      )}
                      {/* 附件变更历史（归位展示）：谁在什么时候增/删/换了本条进展的附件 */}
                      {noteOps.length > 0 && (
                        <div className="space-y-0.5 border-l-2 border-slate-100 pl-2">
                          {[...noteOps]
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map((op) => (
                              <div key={op.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-5 text-muted-foreground">
                                <AutoTranslatedText
                                  as="span"
                                  text={op.comment || "变更了附件"}
                                  className={cn(
                                    "font-medium",
                                    op.action === "task.attachment_removed" && "text-rose-500/80",
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
              <Input
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
              <Input
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
                      className="bg-rose-600 hover:bg-rose-700"
                    >
                      {attachmentBusy ? t("删除中…") : t("确认删除")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* 任务树摘要：嵌套节点优先显示直接父任务；完整递归层级在任务详情的「合并关系」页签查看。 */}
            {(isSubtask || childSubtasks.length > 0) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                {isSubtask ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <SubtaskBadge task={task} />
                      <span className="text-xs text-slate-500">{t("本任务是以下任务的子任务")}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
                        {task.parent_title || task.parent_task_id}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{task.parent_task_id}</span>
                    </div>
                    {task.subtask_origin === "attached" && task.subtask_attached_by && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("由 {name} 于 {time} 并入", {
                          name: task.subtask_attached_by,
                          time: formatTraceDateTime(task.subtask_attached_at),
                        })}
                      </p>
                    )}
                    {canDetachSubtask && (
                      <Button variant="unstyled"
                        type="button"
                        disabled={detaching}
                        onClick={() =>
                          onRequestConfirm({
                            title: t("取消子任务关系"),
                            message: t("将把「{title}」提升为独立的顶层任务，与原父任务同级。", { title: task.title }),
                            confirmLabel: t("确认取消关系"),
                            details: [
                              t("任务本体不受影响：标题/主责/进度/留痕/附件全部保留"),
                              t("提升后落在原父任务所在的子项目里"),
                              t("立即生效，无需审核"),
                            ],
                            onConfirm: () => handleDetachSubtask(),
                          })
                        }
                        className="mt-2.5 cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {detaching ? t("处理中…") : t("取消子任务关系")}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-600">
                        {t("子任务（{n}）", { n: childSubtasks.length })}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {t("平均进度 {p}%", {
                          p: Math.round(
                            childSubtasks.reduce((sum, sub) => sum + (sub.progress ?? 0), 0) / childSubtasks.length,
                          ),
                        })}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {childSubtasks.map((sub) => (
                        <li key={sub.task_id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200/80">
                          <SubtaskBadge task={sub} />
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{sub.title}</span>
                          {sub.owner && <span className="shrink-0 text-[11px] text-muted-foreground">{sub.owner}</span>}
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{sub.progress ?? 0}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* 方案2：低强调的次级文字按钮，置于详情底部，点击打开聚焦的放弃原因弹窗。
                仅主责人 + 活跃状态可见（待审核/已完成等不显示）。 */}
            {(canAbandon || canAttachSubtask) && (
              <div className="flex justify-center gap-4 pt-1">
                {canAttachSubtask && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => { setAttachReason(""); setAttachTargetId(""); setAttachSearch(""); setAttachOpen(true); }}
                    className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    {t("并入其他任务成为子任务")}
                  </Button>
                )}
                {canAbandon && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => { setAbandonReason(""); setAbandonOpen(true); }}
                    className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-rose-600 hover:underline"
                  >
                    {t("请求放弃此任务")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "discussion" && (
          <div className="h-[min(680px,calc(100dvh-220px))] min-h-[420px] overflow-hidden rounded-xl border border-slate-200">
            <RDTaskConversation
              key={`workspace-conversation:${task.task_id}`}
              taskId={task.task_id}
              taskTitle={task.title}
              notes={progressNotes}
              mode="task"
              variant="desktop"
              onUnreadChange={setDiscussionUnread}
            />
          </div>
        )}

        {tab === "progress" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="rounded-xl border border-dashed border-[#cbd8f6] bg-accent/60 px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("AI 综合判断当前进度")}
              </div>
              <p className="mt-1">
                {t("在下方填写进展说明并/或上传附件（方案、测试记录、实验数据、评审纪要等），AI 会一起读取后给出建议；最终进度由人工确认。")}
              </p>
              {aiLoading && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-primary-hover ring-1 ring-[#dce5fa]">
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
                <span className="font-semibold tabular-nums text-primary-hover">{draftProgress}%</span>
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
                className="w-full accent-primary"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
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
                  <span className="text-[10px] text-muted-foreground">{t("可选，本条进展归属到任务的哪个子块")}</span>
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
                <span className="text-[10px] text-muted-foreground">{t("输入 @ 可提及成员 · 文本与附件均会送 AI 分析")}</span>
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
                  className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                />
              </div>
            </label>

            <div
              tabIndex={0}
              onPaste={handleNotePaste}
              onDragOver={(e) => { e.preventDefault(); if (!savingNote && !aiLoading && !preparingNoteFiles) setNoteDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setNoteDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setNoteDragOver(false);
                if (savingNote || aiLoading || preparingNoteFiles) return;
                void addNoteFiles(extractDataTransferFiles(e.dataTransfer.items));
              }}
              className={cn(
                "rounded-xl border px-3 py-3 outline-none transition-colors",
                noteDragOver
                  ? "border-dashed border-[#5f7fd3] bg-accent/70 ring-2 ring-[#dce5fa]"
                  : "border-slate-200 bg-slate-50/60 focus-visible:border-[#8fa9e8]",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{t("附件（AI 判断依据 + 留档）")}</span>
                <label
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    savingNote || aiLoading || preparingNoteFiles
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "cursor-pointer border border-slate-200 bg-white text-slate-700 hover:border-[#8fa9e8] hover:text-primary-hover",
                  )}
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  {preparingNoteFiles ? t("正在压缩图片…") : t("添加文件/图片")}
                  <Input
                    type="file"
                    multiple
                    disabled={savingNote || aiLoading || preparingNoteFiles}
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.zip,.rar,.png,.jpg,.jpeg,.webp,.bmp"
                    onChange={(event) => {
                      void addNoteFiles(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {noteDragOver ? (
                <p className="mt-2 text-[11px] font-medium text-primary">{t("松开鼠标即可上传到此任务")}</p>
              ) : noteAttachments.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">{t("最多 10 个、总计 50MB；超过 8MB 的 JPG/PNG/WebP 会先自动压缩，单文件压缩后需在 25MB 内。支持选择、拖拽或 Ctrl/⌘+V 粘贴。")}</p>
              ) : (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {noteAttachments.map((file, idx) => (
                    <div
                      key={`${file.name}-${file.size}-${idx}`}
                      className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(file.size)}</span>
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => {
                          const next = noteAttachments.filter((_, i) => i !== idx);
                          setNoteAttachments(next);
                          // 证据全部移除则清空 AI 建议；AI 解析改为显式点「AI 解析」按钮触发
                          if (next.length === 0 && !note.trim()) setAiAssessment(null);
                        }}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                        aria-label={t("移除附件")}
                      >
                        <X className="h-3 w-3" />
                      </Button>
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
              <div className="flex flex-col items-stretch gap-2 xl:flex-row xl:items-center xl:justify-between xl:gap-3">
                <span className="text-sm font-semibold text-slate-900">{t("协同人")}</span>
                <span className="text-xs text-muted-foreground">{t("已选")} {selectedCollaboratorKeys.size}</span>
              </div>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                {peopleLoading ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {t("正在读取研发人员")}
                  </div>
                ) : peopleError ? (
                  <div className="rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-600">{t("研发人员加载失败，请稍后重试。")}</div>
                ) : collaboratorCandidates.length === 0 ? (
                  <div className="rounded-lg bg-white px-3 py-3 text-xs text-muted-foreground">{t("暂无可选择的协同人。")}</div>
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
                            checked ? "border-[#cbd8f6] bg-accent text-primary-hover" : "border-slate-200 bg-white text-slate-700 hover:border-[#dce5fa] hover:bg-accent/50",
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
                            className="mt-0.5 rounded border-slate-300 text-primary"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{person.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
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
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
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
              <div className="flex items-start gap-3 rounded-xl border border-[#dce5fa] bg-accent/60 px-4 py-3">
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-primary-hover">{t("审核申请已提交，等待处理")}</div>
                  <div className="mt-0.5 text-xs text-[#5f7fd3]">{t("如审核人未收到通知，可点击「重新发送通知」再次提醒。")}</div>
                </div>
                <ActionButton
                  onClick={submitResult}
                  className="shrink-0 text-primary-hover ring-[#cbd8f6] hover:bg-[#dce5fa]"
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
                    <Checkbox className="rounded border-slate-300 text-primary" />
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
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4"
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
              <Button variant="unstyled"
                type="button"
                disabled={abandonSubmitting}
                onClick={() => setAbandonOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("取消")}
              </Button>
              <Button variant="unstyled"
                type="button"
                disabled={abandonSubmitting || !abandonReason.trim()}
                onClick={submitAbandon}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {abandonSubmitting ? t("提交中…") : t("提交放弃申请")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 转采购确认弹窗：与任务详情页完全同一组件。提交后进入「待研发审核」，
          研发管理员通过后才流转采购并自动分配采购负责人。 */}
      {transferOpen && (
        <TransferToProcurementModal
          taskId={task.task_id}
          taskTitle={task.title}
          owner={task.owner}
          ownerUserId={task.owner_user_id ?? undefined}
          priority={task.priority}
          dueDate={task.due_date}
          attachments={transferAttachments}
          resubmitFrom={procTaskBlocksTransfer ? null : procTask}
          blockingTask={procTaskBlocksTransfer ? procTask : null}
          onTransferred={setProcTask}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {/* 并入其他任务成为子任务：选目标父任务，确认后立即生效（不走审批）。
          本任务及其全部下级完整保留，仅改变整棵任务树的位置。 */}
      {attachOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4"
          onClick={attachSubmitting ? undefined : () => setAttachOpen(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-attach-title"
          >
            <div className="flex items-start gap-3 border-b border-[#dce5fa] bg-accent/70 px-6 py-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#dce5fa] text-primary-hover">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h3 id="workspace-attach-title" className="text-base font-bold text-slate-900">{t("并入其他任务成为子任务")}</h3>
                <p className="mt-1 text-sm text-slate-500">{t("确认后立即生效，无需审核")}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
              <div className="rounded-xl bg-accent/60 px-4 py-3 text-xs leading-5 text-foreground ring-1 ring-[#dce5fa]">
                {t("本任务「{title}」及其全部下级将整体并入所选任务。原有层级、主责人、进度、进展留痕与附件均保持不变，之后可随时取消关系并整体提升回独立任务。", { title: task.title })}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900">{t("选择目标任务")}<span className="ml-0.5 text-rose-500">{t("（必选）")}</span></label>
                <Input
                  value={attachSearch}
                  onChange={(e) => setAttachSearch(e.target.value)}
                  placeholder={t("搜索任务标题 / 编号")}
                  className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                />
                <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                  {attachLoading ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t("加载候选任务…")}</div>
                  ) : (() => {
                    const kw = attachSearch.trim().toLowerCase();
                    const list = attachCandidates.filter(
                      (c) => !kw || c.title.toLowerCase().includes(kw) || c.task_id.toLowerCase().includes(kw),
                    );
                    if (list.length === 0) {
                      return <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t("没有可选的目标任务")}</div>;
                    }
                    return list.slice(0, 100).map((c) => (
                      <Button variant="unstyled"
                        key={c.task_id}
                        type="button"
                        onClick={() => setAttachTargetId(c.task_id)}
                        className={cn(
                          "flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50",
                          attachTargetId === c.task_id && "bg-accent",
                        )}
                      >
                        <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full border", attachTargetId === c.task_id ? "border-primary bg-primary" : "border-slate-300")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{c.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{c.task_id}{c.primary_owner ? ` · ${c.primary_owner}` : ""}</span>
                        </span>
                      </Button>
                    ));
                  })()}
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  {t("候选中不含已完成、已归档或已处于其他任务下的任务；已有下级任务不会被拍平。")}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-900">{t("并入说明")}<span className="ml-1 text-xs font-normal text-muted-foreground">{t("（选填）")}</span></label>
                <Textarea
                  value={attachReason}
                  onChange={(event) => setAttachReason(event.target.value)}
                  rows={3}
                  placeholder={t("简述为何把这个任务并入目标任务，会记入操作留痕")}
                  className="mt-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <Button variant="unstyled"
                type="button"
                disabled={attachSubmitting}
                onClick={() => setAttachOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("取消")}
              </Button>
              <Button
                type="button"
                disabled={attachSubmitting || !attachTargetId}
                onClick={submitAttachSubtask}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {attachSubmitting ? t("处理中…") : t("确认并入")}
              </Button>
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

        <div className="rounded-xl border border-[#dce5fa] bg-accent px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">{t("AI 建议摘要")}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-primary-hover">
              {t("置信度")} {regenerated ? Math.min(96, suggestion.confidence + 6) : suggestion.confidence}%
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-primary-hover">
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
                  <div className="mt-0.5 text-xs text-muted-foreground">{t("建议责任人：{owner}", { owner: task.owner })}</div>
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
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
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
  onOpenDiscussion,
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
  onOpenDiscussion: (notification: WorkspaceNotification) => void;
  canReview?: boolean;
  onApprove?: () => void | Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  onSelfAssess?: () => void;
}) {
  const navigate = useNavigate();
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
  const isProcurementReviewResult = msgBodyType === "procurement_review_result";
  const isPerfSelfAssessment = msgBodyType === "perf_self_assessment";
  const discussionMention = parseRdDiscussionMention(notification.raw_body);
  const sampleTestMessage = parseProcurementSampleTestMessage(notification.raw_body);
  const transferReturnedMessage = parseProcurementTransferReturnedMessage(notification.raw_body);

  // review_request fields
  const reviewType = isReviewRequest ? String(parsedBody!.review_type ?? "") : "";
  const reviewTaskId = isReviewRequest ? String(parsedBody!.task_id ?? "") : "";
  const reviewReferenceTaskId = isReviewRequest && reviewType === "procurement_transfer"
    ? String(parsedBody!.rd_task_id ?? "")
    : reviewTaskId;
  const reviewTaskTitle = isReviewRequest ? String(parsedBody!.task_title ?? "") : "";
  const reviewSubmitterName = isReviewRequest ? String(parsedBody!.submitter_name ?? "") : "";
  const reviewNote = isReviewRequest ? String(parsedBody!.note ?? "") : "";
  const reviewPendingDueDate = isReviewRequest ? String(parsedBody!.pending_due_date ?? "") : "";
  const reviewCurrentDueDate = isReviewRequest ? String(parsedBody!.current_due_date ?? "") : "";

  // 拉取审核任务的进度记录，作为审核参考依据
  useEffect(() => {
    if (!isReviewRequest || !reviewReferenceTaskId) {
      setProgressNotes([]);
      return;
    }
    let cancelled = false;
    setProgressNotesLoading(true);
    fetchRdTaskProgressNotes(reviewReferenceTaskId)
      .then((list) => { if (!cancelled) setProgressNotes(list); })
      .catch(() => { if (!cancelled) setProgressNotes([]); })
      .finally(() => { if (!cancelled) setProgressNotesLoading(false); });
    return () => { cancelled = true; };
  }, [isReviewRequest, reviewReferenceTaskId]);

  // review_result fields
  const resultApproved = isReviewResult ? String(parsedBody!.result ?? "") === "approved" : false;
  const resultTaskTitle = isReviewResult ? String(parsedBody!.task_title ?? "") : "";
  const resultTaskId = isReviewResult ? String(parsedBody!.task_id ?? "") : "";
  const resultReviewerName = isReviewResult ? String(parsedBody!.reviewer_name ?? "管理员") : "";
  const resultReason = isReviewResult ? String(parsedBody!.reason ?? "") : "";
  const resultReviewType = isReviewResult ? String(parsedBody!.review_type ?? "") : "";
  const resultNote = isReviewResult ? String(parsedBody!.note ?? "") : "";
  const resultProcurementCode = isReviewResult ? String(parsedBody!.procurement_code ?? "") : "";
  const resultBuyerName = isReviewResult ? String(parsedBody!.buyer_name ?? "") : "";

  const procurementApproved = isProcurementReviewResult ? String(parsedBody!.result ?? "") === "approved" : false;
  const procurementMaterial = isProcurementReviewResult ? String(parsedBody!.material_name ?? "采购需求") : "";
  const procurementCode = isProcurementReviewResult ? String(parsedBody!.procurement_code ?? "") : "";
  const procurementSpec = isProcurementReviewResult ? String(parsedBody!.specification ?? "") : "";
  const procurementQuantity = isProcurementReviewResult ? Number(parsedBody!.quantity ?? 0) : 0;
  const procurementUnit = isProcurementReviewResult ? String(parsedBody!.unit ?? "") : "";
  const procurementMethod = isProcurementReviewResult ? String(parsedBody!.procurement_method_label ?? "") : "";
  const procurementRequester = isProcurementReviewResult ? String(parsedBody!.requester_name ?? "") : "";
  const procurementContact = isProcurementReviewResult ? String(parsedBody!.rd_contact ?? "") : "";
  const procurementReviewer = isProcurementReviewResult ? String(parsedBody!.reviewer_name ?? "") : "";
  const procurementReason = isProcurementReviewResult ? String(parsedBody!.reason ?? "") : "";
  const procurementNextAction = isProcurementReviewResult ? String(parsedBody!.next_action ?? "") : "";
  const procurementRoute = isProcurementReviewResult ? String(parsedBody!.route ?? "") : "";
  const procurementActionLabel = isProcurementReviewResult ? String(parsedBody!.action_label ?? "") : "";
  const procurementRecipientReason = isProcurementReviewResult ? String(parsedBody!.recipient_reason ?? "") : "";

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

        {sampleTestMessage && <ProcSampleTestMessageCard body={sampleTestMessage} onOpen={(route) => { onClose(); navigate(route); }} />}
        {transferReturnedMessage && <ProcTransferReturnedMessageCard body={transferReturnedMessage} onOpen={(route) => { onClose(); navigate(route); }} />}

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
                {reviewType === "procurement_transfer" ? t("转采购审核") : reviewType === "collaboration" ? t("协作变更审核") : reviewType === "proposal" ? t("立项审核") : reviewType === "due_date" ? t("截止日期变更审核") : reviewType === "abandon" ? t("放弃任务审核") : t("成果审核")}
              </span>
            </div>
            <div>
              <div className="font-mono text-xs text-muted-foreground mb-0.5">{reviewReferenceTaskId || reviewTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{reviewTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">{t("提交人：")}<span className="font-medium text-slate-700">{reviewSubmitterName}</span></div>
            {reviewType === "due_date" && reviewPendingDueDate && (
              <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-slate-500">{reviewCurrentDueDate || t("未设置")}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-semibold text-primary-hover">{reviewPendingDueDate}</span>
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
                <Clock className="h-4 w-4 text-primary" />
                {t("进度时间线")}
                <span className="text-xs font-normal text-muted-foreground">{t("（审核参考依据）")}</span>
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
          <div className={`rounded-xl border p-4 space-y-3 ${resultApproved ? "border-emerald-100 bg-emerald-50/60" : "border-rose-100 bg-rose-50/60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${resultApproved ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                {resultApproved ? t("✓ 审核通过") : t("✕ 被打回")}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                {resultReviewType === "procurement_transfer" ? t("转采购前置审核") : t("审核结果")}
              </span>
            </div>
            <div>
              <div className="font-mono text-xs text-muted-foreground mb-0.5">{resultTaskId}</div>
              <div className="text-sm font-semibold text-slate-800">{resultTaskTitle}</div>
            </div>
            <div className="text-sm text-slate-500">{t("审核人：")}<span className="font-medium text-slate-700">{resultReviewerName}</span></div>
            {resultReviewType === "procurement_transfer" && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                <div><span className="text-slate-500">{t("采购编号：")}</span><span className="font-mono text-slate-700">{resultProcurementCode}</span></div>
                {resultBuyerName && <div><span className="text-slate-500">{t("采购负责人：")}</span><span className="font-medium text-slate-700">{resultBuyerName}</span></div>}
              </div>
            )}
            {resultApproved ? (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-100">
                {resultReviewType === "procurement_transfer"
                  ? <AutoTranslatedText text={resultNote || t("已进入采购待处理，等待采购人员确认接收。")} />
                  : t("任务已通过审核，恭喜完成！")}
              </div>
            ) : (
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-100">
                <span className="font-medium">{t("打回原因：")}</span>{resultReason ? <AutoTranslatedText text={resultReason} /> : t("请联系审核人了解详情")}
                {resultNote && <AutoTranslatedText as="p" className="mt-1 text-rose-600" text={resultNote} />}
              </div>
            )}
          </div>
        )}

        {/* ── Procurement review result card ── */}
        {isProcurementReviewResult && (
          <div className={cn("space-y-4 rounded-xl border bg-white p-4", procurementApproved ? "border-emerald-200" : "border-rose-200")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", procurementApproved ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                {procurementApproved ? t("审核通过") : t("审核打回")}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t("转采购审核")}</span>
            </div>
            <div className="border-b border-slate-100 pb-3">
              <div className="font-mono text-xs tabular-nums text-muted-foreground">{procurementCode}</div>
              <AutoTranslatedText as="div" className="mt-1 text-balance text-sm font-semibold text-slate-900" text={procurementMaterial} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                [t("采购方式"), procurementMethod],
                [t("数量"), `${procurementQuantity} ${procurementUnit}`.trim()],
                [t("规格"), procurementSpec],
                [t("需求提出人"), procurementRequester],
                [t("研发对接人"), procurementContact],
                [t("接收原因"), procurementRecipientReason],
                [t("审核人"), procurementReviewer],
              ].filter(([, value]) => value).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-pretty text-sm font-medium text-slate-700"><AutoTranslatedText text={value} /></dd>
                </div>
              ))}
            </dl>
            {!procurementApproved && (
              <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                <div className="text-xs font-semibold text-rose-700">{t("打回原因")}</div>
                <AutoTranslatedText as="p" className="mt-1 whitespace-pre-wrap text-pretty text-sm leading-6 text-rose-800" text={procurementReason || t("未填写打回原因")} />
              </div>
            )}
            <div className={cn("rounded-lg border px-3 py-2", procurementApproved ? "border-emerald-100 bg-emerald-50" : "border-slate-200 bg-slate-50")}>
              <div className="text-xs font-semibold text-slate-600">{t("下一步")}</div>
              <AutoTranslatedText as="p" className="mt-1 text-pretty text-sm leading-6 text-slate-700" text={procurementNextAction} />
            </div>
            {procurementRoute.startsWith("/") && (
              <ActionButton variant="primary" onClick={() => navigate(procurementRoute)}>
                {t(procurementActionLabel || (procurementApproved ? "查看采购任务" : "查看原研发任务"))}
                <ArrowRight className="size-3.5" />
              </ActionButton>
            )}
          </div>
        )}

        {/* ── Plain message (fallback) ── */}
        {!isReviewRequest && !isReviewResult && !isProcurementReviewResult && !sampleTestMessage && !transferReturnedMessage && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm leading-6 text-slate-700">{notification.message}</p>
          </div>
        )}

        {/* ── 绩效自评入口 ── */}
        {isPerfSelfAssessment && onSelfAssess && (
          <Button
            type="button"
            onClick={onSelfAssess}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-bold transition"
          >
            {isHandled ? t("查看 / 修改自评") : t("去自评")}
          </Button>
        )}

        {/* ── Related task block ── */}
        {relatedTask && !sampleTestMessage && !transferReturnedMessage && (
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-xs text-muted-foreground">{relatedTask.task_id}</div>
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
        {notification.type === "message" && !isReviewRequest && !isReviewResult && !isProcurementReviewResult && !sampleTestMessage && !transferReturnedMessage && (
          <div className="rounded-xl border border-[#dce5fa] bg-accent/60 px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-primary-hover">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-semibold">{notification.sender_name ?? t("未知发件人")}</span>
              {notification.sender_role && <span className="text-[#5f7fd3]">· {notification.sender_role}</span>}
              <span className="ml-auto text-[#5f7fd3]">{relativeTimeLabel((notification as { created_at?: string }).created_at, notification.time)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{notification.message}</p>
          </div>
        )}

        {/* ── System suggestion (non-message notifications) ── */}
        {notification.type !== "message" && (
          <div className="rounded-xl border border-[#dce5fa] bg-accent px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4" />
              {t("系统建议")}
            </div>
            <p className="text-sm leading-6 text-primary-hover">
              {notification.type === "due_soon" && t("建议先确认是否需要顺延；如果仍由你处理，请更新下一步动作和风险说明。")}
              {notification.type === "blocked" && t("建议补充协作反馈，并把上游阻塞同步给主责人和上级。")}
              {notification.type === "pending_ai" && t("建议进入 AI 建议审核，确认后再写入任务池，避免自动生成不准确任务。")}
              {notification.type === "transfer" && t("建议确认接收人和影响范围后再提交移交流程。")}
            </p>
          </div>
        )}

        {/* ── Inline reject dialog ── */}
        {rejectOpen && (
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4 space-y-3">
            <div className="text-sm font-semibold text-rose-700">{t("填写驳回原因")}</div>
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
          {discussionMention && (
            <ActionButton variant="primary" onClick={() => onOpenDiscussion(notification)}>
              {t("查看并回复")}
              <ArrowRight className="h-3.5 w-3.5" />
            </ActionButton>
          )}
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
          {!isReviewRequest && !isReviewResult && !isProcurementReviewResult && !sampleTestMessage && !transferReturnedMessage && (
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
          {sampleTestMessage?.type === "procurement_sample_test_result" && <ActionButton onClick={onDismiss}>{t("知道了")}</ActionButton>}
          {isProcurementReviewResult && (
            <ActionButton onClick={onDismiss}>
              <CheckCircle2 className="size-3.5" />
              {t("标记已处理")}
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


const WORKSPACE_PAGE_SIZE = 6;
const NOTIF_PAGE_SIZE = 5;

const WS_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft:          { label: "草稿",   bg: "bg-slate-100",   text: "text-slate-500" },
  in_progress:    { label: "进行中", bg: "bg-accent",   text: "text-primary" },
  pending_review: { label: "待审核", bg: "bg-accent",   text: "text-primary" },
  paused_leave:   { label: "请假暂停", bg: "bg-amber-50",  text: "text-amber-700" },
  paused_blocked: { label: "阻塞",   bg: "bg-rose-50",     text: "text-rose-700" },
  on_hold:        { label: "挂起",   bg: "bg-slate-100",   text: "text-slate-500" },
  completed:      { label: "已完成", bg: "bg-emerald-50",  text: "text-emerald-700" },
  pending_assign: { label: "待指派", bg: "bg-amber-50",    text: "text-amber-700" },
  archived:       { label: "已归档", bg: "bg-slate-100",   text: "text-muted-foreground" },
};

const WS_PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  high:   { label: "高",  bg: "bg-rose-50",   text: "text-rose-700"   },
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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
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
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dce5fa] text-primary">
              <FolderInput className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{t("移动任务归类")}</h3>
              <p className="max-w-[260px] truncate text-xs text-slate-500">
                {isBatch ? t("已选 {n} 个任务", { n: tasks.length }) : tasks[0]?.title}
              </p>
            </div>
          </div>
          <Button variant="unstyled" type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </Button>
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
          <Button variant="unstyled"
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {t("取消")}
          </Button>
          <Button
            type="button"
            disabled={saving || loadingBase || loadingTree || !targetSubId}
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            {t("确认移动")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function WorkspaceTaskCard({
  task,
  attachmentPreview,
  onOpen,
  moveEnabled = false,
  selected = false,
  onToggleSelect,
  onMove,
  unreadCount = 0,
}: {
  task: WorkspaceTask;
  attachmentPreview?: RdTaskAttachmentPreview;
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean; transfer?: boolean }) => void;
  /** 子系统全景视图下、且为自己主责的任务才允许移动/勾选。 */
  moveEnabled?: boolean;
  selected?: boolean;
  onToggleSelect?: (task: WorkspaceTask) => void;
  onMove?: (task: WorkspaceTask) => void;
  /** 未读评论数（微信式红点，>0 才显示） */
  unreadCount?: number;
}) {
  const pCfg = WS_PRIORITY_CONFIG[task.priority] ?? WS_PRIORITY_CONFIG.medium!;
  const horizonWorkspace = !isProductionWorkspace();
  const days = workspaceDaysUntil(task.due_date);
  const isOverdue = isTaskOverdue(task);
  const currentWorkspace = isUsCollabWorkspace() ? "us-collab" : "rd";
  const isForeignWorkspace = Boolean(task.source_workspace && task.source_workspace !== currentWorkspace);
  // 研发已取消审核的存量申请可打开并主动应用；成果与放弃仍等待审核。
  const isPendingReview = task.status === "pending_review" && !(
    !isForeignWorkspace && !isUsCollabWorkspace() && !isProductionWorkspace()
    && ["proposal", "collaboration", "due_date", "merge"].includes(task.pending_review_type ?? "")
  );
  // 列表卡片直接发起「申请放弃」：仅主责人 + 活跃状态可见（与详情抽屉内 canAbandon 口径一致）。
  const canAbandon =
    !isForeignWorkspace && task.role === "primary" &&
    ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);
  // 列表卡片直接发起「转采购」：参与人（主责/协作）+ 活跃状态 + 仅研发工作台可见。
  // 点开即进入详情面板并自动弹出转采购弹窗（权限码 proc-task:transfer，系统管理·权限目录可配）。
  const canTransferProcPermission = usePermission("proc-task:transfer");
  const canTransferProcCard =
    canTransferProcPermission && currentWorkspace === "rd" && !isForeignWorkspace &&
    ["in_progress", "paused_leave", "paused_blocked", "on_hold"].includes(task.status);
  const hierarchyTags = task.category_path
    .split(/[\/／>＞|]/)
    .map((part) => part.trim())
    // 纯一级分类的路径是「系统 / 默认 / 类型」，「默认」是服务端自动补的容器，不展示
    .filter((part) => part && part !== RD_DEFAULT_SUBPROJECT_LABEL)
    .slice(-2);
  const attachmentCount = attachmentPreview?.attachment_count ?? task.attachments ?? 0;
  const attachmentImages = (attachmentPreview?.attachments ?? [])
    .filter((attachment) => attachment.mime.startsWith("image/"));
  const visibleAttachmentImages = attachmentImages.slice(0, 4);
  const hiddenAttachmentCount = Math.max(0, attachmentCount - visibleAttachmentImages.length);
  const latestActivity = task.latest_progress_summary;
  const taskAtRisk = isOverdue || task.status === "paused_blocked" || task.blockers.length > 0;
  const progressValue = clampProgressValue(task.progress);
  const cardSummary =
    task.latest_progress_summary?.text?.trim()
    || task.next_action?.trim()
    || task.description?.trim()
    || t("暂无进展摘要");

  return (
    <motion.div
      initial={horizonWorkspace ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={isPendingReview ? undefined : () => onOpen(task, "detail")}
      role={isPendingReview ? undefined : "button"}
      tabIndex={isPendingReview ? undefined : 0}
      aria-disabled={isPendingReview || undefined}
      title={isPendingReview ? t("待审核任务，管理员审核通过后方可操作") : undefined}
      onKeyDown={isPendingReview ? undefined : (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task, "detail");
        }
      }}
      className={cn(
        "rd-horizon-workspace-task-card group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-colors focus-visible:outline-none",
        isPendingReview
          ? "cursor-not-allowed select-text bg-slate-50 opacity-60 grayscale"
          : "cursor-pointer hover:border-[#8fa9e8] focus-visible:ring-2 focus-visible:ring-[#8fa9e8]",
        selected && "ring-2 ring-[#5f7fd3]/70",
      )}
      data-status={task.status}
      data-priority={task.priority}
      data-selected={selected || undefined}
    >
      <div className="rd-horizon-workspace-task-card-body flex min-h-[220px] min-w-0 flex-col gap-2.5 px-4 py-3.5">
        {/* 参考卡片第一行：分类标签在左，附件和三点菜单在右。 */}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
            {hierarchyTags.map((tag) => (
              <span
                key={tag}
                title={tag}
                className="max-w-[150px] truncate rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-primary"
              >
                {tag}
              </span>
            ))}
            <span className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-semibold",
              task.role === "primary" ? "bg-accent text-primary" : "bg-slate-100 text-slate-500"
            )}>
              {task.role === "primary" ? t("主责") : `${t("协作")}${task.collab_role ? ` · ${task.collab_role}` : ""}`}
            </span>
            {task.source_workspace && (
              <span className={cn(
                "inline-flex shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold",
                task.source_workspace === "us-collab" ? "bg-accent text-primary" : "bg-slate-100 text-slate-700",
              )}>
                {task.source_workspace === "us-collab" ? t("协同") : t("研发")}
              </span>
            )}
            {task.parent_task_id && <SubtaskBadge task={task} />}
            {(task.subtasks?.length ?? 0) > 0 && (
              <span className="inline-flex shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                {t("含 {n} 子任务", { n: task.subtasks!.length })}
              </span>
            )}
            {task.ai_pending && (
              <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-primary">
                <Sparkles className="h-2.5 w-2.5" />
                {t("AI待确认")}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {attachmentCount > 0 && (
              <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent px-2 text-[10px] font-semibold text-primary">
                <Paperclip className="h-3 w-3" />
                {t("附件")} <span className="tabular-nums">{attachmentCount}</span>
              </span>
            )}
            {unreadCount > 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
            {!isPendingReview && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="unstyled"
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#cbd8f6] hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t("更多操作")}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => onOpen(task, "detail")}>
                    <ArrowRight className="h-4 w-4" />
                    {t("查看任务")}
                  </DropdownMenuItem>
                  {moveEnabled && !isForeignWorkspace && onMove && (
                    <DropdownMenuItem onSelect={() => onMove(task)}>
                      <FolderInput className="h-4 w-4" />
                      {t("移动")}
                    </DropdownMenuItem>
                  )}
                  {canTransferProcCard && (
                    <DropdownMenuItem onSelect={() => onOpen(task, "detail", { transfer: true })}>
                      <ShoppingCart className="h-4 w-4" />
                      {t("转采购")}
                    </DropdownMenuItem>
                  )}
                  {canAbandon && (
                    <DropdownMenuItem onSelect={() => onOpen(task, "detail", { abandon: true })}>
                      <X className="h-4 w-4" />
                      {t("申请放弃")}
                    </DropdownMenuItem>
                  )}
                  {moveEnabled && onToggleSelect && (
                    <DropdownMenuItem onSelect={() => onToggleSelect(task)}>
                      <Check className="h-4 w-4" />
                      {selected ? t("取消选择") : t("选择任务")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">

          {/* Title */}
          <div className="line-clamp-2 text-balance text-[15px] font-bold leading-snug text-slate-900">
            <AutoTranslatedText text={task.title} />
          </div>
          <div className="line-clamp-2 min-h-10 text-pretty text-xs leading-5 text-slate-500">
            <AutoTranslatedText text={cardSummary} />
          </div>

          {/* 参考驾驶舱附件卡：缩略图只占当前卡片宽度，剩余数量收进 +N。 */}
          {visibleAttachmentImages.length > 0 && (
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              {visibleAttachmentImages.map((attachment) => (
                <div
                  key={attachment.id}
                  className="h-12 w-[68px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                  title={attachment.name}
                >
                  <RenewableImage
                    resourceKey={`rd-thumb:${attachment.task_id}:${attachment.id}`}
                    refresh={attachment.task_id ? async () => getAttachmentThumbUrl(await refreshRdAttachment(attachment)) : undefined}
                    src={getAttachmentThumbUrl(attachment)}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ))}
              {hiddenAttachmentCount > 0 && (
                <div className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#cbd8f6] bg-accent/70 px-2 text-xs font-bold tabular-nums text-primary">
                  +{hiddenAttachmentCount}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-auto flex items-center gap-2 pt-0.5">
            <div
              role="progressbar"
              aria-label={t("{task} 的任务进度", { task: task.title })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
              className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className={cn(
                  "rd-horizon-workspace-task-progress h-full rounded-full",
                  progressValue === 100 && "rd-horizon-workspace-task-progress--complete",
                )}
                style={{
                  width: `${progressValue}%`,
                  backgroundColor: progressValue === 100 ? "#10b981" : "var(--primary)",
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-500">
              {progressValue}%
            </span>
          </div>

          {/* 卡片尾部集中呈现执行信息，便于横向扫读。 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", pCfg.bg, pCfg.text)}>
              <Flame className="h-3 w-3" />
              {t(`${pCfg.label}优先`)}
            </span>
            {task.due_date && (
              <span className={cn("inline-flex items-center gap-1", isOverdue && "font-semibold text-rose-600")}>
                <CalendarClock className="h-3 w-3 shrink-0" />
                {isOverdue ? t("逾期 {n} 天", { n: taskOverdueDays(task) }) : days === 0 ? t("今天到期") : `${t("截止：")} ${task.due_date.slice(5)}`}
              </span>
            )}
            {taskAtRisk && (
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                {t("风险")}
              </span>
            )}
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
              {latestActivity && <span>{t("更新：")}{relativeTimeLabel(latestActivity.created_at, latestActivity.created_at)}</span>}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-bold text-white">
                {(latestActivity?.actor_name || task.owner).trim().slice(0, 1)}
              </span>
              <span className="max-w-[70px] truncate font-medium text-slate-600">{latestActivity?.actor_name || task.owner}</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** 类目目录：把“我的任务”按服务端派生的稳定一级类目身份归类。 */
type SubsystemGroup = {
  key: string;
  label: string;
  active: WorkspaceTask[];
  done: WorkspaceTask[];
  total: number;
  avgProgress: number;
};

/** 类目 id 是分组事实源；名称只负责展示。旧接口数据才回退 category_path。 */
function subsystemOf(task: WorkspaceTask): { key: string; label: string } {
  const head = (task.category_path ?? "").split(" / ")[0]?.trim();
  const label = task.category_label?.trim() || (head && head.length > 0 ? head : "未分类");
  return {
    key: task.category_key?.trim() || (task.category_id ? `category:${task.category_id}` : `legacy:${label}`),
    label,
  };
}

/** 全景视图的移动归类能力（仅对自己主责的任务开放）。传入即开启「移动 / 批量勾选」。 */
type PanoramaMoveProps = {
  selectedIds: Set<string>;
  onToggleSelect: (task: WorkspaceTask) => void;
  onMoveTask: (task: WorkspaceTask) => void;
};

type WorkspaceTaskTreeNode = TaskTreeNode<WorkspaceTask>;

function taskTreeHasActiveDescendant(node: WorkspaceTaskTreeNode): boolean {
  return node.children.some(
    (child) => child.task.status !== "completed" || taskTreeHasActiveDescendant(child),
  );
}

function WorkspaceTaskTreeRow({
  node,
  depth,
  onOpen,
  onKickoff,
  move,
  unreadByTask,
}: {
  node: WorkspaceTaskTreeNode;
  depth: number;
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean; transfer?: boolean }) => void;
  onKickoff?: (task: WorkspaceTask) => void;
  move?: PanoramaMoveProps;
  unreadByTask?: Record<string, number>;
}) {
  const { task, children } = node;
  const [expanded, setExpanded] = useState(
    depth === 0 || (task.status === "completed" && taskTreeHasActiveDescendant(node)),
  );
  const status = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.draft;
  const days = workspaceDaysUntil(task.due_date);
  const overdue = isTaskOverdue(task);
  const pendingReview = task.status === "pending_review";
  const movable = Boolean(move) && task.role === "primary";
  const selected = move?.selectedIds.has(task.task_id) ?? false;
  const unreadCount = unreadByTask?.[task.task_id] ?? 0;
  const preview = workspaceTaskPreview(task);
  const kickoffVisible = Boolean(onKickoff)
    && task.role === "primary"
    && task.status !== "completed"
    && task.status !== "pending_review";
  // 服务端的结构深度从 1 开始、最多 5 层；当前树行 depth 从 0 开始。
  // 被筛选/权限提升为根节点的任务仍由服务端做最终深度裁决。
  const visibleDepthLimitReached = (task.tree_depth ?? depth + 1) >= RD_TASK_TREE_MAX_DEPTH;

  const openDetail = () => {
    if (!pendingReview) onOpen(task, "detail");
  };

  return (
    <div>
      <div
        role={pendingReview ? undefined : "button"}
        tabIndex={pendingReview ? undefined : 0}
        aria-disabled={pendingReview || undefined}
        onClick={openDetail}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget
            && !pendingReview
            && (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            openDetail();
          }
        }}
        className={cn(
          "group grid min-h-[62px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]",
          depth === 0 ? "border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.04)]" : "border-transparent bg-slate-50/55",
          pendingReview ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-slate-200 hover:bg-white",
          selected && "border-[#8fa9e8] bg-accent/40 ring-1 ring-[#cbd8f6]",
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {children.length > 0 ? (
            <Button variant="unstyled"
              type="button"
              aria-label={expanded ? t("收起子任务") : t("展开子任务")}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((value) => !value);
              }}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]"
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
            </Button>
          ) : (
            <span className="mt-0.5 h-8 w-8 shrink-0" aria-hidden="true" />
          )}

          <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", status.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate text-[13px] leading-5 text-slate-850", depth === 0 ? "font-semibold" : "font-medium")}>
                <AutoTranslatedText text={task.title} />
              </span>
              {task.priority === "high" && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-rose-600">
                  <AlertTriangle className="h-3 w-3" />
                  {t("高优先级")}
                </span>
              )}
            </div>

            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium", status.className)}>
                {t(task.status_label)}
              </span>
              <span>{task.role === "primary" ? t("我主责") : `${t("协作")} · ${task.owner}`}</span>
              {task.due_date && (
                <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-rose-600", days === 0 && !overdue && "font-semibold text-amber-600")}>
                  <CalendarClock className="h-3 w-3" />
                  {overdue ? t("逾期 {n} 天", { n: taskOverdueDays(task) }) : days === 0 ? t("今天到期") : task.due_date}
                </span>
              )}
              {task.parent_task_id && task.parent_title && depth === 0 && (
                <span className="truncate">{t("上级：{title}", { title: task.parent_title })}</span>
              )}
            </div>

            {preview && (
              <div className="mt-1 line-clamp-1 text-[11px] leading-4 text-slate-500">
                <span className="text-muted-foreground">{t(preview.label)}</span>
                <AutoTranslatedText text={preview.text} />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden w-28 items-center gap-2 sm:flex">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", task.progress >= 100 ? "bg-emerald-500" : "bg-primary")}
                style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
              />
            </div>
            <span className="w-8 text-right text-[10px] font-semibold tabular-nums text-slate-500">{task.progress}%</span>
          </div>

          {!pendingReview && (
            <Button variant="unstyled"
              type="button"
              title={unreadCount > 0 ? t("有 {n} 条未读评论", { n: unreadCount }) : t("查看评论")}
              aria-label={unreadCount > 0 ? t("查看评论，有 {n} 条未读", { n: unreadCount }) : t("查看评论")}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(task, "discussion");
              }}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]",
                unreadCount > 0
                  ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                  : "border-slate-200 bg-white text-slate-500 hover:border-[#cbd8f6] hover:text-primary-hover",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>{t("评论")}</span>
              {unreadCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>
          )}

          {kickoffVisible && onKickoff && (
            <Button variant="unstyled"
              type="button"
              disabled={visibleDepthLimitReached}
              title={visibleDepthLimitReached ? t("任务树最多支持 5 层") : t("在当前节点下发起立项")}
              onClick={(event) => {
                event.stopPropagation();
                onKickoff(task);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#dce5fa] bg-accent/70 px-2 text-[11px] font-semibold text-primary-hover transition-colors hover:border-[#cbd8f6] hover:bg-[#dce5fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6] disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {t("立项")}
            </Button>
          )}

          {!pendingReview && (
            <Button variant="unstyled"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(task, "progress");
              }}
              className="hidden rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 opacity-0 shadow-sm transition-colors hover:border-[#cbd8f6] hover:text-primary-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6] group-focus-within:opacity-100 group-hover:opacity-100 md:inline-flex"
            >
              {t("更新进度")}
            </Button>
          )}

          {movable && move && (
            <>
              <Button variant="unstyled"
                type="button"
                title={t("移动到其它系统 / 子项")}
                onClick={(event) => {
                  event.stopPropagation();
                  move.onMoveTask(task);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 opacity-100 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6] sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              >
                <FolderInput className="h-3.5 w-3.5" />
              </Button>
              <Button variant="unstyled"
                type="button"
                title={selected ? t("取消选择") : t("勾选以批量移动")}
                onClick={(event) => {
                  event.stopPropagation();
                  move.onToggleSelect(task);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]",
                  selected ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-transparent hover:border-[#8fa9e8]",
                )}
              >
                <Check className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {children.length > 0 && expanded && (
        <div className="ml-5 mt-1.5 space-y-1.5 border-l border-slate-200 pl-3">
          {children.map((child) => (
            <WorkspaceTaskTreeRow
              key={child.task.task_id}
              node={child}
              depth={depth + 1}
              onOpen={onOpen}
              onKickoff={onKickoff}
              move={move}
              unreadByTask={unreadByTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceTaskTree({
  tasks,
  onOpen,
  onKickoff,
  move,
  unreadByTask,
}: {
  tasks: WorkspaceTask[];
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean; transfer?: boolean }) => void;
  onKickoff?: (task: WorkspaceTask) => void;
  move?: PanoramaMoveProps;
  unreadByTask?: Record<string, number>;
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const { activeTree, completedTree } = useMemo(() => {
    const completeTree = buildTaskTree(tasks, compareWorkspaceTasks);
    // 活跃任务保留已完成的上级上下文，避免“父任务完成、子任务仍进行中”时层级断裂。
    const activeWithAncestors = filterTaskTree(completeTree, (task) => task.status !== "completed");
    const activeContextIds = collectTaskTreeIds(activeWithAncestors);
    return {
      activeTree: activeWithAncestors,
      // 已作为活跃任务祖先展示的完成节点不重复出现；其它完成任务仍放在折叠区。
      completedTree: buildTaskTree(
        tasks.filter((task) => task.status === "completed" && !activeContextIds.has(task.task_id)),
        compareWorkspaceTasks,
      ),
    };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-center">
        <Search className="mb-2 h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium text-slate-500">{t("该项目下没有匹配的任务")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("可以调整搜索或筛选条件")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activeTree.map((node) => (
        <WorkspaceTaskTreeRow
          key={node.task.task_id}
          node={node}
          depth={0}
          onOpen={onOpen}
          onKickoff={onKickoff}
          move={move}
          unreadByTask={unreadByTask}
        />
      ))}

      {completedTree.length > 0 && (
        <div className="pt-1">
          <Button variant="unstyled"
            type="button"
            onClick={() => setCompletedOpen((value) => !value)}
            aria-expanded={completedOpen}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-left text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", completedOpen && "rotate-90")} />
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {t("已完成任务")}
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 shadow-sm">
              {tasks.filter((task) => task.status === "completed").length}
            </span>
          </Button>
          {completedOpen && (
            <div className="mt-2 space-y-2">
              {completedTree.map((node) => (
                <WorkspaceTaskTreeRow
                  key={node.task.task_id}
                  node={node}
                  depth={0}
                  onOpen={onOpen}
                  onKickoff={onKickoff}
                  move={move}
                  unreadByTask={unreadByTask}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubsystemFolderCard({
  group,
  onOpen,
  unreadByTask,
}: {
  group: SubsystemGroup;
  onOpen: () => void;
  unreadByTask?: Record<string, number>;
}) {
  const all = [...group.active, ...group.done];
  const riskCount = group.active.filter((task) => task.status === "paused_blocked" || isTaskOverdue(task)).length;
  const unreadCount = all.reduce((sum, task) => sum + (unreadByTask?.[task.task_id] ?? 0), 0);

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="group relative min-h-[164px] overflow-hidden rounded-[18px] border border-slate-200/80 bg-white p-4 text-left shadow-[0_4px_18px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-[#cbd8f6] hover:shadow-[0_14px_32px_rgba(15,23,42,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cbd8f6]"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-slate-900 transition-colors group-hover:bg-primary" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition-colors group-hover:border-[#dce5fa] group-hover:bg-accent group-hover:text-primary-hover">
            <Folder className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900" title={group.label}>{group.label}</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("类目任务表")} · {group.total} {t("个任务")}</p>
          </div>
        </div>
        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
        <div>
          <div className="text-base font-semibold tabular-nums text-slate-900">{group.active.length}</div>
          <div className="text-[10px] text-muted-foreground">{t("进行中")}</div>
        </div>
        <div>
          <div className={cn("text-base font-semibold tabular-nums", riskCount > 0 ? "text-rose-600" : "text-slate-900")}>{riskCount}</div>
          <div className="text-[10px] text-muted-foreground">{t("风险任务")}</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-base font-semibold tabular-nums text-slate-900">
            {group.avgProgress}%
            {unreadCount > 0 && <span className="h-2 w-2 rounded-full bg-rose-500" title={t("有未读进展")} />}
          </div>
          <div className="text-[10px] text-muted-foreground">{t("整体进度")}</div>
        </div>
      </div>
    </motion.button>
  );
}

function SubsystemPanorama({
  groups,
  selectedKey,
  onSelectKey,
  onOpen,
  onKickoff,
  move,
  unreadByTask,
}: {
  groups: SubsystemGroup[];
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  onOpen: (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean; transfer?: boolean }) => void;
  onKickoff?: (task: WorkspaceTask) => void;
  move?: PanoramaMoveProps;
  unreadByTask?: Record<string, number>;
}) {
  const selectedGroup = selectedKey ? groups.find((group) => group.key === selectedKey) : null;
  const selectedTasks = useMemo(
    () => (selectedGroup ? [...selectedGroup.active, ...selectedGroup.done] : []),
    [selectedGroup],
  );

  if (selectedKey) {
    const riskCount = selectedGroup?.active.filter((task) => task.status === "paused_blocked" || isTaskOverdue(task)).length ?? 0;
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="unstyled"
                type="button"
                onClick={() => onSelectKey(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-[#cbd8f6] hover:bg-accent hover:text-primary-hover"
                aria-label={t("返回类目列表")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                <FolderOpen className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span>{t("个人工作台")}</span>
                  <ChevronRight className="h-3 w-3" />
                  <span>{t("类目任务")}</span>
                </div>
                <h2 className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={selectedGroup?.label}>{selectedGroup?.label}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-full bg-accent px-2.5 py-1 font-semibold text-primary-hover">{t("进行中")} {selectedGroup?.active.length ?? 0}</span>
              {riskCount > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-600">{t("风险")} {riskCount}</span>}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{t("全部")} {selectedGroup?.total ?? 0}</span>
            </div>
          </div>
        </div>

        <RdCategoryTaskTable
          caption={`${selectedGroup?.label ?? t("类目")} · ${t("我的任务")}`}
          sections={[{ key: selectedGroup?.key ?? selectedKey, tasks: selectedTasks }]}
          onOpenTask={(task) => {
            if (task.status !== "pending_review") onOpen(task, "detail");
          }}
          renderActions={(task) => {
            const pendingReview = task.status === "pending_review";
            const unreadCount = unreadByTask?.[task.task_id] ?? 0;
            const movable = Boolean(move) && task.role === "primary" && !task.parent_task_id;
            const selected = move?.selectedIds.has(task.task_id) ?? false;
            const kickoffVisible = Boolean(onKickoff)
              && task.role === "primary"
              && task.status !== "completed"
              && !pendingReview
              && (task.tree_depth ?? 1) < RD_TASK_TREE_MAX_DEPTH;
            return (
              <div className="flex items-center justify-end gap-1.5">
                {!pendingReview && (
                  <Button variant="unstyled"
                    type="button"
                    title={unreadCount > 0 ? t("有 {n} 条未读评论", { n: unreadCount }) : t("查看评论")}
                    aria-label={unreadCount > 0 ? t("查看评论，有 {n} 条未读", { n: unreadCount }) : t("查看评论")}
                    onClick={() => onOpen(task, "discussion")}
                    className={cn(
                      "relative inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8]",
                      unreadCount > 0
                        ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                        : "border-slate-200 bg-white text-slate-500 hover:border-[#cbd8f6] hover:text-primary-hover",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {unreadCount > 0 && <span className="tabular-nums">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                  </Button>
                )}
                {kickoffVisible && onKickoff && (
                  <Button variant="unstyled"
                    type="button"
                    title={t("在当前节点下发起立项")}
                    onClick={() => onKickoff(task)}
                    className="inline-flex h-8 items-center rounded-lg border border-[#dce5fa] bg-accent px-2 text-[11px] font-semibold text-primary-hover transition-colors hover:bg-[#dce5fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8]"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                  </Button>
                )}
                {!pendingReview && (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => onOpen(task, "progress")}
                    className="hidden h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#cbd8f6] hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8] xl:inline-flex xl:items-center"
                  >
                    {t("更新")}
                  </Button>
                )}
                {movable && move && (
                  <>
                    <Button variant="unstyled"
                      type="button"
                      title={t("移动到其它系统 / 子项")}
                      onClick={() => move.onMoveTask(task)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8]"
                    >
                      <FolderInput className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="unstyled"
                      type="button"
                      title={selected ? t("取消选择") : t("勾选以批量移动")}
                      aria-pressed={selected}
                      onClick={() => move.onToggleSelect(task)}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8]",
                        selected ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-transparent hover:border-[#8fa9e8]",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t("我的类目")}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("每个类目一张表，跨产品库汇总本人全部任务")}</p>
        </div>
        <span className="text-[11px] text-muted-foreground">{groups.length} {t("个类目")}</span>
      </div>

      {groups.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <SubsystemFolderCard
              key={group.key}
              group={group}
              onOpen={() => onSelectKey(group.key)}
              unreadByTask={unreadByTask}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-center">
          <Folder className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-slate-500">{t("没有匹配的类目")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("可以调整搜索或筛选条件")}</p>
        </div>
      )}
    </div>
  );
}

export function RDMyWorkspacePage() {
  useI18n(); // 订阅语言切换（页头/过滤条/任务卡/通知中心文案已 t() 化）
  const navigate = useNavigate();
  const { user } = useAuth();
  const canProposeProject = usePermission(PERMISSIONS.RD_PROJECT_PROPOSE);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canStartProject = canProposeProject || canDirectProject;
  const horizonWorkspace = !isProductionWorkspace();
  const notificationsFirst = horizonWorkspace && !isUsCollabWorkspace();
  // 研发审核通知已由服务端按当前节点成员池逐人投递；是否能执行仍由审核接口做最终授权。
  const canReview = Boolean(user);
  const canReviewNotification = useCallback((notification: WorkspaceNotification) => {
    if (!user || !notification.raw_body) return false;
    try {
      const body = JSON.parse(notification.raw_body) as Record<string, unknown>;
      if (body.type !== "review_request") return false;
      if (String(body.review_type ?? "") === "procurement_transfer") {
        return user.permissions.includes("*") || user.permissions.includes("rd-procurement:review");
      }
      return true;
    } catch {
      return false;
    }
  }, [user]);
  const [workspace, setWorkspace] = useState<RdWorkspacePayload<WorkspaceTask, AiSuggestion, WorkspaceNotification>>(EMPTY_WORKSPACE);
  const [taskAttachmentPreviews, setTaskAttachmentPreviews] = useState<Record<string, RdTaskAttachmentPreview>>({});
  const taskAttachmentPreviewRef = useRef<Record<string, RdTaskAttachmentPreview>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closedSuggestions, setClosedSuggestions] = useState<Set<string>>(new Set());
  const [regeneratedSuggestions, setRegeneratedSuggestions] = useState<Set<string>>(new Set());
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set());
  const [notifVisibleCount, setNotifVisibleCount] = useState(NOTIF_PAGE_SIZE);
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const sampleTestTaskId = searchParams.get("sampleTest")?.trim() || "";
  const closeSampleTest = useCallback(() => {
    setSearchParams((current) => withoutSampleTestQuery(current), { replace: true });
  }, [setSearchParams]);
  // 绩效自评弹窗状态（从通知抽屉「去自评」打开）
  const [perfSelfReport, setPerfSelfReport] = useState<RdPerformanceReport | null>(null);
  const [perfSelfNotifId, setPerfSelfNotifId] = useState<string | null>(null);
  const [taskVisibleCount, setTaskVisibleCount] = useState(WORKSPACE_PAGE_SIZE);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [proposalParentTask, setProposalParentTask] = useState<WorkspaceTask | null>(null);
  const taskScrollRef = React.useRef<HTMLDivElement>(null);
  const taskSentinelRef = React.useRef<HTMLDivElement>(null);
  const filteredRoleTasksLengthRef = React.useRef(0);
  const workspaceLoadSeqRef = React.useRef(0);
  const workspaceKey = isUsCollabWorkspace() ? "us-collab" : "rd";

  const loadWorkspace = React.useCallback(async (options?: { silent?: boolean }) => {
    const requestSeq = ++workspaceLoadSeqRef.current;
    if (!options?.silent) setLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchRdWorkspace({ includeCollaboration: !isUsCollabWorkspace() });
      if (requestSeq !== workspaceLoadSeqRef.current) return;
      setWorkspace({ ...EMPTY_WORKSPACE, ...payload });
    } catch (error) {
      if (requestSeq !== workspaceLoadSeqRef.current) return;
      if (!options?.silent) setWorkspace(EMPTY_WORKSPACE);
      setLoadError(error instanceof Error ? error.message : "个人工作台接口加载失败");
    } finally {
      if (requestSeq === workspaceLoadSeqRef.current && !options?.silent) setLoading(false);
    }
  }, [workspaceKey]);

  useEffect(() => {
    void loadWorkspace();
    return () => { workspaceLoadSeqRef.current += 1; };
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
  const [taskRoleTab, setTaskRoleTab] = useState<WorkspaceRoleTab>("primary");
  const myTasks = useMemo(() => applyProgressOverrides(workspace.myTasks, progressOverrides), [workspace.myTasks, progressOverrides]);
  const primaryTaskIds = useMemo(() => new Set(myTasks.map(workspaceTaskIdentity)), [myTasks]);
  const collabTasks = useMemo(
    () => applyProgressOverrides(workspace.collabTasks, progressOverrides).filter((task) => !primaryTaskIds.has(workspaceTaskIdentity(task))),
    [workspace.collabTasks, progressOverrides, primaryTaskIds],
  );
  const allTasks = useMemo(() => [...myTasks, ...collabTasks], [myTasks, collabTasks]);
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.task_id, task])), [allTasks]);
  const roleTasks = taskRoleTab === "primary" ? myTasks : collabTasks;
  const deferredTaskKeyword = useDeferredValue(taskKeyword);
  const normalizedTaskKeyword = deferredTaskKeyword.trim().toLowerCase();
  const taskFiltersActive = Boolean(taskKeyword.trim()) || taskPriorityFilter !== "all" || taskStatusFilter !== "all" || taskDueFilter !== "all";
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

  // 主责/协助数量同时可见；其余摘要跟随当前 Tab，避免主责视图混入协助任务的数据。
  const activeRoleTasks = useMemo(() => roleTasks.filter((task) => task.status !== "completed"), [roleTasks]);
  const completedCount = roleTasks.length - activeRoleTasks.length;
  const activeMyCount = useMemo(
    () => myTasks.reduce((count, task) => count + (task.status === "completed" ? 0 : 1), 0),
    [myTasks],
  );
  const activeCollabCount = useMemo(
    () => collabTasks.reduce((count, task) => count + (task.status === "completed" ? 0 : 1), 0),
    [collabTasks],
  );
  const averageProgress = useMemo(() => {
    if (activeRoleTasks.length === 0) return 0;
    return Math.round(activeRoleTasks.reduce((sum, task) => sum + task.progress, 0) / activeRoleTasks.length);
  }, [activeRoleTasks]);
  const dueStats = useMemo(
    () =>
      activeRoleTasks.reduce(
        (stats, task) => {
          const days = workspaceDaysUntil(task.due_date);
          if (isTaskOverdue(task)) stats.overdue += 1;
          if (days === 0) stats.today += 1;
          return stats;
        },
        { overdue: 0, today: 0 },
      ),
    [activeRoleTasks],
  );
  const overdueCount = dueStats.overdue;
  const dueTodayCount = dueStats.today;

  // 当前角色下逐条展示任务；待审核沉底、已完成最底。
  const filteredRoleTasks = useMemo(
    () => [...(taskRoleTab === "primary" ? filteredMyTasks : filteredCollabTasks)].sort(compareWorkspaceTasks),
    [filteredCollabTasks, filteredMyTasks, taskRoleTab],
  );
  const shownTasks = useMemo(
    () => filteredRoleTasks.slice(0, taskVisibleCount),
    [filteredRoleTasks, taskVisibleCount],
  );
  const hasMoreTasks = taskVisibleCount < filteredRoleTasks.length;
  const visiblePreviewTaskKey = useMemo(() => {
    const currentWorkspace = isUsCollabWorkspace() ? "us-collab" : "rd";
    return shownTasks
      .filter((task) => (task.source_workspace ?? currentWorkspace) === currentWorkspace)
      .map((task) => task.task_id)
      .join("|");
  }, [shownTasks]);
  // Keep ref in sync so the IntersectionObserver callback always has the latest value
  filteredRoleTasksLengthRef.current = filteredRoleTasks.length;

  useEffect(() => {
    const missingIds = visiblePreviewTaskKey
      .split("|")
      .filter(Boolean)
      .filter((taskId) => !(taskId in taskAttachmentPreviewRef.current));
    if (missingIds.length === 0) return;
    const controller = new AbortController();
    void fetchRdTaskAttachmentPreviews(missingIds, { signal: controller.signal })
      .then((previews) => {
        if (!controller.signal.aborted) {
          taskAttachmentPreviewRef.current = { ...taskAttachmentPreviewRef.current, ...previews };
          setTaskAttachmentPreviews((current) => ({ ...current, ...previews }));
        }
      })
      .catch(() => {
        // 附件预览失败不阻断任务列表，数量仍由工作台任务投影展示。
      });
    return () => controller.abort();
  }, [visiblePreviewTaskKey]);

  // 用户切换筛选时从首条任务重新查看；后台刷新不重置位置。
  useEffect(() => {
    setTaskVisibleCount(WORKSPACE_PAGE_SIZE);
    if (taskScrollRef.current) taskScrollRef.current.scrollTop = 0;
  }, [taskKeyword, taskPriorityFilter, taskStatusFilter, taskDueFilter, taskRoleTab]);

  // Infinite scroll: load more tasks when sentinel enters the task scroll area.
  useEffect(() => {
    const el = taskSentinelRef.current;
    const root = taskScrollRef.current;
    if (!el || !root || !hasMoreTasks) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setTaskVisibleCount((prev) => {
            const total = filteredRoleTasksLengthRef.current;
            return prev >= total ? prev : Math.min(prev + WORKSPACE_PAGE_SIZE, total);
          });
        }
      },
      { root, rootMargin: "180px 0px 240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filteredRoleTasks.length, hasMoreTasks, loading]);

  const findTask = useCallback((taskId?: string) => (taskId ? taskById.get(taskId) : undefined), [taskById]);

  // ── 评论未读红点（微信式）：任务级未读数，打开任务即标记已读（全端同步消失）──
  const [noteUnread, setNoteUnread] = useState<Record<string, number>>({});
  const refreshNoteUnread = useCallback(() => {
    return fetchRdNoteUnreadSummary()
      .then(setNoteUnread)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshNoteUnread();
    };
    const interval = window.setInterval(refresh, 15_000);
    void refreshNoteUnread();
    window.addEventListener("focus", refresh);
    window.addEventListener("rd:discussion-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rd:discussion-updated", refresh);
    };
  }, [refreshNoteUnread]);

  const openTask = (task: WorkspaceTask, tab: OperationTab, opts?: { abandon?: boolean; transfer?: boolean }) => {
    const currentWorkspace = isUsCollabWorkspace() ? "us-collab" : "rd";
    if (task.source_workspace && task.source_workspace !== currentWorkspace) {
      const detailPath = task.source_workspace === "us-collab" ? "/us-collab-task" : "/rd-task";
      navigate(`${detailPath}/${encodeURIComponent(task.task_id)}`, { state: { task } });
      return;
    }
    setActivePanel({ kind: "task", task, tab, openedAt: Date.now(), abandon: opts?.abandon, transfer: opts?.transfer });
    // 正式留痕与讨论使用不同已读游标；打开任务只清正式留痕，讨论需实际打开对应会话。
    void markRdTaskNotesRead(task.task_id)
      .catch(() => {})
      .finally(() => { void refreshNoteUnread(); });
  };

  // 深链定位：MateChat 参考来源 / 通知等带 ?task=<编号> 进来时，任务数据就绪后自动打开该任务详情并锁定，
  // 随后清除该参数，避免刷新或返回时重复弹出。找不到（非本工作台任务/尚未加载）则静默忽略。
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId) return;
    const target = allTasks.find((t) => t.task_id === taskId);
    if (!target) return;
    openTask(target, "detail");
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allTasks]);

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

  const settleReviewNotification = React.useCallback(async (notification: WorkspaceNotification) => {
    // 任务审核和通知回写不是同一事务：任务一旦已处理，必须先在本地撤掉操作入口，
    // 避免后续工作台刷新把同一条通知重新变成可批准/驳回。
    setDismissedNotifs((prev) => {
      if (prev.has(notification.id)) return prev;
      const next = new Set(prev);
      next.add(notification.id);
      return next;
    });
    setWorkspace((prev) => ({
      ...prev,
      notifications: prev.notifications.map((item) => (
        item.id === notification.id ? { ...item, handled: true, read: true } : item
      )),
    }));
    setActivePanel((current) => (
      current?.kind === "notification" && current.notification.id === notification.id ? null : current
    ));

    const messageSynced = await patchReviewNotificationHandled(notification.id);
    if (messageSynced) {
      window.dispatchEvent(new CustomEvent("rd:messages-updated"));
    } else {
      retryReviewNotificationHandledLater(notification.id);
    }
    return messageSynced;
  }, []);

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
      reviewType === "procurement_transfer"
        ? t("转采购审核")
        : reviewType === "collaboration"
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
        reviewType === "procurement_transfer"
          ? t("通过后申请才会进入采购驾驶舱，并按采购部门负载分配采购负责人。")
          : reviewType === "collaboration"
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
        let alreadySettled = false;
        try {
          if (reviewType === "procurement_transfer") {
            await approveRdProcurementTransfer(taskId);
          } else {
            await updateRdTask(taskId, {
              _review_action: "approve",
              _reviewer_name: user?.name,
            } as Parameters<typeof updateRdTask>[1]);
          }
        } catch (error) {
          if (!isReviewAlreadySettledError(error)) throw error;
          alreadySettled = true;
        }
        if (reviewType === "procurement_transfer") announceProcurementRefresh();

        const messageSynced = await settleReviewNotification(notification);
        if (alreadySettled) {
          toast.info(messageSynced
            ? t("该任务已完成审核，当前通知已同步为已处理。")
            : t("该任务已完成审核，通知已从当前工作台收起，消息状态将在后台重试同步。"));
        } else if (messageSynced) {
          toast.success(t("已批准「{title}」", { title: taskTitle }));
        } else {
          toast.warning(t("已批准「{title}」；通知已从当前工作台收起，消息状态将在后台重试同步。", { title: taskTitle }));
        }
        window.dispatchEvent(new CustomEvent("rd:review-submitted"));
        await loadWorkspace({ silent: true });
      },
    });
  }, [loadWorkspace, settleReviewNotification, user?.name]);

  const rejectNotificationReview = React.useCallback(async (notification: WorkspaceNotification, reason: string) => {
    if (!notification.raw_body) return;
    try {
      const body = JSON.parse(notification.raw_body) as Record<string, unknown>;
      const taskId = String(body.task_id ?? "");
      const taskTitle = String(body.task_title ?? "");
      const reviewType = String(body.review_type ?? "");
      let alreadySettled = false;
      try {
        if (reviewType === "procurement_transfer") {
          await rejectRdProcurementTransfer(taskId, reason);
        } else {
          await updateRdTask(taskId, {
            _review_action: "reject",
            _reviewer_name: user?.name,
            _reject_reason: reason,
          } as Parameters<typeof updateRdTask>[1]);
        }
      } catch (error) {
        if (!isReviewAlreadySettledError(error)) throw error;
        alreadySettled = true;
      }
      if (reviewType === "procurement_transfer") announceProcurementRefresh();

      const messageSynced = await settleReviewNotification(notification);
      if (alreadySettled) {
        toast.info(messageSynced
          ? t("该任务已完成审核，当前通知已同步为已处理。")
          : t("该任务已完成审核，通知已从当前工作台收起，消息状态将在后台重试同步。"));
      } else if (messageSynced) {
        toast.success(t("已驳回「{title}」", { title: taskTitle }));
      } else {
        toast.warning(t("已驳回「{title}」；通知已从当前工作台收起，消息状态将在后台重试同步。", { title: taskTitle }));
      }
      window.dispatchEvent(new CustomEvent("rd:review-submitted"));
      await loadWorkspace({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("操作失败"));
    }
  }, [loadWorkspace, settleReviewNotification, user?.name]);

  const closeSuggestion = (id: string) => {
    setClosedSuggestions((prev) => new Set(prev).add(id));
    setActivePanel(null);
  };

  return (
    <div className={cn("flex h-full min-h-0 px-5 py-6 lg:px-7", horizonWorkspace && "rd-horizon-module rd-horizon-workspace")}>
      <div className="rd-horizon-workspace-shell mx-auto flex h-full min-h-0 w-full max-w-[1680px] flex-col gap-4">
        {/* ── Compact header ── */}
        <header className="rd-horizon-workspace-command rounded-2xl border border-white bg-white/75 px-5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left group: title + date + stat chips */}
            <div className="rd-horizon-workspace-metrics flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="rd-horizon-workspace-title shrink-0 text-balance text-base font-semibold text-slate-950">
                {t(isUsCollabWorkspace() ? "协同工作台" : "个人工作台")}
              </h2>
              <span className="rd-horizon-workspace-date shrink-0 text-xs tabular-nums text-muted-foreground">{t("今日")} {todayLabel()}</span>
              {/* Stat chips — always shown */}
              <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary" data-tone="brand">
                <User className="size-3" aria-hidden="true" />
                {t("主责")} {activeMyCount}
              </span>
              <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600" data-tone="neutral">
                <Users className="size-3" aria-hidden="true" />
                {t("协助")} {activeCollabCount}
              </span>
              <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-700" data-tone="complete">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                {t("完成率")} {averageProgress}%
              </span>
              {completedCount > 0 && (
                <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-700" data-tone="complete">
                  <Check className="size-3" aria-hidden="true" />
                  {t("已完成")} {completedCount}
                </span>
              )}
              {/* Conditional chips */}
              {overdueCount > 0 && (
                <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-rose-700" data-tone="danger">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {t("逾期")} {overdueCount}
                </span>
              )}
              {dueTodayCount > 0 && (
                <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-700" data-tone="warning">
                  <CalendarClock className="size-3" aria-hidden="true" />
                  {t("今日到期")} {dueTodayCount}
                </span>
              )}
              {visibleNotifications.length + visibleSuggestions.length > 0 && (
                <span className="rd-horizon-workspace-metric inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary" data-tone="brand">
                  <Bell className="size-3" aria-hidden="true" />
                  {t("待处理")} {visibleNotifications.length + visibleSuggestions.length}
                </span>
              )}
            </div>
            {/* Right: AI 立项 button */}
            {canStartProject && (
              <Button
                type="button"
                onClick={() => {
                  setProposalParentTask(null);
                  setShowProposalDialog(true);
                }}
                className="rd-horizon-workspace-primary-action inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                title={t("AI 立项 · 上传文档或写描述，自动拆任务")}
              >
                <Sparkles className="size-3.5" />
                {t("AI 立项")}
                <ChevronRight className="size-3" />
              </Button>
            )}
          </div>
        </header>

        {loadError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="text-pretty">{loadError}</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void loadWorkspace()} className="shrink-0 border-amber-300 bg-white text-amber-900 focus-visible:ring-amber-600">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
              {loading ? t("重试中…") : t("重新加载")}
            </Button>
          </div>
        )}

        {/* ── Body: 2-column grid ── */}
        <div className="rd-horizon-workspace-grid grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden 2xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.65fr)]">
          {/* ── LEFT column ── */}
          <main className="rd-horizon-workspace-main flex min-h-0 flex-col gap-3">
            {/* Sticky filter bar */}
            <div className="rd-horizon-workspace-filters shrink-0 rounded-2xl border border-white bg-white/90 p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* 搜索与筛选按实际可用空间换行，避免视口和工作台容器断点不一致。 */}
                <div className="rd-horizon-workspace-search relative min-w-0 flex-1 basis-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-8 text-xs text-slate-700 outline-none transition-colors focus:border-[#8fa9e8] focus:bg-white focus:ring-2 focus:ring-[#dce5fa]"
                    placeholder={t("搜索任务、负责人…")}
                    aria-label={t("搜索任务、负责人…")}
                    value={taskKeyword}
                    onChange={(event) => setTaskKeyword(event.target.value)}
                  />
                  {taskKeyword && (
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => setTaskKeyword("")}
                      aria-label={t("清除任务搜索")}
                      className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>

                {/* 筛选组空间不足时独占一行，内部保留横向滚动。 */}
                <div className="rd-horizon-workspace-filter-controls flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-1">
                  <ToggleGroup
                    type="single" value={taskRoleTab} onValueChange={(value) => { if (value) setTaskRoleTab(value as "primary" | "collaborator"); }}
                    aria-label={t("任务角色筛选")}
                    className="rd-horizon-workspace-role-tabs flex items-center gap-0.5 rounded-[8px] border border-slate-200 bg-slate-50 p-0.5"
                  >
                    <ToggleGroupItem
                      value="primary"
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        taskRoleTab === "primary" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      <User className="h-3.5 w-3.5" />
                      {t("主责")}
                      <span className="tabular-nums text-[10px] opacity-70">{myTasks.length}</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="collaborator"
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        taskRoleTab === "collaborator" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {t("协助")}
                      <span className="tabular-nums text-[10px] opacity-70">{collabTasks.length}</span>
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <NativeSelect
                    aria-label={t("优先级")}
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
                    value={taskPriorityFilter}
                    onChange={(event) => setTaskPriorityFilter(event.target.value as Priority | "all")}
                  >
                    <option value="all">{t("优先级")}</option>
                    <option value="high">{t("高")}</option>
                    <option value="medium">{t("中")}</option>
                    <option value="low">{t("低")}</option>
                  </NativeSelect>
                  <NativeSelect
                    aria-label={t("状态")}
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
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
                    aria-label={t("时间")}
                    className="h-8 rounded-[8px] border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#8fa9e8] focus:ring-2 focus:ring-[#dce5fa]"
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
                  {taskFiltersActive && (
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => {
                        setTaskKeyword("");
                        setTaskPriorityFilter("all");
                        setTaskStatusFilter("all");
                        setTaskDueFilter("all");
                      }}
                      className="h-8 shrink-0 rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#cbd8f6] hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {t("清空筛选")}
                    </Button>
                  )}
                  <span className="whitespace-nowrap pl-1 text-[11px] tabular-nums text-muted-foreground">
                    {loading ? t("加载中…") : `${filteredRoleTasks.length} / ${roleTasks.length}`}
                  </span>
                </div>
              </div>
            </div>

            <div ref={taskScrollRef} className="rd-horizon-workspace-task-scroll material-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
              {/* Task list */}
              {loading ? (
                <div role="status" aria-label={t("正在加载任务")} className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="min-h-[220px] animate-pulse rounded-2xl border border-slate-100 bg-white p-4" aria-hidden="true">
                      <div className="h-4 w-2/3 rounded bg-slate-200" />
                      <div className="mt-4 h-3 w-full rounded bg-slate-100" />
                      <div className="mt-2 h-3 w-4/5 rounded bg-slate-100" />
                      <div className="mt-20 h-1.5 w-full rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              ) : filteredRoleTasks.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
                  {taskRoleTab === "primary" ? (
                    <User className="mb-2 size-8 text-muted-foreground" />
                  ) : (
                    <Users className="mb-2 size-8 text-muted-foreground" />
                  )}
                  <p className="text-sm font-medium text-slate-500">
                    {taskFiltersActive
                      ? taskRoleTab === "primary" ? t("没有匹配的主责任务") : t("没有匹配的协助任务")
                      : taskRoleTab === "primary" ? t("当前没有由我主责的任务") : t("当前没有需要我协助的任务")}
                  </p>
                  <p className="mt-1 max-w-md text-pretty text-xs leading-5 text-muted-foreground">
                    {taskFiltersActive ? t("调整筛选条件以查看其他任务。") : t("刷新后将同步最新的任务归属与进度。")}
                  </p>
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => {
                      if (taskFiltersActive) {
                        setTaskKeyword("");
                        setTaskPriorityFilter("all");
                        setTaskStatusFilter("all");
                        setTaskDueFilter("all");
                      } else {
                        void loadWorkspace();
                      }
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#cbd8f6] hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    {taskFiltersActive ? <X className="size-3.5" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
                    {taskFiltersActive ? t("清空筛选") : t("刷新工作台")}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="rd-horizon-workspace-task-list space-y-2">
                    <AnimatePresence>
                      {shownTasks.map((task) => (
                        <WorkspaceTaskCard
                          key={workspaceTaskIdentity(task)}
                          task={task}
                          attachmentPreview={
                            (task.source_workspace ?? (isUsCollabWorkspace() ? "us-collab" : "rd")) === (isUsCollabWorkspace() ? "us-collab" : "rd")
                              ? taskAttachmentPreviews[task.task_id]
                              : undefined
                          }
                          onOpen={openTask}
                          unreadCount={task.source_workspace === "us-collab" ? 0 : noteUnread[task.task_id] ?? 0}
                        />
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* Infinite scroll sentinel */}
                  <div ref={taskSentinelRef}>
                    {hasMoreTasks ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
                        <ChevronDown className="size-3" />
                        <span>{t("滚动加载更多 · 已显示")} <span className="tabular-nums">{shownTasks.length}</span> / {t("共")} <span className="tabular-nums">{filteredRoleTasks.length}</span> {t("个")}</span>
                      </div>
                    ) : filteredRoleTasks.length > WORKSPACE_PAGE_SIZE ? (
                      <div className="mt-3 flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        <span>{t("已显示全部 {n} 个任务", { n: filteredRoleTasks.length })}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </main>

          {/* ── RIGHT column ── */}
          <aside className="rd-horizon-workspace-aside material-scrollbar min-h-0 space-y-4 overflow-y-auto pr-1">
            {/* MateChat 连续使用打卡（激励多用 AI） */}
            {!notificationsFirst && <MateChatStreakCardConnected variant="full" className="rd-horizon-workspace-streak-card" />}
            {/* 通知中心 */}
            <SectionCard title={t("通知中心")} icon={Bell} count={visibleNotifications.length}>
              {visibleNotifications.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-muted-foreground">{t("暂无新通知")}</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {shownNotifications.map((notification) => {
                      const isMessage = notification.type === "message";
                      const sampleTestMessage = parseProcurementSampleTestMessage(notification.raw_body);
                      const transferReturnedMessage = parseProcurementTransferReturnedMessage(notification.raw_body);
                      return (
                        <li key={notification.id}>
                          <div
                            className={cn(
                              "rd-horizon-workspace-notification group flex w-full cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
                              isMessage
                                ? "border-[#dce5fa] bg-accent/60"
                                : notification.type === "blocked" || notification.type === "due_soon"
                                  ? "border-amber-100 bg-amber-50"
                                  : "border-slate-100 bg-slate-50",
                            )}
                          >
                            <Button variant="unstyled"
                              type="button"
                              onClick={() => {
                                const openedNotification = { ...notification, read: true };
                                markNotificationRead(notification);
                                setActivePanel({ kind: "notification", notification: openedNotification });
                              }}
                              className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left focus-visible:outline-none"
                            >
                              {isMessage ? (
                                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                              ) : (
                                <AlertTriangle
                                  className={cn(
                                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                                    notification.type === "blocked" ? "text-rose-500" : "text-amber-500",
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
                                        notification.read ? "bg-slate-100 text-slate-500" : "bg-rose-50 text-rose-600 ring-1 ring-rose-100",
                                      )}
                                    >
                                      {notification.read ? t("已读") : t("未读")}
                                    </span>
                                  ) : null}
                                </span>
                                <AutoTranslatedText as="div" className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600" text={sampleTestMessage ? sampleTestMessageSummary(sampleTestMessage) : transferReturnedMessage ? transferReturnedMessageSummary(transferReturnedMessage) : notification.message} />
                                <span className="mt-1 block text-[10px] text-muted-foreground">{relativeTimeLabel((notification as { created_at?: string }).created_at, notification.time)}</span>
                              </span>
                            </Button>
                            <Button variant="unstyled"
                              type="button"
                              onClick={() =>
                                setConfirmDialog({
                                  title: t("确认关闭通知"),
                                  message: t("将关闭「{title}」这条通知。", { title: notification.title }),
                                  confirmLabel: t("确认关闭"),
                                  details: [t("关闭后会从通知中心移除"), t(sampleTestMessage?.type === "procurement_sample_test_request" ? "关闭通知不会完成测试；仍需研发测试人填写并确认结论。" : transferReturnedMessage ? "关闭通知不会继续转采购；仍需返回原研发任务操作。" : "不会影响关联任务本身")],
                                  onConfirm: () => {
                                    // Persist handled state to backend so it survives page refresh
                                    if (notification.id.startsWith("msg-")) {
                                      void patchRdMessage(notification.id, { handled: true, read: true }).catch(() => {});
                                    }
                                    setDismissedNotifs((prev) => new Set(prev).add(notification.id));
                                  },
                                })
                              }
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-white hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                              aria-label={t("关闭通知")}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Pagination */}
                  {hasMoreNotifs ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground">
                      <ChevronDown className="h-3 w-3" />
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => setNotifVisibleCount((prev) => prev + NOTIF_PAGE_SIZE)}
                        className="font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-700"
                      >
                        {t("加载更多")}
</Button>
                      <span>· {t("已显示 {shown} / 共 {total} 条", { shown: shownNotifications.length, total: visibleNotifications.length })}</span>
                    </div>
                  ) : visibleNotifications.length > NOTIF_PAGE_SIZE ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span>{t("已显示全部 {n} 条通知", { n: visibleNotifications.length })}</span>
                    </div>
                  ) : null}
                </>
              )}
            </SectionCard>

            {notificationsFirst && <MateChatStreakCardConnected variant="full" className="rd-horizon-workspace-streak-card" />}

            {/* AI 建议 */}
            {visibleSuggestions.length > 0 && (
              <SectionCard title={t("待审核 AI 建议")} icon={Sparkles} count={visibleSuggestions.length} helper={t("确认后才写入任务池")}>
                <div className="space-y-3">
                  {visibleSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rd-horizon-workspace-ai-card rounded-xl border border-[#dce5fa] bg-accent/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-xs font-semibold text-slate-900">{suggestion.title}</h3>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-slate-500">{suggestion.preview}</p>
                        </div>
                        <span className="rd-horizon-workspace-ai-score shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-primary-hover">
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
          autoTransfer={activePanel.transfer}
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
          onTaskChanged={async () => {
            setActivePanel(null);
            await loadWorkspace({ silent: true });
          }}
          onSubtaskChanged={async () => {
            // 任务在树中的位置变了（父子关系增删），无法局部更新，直接整表重拉
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
            setActivePanel({ kind: "ai", suggestion: activePanel.suggestion, regenerated: true });
          }}
          onConfirm={() =>
            setConfirmDialog({
              title: t("确认写入任务池"),
              message: t("将把「{title}」生成的内容写入任务池。", { title: activePanel.suggestion.title }),
              confirmLabel: t("确认写入"),
              details: [t("生成任务数：{n}", { n: activePanel.suggestion.generated_tasks.length }), t("来源：{source}", { source: activePanel.suggestion.source }), t("写入后会从待审核列表移除")],
              onConfirm: () => {
                activePanel.suggestion.generated_tasks.forEach((task, index) => {
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
          onOpenDiscussion={(notification) => {
            const body = parseRdDiscussionMention(notification.raw_body);
            if (!body) return;
            navigate(rdDiscussionMentionHref(body, {
              notificationId: notification.id,
              createdAt: notification.created_at,
            }));
          }}
          canReview={canReview && canReviewNotification(activePanel.notification)}
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
            if (notif) await rejectNotificationReview(notif, reason);
          }}
        />
      )}

      {sampleTestTaskId && <ProcSampleTestDialog key={sampleTestTaskId} taskId={sampleTestTaskId} onClose={closeSampleTest} onConfirmed={() => { void loadWorkspace({ silent: true }); }} />}

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
        open={(showProposalDialog || Boolean(proposalParentTask)) && canStartProject}
        onClose={() => {
          setShowProposalDialog(false);
          setProposalParentTask(null);
        }}
        onCompleted={() => loadWorkspace({ silent: true })}
        userRole="user"
        forceOwnerToCurrentUser
        parentTask={proposalParentTask ?? undefined}
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

    </div>
  );
}
