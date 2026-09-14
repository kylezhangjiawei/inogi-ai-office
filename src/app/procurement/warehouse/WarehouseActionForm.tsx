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
import { freeStock, lineBalance, returnableQty } from './warehousePreviewModel';
import { stockBucketLabels, warehouseActionLabels, warehousePeople, type MaterialReturn, type StockBucket, type WarehouseAction, type WarehouseActionContext, type WarehouseActionKind } from './warehouseTypes';
import './warehouse-action-form.css';

export interface WarehouseActionFormProps {
  context: WarehouseActionContext;
  onSubmit: (action: WarehouseAction) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}
type Field = 'lotId' | 'quantity' | 'actualQty' | 'result' | 'bucket' | 'reviewed' | 'actor' | 'note' | 'evidence';
type Draft = Record<Field, string>;
type Errors = Partial<Record<Field | 'submit', string>>;
const fields: Record<WarehouseActionKind, Field[]> = {
  issue: ['lotId', 'quantity', 'actor', 'note'], sign: ['actualQty', 'actor', 'note'],
  return_create: ['quantity', 'result', 'actor', 'note', 'evidence'],
  return_receive: ['actualQty', 'result', 'reviewed', 'actor', 'note', 'evidence'],
  return_discrepancy: ['actualQty', 'actor', 'note'], return_resubmit: ['quantity', 'actor', 'note'],
  count_create: ['bucket', 'actualQty', 'actor', 'note', 'evidence'], count_edit: ['actualQty', 'actor', 'note', 'evidence'],
  count_submit: ['actor', 'note'], count_approve: ['actor', 'note'], count_reject: ['actor', 'note'],
};
const descriptions: Record<WarehouseActionKind, string> = {
  issue: '按 BOM 需求选择同物料、同单位批次发料。发料后等待生产签收。',
  sign: '核对实际收到的数量。数量一致后计入线边结存；不一致先记录差异。',
  return_create: '从原签收单登记退料申请。申请占用可退额度，接收前不改变库存。',
  return_receive: '核对退料数量、批次及质量状态，一次完成线边退回和仓库接收。',
  return_discrepancy: '记录实物与申请的数量差异，退回申请人核对，不改变库存。',
  return_resubmit: '更正申请数量后重新提交仓库核对，保留此前差异记录。',
  count_create: '记录当前账面快照与实盘数量。保存草稿不改变库存。',
  count_edit: '重新核对当前账面与实盘，保存后重新提交复核。',
  count_submit: '核对实盘、差异原因和依据，交由另一位人员复核。',
  count_approve: '复核通过后生成库存调整流水，保留原有记录。',
  count_reject: '填写退回原因，交由盘点人重新核对和修改。',
};
const resultLabels = { qualified: '合格', inspection: '待检', defective: '不良隔离' };
function quantityValue(value: string) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER / 1000 ? parsed : NaN;
}
function scopeOf(context: WarehouseActionContext) {
  return [context.kind, context.lotId, context.dispatchId, context.issueId, context.returnId, context.countId].join(':');
}
function initialDraft(context: WarehouseActionContext): Draft {
  const count = context.state.counts.find((row) => row.id === context.countId);
  const returned = context.state.returns.find((row) => row.id === context.returnId);
  return {
    lotId: context.lotId ?? '', quantity: context.kind === 'return_resubmit' ? String(returned?.quantity ?? '') : '',
    actualQty: context.kind === 'count_edit' ? String(count?.actualQty ?? '') : '',
    result: returned?.result ?? '', bucket: count?.bucket ?? 'qualified', reviewed: '', actor: '',
    note: context.kind === 'count_edit' ? count?.reason ?? '' : '',
    evidence: context.kind === 'count_edit' ? count?.evidence ?? '' : '',
  };
}

export function WarehouseActionForm({ context, onSubmit, onDirtyChange, onCancel }: WarehouseActionFormProps) {
  const { t } = useI18n();
  const { state, kind } = context;
  const [draft, setDraft] = useState(() => initialDraft(context));
  const cleanDraft = useRef(JSON.stringify(draft));
  const initialScope = useRef(scopeOf(context));
  const busyRef = useRef(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<{ input: WarehouseAction; scope: string; version: number } | null>(null);
  const locked = busy || Boolean(confirmation);
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const count = state.counts.find((row) => row.id === context.countId);
  const returned = state.returns.find((row) => row.id === context.returnId);
  const issue = state.issues.find((row) => row.id === (context.issueId ?? returned?.issueId));
  const dispatch = state.dispatches.find((row) => row.id === (context.dispatchId ?? issue?.dispatchId));
  const lot = state.lots.find((row) => row.id === (kind === 'issue' ? draft.lotId : context.lotId ?? count?.lotId ?? issue?.lotId));
  const bucket = (kind === 'count_create' ? draft.bucket : count?.bucket ?? 'qualified') as StockBucket;
  const unit = lot?.unit ?? dispatch?.unit ?? '';
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
  const quantityLabel = (value: number) => `${numberLabel(value)} ${unit}`;
  const currentBook = lot?.[bucket] ?? NaN;
  const availableReturn = issue ? returnableQty(state, issue.id, kind === 'return_resubmit' || kind === 'return_receive' ? returned?.id : undefined) : 0;
  const remaining = dispatch?.requiredQty == null ? NaN : Math.max(0, dispatch.requiredQty - dispatch.issuedQty);
  const reference = count?.code ?? returned?.code ?? issue?.code ?? dispatch?.dispatchNo ?? lot?.batchNo ?? '';
  const blockers: string[] = [];
  if (initialScope.current !== scopeOf(context)) blockers.push('当前单据或操作已变化，请重新打开操作表单。');
  if (kind === 'issue') {
    if (!dispatch) blockers.push('未找到派工物料，请重新选择。');
    else if (!dispatch.bomVersion.trim() || dispatch.qtyPer == null || dispatch.requiredQty == null || dispatch.qtyPer <= 0 || Math.round(dispatch.componentQty * dispatch.qtyPer * 1000) !== Math.round(dispatch.requiredQty * 1000)) blockers.push('BOM 单耗或需求数量未确认，暂不能发料。');
    else if (remaining <= 0) blockers.push('该派工物料已足量发出。');
  } else if (kind === 'sign' && (!issue || !['pending_signature', 'discrepancy'].includes(issue.status))) blockers.push('仅待签收或签收差异单可以登记签收。');
  else if (kind === 'return_create' && (!issue || issue.status !== 'signed' || availableReturn <= 0)) blockers.push('该签收单没有可退额度，请核对线边结存及待接收申请。');
  else if (['return_receive', 'return_discrepancy'].includes(kind) && returned?.status !== 'pending') blockers.push('该退料单已不在待接收状态。');
  else if (kind === 'return_resubmit' && returned?.status !== 'discrepancy') blockers.push('只有退回核对的退料单可以更正数量。');
  else if (kind === 'count_create' && !lot) blockers.push('未找到库存批次，请重新选择。');
  else if (['count_edit', 'count_submit'].includes(kind) && (!count || !['draft', 'rejected'].includes(count.status))) blockers.push('仅草稿或已退回盘点单可以修改或提交。');
  else if (['count_approve', 'count_reject'].includes(kind) && count?.status !== 'pending_review') blockers.push('该盘点单已不在待复核状态。');
  if (['count_submit', 'count_approve'].includes(kind) && count?.bucket === 'qualified' && lot && count.actualQty < lot.reserved) blockers.push('实盘合格数量少于已预留，请先核对预留后再提交或复核。');
  if (['count_submit', 'count_approve'].includes(kind) && count && lot?.version !== count.lotVersion) blockers.push(kind === 'count_submit' ? '库存已变化，请先修改实盘并重新核对当前账面。' : '库存已变化，请退回修改，重新核对账面后再复核。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `warehouse-action-${field}`;
  function focusField(field: Field) {
    const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change(field: Field, value: string) {
    if (busyRef.current || confirmation) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined })); setSaved(false);
  }
  function validate(): WarehouseAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((message) => t(message)).join('；');
    if (!warehousePeople.includes(draft.actor)) next.actor = t('请选择演示经办人员。');
    if (['count_approve', 'count_reject'].includes(kind) && draft.actor === count?.reporter) next.actor = t('复核人须与盘点人不同。');
    for (const field of fields[kind].filter((field) => field === 'note' || field === 'evidence')) {
      if (!draft[field].trim()) next[field] = t(field === 'note' ? '请填写操作说明。' : '请填写核对依据。');
      else if (draft[field].trim().length > 2000) next[field] = t('最多填写 2000 个字符。');
    }
    const quantity = quantityValue(draft.quantity), actualQty = quantityValue(draft.actualQty);
    if (fields[kind].includes('quantity') && (!Number.isFinite(quantity) || quantity <= 0)) next.quantity = t('请填写大于 0 的数量，最多 3 位小数。');
    if (fields[kind].includes('actualQty') && (!Number.isFinite(actualQty) || actualQty < 0 || (kind === 'return_receive' && actualQty === 0))) next.actualQty = t(kind === 'return_receive' ? '请填写大于 0 的实收数量，最多 3 位小数。' : '请填写不小于 0 的实际数量，最多 3 位小数。');
    if (kind === 'issue') {
      if (!lot || lot.materialCode !== dispatch?.materialCode || lot.unit !== dispatch?.unit) next.lotId = t('请选择同物料、同单位的库存批次。');
      else if (quantity > freeStock(lot)) next.quantity = t('发料数量不得超过未预留可用 {quantity}。', { quantity: quantityLabel(freeStock(lot)) });
      if (quantity > remaining) next.quantity = t('发料数量不得超过剩余需求 {quantity}。', { quantity: quantityLabel(remaining) });
    }
    if ((kind === 'return_create' || kind === 'return_resubmit') && quantity > availableReturn) next.quantity = t('退料数量不得超过可退额度 {quantity}。', { quantity: quantityLabel(availableReturn) });
    if (fields[kind].includes('result') && !Object.hasOwn(resultLabels, draft.result)) next.result = t('请选择质量状态。');
    if (kind === 'return_receive') {
      if (actualQty !== returned?.quantity) next.actualQty = t('实收与申请数量不一致，请使用“退回核对”。');
      if (actualQty > availableReturn) next.actualQty = t('当前可退额度不足，请核对线边结存。');
      if (draft.result === 'qualified' && draft.reviewed !== 'yes') next.reviewed = t('合格接收前须确认已完成质量复核。');
    }
    if (kind === 'return_discrepancy' && actualQty === returned?.quantity) next.actualQty = t('实收与申请数量一致，可直接核对接收。');
    if (kind === 'count_create' && !Object.hasOwn(stockBucketLabels, draft.bucket)) next.bucket = t('请选择盘点库存状态。');
    setErrors(next); invalidFocus.current = fields[kind].find((field) => next[field]) ?? null;
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    const common = { actor: draft.actor, note: draft.note.trim() }, evidence = draft.evidence.trim();
    switch (kind) {
      case 'issue': return { kind, dispatchId: dispatch!.id, lotId: lot!.id, quantity, ...common };
      case 'sign': return { kind, issueId: issue!.id, actualQty, ...common };
      case 'return_create': return { kind, issueId: issue!.id, quantity, result: draft.result as MaterialReturn['result'], evidence, ...common };
      case 'return_receive': return { kind, returnId: returned!.id, actualQty, result: draft.result as MaterialReturn['result'], reviewed: draft.reviewed === 'yes', evidence, ...common };
      case 'return_discrepancy': return { kind, returnId: returned!.id, actualQty, ...common };
      case 'return_resubmit': return { kind, returnId: returned!.id, quantity, ...common };
      case 'count_create': return { kind, lotId: lot!.id, bucket, actualQty, evidence, ...common };
      case 'count_edit': return { kind, countId: count!.id, actualQty, evidence, ...common };
      default: return { kind, countId: count!.id, ...common };
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || confirmation) return;
    setSaved(false); const input = validate();
    if (input) setConfirmation({ input, scope: scopeOf(context), version: state.version });
  }
  async function confirm() {
    if (!confirmation || busyRef.current) return;
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scope !== scopeOf(context) || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) {
      setConfirmation(null); setErrors({ submit: t('当前库存或单据已变化，请核对后重新保存。填写内容已保留。') }); return;
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
  const labelFor = (field: Field, label: string) => <Label htmlFor={fieldId(field)}>{label}<span aria-hidden="true" className="text-destructive"> *</span></Label>;
  const selectField = (field: Field, label: string, options: Record<string, string>) => <div className={cn("warehouse-action-field min-w-0 space-y-1.5", field === "lotId" && "warehouse-action-field-wide")}>{labelFor(field, t(label))}<Select value={draft[field]} disabled={locked} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择')} /></SelectTrigger><SelectContent>{Object.entries(options).map(([value, name]) => <SelectItem key={value} value={value}>{t(name)}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const paragraphField = (field: 'note' | 'evidence', label: string) => <div className="min-w-0 space-y-1.5">{labelFor(field, t(label))}<Textarea {...propsFor(field)} required maxLength={2000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" placeholder={field === 'evidence' ? t('填写核对说明或关联单据号') : ''} />{fieldError(field)}</div>;
  const quantityField = (field: 'quantity' | 'actualQty', label: string) => <div className="warehouse-action-field min-w-0 space-y-1.5">{labelFor(field, t(label))}<div className="relative min-w-0"><Input {...propsFor(field)} type="text" inputMode="decimal" required value={draft[field]} onChange={(event) => change(field, event.target.value)} placeholder="0.000" className="min-w-0 pr-12 tabular-nums" /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span></div>{fieldError(field)}<p className="text-xs leading-5 text-muted-foreground">{t('最多 3 位小数')}</p></div>;
  const actorLabel = kind === 'count_approve' || kind === 'count_reject' ? '演示复核人' : kind === 'sign' ? '演示签收人' : '演示经办';
  const selectedQuantity = quantityValue(draft.quantity), selectedActual = quantityValue(draft.actualQty);
  const impact = kind === 'issue' ? `合格现存减少 ${quantityLabel(selectedQuantity)}；生产签收前不计入线边结存。`
    : kind === 'sign' ? selectedActual === issue?.quantity ? `签收 ${quantityLabel(selectedActual)} 后计入线边结存，仓库不再扣减。` : '数量不一致会进入签收差异，仓库和线边结存均不改变。'
      : kind === 'return_receive' ? `线边结存减少 ${quantityLabel(selectedActual)}；${resultLabels[draft.result as keyof typeof resultLabels] ?? '对应状态'}库存增加同样数量。`
        : kind === 'count_approve' && count ? `本次${count.actualQty >= count.bookQty ? '增加' : '减少'} ${quantityLabel(Math.abs(count.actualQty - count.bookQty))}，仅调整${stockBucketLabels[count.bucket]}。`
          : '本次仅保存单据状态与记录，不改变仓库或线边库存。';
  const rebase = kind === 'count_edit' && count ? `保存修改将以当前账面 ${quantityLabel(currentBook)} 重新建立快照（原账面 ${quantityLabel(count.bookQty)}），历史记录保留。请重新核对实盘。` : '';
  const summary: [string, string][] = [
    ['操作', warehouseActionLabels[kind]], ['关联单据', reference], ['物料 / 批次', `${lot?.materialName ?? dispatch?.materialName ?? '—'} / ${lot?.batchNo ?? '—'}`],
    ...(fields[kind].includes('quantity') ? [['数量', quantityLabel(selectedQuantity)] as [string, string]] : []),
    ...(fields[kind].includes('actualQty') ? [['实际数量', quantityLabel(selectedActual)] as [string, string]] : []),
    ...(fields[kind].includes('result') ? [['质量状态', resultLabels[draft.result as keyof typeof resultLabels]] as [string, string]] : []),
    ...(kind === 'return_receive' && draft.result === 'qualified' ? [['质量复核', draft.reviewed === 'yes' ? '已完成质量复核' : '未确认'] as [string, string]] : []),
    ...(kind.startsWith('count_') ? [['库存状态', stockBucketLabels[bucket]], ['当前账面', quantityLabel(currentBook)]] as [string, string][] : []),
    ...(kind.startsWith('count_') && count ? [['原账面 / 实盘', `${quantityLabel(count.bookQty)} / ${quantityLabel(kind === 'count_edit' ? selectedActual : count.actualQty)}`] as [string, string]] : []),
    [actorLabel, draft.actor], ['操作说明', draft.note.trim()], ...(fields[kind].includes('evidence') ? [['核对依据', draft.evidence.trim()] as [string, string]] : []),
  ];
  return <>
    <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="warehouse-action-title" aria-busy={busy} className="warehouse-action-form min-w-0 rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-4 sm:px-5"><h3 id="warehouse-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 text-primary" />{t(warehouseActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(descriptions[kind])}</p></header>
      <div className="warehouse-action-fields px-4 py-4 sm:px-5">
        <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5"><p className="break-words font-medium">{reference} · {lot?.materialName ?? dispatch?.materialName}</p>
          {kind === 'issue' && <p className="text-pretty text-muted-foreground">{t('剩余需求')} <span className="tabular-nums text-foreground">{quantityLabel(remaining)}</span> · {t('选中批次未预留可用')} <span className="tabular-nums text-foreground">{lot ? quantityLabel(freeStock(lot)) : '—'}</span></p>}
          {kind === 'issue' && dispatch && <p className="text-pretty text-muted-foreground">{t('BOM')} {dispatch.bomVersion || t('待确认')} · <span className="tabular-nums">{numberLabel(dispatch.componentQty)} {t('组件')} × {numberLabel(dispatch.qtyPer ?? NaN)} {unit} = {quantityLabel(dispatch.requiredQty ?? NaN)}</span></p>}
          {issue && <p className="text-pretty text-muted-foreground">{t('原发料')} <span className="tabular-nums">{quantityLabel(issue.quantity)}</span> · {t('线边结存')} <span className="tabular-nums">{quantityLabel(lineBalance(issue))}</span>{kind.startsWith('return_') && <> · {t('本单可退额度')} <span className="tabular-nums">{quantityLabel(availableReturn)}</span></>}</p>}
          {kind.startsWith('count_') && <p className="text-pretty text-muted-foreground">{t(stockBucketLabels[bucket] ?? '库存')} · {t('当前账面')} <span className="tabular-nums">{quantityLabel(currentBook)}</span>{count && <> · {t('原实盘')} <span className="tabular-nums">{quantityLabel(count.actualQty)}</span> · {t('盘点人')} {count.reporter}</>}{bucket === 'qualified' && <> · {t('已预留')} <span className="tabular-nums">{quantityLabel(lot?.reserved ?? NaN)}</span></>}</p>}
        </div>
        {['count_create', 'count_edit'].includes(kind) && bucket === 'qualified' && lot && selectedActual < lot.reserved && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-pretty text-xs leading-5 text-amber-900">{t('实盘合格数量少于已预留，可先保存实际盘点草稿。须核对预留后才能提交复核。')}</p>}
        {count && ['count_submit', 'count_approve', 'count_reject'].includes(kind) && <details className="rounded-lg border border-border px-3 py-3 text-xs leading-5"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('查看盘点说明与依据')}</summary><dl className="mt-3 space-y-3"><div><dt className="text-muted-foreground">{t('盘点说明')}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{count.reason}</dd></div><div><dt className="text-muted-foreground">{t('核对依据')}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{count.evidence}</dd></div></dl></details>}
        {rebase && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-pretty text-xs leading-5 text-amber-900">{t(rebase)}</p>}
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-amber-900"><p className="text-xs font-medium">{t('暂不能保存此操作')}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-pretty text-xs leading-5">{blockers.map((message) => <li key={message}>{t(message)}</li>)}</ul></div>}
        <p className="text-xs text-muted-foreground">{t('标 * 为必填')}</p>
        {kind === 'issue' && selectField('lotId', '发料批次', Object.fromEntries(state.lots.filter((item) => item.materialCode === dispatch?.materialCode && item.unit === dispatch?.unit).map((item) => [item.id, `${item.batchNo} · ${item.warehouse} / ${item.location} · 可用 ${numberLabel(freeStock(item))} ${item.unit}`])))}
        {fields[kind].includes('bucket') && selectField('bucket', '盘点库存状态', stockBucketLabels)}
        {fields[kind].includes('quantity') && quantityField('quantity', kind === 'issue' ? '本次发料数量' : '申请退料数量')}
        {fields[kind].includes('actualQty') && quantityField('actualQty', kind.startsWith('count_') ? '实盘数量' : '实际收到数量')}
        {fields[kind].includes('result') && selectField('result', '质量状态', resultLabels)}
        {kind === 'return_receive' && draft.result === 'qualified' && selectField('reviewed', '质量复核确认', { yes: '已完成质量复核，可按合格接收', no: '尚未完成质量复核' })}
        {selectField('actor', actorLabel, Object.fromEntries(warehousePeople.map((name) => [name, name])))}
        {paragraphField('note', kind.startsWith('count_') ? (kind === 'count_reject' ? '退回原因' : kind === 'count_approve' ? '复核说明' : '盘点说明') : kind === 'return_discrepancy' ? '数量差异说明' : '操作说明')}
        {fields[kind].includes('evidence') && paragraphField('evidence', '核对依据')}
        {fields[kind].includes('evidence') && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本次依据为文字说明或关联单据号，不提供附件上传。')}</p>}
        <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5 text-muted-foreground">{t(impact)}</p>
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t('演示记录已保存。')}</p>}
      </div>
      <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5"><Button type="button" variant="outline" disabled={locked} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t('取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : '保存演示记录')}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}>
      <AlertDialogContent className="warehouse-action-confirm proc-horizon-overlay min-w-0" overlayClassName="warehouse-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{t('确认保存演示记录')}</AlertDialogTitle><AlertDialogDescription>{t('请核对本次单据、数量和库存影响。保存仅更新本页演示记录。')}</AlertDialogDescription></AlertDialogHeader>
        <dl className="min-w-0 space-y-3 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{t(label)}</dt><dd className={cn('mt-0.5 whitespace-pre-wrap break-words text-pretty font-medium', label.includes('数量') && 'tabular-nums')}>{value}</dd></div>)}</dl>
        {rebase && <p className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-pretty text-xs leading-5 text-amber-900">{t(rebase)}</p>}
        <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{t(impact)}</p>
        <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : '确认保存演示记录')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
