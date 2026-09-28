// 供应链任务驾驶舱：任务概览、集中筛选栏和按可用宽度排布的任务卡。
// 分类/物料维度的浏览在「物料库」页，此页专注任务流。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { Activity, AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Download, FolderTree, LayoutGrid, Layers3, MoreHorizontal, PackageCheck, PackageSearch, Plus, Search, Table2, Truck, UserCog, Users, X } from "lucide-react";
import { cn } from "../components/ui/utils";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
import { toast } from "sonner";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, taskMainDate, taskRequester, useProcurementData, type ProcStatus, type ProcurementTask } from "./data";
import { PersonAvatar, StatCell, useBuyerDirectory } from "./components/common";
import { procurementTasksForBuyer, uniqueRosterUserIdsByName } from "./procurementLogic";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { ProcurementTaskTable } from "./components/ProcurementTaskTable";
import { ProcurementSystemTree } from "./components/ProcurementSystemTree";
import { useProcTaskAction } from "./components/taskActions";
import { ProcurementTaskSummaryDrawer } from "./components/ProcurementTaskSummaryDrawer";
import { MoveTaskDialog } from "./components/MoveTaskDialog";
import { StockPlanPanel } from "./components/StockPlanPanel";
import { ProcurementSampleWorkspace } from "./components/ProcurementSampleWorkspace";
import { ProcSampleNavigationGuard } from "./components/ProcSampleNavigationGuard";
import { BatchReassignModal, NewRequirementModal, PoMatchModal } from "./components/modals";
import { usePermission } from "../hooks/usePermission";
import { exportProcTasksXlsx } from "./exportTasks";
import { type ProcTaskTreeNode } from "../lib/procurementApi";
import { procurementWorkspaceReturnPath } from "../lib/procurementWorkspaceNavigation";
import { routePath } from "../lib/routePaths";
import { clearStockPlanViewParams } from "../lib/stockPlanNavigation";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const TRANSIT_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival"];
/** 任务分批渲染，滚动到底自动追加。 */
const WATERFALL_PAGE_SIZE = 9;
type CockpitTab = "tasks" | "samples" | "stock-plans";

// 与研发驾驶舱一致：按既有排序轮转分列，各列独立堆叠；追加不重排已展示的任务。
function distributeIntoColumns<T>(items: T[], columnCount: number): T[][] {
  const columns: T[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, index) => columns[index % columnCount].push(item));
  return columns;
}

function useMasonryColumns(container: HTMLDivElement | null, reflowPaused: boolean): number {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    if (!container) return;
    const touchQuery = window.matchMedia("(pointer: coarse)");
    const tabletQuery = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      // 卡片换列会重挂载；弹窗打开时延后重排，保留预览位置与未保存的编辑内容。
      if (reflowPaused) return;
      const availableWidth = container.clientWidth - 8;
      if (availableWidth <= 0) return;
      // 使用任务区实际宽度，兼容侧栏收起；窄触屏保持单列阅读，桌面最多六列。
      const next = touchQuery.matches && tabletQuery.matches
        ? 1
        : Math.max(1, Math.min(6, Math.floor((availableWidth + 16) / (288 + 16))));
      setColumns((previous) => previous === next ? previous : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    touchQuery.addEventListener("change", update);
    tabletQuery.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      touchQuery.removeEventListener("change", update);
      tabletQuery.removeEventListener("change", update);
    };
  }, [container, reflowPaused]);
  return columns;
}

type StatKey = "inprogress" | "pending" | "inquiring" | "transit" | "overdue" | "week";

const STAT_LABELS: Record<StatKey, string> = {
  inprogress: "进行中",
  pending: "待处理",
  inquiring: "询价中",
  transit: "在途",
  overdue: "逾期",
  week: "本周到货",
};

function isProcurementTaskArrivingThisWeek(task: ProcurementTask) {
  const days = daysFromToday(task.expectedArrivalDate);
  return TRANSIT_STATUSES.includes(task.status) && days != null && days >= 0 && days <= 7;
}

export function ProcurementCockpitPage() {
  const { t } = useI18n();
  const { tasks, materials, loading, error } = useProcurementData();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<ProcurementTask | null>(null);
  const [stat, setStat] = useState<StatKey | null>(null);
  const [buyerUserId, setBuyerUserId] = useState<string | null>(null);
  const [treeNode, setTreeNode] = useState<ProcTaskTreeNode | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [poMatchOpen, setPoMatchOpen] = useState(false);
  const [sampleInteraction, setSampleInteraction] = useState({ dirty: false, busy: false });
  const approvedSampleNavigationRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceReturn = procurementWorkspaceReturnPath(location.state);
  const canOpenWorkspace = usePermission("page:proc-my-workspace");
  const [kw, setKw] = useState("");
  // 写操作按钮按系统管理配置的操作码显隐；物料审核在工作台物料详情里做（带完整上下文）
  const canCreate = usePermission("proc-task:create");
  const canReassign = usePermission("proc-task:reassign");
  const canOrder = usePermission("proc-task:order");
  const canReadProduction = usePermission("page:production-execution"), canPlanProduction = usePermission("production:plan"), canViewProduction = usePermission("production:view-all");
  const canViewKeyMaterials = usePermission("page:proc-key-materials");
  const { users: procurementDepartmentUsers } = useBuyerDirectory({ departmentOnly: true });
  // 决策类动作（选定报价 / 测试结论）在卡片上点只打开详情，由详情提供报价与图纸依据。
  // 必须声明在 setOpen 之后——放前面会命中 TDZ，构建器不报错但运行时直接白屏。
  const openTask = (task: ProcurementTask) => {
    setOpen(task);
    if (params.has("task")) setParams(current => {
      const next = new URLSearchParams(current);
      next.set("task", task.id);
      return next;
    }, { replace: true });
  };
  const taskAction = useProcTaskAction({ onOpenDetail: openTask });

  // 默认展示采购任务；保留已有业务链接的栏目参数，?line= 只筛选采购任务。
  const cockpitTab: CockpitTab = params.get("tab") === "stock-plans" ? "stock-plans" : params.get("tab") === "samples" ? "samples" : "tasks";
  const lineParam = params.get("line");
  const line: "all" | "rd" | "production" = lineParam === "rd" || lineParam === "production" ? lineParam : "all";
  const setLine = (nextLine: "all" | "rd" | "production") => {
    // 生产任务不经过询价阶段；切换时同步清掉已选中的询价筛选，避免出现隐藏筛选。
    if (nextLine === "production" && stat === "inquiring") setStat(null);
    setParams((p) => {
      const next = clearStockPlanViewParams(new URLSearchParams(p));
      next.delete("tab");
      if (nextLine === "all") next.delete("line");
      else next.set("line", nextLine);
      return next;
    }, { replace: true });
  };

  const view: "tasks" | "systems" = params.get("view") === "systems" ? "systems" : "tasks";
  const setView = (nextView: "tasks" | "systems") => setParams((p) => {
    const next = new URLSearchParams(p);
    if (nextView !== view) clearStockPlanViewParams(next);
    if (nextView === "tasks") {
      next.delete("view");
      next.delete("module");
      next.delete("product");
      next.delete("core");
    } else {
      next.set("view", "systems");
      next.delete("core");
    }
    return next;
  }, { replace: true });
  const moduleParam = params.get("module");
  const systemProductParam = params.get("product");
  const openSystemModule = useCallback((node: ProcTaskTreeNode, productId: string) => {
    setTreeNode(node);
    setParams((current) => {
      const next = clearStockPlanViewParams(new URLSearchParams(current));
      next.set("view", "systems");
      next.set("product", productId);
      next.set("module", node.id);
      next.delete("core");
      return next;
    });
  }, [setParams]);
  const closeSystemModule = useCallback(() => {
    setParams((current) => {
      const next = clearStockPlanViewParams(new URLSearchParams(current));
      next.delete("module");
      next.set("view", "systems");
      return next;
    }, { replace: true });
  }, [setParams]);
  const setSystemProduct = useCallback((productId: string) => {
    setParams((current) => {
      const next = clearStockPlanViewParams(new URLSearchParams(current));
      next.set("view", "systems");
      next.set("product", productId);
      next.delete("module");
      return next;
    }, { replace: true });
  }, [setParams]);
  const materialParam = params.get("material");
  const taskParam = params.get("task");
  // 旧整页链接统一使用抽屉，保留任务及其他筛选参数。
  useEffect(() => {
    if (!params.has("detail")) return;
    setParams(current => { const next = new URLSearchParams(current); next.delete("detail"); return next; }, { replace: true });
  }, [params, setParams]);
  // 从物料页跳转：?task= 自动打开详情；?material= 过滤采购任务。
  useEffect(() => {
    if (taskParam) {
      const t = tasks.find((x) => x.id === taskParam);
      if (t) setOpen(t);
    }
  }, [taskParam, tasks]);

  // 操作后数据刷新，已打开的抽屉要跟着换成最新对象（否则状态停在操作前）
  useEffect(() => {
    setOpen((cur) => (cur ? tasks.find((x) => x.id === cur.id) ?? null : cur));
  }, [tasks]);

  // Tab 数量徽标按全量任务计，作用域内数据一律用 lineTasks
  const lineTasks = useMemo(() => (line === "all" ? tasks : tasks.filter((t) => t.businessLine === line)), [tasks, line]);
  const lineCounts = useMemo(() => ({
    all: tasks.length,
    production: tasks.filter((t) => t.businessLine === "production").length,
    rd: tasks.filter((t) => t.businessLine === "rd").length,
  }), [tasks]);

  // 子系统筛选是整页作用域：统计条、人员泳道和任务卡必须使用同一批任务。
  const treeScopedTasks = useMemo(() => {
    if (!treeNode) return lineTasks;
    const taskIds = new Set(treeNode.taskIds);
    return lineTasks.filter((task) => taskIds.has(task.id));
  }, [lineTasks, treeNode]);


  // 人员泳道只看采购部门正式成员；任务按采购负责人归属，不看研发对接人或需求提出人。
  const uniqueBuyerIdsByName = useMemo(
    () => uniqueRosterUserIdsByName(procurementDepartmentUsers),
    [procurementDepartmentUsers],
  );
  const people = useMemo(() => {
    const countsByUserId = new Map(procurementDepartmentUsers.map((user) => [user.id, 0]));
    for (const task of treeScopedTasks) {
      const ownerId = task.buyerUserId || (task.buyer ? uniqueBuyerIdsByName.get(task.buyer) : null);
      if (ownerId && countsByUserId.has(ownerId)) {
        countsByUserId.set(ownerId, (countsByUserId.get(ownerId) ?? 0) + 1);
      }
    }
    return procurementDepartmentUsers
      .map((user) => ({ ...user, taskCount: countsByUserId.get(user.id) ?? 0 }))
      .sort((a, b) => b.taskCount - a.taskCount || a.name.localeCompare(b.name, "zh-CN"));
  }, [procurementDepartmentUsers, treeScopedTasks, uniqueBuyerIdsByName]);

  const buyerScopedTasks = useMemo(
    () => procurementTasksForBuyer(treeScopedTasks, buyerUserId, uniqueBuyerIdsByName),
    [treeScopedTasks, buyerUserId, uniqueBuyerIdsByName],
  );
  const counts = useMemo(() => ({
    inprogress: buyerScopedTasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    pending: buyerScopedTasks.filter((t) => t.status === "pending_confirm").length,
    inquiring: buyerScopedTasks.filter((t) => t.status === "inquiring").length,
    transit: buyerScopedTasks.filter((t) => TRANSIT_STATUSES.includes(t.status)).length,
    overdue: buyerScopedTasks.filter(isProcurementTaskOverdue).length,
    week: buyerScopedTasks.filter(isProcurementTaskArrivingThisWeek).length,
  }), [buyerScopedTasks]);


  useEffect(() => {
    if (buyerUserId && !procurementDepartmentUsers.some((user) => user.id === buyerUserId)) {
      setBuyerUserId(null);
    }
  }, [buyerUserId, procurementDepartmentUsers]);

  const filtered = useMemo(() => {
    let list = buyerScopedTasks.filter((t) => {
      if (!stat) return true;
      if (stat === "inprogress") return ACTIVE_STATUSES.includes(t.status);
      if (stat === "pending") return t.status === "pending_confirm";
      if (stat === "inquiring") return t.status === "inquiring";
      if (stat === "transit") return TRANSIT_STATUSES.includes(t.status);
      if (stat === "overdue") return isProcurementTaskOverdue(t);
      if (stat === "week") return isProcurementTaskArrivingThisWeek(t);
      return true;
    });
    if (materialParam) list = list.filter((t) => t.materialName === materialParam);
    const keyword = kw.trim().toLowerCase();
    if (keyword) list = list.filter((t) => `${t.code} ${t.materialName} ${t.spec} ${t.buyer} ${t.rdContact ?? ""} ${taskRequester(t).name}`.toLowerCase().includes(keyword));
    // 待处理置顶；其余按主日期升序
    return [...list].sort((a, b) => {
      if ((a.status === "pending_confirm") !== (b.status === "pending_confirm")) return a.status === "pending_confirm" ? -1 : 1;
      const da = taskMainDate(a).date ?? "9999";
      const db = taskMainDate(b).date ?? "9999";
      return da.localeCompare(db);
    });
  }, [buyerScopedTasks, stat, materialParam, kw]);

  const toggleStat = (k: StatKey) => setStat((cur) => (cur === k ? null : k));

  // 任务分批渲染：首屏一批，滚动到底部哨兵自动追加；筛选条件变化重置
  const [visibleCount, setVisibleCount] = useState(WATERFALL_PAGE_SIZE);
  const [taskDisplay, setTaskDisplay] = useState<"masonry" | "table">("table");
  const [taskTablePage, setTaskTablePage] = useState(1);
  const [taskTablePageSize, setTaskTablePageSize] = useState(10);
  const [taskStreamElement, setTaskStreamElement] = useState<HTMLDivElement | null>(null);
  const [openTaskOverlays, setOpenTaskOverlays] = useState<Set<string>>(() => new Set());
  const onTaskOverlayOpenChange = useCallback((taskId: string, open: boolean) => {
    setOpenTaskOverlays((current) => {
      if (current.has(taskId) === open) return current;
      const next = new Set(current);
      if (open) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);
  const masonryColumns = useMasonryColumns(taskStreamElement, openTaskOverlays.size > 0);
  const [sentinelElement, setSentinelElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setVisibleCount(WATERFALL_PAGE_SIZE);
    setTaskTablePage(1);
  }, [line, treeNode?.id, buyerUserId, stat, materialParam, kw]);
  useEffect(() => {
    if (cockpitTab !== "tasks" || view !== "tasks" || taskDisplay !== "masonry" || !taskStreamElement || !sentinelElement || visibleCount >= filtered.length) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + WATERFALL_PAGE_SIZE, filtered.length));
        }
      },
      { root: taskStreamElement, rootMargin: "200px" },
    );
    observer.observe(sentinelElement);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [cockpitTab, view, taskDisplay, taskStreamElement, sentinelElement, visibleCount, filtered]);
  const visibleTasks = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const taskTablePageCount = Math.max(1, Math.ceil(filtered.length / taskTablePageSize));
  const currentTaskTablePage = Math.min(taskTablePage, taskTablePageCount);
  const tablePageTasks = useMemo(() => filtered.slice((currentTaskTablePage - 1) * taskTablePageSize, currentTaskTablePage * taskTablePageSize), [filtered, currentTaskTablePage, taskTablePageSize]);
  const tablePageNumbers = [...new Set([
    1,
    ...Array.from({ length: Math.min(5, taskTablePageCount) }, (_, index) => Math.max(1, Math.min(currentTaskTablePage - 2, taskTablePageCount - 4)) + index),
    taskTablePageCount,
  ])];
  useEffect(() => {
    setTaskTablePage((page) => Math.min(page, taskTablePageCount));
  }, [taskTablePageCount]);
  useEffect(() => {
    if (taskDisplay === "table") taskStreamElement?.scrollTo({ top: 0, behavior: "instant" });
  }, [taskDisplay, currentTaskTablePage, taskTablePageSize, line, treeNode?.id, buyerUserId, stat, materialParam, kw, taskStreamElement]);
  const tablePaginationDisabled = loading || openTaskOverlays.size > 0;
  const changeTaskTablePage = (page: number) => {
    if (!tablePaginationDisabled) setTaskTablePage(Math.max(1, Math.min(page, taskTablePageCount)));
  };
  const hasActiveFilters = line !== "all" || Boolean(stat || buyerUserId || treeNode || materialParam || kw.trim());
  const clearFilters = () => {
    setStat(null);
    setBuyerUserId(null);
    setTreeNode(null);
    setKw("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("line");
      next.delete("material");
      return next;
    }, { replace: true });
  };

  const businessLineFilter = (
    <div className="proc-horizon-line-filter">
      <span className="proc-horizon-line-filter-label">{t("业务线")}</span>
      <ToggleGroup
        type="single"
        value={line}
        onValueChange={(value) => value && setLine(value as typeof line)}
        aria-label={t("按采购业务线筛选")}
        className="proc-horizon-line-filter-list"
      >
        {([["all", "全部", lineCounts.all], ["production", "生产", lineCounts.production], ["rd", "研发", lineCounts.rd]] as const).map(([key, label, count]) => (
          <ToggleGroupItem key={key} value={key} className="proc-horizon-line-filter-option">
            <span>{t(label)}</span>
            <span className="proc-horizon-line-filter-count tabular-nums">{count}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  // 兼容旧核心配件入口，统一进入关键物料目录。
  if (params.get("core") === "1") return <Navigate replace to={routePath("page:proc-key-materials", "/proc-key-materials")} />;


  if (cockpitTab === "samples") {
    return <div className="proc-horizon proc-horizon-cockpit-shell h-full min-h-0 min-w-0 w-full">
      <div className="proc-horizon-layout flex h-full min-h-0 min-w-0 flex-col">
        <ProcSampleNavigationGuard dirty={sampleInteraction.dirty} busy={sampleInteraction.busy} approvedSampleNavigationRef={approvedSampleNavigationRef} />
        <ProcurementSampleWorkspace tasks={tasks} materials={materials} loading={loading} error={error} selectedId={params.get("sample")} onInteractionStateChange={setSampleInteraction} onSelect={(id) => {
          approvedSampleNavigationRef.current = id;
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("tab", "samples");
            next.set("sample", id);
            return next;
          }, { replace: true, state: location.state });
        }} />
      </div>
    </div>;
  }

  if (cockpitTab === "stock-plans") {
    return (
      <div className="proc-horizon proc-horizon-cockpit-shell h-full min-h-0 min-w-0 w-full">
        <div className="proc-horizon-layout flex h-full min-h-0 flex-col">
          {canOpenWorkspace && workspaceReturn && <div><Button type="button" variant="ghost" onClick={() => navigate(workspaceReturn)} className="min-h-10 gap-1.5"><ArrowLeft className="size-4" aria-hidden="true" />{t("返回采购工作台")}</Button></div>}
          <StockPlanPanel materials={materials} canCreate={canCreate} />
        </div>
      </div>
    );
  }

  return (
    <div className="proc-horizon proc-horizon-cockpit-shell h-full min-h-0 min-w-0 w-full">
      <div className="proc-horizon-layout flex h-full min-h-0 flex-col">
      {/* Horizon 指挥区：业务范围、全局操作与 KPI 共用一个信息焦点。 */}
      {view === "tasks" && (
        <section className="proc-horizon-command proc-horizon-command-cockpit mb-3">
          <div className="proc-horizon-command-layout">
            <div className="proc-horizon-command-heading">
              <div className="proc-horizon-command-copy">
                <h2 className="text-balance">{t("任务概览")}</h2>
                <p className="text-pretty">{treeNode?.name || t("权限范围内的采购任务")} · {buyerUserId ? procurementDepartmentUsers.find(person => person.id === buyerUserId)?.name || t("当前负责人") : t("全部负责人")}<span className="ml-2 tabular-nums">{buyerScopedTasks.length} {t("个任务")}</span></p>
              </div>
            </div>

            <div className="proc-horizon-actions">
              <Button variant="unstyled" type="button" aria-label={t("子系统全景")} title={t("子系统全景")} onClick={() => setView("systems")} className="material-button-secondary inline-flex items-center gap-1.5 text-xs">
                <Layers3 className="size-4" /><span className="proc-horizon-action-label">{t("子系统全景")}</span>
              </Button>
              {canViewKeyMaterials && <Button variant="unstyled" type="button" aria-label={t("核心配件")} title={t("全部关键物料")} onClick={() => navigate(routePath("page:proc-key-materials", "/proc-key-materials"))} className="material-button-secondary inline-flex items-center gap-1.5 text-xs">
                <PackageSearch className="size-4" /><span className="proc-horizon-action-label">{t("核心配件")}</span>
              </Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="unstyled" type="button" className="material-button-secondary inline-flex items-center gap-1.5 text-xs">
                    <MoreHorizontal className="size-4" />{t("更多")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="proc-horizon-menu min-w-48 rounded-xl border-slate-200 p-1.5 shadow-lg data-[state=open]:animate-none data-[state=closed]:animate-none">
                  {canReadProduction && (canPlanProduction || canViewProduction) && <DropdownMenuItem onSelect={() => navigate(`/production-dashboard?${new URLSearchParams({ ...(params.get("month") ? { month: params.get("month")! } : {}), ...(systemProductParam ? { riskProduct: systemProductParam } : {}) })}`)}><AlertTriangle className="size-4" />交付风险与齐套</DropdownMenuItem>}
                  <DropdownMenuItem
                    onSelect={() => {
                      void exportProcTasksXlsx(filtered)
                        .then((count) => toast.success(t('已导出 {count} 个任务', { count })))
                        .catch((err) => toast.error(err instanceof Error ? err.message : t('导出失败')));
                    }}
                  ><Download className="size-4" />{t('导出当前列表')}</DropdownMenuItem>
                  {canOrder && <DropdownMenuItem onSelect={() => setPoMatchOpen(true)}><Truck className="size-4" />{t('单据匹配')}</DropdownMenuItem>}
                  {canViewKeyMaterials && <DropdownMenuItem onSelect={() => navigate(`${routePath('page:proc-key-materials', '/proc-key-materials')}?${new URLSearchParams({ ...(params.get('month') ? { month: params.get('month')! } : {}), ...(systemProductParam ? { product: systemProductParam } : {}) })}`)}><PackageSearch className="size-4" />{t('全部关键物料')}</DropdownMenuItem>}
                  {(canOrder || canReassign || canCreate) && <DropdownMenuSeparator />}
                  {canReassign && <DropdownMenuItem onSelect={() => setBatchOpen(true)}><Users className="size-4" />{t('批量转派')}</DropdownMenuItem>}
                  {(canCreate || canReassign) && <DropdownMenuItem onSelect={() => setBatchMoveOpen(true)}><FolderTree className="size-4" />{t('批量归类')}</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => navigate('/proc-people-management')}><UserCog className="size-4" />{t('人员与负载')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canCreate && <Button variant="unstyled" type="button" onClick={() => setNewOpen(true)} className="proc-horizon-primary-action inline-flex items-center gap-1.5 text-xs"><Plus className="size-4" />{t('新建需求')}</Button>}
            </div>

            <div className="proc-horizon-cockpit-kpis" data-production={line === "production"} aria-label={t("供应链任务统计")}>
                <StatCell label={t('在制任务')} value={counts.inprogress} Icon={Activity} active={stat === "inprogress"} onClick={() => toggleStat("inprogress")} />
                <StatCell label={t('待确认')} value={counts.pending} tone={counts.pending > 0 ? "red" : "slate"} badge={counts.pending > 0} Icon={ClipboardList} active={stat === "pending"} onClick={() => toggleStat("pending")} />
                {line !== "production" ? <StatCell label={t('询价中')} value={counts.inquiring} tone="indigo" Icon={Search} active={stat === "inquiring"} onClick={() => toggleStat("inquiring")} /> : null}
                <StatCell label={t('采购在途')} value={counts.transit} tone="indigo" Icon={Truck} active={stat === "transit"} onClick={() => toggleStat("transit")} />
                <StatCell label={t('本周到货')} value={counts.week} tone="emerald" Icon={PackageCheck} active={stat === "week"} onClick={() => toggleStat("week")} />
                <StatCell label={t('逾期异常')} value={counts.overdue} tone="red" Icon={AlertTriangle} active={stat === "overdue"} onClick={() => toggleStat("overdue")} />
            </div>
          </div>
        </section>
      )}

      {view === "systems" ? (
        <div className="flex min-h-0 flex-1">
          <ProcurementSystemTree
            tasks={tasks}
            materials={materials}
            selected={treeNode}
            onSelect={setTreeNode}
            onShowTasks={() => setView("tasks")}
            detailNodeId={moduleParam}
            requestedProductId={systemProductParam}
            onCloseModule={closeSystemModule}
            onOpenModule={openSystemModule}
            onProductChange={setSystemProduct}
          />
        </div>
      ) : (
        <div className="proc-horizon-task-body flex min-h-0 flex-1 flex-col gap-3">
        <section className="proc-horizon-task-stream flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 人员泳道 */}
      <div className="proc-horizon-people-nav">
        {businessLineFilter}
        <span className="proc-horizon-people-label"><Users className="size-3.5" />{t('采购负责人')}</span>
        <ToggleGroup
          type="single"
          value={buyerUserId ?? "all"}
          onValueChange={(value) => setBuyerUserId(!value || value === "all" ? null : value)}
          aria-label={t("按采购负责人筛选")}
          className="proc-horizon-people-list"
        >
          <ToggleGroupItem value="all" size="sm" className="proc-horizon-person-tab" aria-label={t("{name}，{count} 个任务", { name: t("全部"), count: treeScopedTasks.length })}>
            <span className="proc-horizon-avatar-ring">
              <span className="proc-horizon-avatar-core"><Users className="size-4" /></span>
            </span>
            <span className="proc-horizon-person-name">{t('全部')}</span>
            <span className="proc-horizon-person-count tabular-nums" data-empty={treeScopedTasks.length === 0}>{treeScopedTasks.length}</span>
          </ToggleGroupItem>
          {people.map((buyer) => (
            <ToggleGroupItem key={buyer.id} value={buyer.id} size="sm" className="proc-horizon-person-tab" aria-label={t("{name}，{count} 个任务", { name: buyer.name, count: buyer.taskCount })}>
              <span className="proc-horizon-avatar-ring">
                <span className="proc-horizon-avatar-core"><PersonAvatar name={buyer.name} size="md" /></span>
              </span>
              <span className="proc-horizon-person-name">{buyer.name}</span>
              <span className="proc-horizon-person-count tabular-nums" data-empty={buyer.taskCount === 0}>{buyer.taskCount}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="proc-horizon-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={t('搜索采购任务')} value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t('搜索单号 / 物料 / 人员')} className="pl-8 pr-8 text-xs placeholder:text-muted-foreground" />
          {kw && (
            <Button variant="unstyled" type="button" aria-label={t('清空搜索')} onClick={() => setKw("")} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="proc-horizon-task-feed flex min-h-0 flex-1 flex-col">
      <div className="proc-horizon-filter-bar">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-semibold text-slate-500">{t("当前任务流")}</span>
          {stat && (
            <Button variant="unstyled" type="button" onClick={() => setStat(null)} aria-label={t("移除状态筛选：{status}", { status: t(STAT_LABELS[stat]) })} className="proc-horizon-filter-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t(STAT_LABELS[stat])} ×
            </Button>
          )}
          {treeNode && (
            <Button type="button" variant="outline" size="sm" onClick={() => setTreeNode(null)} className="proc-horizon-filter-chip h-auto">
              {t("系统")}：<AutoTranslatedText text={treeNode.name} /> ×
            </Button>
          )}
          {materialParam && (
            <Button variant="unstyled" type="button" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("material"); return n; }, { replace: true })} aria-label={t("移除物料筛选：{material}", { material: materialParam })} className="proc-horizon-filter-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t('物料')}：<AutoTranslatedText text={materialParam} /> ×
            </Button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="font-semibold tabular-nums text-slate-500">{t("显示 {count} 个任务", { count: filtered.length })}</span>
          <ToggleGroup type="single" size="sm" value={taskDisplay} disabled={openTaskOverlays.size > 0} aria-label={t("任务显示模式")} className="proc-horizon-display-toggle" onValueChange={(value) => {
            if ((value !== "masonry" && value !== "table") || value === taskDisplay || openTaskOverlays.size > 0) return;
            taskStreamElement?.scrollTo({ top: 0, left: 0, behavior: "instant" });
            setTaskDisplay(value);
          }}>
            <ToggleGroupItem value="masonry" aria-label={t("瀑布流视图")} title={t("瀑布流视图")}><LayoutGrid aria-hidden="true" className="size-4" /></ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label={t("表格视图")} title={t("表格视图")}><Table2 aria-hidden="true" className="size-4" /></ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* 任务展示区 */}
        <div ref={setTaskStreamElement} className="proc-horizon-task-scroll cockpit-scroll" data-display={taskDisplay} role="region" aria-label={t("采购任务列表")} tabIndex={0}>
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/40 px-4 py-12 text-center text-sm text-rose-700">
              <AlertTriangle className="size-7 text-rose-500" />
              <div>
                <p className="font-semibold">{t("采购任务加载失败")}</p>
                <p className="mt-1 max-w-xl text-pretty text-xs text-rose-600">{error}</p>
              </div>
              <Button variant="unstyled" type="button" onClick={() => void refreshProcurement()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</Button>
            </div>
          ) : loading && tasks.length === 0 ? (
            <div aria-label={t("正在加载采购任务")} role="status" className={taskDisplay === "table" ? "space-y-2" : "proc-horizon-task-masonry"}>
              {taskDisplay === "table" ? Array.from({ length: 6 }, (_, item) => (
                <div key={item} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-6 rounded-lg border border-border bg-card px-4 py-5">
                  <span className="h-4 rounded bg-muted" /><span className="h-4 rounded bg-muted" /><span className="h-4 rounded bg-muted" /><span className="h-4 rounded bg-muted" />
                </div>
              )) : Array.from({ length: masonryColumns }, (_, item) => (
                <div key={item} className="min-h-52 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex gap-2"><span className="h-5 w-16 rounded bg-slate-100" /><span className="h-5 w-20 rounded bg-slate-100" /></div>
                  <div className="mt-4 h-5 w-3/4 rounded bg-slate-100" />
                  <div className="mt-3 h-4 w-full rounded bg-slate-100" />
                  <div className="mt-2 h-4 w-2/3 rounded bg-slate-100" />
                  <div className="mt-8 h-2 w-full rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 py-12 text-center">
              <ClipboardList className="size-7 text-muted-foreground" />
              <p className="text-pretty text-sm font-medium text-slate-600">{t(hasActiveFilters ? '没有符合条件的任务' : '当前还没有采购任务')}</p>
              {hasActiveFilters ? (
                <Button variant="unstyled" type="button" onClick={clearFilters} className="material-button-secondary px-3 py-2 text-xs">{t("清除筛选")}</Button>
              ) : canCreate ? (
                <Button variant="unstyled" type="button" onClick={() => setNewOpen(true)} className="material-button-primary px-3 py-2 text-xs">{t("新建需求")}</Button>
              ) : null}
            </div>
          ) : (
              <>
                {taskDisplay === "table" ? (
                  <ProcurementTaskTable
                    tasks={tablePageTasks}
                    materials={materials}
                    selectedTaskId={open?.id}
                    onOpen={openTask}
                    onNext={(nextTask) => taskAction.runNext(nextTask, "card")}
                    onReassign={taskAction.reassign}
                    onRemove={taskAction.remove}
                    onOverlayOpenChange={onTaskOverlayOpenChange}
                  />
                ) : <div className="proc-horizon-task-masonry">
                  {distributeIntoColumns(visibleTasks, masonryColumns).map((column, columnIndex) => (
                    <div key={columnIndex} className="proc-horizon-task-masonry-column">
                      {column.map((task) => (
                        <ProcurementTaskCard
                          key={task.id}
                          task={task}
                          materials={materials}
                          onOpen={openTask}
                          onNext={(nextTask) => taskAction.runNext(nextTask, "card")}
                          onReassign={taskAction.reassign}
                          onRemove={taskAction.remove}
                          onOverlayOpenChange={onTaskOverlayOpenChange}
                        />
                      ))}
                    </div>
                  ))}
                </div>}
                {taskDisplay === "masonry" && (visibleCount < filtered.length ? (
                  <div ref={setSentinelElement} className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <span className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary motion-reduce:animate-none" />
                    {t('下拉加载更多')}（{visibleCount} / {filtered.length}）
                  </div>
                ) : filtered.length > WATERFALL_PAGE_SIZE ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">{t('已加载全部')} {filtered.length} {t('个任务')}</div>
                ) : null)}
              </>
            )}
        </div>
        {taskDisplay === "table" && !error && (
          <div className="proc-horizon-task-pagination">
            <span role="status" aria-live="polite" className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {filtered.length === 0
                ? t("共 0 个任务")
                : t("第 {start}–{end} 条，共 {total} 个任务", { start: (currentTaskTablePage - 1) * taskTablePageSize + 1, end: Math.min(currentTaskTablePage * taskTablePageSize, filtered.length), total: filtered.length })}
            </span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
              <Select value={String(taskTablePageSize)} disabled={tablePaginationDisabled} onValueChange={(value) => {
                const size = Number(value);
                if (tablePaginationDisabled || ![10, 20, 50].includes(size)) return;
                setTaskTablePageSize(size);
                setTaskTablePage(1);
              }}>
                <SelectTrigger size="sm" aria-label={t("每页条数")} className="w-auto min-w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 20, 50].map((size) => <SelectItem key={size} value={String(size)}>{t("{count} 条 / 页", { count: size })}</SelectItem>)}
                </SelectContent>
              </Select>
              <Pagination aria-label={t("采购任务分页")} className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem><Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("上一页")} title={t("上一页")} disabled={tablePaginationDisabled || currentTaskTablePage === 1} onClick={() => changeTaskTablePage(currentTaskTablePage - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button></PaginationItem>
                  {tablePageNumbers.map((page, index) => (
                    <PaginationItem key={page} className="flex items-center gap-1">
                      {index > 0 && page - tablePageNumbers[index - 1] > 1 && <PaginationEllipsis className="size-8" />}
                      <Button type="button" variant={page === currentTaskTablePage ? "secondary" : "ghost"} size="icon" className="size-8 text-xs tabular-nums" aria-label={t("第 {page} 页", { page })} aria-current={page === currentTaskTablePage ? "page" : undefined} disabled={tablePaginationDisabled} onClick={() => changeTaskTablePage(page)}>{page}</Button>
                    </PaginationItem>
                  ))}
                  <PaginationItem><Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("下一页")} title={t("下一页")} disabled={tablePaginationDisabled || currentTaskTablePage === taskTablePageCount} onClick={() => changeTaskTablePage(currentTaskTablePage + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button></PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        )}

      </div>

        </section>
      </div>
      )}

      {open && <ProcurementTaskSummaryDrawer materials={materials} task={open} onClose={() => { setOpen(null); if (taskParam) setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true }); }} />}
      {taskAction.modal}
      {newOpen && <NewRequirementModal onClose={() => setNewOpen(false)} />}
      {batchOpen && <BatchReassignModal tasks={treeScopedTasks} onClose={() => setBatchOpen(false)} />}
      {batchMoveOpen && (
        <MoveTaskDialog
          candidates={treeScopedTasks}
          productId={systemProductParam ?? treeScopedTasks[0]?.productId ?? "prod-portable-o2"}
          onClose={() => setBatchMoveOpen(false)}
          onMoved={() => { void refreshProcurement(); }}
        />
      )}
      {poMatchOpen && <PoMatchModal onClose={() => setPoMatchOpen(false)} />}
      </div>
    </div>
  );
}
