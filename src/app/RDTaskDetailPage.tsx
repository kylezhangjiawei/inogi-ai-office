import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  GitBranch,
  Layers3,
  Lock,
  Loader2,
  MessageCircleMore,
  Pencil,
  Send,
  ShoppingCart,
  Sparkles,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./components/ui/utils";
import { Button } from "./components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Progress } from "./components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { useAnyPermission, usePermission } from "./hooks/usePermission";
import { useAuth } from "./auth";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { openMateChat } from "./components/matechat/openMateChat";
import { createRdTaskPageContext } from "./components/matechat/pageContext";
import { PERMISSIONS } from "./lib/permissions";
import { procurementWorkspaceReturnPath } from "./lib/procurementWorkspaceNavigation";
import { t, useI18n } from "./lib/i18n";
import { AutoTranslatedText } from "./components/TranslatableText";
import { AuditTimeline } from "./RDAuditTimeline";
import {
  addAuditLogNote,
  auditActorMatchesIdentity,
  canReadAllAuditLogs,
  filterAuditLogsByActor,
  filterAuditLogsForViewer,
  useAuditActor,
  type AuditActorIdentity,
  type AuditLog,
  useAuditLogs,
} from "./lib/auditLog";
import { inferAttachmentMime } from "./components/AttachmentPreviewDialog";
import { AttachmentPreviewModal, ProgressAttachmentGrid, TaskImageGallery, TaskImageGalleryScope, formatRdFileSize, formatTraceDateTime } from "./RDProgressEvidence";
import { RDTaskConversation } from "./RDTaskConversation";
import { getProductionStockPlanSource } from './lib/procurementOperationsApi';
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  WorkItemsSection,
  HandoverDialog,
  AddCollaboratorsDialog,
  CompleteConfirmDialog,
  ApprovalActionDialog,
  MoveTaskDialog,
  SubmitConfirmDialog,
  TaskCompletionScoreCard,
  blobToDataUrl,
  buildSubtaskParentIndex,
  collectTopLevelTasks,
  displayPersonName,
  flattenTasks,
  OwnerAvatar,
  SubtaskBadge,
  type PersonProfile,
} from "./RDTaskManagementPage";
import { ProcurementActivitySection, ProcurementLinkChip, TransferToProcurementModal, useProcurementTaskLink } from "./procurement/components/rdInsertion";
import { TechnicalDocumentsPanel } from "./rd/TechnicalDocumentsPanel";
import "./rd/rdTaskDetail.css";
import { createHttpIssueService } from "./lib/issue/issueHttpService";
import { getReviewTypeMeta } from "./lib/reviewTypes";
import { isTaskOverdue } from "./lib/taskDue";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import {
  attachRdTasksToParent,
  blockedDaysOf,
  createRdTask,
  currentRdWorkspace,
  detachRdSubtask,
  detachRdSubtasks,
  fetchMergedTaskCategories,
  fetchRdPeople,
  fetchRdProducts,
  fetchRdTaskCategories,
  fetchRdTaskProgressNoteGroup,
  fetchRdProductionTaskSyncs,
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrl,
  getAttachmentUrl,
  markRdTaskNotesRead,
  moveRdTasks,
  RD_TASK_TYPE_PRESETS,
  taskTypeOf,
  withTaskType,
  revokeRdTaskProductionSync,
  syncRdTaskToProduction,
  updateRdTask,
  isProductionMirrorTask,
  isProductionWorkspace,
  type RdCategory,
  type RdCollaborator,
  type RdPriority,
  type RdProductDef,
  type RdTask,
  type RdTaskProgressAttachment,
  type RdTaskProgressNote,
  type RdTaskProgressGroupTask,
  type RdProductionTaskSync,
} from "./lib/rdApi";

function DetailGridOrder({
  productionWorkspace,
  children,
}: {
  productionWorkspace: boolean;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  return <>{productionWorkspace ? items : [...items].reverse()}</>;
}

type DetailTab = "notes" | "conversation" | "attachments" | "audit" | "relations" | "procurement";
/** 模块级常量：保证 useAuditLogs 的订阅条件恒定，避免任何重订阅/重拉取。 */
const TASK_AUDIT_FILTER = { resourceType: "task" } as const;
/** 研发与生产任务详情共用同一 Horizon 视觉作用域；工作区差异仅保留在业务逻辑中。 */
const RD_TASK_DETAIL_HORIZON_SCOPE = "rd-horizon-module rd-horizon-task-detail";

/** 管理员点选人员时允许新旧数据在一侧缺少 user id 的情况下按姓名兜底；两侧都有 id 时仍只认 id。 */
function detailActivityActorMatches(
  actor: { id?: string | null; name?: string | null } | null | undefined,
  identity: AuditActorIdentity | null | undefined,
): boolean {
  return auditActorMatchesIdentity(actor, identity) || auditActorMatchesIdentity(identity, actor);
}

function countRelationNodes(task: RdTask): number {
  return 1 + (task.subtasks ?? []).reduce((total, child) => total + countRelationNodes(child), 0);
}

function relationContainsTask(task: RdTask, targetTaskId: string): boolean {
  if (task.task_id === targetTaskId) return true;
  return (task.subtasks ?? []).some((child) => relationContainsTask(child, targetTaskId));
}

type TaskRelationNodeProps = {
  task: RdTask;
  currentTaskId: string;
  isRoot?: boolean;
  onOpen: (task: RdTask) => void;
};

function TaskRelationNode({ task, currentTaskId, isRoot = false, onOpen }: TaskRelationNodeProps) {
  const status = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.in_progress;
  const children = task.subtasks ?? [];
  const current = task.task_id === currentTaskId;

  return (
    <li>
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={() => onOpen(task)}
        data-active={current}
        className={cn(
          "rd-horizon-detail-relation-node flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
          current
            ? "border-[#002fa7]/20 bg-[#eef3ff] text-[#1b2559]"
            : "border-slate-200 bg-white text-slate-700 hover:border-[#002fa7]/20 hover:bg-slate-50",
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
        {isRoot ? (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {t("主任务")}
          </span>
        ) : (
          <SubtaskBadge task={task} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium"><AutoTranslatedText text={task.title} /></span>
            {current ? (
              <span className="shrink-0 rounded bg-[#dce6ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#002fa7]">
                {t("当前")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-slate-400">
            <span className="shrink-0 font-mono">{task.task_id}</span>
            <span className="truncate">{displayPersonName(task.primary_owner)}</span>
            {children.length > 0 ? (
              <span className="shrink-0 tabular-nums">{t("{n} 个下级", { n: children.length })}</span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">{task.progress}%</span>
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      </button>
      {children.length > 0 ? (
        <ul className="ml-5 mt-1.5 space-y-1.5 border-l border-slate-200 pl-3">
          {children.map((child) => (
            <TaskRelationNode
              key={child.task_id}
              task={child}
              currentTaskId={currentTaskId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TaskRelationTree({
  root,
  currentTaskId,
  onOpen,
}: {
  root: RdTask;
  currentTaskId: string;
  onOpen: (task: RdTask) => void;
}) {
  return (
    <ul className="space-y-1.5">
      <TaskRelationNode task={root} currentTaskId={currentTaskId} isRoot onOpen={onOpen} />
    </ul>
  );
}

function ActivityTaskFilterBar({
  value,
  currentTaskId,
  tasks,
  countByTask,
  totalCount,
  onChange,
  summary,
}: {
  value: string;
  currentTaskId: string;
  tasks: RdTaskProgressGroupTask[];
  countByTask: ReadonlyMap<string, number>;
  totalCount: number;
  onChange: (taskId: string) => void;
  summary?: React.ReactNode;
}) {
  const taskButtonClass = (selected: boolean) => cn(
    "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
    selected
      ? "bg-[#002fa7] text-white shadow-sm"
      : "border border-slate-200 bg-white text-slate-600 hover:border-[#002fa7]/20 hover:text-[#002fa7]",
  );
  const relatedTasks = tasks.filter((item) => item.task_id !== currentTaskId);

  return (
    <div className="rd-horizon-detail-filter flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-slate-50/70 px-3 py-2 sm:px-4">
      <div className="cockpit-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain pb-1.5 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400">
        {tasks.length > 1 ? (
          <div role="group" aria-label={t("任务范围")} className="flex shrink-0 items-center gap-2">
            <button type="button" aria-pressed={value === "all"} onClick={() => onChange("all")} className={taskButtonClass(value === "all")}>
              {t("全部任务")} <span className="tabular-nums">{totalCount}</span>
            </button>
            <button type="button" aria-pressed={value === currentTaskId} onClick={() => onChange(currentTaskId)} className={taskButtonClass(value === currentTaskId)}>
              {t("当前任务")} <span className="tabular-nums">{countByTask.get(currentTaskId) ?? 0}</span>
            </button>
            {relatedTasks.map((item) => (
              <button
                key={item.task_id}
                type="button"
                aria-pressed={value === item.task_id}
                onClick={() => onChange(item.task_id)}
                title={item.path.join(" / ")}
                className={taskButtonClass(value === item.task_id)}
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="max-w-48 truncate"><AutoTranslatedText text={item.title} /></span>
                <span className="tabular-nums">{countByTask.get(item.task_id) ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {summary ? <span className="hidden shrink-0 text-[11px] text-slate-500 sm:inline">{summary}</span> : null}
    </div>
  );
}

/**
 * 研发任务 · 全屏详情页（双栏布局，与协同任务详情同款范式）：
 * 左栏为任务档案（字段表 / 人员 / 快捷操作），右主栏为纵向过程叙事
 * （描述 → 工作项 → 留痕/附件库/操作记录 Tab）。
 * 由 UsCollabTaskDetailPage 复刻并按研发功能裁剪：去掉协同专属的跨时区
 * LocalClock / AI 小结 / 导出过程报告，补充研发侧的分类路径字段。
 * 独立文件 + 独立路由（/rd-task/:taskId，无 /us-collab 前缀 → rdApi 自动落研发池），
 * 与协同详情页互不干扰。
 */
/** 任务类型下拉里「自定义…」那一项的哨兵值。带下划线前缀，不会与真实类型撞名。 */
const CUSTOM_TASK_TYPE_OPTION = "__custom_task_type__";

export default function RDTaskDetailPage() {
  const { taskId = "" } = useParams();
  // 路由参数切换不会卸载详情组件；异步操作必须同时核对“当前 URL 的任务”，
  // 仅靠请求序号无法阻止旧任务操作在新页面发起一次更晚的刷新。
  const activeTaskIdRef = useRef(taskId);
  activeTaskIdRef.current = taskId;
  const navigate = useNavigate();
  const location = useLocation();
  const activityActor = useMemo<AuditActorIdentity | null>(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("activity_user_id")?.trim() ?? "";
    const name = params.get("activity_user_name")?.trim() ?? "";
    return id || name ? { id: id || null, name: name || null } : null;
  }, [location.search]);
  const productionWorkspace = isProductionWorkspace();
  const researchWorkspace = currentRdWorkspace() === null;
  const canOpenRdCockpit = usePermission(PERMISSIONS.PAGE_RD_TASK_MANAGEMENT);
  const cockpitPath = productionWorkspace
    ? "/production-dashboard"
    : canOpenRdCockpit ? routePath("page:rd-task-management", "/rd-task-management") : routePath("page:rd-my-workspace", "/rd-my-workspace");
  const cockpitReturnPath = `${cockpitPath}${location.search}`;
  const procurementReturnPath = researchWorkspace ? procurementWorkspaceReturnPath(location.state) : null;
  const detailReturnPath = procurementReturnPath ?? cockpitReturnPath;
  const procurementReturnState = useMemo(() => procurementReturnPath
    ? { procurementWorkspaceReturn: procurementReturnPath } : undefined, [procurementReturnPath]);
  const taskDetailPath = useCallback(
    (id: string) => `${productionWorkspace ? "/production-task" : "/rd-task"}/${encodeURIComponent(id)}${location.search}`,
    [location.search, productionWorkspace],
  );
  const shouldReduceMotion = useReducedMotion();
  const { lang } = useI18n(); // i18n：订阅语言切换（本页文案已 t() 化）
  void lang;
  const { user } = useAuth();
  const [selectedActivityActor, setSelectedActivityActor] = useState<AuditActorIdentity | null>(null);
  const canSelectActivityActor = !activityActor && canReadAllAuditLogs(user?.permissions);
  const visibleActivityActor = useMemo<AuditActorIdentity | null>(() => {
    if (activityActor) return activityActor;
    return canSelectActivityActor ? selectedActivityActor : null;
  }, [activityActor, canSelectActivityActor, selectedActivityActor]);
  const activityActorIsSelected = useCallback(
    (actor: AuditActorIdentity) => detailActivityActorMatches(actor, selectedActivityActor),
    [selectedActivityActor],
  );
  const toggleActivityActor = useCallback((actor: AuditActorIdentity) => {
    if (!canSelectActivityActor) return;
    setSelectedActivityActor((current) => detailActivityActorMatches(actor, current) ? null : actor);
    setTab((current) => current === "audit" ? "audit" : "notes");
  }, [canSelectActivityActor]);
  const canViewRd = useAnyPermission(PERMISSIONS.PAGE_RD_TASK_MANAGEMENT, PERMISSIONS.PAGE_RD_MY_WORKSPACE);
  const canViewProduction = usePermission(PERMISSIONS.PAGE_RD_DIRECTOR_DASHBOARD);
  const canReadAllRdTasks = usePermission('rd-task:view-all');
  const canView = productionWorkspace ? canViewProduction : canViewRd;
  // 管理动作口径与驾驶舱抽屉的 canManageTaskFlow 一致
  const canManagePermission = useAnyPermission(
    PERMISSIONS.RD_PROJECT_DIRECT,
    PERMISSIONS.RD_PROJECT_REVIEW_L1,
    PERMISSIONS.RD_PROJECT_REVIEW_L2,
    PERMISSIONS.RD_PEOPLE_MANAGE,
    PERMISSIONS.RD_TASK_REASSIGN,
  );
  const canSyncProduction = usePermission(PERMISSIONS.RD_TASK_SYNC_PRODUCTION);
  const AUDIT_ACTOR = useAuditActor(productionWorkspace ? "生产管理员" : "研发管理员");

  const [task, setTask] = useState<RdTask | null>(null);
  const taskReadOnly = isProductionMirrorTask(task);
  const canManage = canManagePermission && !taskReadOnly;
  const [productionSync, setProductionSync] = useState<RdProductionTaskSync | null>(null);
  const [productionSyncing, setProductionSyncing] = useState(false);
  const [allTasks, setAllTasks] = useState<RdTask[]>([]);
  // 子任务上下文：父子关系按「结构位置」建索引（存量子任务无 parent_task_id 字段，只认字段会漏判）
  const [subtaskParents, setSubtaskParents] = useState<Map<string, RdTask>>(() => new Map());
  const [topLevelTasks, setTopLevelTasks] = useState<RdTask[]>([]);
  const [showCreateSubtask, setShowCreateSubtask] = useState(false);
  const [showAttachSubtasks, setShowAttachSubtasks] = useState(false);
  const [showDetachSubtasks, setShowDetachSubtasks] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState<RdTaskProgressNote[]>([]);
  const [groupNotes, setGroupNotes] = useState<RdTaskProgressNote[]>([]);
  const [progressGroupTasks, setProgressGroupTasks] = useState<RdTaskProgressGroupTask[]>([]);
  const [noteTaskFilter, setNoteTaskFilter] = useState("all");
  const [auditTaskFilter, setAuditTaskFilter] = useState("all");
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState("");
  const [tab, setTab] = useState<DetailTab>(() => researchWorkspace && !activityActor ? "attachments" : "notes");
  const [discussionUnread, setDiscussionUnread] = useState(0);
  const [progressThreadOpen, setProgressThreadOpen] = useState(false);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [showHandover, setShowHandover] = useState(false);
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  // ── 研发侧特有动作（与驾驶舱抽屉同口径）：提交审核 / 转采购 / 生成问题 / 移动类目 ──
  const issueService = useMemo(() => createHttpIssueService(), []);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [generatingIssue, setGeneratingIssue] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  // 转采购操作码（系统管理·权限目录可配），已转的跳转芯片保持只读可见
  const canTransferProcPermission = useAnyPermission("proc-task:transfer");
  const canCreateStockPlan = usePermission('proc-task:create');
  const canOpenProcurement = usePermission('page:proc-cockpit');
  const [stockPlanLinkLoading, setStockPlanLinkLoading] = useState(false);
  const stockPlanLinkRequestRef = useRef(0);
  const canTransferProc = canTransferProcPermission && !taskReadOnly;
  const [showMove, setShowMove] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);
  const moveRequestSeqRef = useRef(0);
  const issueRequestSeqRef = useRef(0);
  const [categories, setCategories] = useState<RdCategory[]>([]);
  const [products, setProducts] = useState<RdProductDef[]>([]);
  // 完成质量评分区收起/展开（默认展开但限高内滚，避免长点评把 Tab 区挤出视口）
  const [scoreOpen, setScoreOpen] = useState(true);
  const [showApproval, setShowApproval] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingTaskType, setSavingTaskType] = useState(false);
  // 非 null 表示正在填自定义任务类型（预设清单外的值）
  const [customTaskType, setCustomTaskType] = useState<string | null>(null);
  /** 点击人员后展示其名下任务的弹层（点任务跳转到该任务的详情页） */
  const [personTasksFor, setPersonTasksFor] = useState<string | null>(null);
  /**
   * 审计日志按「任务」整类订阅，范围过滤在下方 useMemo 里做。
   * ⚠️ 不要把范围条件塞进 useAuditLogs 的 filter：它的 effect 依赖 filter 的字符串化值，
   * 条件一变就重跑 fetchRdAuditLogs()（全量拉取），点一次范围切换就多一次网络往返。
   * 日志本来就是全量取回再客户端过滤的，这里保持过滤条件恒定 → 每个任务只拉一次。
   */
  const allTaskAuditLogs = useAuditLogs(TASK_AUDIT_FILTER);
  const { task: procTask, setTask: setProcTask } = useProcurementTaskLink(taskId);
  // 只有仍在流程里的采购任务才顶掉「转采购」入口。已取消的（含审核驳回后落 cancelled 的
  // 存量数据）后端允许在原记录上重新提交，前端必须把入口放回来，否则研发侧永久卡死。
  const procTaskBlocksTransfer = Boolean(procTask) && procTask?.status !== "cancelled";
  const openProductionStockPlan = async () => {
    if (!productionWorkspace || !task || !canCreateStockPlan || !canOpenProcurement || stockPlanLinkLoading) return;
    const expectedTaskId = task.task_id;
    const requestId = ++stockPlanLinkRequestRef.current;
    setStockPlanLinkLoading(true);
    try {
      const source = await getProductionStockPlanSource(expectedTaskId);
      if (activeTaskIdRef.current !== expectedTaskId || stockPlanLinkRequestRef.current !== requestId) return;
      navigate(`/proc-cockpit?${new URLSearchParams({ tab: 'stock-plans', newPlan: '1', planType: 'machine', productionTaskId: source.taskId, product: source.productId, materialName: source.title })}`);
    } catch (error) {
      if (activeTaskIdRef.current === expectedTaskId && stockPlanLinkRequestRef.current === requestId) toast.error(error instanceof Error ? error.message : t('无法读取生产任务归属'));
    } finally {
      if (stockPlanLinkRequestRef.current === requestId) setStockPlanLinkLoading(false);
    }
  };

  // 采购动态是按任务按需出现的页签；切换到没有采购关联的任务时回退到合并关系，
  // 避免 Tabs 保留一个已不存在的受控 value 而显示空白。
  useEffect(() => {
    if (tab === "procurement" && !procTask) setTab("relations");
  }, [procTask, tab]);

  // 视口内布局的可用高度：实测容器到视口顶的距离（覆盖全局顶栏/面包屑/内边距的任意组合），
  // 不猜固定偏移。仅双栏大屏启用；更窄的单栏布局走自然文档流。
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      if (!rootRef.current || window.innerWidth < 1280) {
        setViewportHeight(null);
        return;
      }
      const top = rootRef.current.getBoundingClientRect().top + window.scrollY;
      setViewportHeight(Math.max(480, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading]);

  // 竞态守卫：人员弹层跳转会快速切换 taskId，旧请求晚到不得覆盖新任务的状态
  const loadSeqRef = React.useRef(0);
  const loadTask = useCallback(async (opts?: { silent?: boolean; expectedTaskId?: string }) => {
    const expectedTaskId = opts?.expectedTaskId ?? taskId;
    if (!expectedTaskId || activeTaskIdRef.current !== expectedTaskId) return;
    const seq = ++loadSeqRef.current;
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    try {
      const categories = await fetchMergedTaskCategories();
      if (seq !== loadSeqRef.current || activeTaskIdRef.current !== expectedTaskId) return;
      const all = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks)));
      setAllTasks(all);
      setSubtaskParents(buildSubtaskParentIndex(categories));
      setTopLevelTasks(collectTopLevelTasks(categories));
      const found = all.find((t) => t.task_id === expectedTaskId) ?? null;
      if (!found) setLoadError("任务不存在或已被删除");
      setTask(found);
    } catch (error) {
      if (seq !== loadSeqRef.current || activeTaskIdRef.current !== expectedTaskId) return;
      setLoadError(error instanceof Error ? error.message : "任务加载失败");
    } finally {
      if (seq === loadSeqRef.current && activeTaskIdRef.current === expectedTaskId) setLoading(false);
    }
  }, [taskId]);

  // 秒开：驾驶舱/序列导航经 location.state 带来任务快照，先渲染再后台静默拉最新覆盖

  useEffect(() => {
    const seeded = (location.state as { task?: RdTask } | null)?.task;
    const hasSeed = Boolean(seeded && seeded.task_id === taskId);
    if (hasSeed) {
      setTask(seeded!);
      setLoading(false);
    }
    void loadTask({ silent: hasSeed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTask, taskId]);

  useEffect(() => {
    if (productionWorkspace || !canSyncProduction) {
      setProductionSync(null);
      return;
    }
    let cancelled = false;
    fetchRdProductionTaskSyncs()
      .then((records) => {
        if (!cancelled) setProductionSync(records.find((record) => record.task_id === taskId) ?? null);
      })
      .catch(() => { if (!cancelled) setProductionSync(null); });
    return () => { cancelled = true; };
  }, [canSyncProduction, productionWorkspace, taskId]);

  const toggleProductionSync = async () => {
    if (!task || productionSyncing || productionWorkspace || !canSyncProduction) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setProductionSyncing(true);
    try {
      const next = productionSync?.active
        ? await revokeRdTaskProductionSync(expectedTaskId)
        : await syncRdTaskToProduction(expectedTaskId);
      if (activeTaskIdRef.current !== expectedTaskId) return;
      setProductionSync(next);
      toast.success(next.active ? t("已同步到生产驾驶舱") : t("已撤销生产驾驶舱同步"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("同步操作失败，请重试"));
    } finally {
      setProductionSyncing(false);
    }
  };

  useEffect(() => {
    fetchRdPeople()
      .then((data) => setPeople(data.map((p) => ({ id: p.id, user_id: p.user_id ?? null, name: p.name, position: p.position ?? "" }))))
      .catch(() => setPeople([]));
  }, []);

  // 附件库表格里点文件名打开的预览（与留痕附件磁贴共用同一个弹窗）
  const [previewAttachment, setPreviewAttachment] = useState<RdTaskProgressAttachment | null>(null);

  const progressLoadSeqRef = useRef(0);
  const loadProgressGroup = useCallback(async (showLoading = true) => {
    const expectedTaskId = taskId;
    if (!expectedTaskId || activeTaskIdRef.current !== expectedTaskId) return;
    const seq = ++progressLoadSeqRef.current;
    if (showLoading) {
      setNotesLoading(true);
      setNotesError("");
    }
    try {
      const data = await fetchRdTaskProgressNoteGroup(expectedTaskId);
      if (seq !== progressLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId) return;
      setNotesError("");
      setGroupNotes(data.notes);
      setProgressGroupTasks(data.tasks);
      setNotes(data.notes.filter((note) => (note.source_task?.task_id ?? note.task_id) === expectedTaskId));
      void markRdTaskNotesRead(expectedTaskId).catch(() => {});
    } catch (error) {
      if (seq !== progressLoadSeqRef.current || activeTaskIdRef.current !== expectedTaskId) return;
      setNotesError(error instanceof Error ? error.message : t("进度留痕加载失败"));
    } finally {
      if (seq === progressLoadSeqRef.current && activeTaskIdRef.current === expectedTaskId) setNotesLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setNotes([]);
    setGroupNotes([]);
    setProgressGroupTasks([]);
    setNoteTaskFilter("all");
    setAuditTaskFilter("all");
    setSelectedActivityActor(null);
    setEditingDescription(false);
    setDescriptionDraft("");
    setDescriptionSaving(false);
    void loadProgressGroup();
    return () => { progressLoadSeqRef.current += 1; };
  }, [loadProgressGroup, taskId]);

  // 任务参数切换时关闭所有“绑定当前任务”的浮层，避免 A 任务的确认状态沿用到 B。
  // 同时让跨任务异步请求失效；旧任务的响应不得在新任务上开窗或触发跳转。
  useEffect(() => {
    moveRequestSeqRef.current += 1;
    issueRequestSeqRef.current += 1;
    setShowCreateSubtask(false);
    setShowAttachSubtasks(false);
    setShowDetachSubtasks(false);
    setShowHandover(false);
    setShowEditInfo(false);
    setShowAddCollab(false);
    setShowComplete(false);
    setShowSubmitConfirm(false);
    setTransferOpen(false);
    stockPlanLinkRequestRef.current += 1;
    setStockPlanLinkLoading(false);
    setShowMove(false);
    setMoveLoading(false);
    setGeneratingIssue(false);
    setShowApproval(null);
    setCustomTaskType(null);
    setPersonTasksFor(null);
    setDiscussionUnread(0);
    setProgressThreadOpen(false);
  }, [taskId]);

  const activityNotes = useMemo(
    () => visibleActivityActor
      ? notes.filter((note) => activityActor
        ? auditActorMatchesIdentity(note.actor, visibleActivityActor)
        : detailActivityActorMatches(note.actor, visibleActivityActor))
      : notes,
    [activityActor, notes, visibleActivityActor],
  );
  const activityGroupNotes = useMemo(
    () => visibleActivityActor
      ? groupNotes.filter((note) => activityActor
        ? auditActorMatchesIdentity(note.actor, visibleActivityActor)
        : detailActivityActorMatches(note.actor, visibleActivityActor))
      : groupNotes,
    [activityActor, groupNotes, visibleActivityActor],
  );
  const noteCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of activityNotes) {
      if (note.work_item_id) counts.set(note.work_item_id, (counts.get(note.work_item_id) ?? 0) + 1);
    }
    return counts;
  }, [activityNotes]);

  const progressGroupTaskById = useMemo(
    () => new Map(progressGroupTasks.map((item) => [item.task_id, item] as const)),
    [progressGroupTasks],
  );
  const progressGroupTaskIds = useMemo(
    () => new Set(progressGroupTasks.length > 0 ? progressGroupTasks.map((item) => item.task_id) : [taskId]),
    [progressGroupTasks, taskId],
  );
  const allTaskById = useMemo(
    () => new Map(allTasks.map((item) => [item.task_id, item] as const)),
    [allTasks],
  );
  const filteredGroupNotes = useMemo(
    () => noteTaskFilter === "all"
      ? activityGroupNotes
      : activityGroupNotes.filter((note) => (note.source_task?.task_id ?? note.task_id) === noteTaskFilter),
    [activityGroupNotes, noteTaskFilter],
  );
  const activityNoteCountByTask = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of activityGroupNotes) {
      const sourceTaskId = note.source_task?.task_id ?? note.task_id;
      counts.set(sourceTaskId, (counts.get(sourceTaskId) ?? 0) + 1);
    }
    return counts;
  }, [activityGroupNotes]);
  const filteredGroupTaskCount = useMemo(
    () => new Set(filteredGroupNotes.map((note) => note.source_task?.task_id ?? note.task_id)).size,
    [filteredGroupNotes],
  );
  const changeNoteTaskFilter = (nextTaskId: string) => {
    setNoteTaskFilter(nextTaskId);
  };

  const subtasks = task?.subtasks ?? [];

  const auditLogs = useMemo(
    () => {
      const taskLogs = allTaskAuditLogs.filter((log) => progressGroupTaskIds.has(log.resource.id));
      if (!visibleActivityActor) return taskLogs;
      if (activityActor) return filterAuditLogsByActor(taskLogs, visibleActivityActor);
      return taskLogs.filter((log) => detailActivityActorMatches(log.actor, visibleActivityActor));
    },
    [activityActor, allTaskAuditLogs, progressGroupTaskIds, visibleActivityActor],
  );

  // 附件库按整棵关系树聚合（与「进展留痕」Tab、移动端附件库同口径）：合并进来的子任务和
  // 自建子任务的附件此前完全看不到——它们的留痕挂在各自的 source_task 上，被过滤掉了。
  // 同一文件可能经多条留痕重复出现，按 object_key（无则 id）去重，保留最新一条。
  const docAttachments = useMemo(() => {
    const seen = new Set<string>();
    return groupNotes
      .flatMap((n) =>
        (n.attachments ?? [])
          .filter((att) => !inferAttachmentMime(att).startsWith("image/"))
          .map((att) => ({
            att,
            createdAt: n.created_at,
            actor: n.actor?.name ?? "",
            sourceTaskId: n.source_task?.task_id ?? n.task_id,
            sourceTaskTitle: n.source_task?.title ?? "",
          })),
      )
      .filter((item) => {
        const key = item.att.object_key || item.att.id || `${item.att.name}|${item.att.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [groupNotes]);
  const detailFacts = useMemo(() => {
    const workItems = task?.work_items ?? [];
    let attachmentCount = 0;
    for (const note of activityGroupNotes) attachmentCount += note.attachments?.length ?? 0;
    return {
      workItemCount: workItems.length,
      completedWorkItemCount: workItems.filter((item) => item.done).length,
      noteCount: activityGroupNotes.length,
      attachmentCount,
    };
  }, [activityGroupNotes, task?.work_items]);
  const latestProgressNote = useMemo(() => activityNotes.reduce<RdTaskProgressNote | null>(
    (latest, note) => !latest || note.created_at > latest.created_at ? note : latest, null,
  ), [activityNotes]);

  // 导出报告用：audit 记录 + 无对应 audit 的留痕合成条目（保证报告时间线完整）
  // 合成条目的 resource.id/name 取该留痕自身所属任务，主线视图下才能正确标出来源。
  const reportLogs = useMemo<AuditLog[]>(() => {
    const matchedNoteIds = new Set(
      auditLogs.map((log) => (typeof log.metadata?.note_id === "string" ? log.metadata.note_id : "")).filter(Boolean),
    );
    const orphanLogs: AuditLog[] = activityGroupNotes
      .filter((n) => !matchedNoteIds.has(n.id))
      .map((n) => {
        const sourceTaskId = n.source_task?.task_id ?? n.task_id;
        const sourceTask = progressGroupTaskById.get(sourceTaskId) ?? allTaskById.get(sourceTaskId);
        return {
          id: `report-note-${n.id}`,
          timestamp: n.created_at,
          actor: { id: n.actor?.id ?? null, name: n.actor?.name ?? "研发成员", role: n.actor?.role ?? "研发成员" },
          action: "task.progress_updated" as const,
          resource: {
            type: "task" as const,
            id: sourceTaskId,
            name: n.source_task?.title ?? sourceTask?.title ?? task?.title ?? "",
          },
          comment: n.text || "更新任务进度",
          metadata: { note_id: n.id, synthetic: true },
          source: "web" as const,
        };
      });
    return filterAuditLogsForViewer([...auditLogs, ...orphanLogs], user);
  }, [activityGroupNotes, allTaskById, auditLogs, progressGroupTaskById, task?.title, user]);
  const noteById = useMemo(() => new Map(activityGroupNotes.map((n) => [n.id, n] as const)), [activityGroupNotes]);
  const reportLogById = useMemo(() => new Map(reportLogs.map((log) => [log.id, log] as const)), [reportLogs]);
  const reportNoteOf = useCallback(
    (logId: string) => {
      const log = reportLogById.get(logId);
      const noteId = typeof log?.metadata?.note_id === "string" ? log.metadata.note_id : "";
      return noteId ? noteById.get(noteId) : undefined;
    },
    [noteById, reportLogById],
  );
  // 操作记录 Tab 的完整时间线（动作 + 进展合成，时间倒序）——与驾驶舱抽屉/导出报告同一份口径
  const timelineLogs = useMemo(
    () => [...reportLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [reportLogs],
  );
  const timelineLogCountByTask = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of timelineLogs) {
      counts.set(log.resource.id, (counts.get(log.resource.id) ?? 0) + 1);
    }
    return counts;
  }, [timelineLogs]);
  const filteredTimelineLogs = useMemo(
    () => auditTaskFilter === "all"
      ? timelineLogs
      : timelineLogs.filter((log) => log.resource.id === auditTaskFilter),
    [auditTaskFilter, timelineLogs],
  );

  // 参与人（主责/协作）或管理员可在时间线底部直接记进展（后端同口径校验兜底）
  const isParticipant = useMemo(() => {
    if (!task || !user) return false;
    if (task.primary_owner_user_id === user.id || task.primary_owner === user.name) return true;
    return (task.collaborators ?? []).some((c) => c.user_id === user.id || c.name === user.name);
  }, [task, user]);
  // ── 管理动作（API 口径与驾驶舱抽屉完全一致） ──────────────────────────────

  /** 编辑标题/描述（主管）：PATCH 后乐观更新双数据源并留审计 diff */
  const handleEditInfo = async (nextTitle: string, nextDescription: string) => {
    if (!task) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    const title = nextTitle.trim();
    if (!title) {
      toast.error(t("标题不能为空"));
      return;
    }
    const changes: { field: string; before: string; after: string }[] = [];
    const titleChanged = title !== task.title;
    const descChanged = nextDescription !== (task.description ?? "");
    if (titleChanged) changes.push({ field: "title", before: task.title, after: title });
    if (descChanged) {
      // 从首个差异处截取摘要：长描述只改结尾时，头 120 字相同会记出 before===after 的无效 diff
      const before = task.description ?? "";
      let diffAt = 0;
      while (diffAt < before.length && diffAt < nextDescription.length && before[diffAt] === nextDescription[diffAt]) diffAt += 1;
      const from = Math.max(0, diffAt - 30);
      const clip = (s: string) => (from > 0 ? "…" : "") + s.slice(from, from + 120) + (s.length > from + 120 ? "…" : "");
      changes.push({ field: "description", before: clip(before), after: clip(nextDescription) });
    }
    if (changes.length === 0) {
      setShowEditInfo(false);
      return;
    }
    // 只提交实际变更的字段，避免把 undefined 描述静默覆写成空串
    await updateRdTask(expectedTaskId, {
      ...(titleChanged ? { title } : {}),
      ...(descChanged ? { description: nextDescription } : {}),
    });
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setTask((prev) => (prev?.task_id === expectedTaskId ? { ...prev, title, description: nextDescription } : prev));
    setAllTasks((prev) => prev.map((item) => (item.task_id === expectedTaskId ? { ...item, title, description: nextDescription } : item)));
    setShowEditInfo(false);
    toast.success(t("任务信息已更新"));
  };

  /** 描述卡就地编辑：复用任务信息更新与审计链路，避免出现两套保存口径。 */
  const startDescriptionEdit = () => {
    if (!task || !canManage || task.archived) return;
    setDescriptionDraft(task.description ?? "");
    setEditingDescription(true);
  };

  const cancelDescriptionEdit = () => {
    if (descriptionSaving) return;
    setDescriptionDraft(task?.description ?? "");
    setEditingDescription(false);
  };

  const saveDescription = async () => {
    if (!task || descriptionSaving) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    if (descriptionDraft === (task.description ?? "")) {
      setEditingDescription(false);
      return;
    }
    setDescriptionSaving(true);
    try {
      await handleEditInfo(task.title, descriptionDraft);
      if (activeTaskIdRef.current === expectedTaskId) setEditingDescription(false);
    } catch (error) {
      if (activeTaskIdRef.current === expectedTaskId) {
        toast.error(error instanceof Error ? error.message : t("保存失败，请重试"));
      }
    } finally {
      if (activeTaskIdRef.current === expectedTaskId) setDescriptionSaving(false);
    }
  };

  const savePriority = async (next: RdPriority) => {
    if (!task || savingPriority || next === task.final_priority) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId || !canManage) return;
    const prev = task.final_priority;
    setSavingPriority(true);
    try {
      await updateRdTask(expectedTaskId, { final_priority: next });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      setTask((prevTask) => (prevTask?.task_id === expectedTaskId ? { ...prevTask, final_priority: next } : prevTask));
      // 同步 allTasks，保证人员任务弹层等派生视图显示新值（task 与 allTasks 双源须一起更新）
      setAllTasks((prevAll) => prevAll.map((t) => (t.task_id === expectedTaskId ? { ...t, final_priority: next } : t)));
      toast.success(t("优先级已更新"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新优先级失败");
    } finally {
      setSavingPriority(false);
    }
  };

  /**
   * 任务类型 = category_path 第三段，也就是驾驶舱卡片上那个 tag。
   * AI 抽取时判断，判错了由人工在这里纠正；前两段（分类归属）不动 —— 改归属是「移动归类」的事。
   */
  const saveTaskType = async (next: string) => {
    if (!task || savingTaskType) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId || !canManage) return;
    const value = next.trim();
    const current = taskTypeOf(task.category_path);
    if (!value || value === current) {
      setCustomTaskType(null);
      return;
    }
    const nextPath = withTaskType(task.category_path, value);
    setSavingTaskType(true);
    try {
      await updateRdTask(expectedTaskId, { category_path: nextPath });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      // task 与 allTasks 双源须一起更新，否则人员任务弹层等派生视图仍显示旧 tag
      setTask((prevTask) => (prevTask?.task_id === expectedTaskId ? { ...prevTask, category_path: nextPath } : prevTask));
      setAllTasks((prevAll) =>
        prevAll.map((t) => (t.task_id === expectedTaskId ? { ...t, category_path: nextPath } : t)),
      );
      setCustomTaskType(null);
      toast.success(t("任务类型已更新"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("保存失败，请重试"));
    } finally {
      setSavingTaskType(false);
    }
  };

  /** 审批（通过/驳回）：口径与驾驶舱抽屉 handleApproval 一致——状态裁决完全交给后端 _review_action。 */
  const handleApproval = async (reason?: string, rollbackProgress?: number) => {
    if (!task || !showApproval || !canManage || task.status !== "pending_review") return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setSubmitting(true);
    try {
      const isApprove = showApproval === "approve";
      const meta = getReviewTypeMeta(task.pending_review_type);
      if (!meta) {
        toast.error(t("无法识别该任务的审核类型，请刷新后重试"));
        return;
      }
      await updateRdTask(expectedTaskId, {
        _review_action: isApprove ? "approve" : "reject",
        _reviewer_name: AUDIT_ACTOR.name,
        ...(isApprove ? {} : { _reject_reason: reason ?? `驳回${meta.label}` }),
        ...(!isApprove && typeof rollbackProgress === "number" ? { progress: rollbackProgress } : {}),
      } as Parameters<typeof updateRdTask>[1]);
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(`${t(meta.label)}${isApprove ? t("已通过") : t("已驳回")}`);
      setShowApproval(null);
      void loadTask({ expectedTaskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHandover = async (newOwner: string) => {
    if (!task || !canManage) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setSubmitting(true);
    try {
      await updateRdTask(expectedTaskId, {
        primary_owner: newOwner,
        _actor_name: user?.name || "管理员",
      } as Partial<Omit<RdTask, "task_id">> & { _actor_name?: string });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(t("任务已移交给 {name}", { name: newOwner }));
      setShowHandover(false);
      void loadTask({ expectedTaskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCollaborators = async (newCollaborators: RdCollaborator[]) => {
    if (!task || !canManage) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    try {
      // 全屏页可能停留很久，页面快照的 collaborators 会过期——提交前取服务器最新值再合并，
      // 避免全量覆盖把期间他端新增的协作人静默挤掉
      let baseCollaborators = task.collaborators ?? [];
      try {
        const categories = await fetchMergedTaskCategories();
        const fresh = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks))).find(
          (t) => t.task_id === expectedTaskId,
        );
        if (fresh) baseCollaborators = fresh.collaborators ?? [];
      } catch {
        // 取最新失败时退回页面快照（后端 normalizeCollaboratorList 仍会去重）
      }
      const existingKeys = new Set(baseCollaborators.map((c) => c.user_id || c.name));
      const merged = [...baseCollaborators, ...newCollaborators.filter((c) => !existingKeys.has(c.user_id || c.name))];
      await updateRdTask(expectedTaskId, {
        collaborators: merged,
        _actor_name: user?.name || "管理员",
      } as Partial<Omit<RdTask, "task_id">> & { _actor_name?: string });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(t("已添加 {n} 位协作人", { n: newCollaborators.length }));
      setShowAddCollab(false);
      void loadTask({ expectedTaskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加协作人失败");
    }
  };

  const handleDirectComplete = async () => {
    if (!task || !canManage || taskReadOnly || task.status === "completed") return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setSubmitting(true);
    try {
      await updateRdTask(expectedTaskId, { status: "completed", progress: 100 });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(t("任务已标记完成"));
      setShowComplete(false);
      void loadTask({ expectedTaskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ── 研发侧特有动作（与驾驶舱抽屉同口径） ────────────────────────────────────

  /** 仅主责人本人（且非管理员）可提交完成审核，与抽屉 canSubmitForReview 口径一致 */
  const isCurrentOwner = Boolean(
    task && user && (
      (task.primary_owner_user_id && task.primary_owner_user_id === user.id) ||
      task.primary_owner === user.name
    ),
  );
  const canSubmitForReview = Boolean(task && !taskReadOnly && task.status === "in_progress" && isCurrentOwner && !canManage);

  /** 转采购弹窗默认带入的任务附件（全部进度留痕附件拍平） */
  const transferAttachments = useMemo(
    () => notes.flatMap((note) => note.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mime,
      fileUrl: getAttachmentUrl(a),
      fileKey: a.object_key,
    }))).filter((attachment) => Boolean(attachment.fileUrl)),
    [notes],
  );

  const handleSubmitForReview = async () => {
    if (!task || !canSubmitForReview) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setSubmitting(true);
    try {
      await updateRdTask(expectedTaskId, { status: "pending_review", progress: 100 });
      const changes: { field: string; before: string; after: string }[] = [
        { field: "status", before: task.status, after: "pending_review" },
      ];
      if (task.progress !== 100) {
        changes.push({ field: "progress", before: String(task.progress), after: "100" });
      }
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(t("任务已提交审核，等待确认"));
      window.dispatchEvent(new CustomEvent("rd:review-submitted"));
      setShowSubmitConfirm(false);
      void loadTask({ expectedTaskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  /** 生成问题：把任务内容（描述+留痕+附件）一键建到「问题记录与 AI 定位」，与抽屉实现同源 */
  const handleGenerateIssue = async () => {
    if (!task || generatingIssue) return;
    const expectedTaskId = task.task_id;
    const requestSeq = ++issueRequestSeqRef.current;
    const sourceTask = task;
    const sourceNotes = notes;
    const isCurrentRequest = () => issueRequestSeqRef.current === requestSeq && activeTaskIdRef.current === expectedTaskId;
    if (!isCurrentRequest()) return;
    setGeneratingIssue(true);
    try {
      const parts: string[] = [];
      if (sourceTask.description?.trim()) parts.push(sourceTask.description.trim());
      const noteTexts = sourceNotes.map((n) => (n.text ?? "").trim()).filter(Boolean);
      if (noteTexts.length > 0) parts.push("【进展 / 问题记录】\n" + noteTexts.map((s, i) => `${i + 1}. ${s}`).join("\n"));
      parts.push(`（自研发任务生成：${sourceTask.task_id}${sourceTask.category_path ? "｜" + sourceTask.category_path : ""}）`);

      // 把留痕附件经同源 preview_url 取回字节，走问题模块 uploadAttachment 搬运（与抽屉逻辑一致）
      const seen = new Set<string>();
      const srcAtts = sourceNotes
        .flatMap((n) => n.attachments)
        .filter((a) => {
          const k = a.id || `${a.name}-${a.size}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      if (srcAtts.length > 0) toast.info(`正在搬运 ${srcAtts.length} 个附件到问题…`);
      const issueAttachments: NonNullable<Parameters<typeof issueService.create>[0]["attachments"]> = [];
      for (const a of srcAtts) {
        if (!isCurrentRequest()) return;
        try {
          const url = getAttachmentPreviewUrl(a) || getAttachmentUrl(a);
          if (!url) continue;
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const raw = await issueService.uploadAttachment({
            fileName: a.name,
            fileType: a.mime || blob.type || "application/octet-stream",
            size: a.size ?? blob.size,
            dataUrl: await blobToDataUrl(blob),
          });
          const processed = await issueService.processAttachment(raw, "ai").catch(() => raw);
          const extractedText = (processed.extractedText && processed.extractedText.trim()) || (a.extracted_text && a.extracted_text.trim()) || undefined;
          issueAttachments.push({ id: processed.id, fileName: processed.fileName, fileType: processed.fileType, fileUrl: processed.fileUrl, extractedText });
        } catch {
          // 单个附件搬运失败不阻断整体生成
        }
      }
      if (!isCurrentRequest()) return;
      if (issueAttachments.length < srcAtts.length) {
        const names = srcAtts.map((a) => a.name).join("、");
        if (names) parts.splice(parts.length - 1, 0, "【相关附件】" + names);
      }

      const issue = await issueService.create({
        title: sourceTask.title,
        description: parts.join("\n\n"),
        source: "rd",
        attachments: issueAttachments.length > 0 ? issueAttachments : undefined,
      });
      if (!isCurrentRequest()) return;
      toast.success(`已生成问题${issueAttachments.length > 0 ? `（含 ${issueAttachments.length} 个附件）` : ""}，正在跳转…`);
      navigate(`/issue-ai?issue=${encodeURIComponent(issue.id)}`);
    } catch (e) {
      if (isCurrentRequest()) toast.error(e instanceof Error ? e.message : "生成问题失败，请重试");
    } finally {
      if (isCurrentRequest()) setGeneratingIssue(false);
    }
  };

  /** 打开「移动到其他类目」：按需拉主产品树与产品列表（详情页平时用不到这两份数据） */
  const openMoveDialog = async () => {
    if (!task || !canManage || moveLoading) return;
    const expectedTaskId = task.task_id;
    const requestSeq = ++moveRequestSeqRef.current;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setMoveLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        categories.length > 0 ? Promise.resolve(categories) : fetchRdTaskCategories(),
        products.length > 0 ? Promise.resolve(products) : fetchRdProducts(),
      ]);
      if (requestSeq !== moveRequestSeqRef.current || activeTaskIdRef.current !== expectedTaskId) return;
      setCategories(cats);
      setProducts(prods);
      setShowMove(true);
    } catch (error) {
      if (requestSeq === moveRequestSeqRef.current && activeTaskIdRef.current === expectedTaskId) {
        toast.error(error instanceof Error ? error.message : "分类数据加载失败，请重试");
      }
    } finally {
      if (requestSeq === moveRequestSeqRef.current && activeTaskIdRef.current === expectedTaskId) setMoveLoading(false);
    }
  };

  const handleMoveConfirm = async (targetProductId: string, targetCatId: string, targetSubId: string) => {
    if (!task || !canManage) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    try {
      const result = await moveRdTasks({
        taskIds: [expectedTaskId],
        targetProductId,
        targetCategoryId: targetCatId,
        targetSubId,
      });
      if (activeTaskIdRef.current !== expectedTaskId) return;
      const productLabel = products.find((p) => p.id === targetProductId)?.name ?? "";
      const movedPath = `${result.targetCategoryLabel} / ${result.targetSubLabel}`;
      toast.success(productLabel ? `任务已移动到 ${productLabel} · ${movedPath}` : `任务已移动到 ${movedPath}`);
      setShowMove(false);
      void loadTask({ expectedTaskId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移动失败，请重试");
    }
  };

  // ── 子任务树：父任务面包屑 / 子任务清单 / 整树并入 / 取消关系 ───────────────

  /** 当前任务的父任务（本任务是子任务时非空）。按结构索引判定，不看 parent_task_id 字段。 */
  const parentTask = subtaskParents.get(taskId) ?? null;
  /** 当前任务所在关系树的根节点；关系页签始终展示完整上下文，不把中间层拍平。 */
  const relationRoot = useMemo(() => {
    if (!task) return null;
    let root = task;
    const visited = new Set([task.task_id]);
    while (true) {
      const parent = subtaskParents.get(root.task_id);
      if (!parent || visited.has(parent.task_id)) return root;
      visited.add(parent.task_id);
      root = parent;
    }
  }, [task, subtaskParents]);
  const relationNodeCount = useMemo(
    () => (relationRoot ? countRelationNodes(relationRoot) : 0),
    [relationRoot],
  );
  const openRelationTask = useCallback((target: RdTask) => {
    if (target.task_id !== taskId) {
      navigate(taskDetailPath(target.task_id), { state: { ...procurementReturnState, task: target } });
    }
  }, [navigate, taskDetailPath, taskId, procurementReturnState]);
  /**
   * 可并入为子任务的候选：顶层任务、非自身、未归档。
   * 候选可以自带完整子任务树；挂载后原层级永久保留。
   */
  const attachCandidates = useMemo(
    () =>
      topLevelTasks.filter(
        (candidate) =>
          candidate.task_id !== taskId &&
          !relationContainsTask(candidate, taskId) &&
          !candidate.archived &&
          candidate.status !== "archived",
      ),
    [topLevelTasks, taskId],
  );

  const handleCreateSubtask = async (input: {
    title: string;
    primary_owner: string;
    primary_owner_user_id: string | null;
    due_date: string;
    final_priority: RdPriority;
    description: string;
  }) => {
    if (!task || !canManage) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    await createRdTask({
      parent_task_id: expectedTaskId,
      title: input.title,
      primary_owner: input.primary_owner,
      primary_owner_user_id: input.primary_owner_user_id,
      status: "in_progress",
      final_priority: input.final_priority,
      ai_priority: input.final_priority,
      due_date: input.due_date || undefined,
      description: input.description || undefined,
    });
    if (activeTaskIdRef.current !== expectedTaskId) return;
    toast.success(t("子任务已创建"));
    setShowCreateSubtask(false);
    void Promise.all([loadTask({ silent: true, expectedTaskId }), loadProgressGroup(false)]);
  };

  const handleAttachSubtasks = async (childIds: string[]) => {
    if (!task || !canManage || childIds.length === 0) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    await attachRdTasksToParent(childIds, expectedTaskId);
    if (activeTaskIdRef.current !== expectedTaskId) return;
    toast.success(t("已并入 {n} 个任务为子任务", { n: childIds.length }));
    setShowAttachSubtasks(false);
    void Promise.all([loadTask({ silent: true, expectedTaskId }), loadProgressGroup(false)]);
  };

  const handleDetachSubtasks = async (childIds: string[]) => {
    if (!task || !canManage || childIds.length === 0) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    await detachRdSubtasks(childIds, expectedTaskId);
    if (activeTaskIdRef.current !== expectedTaskId) return;
    toast.success(t("已取消 {n} 个子任务关系", { n: childIds.length }));
    setShowDetachSubtasks(false);
    void Promise.all([loadTask({ silent: true, expectedTaskId }), loadProgressGroup(false)]);
  };

  const handleDetachSubtask = async () => {
    if (!task || !canManage || detaching) return;
    const expectedTaskId = task.task_id;
    if (activeTaskIdRef.current !== expectedTaskId) return;
    setDetaching(true);
    try {
      await detachRdSubtask(expectedTaskId);
      if (activeTaskIdRef.current !== expectedTaskId) return;
      toast.success(t("已取消子任务关系，该任务已提升为独立任务"));
      void Promise.all([loadTask({ silent: true, expectedTaskId }), loadProgressGroup(false)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("取消子任务失败，请重试"));
    } finally {
      setDetaching(false);
    }
  };

  /** 某人名下的活跃任务（供人员任务弹层展示，点击可跳到对应任务详情页） */
  const tasksOfPerson = useMemo(() => {
    if (!personTasksFor) return [];
    return allTasks.filter(
      (t) => t.primary_owner === personTasksFor && !t.archived && t.status !== "archived",
    );
  }, [allTasks, personTasksFor]);

  // ── 上一条/下一条任务导航（j/k 快捷键 + 页头按钮）：领导逐条过任务不用来回跳驾驶舱 ──
  // 序列按最近活动倒序（与驾驶舱「全部」卡片流同口径）
  const taskSeq = useMemo(
    () =>
      allTasks
        .filter((t) => !t.archived && t.status !== "archived")
        .sort((a, b) =>
          String(b.last_activity_at ?? b.updated_at ?? "").localeCompare(String(a.last_activity_at ?? a.updated_at ?? "")),
        ),
    [allTasks],
  );
  const seqIndex = useMemo(() => taskSeq.findIndex((t) => t.task_id === taskId), [taskSeq, taskId]);
  const taskNavigationLocked = Boolean(
    showCreateSubtask || showAttachSubtasks || showDetachSubtasks || showHandover || showEditInfo
    || editingDescription || showAddCollab || showComplete || showSubmitConfirm || transferOpen
    || showMove || showApproval || customTaskType !== null || personTasksFor || submitting
    || productionSyncing || descriptionSaving || savingPriority || savingTaskType || detaching || generatingIssue || moveLoading,
  );
  const gotoSeq = useCallback(
    (offset: number) => {
      if (taskNavigationLocked || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = taskSeq[seqIndex + offset];
      if (target) navigate(taskDetailPath(target.task_id), { state: { ...procurementReturnState, task: target } });
    },
    [navigate, seqIndex, taskDetailPath, taskNavigationLocked, taskSeq, procurementReturnState],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || taskNavigationLocked) return;
      const el = e.target as HTMLElement | null;
      // 输入场景不劫持按键
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "j") gotoSeq(1);
      if (e.key === "k") gotoSeq(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gotoSeq, taskNavigationLocked]);

  if (!canView) {
    return (
      <div className={cn(RD_TASK_DETAIL_HORIZON_SCOPE, "flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center text-slate-500")}>
        <span className="flex size-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-balance text-base font-semibold text-slate-800">{t("无法查看任务详情")}</h2>
        <p className="max-w-sm text-pretty text-sm leading-6">{t("当前账号没有此工作区的任务访问权限。")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cn(RD_TASK_DETAIL_HORIZON_SCOPE, "flex min-h-[40vh] w-full max-w-[1440px] flex-col gap-4 px-3 py-5 sm:px-5")}
        role="status"
        aria-label={t("正在加载任务详情")}
      >
        <span className="sr-only">{t("正在加载任务…")}</span>
        <div className="h-9 w-44 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />
          <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className={cn(RD_TASK_DETAIL_HORIZON_SCOPE, "flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center text-slate-500")} role="alert">
        <span className="flex size-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-balance text-base font-semibold text-slate-800">{t("任务详情暂不可用")}</h2>
        <p className="max-w-md text-pretty text-sm leading-6">{loadError || t("任务不存在")}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={() => void loadTask()} className="bg-[#002fa7] text-white hover:bg-[#002581]">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t("重新加载")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(detailReturnPath)}>
            {t(procurementReturnPath ? "返回采购工作台" : "返回驾驶舱")}
          </Button>
        </div>
      </div>
    );
  }

  const sCfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.in_progress;
  const pCfg = PRIORITY_CONFIG[task.final_priority] ?? PRIORITY_CONFIG.medium;
  const blockedDays = blockedDaysOf(task);
  const workItems = task.work_items ?? [];
  const topicPathParts = String(task.category_path ?? "")
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const topicLabel = topicPathParts.at(-1) ?? t("待归类任务");
  // topicLabel 在无分类时是占位文案，不能当成真实类型塞进选择器；这里取实际存储值（可能为空）。
  const currentTaskType = taskTypeOf(task.category_path);
  const componentLabel = topicPathParts.length > 1 ? topicPathParts.at(-2)! : topicLabel;
  const overdue = isTaskOverdue(task);
  const riskLabel = task.status === "paused_blocked" ? t("阻塞中") : overdue ? t("已逾期") : t("正常");
  const canClearActivityActor = canSelectActivityActor && Boolean(selectedActivityActor);
  const clearActivityActor = () => {
    if (canSelectActivityActor) setSelectedActivityActor(null);
  };
  const hasNoteFilter = Boolean(visibleActivityActor) || noteTaskFilter !== "all";
  const notesFilteredEmpty = hasNoteFilter && !progressThreadOpen && !notesLoading && !notesError && filteredGroupNotes.length === 0;
  const reviewMeta = task.status === "pending_review" ? getReviewTypeMeta(task.pending_review_type) : null;


  const taskPeopleSection = (
    <div className="rd-reference-people px-4 py-3.5">
            {researchWorkspace && <h3 className="mb-4 text-sm font-semibold text-slate-800">{t("任务协作")}</h3>}
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{t("主责人")}</span>
              {canManage && !task.archived && (
                <button
                  type="button"
                  onClick={() => setShowAddCollab(true)}
                  className="min-h-9 cursor-pointer rounded px-1.5 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff]"
                >
                  + {t("添加协作人")}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-pressed={canSelectActivityActor ? activityActorIsSelected({ id: task.primary_owner_user_id, name: task.primary_owner }) : undefined}
              onClick={() => {
                const actor = { id: task.primary_owner_user_id, name: task.primary_owner };
                if (canSelectActivityActor) toggleActivityActor(actor);
                else setPersonTasksFor(task.primary_owner);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                canSelectActivityActor && activityActorIsSelected({ id: task.primary_owner_user_id, name: task.primary_owner })
                  ? "bg-[#eef3ff] ring-1 ring-inset ring-[#002fa7]/20"
                  : "hover:bg-slate-50",
              )}
              title={canSelectActivityActor
                ? t(activityActorIsSelected({ id: task.primary_owner_user_id, name: task.primary_owner }) ? "再次点击恢复全部人员" : "只看此人的留痕与操作记录")
                : `查看 ${task.primary_owner} 名下的任务`}
            >
              <OwnerAvatar name={task.primary_owner} userId={task.primary_owner_user_id} size="sm" />
              <span className="text-sm font-medium text-slate-800">{displayPersonName(task.primary_owner)}</span>
              {canSelectActivityActor && activityActorIsSelected({ id: task.primary_owner_user_id, name: task.primary_owner }) ? (
                <span className="ml-auto rounded-full bg-[#dce6ff] px-2 py-0.5 text-[10px] font-semibold text-[#002fa7]">{t("筛选中")}</span>
              ) : null}
            </button>
            {(task.collaborators ?? []).length > 0 && (
              <>
                <div className="mb-2 mt-3 text-xs font-semibold text-slate-500">{t("协作人")}</div>
                <div className="space-y-1">
                  {(task.collaborators ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={canSelectActivityActor ? activityActorIsSelected({ id: c.user_id, name: c.name }) : undefined}
                      onClick={() => {
                        const actor = { id: c.user_id, name: c.name };
                        if (canSelectActivityActor) toggleActivityActor(actor);
                        else setPersonTasksFor(c.name);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30",
                        canSelectActivityActor && activityActorIsSelected({ id: c.user_id, name: c.name })
                          ? "bg-[#eef3ff] ring-1 ring-inset ring-[#002fa7]/20"
                          : "hover:bg-slate-50",
                      )}
                      title={canSelectActivityActor
                        ? t(activityActorIsSelected({ id: c.user_id, name: c.name }) ? "再次点击恢复全部人员" : "只看此人的留痕与操作记录")
                        : `查看 ${c.name} 名下的任务`}
                    >
                      <OwnerAvatar name={c.name} userId={c.user_id} size="xs" />
                      <span className="text-sm text-slate-700">{c.name}</span>
                      <span className="text-[11px] text-slate-400">{t(c.role)}</span>
                      {canSelectActivityActor && activityActorIsSelected({ id: c.user_id, name: c.name }) ? (
                        <span className="ml-auto rounded-full bg-[#dce6ff] px-2 py-0.5 text-[10px] font-semibold text-[#002fa7]">{t("筛选中")}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
  );
  const taskWorkflowActions = (canSubmitForReview || (canManage && task.status === "pending_review" && reviewMeta) || (canManage && !task.archived && task.status === "in_progress")) ? (
    <div className="rd-horizon-detail-workflow flex flex-wrap items-center gap-2" role="group" aria-label={t("任务处理")}>
      {canSubmitForReview && (
        <Button type="button" size="sm" onClick={() => setShowSubmitConfirm(true)} className="min-h-10 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90">
          <Send className="size-3.5" aria-hidden="true" />
          {t("提交审核")}
        </Button>
      )}
      {canManage && task.status === "pending_review" && reviewMeta ? (
        <>
          <span className="text-xs text-muted-foreground">{t("待审核")}：{t(reviewMeta.label)}</span>
          <Button type="button" size="sm" onClick={() => setShowApproval("approve")} className="min-h-10 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t("审核通过")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowApproval("reject")} className="min-h-10 gap-1.5 border-destructive/25 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
            <X className="size-3.5" aria-hidden="true" />
            {t("驳回")}
          </Button>
        </>
      ) : null}
      {canManage && !task.archived && task.status === "in_progress" && (
        <Button type="button" size="sm" onClick={() => setShowComplete(true)} className="min-h-10 gap-1.5 bg-primary text-xs text-primary-foreground hover:bg-primary/90">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          {t("标记完成")}
        </Button>
      )}
    </div>
  ) : null;
  const taskSyncAction = !productionWorkspace && canSyncProduction && (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={productionSyncing}
      onClick={() => void toggleProductionSync()}
      className={cn(
        "h-8 gap-1.5 text-xs",
        productionSync?.active
          ? "border-amber-200 text-amber-700 hover:bg-amber-50"
          : "border-sky-200 text-sky-700 hover:bg-sky-50",
      )}
    >
      {productionSyncing
        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        : productionSync?.active
          ? <Undo2 className="h-3.5 w-3.5" />
          : <RefreshCw className="h-3.5 w-3.5" />}
      {productionSync?.active ? t("撤销同步") : t("同步到生产驾驶舱")}
    </Button>
  );
  const taskAssistantActions = currentRdWorkspace() === null ? (
    <div className="rd-reference-assistant grid grid-cols-2 gap-2" aria-label={t("MateChat 任务助手")}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => openMateChat({ pageContext: createRdTaskPageContext(task.task_id) })}
        className="min-h-10 gap-1.5 px-2 text-xs"
      >
        <MessageCircleMore className="size-3.5" aria-hidden="true" />
        {t("问 MateChat")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => openMateChat({
          pageContext: createRdTaskPageContext(task.task_id),
          intent: "delivery_check",
        })}
        className="min-h-10 gap-1.5 px-2 text-xs"
      >
        <FileText className="size-3.5" aria-hidden="true" />
        {t("检查结项资料")}
      </Button>
    </div>
  ) : null;

  const taskRelatedActions = (
    <div className={cn("space-y-1.5 px-4 py-3.5", researchWorkspace && "rd-reference-related-actions")}>
            {/* 移交仍仅向进行中任务开放；任务动作在研发右侧、生产原侧栏各渲染一次。 */}
            {canManage && !task.archived && task.status === "in_progress" && (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowHandover(true)} className="h-8 w-full gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                {t("移交任务")}
              </Button>
            )}
            {productionWorkspace && !task.archived && canCreateStockPlan && canOpenProcurement && (
              <Button type="button" variant="outline" size="sm" disabled={stockPlanLinkLoading} onClick={() => void openProductionStockPlan()} className="h-8 w-full gap-1.5 border-[#002fa7]/20 text-xs text-[#002fa7]">
                {stockPlanLinkLoading ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart aria-hidden="true" className="h-3.5 w-3.5" />}
                {t(stockPlanLinkLoading ? '正在读取任务归属…' : '建立备货计划')}
              </Button>
            )}
            {/* 研发侧特有：转采购 / 生成问题（非归档任务始终可用，与抽屉口径一致）。
                在途的采购关联显示跳转芯片而非再次转出；已取消的（含存量「审核驳回」数据）
                不占位——后端 transferFromRd 支持复用该记录重走审核，芯片与重提入口并存。 */}
            {!task.archived && !taskReadOnly && (
              <>
                {!researchWorkspace && procTask ? (
                  <ProcurementLinkChip
                    task={procTask}
                    onJump={(procTaskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(procTaskId)}`)}
                  />
                ) : null}
                {procTaskBlocksTransfer ? null : canTransferProc && (canManage || isParticipant) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTransferOpen(true)}
                    title={t("把本任务转为采购任务（需携带图纸附件）")}
                    className="h-8 w-full gap-1.5 text-xs"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {procTask ? t("重新转采购") : t("转采购")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleGenerateIssue()}
                  disabled={generatingIssue}
                  className={cn("h-8 w-full gap-1.5 text-xs", !researchWorkspace && "border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatingIssue ? t("生成中…") : t("生成问题")}
                </Button>
              </>
            )}
          </div>
  );

  // 双栏大屏至少占满可用视口；内容过多时允许页面自然增长，不能裁掉留痕列表。
  return (
    <TaskImageGalleryScope notes={groupNotes}>
      <motion.div
      ref={rootRef}
      style={viewportHeight ? { minHeight: viewportHeight } : undefined}
      className={cn(
        RD_TASK_DETAIL_HORIZON_SCOPE,
        researchWorkspace && "rd-reference-detail",
        "mx-auto flex max-w-[1440px] flex-col gap-4 px-2 pt-4 sm:px-4",
      )}
    >
      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
          <div className="min-w-0">
            <p className="font-semibold">{t("最新数据刷新失败，当前显示进入页面时的任务快照。")}</p>
            <p className="mt-0.5 break-words text-xs text-amber-700">{loadError}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0 border-amber-300 bg-white" onClick={() => void loadTask({ expectedTaskId: task.task_id })}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {t("重新同步")}
          </Button>
        </div>
      ) : null}
      <div className="rd-horizon-detail-shell">
      <div className="rd-horizon-detail-context">
      {/* ── 顶部：返回 + 标题 + 徽章 ── */}
      <div className="rd-horizon-detail-toolbar flex shrink-0 flex-wrap items-center gap-3">
        <div className="rd-horizon-detail-orientation">
        {/* 采购关联保留工作台来源；其他入口直接回驾驶舱，不逐条回退任务序列。 */}
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(detailReturnPath)} className="rd-horizon-detail-nav-control gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t(procurementReturnPath ? "返回采购工作台" : "返回")}
        </Button>
        {/* 序列导航：按驾驶舱同口径顺序穿行任务（j/k 快捷键同效） */}
        {seqIndex >= 0 && taskSeq.length > 1 && (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => gotoSeq(-1)}
              disabled={taskNavigationLocked || seqIndex <= 0}
              title={t("上一条任务（k）")}
              aria-label={t("上一条任务（k）")}
              className="rd-horizon-detail-nav-control h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 text-xs tabular-nums text-slate-400">{seqIndex + 1} / {taskSeq.length}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => gotoSeq(1)}
              disabled={taskNavigationLocked || seqIndex >= taskSeq.length - 1}
              title={t("下一条任务（j）")}
              aria-label={t("下一条任务（j）")}
              className="rd-horizon-detail-nav-control h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
        <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
        {taskReadOnly && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
            <Lock className="h-3.5 w-3.5" />
            {t("研发同步 · 完全只读")}
          </span>
        )}
        </div>
        <div className="rd-horizon-detail-heading flex min-w-0 flex-1 items-center gap-1.5">
          <h2 className="rd-horizon-detail-title min-w-0 flex-1 text-balance break-words text-lg font-bold leading-snug text-slate-900 sm:text-xl">
            <AutoTranslatedText text={task.title} />
          </h2>
          {canManage && !task.archived && (
            <button
              type="button"
              onClick={() => setShowEditInfo(true)}
              title={t("编辑标题与描述")}
              aria-label={t("编辑标题与描述")}
              className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="rd-horizon-detail-state">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", sCfg.bg, sCfg.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
          {t(sCfg.label)}
        </span>
        {!researchWorkspace && taskSyncAction}
        {canManage && !task.archived && task.status !== "completed" ? (
          <Select value={task.final_priority} disabled={savingPriority} onValueChange={(value) => void savePriority(value as RdPriority)}>
            <SelectTrigger
              className={cn(
                // 与旁边的状态胶囊完全同构：覆盖 shadcn 默认的 h-9/px-3/text-sm/size-4 箭头
                "w-auto shrink-0 gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-none",
                "min-h-0 data-[size=default]:h-auto data-[size=sm]:h-auto [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-current",
                pCfg.bg,
                pCfg.text,
              )}
              title={lang === "en" ? "Change task priority" : "调整任务优先级"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rd-horizon-detail-select rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <SelectItem value="high">{t("高优先")}</SelectItem>
              <SelectItem value="medium">{t("中优先")}</SelectItem>
              <SelectItem value="low">{t("低优先")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", pCfg.bg, pCfg.text)}>
            {t(`${pCfg.label}优先`)}
          </span>
        )}
        {!researchWorkspace && taskWorkflowActions}
        </div>
      </div>

      {/* 详情总览：与标题共用一个 Horizon 上下文表面。 */}
      <section className="rd-horizon-detail-overview material-card overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rd-horizon-detail-description min-w-0 px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <FileText className="h-3.5 w-3.5 text-[#002fa7]" />
                {t("任务描述")}
              </span>
              {canManage && !task.archived && !editingDescription && (
                <button
                  type="button"
                  onClick={startDescriptionEdit}
                  aria-label={t("编辑任务描述")}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#002fa7] transition-colors hover:bg-[#eef3ff]"
                >
                  <Pencil className="h-3 w-3" />
                  {t("编辑")}
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className="space-y-2">
                <Textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelDescriptionEdit();
                    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void saveDescription();
                    }
                  }}
                  rows={4}
                  autoFocus
                  disabled={descriptionSaving}
                  placeholder={t("补充任务背景、目标与交付要求…")}
                  aria-label={t("任务描述")}
                  className="cockpit-scroll min-h-24 w-full resize-y rounded-lg border-slate-200 text-sm leading-6"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">{t("Ctrl+Enter 保存，Esc 取消")}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={descriptionSaving}
                      onClick={cancelDescriptionEdit}
                      className="h-8 px-3 text-xs"
                    >
                      {t("取消")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={descriptionSaving}
                      onClick={() => void saveDescription()}
                      className="h-8 gap-1.5 bg-[#002fa7] px-3 text-xs text-white hover:bg-[#002581]"
                    >
                      {descriptionSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {t("保存")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : task.description ? (
              <AutoTranslatedText
                as="p"
                text={task.description}
                className="cockpit-scroll max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-pretty text-sm leading-6 text-slate-700"
              />
            ) : (
              <p className="text-sm text-slate-400">{t("暂未填写任务描述")}</p>
            )}
          </div>
          <div className="rd-horizon-detail-topic border-t border-slate-100 bg-slate-50/55 px-5 py-4 lg:border-l lg:border-t-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <Layers3 className="h-3.5 w-3.5 text-[#002fa7]" />
                {t("主题归属")}
              </span>
              {canManage && !task.archived && (
                <button
                  type="button"
                  onClick={() => void openMoveDialog()}
                  className="cursor-pointer text-xs font-semibold text-[#002fa7] hover:underline"
                >
                  {t("移动")}
                </button>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-[#002fa7]/15 bg-[#eef3ff] px-2 py-1 text-xs font-semibold text-[#002fa7]">
                  {componentLabel}
                </span>
                {topicLabel !== componentLabel && (
                  <span className="min-w-0 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                    {topicLabel}
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-400" title={task.category_path || undefined}>
                {task.category_path || t("暂未设置分类路径")}
              </p>
            </div>
          </div>
        </div>
      </section>
      <dl
        aria-label={t("任务事实摘要")}
        className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3 lg:grid-cols-5"
      >
        {[
          { label: t("完成进度"), value: `${task.progress}%`, detail: t(sCfg.label) },
          ...(!researchWorkspace ? [{ label: t("主责人"), value: displayPersonName(task.primary_owner), detail: t("当前责任范围") }] : []),
          { label: t("截止与风险"), value: task.due_date || t("未设置"), detail: riskLabel },
          ...(productionWorkspace ? [{
            label: t("工作项"),
            value: `${detailFacts.completedWorkItemCount}/${detailFacts.workItemCount}`,
            detail: t("已完成 / 全部"),
          }] : []),
          {
            label: t("事实留痕"),
            value: t("{notes} 条 · {files} 个附件", { notes: detailFacts.noteCount, files: detailFacts.attachmentCount }),
            detail: notesError ? t("读取异常") : t("包含合并任务范围"),
          },
        ].map((fact) => (
          <div key={fact.label} className="min-w-0 border-b border-r border-slate-100 px-3 py-2.5 last:border-r-0 sm:px-4">
            <dt className="truncate text-[11px] font-medium text-slate-500">{fact.label}</dt>
            <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-slate-800" title={String(fact.value)}>{fact.value}</dd>
            <dd className="mt-0.5 truncate text-[10px] text-slate-400">{fact.detail}</dd>
          </div>
        ))}
      </dl>
      </div>

      {/* 研发：左侧资料与留痕，右侧任务操作及属性；窄屏按操作、资料、属性阅读。 */}
      <div className="rd-horizon-detail-grid grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {researchWorkspace && (
          <Collapsible defaultOpen className="rd-reference-action-panel" asChild>
            <section aria-label={t("任务操作")}>
              <h3>
                <CollapsibleTrigger className="group flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {t("任务操作")}
                  <ChevronDown className="size-4 text-slate-400 group-data-[state=closed]:-rotate-90" aria-hidden="true" />
                </CollapsibleTrigger>
              </h3>
              <CollapsibleContent className="rd-reference-action-content space-y-3 px-4 pb-4">
                {taskWorkflowActions}
                {taskRelatedActions}
                {procTask && (
                  <div className="rd-reference-procurement-link space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium tabular-nums text-slate-500">{procTask.code}</p>
                    <div className="rd-reference-procurement-controls grid grid-cols-2 gap-2">
                      {!task.archived && !taskReadOnly && (
                        <div className="rd-reference-procurement-status flex min-w-0 items-center">
                          <ProcurementLinkChip
                            task={procTask}
                            onJump={(procTaskId) => navigate(`/proc-cockpit?task=${encodeURIComponent(procTaskId)}`)}
                          />
                        </div>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={() => setTab("procurement")} className="min-h-10 gap-1 px-2 text-xs">
                        {t("采购与样品")}<ChevronRight className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
                {taskSyncAction}
              </CollapsibleContent>
            </section>
          </Collapsible>
        )}
        <DetailGridOrder productionWorkspace={productionWorkspace}>
        {/* ══ 右侧 Properties 栏（单一面板，分节细线分隔；随页面自然滚动）══ */}
        <div key="properties" className="rd-horizon-detail-aside cockpit-scroll min-h-0 xl:order-2 xl:overflow-y-auto">
        <div className="rd-horizon-detail-properties material-card divide-y divide-slate-100">
          {researchWorkspace && taskPeopleSection}
          {/* 字段节 */}
          <div className="space-y-2.5 px-4 py-3.5">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <Layers3 className="h-3.5 w-3.5 text-[#002fa7]" />
              {t("任务信息")}
            </div>
            {[
              { label: t("完成进度"), value: (
                <span className="flex items-center justify-end gap-2">
                  <Progress value={task.progress} className="h-1.5 w-24" />
                  <span className="tabular-nums">{task.progress}%</span>
                </span>
              ) },
              { label: t("风险状态"), value: (
                <span className={cn(
                  "inline-flex items-center justify-end gap-1 font-semibold",
                  task.status === "paused_blocked" || overdue ? "text-red-600" : "text-emerald-600",
                )}>
                  {task.status === "paused_blocked" || overdue
                    ? <AlertTriangle className="h-3.5 w-3.5" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {riskLabel}
                </span>
              ) },
              { label: t("优先级"), value: <span className={cn("font-semibold", task.final_priority === "high" ? "text-red-600" : pCfg.text)}>{t(`${pCfg.label}优先`)}</span> },
              { label: t("任务状态"), value: (
                <span className={cn("inline-flex items-center justify-end gap-1.5 font-semibold", sCfg.text)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
                  {t(sCfg.label)}
                </span>
              ) },
              { label: t("任务编号"), value: <span className="font-mono text-xs">{task.task_id}</span> },
              { label: t("开始日期"), value: task.start_date || "—" },
              { label: t("截止日期"), value: (
                <span className="inline-flex items-center justify-end gap-1">
                  <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
                  {task.due_date || "—"}
                </span>
              ) },
              { label: t("组件"), value: componentLabel },
            ].filter((row) => !researchWorkspace || ![t("完成进度"), t("风险状态"), t("任务编号"), t("截止日期"), t("组件")].includes(row.label)).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs text-slate-400">{row.label}</span>
                <span className="min-w-0 flex-1 truncate text-right font-medium tabular-nums text-slate-700">{row.value}</span>
              </div>
            ))}
            {/* 任务类型 = category_path 第三段，即驾驶舱卡片上那个 tag。AI 判断不准时在这里纠正。
                原先这里是只读的「主题」行，值完全相同，故改造为可编辑而不是另加一行。 */}
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="shrink-0 text-xs text-slate-400">{t("任务类型")}</span>
              {canManage && !task.archived ? (
                customTaskType !== null ? (
                  <Input
                    autoFocus
                    value={customTaskType}
                    disabled={savingTaskType}
                    placeholder={t("输入任务类型")}
                    onChange={(e) => setCustomTaskType(e.target.value)}
                    onBlur={() => void saveTaskType(customTaskType)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void saveTaskType(customTaskType); }
                      else if (e.key === "Escape") { e.preventDefault(); setCustomTaskType(null); }
                    }}
                    className="h-7 min-w-0 flex-1 text-right text-sm"
                  />
                ) : (
                  <Select
                    value={currentTaskType || undefined}
                    disabled={savingTaskType}
                    onValueChange={(value) => {
                      if (value === CUSTOM_TASK_TYPE_OPTION) setCustomTaskType(currentTaskType);
                      else void saveTaskType(value);
                    }}
                  >
                    <SelectTrigger className="h-7 w-auto max-w-full gap-1 border-slate-200 px-2 text-sm font-medium text-slate-700">
                      <SelectValue placeholder={t("待归类任务")} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* 当前值可能是清单外的自定义值或历史默认值（如「研发任务」），必须并入选项，否则 Select 显示为空 */}
                      {Array.from(new Set([currentTaskType, ...RD_TASK_TYPE_PRESETS])).filter(Boolean).map((option) => (
                        <SelectItem key={option} value={option}>{t(option)}</SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_TASK_TYPE_OPTION}>{t("自定义…")}</SelectItem>
                    </SelectContent>
                  </Select>
                )
              ) : (
                <span className="min-w-0 flex-1 truncate text-right font-medium text-slate-700">{topicLabel}</span>
              )}
            </div>
          </div>

          {/* 阻塞提示节 */}
          {task.status === "paused_blocked" && (
            <div className="flex items-start gap-2 bg-red-50/70 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="text-sm text-red-700">
                <span className="font-semibold">{t("任务阻塞中")}{blockedDays != null ? t("，已阻塞 {n} 天", { n: blockedDays }) : ""}</span>
                {blockedDays != null && blockedDays >= 3 && <div className="mt-0.5 text-xs">{t("建议尽快协调对方团队解除依赖。")}</div>}
              </div>
            </div>
          )}

          {/* 中间层任务可同时显示直接父任务和直接子任务，并继续向下扩展关系树。 */}
          {parentTask && (
            <div className="rd-horizon-detail-parent-task bg-sky-50/60 px-4 py-3.5">
              <div className="mb-2 flex items-center gap-1.5">
                <SubtaskBadge task={task} />
                <span className="text-xs font-semibold text-slate-500">{t("所属父任务")}</span>
              </div>
              <button
                type="button"
                onClick={() => navigate(taskDetailPath(parentTask.task_id), { state: procurementReturnState })}
                className="rd-horizon-detail-parent-task__link flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50/60"
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                  <AutoTranslatedText text={parentTask.title} />
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{parentTask.task_id}</span>
              </button>
              {task.subtask_origin === "attached" && task.subtask_attached_at && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {t("由独立任务并入")}
                  {task.subtask_attached_by ? t("，操作人 {name}", { name: task.subtask_attached_by }) : ""}
                  {t("（{time}）", { time: formatTraceDateTime(task.subtask_attached_at) })}
                </p>
              )}
              {canManage && !task.archived && (
                <button
                  type="button"
                  disabled={detaching}
                  onClick={() => void handleDetachSubtask()}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  {detaching ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  {t("取消子任务关系（提升为独立任务）")}
                </button>
              )}
            </div>
          )}
          <div className={cn("px-4 py-3.5", parentTask && "border-t border-slate-100")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {t("子任务")}
                  {subtasks.length > 0 && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">
                      {subtasks.length}
                    </span>
                  )}
                </span>
                {canManage && !task.archived && (
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setShowCreateSubtask(true)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#002fa7] hover:bg-[#eef3ff]"
                    >
                      {t("新建")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAttachSubtasks(true)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 hover:bg-amber-50"
                    >
                      {t("并入已有任务")}
                    </button>
                    {subtasks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowDetachSubtasks(true)}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      >
                        {t("批量取消")}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {subtasks.length === 0 ? (
                <p className="text-xs text-slate-400">{t("暂无子任务")}</p>
              ) : (
                <>
                  {/* 进度汇总：子任务完成数 + 平均进度 */}
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      {t("已完成 {done}/{total}", {
                        done: subtasks.filter((s) => s.status === "completed").length,
                        total: subtasks.length,
                      })}
                    </span>
                    <Progress
                      value={Math.round(subtasks.reduce((sum, s) => sum + s.progress, 0) / subtasks.length)}
                      className="h-1.5 flex-1"
                    />
                    <span className="tabular-nums">
                      {Math.round(subtasks.reduce((sum, s) => sum + s.progress, 0) / subtasks.length)}%
                    </span>
                  </div>
                  <div className="cockpit-scroll max-h-72 space-y-1 overflow-y-auto pr-1">
                    {subtasks.map((sub) => {
                      const subCfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.in_progress;
                      return (
                        <button
                          key={sub.task_id}
                          type="button"
                          onClick={() => navigate(taskDetailPath(sub.task_id), { state: procurementReturnState })}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-left transition-colors hover:border-[#002fa7]/20 hover:bg-[#eef3ff]"
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", subCfg.dot)} />
                          <SubtaskBadge task={sub} />
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                            <AutoTranslatedText text={sub.title} />
                          </span>
                          {(sub.subtasks?.length ?? 0) > 0 ? (
                            <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                              {t("{n} 个下级", { n: sub.subtasks!.length })}
                            </span>
                          ) : null}
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{sub.progress}%</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
          </div>

          {!researchWorkspace && taskPeopleSection}
          {!researchWorkspace && taskRelatedActions}
          {researchWorkspace && (
            <div className="px-4 py-3.5">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">{t("MateChat 任务助手")}</h3>
              {taskAssistantActions}
            </div>
          )}
        </div>
        </div>

        {/* ══ 主内容列（左）：纵向过程叙事——Tab 卡吃掉剩余高度，内容内滚 ══ */}
        <div key="workspace" className="rd-horizon-detail-main flex min-h-0 min-w-0 flex-col gap-4 xl:order-1">
          {/* 工作项（只读展示）：创建/勾选/删除入口在个人工作台，成员按需自建 */}
          <div className="rd-horizon-detail-work-items shrink-0">
            <WorkItemsSection
              task={task}
              canEdit={false}
              noteCountByItem={noteCountByItem}
              onTaskPatched={(_, patch) => setTask((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
          </div>

          {/* 完成质量评分（研发侧特有）：可收起 + 限高内滚。容器允许被 flex 压缩
              （非 shrink-0），主列空间不足时评分区自动让位给下方 Tab 区，整页不出滚动条。
              评分卡组件与驾驶舱抽屉共享，此处只做外层容器，不改其内部。 */}
          {task.status === "completed" && (
            <div
              className={cn(
                "rd-horizon-detail-score flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-slate-200 bg-white",
                scoreOpen ? "max-h-[260px]" : "shrink-0",
              )}
            >
              <button
                type="button"
                onClick={() => setScoreOpen((v) => !v)}
                className="flex w-full shrink-0 cursor-pointer items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50/70"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Sparkles className="h-3.5 w-3.5 text-[#002fa7]" />
                  {t("完成质量评分")}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  {scoreOpen ? t("收起") : t("展开")}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", scoreOpen && "rotate-180")} />
                </span>
              </button>
              {scoreOpen && (
                <div className="cockpit-scroll min-h-0 flex-1 overflow-y-auto border-t border-slate-100 p-2">
                  <TaskCompletionScoreCard
                    task={task}
                    notes={notes}
                    loading={notesLoading}
                    canView={canManage || isParticipant || (!productionWorkspace && canReadAllRdTasks)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab：筛选条、留痕列表和卡片内留言共存时仍为列表保留可视区域；内容区各自内滚。 */}
          <div className={cn("rd-horizon-detail-activity material-card flex min-h-0 flex-1 flex-col overflow-hidden p-0 lg:min-h-[440px]", researchWorkspace && tab === "attachments" && "rd-reference-document-workspace")}>
            <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="rd-horizon-detail-tabs cockpit-scroll h-auto w-full shrink-0 justify-start gap-3 overflow-x-auto rounded-none border-b border-slate-200/80 bg-transparent p-0 px-3 sm:gap-5 sm:px-4">
                {([
                  ...(researchWorkspace ? [{ key: "attachments" as const, label: t("技术资料"), count: null }] : []),
                  { key: "notes", label: t("进展留痕"), count: activityGroupNotes.length },
                  { key: "conversation", label: t(researchWorkspace ? "讨论" : "任务讨论"), count: discussionUnread },
                  { key: "audit", label: t("操作记录"), count: timelineLogs.length },
                  ...(!researchWorkspace ? [{ key: "attachments" as const, label: t("附件库"), count: null }] : []),
                  { key: "relations", label: t("合并关系"), count: Math.max(0, relationNodeCount - 1) },
                  ...(procTask ? [{ key: "procurement" as const, label: productionWorkspace ? t("采购动态") : t("采购与样品"), count: researchWorkspace ? null : procTask.logs.length }] : []),
                ] as const).map((tabItem) => (
                  <TabsTrigger
                    key={tabItem.key}
                    value={tabItem.key}
                    className="-mb-px flex-none cursor-pointer gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-3 pt-3.5 text-sm font-medium text-slate-500 shadow-none transition-colors hover:text-slate-800 data-[state=active]:border-[#002fa7] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-[#002fa7] data-[state=active]:shadow-none"
                  >
                    {tabItem.key === "conversation" && <MessageCircleMore className="h-3.5 w-3.5 text-[#002fa7]" />}
                    {tabItem.key === "relations" && <GitBranch className="h-3.5 w-3.5 text-[#002fa7]" />}
                    {tabItem.key === "procurement" && <ShoppingCart className="h-3.5 w-3.5 text-[#002fa7]" />}
                    {tabItem.label}
                    {tabItem.count != null && tabItem.count > 0 && (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                        tabItem.key === "conversation" ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-500",
                      )}>{tabItem.count}</span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(tab === "notes" || tab === "audit") && visibleActivityActor ? (
                <div className="rd-horizon-detail-actor-filter flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-3" role="group" aria-label={t("当前人员筛选")}>
                  <p className="min-w-0 text-pretty break-words text-xs text-muted-foreground">
                    {activityActor ? <Lock className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden="true" /> : null}
                    {t("仅查看 {name} 的留痕与操作记录", { name: visibleActivityActor.name || t("所选人员") })}
                  </p>
                  {canClearActivityActor ? (
                    <button type="button" onClick={clearActivityActor} className="rd-horizon-detail-filter-clear inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary/10">
                      <X className="size-3.5" aria-hidden="true" />
                      {t("清除人员筛选")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <TabsContent value="notes" className="min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=active]:flex">
                {progressGroupTasks.length > 1 && (
                  <ActivityTaskFilterBar
                    value={noteTaskFilter}
                    currentTaskId={taskId}
                    tasks={progressGroupTasks}
                    countByTask={activityNoteCountByTask}
                    totalCount={activityGroupNotes.length}
                    onChange={changeNoteTaskFilter}
                    summary={t("共 {notes} 条，来自 {tasks} 个任务", {
                      notes: filteredGroupNotes.length,
                      tasks: filteredGroupTaskCount,
                    })}
                  />
                )}
                {notesFilteredEmpty ? (
                  <div className="rd-horizon-detail-filter-empty flex min-h-64 flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center" role="status">
                    <p className="text-balance text-sm font-semibold text-foreground">{t("当前筛选下没有进度留痕")}</p>
                    <p className="max-w-md text-pretty text-xs leading-5 text-muted-foreground">
                      {canClearActivityActor
                        ? t("清除人员筛选，查看当前任务范围内的其他记录。")
                        : noteTaskFilter !== "all"
                          ? t("切换到全部任务，查看当前人员范围内的其他记录。")
                          : t("该人员在当前任务范围内还没有进度留痕。")}
                    </p>
                    {canClearActivityActor ? (
                      <Button type="button" variant="outline" size="sm" onClick={clearActivityActor} className="rd-horizon-detail-filter-clear mt-2 min-h-10 text-primary">{t("清除人员筛选")}</Button>
                    ) : noteTaskFilter !== "all" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => changeNoteTaskFilter("all")} className="rd-horizon-detail-filter-clear mt-2 min-h-10 text-primary">{t("查看全部任务留痕")}</Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => navigate(detailReturnPath)} className="mt-2 min-h-10">{t(procurementReturnPath ? "返回采购工作台" : "返回驾驶舱")}</Button>
                    )}
                  </div>
                ) : null}
                <RDTaskConversation
                  key={`progress-${taskId}`}
                  taskId={taskId}
                  taskTitle={task.title}
                  notes={filteredGroupNotes}
                  mode="progress"
                  variant="desktop"
                  notesLoading={notesLoading}
                  notesError={notesError}
                  onRetryNotes={() => void loadProgressGroup()}
                  showHeader={false}
                  threadLayout="replace"
                  progressPresentation="timeline"
                  onUnreadChange={setDiscussionUnread}
                  onOpenSourceTask={(sourceTaskId) => {
                    if (sourceTaskId !== taskId) navigate(taskDetailPath(sourceTaskId), { state: procurementReturnState });
                  }}
                  selectedActor={canSelectActivityActor ? selectedActivityActor : null}
                  onActorClick={canSelectActivityActor ? toggleActivityActor : undefined}
                  onThreadOpenChange={setProgressThreadOpen}
                  className={cn("rd-horizon-detail-conversation rd-horizon-detail-conversation--timeline", notesFilteredEmpty && "hidden")}
                />
              </TabsContent>

              <TabsContent value="conversation" className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex">
                <RDTaskConversation
                  key={`conversation-${taskId}`}
                  taskId={taskId}
                  taskTitle={task.title}
                  notes={notes}
                  mode="task"
                  variant="desktop"
                  showHeader={false}
                  threadLayout="replace"
                  onUnreadChange={setDiscussionUnread}
                  className="rd-horizon-detail-conversation rd-horizon-detail-conversation--discussion"
                />
              </TabsContent>

              <TabsContent value="attachments" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
              {notesLoading && groupNotes.length === 0 ? (
                <div className="space-y-3" role="status" aria-label={t("正在加载附件库")}>
                  <div className="h-28 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
                  <div className="h-12 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
                  <span className="sr-only">{t("正在加载附件库")}</span>
                </div>
              ) : notesError ? (
                <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center" role="alert">
                  <AlertTriangle className="size-7 text-amber-500" aria-hidden="true" />
                  <h3 className="mt-3 text-balance text-sm font-semibold text-slate-800">{t("附件库暂不可用")}</h3>
                  <p className="mt-1 max-w-md text-pretty text-xs leading-5 text-slate-500">{notesError}</p>
                  <Button type="button" size="sm" onClick={() => void loadProgressGroup()} className="mt-3 bg-[#002fa7] text-white hover:bg-[#002581]">
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    {t("重新加载")}
                  </Button>
                </div>
              ) : (
              <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="space-y-3">
                {researchWorkspace && !taskReadOnly && <TechnicalDocumentsPanel key={taskId} taskId={taskId} notes={notes} onPreview={setPreviewAttachment} onNotesChanged={() => { void loadProgressGroup(); }} />}
                {(!researchWorkspace || groupNotes.some((note) => note.attachments.length > 0)) && <details className={researchWorkspace ? "rd-reference-original-files rounded-lg border border-slate-200 p-3" : undefined} open={!researchWorkspace || undefined}>
                  <summary className={researchWorkspace ? "cursor-pointer text-sm font-medium text-slate-600" : "hidden"}>{t("原始与合并任务附件")}</summary>
                  <div className={researchWorkspace ? "mt-3 space-y-3" : "space-y-3"}>
                <TaskImageGallery notes={groupNotes} />
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-500">{t("文档附件（{n}）", { n: docAttachments.length })}</div>
                  {docAttachments.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">{t("暂无文档附件")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-100 hover:bg-transparent">
                            <TableHead className="text-xs text-slate-400">{t("文件名")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("来源任务")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("大小")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传时间")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("上传人")}</TableHead>
                            <TableHead className="text-xs text-slate-400">{t("操作")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {docAttachments.map(({ att, createdAt, actor, sourceTaskId, sourceTaskTitle }) => (
                            <TableRow key={att.id} className="border-slate-50 hover:bg-slate-50/60">
                              <TableCell className="max-w-[320px]">
                                {/* 文件名即预览入口：PDF / 文本 / 表格走内嵌预览，与留痕里的附件磁贴同一个弹窗 */}
                                <button
                                  type="button"
                                  onClick={() => setPreviewAttachment(att)}
                                  title={att.name}
                                  className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-left transition hover:text-[#002fa7]"
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0 truncate text-sm text-slate-700">{att.name}</span>
                                </button>
                              </TableCell>
                              <TableCell className="max-w-[200px]">
                                {sourceTaskId && sourceTaskId !== taskId ? (
                                  <button
                                    type="button"
                                    onClick={() => navigate(taskDetailPath(sourceTaskId), { state: procurementReturnState })}
                                    title={sourceTaskTitle || sourceTaskId}
                                    className="min-w-0 max-w-full cursor-pointer truncate text-xs font-medium text-[#002fa7] hover:text-[#002581]"
                                  >
                                    {sourceTaskTitle || sourceTaskId}
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">{t("本任务")}</span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatRdFileSize(att.size)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatTraceDateTime(createdAt)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">{actor || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <a
                                  href={getAttachmentDownloadUrl(att)}
                                  download={att.name}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#002fa7] hover:text-[#002581]"
                                >
                                  <Download className="h-3 w-3" />
                                  {t("下载")}
                                </a>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
                  </div>
                </details>}
              </motion.div>
              )}
              </TabsContent>

              <TabsContent value="relations" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
                {relationRoot && relationNodeCount > 1 ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-balance text-sm font-semibold text-slate-800">{t("合并层级")}</h3>
                      <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-500">
                        {t("任务并入后会永久保留原有上下级结构。点击任意节点可跳转到对应任务详情。")}
                      </p>
                    </div>
                    <TaskRelationTree
                      root={relationRoot}
                      currentTaskId={taskId}
                      onOpen={openRelationTask}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
                    <GitBranch className="size-7 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">{t("暂无合并关系")}</p>
                    <p className="text-pretty text-xs text-slate-400">{t("并入已有任务后，层级关系会显示在这里。")}</p>
                  </div>
                )}
              </TabsContent>

              {procTask && (
                <TabsContent value="procurement" className="cockpit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
                  <div>
                    <ProcurementActivitySection task={procTask} />
                  </div>
                </TabsContent>
              )}

              <TabsContent value="audit" className="min-h-0 min-w-0 flex-1 flex-col overflow-hidden data-[state=active]:flex">
              {progressGroupTasks.length > 1 && (
                <ActivityTaskFilterBar
                  value={auditTaskFilter}
                  currentTaskId={taskId}
                  tasks={progressGroupTasks}
                  countByTask={timelineLogCountByTask}
                  totalCount={timelineLogs.length}
                  onChange={setAuditTaskFilter}
                />
              )}
              <div className="cockpit-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
                {/* 完整时间线：操作动作 + 进展留痕合成，进展条目下挂附件缩略图（与抽屉口径一致） */}
                <AuditTimeline
                  logs={filteredTimelineLogs}
                  showResource={auditTaskFilter === "all" && progressGroupTasks.length > 1}
                  emptyText={visibleActivityActor || auditTaskFilter !== "all" ? t("当前筛选下没有操作记录") : t("暂无操作记录")}
                  canAddNote={canManage}
                  onAddNote={async (logId, text) => {
                    await addAuditLogNote(logId, { text });
                  }}
                  notePlaceholder={t("填写备注（最多 200 字），仅主管可添加…")}
                  selectedActor={canSelectActivityActor ? selectedActivityActor : null}
                  onActorClick={canSelectActivityActor ? toggleActivityActor : undefined}
                  renderExtra={(log) => {
                    const note = reportNoteOf(log.id);
                    if (!note || note.attachments.length === 0) return null;
                    return <ProgressAttachmentGrid attachments={note.attachments} compact imageDisplay="clipped-cards" />;
                  }}
                />
              </div>
              </TabsContent>
            </Tabs>
          </div>
          {researchWorkspace && latestProgressNote && !notesError && (
            <section className="rd-reference-latest shrink-0 rounded-xl border border-border bg-card px-4 py-3" aria-label={t("最新进展依据")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("最新进展依据")}</h3>
                <button type="button" onClick={() => setTab("notes")} className="min-h-9 text-xs font-medium text-primary hover:underline">{t("查看进展留痕")}</button>
              </div>
              <p className="line-clamp-2 break-words text-sm leading-6 text-foreground">{notesError ? t("进展暂不可用，请重新加载") : latestProgressNote?.text || (notesLoading ? t("正在加载进展…") : t("暂无进展记录"))}</p>
              {!notesError && latestProgressNote && <p className="mt-1 text-xs text-muted-foreground">{latestProgressNote.actor.name} · {formatTraceDateTime(latestProgressNote.created_at)} · {t("{n} 个附件", { n: latestProgressNote.attachments.length })}</p>}
            </section>
          )}

        </div>
        </DetailGridOrder>
      </div>
      </div>

      {/* ── 管理弹窗 ── */}
      {showEditInfo && (
        <EditTaskInfoDialog
          initialTitle={task.title}
          initialDescription={task.description ?? ""}
          onConfirm={handleEditInfo}
          onCancel={() => setShowEditInfo(false)}
        />
      )}
      {showHandover && (
        <HandoverDialog
          taskId={task.task_id}
          taskTitle={task.title}
          currentOwner={task.primary_owner}
          people={people}
          horizonVariant
          onConfirm={handleHandover}
          onCancel={() => setShowHandover(false)}
        />
      )}
      {showAddCollab && (
        <AddCollaboratorsDialog
          taskTitle={task.title}
          currentOwner={task.primary_owner}
          existingCollaborators={task.collaborators ?? []}
          people={people}
          onConfirm={handleAddCollaborators}
          onCancel={() => setShowAddCollab(false)}
        />
      )}
      {showComplete && (
        <CompleteConfirmDialog
          taskTitle={task.title}
          submitting={submitting}
          onConfirm={() => void handleDirectComplete()}
          onCancel={() => setShowComplete(false)}
        />
      )}
      {showSubmitConfirm && (
        <SubmitConfirmDialog
          taskTitle={task.title}
          submitting={submitting}
          onConfirm={() => void handleSubmitForReview()}
          onCancel={() => setShowSubmitConfirm(false)}
        />
      )}
      {showMove && (
        <MoveTaskDialog
          key={`move-task-${task.task_id}`}
          task={task}
          categories={categories}
          products={products}
          onConfirm={handleMoveConfirm}
          onClose={() => setShowMove(false)}
        />
      )}
      {transferOpen && (
        <TransferToProcurementModal
          key={`transfer-procurement-${task.task_id}`}
          taskId={task.task_id}
          taskTitle={task.title}
          owner={task.primary_owner}
          ownerUserId={task.primary_owner_user_id ?? undefined}
          priority={task.final_priority}
          dueDate={task.due_date}
          attachments={transferAttachments}
          resubmitFrom={procTaskBlocksTransfer ? null : procTask}
          blockingTask={procTaskBlocksTransfer ? procTask : null}
          onTransferred={(nextProcTask) => {
            if (activeTaskIdRef.current !== task.task_id) return;
            setProcTask(nextProcTask);
          }}
          onClose={() => {
            if (activeTaskIdRef.current !== task.task_id) return;
            setTransferOpen(false);
          }}
        />
      )}
      {showApproval && (
        <ApprovalActionDialog
          mode={showApproval}
          task={task}
          submitting={submitting}
          onConfirm={handleApproval}
          onCancel={() => setShowApproval(null)}
        />
      )}
      {showCreateSubtask && (
        <CreateSubtaskDialog
          parentTask={task}
          people={people}
          horizonVariant
          onConfirm={handleCreateSubtask}
          onCancel={() => setShowCreateSubtask(false)}
        />
      )}
      {showAttachSubtasks && (
        <AttachSubtasksDialog
          parentTask={task}
          candidates={attachCandidates}
          onConfirm={handleAttachSubtasks}
          onCancel={() => setShowAttachSubtasks(false)}
        />
      )}
      {showDetachSubtasks && (
        <DetachSubtasksDialog
          parentTask={task}
          candidates={subtasks}
          onConfirm={handleDetachSubtasks}
          onCancel={() => setShowDetachSubtasks(false)}
        />
      )}

      {/* 人员名下任务弹层（Radix Dialog）：点任务跳转到该任务的详情页 */}
      <Dialog open={Boolean(personTasksFor)} onOpenChange={(open) => { if (!open) setPersonTasksFor(null); }}>
        <DialogContent className="rd-horizon-detail-dialog rounded-2xl border-slate-200 bg-white p-5 shadow-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {personTasksFor && <OwnerAvatar name={personTasksFor} size="sm" />}
              <span>
                {personTasksFor}
                <span className="ml-2 text-[11px] font-normal text-slate-400">名下活跃任务 {tasksOfPerson.length} 条</span>
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="cockpit-scroll max-h-[50vh] space-y-1.5 overflow-y-auto">
            {tasksOfPerson.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">暂无活跃任务</p>
            ) : (
              tasksOfPerson.map((t) => {
                const tCfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.in_progress;
                return (
                  <button
                    key={t.task_id}
                    type="button"
                    onClick={() => {
                      setPersonTasksFor(null);
                      if (t.task_id !== taskId) navigate(taskDetailPath(t.task_id), { state: procurementReturnState });
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 text-left transition-colors hover:border-[#002fa7]/20 hover:bg-[#eef3ff]"
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tCfg.dot)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.title}</span>
                    <span className={cn("shrink-0 text-[11px] font-medium", tCfg.text)}>{tCfg.label}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{t.progress}%</span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
      </motion.div>
      {previewAttachment && (
        <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </TaskImageGalleryScope>
  );
}

/** 编辑任务标题/描述（主管）：与移交/协作人弹窗同风格的轻量弹窗 */
function EditTaskInfoDialog({
  initialTitle,
  initialDescription,
  onConfirm,
  onCancel,
}: {
  initialTitle: string;
  initialDescription: string;
  onConfirm: (title: string, description: string) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSubmitError("");
    setSaving(true);
    try {
      await onConfirm(title, description);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("保存失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog max-h-[90dvh] gap-0 overflow-y-auto rounded-xl border-slate-200 bg-white p-0 sm:max-w-md"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-6 py-4 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Pencil className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("编辑任务信息")}</DialogTitle>
            <DialogDescription className="mt-1 text-pretty text-xs text-slate-500">{t("修改标题与描述后将同步记录到任务事实链路。")}</DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务标题")} <span className="text-red-500">*</span></label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务描述")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={t("补充任务背景、目标与交付要求…")}
              className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
            />
          </div>
        </div>
        {submitError ? <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
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
            disabled={saving || !title.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#002581] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {saving ? t("保存中…") : t("保存任务信息")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 在父任务下直建子任务。分类/产品库继承父任务，故无需选类目；
 * 状态直接给 in_progress（管理员在详情页操作，按约定不走立项审批）。
 */
function CreateSubtaskDialog({
  parentTask,
  people,
  horizonVariant = false,
  onConfirm,
  onCancel,
}: {
  parentTask: RdTask;
  people: PersonProfile[];
  horizonVariant?: boolean;
  onConfirm: (input: {
    title: string;
    primary_owner: string;
    primary_owner_user_id: string | null;
    due_date: string;
    final_priority: RdPriority;
    description: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState(parentTask.primary_owner ?? "");
  const [dueDate, setDueDate] = useState(parentTask.due_date ?? "");
  const [priority, setPriority] = useState<RdPriority>(parentTask.final_priority ?? "medium");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const activePeople = useMemo(
    () => people.filter((p) => p.status !== "left" && p.status !== "resigned"),
    [people],
  );

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSubmitError("");
    setSaving(true);
    try {
      const picked = activePeople.find((p) => p.name === ownerName);
      await onConfirm({
        title: title.trim(),
        primary_owner: ownerName.trim() || "待指派",
        primary_owner_user_id: picked?.user_id ?? null,
        due_date: dueDate,
        final_priority: priority,
        description: description.trim(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("创建子任务失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog max-h-[90dvh] gap-0 overflow-y-auto rounded-xl border-slate-200 bg-white p-0 sm:max-w-md"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-6 py-4 text-left">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("新建子任务")}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[11px] text-slate-500">
              {t("父任务：{title}", { title: parentTask.title })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              {t("子任务标题")} <span className="text-red-500">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder={t("这个子任务要交付什么…")}
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("主责人")}</label>
              <Select value={ownerName || "待指派"} onValueChange={setOwnerName}>
                <SelectTrigger className="h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={cn(horizonVariant && "rd-horizon-detail-select")}>
                  <SelectItem value="待指派">{t("待指派")}</SelectItem>
                  {activePeople.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {displayPersonName(p.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("优先级")}</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as RdPriority)}>
                <SelectTrigger className="h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={cn(horizonVariant && "rd-horizon-detail-select")}>
                  <SelectItem value="high">{t("高")}</SelectItem>
                  <SelectItem value="medium">{t("中")}</SelectItem>
                  <SelectItem value="low">{t("低")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("截止日期")}</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 rounded-lg border-slate-200 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">{t("任务描述")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t("补充子任务的目标与交付要求…")}
              className="cockpit-scroll w-full resize-none rounded-lg border-slate-200 text-sm"
            />
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-pretty text-[11px] leading-relaxed text-slate-500">
            {t("新建项会直接归属当前任务；若要保留已有的多级任务结构，请使用「并入已有任务」。")}
          </p>
        </div>
        {submitError ? <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
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
            disabled={saving || !title.trim()}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#002581] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            {saving ? t("创建中…") : t("创建子任务")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 把已有的独立任务并入当前任务成为子任务（可多选）。任务本体完整保留，仅改变归属位置。
 * 与「合并申请」不同：这里不归档源任务、不改写描述、不改主责人，也不走审批。
 */
function AttachSubtasksDialog({
  parentTask,
  candidates,
  onConfirm,
  onCancel,
}: {
  parentTask: RdTask;
  candidates: RdTask[];
  onConfirm: (childIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter(
      (c) =>
        c.title.toLowerCase().includes(kw) ||
        c.task_id.toLowerCase().includes(kw) ||
        (c.primary_owner ?? "").toLowerCase().includes(kw),
    );
  }, [candidates, keyword]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (picked.size === 0 || saving) return;
    setSubmitError("");
    setSaving(true);
    try {
      await onConfirm(Array.from(picked));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("并入失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-5 py-4 text-left sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <ChevronRight className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("并入已有任务为子任务")}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[11px] text-slate-500">
              {t("父任务：{title}", { title: parentTask.title })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
            placeholder={t("搜索任务标题 / 编号 / 主责人")}
            className="h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>
        <div className="cockpit-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-3 sm:px-6" role="group" aria-label={t("可并入任务列表")}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-pretty text-sm text-slate-500">{candidates.length === 0 ? t("没有可并入的独立任务") : t("没有匹配的任务")}</p>
              {keyword ? <button type="button" onClick={() => setKeyword("")} className="mt-2 text-xs font-semibold text-[#002fa7] hover:underline">{t("清空搜索")}</button> : null}
            </div>
          ) : (
            filtered.map((c) => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.in_progress;
              const checked = picked.has(c.task_id);
              return (
                <button
                  key={c.task_id}
                  type="button"
                  onClick={() => toggle(c.task_id)}
                  aria-pressed={checked}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    checked
                      ? "border-amber-300 bg-amber-50/70"
                      : "border-slate-100 hover:border-amber-200 hover:bg-amber-50/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked ? "border-amber-500 bg-amber-500 text-white" : "border-slate-300 bg-white",
                    )}
                  >
                    {checked && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} />
                  <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2.5">
                    <span className="block min-w-0 flex-1 truncate text-sm text-slate-700">
                      <AutoTranslatedText text={c.title} />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
                      {(c.subtasks?.length ?? 0) > 0 ? (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                          {t("含 {n} 个下级", { n: countRelationNodes(c) - 1 })}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-slate-400">{displayPersonName(c.primary_owner)}</span>
                      <span className="break-all font-mono text-[11px] text-slate-400">{c.task_id}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          {submitError ? <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
          <p className="mb-2 text-pretty text-[11px] leading-relaxed text-slate-500">
            {t("并入后任务本体及其全部下级层级永久保留，仅整棵任务树的归属发生变化，可随时取消。跨产品库时，整棵任务树会一并迁入当前产品库。")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] tabular-nums text-slate-500">{t("已选 {n} 个", { n: picked.size })}</span>
            <span className="flex justify-end gap-2">
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
                disabled={saving || picked.size === 0}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {saving ? t("并入中…") : t("并入为子任务")}
              </button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 批量解除当前任务与多个直接子任务的关系；每个子任务自带的下级树保持原样。 */
function DetachSubtasksDialog({
  parentTask,
  candidates,
  onConfirm,
  onCancel,
}: {
  parentTask: RdTask;
  candidates: RdTask[];
  onConfirm: (childIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  useI18n();
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.title.toLowerCase().includes(kw) ||
        candidate.task_id.toLowerCase().includes(kw) ||
        (candidate.primary_owner ?? "").toLowerCase().includes(kw),
    );
  }, [candidates, keyword]);

  const toggle = (taskId: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((previous) =>
      previous.size === candidates.length
        ? new Set()
        : new Set(candidates.map((candidate) => candidate.task_id)),
    );
  };

  const handleSave = async () => {
    if (picked.size === 0 || saving) return;
    setSubmitError("");
    setSaving(true);
    try {
      await onConfirm(Array.from(picked));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("批量取消失败，请重试");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        className="rd-horizon-detail-dialog flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-white p-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-100 px-5 py-4 text-left sm:px-6">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Undo2 className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-balance text-base font-semibold text-slate-900">{t("批量取消子任务关系")}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-[11px] text-slate-500">
              {t("父任务：{title}", { title: parentTask.title })}
            </DialogDescription>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={toggleAll}
            className="mr-7 rounded px-2 py-1 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff] disabled:opacity-40"
          >
            {picked.size === candidates.length ? t("取消全选") : t("全选")}
          </button>
        </DialogHeader>
        <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            autoFocus
            placeholder={t("搜索任务标题 / 编号 / 主责人")}
            className="h-9 rounded-lg border-slate-200 text-sm"
          />
        </div>
        <div className="cockpit-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-3 sm:px-6" role="group" aria-label={t("可取消关系任务列表")}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-pretty text-sm text-slate-500">{t("没有匹配的子任务")}</p>
              {keyword ? <button type="button" onClick={() => setKeyword("")} className="mt-2 text-xs font-semibold text-[#002fa7] hover:underline">{t("清空搜索")}</button> : null}
            </div>
          ) : filtered.map((candidate) => {
            const checked = picked.has(candidate.task_id);
            const descendantCount = countRelationNodes(candidate) - 1;
            return (
              <button
                key={candidate.task_id}
                type="button"
                onClick={() => toggle(candidate.task_id)}
                aria-pressed={checked}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  checked
                    ? "border-slate-400 bg-slate-50"
                    : "border-slate-100 hover:border-slate-300 hover:bg-slate-50/70",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300 bg-white",
                  )}
                >
                  {checked ? <CheckCircle2 className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2.5">
                  <span className="block min-w-0 flex-1 truncate text-sm text-slate-700">
                    <AutoTranslatedText text={candidate.title} />
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
                    {descendantCount > 0 ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                        {t("含 {n} 个下级", { n: descendantCount })}
                      </span>
                    ) : null}
                    <span className="break-all font-mono text-[11px] text-slate-400">{candidate.task_id}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          {submitError ? <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700" role="alert">{submitError}</p> : null}
          <p className="mb-2 text-pretty text-[11px] leading-relaxed text-slate-500">
            {t("取消后，所选任务会连同其全部下级任务一起提升为独立任务，不会删除任何留痕或附件。")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] tabular-nums text-slate-500">{t("已选 {n} 个", { n: picked.size })}</span>
            <span className="flex justify-end gap-2">
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
                disabled={saving || picked.size === 0}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
                {saving ? t("取消中…") : t("确认取消关系")}
              </button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
