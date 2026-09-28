import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { getPurchaseDelivery, isDeliveryDay, PURCHASE_DELIVERY_CHANGED, PurchaseDeliveryError, recordSupplierCommitment,
  type PurchaseDeliveryDetail, type RecordSupplierCommitmentInput } from '../../lib/purchaseDeliveryApi';
import './purchase-delivery.css';
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import { PurchaseOrderDeliveryImpacts } from './PurchaseOrderDeliveryImpacts';

export interface PurchaseOrderDeliveryPanelProps {
  lineId: string; orderNo: string; onSaved?: () => void;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}
const blank = () => ({ promisedDate: '', communicatedOn: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), evidence: '', reason: '', declareOriginal: false, withdraw: false });
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间待核对';

export function PurchaseOrderDeliveryPanel(props: PurchaseOrderDeliveryPanelProps) {
  const { user } = useAuth();
  const scope = JSON.stringify([props.lineId, props.orderNo, user?.id, [...(user?.permissions ?? [])].sort()]);
  return <DeliveryPanel key={scope} {...props} />;
}
function DeliveryPanel({ lineId, orderNo, onSaved, onStateChange }: PurchaseOrderDeliveryPanelProps) {
  const { t } = useI18n(), { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canRead = permissions.includes('*') || ['page:purchase-orders', 'page:purchase-order-detail'].some((permission) => permissions.includes(permission));
  const canWrite = permissions.includes('*') || ['page:purchase-order-detail', 'proc-purchase-order:record-commitment'].every((permission) => permissions.includes(permission));
  const [data, setData] = useState<PurchaseDeliveryDetail | null>(null), [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [impactRevision, setImpactRevision] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(blank), [initial, setInitial] = useState(''), [needsReload, setNeedsReload] = useState(false);
  const alive = useRef(true), inFlight = useRef(false), readAbort = useRef<AbortController | null>(null), sequence = useRef(0);
  const requestIdentity = useRef<{ signature: string; requestId: string } | null>(null);
  const dirty = editing && JSON.stringify(draft) !== initial;
  useEffect(() => { onStateChange?.({ dirty, busy: Boolean(busy) }); }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty && busy !== 'save') return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  async function load(supplierPage = 1, erpPage = 1) {
    if (!canRead || inFlight.current) return;
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    const current = ++sequence.current; setBusy('read'); setError('');
    try {
      const value = await getPurchaseDelivery(lineId, orderNo, supplierPage, erpPage, controller.signal);
      if (!alive.current || current !== sequence.current) return;
      setData(value); setNeedsReload(false); setImpactRevision(value => value + 1);
      if (editing) setNotice(t('已读取最新记录，草稿保留。请核对日期、原因和最新版本后保存。'));
    } catch (cause) { if (alive.current && !controller.signal.aborted) { setError(cause instanceof Error ? cause.message : t('交期读取失败')); setNeedsReload(true); } }
    finally { if (alive.current && current === sequence.current) setBusy(null); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; sequence.current++; readAbort.current?.abort(); }; }, []);
  function begin() {
    if (!data || busy || !canWrite) return;
    const value = { ...blank(), promisedDate: data.supplier?.currentDate ?? '' };
    setDraft(value); setInitial(JSON.stringify(value)); setEditing(true); setNotice(''); setError(''); requestIdentity.current = null;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || inFlight.current || busy || !canWrite || !data.canRecord || needsReload) return;
    if ((!draft.withdraw && !isDeliveryDay(draft.promisedDate)) || !isDeliveryDay(draft.communicatedOn) || !draft.evidence.trim() || !draft.reason.trim()) {
      setError(t('请填写有效日期、承诺凭据或出处，以及登记或改期原因。')); return;
    }
    const payload = { orderNo, promisedDate: draft.withdraw ? null : draft.promisedDate, communicatedOn: draft.communicatedOn,
      evidence: draft.evidence.trim(), reason: draft.reason.trim(), declareOriginal: !draft.withdraw && !data.supplier && draft.declareOriginal,
      expectedVersion: data.supplier?.version ?? 0, expectedSourceUpdatedAt: data.line.sourceUpdatedAt };
    const signature = JSON.stringify(payload);
    if (requestIdentity.current?.signature !== signature) requestIdentity.current = { signature, requestId: crypto.randomUUID() };
    const input: RecordSupplierCommitmentInput = { ...payload, requestId: requestIdentity.current.requestId };
    inFlight.current = true; setBusy('save'); setError(''); setNotice('');
    try {
      const value = await recordSupplierCommitment(lineId, input);
      if (!alive.current) return;
      setData(value); setImpactRevision(value => value + 1); setEditing(false); setInitial(''); requestIdentity.current = null;
      setNotice(t('供应商承诺已保存；ERP 预计到货日期保持其同步来源。'));
      window.dispatchEvent(new Event(PURCHASE_DELIVERY_CHANGED)); onSaved?.();
    } catch (cause) { if (alive.current) { setError(cause instanceof Error ? cause.message : t('承诺保存失败')); if (cause instanceof PurchaseDeliveryError && cause.status === 409) setNeedsReload(true); } }
    finally { inFlight.current = false; if (alive.current) setBusy(null); }
  }
  if (!canRead) return <p role="status">{t('需要采购订单查看权限才能读取交期记录。')}</p>;
  return <section className="purchase-delivery-panel" aria-label={t('供应商承诺与 ERP 交期记录')}>
    <div className="delivery-toolbar"><p className="delivery-explanation">{t('供应商承诺按凭据人工登记；ERP 日期来自只读同步。两类日期分别保留。')}</p><Button variant="outline" disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw className="size-4" />{t('刷新交期')}</Button></div>
    {error ? <div className="delivery-error" role="alert"><p>{error}</p>{needsReload ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void load()}>{t('重新载入并核对')}</Button> : null}</div> : null}
    {busy ? <p role="status">{t(busy === 'save' ? '正在保存供应商承诺…' : '正在读取交期记录…')}</p> : null}
    {notice ? <p className="delivery-notice" role="status">{notice}</p> : null}
    {data ? <>
      <p className="delivery-explanation">{data.line.orderNo} · {t('行')} {data.line.lineNo} · {data.line.inventoryName} · {data.line.supplierName}</p>
      <dl className="delivery-date-summary"><div><dt>{t('供应商最初承诺（凭据登记）')}</dt><dd>{data.supplier?.originalDate || t('未提供原始凭据')}</dd></div><div><dt>{t('当前登记承诺')}</dt><dd>{data.supplier?.currentDate || t(data.supplier ? '已撤销日期' : '未登记')}</dd></div><div><dt>{t('ERP 当前预计到货')}</dt><dd>{data.line.erpExpectedDate || t('未提供')}</dd></div></dl>
      {data.supplier?.sourceChanged ? <p className="delivery-warning" role="status">{t('订单物料、供应商、单位或订购数量已变化，以上人工记录属于旧来源，须核对后重新登记。')}</p> : null}
      {canWrite && data.canRecord && !editing ? <Button onClick={begin} disabled={Boolean(busy) || needsReload}>{t(data.supplier ? '登记改期或撤销承诺' : '登记供应商承诺')}</Button> : null}
      {editing ? <form className="delivery-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={Boolean(busy)}><legend>{t('登记供应商承诺')}</legend>
          <label>{t('供应商承诺到货日期')}<Input type="date" value={draft.promisedDate} disabled={Boolean(busy) || draft.withdraw} required={!draft.withdraw} onChange={(event) => setDraft((value) => ({ ...value, promisedDate: event.target.value }))} /></label>
          <label>{t('供应商沟通日期')}<Input type="date" value={draft.communicatedOn} required onChange={(event) => setDraft((value) => ({ ...value, communicatedOn: event.target.value }))} /></label>
          <label className="delivery-wide">{t('承诺凭据或出处')}<Textarea value={draft.evidence} maxLength={2000} required placeholder={t('例如邮件主题与日期、聊天记录时间、文件编号')} onChange={(event) => setDraft((value) => ({ ...value, evidence: event.target.value }))} /></label>
          <label className="delivery-wide">{t('登记或改期原因')}<Textarea value={draft.reason} maxLength={2000} required onChange={(event) => setDraft((value) => ({ ...value, reason: event.target.value }))} /></label>
          {!data.supplier ? <label className="delivery-check delivery-wide"><Checkbox checked={draft.declareOriginal} disabled={Boolean(busy) || draft.withdraw} onCheckedChange={(checkedValue) => setDraft((value) => ({ ...value, declareOriginal: (checkedValue === true) }))} />{t('凭据证明此日期为供应商最初承诺')}</label> : null}
          <label className="delivery-check delivery-wide"><Checkbox checked={draft.withdraw} onCheckedChange={(checkedValue) => setDraft((value) => ({ ...value, withdraw: (checkedValue === true) }))} />{t('撤销当前承诺日期，保留历史')}</label>
        </fieldset>
        <p className="delivery-explanation">{t('首次登记不自动视为最初承诺。保存会记录操作者、凭据、原因与版本。')}</p>
        <Button type="submit" disabled={Boolean(busy) || needsReload}>{t(busy === 'save' ? '保存中…' : '保存承诺记录')}</Button>
      </form> : null}
      <PurchaseOrderDeliveryImpacts lineId={lineId} orderNo={orderNo} refreshKey={JSON.stringify([data.line.sourceUpdatedAt, data.supplier?.version, impactRevision])} />
      <section><h3>{t('供应商承诺登记历史')}</h3><HistoryPager page={data.supplierHistory} disabled={Boolean(busy)} label={t('供应商历史')} onPage={(page) => void load(page, data.erpHistory.page)} />
        {!data.supplierHistory.items.length ? <p className="delivery-explanation">{t('尚无登记记录，不能据此判断供应商从未改期。')}</p> : <ol className="delivery-history">{data.supplierHistory.items.map((entry) => <li key={entry.version}><strong>{t(entry.kind === 'original' ? '原承诺凭据登记' : entry.kind === 'withdrawal' ? '撤销日期' : '承诺登记/改期')} · v{entry.version}</strong><p className="delivery-history-dates">{entry.before || t('未登记')} → {entry.after || t('撤销')}</p><p>{t('供应商沟通日')}：{entry.communicatedOn}</p><p>{t('凭据')}：{entry.evidence}</p><p>{t('原因')}：{entry.reason}</p><p className="delivery-explanation">{t('登记时来源')}：{entry.source.inventoryName} · {entry.source.supplierName} · {entry.source.orderedQty} {entry.source.unit}</p><p className="delivery-explanation">{entry.actorName} · {time(entry.recordedAt)}</p></li>)}</ol>}
      </section>
      <section><h3>{t('ERP 同步交期观察历史')}</h3><p className="delivery-explanation">{t(data.historyNotice)} {data.erp ? `${t('开始观察')}：${time(data.erp.coverageStartedAt)}` : t('尚未建立观察基线。')}</p><HistoryPager page={data.erpHistory} disabled={Boolean(busy)} label={t('ERP 历史')} onPage={(page) => void load(data.supplierHistory.page, page)} />
        <ol className="delivery-history">{data.erpHistory.items.map((entry) => <li key={entry.version}><strong>{t(entry.kind === 'baseline' ? '首次观察基线' : '同步时观察到变化')} · v{entry.version}</strong><p className="delivery-history-dates">{entry.kind === 'baseline' ? t('此前历史未知') : entry.before || t('未提供')} → {entry.after || t('未提供')}</p>{entry.beforeOrderDate !== entry.afterOrderDate ? <p>{t('订单日期')}：{entry.beforeOrderDate || t('此前未知')} → {entry.afterOrderDate || t('未提供')}</p> : null}<p className="delivery-explanation">{t('观察时来源')}：{entry.source.inventoryName} · {entry.source.supplierName} · {entry.source.orderedQty} {entry.source.unit}</p><p className="delivery-explanation">{t('观察时间')}：{time(entry.recordedAt)}</p></li>)}</ol>
      </section>
    </> : !busy && !error ? <p role="status">{t('尚未读取交期记录。')}</p> : null}
  </section>;
}
function HistoryPager({ page, disabled, label, onPage }: { page: { page: number; totalPages: number; total: number }; disabled: boolean; label: string; onPage: (page: number) => void }) {
  return <nav className="delivery-history-pager" aria-label={label}><span>{page.total} 条 · {page.page}/{page.totalPages}</span><Button size="sm" variant="outline" aria-label={`${label}上一页`} disabled={disabled || page.page <= 1} onClick={() => onPage(page.page - 1)}>上一页</Button><Button size="sm" variant="outline" aria-label={`${label}下一页`} disabled={disabled || page.page >= page.totalPages} onClick={() => onPage(page.page + 1)}>下一页</Button></nav>;
}
