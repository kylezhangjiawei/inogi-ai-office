import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, ClipboardList, FlaskConical, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { cn } from "../../components/ui/utils";
import { i18nLocale, useI18n } from "../../lib/i18n";
import type { Material, ProcurementTask } from "../../lib/procurementApi";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { filterSampleTasks, isSampleTask, sampleTaskStage, type SampleFilter } from "../sampleWorkspaceModel";
import { refreshProcurement } from "../data";
import { PROC_STATUS_META, PersonAvatar, useProcCan } from "./common";
import { nextPermissionOf, useProcTaskAction } from "./taskActions";
import { ProcSampleTestDialog } from "./ProcSampleTestDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { SampleCommercialSummary } from "../samples/SampleCommercialSummary";
import { SampleProductImage } from "../samples/SampleProductImage";
import "../sampleWorkspace.css";

const FILTERS: Array<[SampleFilter, string]> = [["all", "全部"], ["testing", "待验证"], ["followup", "需跟进"], ["waiting", "待到样"], ["preparing", "准备中"], ["confirmed", "已验证"]];

export function ProcurementSampleWorkspace({ tasks, materials = [], loading, error, selectedId, onSelect, onInteractionStateChange }: {
  tasks: ProcurementTask[];
  materials?: Material[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInteractionStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SampleFilter>("all");
  const [interaction, setInteraction] = useState({ dirty: false, busy: false });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [initialSelection, setInitialSelection] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selectedRegionRef = useRef<HTMLElement>(null);
  const confirmedSelectionRef = useRef(false);
  const selectionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<string | null>(null);
  const [compactList, setCompactList] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  useEffect(() => {
    const container = workspaceRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompactList(entry.contentRect.width < 864));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const samples = useMemo(() => tasks.filter(isSampleTask), [tasks]);
  const materialsById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const filtered = useMemo(() => filterSampleTasks(samples, filter, query), [samples, filter, query]);
  // Filtering the list never switches a form that the user may be writing in.
  useEffect(() => {
    if (!initialSelection && samples.length) setInitialSelection(samples[0].id);
  }, [initialSelection, samples]);
  const effectiveSelection = selectedId || initialSelection;
  const selected = effectiveSelection ? samples.find((task) => task.id === effectiveSelection) : samples[0];
  useEffect(() => {
    if (!selectionFocus || selected?.id !== selectionFocus || pendingSelection) return;
    selectedRegionRef.current?.focus({ preventScroll: true });
    selectedRegionRef.current?.scrollIntoView({ block: "start" });
    setSelectionFocus(null);
  }, [selectionFocus, selected?.id, pendingSelection]);
  const detailTask = detailId ? tasks.find((task) => task.id === detailId) : null;
  const detailBlocked = loading || Boolean(error) || interaction.dirty || interaction.busy;
  const detailScope = JSON.stringify([selected?.id, selected?.updatedAt]);
  const latestDetailScope = useRef({ scope: detailScope, blocked: detailBlocked });
  latestDetailScope.current = { scope: detailScope, blocked: detailBlocked };
  const openSelectedDetail = () => {
    if (selected && latestDetailScope.current.scope === detailScope && !latestDetailScope.current.blocked) setDetailId(selected.id);
  };
  const updateInteraction = useCallback((next: { dirty: boolean; busy: boolean }) => {
    setInteraction(next);
    onInteractionStateChange?.(next);
  }, [onInteractionStateChange]);
  const commitSelection = (id: string) => {
    setListExpanded(false);
    if (compactList) setSelectionFocus(id);
    onSelect(id);
  };
  const selectTask = (id: string, trigger: HTMLButtonElement) => {
    if (interaction.busy || id === selected?.id) return;
    if (interaction.dirty) {
      selectionTriggerRef.current = trigger;
      setPendingSelection(id);
      return;
    }
    commitSelection(id);
  };
  const clearFilters = () => { setFilter("all"); setQuery(""); };
  const refreshSamples = () => {
    if (loading || interaction.busy) return;
    setRefreshVersion((value) => value + 1);
    void refreshProcurement();
  };

  return <div ref={workspaceRef} className="proc-sample-workspace">
    <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-balance text-xl font-semibold text-foreground">{t("样品协同")}</h2>
        <p className="mt-1 text-pretty text-sm text-muted-foreground">{t("核对交付资料、安排验证，跟进每份样品的处理结果。")}</p>
      </div>
      <Button type="button" variant="outline" disabled={loading || interaction.busy} onClick={refreshSamples} className="min-h-10 gap-2"><RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />{t("刷新")}</Button>
    </div>
    {error && <div role="alert" className="mb-4 shrink-0 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><p className="text-pretty">{error}</p><Button type="button" variant="outline" className="mt-2" disabled={loading || interaction.busy} onClick={refreshSamples}>{t("重新加载")}</Button></div>}
    <div className="proc-sample-workspace-grid cockpit-scroll">
      <Collapsible asChild open={!compactList || listExpanded} onOpenChange={setListExpanded}>
      <aside className="proc-sample-list min-w-0 rounded-xl border border-border bg-card" aria-label={t("全部样品")}>
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <div><h3 className="text-balance text-sm font-semibold">{t("全部样品")}</h3><span className="text-xs tabular-nums text-muted-foreground">{loading && !samples.length ? "—" : t("{count} 项", { count: samples.length })}</span></div>
          {compactList && <CollapsibleTrigger asChild><Button type="button" variant="outline" className="min-h-11 gap-2 text-xs" aria-label={t(listExpanded ? "收起样品列表" : "展开样品列表")}>{t(listExpanded ? "收起列表" : "切换样品")}<ChevronDown className={cn("size-4", listExpanded && "rotate-180")} aria-hidden="true" /></Button></CollapsibleTrigger>}
        </div>
        <CollapsibleContent className="proc-sample-list-content">
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={t("搜索样品")} placeholder={t("名称、规格、供应商或人员")} value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 pl-9" /></div>
          <ToggleGroup type="single" value={filter} onValueChange={(value) => value && setFilter(value as SampleFilter)} aria-label={t("按样品阶段筛选")} className="grid w-full grid-cols-3 gap-1.5">
            {FILTERS.map(([value, label]) => <ToggleGroupItem key={value} value={value} className="min-h-9 rounded-lg border border-border px-1 text-xs data-[state=on]:border-primary/20 data-[state=on]:bg-accent data-[state=on]:text-primary">{t(label)}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        {selected && !filtered.some((task) => task.id === selected.id) && <p className="shrink-0 border-b border-border px-4 py-3 text-pretty text-xs text-muted-foreground">{t("当前正在查看的样品不在筛选结果中。")}</p>}
        <div className="proc-sample-list-scroll cockpit-scroll space-y-2 p-3">
          {filtered.map((task) => <Button variant="unstyled" key={task.id} type="button" disabled={interaction.busy} aria-pressed={selected?.id === task.id} onClick={(event) => selectTask(task.id, event.currentTarget)} className={cn("proc-sample-list-item w-full rounded-xl border p-3 text-left disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", selected?.id === task.id ? "border-primary/30 bg-accent" : "border-border bg-card hover:bg-muted/40")}>
            <SampleProductImage task={task} material={task.materialId ? materialsById.get(task.materialId) : undefined} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1"><span className="min-w-0 flex-1 basis-24 line-clamp-2 break-words text-sm font-semibold">{task.materialName}</span><span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs", PROC_STATUS_META[task.status].pill)}>{t(PROC_STATUS_META[task.status].label)}</span></span>
              <span className="mt-1 block break-all text-xs tabular-nums text-muted-foreground">{task.code}</span>
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="shrink-0 tabular-nums">{task.quantity} {task.unit}</span><span className="flex min-w-0 items-center gap-1.5"><PersonAvatar name={task.status === "testing" ? task.sampleTest?.testerName || t("待指定") : task.buyer || t("未指派")} size="xs" /><span className="truncate">{task.status === "testing" ? task.sampleTest?.testerName || t("待指定测试人") : task.buyer || t("采购待指派")}</span></span></span>
            </span>
          </Button>)}
          {!loading && !filtered.length && <div className="px-3 py-6 text-center"><p className="text-pretty text-sm text-muted-foreground">{t("没有符合条件的样品")}</p>{(filter !== "all" || query) && <Button type="button" variant="link" onClick={clearFilters}>{t("清除筛选")}</Button>}</div>}
        </div>
        <p className="shrink-0 border-t border-border px-4 py-3 text-xs tabular-nums text-muted-foreground">{t("显示 {shown} / {total} 项", { shown: filtered.length, total: samples.length })}</p>
        </CollapsibleContent>
      </aside>
      </Collapsible>
      <section ref={selectedRegionRef} tabIndex={-1} className="proc-sample-selected cockpit-scroll min-w-0 scroll-mt-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={selected ? t("当前样品：{name} · {code}", { name: selected.materialName, code: selected.code }) : t("当前样品")}>
        {selected ? <>
          <SampleContext key={`context:${selected.id}`} task={selected} material={selected.materialId ? materialsById.get(selected.materialId) : undefined} blocked={detailBlocked} onOpenTask={openSelectedDetail} />
          <ProcSampleTestDialog key={selected.id} taskId={selected.id} inline revision={`${selected.updatedAt}:${refreshVersion}`} onClose={() => {}} onConfirmed={() => void refreshProcurement()} onRecordsSaved={() => void refreshProcurement()} onInteractionStateChange={updateInteraction} />
          <Collapsible className="mt-4 rounded-xl border border-border bg-card">
            <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("采购条件与操作记录")}<ChevronDown className="size-4 group-data-[state=open]:rotate-180" aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t border-border p-4">
              <SampleCommercialSummary key={selected.id} task={selected} disabled={interaction.dirty || interaction.busy}
                unavailable={loading || Boolean(error)} revision={refreshVersion} onOpenTask={openSelectedDetail} />
              <h3 className="text-sm font-semibold">{t("操作记录")}</h3>
              <ol className="space-y-3" aria-label={t("样品关联任务操作记录")}>
                {selected.logs.length ? [...selected.logs].reverse().map((log, index) => <li key={log.id || `${log.at}:${index}`} className="border-l-2 border-border pl-3">
                  <p className="text-pretty text-sm leading-6">{log.text}</p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">{log.actor || t("操作人未记录")} · {log.createdAt ? new Date(log.createdAt).toLocaleString(i18nLocale()) : log.at || t("时间未记录")}</p>
                </li>) : <li className="text-sm text-muted-foreground">{t("暂无操作记录")}</li>}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        </> : <div role="status" className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
          <FlaskConical className="size-8 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-balance font-semibold">{t(loading ? "正在加载样品…" : effectiveSelection ? "此样品暂不可用" : "暂无样品任务")}</h3>
          <p className="text-pretty text-sm text-muted-foreground">{t(effectiveSelection ? "任务可能已更新或不在当前权限范围，请从样品列表重新选择。" : "需要样品的采购任务和已有测试记录会显示在这里。")}</p>
          {!loading && !samples.length && <Button type="button" variant="outline" disabled={interaction.busy} onClick={refreshSamples}>{t("重新加载")}</Button>}
        </div>}
      </section>
    </div>
    {detailTask && <TaskDetailDrawer key={detailTask.id} task={detailTask} onClose={() => setDetailId(null)} />}
    <AlertDialog open={Boolean(pendingSelection)} onOpenChange={(open) => { if (!open) setPendingSelection(null); }}>
      <AlertDialogContent className="horizon-theme horizon-portal proc-horizon-overlay" onCloseAutoFocus={(event) => {
        if (confirmedSelectionRef.current) {
          event.preventDefault();
          confirmedSelectionRef.current = false;
        } else if (selectionTriggerRef.current) {
          event.preventDefault();
          if (selectionTriggerRef.current.isConnected) selectionTriggerRef.current.focus();
          else selectedRegionRef.current?.focus();
        }
        selectionTriggerRef.current = null;
      }}><AlertDialogHeader><AlertDialogTitle>{t("切换样品前放弃未提交的结论？")}</AlertDialogTitle><AlertDialogDescription>{t("当前填写的测试结果和结论尚未提交，切换后需要重新填写。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("继续填写")}</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (!pendingSelection || interaction.busy) return;
        confirmedSelectionRef.current = compactList;
        commitSelection(pendingSelection);
        setPendingSelection(null);
      }}>{t("放弃并切换")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}

function SampleContext({ task, material, blocked, onOpenTask }: { task: ProcurementTask; material?: Material; blocked: boolean; onOpenTask: () => void }) {
  const { t } = useI18n();
  const can = useProcCan();
  const action = useProcTaskAction();
  const facts = getProcSampleFacts(task);
  const stage = sampleTaskStage(task);
  const label = task.status === "pending_sample" ? "确认到样并安排测试" : PROC_STATUS_META[task.status].next;
  return <div className="mb-4 space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="proc-sample-product-summary border-t border-border pt-4">
      <SampleProductImage task={task} material={material} detail />
      <div className="min-w-0 self-center">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-xs tabular-nums text-muted-foreground">{task.code}</p><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", PROC_STATUS_META[task.status].pill)}>{t(PROC_STATUS_META[task.status].label)}</span></div>
        <h3 className="mt-2 text-balance break-words text-xl font-semibold">{task.materialName}</h3>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">{task.spec || t("规格待补充")}</p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs"><div className="flex flex-wrap gap-2"><dt className="text-muted-foreground">{t("需求数量")}</dt><dd className="font-medium tabular-nums">{task.quantity} {task.unit}</dd></div><div className="flex min-w-0 flex-wrap gap-2"><dt className="text-muted-foreground">{t("采购负责人")}</dt><dd className="break-words font-medium">{task.buyer || t("未指派")}</dd></div></dl>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertCircle className="size-3.5" aria-hidden="true" />{t(facts.label)}{task.expectedArrivalDate ? ` · ${t("预计到货")} ${task.expectedArrivalDate}` : ""}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("样品处理操作")}>
        <Button type="button" variant="outline" disabled={blocked || action.busy} onClick={onOpenTask} className="min-h-10 text-xs"><ClipboardList className="size-3.5" aria-hidden="true" />{t("采购详情")}</Button>
        {label && can(nextPermissionOf(task)) && <Button type="button" variant={task.status === "testing" ? "outline" : "default"} disabled={blocked || action.busy} onClick={() => action.runNext(task, "detail")} className="min-h-10 text-xs">{t(label)}<ArrowRight className="size-3.5" aria-hidden="true" /></Button>}
      </div>
    </div>
    {stage === "followup" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-pretty text-xs text-amber-800">{t(task.sampleTest?.result === "failed_requote" ? "上次测试未通过，当前需重新询价并跟进供应商。" : "上次测试未通过，当前等待修改后重新送样。")}</p>}
    {action.modal}
  </div>;
}
