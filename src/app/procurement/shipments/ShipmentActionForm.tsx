import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { availableToShip, validateShipmentAction } from './shipmentPreviewModel';
import { shipmentActionLabels, type ShipmentAction, type ShipmentActionContext } from './shipmentTypes';
import './shipment-action-form.css';

export interface ShipmentActionFormProps {
  context: ShipmentActionContext;
  onSubmit: (action: ShipmentAction) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}
type Field = 'documentNo' | 'actualDate' | 'customer' | 'orderNo' | 'batchId' | 'quantity' | 'handler' | 'note' | 'serialNumbers' | 'actor' | 'reason';
type Draft = Record<Field, string> & { createReplacement: boolean };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['documentNo', 'actualDate', 'customer', 'orderNo', 'batchId', 'quantity', 'handler', 'note', 'serialNumbers', 'actor', 'reason'];
const descriptions = {
  create: '先登记本次实际出货，可分批登记。保存后还需确认实际出库。',
  edit: '更正待确认记录并保留修改原因，保存后仍需确认实际出库。',
  confirm: '核对实物已出库及质量放行依据，确认后按实际出货日期计入出货统计。',
  reverse: '冲销错误出货记录并保留原单及原因。需要更正时，可同时生成替代草稿。',
  sn: '按现有清单补充本单 SN，每行一个。数量不足时继续标记待补齐。',
};
const saveLabels = { create: '保存出货登记', edit: '保存修改', confirm: '确认实际出库', reverse: '冲销记录', sn: '保存 SN' };
const confirmLabels = { create: '确认保存出货登记', edit: '确认保存修改', confirm: '确认实际出库', reverse: '确认冲销记录', sn: '确认保存 SN' };
const successLabels = { create: '出货登记已保存。', edit: '修改已保存。', confirm: '已确认实际出库。', reverse: '已冲销记录。', sn: 'SN 已保存。' };
function scopeOf(context: ShipmentActionContext) { return `${context.kind}:${context.recordId ?? ''}`; }
function serials(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function wholeQuantity(value: string) {
  const result = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(result) && result > 0 ? result : NaN;
}
function initialDraft(context: ShipmentActionContext): Draft {
  const record = context.kind === 'create' ? undefined : context.state.records.find((item) => item.id === context.recordId);
  return {
    documentNo: record?.documentNo ?? '', actualDate: record?.actualDate ?? '', customer: record?.customer ?? '',
    orderNo: record?.orderNo ?? '', batchId: record?.batchId ?? '', quantity: record ? String(record.quantity) : '',
    handler: record?.handler ?? '', note: record?.note ?? '', serialNumbers: record?.serialNumbers.join('\n') ?? '',
    actor: '', reason: '', createReplacement: true,
  };
}

export function ShipmentActionForm({ context, onSubmit, onDirtyChange, onCancel }: ShipmentActionFormProps) {
  const { t } = useI18n();
  const { kind, state, readOnly } = context;
  const [draft, setDraft] = useState(() => initialDraft(context));
  const cleanDraft = useRef(JSON.stringify(draft));
  const initialScope = useRef(scopeOf(context));
  const initialVersion = useRef(state.version);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: ShipmentAction; scope: string; version: number } | null>(null);
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const editable = kind === 'create' || kind === 'edit';
  const record = state.records.find((item) => item.id === context.recordId);
  const batch = state.batches.find((item) => item.id === (editable ? draft.batchId : record?.batchId));
  const count = editable ? wholeQuantity(draft.quantity) : record?.quantity ?? NaN;
  const selectedSerials = serials(draft.serialNumbers);
  const remainingSn = Number.isFinite(count) ? Math.max(0, count - selectedSerials.length) : null;
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale()) : '—';
  const locked = busy || Boolean(confirmation) || Boolean(readOnly) || saved;
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存操作。');
  if (initialScope.current !== scopeOf(context)) blockers.push('当前单据或操作已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version) blockers.push('出货记录已变化，请重新打开表单后核对。填写内容已保留。');
  if (kind !== 'create' && !record) blockers.push('未找到该出货记录，请重新选择。');
  if (['edit', 'confirm'].includes(kind) && record && record.status !== 'draft') blockers.push('只有待确认记录可以修改或确认实际出库。');
  if (['reverse', 'sn'].includes(kind) && record && record.status !== 'confirmed') blockers.push('只有已出库记录可以冲销或补充 SN。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (optionalOpen && !confirmation && invalidFocus.current && ['note', 'serialNumbers'].includes(invalidFocus.current)) focusField(invalidFocus.current);
  }, [optionalOpen, confirmation]);
  const fieldId = (field: Field) => `shipment-action-${field}`;
  function focusField(field: Field) {
    const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || locked) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
  }
  function validate(): ShipmentAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((message) => t(message)).join('；');
    const required = (field: Field, label: string, limit = 120) => {
      if (!draft[field].trim()) next[field] = t('请填写{label}。', { label: t(label) });
      else if (draft[field].trim().length > limit) next[field] = t('最多填写 {limit} 个字符。', { limit });
    };
    if (editable) {
      required('documentNo', '出库单号', 80); required('actualDate', '实际出货日期'); required('customer', '客户'); required('orderNo', '客户订单', 80); required('handler', '经办人', 80);
      if (!batch) next.batchId = t('请选择出货批次。');
      if (!Number.isFinite(count)) next.quantity = t('请填写大于 0 的整台数量。');
      if (draft.note.trim().length > 2000) next.note = t('最多填写 2000 个字符。');
      if (draft.actualDate && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.actualDate) || Number.isNaN(Date.parse(`${draft.actualDate}T00:00:00Z`)) || new Date(`${draft.actualDate}T00:00:00Z`).toISOString().slice(0, 10) !== draft.actualDate)) next.actualDate = t('请填写有效的实际出货日期。');
    }
    if (kind !== 'create') required('actor', kind === 'confirm' ? '出库确认人' : '操作人', 80);
    if (['edit', 'reverse', 'sn'].includes(kind)) required('reason', kind === 'edit' ? '修改原因' : kind === 'reverse' ? '冲销原因' : 'SN 补充说明', 1000);
    if (editable || kind === 'sn') {
      if (selectedSerials.length > count) next.serialNumbers = t('SN 数量不得超过本次出货数量。');
      else if (new Set(selectedSerials.map((value) => value.toLocaleUpperCase('en-US'))).size !== selectedSerials.length) next.serialNumbers = t('存在重复 SN，请核对后删除重复项。');
      else if (selectedSerials.some((value) => value.length > 128)) next.serialNumbers = t('每个 SN 最多 128 个字符。');
    }
    const actor = (kind === 'create' ? draft.handler : draft.actor).trim();
    let input: ShipmentAction;
    if (editable) {
      const details = { documentNo: draft.documentNo.trim(), actualDate: draft.actualDate, customer: draft.customer.trim(), orderNo: draft.orderNo.trim(), batchId: draft.batchId, quantity: count, handler: draft.handler.trim(), note: draft.note.trim(), serialNumbers: selectedSerials, actor };
      input = kind === 'create' ? { kind, ...details } : { kind, ...details, recordId: context.recordId ?? '', reason: draft.reason.trim() };
    } else if (kind === 'reverse') input = { kind, recordId: context.recordId ?? '', actor, reason: draft.reason.trim(), createReplacement: draft.createReplacement };
    else if (kind === 'sn') input = { kind, recordId: context.recordId ?? '', actor, reason: draft.reason.trim(), serialNumbers: selectedSerials };
    else input = { kind, recordId: context.recordId ?? '', actor };
    if (!Object.keys(next).length) {
      try { validateShipmentAction(state, input); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : t('请核对出货信息后重试。');
        const field: Field | 'submit' = editable && message.includes('出库单号') ? 'documentNo' : editable && message.includes('实际出货日期') ? 'actualDate' : (editable || kind === 'sn') && message.includes('SN') ? 'serialNumbers' : 'submit';
        next[field] = message;
      }
    }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (editable && (next.note || next.serialNumbers)) setOptionalOpen(true);
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    return input;
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || locked) return;
    const input = validate(); if (input) setConfirmation({ input, scope: scopeOf(context), version: state.version });
  }
  async function confirm() {
    if (!confirmation || busyRef.current || saved) return;
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scope !== scopeOf(context) || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) {
      setConfirmation(null); setErrors({ submit: t('当前记录已变化，请重新核对后保存。填写内容已保留。') }); return;
    }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      cleanDraft.current = JSON.stringify(draft); setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) {
      if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('演示记录未保存，填写内容已保留，请重试。') }); }
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)}>{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const inputField = (field: Field, label: string, type = 'text') => <div className="shipment-action-field min-w-0 space-y-1.5">{labelFor(field, label)}<Input {...propsFor(field)} type={type} inputMode={field === 'quantity' ? 'numeric' : undefined} required maxLength={['actor', 'handler', 'documentNo', 'orderNo'].includes(field) ? 80 : 120} value={draft[field]} onChange={(event) => change(field, event.target.value)} className={cn('min-w-0', ['quantity', 'actualDate'].includes(field) && 'tabular-nums')} />{fieldError(field)}</div>;
  const paragraphField = (field: 'note' | 'reason' | 'serialNumbers', label: string, required = true) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, required)}<Textarea {...propsFor(field)} required={required} maxLength={field === 'serialNumbers' ? undefined : field === 'reason' ? 1000 : 2000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className={cn('min-h-20 resize-y', field === 'serialNumbers' && 'tabular-nums')} placeholder={field === 'serialNumbers' ? t('每行填写一个已有 SN') : undefined} />{fieldError(field)}</div>;
  const actualDate = editable ? draft.actualDate : record?.actualDate ?? '';
  const impact = kind === 'confirm' ? t('确认后，本单 {quantity} 台计入 {month} 实际出货；生产完成数和检验结果保持原记录。', { quantity: numberLabel(count), month: actualDate.slice(0, 7) })
    : kind === 'reverse' ? t('冲销后，{month} 实际出货扣除本单 {quantity} 台。原单和原因保留，不代表实物退货。', { month: actualDate.slice(0, 7), quantity: numberLabel(count) })
      : kind === 'sn' ? t('仅补充本单 SN，不改变出货数量、日期或统计。') : t('本次保存待确认记录，不计入实际出货，也不占用可出货额度。');
  const summary: [string, string][] = [
    ['操作', shipmentActionLabels[kind]], ['出库单号', editable ? draft.documentNo.trim() : record?.documentNo ?? '—'],
    ['实际出货日期', actualDate || '—'], ['客户 / 订单', editable ? `${draft.customer.trim()} / ${draft.orderNo.trim()}` : `${record?.customer ?? '—'} / ${record?.orderNo ?? '—'}`],
    ['产品 / 批次', `${batch?.productName ?? '—'} / ${batch?.batchNo ?? '—'}`], ['本次出货数量', `${numberLabel(count)} 台`],
    ['操作人', kind === 'create' ? draft.handler.trim() : draft.actor.trim()],
    ...(editable || kind === 'sn' ? [['已有 SN / 待补齐', `${selectedSerials.length} / ${remainingSn ?? '—'} 台`]] as [string, string][] : []),
    ...(editable && draft.note.trim() ? [['备注', draft.note.trim()]] as [string, string][] : []),
    ...(['edit', 'reverse', 'sn'].includes(kind) ? [['操作原因', draft.reason.trim()]] as [string, string][] : []),
    ...(kind === 'reverse' ? [['替代记录', draft.createReplacement ? '同时生成待确认草稿，需修改后另行确认实际出库' : '不生成替代草稿']] as [string, string][] : []),
  ];
  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="shipment-action-title" aria-busy={busy} className="shipment-action-form min-w-0 rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-4 sm:px-5"><h3 id="shipment-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(shipmentActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(descriptions[kind])}</p></header>
      <div className="shipment-action-fields px-4 py-4 sm:px-5">
        {!editable && record && <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-lg bg-muted/40 px-3 py-3 text-xs leading-5"><div className="col-span-2 min-w-0"><dt className="text-muted-foreground">{t('出库单 / 批次')}</dt><dd className="mt-0.5 break-words font-medium">{record.documentNo} · {batch?.batchNo ?? '—'}</dd></div><div><dt className="text-muted-foreground">{t('实际出货日期')}</dt><dd className="mt-0.5 tabular-nums">{record.actualDate}</dd></div><div><dt className="text-muted-foreground">{t('本次出货')}</dt><dd className="mt-0.5 tabular-nums">{numberLabel(record.quantity)} {t('台')}</dd></div></dl>}
        {blockers.length > 0 && <div role="status" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-pretty text-xs leading-5 text-amber-900">{blockers.map((message) => <p key={message}>{t(message)}</p>)}</div>}
        <p className="text-xs text-muted-foreground">{t('标 * 为必填')}</p>
        {editable && <>
          {inputField('documentNo', '出库单号')}{inputField('actualDate', '实际出货日期', 'date')}
          {inputField('customer', '客户')}{inputField('orderNo', '客户订单')}
          <div className="min-w-0 space-y-1.5">{labelFor('batchId', '出货批次')}<Select value={draft.batchId} disabled={locked} onValueChange={(value) => change('batchId', value)}><SelectTrigger {...propsFor('batchId')} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择产品批次')} /></SelectTrigger><SelectContent>{state.batches.map((item) => <SelectItem key={item.id} value={item.id}>{item.batchNo} · {item.productName}</SelectItem>)}</SelectContent></Select>{fieldError('batchId')}</div>
          {inputField('quantity', '本次出货数量（台）')}{inputField('handler', '经办人')}
        </>}
        {(editable || kind === 'confirm') && batch && <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">
          <p>{t('终检合格')} <span className="tabular-nums font-medium">{numberLabel(batch.inspectionPassedQty)} {t('台')}</span> · {t('质量放行')} <span className="tabular-nums font-medium">{numberLabel(batch.releasedQty)} {t('台')}</span></p>
          <p>{t('当前可出货')} <span className="tabular-nums font-medium">{numberLabel(availableToShip(state, batch.id))} {t('台')}</span></p>
          <p className="break-words text-muted-foreground">{t('放行依据')}：{batch.releaseEvidence || t('待补齐')} · {batch.releasedOn || t('日期待补齐')}</p>
        </div>}
        {editable && <details open={optionalOpen} onToggle={(event) => setOptionalOpen(event.currentTarget.open)} className="min-w-0 rounded-lg border border-border px-3 py-3 text-xs leading-5"><summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('备注与已有 SN（选填）')}{selectedSerials.length > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{t('已登记 {count} 个 SN', { count: selectedSerials.length })}</span>}</summary><div className="mt-3 space-y-4">{paragraphField('note', '备注', false)}{paragraphField('serialNumbers', '已有 SN（选填）', false)}<p className="text-pretty text-muted-foreground">{t('已登记')} <span className="tabular-nums">{selectedSerials.length}</span> {t('个')}{remainingSn !== null && <> · {t('待补齐')} <span className="tabular-nums">{remainingSn}</span> {t('台')}</>}。{t('未补齐不阻止出库，批次记录仍保留。')}</p></div></details>}
        {kind === 'sn' && <div className="min-w-0 space-y-2">{paragraphField('serialNumbers', '已有 SN（选填）', false)}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('已登记')} <span className="tabular-nums">{selectedSerials.length}</span> {t('个')}{remainingSn !== null && <> · {t('待补齐')} <span className="tabular-nums">{remainingSn}</span> {t('台')}</>}。{t('未补齐不阻止出库，批次记录仍保留。')}</p></div>}
        {kind !== 'create' && inputField('actor', kind === 'confirm' ? '出库确认人' : '操作人')}
        {['edit', 'reverse', 'sn'].includes(kind) && paragraphField('reason', kind === 'edit' ? '修改原因' : kind === 'reverse' ? '冲销原因' : 'SN 补充说明')}
        {kind === 'reverse' && <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-3 text-pretty text-xs leading-5"><input type="checkbox" checked={draft.createReplacement} disabled={locked} onChange={(event) => change('createReplacement', event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span>{t('同时生成替代草稿')}<span className="mt-1 block text-muted-foreground">{t('保留与原单的关联。修改草稿后，需另行确认实际出库才计入统计。')}</span></span></label>}
        <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5 text-muted-foreground">{impact}</p>
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(successLabels[kind])}</p>}
      </div>
      <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5"><Button type="button" variant="outline" disabled={busy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}>
      <AlertDialogContent className="shipment-action-confirm proc-horizon-overlay min-w-0" overlayClassName="shipment-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t('请核对本次单据、数量和统计影响。保存仅更新本页演示记录。')}</AlertDialogDescription></AlertDialogHeader>
        <dl className="min-w-0 space-y-3 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{t(label)}</dt><dd className={cn('mt-0.5 whitespace-pre-wrap break-words text-pretty font-medium', (label.includes('数量') || label.includes('日期')) && 'tabular-nums')}>{value}</dd></div>)}</dl>
        <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{impact}</p>
        <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
