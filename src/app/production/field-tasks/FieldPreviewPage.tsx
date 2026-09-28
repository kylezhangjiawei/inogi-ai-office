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
import { FieldActionForm } from './FieldActionForm';
import { FieldSections } from './FieldSections';
import { applyFieldAction, buildFieldCsv, canOperateField, createFieldState, getFieldProgress, getReturnable } from './fieldModel';
import { fieldActionLabels, fieldViewLabels, type FieldAction, type FieldActionContext, type FieldPhoto, type FieldTask, type FieldView } from './fieldTypes';
import '../../order-processing/horizon.css';
import './field-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const viewKeys = Object.keys(fieldViewLabels) as FieldView[];
const statusName = (task: FieldTask) => task.closed ? '已结束' : task.acceptedAt ? '执行中' : '待接收';

export function FieldPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = viewKeys.includes(params.get('tab') as FieldView) ? params.get('tab') as FieldView : 'reports';
  const [state, setState] = useState(createFieldState);
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('line-a-owner');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<FieldActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [source, setSource] = useState<PlanningDocument | null>(null);
  const [photo, setPhoto] = useState<FieldPhoto | null>(null);
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
  const scopedTasks = state.tasks.filter((item) => actor && (actor.role !== 'line' || item.lineId === actor.lineId));
  const tasks = scenario === 'empty' ? [] : scopedTasks.filter((item) =>
    (statusFilter === 'all' || (statusFilter === 'pending' ? !item.acceptedAt && !item.closed : statusFilter === 'active' ? Boolean(item.acceptedAt) && !item.closed : item.closed)) &&
    [item.code, item.dispatchCode, item.batchCode, item.product, item.component, item.process, item.lineName].join(' ').toLocaleLowerCase().includes(needle));
  const task = params.has('task') ? tasks.find((item) => item.id === params.get('task')) : tasks[0];
  const progress = task ? getFieldProgress(state, task.id) : null;
  const readOnly = scenario !== 'normal' || !task || !canOperateField(state, actorId, task.id) || task.closed;
  const actionContext = editing?.taskId === task?.id ? editing : null;
  const ctx = useRef({ generation, actorId, taskId: task?.id, editing, scenario });
  ctx.current = { generation, actorId, taskId: task?.id, editing, scenario };
  const issues = state.issues.filter((item) => item.taskId === task?.id);
  const drafts = task ? state.drafts[`${actorId}:${task.id}`] : undefined;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function scrollToRegion(id: 'field-records' | 'field-actions') {
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
  function changeView(next: FieldView) {
    requestChange(() => { clearForm(); navigate({ tab: next }); });
  }
  function startAction(context: FieldActionContext) {
    if (readOnly || context.taskId !== task?.id) return;
    requestChange(() => {
      clearForm(); setFlash(''); setEditing(context);
      if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('field-actions'));
    });
  }
  function reset() {
    const next = createFieldState(); stateRef.current = next; setState(next); clearForm();
    setActorId('line-a-owner'); setQuery(''); setStatusFilter('all'); setScenario('normal');
    setFlash(''); setExportError(''); setFailNext(false); setResetOpen(false); setSource(null); setPhoto(null);
    navigate({ task: null, tab: 'reports' });
  }
  async function save(input: FieldAction) {
    const current = ctx.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!actionContext || !task || readOnly || current.generation !== generation || current.actorId !== actorId || current.taskId !== task.id || current.scenario !== 'normal' || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('任务或操作人已变化，请重新打开。'));
    if (input.taskId !== task.id || input.actorId !== actorId || (input.kind !== actionContext.kind && !(input.kind === 'save-draft' && actionContext.kind === 'report'))) throw new Error(t('提交内容与当前操作不一致。'));
    if ((input.kind === 'defect' && actionContext.reportId && input.reportId !== actionContext.reportId) || ((input.kind === 'sign' || input.kind === 'return') && actionContext.issueId && input.issueId !== actionContext.issueId)) throw new Error(t('来源记录与打开时不一致，请重新选择。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyFieldAction(stateRef.current, state.version, input);
      stateRef.current = next; setState(next); clearForm();
      if (input.kind === 'accept') setStatusFilter('all');
      if (input.kind === 'save-draft') setEditing({ kind: 'report', taskId: task.id });
      const nextView: FieldView = input.kind === 'defect' ? 'defects' : input.kind === 'sign' || input.kind === 'return' ? 'materials' : input.kind === 'accept' ? 'history' : 'reports';
      navigate({ task: task.id, tab: nextView });
      const messages: Record<FieldAction['kind'], string> = {
        accept: '派工已接收，可核对领料并登记实际报工。', sign: '领料签收已记录，签收不会再次扣减库存。',
        'save-draft': '报工草稿已保存在本页，尚未计入实际数量。刷新后恢复演示。',
        report: '报工已提交。现场自检合格不等同正式检验或整机完工；不良请关联本次报工登记。',
        defect: '不良已登记为待质量处理，原报工及不良总数保持不变。',
        return: '退料申请已记录，等待仓库核对；尚未退回入库。',
      };
      setFlash(t(messages[input.kind]));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportTask() {
    if (!task) return;
    try {
      const blob = new Blob([buildFieldCsv(state, task.id)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const link = window.document.createElement('a');
      link.href = url; link.download = `${task.code}-现场记录.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError('');
    } catch { setExportError(t('导出未完成，请重试。当前填写保留。')); }
  }
  const buttonFor = (kind: FieldActionContext['kind'], disabled = false) => task ?
    <Button key={kind} variant={kind === 'report' || kind === 'accept' ? 'default' : 'outline'} disabled={readOnly || disabled} onClick={() => startAction({ kind, taskId: task.id })}>{t(fieldActionLabels[kind])}</Button> : null;

  return <main className="order-horizon field-preview">
    <OrderPageHeader Icon={ClipboardCheck} title={t('现场任务与不良登记')} description={t('核对当前派工，记录现场实际数量，跟进领料与不良。')} eyebrow={t('生产管理 / 现场报工 / P02')} actions={<><Button variant="outline" onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button variant="outline" disabled={!task || scenario === 'error'} onClick={exportTask}><Download className="size-4" aria-hidden="true" />{t('导出当前任务')}</Button></>} />
    <div className="ft-preview-note"><strong>{t('前端演示')}</strong><span>{t('预置派工快照与 P01 独立；报工、照片及领退料仅在本页保留，刷新恢复。正式接口后续接入。')}</span></div>
    <details className="ft-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal', 'readonly', 'empty', 'error'] as Scenario[]).map((item) => <Button key={item} size="sm" variant={scenario === item ? 'default' : 'outline'} onClick={() => filter(() => setScenario(item))}>{t(({ normal: '正常', readonly: '只读', empty: '空数据', error: '读取失败' })[item])}</Button>)}<label><Checkbox checked={failNext} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    <section className="ft-filters" aria-label={t('现场任务筛选')}>
      <div><Label htmlFor="field-actor">{t('演示操作人')}</Label><Select value={actorId} onValueChange={(value) => filter(() => setActorId(value))}><SelectTrigger id="field-actor"><SelectValue /></SelectTrigger><SelectContent>{state.actors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {t(item.role === 'supervisor' ? '主管 / 可补录' : item.role === 'viewer' ? '只读' : '仅本线')}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="field-status">{t('任务状态')}</Label><Select value={statusFilter} onValueChange={(value) => filter(() => setStatusFilter(value))}><SelectTrigger id="field-status"><SelectValue /></SelectTrigger><SelectContent>{[['all','全部状态'],['pending','待接收'],['active','执行中'],['closed','已结束']].map(([value,label]) => <SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></div>
      <div className="ft-search"><Label htmlFor="field-query">{t('查找任务')}</Label><Input id="field-query" value={query} placeholder={t('任务、派工、批次或组件')} onChange={(event) => { const value = event.target.value; filter(() => setQuery(value)); }} /></div>
    </section>
    {flash ? <div className="ft-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</div> : null}
    {exportError ? <p role="alert" className="ft-error">{exportError}</p> : null}
    {scenario === 'error' ? <OrderEmptyState Icon={ClipboardCheck} title={t('现场任务读取失败')} description={t('已有演示记录保留，重试后继续。')} action={<Button onClick={() => setScenario('normal')}>{t('重试读取')}</Button>} /> : !task || !progress ? <OrderEmptyState Icon={ClipboardCheck} title={t('当前范围没有可查看任务')} description={t('检查任务编号、筛选或操作人。未完任务按原派工日期保留，不因跨月隐藏。')} action={<Button onClick={() => filter(() => { setScenario('normal'); setQuery(''); setStatusFilter('all'); })}>{t('清除筛选')}</Button>} /> : <>
      <div className="ft-task-picker"><Label htmlFor="field-task">{t('当前现场任务')}</Label><Select value={task.id} onValueChange={selectTask}><SelectTrigger id="field-task"><SelectValue /></SelectTrigger><SelectContent>{tasks.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {item.batchCode} · {item.component} · {t(statusName(item))}</SelectItem>)}</SelectContent></Select><span>{t('共 {count} 项，含跨月未完', { count: tasks.length })}</span></div>
      <section className="ft-context" aria-label={t('派工带入信息')}>
        <div><span>{t('生产批次 / 产品工序')}</span><strong>{task.batchCode}</strong><p>{task.product} · {task.component} / {task.process}</p></div>
        <div><span>{t('派工日期 / 产线')}</span><strong>{task.date} · {task.lineName}</strong><p>{task.dispatchCode} · {t('第 {version} 版', { version: task.dispatchVersion })}</p></div>
        <div className="ft-source-links"><span>{t('本任务作业依据')}</span><div>{task.documents.map((doc) => <Button variant="unstyled" key={doc.id} onClick={() => setSource(doc)}><FileText className="size-4" aria-hidden="true" />{doc.code} · {doc.version}{doc.status !== 'published' ? ` · ${t('待发布')}` : ''}</Button>)}</div>{task.ecnId ? <Link to={`/__preview/ecn?ecn=${encodeURIComponent(task.ecnId)}`}>{t('查看 ECN 与岗位确认')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}</div>
      </section>
      <div className="ft-status-summary" aria-label={t('现场执行概况')}>
        <span className={cn(task.acceptedAt && 'ft-complete')}>{t('派工')}{' · '}{t(task.acceptedAt ? '已接收' : '待接收')}</span>
        <span>{t('领料')}{' · '}{issues.filter((item) => item.signedAt).length}/{issues.length} {t('单已签收')}</span>
        <span>{t('报工')}{' · '}{progress.reported}/{task.planned} {task.unit}</span>
        <span className={cn(progress.unregisteredBad > 0 && 'ft-attention')}>{t('不良')}{' · '}{progress.unregisteredBad} {task.unit}{t('待登记')}</span>
      </div>
      <div className="ft-mobile-jump"><Button variant="unstyled" onClick={() => scrollToRegion('field-records')}>{t('查看任务记录')}</Button><Button variant="unstyled" onClick={() => scrollToRegion('field-actions')}>{t('前往现场操作')}</Button></div>
      <div className="ft-workspace">
        <section id="field-records" className="ft-main">
          <div className="ft-progress-card">
            <div className="ft-heading"><h2>{t('当前任务实际进度')}</h2><span className="ft-badge">{t(statusName(task))}</span></div>
            <dl className="ft-numbers">{[[t('计划数量'),task.planned],[t('累计报工'),progress.reported],[t('现场自检合格'),progress.good],[t('现场不良'),progress.bad],[t('尚未报工'),progress.unreported]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}<small>{task.unit}</small></dd></div>)}</dl>
            <p>{t('本页为现场记录；正式检验、复验及整机完工由后续独立确认。不良明细不再累加到报工数量。')}</p>
          </div>
          <Tabs value={view} onValueChange={(value) => changeView(value as FieldView)}><TabsList className="ft-tabs" aria-label={t('现场记录分类')}>{viewKeys.map((key) => <TabsTrigger key={key} value={key}>{t(fieldViewLabels[key])}</TabsTrigger>)}</TabsList><TabsContent value={view}><FieldSections state={state} taskId={task.id} view={view} readOnly={readOnly} onAction={startAction} onPhoto={setPhoto} /></TabsContent></Tabs>
          <div className="ft-related"><Link to={`/__preview/production-planning?month=${task.date.slice(0,7)}&batch=${encodeURIComponent(task.batchId)}`}>{t('查看批次计划与日安排')}<ArrowRight className="size-4" aria-hidden="true" /></Link><p>{t('两页演示记录独立；本页报工与领退料暂不回写计划、采购或仓库。')}</p></div>
        </section>
        <aside id="field-actions" className="ft-sidebar" aria-label={t('当前现场操作')}>
          <Button variant="unstyled" className="ft-back" onClick={() => scrollToRegion('field-records')}>{t('返回任务记录')}</Button>
          {!actionContext ? <div className="ft-action-card"><div className="ft-heading"><h2>{t('当前现场操作')}</h2><span>{actor?.name}</span></div>
            {readOnly ? <p className="ft-note">{t(task.closed ? '任务已结束，保留原始现场记录。' : '当前为只读范围，可以查看任务、资料与导出。')}</p> : <>
              <div className="ft-action-buttons">{!task.acceptedAt ? buttonFor('accept') : <>{buttonFor('report',progress.unreported <= 0)}{buttonFor('defect',progress.unregisteredBad <= 0)}{buttonFor('sign',!issues.some((item) => !item.signedAt))}{buttonFor('return',!issues.some((item) => getReturnable(state,item.id) > 0))}</>}</div>
              {drafts && actionContext?.kind !== 'report' ? <p className="ft-draft-note">{t('本任务有已保存报工草稿，打开“提交报工”可继续填写。')}</p> : null}
              {!task.acceptedAt ? <p className="ft-note">{t('请先核对产线、批次、数量及作业资料并接收派工。')}</p> : progress.unregisteredBad > 0 ? <p className="ft-draft-note">{t('已有 {quantity} 个不良待补充现象与来源；按尚未登记的实物分组，不重复登记。', { quantity: progress.unregisteredBad })}</p> : <p className="ft-note">{t('逐次登记实际数量，任务计划不会自动转为完成。')}</p>}
            </>}
          </div> : null}
          {actionContext ? <FieldActionForm key={`${generation}:${actorId}:${task.id}:${actionContext.kind}`} state={state} actorId={actorId} context={actionContext} readOnly={readOnly} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(clearForm)} /> : <div className="ft-action-help"><h3>{t('填写前核对')}</h3><p>{t('生产批次和工序由派工带入。报工数量由现场填写，来料批次从签收单选择；缺码可以标记待补齐。')}</p><p>{t('退料先提出申请，由仓库后续核对实际接收。照片只保留在本次演示中。')}</p></div>}
        </aside>
      </div>
    </>}
    <Sheet open={Boolean(source)} onOpenChange={(open) => { if (!open) setSource(null); }}><SheetContent className="proc-horizon-overlay ft-sheet"><SheetHeader><SheetTitle>{t('现场作业资料摘要')}</SheetTitle><SheetDescription>{t('原文件尚未接入；按派工版本核对，摘要不能替代受控文件。')}</SheetDescription></SheetHeader>{source ? <div className="ft-sheet-body"><h2>{source.code} · {source.version}</h2><p>{source.title} · {t(source.status === 'published' ? '演示已发布' : '待发布')}</p><p>{source.summary}</p></div> : null}</SheetContent></Sheet>
    <Sheet open={Boolean(photo)} onOpenChange={(open) => { if (!open) setPhoto(null); }}><SheetContent className="proc-horizon-overlay ft-sheet"><SheetHeader><SheetTitle>{t('现场照片')}</SheetTitle><SheetDescription>{t('本次演示中添加的照片，未上传至正式服务。')}</SheetDescription></SheetHeader>{photo ? <div className="ft-sheet-body"><p>{photo.name}</p><img src={photo.dataUrl} alt={photo.name} className="ft-evidence-image" /></div> : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open) => { setDiscardOpen(open); if (!open) pendingChange.current = null; }}><AlertDialogContent className="proc-horizon-overlay ft-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('当前填写将清空，已保存草稿和提交记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => { pendingChange.current = null; setDiscardOpen(false); }}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const change = pendingChange.current; pendingChange.current = null; setDiscardOpen(false); clearForm(); change?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state === 'blocked'}><AlertDialogContent className="proc-horizon-overlay ft-dialog"><AlertDialogHeader><AlertDialogTitle>{t('离开当前现场任务？')}</AlertDialogTitle><AlertDialogDescription>{t('尚未保存的填写将丢失。已保存演示记录也会在页面重新加载后恢复样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.reset?.()}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { clearForm(); blocker.proceed?.(); }}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="proc-horizon-overlay ft-dialog"><AlertDialogHeader><AlertDialogTitle>{t('重置现场演示？')}</AlertDialogTitle><AlertDialogDescription>{t('本次新增的报工、照片、不良、领退料及草稿将恢复为初始样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留当前记录')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
