import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { AlertCircle, ArrowLeft, ArrowUpRight, CheckCircle2, ClipboardList, Clock3, FileText, Plus, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { OrderEmptyState, OrderPageHeader } from '../../order-processing/components/HorizonPage';
import { QualityExceptionActionForm } from './QualityExceptionActionForm';
import { QualityExceptionCreateDialog } from './QualityExceptionCreateDialog';
import { allowedQualityActions, applyQualityAction, createQualityIssue, createQualityPreviewState } from './qualityExceptionPreviewModel';
import { qualityActionLabels, qualityCauseLabels, qualityMethodLabels, qualitySourceLabels, qualityStatusLabels, type QualityActionInput, type QualityActionKind, type QualityCause, type QualityCreateInput, type QualityIssue, type QualitySource, type QualityStatus } from './qualityExceptionTypes';
import '../../order-processing/horizon.css';
import './quality-exceptions-preview.css';
import { Checkbox } from "../../components/ui/checkbox";

type Scenario = 'normal' | 'empty' | 'error' | 'readonly';
type Filters = { source: QualitySource | 'all'; status: QualityStatus | 'all'; cause: QualityCause | 'unknown' | 'all'; query: string; from: string; to: string };
const initialFilters: Filters = { source: 'incoming', status: 'all', cause: 'all', query: '', from: '', to: '' };
const sources = Object.keys(qualitySourceLabels) as QualitySource[];
const stages: QualityStatus[] = ['unassigned', 'processing', 'awaiting_verification', 'awaiting_close', 'closed'];
const countPerPage = 8;
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function nextAction(issue: QualityIssue): QualityActionKind {
  if (issue.status === 'awaiting_verification') return 'verify';
  if (issue.status === 'awaiting_close' || issue.status === 'closed') return 'close';
  if (issue.status === 'unassigned') return 'assign';
  if (issue.verificationResult === 'failed') return 'disposition';
  if (!issue.causeCategory) return 'cause';
  return issue.handledQty < issue.defectiveQty ? 'disposition' : 'submit_verification';
}

/** Development-only S06/S16 review. The existing quality services remain separate. */
export function QualityExceptionsPreviewPage() {
  const { t } = useI18n();
  const [state, setState] = useState(createQualityPreviewState);
  const stateRef = useRef(state);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('issue');
  const issue = state.issues.find((item) => item.id === selectedId);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [actionKind, setActionKind] = useState<QualityActionKind>(() => issue ? nextAction(issue) : 'assign');
  const [generation, setGeneration] = useState(0);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [createOpen, setCreateOpen] = useState(false);
  const [failNextSave, setFailNextSave] = useState(false);
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const lastListButton = useRef<string | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const allowed = issue ? allowedQualityActions(issue) : [];
  const effectiveKind = allowed.includes(actionKind) ? actionKind : allowed[0];
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const overdue = (item: QualityIssue) => item.status !== 'closed' && Boolean(item.dueDate) && item.dueDate < today();
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const scoped = state.issues.filter((item) => (filters.source === 'all' || item.source === filters.source)
    && (filters.status === 'all' || item.status === filters.status)
    && (!filters.from || item.discoveredDate >= filters.from) && (!filters.to || item.discoveredDate <= filters.to)
    && [item.code, item.materialCode, item.materialName, item.batchNo, item.supplierName, item.owner, item.phenomenon].some((value) => value.toLowerCase().includes(filters.query.trim().toLowerCase())));
  const visible = invalidRange ? [] : scoped.filter((item) => filters.cause === 'all' || (item.causeCategory || 'unknown') === filters.cause);
  const pages = Math.max(1, Math.ceil(visible.length / countPerPage));
  const currentPage = Math.min(page, pages);
  const rows = visible.slice((currentPage - 1) * countPerPage, currentPage * countPerPage);
  const reasonCounts = (['unknown', ...Object.keys(qualityCauseLabels)] as (QualityCause | 'unknown')[]).map((cause) => ({ cause, count: scoped.filter((item) => (item.causeCategory || 'unknown') === cause).length }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (selectedId) return;
    if (lastListButton.current) document.getElementById(lastListButton.current)?.focus();
  }, [selectedId]);

  function requestChange(action: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) { pendingAction.current = action; setDiscardOpen(true); }
    else action();
  }
  function resetForm() { markDirty(false); setGeneration((value) => value + 1); }
  function selectIssue(id: string | null) {
    requestChange(() => {
      resetForm(); setFlash(null);
      const next = new URLSearchParams(params);
      if (id) { next.set('issue', id); lastListButton.current = `quality-open-${id}`; const target = stateRef.current.issues.find((item) => item.id === id); setActionKind(target ? nextAction(target) : 'assign'); }
      else next.delete('issue');
      setParams(next);
    });
  }
  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) { setFilters((current) => ({ ...current, [key]: value })); setPage(1); }
  function resetPreview() {
    const next = createQualityPreviewState(); stateRef.current = next; setState(next);
    setFilters(initialFilters); setPage(1); setScenario('normal'); setFailNextSave(false); setFlash(null); resetForm();
    const query = new URLSearchParams(params); query.delete('issue'); setParams(query, { replace: true });
  }
  function commit(action: () => void) {
    if (busyRef.current) throw new Error(t('正在保存，请稍候。'));
    busyRef.current = true; setBusy(true);
    try {
      if (scenario !== 'normal') throw new Error(t('当前演示场景不能保存。'));
      if (failNextSave) { setFailNextSave(false); throw new Error(t('演示保存失败，填写内容已保留。请再次保存。')); }
      action();
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function saveAction(input: QualityActionInput) {
    if (!issue) throw new Error(t('未找到当前演示异常。'));
    commit(() => {
      const next = applyQualityAction(stateRef.current, issue.id, issue.version, input);
      stateRef.current = next; setState(next); markDirty(false);
      const updated = next.issues.find((item) => item.id === issue.id)!;
      if (input.kind !== 'feedback') setActionKind(nextAction(updated));
      setGeneration((value) => value + 1);
      setFlash({ id: issue.id, text: t('已保存{action}演示记录。', { action: t(qualityActionLabels[input.kind]) }) });
    });
  }
  async function saveNew(input: QualityCreateInput) {
    commit(() => {
      const next = createQualityIssue(stateRef.current, input);
      const created = next.issues.find((item) => !stateRef.current.issues.some((old) => old.id === item.id));
      if (!created) throw new Error(t('演示异常创建失败，请重试。'));
      stateRef.current = next; setState(next); resetForm(); setActionKind('assign');
      setFilters({ ...initialFilters, source: input.source }); setPage(1);
      const nextParams = new URLSearchParams(params); nextParams.set('issue', created.id); setParams(nextParams);
      setFlash({ id: created.id, text: t('演示异常已登记，请分派经办与验证人。') });
    });
  }

  function showStatus(item: QualityIssue) { return <span className="qep-status" data-status={item.status}>{t(qualityStatusLabels[item.status])}</span>; }
  function detail(item: QualityIssue) {
    const qty = (value: number) => `${number(value)} ${item.unit}`;
    const records = state.records.filter((record) => record.issueId === item.id);
    const step = stages.indexOf(item.status);
    return <>
      <div className="qep-detail-heading"><Button variant="ghost" onClick={() => selectIssue(null)} disabled={busy}><ArrowLeft className="size-4" aria-hidden="true" />{t('返回异常列表')}</Button><span className="qep-muted">{t('来源记录、处置与复检集中查看')}</span></div>
      <section className="qep-card qep-identity">
        <div className="qep-identity-title"><div><p className="qep-muted tabular-nums">{item.code}</p><h2 className="text-balance">{item.materialName} · {item.phenomenon}</h2></div>{showStatus(item)}</div>
        <dl className="qep-identity-grid">{[[t('来源 / 发现日期'), `${t(qualitySourceLabels[item.source])} · ${item.discoveredDate}`], [t('物料 / 规格'), `${item.materialCode} · ${item.spec || t('未记录规格')}`], [t('供应商'), item.supplierName], [t('批次 / 采购单'), `${item.batchNo} / ${item.orderNo || t('未关联采购单')}`], [t('经办 / 验证'), `${item.owner || t('待分派')} / ${item.verifier || t('待分派')}`], [t('处理期限'), item.dueDate || t('待分派时确认')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={cn(label === t('处理期限') && overdue(item) && 'text-destructive')}>{value}{label === t('处理期限') && overdue(item) ? ` · ${t('已逾期')}` : ''}</dd></div>)}</dl>
      </section>
      <ol className="qep-progress" aria-label={t('异常处理进度')}>{stages.map((status, index) => <li key={status} aria-current={index === step ? 'step' : undefined} data-past={index < step}><span>{index < step ? <CheckCircle2 className="size-4" aria-hidden="true" /> : index + 1}</span>{t(qualityStatusLabels[status])}</li>)}</ol>
      {flash?.id === item.id ? <p role="status" className="qep-flash">{flash.text}</p> : null}
      <div className="qep-detail-grid">
        <div className="qep-facts-column">
          <section className="qep-card qep-section"><h3>{t('异常事实与证据')}</h3><dl className="qep-quantity-grid"><div><dt>{t('检验数量')}</dt><dd>{qty(item.inspectedQty)}</dd></div><div><dt>{t('不良数量')}</dt><dd>{qty(item.defectiveQty)}</dd></div><div><dt>{t('本批不良占比')}</dt><dd>{number(item.defectiveQty / item.inspectedQty * 100)}%</dd></div></dl><p className="qep-muted">{t('仅表示当前异常批次，不代表供应商整体不良率。')}</p><p className="qep-field-label">{t('发现现象')}</p><p className="qep-prose">{item.phenomenon}</p><p className="qep-field-label">{t('原始证据说明')}</p><p className="qep-prose">{item.evidence}</p><p className="qep-note">{t('本期可记录文字依据和单据号，附件上传后续接入。')}</p>{item.receiptId ? <details className="qep-details"><summary>{t('查看收货来源')}</summary><p className="qep-prose tabular-nums">{item.orderNo} / {item.receiptId}</p><p className="qep-muted">{t('演示来源引用；此页面不回写收货或库存。')}</p></details> : null}</section>
          <section className="qep-card qep-section"><div className="qep-section-title"><h3>{t('关联反馈')}</h3><span className="qep-muted">{t('{count} 条', { count: item.linkedFeedback.length })}</span></div><p className="qep-muted">{t('同批问题归入这张异常单，关联反馈不重复增加不良数。')}</p>{item.linkedFeedback.length ? <ul className="qep-feedback">{item.linkedFeedback.map((feedback) => <li key={`${feedback.source}:${feedback.reference}`}><strong>{t(qualitySourceLabels[feedback.source])} · {feedback.reference}</strong><p className="qep-prose">{feedback.note}</p></li>)}</ul> : <p className="qep-note">{t(scenario !== 'readonly' && allowed.includes('feedback') ? '暂无关联反馈，可从操作区选择“关联反馈”。' : '暂无关联反馈。')}</p>}</section>
        </div>
        <div className="qep-facts-column">
          <section className="qep-card qep-section"><div className="qep-section-title"><h3>{t('原因与责任认定')}</h3><span className="qep-status" data-status={item.causeCategory ? 'closed' : 'unassigned'}>{t(item.causeCategory ? '主因已确认' : '主因待确认')}</span></div>{item.causeCategory ? <><p className="qep-field-label">{t(qualityCauseLabels[item.causeCategory])}</p><p className="qep-prose">{item.causeDetail}</p><p className="qep-field-label">{t('责任认定')}</p><p className="qep-prose">{item.responsibility}</p><p className="qep-field-label">{t('确认依据')}</p><p className="qep-prose">{item.causeEvidence}</p></> : <p className="qep-note">{t('原因尚待人工确认。发现现象和经办分派不等于责任认定。')}</p>}</section>
          <section className="qep-card qep-section"><h3>{t('处置与复检')}</h3><dl className="qep-quantity-grid qep-quantity-grid-two"><div><dt>{t('累计已处理')}</dt><dd>{qty(item.handledQty)}</dd></div><div><dt>{t('剩余待处理')}</dt><dd>{qty(Math.round((item.defectiveQty - item.handledQty) * 1000) / 1000)}</dd></div></dl>{item.dispositionMethod ? <><p className="qep-field-label">{t(qualityMethodLabels[item.dispositionMethod])}</p><p className="qep-prose">{item.dispositionDetail}</p><p className="qep-muted whitespace-pre-wrap">{item.dispositionEvidence}</p></> : <p className="qep-note">{t('尚未登记已完成的处置结果。')}</p>}<div className="qep-verification"><strong>{item.verificationRound > 0 ? t('复检第 {round} 轮', { round: item.verificationRound }) : t('尚未提交复检')}</strong><span className="qep-muted">{t(item.verificationResult === 'passed' ? '复检通过' : item.verificationResult === 'failed' ? '复检未通过，继续整改' : item.status === 'awaiting_verification' ? '等待复检结果' : '尚无有效复检通过结果')}</span>{item.verificationNote ? <><p className="qep-prose">{item.verificationNote}</p><p className="qep-muted">{qty(item.verificationQty)} · {item.verificationEvidence}</p></> : null}{item.closeNote ? <><p className="qep-field-label">{t('关闭说明')}</p><p className="qep-prose">{item.closeNote}</p></> : null}</div></section>
        </div>
        <section className="qep-action-column" aria-label={t('本次异常操作')}>
          {scenario === 'readonly' || !effectiveKind ? <div className="qep-card"><OrderEmptyState Icon={item.status === 'closed' ? CheckCircle2 : ShieldAlert} title={t(item.status === 'closed' ? '此异常已关闭' : '当前仅可查看')} description={t(item.status === 'closed' ? '可查看原因、处置、复检及关闭记录。演示关闭不代表物料已经放行或库存释放。' : '当前演示角色可以查看异常详情和历史，不能登记处置。')} action={scenario === 'readonly' ? <Button variant="outline" onClick={() => setScenario('normal')}>{t('返回正常操作')}</Button> : <Button variant="outline" onClick={() => selectIssue(null)}>{t('返回异常列表')}</Button>} /></div> : <><div className="qep-action-picker"><Label htmlFor="quality-current-action">{t('本次操作')}</Label><Select value={effectiveKind} disabled={busy} onValueChange={(value) => requestChange(() => { resetForm(); setActionKind(value as QualityActionKind); setFlash(null); })}><SelectTrigger id="quality-current-action" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{allowed.map((kind) => <SelectItem key={kind} value={kind}>{t(qualityActionLabels[kind])}</SelectItem>)}</SelectContent></Select></div><QualityExceptionActionForm key={`${item.id}:${effectiveKind}:${generation}`} issue={item} kind={effectiveKind} onSubmit={saveAction} onDirtyChange={markDirty} onCancel={() => requestChange(resetForm)} /></>}
        </section>
      </div>
      <section className="qep-card qep-history"><div className="qep-section-title"><h3>{t('处理记录')}</h3><span className="qep-muted">{t('{count} 条 · 最新在前', { count: records.length })}</span></div><ol>{records.map((record) => <li key={record.id}><div className="qep-history-heading"><strong>{record.summary}</strong><time className="tabular-nums">{new Date(record.createdAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false })}</time></div><p className="qep-muted">{record.actor} · {t(qualityStatusLabels[record.beforeStatus])} → {t(qualityStatusLabels[record.afterStatus])}</p><details className="qep-details"><summary>{t('查看本次记录')}</summary><dl className="qep-history-data">{record.details.map((field, index) => <div key={`${field.label}:${index}`}><dt>{t(field.label)}</dt><dd>{field.value}</dd></div>)}</dl></details></li>)}</ol></section>
    </>;
  }

  return <main className="order-horizon quality-exceptions-preview">
    <OrderPageHeader Icon={ShieldAlert} eyebrow={t('供应链 / 质量异常')} title={t(selectedId ? '质量异常处置详情' : '质量异常与原因分析')} description={t(selectedId ? '核对异常依据、跟进处置并记录复检结果。' : '优先跟进来料异常，按来源与主因查看待处理问题。')} actions={<><Button variant="outline" disabled={busy || createOpen} onClick={() => requestChange(resetPreview)}><RotateCcw className="size-4" aria-hidden="true" />{t('重置演示')}</Button>{!selectedId && scenario === 'normal' ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" />{t('登记演示异常')}</Button> : null}</>} />
    <div className="qep-preview-note"><strong>{t('交互预览')}</strong><p>{t('演示数据，刷新后恢复。登记、复检和关闭仅用于页面评审，不生成正式业务记录。')}</p></div>
    <details className="qep-scenarios"><summary>{t('演示场景')}</summary><div>{([['normal', '正常操作'], ['empty', '暂无异常'], ['error', '读取失败'], ['readonly', '仅可查看']] as const).map(([value, label]) => <Button key={value} variant={scenario === value ? 'secondary' : 'outline'} size="sm" aria-pressed={scenario === value} disabled={busy || createOpen} onClick={() => requestChange(() => { resetForm(); setScenario(value); })}>{t(label)}</Button>)}<label><Checkbox checked={failNextSave} disabled={busy || scenario !== 'normal'} onCheckedChange={(checkedValue) => setFailNextSave((checkedValue === true))} />{t('下次保存失败')}</label></div></details>
    {scenario === 'error' ? <section className="qep-card"><OrderEmptyState Icon={AlertCircle} title={t('质量异常读取失败')} description={t('演示记录仍保留，可重新加载后继续。')} action={<Button onClick={() => setScenario('normal')}>{t('重新加载')}</Button>} /></section> : scenario === 'empty' ? <section className="qep-card"><OrderEmptyState Icon={ClipboardList} title={t('暂无质量异常')} description={t('这是空列表的演示状态。')} action={<Button variant="outline" onClick={() => setScenario('normal')}>{t('返回演示异常')}</Button>} /></section> : selectedId ? issue ? detail(issue) : <section className="qep-card"><OrderEmptyState Icon={FileText} title={t('未找到这张演示异常')} description={t('新增演示记录会在刷新后恢复。请返回列表选择现有异常。')} action={<Button onClick={() => selectIssue(null)}>{t('返回异常列表')}</Button>} /></section> : <>
      <section className="qep-card qep-filters" aria-label={t('异常筛选')}><div className="qep-source-tabs" role="group" aria-label={t('异常来源')}><Button variant={filters.source === 'all' ? 'secondary' : 'ghost'} aria-pressed={filters.source === 'all'} onClick={() => changeFilter('source', 'all')}>{t('全部')}</Button>{sources.map((source) => <Button key={source} variant={filters.source === source ? 'secondary' : 'ghost'} aria-pressed={filters.source === source} onClick={() => changeFilter('source', source)}>{t(qualitySourceLabels[source])}</Button>)}</div><div className="qep-filter-fields"><div className="qep-search-field"><Label htmlFor="quality-query">{t('搜索异常')}</Label><div><Search className="size-4" aria-hidden="true" /><Input id="quality-query" placeholder={t('异常号、物料、供应商或批次')} value={filters.query} onChange={(event) => changeFilter('query', event.target.value)} /></div></div><div><Label htmlFor="quality-filter-status">{t('处理状态')}</Label><Select value={filters.status} onValueChange={(value) => changeFilter('status', value as Filters['status'])}><SelectTrigger id="quality-filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('全部状态')}</SelectItem>{stages.map((status) => <SelectItem key={status} value={status}>{t(qualityStatusLabels[status])}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="quality-date-from">{t('发现日期起')}</Label><Input id="quality-date-from" type="date" value={filters.from} onChange={(event) => changeFilter('from', event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? 'quality-date-error' : undefined} /></div><div><Label htmlFor="quality-date-to">{t('发现日期止')}</Label><Input id="quality-date-to" type="date" value={filters.to} onChange={(event) => changeFilter('to', event.target.value)} aria-invalid={invalidRange} aria-describedby={invalidRange ? 'quality-date-error' : undefined} /></div><Button variant="outline" onClick={() => { setFilters(initialFilters); setPage(1); }}>{t('重置筛选')}</Button></div>{invalidRange ? <p id="quality-date-error" role="alert" className="text-sm text-destructive">{t('开始日期不能晚于结束日期。')}</p> : null}</section>
      <section className="qep-metrics" aria-label={t('当前筛选统计')}>{[[t('异常单数'), visible.length, ClipboardList], [t('主因待确认'), visible.filter((item) => !item.causeCategory).length, Search], [t('等待复检'), visible.filter((item) => item.status === 'awaiting_verification').length, CheckCircle2], [t('逾期未完成'), visible.filter(overdue).length, Clock3]].map(([label, value, Icon]) => { const MetricIcon = Icon as typeof ClipboardList; return <div key={String(label)} className="qep-card"><div><p>{label as string}</p><strong className="tabular-nums">{value as number}<span>{t('单')}</span></strong></div><MetricIcon className="size-5" aria-hidden="true" /></div>; })}</section>
      <section className="qep-card qep-cause-summary"><div className="qep-section-title"><div><h3>{t('按主因查看异常')}</h3><p className="qep-muted">{t('按异常单计数；不同单位的物料数量不相加。')}</p></div>{filters.cause !== 'all' ? <Button variant="ghost" size="sm" onClick={() => changeFilter('cause', 'all')}>{t('清除主因筛选')}</Button> : null}</div><div className="qep-cause-buttons">{reasonCounts.map(({ cause, count }) => <Button variant="unstyled" key={cause} type="button" aria-pressed={filters.cause === cause} disabled={invalidRange} onClick={() => changeFilter('cause', filters.cause === cause ? 'all' : cause)}><span>{t(cause === 'unknown' ? '待确认' : qualityCauseLabels[cause])}</span><strong className="tabular-nums">{invalidRange ? '—' : count}</strong></Button>)}</div></section>
      <section className="qep-card qep-list"><div className="qep-section-title"><h2>{t('异常清单')}</h2><span className="qep-muted">{t('{count} 张异常单', { count: visible.length })}{filters.cause !== 'all' ? ` · ${t(filters.cause === 'unknown' ? '主因待确认' : qualityCauseLabels[filters.cause])}` : ''}</span></div>{rows.length ? <><div className="qep-table-head" aria-hidden="true"><span>{t('异常 / 物料')}</span><span>{t('来源 / 批次')}</span><span>{t('本批不良 / 检验')}</span><span>{t('主因 / 经办')}</span><span>{t('状态 / 期限')}</span><span>{t('操作')}</span></div><ul>{rows.map((item) => <li key={item.id} className="qep-list-row"><div><p className="qep-code tabular-nums">{item.code}</p><strong>{item.materialName}</strong><p className="qep-muted">{item.phenomenon}</p></div><div><span>{t(qualitySourceLabels[item.source])} · {item.discoveredDate}</span><p className="qep-muted tabular-nums">{item.batchNo}</p><p className="qep-muted">{item.supplierName}</p></div><div className="qep-row-qty tabular-nums"><span className="qep-mobile-label">{t('不良 / 检验')}</span><strong>{number(item.defectiveQty)} / {number(item.inspectedQty)} {item.unit}</strong></div><div><span>{t(item.causeCategory ? qualityCauseLabels[item.causeCategory] : '主因待确认')}</span><p className="qep-muted">{item.owner || t('经办待分派')}</p></div><div>{showStatus(item)}<p className={cn('qep-muted tabular-nums', overdue(item) && 'text-destructive')}>{item.dueDate || t('期限待确认')}{overdue(item) ? ` · ${t('逾期')}` : ''}</p></div><Button id={`quality-open-${item.id}`} variant="outline" size="sm" onClick={() => selectIssue(item.id)} aria-label={t('查看异常 {code}', { code: item.code })}>{t('查看详情')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Button></li>)}</ul><div className="qep-pagination"><span>{t('第 {page} / {pages} 页', { page: currentPage, pages })}</span><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('上一页')}</Button><Button variant="outline" size="sm" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{t('下一页')}</Button></div></> : <OrderEmptyState Icon={Search} title={t(invalidRange ? '请先修正日期范围' : '没有匹配的异常')} description={t('可清除筛选，查看全部演示来源。')} action={<Button variant="outline" onClick={() => { setFilters({ ...initialFilters, source: 'all' }); setPage(1); }}>{t('清除全部筛选')}</Button>} />}</section>
    </>}
    <QualityExceptionCreateDialog open={createOpen} navigationPending={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { setCreateOpen(open); if (!open) markDirty(false); }} onSubmit={saveNew} onDirtyChange={markDirty} />
    <AlertDialog open={discardOpen || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setDiscardOpen(false); pendingAction.current = null; if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent className="qep-confirm" overlayClassName="qep-confirm-overlay"><AlertDialogHeader><AlertDialogTitle>{t('放弃尚未保存的填写？')}</AlertDialogTitle><AlertDialogDescription>{t('本次填写将被清空，已保存的演示记录仍保留；重置演示会恢复初始数据。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; markDirty(false); setCreateOpen(false); setDiscardOpen(false); if (blocker.state === 'blocked') blocker.proceed(); else action?.(); }}>{t('放弃并继续')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
