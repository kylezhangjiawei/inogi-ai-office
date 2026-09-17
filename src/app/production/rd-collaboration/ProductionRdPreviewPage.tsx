import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router';
import { ArrowRight, ArrowUpRight, CheckCircle2, ClipboardList, GitBranch, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { useI18n } from '../../lib/i18n';
import { defectToday, getDefectProgress } from '../defects/defectModel';
import { getDefectPreviewState, resetDefectPreviewState, setDefectPreviewState } from '../defects/defectPreviewSession';
import { RdActionForm } from './RdActionForm';
import { applyRdAction, canOperateRd, getRdCase, getRdCurrentActorId } from './rdModel';
import { getRdPreviewState, setRdPreviewState } from './rdPreviewSession';
import { rdActionLabels, rdStatusLabels, type RdAction, type RdActionKind } from './rdTypes';
import '../../order-processing/horizon.css';
import './production-rd.css';
import { Checkbox } from "../../components/ui/checkbox";
import { NativeSelect } from "../../components/ui/native-select";
import { Input } from "../../components/ui/input";

type Scenario = 'normal' | 'readonly' | 'empty' | 'error';
const actionKinds = Object.keys(rdActionLabels) as RdActionKind[];
const stages = ['生产提报', '指定处理人', '研发处理', '现场验证', '技术协同关闭'];
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function ProductionRdPreviewPage() {
  const { t } = useI18n(); const [params, setParams] = useSearchParams();
  const [defects, setDefects] = useState(getDefectPreviewState); const [state, setState] = useState(getRdPreviewState);
  const [actorId, setActorId] = useState('quality-a'); const [scope, setScope] = useState('all'); const [query, setQuery] = useState(''); const [statusFilter, setStatusFilter] = useState('all');
  const [scenario, setScenario] = useState<Scenario>('normal'); const [editing, setEditing] = useState<RdActionKind | null>(null); const [tab, setTab] = useState('source'); const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false); const busyRef = useRef(false); const [failNext, setFailNext] = useState(false); const [flash, setFlash] = useState('');
  const [discard, setDiscard] = useState(false); const [resetOpen, setResetOpen] = useState(false); const pending = useRef<(() => void) | null>(null); const internalNavigation = useRef(false);
  const blocker = useBlocker(() => dirtyRef.current && !internalNavigation.current);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const person = (id: string | undefined | null) => defects.actors.find((actor) => actor.id === id)?.name ?? t('待指定');
  const actor = defects.actors.find((item) => item.id === actorId);
  const needle = query.trim().toLocaleLowerCase();
  const candidates = defects.issues.filter((item) => item.direction === 'rd' || item.direction === 'pending' || item.id === params.get('issue'));
  const issues = scenario === 'empty' ? [] : candidates.filter((item) => {
    const record = getRdCase(state, defects, item.id); const collaboration = defects.collaborations.find((entry) => entry.issueId === item.id && entry.direction === 'rd');
    const visible = actor?.role === 'quality' || actor?.role === 'viewer' || item.ownerId === actorId || collaboration?.actorId === actorId || record?.verifications.at(-1)?.verifierId === actorId;
    const mine = getRdCurrentActorId(state, defects, item.id) === actorId || (actor?.role === 'quality' && (!record || record.status === 'awaiting-info' || record.status === 'verified'));
    return visible && (scope === 'all' || (scope === 'mine' ? mine : collaboration?.actorId === actorId)) && (statusFilter === 'all' || (record?.status ?? 'unassigned') === statusFilter) && [item.code, item.sourceCode, item.product, item.batchCode, item.material, item.phenomenon].join(' ').toLocaleLowerCase().includes(needle);
  });
  const issue = params.has('issue') ? issues.find((item) => item.id === params.get('issue')) : issues[0];
  const record = issue ? getRdCase(state, defects, issue.id) : undefined; const collaboration = defects.collaborations.find((entry) => entry.issueId === issue?.id && entry.direction === 'rd');
  const progress = issue ? getDefectProgress(defects, issue.id) : undefined; const status = record?.status ?? 'unassigned'; const latestOpinion = record?.opinions.at(-1); const verification = record?.verifications.at(-1);
  const stage = !record ? 1 : record.status === 'closed' ? 4 : ['verified', 'verifying'].includes(record.status) ? 3 : 2;
  const available = scenario === 'normal' && issue ? actionKinds.filter((kind) => canOperateRd(state, defects, issue.id, actorId, kind)) : [];
  const context = useRef({ generation, issueId: issue?.id, actorId, editing, scenario }); context.current = { generation, issueId: issue?.id, actorId, editing, scenario };
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function clear() { markDirty(false); setEditing(null); setGeneration((value) => value + 1); }
  function change(action: () => void) { if (busyRef.current) return; if (dirtyRef.current) { pending.current = action; setDiscard(true); } else action(); }
  function navigate(id: string | null) { const next = new URLSearchParams(params); if (id) next.set('issue', id); else next.delete('issue'); internalNavigation.current = true; try { setParams(next); } finally { internalNavigation.current = false; } }
  function filter(action: () => void) { change(() => { clear(); action(); navigate(null); setFlash(''); }); }
  function selectIssue(id: string) { change(() => { clear(); navigate(id); setFlash(''); }); }
  function start(kind: RdActionKind) { if (!available.includes(kind)) return; change(() => { clear(); setEditing(kind); setFlash(''); window.requestAnimationFrame(() => window.document.getElementById('prd-action-panel')?.scrollIntoView({ behavior: 'instant', block: 'nearest' })); }); }
  async function save(action: RdAction) {
    const current = context.current;
    if (busyRef.current) throw new Error('正在保存，请稍候');
    if (!issue || current.generation !== generation || current.issueId !== issue.id || current.actorId !== actorId || current.editing !== editing || current.scenario !== 'normal' || action.actorId !== actorId || action.issueId !== issue.id || action.kind !== editing) throw new Error('当前人员或异常已变化，请重新打开操作');
    busyRef.current = true;
    try {
      if (failNext) { setFailNext(false); throw new Error('演示保存失败，填写内容已保留，请重试'); }
      const result = applyRdAction(getRdPreviewState(), getDefectPreviewState(), state.version, defects.version, action);
      setDefectPreviewState(result.defects); setRdPreviewState(result.rd); setDefects(result.defects); setState(result.rd); clear(); setStatusFilter('all'); setScope('all');
      setTab(action.kind === 'opinion' ? 'opinions' : action.kind === 'send-verification' || action.kind === 'verify' ? 'verification' : action.kind === 'close' ? 'history' : 'source');
      setFlash(action.kind === 'close' ? '技术协同已关闭；原不良继续保留，QC 复验和 QA 放行分别处理。' : `${rdActionLabels[action.kind]}已记录，当前会话可在 P08／P04 间继续查看。`);
    } finally { busyRef.current = false; }
  }
  function reset() { const next = resetDefectPreviewState(); setDefects(next); setState(getRdPreviewState()); clear(); setActorId('quality-a'); setScope('all'); setStatusFilter('all'); setQuery(''); setScenario('normal'); setTab('source'); setFailNext(false); setResetOpen(false); setFlash(''); navigate(null); }
  return <main className="order-horizon production-rd">
    <OrderPageHeader Icon={GitBranch} eyebrow={t('生产管理 / 研发协同 / P04')} title={t('生产问题转研发')} description={t('让现场问题找到明确的技术处理人，带着验证结果回到生产。')} actions={<><Link className="prd-link-button" to="/__preview/production-defects">{t('生产不良 P08')}<ArrowUpRight size={14}/></Link><Button variant="outline" onClick={() => change(() => setResetOpen(true))}><RotateCcw size={14}/>{t('重置演示')}</Button></>}/>
    <div className="prd-demo-note"><strong>{t('前端演示')}</strong><span>{t('P04 与 P08 共用本次会话的原异常；刷新恢复样例。人员为演示岗位，技术记录尚未接入正式业务。')}</span></div>
    <details className="prd-scenarios"><summary>{t('预览状态')}</summary><div>{(['normal', 'readonly', 'empty', 'error'] as Scenario[]).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'default' : 'outline'} onClick={() => filter(() => setScenario(value))}>{t(({ normal: '正常', readonly: '只读', empty: '空数据', error: '读取失败' })[value])}</Button>)}<label><Checkbox checked={failNext} onCheckedChange={(checkedValue) => setFailNext((checkedValue === true))}/>{t('下次保存失败')}</label></div></details>
    <section className="prd-filters" aria-label={t('研发协同筛选')}>
      <label>{t('演示操作人')}<NativeSelect id="prd-actor" value={actorId} onChange={(event) => { const value = event.target.value; filter(() => setActorId(value)); }}>{defects.actors.filter((item) => item.role !== 'procurement').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label>{t('处理状态')}<NativeSelect value={statusFilter} onChange={(event) => { const value = event.target.value; filter(() => setStatusFilter(value)); }}><option value="all">{t('全部状态')}</option>{Object.entries(rdStatusLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect></label>
      <label className="prd-search">{t('查找问题')}<Input type="search" value={query} placeholder={t('原异常号、批次、物料或现象')} onChange={(event) => { const value = event.target.value; filter(() => setQuery(value)); }}/></label>
    </section>
    <div className="prd-scope" role="group" aria-label={t('协同任务范围')}>{[['all', '全部（授权）'], ['mine', '待我处理'], ['initiated', '我发起的']].map(([value, label]) => <Button variant="unstyled" key={value} aria-pressed={scope === value} onClick={() => filter(() => setScope(value))}>{t(label)}</Button>)}</div>
    {flash ? <p className="prd-feedback" role="status"><CheckCircle2 size={16}/>{t(flash)}</p> : null}
    {scenario === 'error' ? <OrderEmptyState Icon={ClipboardList} title={t('研发协同读取失败')} description={t('已有记录保留，重试后继续。')} action={<Button onClick={() => setScenario('normal')}>{t('重试读取')}</Button>}/> : !issue || !progress ? <OrderEmptyState Icon={ClipboardList} title={t('当前范围没有研发问题')} description={t('可清除筛选，或在 P08 指定研发处理方向后进入。')} action={<Button onClick={() => filter(() => { setQuery(''); setStatusFilter('all'); setScope('all'); setScenario('normal'); })}>{t('清除筛选')}</Button>}/> : <>
      <ol className="prd-steps" aria-label={t('生产问题协同流程')}>{stages.map((label, index) => <li key={label} className={index === stage ? 'is-current' : index < stage ? 'is-done' : ''} aria-current={index === stage ? 'step' : undefined}><span>{index < stage ? <CheckCircle2 size={16}/> : index + 1}</span><strong>{t(label)}</strong></li>)}</ol>
      <div className="prd-board">
        <aside className="prd-queue" aria-label={t('研发问题列表')}><div className="prd-section-heading"><h2>{t('问题列表')}</h2><span>{issues.length} {t('项')}</span></div><p>{t('沿用 P08 原异常号')}</p><ul>{issues.map((item) => { const itemStatus = getRdCase(state, defects, item.id)?.status ?? 'unassigned'; return <li key={item.id}><Button variant="unstyled" aria-current={item.id === issue.id ? 'true' : undefined} onClick={() => selectIssue(item.id)}><span className="prd-code">{item.code}</span><strong>{item.phenomenon}</strong><span>{item.batchCode} · {item.material}</span><span className="prd-queue-meta"><em>{t(({ high: '高优先', medium: '中优先', low: '低优先' })[item.priority])}</em>{t(rdStatusLabels[itemStatus])}</span></Button></li>; })}</ul></aside>
        <div className="prd-detail">
          <section className="prd-context"><header><div><div className="prd-kicker"><span>{issue.code}</span><span className="prd-badge">{t(rdStatusLabels[status])}</span></div><h2>{issue.phenomenon} / {issue.material}</h2><p>{issue.batchCode} · {issue.lineName} · {issue.process}</p></div><Link to={`/__preview/production-defects?issue=${encodeURIComponent(issue.id)}`} className="prd-source-link">{t('查看原不良')}<ArrowUpRight size={14}/></Link></header>
            <div className="prd-owner-lane"><div><span>{t('生产发起人')}</span><strong>{collaboration ? person(collaboration.actorId) : t('待确认交接')}</strong><small>{collaboration ? time(collaboration.at) : t('来源记录已保留')}</small></div><ArrowRight size={20} aria-hidden="true"/><div><span>{t(status === 'awaiting-info' ? '当前待补充人' : status === 'verifying' ? '当前现场验证人' : status === 'verified' ? '待关闭确认人' : '当前研发处理人')}</span><strong>{collaboration ? person(getRdCurrentActorId(state, defects, issue.id) ?? issue.ownerId) : t('待指定研发')}</strong><small>{issue.dueDate ? `${t('截止')} ${issue.dueDate}` : t('期限待确认')}{issue.dueDate && issue.dueDate < defectToday() && status !== 'closed' ? <b>{t('已逾期')}</b> : null}</small></div></div>
            <div className="prd-original-range"><span>{t('原不良范围')} <strong>{issue.quantity} {issue.unit}</strong></span><span>{t('P08 尚未解决')} <strong>{progress.remaining} {issue.unit}</strong></span><p>{t('技术验证不冲减不良数；QC 复验合格与 QA 放行独立记录。')}</p></div>
          </section>
          <div className="prd-workspace">
            <Tabs value={tab} onValueChange={(value) => change(() => { clear(); setTab(value); })} activationMode="manual" className="prd-records"><TabsList className="prd-tabs" aria-label={t('技术协同记录')}>{[['source', '原问题与资料'], ['opinions', '技术意见'], ['verification', '现场验证'], ['history', '处理记录']].map(([value, label]) => <TabsTrigger key={value} value={value}>{t(label)}</TabsTrigger>)}</TabsList>
              <TabsContent value={tab} className="prd-record-panel">
                {tab === 'source' ? <><h3>{t('现场问题')}</h3><p className="prd-description">{issue.description}</p><dl className="prd-facts"><div><dt>{t('原业务单号')}</dt><dd>{issue.sourceCode}</dd></div><div><dt>{t('发生日期')}</dt><dd>{issue.date}</dd></div><div><dt>{t('原因确认')}</dt><dd>{issue.causeStatus === 'confirmed' ? issue.cause : t('尚待研发分析，不预填根因')}</dd></div><div><dt>{t('研发处理人')}</dt><dd>{collaboration ? person(issue.ownerId) : t('待指定研发')}</dd></div><div><dt>{t('原协同交接')}</dt><dd>{collaboration?.description ?? t('尚未转研发，先指定处理人并记录交接范围。')}</dd></div></dl><div className="prd-evidence"><ClipboardList size={20}/><div><strong>{t('检验与现场证据')}</strong><p>{t('来源为本地样例摘要；正式照片、图纸与附件原件后续接入。')}</p><Link className="prd-source-link" to={`/__preview/production-defects?issue=${encodeURIComponent(issue.id)}`}>{t('核对 P08 来源与已有资料')}<ArrowUpRight size={14}/></Link></div></div>{record?.infoRequest ? <div className="prd-info-request"><strong>{t('研发请求补充')}</strong><p>{record.infoRequest}</p><small>{t('由发起方或质量管理岗补充后继续处理。')}</small></div> : null}</> : null}
                {tab === 'opinions' ? <><h3>{t('技术意见与受控资料')}</h3>{record?.opinions.length ? [...record.opinions].reverse().map((opinion, index) => <article key={opinion.id} className="prd-record"><header><strong>{index === 0 ? t('最新技术意见') : t('历史技术意见')}</strong><span>{person(opinion.actorId)} · {time(opinion.at)}</span></header><p>{opinion.text}</p><dl className="prd-facts"><div><dt>{t('技术依据')}</dt><dd>{opinion.basis}</dd></div><div><dt>{t('图纸更新')}</dt><dd>{opinion.drawingChange === 'yes' ? opinion.drawingReference : t('不需要')}</dd></div><div><dt>{t('SOP 更新')}</dt><dd>{opinion.sopChange === 'yes' ? opinion.sopReference : t('不需要')}</dd></div></dl></article>) : <p className="prd-empty">{t('研发处理人提交技术分析与依据后，在这里保留版本记录。')}</p>}<p className="prd-note">{t('需要变更图纸或 SOP 时，须沿正式变更流程执行；此页意见不会自动修改受控文件。')}</p></> : null}
                {tab === 'verification' ? <><h3>{t('现场验证安排与结果')}</h3>{record?.verifications.length ? [...record.verifications].reverse().map((entry) => <article className="prd-record" key={entry.id}><header><strong>{t(entry.result === 'passed' ? '技术验证通过' : entry.result === 'failed' ? '未通过，已返回研发' : '待现场验证')}</strong><span>{person(entry.verifierId)}</span></header><dl className="prd-facts"><div><dt>{t('计划 / 实际日期')}</dt><dd>{entry.plannedDate} / {entry.date ?? t('待执行')}</dd></div><div><dt>{t('对应技术意见')}</dt><dd>{record.opinions.find((opinion) => opinion.id === entry.opinionId)?.text ?? t('来源待核对')}</dd></div><div><dt>{t('验证结论')}</dt><dd>{entry.note ?? t('尚未登记结果')}</dd></div><div><dt>{t('验证依据')}</dt><dd>{entry.evidence ?? t('待补充')}</dd></div></dl></article>) : <p className="prd-empty">{t('先提交技术意见，再指定验证人和验证日期。')}</p>}<p className="prd-note">{t('技术方案现场验证记录不产生检验数量，也不关闭 P08 原不良。')}</p></> : null}
                {tab === 'history' ? <><h3>{t('本异常技术处理记录')}</h3>{record?.events.length ? <ol className="prd-history">{[...record.events].reverse().map((entry) => <li key={entry.id}><strong>{t(rdActionLabels[entry.kind])}</strong><span>{person(entry.actorId)} · {time(entry.at)}</span><p>{entry.text}</p></li>)}</ol> : <p className="prd-empty">{t('技术操作完成后记录人员、时间与处理内容。原异常历史在 P08 保留。')}</p>}</> : null}
              </TabsContent>
            </Tabs>
            <aside id="prd-action-panel" className="prd-action-panel" aria-label={t('研发处理操作')}>
              {editing ? <RdActionForm key={`${generation}:${issue.id}:${actorId}:${editing}`} state={state} defects={defects} issueId={issue.id} actorId={actorId} kind={editing} onDirtyChange={markDirty} onSubmit={save} onCancel={() => change(clear)}/> : <div className="prd-action-card"><div className="prd-section-heading"><h3>{t('下一步处理')}</h3><span>{person(actorId)}</span></div><p>{t(!record ? '先明确研发处理人与期限，将当前原异常交给研发跟进。' : status === 'awaiting-info' ? '发起方补齐研发所需资料后，问题返回研发继续分析。' : status === 'opinion-ready' ? '技术意见已登记，请安排人员在现场验证。' : status === 'verifying' ? '由已指定的现场验证人登记实际结果与依据。' : status === 'verified' ? '现场验证已通过，由发起方或质量管理岗核对关闭。' : status === 'closed' ? '技术协同已关闭。返回原不良继续处理整改和 QC 复验。' : '研发处理人可请求补充资料，或提交技术分析与建议。')}</p><div className="prd-action-buttons">{available.map((kind) => <Button key={kind} variant={kind === 'assign' && record || kind === 'request-info' ? 'outline' : 'default'} onClick={() => start(kind)}>{t(rdActionLabels[kind])}</Button>)}</div>{available.length === 0 && status !== 'closed' ? <p className="prd-note">{t('当前岗位或预览状态仅可查看。可在上方切换到对应演示操作人。')}</p> : null}{latestOpinion ? <div className="prd-latest"><strong>{t('最新技术建议')}</strong><p>{latestOpinion.text}</p></div> : null}</div>}
              <div className="prd-closure-rule"><strong>{t('关闭条件')}</strong><p>{t('最新技术意见已有对应现场验证通过依据，再由发起方或质量管理岗确认。')}</p><span>{t('技术解决 ≠ QC 全量合格 ≠ QA 放行')}</span></div>
            </aside>
          </div>
        </div>
      </div>
    </>}
    <AlertDialog open={discard} onOpenChange={(open) => { if (!open) { setDiscard(false); pending.current = null; } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写尚未保存。继续切换会丢弃这些内容，已保存的记录保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pending.current; pending.current = null; clear(); setDiscard(false); action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && blocker.state === 'blocked') blocker.reset(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('离开前放弃填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次技术操作尚未保存。已保存的原异常和协同记录会在当前会话保留。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => { if (blocker.state === 'blocked') blocker.reset(); }}>{t('留在本页')}</AlertDialogCancel><AlertDialogAction onClick={() => { clear(); if (blocker.state === 'blocked') blocker.proceed(); }}>{t('放弃并离开')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={resetOpen} onOpenChange={setResetOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('重置生产协同演示？')}</AlertDialogTitle><AlertDialogDescription>{t('P08 不良处理和 P04 技术协同的本次会话记录将一起恢复为初始样例。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('取消')}</AlertDialogCancel><AlertDialogAction onClick={reset}>{t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
