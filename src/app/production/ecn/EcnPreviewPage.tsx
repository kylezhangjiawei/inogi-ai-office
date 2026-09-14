import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, CheckCircle2, Circle, Download, FileDiff, FileText, History, MessageSquareWarning, RotateCcw, Search, ShieldCheck } from 'lucide-react';
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
import { EcnActionForm } from './EcnActionForm';
import { EcnSections } from './EcnSections';
import { applyEcnAction, buildEcnCsv, createEcnState, getArchiveBlockers, getEcnProgress } from './ecnModel';
import { ecnStatusLabels, ecnTabLabels, type EcnAction, type EcnActionContext, type EcnTab } from './ecnTypes';
import '../../order-processing/horizon.css';
import './ecn-preview.css';

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const tabKeys = Object.keys(ecnTabLabels) as EcnTab[];
export function EcnPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(createEcnState);
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('line-a');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<EcnActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
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
  const rawTab = params.get('tab');
  const tab: EcnTab = tabKeys.includes(rawTab as EcnTab) ? rawTab as EcnTab : 'comparison';
  const needle = query.trim().toLocaleLowerCase();
  const matches = scenario === 'empty' ? [] : state.records.filter((item) => (statusFilter === 'all' || statusFilter === item.status) && [item.code, item.title, item.materialCode, item.materialName, ...item.impacts.flatMap((impact) => [impact.batchNo, impact.planNo]), ...item.legacyTargets.map((target) => target.code)].join(' ').toLocaleLowerCase().includes(needle));
  const requested = params.get('ecn');
  const recordId = requested ?? matches[0]?.id;
  const record = matches.find((item) => item.id === recordId);
  const actor = state.actors.find((item) => item.id === actorId);
  const progress = record ? getEcnProgress(state, record.id) : null;
  const blockers = record && record.status !== 'archived' ? getArchiveBlockers(state, record.id) : [];
  const readOnly = scenario !== 'normal' || record?.status !== 'published';
  const document = record?.documents.find((item) => item.id === documentId);
  const myRead = record ? new Set(record.acknowledgements.filter((item) => item.actorId === actorId).flatMap((item) => item.impactIds)) : new Set<string>();
  const myComplete = Boolean(record?.impacts.length && record.impacts.every((item) => myRead.has(item.id)));
  const actionContextRef = useRef({ recordId: record?.id, actorId, editing, scenario, generation });
  actionContextRef.current = { recordId: record?.id, actorId, editing, scenario, generation };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function scrollToRegion(id: 'ecn-content' | 'ecn-actions') { window.document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  function clearForm() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) { if (busyRef.current) return; if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); } else action(); }
  function location(nextTab: EcnTab, id?: string) {
    const next = new URLSearchParams(params); next.set('tab', nextTab); if (id) next.set('ecn', id); else next.delete('ecn');
    internalNavigation.current = true; try { setParams(next); } finally { internalNavigation.current = false; }
  }
  function switchTab(next: EcnTab) { requestChange(() => { clearForm(); setFlash(''); location(next, record?.id); }); }
  function startAction(context: EcnActionContext) {
    if (readOnly) return;
    requestChange(() => { clearForm(); setFlash(''); setError(''); setEditing(context); if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('ecn-actions')); });
  }
  function changeFilter(change: () => void) { requestChange(() => { clearForm(); change(); setDocumentId(null); setFlash(''); setError(''); location(tab); }); }
  function resetPreview() { const next = createEcnState(); stateRef.current = next; setState(next); clearForm(); setQuery(''); setStatusFilter('all'); setActorId('line-a'); setScenario('normal'); setFailNext(false); setDocumentId(null); setFlash(''); setError(''); setResetOpen(false); location('comparison'); }
  async function save(input: EcnAction) {
    const current = actionContextRef.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!record || !editing || readOnly || input.actorId !== actorId || input.kind !== editing.kind || current.recordId !== record.id || current.actorId !== actorId || current.scenario !== 'normal' || current.generation !== generation || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('当前变更、操作人或动作已变化，请重新打开。'));
    if ((editing.targetId && (!('targetId' in input) || input.targetId !== editing.targetId)) || (editing.taskId && (!('taskId' in input) || input.taskId !== editing.taskId)) || (editing.impactId && (!('impactId' in input) || input.impactId !== editing.impactId))) throw new Error(t('提交对象与当前打开的范围不一致，请重新核对。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyEcnAction(stateRef.current, record.id, state.version, input); stateRef.current = next; setState(next); clearForm();
      const nextTab: EcnTab = input.kind === 'acknowledge' || input.kind === 'verify' ? 'confirmations' : input.kind === 'disposition' ? 'scope' : input.kind === 'archive' ? 'history' : 'tasks';
      location(nextTab, record.id); setFlash(t(({ acknowledge:'已保存已阅与范围确认，执行验证仍单独记录。', disposition:'旧版处置决定已留档，库存、批次和订单原记录未自动改版。', feedback:'已生成本页协同待办，可继续跟进；尚未发送外部通知。', 'resolve-task':'协同处理结果已留档；执行验证仍需单独核对。', verify:'执行验证已记录，可在岗位确认与验证中查看历史。', archive:'演示变更已归档，版本与执行证据保留。' })[input.kind]));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportRecord() {
    if (!record) return;
    try { const csv = buildEcnCsv(state, record.id); const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' })); const link = window.document.createElement('a'); link.href = url; link.download = `${record.code}-变更记录-演示.csv`; window.document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setError(''); setFlash(t('已发起变更记录下载，包含已保存资料和操作历史。')); } catch { setError(t('变更记录导出失败，请重试。')); }
  }
  function sidebar() {
    if (!record || !progress) return null;
    if (editing) return <section className="ecn-card"><p className="ecn-meta">{record.code} · {actor?.name}</p><EcnActionForm key={`${generation}:${record.id}:${actorId}:${JSON.stringify(editing)}`} state={state} recordId={record.id} actorId={actorId} context={editing} readOnly={readOnly} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(clearForm)} /></section>;
    return <>
      <section className="ecn-card"><div className="ecn-heading"><h2>{t('我的执行确认')}</h2><ShieldCheck className="size-4" aria-hidden="true" /></div><p className="ecn-person">{actor?.name}<span>{actor?.role}</span></p>
        {readOnly ? <p className="ecn-callout">{t(record.status === 'draft' ? '未发布草稿仅供评审，不能作为现场作业依据。' : record.status === 'archived' ? '此变更已归档，查看保留的确认与验证记录。' : '当前为只读预览。')}</p> : <><p className="ecn-note">{myComplete ? t('你已查看本次变更及全部列明范围。') : t('先核对版本差异及适用批次，再确认本人已阅。')}</p><Button className="ecn-primary-action" disabled={myComplete} onClick={() => startAction({kind:'acknowledge'})}><CheckCircle2 className="size-4" aria-hidden="true" />{t(myComplete ? '本人已完成已阅确认' : '确认已阅与适用范围')}</Button><Button variant="outline" className="ecn-primary-action" onClick={() => startAction({kind:'feedback'})}><MessageSquareWarning className="size-4" aria-hidden="true" />{t('反馈执行问题')}</Button></>}
        <p className="ecn-callout">{t('已阅不代表验证合格。旧库存、在制品及旧订单按明确决定处理，不自动全量换版。')}</p>
      </section>
      <section className="ecn-card"><div className="ecn-heading"><h2>{t('执行与归档条件')}</h2><span className="ecn-muted">{t('{count} 项待满足',{count:blockers.length})}</span></div><dl className="ecn-review-grid"><div><dt>{t('岗位已阅')}</dt><dd>{progress.acknowledged} / {progress.required}</dd></div><div><dt>{t('执行验证通过')}</dt><dd>{progress.verified} / {progress.verificationRequired}</dd></div></dl><div className="ecn-quick-links"><button onClick={() => switchTab('scope')}>{t('旧版处置待决定')} <strong>{progress.undecided}</strong><ArrowRight className="size-3.5" aria-hidden="true" /></button><button onClick={() => switchTab('tasks')}>{t('未完成协同')} <strong>{progress.openTasks}</strong><ArrowRight className="size-3.5" aria-hidden="true" /></button></div>{blockers.length ? <details className="ecn-blockers"><summary>{t('查看待满足条件')}</summary><ul>{blockers.map((item) => <li key={item}>{t(item)}</li>)}</ul></details> : <p className="ecn-note">{t(record.status === 'archived' ? '归档时的依据已保留。' : '当前演示资料已满足归档条件。')}</p>}{!readOnly && actor?.team === 'quality' ? <div className="ecn-side-buttons"><Button variant="outline" onClick={() => startAction({kind:'verify'})}>{t('登记执行验证')}</Button><Button disabled={blockers.length > 0} onClick={() => startAction({kind:'archive'})}>{t('归档变更')}</Button></div> : null}</section>
      <section className="ecn-card"><h2>{t('相关资料')}</h2><p className="ecn-note">{t('本页保留独立演示记录。正式文件、岗位权限和跨模块数据后续接入。')}</p>{record.impacts.some((item) => item.batchNo === 'B-FG-0902') ? <Link className="ecn-archive-link" to="/__preview/batch-archives?tab=versions&batch=batch-02">{t('查看 B-FG-0902 原版本档案')}<ArrowRight className="size-4" aria-hidden="true" /></Link> : null}<p className="ecn-note">{t('档案展示原批次历史版本，本页动作不会自动改写档案。')}</p></section>
    </>;
  }
  return <main className="order-horizon ecn-preview">
    <OrderPageHeader Icon={FileDiff} eyebrow={t('生产管理 / ECN 变更 / P10')} title={t('ECN 变更查看与确认')} description={t('核对变更内容和适用范围，保留岗位确认、旧版处置与执行证据。')} actions={<><Button variant="outline" disabled={busy} onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button variant="outline" disabled={!record || scenario==='error'} onClick={() => switchTab('history')}><History className="size-4" aria-hidden="true" />{t('操作记录')}</Button><Button disabled={!record || scenario==='error' || busy} onClick={exportRecord}><Download className="size-4" aria-hidden="true" />{t('导出变更记录')}</Button></>} />
    <div className="ecn-preview-note"><strong>{t('前端演示')}</strong><span>{t('填写仅在本次预览保留，刷新恢复；协同待办不发送外部通知。')}</span></div>
    <details className="ecn-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal','readonly','empty','error'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'secondary' : 'outline'} aria-pressed={scenario===value} onClick={() => changeFilter(() => setScenario(value))}>{t({normal:'正常',readonly:'只读',empty:'空数据',error:'读取失败'}[value])}</Button>)}<label><input type="checkbox" checked={failNext} disabled={readOnly || busy} onChange={(event) => setFailNext(event.target.checked)} />{t('下次保存失败')}</label></div></details>
    {flash ? <p className="ecn-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</p> : null}{error ? <p role="alert" className="ecn-error">{error}</p> : null}
    {scenario === 'error' ? <section className="ecn-card"><OrderEmptyState Icon={AlertCircle} title={t('ECN 资料读取失败')} description={t('重新读取可恢复当前已保存的演示记录。')} action={<Button onClick={() => setScenario('normal')}>{t('重新读取')}</Button>} /></section> : <>
      <section className="ecn-filters" aria-label={t('选择变更与操作人')}><div><Label htmlFor="ecn-query">{t('查找 ECN 或批次')}</Label><div className="ecn-search"><Search className="size-4" aria-hidden="true" /><Input id="ecn-query" value={query} placeholder={t('ECN、物料、批次或订单号')} onChange={(event) => {const value=event.target.value; changeFilter(() => setQuery(value));}} /></div></div><div><Label htmlFor="ecn-record">{t('当前变更')}</Label><Select value={record?.id ?? ''} disabled={!matches.length} onValueChange={(id) => requestChange(() => {clearForm();setDocumentId(null);setFlash('');location(tab,id);})}><SelectTrigger id="ecn-record"><SelectValue placeholder={t('请选择变更')} /></SelectTrigger><SelectContent>{matches.map((item) => <SelectItem key={item.id} value={item.id}>{item.code} · {t(ecnStatusLabels[item.status])}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="ecn-status">{t('发布状态')}</Label><Select value={statusFilter} onValueChange={(value) => changeFilter(() => setStatusFilter(value))}><SelectTrigger id="ecn-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部状态')}</SelectItem>{Object.entries(ecnStatusLabels).map(([key,label]) => <SelectItem value={key} key={key}>{t(label)}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="ecn-actor">{t('演示操作人')}</Label><Select value={actorId} onValueChange={(id) => requestChange(() => {clearForm();setActorId(id);setFlash('');})}><SelectTrigger id="ecn-actor"><SelectValue /></SelectTrigger><SelectContent>{state.actors.map((item) => <SelectItem value={item.id} key={item.id}>{item.name} · {item.role}</SelectItem>)}</SelectContent></Select></div></section>
      {record && progress ? <>
        <section className="ecn-context"><div><span>{t('ECN 编号')}</span><strong>{record.code}</strong><em className={cn('ecn-status',record.status==='draft' && 'ecn-status-warning')}>{t(ecnStatusLabels[record.status])}</em></div><div><span>{t('变更物料 / 工序')}</span><strong>{record.materialName}</strong><small>{record.materialCode} · {record.process}</small></div><div><span>{t('生效范围')}</span><strong>{record.effectiveRule}</strong><small>{t('按下方批次与数量范围核对')}</small></div></section>
        <ol className="ecn-stages" aria-label={t('变更执行进度')}>{[{label:'变更发布',done:record.status!=='draft'},{label:'范围与旧料',done:record.status!=='draft' && progress.undecided===0 && record.impacts.every((item)=>item.applicability!=='pending')},{label:'岗位已阅',done:record.status!=='draft' && progress.acknowledged===progress.required},{label:'执行验证',done:record.status!=='draft' && progress.verified===progress.verificationRequired && progress.openTasks===0},{label:'归档',done:record.status==='archived'}].map((step,index) => <li key={step.label} data-done={step.done}>{step.done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}<span>{index+1}. {t(step.label)}</span><span className="sr-only">{t(step.done?'已完成':'未完成')}</span></li>)}</ol>
        <Tabs value={tab} onValueChange={(value) => switchTab(value as EcnTab)}><TabsList className="ecn-tabs" aria-label={t('变更资料分类')}>{tabKeys.map((value)=><TabsTrigger value={value} key={value}>{t(ecnTabLabels[value])}</TabsTrigger>)}</TabsList><div className="ecn-mobile-jump"><button type="button" onClick={() => scrollToRegion('ecn-content')}>{t('查看当前资料')}</button><button type="button" onClick={() => scrollToRegion('ecn-actions')}>{t('前往当前操作')}</button></div><div className="ecn-workspace"><TabsContent value={tab} className="ecn-card ecn-content"><div id="ecn-content"><EcnSections state={state} actorId={actorId} recordId={record.id} tab={tab} readOnly={readOnly} onViewDocument={setDocumentId} onAction={startAction} /></div></TabsContent><aside className="ecn-sidebar" id="ecn-actions" aria-label={t('执行确认与当前操作')}><button className="ecn-back" type="button" onClick={() => scrollToRegion('ecn-content')}>{t('返回当前资料')}</button>{sidebar()}</aside></div></Tabs>
      </> : <section className="ecn-card"><OrderEmptyState Icon={Search} title={t(scenario==='empty'?'暂无 ECN 变更记录':requested?'未找到这个变更':'没有匹配的 ECN')} description={t('按已有 ECN、物料、批次或订单检索，清除筛选可返回演示记录。')} action={<Button variant="outline" onClick={() => changeFilter(() => {setQuery('');setStatusFilter('all');setScenario('normal');})}>{t('返回演示记录')}</Button>} /></section>}
    </>}
    <Sheet open={Boolean(documentId)} onOpenChange={(open) => {if(!open)setDocumentId(null);}}><SheetContent className="ecn-sheet"><SheetHeader><SheetTitle>{t('版本资料摘要')}</SheetTitle><SheetDescription>{t('按记录的具体版本查看。参考文件夹未附工程图纸原文件，当前不提供原图预览。')}</SheetDescription></SheetHeader>{document ? <div className="ecn-sheet-body"><div className="ecn-heading"><h2>{document.code}</h2><span className="ecn-status">{t(document.status==='published'?'已发布资料':'未发布草稿')}</span></div><p className="ecn-note">{document.title}</p><dl className="ecn-facts"><div><dt>{t('资料版本')}</dt><dd>{document.revision}</dd></div><div><dt>{t('适用批次')}</dt><dd>{document.impactIds.map((id)=>record?.impacts.find((item)=>item.id===id)?.batchNo ?? t('待补齐')).join('、') || t('按变更范围核对')}</dd></div>{document.facts.map((item)=><div key={item.label}><dt>{t(item.label)}</dt><dd>{item.value}</dd></div>)}</dl><p className="ecn-callout">{document.summary}</p><p className="ecn-note">{t('本摘要为演示资料，正式文件、发布状态及访问授权后续接入核验。')}</p></div> : <OrderEmptyState Icon={FileText} title={t('资料尚未归集')} description={t('保留版本引用，后续补齐来源。')} action={<Button variant="outline" onClick={()=>setDocumentId(null)}>{t('返回变更')}</Button>} />}</SheetContent></Sheet>
    <AlertDialog open={discardOpen || blocker.state==='blocked'} onOpenChange={(open)=>{if(!open){setDiscardOpen(false);pendingAction.current=null;if(blocker.state==='blocked')blocker.reset();}}}><AlertDialogContent className="ecn-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将清空，已保存的确认、待办与历史记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={()=>{const action=pendingAction.current;pendingAction.current=null;clearForm();setDiscardOpen(false);if(blocker.state==='blocked')blocker.proceed();else action?.();}}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="ecn-dialog"><AlertDialogHeader><AlertDialogTitle>{t('恢复初始演示变更？')}</AlertDialogTitle><AlertDialogDescription>{t('本次岗位确认、处置决定、协同和验证记录将清空。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction onClick={resetPreview}>{t('重置演示数据')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
