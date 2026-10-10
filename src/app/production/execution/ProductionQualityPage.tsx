import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Check, ClipboardCheck, FileText, Image, MessageSquare, Search, Users } from 'lucide-react';
import { useAuth } from '../../auth';
import { usePermission } from '../../hooks/usePermission';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { AttachmentPreviewDialog, type PreviewableAttachment } from '../../components/AttachmentPreviewDialog';
import type { ExecutionPlan, ExecutionTask } from '../../lib/productionExecutionApi';
import { getQualityAttachment, type QualityRecord } from '../../lib/procurementOperationsApi';
import { QualityAnalysisDialog, qualityCauseNames } from '../../procurement/quality/QualityAnalysisDialog';
import { QualityVerificationDialog } from '../../procurement/components/QualityVerificationDialog';
import { qualityRecordSummary } from '../../procurement/quality/QualityRecordsPanel';
import { productionPage, productionQuery, productionSearch } from './productionViewState';
import type { Editor } from './ProductionExecutionPage';
import './production-quality.css';

type QualityItem = { record: QualityRecord; plan: ExecutionPlan; task: ExecutionTask; productionCode: string; process: string };
type Props = { plans: ExecutionPlan[]; collaborationOnly?: boolean; onSaved: () => void; onEdit?: (plan: ExecutionPlan, editor: Editor) => void; onVerify?: (record: QualityRecord) => void };
const dispositions = { pending: '待判定', return: '退货', rework: '返工', scrap: '报废', concession: '让步接收', replacement: '换货' };
const initialCauseNames = { unknown: '待分析', material: '来料', software: '软件', assembly: '装配', other: '其他' };
const priorityNames = { high: '高优先', medium: '普通', low: '低优先' };
const historyActions: Record<string, string> = { 'field-issue': '现场提报', inspect: '检验登记', disposition: '登记处置', 'assign-quality': '负责人分派协同', 'reply-quality': '协同回复' };

export function productionQualityItems(plans: ExecutionPlan[], collaborationOnly = false) {
  const rows = new Map<string, QualityItem>();
  for (const plan of plans) for (const task of plan.tasks) {
    const productionCode = plan.batches.find(batch => batch.id === task.batchId)?.code || '生产单号待确认';
    for (const source of [...(task.fieldIssues ?? []), ...task.inspections]) {
      const record = source.quality;
      if (!record || collaborationOnly && !record.collaboration) continue;
      const previous = rows.get(record.id);
      if (!previous || record.updatedAt >= previous.record.updatedAt) rows.set(record.id, { record, plan, task, productionCode, process: 'process' in source && source.process ? source.process : task.name });
    }
  }
  return [...rows.values()].sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
}

export function productionQualityState(record: QualityRecord) {
  if (record.status === 'closed') return { label: '已关闭', tone: 'success', step: 4 };
  if (record.collaboration?.phase === 'waiting_reply') return { label: '待协同回复', tone: 'warning', step: 2 };
  if (record.disposition !== 'pending' && record.resolution?.trim()) return { label: '待复验', tone: 'warning', step: 3 };
  if (record.collaboration?.phase === 'returned') return { label: '已回复待处置', tone: 'active', step: 2 };
  return { label: record.status === 'processing' ? '处理中' : '待处理', tone: 'active', step: 1 };
}

export function ProductionQualityPage(props: Props) {
  const { user } = useAuth();
  return <ProductionQualityContent key={`${user?.id}:${user?.permissions?.join(',')}:${props.collaborationOnly ? 'collaboration' : 'defects'}`} {...props} />;
}

function ProductionQualityContent({ plans, collaborationOnly = false, onSaved, onEdit, onVerify }: Props) {
  const { user } = useAuth();
  const canManage = usePermission('proc-quality:manage'), canCollaborate = usePermission('proc-quality:collaborate'), canVerify = usePermission('proc-quality:verify');
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(''), [status, setStatus] = useState('open'), [person, setPerson] = useState('all'), [page, setPage] = useState(1);
  const [dialogId, setDialogId] = useState<string | null>(null), [verificationId, setVerificationId] = useState<string | null>(null);
  const all = productionQualityItems(plans, collaborationOnly);
  const matches = all.filter(({ record, task, productionCode, plan }) => (status === 'all' || (status === 'closed' ? record.status === 'closed' : status === 'verify' ? productionQualityState(record).step === 3 : record.status !== 'closed')) && (person === 'all' || record.collaboration?.ownerId === user?.id && record.collaboration.phase === 'waiting_reply') && productionSearch(query, [record.id, record.issue, productionCode, plan.productLine, task.name, task.line, record.collaboration?.ownerName]));
  const paged = productionPage(matches, page, 6);
  const linkedId = params.get('quality');
  const current = linkedId ? all.find(item => item.record.id === linkedId) : paged.rows[0];
  const record = current?.record, state = record ? productionQualityState(record) : null;
  const fieldSource = current?.task.fieldIssues?.find(row => row.qualityId === record?.id);
  const suggestion = fieldSource?.requestedCollaboration;
  const handlingEvents = current?.plan.events?.filter(event => event.subjectId === record?.id) ?? [];
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const overdue = record?.status !== 'closed' && record?.collaboration?.dueDate && record.collaboration.dueDate < today;
  const filter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); setParams(previous => productionQuery(previous, { quality: null }), { replace: true }); };
  const summary = qualityRecordSummary(matches.map(item => item.record));
   const steps = collaborationOnly ? ['生产提报', '负责人分派', '协同回复', '独立复验', '确认关闭'] : ['现场提报', '负责人初判', '协同处置', '独立复验', '确认关闭'];
  const verifyRecord = all.find(item => item.record.id === verificationId)?.record;
  const currentDialog = all.find(item => item.record.id === dialogId)?.record;
  return <div className="production-quality-page">
    <ol className="pq-flow" aria-label={collaborationOnly ? '生产问题协同流程' : '生产不良处理流程'}>{steps.map((label, index) => <li key={label} aria-current={state?.step === index ? 'step' : undefined} data-state={state ? index < state.step ? 'complete' : index === state.step ? 'current' : 'pending' : 'pending'}><span className="pq-step-number">{state && index < state.step ? <Check size={14} aria-hidden="true" /> : index + 1}</span><span>{label}</span>{index < steps.length - 1 && <ArrowRight size={16} aria-hidden="true" />}</li>)}</ol>
    <div className="pq-workspace">
      <aside className="pq-list" aria-label={collaborationOnly ? '生产协同问题列表' : '生产不良处理列表'}>
        <div className="pq-section-title"><h2>{collaborationOnly ? '协同问题' : '不良处理任务'}</h2><span>{all.length} 条</span></div>
        <div className="pq-status-tabs" aria-label="异常处理范围">{[['open', '待处理'], ['verify', '待复验'], ['closed', '已关闭'], ['all', '全部']].map(([value, label]) => <Button key={value} variant="ghost" size="sm" aria-pressed={status === value} onClick={() => filter(setStatus, value)}>{label}<span>{all.filter(item => value === 'all' || (value === 'closed' ? item.record.status === 'closed' : value === 'verify' ? productionQualityState(item.record).step === 3 : item.record.status !== 'closed')).length}</span></Button>)}</div>
        <div className="pq-filters"><div className="pq-search"><Search size={15} aria-hidden="true"/><Input aria-label="搜索生产不良" placeholder="搜索现象、生产单号、经办人" value={query} onChange={event => filter(setQuery, event.target.value)} /></div><NativeSelect aria-label="协同处理人范围" value={person} onChange={event => filter(setPerson, event.target.value)}><option value="all">全部经办</option><option value="mine">待我协同</option></NativeSelect></div>
        <div className="pq-records">{paged.rows.map(item => { const itemState = productionQualityState(item.record); return <Button variant="ghost" key={item.record.id} className="pq-record" aria-pressed={current?.record.id === item.record.id} onClick={() => setParams(previous => productionQuery(previous, { quality: item.record.id }), { replace: true })}><span className="pq-record-head"><strong>{item.record.issue}</strong><span className={`pq-badge pq-badge-${itemState.tone}`}>{itemState.label}</span></span><span className="pq-record-priority">{item.record.collaboration?.priority && <span className={`pq-badge pq-priority-${item.record.collaboration.priority}`}>{priorityNames[item.record.collaboration.priority]}</span>}{item.record.collaboration?.department && <span>{item.record.collaboration.department}</span>}</span><span className="pq-record-quantity">{item.record.defectiveQty.toLocaleString()} {item.record.unit} · {item.task.name}</span><span className="pq-record-meta">{item.productionCode} · {item.task.line || '产线待确认'}</span><span className="pq-record-meta">{item.record.inspectionDate} · {item.record.collaboration?.ownerName || item.record.createdByName || '经办待确认'}</span></Button>; })}{!paged.rows.length && <p className="pq-empty">{collaborationOnly && !all.length ? '暂无已发起的协同问题。可在“生产不良处理”选择原异常并转交协同人。' : '当前条件下没有异常记录。'}</p>}</div>
        <div className="pq-pagination"><span>{matches.length} 条 · {paged.page} / {paged.pageCount}</span><div><Button size="sm" variant="outline" aria-label="不良列表上一页" disabled={paged.page === 1} onClick={() => { setPage(paged.page - 1); setParams(previous => productionQuery(previous, { quality: null }), { replace: true }); }}>上一页</Button><Button size="sm" variant="outline" aria-label="不良列表下一页" disabled={paged.page === paged.pageCount} onClick={() => { setPage(paged.page + 1); setParams(previous => productionQuery(previous, { quality: null }), { replace: true }); }}>下一页</Button></div></div>
      </aside>
      {current && record && state ? <section className="pq-detail" aria-label="生产不良详情">
        <header className="pq-detail-heading"><div><div className="pq-detail-heading-line"><h2>{record.issue}</h2><span className={`pq-badge pq-badge-${state.tone}`}>{state.label}</span>{overdue && <span className="pq-badge pq-badge-danger">协同逾期</span>}</div><p>{current.productionCode} · {current.task.name} · {current.plan.productLine}</p></div><Link className="pq-source-link" to={`?${productionQuery(params, { view: 'tasks', plan: current.plan.id, task: current.task.id, taskSection: 'quality', inspection: null, quality: record.id })}`}>查看原作业<ArrowRight size={14} aria-hidden="true" /></Link></header>
        <dl className="pq-facts"><div><dt>不良数量</dt><dd className="pq-danger">{record.defectiveQty.toLocaleString()} <small>{record.unit}</small></dd></div><div><dt>生产单号</dt><dd>{current.productionCode}</dd></div><div><dt>发现工序</dt><dd>{current.process}</dd></div><div><dt>现场负责人</dt><dd>{current.task.ownerName || '待确认'}</dd></div><div><dt>当前协同人</dt><dd>{record.collaboration?.ownerName || '尚未转交'}</dd></div><div><dt>协同部门</dt><dd>{record.collaboration ? record.collaboration.department || '未登记部门' : '尚未转交'}</dd></div><div><dt>协同优先级</dt><dd>{record.collaboration?.priority ? priorityNames[record.collaboration.priority] : '尚未指定'}</dd></div><div><dt>处理期限</dt><dd className={overdue ? 'pq-danger' : undefined}>{record.collaboration?.dueDate || '尚未安排'}</dd></div></dl>
        {collaborationOnly && record.collaboration && <section className="pq-handoff"><div><span className="pq-avatar"><Users size={19} aria-hidden="true" /></span><p><small>发起人</small><strong>{record.collaboration.originatorName || record.createdByName}</strong></p></div><ArrowRight size={20} aria-hidden="true" /><div><span className="pq-avatar"><MessageSquare size={19} aria-hidden="true" /></span><p><small>协同处理人</small><strong>{record.collaboration.phase === 'returned' ? record.collaboration.repliedByName || '历史接收人' : record.collaboration.ownerName}</strong></p></div><span className="pq-badge pq-badge-active">{record.collaboration.phase === 'waiting_reply' ? '等待回复' : '已回复'}</span></section>}
        <div className="pq-detail-columns"><section className="pq-block"><h3><Image size={17} aria-hidden="true" />不良证据</h3><p className="pq-prose">{record.analysis?.evidence || '尚未补充现场证据说明。'}</p><QualityEvidence key={`${record.id}:${record.updatedAt}`} record={record} />{record.analysis?.phenomena?.length ? <div className="pq-phenomena">{record.analysis.phenomena.map((item, index) => <span key={`${item.name}:${index}`}>{item.name}<strong>{item.count} 次</strong></span>)}</div> : null}</section>
          <section className="pq-block"><h3><ClipboardCheck size={17} aria-hidden="true" />原因与处置</h3><dl className="pq-definition"><div><dt>现场初步原因</dt><dd>{fieldSource?.initialCause ? initialCauseNames[fieldSource.initialCause] : '未填写'}<small className="pq-fact-secondary">仅为现场初判，待负责人认定</small></dd></div><div><dt>主因</dt><dd>{record.analysis?.state === 'confirmed' ? qualityCauseNames[record.analysis.category] : '待分析 / 确认'}</dd></div><div><dt>责任主体</dt><dd>{record.analysis?.state === 'confirmed' ? record.analysis.responsibility.name || '待认定' : '待认定'}</dd></div><div><dt>处置方式</dt><dd>{dispositions[record.disposition]}</dd></div></dl><p className="pq-prose">{record.analysis?.detail || '尚未补充原因分析。'}</p><div className="pq-resolution"><span>处置结果</span><p>{record.resolution || '待登记处置结果，保存后由质量授权人员独立复验。'}</p></div></section></div>
        {suggestion && !record.collaboration && <section className="pq-suggestion" aria-label="现场协同建议"><div><h3>待负责人初判、分派</h3><p>现场建议：{suggestion.department || '未登记部门'} · {suggestion.ownerName}</p><p className="production-note">建议接收人尚未成为正式经办人。由负责人核对原因、期限及验证安排后转交。</p></div>{canManage && record.status !== 'closed' && onEdit && <Button variant="outline" onClick={() => onEdit(current.plan, { action: 'assign-quality', task: current.task, quality: record })}>采纳建议并办理转交</Button>}</section>}
        {record.collaboration && <section className="pq-block pq-collaboration"><h3><MessageSquare size={17} aria-hidden="true" />协同反馈与验证安排</h3><div className="pq-collaboration-grid"><div><span>待补资料</span><p>{record.collaboration.requiredInfo || '未填写'}</p></div><div><span>验证安排</span><p>{record.collaboration.verificationPlan || '未填写'}</p></div></div><p className="pq-prose">{record.collaboration.reply ? `${record.collaboration.repliedByName || record.collaboration.ownerName}：${record.collaboration.reply}` : '接收方尚未提交回复。'}</p></section>}
        <details className="pq-history"><summary>处理记录 · {handlingEvents.length} 次办理 · {record.analysis?.history.length ?? 0} 次原因认定</summary><p>原异常编号：{record.id}</p><p>提报：{record.createdByName} · {record.inspectionDate}</p>{record.collaboration?.reason && <p>协同转交依据：{record.collaboration.reason}</p>}{[...handlingEvents].reverse().map(event => <article key={event.id}><strong>{historyActions[event.action] || event.action} · {event.actorName} · {new Date(event.at).toLocaleString('zh-CN', { hour12: false })}</strong><p>{event.reason}</p></article>)}{[...(record.analysis?.history ?? [])].reverse().slice(0, 5).map((item, index) => <article key={`${item.at}:${index}`}><strong>{item.actorName} · {item.at.slice(0, 10)} · {item.action === 'confirm' ? '确认原因' : '补充分析'}</strong><p>{item.reason}</p></article>)}{(record.analysis?.history.length ?? 0) > 5 && <p>在“分析与处置”中查看全部历史。</p>}</details>
        <footer className="pq-actions"><div><Button variant="outline" onClick={() => setDialogId(record.id)}><FileText size={16} aria-hidden="true" />{canManage && record.status !== 'closed' ? '分析与处置' : '查看分析详情'}</Button>{canManage && record.status !== 'closed' && onEdit && <Button variant="outline" onClick={() => onEdit(current.plan, { action: 'assign-quality', task: current.task, quality: record })}><Users size={16} aria-hidden="true" />转交协同</Button>}{canCollaborate && record.collaboration?.phase === 'waiting_reply' && record.collaboration.ownerId === user?.id && onEdit && <Button onClick={() => onEdit(current.plan, { action: 'reply-quality', task: current.task, quality: record })}>回复原异常</Button>}</div><Button onClick={() => onVerify ? onVerify(record) : setVerificationId(record.id)}><ClipboardCheck size={16} aria-hidden="true" />{canVerify ? record.status === 'closed' ? '验证记录 / 重开' : '独立复验' : '查看验证记录'}</Button></footer>
      </section> : <section className="pq-detail pq-detail-empty" role={linkedId ? 'alert' : undefined}><ClipboardCheck size={30} aria-hidden="true" /><h2>{linkedId ? '原异常不存在或无权查看' : '暂无可处理的不良'}</h2><p>{linkedId ? '请从左侧选择当前范围内的原异常。' : '现场提报或生产检验产生的异常会显示在这里。'}</p></section>}
    </div>
    {!collaborationOnly && summary.top.length > 0 && <section className="pq-frequency"><div className="pq-section-title"><h2>高频不良现象</h2><span>当前筛选范围 · 按发生次数统计</span></div><ol>{summary.top.map(([name, count], index) => <li key={name}><span>{index + 1}</span><strong>{name}</strong><div className="pq-bar"><span style={{ width: `${count / (summary.top[0]?.[1] || 1) * 100}%` }} /></div><span>{count} 次</span></li>)}</ol></section>}
    {currentDialog && <QualityAnalysisDialog id={currentDialog.id} onClose={() => setDialogId(null)} onSaved={onSaved} />}
    {verifyRecord && <QualityVerificationDialog record={verifyRecord} canVerify={canVerify} onClose={() => setVerificationId(null)} onSaved={() => { setVerificationId(null); onSaved(); }} />}
  </div>;
}

function QualityEvidence({ record }: { record: QualityRecord }) {
  const files = record.analysis?.files ?? [];
  const [attachments, setAttachments] = useState<Record<string, PreviewableAttachment>>({}), [preview, setPreview] = useState<PreviewableAttachment | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(files.slice(0, 4).filter(file => file.mime.startsWith('image/')).map(async file => {
      const attachment = await getQualityAttachment(record.id, file.fileId, controller.signal);
      if (!controller.signal.aborted) setAttachments(previous => ({ ...previous, [file.fileId]: attachment }));
    }));
    return () => controller.abort();
  }, [record.id]);
  async function open(fileId: string) {
    setError('');
    try { const refresh = () => getQualityAttachment(record.id, fileId); setPreview({ ...await refresh(), refresh }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '证据读取失败，请重试'); }
  }
  return <>{files.length ? <div className="pq-evidence">{files.map(file => <Button className="pq-evidence-file" key={file.fileId} variant="outline" onClick={() => void open(file.fileId)}>{attachments[file.fileId] ? <img src={attachments[file.fileId].previewUrl || attachments[file.fileId].url} alt={file.name} loading="lazy" /> : <FileText size={24} aria-hidden="true" />}<span>{file.name}</span></Button>)}</div> : <p className="pq-evidence-empty">暂无照片或视频；可在“分析与处置”补充。</p>}{error && <p className="pq-file-error" role="alert">{error}</p>}{preview && <AttachmentPreviewDialog attachment={preview} attachments={[preview]} onClose={() => setPreview(null)} />}</>;
}
