import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { CheckCircle2, ClipboardCheck, Download, RotateCcw, AlertTriangle } from 'lucide-react';
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
import { DefectActionForm } from './DefectActionForm';
import { DefectSections } from './DefectSections';
import { applyDefectAction, buildDefectCsv, canOperateDefect, getDefectProgress, getHandoffAvailable, getDefectRanking, defectToday } from './defectModel';
import { getDefectPreviewState, resetDefectPreviewState, setDefectPreviewState } from './defectPreviewSession';
import { defectActionLabels, defectViewLabels, type DefectAction, type DefectActionContext, type DefectPhoto, type DefectIssue, type DefectView, type DefectState, defectDirectionLabels, defectPhenomena } from './defectTypes';
import '../../order-processing/horizon.css';
import './defect-preview.css';

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const viewKeys = Object.keys(defectViewLabels) as DefectView[];
const statusName = (state: DefectState, issue: DefectIssue) => issue.closedAt ? '已关闭' : getDefectProgress(state,issue.id).pendingReinspection > 0 ? '待复验回执' : '待处理';

export function DefectPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = viewKeys.includes(params.get('tab') as DefectView) ? params.get('tab') as DefectView : 'overview';
  const [state, setState] = useState(getDefectPreviewState);
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('quality-a');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [lineFilter, setLineFilter] = useState('all');
  const [showRanking, setShowRanking] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<DefectActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [photo, setPhoto] = useState<DefectPhoto | null>(null);
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
  const scopedIssues = state.issues.filter((item) => actor && (['quality','qc','viewer'].includes(actor.role) || item.ownerId === actor.id));
  const issues = scenario === 'empty' ? [] : scopedIssues.filter((item) =>
    (lineFilter === 'all' || item.lineId === lineFilter) &&
    (statusFilter === 'all' || (statusFilter === 'open' ? !item.closedAt : statusFilter === 'waiting' ? !item.closedAt && getDefectProgress(state,item.id).pendingReinspection > 0 : Boolean(item.closedAt))) &&
    [item.code,item.sourceCode,item.batchCode,item.product,item.material,item.phenomenon,item.process].join(' ').toLocaleLowerCase().includes(needle));
  const issue = params.has('issue') ? issues.find((item) => item.id === params.get('issue')) : issues[0];
  const progress = issue ? getDefectProgress(state, issue.id) : null;
  const readOnly = scenario !== 'normal' || !issue || !canOperateDefect(state,actorId,issue.id) || Boolean(issue.closedAt);
  const actionContext = editing?.issueId === issue?.id ? editing : null;
  const ctx = useRef({ generation, actorId, issueId: issue?.id, editing, scenario });
  ctx.current = { generation, actorId, issueId: issue?.id, editing, scenario };
  const repairs = state.repairs.filter((item) => item.issueId === issue?.id);
  const ranking = getDefectRanking(state, lineFilter);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function scrollToRegion(id: 'defect-records' | 'defect-actions') {
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
    requestChange(() => { clearForm(); change(); setFlash(''); setPhoto(null); navigate({ issue: null }); });
  }
  function selectIssue(id: string) {
    if (!issues.some((item) => item.id === id)) return;
    requestChange(() => { clearForm(); setFlash(''); navigate({ issue: id }); });
  }
  function changeActor(id: string) {
    if (!state.actors.some((item) => item.id === id)) return;
    requestChange(() => { clearForm(); setActorId(id); setFlash(''); setPhoto(null); const nextActor=state.actors.find((item)=>item.id===id); if (issue && nextActor && !['quality','qc','viewer'].includes(nextActor.role) && issue.ownerId!==id) navigate({ issue:null }); });
  }
  function changeView(next: DefectView) {
    requestChange(() => { clearForm(); navigate({ tab: next }); });
  }
  function startAction(context: DefectActionContext) {
    if (readOnly || context.issueId !== issue?.id || !canOperateDefect(state, actorId, context.issueId, context.kind)) return;
    requestChange(() => {
      clearForm(); setFlash(''); setEditing(context);
      if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scrollToRegion('defect-actions'));
    });
  }
  function reset() {
    const next = resetDefectPreviewState(); stateRef.current = next; setState(next); clearForm();
    setActorId('quality-a'); setQuery(''); setStatusFilter('all'); setLineFilter('all'); setShowRanking(false); setScenario('normal');
    setFlash(''); setExportError(''); setFailNext(false); setResetOpen(false); setPhoto(null);
    navigate({ issue: null, tab: 'overview' });
  }
  async function save(input: DefectAction) {
    const current = ctx.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!actionContext || !issue || readOnly || current.generation !== generation || current.actorId !== actorId || current.issueId !== issue.id || current.scenario !== 'normal' || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('任务或操作人已变化，请重新打开。'));
    if (input.issueId !== issue.id || input.actorId !== actorId || input.kind !== actionContext.kind) throw new Error(t('提交内容与当前操作不一致。'));
    if ((input.kind === 'handoff' && actionContext.repairId && input.repairId !== actionContext.repairId) || (input.kind === 'route' && actionContext.direction && input.direction !== actionContext.direction)) throw new Error(t('来源或处理方向与打开时不一致，请重新选择。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyDefectAction(stateRef.current, state.version, input);
      setDefectPreviewState(next); stateRef.current = next; setState(next); clearForm();
      setStatusFilter('all');
      const nextView: DefectView = input.kind === 'repair' ? 'repairs' : input.kind === 'handoff' ? 'reinspection' : input.kind === 'close' ? 'history' : 'overview';
      navigate({ issue: issue.id, tab: nextView });
      const messages: Record<DefectAction['kind'], string> = {
        assign: '责任人和期限已记录，问题继续保留待处理。', route: '处理方向与下一责任人已记录；外部协同尚未发送。',
        repair: '现场整改已登记，尚未送复验，不计为检验合格。', handoff: '复验交接已记录，等待独立检验回执。',
        close: '已按检验回执关闭本页不良记录，首次检验与 QA 放行保持独立。',
      };
      setFlash(t(messages[input.kind]));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function exportIssue() {
    if (!issue) return;
    try {
      const blob = new Blob([buildDefectCsv(state, issue.id)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const link = window.document.createElement('a');
      link.href = url; link.download = `${issue.code}-不良处理记录.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError('');
    } catch { setExportError(t('导出未完成，请重试。当前填写保留。')); }
  }
  const actionButton = (kind: DefectActionContext['kind'], disabled=false, direction?: DefectActionContext['direction']) => issue && canOperateDefect(state,actorId,issue.id,kind) ? <Button key={direction ?? kind} variant={kind==='repair'||kind==='handoff'?'default':'outline'} disabled={readOnly||disabled} onClick={()=>startAction({kind,issueId:issue.id,...(direction?{direction}:{})})}>{t(direction==='rd'?'转研发':direction==='procurement'?'转采购':direction==='onsite'?'转现场整改':defectActionLabels[kind])}</Button> : null;
  const lines = [...new Map(state.issues.map((item)=>[item.lineId,item.lineName])).entries()];
  return <main className="order-horizon defect-preview">
    <OrderPageHeader Icon={AlertTriangle} eyebrow={t('生产管理 / 不良处理 / P08')} title={t('生产不良处理')} description={t('保留原不良范围，落实下一责任人，跟进整改与复验。')} actions={<><Button variant="outline" onClick={()=>requestChange(()=>setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true"/>{t('重置演示')}</Button><Button variant="outline" disabled={!issue||scenario==='error'} onClick={exportIssue}><Download className="size-4" aria-hidden="true"/>{t('导出当前不良')}</Button></>}/>
    <div className="dp-preview-note"><strong>{t('前端演示')}</strong><span>{t('P08 与 P04 共用本次会话的原异常，刷新恢复；检验回执为独立样例，外部任务尚未发送。')}</span></div>
    <details className="dp-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal','readonly','empty','error'] as Scenario[]).map((item)=><Button key={item} size="sm" variant={scenario===item?'default':'outline'} onClick={()=>filter(()=>setScenario(item))}>{t(({normal:'正常',readonly:'只读',empty:'空数据',error:'读取失败'})[item])}</Button>)}<label><input type="checkbox" checked={failNext} onChange={(event)=>setFailNext(event.target.checked)}/>{t('下次保存失败')}</label></div></details>
    <section className="dp-filters" aria-label={t('不良任务筛选')}>
      <div><Label htmlFor="defect-actor">{t('演示操作人')}</Label><Select value={actorId} onValueChange={changeActor}><SelectTrigger id="defect-actor"><SelectValue/></SelectTrigger><SelectContent>{state.actors.map((item)=><SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="defect-line">{t('发生产线')}</Label><Select value={lineFilter} onValueChange={(value)=>filter(()=>setLineFilter(value))}><SelectTrigger id="defect-line"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">{t('全部产线')}</SelectItem>{lines.map(([id,name])=><SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label htmlFor="defect-status">{t('处理状态')}</Label><Select value={statusFilter} onValueChange={(value)=>filter(()=>setStatusFilter(value))}><SelectTrigger id="defect-status"><SelectValue/></SelectTrigger><SelectContent>{[['all','全部状态'],['open','未关闭'],['waiting','待复验回执'],['closed','已关闭']].map(([value,label])=><SelectItem key={value} value={value}>{t(label)}</SelectItem>)}</SelectContent></Select></div>
      <div className="dp-search"><Label htmlFor="defect-query">{t('查找不良')}</Label><Input id="defect-query" value={query} placeholder={t('异常号、现象、批次或物料')} onChange={(event)=>{const value=event.target.value;filter(()=>setQuery(value));}}/></div>
    </section>
    {flash?<div className="dp-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true"/>{flash}</div>:null}
    {exportError?<p role="alert" className="dp-error">{exportError}</p>:null}
    {scenario==='error'?<OrderEmptyState Icon={ClipboardCheck} title={t('生产不良读取失败')} description={t('已有演示记录保留，重试后继续。')} action={<Button onClick={()=>setScenario('normal')}>{t('重试读取')}</Button>}/>:!issue||!progress?<OrderEmptyState Icon={ClipboardCheck} title={t('当前范围没有可查看的不良')} description={t('请核对异常号、产线或操作人；已转交的任务会离开原责任人的列表。')} action={<Button onClick={()=>filter(()=>{setScenario('normal');setQuery('');setStatusFilter('all');setLineFilter('all');})}>{t('清除筛选')}</Button>}/>:<>
      <div className="dp-picker"><Label htmlFor="defect-issue">{t('当前不良任务')}</Label><Select value={issue.id} onValueChange={selectIssue}><SelectTrigger id="defect-issue"><SelectValue/></SelectTrigger><SelectContent>{issues.map((item)=><SelectItem key={item.id} value={item.id}>{item.code} · {item.phenomenon} · {t(statusName(state,item))}</SelectItem>)}</SelectContent></Select></div>
      <div className="dp-board">
        <aside className="dp-queue" aria-label={t('不良处理任务')}><div className="dp-heading"><h2>{t('不良处理任务')}</h2><span>{issues.length}{t('项')}</span></div><p>{t('未关闭问题持续保留')}</p><ul>{issues.map((item)=><li key={item.id}><button className={cn('dp-queue-item',item.id===issue.id&&'dp-selected')} aria-current={item.id===issue.id?'true':undefined} aria-label={t('查看不良 {code}',{code:item.code})} onClick={()=>selectIssue(item.id)}><span className="dp-queue-code">{item.code}</span><strong>{item.phenomenon} · {item.quantity} {item.unit}</strong><span>{item.batchCode} · {item.lineName}</span><span className="dp-queue-meta"><em>{t(({high:'高优先',medium:'中优先',low:'低优先'})[item.priority])}</em>{t(statusName(state,item))}</span></button></li>)}</ul></aside>
        <div className="dp-detail">
          <section className="dp-context" aria-label={t('当前不良详情')}><header><div><span>{t('当前不良')}</span><h2>{issue.code}</h2></div><span className="dp-badge">{t(statusName(state,issue))}</span></header><dl><div><dt>{t('产品 / 发生工序')}</dt><dd>{issue.product} · {issue.process}</dd></div><div><dt>{t('批次 / 物料')}</dt><dd>{issue.batchCode} · {issue.material}</dd></div><div><dt>{t('当前责任人')}</dt><dd>{state.actors.find((item)=>item.id===issue.ownerId)?.name??t('待指派')} · {t(defectDirectionLabels[issue.direction])}</dd></div><div><dt>{t('发现日期 / 处理期限')}</dt><dd>{issue.date} / {issue.dueDate??t('待确定')}{!issue.closedAt&&issue.dueDate&&issue.dueDate<defectToday()?<span className="dp-overdue">{t('已逾期')}</span>:null}</dd></div></dl></section>
          <dl className="dp-numbers" aria-label={t('不良处理数量')}>
            {[[t('原不良范围'),issue.quantity],[t('复验合格'),progress.resolved],[t('已整改待交接'),progress.ready],[t('等待复验回执'),progress.pendingReinspection],[t('尚未解决'),progress.remaining]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}<small>{issue.unit}</small></dd></div>)}
          </dl>
          <p className="dp-quantity-note">{t('剩余数按原不良减去复验合格计算；重复整改和协同不新增不良数量。')}</p>
          <div className="dp-mobile-jump"><button onClick={()=>scrollToRegion('defect-records')}>{t('查看处理记录')}</button><button onClick={()=>scrollToRegion('defect-actions')}>{t('前往处理操作')}</button></div>
          <div className="dp-workspace">
            <section id="defect-records" className="dp-main"><Tabs value={view} onValueChange={(value)=>changeView(value as DefectView)}><TabsList className="dp-tabs" aria-label={t('不良记录分类')}>{viewKeys.map((key)=><TabsTrigger key={key} value={key}>{t(defectViewLabels[key])}</TabsTrigger>)}</TabsList><TabsContent value={view}><DefectSections state={state} issueId={issue.id} view={view} actorId={actorId} readOnly={readOnly} onAction={startAction} onPhoto={setPhoto}/></TabsContent></Tabs></section>
            <aside id="defect-actions" className="dp-sidebar" aria-label={t('当前处理操作')}><button className="dp-back" onClick={()=>scrollToRegion('defect-records')}>{t('返回处理记录')}</button>
              {actionContext?<DefectActionForm key={`${generation}:${actorId}:${issue.id}:${actionContext.kind}`} state={state} actorId={actorId} context={actionContext} readOnly={readOnly} onSubmit={save} onDirtyChange={markDirty} onCancel={()=>requestChange(clearForm)}/>:<><div className="dp-action-card"><div className="dp-heading"><h2>{t('当前处理操作')}</h2><span>{actor?.name}</span></div>{readOnly?<p className="dp-note">{t(issue.closedAt?'不良已关闭，原始数量和处置依据保留。':'当前岗位仅可查看记录与来源。')}</p>:<><div className="dp-action-buttons">{actionButton('assign')}{actionButton('repair',issue.direction!=='onsite'||progress.availableToRepair<=0)}{actionButton('handoff',!repairs.some((item)=>getHandoffAvailable(state,item.id)>0))}{actionButton('close',progress.remaining>0||progress.pendingReinspection>0||progress.ready>0)}</div><div className="dp-route-buttons"><span>{t('处理方向')}</span>{actionButton('route',false,'rd')}{actionButton('route',false,'procurement')}{actionButton('route',false,'onsite')}</div><p className="dp-note">{t(progress.pendingReinspection>0?'已送复验部分等待 QC 回执，不能直接改为合格或关闭。':progress.ready>0?'已有完成整改的数量，可以按实际范围提交复验。':'原因尚未确认可以继续分派、协同或整改。未解决的问题保留下一责任人。')}</p></>}</div><div className="dp-action-help"><h3>{t('按同一异常持续跟进')}</h3><p>{t('整改次数不等于去重不良件数。复验未通过的范围回到原异常继续处理，QC 合格与 QA 放行分别记录。')}</p></div></>}
            </aside>
          </div>
        </div>
      </div>
      <section className="dp-ranking" aria-label={t('常用现象与历史统计')}><div className="dp-heading"><div><h2>{t(showRanking?'近期高频现象 Top10':'初始常用现象')}</h2><p>{t(showRanking?'近 30 天演示样本，按原始来源去重计发生次数，不按不良数量排名。':'用于填写建议，不代表已发生次数或生产排名。正式常用项由工艺资料确认。')}</p></div><Button size="sm" variant="outline" onClick={()=>setShowRanking((value)=>!value)}>{t(showRanking?'查看初始常用项':'查看近期样例统计')}</Button></div>{showRanking?ranking.length?<ol className="dp-rank-list">{ranking.map((row,index)=><li key={row.phenomenon}><span>{index+1}</span><strong>{row.phenomenon}</strong><span>{row.count}{t('次')}</span></li>)}</ol>:<p>{t('当前产线没有近期历史样本，暂不显示排名。')}</p>:<ul className="dp-common-list">{defectPhenomena.map((name)=><li key={name}>{t(name)}</li>)}</ul>}</section>
    </>}
    <Sheet open={Boolean(photo)} onOpenChange={(open)=>{if(!open)setPhoto(null);}}><SheetContent className="proc-horizon-overlay dp-sheet"><SheetHeader><SheetTitle>{t('整改照片')}</SheetTitle><SheetDescription>{t('本次演示中添加的照片，未上传至正式服务。')}</SheetDescription></SheetHeader>{photo?<div className="dp-sheet-body"><p>{photo.name}</p><img src={photo.dataUrl} alt={photo.name}/></div>:null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open)=>{setDiscardOpen(open);if(!open)pendingChange.current=null;}}><AlertDialogContent className="proc-horizon-overlay dp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('当前填写将清空，已提交的处理记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={()=>{pendingChange.current=null;setDiscardOpen(false);}}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={()=>{const change=pendingChange.current;pendingChange.current=null;setDiscardOpen(false);clearForm();change?.();}}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state==='blocked'}><AlertDialogContent className="proc-horizon-overlay dp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('离开当前不良处理？')}</AlertDialogTitle><AlertDialogDescription>{t('尚未保存的填写将丢失；演示记录在页面重新加载后恢复样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={()=>blocker.reset?.()}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={()=>{clearForm();blocker.proceed?.();}}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="proc-horizon-overlay dp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('重置不良处理演示？')}</AlertDialogTitle><AlertDialogDescription>{t('P08 的分派、整改、照片和复验交接，以及 P04 技术协同记录，将一起恢复为初始样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留当前记录')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
