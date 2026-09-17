import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, Plus, RotateCcw, Search } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { PlanningActionForm } from './PlanningActionForm';
import { PlanningSections } from './PlanningSections';
import { applyPlanningAction, buildPlanningCsv, canPlan, createPlanningState, getMonthlyProgress, getTaskProgress } from './planningModel';
import { planningRoleLabels, planningStatusLabels, planningViewLabels, type PlanningAction, type PlanningActionContext, type PlanningDocument, type PlanningView } from './planningTypes';
import '../../order-processing/horizon.css';
import './planning-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

const viewKeys = Object.keys(planningViewLabels) as PlanningView[];
type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function validMonth(value: string | null): value is string { return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)); }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function addDays(value: string, amount: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function dateRange(month: string, length = 10, taskDate?: string) { const start = taskDate?.startsWith(month) && validDate(taskDate) ? taskDate : today().startsWith(month) ? today() : `${month}-01`; const next = new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0); return { start, end: [addDays(start, length - 1), next.toISOString().slice(0, 10)].sort()[0] }; }

export function PlanningPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(createPlanningState);
  const linkedTask = state.tasks.find((item) => item.id === params.get('task') && validDate(item.date) && (!params.get('batch') || params.get('batch') === 'all' || params.get('batch') === item.batchId));
  const linkedBatch = state.batches.find((item) => item.id === linkedTask?.batchId);
  const month = validMonth(params.get('month')) ? params.get('month')! : linkedBatch && linkedTask ? linkedTask.date.slice(0, 7) : '2026-09';
  const view = viewKeys.includes(params.get('view') as PlanningView) ? params.get('view') as PlanningView : 'tasks';
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('planner-a');
  const [productId, setProductId] = useState(() => linkedBatch?.productId ?? 'product-in100');
  const [lineId, setLineId] = useState('all');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState(() => dateRange(month, 10, linkedBatch ? linkedTask?.date : undefined));
  const [rangeMonth, setRangeMonth] = useState(month);
  const currentRange = rangeMonth === month ? range : dateRange(month);
  const effectiveRange = linkedBatch?.productId === productId && linkedTask?.date.startsWith(month) && (linkedTask.date < currentRange.start || linkedTask.date > currentRange.end) ? dateRange(month, 10, linkedTask.date) : currentRange;
  const [showCarry, setShowCarry] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<PlanningActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [sourceDocument, setSourceDocument] = useState<PlanningDocument | null>(null);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const [exportError, setExportError] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const internalNavigation = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const blocker = useBlocker(() => !internalNavigation.current && (dirtyRef.current || busyRef.current));
  const rangeValid = validDate(effectiveRange.start) && validDate(effectiveRange.end) && effectiveRange.start <= effectiveRange.end && effectiveRange.start.startsWith(month) && effectiveRange.end.startsWith(month);
  const dates: string[] = [];
  if (rangeValid) for (let day = effectiveRange.start; day <= effectiveRange.end && dates.length < 31; day = addDays(day, 1)) dates.push(day);
  const batchFilter = params.get('batch') ?? 'all';
  const eligibleBatches = state.batches.filter((item) => item.productId === productId && item.startDate <= `${month}-31` && item.endDate >= `${month}-01`);
  const needle = query.trim().toLocaleLowerCase();
  const matchingTasks = scenario === 'empty' ? [] : state.tasks.filter((item) => {
    const batch = state.batches.find((entry) => entry.id === item.batchId);
    const operation = batch?.operations.find((entry) => entry.id === item.operationId);
    return batch?.productId === productId && (batchFilter === 'all' || item.batchId === batchFilter) && (lineId === 'all' || item.lineId === lineId) && [item.code, batch.code, batch.planCode, operation?.component, operation?.process, item.note].join(' ').toLocaleLowerCase().includes(needle);
  });
  const carryTasks = rangeValid ? matchingTasks.filter((item) => item.date < effectiveRange.start && !['completed', 'cancelled'].includes(item.status)) : [];
  const tasks = rangeValid ? matchingTasks.filter((item) => (item.date >= effectiveRange.start && item.date <= effectiveRange.end) || (showCarry && carryTasks.some((entry) => entry.id === item.id))).sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code)) : [];
  const task = params.has('task') ? tasks.find((item) => item.id === params.get('task')) : tasks[0];
  const batch = scenario === 'empty' ? undefined : state.batches.find((item) => item.id === (batchFilter !== 'all' ? batchFilter : task?.batchId ?? eligibleBatches[0]?.id) && item.productId === productId);
  const selectedTask = task?.batchId === batch?.id ? task : undefined;
  const operation = batch?.operations.find((item) => item.id === selectedTask?.operationId);
  const actor = state.actors.find((item) => item.id === actorId);
  const monthly = getMonthlyProgress(state, month, productId);
  const progress = selectedTask ? getTaskProgress(selectedTask) : null;
  const readOnly = scenario !== 'normal' || !canPlan(state, actorId) || batch?.status === 'closed';
  const ctxRef = useRef({ editing, actorId, generation, scenario, batchId: batch?.id });
  ctxRef.current = { editing, actorId, generation, scenario, batchId: batch?.id };
  const materialRequest = state.materialRequests.find((item) => item.taskId === selectedTask?.id);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function scrollToRegion(id: 'planning-content' | 'planning-actions') { window.document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  function clearForm() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) { if (busyRef.current) return; if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action(); }
  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params); if (!validMonth(next.get('month')) && linkedBatch && linkedTask) next.set('month', month);
    for (const [key, value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key, value); }
    internalNavigation.current = true; try { setParams(next); } finally { internalNavigation.current = false; }
  }
  function filter(change: () => void, patch: Record<string, string | null> = {}) { requestChange(() => { clearForm(); change(); setSourceDocument(null); setReadinessOpen(false); setFlash(''); navigate({ task: null, ...patch }); }); }
  function switchView(next: PlanningView) { filter(() => undefined, { view: next, batch: next === 'schedule' && batch ? batch.id : batchFilter }); }
  function chooseTask(id: string) {
    const target = state.tasks.find((item) => item.id === id);
    const targetBatch = state.batches.find((item) => item.id === target?.batchId);
    if (!target || !targetBatch) return;
    requestChange(() => {
      clearForm(); setFlash('');
      if (!tasks.some((item) => item.id === id)) {
        setProductId(targetBatch.productId); setLineId('all'); setQuery(''); setShowCarry(false);
        setRange({ start: target.date, end: target.date }); setRangeMonth(target.date.slice(0, 7));
        navigate({ task: id, batch: target.batchId, month: target.date.slice(0, 7) });
      } else navigate({ task: id });
      if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('planning-actions'));
    });
  }
  function startAction(context: PlanningActionContext) {
    if (readOnly || !batch || context.batchId !== batch.id || (context.taskId && !state.tasks.some((item) => item.id === context.taskId && item.batchId === batch.id))) return;
    requestChange(() => { clearForm(); setFlash(''); setEditing(context); if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('planning-actions')); });
  }
  function changeMonth(next: string) { if (!validMonth(next)) return; filter(() => { setRange(dateRange(next)); setRangeMonth(next); setShowCarry(false); }, { month: next, batch: null }); }
  function stepMonth(amount: number) { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + amount); changeMonth(date.toISOString().slice(0, 7)); }
  function setPeriod(length: number) { filter(() => { setRange(dateRange(month, length)); setRangeMonth(month); setShowCarry(false); }); }
  function reset() { const next = createPlanningState(); stateRef.current = next; setState(next); clearForm(); setActorId('planner-a'); setProductId('product-in100'); setLineId('all'); setQuery(''); setRange(dateRange('2026-09')); setRangeMonth('2026-09'); setShowCarry(false); setScenario('normal'); setFailNext(false); setFlash(''); setExportError(''); setResetOpen(false); navigate({ month: '2026-09', view: 'tasks', batch: null, task: null }); }
  async function save(input: PlanningAction) {
    const current = ctxRef.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!editing || !batch || readOnly || input.actorId !== actorId || input.kind !== editing.kind || current.actorId !== actorId || current.batchId !== batch.id || current.generation !== generation || current.scenario !== 'normal' || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('当前计划或操作人已变化，请重新打开。'));
    if ((input.kind === 'create' && input.batchId !== editing.batchId) || (input.kind !== 'create' && input.taskId !== editing.taskId)) throw new Error(t('提交对象与当前计划不一致。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyPlanningAction(stateRef.current, state.version, input); const savedTask = input.kind === 'create' ? next.tasks.find((item) => !stateRef.current.tasks.some((old) => old.id === item.id)) : next.tasks.find((item) => item.id === input.taskId);
      stateRef.current = next; setState(next); clearForm();
      if (savedTask) { setLineId('all'); setQuery(''); setShowCarry(false); setRange({ start: savedTask.date, end: savedTask.date }); setRangeMonth(savedTask.date.slice(0, 7)); navigate({ month: savedTask.date.slice(0, 7), task: savedTask.id, batch: savedTask.batchId, view: input.kind === 'dispatch' ? 'dispatches' : input.kind === 'cancel' ? 'history' : view }); }
      setFlash(t(({ create: '组件任务已保存为待派工，实际完成数量保持不变。', adjust: '计划调整已留档，已有报工事实保持原样；已派工任务的需求版本同步更新。', dispatch: '已生成本页派工单与用料需求，可在“派工与用料”查看。', cancel: '未派工任务已取消，原计划与取消原因保留。' })[input.kind]));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportBatch() {
    if (!batch) return;
    try { const url = URL.createObjectURL(new Blob([buildPlanningCsv(state, batch.id)], { type: 'text/csv;charset=utf-8;' })); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `${batch.code}-计划与派工-演示.csv`; window.document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError(''); setFlash(t('已发起当前批次完整计划下载，包含已保存派工、用料需求和历史。')); } catch { setExportError(t('计划导出失败，请重试。')); }
  }
  function sidebar() {
    if (!batch) return null;
    if (editing) return <section className="pp-card"><p className="pp-meta">{batch.code} · {actor?.name}</p><PlanningActionForm key={`${generation}:${actorId}:${JSON.stringify(editing)}`} state={state} actorId={actorId} context={editing} readOnly={readOnly} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(clearForm)} /></section>;
    return <>
      <section className="pp-card"><div className="pp-heading"><h2>{t('当前组件任务')}</h2>{selectedTask ? <span className={cn('pp-status', selectedTask.status === 'draft' && 'pp-status-warning')}>{t(planningStatusLabels[selectedTask.status])}</span> : null}</div>
        {selectedTask && operation && progress ? <><h3 className="pp-task-title">{operation.component} · {operation.process}</h3><p className="pp-meta">{selectedTask.code}</p>        {!readOnly && !['completed', 'cancelled'].includes(selectedTask.status) ? <div className="pp-actions">{selectedTask.status === 'draft' ? <Button onClick={() => startAction({ kind: 'dispatch', batchId: batch.id, taskId: selectedTask.id })}><CheckCircle2 className="size-4" aria-hidden="true" />{t('确认派工')}</Button> : null}<Button variant="outline" onClick={() => startAction({ kind: 'adjust', batchId: batch.id, taskId: selectedTask.id })}>{t('调整计划')}</Button></div> : <p className="pp-callout">{t(readOnly ? '当前记录仅供查看。' : '此任务保留历史记录，不再调整。')}</p>}
        {selectedTask.status === 'draft' && !readOnly ? <Button variant="unstyled" className="pp-text-button pp-cancel" onClick={() => startAction({ kind: 'cancel', batchId: batch.id, taskId: selectedTask.id })}>{t('取消未派工任务')}</Button> : null}
<dl className="pp-facts"><div><dt>{t('计划日期')}</dt><dd>{selectedTask.date}</dd></div><div><dt>{t('执行产线 / 线长')}</dt><dd>{state.lines.find((item) => item.id === selectedTask.lineId)?.name} / {state.actors.find((item) => item.id === selectedTask.ownerId)?.name}</dd></div></dl><dl className="pp-task-numbers"><div><dt>{t('计划数量')}</dt><dd>{selectedTask.quantity}<small>{operation.unit}</small></dd></div><div><dt>{t('合格完成')}</dt><dd>{progress.qualified}<small>{operation.unit}</small></dd></div><div><dt>{t('已报工')}</dt><dd>{progress.reported}<small>{operation.unit}</small></dd></div><div><dt>{t('返工待验')}</dt><dd>{progress.rework}<small>{operation.unit}</small></dd></div><div><dt>{t('尚未报工')}</dt><dd>{progress.notStarted}<small>{operation.unit}</small></dd></div><div><dt>{t('计划剩余')}</dt><dd>{progress.remaining}<small>{operation.unit}</small></dd></div></dl>
        {selectedTask.reported > 0 ? <details className="pp-details"><summary>{t('查看已发生报工依据')}</summary><p>{t('报工日期')}：{selectedTask.actualDate ?? selectedTask.date} · {t('原报工产线')}：{state.lines.find((item) => item.id === (selectedTask.actualLineId ?? selectedTask.lineId))?.name}</p><p>{t('调整计划不改写已报工数量、合格数量或历史所属日期和产线。')}</p></details> : null}
        <p className="pp-note">{selectedTask.note || t('暂未填写计划备注。')}</p></> : <><p className="pp-note">{t(params.has('task') ? '当前筛选范围内未找到指定任务，可重新选择。' : '当前区间没有组件任务，可调整区间或新增任务。')}</p>{!readOnly ? <Button onClick={() => startAction({ kind: 'create', batchId: batch.id })}>{t('新增组件任务')}</Button> : null}</>}
      </section>
      {operation && selectedTask && selectedTask.status !== 'cancelled' ? <section className="pp-card"><div className="pp-heading"><h2>{t('用料需求')}</h2><span className="pp-note">{materialRequest ? materialRequest.code : t('待派工后生成')}</span></div><div className="pp-materials">{operation.materials.map((item) => { const issued = materialRequest?.lines.find((line) => line.materialId === item.id)?.issued ?? 0; return <div key={item.id}><strong>{item.name}</strong><small>{item.code} · {t('单耗')} {item.perUnit} {item.unit}</small><p>{t('计划需料')} <b>{selectedTask.quantity * item.perUnit} {item.unit}</b><span>{t('已发')} {issued} · {t('待发')} {Math.max(0, selectedTask.quantity * item.perUnit - issued)}</span></p></div>; })}</div><p className="pp-note">{t('需求按本任务数量与 BOM 单耗计算；派工不等于已配齐或已开工。')}</p></section> : null}
      <section className="pp-card"><h2>{t('作业依据与关联')}</h2>{operation ? <div className="pp-documents">{operation.documents.map((item) => <Button key={item.id} variant="outline" onClick={() => setSourceDocument(item)}><FileText className="size-4" aria-hidden="true" />{item.code} · {item.version}</Button>)}</div> : null}{batch.ecnId ? <Link className="pp-link" to={`/__preview/ecn?ecn=${batch.ecnId}`}>{t('查看适用 ECN 与执行确认')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}{batch.archiveId ? <Link className="pp-link" to={`/__preview/batch-archives?batch=${batch.archiveId}&tab=versions`}>{t('查看历史批次档案')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}<p className="pp-note">{t('资料为演示摘要，原文件与正式发布授权待接入。')}</p></section>
    </>;
  }

  return <main className="order-horizon planning-preview">
    <OrderPageHeader Icon={CalendarDays} eyebrow={t('生产管理 / 计划与派工 / P01 · P07')} title={t(view === 'schedule' ? '批次计划与工序安排' : '生产计划与派工')} description={t('按批次安排组件与工序，人工确认派工并保留调整依据。')} actions={<><Button variant="outline" disabled={busy} onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button variant="outline" disabled={!batch || scenario === 'error'} onClick={exportBatch}><Download className="size-4" aria-hidden="true" />{t('导出本批计划')}</Button></>} />
    <div className="pp-preview-note"><strong>{t('前端演示')}</strong><span>{t('计划、派工与用料需求仅在本页保留，刷新恢复；正式现场任务和仓库接口后续接入。')}</span></div>
    <details className="pp-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal', 'readonly', 'empty', 'error'] as Scenario[]).map((item) => <Button key={item} size="sm" variant={scenario === item ? 'default' : 'outline'} aria-pressed={scenario === item} onClick={() => filter(() => setScenario(item))}>{t(({ normal: '正常', readonly: '只读', empty: '空记录', error: '读取失败' })[item])}</Button>)}<label><Checkbox checked={failNext} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存模拟失败')}</label></div></details>
    <section className="pp-month" aria-label={t('月度整机目标')}><div className="pp-month-picker"><Button size="icon" variant="ghost" aria-label={t('上个月')} onClick={() => stepMonth(-1)}><ChevronLeft className="size-4" /></Button><Label htmlFor="planning-month" className="sr-only">{t('计划月份')}</Label><Input id="planning-month" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} /><Button size="icon" variant="ghost" aria-label={t('下个月')} onClick={() => stepMonth(1)}><ChevronRight className="size-4" /></Button></div><dl><div><dt>{t('本月整机目标')}</dt><dd>{monthly.target} <small>{t('台')}</small></dd></div><div><dt>{t('整机已完工')}</dt><dd>{monthly.completed} <small>{t('台')}</small></dd></div><div><dt>{t('目标剩余')}</dt><dd>{monthly.remaining} <small>{t('台')}</small></dd></div></dl><p>{t('按整机完工记录统计；组件与工序数量不累计为整机。')}</p></section>
    <section className="pp-filters" aria-label={t('筛选计划')}><div><Label htmlFor="planning-product">{t('产品')}</Label><Select value={productId} onValueChange={(value) => filter(() => { setProductId(value); setShowCarry(false); }, { batch: null })}><SelectTrigger id="planning-product"><SelectValue /></SelectTrigger><SelectContent>{state.products.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.name}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="planning-batch">{t('生产批次')}</Label><Select value={batchFilter} onValueChange={(value) => filter(() => undefined, { batch: value })}><SelectTrigger id="planning-batch"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部批次')}</SelectItem>{eligibleBatches.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.target} {t('台')}{item.status === 'closed' ? ` · ${t('已结束')}` : ''}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="planning-line">{t('产线')}</Label><Select value={lineId} onValueChange={(value) => filter(() => setLineId(value))}><SelectTrigger id="planning-line"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部产线')}</SelectItem>{state.lines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="planning-actor">{t('演示操作人')}</Label><Select value={actorId} onValueChange={(value) => filter(() => setActorId(value))}><SelectTrigger id="planning-actor"><SelectValue /></SelectTrigger><SelectContent>{state.actors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {t(planningRoleLabels[item.role])}</SelectItem>)}</SelectContent></Select></div></section>
    <div className="pp-range-bar"><div className="pp-search"><Search className="size-4" aria-hidden="true" /><Input id="planning-query" aria-label={t('查找任务或批次')} placeholder={t('任务、批次、组件或工序')} value={query} onChange={(event) => filter(() => setQuery(event.target.value))} /></div><div className="pp-range-inputs"><Label htmlFor="planning-start">{t('计划区间')}</Label><Input id="planning-start" type="date" aria-label={t('区间开始日期')} value={effectiveRange.start} onChange={(event) => filter(() => { setRange({ ...effectiveRange, start: event.target.value }); setRangeMonth(month); })} /><span>{t('至')}</span><Input id="planning-end" type="date" aria-label={t('区间结束日期')} value={effectiveRange.end} onChange={(event) => filter(() => { setRange({ ...effectiveRange, end: event.target.value }); setRangeMonth(month); })} /></div><div className="pp-periods">{[1, 3, 10].map((length) => <Button key={length} variant="outline" onClick={() => setPeriod(length)}>{t(length === 1 ? month === today().slice(0, 7) ? '今天' : '月初 1 天' : `${length} 天`)}</Button>)}</div></div>
    {!rangeValid ? <p role="alert" className="pp-error">{t('请选择当前月份内的有效起止日期，结束日期不能早于开始日期。')}</p> : null}
    {carryTasks.length && scenario !== 'error' ? <div className="pp-carry"><span>{t('区间前仍有 {count} 项未完任务，包含跨月记录。', { count: carryTasks.length })}</span><Button size="sm" variant="outline" aria-pressed={showCarry} onClick={() => filter(() => setShowCarry(!showCarry), !showCarry ? { view: 'tasks' } : {})}>{t(showCarry ? '收起区间前任务' : '同时查看未完任务')}</Button></div> : null}
    {flash ? <div className="pp-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}{exportError ? <p role="alert" className="pp-error">{exportError}</p> : null}
    {scenario === 'error' ? <section className="pp-card"><OrderEmptyState Icon={AlertCircle} title={t('计划读取失败')} description={t('本次已保存记录仍保留，请重试读取。')} action={<Button onClick={() => filter(() => setScenario('normal'))}>{t('重新读取')}</Button>} /></section> : !batch ? <section className="pp-card"><OrderEmptyState Icon={ClipboardList} title={t('没有匹配的生产批次')} description={t('可调整月份、产品或批次条件。')} action={<Button onClick={() => filter(() => { setScenario('normal'); setProductId('product-in100'); setQuery(''); setLineId('all'); setRange(dateRange('2026-09')); setRangeMonth('2026-09'); }, { month: '2026-09', batch: null })}>{t('返回演示计划')}</Button>} /></section> : <>
      <section className="pp-batch-context"><div><span>{t('当前批次')}</span><strong>{batch.code}<small>{batch.status === 'closed' ? t('已结束') : t('安排中')}</small></strong><p>{batch.planCode} · {batch.bomVersion}</p></div><div><span>{t('批次整机目标 / 需求日期')}</span><strong>{batch.target} {t('台')} <small>{batch.dueDate}</small></strong><p>{t('整机完工')} {batch.completed} {t('台')} · {t('人工安排，不承诺产能')}</p></div><div><span>{t('本批齐套快照')}</span><strong>{t('当前可配')} {batch.readiness.current} <small>{t('套')} · {t('按期可配')} {batch.readiness.onTime ?? t('待确认')}</small></strong><Button variant="unstyled" className="pp-text-button" onClick={() => setReadinessOpen(true)}>{t('查看齐套依据与日期')}<ArrowRight className="size-3.5" aria-hidden="true" /></Button></div></section>
      <Tabs value={view} onValueChange={(value) => switchView(value as PlanningView)}><div className="pp-workbar"><TabsList className="pp-tabs" aria-label={t('计划资料分类')}>{viewKeys.map((key) => <TabsTrigger key={key} value={key}>{t(planningViewLabels[key])}</TabsTrigger>)}</TabsList>{!readOnly ? <Button onClick={() => startAction({ kind: 'create', batchId: batch.id })}><Plus className="size-4" aria-hidden="true" />{t('新增组件任务')}</Button> : null}</div><div className="pp-mobile-jump"><Button variant="unstyled" onClick={() => scrollToRegion('planning-content')}>{t('查看计划资料')}</Button><Button variant="unstyled" onClick={() => scrollToRegion('planning-actions')}>{t('前往当前操作')}</Button></div><div className="pp-workspace"><TabsContent id="planning-content" value={view} className="pp-content"><PlanningSections state={state} batchId={batch.id} view={view} tasks={tasks} selectedTaskId={selectedTask?.id} dates={dates} readOnly={readOnly} onSelectTask={chooseTask} onAction={startAction} onDocument={setSourceDocument} /></TabsContent><aside id="planning-actions" className="pp-sidebar" aria-label={t('任务详情与当前操作')}><Button variant="unstyled" className="pp-back" onClick={() => scrollToRegion('planning-content')}>{t('返回计划资料')}</Button>{sidebar()}</aside></div></Tabs>
    </>}
    <Sheet open={Boolean(sourceDocument)} onOpenChange={(open) => { if (!open) setSourceDocument(null); }}><SheetContent className="proc-horizon-overlay pp-sheet"><SheetHeader><SheetTitle>{t('作业资料摘要')}</SheetTitle><SheetDescription>{t('按具体版本查看，原文件尚未接入；摘要不能替代正式作业文件。')}</SheetDescription></SheetHeader>{sourceDocument ? <div className="pp-sheet-body"><h2>{sourceDocument.code} · {sourceDocument.version}</h2><p className="pp-note">{sourceDocument.title} · {t(sourceDocument.status === 'published' ? '演示已发布版本' : '资料待确认')}</p><p>{sourceDocument.summary}</p></div> : null}</SheetContent></Sheet>
    <Sheet open={readinessOpen} onOpenChange={setReadinessOpen}><SheetContent className="proc-horizon-overlay pp-sheet"><SheetHeader><SheetTitle>{t('批次物料齐套依据')}</SheetTitle><SheetDescription>{t('仅表明物料条件，排程及交付日期仍由计划员确认。')}</SheetDescription></SheetHeader>{batch ? <div className="pp-sheet-body"><h2>{batch.code} · {batch.bomVersion}</h2><dl className="pp-facts"><div><dt>{t('批次需求')}</dt><dd>{batch.target} {t('套')}</dd></div><div><dt>{t('当前合格可配')}</dt><dd>{batch.readiness.current} {t('套')}</dd></div><div><dt>{t('按需求日预计可配')}</dt><dd>{batch.readiness.onTime ?? t('待确认')} {t('套')}</dd></div><div><dt>{t('预计检验可用日期')}</dt><dd>{batch.readiness.availableDate ?? t('待人工确认')}</dd></div><div><dt>{t('最近核对')}</dt><dd>{new Date(batch.readiness.checkedAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</dd></div><div><dt>{t('需求日期')}</dt><dd>{batch.dueDate}</dd></div></dl><p>{batch.readiness.note}</p><p className="pp-callout">{t('这是固定的批次演示快照。计划调整后需重新核对用料日期，不据此自动承诺开工、产能或交付。')}</p><Link className="pp-link" to="/proc-inventory-readiness">{t('打开库存与齐套页面')}<ArrowRight className="size-4" aria-hidden="true" /></Link><p className="pp-note">{t('正式齐套页面按当前登录权限读取；本页批次尚未与正式计划关联。')}</p></div> : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open) => { setDiscardOpen(open); if (!open) pendingAction.current = null; }}><AlertDialogContent className="proc-horizon-overlay pp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将清空，已经保存的计划和历史记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => { setDiscardOpen(false); pendingAction.current = null; }}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; setDiscardOpen(false); clearForm(); action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state === 'blocked'}><AlertDialogContent className="proc-horizon-overlay pp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('离开当前计划？')}</AlertDialogTitle><AlertDialogDescription>{t('尚未保存的填写将丢失。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.reset?.()}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { clearForm(); blocker.proceed?.(); }}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="proc-horizon-overlay pp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('重置本次演示？')}</AlertDialogTitle><AlertDialogDescription>{t('新增计划、派工、用料需求和调整记录会恢复为初始样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留当前记录')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
