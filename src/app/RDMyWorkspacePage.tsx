import React, { useMemo, useState } from "react";
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
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "./components/ui/utils";

type Priority = "high" | "medium" | "low";
type TaskStatus = "in_progress" | "paused_leave" | "blocked" | "pending_review";
type TaskRole = "primary" | "collaborator";
type OperationTab = "detail" | "progress" | "handoff" | "submit";

type WorkspaceTask = {
  task_id: string;
  title: string;
  priority: Priority;
  progress: number;
  due_date: string;
  status: TaskStatus;
  status_label: string;
  role: TaskRole;
  category_path: string;
  owner: string;
  collab_role?: string;
  on_leave?: boolean;
  ai_pending?: boolean;
  description: string;
  next_action: string;
  deliverables: string[];
  blockers: string[];
  timeline: { label: string; time: string; state: "done" | "current" | "todo" }[];
};

type AiSuggestion = {
  id: string;
  type: "task_create" | "summary";
  title: string;
  preview: string;
  confidence: number;
  source: string;
  generated_tasks: {
    title: string;
    owner: string;
    due: string;
    priority: Priority;
  }[];
};

type WorkspaceNotification = {
  id: string;
  type: "blocked" | "due_soon" | "pending_ai" | "transfer";
  title: string;
  message: string;
  time: string;
  related_task_id?: string;
};

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

const TODAY_LABEL = "2026-05-14";

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
    status: "blocked",
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

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
  high: { label: "高", className: "border-red-100 bg-red-50 text-red-600" },
  medium: { label: "中", className: "border-amber-100 bg-amber-50 text-amber-700" },
  low: { label: "低", className: "border-slate-100 bg-slate-50 text-slate-500" },
};

const STATUS_CONFIG: Record<TaskStatus, { className: string; dot: string }> = {
  in_progress: { className: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  paused_leave: { className: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  blocked: { className: "bg-red-50 text-red-700", dot: "bg-red-500" },
  pending_review: { className: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
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
      onClick={onCancel}
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
        onClick={(event) => event.stopPropagation()}
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
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 backdrop-blur-[1px]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
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
  onProgressSave: (taskId: string, progress: number) => void;
  onLog: (message: string) => void;
  onRequestConfirm: (config: ConfirmDialogConfig) => void;
}) {
  const [tab, setTab] = useState<OperationTab>(initialTab);
  const [draftProgress, setDraftProgress] = useState(task.progress);
  const [note, setNote] = useState("");
  const [uploadedEvidence, setUploadedEvidence] = useState<UploadedEvidence[]>([]);
  const [aiAssessment, setAiAssessment] = useState<ProgressAssessment | null>(null);
  const [handoffTo, setHandoffTo] = useState("赵强");
  const [receipt, setReceipt] = useState<string | null>(null);

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

  const submitProgress = () => {
    const source = aiAssessment && aiAssessment.progress === draftProgress ? "AI 判断" : "人工设置";
    const evidenceText = uploadedEvidence.length > 0 ? `，依据 ${uploadedEvidence.length} 个上传文件` : "";
    const message = `${task.task_id} 已通过${source}更新到 ${draftProgress}%${evidenceText}`;
    onRequestConfirm({
      title: "确认保存进度",
      message: `将把 ${task.task_id} 的进度更新为 ${draftProgress}%。`,
      confirmLabel: "确认保存",
      details: [
        `进度来源：${source}`,
        uploadedEvidence.length > 0 ? `上传依据：${uploadedEvidence.length} 个文件` : "上传依据：无，按人工判断保存",
        note ? "已填写进展说明" : "未填写进展说明",
      ],
      onConfirm: () => {
        onProgressSave(task.task_id, draftProgress);
        setReceipt(message);
        onLog(message);
      },
    });
  };

  const handleEvidenceUpload = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "unknown",
    }));
    if (nextFiles.length === 0) return;

    const merged = [...nextFiles, ...uploadedEvidence].slice(0, 5);
    const assessment = buildProgressAssessment(task, merged);
    setUploadedEvidence(merged);
    setAiAssessment(assessment);
    setReceipt(null);
    setNote((current) => current || `AI 识别：${assessment.stage}。${assessment.recommendation}`);
  };

  const submitHandoff = () => {
    const message = `${task.task_id} 已提交移交给 ${handoffTo}`;
    onRequestConfirm({
      title: "确认提交移交",
      message: `将把 ${task.task_id} 的移交流程提交给 ${handoffTo}。`,
      confirmLabel: "确认移交",
      details: ["提交后会生成移交记录", "接收人和相关负责人会看到该流程", "当前页面会保留操作日志"],
      onConfirm: () => {
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
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.18)] transition-colors hover:bg-blue-700">
                  <UploadCloud className="h-3.5 w-3.5" />
                  上传文件
                  <input
                    type="file"
                    multiple
                    className="sr-only"
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
              <span className="text-sm font-semibold text-slate-900">进展说明</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                placeholder="说明本次进度变化、上传文件依据、产出内容、仍需支持的事项"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <ActionButton onClick={onClose}>取消</ActionButton>
              <ActionButton onClick={submitProgress} variant="primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                保存进度
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
  const [closedSuggestions, setClosedSuggestions] = useState<Set<string>>(new Set());
  const [regeneratedSuggestions, setRegeneratedSuggestions] = useState<Set<string>>(new Set());
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set());
  const [todoChecked, setTodoChecked] = useState<Set<number>>(new Set());
  const [progressOverrides, setProgressOverrides] = useState<Record<string, number>>({});
  const [operationLogs, setOperationLogs] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null);

  const myTasks = useMemo(() => applyProgressOverrides(MY_TASKS, progressOverrides), [progressOverrides]);
  const collabTasks = useMemo(() => applyProgressOverrides(COLLAB_TASKS, progressOverrides), [progressOverrides]);
  const allTasks = useMemo(() => [...myTasks, ...collabTasks], [myTasks, collabTasks]);
  const visibleSuggestions = useMemo(
    () => AI_SUGGESTIONS.filter((suggestion) => !closedSuggestions.has(suggestion.id)),
    [closedSuggestions],
  );
  const visibleNotifications = useMemo(
    () => NOTIFICATIONS.filter((notification) => !dismissedNotifs.has(notification.id)),
    [dismissedNotifs],
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
    <div className="min-h-full bg-[#f7f9fc] px-6 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">个人工作台</h1>
            <p className="mt-1 text-sm text-slate-500">只展示与我有关的任务、提醒和 AI 待确认项 / 今日 {TODAY_LABEL}</p>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton
              onClick={() =>
                setConfirmDialog({
                  title: "确认生成日报",
                  message: "将根据当前任务、待办和操作记录生成今日研发日报。",
                  confirmLabel: "确认生成",
                  details: ["会读取当前页面的任务状态", "生成结果会进入操作记录", "不会自动提交给上级"],
                  onConfirm: () => addLog("今日研发日报已生成"),
                })
              }
            >
              <CalendarClock className="h-3.5 w-3.5" />
              生成日报
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={() =>
                setConfirmDialog({
                  title: "确认同步今日进展",
                  message: "将把今日进度、待办完成情况和操作记录同步到研发任务流。",
                  confirmLabel: "确认同步",
                  details: [`已完成待办：${todoChecked.size} / ${TODAY_TODOS.length}`, `待处理通知：${visibleNotifications.length}`, `待审核 AI 建议：${visibleSuggestions.length}`],
                  onConfirm: () => addLog("今日进展已同步到研发任务流"),
                })
              }
            >
              <CheckSquare className="h-3.5 w-3.5" />
              同步今日进展
            </ActionButton>
          </div>
        </header>

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

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
            <SectionCard title="我的任务" icon={User} count={myTasks.length} helper="按优先级和到期时间处理">
              <div className="space-y-3">
                {myTasks.map((task) => (
                  <TaskCardUI key={task.task_id} task={task} onOpen={openTask} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="协作任务" icon={Users} count={collabTasks.length} helper="需要我提供输入或反馈">
              <div className="space-y-3">
                {collabTasks.map((task) => (
                  <TaskCardUI key={task.task_id} task={task} onOpen={openTask} />
                ))}
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
                              onConfirm: () => closeSuggestion(suggestion.id, `${suggestion.title} 已忽略`),
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
            <SectionCard title="今日待办" icon={CheckSquare} count={`${TODAY_TODOS.length - todoChecked.size}/${TODAY_TODOS.length}`}>
              <ul className="space-y-2">
                {TODAY_TODOS.map((todo, index) => {
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
            </SectionCard>

            <SectionCard title="通知中心" icon={Bell} count={visibleNotifications.length}>
              {visibleNotifications.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">暂无新通知</p>
              ) : (
                <ul className="space-y-2">
                  {visibleNotifications.map((notification) => (
                    <li key={notification.id}>
                      <div
                        className={cn(
                          "group flex w-full cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
                          notification.type === "blocked" || notification.type === "due_soon"
                            ? "border-amber-100 bg-amber-50"
                            : "border-slate-100 bg-slate-50",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setActivePanel({ kind: "notification", notification })}
                          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left focus-visible:outline-none"
                        >
                          <AlertTriangle
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0",
                              notification.type === "blocked" ? "text-red-500" : "text-amber-500",
                            )}
                          />
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
                              onConfirm: () => setDismissedNotifs((prev) => new Set(prev).add(notification.id)),
                            })
                          }
                          className="rounded p-1 text-slate-300 transition-colors hover:bg-white hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                          aria-label="关闭通知"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
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
          onProgressSave={(taskId, progress) =>
            setProgressOverrides((prev) => ({
              ...prev,
              [taskId]: progress,
            }))
          }
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
            setActivePanel({ kind: "ai", suggestion: activePanel.suggestion, regenerated: true });
          }}
          onConfirm={() =>
            setConfirmDialog({
              title: "确认写入任务池",
              message: `将把「${activePanel.suggestion.title}」生成的内容写入任务池。`,
              confirmLabel: "确认写入",
              details: [`生成任务数：${activePanel.suggestion.generated_tasks.length}`, `来源：${activePanel.suggestion.source}`, "写入后会从待审核列表移除"],
              onConfirm: () => closeSuggestion(activePanel.suggestion.id, `${activePanel.suggestion.title} 已确认写入任务池`),
            })
          }
          onDismiss={() =>
            setConfirmDialog({
              title: "确认忽略 AI 建议",
              message: `将忽略「${activePanel.suggestion.title}」，该建议不会写入任务池。`,
              confirmLabel: "确认忽略",
              tone: "danger",
              details: ["忽略后会从待审核列表移除", "如需恢复，需要重新生成建议"],
              onConfirm: () => closeSuggestion(activePanel.suggestion.id, `${activePanel.suggestion.title} 已忽略`),
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
    </div>
  );
}
