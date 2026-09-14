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
import { canPlan, validatePlanningAction } from './planningModel';
import { planningActionLabels, type PlanningAction, type PlanningActionContext, type PlanningState } from './planningTypes';
import './planning-action-form.css';

export interface PlanningActionFormProps {
  state: PlanningState; actorId: string; context: PlanningActionContext; readOnly?: boolean;
  onSubmit: (action: PlanningAction) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onCancel: () => void;
}
type TextField = 'operationId' | 'date' | 'lineId' | 'ownerId' | 'quantity' | 'note' | 'reason';
type Field = TextField | 'reviewed';
type Draft = Record<TextField, string> & { reviewed: boolean };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['operationId', 'date', 'quantity', 'lineId', 'ownerId', 'note', 'reviewed', 'reason'];
const saveLabels = { create: '保存组件任务', adjust: '保存计划调整', dispatch: '确认派工', cancel: '取消未派工任务' };
const confirmLabels = { create: '确认保存组件任务', adjust: '确认保存计划调整', dispatch: '确认生成派工与用料需求', cancel: '确认取消任务' };
const impactText = {
  create: '保存为待派工任务，确认派工后才生成对应派工单与用料需求。',
  adjust: '调整计划安排并保留原因。既有报工日期、产线与数量保留原记录。',
  dispatch: '本页生成派工与用料需求，不代表已配料、已开工或已完成生产。',
  cancel: '仅取消尚未派工的任务，保留原计划与取消原因。取消后该任务不能继续派工。',
};
function wholeQuantity(value: string) {
  const number = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
}
function initialDraft({ state, context }: PlanningActionFormProps): Draft {
  const task = context.kind === 'create' ? undefined : state.tasks.find((item) => item.id === context.taskId);
  return { operationId: task?.operationId ?? '', date: task?.date ?? '', lineId: task?.lineId ?? '', ownerId: task?.ownerId ?? '', quantity: task ? String(task.quantity) : '', note: context.kind === 'dispatch' ? '' : task?.note ?? '', reason: '', reviewed: false };
}

export function PlanningActionForm(props: PlanningActionFormProps) {
  const { state, actorId, context, readOnly, onSubmit, onDirtyChange, onCancel } = props;
  const { kind, batchId, taskId } = context;
  const { t } = useI18n();
  const batch = state.batches.find((item) => item.id === batchId);
  const task = kind === 'create' ? undefined : state.tasks.find((item) => item.id === taskId);
  const actor = state.actors.find((item) => item.id === actorId);
  const scopeKey = JSON.stringify([actorId, kind, batchId, taskId ?? '']);
  const [draft, setDraft] = useState(() => initialDraft(props));
  const clean = useRef(JSON.stringify(draft));
  const initialScope = useRef(scopeKey);
  const initialVersion = useRef(state.version);
  const initialRevision = useRef(task?.revision);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: PlanningAction; scopeKey: string; version: number } | null>(null);
  const dirty = JSON.stringify(draft) !== clean.current;
  const editable = kind === 'create' || kind === 'adjust';
  const locked = Boolean(readOnly) || busy || Boolean(confirmation) || saved;
  const operation = batch?.operations.find((item) => item.id === (kind === 'create' ? draft.operationId : task?.operationId));
  const plannedQuantity = state.tasks.filter((item) => item.batchId === batchId && item.operationId === operation?.id && item.status !== 'cancelled' && item.id !== task?.id).reduce((total, item) => total + item.quantity, 0);
  const availableQuantity = Math.max(0, (operation?.requiredQty ?? 0) - plannedQuantity);
  const allowedLines = state.lines.filter((line) => operation?.lineIds.includes(line.id));
  const allowedOwners = state.actors.filter((person) => person.role === 'line' && person.lineId === draft.lineId);
  const count = editable ? wholeQuantity(draft.quantity) : task?.quantity ?? NaN;
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
  const quantityLabel = (value: number) => `${numberLabel(value)} ${operation?.unit ?? ''}`.trim();
  const lineName = (id: string | undefined) => state.lines.find((line) => line.id === id)?.name ?? '—';
  const ownerName = (id: string | undefined) => state.actors.find((person) => person.id === id)?.name ?? '—';
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存计划操作。');
  if (!canPlan(state, actorId)) blockers.push('请由计划员或生产主管完成此操作。');
  if (initialScope.current !== scopeKey) blockers.push('当前批次、任务或操作人已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version || initialRevision.current !== task?.revision) blockers.push('计划记录已更新，请重新打开表单后核对。填写内容已保留。');
  if (!batch) blockers.push('未找到该生产批次，请重新选择。');
  else if (batch.status === 'closed') blockers.push('该批次已关闭，不能继续调整或派工。');
  if (kind !== 'create' && (!task || task.batchId !== batchId)) blockers.push('任务不属于当前批次，请重新选择。');
  if (task && ['completed', 'cancelled'].includes(task.status)) blockers.push('已完成或已取消的任务仅可查看。');
  if (task && ['dispatch', 'cancel'].includes(kind) && task.status !== 'draft') blockers.push(kind === 'dispatch' ? '只有待派工任务可以确认派工。' : '只有未派工任务可以取消。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `planning-action-${field}`;
  function focusField(field: Field) {
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || locked || (field === 'operationId' && kind !== 'create')) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'operationId' ? { lineId: '', ownerId: '' } : {}), ...(field === 'lineId' ? { ownerId: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === 'operationId' ? { lineId: undefined, ownerId: undefined } : {}), ...(field === 'lineId' ? { ownerId: undefined } : {}), submit: undefined }));
  }
  function validate(): PlanningAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((value) => t(value)).join('；');
    if (kind === 'adjust' && !draft.reason.trim()) next.reason = t('请填写调整原因。');
    const visibleFields: Field[] = editable ? ['date', 'quantity', 'lineId', 'ownerId', 'note', ...(kind === 'create' ? ['operationId' as const] : ['reason' as const])] : kind === 'dispatch' ? ['reviewed', 'note'] : ['reason'];
    const schedule = { date: draft.date, lineId: draft.lineId, ownerId: draft.ownerId, quantity: count, note: draft.note.trim() };
    let input: PlanningAction;
    if (kind === 'create') input = { kind, actorId, batchId, operationId: draft.operationId, ...schedule };
    else if (kind === 'adjust') input = { kind, actorId, taskId: taskId ?? '', ...schedule, reason: draft.reason.trim() };
    else if (kind === 'dispatch') input = { kind, actorId, taskId: taskId ?? '', reviewed: draft.reviewed, note: draft.note.trim() };
    else input = { kind, actorId, taskId: taskId ?? '', reason: draft.reason.trim() };
    try {
      const modelErrors = validatePlanningAction(state, input);
      for (const [field, message] of Object.entries(modelErrors)) {
        if (!message) continue;
        if (visibleFields.includes(field as Field)) next[field as Field] = t(message);
        else next.submit = [next.submit, t(message)].filter(Boolean).join('；');
      }
    } catch (cause) { next.submit = cause instanceof Error ? cause.message : t('请核对本次计划操作后重试。'); }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    return input;
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || locked) return;
    const input = validate(); if (input) setConfirmation({ input, scopeKey, version: state.version });
  }
  async function confirm() {
    if (!confirmation || busyRef.current || saved) return;
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scopeKey !== scopeKey || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) {
      setConfirmation(null); setErrors({ submit: t('本次计划内容已变化，请重新核对后保存。填写内容已保留。') }); return;
    }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      clean.current = JSON.stringify(draft); setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) { if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('计划操作未保存，填写内容已保留，请重试。') }); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked || (field === 'operationId' && kind !== 'create'), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)}>{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const selectField = (field: 'operationId' | 'lineId' | 'ownerId', label: string, options: { id: string; label: string }[]) => <div className="planning-action-field min-w-0 space-y-1.5">{labelFor(field, label)}<Select value={draft[field]} disabled={locked || (field === 'operationId' && kind !== 'create')} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择{label}', { label: t(label) })} /></SelectTrigger><SelectContent className="planning-action-select proc-horizon-overlay">{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const paragraphField = (field: 'note' | 'reason', label: string, required = true) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, required)}<Textarea {...propsFor(field)} required={required} maxLength={1000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" />{fieldError(field)}</div>;
  const summary: [string, string][] = [
    ['操作人', actor?.name ?? '—'], ['生产批次', batch?.code ?? '—'], ['任务', task?.code ?? '新增待派工任务'],
    ['组件 / 工序', operation ? `${operation.component} / ${operation.process}` : '—'],
    ['计划数量', quantityLabel(count)], ['计划日期', editable ? draft.date : task?.date ?? '—'],
    ['计划产线', lineName(editable ? draft.lineId : task?.lineId)], ['责任线长', ownerName(editable ? draft.ownerId : task?.ownerId)],
  ];
  if (kind !== 'cancel') summary.push(['备注', draft.note.trim() || '—']);
  if (kind === 'adjust' || kind === 'cancel') summary.push([kind === 'cancel' ? '取消原因' : '调整原因', draft.reason.trim()]);
  const changes: [string, string, string][] = task && kind === 'adjust' ? [['计划数量', quantityLabel(task.quantity), quantityLabel(count)], ['计划日期', task.date, draft.date], ['计划产线', lineName(task.lineId), lineName(draft.lineId)], ['责任线长', ownerName(task.ownerId), ownerName(draft.ownerId)]] : [];
  const reportedFacts = task && task.reported > 0 ? <dl className="planning-action-facts grid min-w-0 grid-cols-3 gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5"><div><dt className="text-muted-foreground">{t('已报工')}</dt><dd className="tabular-nums font-medium">{quantityLabel(task.reported)}</dd></div><div><dt className="text-muted-foreground">{t('合格完成')}</dt><dd className="tabular-nums font-medium">{quantityLabel(task.qualified)}</dd></div><div><dt className="text-muted-foreground">{t('待复验')}</dt><dd className="tabular-nums font-medium">{quantityLabel(task.rework)}</dd></div><div className="col-span-3 text-pretty text-muted-foreground">{t('报工日期')}：{task.actualDate || t('待补齐')} · {t('实际产线')}：{task.actualLineId ? lineName(task.actualLineId) : t('待补齐')}</div></dl> : null;

  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="planning-action-title" aria-busy={busy} className="planning-action-form min-w-0">
      <header className="border-b border-border pb-3"><h3 id="planning-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(planningActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(impactText[kind])}</p></header>
      <div className="planning-action-fields py-4">
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{batch?.code ?? t('批次待选择')} · {t('操作人')}：{actor?.name ?? '—'}</p>
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-pretty text-xs leading-5 text-amber-900">{[...new Set(blockers)].map((message) => <p key={message}>{t(message)}</p>)}</div>}
        {kind === 'create' ? selectField('operationId', '组件 / 工序', batch?.operations.map((item) => ({ id: item.id, label: `${item.component} / ${item.process}` })) ?? []) : <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5"><p className="break-words font-medium">{task?.code ?? '—'} · {operation?.component ?? '—'} / {operation?.process ?? '—'}</p>{!editable && <p className="mt-1 text-muted-foreground">{task?.date ?? '—'} · {lineName(task?.lineId)} · {ownerName(task?.ownerId)} · <span className="tabular-nums">{quantityLabel(count)}</span></p>}</div>}
        {editable && <>
          <div className="planning-action-field min-w-0 space-y-1.5">{labelFor('date', '计划日期')}<Input {...propsFor('date')} type="date" required value={draft.date} min={batch?.startDate} max={batch?.endDate} onChange={(event) => change('date', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('date')}</div>
          <div className="planning-action-field min-w-0 space-y-1.5">{labelFor('quantity', operation ? `计划数量（${operation.unit}）` : '计划数量')}<Input {...propsFor('quantity')} required inputMode="numeric" value={draft.quantity} onChange={(event) => change('quantity', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('quantity')}</div>
          {selectField('lineId', '计划产线', allowedLines.map((line) => ({ id: line.id, label: line.name })))}
          {selectField('ownerId', '责任线长', allowedOwners.map((person) => ({ id: person.id, label: person.name })))}
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('可安排日期')}：<span className="tabular-nums">{batch?.startDate ?? '—'} ~ {batch?.endDate ?? '—'}</span>{operation && <><br />{t('本任务最多可安排')} <span className="tabular-nums font-medium text-foreground">{quantityLabel(availableQuantity)}</span>。{t('同工序的其他有效任务已计入总量。')}</>}</p>
          {reportedFacts}{paragraphField('note', '计划备注（选填）', false)}
        </>}
        {kind === 'dispatch' && <>
          <section className="min-w-0 rounded-lg border border-border px-3 py-3"><h4 className="text-balance text-xs font-semibold">{t('本次用料需求')}</h4>{operation?.materials.length ? <ul className="mt-2 space-y-2 text-xs leading-5">{operation.materials.map((material) => <li key={material.id} className="flex min-w-0 justify-between gap-3"><span className="min-w-0 break-words">{material.code} · {material.name}</span><strong className="shrink-0 tabular-nums font-medium">{numberLabel(material.perUnit * count)} {material.unit}</strong></li>)}</ul> : <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t('当前工序未配置用料明细，请核对工序与 BOM 依据。')}</p>}</section>
          <div className="space-y-1.5"><label className="flex cursor-pointer items-start gap-2 text-pretty text-sm leading-6"><input {...propsFor('reviewed')} required type="checkbox" checked={draft.reviewed} onChange={(event) => change('reviewed', event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" /><span>{t('已核对批次、工序、计划数量、责任线长及用料需求')}</span></label>{fieldError('reviewed')}</div>{paragraphField('note', '派工备注（选填）', false)}
        </>}
        {(kind === 'adjust' || kind === 'cancel') && paragraphField('reason', kind === 'cancel' ? '取消原因' : '调整原因')}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(kind === 'dispatch' ? '派工与用料需求已生成。' : kind === 'cancel' ? '任务已取消，原记录与原因已保留。' : '计划已保存，原有报工记录已保留。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" variant={kind === 'cancel' ? 'destructive' : 'default'} disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="planning-action-confirm proc-horizon-overlay min-w-0" overlayClassName="planning-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t(impactText[kind])}</AlertDialogDescription></AlertDialogHeader>
      <dl className="planning-action-confirm-summary min-w-0 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className={cn('min-w-0', ['组件 / 工序', '备注', '调整原因', '取消原因'].includes(label) && 'planning-action-summary-wide')}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty font-medium">{value}</dd></div>)}</dl>
      {changes.length > 0 && <div className="min-w-0 overflow-x-auto"><table className="planning-action-comparison w-full text-left text-xs leading-5"><thead><tr><th scope="col">{t('调整项')}</th><th scope="col">{t('原计划')}</th><th scope="col">{t('本次计划')}</th></tr></thead><tbody>{changes.map(([label, before, after]) => <tr key={label}><th scope="row">{t(label)}</th><td>{before}</td><td className={cn(before !== after && 'font-medium text-primary')}>{after}</td></tr>)}</tbody></table></div>}
      {kind === 'adjust' && reportedFacts}
      {kind === 'dispatch' && <section className="min-w-0 rounded-lg bg-muted/40 px-3 py-3"><h4 className="text-balance text-xs font-semibold">{t('将生成的用料需求')}</h4><ul className="mt-2 space-y-2 text-xs leading-5">{operation?.materials.map((material) => <li key={material.id} className="flex justify-between gap-3"><span className="min-w-0 break-words">{material.code} · {material.name}</span><strong className="shrink-0 tabular-nums font-medium">{numberLabel(material.perUnit * count)} {material.unit}</strong></li>)}</ul></section>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} className={cn(kind === 'cancel' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
