import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, PackageCheck, RefreshCw, Search, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../components/ui/utils";
import { useI18n } from "../lib/i18n";
import { routePath } from "../lib/routePaths";
import { buildPurchaseOrderLinePath } from "../lib/purchaseOrderLineNavigation";
import { buildWorkspaceArrivalReturnPath, parseWorkspaceArrivalView } from "../lib/workspaceArrivalNavigation";
import { workspaceArrivals, type WorkspaceArrival } from "./procurementWorkspaceModel";
import { daysFromToday, isProcurementTaskOverdue, refreshProcurement, useProcurementData, useProcurementProducts, type ProcStatus, type ProcurementTask } from "./data";
import { isProcurementTaskAssignedToUser } from "./procurementLogic";
import { filterWorkspaceTasks, sortWorkspaceTasks, uniqueWorkspaceTasks, UNDETERMINED_SUPPLIER, workspacePeriod, workspaceSuppliers, type WorkspacePeriod, type WorkspaceSort } from "./procurementWorkspaceModel";
import { PROC_STATUS_META, StatCell, useProcCan } from "./components/common";
import { ProcWorkspaceArrivals } from "./components/ProcWorkspaceArrivals";
import { ProcWorkspaceTaskList } from "./components/ProcWorkspaceTaskList";
import { ProcWorkspaceTaskPanel } from "./components/ProcWorkspaceTaskPanel";
import { ProcWorkspaceAggregation, type WorkspacePlanOptions } from "./components/ProcWorkspaceAggregation";
import type { WorkspaceBusiness } from "./procurementAggregationModel";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { ProcurementDeliverySchedule } from "./delivery/ProcurementDeliverySchedule";
import { useProcTaskAction } from "./components/taskActions";
import "./procurementWorkspace.css";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const PERIODS: Array<[WorkspacePeriod, string]> = [["month", "所选月需求"], ["carryover", "跨月未完成"], ["undated", "日期待确认"], ["all", "全部进行中"]];
const SORTS: Array<[WorkspaceSort, string]> = [["urgent", "逾期优先"], ["date", "期限由近到远"], ["priority", "优先级由高到低"]];
const PAGE_SIZE = 20;
type Focus = "all" | "pending" | "overdue" | "week";

function thisMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function arrivingThisWeek(task: ProcurementTask) {
  const days = daysFromToday(task.expectedArrivalDate);
  return ["in_transit", "partial_arrival"].includes(task.status) && days != null && days >= 0 && days <= 7;
}

export function ProcMyWorkspacePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const can = useProcCan();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { tasks, materials, loading, error } = useProcurementData();
  const products = useProcurementProducts();
  const [defaultMonth] = useState(thisMonth);
  const pageRef = useRef<HTMLDivElement>(null);
  const panelFocusRef = useRef<HTMLDivElement>(null);
  const [panelFocusRequest, setPanelFocusRequest] = useState<{ id: string } | null>(null);
  const [compact, setCompact] = useState(true);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [detail, setDetail] = useState<{ id: string; action?: "rollback" | "logs" } | null>(null);
  const [planOptions, setPlanOptions] = useState<WorkspacePlanOptions | null>(null);
  const openDetail = (task: ProcurementTask, action?: "rollback" | "logs") => setDetail({ id: task.id, action });
  const taskAction = useProcTaskAction({ onOpenDetail: openDetail });
  const monthParam = params.get("month") || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : defaultMonth;
  const period = (PERIODS.some(([value]) => value === params.get("period")) ? params.get("period") : "month") as WorkspacePeriod;
  const productId = params.get("product") || "all";
  const supplier = params.get("supplier") || "all";
  const status: ProcStatus | "all" = ACTIVE_STATUSES.includes(params.get("status") as ProcStatus) ? params.get("status") as ProcStatus : "all";
  const query = params.get("q") || "";
  const business = (["sample", "stock", "arrival"].includes(params.get("source") || "") ? params.get("source") : "purchase") as WorkspaceBusiness;
  const focus = (["pending", "overdue", "week"].includes(params.get("focus") || "") ? params.get("focus") : "all") as Focus;
  const sort = (SORTS.some(([value]) => value === params.get("sort")) ? params.get("sort") : "urgent") as WorkspaceSort;
  const selectedId = params.get("task");
  const requestedPage = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const arrivalsOpen = params.get("arrivals") === "open";
  const requestedArrivalPage = Number(params.get("arrivalPage"));
  const arrivalPage = Number.isSafeInteger(requestedArrivalPage) && requestedArrivalPage > 0 ? requestedArrivalPage : 1;
  const arrivalFocus = params.get("arrivalFocus") || undefined;
  const arrivalSettings = parseWorkspaceArrivalView(params, month);
  const arrivalScope = JSON.stringify([user?.id, month, period, productId, supplier, status, query, focus, sort, arrivalSettings]);
  const refreshedReturn = useRef<string | null>(null);

  useEffect(() => {
    if (!arrivalFocus || refreshedReturn.current === location.key) return;
    refreshedReturn.current = location.key;
    void refreshProcurement();
  }, [arrivalFocus, location.key]);

  useEffect(() => {
    if (!pageRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 896));
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, []);
  const mine = useMemo(() => uniqueWorkspaceTasks(tasks).filter((task) => isProcurementTaskAssignedToUser(task, user)), [tasks, user?.id, user?.name]);
  const active = useMemo(() => mine.filter((task) => ACTIVE_STATUSES.includes(task.status)), [mine]);
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const availablePlanOptions = can("page:proc-cockpit") && planOptions?.userKey === JSON.stringify(user) ? planOptions : null;
  const productOptions = useMemo(() => [...new Set([...mine.map((task) => task.productId).filter(Boolean), ...(availablePlanOptions?.products ?? [])])].map((id) => ({ value: id, label: productNames.get(id) || id })), [mine, productNames, availablePlanOptions]);
  const supplierOptions = useMemo(() => [...new Set([...mine.flatMap(workspaceSuppliers), ...(availablePlanOptions?.suppliers ?? [])])].sort((a, b) => a.localeCompare(b, "zh-CN")).map((name) => ({ value: name, label: name })), [mine, availablePlanOptions]);
  const commonScope = useMemo(() => filterWorkspaceTasks(active, { month, period: "all", productId, supplier, status, query }), [active, month, productId, supplier, status, query]);
  const exceptionScope = useMemo(() => filterWorkspaceTasks(active, { month, period: "all", productId, supplier, status: "all", query: "" }), [active, month, productId, supplier]);
  const periodCounts = useMemo(() => ({ month: commonScope.filter((task) => workspacePeriod(task, month) === "month").length, carryover: exceptionScope.filter((task) => workspacePeriod(task, month) === "carryover").length, undated: exceptionScope.filter((task) => workspacePeriod(task, month) === "undated").length, all: commonScope.length }), [commonScope, exceptionScope, month]);
  const scoped = useMemo(() => filterWorkspaceTasks(commonScope, { month, period, productId: "all", supplier: "all", status: "all", query: "" }), [commonScope, month, period]);
  const counts = useMemo(() => ({ all: scoped.length, pending: scoped.filter((task) => task.status === "pending_confirm").length, overdue: scoped.filter(isProcurementTaskOverdue).length, week: scoped.filter(arrivingThisWeek).length }), [scoped]);
  const filtered = useMemo(() => sortWorkspaceTasks(scoped.filter((task) => focus === "all" || (focus === "pending" ? task.status === "pending_confirm" : focus === "overdue" ? isProcurementTaskOverdue(task) : arrivingThisWeek(task))), sort), [scoped, focus, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const visibleTasks = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = selectedId ? mine.find((task) => task.id === selectedId) ?? null : null;
  const detailTask = detail ? mine.find((task) => task.id === detail.id) : null;
  const isInitialLoading = loading && tasks.length === 0;
  const metricsUnknown = isInitialLoading || Boolean(error && !tasks.length);
  const blocked = taskAction.busy || loading || Boolean(error);
  const latestArrivalView = useRef({ scope: arrivalScope, blocked, filtered, open: arrivalsOpen, page: arrivalPage, focusKey: arrivalFocus, canOpenOrder: can("page:purchase-order-detail") });
  latestArrivalView.current = { scope: arrivalScope, blocked, filtered, open: arrivalsOpen, page: arrivalPage, focusKey: arrivalFocus, canOpenOrder: can("page:purchase-order-detail") };
  const hasFilters = period !== "all" || productId !== "all" || supplier !== "all" || status !== "all" || Boolean(query.trim()) || focus !== "all";
  const firstId = filtered[0]?.id;
  // Persist the initial task in the route; an explicitly missing task never switches silently.
  useEffect(() => {
    if (selectedId || !firstId || loading || error) return;
    setParams((current) => {
      if (current.get("task")) return current;
      const next = new URLSearchParams(current);
      next.set("task", firstId);
      next.set("month", month);
      return next;
    }, { replace: true });
  }, [selectedId, firstId, loading, error, month, setParams]);

  // Only an explicit view request moves focus, after the selected detail has committed.
  // Inline workflow actions open their own dialogs and must keep that dialog's focus.
  useEffect(() => {
    if (!panelFocusRequest || panelFocusRequest.id !== selectedId || (compact && !panelExpanded)) return;
    setPanelFocusRequest(null);
    if (blocked || detail || taskAction.modal) return;
    panelFocusRef.current?.focus({ preventScroll: true });
    if (compact) panelFocusRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [panelFocusRequest, selectedId, compact, panelExpanded, blocked, detail, taskAction.modal]);

  const updateFilters = (patch: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set("month", month);
    next.delete("page");
    if (Object.keys(patch).some((key) => ["month", "period", "product", "supplier", "status", "q", "focus", "sort"].includes(key))) {
      next.delete("arrivalPage");
      next.delete("arrivalFocus");
      next.delete("arrivalDay");
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    return next;
  }, { replace: true });
  const selectTask = (id: string, options: { focusDetail?: boolean } = {}) => {
    if (blocked) return;
    const index = filtered.findIndex((task) => task.id === id);
    const selectedPage = index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : page;
    updateFilters({ task: id, page: String(selectedPage) });
    setPanelExpanded(true);
    setPanelFocusRequest(options.focusDetail === false ? null : { id });
  };
  const clearFilters = () => updateFilters({ product: null, supplier: null, status: null, q: null, focus: null, period: "all" });
  const setFocus = (next: Focus) => updateFilters({ focus: next === focus || next === "all" ? null : next });
  const navigateRelated = (path: string) => navigate(path, {
    state: { procurementWorkspaceReturn: `${routePath("page:proc-my-workspace", "/proc-my-workspace")}?${params.toString()}` },
  });
  const updateArrivalView = (patch: Record<string, string | null>) => {
    if (latestArrivalView.current.scope !== arrivalScope || latestArrivalView.current.blocked) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
  };
  const openArrivalOrder = (row: WorkspaceArrival, target: { orderNo: string; lineId: string }) => {
    const current = latestArrivalView.current;
    if (current.scope !== arrivalScope || current.blocked || !current.canOpenOrder || !current.open || current.page !== arrivalPage) return;
    if (!workspaceArrivals(current.filtered).some((item) => item.key === row.key && item.taskId === row.taskId && item.orderId === row.orderId)) return;
    const index = current.filtered.findIndex((task) => task.id === row.taskId);
    if (index < 0) return;
    const sourceParams = new URLSearchParams(params);
    sourceParams.set("month", month);
    sourceParams.set("arrivalView", arrivalSettings.view);
    sourceParams.set("arrivalMonth", arrivalSettings.month);
    sourceParams.set("arrivalDay", arrivalSettings.selection);
    const source = buildWorkspaceArrivalReturnPath(sourceParams, { taskId: row.taskId, rowKey: row.key, taskPage: Math.floor(index / PAGE_SIZE) + 1, arrivalPage });
    const destination = buildPurchaseOrderLinePath(target.orderNo, target.lineId);
    if (!source || !destination) return;
    navigate(source, { replace: true });
    navigate(destination, { state: { workspaceArrivalReturnTo: source, workspaceArrivalHistoryBack: true } });
  };

  return <div ref={pageRef} className="proc-horizon proc-workspace-page proc-s01-page mx-auto w-full min-w-0 max-w-[1600px] space-y-4 pb-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-balance text-xl font-semibold text-foreground">{t("采购工作台")}</h1><p className="mt-1 text-pretty text-sm text-muted-foreground">{t("按需求月份和期限，推进分配给你的采购任务。")}</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={loading || taskAction.busy} onClick={() => void refreshProcurement()} className="min-h-10 gap-1.5"><RefreshCw className="size-4" aria-hidden="true" />{t("刷新")}</Button>{can("page:proc-cockpit") && <Button type="button" variant="outline" disabled={taskAction.busy} onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="min-h-10 gap-1.5">{t("查看采购驾驶舱")}<ArrowUpRight className="size-4" aria-hidden="true" /></Button>}</div>
    </header>
    <section aria-label={t("我的采购任务筛选")} className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="proc-s01-filters">
        <label className="min-w-0"><span className="mb-1.5 block text-xs text-muted-foreground">{t("需求月份")}</span><Input type="month" aria-label={t("需求月份")} value={month} disabled={taskAction.busy} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) updateFilters({ month: event.target.value, period: "month", focus: null }); }} className="min-h-10 w-full text-sm" /></label>
        <WorkspaceSelect label={t("产品")} value={productId} disabled={taskAction.busy} onChange={(value) => updateFilters({ product: value, focus: null })} options={[{ value: "all", label: t("全部产品") }, ...productOptions]} />
        <WorkspaceSelect label={t("供应商")} value={supplier} disabled={taskAction.busy} onChange={(value) => updateFilters({ supplier: value, focus: null })} options={[{ value: "all", label: t("全部供应商") }, { value: UNDETERMINED_SUPPLIER, label: t("未确定") }, ...supplierOptions]} />
        <WorkspaceSelect label={t("状态")} value={status} disabled={taskAction.busy} onChange={(value) => updateFilters({ status: value, focus: null })} options={[{ value: "all", label: t("全部进行中状态") }, ...ACTIVE_STATUSES.map((value) => ({ value, label: t(PROC_STATUS_META[value].label) }))]} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><div className="relative min-w-0 flex-1 basis-72"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={t("搜索我的采购任务")} value={query} disabled={taskAction.busy} onChange={(event) => updateFilters({ q: event.target.value })} placeholder={t("搜索任务、物料、规格、供应商或采购单号")} className="min-h-10 pl-9 pr-10" />{query && <Button type="button" variant="ghost" size="icon" disabled={taskAction.busy} aria-label={t("清空搜索")} onClick={() => updateFilters({ q: null })} className="absolute right-1 top-1 size-8"><X className="size-4" aria-hidden="true" /></Button>}</div>{hasFilters && <Button type="button" variant="ghost" disabled={taskAction.busy} onClick={clearFilters} className="min-h-10 text-xs">{t("清除筛选")}</Button>}</div>
      <Tabs value={period} onValueChange={(value) => updateFilters({ period: value, focus: null, ...(["carryover", "undated"].includes(value) ? { status: null, q: null } : {}) })} className="mt-3"><TabsList aria-label={t("按需求月份查看任务")} className="proc-s01-periods">{PERIODS.map(([value, label]) => <TabsTrigger key={value} value={value} disabled={taskAction.busy} className="min-h-10 gap-1.5 text-xs">{t(label)}<span className="tabular-nums">{isInitialLoading || (error && !tasks.length) ? "—" : periodCounts[value]}</span></TabsTrigger>)}</TabsList></Tabs>
      <p className="mt-2 text-pretty text-xs text-muted-foreground">{t(period === "carryover" ? "显示需求月份早于所选月、仍未完成的任务。" : period === "undated" ? "这些任务尚未填写有效需求日期，请在任务详情中核对。" : period === "all" ? "显示本人全部进行中任务，包含未来需求与未填写日期的任务。" : "按任务需求日期归月，跨月未完成和未填日期的任务可单独查看。")}</p>
    </section>
    <ProcWorkspaceAggregation tasks={mine} month={month} productId={productId} supplier={supplier} loading={loading} error={error} disabled={taskAction.busy} onSelectTask={selectTask} onNavigate={navigateRelated} onPlanOptions={setPlanOptions} selectedBusiness={business} onBusinessChange={(nextBusiness) => setParams((current) => { const next = new URLSearchParams(current); next.set("month", month); if (nextBusiness === "purchase") next.delete("source"); else next.set("source", nextBusiness); return next; }, { replace: true })} />
    <div role="group" aria-label={t("我的采购任务概览")} className="proc-workspace-stats proc-horizon-kpi-grid proc-horizon-surface rounded-xl border border-border bg-card">
      <StatCell label={t("当前范围")} value={metricsUnknown ? "—" : counts.all} Icon={Activity} active={focus === "all"} onClick={() => !taskAction.busy && setFocus("all")} />
      <StatCell label={t("待处理")} value={metricsUnknown ? "—" : counts.pending} Icon={ClipboardList} active={focus === "pending"} onClick={() => !taskAction.busy && setFocus("pending")} />
      <StatCell label={t("已逾期")} value={metricsUnknown ? "—" : counts.overdue} tone="red" Icon={AlertTriangle} active={focus === "overdue"} onClick={() => !taskAction.busy && setFocus("overdue")} />
      <StatCell label={t("未来7天到货")} value={metricsUnknown ? "—" : counts.week} tone="emerald" Icon={PackageCheck} active={focus === "week"} onClick={() => !taskAction.busy && setFocus("week")} />
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><div><p className="font-semibold">{t("我的采购任务加载失败")}</p><p className="mt-1 break-words text-pretty">{error}</p></div><Button type="button" variant="outline" disabled={loading || taskAction.busy} onClick={() => void refreshProcurement()}>{t("重新加载")}</Button></div>}
    <div className="proc-s01-layout">
      <section className="proc-s01-list min-w-0 space-y-3" aria-label={t("采购任务列表")}>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-balance text-base font-semibold text-foreground">{t("我的采购任务")}</h2><p className="mt-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">{isInitialLoading ? t("正在加载我的采购任务") : t("显示 {count} 个任务", { count: filtered.length })}</p></div><WorkspaceSelect label={t("排序")} value={sort} disabled={taskAction.busy} onChange={(value) => updateFilters({ sort: value })} options={SORTS.map(([value, label]) => ({ value, label: t(label) }))} compact /></div>
        {isInitialLoading ? <div role="status" aria-label={t("正在加载我的采购任务")} className="min-h-52 space-y-3 rounded-xl border border-border bg-card p-4">{[0, 1, 2, 3].map((item) => <div key={item} className="flex h-16 items-center gap-3 border-b border-border"><div className="size-10 rounded-lg bg-muted" /><div className="h-4 w-2/3 rounded bg-muted" /></div>)}</div> : filtered.length ? <>
          <ProcWorkspaceTaskList tasks={visibleTasks} materials={materials} selectedId={selectedId} disabled={blocked} onSelect={selectTask} onNext={(task) => { if (blocked) return; selectTask(task.id, { focusDetail: false }); taskAction.runNext(task, "card"); }} />
          {pageCount > 1 && <Pagination aria-label={t("采购任务分页")} className="justify-end"><PaginationContent><PaginationItem><Button type="button" variant="outline" size="sm" disabled={page === 1 || taskAction.busy} onClick={() => updateFilters({ page: String(page - 1) })} aria-label={t("上一页")}><ChevronLeft className="size-4" aria-hidden="true" /></Button></PaginationItem><PaginationItem><span className="px-2 text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span></PaginationItem><PaginationItem><Button type="button" variant="outline" size="sm" disabled={page === pageCount || taskAction.busy} onClick={() => updateFilters({ page: String(page + 1) })} aria-label={t("下一页")}><ChevronRight className="size-4" aria-hidden="true" /></Button></PaginationItem></PaginationContent></Pagination>}
        </> : !error && <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-6 text-center"><ClipboardList className="size-7 text-muted-foreground" aria-hidden="true" /><h3 className="text-balance text-sm font-semibold">{t(active.length ? "没有符合筛选条件的任务" : "当前没有需要推进的采购任务")}</h3><p className="text-pretty text-sm text-muted-foreground">{t(active.length ? "可以查看跨月未完成、日期待确认，或清除筛选。" : "分配给你的未完成任务会显示在这里。")}</p>{active.length ? <Button type="button" variant="outline" onClick={clearFilters}>{t("清除筛选")}</Button> : <Button type="button" variant="outline" disabled={loading} onClick={() => void refreshProcurement()}>{t("重新加载")}</Button>}</div>}
        {!isInitialLoading && <ProcWorkspaceArrivals tasks={filtered} onSelect={selectTask} disabled={blocked}
          open={arrivalsOpen} onOpenChange={(open) => updateArrivalView({ arrivals: open ? "open" : null, arrivalFocus: null })}
          page={arrivalPage} onPageChange={(next) => { if (latestArrivalView.current.page === arrivalPage) updateArrivalView({ arrivalPage: String(next), arrivalFocus: null }); }}
          onRestorePage={(next) => { if (latestArrivalView.current.focusKey === arrivalFocus) updateArrivalView({ arrivalPage: String(next) }); }}
          scopeKey={arrivalScope} focusKey={arrivalFocus}
          view={arrivalSettings.view} calendarMonth={arrivalSettings.month} selection={arrivalSettings.selection}
          onViewChange={(patch) => updateArrivalView({ arrivalView: patch.view ?? arrivalSettings.view,
            arrivalMonth: patch.month ?? arrivalSettings.month, arrivalDay: patch.selection ?? arrivalSettings.selection,
            arrivalPage: "1", arrivalFocus: null })}
          onRestoreRange={(next) => updateArrivalView({ arrivalDay: "all", arrivalPage: String(next) })}
          onFocusHandled={(key) => { if (key === arrivalFocus && latestArrivalView.current.focusKey === key) updateArrivalView({ arrivalFocus: null }); }}
          onOpenOrderLine={openArrivalOrder} />}
      </section>
      <Collapsible open={!compact || panelExpanded} onOpenChange={setPanelExpanded} className="proc-s01-panel min-w-0 self-start" id="proc-workspace-current-task">
        <CollapsibleTrigger asChild><Button type="button" variant="outline" className="proc-s01-panel-toggle min-h-11 h-auto w-full justify-between gap-2 whitespace-normal text-left"><span className="min-w-0"><span className="block text-xs text-muted-foreground">{t("当前任务")}</span><span className="line-clamp-1">{selected?.materialName || t("选择任务查看详情")}</span></span><ChevronDown className={cn("size-4 shrink-0", panelExpanded && "rotate-180")} aria-hidden="true" /></Button></CollapsibleTrigger>
        <CollapsibleContent>
          <div ref={panelFocusRef} id="proc-workspace-task-detail" tabIndex={-1} role="region" aria-label={t("任务详情：{name}", { name: selected ? `${selected.materialName} · ${selected.code}` : t("当前任务") })} className="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {selected && !filtered.some((task) => task.id === selected.id) && <p className="mb-2 rounded-lg border border-border bg-muted p-3 text-pretty text-xs text-muted-foreground">{t("当前查看的任务不在筛选结果中，详情仍保留。")}</p>}
          {selectedId && !selected && !isInitialLoading ? <div role="status" className="rounded-xl border border-border bg-card p-4"><h3 className="text-balance text-sm font-semibold">{t("此任务暂不可用")}</h3><p className="mt-2 text-pretty text-xs text-muted-foreground">{t("任务可能已转派、删除或不在当前账号范围，请从列表重新选择。")}</p>{firstId && <Button type="button" variant="outline" disabled={blocked} className="mt-3" onClick={() => selectTask(firstId)}>{t("查看列表首项")}</Button>}</div> : <ProcWorkspaceTaskPanel task={selected} blocked={blocked} onOpenDetail={openDetail} onNext={(task) => { if (!blocked) taskAction.runNext(task, "card"); }} onReassign={taskAction.reassign} onRemove={taskAction.remove} onNavigateRelated={navigateRelated} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
    <ProcurementDeliverySchedule />
    {detailTask && <TaskDetailDrawer key={detailTask.id} task={detailTask} initialAction={detail?.action} onClose={() => setDetail(null)} onNavigateRelated={navigateRelated} />}
    {taskAction.modal}
  </div>;
}

function WorkspaceSelect({ label, value, options, onChange, disabled, compact = false }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={cn("min-w-0", compact && "w-40")}><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} className="min-h-10 w-full"><SelectValue /></SelectTrigger><SelectContent>{!options.some((option) => option.value === value) && <SelectItem value={value}>{value}</SelectItem>}{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}
