import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, PackageCheck, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { cn } from '../../components/ui/utils';
import { usePermission } from '../../hooks/usePermission';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { getReceiptQualityOptions, createPurchaseInspection, createPurchaseReceipt, getPurchaseReceipts, PurchaseReceiptRequestError, type PurchaseReceipt, type PurchaseReceiptLedger } from '../../lib/purchaseReceiptApi';
import './purchase-receipt-drawer.css';

const PAGE_SIZE = 10;
type Draft = {
  scope: string; mode: 'receive' | 'inspect'; receiptId: string; deliveryNo: string; date: string;
  receivedQty: string; qualifiedQty: string; defectiveQty: string; pendingJudgmentQty: string;
  basis: string; note: string; expectedSourceUpdatedAt: string; expectedVersion: number;
  treeNodeId: string; initial: string;
};

function chinaToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function validDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function quantity(value: string) {
  return value.trim() && /^\d+(?:\.\d{1,3})?$/.test(value.trim()) ? Number(value) : NaN;
}
function numberLabel(value: number) {
  return Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
}
function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale()) : '—';
}
function draftValues(draft: Draft) {
  return JSON.stringify([draft.deliveryNo, draft.date, draft.receivedQty, draft.qualifiedQty, draft.defectiveQty, draft.pendingJudgmentQty, draft.basis, draft.note, draft.treeNodeId]);
}

export function PurchaseReceiptDrawer({ lineId, orderNo, onClose, onCloseAutoFocus }: {
  lineId: string; orderNo: string; onClose: () => void; onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canView = usePermission('page:purchase-order-detail');
  const receivePermission = usePermission('proc-purchase-order:receive');
  const inspectPermission = usePermission('proc-purchase-order:inspect');
  const scope = JSON.stringify([lineId, orderNo, user?.id, canView, receivePermission, inspectPermission]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sequence = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const retryIdentity = useRef<{ key: string; requestId: string } | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const [loaded, setLoaded] = useState<{ scope: string; value: PurchaseReceiptLedger } | null>(null);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedNotice, setSavedNotice] = useState(0);
  const [draftState, setDraft] = useState<Draft | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [qualityNodes, setQualityNodes] = useState<Array<{ id: string; productId: string; name: string; parentId: string | null }>>([]);
  const [qualityLoadError, setQualityLoadError] = useState('');
  useEffect(() => {
    if (draftState?.mode !== 'inspect') return;
    const abort = new AbortController(); setQualityLoadError('');
    getReceiptQualityOptions(lineId, abort.signal).then(rows => { if (!abort.signal.aborted) setQualityNodes(rows); }).catch(cause => { if (!abort.signal.aborted) setQualityLoadError(cause instanceof Error ? cause.message : '质量归属读取失败'); });
    return () => abort.abort();
  }, [lineId, draftState?.mode]);
  const data = loaded?.scope === scope ? loaded.value : null;
  const draft = draftState?.scope === scope ? draftState : null;
  const selectedReceipt = draft?.mode === 'inspect' ? data?.receipts.find((receipt) => receipt.id === draft.receiptId) : undefined;
  const sourceKnown = Boolean(data?.line.updatedAt && Number.isFinite(Date.parse(data.line.updatedAt)));
  const mixedUnits = Boolean(data && new Set(data.receipts.map((receipt) => receipt.source.unit)).size > 1);
  const canReceive = Boolean(canView && receivePermission && data?.canReceive && !data.sourceIssue && sourceKnown && !mixedUnits);
  const canInspect = Boolean(canView && inspectPermission && data?.canInspect && !data.sourceIssue && sourceKnown && !mixedUnits);
  const dirty = Boolean(draft && draftValues(draft) !== draft.initial);
  const pageCount = Math.max(1, Math.ceil((data?.receipts.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = data?.receipts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) ?? [];
  const remainingCanReceive = data ? Math.max(0, Math.round(((data.fulfillment ? data.fulfillment.effectiveOrderedQty ?? 0 : data.line.orderedQty) - (data.fulfillment?.localNetReceivedQty ?? data.summary.receivedQty)) * 1000) / 1000) : 0;
  const formDisabled = Boolean(busy || needsReload || reviewRequired || !data || (draft?.mode === 'receive' ? !canReceive : !canInspect || !selectedReceipt || selectedReceipt.sourceChanged));

  function checked(value: PurchaseReceiptLedger) {
    if (!value?.line || value.line.id !== lineId || value.line.orderNo !== orderNo || !Array.isArray(value.receipts)) {
      throw new Error(t('订单行关联已变化，请关闭后重新打开收货检验。'));
    }
    return value;
  }

  async function load(preserveDraft = false) {
    if (!canView || currentScope.current !== scope || inFlight.current) return;
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    const requestSequence = ++sequence.current;
    setBusy('read');
    setError('');
    setNotice('');
    try {
      const value = checked(await getPurchaseReceipts(lineId, controller.signal));
      if (controller.signal.aborted || currentScope.current !== scope || sequence.current !== requestSequence) return;
      setLoaded({ scope, value });
      setNeedsReload(false);
      if (preserveDraft && draft) {
        setReviewRequired(true);
        setNotice(t('最新收货和检验记录已载入。草稿已保留，请核对本批数量及订单来源后继续。'));
      }
    } catch (cause) {
      if (controller.signal.aborted || currentScope.current !== scope || sequence.current !== requestSequence) return;
      setError(cause instanceof Error ? cause.message : t('收货检验读取失败，请重试。'));
      setNeedsReload(true);
    } finally {
      if (!controller.signal.aborted && currentScope.current === scope && sequence.current === requestSequence) setBusy(null);
    }
  }

  useEffect(() => {
    setLoaded(null); setDraft(null); setPage(1); setError(''); setNotice(''); setSavedNotice(0);
    setNeedsReload(false); setReviewRequired(false); setDiscardOpen(false); setBusy(null);
    inFlight.current = false;
    retryIdentity.current = null; pendingAction.current = null;
    void load();
    return () => { readAbort.current?.abort(); sequence.current += 1; };
    // A scope change must invalidate reads and drafts for the former line or account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!draft) return;
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    firstFieldRef.current?.focus({ preventScroll: true });
  }, [draft?.mode, draft?.receiptId, scope]);

  useEffect(() => {
    if (!savedNotice) return;
    noticeRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    noticeRef.current?.focus({ preventScroll: true });
  }, [savedNotice]);

  function perform(action: () => void) {
    if (inFlight.current || currentScope.current !== scope) return;
    if (dirty) { pendingAction.current = action; setDiscardOpen(true); }
    else action();
  }
  function openForm(mode: 'receive' | 'inspect', receipt?: PurchaseReceipt) {
    if (!data || busy || currentScope.current !== scope || (mode === 'receive' ? !canReceive : !canInspect || !receipt || receipt.sourceChanged)) return;
    perform(() => {
      const next: Draft = { scope, mode, receiptId: receipt?.id ?? '', deliveryNo: '', date: chinaToday(), receivedQty: '',
        qualifiedQty: String(receipt?.qualifiedQty ?? 0), defectiveQty: String(receipt?.defectiveQty ?? 0), pendingJudgmentQty: String(receipt?.pendingJudgmentQty ?? 0),
        basis: receipt?.inspections[0]?.basis ?? '', note: '', expectedSourceUpdatedAt: data.line.updatedAt, expectedVersion: receipt?.version ?? 0, treeNodeId: '', initial: '' };
      next.initial = draftValues(next);
      setDraft(next); setError(''); setNotice(''); setReviewRequired(false);
      retryIdentity.current = null;
    });
  }
  function change(field: keyof Draft, value: string) {
    setDraft((old) => old?.scope === scope ? { ...old, [field]: value } : old);
    setError(''); setNotice('');
  }
  function reviewed() {
    if (!draft || !data || busy || currentScope.current !== scope || (draft.mode === 'receive' ? !canReceive : !canInspect || !selectedReceipt || selectedReceipt.sourceChanged)) return;
    setDraft({ ...draft, expectedSourceUpdatedAt: data.line.updatedAt, expectedVersion: selectedReceipt?.version ?? 0 });
    setReviewRequired(false); setNotice(t('请确认草稿中的本批累计数量，再保存记录。'));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !data || formDisabled || inFlight.current || currentScope.current !== scope) return;
    setError(''); setNotice('');
    if (!validDate(draft.date) || draft.date > chinaToday()) { setError(t('请填写有效日期，不能晚于今天。')); return; }
    const receivedQty = quantity(draft.receivedQty);
    const qualifiedQty = quantity(draft.qualifiedQty);
    const defectiveQty = quantity(draft.defectiveQty);
    const pendingJudgmentQty = quantity(draft.pendingJudgmentQty);
    if (draft.mode === 'receive') {
      if (!draft.deliveryNo.trim()) { setError(t('请填写送货单号。')); return; }
      if (draft.deliveryNo.trim().length > 120) { setError(t('送货单号不能超过 120 个字符。')); return; }
      if (!Number.isFinite(receivedQty) || receivedQty <= 0) { setError(t('实收数量须大于 0，最多保留 3 位小数。')); return; }
      if (receivedQty > remainingCanReceive + 0.0000001) { setError(t('本批实收数量不能超过剩余可登记量 {qty} {unit}。', { qty: numberLabel(remainingCanReceive), unit: data.line.unit })); return; }
    } else {
      if (!selectedReceipt || draft.date < selectedReceipt.receivedDate) { setError(t('检验日期不能早于本批收货日期。')); return; }
      if ([qualifiedQty, defectiveQty, pendingJudgmentQty].some((value) => !Number.isFinite(value) || value < 0)) { setError(t('请填写不小于 0 的检验数量，最多保留 3 位小数。')); return; }
      if (qualifiedQty + defectiveQty + pendingJudgmentQty > selectedReceipt.receivedQty + 0.0000001) { setError(t('合格、不良和待判定数量合计不能超过本批实收数量。')); return; }
      if (!draft.basis.trim()) { setError(t('请填写检验依据。')); return; }
      if (!draft.note.trim()) { setError(t('请填写检验结论说明。')); return; }
    }
    const payload = draft.mode === 'receive'
      ? { expectedSourceUpdatedAt: draft.expectedSourceUpdatedAt, deliveryNo: draft.deliveryNo.trim(), receivedDate: draft.date, receivedQty, note: draft.note.trim() }
      : { expectedVersion: draft.expectedVersion, expectedSourceUpdatedAt: draft.expectedSourceUpdatedAt, treeNodeId: draft.treeNodeId || undefined, inspectionDate: draft.date, qualifiedQty, defectiveQty, pendingJudgmentQty, basis: draft.basis.trim(), note: draft.note.trim() };
    const key = JSON.stringify([scope, draft.mode, draft.receiptId, payload]);
    if (retryIdentity.current?.key !== key) retryIdentity.current = { key, requestId: crypto.randomUUID() };
    const requestId = retryIdentity.current.requestId;
    inFlight.current = true;
    readAbort.current?.abort();
    const requestSequence = ++sequence.current;
    setBusy('save');
    try {
      const value = checked(draft.mode === 'receive'
        ? await createPurchaseReceipt(lineId, { ...payload, requestId } as Parameters<typeof createPurchaseReceipt>[1])
        : await createPurchaseInspection(lineId, draft.receiptId, { ...payload, requestId } as Parameters<typeof createPurchaseInspection>[2]));
      if (currentScope.current !== scope || sequence.current !== requestSequence) return;
      setLoaded({ scope, value }); setDraft(null); retryIdentity.current = null;
      setPage(1); setNotice(t(draft.mode === 'receive' ? '收货已登记，数量已计入本台账。' : '检验结果已记录，上一版结果保留在历史中。'));
      setSavedNotice((count) => count + 1);
    } catch (cause) {
      if (currentScope.current !== scope || sequence.current !== requestSequence) return;
      setError(cause instanceof Error ? cause.message : t('保存未能确认，请保留草稿并重试。'));
      if (cause instanceof PurchaseReceiptRequestError && cause.status === 409) setNeedsReload(true);
    } finally {
      if (currentScope.current === scope && sequence.current === requestSequence) { inFlight.current = false; setBusy(null); }
    }
  }

  const draftInspected = draft ? quantity(draft.qualifiedQty) + quantity(draft.defectiveQty) + quantity(draft.pendingJudgmentQty) : NaN;
  const draftRemaining = selectedReceipt && Number.isFinite(draftInspected) ? selectedReceipt.receivedQty - draftInspected : NaN;
  const renderField = (field: 'deliveryNo' | 'date' | 'receivedQty' | 'qualifiedQty' | 'defectiveQty' | 'pendingJudgmentQty' | 'basis', label: string, type: 'text' | 'date' | 'number' = 'text') => <div className="min-w-0 space-y-1.5">
    <Label htmlFor={`receipt-${field}`}>{t(label)}</Label>
    <Input id={`receipt-${field}`} value={draft?.[field] ?? ''} type={type} required disabled={formDisabled}
      ref={(draft?.mode === 'receive' && field === 'deliveryNo') || (draft?.mode === 'inspect' && field === 'date') ? firstFieldRef : undefined}
      inputMode={type === 'number' ? 'decimal' : undefined} min={type === 'number' ? 0 : type === 'date' && selectedReceipt ? selectedReceipt.receivedDate : undefined}
      max={type === 'date' ? chinaToday() : field === 'receivedQty' ? remainingCanReceive : undefined} step={type === 'number' ? '0.001' : undefined}
      maxLength={field === 'deliveryNo' ? 120 : field === 'basis' ? 2000 : undefined}
      onChange={(event) => change(field, event.target.value)} className={cn('min-w-0', type !== 'text' && 'tabular-nums')} />
  </div>;

  return <>
    <Sheet open onOpenChange={(open) => { if (!open) perform(onClose); }}>
      <SheetContent side="right" className="proc-horizon-drawer purchase-receipt-drawer w-full gap-0 overflow-hidden p-0 sm:max-w-6xl" closeDisabled={busy === 'save'} onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault(); }}
        onInteractOutside={(event) => { if (inFlight.current) event.preventDefault(); }}>
        <SheetHeader className="border-b border-border px-5 py-4 pr-16">
          <SheetTitle className="text-balance text-lg">{t('收货与检验')}</SheetTitle>
          <SheetDescription className="break-all text-pretty tabular-nums">{orderNo}{data ? ` · ${t('行号')} ${data.line.lineNo}` : ''}</SheetDescription>
        </SheetHeader>
        <div className="purchase-receipt-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {!canView ? <p role="status" className="text-pretty text-sm text-muted-foreground">{t('当前没有采购订单详情查看权限。')}</p> : null}
          {canView && !data && busy === 'read' ? <div aria-label={t('正在读取收货检验')} role="status" className="space-y-4"><div className="h-24 rounded-lg bg-muted" /><div className="h-40 rounded-lg bg-muted" /><span className="sr-only">{t('正在读取收货检验…')}</span></div> : null}
          {!draft && error ? <div role="alert" className="mb-4 space-y-2 rounded-lg border border-destructive/30 p-3"><p className="text-pretty text-sm text-destructive">{error}</p>{canView ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />{t('重新读取')}</Button> : null}</div> : null}
          {notice ? <p id="purchase-receipt-notice" ref={noticeRef} role="status" aria-atomic="true" tabIndex={-1} className="mb-4 scroll-mt-5 text-pretty text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{notice}</p> : null}
          {data ? <>
            <section aria-label={t('订单行来源')} className="mb-5 min-w-0 rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="break-words text-balance font-semibold">{data.line.inventoryName || t('物料名称未同步')}</h3>
              <p className="mt-1 break-words text-pretty text-sm text-muted-foreground"><span className="tabular-nums">{data.line.inventoryCode || t('料号待确认')}</span> · {data.line.spec || t('未提供规格')} · {data.line.supplierName || t('供应商未同步')}</p>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-muted-foreground">{t('订单数量')}</dt><dd className="mt-1 font-medium tabular-nums">{numberLabel(data.line.orderedQty)} {data.line.unit}</dd></div>
                <div><dt className="text-muted-foreground">{t('ERP 已收数量')}</dt><dd className="mt-1 font-medium tabular-nums">{numberLabel(data.line.erpReceivedQty)} {data.line.unit}</dd></div>
              </dl>
              {data.fulfillment ? <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs leading-5">
                <p>{t('履约台账：净订购')} {data.fulfillment.effectiveOrderedQty === null ? t('待核对') : numberLabel(data.fulfillment.effectiveOrderedQty)} · {t('本地净实收')} {numberLabel(data.fulfillment.localNetReceivedQty)} · {t('检验可用')} {data.fulfillment.qualifiedAvailableQty === null ? t('待核对') : numberLabel(data.fulfillment.qualifiedAvailableQty)} {data.line.unit}</p>
                <p className="mt-1 text-muted-foreground">{t('下方保留原始收货及累计检验记录。退货、冲销的批准扣减单独记入履约台账，补交上限使用净实收。')}</p>
                {data.fulfillment.issues.map((issue) => <p className="mt-1 text-amber-800" key={issue}>{t(issue)}</p>)}
              </div> : null}
              {data.sourceIssue ? <p role="alert" className="mt-3 text-pretty text-sm text-destructive">{data.sourceIssue}</p> : !sourceKnown ? <p role="alert" className="mt-3 text-pretty text-sm text-destructive">{t('订单来源时间缺失，请重新读取后核对。')}</p> : null}
            </section>
            <div className="purchase-receipt-layout">
              <main className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-balance font-semibold"><PackageCheck className="size-4 text-primary" aria-hidden="true" />{t('分批收货')}</h3>
                  <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void load(Boolean(draft))}><RefreshCw className="size-4" aria-hidden="true" />{t(busy === 'read' ? '读取中…' : '刷新记录')}</Button>
                    {canReceive ? <Button size="sm" disabled={Boolean(busy)} onClick={() => openForm('receive')}><Plus className="size-4" aria-hidden="true" />{t('登记收货')}</Button> : null}</div>
                </div>
                {data.receipts.length ? <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <p className="tabular-nums">{t('第 {page} / {pages} 页，共 {count} 批', { page: currentPage, pages: pageCount, count: data.receipts.length })}</p>
                    <div className="flex gap-1"><Button size="icon" variant="outline" className="size-8" aria-label={t('上一页收货记录')} disabled={currentPage <= 1 || Boolean(busy)} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button><Button size="icon" variant="outline" className="size-8" aria-label={t('下一页收货记录')} disabled={currentPage >= pageCount || Boolean(busy)} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button></div>
                  </div>
                  <ul className="space-y-3" aria-label={t('收货批次')}>
                    {rows.map((receipt) => <li key={receipt.id} className={cn('min-w-0 rounded-lg border p-4', selectedReceipt?.id === receipt.id ? 'border-primary bg-accent/30' : 'border-border')}>
                      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-all text-balance text-sm font-semibold">{receipt.deliveryNo}</h4><p className="mt-1 text-xs text-muted-foreground tabular-nums">{receipt.receivedDate} · {t('实收')} {numberLabel(receipt.receivedQty)} {receipt.source.unit || t('单位待确认')}</p></div>
                        {canInspect ? <Button size="sm" variant="outline" disabled={Boolean(busy) || receipt.sourceChanged} onClick={() => openForm('inspect', receipt)} aria-label={t('记录检验结果：{deliveryNo}', { deliveryNo: receipt.deliveryNo })}><ClipboardCheck className="size-4" aria-hidden="true" />{t('记录检验结果')}</Button> : null}</div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                        {[['合格', receipt.qualifiedQty], ['不良', receipt.defectiveQty], ['待判定', receipt.pendingJudgmentQty], ['未检验', receipt.pendingQty]].map(([label, amount]) => <div key={label}><dt className="text-muted-foreground">{t(String(label))}</dt><dd className="mt-1 font-medium tabular-nums">{numberLabel(Number(amount))}</dd></div>)}
                      </dl>
                      <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">{t('收货登记')}：{receipt.createdByName || t('未记录经办人')} · <span className="tabular-nums">{timeLabel(receipt.createdAt)}</span></p>
                      {receipt.note ? <p className="mt-1 whitespace-pre-wrap break-words text-pretty text-xs leading-5 text-muted-foreground">{receipt.note}</p> : null}
                      {receipt.sourceChanged ? <div className="mt-2 space-y-2"><p role="status" className="text-pretty text-xs text-destructive">{t('订单物料或单位已变化，本批仅供查看，暂不能记录检验结果。')}</p><details className="text-xs leading-5"><summary className="cursor-pointer font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">{t('查看登记时的订单来源')}</summary><dl className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3">
                        {[[t('物料编码'), receipt.source.inventoryCode], [t('物料名称'), receipt.source.inventoryName], [t('规格'), receipt.source.spec], [t('原单位'), receipt.source.unit], [t('供应商'), receipt.source.supplierName], [t('原订单行'), `${receipt.source.orderNo} · ${receipt.source.lineNo}`]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words tabular-nums">{value || '—'}</dd></div>)}
                      </dl><p className="mt-2 text-pretty text-muted-foreground">{t('以上实收及检验数量均按登记时的原单位展示。')}</p></details></div> : null}
                      {receipt.inspections.length ? <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">{t('检验历史')} <span className="tabular-nums">({receipt.inspections.length})</span></summary>
                        <ol className="mt-3 space-y-3">{receipt.inspections.map((inspection) => <li key={inspection.id} className="border-l-2 border-border pl-3 text-xs leading-5">
                          <p className="font-medium tabular-nums">{t('第 {version} 版', { version: inspection.version })} · {inspection.inspectionDate}</p>
                          <p className="text-muted-foreground">{t('本批累计数量')} · {receipt.source.unit || t('单位待确认')}</p>
                          <p className="text-pretty tabular-nums">{t('合格 {good} · 不良 {bad} · 待判定 {judgment} · 未检验 {pending}', { good: numberLabel(inspection.qualifiedQty), bad: numberLabel(inspection.defectiveQty), judgment: numberLabel(inspection.pendingJudgmentQty), pending: numberLabel(inspection.pendingQty) })}</p>
                          <p className="break-words text-pretty">{t('检验依据')}：{inspection.basis}</p>
                          {inspection.note ? <p className="whitespace-pre-wrap break-words text-pretty text-muted-foreground">{inspection.note}</p> : null}
                          <p className="break-words text-muted-foreground">{inspection.createdByName || t('未记录检验人')} · <span className="tabular-nums">{timeLabel(inspection.createdAt)}</span></p>
                        </li>)}</ol>
                      </details> : <p className="mt-2 text-pretty text-xs text-muted-foreground">{t('尚未记录检验结果')}</p>}
                    </li>)}
                  </ul>
                </> : <div className="rounded-lg border border-dashed border-border p-6 text-center"><p className="text-pretty text-sm font-medium">{t('本订单行尚未登记收货')}</p><p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t(canReceive ? '使用右上方“登记收货”，按送货单记录本批实收数量。' : '收货登记后，可在这里查看每批数量与检验记录。')}</p></div>}
              </main>
              <aside className="purchase-receipt-aside min-w-0 space-y-4" aria-label={t('台账汇总与登记')}>
                <section className="rounded-lg border border-border p-4"><h3 className="text-balance text-sm font-semibold">{t('本台账汇总')}</h3>{mixedUnits ? <p role="status" className="mt-3 text-pretty text-sm text-muted-foreground">{t('历史批次存在不同单位，请逐批核对数量，暂不合计。')}</p> : <dl className="mt-3 grid grid-cols-2 gap-4 text-xs">
                  {[['本台账实收', data.summary.receivedQty], ['未检验', data.summary.pendingQty], ['合格', data.summary.qualifiedQty], ['不良', data.summary.defectiveQty], ['待判定', data.summary.pendingJudgmentQty]].map(([label, amount]) => <div key={label}><dt className="text-muted-foreground">{t(String(label))}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{numberLabel(Number(amount))} <span className="text-xs font-normal text-muted-foreground">{data.summaryUnit || t('单位待确认')}</span></dd></div>)}
                </dl>}<p className="mt-3 border-t border-border pt-3 text-pretty text-xs leading-5 text-muted-foreground">{t('本台账不增加库存，ERP 同步数量单独核对。')}</p></section>
                {draft ? <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy === 'save'} className="min-w-0 scroll-mt-5 rounded-lg border border-primary/30 p-4">
                  <h3 className="text-balance font-semibold">{t(draft.mode === 'receive' ? '登记收货' : '记录检验结果')}</h3>
                  {draft.mode === 'receive' ? <div className="mt-2 space-y-1 text-pretty text-xs leading-5 text-muted-foreground"><p>{t('本台账剩余可登记量')}：<span className="font-medium tabular-nums">{numberLabel(remainingCanReceive)} {data.line.unit}</span></p><p>{t('收货记录保存后不可直接修改，请核对单号、数量与日期。')}</p></div> : null}
                  {draft.mode === 'inspect' && selectedReceipt ? <div className="mt-2 text-xs leading-5"><p className="break-all font-medium">{selectedReceipt.deliveryNo} · <span className="tabular-nums">{t('实收')} {numberLabel(selectedReceipt.receivedQty)} {selectedReceipt.source.unit || t('单位待确认')}</span></p><p className="mt-1 text-pretty text-muted-foreground">{t('填写本批累计数量，将替换当前结果，历史保留。')}</p></div> : null}
                  <div className="mt-4 space-y-3">
                    {draft.mode === 'receive' ? <>{renderField('deliveryNo', '送货单号')}{renderField('receivedQty', '本批实收数量', 'number')}{renderField('date', '收货日期', 'date')}</> : <>
                      {renderField('date', '检验日期', 'date')}
                      <div className="grid grid-cols-2 gap-3">{renderField('qualifiedQty', '合格数量', 'number')}{renderField('defectiveQty', '不良数量', 'number')}{renderField('pendingJudgmentQty', '待判定数量', 'number')}<div className="space-y-1.5"><p className="text-sm font-medium">{t('未检验数量')}</p><p className={cn('rounded-md bg-muted px-3 py-2 text-sm tabular-nums', draftRemaining < 0 && 'text-destructive')}>{numberLabel(draftRemaining)}</p></div></div>
                      {Number(draft.defectiveQty) > 0 && <div className="space-y-2"><Label htmlFor="receipt-quality-node">{t('不良所属产品与模块')}</Label><NativeSelect id="receipt-quality-node" required disabled={formDisabled} value={draft.treeNodeId} onChange={e => change('treeNodeId', e.target.value)}><option value="">{t('请选择')}</option>{qualityNodes.map(node => <option key={node.id} value={node.id}>{qualityNodes.find(root => root.productId === node.productId && !root.parentId)?.name} · {node.name}</option>)}</NativeSelect>{qualityLoadError && <p role="alert" className="text-sm text-destructive">{qualityLoadError}</p>}<p className="text-xs text-muted-foreground">{t('不良会关联原收货单生成质量异常，后续在原异常处置和验证。')}</p></div>}
                      {renderField('basis', '检验依据')}
                    </>}
                    <div className="space-y-1.5"><Label htmlFor="receipt-note">{t(draft.mode === 'inspect' ? '检验结论说明（必填）' : '备注')}</Label><Textarea id="receipt-note" maxLength={2000} required={draft.mode === 'inspect'} value={draft.note} disabled={formDisabled} onChange={(event) => change('note', event.target.value)} className="min-h-24 resize-y" /></div>
                  </div>
                  {error ? <p id="purchase-receipt-error" role="alert" className="mt-3 text-pretty text-sm text-destructive">{error}</p> : null}
                  {needsReload ? <Button type="button" variant="outline" className="mt-3 w-full" disabled={Boolean(busy)} onClick={() => void load(true)}>{t('重新载入后核对')}</Button> : null}
                  {reviewRequired ? <Button type="button" variant="outline" className="mt-3 w-full" disabled={Boolean(busy) || (draft.mode === 'receive' ? !canReceive : !canInspect || !selectedReceipt || selectedReceipt.sourceChanged)} onClick={reviewed}>{t('已核对，继续填写')}</Button> : null}
                  {!needsReload && !reviewRequired && formDisabled && !busy ? <p role="status" className="mt-3 text-pretty text-xs text-muted-foreground">{t('当前权限或订单来源不支持保存，草稿仍保留。')}</p> : null}
                  <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy === 'save'} onClick={() => perform(() => { setDraft(null); setError(''); setReviewRequired(false); retryIdentity.current = null; })}>{t('取消填写')}</Button><Button type="submit" disabled={formDisabled}>{t(busy === 'save' ? '保存中…' : draft.mode === 'receive' ? '保存收货记录' : '保存检验结果')}</Button></div>
                </form> : !canReceive && !canInspect ? <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('当前可查看收货检验记录，登记操作需相应权限及有效订单来源。')}</p> : <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('先按送货单登记收货，再在对应批次记录检验结果。')}</p>}
              </aside>
            </div>
          </> : null}
        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={discardOpen} onOpenChange={(open) => { if (!open) pendingAction.current = null; setDiscardOpen(open); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('放弃未保存的填写内容？')}</AlertDialogTitle><AlertDialogDescription>{t('当前草稿尚未保存。已登记的收货和检验记录不受影响。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => { pendingAction.current = null; }}>{t('继续填写')}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction.current; pendingAction.current = null; setDiscardOpen(false); action?.(); }}>{t('放弃草稿')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
