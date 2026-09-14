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
import { useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { TransferActionForm } from './TransferActionForm';
import { applyTransferAction, buildTransferCsv, canOperateTransfer, createTransferState, getTransferGates } from './transferModel';
import { transferActionLabels, transferDocumentLabels, transferRoleLabels, transferTabLabels, type TransferAction, type TransferActionContext, type TransferDocument, type TransferEvidence, type TransferTab } from './transferTypes';
import '../../order-processing/horizon.css';
import './transfer-preview.css';

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const tabKeys = Object.keys(transferTabLabels) as TransferTab[];
export function TransferPreviewPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: TransferTab = tabKeys.includes(params.get('tab') as TransferTab) ? params.get('tab') as TransferTab : 'documents';
  const [state, setState] = useState(createTransferState);
  const stateRef = useRef(state);
  const [actorId, setActorId] = useState('process-a');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [editing, setEditing] = useState<TransferActionContext | null>(null);
  const [generation, setGeneration] = useState(0);
  const [document, setDocument] = useState<TransferDocument | null>(null);
  const [evidence, setEvidence] = useState<TransferEvidence | null>(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [failNext, setFailNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const internalNavigation = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const blocker = useBlocker(() => !internalNavigation.current && (dirtyRef.current || busyRef.current));
  const needle = query.trim().toLocaleLowerCase();
  const matches = scenario === 'empty' ? [] : state.records.filter((item) => (status === 'all' || item.status === status) && `${item.code} ${item.batch} ${item.sample} ${item.product}`.toLocaleLowerCase().includes(needle));
  const record = params.has('transfer') ? matches.find((item) => item.id === params.get('transfer')) : matches[0];
  const actor = state.actors.find((item) => item.id === actorId);
  const gates = record ? getTransferGates(record) : null;
  const readOnly = scenario !== 'normal' || !record || record.status === 'confirmed' || actor?.role === 'viewer';
  const context = editing?.recordId === record?.id ? editing : null;
  const ctx = useRef({ recordId: record?.id, actorId, scenario, generation, editing });
  ctx.current = { recordId: record?.id, actorId, scenario, generation, editing };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function clearForm() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function requestChange(action: () => void) { if (busyRef.current) return; if (dirtyRef.current) { pending.current = action; setDiscardOpen(true); } else action(); }
  function navigate(nextTab: TransferTab, id?: string) { const next = new URLSearchParams(params); next.set('tab', nextTab); if (id) next.set('transfer', id); else next.delete('transfer'); internalNavigation.current = true; try { setParams(next); } finally { internalNavigation.current = false; } }
  function changeScope(action: () => void, clearSelection = false) { requestChange(() => {clearForm(); action(); setFlash(''); setError(''); setDocument(null); setEvidence(null); if (clearSelection) navigate(tab);}); }
  function changeTab(value: TransferTab) { changeScope(() => navigate(value, record?.id)); }
  function scroll(id: string) { window.document.getElementById(id)?.scrollIntoView({ behavior:'instant', block:'start' }); }
  function startAction(kind: TransferAction['kind'], targetId?: string) {
    if (!record || readOnly || !canOperateTransfer(state, actorId, record.id, kind)) return;
    requestChange(() => { clearForm(); setFlash(''); setEditing({kind, recordId:record.id, targetId}); if (window.matchMedia?.('(max-width: 999px)').matches) window.requestAnimationFrame(() => scroll('transfer-actions')); });
  }
  async function save(input: TransferAction) {
    const current = ctx.current;
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    if (!record || !context || readOnly || current.recordId !== record.id || current.actorId !== actorId || current.scenario !== 'normal' || current.generation !== generation || JSON.stringify(current.editing) !== JSON.stringify(editing)) throw new Error(t('批次、岗位或操作已变化，请重新打开。'));
    if (input.recordId !== record.id || input.actorId !== actorId || input.kind !== context.kind || (context.targetId && ('documentId' in input ? input.documentId : 'problemId' in input ? input.problemId : undefined) !== context.targetId)) throw new Error(t('提交内容与当前打开的批次或对象不一致。'));
    busyRef.current = true; setBusy(true);
    try {
      if (failNext) { setFailNext(false); throw new Error(t('演示保存失败，填写内容已保留，请重试。')); }
      const next = applyTransferAction(stateRef.current, state.version, input); stateRef.current = next; setState(next); clearForm(); if (input.kind === 'submit') setStatus('all');
      const nextTab: TransferTab = input.kind === 'document' ? 'documents' : input.kind === 'trial' ? 'trials' : input.kind === 'remedy' || input.kind === 'verify' ? 'problems' : input.kind === 'confirm' ? 'confirmations' : 'history';
      navigate(nextTab, record.id); setFlash(t(input.kind === 'document' ? '资料已补充；请按新资料快照重新试装、复验与岗位确认。' : input.kind === 'submit' ? '转产确认已在本页保存，批次依据已锁定。' : `${transferActionLabels[input.kind]}已保存。`));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function reset() { const next = createTransferState(); stateRef.current = next; setState(next); clearForm(); setActorId('process-a'); setQuery(''); setStatus('all'); setScenario('normal'); setFailNext(false); setFlash(''); setError(''); setDocument(null); setEvidence(null); setResetOpen(false); navigate('documents'); }
  function download() { if (!record) return; try { const url = URL.createObjectURL(new Blob([buildTransferCsv(state,record.id)], {type:'text/csv;charset=utf-8;'})); const link = window.document.createElement('a'); link.href = url; link.download = `${record.code}-转产确认-演示.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url),1000); setError(''); setFlash(t('已发起转产记录下载，包含资料、验证与操作历史。')); } catch { setError(t('导出失败，请重试。当前记录保留。')); } }
  const actionButton = (kind: TransferAction['kind'], disabled = false) => record && canOperateTransfer(state,actorId,record.id,kind) ? <Button key={kind} disabled={readOnly || disabled} variant={kind === 'submit' ? 'default':'outline'} onClick={() => startAction(kind)}>{t(transferActionLabels[kind])}</Button> : null;
  return <main className="order-horizon transfer-preview">
    <OrderPageHeader Icon={ClipboardCheck} eyebrow={t('生产管理 / 转产确认 / P05')} title={t('转产确认')} description={t('从样品结论到试产依据，逐项核对资料、验证与岗位确认。')} actions={<><Button variant="outline" disabled={busy} onClick={() => requestChange(() => setResetOpen(true))}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button><Button disabled={!record || scenario === 'error'} onClick={download}><Download className="size-4" aria-hidden="true" />{t('导出转产记录')}</Button></>} />
    <div className="tp-preview-note"><strong>{t('前端演示')}</strong><span>{t('填写仅在本次预览内保留，刷新恢复；正式资料、权限和跨模块同步后续接入。')}</span></div>
    <details className="tp-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal','readonly','empty','error'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'secondary':'outline'} aria-pressed={scenario === value} onClick={() => changeScope(() => setScenario(value), true)}>{t({normal:'正常',readonly:'只读',empty:'空数据',error:'读取失败'}[value])}</Button>)}<label><input type="checkbox" checked={failNext} disabled={readOnly || busy} onChange={(event) => setFailNext(event.target.checked)} />{t('下次保存失败')}</label></div></details>
    <div className="tp-filters"><div><Label htmlFor="tp-actor">{t('当前岗位')}</Label><Select value={actorId} onValueChange={(value) => changeScope(() => setActorId(value))}><SelectTrigger id="tp-actor"><SelectValue /></SelectTrigger><SelectContent>{state.actors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {t(transferRoleLabels[item.role])}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="tp-status">{t('转产状态')}</Label><Select value={status} onValueChange={(value) => changeScope(() => setStatus(value), true)}><SelectTrigger id="tp-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部状态')}</SelectItem><SelectItem value="preparing">{t('准备转产')}</SelectItem><SelectItem value="confirmed">{t('已确认')}</SelectItem></SelectContent></Select></div><div className="tp-search"><Label htmlFor="tp-query">{t('查找转产批次')}</Label><Input id="tp-query" value={query} placeholder={t('批次、样品或产品型号')} onChange={(event) => { const value = event.target.value; changeScope(() => setQuery(value),true); }} /></div></div>
    {flash ? <p className="tp-feedback" role="status"><CheckCircle2 className="size-4" aria-hidden="true" />{flash}</p> : null}{error ? <p className="tp-error" role="alert">{error}</p> : null}
    {scenario === 'error' ? <OrderEmptyState Icon={ClipboardCheck} title={t('转产资料读取失败')} description={t('已有演示记录保留，可重新读取后继续。')} action={<Button onClick={() => setScenario('normal')}>{t('重新读取')}</Button>} /> : !record || !gates ? <OrderEmptyState Icon={ClipboardCheck} title={t('当前范围没有转产记录')} description={t('检查批次编号或清除筛选后继续。')} action={<Button onClick={() => changeScope(() => {setScenario('normal');setQuery('');setStatus('all');},true)}>{t('清除筛选')}</Button>} /> : <>
      <div className="tp-picker"><Label htmlFor="tp-record">{t('当前转产批次')}</Label><Select value={record.id} onValueChange={(value) => changeScope(() => navigate(tab,value))}><SelectTrigger id="tp-record"><SelectValue /></SelectTrigger><SelectContent>{matches.map((item) => <SelectItem key={item.id} value={item.id}>{item.batch} · {item.product}</SelectItem>)}</SelectContent></Select><span>{t('共 {count} 项',{count:matches.length})}</span></div>
      <section className="tp-context"><div><span>{t('产品 / 转产类型')}</span><strong>{record.product}</strong><p>{t({device:'整机',part:'零部件',actuator:'电动执行器'}[record.type])} · {record.code}</p></div><div><span>{t('关联样品 / 计划转产')}</span><strong>{record.sample}</strong><p>{record.date} · {t(record.samplePassed ? '样品评审通过':'样品待确认')}</p></div><div><span>{t('发布条件')}</span><strong className={gates.blockers.length ? 'tp-warning':'tp-good'}>{t(record.status === 'confirmed' ? '已完成转产确认' : gates.blockers.length ? '尚有 {count} 项待满足' : '条件已齐，可提交', {count:gates.blockers.length})}</strong><p>{t('当前资料快照 {version}',{version:record.basisVersion})}</p></div></section>
      <div className="tp-workflow" aria-label={t('转产条件进度')}>{[[t('样品结论'),record.samplePassed],[t('资料齐套'),gates.docs.length === 0],[t('试装验证'),gates.trialPassed],[t('问题复验'),gates.problems.length === 0],[t('岗位确认'),gates.confirmations.length === 0]].map(([label,done],index) => <span key={String(label)} className={done ? 'tp-step-done':''}><b>{done ? '✓':index+1}</b>{label}</span>)}</div>
      <div className="tp-mobile-jump"><button onClick={() => scroll('transfer-details')}>{t('查看转产资料')}</button><button onClick={() => scroll('transfer-actions')}>{t('前往当前操作')}</button></div>
      <div className="tp-workspace"><section id="transfer-details" className="tp-main">
        <Tabs value={tab} onValueChange={(value) => changeTab(value as TransferTab)}><TabsList className="tp-tabs" aria-label={t('转产资料分类')}>{tabKeys.map((key) => <TabsTrigger key={key} value={key}>{t(transferTabLabels[key])}</TabsTrigger>)}</TabsList><TabsContent value={tab}>
          {tab === 'documents' ? <div className="tp-panel"><div className="tp-heading"><h2>{t('本批转产资料')}</h2><span>{t('按产品类型配置')}</span></div><p className="tp-note">{t(record.type === 'part' ? '本零部件不要求软件、硬件或 ECN；按当前图纸与检验标准验证。' : '各资料按当前批次适用版本核对，更新资料会要求重新验证与确认。')}</p><div className="tp-table-scroll"><table><thead><tr><th>{t('资料')}</th><th>{t('适用版本')}</th><th>{t('发布状态')}</th><th>{t('操作')}</th></tr></thead><tbody>{record.documents.map((doc) => <tr key={doc.id}><td><button className="tp-text-button" onClick={() => setDocument(doc)}><FileText className="size-3.5" aria-hidden="true" />{t(transferDocumentLabels[doc.kind])}</button><small>{doc.code}</small></td><td>{doc.revision || '—'}</td><td><span className={doc.status === 'published' ? 'tp-good':'tp-warning'}>{t(doc.status === 'published' ? '演示已发布':'待补充发布')}</span></td><td>{!readOnly && canOperateTransfer(state,actorId,record.id,'document') ? <Button variant="ghost" size="sm" onClick={() => startAction('document',doc.id)}>{t('补充资料')}</Button> : <span className="tp-muted">{t('查看摘要')}</span>}</td></tr>)}</tbody></table></div><p className="tp-callout">{t('点击资料查看版本摘要。当前未接入受控原文件，摘要不能替代现场作业依据。')}</p></div> : null}
          {tab === 'trials' ? <div className="tp-panel"><div className="tp-heading"><h2>{t('试装 / 小批验证')}</h2><span>{t('最低 {count} 件',{count:record.minTrialQuantity})}</span></div><p className="tp-note">{t(record.requireVideo ? '本类型配置要求验证视频；无视频的试装可以保存，但不能满足转产门槛。' : '本类型未配置视频要求；填写明确验证方法与结果即可，照片和视频选填。')}</p>{record.trials.length ? record.trials.map((trial) => <article className="tp-record-row" key={trial.id}><div className="tp-heading"><h3>{trial.date} · {trial.quantity} {t('件')}</h3><span className={trial.passed ? 'tp-good':'tp-warning'}>{t(trial.passed ? '通过':'未通过')}</span></div><p>{trial.result}</p><p className="tp-note">{t('资料快照 {version}',{version:trial.basisVersion})} · {state.actors.find((item) => item.id === trial.actorId)?.name}{trial.basisVersion !== record.basisVersion ? ` · ${t('历史版本，需重新验证')}` : ''}</p>{trial.evidence.map((item) => <button className="tp-text-button" key={item.id} onClick={() => setEvidence(item)}>{item.name}</button>)}</article>) : <p className="tp-empty">{t('尚未保存试装记录。工艺岗位核对资料后可登记首次验证。')}</p>}</div> : null}
          {tab === 'problems' ? <div className="tp-panel"><div className="tp-heading"><h2>{t('问题整改与复验')}</h2><span>{t('{count} 项待闭环',{count:gates.problems.length})}</span></div>{record.problems.length ? record.problems.map((problem) => <article className="tp-record-row" key={problem.id}><div className="tp-heading"><h3>{problem.id}</h3><span className={problem.status === 'closed' && problem.basisVersion === record.basisVersion ? 'tp-good':'tp-warning'}>{t(problem.status === 'closed' ? problem.basisVersion === record.basisVersion ? '复验通过':'需按新版复验' : problem.status === 'open' ? '待整改':'待质量复验')}</span></div><p>{problem.title}</p><dl className="tp-facts"><div><dt>{t('整改')}</dt><dd>{problem.remedy || t('尚未记录')}</dd></div><div><dt>{t('复验')}</dt><dd>{problem.verification || t('尚未记录')}</dd></div></dl>{!readOnly && (problem.status !== 'closed' || problem.basisVersion !== record.basisVersion) ? <div className="tp-row-actions">{canOperateTransfer(state,actorId,record.id,'remedy') ? <Button size="sm" variant="outline" onClick={() => startAction('remedy',problem.id)}>{t('登记整改')}</Button> : null}{canOperateTransfer(state,actorId,record.id,'verify') && problem.status !== 'open' ? <Button size="sm" variant="outline" onClick={() => startAction('verify',problem.id)}>{t('记录问题复验')}</Button> : null}</div> : null}</article>) : <p className="tp-empty">{t('当前未发现试装问题；后续未通过的试装会生成问题记录。')}</p>}</div> : null}
          {tab === 'confirmations' ? <div className="tp-panel"><h2>{t('必需岗位确认')}</h2><p className="tp-note">{t('先完成资料、试装与问题复验，再由工艺、质量和生产负责人分别确认。')}</p>{record.requiredRoles.map((role) => {const confirmation = record.confirmations.find((item) => item.role === role && item.basisVersion === record.basisVersion); return <article className="tp-record-row" key={role}><div className="tp-heading"><h3>{t(transferRoleLabels[role])}</h3><span className={confirmation ? 'tp-good':'tp-warning'}>{t(confirmation ? '已确认':'待本人确认')}</span></div>{confirmation ? <><p>{confirmation.note}</p><p className="tp-note">{state.actors.find((item) => item.id === confirmation.actorId)?.name} · {t('资料快照 {version}',{version:confirmation.basisVersion})}</p></> : <p className="tp-note">{t('切换到对应岗位后，核对并完成本人确认。')}</p>}</article>;})}</div> : null}
          {tab === 'history' ? <div className="tp-panel"><h2>{t('操作与变更记录')}</h2>{record.events.length ? [...record.events].reverse().map((event) => <article className="tp-record-row" key={event.id}><div className="tp-heading"><h3>{t(event.label)}</h3><span>{state.actors.find((item) => item.id === event.actorId)?.name}</span></div><p>{event.detail}</p><time>{event.at.replace('T',' ').slice(0,19)} UTC</time></article>) : <p className="tp-empty">{t('尚无本次操作记录。已保存的资料和验证会在这里留痕。')}</p>}</div> : null}
        </TabsContent></Tabs>
        <div className="tp-related"><Link to="/__preview/batch-archives">{t('浏览批次档案演示')}<ArrowRight className="size-4" aria-hidden="true" /></Link><p className="tp-note">{t('当前样品与试产批次为本页样例。样品原单尚未接入，转产确认不会自动创建 P09 档案或生产任务。')}</p></div>
      </section><aside id="transfer-actions" className="tp-sidebar"><button className="tp-back" onClick={() => scroll('transfer-details')}>{t('返回转产资料')}</button>{context ? <TransferActionForm key={`${generation}:${record.id}:${actorId}:${context.kind}:${context.targetId ?? ''}`} record={record} actorId={actorId} context={context} onSubmit={save} onDirtyChange={markDirty} onCancel={() => requestChange(clearForm)} /> : <>
        <section className="tp-panel"><div className="tp-heading"><h2>{t('当前操作')}</h2><span>{actor?.name}</span></div>{readOnly ? <p className="tp-note">{t(record.status === 'confirmed' ? '转产已确认，本批资料与确认依据锁定，可查看和导出。' : '当前岗位为只读，可查看资料与导出记录。')}</p> : <><div className="tp-action-buttons">{actionButton('trial',gates.docs.length > 0)}{actionButton('confirm',gates.docs.length > 0 || !gates.trialPassed || gates.problems.length > 0 || !gates.confirmations.includes(actor!.role))}{actionButton('submit',gates.blockers.length > 0)}</div><p className="tp-note">{t(actor?.role === 'process' ? '工艺负责补齐资料、登记试装与整改。资料未齐时先从左侧补充。' : actor?.role === 'quality' ? '质量负责问题复验与本人岗位确认。整改与复验分别留痕。' : '生产负责人核对必需条件和岗位意见后提交转产确认。')}</p></>}</section>
        <section className="tp-panel tp-gates"><div className="tp-heading"><h2>{t('转产前还需要')}</h2><span>{gates.blockers.length}</span></div>{gates.blockers.length ? <ul>{gates.blockers.map((item) => <li key={item}>{t(item)}</li>)}</ul> : <p className="tp-good">{t(record.status === 'confirmed' ? '提交时全部条件已满足。':'全部必需条件已满足。')}</p>}</section>
        <div className="tp-side-note"><h3>{t('验证范围')}</h3><p>{t('每次验证对应明确资料快照。最新试装未通过、问题复验失败或资料换版，都会阻止转产提交。')}</p><p>{record.sampleConclusion}</p></div>
      </>}</aside></div>
    </>}
    <Sheet open={Boolean(document || evidence)} onOpenChange={(open) => {if (!open) {setDocument(null);setEvidence(null);}}}><SheetContent className="order-horizon-overlay tp-sheet"><SheetHeader><SheetTitle>{t(document ? '资料版本摘要':'试装证据')}</SheetTitle><SheetDescription>{t('本次前端演示资料，尚未连接正式文件服务。')}</SheetDescription></SheetHeader>{document ? <div className="tp-sheet-body"><h2>{document.code} · {document.revision}</h2><p>{document.summary}</p><p className="tp-callout">{t('原文件尚未接入，本页不提供原文件下载。')}</p></div> : evidence ? <div className="tp-sheet-body"><p>{evidence.name}</p>{evidence.type === 'photo' ? <img src={evidence.dataUrl} alt={evidence.name} /> : <video controls src={evidence.dataUrl} aria-label={evidence.name} />}</div> : null}</SheetContent></Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open) => {setDiscardOpen(open);if (!open) pending.current = null;}}><AlertDialogContent className="order-horizon-overlay tp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将清空，已经保存的资料、验证和记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => {const action = pending.current;pending.current = null;clearForm();setDiscardOpen(false);action?.();}}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state === 'blocked'}><AlertDialogContent className="order-horizon-overlay tp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('离开当前转产批次？')}</AlertDialogTitle><AlertDialogDescription>{t('尚未保存的填写会丢失；本页演示数据重新加载后恢复样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.reset?.()}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => {clearForm();blocker.proceed?.();}}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent className="order-horizon-overlay tp-dialog"><AlertDialogHeader><AlertDialogTitle>{t('恢复初始转产演示？')}</AlertDialogTitle><AlertDialogDescription>{t('本次补充的资料、证据、验证和确认记录将清空。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('保留当前记录')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
