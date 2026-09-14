import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { qualitySourceLabels, type QualityCreateInput, type QualitySource } from './qualityExceptionTypes';

type Draft = Omit<QualityCreateInput, 'inspectedQty' | 'defectiveQty'> & { inspectedQty: string; defectiveQty: string };
type Field = keyof Draft;
type Errors = Partial<Record<Field | 'submit', string>>;
const FIELD_ORDER: Field[] = ['source', 'discoveredDate', 'materialCode', 'materialName', 'category', 'spec', 'unit', 'supplierName', 'batchNo', 'orderNo', 'inspectedQty', 'defectiveQty', 'phenomenon', 'evidence'];
const TEXT_LABELS = { materialCode: '物料编码', materialName: '物料名称', category: '物料类别', spec: '规格', unit: '数量单位', supplierName: '供应商', batchNo: '批次号', orderNo: '采购订单号', phenomenon: '不良现象', evidence: '证据说明 / 单据号' };
type TextField = keyof typeof TEXT_LABELS;
const OPTIONAL = new Set<Field>(['spec', 'orderNo']);

function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function initialDraft(): Draft { return { source: 'incoming', discoveredDate: today(), materialCode: '', materialName: '', category: '', spec: '', unit: '', supplierName: '', batchNo: '', orderNo: '', inspectedQty: '', defectiveQty: '', phenomenon: '', evidence: '' }; }
function validDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function parsedQuantity(value: string) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const result = Number(value);
  return Number.isFinite(result) && result <= Number.MAX_SAFE_INTEGER / 1000 ? result : NaN;
}

export interface QualityExceptionCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: QualityCreateInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  navigationPending?: boolean;
}

/** Isolated preview form: saving delegates to the parent, without a business API. */
export function QualityExceptionCreateDialog({ open, onOpenChange, onSubmit, onDirtyChange, navigationPending = false }: QualityExceptionCreateDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initialDraft);
  const cleanDraft = useRef(JSON.stringify(draft));
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<'save' | 'discard' | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const focusAfterConfirm = useRef<Field | 'submit' | 'button' | null>(null);
  const alive = useRef(true);
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const locked = busy || confirmation !== null || navigationPending;
  const fieldId = (field: Field) => `quality-create-${field}`;
  const quantityLabel = (value: string) => parsedQuantity(value).toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!open) { const next = initialDraft(); cleanDraft.current = JSON.stringify(next); setDraft(next); setErrors({}); setConfirmation(null); } }, [open]);
  // A closed create dialog must not overwrite the active detail form's dirty state.
  useEffect(() => { if (open) onDirtyChange?.(dirty); }, [open, dirty, onDirtyChange]);

  function reset() { const next = initialDraft(); cleanDraft.current = JSON.stringify(next); setDraft(next); setErrors({}); setConfirmation(null); if (open) onDirtyChange?.(false); }
  function focusField(field: Field) {
    const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends Field>(field: K, value: Draft[K]) {
    if (busyRef.current || confirmation || navigationPending) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined, ...(field === 'inspectedQty' ? { defectiveQty: undefined } : {}) }));
  }
  function requestClose() {
    if (busyRef.current || confirmation || navigationPending) return;
    if (dirty) { focusAfterConfirm.current = null; setConfirmation('discard'); }
    else { reset(); onOpenChange(false); }
  }
  function validate(): QualityCreateInput | null {
    const next: Errors = {};
    if (!Object.prototype.hasOwnProperty.call(qualitySourceLabels, draft.source)) next.source = t('请选择有效的发现来源。');
    if (!validDate(draft.discoveredDate) || draft.discoveredDate > today()) next.discoveredDate = t('请填写不晚于今天的有效发现日期。');
    for (const field of Object.keys(TEXT_LABELS) as TextField[]) {
      const value = draft[field].trim(), limit = field === 'phenomenon' || field === 'evidence' ? 2000 : field === 'unit' ? 20 : 120;
      if (!OPTIONAL.has(field) && !value) next[field] = t('请填写{field}。', { field: t(TEXT_LABELS[field]) });
      else if (value.length > limit) next[field] = t('{field}不能超过 {limit} 个字符。', { field: t(TEXT_LABELS[field]), limit });
    }
    const inspectedQty = parsedQuantity(draft.inspectedQty), defectiveQty = parsedQuantity(draft.defectiveQty);
    if (!Number.isFinite(inspectedQty) || inspectedQty <= 0) next.inspectedQty = t('请填写大于 0 的检验数量，最多保留 3 位小数。');
    if (!Number.isFinite(defectiveQty) || defectiveQty <= 0) next.defectiveQty = t('请填写大于 0 的不良数量，最多保留 3 位小数。');
    else if (Number.isFinite(inspectedQty) && defectiveQty > inspectedQty) next.defectiveQty = t('不良数量不能超过检验数量。');
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    if (first) { focusAfterConfirm.current = first; if (!confirmation) focusField(first); return null; }
    const trimmed = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as Draft;
    return { ...trimmed, inspectedQty, defectiveQty };
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || confirmation || navigationPending) return;
    if (validate()) { focusAfterConfirm.current = 'button'; setConfirmation('save'); }
  }
  async function confirmSave() {
    if (busyRef.current || confirmation !== 'save' || navigationPending) return;
    const input = validate();
    if (!input) { setConfirmation(null); return; }
    busyRef.current = true; setBusy(true);
    try {
      await onSubmit(input);
      if (alive.current) { focusAfterConfirm.current = null; reset(); onOpenChange(false); }
    } catch (cause) {
      if (alive.current) { focusAfterConfirm.current = 'submit'; setErrors({ submit: cause instanceof Error ? cause.message : t('演示异常未保存，填写内容已保留，请重试。') }); setConfirmation(null); }
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  const error = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const inputProps = (field: Field) => ({ id: fieldId(field), disabled: locked, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const label = (field: Field, value: string) => <Label htmlFor={fieldId(field)}>{t(value)}{OPTIONAL.has(field) ? <span className="font-normal text-muted-foreground">{t('（选填）')}</span> : <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const textField = (field: TextField) => <div className="min-w-0 space-y-1.5">{label(field, TEXT_LABELS[field])}<Input {...inputProps(field)} required={!OPTIONAL.has(field)} maxLength={field === 'unit' ? 20 : 120} value={draft[field]} onChange={(event) => change(field, event.target.value)} placeholder={field === 'supplierName' ? t('未知时填写“待确认”') : undefined} />{error(field)}</div>;

  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent className="horizon-portal bg-card sm:max-w-3xl" closeDisabled={locked} onEscapeKeyDown={(event) => { event.preventDefault(); requestClose(); }} onPointerDownOutside={(event) => { event.preventDefault(); requestClose(); }} onInteractOutside={(event) => { event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t('登记质量异常')}</DialogTitle><DialogDescription>{t('先记录物料批次、不良现象与证据，后续再分派经办和确认原因。')}</DialogDescription></DialogHeader>
        <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-pretty text-xs leading-5 text-muted-foreground">{t('演示登记，仅用于核对页面流程，刷新后恢复。不会生成正式异常或调整库存。')}</p>
        <form ref={formRef} noValidate onSubmit={submit} aria-busy={busy} className="min-w-0 space-y-5">
          <fieldset disabled={locked} className="min-w-0 space-y-3"><legend className="mb-3 text-sm font-semibold">{t('发现与物料批次')}</legend>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">{label('source', '发现来源')}<Select value={draft.source} onValueChange={(value) => change('source', value as QualitySource)} disabled={locked}><SelectTrigger {...inputProps('source')} aria-required="true" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(qualitySourceLabels).map(([value, name]) => <SelectItem key={value} value={value}>{t(name)}</SelectItem>)}</SelectContent></Select>{error('source')}</div>
              <div className="min-w-0 space-y-1.5">{label('discoveredDate', '发现日期')}<Input {...inputProps('discoveredDate')} type="date" max={today()} required value={draft.discoveredDate} className="min-w-0 tabular-nums" onChange={(event) => change('discoveredDate', event.target.value)} />{error('discoveredDate')}</div>
              {textField('materialCode')}{textField('materialName')}{textField('category')}{textField('spec')}{textField('unit')}{textField('supplierName')}{textField('batchNo')}{textField('orderNo')}
            </div>
          </fieldset>
          <fieldset disabled={locked} className="min-w-0 space-y-3 border-t border-border pt-4"><legend className="pr-2 text-sm font-semibold">{t('检验事实与证据')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">{(['inspectedQty', 'defectiveQty'] as const).map((field) => <div key={field} className="min-w-0 space-y-1.5">{label(field, field === 'inspectedQty' ? '检验数量' : '不良数量')}<Input {...inputProps(field)} type="text" inputMode="decimal" required maxLength={24} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="tabular-nums" placeholder={t('大于 0，最多 3 位小数')} />{error(field)}</div>)}</div>
            {(['phenomenon', 'evidence'] as const).map((field) => <div key={field} className="min-w-0 space-y-1.5">{label(field, TEXT_LABELS[field])}<Textarea {...inputProps(field)} required maxLength={2000} rows={3} value={draft[field]} onChange={(event) => change(field, event.target.value)} placeholder={t(field === 'phenomenon' ? '描述实际观察到的现象，不将猜测当作已确认原因。' : '填写检验记录、照片编号或测量依据；此处为文字登记。')} />{error(field)}</div>)}
          </fieldset>
          {errors.submit ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-pretty text-sm text-destructive outline-none">{errors.submit}</p> : null}
          <DialogFooter className="border-t border-border pt-4"><Button type="button" variant="outline" disabled={locked} onClick={requestClose}>{t('取消登记')}</Button><Button ref={submitRef} type="submit" disabled={locked}>{t('保存演示异常')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmation !== null && !navigationPending} onOpenChange={(next) => { if (!next && !busyRef.current && !navigationPending) setConfirmation(null); }}>
      <AlertDialogContent className={cn('horizon-portal bg-card')} onEscapeKeyDown={(event) => { if (busyRef.current || navigationPending) event.preventDefault(); }} onCloseAutoFocus={(event) => {
        if (navigationPending) { event.preventDefault(); return; }
        const target = focusAfterConfirm.current; focusAfterConfirm.current = null;
        if (target && open) { event.preventDefault(); if (target === 'button') submitRef.current?.focus(); else if (target === 'submit') errorRef.current?.focus(); else focusField(target); }
      }}>
        <AlertDialogHeader><AlertDialogTitle>{t(confirmation === 'discard' ? '放弃尚未保存的登记？' : '核对质量异常登记')}</AlertDialogTitle><AlertDialogDescription>{t(confirmation === 'discard' ? '本次填写尚未保存，放弃后将清空。已保存的演示异常不受影响。' : '请核对物料、批次与检验数量。本次只保存演示记录，后续需继续确认原因和处置。')}</AlertDialogDescription></AlertDialogHeader>
        {confirmation === 'save' ? <dl className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">{[[t('来源 / 日期'), `${t(qualitySourceLabels[draft.source])} · ${draft.discoveredDate}`], [t('物料'), `${draft.materialCode} · ${draft.materialName}`], [t('供应商 / 批次'), `${draft.supplierName} · ${draft.batchNo}`], [t('检验 / 不良'), `${quantityLabel(draft.inspectedQty)} / ${quantityLabel(draft.defectiveQty)} ${draft.unit}`], [t('不良现象'), draft.phenomenon], [t('证据说明 / 单据号'), draft.evidence]].map(([name, value]) => <div key={name} className="grid gap-1 sm:grid-cols-3"><dt className="text-xs text-muted-foreground">{name}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-pretty tabular-nums sm:col-span-2">{value}</dd></div>)}</dl> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={busy || navigationPending}>{t(confirmation === 'discard' ? '继续填写' : '返回核对')}</AlertDialogCancel><AlertDialogAction disabled={busy || navigationPending} onClick={(event) => { event.preventDefault(); if (busyRef.current || navigationPending) return; if (confirmation === 'discard') { focusAfterConfirm.current = null; reset(); onOpenChange(false); } else { void confirmSave(); } }}>{t(confirmation === 'discard' ? '放弃登记' : busy ? '保存中…' : '确认保存演示异常')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
