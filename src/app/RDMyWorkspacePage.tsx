import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  CheckSquare,
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
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { AuditTimeline } from "./RDAuditTimeline";
import { AuditActor, recordAudit, useAuditActor, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  assessRdTaskProgress,
  createRdDailyReport,
  createRdTaskProgressNote,
  fetchRdWorkspace,
  updateRdTask,
  type RdAiProgressAssessment,
  type RdDailyReport,
  type RdPriority,
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
  | { kind: "task"; task: WorkspaceTask; tab: OperationTab }
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
  onConfirm: () => void;
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

const MY_TASKS: WorkspaceTask[] = [
  {
    task_id: "RD-2026-001",
    title: "电磁阀温升测试方案制定",
    priority: "high",
    progress: 45,
    due_date: "2026-05-20",
    status: "in_progress",
    status_label: "进行中",
    role: "primary",
    category_path: "310阀系统 / 310电磁阀",
    owner: "我",
    description: "补齐电磁阀温升测试方案，确认测试边界、夹具准备、数据记录模板和验收口径。",
    next_action: "今天完成测试方案初稿，并同步给赵强做结构确认。",
    deliverables: ["测试方案初稿", "温升数据记录表", "风险项确认清单"],
    blockers: ["测试夹具到位时间未最终确认"],
    timeline: [
      { label: "任务创建", time: "05-10 09:30", state: "done" },
      { label: "方案拆解", time: "05-12 16:20", state: "done" },
      { label: "测试方案编制", time: "当前", state: "current" },
      { label: "评审提交", time: "预计 05-16", state: "todo" },
    ],
  },
  {
    task_id: "RD-2026-008",
    title: "电磁阀 ECN 变更文档更新",
    priority: "medium",
    progress: 20,
    due_date: "2026-05-22",
    status: "in_progress",
    status_label: "进行中",
    role: "primary",
    category_path: "310阀系统 / 310电磁阀",
    owner: "我",
    ai_pending: true,
    description: "根据结构变更记录补齐 ECN 文档，明确影响范围、BOM 变更和验证要求。",
    next_action: "确认 ECN 变更范围，并把 AI 摘要中的风险项转成检查项。",
    deliverables: ["ECN 变更说明", "BOM 影响项", "验证要求列表"],
    blockers: [],
    timeline: [
      { label: "资料收集", time: "05-13 11:00", state: "done" },
      { label: "AI 摘要待确认", time: "当前", state: "current" },
      { label: "文档更新", time: "预计 05-15", state: "todo" },
      { label: "提交审核", time: "预计 05-17", state: "todo" },
    ],
  },
  {
    task_id: "RD-2026-012",
    title: "510K 法规资料整理",
    priority: "high",
    progress: 0,
    due_date: "2026-05-19",
    status: "paused_leave",
    status_label: "暂停/请假",
    role: "primary",
    category_path: "外观结构 / 法规资料",
    owner: "我",
    on_leave: true,
    description: "整理 510K 资料目录和缺失项，给法规同事提供可追踪的补料清单。",
    next_action: "复岗后先确认资料缺口，再安排补料责任人。",
    deliverables: ["资料目录", "缺失项清单", "补料责任分配"],
    blockers: ["主责人请假，资料确认顺延"],
    timeline: [
      { label: "任务创建", time: "05-11 10:00", state: "done" },
      { label: "资料盘点", time: "05-12 15:40", state: "done" },
      { label: "暂停/请假", time: "当前", state: "current" },
      { label: "补料确认", time: "待恢复", state: "todo" },
    ],
  },
];

const COLLAB_TASKS: WorkspaceTask[] = [
  {
    task_id: "RD-2026-004",
    title: "串口握手协议优化",
    priority: "high",
    progress: 65,
    due_date: "2026-05-18",
    status: "paused_blocked",
    status_label: "协作受阻",
    role: "collaborator",
    category_path: "Top结构 / 嵌入式接口",
    owner: "赵强",
    collab_role: "嵌入式工程师",
    description: "配合固件侧完成串口握手协议优化，重点确认超时重试和异常恢复策略。",
    next_action: "补充异常恢复测试数据，反馈给主责人合并方案。",
    deliverables: ["异常恢复测试记录", "接口参数确认", "协作反馈"],
    blockers: ["上游固件参数仍在调整"],
    timeline: [
      { label: "协作加入", time: "05-12 14:10", state: "done" },
      { label: "联调测试", time: "05-13 18:00", state: "done" },
      { label: "等待上游参数", time: "当前", state: "current" },
      { label: "反馈结论", time: "预计 05-16", state: "todo" },
    ],
  },
  {
    task_id: "RD-2026-006",
    title: "电池循环寿命测试",
    priority: "medium",
    progress: 78,
    due_date: "2026-05-30",
    status: "in_progress",
    status_label: "进行中",
    role: "collaborator",
    category_path: "电源部分 / 电池",
    owner: "陈静",
    collab_role: "质检工程师",
    description: "协作跟进电池循环寿命测试数据，确认异常样本和复测条件。",
    next_action: "补录第 3 组样本数据，并标记异常曲线。",
    deliverables: ["循环寿命数据", "异常样本说明", "复测建议"],
    blockers: [],
    timeline: [
      { label: "任务同步", time: "05-09 10:30", state: "done" },
      { label: "样本测试", time: "05-13 17:20", state: "done" },
      { label: "数据补录", time: "当前", state: "current" },
      { label: "复测建议", time: "预计 05-21", state: "todo" },
    ],
  },
];

const TODAY_TODOS = [
  { text: "提交电磁阀温升测试初稿", task_id: "RD-2026-001" },
  { text: "确认 ECN 变更范围，并与项目工程师对齐", task_id: "RD-2026-008" },
  { text: "回复陈工关于串口握手参数的问题", task_id: "RD-2026-004" },
];

const AI_SUGGESTIONS: AiSuggestion[] = [
  {
    id: "sug-1",
    type: "task_create",
    title: "会议纪要转 3 个研发任务",
    preview: "系统从今日早会纪要中识别出测试方案、BOM 更新、文档归档 3 个后续动作。",
    confidence: 88,
    source: "今日 09:30 研发晨会纪要",
    generated_tasks: [
      { title: "确认电磁阀压差测试边界", owner: "我", due: "05-16", priority: "high" },
      { title: "补齐 BOM 变更影响项", owner: "赵强", due: "05-17", priority: "medium" },
      { title: "归档温升测试记录模板", owner: "陈静", due: "05-20", priority: "low" },
    ],
  },
  {
    id: "sug-2",
    type: "summary",
    title: "实验记录摘要待确认",
    preview: "AI 已整理温升测试记录摘要，建议确认测试夹具未到位这一阻塞点。",
    confidence: 76,
    source: "RD-2026-001 最新实验记录",
    generated_tasks: [
      { title: "确认测试夹具到货时间", owner: "我", due: "05-15", priority: "high" },
      { title: "补充温升测试风险说明", owner: "我", due: "05-16", priority: "medium" },
    ],
  },
];

const NOTIFICATIONS: WorkspaceNotification[] = [
  {
    id: "n1",
    type: "due_soon",
    title: "任务即将到期",
    message: "RD-2026-012 / 510K 法规资料整理将在明天到期，需要确认是否顺延。",
    time: "刚刚",
    related_task_id: "RD-2026-012",
  },
  {
    id: "n2",
    type: "blocked",
    title: "协作任务受阻",
    message: "RD-2026-004 / 串口握手协议优化存在上游阻塞，影响你的协作反馈。",
    time: "1 小时前",
    related_task_id: "RD-2026-004",
  },
  {
    id: "n3",
    type: "pending_ai",
    title: "AI 摘要待确认",
    message: "1 份实验记录等待你确认 AI 摘要和后续动作。",
    time: "2 小时前",
    related_task_id: "RD-2026-001",
  },
];

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
    <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.045)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon className="h-4 w-4 text-slate-500" />
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-500">{count}</span>
          )}
        </h2>
        {helper && <span className="text-xs text-slate-400">{helper}</span>}
      </div>
      {children}
    </section>
  );
}

function WorkspaceMetric({
  label,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/75 bg-white px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon className={cn("h-4 w-4", tone)} />
      </div>
      <div className="text-2xl font-semibold leading-none tabular-nums text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{helper}</div>
    </div>
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

  const confirm = () => {
    config.onConfirm();
    onCancel();
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
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2",
              isDanger
                ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-200"
                : "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-200",
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {config.confirmLabel}
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
        "group rounded-xl border bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.07)]",
        task.on_leave ? "border-amber-100 bg-amber-50/40" : task.status === "blocked" ? "border-red-100 bg-red-50/30" : "border-slate-200/80",
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
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{task.next_action}</p>
          </div>
          <PriorityBadge priority={task.priority} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
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

        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={task.progress} />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500">{task.progress}%</span>
        </div>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
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
}: {
  task: WorkspaceTask;
  initialTab: OperationTab;
  onClose: () => void;
  onProgressSave: (taskId: string, progress: number) => void | Promise<void>;
  onLog: (message: string) => void;
  onRequestConfirm: (config: ConfirmDialogConfig) => void;
}) {
  const WORKSPACE_AUDIT_ACTOR = useAuditActor("研发成员");
  const [tab, setTab] = useState<OperationTab>(initialTab);
  const [draftProgress, setDraftProgress] = useState(task.progress);
  const [note, setNote] = useState("");
  const [uploadedEvidence, setUploadedEvidence] = useState<UploadedEvidence[]>([]);
  const [aiAssessment, setAiAssessment] = useState<ProgressAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [noteAttachments, setNoteAttachments] = useState<File[]>([]);
  const [savingNote, setSavingNote] = useState(false);
  const [handoffTo, setHandoffTo] = useState("赵强");
  const [receipt, setReceipt] = useState<string | null>(null);
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });

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
          { label: "选择接收人", helper: "明确新责任人", state: "current" as const },
          { label: "说明影响", helper: "交代风险和下一步", state: "todo" as const },
          { label: "提交审批", helper: "同步给负责人", state: "todo" as const },
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
    let progressToSave = draftProgress;
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
        progressToSave = Math.max(draftProgress, assessmentForSave.progress);
        setAiAssessment(assessmentForSave);
        setDraftProgress(progressToSave);
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
          setNoteAttachments([]);
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
      setDraftProgress(Math.max(draftProgress, assessment.progress));
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
    const message = `${task.task_id} 已提交移交给 ${handoffTo}`;
    onRequestConfirm({
      title: "确认提交移交",
      message: `将把 ${task.task_id} 的移交流程提交给 ${handoffTo}。`,
      confirmLabel: "确认移交",
      details: ["提交后会生成移交记录", "接收人和相关负责人会看到该流程", "当前页面会保留操作日志"],
      onConfirm: () => {
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.handoff_requested",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [{ field: "owner", before: task.owner, after: handoffTo }],
          comment: "提交任务移交流程",
          metadata: { current_progress: task.progress },
          source: "web",
        });
        setReceipt(message);
        onLog(message);
      },
    });
  };

  const submitResult = () => {
    const message = `${task.task_id} 已提交结果审核`;
    onRequestConfirm({
      title: "确认提交审核",
      message: `将把 ${task.task_id} 提交给上级审核。`,
      confirmLabel: "确认提交",
      details: ["请确认交付物、风险说明和测试记录已补齐", "提交后会进入审核流转", "审核人会看到本次提交说明"],
      onConfirm: () => {
        recordAudit({
          actor: WORKSPACE_AUDIT_ACTOR,
          action: "task.submitted",
          resource: { type: "task", id: task.task_id, name: task.title },
          changes: [{ field: "status", before: task.status, after: "pending_review" }],
          comment: "提交任务结果审核",
          metadata: { progress: task.progress },
          source: "web",
        });
        setReceipt(message);
        onLog(message);
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
                  <input
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
                      setDraftProgress(aiAssessment.progress);
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
              <input
                type="range"
                min={0}
                max={100}
                value={draftProgress}
                onChange={(event) => {
                  setDraftProgress(Number(event.target.value));
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
              <textarea
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
                  <input
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
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">接收人</span>
              <select
                value={handoffTo}
                onChange={(event) => setHandoffTo(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              >
                <option>赵强</option>
                <option>陈静</option>
                <option>王磊</option>
                <option>刘华</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">移交原因和影响</span>
              <textarea
                rows={4}
                placeholder="说明为什么移交、当前进展、未解决风险和期望接收人下一步动作"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              提交后会生成一条移交审批记录，并同步给原主责、接收人和上级查看。
            </div>
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose}>取消</ActionButton>
              <ActionButton onClick={submitHandoff} variant="primary">
                <GitBranch className="h-3.5 w-3.5" />
                提交移交
              </ActionButton>
            </div>
          </div>
        )}

        {tab === "submit" && (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">提交前检查</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {["交付物已上传", "风险已说明", "测试记录已补齐", "关联人员已同步"].map((item) => (
                  <label key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                    <input type="checkbox" className="rounded border-slate-300 text-blue-600" />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-slate-900">提交说明</span>
              <textarea
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
              <ActionButton onClick={submitResult} variant="primary">
                <Send className="h-3.5 w-3.5" />
                提交审核
              </ActionButton>
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
          <textarea
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
}: {
  notification: WorkspaceNotification;
  relatedTask?: WorkspaceTask;
  onClose: () => void;
  onDismiss: () => void;
  onOpenTask: (task: WorkspaceTask, tab: OperationTab) => void;
}) {
  return (
    <DrawerShell
      title={notification.title}
      subtitle={`${notification.time} / 通知处理`}
      icon={Bell}
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm leading-6 text-slate-700">{notification.message}</p>
        </div>

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

        {notification.type === "message" && (
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

        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose}>稍后处理</ActionButton>
          <ActionButton onClick={onDismiss} variant="primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            标记已处理
          </ActionButton>
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

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildProgressAssessment(task: WorkspaceTask, evidence: UploadedEvidence[]): ProgressAssessment {
  const names = evidence.map((file) => file.name.toLowerCase()).join(" ");
  const hasReview = /评审|审核|review|submit|提交|final/.test(names);
  const hasTest = /测试|试验|实验|数据|记录|test|report|log/.test(names);
  const hasPlan = /方案|计划|说明|ecn|plan|spec|需求/.test(names);

  if (hasReview) {
    return {
      progress: Math.max(task.progress, 88),
      stage: "结果已形成，待审核关闭",
      confidence: evidence.length > 1 ? 92 : 88,
      basis: ["文件名包含评审/提交类线索", "可作为提交审核前的完成依据", "建议同步风险和交付物清单"],
      recommendation: "可采用 AI 进度，并进入“提交结果”流程完成审核。",
    };
  }

  if (hasTest) {
    return {
      progress: Math.max(task.progress, 68),
      stage: "验证数据已产出，处于测试收敛阶段",
      confidence: evidence.length > 1 ? 86 : 82,
      basis: ["文件名包含测试、实验、记录或数据线索", "说明任务已从方案阶段进入验证阶段", "仍需要补充结论或异常说明"],
      recommendation: "建议采用 AI 进度后补充进展说明，再视情况提交评审。",
    };
  }

  if (hasPlan) {
    return {
      progress: Math.max(task.progress, 52),
      stage: "方案资料已形成，待验证推进",
      confidence: evidence.length > 1 ? 82 : 78,
      basis: ["文件名包含方案、计划、ECN 或规格说明线索", "说明基础资料已经具备", "下一步应进入验证或跨部门确认"],
      recommendation: "建议将进度调整到方案完成节点，并说明下一步验证计划。",
    };
  }

  return {
    progress: Math.max(task.progress, 45),
    stage: "资料已上传，需人工补充判断",
    confidence: evidence.length > 1 ? 76 : 70,
    basis: ["文件已上传但名称未体现明确阶段", "AI 只能判断为已有阶段性输入", "需要人工补充进展说明降低误判"],
    recommendation: "建议先人工确认真实节点，再保存进度。",
  };
}

export function RDMyWorkspacePage() {
  const canProposeProject = usePermission(PERMISSIONS.RD_PROJECT_PROPOSE);
  const WORKSPACE_AUDIT_ACTOR = useAuditActor("研发成员");
  const [dailyReportLoading, setDailyReportLoading] = useState(false);
  const [latestDailyReport, setLatestDailyReport] = useState<RdDailyReport | null>(null);
  const [workspace, setWorkspace] = useState<RdWorkspacePayload<WorkspaceTask, AiSuggestion, WorkspaceNotification>>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closedSuggestions, setClosedSuggestions] = useState<Set<string>>(new Set());
  const [regeneratedSuggestions, setRegeneratedSuggestions] = useState<Set<string>>(new Set());
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set());
  const [todoChecked, setTodoChecked] = useState<Set<number>>(new Set());
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  const [operationLogs, setOperationLogs] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);
  const [showProposalDialog, setShowProposalDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      setLoadError(null);
      try {
        const payload = await fetchRdWorkspace();
        if (!cancelled) setWorkspace({ ...EMPTY_WORKSPACE, ...payload });
      } catch (error) {
        if (!cancelled) {
          setWorkspace(EMPTY_WORKSPACE);
          setLoadError(error instanceof Error ? error.message : "个人工作台接口加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<Priority | "all">("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | "all">("all");
  const [taskDueFilter, setTaskDueFilter] = useState<WorkspaceDueFilter>("all");
  const todayTodos = workspace.todayTodos;
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

  const averageProgress = useMemo(() => {
    if (allTasks.length === 0) return 0;
    return Math.round(allTasks.reduce((sum, task) => sum + task.progress, 0) / allTasks.length);
  }, [allTasks]);

  const findTask = (taskId?: string) => allTasks.find((task) => task.task_id === taskId);
  const openTask = (task: WorkspaceTask, tab: OperationTab) => setActivePanel({ kind: "task", task, tab });
  const addLog = (message: string) => setOperationLogs((prev) => [message, ...prev].slice(0, 5));

  const closeSuggestion = (id: string, message: string) => {
    setClosedSuggestions((prev) => new Set(prev).add(id));
    addLog(message);
    setActivePanel(null);
  };

  return (
    <div className="min-h-full  px-6 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">个人工作台</h1>
            <p className="mt-1 text-sm text-slate-500">只展示与我有关的任务、提醒和 AI 待确认项 / 今日 {TODAY_LABEL}</p>
            {loadError && (
              <p className="mt-2 inline-flex rounded-md border border-amber-100 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                {loadError}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canProposeProject && (
              <button
                type="button"
                onClick={() => setShowProposalDialog(true)}
                className="group inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(99,102,241,0.25)] transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-violet-700 hover:shadow-[0_12px_24px_rgba(99,102,241,0.32)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                title="AI 立项 · 上传文档或写描述，自动拆任务"
              >
                <Sparkles className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
                AI 立项
                <ChevronRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
            <ActionButton
              disabled={dailyReportLoading}
              onClick={() =>
                setConfirmDialog({
                  title: "确认生成日报",
                  message: "将根据今日的进度记录、任务状态自动汇总成研发日报，发送至研发主管驾驶舱。",
                  confirmLabel: "确认生成",
                  details: ["将基于今日的进度记录、任务变更生成", "研发主管驾驶舱可以看到", "下午 18:30 会自动生成，无需重复操作"],
                  onConfirm: async () => {
                    setDailyReportLoading(true);
                    try {
                      const report = await createRdDailyReport({});
                      setLatestDailyReport(report);
                      recordAudit({
                        actor: WORKSPACE_AUDIT_ACTOR,
                        action: "daily_report.generated",
                        resource: { type: "system", id: report.id, name: `${report.user_name} ${report.date} 日报` },
                        metadata: {
                          report_date: report.date,
                          tasks: report.summary.stats.total_tasks,
                          notes: report.summary.stats.notes_count,
                          trigger: report.trigger,
                        },
                        source: "web",
                      });
                      addLog(`日报已生成：${report.date}，已同步至研发主管驾驶舱`);
                      toast.success("日报已生成，研发主管驾驶舱可查看");
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "日报生成失败";
                      toast.error(msg);
                    } finally {
                      setDailyReportLoading(false);
                    }
                  },
                })
              }
            >
              {dailyReportLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              {dailyReportLoading ? "生成中…" : "生成日报"}
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={() =>
                setConfirmDialog({
                  title: "确认同步今日进展",
                  message: "将把今日进度、待办完成情况和操作记录同步到研发任务流。",
                  confirmLabel: "确认同步",
                  details: [`已完成待办：${todoChecked.size} / ${todayTodos.length}`, `待处理通知：${visibleNotifications.length}`, `待审核 AI 建议：${visibleSuggestions.length}`],
                  onConfirm: () => {
                    recordAudit({
                      actor: WORKSPACE_AUDIT_ACTOR,
                      action: "daily_progress.synced",
                      resource: { type: "system", id: "daily-progress", name: "今日研发进展" },
                      metadata: {
                        done_todos: todoChecked.size,
                        total_todos: todayTodos.length,
                        pending_notifications: visibleNotifications.length,
                        pending_ai_suggestions: visibleSuggestions.length,
                      },
                      source: "web",
                    });
                    addLog("今日进展已同步到研发任务流");
                  },
                })
              }
            >
              <CheckSquare className="h-3.5 w-3.5" />
              同步今日进展
            </ActionButton>
          </div>
        </header>

        {latestDailyReport && (
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-xs text-violet-700">
            <div className="flex items-center gap-2 font-semibold">
              <CalendarClock className="h-3.5 w-3.5" />
              {latestDailyReport.date} 日报已生成
              <span className="rounded-full bg-white px-1.5 text-[10px] text-violet-700 ring-1 ring-violet-200">
                任务 {latestDailyReport.summary.stats.total_tasks} · 进度记录 {latestDailyReport.summary.stats.notes_count}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-slate-600">
              {latestDailyReport.summary.text.split("\n").slice(2, 5).join(" ")}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <WorkspaceMetric label="主责任务" value={myTasks.length} helper="需要我推进闭环" icon={User} tone="text-blue-500" />
          <WorkspaceMetric label="协作任务" value={collabTasks.length} helper="我作为协作人参与" icon={Users} tone="text-slate-500" />
          <WorkspaceMetric label="平均完成率" value={`${averageProgress}%`} helper="按当前任务计算" icon={CheckCircle2} tone="text-emerald-500" />
          <WorkspaceMetric
            label="待处理事项"
            value={visibleNotifications.length + visibleSuggestions.length}
            helper="通知和 AI 建议"
            icon={Bell}
            tone="text-amber-500"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_140px_140px_130px_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-[8px] border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-50"
                placeholder="搜索任务、负责人、系统、下一步"
                value={taskKeyword}
                onChange={(event) => setTaskKeyword(event.target.value)}
              />
            </label>
            <select
              className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              value={taskPriorityFilter}
              onChange={(event) => setTaskPriorityFilter(event.target.value as Priority | "all")}
            >
              <option value="all">全部优先级</option>
              <option value="high">高优先级</option>
              <option value="medium">中优先级</option>
              <option value="low">低优先级</option>
            </select>
            <select
              className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              value={taskStatusFilter}
              onChange={(event) => setTaskStatusFilter(event.target.value as TaskStatus | "all")}
            >
              <option value="all">全部状态</option>
              <option value="in_progress">进行中</option>
              <option value="pending_review">待评审</option>
              <option value="paused_blocked">阻塞</option>
              <option value="paused_leave">请假暂停</option>
              <option value="completed">已完成</option>
            </select>
            <select
              className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              value={taskDueFilter}
              onChange={(event) => setTaskDueFilter(event.target.value as WorkspaceDueFilter)}
            >
              <option value="all">全部时间</option>
              <option value="overdue">已逾期</option>
              <option value="today">今天到期</option>
              <option value="3d">3 天内</option>
              <option value="7d">7 天内</option>
              <option value="no_due">无截止日</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setTaskKeyword("");
                setTaskPriorityFilter("all");
                setTaskStatusFilter("all");
                setTaskDueFilter("all");
              }}
              disabled={!taskFiltersActive}
              className="h-9 cursor-pointer rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              清空
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            当前显示 <span className="font-semibold text-slate-800">{filteredMyTasks.length + filteredCollabTasks.length}</span> / {allTasks.length} 个任务
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
            <SectionCard title="我的任务" icon={User} count={filteredMyTasks.length} helper="按优先级和到期时间处理">
              <div className="space-y-3">
                {loading ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">正在加载我的任务…</p>
                ) : filteredMyTasks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                    暂无分配给我的研发任务
                  </p>
                ) : (
                  filteredMyTasks.map((task) => (
                    <TaskCardUI key={task.task_id} task={task} onOpen={openTask} />
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="协作任务" icon={Users} count={filteredCollabTasks.length} helper="需要我提供输入或反馈">
              <div className="space-y-3">
                {loading ? (
                  <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">正在加载协作任务…</p>
                ) : filteredCollabTasks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                    暂无需要我协作的任务
                  </p>
                ) : (
                  filteredCollabTasks.map((task) => (
                    <TaskCardUI key={task.task_id} task={task} onOpen={openTask} />
                  ))
                )}
              </div>
            </SectionCard>

            {visibleSuggestions.length > 0 && (
              <SectionCard title="待审核 AI 建议" icon={Sparkles} count={visibleSuggestions.length} helper="确认后才写入任务池">
                <div className="grid gap-3 lg:grid-cols-2">
                  {visibleSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-blue-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-900">{suggestion.title}</h3>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{suggestion.preview}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-violet-700">
                          {regeneratedSuggestions.has(suggestion.id) ? suggestion.confidence + 6 : suggestion.confidence}%
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <ActionButton
                          onClick={() => setActivePanel({ kind: "ai", suggestion, regenerated: regeneratedSuggestions.has(suggestion.id) })}
                          variant="primary"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
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
                          <RefreshCw className="h-3.5 w-3.5" />
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
                                closeSuggestion(suggestion.id, `${suggestion.title} 已忽略`);
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
          </main>

          <aside className="space-y-5">
            <SectionCard title="今日待办" icon={CheckSquare} count={`${todayTodos.length - todoChecked.size}/${todayTodos.length}`}>
              {todayTodos.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                  暂无今日待办
                </p>
              ) : (
              <ul className="space-y-2">
                {todayTodos.map((todo, index) => {
                  const checked = todoChecked.has(index);
                  const task = findTask(todo.task_id);
                  return (
                    <li key={todo.text}>
                      <button
                        type="button"
                        onClick={() =>
                          setTodoChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-slate-50",
                          checked ? "text-slate-300 line-through" : "text-slate-700",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            checked ? "border-emerald-300 bg-emerald-400 text-white" : "border-slate-300 text-transparent",
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="min-w-0 flex-1">{todo.text}</span>
                        {task && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              )}
            </SectionCard>

            <SectionCard title="通知中心" icon={Bell} count={visibleNotifications.length}>
              {visibleNotifications.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">暂无新通知</p>
              ) : (
                <ul className="space-y-2">
                  {visibleNotifications.map((notification) => {
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
                          onClick={() => setActivePanel({ kind: "notification", notification })}
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
                            <span className="block text-xs font-semibold text-slate-800">{notification.title}</span>
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
              )}
            </SectionCard>

            <SectionCard title="操作记录" icon={MessageSquare} count={operationLogs.length}>
              {operationLogs.length === 0 ? (
                <div className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-400">今天还没有提交类操作。</div>
              ) : (
                <ul className="space-y-2">
                  {operationLogs.map((log, index) => (
                    <li key={`${log}-${index}`} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                      {log}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </aside>
        </div>
      </div>

      {activePanel?.kind === "task" && (
        <TaskOperationDrawer
          key={`${activePanel.task.task_id}-${activePanel.tab}`}
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
            setActivePanel((current) =>
              current?.kind === "task" && current.task.task_id === taskId
                ? { ...current, task: { ...current.task, progress } }
                : current,
            );
          }}
          onLog={addLog}
          onRequestConfirm={setConfirmDialog}
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
                closeSuggestion(activePanel.suggestion.id, `${activePanel.suggestion.title} 已确认写入任务池`);
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
                closeSuggestion(activePanel.suggestion.id, `${activePanel.suggestion.title} 已忽略`);
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
                setDismissedNotifs((prev) => new Set(prev).add(activePanel.notification.id));
                addLog(`${activePanel.notification.title} 已标记处理`);
                setActivePanel(null);
              },
            })
          }
          onOpenTask={(task, tab) => setActivePanel({ kind: "task", task, tab })}
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
      />
    </div>
  );
}
