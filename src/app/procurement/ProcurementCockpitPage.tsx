// 供应链任务驾驶舱：任务概览、集中筛选栏和按可用宽度排布的任务卡。
// 分类/物料维度的浏览在「物料库」页，此页专注任务流。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Activity, AlertTriangle, ArrowLeft, ClipboardList, Download, FolderTree, Layers3, MoreHorizontal, PackageCheck, PackagePlus, PackageSearch, Plus, Search, Truck, UserCog, Users, X } from "lucide-react";
import { cn } from "../components/ui/utils";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useI18n } from "../lib/i18n";
import { toast } from "sonner";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, taskMainDate, taskRequester, useProcurementData, type ProcStatus, type ProcurementTask } from "./data";
import { PersonAvatar, StatCell, useBuyerDirectory } from "./components/common";
import { uniqueRosterUserIdsByName } from "./procurementLogic";
import { ProcurementTaskCard } from "./components/ProcurementTaskCard";
import { ProcurementSystemTree } from "./components/ProcurementSystemTree";
import { useProcTaskAction } from "./components/taskActions";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { MoveTaskDialog } from "./components/MoveTaskDialog";
import { StockPlanPanel } from "./components/StockPlanPanel";
import { ProcurementSampleWorkspace } from "./components/ProcurementSampleWorkspace";
import { ProcSampleNavigationGuard } from "./components/ProcSampleNavigationGuard";
import { BatchReassignModal, NewRequirementModal, PoMatchModal } from "./components/modals";
import { usePermission } from "../hooks/usePermission";
import { exportProcTasksXlsx } from "./exportTasks";
import { getProcCoreMaterialConfig, setProcCoreMaterialConfig, type ProcCoreMaterialConfig, type ProcTaskTreeNode } from "../lib/procurementApi";
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
  const [coreMaterialConfig, setCoreMaterialConfig] = useState<ProcCoreMaterialConfig>({ maxItems: 30, products: {} });
  const [coreConfigLoading, setCoreConfigLoading] = useState(true);
  const [coreConfigError, setCoreConfigError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceReturn = procurementWorkspaceReturnPath(location.state);
  const canOpenWorkspace = usePermission("page:proc-my-workspace");
  const [kw, setKw] = useState("");
  // 写操作按钮按系统管理配置的操作码显隐；物料审核在工作台物料详情里做（带完整上下文）
  const canCreate = usePermission("proc-task:create");
  const canReassign = usePermission("proc-task:reassign");
  const canOrder = usePermission("proc-task:order");
  const { users: procurementDepartmentUsers } = useBuyerDirectory({ departmentOnly: true });
  // 决策类动作（选定报价 / 测试结论）在卡片上点只打开详情，由详情提供报价与图纸依据。
  // 必须声明在 setOpen 之后——放前面会命中 TDZ，构建器不报错但运行时直接白屏。
  const taskAction = useProcTaskAction({ onOpenDetail: setOpen });

  // 页面级 Tab 与业务线筛选是两层信息架构：?tab= 切换栏目，?line= 只筛选采购任务。
  const cockpitTab: CockpitTab = params.get("tab") === "stock-plans" ? "stock-plans" : params.get("tab") === "samples" ? "samples" : "tasks";
  const lineParam = params.get("line");
  const line: "all" | "rd" | "production" = lineParam === "rd" || lineParam === "production" ? lineParam : "all";
  const setCockpitTab = (nextTab: "tasks" | "samples" | "stock-plans") => setParams((p) => {
    const next = new URLSearchParams(p);
    if (nextTab !== cockpitTab) clearStockPlanViewParams(next);
    next.delete("sample");
    if (nextTab !== "tasks") {
      next.set("tab", nextTab);
      next.delete("view");
      next.delete("module");
      next.delete("product");
      next.delete("core");
      next.delete("material");
      next.delete("task");
    } else {
      next.delete("tab");
    }
    return next;
  }, { replace: true });
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
  const coreMode = params.get("core") === "1";
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
  const setCoreMode = useCallback((active: boolean) => {
    setParams((current) => {
      const next = clearStockPlanViewParams(new URLSearchParams(current));
      next.set("view", "systems");
      next.delete("module");
      if (active) next.set("core", "1");
      else next.delete("core");
      return next;
    }, { replace: true });
  }, [setParams]);
  const saveCoreMaterials = useCallback(async (productId: string, materialIds: string[]) => {
    const saved = await setProcCoreMaterialConfig(productId, materialIds);
    setCoreMaterialConfig((current) => ({
      maxItems: saved.maxItems,
      products: { ...current.products, [saved.productId]: saved.materialIds },
    }));
  }, []);

  const loadCoreMaterialConfig = useCallback(async (signal?: AbortSignal) => {
    setCoreConfigLoading(true);
    setCoreConfigError(null);
    try {
      setCoreMaterialConfig(await getProcCoreMaterialConfig(signal));
    } catch (cause) {
      if (signal?.aborted) return;
      setCoreConfigError(cause instanceof Error ? cause.message : t("核心配件配置加载失败"));
    } finally {
      if (!signal?.aborted) setCoreConfigLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCoreMaterialConfig(controller.signal);
    return () => controller.abort();
  }, [loadCoreMaterialConfig]);

  const materialParam = params.get("material");
  const taskParam = params.get("task");
  // 从物料页跳转：?task= 自动打开详情；?material= 过滤瀑布流。
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

  const counts = useMemo(() => ({
    inprogress: treeScopedTasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length,
    pending: treeScopedTasks.filter((t) => t.status === "pending_confirm").length,
    inquiring: treeScopedTasks.filter((t) => t.status === "inquiring").length,
    transit: treeScopedTasks.filter((t) => TRANSIT_STATUSES.includes(t.status)).length,
    overdue: treeScopedTasks.filter(isProcurementTaskOverdue).length,
    week: treeScopedTasks.filter(isProcurementTaskArrivingThisWeek).length,
  }), [treeScopedTasks]);

  const coreInventorySummary = useMemo(() => {
    const configuredIds = new Set(Object.values(coreMaterialConfig.products).flat());
    let total = 0;
    let shortage = 0;
    let low = 0;
    for (const material of materials) {
      if (!configuredIds.has(material.id) || !material.tpInventoryCode?.trim() || !material.inventorySyncedAt) continue;
      total += 1;
      if (material.availableQty <= 0) shortage += 1;
      else if (material.safeStock > 0 && material.availableQty < material.safeStock) low += 1;
    }
    return { total, shortage, low, abnormal: shortage + low };
  }, [coreMaterialConfig.products, materials]);

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

  const buyerNameById = useMemo(
    () => new Map(procurementDepartmentUsers.map((user) => [user.id, user.name])),
    [procurementDepartmentUsers],
  );

  useEffect(() => {
    if (buyerUserId && !procurementDepartmentUsers.some((user) => user.id === buyerUserId)) {
      setBuyerUserId(null);
    }
  }, [buyerUserId, procurementDepartmentUsers]);

  const filtered = useMemo(() => {
    let list = treeScopedTasks.filter((t) => {
      if (!stat) return true;
      if (stat === "inprogress") return ACTIVE_STATUSES.includes(t.status);
      if (stat === "pending") return t.status === "pending_confirm";
      if (stat === "inquiring") return t.status === "inquiring";
      if (stat === "transit") return TRANSIT_STATUSES.includes(t.status);
      if (stat === "overdue") return isProcurementTaskOverdue(t);
      if (stat === "week") return isProcurementTaskArrivingThisWeek(t);
      return true;
    });
    if (buyerUserId) {
      const buyerName = buyerNameById.get(buyerUserId);
      list = list.filter((task) =>
        task.buyerUserId === buyerUserId
        || (!task.buyerUserId && buyerName !== undefined && task.buyer === buyerName && uniqueBuyerIdsByName.get(buyerName) === buyerUserId),
      );
    }
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
  }, [treeScopedTasks, stat, buyerUserId, buyerNameById, uniqueBuyerIdsByName, materialParam, kw]);

  const toggleStat = (k: StatKey) => setStat((cur) => (cur === k ? null : k));

  // 任务分批渲染：首屏一批，滚动到底部哨兵自动追加；筛选条件变化重置
  const [visibleCount, setVisibleCount] = useState(WATERFALL_PAGE_SIZE);
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
  }, [line, treeNode?.id, buyerUserId, stat, materialParam, kw]);
  useEffect(() => {
    if (cockpitTab !== "tasks" || view !== "tasks" || !sentinelElement || visibleCount >= filtered.length) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + WATERFALL_PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelElement);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [cockpitTab, view, sentinelElement, visibleCount, filtered]);
  const visibleTasks = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
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

  const cockpitTabs = <>
    <Tabs value={cockpitTab} className="proc-horizon-page-tabs" onValueChange={(value) => {
      if (value === cockpitTab) return;
      setCockpitTab(value as CockpitTab);
    }}>
      <TabsList aria-label={t("供应链驾驶舱栏目")}>
        <TabsTrigger value="tasks">
          <ClipboardList aria-hidden="true" className="size-4" />
          {t("采购任务")}
        </TabsTrigger>
        <TabsTrigger value="samples">
          <PackageCheck aria-hidden="true" className="size-4" />
          {t("样品协同")}
        </TabsTrigger>
        <TabsTrigger value="stock-plans">
          <PackagePlus aria-hidden="true" className="size-4" />
          {t("备货计划")}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  </>;

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

  if (cockpitTab === "samples") {
    return <div className="proc-horizon proc-horizon-cockpit-shell min-h-full min-w-0 w-full">
      <div className="proc-horizon-layout flex min-h-full min-w-0 flex-col">
        {canOpenWorkspace && <div><Button type="button" variant="ghost" disabled={sampleInteraction.busy} onClick={() => navigate(workspaceReturn ?? routePath("page:proc-my-workspace", "/proc-my-workspace"))} className="min-h-10 gap-1.5"><ArrowLeft className="size-4" aria-hidden="true" />{t("返回采购工作台")}</Button></div>}
        <div className="hidden md:block">{cockpitTabs}</div>
        <ProcSampleNavigationGuard dirty={sampleInteraction.dirty} busy={sampleInteraction.busy} approvedSampleNavigationRef={approvedSampleNavigationRef} />
        <ProcurementSampleWorkspace tasks={tasks} loading={loading} error={error} selectedId={params.get("sample")} onInteractionStateChange={setSampleInteraction} onSelect={(id) => {
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
      <div className="proc-horizon proc-horizon-cockpit-shell h-full min-w-0 w-full">
        <div className="proc-horizon-layout flex h-full min-h-0 flex-col">
          {canOpenWorkspace && workspaceReturn && <div><Button type="button" variant="ghost" onClick={() => navigate(workspaceReturn)} className="min-h-10 gap-1.5"><ArrowLeft className="size-4" aria-hidden="true" />{t("返回采购工作台")}</Button></div>}
          {cockpitTabs}
          <StockPlanPanel materials={materials} canCreate={canCreate} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("proc-horizon proc-horizon-cockpit-shell min-w-0 w-full", view === "systems" ? "h-full" : "min-h-full")}>
      <div className={cn("proc-horizon-layout flex min-h-0 flex-col", view === "systems" ? "h-full" : "min-h-full")}>
      {cockpitTabs}
      {/* Horizon 指挥区：业务范围、全局操作与 KPI 共用一个信息焦点。 */}
      {view === "tasks" && (
        <section className="proc-horizon-command proc-horizon-command-cockpit mb-3">
          <div className="proc-horizon-command-layout">
            <div className="proc-horizon-command-heading">
              <div className="proc-horizon-command-copy">
                <h2 className="text-balance">{t("任务概览")}</h2>
                {treeNode ? (
                  <p className="text-pretty">{t("当前聚焦「{name}」，共 {count} 个任务", { name: treeNode.name, count: treeScopedTasks.length })}</p>
                ) : null}
              </div>
            </div>

            <div className="proc-horizon-actions">
              <button type="button" aria-label={t("子系统全景")} title={t("子系统全景")} onClick={() => setView("systems")} className="material-button-secondary inline-flex items-center gap-1.5 text-xs">
                <Layers3 className="size-4" /><span className="proc-horizon-action-label">{t("子系统全景")}</span>
              </button>
              <button
                type="button"
                aria-label={coreConfigError ? t("核心配件配置加载失败，打开查看详情") : t("核心配件")}
                title={coreConfigError ? t("核心配件配置加载失败，打开后可重试") : t("核心配件")}
                onClick={() => setCoreMode(true)}
                className="material-button-secondary inline-flex items-center gap-1.5 text-xs"
              >
                <PackageSearch className="size-4" /><span className="proc-horizon-action-label">{t("核心配件")}</span>
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">{coreConfigLoading ? "—" : coreInventorySummary.total}</span>
                {coreConfigError ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700"><AlertTriangle className="size-3" />{t("配置异常")}</span>
                ) : coreInventorySummary.abnormal > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 text-[10px] tabular-nums text-rose-700"><AlertTriangle className="size-3" />{t("异常")} {coreInventorySummary.abnormal}</span>
                ) : null}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="material-button-secondary inline-flex items-center gap-1.5 text-xs">
                    <MoreHorizontal className="size-4" />{t("更多")}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="proc-horizon-menu min-w-48 rounded-xl border-slate-200 p-1.5 shadow-lg data-[state=open]:animate-none data-[state=closed]:animate-none">
                  <DropdownMenuItem
                    onSelect={() => {
                      void exportProcTasksXlsx(filtered)
                        .then((count) => toast.success(t('已导出 {count} 个任务', { count })))
                        .catch((err) => toast.error(err instanceof Error ? err.message : t('导出失败')));
                    }}
                  ><Download className="size-4" />{t('导出当前列表')}</DropdownMenuItem>
                  {canOrder && <DropdownMenuItem onSelect={() => setPoMatchOpen(true)}><Truck className="size-4" />{t('单据匹配')}</DropdownMenuItem>}
                  {(canOrder || canReassign || canCreate) && <DropdownMenuSeparator />}
                  {canReassign && <DropdownMenuItem onSelect={() => setBatchOpen(true)}><Users className="size-4" />{t('批量转派')}</DropdownMenuItem>}
                  {(canCreate || canReassign) && <DropdownMenuItem onSelect={() => setBatchMoveOpen(true)}><FolderTree className="size-4" />{t('批量归类')}</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => navigate('/proc-people-management')}><UserCog className="size-4" />{t('人员管理')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canCreate && <button type="button" onClick={() => setNewOpen(true)} className="proc-horizon-primary-action inline-flex items-center gap-1.5 text-xs"><Plus className="size-4" />{t('新建需求')}</button>}
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
            coreMode={coreMode}
            coreMaterialsByProduct={coreMaterialConfig.products}
            coreMaterialLimit={coreMaterialConfig.maxItems}
            coreConfigLoading={coreConfigLoading}
            coreConfigError={coreConfigError}
            onRetryCoreConfig={() => void loadCoreMaterialConfig()}
            onCoreModeChange={setCoreMode}
            onSaveCoreMaterials={saveCoreMaterials}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
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
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input aria-label={t('搜索采购任务')} value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t('搜索单号 / 物料 / 人员')} className="pl-8 pr-8 text-xs placeholder:text-slate-400" />
          {kw && (
            <button type="button" aria-label={t('清空搜索')} onClick={() => setKw("")} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="proc-horizon-task-feed flex min-h-0 flex-1 flex-col">
      <div className="proc-horizon-filter-bar">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-semibold text-slate-500">{t("当前任务流")}</span>
          {stat && (
            <button type="button" onClick={() => setStat(null)} aria-label={t("移除状态筛选：{status}", { status: t(STAT_LABELS[stat]) })} className="proc-horizon-filter-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t(STAT_LABELS[stat])} ×
            </button>
          )}
          {treeNode && (
            <Button type="button" variant="outline" size="sm" onClick={() => setTreeNode(null)} className="proc-horizon-filter-chip h-auto">
              {t("系统")}：<AutoTranslatedText text={treeNode.name} /> ×
            </Button>
          )}
          {materialParam && (
            <button type="button" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("material"); return n; }, { replace: true })} aria-label={t("移除物料筛选：{material}", { material: materialParam })} className="proc-horizon-filter-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t('物料')}：<AutoTranslatedText text={materialParam} /> ×
            </button>
          )}
        </div>
        <span className="shrink-0 font-semibold tabular-nums text-slate-500">{t("显示 {count} 个任务", { count: filtered.length })}</span>
      </div>

      {/* 任务展示区 */}
        <div ref={setTaskStreamElement} className="proc-horizon-task-scroll">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-rose-200 bg-rose-50/40 px-4 py-12 text-center text-sm text-rose-700">
              <AlertTriangle className="size-7 text-rose-500" />
              <div>
                <p className="font-semibold">{t("采购任务加载失败")}</p>
                <p className="mt-1 max-w-xl text-pretty text-xs text-rose-600">{error}</p>
              </div>
              <button type="button" onClick={() => void refreshProcurement()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</button>
            </div>
          ) : loading && tasks.length === 0 ? (
            <div aria-label={t("正在加载采购任务")} className="proc-horizon-task-masonry">
              {Array.from({ length: masonryColumns }, (_, item) => (
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
              <ClipboardList className="size-7 text-slate-300" />
              <p className="text-pretty text-sm font-medium text-slate-600">{t(hasActiveFilters ? '没有符合条件的任务' : '当前还没有采购任务')}</p>
              {hasActiveFilters ? (
                <button type="button" onClick={clearFilters} className="material-button-secondary px-3 py-2 text-xs">{t("清除筛选")}</button>
              ) : canCreate ? (
                <button type="button" onClick={() => setNewOpen(true)} className="material-button-primary px-3 py-2 text-xs">{t("新建需求")}</button>
              ) : null}
            </div>
          ) : (
              <>
                <div className="proc-horizon-task-masonry">
                  {distributeIntoColumns(visibleTasks, masonryColumns).map((column, columnIndex) => (
                    <div key={columnIndex} className="proc-horizon-task-masonry-column">
                      {column.map((task) => (
                        <ProcurementTaskCard
                          key={task.id}
                          task={task}
                          materials={materials}
                          onOpen={setOpen}
                          onNext={(nextTask) => taskAction.runNext(nextTask, "card")}
                          onReassign={taskAction.reassign}
                          onRemove={taskAction.remove}
                          onOverlayOpenChange={onTaskOverlayOpenChange}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {visibleCount < filtered.length ? (
                  <div ref={setSentinelElement} className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                    <span className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary motion-reduce:animate-none" />
                    {t('下拉加载更多')}（{visibleCount} / {filtered.length}）
                  </div>
                ) : filtered.length > WATERFALL_PAGE_SIZE ? (
                  <div className="py-4 text-center text-xs text-slate-400">{t('已加载全部')} {filtered.length} {t('个任务')}</div>
                ) : null}
              </>
            )}
        </div>

      </div>

        </section>
      </div>
      )}

      {open && <TaskDetailDrawer task={open} onClose={() => { setOpen(null); if (taskParam) setParams((p) => { const n = new URLSearchParams(p); n.delete("task"); return n; }, { replace: true }); }} />}
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
