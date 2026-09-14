import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ClipboardCheck, PackageCheck, ShieldAlert, Undo2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { dispositionLabels, type DispositionInput, type DispositionKind, type DispositionLimits, type DispositionReceipt } from '../receiptDispositionTypes';
import './receipt-disposition-form.css';

type Draft = Omit<DispositionInput, 'kind' | 'quantity'> & { quantity: string };
type FieldErrors = Partial<Record<keyof Draft | 'submit', string>>;
const FIELD_ORDER: (keyof Draft)[] = ['quantity', 'date', 'warehouse', 'location', 'documentNo', 'owner', 'expectedDate', 'reason', 'note'];

export interface ReceiptDispositionFormProps {
  receipt: DispositionReceipt;
  kind: DispositionKind;
  limits: DispositionLimits;
  onSubmit: (input: DispositionInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}

const MODE_ICONS = { correction: Undo2, inbound: PackageCheck, isolation: ShieldAlert, return: ClipboardCheck };
const WAREHOUSES: Record<'inbound' | 'isolation', Record<string, string[]>> = {
  inbound: { '原材料仓': ['A-01-01', 'A-01-02', 'A-02-01'], '备件仓': ['B-01-01', 'B-02-01'] },
  isolation: { '不合格品区': ['NG-01', 'NG-02'], '来料隔离区': ['IQC-01', 'IQC-02'] },
};

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function initialDraft(kind: DispositionKind, receipt: DispositionReceipt): Draft {
  return { quantity: kind === 'correction' ? String(receipt.receivedQty) : '', date: today(), reason: '', warehouse: '', location: '', documentNo: '', owner: '', returnMethod: 'return', expectedDate: '', note: '' };
}

function validDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsedQuantity(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) return NaN;
  const result = Number(trimmed);
  return Number.isFinite(result) && result <= Number.MAX_SAFE_INTEGER / 1000 ? result : NaN;
}

function roundQuantity(value: number) { return Math.round(value * 1000) / 1000; }

export function ReceiptDispositionForm({ receipt, kind, limits, onSubmit, onDirtyChange, onCancel }: ReceiptDispositionFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => initialDraft(kind, receipt));
  const cleanDraft = useRef(JSON.stringify(draft));
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const validationFocus = useRef<keyof Draft | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmation, setConfirmation] = useState<DispositionInput | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const quantity = parsedQuantity(draft.quantity);
  const max = kind === 'correction' ? limits.correctionMax : limits[kind];
  const min = kind === 'correction' ? Math.max(0.001, limits.correctionMin) : 0;
  const unavailable = !Number.isFinite(max) || !Number.isFinite(min) || max < min || (kind !== 'correction' && max <= 0);
  const Icon = MODE_ICONS[kind];
  const fieldId = (field: keyof Draft | 'submit') => `receipt-disposition-${field}`;
  const quantityLabel = kind === 'correction' ? t('纠正后实收数量') : kind === 'inbound' ? t('本次入库数量') : kind === 'isolation' ? t('本次隔离数量') : t('本次安排数量');
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
  const actionDescription = kind === 'correction' ? t('记录纠正后的实收数量和原因，保留原始登记。') : kind === 'inbound' ? t('填写本批合格品的入库安排和存放位置。') : kind === 'isolation' ? t('仅隔离已判定不良的数量，待判定数量继续保留。') : t('记录供应商退货或换补安排，便于继续跟进。');
  const balance = Number.isFinite(quantity) ? roundQuantity(max - quantity) : NaN;
  const warehouseOptions = kind === 'inbound' || kind === 'isolation' ? WAREHOUSES[kind] : undefined;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function focusField(field: keyof Draft) {
    const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'warehouse' ? { location: '' } : {}), ...(field === 'returnMethod' && value === 'return' ? { expectedDate: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined, ...(field === 'warehouse' ? { location: undefined } : {}), ...(field === 'returnMethod' ? { expectedDate: undefined } : {}) }));
    setSaved(false);
  }

  function validate(): DispositionInput | null {
    const next: FieldErrors = {};
    if (unavailable) next.quantity = t('当前没有可安排的数量，请选择其他批次或处置方式。');
    else if (!Number.isFinite(quantity) || quantity <= 0) next.quantity = t('请填写大于 0 的数量，最多保留 3 位小数。');
    else if (quantity < min || quantity > max) next.quantity = t('数量须在 {min} 至 {max} {unit}之间。', { min: numberLabel(min), max: numberLabel(max), unit: receipt.unit });
    else if (kind === 'correction' && roundQuantity(quantity - receipt.receivedQty) === 0) next.quantity = t('纠正后数量与当前实收相同，请填写需要改为的数量。');
    if (!validDate(draft.date) || draft.date < receipt.receivedDate || draft.date > today()) next.date = t('请填写收货日至今天之间的有效日期。');
    if (!draft.reason.trim()) next.reason = t('请填写本次处置原因。');
    else if (draft.reason.trim().length > 1000) next.reason = t('处置原因不能超过 1000 个字符。');
    if (draft.note.trim().length > 1000) next.note = t('备注不能超过 1000 个字符。');
    if (kind === 'inbound' || kind === 'isolation') {
      if (!warehouseOptions?.[draft.warehouse]) next.warehouse = t('请选择本次使用的仓库。');
      if (!warehouseOptions?.[draft.warehouse]?.includes(draft.location)) next.location = t('请选择该仓库下的库位。');
    }
    if (kind === 'inbound' || kind === 'return') {
      if (!draft.documentNo.trim()) next.documentNo = t('请填写关联单据号。');
      else if (draft.documentNo.trim().length > 120) next.documentNo = t('关联单据号不能超过 120 个字符。');
    }
    if (kind === 'isolation' || kind === 'return') {
      if (!draft.owner.trim()) next.owner = t('请填写跟进负责人。');
      else if (draft.owner.trim().length > 80) next.owner = t('负责人不能超过 80 个字符。');
    }
    if (kind === 'return' && draft.returnMethod === 'replacement' && (!validDate(draft.expectedDate) || draft.expectedDate < draft.date)) next.expectedDate = t('请填写不早于本次安排日期的预计补货日期。');
    setErrors(next);
    const firstInvalid = FIELD_ORDER.find((field) => next[field]);
    validationFocus.current = firstInvalid ?? null;
    if (firstInvalid) {
      // A confirmation must finish closing before focus can leave its focus trap.
      if (!confirmation) focusField(firstInvalid);
      return null;
    }
    return { kind, quantity, date: draft.date, reason: draft.reason.trim(), note: draft.note.trim(), warehouse: warehouseOptions ? draft.warehouse : '', location: warehouseOptions ? draft.location : '', documentNo: kind === 'inbound' || kind === 'return' ? draft.documentNo.trim() : '', owner: kind === 'isolation' || kind === 'return' ? draft.owner.trim() : '', returnMethod: kind === 'return' ? draft.returnMethod : 'return', expectedDate: kind === 'return' && draft.returnMethod === 'replacement' ? draft.expectedDate : '' };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const input = validate();
    if (input) setConfirmation(input);
  }

  async function confirm() {
    if (!confirmation || busyRef.current) return;
    const input = validate();
    if (!input) { setConfirmation(null); return; }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    try {
      await onSubmit(input);
      const next = initialDraft(kind, kind === 'correction' ? { ...receipt, receivedQty: input.quantity } : receipt);
      cleanDraft.current = JSON.stringify(next);
      setDraft(next);
      setConfirmation(null);
      setSaved(true);
      onDirtyChange?.(false);
    } catch (cause) {
      setConfirmation(null);
      setErrors({ submit: cause instanceof Error ? cause.message : t('演示记录未保存，请保留填写内容后重试。') });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const error = (field: keyof Draft) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const inputProps = (field: keyof Draft) => ({ id: fieldId(field), disabled: busy, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const textField = (field: 'documentNo' | 'owner', label: string, placeholder: string) => <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId(field)}>{label}<span className="text-destructive" aria-hidden="true"> *</span></Label><Input {...inputProps(field)} value={draft[field]} required maxLength={field === 'owner' ? 80 : 120} placeholder={placeholder} onChange={(event) => change(field, event.target.value)} />{error(field)}</div>;

  return <>
    <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="receipt-disposition-form-title" aria-busy={busy} className="receipt-disposition-form min-w-0 rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <h3 id="receipt-disposition-form-title" className="flex items-center gap-2 text-balance text-base font-semibold"><Icon aria-hidden="true" className="size-4 text-primary" />{t(dispositionLabels[kind])}</h3>
        <p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{actionDescription}</p>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5">
          {kind === 'correction' ? <><p>{t('当前实收')} <strong className="ml-1 font-semibold tabular-nums">{numberLabel(receipt.receivedQty)} {receipt.unit}</strong></p><p className="mt-1 text-pretty text-muted-foreground">{t('可改为 {min}–{max} {unit}；已分类数量须保留。', { min: numberLabel(min), max: numberLabel(max), unit: receipt.unit })}</p></> : <><p>{t(kind === 'inbound' ? '合格待入库' : kind === 'isolation' ? '不良待隔离' : '可安排退换补货')} <strong className="ml-1 font-semibold tabular-nums">{numberLabel(max)} {receipt.unit}</strong></p><p className="mt-1 text-pretty text-muted-foreground">{t(kind === 'return' ? '安排记录不会标记为已退回或补货已到货。' : kind === 'isolation' ? '待判定数量不计入本次可隔离量。' : '本次安排数量不得超过合格待入库量。')}</p></>}
        </div>
        {unavailable ? <div role="status" className="space-y-1 rounded-lg border border-border p-3"><p className="text-pretty text-sm">{t('本批当前没有可安排的数量。')}</p><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('请使用上方处置选项，选择其他方式。')}</p></div> : null}
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground">{t('本次填写')}<span className="ml-2 font-normal">{t('标 * 为必填')}</span></p>
          {kind === 'return' ? <div className="space-y-2"><Label id="receipt-disposition-method-label">{t('处置方式')}<span className="text-destructive" aria-hidden="true"> *</span></Label><RadioGroup id={fieldId('returnMethod')} value={draft.returnMethod} disabled={busy} onValueChange={(value) => change('returnMethod', value === 'replacement' ? 'replacement' : 'return')} aria-labelledby="receipt-disposition-method-label" className="grid grid-cols-2 gap-2">
            {(['return', 'replacement'] as const).map((method) => <Label key={method} htmlFor={`disposition-method-${method}`} className={cn('flex cursor-pointer items-center gap-2 rounded-md border p-3 text-xs', draft.returnMethod === method ? 'border-primary/40 bg-primary/5' : 'border-border', busy && 'cursor-not-allowed opacity-50')}><RadioGroupItem id={`disposition-method-${method}`} value={method} />{t(method === 'return' ? '退货安排' : '换货 / 补货安排')}</Label>)}
          </RadioGroup></div> : null}
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('quantity')}>{quantityLabel}<span className="text-destructive" aria-hidden="true"> *</span></Label><div className="relative min-w-0"><Input {...inputProps('quantity')} type="text" inputMode="decimal" required value={draft.quantity} placeholder="0.000" onChange={(event) => change('quantity', event.target.value)} className="min-w-0 pr-12 tabular-nums" aria-describedby={[errors.quantity ? `${fieldId('quantity')}-error` : '', 'receipt-disposition-quantity-hint'].filter(Boolean).join(' ')} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{receipt.unit}</span></div>{error('quantity')}<p id="receipt-disposition-quantity-hint" className="text-pretty text-xs leading-5 text-muted-foreground">{t('最多 3 位小数')}</p></div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('date')}>{t(kind === 'return' ? '安排日期' : '处置日期')}<span className="text-destructive" aria-hidden="true"> *</span></Label><Input {...inputProps('date')} type="date" min={receipt.receivedDate} max={today()} required value={draft.date} onChange={(event) => change('date', event.target.value)} className="min-w-0 tabular-nums" />{error('date')}</div>
          </div>
          {warehouseOptions ? <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('warehouse')}>{t(kind === 'isolation' ? '隔离仓库' : '入库仓库')}<span className="text-destructive" aria-hidden="true"> *</span></Label><Select value={draft.warehouse} onValueChange={(value) => change('warehouse', value)} disabled={busy}><SelectTrigger {...inputProps('warehouse')} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('选择仓库')} /></SelectTrigger><SelectContent>{Object.keys(warehouseOptions).map((warehouse) => <SelectItem key={warehouse} value={warehouse}>{t(warehouse)}</SelectItem>)}</SelectContent></Select>{error('warehouse')}</div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('location')}>{t('库位')}<span className="text-destructive" aria-hidden="true"> *</span></Label><Select value={draft.location} onValueChange={(value) => change('location', value)} disabled={busy || !draft.warehouse}><SelectTrigger {...inputProps('location')} disabled={busy || !draft.warehouse} aria-required="true" className="w-full min-w-0 tabular-nums"><SelectValue placeholder={t('选择库位')} /></SelectTrigger><SelectContent>{(warehouseOptions[draft.warehouse] ?? []).map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}</SelectContent></Select>{error('location')}</div>
          </div> : null}
          {kind === 'inbound' || kind === 'return' ? textField('documentNo', t(kind === 'inbound' ? '关联入库单号' : '关联退换补货单号'), t(kind === 'inbound' ? '填写入库单或安排单编号' : '填写供应商退换补货单编号')) : null}
          {kind === 'isolation' || kind === 'return' ? textField('owner', t('跟进负责人'), t('填写负责跟进的人员')) : null}
          {kind === 'return' ? <div className="min-w-0 space-y-1.5"><Label htmlFor="receipt-disposition-supplier">{t('供应商')}</Label><Input id="receipt-disposition-supplier" value={receipt.supplierName || t('未提供供应商')} readOnly className="bg-muted/40 text-muted-foreground" /></div> : null}
          {kind === 'return' && draft.returnMethod === 'replacement' ? <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('expectedDate')}>{t('预计补货日期')}<span className="text-destructive" aria-hidden="true"> *</span></Label><Input {...inputProps('expectedDate')} type="date" min={draft.date || receipt.receivedDate} required value={draft.expectedDate} onChange={(event) => change('expectedDate', event.target.value)} className="min-w-0 tabular-nums" />{error('expectedDate')}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('预计日期供跟进使用，实际到货后仍需收货检验。')}</p></div> : null}
          <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('reason')}>{t(kind === 'correction' ? '纠错原因' : '处置原因')}<span className="text-destructive" aria-hidden="true"> *</span></Label><Textarea {...inputProps('reason')} required maxLength={1000} value={draft.reason} placeholder={t(kind === 'correction' ? '说明原数量有误的原因及核对依据' : '说明本次处置的原因与依据')} onChange={(event) => change('reason', event.target.value)} className="min-h-20 resize-y" />{error('reason')}</div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor={fieldId('note')}>{t('补充说明')}<span className="ml-1 font-normal text-muted-foreground">{t('（选填）')}</span></Label><Textarea {...inputProps('note')} maxLength={1000} value={draft.note} onChange={(event) => change('note', event.target.value)} className="min-h-16 resize-y" />{error('note')}</div>
        </div>
        {Number.isFinite(quantity) && !errors.quantity ? <div aria-live="polite" className={cn('rounded-lg border px-3 py-2.5 text-xs leading-5', quantity < min || quantity > max ? 'border-destructive/30 text-destructive' : 'border-border text-muted-foreground')}>
          {kind === 'correction' ? <p className="flex flex-wrap items-center gap-2"><span>{t('实收数量')}</span><span className="font-medium tabular-nums">{numberLabel(receipt.receivedQty)}</span><ArrowRight className="size-3" aria-hidden="true" /><span className="font-medium tabular-nums">{numberLabel(quantity)} {receipt.unit}</span><span className="tabular-nums">({quantity >= receipt.receivedQty ? '+' : ''}{numberLabel(roundQuantity(quantity - receipt.receivedQty))})</span></p> : <p className="text-pretty">{t('本次安排后剩余 {qty} {unit}。', { qty: numberLabel(balance), unit: receipt.unit })}</p>}
        </div> : null}
        {errors.submit ? <p id={fieldId('submit')} role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p> : null}
        {saved ? <p role="status" className="text-pretty text-sm leading-6 text-primary">{t('演示记录已保存，可在处置记录中查看。')}</p> : null}
      </div>
      <footer className="border-t border-border px-4 py-4 sm:px-5"><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => { if (!busyRef.current) onCancel(); }}>{t('取消填写')}</Button><Button ref={submitRef} type="submit" disabled={busy || unavailable}>{t(busy ? '保存中…' : '保存演示记录')}</Button></div></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) setConfirmation(null); }}>
      <AlertDialogContent className="receipt-disposition-confirm" overlayClassName="receipt-disposition-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (validationFocus.current) { focusField(validationFocus.current); validationFocus.current = null; } else submitRef.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{t('保存这笔{kind}演示记录？', { kind: t(dispositionLabels[kind]) })}</AlertDialogTitle><AlertDialogDescription>{t('请核对本次填写内容。保存后将保留这笔处置记录，供流程评审查看。')}</AlertDialogDescription></AlertDialogHeader>
        {confirmation ? <dl className="space-y-3 rounded-lg bg-muted/40 p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('送货单号')}</dt><dd className="break-all text-right tabular-nums">{receipt.deliveryNo}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{quantityLabel}</dt><dd className="font-semibold tabular-nums">{numberLabel(confirmation.quantity)} {receipt.unit}</dd></div>
          {confirmation.warehouse ? <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('存放位置')}</dt><dd className="break-words text-right">{t(confirmation.warehouse)} · <span className="tabular-nums">{confirmation.location}</span></dd></div> : null}
          {kind === 'return' ? <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('处置方式')}</dt><dd>{t(confirmation.returnMethod === 'return' ? '退货安排' : '换货 / 补货安排')}</dd></div> : null}
          {confirmation.documentNo ? <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('关联单据')}</dt><dd className="break-all text-right tabular-nums">{confirmation.documentNo}</dd></div> : null}
          {confirmation.owner ? <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('跟进负责人')}</dt><dd className="break-words text-right">{confirmation.owner}</dd></div> : null}
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('日期')}</dt><dd className="tabular-nums">{confirmation.date}</dd></div>
          {confirmation.expectedDate ? <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{t('预计补货日期')}</dt><dd className="tabular-nums">{confirmation.expectedDate}</dd></div> : null}
          <div className="space-y-1 border-t border-border pt-3"><dt className="text-muted-foreground">{t('原因')}</dt><dd className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-pretty leading-6">{confirmation.reason}</dd></div>
        </dl> : null}
        <AlertDialogFooter className="flex-row justify-end"><AlertDialogCancel disabled={busy}>{t('返回核对')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : '确认保存演示记录')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
