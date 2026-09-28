import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock, AlertTriangle, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth";
import { MateChatStreakCardConnected } from "../components/matechat/MateChatStreakCardConnected";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "../components/ui/utils";
import { useI18n } from "../lib/i18n";
import { routePath } from "../lib/routePaths";
import { isProcurementTaskOverdue, refreshProcurement, useProcurementData, useProcurementProducts, type ProcStatus, type ProcurementTask } from "./data";
import { isProcurementTaskAssignedToUser } from "./procurementLogic";
import { filterWorkspaceTasks, sortWorkspaceTasks, uniqueWorkspaceTasks, UNDETERMINED_SUPPLIER, workspaceSuppliers, type WorkspaceSort } from "./procurementWorkspaceModel";
import { PROC_STATUS_META, PersonAvatar, StatCell, useProcCan } from "./components/common";
import { ProcWorkspaceTaskList } from "./components/ProcWorkspaceTaskList";
import { ProcurementTaskDetailPage } from "./components/ProcurementTaskDetailPage";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { useProcTaskAction } from "./components/taskActions";
import "./procurementWorkspace.css";

const ACTIVE_STATUSES: ProcStatus[] = ["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"];
const SORTS: Array<[WorkspaceSort, string]> = [["urgent", "逾期优先"], ["date", "期限由近到远"], ["priority", "优先级由高到低"]];
const PAGE_SIZE = 20;
type Focus = "all" | "pending" | "overdue" | "waiting";
const TASK_STATUSES: ProcStatus[] = [...ACTIVE_STATUSES, "completed", "cancelled"];
const RETIRED_PARAMS = ["month", "period", "source", "arrivals", "arrivalPage", "arrivalFocus", "arrivalDay", "arrivalMonth", "arrivalView"];

export function ProcMyWorkspacePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const can = useProcCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { tasks, materials, loading, error } = useProcurementData();
  const products = useProcurementProducts();
  const pageRef = useRef<HTMLDivElement>(null);
  const panelFocusRef = useRef<HTMLDivElement>(null);
  const [panelFocusRequest, setPanelFocusRequest] = useState<{ id: string } | null>(null);
  const [compact, setCompact] = useState(true);
  const [detailDismissed, setDetailDismissed] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [detail, setDetail] = useState<{ id: string; action?: "rollback" | "logs" } | null>(null);
  const openDetail = (task: ProcurementTask, action?: "rollback" | "logs") => {
    if (action) { setDetail({ id: task.id, action }); return; }
    setParams(current => { const next = new URLSearchParams(current); next.set("task", task.id); next.set("detail", "1"); return next; });
  };
  const taskAction = useProcTaskAction({ onOpenDetail: openDetail });
  const businessLine = ["production", "rd"].includes(params.get("business") || "") ? params.get("business")! : "all";
  const productId = params.get("product") || "all";
  const supplier = params.get("supplier") || "all";
  const status: ProcStatus | "all" = TASK_STATUSES.includes(params.get("status") as ProcStatus) ? params.get("status") as ProcStatus : "all";
  const query = params.get("q") || "";
  const focus = (["pending", "overdue", "waiting"].includes(params.get("focus") || "") ? params.get("focus") : "all") as Focus;
  const sort = (SORTS.some(([value]) => value === params.get("sort")) ? params.get("sort") : "urgent") as WorkspaceSort;
  const selectedId = params.get("task");
  const requestedPage = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  useEffect(() => {
    if (!RETIRED_PARAMS.some(key => params.has(key)) && params.get("focus") !== "week") return;
    setParams(current => {
      const next = new URLSearchParams(current);
      RETIRED_PARAMS.forEach(key => next.delete(key));
      if (next.get("focus") === "week") next.delete("focus");
      return next;
    }, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!pageRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 896));
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [params.get("detail")]);
  const mine = useMemo(() => uniqueWorkspaceTasks(tasks).filter((task) => isProcurementTaskAssignedToUser(task, user)), [tasks, user?.id, user?.name]);
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const productOptions = useMemo(() => [...new Set(mine.map(task => task.productId).filter(Boolean))].map(id => ({ value: id, label: productNames.get(id) || id })), [mine, productNames]);
  const supplierOptions = useMemo(() => [...new Set(mine.flatMap(workspaceSuppliers))].sort((a, b) => a.localeCompare(b, "zh-CN")).map(name => ({ value: name, label: name })), [mine]);
  const scoped = useMemo(() => filterWorkspaceTasks(mine.filter(task => businessLine === "all" || task.businessLine === businessLine), { month: "", period: "all", productId, supplier, status, query }), [mine, businessLine, productId, supplier, status, query]);
  const counts = useMemo(() => ({ all: scoped.length, pending: scoped.filter((task) => ["pending_confirm", "pending_inquiry", "pending_purchase", "priced"].includes(task.status)).length, overdue: scoped.filter(isProcurementTaskOverdue).length, waiting: scoped.filter(task => ["pending_rd_review", "pending_sample", "testing"].includes(task.status)).length }), [scoped]);
  const filtered = useMemo(() => sortWorkspaceTasks(scoped.filter((task) => focus === "all" || (focus === "pending" ? ["pending_confirm", "pending_inquiry", "pending_purchase", "priced"].includes(task.status) : focus === "overdue" ? isProcurementTaskOverdue(task) : ["pending_rd_review", "pending_sample", "testing"].includes(task.status))), sort), [scoped, focus, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const visibleTasks = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = selectedId ? mine.find((task) => task.id === selectedId) ?? null : null;
  const detailTask = detail ? mine.find((task) => task.id === detail.id) : null;
  const isInitialLoading = loading && tasks.length === 0;
  const metricsUnknown = isInitialLoading || Boolean(error && !tasks.length);
  const blocked = taskAction.busy || loading || Boolean(error);
  const hasFilters = businessLine !== "all" || productId !== "all" || supplier !== "all" || status !== "all" || Boolean(query.trim()) || focus !== "all";
  const firstId = filtered[0]?.id;
  // Persist the initial task in the route; an explicitly missing task never switches silently.
  useEffect(() => {
    if (selectedId || !firstId || loading || error) return;
    setParams((current) => {
      if (current.get("task")) return current;
      const next = new URLSearchParams(current);
      next.set("task", firstId);
      return next;
    }, { replace: true });
  }, [selectedId, firstId, loading, error, setParams]);

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
    next.delete("page");
    RETIRED_PARAMS.forEach(key => next.delete(key));
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    return next;
  }, { replace: true });
  const selectTask = (id: string, options: { focusDetail?: boolean } = {}) => {
    if (blocked) return;
    setDetailDismissed(false);
    const index = filtered.findIndex((task) => task.id === id);
    const selectedPage = index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : page;
    updateFilters({ task: id, page: String(selectedPage) });
    setPanelExpanded(true);
    setPanelFocusRequest(options.focusDetail === false ? null : { id });
  };
  const clearFilters = () => updateFilters({ business: null, product: null, supplier: null, status: null, q: null, focus: null });
  const setFocus = (next: Focus) => updateFilters({ focus: next === focus || next === "all" ? null : next });
  const navigateRelated = (path: string) => navigate(path, {
    state: { procurementWorkspaceReturn: `${routePath("page:proc-my-workspace", "/proc-my-workspace")}?${params.toString()}` },
  });
  if (params.get("detail") === "1") return <ProcurementTaskDetailPage
    task={mine.find(task => task.id === selectedId)} loading={loading} error={error}
    onClose={() => setParams(current => { const next = new URLSearchParams(current); next.delete("detail"); return next; }, { replace: true })}
    onNavigateRelated={navigateRelated} />;

  return <div ref={pageRef} className="proc-workspace-page proc-s01-page proc-s01-reference">
    <header className="proc-s01-page-heading flex flex-wrap items-start justify-between gap-3">
      <h1 data-page-title className="text-balance text-xl font-semibold text-foreground">{t("个人工作台")}</h1>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={loading || taskAction.busy} onClick={() => void refreshProcurement()} className="min-h-9 gap-1.5 text-xs"><RefreshCw className="size-3.5" aria-hidden="true" />{t("刷新")}</Button>{can("page:proc-cockpit") && <Button type="button" variant="outline" disabled={taskAction.busy} onClick={() => navigate(routePath("page:proc-cockpit", "/proc-cockpit"))} className="min-h-9 gap-1.5 text-xs">{t("供应链任务驾驶舱")}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Button>}</div>
    </header>
    <div className="proc-s01-top-row">
    <section className="proc-s01-identity" aria-label={t("当前人员与任务概况")}>
      <div className="proc-s01-person"><span className="text-xs text-muted-foreground">{t("当前人员")}</span><PersonAvatar name={user?.name || t("未登录")} size="md" /><div><strong className="text-base">{user?.name || "—"}</strong><p className="mt-1 text-xs text-muted-foreground">{user?.department || user?.roleName || t("供应链成员")}</p></div></div>
      <p className="proc-s01-scope text-xs text-muted-foreground">{t("查看范围：本人负责的采购任务")}</p>
    <div role="group" aria-label={t("我的采购任务概览")} className="proc-workspace-stats proc-horizon-kpi-grid proc-horizon-surface rounded-xl border border-border bg-card">
      <StatCell label={t("当前范围")} value={metricsUnknown ? "—" : counts.all} Icon={Activity} active={focus === "all"} onClick={() => !taskAction.busy && setFocus("all")} />
      <StatCell label={t("待处理")} value={metricsUnknown ? "—" : counts.pending} Icon={ClipboardList} active={focus === "pending"} onClick={() => !taskAction.busy && setFocus("pending")} />
      <StatCell label={t("已逾期")} value={metricsUnknown ? "—" : counts.overdue} tone="red" Icon={AlertTriangle} active={focus === "overdue"} onClick={() => !taskAction.busy && setFocus("overdue")} />
      <StatCell label={t("等待他人")} value={metricsUnknown ? "—" : counts.waiting} Icon={Clock} active={focus === "waiting"} onClick={() => !taskAction.busy && setFocus("waiting")} />
    </div>
    </section>
    <MateChatStreakCardConnected key={user?.id ?? "anonymous"} variant="full" className="proc-s01-streak-card" />
    </div>
    <div className="proc-s01-workbench">
    <div className="proc-s01-layout proc-s01-pane" data-view="tasks" data-detail-closed={detailDismissed}>
      <section className="proc-s01-list" aria-label={t("采购任务列表")}>
    <section aria-label={t("我的采购任务筛选")} className="proc-s01-filter-area proc-s01-pane">
      <Collapsible open={filtersExpanded} onOpenChange={setFiltersExpanded} className="proc-s01-filter-controls">
        <div className="proc-s01-quick-filters">
          <WorkspaceSelect label={t("所属业务")} value={businessLine} disabled={taskAction.busy} onChange={(value) => updateFilters({ business: value, focus: null })} options={[{ value: "all", label: t("全部业务") }, { value: "production", label: t("生产采购") }, { value: "rd", label: t("研发采购") }]} />
        <WorkspaceSelect label={t("状态")} value={status} disabled={taskAction.busy} onChange={(value) => updateFilters({ status: value, focus: null })} options={[{ value: "all", label: t("全部状态") }, ...TASK_STATUSES.map((value) => ({ value, label: t(PROC_STATUS_META[value].label) }))]} />
      <div className="proc-s01-search-controls flex min-w-0 items-end gap-2"><div className="min-w-0 flex-1"><span className="mb-1.5 block text-xs text-muted-foreground">{t("任务搜索")}</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={t("搜索我的采购任务")} value={query} disabled={taskAction.busy} onChange={(event) => updateFilters({ q: event.target.value })} placeholder={t("搜索任务、物料、规格、供应商或采购单号")} className="min-h-10 pl-9 pr-10" />{query && <Button type="button" variant="ghost" size="icon" disabled={taskAction.busy} aria-label={t("清空搜索")} onClick={() => updateFilters({ q: null })} className="absolute right-1 top-1 size-8"><X className="size-4" aria-hidden="true" /></Button>}</div></div>{hasFilters && <Button type="button" variant="ghost" disabled={taskAction.busy} onClick={clearFilters} className="min-h-10 px-2 text-xs">{t("清除筛选")}</Button>}</div>
          <CollapsibleTrigger asChild><Button type="button" variant="outline" className="proc-s01-filter-toggle min-h-10" aria-label={t("更多筛选")}>
            {t("更多筛选")}<span className="tabular-nums">{[productId, supplier, status].filter((value) => value !== "all").length || ""}</span><ChevronDown className="size-4" aria-hidden="true" />
          </Button></CollapsibleTrigger>
        </div>
        <CollapsibleContent className="proc-s01-advanced-filters">
          <div className="proc-s01-filters">

        <WorkspaceSelect label={t("产品")} value={productId} disabled={taskAction.busy} onChange={(value) => updateFilters({ product: value, focus: null })} options={[{ value: "all", label: t("全部产品") }, ...productOptions]} />
        <WorkspaceSelect label={t("供应商")} value={supplier} disabled={taskAction.busy} onChange={(value) => updateFilters({ supplier: value, focus: null })} options={[{ value: "all", label: t("全部供应商") }, { value: UNDETERMINED_SUPPLIER, label: t("未确定") }, ...supplierOptions]} />

          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
    <div id="proc-workspace-tasks-view" role="region" aria-label={t("我的任务")} className="proc-s01-task-view proc-s01-pane">
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><div><p className="font-semibold">{t("我的采购任务加载失败")}</p><p className="mt-1 break-words text-pretty">{error}</p></div><Button type="button" variant="outline" disabled={loading || taskAction.busy} onClick={() => void refreshProcurement()}>{t("重新加载")}</Button></div>}
        <div className="proc-s01-list-heading flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-baseline gap-2"><h2 className="text-balance text-base font-semibold text-foreground">{t("我的任务")}</h2><span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{isInitialLoading ? t("正在加载我的采购任务") : t("共 {count} 个", { count: filtered.length })}</span></div><WorkspaceSelect label={t("排序")} value={sort} disabled={taskAction.busy} onChange={(value) => updateFilters({ sort: value })} options={SORTS.map(([value, label]) => ({ value, label: t(label) }))} compact /></div>
        <div className="proc-s01-task-content cockpit-scroll">
        <div className="proc-s01-task-results" data-empty={!filtered.length && !isInitialLoading}>
        <div className="proc-s01-task-scroll cockpit-scroll" role="region" aria-label={t("采购任务内容")} tabIndex={0}>
        {isInitialLoading ? <div role="status" aria-label={t("正在加载我的采购任务")} className="min-h-52 space-y-3 bg-card p-4">{[0, 1, 2, 3].map((item) => <div key={item} className="flex h-16 items-center gap-3 border-b border-border"><div className="size-10 rounded-lg bg-muted" /><div className="h-4 w-2/3 rounded bg-muted" /></div>)}</div> : filtered.length ? <>
          <ProcWorkspaceTaskList tasks={visibleTasks} materials={materials} selectedId={selectedId} disabled={blocked} onSelect={selectTask} onNext={(task) => { if (blocked) return; selectTask(task.id, { focusDetail: false }); taskAction.runNext(task, "card"); }} />
        </> : !error && <div className="flex min-h-52 flex-col items-center justify-center gap-3 bg-card p-6 text-center"><ClipboardList className="size-7 text-muted-foreground" aria-hidden="true" /><h3 className="text-balance text-sm font-semibold">{t(mine.length ? "没有符合筛选条件的任务" : "当前没有分配给你的采购任务")}</h3><p className="text-pretty text-sm text-muted-foreground">{t(mine.length ? "调整过滤项或清除筛选后重试。" : "分配给你的采购任务会显示在这里。")}</p>{mine.length ? <Button type="button" variant="outline" onClick={clearFilters}>{t("清除筛选")}</Button> : <Button type="button" variant="outline" disabled={loading} onClick={() => void refreshProcurement()}>{t("重新加载")}</Button>}</div>}
        </div>
        <div className="proc-s01-pagination">
          <span className="text-xs tabular-nums text-muted-foreground">{t("共 {count} 个任务", { count: filtered.length })} · {t("每页 {count} 条", { count: PAGE_SIZE })}</span>
          <Pagination aria-label={t("采购任务分页")} className="mx-0 w-auto"><PaginationContent><PaginationItem><Button type="button" variant="outline" size="sm" disabled={page === 1 || blocked} onClick={() => updateFilters({ page: String(page - 1) })} aria-label={t("上一页")}><ChevronLeft className="size-4" aria-hidden="true" /></Button></PaginationItem><PaginationItem><span className="px-2 text-xs tabular-nums text-muted-foreground">{page} / {pageCount}</span></PaginationItem><PaginationItem><Button type="button" variant="outline" size="sm" disabled={page === pageCount || blocked} onClick={() => updateFilters({ page: String(page + 1) })} aria-label={t("下一页")}><ChevronRight className="size-4" aria-hidden="true" /></Button></PaginationItem></PaginationContent></Pagination>
        </div>
        </div>
        </div>
        </div>
      </section>
      <aside className="proc-s01-sidebar proc-s01-pane cockpit-scroll" aria-label={t("个人工作台侧栏")} hidden={detailDismissed}>
      <Collapsible open={!compact || panelExpanded} onOpenChange={setPanelExpanded} className="proc-s01-panel min-w-0 self-start" id="proc-workspace-current-task">
        <CollapsibleTrigger asChild><Button type="button" variant="outline" className="proc-s01-panel-toggle min-h-11 h-auto w-full justify-between gap-2 whitespace-normal text-left"><span className="min-w-0"><span className="block text-xs text-muted-foreground">{t("当前任务")}</span><span className="line-clamp-1">{selected?.materialName || t("选择任务查看详情")}</span></span><ChevronDown className={cn("size-4 shrink-0", panelExpanded && "rotate-180")} aria-hidden="true" /></Button></CollapsibleTrigger>
        <CollapsibleContent className="proc-s01-panel-content">
          <div ref={panelFocusRef} id="proc-workspace-task-detail" tabIndex={-1} role="region" aria-label={t("任务详情：{name}", { name: selected ? `${selected.materialName} · ${selected.code}` : t("当前任务") })} className="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {selected && !filtered.some((task) => task.id === selected.id) && <p className="mb-2 rounded-lg border border-border bg-muted p-3 text-pretty text-xs text-muted-foreground">{t("当前查看的任务不在筛选结果中，详情仍保留。")}</p>}
          {selectedId && !selected && !isInitialLoading ? <div role="status" className="rounded-xl border border-border bg-card p-4"><h3 className="text-balance text-sm font-semibold">{t("此任务暂不可用")}</h3><p className="mt-2 text-pretty text-xs text-muted-foreground">{t("任务可能已转派、删除或不在当前账号范围，请从列表重新选择。")}</p>{firstId && <Button type="button" variant="outline" disabled={blocked} className="mt-3" onClick={() => selectTask(firstId)}>{t("查看列表首项")}</Button>}</div> : selected ? <div className="proc-s01-original-detail proc-task-reader">
            <div className="proc-s01-detail-toolbar"><h2 className="font-semibold">{t("任务详情")}</h2><Button variant="ghost" size="icon" disabled={blocked} aria-label={t("关闭任务详情")} onClick={() => setDetailDismissed(true)}><X className="size-4" /></Button></div>
            <TaskDetailDrawer key={JSON.stringify([selected.id, user?.id, user?.permissions])} presentation="workspace" task={selected} readOnly={blocked} onClose={() => setDetailDismissed(true)} onNavigateRelated={navigateRelated} />
          </div> : <div className="p-5 text-sm text-muted-foreground">{t("从任务列表选择一项查看详情。")}</div>}
          </div>
        </CollapsibleContent>
      </Collapsible>
      </aside>
    </div>
    </div>
    {detailTask && <TaskDetailDrawer key={detailTask.id} task={detailTask} initialAction={detail?.action} onClose={() => setDetail(null)} onNavigateRelated={navigateRelated} restoreFocus={() => panelFocusRef.current?.focus({ preventScroll: true })} />}
    {taskAction.modal}
  </div>;
}

function WorkspaceSelect({ label, value, options, onChange, disabled, compact = false }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={cn("min-w-0", compact && "w-40")}><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} className="min-h-10 w-full"><SelectValue /></SelectTrigger><SelectContent>{!options.some((option) => option.value === value) && <SelectItem value={value}>{value}</SelectItem>}{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}
