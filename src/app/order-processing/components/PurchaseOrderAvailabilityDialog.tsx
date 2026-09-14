import { useRef, useState, type FormEvent } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { AutoTranslatedText } from '../../components/TranslatableText';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { usePermission } from '../../hooks/usePermission';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { orderProcessingApi, OrderProcessingRequestError, type PurchaseOrderLine } from '../../lib/orderProcessingApi';

function calendarDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function availabilityConfirmedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(i18nLocale()) : '—';
}

export function PurchaseOrderAvailabilityDialog({ orderId, orderNo, line, onClose, onSaved, onCloseAutoFocus }: {
  orderId: string;
  orderNo: string;
  line: PurchaseOrderLine;
  onClose: () => void;
  onSaved: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  const canView = usePermission('page:purchase-order-detail');
  const canConfirm = usePermission('proc-purchase-order:confirm-availability') && canView;
  const [source, setSource] = useState(line);
  const [availableDate, setAvailableDate] = useState(line.availability?.availableDate ?? '');
  const [note, setNote] = useState(line.availability?.note ?? '');
  const [busy, setBusy] = useState<'save' | 'reload' | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<'date' | 'note' | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const etaDate = calendarDate(source.etaDate);
  const existing = source.availability;
  const sourceKnown = Boolean(source.id && source.sourceUpdatedAt && Number.isFinite(Date.parse(source.sourceUpdatedAt)));
  const isRevocation = !availableDate && Boolean(existing);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !canConfirm || !sourceKnown || needsReload) return;
    setError('');
    setFieldError(null);
    setNotice('');
    if (availableDate && !calendarDate(availableDate)) {
      setFieldError('date');
      setError(t('请选择有效的预计检验后可用日期。'));
      return;
    }
    if (availableDate && etaDate && availableDate < etaDate) {
      setFieldError('date');
      setError(t('预计检验后可用日期不能早于本行预计到货日期 {date}。', { date: etaDate }));
      return;
    }
    if (!availableDate && !existing) {
      setFieldError('date');
      setError(t('请填写预计检验后可用日期，首次确认不能留空。'));
      return;
    }
    if (!availableDate && !note.trim()) {
      setFieldError('note');
      setError(t('撤销日期确认时，请填写原因。'));
      return;
    }
    inFlight.current = true;
    setBusy('save');
    try {
      await orderProcessingApi.confirmPurchaseOrderAvailability(orderId, source.id, {
        availableDate: availableDate || null,
        note: note.trim(),
        expectedVersion: existing?.version ?? 0,
        expectedSourceUpdatedAt: source.sourceUpdatedAt,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('预计检验后可用日期保存失败，请重试。'));
      if (cause instanceof OrderProcessingRequestError && cause.status === 409) setNeedsReload(true);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function reloadSource() {
    if (inFlight.current || !canView) return;
    inFlight.current = true;
    setBusy('reload');
    setNotice('');
    try {
      const { order } = await orderProcessingApi.getPurchaseOrder(orderId);
      const latest = order.items?.find((item) => item.id === line.id);
      if (!latest) {
        setNeedsReload(true);
        setError(t('当前订单行已不可用，请关闭弹窗并重新加载订单。草稿仍保留在此处。'));
        return;
      }
      setSource(latest);
      setNeedsReload(false);
      setError('');
      setFieldError(null);
      setNotice(t('已载入最新订单来源和确认记录；你填写的日期与备注已保留，请核对后保存。'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('重新载入失败，草稿已保留。'));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose(); }}>
    <DialogContent closeDisabled={Boolean(busy)} onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault(); }}
      onInteractOutside={(event) => { if (inFlight.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{t('确认预计检验后可用日期')}</DialogTitle>
        <DialogDescription>{t('按订单行人工确认检验或处置完成后预计可用的日期；确认日期不会增加当前库存。')}</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="min-w-0 space-y-4" aria-busy={Boolean(busy)} noValidate>
        <section aria-label={t('订单行来源')} className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
          <p className="break-words text-sm font-medium text-foreground"><AutoTranslatedText text={source.name} /></p>
          <p className="mt-1 break-all text-xs leading-5 text-muted-foreground tabular-nums">{orderNo} · {t('行号')} {source.lineNo || '—'} · {source.sku || t('料号待确认')}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-muted-foreground">{t('预计到货')}</dt><dd className="mt-1 font-medium tabular-nums">{etaDate || t('待确认')}</dd></div>
            <div><dt className="text-muted-foreground">{t('采购 / 已到货')}</dt><dd className="mt-1 break-words font-medium tabular-nums">{source.qty} / {source.receivedQty} {source.unit}</dd></div>
          </dl>
          {!etaDate ? <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t('本行尚无预计到货日期，请结合供应商承诺及检验安排确认。')}</p> : null}
          {existing ? <div className="mt-3 border-t border-border pt-3 text-xs leading-5">
            <p className="text-pretty"><span className="text-muted-foreground">{t('当前确认记录')}：</span><span className="font-medium tabular-nums">{existing.availableDate || t('已撤销日期确认')}</span></p>
            <p className="break-words text-muted-foreground">{existing.confirmedByName || t('未记录确认人')} · <span className="tabular-nums">{availabilityConfirmedAt(existing.confirmedAt)}</span></p>
            {existing.note ? <p className="mt-1 whitespace-pre-wrap break-words text-pretty text-muted-foreground">{existing.note}</p> : null}
            {existing.needsReconfirmation ? <p className="mt-1 text-pretty font-medium text-amber-700">{t('订单来源已变化，需要重新确认可用日期。')}</p> : null}
          </div> : null}
        </section>
        <div className="space-y-1.5">
          <Label htmlFor="purchase-line-available-date">{t('预计检验后可用日期')}</Label>
          <Input id="purchase-line-available-date" type="date" value={availableDate} min={etaDate || undefined}
            aria-invalid={fieldError === 'date'} aria-describedby={fieldError === 'date' ? 'purchase-availability-error' : 'purchase-availability-date-help'}
            disabled={Boolean(busy) || !canConfirm} className="min-w-0 tabular-nums"
            onChange={(event) => setAvailableDate(event.target.value)} />
          <p id="purchase-availability-date-help" className="text-pretty text-xs leading-5 text-muted-foreground">{t(existing ? '清空日期并填写原因，可撤销当前日期确认。' : '首次确认请自行选择日期，预计到货日期未自动作为可用日期。')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="purchase-line-availability-note">{t(isRevocation ? '撤销原因（必填）' : '确认说明')}</Label>
          <Textarea id="purchase-line-availability-note" value={note} maxLength={1000}
            aria-invalid={fieldError === 'note'} aria-describedby={fieldError === 'note' ? 'purchase-availability-error' : undefined}
            disabled={Boolean(busy) || !canConfirm} placeholder={t('记录供应商承诺、检验安排或调整原因')}
            onChange={(event) => setNote(event.target.value)} className="min-h-24 resize-y" />
        </div>
        {!sourceKnown ? <p role="alert" className="text-pretty text-sm text-amber-700">{t('订单行来源信息不完整，请重新载入后确认。')}</p> : null}
        {!canConfirm ? <p role="status" className="text-pretty text-sm text-muted-foreground">{t('当前没有日期确认权限，可查看已有确认记录。')}</p> : null}
        {error ? <p id="purchase-availability-error" role="alert" className="text-pretty text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-pretty text-sm text-muted-foreground">{notice}</p> : null}
        <DialogFooter>
          {(needsReload || !sourceKnown) && canView ? <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void reloadSource()}>
            <RefreshCw className="size-4" aria-hidden="true" />{t(busy === 'reload' ? '正在载入…' : '重新载入订单来源')}
          </Button> : null}
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          {canConfirm ? <Button type="submit" disabled={Boolean(busy) || !sourceKnown || needsReload}>
            {busy === 'save' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t(busy === 'save' ? '保存中…' : isRevocation ? '撤销日期确认' : '保存确认')}
          </Button> : null}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
