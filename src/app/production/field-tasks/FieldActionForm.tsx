import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { canOperateField, fieldToday, getFieldProgress, getReportUnregistered, getReturnable, validateFieldAction } from './fieldModel';
import { fieldActionLabels, fieldPhenomena, type FieldAction, type FieldActionContext, type FieldPhoto, type FieldReportDraft, type FieldState } from './fieldTypes';
import './field-action-form.css';
import { Checkbox } from "../../components/ui/checkbox";

export interface FieldActionFormProps {
  state: FieldState; actorId: string; context: FieldActionContext; readOnly?: boolean;
  onSubmit: (action: FieldAction) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onCancel: () => void;
}
type TextField = 'date' | 'actual' | 'good' | 'bad' | 'note' | 'issueId' | 'reportId' | 'quantity' | 'phenomenon' | 'description' | 'reason';
type Field = TextField | 'reviewed' | 'photos';
type Draft = Record<TextField, string> & { reviewed: boolean };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['issueId', 'reportId', 'date', 'actual', 'good', 'bad', 'quantity', 'phenomenon', 'description', 'photos', 'note', 'reason', 'reviewed'];
const descriptions = {
  accept: '核对当前派工、批次、工序与责任产线后接收。接收不代表已领料或已报工。',
  sign: '按实际收到的领料单签收整单数量。来源批次缺失时保留待补齐，不自行编造批号。',
  report: '实际完成、自检合格与不良数量均由现场填写。现场自检不等于正式 QC 检验或质量放行。',
  defect: '关联本任务已有报工的不良数量，补充现象与证据；登记不良不重复增加报工不良数量。',
  return: '确认剩余物料尚未使用后提出退料申请，仓库收回与正式库存更新后续处理。',
};
const saveLabels = { accept: '确认接收派工', sign: '确认签收领料', report: '提交报工', defect: '保存不良记录', return: '提交退料申请' };
const confirmLabels = { accept: '确认接收本次派工', sign: '确认整单签收', report: '确认提交报工', defect: '确认保存不良记录', return: '确认提交退料申请' };
const whole = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim())) ? Number(value.trim()) : NaN;
const materialQuantity = (value: string) => /^\d+(?:\.\d{1,3})?$/.test(value.trim()) && Number.isFinite(Number(value.trim())) ? Number(value.trim()) : NaN;
function initialDraft({ state, actorId, context }: FieldActionFormProps): Draft {
  const stored = context.kind === 'report' ? state.drafts[`${actorId}:${context.taskId}`] : undefined;
  return { date: stored?.date ?? fieldToday(), actual: stored?.actual ?? '', good: stored?.good ?? '', bad: stored?.bad ?? '', note: stored?.note ?? '', issueId: context.issueId ?? '', reportId: context.reportId ?? '', quantity: '', phenomenon: '', description: '', reason: '', reviewed: false };
}

export function FieldActionForm(props: FieldActionFormProps) {
  const { state, actorId, context, readOnly, onSubmit, onDirtyChange, onCancel } = props;
  const { kind, taskId } = context;
  const { t } = useI18n();
  const task = state.tasks.find((item) => item.id === taskId);
  const actor = state.actors.find((item) => item.id === actorId);
  const scopeKey = JSON.stringify([actorId, kind, taskId, context.issueId ?? '', context.reportId ?? '']);
  const [draft, setDraft] = useState(() => initialDraft(props));
  const [photos, setPhotos] = useState<FieldPhoto[]>([]);
  const snapshot = JSON.stringify({ draft, photos });
  const clean = useRef(snapshot);
  const initialScope = useRef(scopeKey);
  const initialVersion = useRef(state.version);
  const stateRef = useRef(state); stateRef.current = state;
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const busyRef = useRef(false);
  const photoBusyRef = useRef(false);
  const alive = useRef(true);
  const photoSequence = useRef(0);
  const readers = useRef<FileReader[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: FieldAction; scopeKey: string; version: number } | null>(null);
  const dirty = snapshot !== clean.current || photoBusy;
  const locked = Boolean(readOnly) || busy || photoBusy || Boolean(confirmation) || saved;
  const issue = state.issues.find((item) => item.id === draft.issueId && item.taskId === taskId);
  const report = state.reports.find((item) => item.id === draft.reportId && item.taskId === taskId);
  const availableReports = state.reports.filter((item) => item.taskId === taskId && getReportUnregistered(state, item.id) > 0);
  const availableIssues = state.issues.filter((item) => item.taskId === taskId && (kind === 'sign' ? !item.signedAt : Boolean(item.signedAt)));
  const progress = task ? getFieldProgress(state, taskId) : { reported: 0, good: 0, bad: 0, unreported: 0, unregisteredBad: 0, registeredBad: 0 };
  const number = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
  const count = kind === 'return' ? materialQuantity(draft.quantity) : whole(draft.quantity);
  const unit = kind === 'return' || kind === 'sign' ? issue?.unit ?? '' : task?.unit ?? '';
  const amount = (value: number, quantityUnit = unit) => `${number(value)} ${quantityUnit}`.trim();
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存现场操作。');
  if (!task) blockers.push('未找到当前派工任务，请重新选择。');
  else if (task.closed) blockers.push('当前任务已关闭，仅可查看已有记录。');
  if (!canOperateField(state, actorId, taskId)) blockers.push('请由本任务责任线长或生产主管操作。');
  if (initialScope.current !== scopeKey) blockers.push('当前任务、操作人或关联对象已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version) blockers.push('现场记录已更新，请重新打开表单后核对。填写内容已保留。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; readers.current.forEach((reader) => { if (reader.readyState === 1) reader.abort(); }); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `field-action-${field}`;
  const fixed = (field: Field) => (field === 'issueId' && Boolean(context.issueId)) || (field === 'reportId' && Boolean(context.reportId));
  function focusField(field: Field) {
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || photoBusyRef.current || locked || fixed(field)) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'reportId' || (field === 'issueId' && kind === 'return') ? { quantity: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined })); setDraftSaved(false);
  }
  function inputFor(saveDraft = false): FieldAction {
    const base = { actorId, taskId };
    if (saveDraft) { const values: FieldReportDraft = { date: draft.date, actual: draft.actual, good: draft.good, bad: draft.bad, note: draft.note }; return { ...base, kind: 'save-draft', draft: values }; }
    if (kind === 'accept') return { ...base, kind, reviewed: draft.reviewed };
    if (kind === 'sign') return { ...base, kind, issueId: draft.issueId, reviewed: draft.reviewed };
    if (kind === 'report') return { ...base, kind, date: draft.date, actual: whole(draft.actual), good: whole(draft.good), bad: whole(draft.bad), note: draft.note.trim() };
    if (kind === 'defect') return { ...base, kind, reportId: draft.reportId, quantity: count, phenomenon: draft.phenomenon, description: draft.description.trim(), issueId: draft.issueId || null, photos: [...photos] };
    return { ...base, kind, issueId: draft.issueId, quantity: count, reason: draft.reason.trim(), reviewed: draft.reviewed };
  }
  function validate(saveDraft = false): FieldAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((value) => t(value)).join('；');
    const visible: Field[] = kind === 'report' ? ['date', 'actual', 'good', 'bad', 'note'] : kind === 'defect' ? ['reportId', 'quantity', 'phenomenon', 'description', 'issueId', 'photos'] : kind === 'return' ? ['issueId', 'quantity', 'reason', 'reviewed'] : kind === 'sign' ? ['issueId', 'reviewed'] : ['reviewed'];
    const input = inputFor(saveDraft);
    try {
      for (const [field, message] of Object.entries(validateFieldAction(state, input))) {
        if (!message) continue;
        if (visible.includes(field as Field) && !fixed(field as Field)) next[field as Field] = t(message);
        else next.submit = [next.submit, t(message)].filter(Boolean).join('；');
      }
    } catch (cause) { next.submit = cause instanceof Error ? cause.message : t('请核对现场记录后重试。'); }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    return input;
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || photoBusyRef.current || locked) return;
    const input = validate(); if (input) setConfirmation({ input, scopeKey, version: state.version });
  }
  async function persist(input: FieldAction) {
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      clean.current = snapshot; setConfirmation(null); onDirtyChange?.(false);
      if (input.kind === 'save-draft') { initialVersion.current = stateRef.current.version; setDraftSaved(true); }
      else setSaved(true);
    } catch (cause) { if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('现场记录未保存，填写内容已保留，请重试。') }); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function saveDraft() {
    if (kind !== 'report' || busyRef.current || photoBusyRef.current || locked) return;
    const input = validate(true); if (input) await persist(input);
  }
  async function confirm() {
    if (!confirmation || busyRef.current || photoBusyRef.current || saved) return;
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scopeKey !== scopeKey || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) { setConfirmation(null); setErrors({ submit: t('本次操作内容已变化，请重新核对后保存。填写内容已保留。') }); return; }
    await persist(input);
  }
  async function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length || busyRef.current || photoBusyRef.current || locked) return;
    const error = photos.length + files.length > 3 ? t('每次不良记录最多保留 3 张照片。') : files.some((file) => !['image/png', 'image/jpeg'].includes(file.type)) ? t('请选择 JPG 或 PNG 照片。') : files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024) ? t('每张照片须大于 0 且不超过 10 MB。') : '';
    if (error) { setErrors((current) => ({ ...current, photos: error })); focusField('photos'); return; }
    photoBusyRef.current = true; setPhotoBusy(true); setErrors((current) => ({ ...current, photos: undefined }));
    try {
      const selected = await Promise.all(files.map((file) => new Promise<FieldPhoto>((resolve, reject) => {
        const reader = new FileReader(); readers.current.push(reader);
        reader.onerror = () => reject(new Error(t('照片读取失败，请重新选择。')));
        reader.onabort = () => reject(new Error(t('照片读取已取消。')));
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '');
          if (!dataUrl.startsWith(`data:${file.type};base64,`)) { reject(new Error(t('照片内容无效，请重新选择。'))); return; }
          resolve({ id: `field-photo-${Date.now()}-${++photoSequence.current}`, name: file.name, type: file.type as FieldPhoto['type'], size: file.size, dataUrl });
        };
        reader.readAsDataURL(file);
      })));
      if (alive.current) setPhotos((current) => [...current, ...selected]);
    } catch (cause) { if (alive.current) setErrors((current) => ({ ...current, photos: cause instanceof Error ? cause.message : t('照片读取失败，请重新选择。') })); }
    finally { readers.current = readers.current.filter((reader) => reader.readyState === 1); photoBusyRef.current = false; if (alive.current) setPhotoBusy(false); }
  }
  function removePhoto(id: string) { if (busyRef.current || photoBusyRef.current || locked) return; setPhotos((current) => current.filter((photo) => photo.id !== id)); setErrors((current) => ({ ...current, photos: undefined, submit: undefined })); }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked || fixed(field), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)}>{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const selectField = (field: 'issueId' | 'reportId', label: string, options: { id: string; label: string }[], optional = false) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, !optional)}<Select value={optional ? draft[field] || 'unlinked' : draft[field]} disabled={locked || fixed(field)} onValueChange={(value) => change(field, value === 'unlinked' ? '' : value)}><SelectTrigger {...propsFor(field)} aria-required={!optional} className="w-full min-w-0"><SelectValue placeholder={t('请选择{label}', { label: t(label) })} /></SelectTrigger><SelectContent className="field-action-select proc-horizon-overlay">{optional && <SelectItem value="unlinked">{t('未关联领料批次（待补齐）')}</SelectItem>}{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const numericField = (field: 'actual' | 'good' | 'bad' | 'quantity', label: string) => <div className="field-action-short min-w-0 space-y-1.5">{labelFor(field, label)}<Input {...propsFor(field)} required inputMode={kind === 'return' ? 'decimal' : 'numeric'} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-w-0 tabular-nums" />{fieldError(field)}</div>;
  const paragraphField = (field: 'note' | 'description' | 'reason', label: string, required = true) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, required)}<Textarea {...propsFor(field)} required={required} maxLength={field === 'description' ? 2000 : 1000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" />{fieldError(field)}</div>;
  const reviewedField = (label: string) => <div className="space-y-1.5"><label className="flex cursor-pointer items-start gap-2 text-pretty text-sm leading-6"><Checkbox {...propsFor('reviewed')}  required checked={draft.reviewed} onCheckedChange={(checkedValue) => change('reviewed', (checkedValue === true))} className="mt-1 size-4 shrink-0 accent-primary" /><span>{t(label)}</span></label>{fieldError('reviewed')}</div>;
  const issueOptions = availableIssues.map((item) => ({ id: item.id, label: `${item.code} · ${item.materialName} · ${item.lotCode || t('批次待补齐')}` }));
  const summary: [string, string][] = [['操作人', actor?.name ?? '—'], ['任务', task?.code ?? '—'], ['生产批次', task?.batchCode ?? '—'], ['组件 / 工序', task ? `${task.component} / ${task.process}` : '—']];
  if (kind === 'accept') summary.push(['派工单', task?.dispatchCode ?? '—'], ['任务数量', amount(task?.planned ?? NaN)], ['责任产线', task?.lineName ?? '—']);
  if (kind === 'sign') summary.push(['领料单', issue?.code ?? '—'], ['材料', issue ? `${issue.materialCode} · ${issue.materialName}` : '—'], ['整单签收量', amount(issue?.quantity ?? NaN)], ['来料批次', issue?.lotCode || '待补齐']);
  if (kind === 'report') summary.push(['报工日期', draft.date], ['实际完成', amount(whole(draft.actual))], ['现场自检合格', amount(whole(draft.good))], ['不良数量', amount(whole(draft.bad))], ['备注', draft.note.trim() || '—']);
  if (kind === 'defect') summary.push(['原报工单', report?.code ?? '—'], ['登记不良量', amount(count)], ['不良现象', draft.phenomenon], ['现象说明', draft.description.trim()], ['领料单 / 来料批次', issue ? `${issue.code} / ${issue.lotCode || t('待补齐')}` : '未关联，待补齐'], ['照片', photos.length ? photos.map((photo) => photo.name).join('、') : '未添加']);
  if (kind === 'return') summary.push(['领料单', issue?.code ?? '—'], ['材料', issue ? `${issue.materialCode} · ${issue.materialName}` : '—'], ['申请退料量', amount(count)], ['来料批次', issue?.lotCode || '待补齐'], ['退料原因', draft.reason.trim()]);

  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="field-action-title" aria-busy={busy || photoBusy} className="field-action-form min-w-0">
      <header className="border-b border-border pb-3"><h3 id="field-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(fieldActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(descriptions[kind])}</p></header>
      <div className="field-action-fields py-4">
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{task?.code ?? '—'} · {actor?.name ?? '—'} · {task?.component ?? '—'} / {task?.process ?? '—'}</p>
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-pretty text-xs leading-5 text-amber-900">{[...new Set(blockers)].map((message) => <p key={message}>{t(message)}</p>)}</div>}
        {kind === 'accept' && <><p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{task?.dispatchCode ?? '—'} · {task?.batchCode ?? '—'} · {task?.lineName ?? '—'} · <span className="tabular-nums">{amount(task?.planned ?? NaN)}</span></p>{reviewedField('已核对本次派工、批次、工序和责任产线')}</>}
        {kind === 'sign' && <>{selectField('issueId', '待签收领料单', issueOptions)}{issue && <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{issue.materialCode} · {issue.materialName}<br />{t('整单待签收')} <strong className="tabular-nums">{amount(issue.quantity)}</strong> · {t('来料批次')}：{issue.lotCode || t('待补齐')}</p>}{reviewedField('现场已收到并核对该领料单全部数量')}</>}
        {kind === 'report' && <>
          {state.drafts[`${actorId}:${taskId}`] && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('已载入本任务的报工草稿，提交前请再次核对数量。')}</p>}
          <div className="field-action-short min-w-0 space-y-1.5">{labelFor('date', '报工日期')}<Input {...propsFor('date')} type="date" required value={draft.date} max={fieldToday()} onChange={(event) => change('date', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('date')}</div>
          {numericField('actual', `实际完成（${task?.unit ?? ''}）`)}{numericField('good', `现场自检合格（${task?.unit ?? ''}）`)}{numericField('bad', `不良数量（${task?.unit ?? ''}）`)}
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本任务尚未报工')} <strong className="tabular-nums text-foreground">{amount(progress.unreported)}</strong>。{t('实际完成须等于自检合格与不良之和。')}</p>{paragraphField('note', '报工备注（选填）', false)}
        </>}
        {kind === 'defect' && <>
          {selectField('reportId', '关联报工单', availableReports.map((item) => ({ id: item.id, label: `${item.code} · ${item.date} · ${t('未登记')} ${amount(getReportUnregistered(state, item.id))}` })))}
          {numericField('quantity', `本次登记不良（${task?.unit ?? ''}）`)}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('该报工尚可登记')} <strong className="tabular-nums text-foreground">{amount(report ? getReportUnregistered(state, report.id) : 0)}</strong>。{t('登记只补充现象，不再次累计报工不良数量。')}</p>
          <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">{t('不良现象')} <span aria-hidden="true" className="text-destructive">*</span></legend><div className="flex flex-wrap gap-2">{fieldPhenomena.map((phenomenon, index) => <Button key={phenomenon} type="button" {...(index === 0 ? propsFor('phenomenon') : { disabled: locked })} variant={draft.phenomenon === phenomenon ? 'default' : 'outline'} size="sm" aria-pressed={draft.phenomenon === phenomenon} onClick={() => change('phenomenon', phenomenon)}>{t(phenomenon)}</Button>)}</div>{fieldError('phenomenon')}</fieldset>
          {paragraphField('description', draft.phenomenon === '其他' ? '其他现象说明' : '现象说明（选填）', draft.phenomenon === '其他')}
          {selectField('issueId', '关联已签收领料批次（选填）', issueOptions, true)}{(!issue || !issue.lotCode) && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('来料批次待补齐，可保留现有事实继续登记。')}</p>}
          <div className="min-w-0 space-y-2">{labelFor('photos', '现场照片（选填）', false)}<Input {...propsFor('photos')} type="file" multiple accept="image/jpeg,image/png" onChange={choosePhotos} className="h-auto min-h-9 py-2 text-xs" /><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('最多 3 张 JPG / PNG，每张不超过 10 MB。照片仅在本页演示中保存。')}</p>{photoBusy && <p role="status" className="text-xs leading-5">{t('正在读取照片…')}</p>}{fieldError('photos')}{photos.length > 0 && <ul className="field-action-photos">{photos.map((photo) => <li key={photo.id}><img src={photo.dataUrl} alt={t('现场照片：{name}', { name: photo.name })} /><div><span className="min-w-0 break-words text-xs leading-5">{photo.name}</span><Button type="button" size="icon" variant="ghost" disabled={locked} aria-label={t('移除照片 {name}', { name: photo.name })} onClick={() => removePhoto(photo.id)} className="size-8 shrink-0"><X aria-hidden="true" className="size-3.5" /></Button></div></li>)}</ul>}</div>
        </>}
        {kind === 'return' && <>{selectField('issueId', '已签收领料单', issueOptions)}{numericField('quantity', `申请退料数量（${issue?.unit ?? ''}）`)}<p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{t('本页可申请上限')} <strong className="tabular-nums">{amount(issue ? getReturnable(state, issue.id) : 0)}</strong>。{t('上限仅按签收与既有申请记录核对，不是实际库存；请现场确认尚未使用的余料。')}</p>{paragraphField('reason', '退料原因')}{reviewedField('已现场核对，本次申请数量为剩余未使用物料')}</>}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {draftSaved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t('报工草稿已保存，可继续填写；草稿尚未计入数量。')}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(kind === 'return' ? '退料申请已保存，等待仓库处理。' : '现场记录已保存。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || photoBusy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !photoBusyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button>{kind === 'report' && <Button type="button" variant="outline" disabled={locked || blockers.length > 0} onClick={() => void saveDraft()}>{t('保存报工草稿')}</Button>}<Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="field-action-confirm proc-horizon-overlay min-w-0" overlayClassName="field-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t(descriptions[kind])}</AlertDialogDescription></AlertDialogHeader>
      <dl className="field-action-summary min-w-0 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className={cn('min-w-0', ['组件 / 工序', '备注', '现象说明', '领料单 / 来料批次', '照片', '材料', '退料原因'].includes(label) && 'field-action-summary-wide')}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty font-medium">{value}</dd></div>)}</dl>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
