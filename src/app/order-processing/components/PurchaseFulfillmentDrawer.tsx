import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { decidePurchaseFulfillment, getPurchaseFulfillment, proposePurchaseFulfillment, type FulfillmentBucket, type FulfillmentKind, type PurchaseFulfillmentLedger } from '../../lib/purchaseFulfillmentApi';
import './purchase-fulfillment.css';

const kinds: Record<FulfillmentKind, string> = { cancel: '取消未交数量', return: '退货并保留补交需求', reversal: '冲销错误实收登记', coverage: '确认 ERP 与本地覆盖' };
const statuses = { pending: '待确认', approved: '已批准', revoked: '已撤销' };
const buckets: Record<FulfillmentBucket, string> = { qualified: '合格', defective: '不良', pending_judgment: '待判', pending: '待检' };
type FulfillmentDrawerProps = { lineId: string; onClose: () => void; onSaved?: () => void; onCloseAutoFocus?: (event: Event) => void };
export function PurchaseFulfillmentDrawer(props: FulfillmentDrawerProps) {
  const { user } = useAuth();
  return <FulfillmentSession key={JSON.stringify([props.lineId, user?.id, [...(user?.permissions ?? [])].sort()])} {...props} />;
}
function FulfillmentSession({ lineId, onClose, onSaved, onCloseAutoFocus }: FulfillmentDrawerProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const identity = JSON.stringify([user?.id, [...(user?.permissions ?? [])].sort()]);
  const scopeKey = JSON.stringify([lineId, identity]);
  const [ledger, setLedger] = useState<PurchaseFulfillmentLedger | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [kind, setKind] = useState<FulfillmentKind>('cancel'), [quantity, setQuantity] = useState(''), [receiptId, setReceiptId] = useState(''), [bucket, setBucket] = useState<FulfillmentBucket>('pending'), [reason, setReason] = useState(''), [reflected, setReflected] = useState<string[]>([]);
  const [decision, setDecision] = useState<{ id: string; action: 'approve' | 'revoke' } | null>(null), [decisionReason, setDecisionReason] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const closeOrigin = useRef<HTMLElement | null>(null), discarded = useRef(false);
  const mounted = useRef(true), activeScope = useRef(scopeKey), busyRef = useRef(false), attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  activeScope.current = scopeKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setLedger(null);
    void getPurchaseFulfillment(lineId, controller.signal).then((value) => { if (!controller.signal.aborted) setLedger(value); }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('读取失败')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lineId, reload, t, identity]);
  const number = (value: number | null) => value === null ? t('待核对') : value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const dirty = kind !== 'cancel' || quantity !== '' || receiptId !== '' || bucket !== 'pending' || reason !== '' || reflected.length > 0 || decisionReason !== '';
  const requestClose = () => {
    if (!mounted.current || busyRef.current) return;
    if (!dirty) { onClose(); return; }
    closeOrigin.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    discarded.current = false; setDiscardOpen(true);
  };
  const save = async () => {
    if (!mounted.current || !ledger || busyRef.current || activeScope.current !== scopeKey) return;
    const scope = lineId, submittedScope = scopeKey;
    const data = { expectedVersion: ledger.version, expectedSourceUpdatedAt: ledger.line.updatedAt, reason: decision ? decisionReason.trim() : reason.trim(),
      ...(decision ? {} : { kind, quantity: kind === 'coverage' ? 0 : Number(quantity), ...(kind === 'return' || kind === 'reversal' ? { receiptId, bucket } : {}), reflectedEntryIds: kind === 'coverage' ? reflected : [] }) };
    if (!data.reason || (!decision && kind !== 'coverage' && (!quantity.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0))) { setError(t('请填写有效数量和操作依据')); return; }
    const fingerprint = JSON.stringify([scope, decision, data]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    const input = { ...data, requestId: attempt.current.id };
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = decision ? await decidePurchaseFulfillment(scope, decision.id, decision.action, input)
        : await proposePurchaseFulfillment(scope, input as Parameters<typeof proposePurchaseFulfillment>[1]);
      if (!mounted.current || activeScope.current !== submittedScope) return;
      setLedger(result);
      if (!decision) { setKind('cancel'); setReason(''); setQuantity(''); setReceiptId(''); setBucket('pending'); setReflected([]); }
      setDecision(null); setDecisionReason(''); attempt.current = null; onSaved?.();
    } catch (e) { if (mounted.current && activeScope.current === submittedScope) setError(e instanceof Error ? e.message : t('保存失败，请保留当前填写并重试')); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}><DialogContent aria-modal="true" closeDisabled={busy} onCloseAutoFocus={onCloseAutoFocus} className="horizon-theme horizon-portal proc-horizon-overlay fulfillment-drawer flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
    <DialogHeader className="shrink-0 border-b px-5 py-4"><DialogTitle>{t('订单行履约台账')}</DialogTitle><DialogDescription>{ledger ? `${ledger.line.orderNo} · ${t('第 {line} 行', { line: ledger.line.lineNo })} · ${ledger.line.name}` : t('取消、退货、冲销与检验可用数量')}</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      {loading ? <p role="status">{t('正在读取履约与收货证据…')}</p> : null}
      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {!loading && !ledger ? <Button onClick={() => setReload((n) => n + 1)}>{t('重新载入')}</Button> : null}
      {ledger ? <>
        <p className="text-xs leading-5 text-slate-500">{t('ERP 原值只读。本地实收不与 ERP 累计相加；退货保留补交需求，取消才减少订购义务。检验可用仅指已核对覆盖的合格净量，不代表可领库存。')}</p>
        <div className="fulfillment-ledger-grid">
          <section><h3>{t('ERP 累计原值')}</h3><dl><dt>{t('订购')}</dt><dd>{number(ledger.summary.erpOrderedQty)}</dd><dt>{t('已到')}</dt><dd>{number(ledger.summary.erpReceivedQty)}</dd></dl></section>
          <section><h3>{t('本地收货证据')}</h3><dl><dt>{t('登记实收')}</dt><dd>{number(ledger.summary.localGrossReceivedQty)}</dd><dt>{t('扣减后净实收')}</dt><dd>{number(ledger.summary.localNetReceivedQty)}</dd><dt>{t('本地合格净量')}</dt><dd>{number(ledger.summary.localQualifiedQty)}</dd></dl></section>
          <section><h3>{t('批准调整后')} · {ledger.line.unit}</h3><dl><dt>{t('净订购')}</dt><dd>{number(ledger.summary.effectiveOrderedQty)}</dd><dt>{t('净到货')}</dt><dd>{number(ledger.summary.effectiveReceivedQty)}</dd><dt>{t('剩余待交')}</dt><dd>{number(ledger.summary.remainingQty)}</dd><dt>{t('检验可用')}</dt><dd>{number(ledger.summary.qualifiedAvailableQty)}</dd></dl></section>
        </div>
        <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{t(ledger.summary.coverageComplete ? '覆盖已核对' : '覆盖待核对')}</strong><p className="mt-1 text-xs leading-5">{t('确认覆盖须核对全部本地收货对应 ERP 到货，并标记已在 ERP 反映的调整；数量、收货或检验变化后需重新确认。')}</p>{ledger.summary.issues.map((issue) => <p className="mt-1 text-xs text-amber-800" key={issue}>{t(issue)}</p>)}</div>
        {ledger.canPropose ? <fieldset disabled={busy} className="fulfillment-form rounded-xl border border-slate-200 p-4"><legend>{t('登记待确认事项')}</legend>
          <label>{t('事项')}<select value={kind} onChange={(e) => setKind(e.target.value as FulfillmentKind)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          {kind === 'return' || kind === 'reversal' ? <><label>{t('收货记录')}<select value={receiptId} onChange={(e) => setReceiptId(e.target.value)}><option value="">{t('选择送货单')}</option>{ledger.receiptOptions.map((r) => <option key={r.id} value={r.id}>{r.deliveryNo} · {r.receivedDate}</option>)}</select></label><label>{t('扣减哪类数量')}<select value={bucket} onChange={(e) => setBucket(e.target.value as FulfillmentBucket)}>{Object.entries(buckets).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label></> : null}
          {kind !== 'coverage' ? <label>{t('调整数量')} · {ledger.line.unit}<input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label> : <div><p className="mb-2 text-xs">{t('勾选已在当前 ERP 数量中反映的调整；未勾选的记录将在 ERP 原值上扣减。')}</p>{ledger.entries.filter((e) => e.status === 'approved' && e.kind !== 'coverage').map((entry) => <label className="flex-row items-center" key={entry.id}><input type="checkbox" checked={reflected.includes(entry.id)} onChange={(e) => setReflected((old) => e.target.checked ? [...old, entry.id] : old.filter((id) => id !== entry.id))} />{t(kinds[entry.kind])} {number(entry.quantity)} · {entry.reason}</label>)}</div>}
          <label className="sm:col-span-2">{t('依据与原因')}<textarea maxLength={2000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('例如取消协议、退货单或 ERP 核对依据')} /></label><Button type="button" disabled={busy || Boolean(decision) || !reason.trim()} onClick={() => void save()}>{t(busy ? '正在保存…' : '登记待确认')}</Button>
        </fieldset> : null}
        <section><h3 className="mb-3 text-sm font-semibold">{t('调整及审批历史')} · {ledger.entries.length}</h3>{!ledger.entries.length ? <p className="text-sm text-slate-500">{t('尚未登记履约调整。')}</p> : <ol className="space-y-3">{[...ledger.entries].reverse().map((entry) => <li key={entry.id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{t(kinds[entry.kind])}{entry.kind !== 'coverage' ? ` · ${number(entry.quantity)} ${ledger.line.unit}` : ''}</strong><span>{t(statuses[entry.status])}</span></div><p className="mt-2 break-words text-sm">{entry.reason}</p><div className="mt-2 space-y-1 text-xs text-slate-500">{entry.history.map((item, index) => <p key={`${item.at}-${index}`}>{item.actorName} · {item.at.replace('T', ' ').slice(0, 19)} · {t(item.action === 'proposed' ? '登记' : item.action === 'approved' ? '批准' : '撤销')} · {item.reason}</p>)}</div><div className="mt-3 flex flex-wrap gap-2">{entry.status === 'pending' && ledger.canApprove ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDecision({ id: entry.id, action: 'approve' }); setDecisionReason(''); }}>{t('审核批准')}</Button> : null}{entry.status !== 'revoked' && ledger.canPropose && (entry.status === 'pending' || ledger.canApprove) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDecision({ id: entry.id, action: 'revoke' }); setDecisionReason(''); }}>{t('撤销记录')}</Button> : null}</div>{decision?.id === entry.id ? <div className="fulfillment-form mt-3 border-t pt-3"><label>{t('本次审核依据')}<textarea rows={2} disabled={busy} value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} /></label><div className="flex gap-2"><Button disabled={busy || !decisionReason.trim()} onClick={() => void save()}>{t(decision.action === 'approve' ? '确认批准' : '确认撤销')}</Button><Button disabled={busy} variant="outline" onClick={() => setDecision(null)}>{t('取消')}</Button></div></div> : null}</li>)}</ol>}</section>
        <section><h3 className="mb-2 text-sm font-semibold">{t('受影响备货计划 · 实时重算')}</h3>{!ledger.canReadAffectedPlans ? <p className="text-xs text-slate-500">{t('当前账号没有查看备货计划的权限。')}</p> : !ledger.affectedPlans.length ? <p className="text-xs text-slate-500">{t('该订单行尚未明确关联备货计划。')}</p> : ledger.affectedPlans.map((plan) => <div key={plan.id} className="mb-2 rounded-lg border p-3"><p className="text-sm font-medium">{plan.code} · {plan.name}</p><p className="mt-2 text-sm">{t('仍需采购')} {number(plan.remainingToPurchaseQty)} · {t('仍需到货')} {number(plan.remainingToReceiveQty)} · {t('检验可用')} {number(plan.qualifiedQty)} {plan.unit}</p>{plan.issues.map((issue) => <p className="mt-1 text-xs text-amber-800" key={issue}>{t(issue)}</p>)}</div>)}</section>
      </> : null}
    </div><div className="flex shrink-0 justify-end gap-2 border-t p-4"><Button variant="outline" disabled={busy} onClick={() => setReload((n) => n + 1)}>{t('重新核对来源')}</Button><Button disabled={busy} onClick={requestClose}>{t('关闭')}</Button></div>
  </DialogContent></Dialog>
  <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent onCloseAutoFocus={(event) => { if (!discarded.current && closeOrigin.current?.isConnected) { event.preventDefault(); closeOrigin.current.focus(); } }}><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的填写内容？')}</AlertDialogTitle><AlertDialogDescription>{t('当前调整或审核依据尚未保存。已登记和已批准的历史记录不受影响。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { if (busyRef.current || !mounted.current) return; discarded.current = true; setDiscardOpen(false); onClose(); }}>{t('放弃草稿')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
