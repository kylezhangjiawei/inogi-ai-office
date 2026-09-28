import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { ArrowRight, CheckCircle2, ClipboardCheck, Download, FileText, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../components/ui/utils';
import { useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import type { PlanningDocument } from '../planning/planningTypes';
import { InspectionActionForm } from './InspectionActionForm';
import { InspectionSections } from './InspectionSections';
import { applyInspectionAction, buildInspectionCsv, canOperateInspection, createInspectionState, getInspectionProgress, getReinspectable, getTransferable } from './inspectionModel';
import { inspectionActionLabels, inspectionViewLabels, type InspectionAction, type InspectionActionContext, type InspectionPhoto, type InspectionTask, type InspectionView } from './inspectionTypes';
import '../../order-processing/horizon.css';
import './inspection-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const viewKeys = Object.keys(inspectionViewLabels) as InspectionView[];
const statusName = (task: InspectionTask) => task.closed ? '已结束' : task.acceptedAt ? '执行中' : '待接收';

export function InspectionPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = viewKeys.includes(params.get('tab') as InspectionView) ? params.get('tab') as InspectionView : 'records';
  const [state, setState] = useState(createInspectionState);
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('qc-a');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<InspectionActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [source, setSource] = useState<PlanningDocument | null>(null);
  const [photo, setPhoto] = useState<InspectionPhoto | null>(null);
  const [flash, setFlash] = useState('');
  const [exportError, setExportError] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pendingChange = useRef<(() => void) | null>(null);
  const internalNavigation = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const blocker = useBlocker(() => dirtyRef.current && !internalNavigation.current);
  const actor = state.actors.find((item) => item.id === actorId);
  const needle = query.trim().toLocaleLowerCase();
  const scopedTasks = actor ? state.tasks : [];
  const tasks = scenario === 'empty' ? [] : scopedTasks.filter((item) =>
    (statusFilter === 'all' || (statusFilter === 'pending' ? !item.acceptedAt && !item.closed : statusFilter === 'active' ? Boolean(item.acceptedAt) && !item.closed : item.closed)) &&
    [item.code, item.reportCode, item.batchCode, item.product, item.process].join(' ').toLocaleLowerCase().includes(needle));
  const task = params.has('task') ? tasks.find((item) => item.id === params.get('task')) : tasks[0];
  const progress = task ? getInspectionProgress(state, task.id) : null;
  const readOnly = scenario !== 'normal' || !task || actor?.role === 'viewer' || task.closed;
  const actionContext = editing?.taskId === task?.id ? editing : null;
  const ctx = useRef({ generation, actorId, taskId: task?.id, editing, scenario });
  ctx.current = { generation, actorId, taskId: task?.id, editing, scenario };
  const issues = state.issues.filter((item) => item.taskId === task?.id);
  const records = state.records.filter((item) => item.taskId === task?.id);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function scrollToRegion(id: 'inspection-records' | 'inspection-actions') {
    window.document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  function clearForm() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function requestChange(change: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) { pendingChange.current = change; setDiscardOpen(true); } else change();
  }
  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    internalNavigation.current = true;
    try { setParams(next); } finally { internalNavigation.current = false; }
  }
  function filter(change: () => void) {
    requestChange(() => { clearForm(); change(); setFlash(''); setSource(null); setPhoto(null); navigate({ task: null }); });
  }
  function selectTask(id: string) {
    if (!tasks.some((item) => item.id === id)) return;
    requestChange(() => { clearForm(); setFlash(''); navigate({ task: id }); });
  }
  function changeActor(id: string) {
    if (!state.actors.some((item) => item.id === id)) return;
    requestChange(() => { clearForm(); setActorId(id); setFlash(''); setSource(null); setPhoto(null); });
  }
  function changeView(next: InspectionView) {
    requestChange(() => { clearForm(); navigate({ tab: next }); });
  }
  function startAction(context: InspectionActionContext) {
    if (readOnly || context.taskId !== task?.id || !canOperateInspection(state, actorId, context.taskId, context.kind)) return;
    requestChange(() => {
      clearForm(); setFlash(''); setEditing(context);
      if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('inspection-actions'));
    });
  }
  function reset() {
    const next = createInspectionState(); stateRef.current = next; setState(next); clearForm();
    setActorId('qc-a'); setQuery(''); setStatusFilter('all'); setScenario('normal');
    setFlash(''); setExportError(''); setFailNext(false); setResetOpen(false); setSource(null); setPhoto(null);
    navigate({ task: null, tab: 'records' });
  }
  async function save(input: InspectionAction) {
    const current = ctx.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!actionContext || !task || readOnly || current.generation !== generation || current.actorId !== actorId || current.taskId !== task.id || current.scenario !== 'normal' || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('任务或操作人已变化，请重新打开。'));
    if (input.taskId !== task.id || input.actorId !== actorId || input.kind !== actionContext.kind) throw new Error(t('提交内容与当前操作不一致。'));
    if ((input.kind === 'transfer' && actionContext.recordId && input.recordId !== actionContext.recordId) || (input.kind === 'reinspect' && actionContext.issueId && input.issueId !== actionContext.issueId)) throw new Error(t('来源记录与打开时不一致，请重新选择。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyInspectionAction(stateRef.current, state.version, input);
      stateRef.current = next; setState(next); clearForm();
      if (input.kind === 'accept') setStatusFilter('all');
      const nextView: InspectionView = input.kind === 'transfer' ? 'issues' : input.kind === 'release' ? 'releases' : input.kind === 'accept' ? 'history' : 'records';
      navigate({ task: task.id, tab: nextView });
      const messages: Record<InspectionAction['kind'], string> = {
        accept: '报检已接受，可核对 SIP 后登记初检。', inspect: '初检已保存；检验结论与 QA 放行分别记录。',
        reinspect: '复验已保存，首次合格率保持不变；未通过数量继续保留待处理。',
        transfer: '不良处理单已建立，等待处置。后续在 P08 接入完整处理流程。',
        release: 'QA 放行依据与数量已单独记录，尚未产生出货记录。',
      };
      setFlash(t(messages[input.kind]));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportTask() {
    if (!task) return;
    try {
      const blob = new Blob([buildInspectionCsv(state, task.id)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const link = window.document.createElement('a');
      link.href = url; link.download = `${task.code}-检验记录.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError('');
    } catch { setExportError(t('导出未完成，请重试。当前填写保留。')); }
  }
  const buttonFor = (kind: InspectionActionContext['kind'], disabled = false) => task && canOperateInspection(state,actorId,task.id,kind) ?
    <Button key={kind} variant={kind === 'inspect' || kind === 'accept' || kind === 'release' ? 'default' : 'outline'} disabled={readOnly || disabled} onClick={() => startAction({ kind, taskId: task.id })}>{t(inspectionActionLabels[kind])}</Button> : null;
  return <main className="order-horizon inspection-preview">
    <OrderPageHeader Icon={ClipboardCheck} eyebrow={t('生产管理 / 生产检验 / P03')} title={t('生产检验与复验')} description={t('逐次登记检验结论，沿原不良记录追踪复验与质量放行。')} actions={<><Button variant="outline" onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button variant="outline" disabled={!task || scenario === 'error'} onClick={exportTask}><Download className="size-4" aria-hidden="true" />{t('导出当前任务')}</Button></>} />
    <div className="ip-preview-note"><strong>{t('前端演示')}</strong><span>{t('检验、处置依据和 QA 角色均为独立样例；新增记录与照片仅在本页保留，刷新恢复。')}</span></div>
    <details className="ip-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal','readonly','empty','error'] as Scenario[]).map((item) => <Button key={item} size="sm" variant={scenario === item ? 'default' : 'outline'} onClick={() => filter(() => setScenario(item))}>{t(({normal:'正常',readonly:'只读',empty:'空数据',error:'读取失败'})[item])}</Button>)}<label><Checkbox checked={failNext} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    <section className="ip-filters" aria-label={t('检验任务筛选')}>
      <div><Label htmlFor="inspection-actor">{t('演示操作人')}</Label><Select value={actorId} onValueChange={changeActor}><SelectTrigger id="inspection-actor"><SelectValue /></SelectTrigger><SelectContent>{state.actors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {t(item.role === 'qc' ? '检验' : item.role === 'qa' ? '放行授权' : '只读')}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="inspection-status">{t('任务状态')}</Label><Select value={statusFilter} onValueChange={(value) => filter(() => setStatusFilter(value))}><SelectTrigger id="inspection-status"><SelectValue /></SelectTrigger><SelectContent>{[['all','全部状态'],['pending','待接收'],['active','执行中'],['closed','已结束']].map(([value,label]) => <SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></div>
      <div className="ip-search"><Label htmlFor="inspection-query">{t('查找检验任务')}</Label><Input id="inspection-query" value={query} placeholder={t('检验任务、报工单、批次或工序')} onChange={(event) => { const value = event.target.value; filter(() => setQuery(value)); }} /></div>
    </section>
    {flash ? <div className="ip-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}
    {exportError ? <p role="alert" className="ip-error">{exportError}</p> : null}
    {scenario === 'error' ? <OrderEmptyState Icon={ClipboardCheck} title={t('检验任务读取失败')} description={t('已有演示记录保留，重试后继续。')} action={<Button onClick={() => setScenario('normal')}>{t('重试读取')}</Button>} /> : !task || !progress ? <OrderEmptyState Icon={ClipboardCheck} title={t('当前范围没有可查看任务')} description={t('请检查任务编号、批次或状态筛选。')} action={<Button onClick={() => filter(() => { setScenario('normal'); setQuery(''); setStatusFilter('all'); })}>{t('清除筛选')}</Button>} /> : <>
      <div className="ip-task-picker"><Label htmlFor="inspection-task">{t('当前检验任务')}</Label><Select value={task.id} onValueChange={selectTask}><SelectTrigger id="inspection-task"><SelectValue /></SelectTrigger><SelectContent>{tasks.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.batchCode} · {t(item.stage === 'final' ? '终检' : '过程检')} · {t(statusName(item))}</SelectItem>)}</SelectContent></Select><span>{t('共 {count} 项', {count:tasks.length})}</span></div>
      <section className="ip-context" aria-label={t('报检来源与版本')}>
        <div><span>{t('生产批次 / 产品工序')}</span><strong>{task.batchCode}</strong><p>{task.product} · {task.process}</p></div>
        <div><span>{t('报检来源 / 数量')}</span><strong>{task.reportCode} · {task.quantity} {task.unit}</strong><p>{task.date} · {t(task.stage === 'final' ? '终检' : '过程检')} · {t(statusName(task))}</p></div>
        <div className="ip-source-links"><span>{t('本任务受控版本')}</span><div>{task.documents.map((doc) => <Button variant="unstyled" key={doc.id} onClick={() => setSource(doc)}><FileText className="size-4" aria-hidden="true" />{doc.code} · {doc.version}{doc.status !== 'published' ? ` · ${t('待发布')}` : ''}</Button>)}</div></div>
      </section>
      <div className="ip-status-summary" aria-label={t('质量跟进状态')}>
        <span className={cn(task.acceptedAt && 'ip-complete')}>{t('报检')}{' · '}{t(task.acceptedAt ? '已接受' : '待接受')}</span>
        <span>{t('初检')}{' · '}{progress.initial}/{task.quantity} {task.unit}</span>
        <span className={cn(progress.unresolved > 0 && 'ip-attention')}>{t('尚未解决不良')}{' · '}{progress.unresolved} {task.unit}</span>
        <span>{t('QA 已放行')}{' · '}{progress.released} {task.unit}</span>
      </div>
      <div className="ip-mobile-jump"><Button variant="unstyled" onClick={() => scrollToRegion('inspection-records')}>{t('查看检验记录')}</Button><Button variant="unstyled" onClick={() => scrollToRegion('inspection-actions')}>{t('前往检验操作')}</Button></div>
      <div className="ip-workspace">
        <section id="inspection-records" className="ip-main">
          <div className="ip-progress-card"><div className="ip-heading"><h2>{t('首次检验结果')}</h2><span className="ip-badge">{t(task.stage === 'final' ? '终检' : '过程检')} · {t('当前任务')}</span></div>
            <dl className="ip-numbers">{[[t('首次检验'),progress.initial],[t('首次合格'),progress.firstGood],[t('首次不合格'),progress.firstBad]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}<small>{task.unit}</small></dd></div>)}<div><dt>{t('一次合格率')}</dt><dd>{progress.firstPassRate === null ? '—' : `${progress.firstPassRate.toFixed(1)}%`}</dd></div></dl>
            <p>{t('复验另计：累计检验 {quantity}，转合格 {good}。首次合格率不回填。', {quantity:`${progress.retested} ${task.unit}`,good:`${progress.retestGood} ${task.unit}`})}</p>
          </div>
          <Tabs value={view} onValueChange={(value) => changeView(value as InspectionView)}><TabsList className="ip-tabs" aria-label={t('检验记录分类')}>{viewKeys.map((key) => <TabsTrigger key={key} value={key}>{t(inspectionViewLabels[key])}</TabsTrigger>)}</TabsList><TabsContent value={view}><InspectionSections state={state} taskId={task.id} view={view} actorId={actorId} readOnly={readOnly} onAction={startAction} onPhoto={setPhoto} onDocument={setSource} /></TabsContent></Tabs>
          <div className="ip-related">{task.archiveId ? <Link to={`/__preview/batch-archives?tab=inspections&batch=${encodeURIComponent(task.archiveId)}`}>{t('查看该批次历史档案')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : <span>{t('检验记录已按当前批次归集')}</span>}<p>{t('本页与现场报工、批次档案为独立演示。新增检验不会回写档案、库存或出货。')}</p></div>
        </section>
        <aside id="inspection-actions" className="ip-sidebar" aria-label={t('当前检验操作')}>
          <Button variant="unstyled" className="ip-back" onClick={() => scrollToRegion('inspection-records')}>{t('返回检验记录')}</Button>
          {actionContext ? <InspectionActionForm key={`${generation}:${actorId}:${task.id}:${actionContext.kind}`} state={state} actorId={actorId} context={actionContext} readOnly={readOnly} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(clearForm)} /> : <>
            <div className="ip-action-card"><div className="ip-heading"><h2>{t('当前检验操作')}</h2><span>{actor?.name}</span></div>
              {readOnly ? <p className="ip-note">{t(task.closed ? '任务已结束，保留原始检验和独立放行记录。' : '当前为只读范围，可以查看资料与导出记录。')}</p> : <><div className="ip-action-buttons">{!task.acceptedAt ? buttonFor('accept') : <>{buttonFor('inspect',progress.uninspected <= 0)}{buttonFor('reinspect',!issues.some((item) => getReinspectable(state,item.id)>0))}{buttonFor('transfer',!records.some((item) => getTransferable(state,item.id)>0))}{buttonFor('release',progress.releasable<=0)}</>}</div><p className="ip-note">{t(actor?.role === 'qa' ? 'QA 放行须有授权依据；仅终检完成且不良已解决的数量可登记。' : !task.acceptedAt ? '先核对报检来源、数量与 SIP 版本，再接受报检。' : '初检与复验分别提交；复验须关联原不良及已完成的处置范围。')}</p></>}
            </div>
            <div className="ip-action-help"><h3>{t('后续状态分别记录')}</h3><dl className="ip-quality-states"><div><dt>{t('累计检验合格')}</dt><dd>{progress.qualified} {task.unit}</dd></div><div><dt>{t('QA 已放行')}</dt><dd>{progress.released} {task.unit}</dd></div><div><dt>{t('实际出货')}</dt><dd>{t('以出货记录为准')}</dd></div></dl><p>{t('检验合格不自动放行。处置尚未完成的不良继续保留，下一步由不良处理模块跟进。')}</p></div>
          </>}
        </aside>
      </div>
    </>}
    <Sheet open={Boolean(source)} onOpenChange={(open) => { if (!open) setSource(null); }}><SheetContent className="proc-horizon-overlay ip-sheet"><SheetHeader><SheetTitle>{t('检验依据摘要')}</SheetTitle><SheetDescription>{t('原文件尚未接入；按报检任务版本核对，摘要不能替代受控文件。')}</SheetDescription></SheetHeader>{source ? <div className="ip-sheet-body"><h2>{source.code} · {source.version}</h2><p>{source.title} · {t(source.status === 'published' ? '演示已发布' : '待发布')}</p><p>{source.summary}</p></div> : null}</SheetContent></Sheet>
    <Sheet open={Boolean(photo)} onOpenChange={(open) => { if (!open) setPhoto(null); }}><SheetContent className="proc-horizon-overlay ip-sheet"><SheetHeader><SheetTitle>{t('检验证据照片')}</SheetTitle><SheetDescription>{t('本次演示中添加的照片，未上传至正式服务。')}</SheetDescription></SheetHeader>{photo ? <div className="ip-sheet-body"><p>{photo.name}</p><img src={photo.dataUrl} alt={photo.name} className="ip-evidence-image" /></div> : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open) => { setDiscardOpen(open); if (!open) pendingChange.current = null; }}><AlertDialogContent className="proc-horizon-overlay ip-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('当前填写将清空，已提交的检验记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => { pendingChange.current = null; setDiscardOpen(false); }}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const change = pendingChange.current; pendingChange.current = null; setDiscardOpen(false); clearForm(); change?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state === 'blocked'}><AlertDialogContent className="proc-horizon-overlay ip-dialog"><AlertDialogHeader><AlertDialogTitle>{t('离开当前检验任务？')}</AlertDialogTitle><AlertDialogDescription>{t('尚未保存的填写将丢失。已保存演示记录也会在页面重新加载后恢复样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.reset?.()}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { clearForm(); blocker.proceed?.(); }}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="proc-horizon-overlay ip-dialog"><AlertDialogHeader><AlertDialogTitle>{t('重置检验演示？')}</AlertDialogTitle><AlertDialogDescription>{t('本次新增的检验、照片、不良处理单及 QA 放行记录将恢复为初始样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留当前记录')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
