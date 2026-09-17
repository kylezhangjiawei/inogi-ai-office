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
import { fieldPhenomena } from '../field-tasks/fieldTypes';
import { canOperateInspection, getInspectionProgress, getReinspectable, getTransferable, inspectionToday, validateInspectionAction } from './inspectionModel';
import { inspectionActionLabels, type InspectionAction, type InspectionActionContext, type InspectionPhoto, type InspectionState } from './inspectionTypes';
import './inspection-action-form.css';
import { Checkbox } from "../../components/ui/checkbox";

export interface InspectionActionFormProps {
  state: InspectionState; actorId: string; context: InspectionActionContext; readOnly?: boolean;
  onSubmit: (action: InspectionAction) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onCancel: () => void;
}
type TextField = 'date' | 'quantity' | 'good' | 'bad' | 'note' | 'evidence' | 'recordId' | 'issueId' | 'phenomenon' | 'description' | 'basis';
type Field = TextField | 'reviewed' | 'photos';
type Draft = Record<TextField, string> & { reviewed: boolean };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['issueId', 'recordId', 'date', 'quantity', 'good', 'bad', 'evidence', 'photos', 'note', 'phenomenon', 'description', 'basis', 'reviewed'];
const descriptionLabels = {
  accept: '核对报检来源、生产批次及已发布 SIP 后接受报检。接受不表示检验已经通过。',
  inspect: '登记本次初检的实际数量和证据。初检结果独立留存，复验不会回填首次合格率。',
  reinspect: '依据原检验和已完成处置登记复验。复验通过可更新当前合格数量，首次检验结果保持原记录。',
  transfer: '把当前检验记录的尚未转出不良交给不良处理，保留原检验关联，不重复累计不良数量。',
  release: '由 QA 单独记录质量授权放行及依据。放行不代表实物已经出货。',
};
const introLabels = { accept: '核对来源与 SIP 后接受，不代表检验通过。', inspect: '登记初检结果；复验不回填首次合格率。', reinspect: '依据处置凭据复验，保留首次检验结果。', transfer: '整条不良转交处理，不重复累计数量。', release: '独立记录 QA 授权，不代表已经出货。' };
const saveLabels = { accept: '接受报检', inspect: '保存初检记录', reinspect: '保存复验记录', transfer: '转不良处理', release: '保存 QA 放行' };
const confirmLabels = { accept: '确认接受报检', inspect: '确认保存初检记录', reinspect: '确认保存复验记录', transfer: '确认转不良处理', release: '确认记录 QA 放行' };
const whole = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim())) ? Number(value.trim()) : NaN;
function initialDraft(context: InspectionActionContext): Draft {
  return { date: inspectionToday(), quantity: '', good: '', bad: '', note: '', evidence: '', recordId: context.recordId ?? '', issueId: context.issueId ?? '', phenomenon: '', description: '', basis: '', reviewed: false };
}

export function InspectionActionForm({ state, actorId, context, readOnly, onSubmit, onDirtyChange, onCancel }: InspectionActionFormProps) {
  const { kind, taskId } = context;
  const { t } = useI18n();
  const task = state.tasks.find((item) => item.id === taskId);
  const actor = state.actors.find((item) => item.id === actorId);
  const checking = kind === 'inspect' || kind === 'reinspect';
  const scopeKey = JSON.stringify([actorId, kind, taskId, context.recordId ?? '', context.issueId ?? '']);
  const [draft, setDraft] = useState(() => initialDraft(context));
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const snapshot = JSON.stringify({ draft, photos });
  const clean = useRef(snapshot);
  const initialScope = useRef(scopeKey);
  const initialVersion = useRef(state.version);
  const formRef = useRef<HTMLFormElement>(null);
  const optionalRef = useRef<HTMLDetailsElement>(null);
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
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: InspectionAction; scopeKey: string; version: number } | null>(null);
  const dirty = snapshot !== clean.current || photoBusy;
  const locked = Boolean(readOnly) || busy || photoBusy || Boolean(confirmation) || saved;
  const sip = task?.documents.find((item) => /^SIP(?:-|$)/i.test(item.code) && item.status === 'published' && item.version.trim());
  const issue = state.issues.find((item) => item.id === draft.issueId && item.taskId === taskId);
  const sourceRecord = state.records.find((item) => item.id === (kind === 'reinspect' ? issue?.recordId : draft.recordId) && item.taskId === taskId);
  const initialRecord = sourceRecord?.originalId ? state.records.find((item) => item.id === sourceRecord.originalId && item.taskId === taskId) : sourceRecord;
  const availableIssues = state.issues.filter((item) => item.taskId === taskId && getReinspectable(state, item.id) > 0);
  const availableRecords = state.records.filter((item) => item.taskId === taskId && getTransferable(state, item.id) > 0);
  const progress = task ? getInspectionProgress(state, taskId) : null;
  const quantity = whole(draft.quantity), good = whole(draft.good), bad = whole(draft.bad);
  const validCounts = Number.isSafeInteger(quantity) && quantity > 0 && Number.isSafeInteger(good) && good >= 0 && Number.isSafeInteger(bad) && bad >= 0 && good + bad === quantity;
  const conclusion = validCounts ? bad > 0 ? '不合格' : '合格' : '待核对数量';
  const number = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale()) : '—';
  const amount = (value: number) => `${number(value)} ${task?.unit ?? ''}`.trim();
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存检验操作。');
  if (!task) blockers.push('未找到当前检验任务，请重新选择。');
  else if (task.closed) blockers.push('当前检验任务已关闭，仅可查看。');
  if (!canOperateInspection(state, actorId, taskId, kind)) blockers.push(kind === 'release' ? '请由 QA 放行岗位完成此操作。' : '请由 QC 检验岗位完成此操作。');
  if (initialScope.current !== scopeKey) blockers.push('当前任务、操作人或关联对象已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version) blockers.push('检验记录已更新，请重新打开表单后核对。填写内容已保留。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; readers.current.forEach((reader) => { if (reader.readyState === 1) reader.abort(); }); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `inspection-action-${field}`;
  const fixed = (field: Field) => (field === 'recordId' && Boolean(context.recordId)) || (field === 'issueId' && Boolean(context.issueId));
  function focusField(field: Field) {
    if (['note', 'photos'].includes(field) && optionalRef.current) optionalRef.current.open = true;
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || photoBusyRef.current || locked || fixed(field)) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'issueId' ? { quantity: '', good: '', bad: '', reviewed: false } : {}), ...(field === 'recordId' ? { reviewed: false } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
  }
  function inputFor(): InspectionAction {
    const base = { actorId, taskId };
    if (kind === 'accept') return { ...base, kind, reviewed: draft.reviewed };
    if (kind === 'transfer') return { ...base, kind, recordId: draft.recordId, phenomenon: draft.phenomenon, description: draft.description.trim(), reviewed: draft.reviewed };
    if (kind === 'release') return { ...base, kind, quantity, basis: draft.basis.trim(), note: draft.note.trim(), reviewed: draft.reviewed };
    const values = { ...base, date: draft.date, quantity, good, bad, evidence: draft.evidence.trim(), note: draft.note.trim(), photos: [...photos], reviewed: draft.reviewed };
    return kind === 'reinspect' ? { ...values, kind, issueId: draft.issueId } : { ...values, kind };
  }
  function validate(): InspectionAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((value) => t(value)).join('；');
    const visible: Field[] = checking ? ['issueId', 'date', 'quantity', 'good', 'bad', 'evidence', 'photos', 'note', 'reviewed'] : kind === 'transfer' ? ['recordId', 'phenomenon', 'description', 'reviewed'] : kind === 'release' ? ['quantity', 'basis', 'note', 'reviewed'] : ['reviewed'];
    const input = inputFor();
    try {
      for (const [field, message] of Object.entries(validateInspectionAction(state, input))) {
        if (!message) continue;
        if (visible.includes(field as Field) && !fixed(field as Field)) next[field as Field] = t(message);
        else next.submit = [next.submit, t(message)].filter(Boolean).join('；');
      }
    } catch (cause) { next.submit = cause instanceof Error ? cause.message : t('请核对检验记录后重试。'); }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    return input;
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || photoBusyRef.current || locked) return;
    const input = validate(); if (input) setConfirmation({ input, scopeKey, version: state.version });
  }
  async function confirm() {
    if (!confirmation || busyRef.current || photoBusyRef.current || saved) return;
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scopeKey !== scopeKey || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) { setConfirmation(null); setErrors({ submit: t('本次操作内容已变化，请重新核对后保存。填写内容已保留。') }); return; }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      clean.current = snapshot; setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) { if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('检验记录未保存，填写内容已保留，请重试。') }); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length || busyRef.current || photoBusyRef.current || locked) return;
    if (optionalRef.current) optionalRef.current.open = true;
    const error = photos.length + files.length > 3 ? t('每次检验最多保留 3 张照片。') : files.some((file) => !['image/png', 'image/jpeg'].includes(file.type)) ? t('请选择 JPG 或 PNG 照片。') : files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024) ? t('每张照片须大于 0 且不超过 10 MB。') : '';
    if (error) { setErrors((current) => ({ ...current, photos: error })); focusField('photos'); return; }
    photoBusyRef.current = true; setPhotoBusy(true); setErrors((current) => ({ ...current, photos: undefined }));
    try {
      const selected = await Promise.all(files.map((file) => new Promise<InspectionPhoto>((resolve, reject) => {
        const reader = new FileReader(); readers.current.push(reader);
        reader.onerror = () => reject(new Error(t('照片读取失败，请重新选择。')));
        reader.onabort = () => reject(new Error(t('照片读取已取消。')));
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '');
          if (!dataUrl.startsWith(`data:${file.type};base64,`)) { reject(new Error(t('照片内容无效，请重新选择。'))); return; }
          resolve({ id: `inspection-photo-${Date.now()}-${++photoSequence.current}`, name: file.name, type: file.type as InspectionPhoto['type'], size: file.size, dataUrl });
        };
        reader.readAsDataURL(file);
      })));
      if (alive.current) setPhotos((current) => [...current, ...selected]);
    } catch (cause) { if (alive.current) setErrors((current) => ({ ...current, photos: cause instanceof Error ? cause.message : t('照片读取失败，请重新选择。') })); }
    finally { readers.current = readers.current.filter((reader) => reader.readyState === 1); photoBusyRef.current = false; if (alive.current) setPhotoBusy(false); }
  }
  function removePhoto(id: string) { if (busyRef.current || photoBusyRef.current || locked) return; setPhotos((current) => current.filter((photo) => photo.id !== id)); setErrors((current) => ({ ...current, photos: undefined, submit: undefined })); }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked || fixed(field), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="iaf-field-error text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)} className="iaf-field-label">{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const selectField = (field: 'recordId' | 'issueId', label: string, options: { id: string; label: string }[]) => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<Select value={draft[field]} disabled={locked || fixed(field)} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择{label}', { label: t(label) })} /></SelectTrigger><SelectContent className="inspection-action-select proc-horizon-overlay">{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const numericField = (field: 'quantity' | 'good' | 'bad', label: string) => <div className="iaf-short min-w-0 space-y-1.5">{labelFor(field, label)}<Input {...propsFor(field)} required inputMode="numeric" value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-w-0 tabular-nums" />{fieldError(field)}</div>;
  const paragraphField = (field: 'note' | 'evidence' | 'description' | 'basis', label: string, required = true) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, required)}<Textarea {...propsFor(field)} required={required} maxLength={['evidence', 'description'].includes(field) ? 2000 : 1000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" />{fieldError(field)}</div>;
  const reviewedField = (label: string) => <div className="space-y-1.5"><label className="flex cursor-pointer items-start gap-2 text-pretty text-sm leading-6"><Checkbox {...propsFor('reviewed')}  required checked={draft.reviewed} onCheckedChange={(checkedValue) => change('reviewed', (checkedValue === true))} className="mt-1 size-4 shrink-0 accent-primary" /><span>{t(label)}</span></label>{fieldError('reviewed')}</div>;
  const summary: [string, string][] = [['操作人', actor?.name ?? '—'], ['检验任务', task?.code ?? '—'], ['生产批次', task?.batchCode ?? '—'], ['生产工序', task?.process ?? '—']];
  if (kind === 'accept') summary.push(['报检来源', task?.reportCode ?? '—'], ['待检数量', amount(task?.quantity ?? NaN)]);
  if (kind !== 'release') summary.push(['本次 SIP 版本', sip ? `${sip.code} · ${sip.version}` : '待补齐']);
  if (kind === 'reinspect') summary.push(['原检验号', initialRecord?.code ?? '—'], ['原检验 SIP', initialRecord ? `${initialRecord.sipCode} · ${initialRecord.sipVersion}` : '—'], ['不良 / 处置单', `${issue?.code ?? '—'} / ${issue?.dispositionCode ?? '待补齐'}`]);
  if (checking) summary.push(['检验日期', draft.date], [kind === 'inspect' ? '本次初检量' : '本次复验量', amount(quantity)], ['合格数量', amount(good)], ['不良数量', amount(bad)], ['本次结论', conclusion], ['现场读数 / 记录依据', draft.evidence.trim()], ['备注', draft.note.trim() || '—'], ['照片', photos.length ? photos.map((photo) => photo.name).join('、') : '未添加']);
  if (kind === 'transfer') summary.push(['原检验号', sourceRecord?.code ?? '—'], ['转不良处理数量', amount(sourceRecord ? getTransferable(state, sourceRecord.id) : NaN)], ['不良现象', draft.phenomenon], ['现象说明', draft.description.trim() || '—']);
  if (kind === 'release') summary.push(['本次授权放行量', amount(quantity)], ['授权依据', draft.basis.trim()], ['备注', draft.note.trim() || '—']);

  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="inspection-action-title" aria-busy={busy || photoBusy} className="inspection-action-form min-w-0">
      <header className="iaf-heading border-b border-border pb-2.5"><h3 id="inspection-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(inspectionActionLabels[kind])}</h3><p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{t(introLabels[kind])}</p></header>
      <div className="iaf-fields py-3">
        <p className="truncate text-xs leading-5 text-muted-foreground" title={`${task?.code ?? '—'} · ${actor?.name ?? '—'} · ${task?.batchCode ?? '—'}`}>{task?.code ?? '—'} · {actor?.name ?? '—'} · {task?.batchCode ?? '—'}</p>
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-pretty text-xs leading-5 text-amber-900">{[...new Set(blockers)].map((message) => <p key={message}>{t(message)}</p>)}</div>}
        {kind !== 'release' && <p className="text-pretty text-xs leading-5">{t('本次 SIP')}：<strong>{sip ? `${sip.code} · ${sip.version}` : t('发布版本待补齐')}</strong></p>}
        {kind === 'accept' && <><p className="text-pretty text-xs leading-5">{t('报检来源')}：{task?.reportCode ?? '—'} · {task?.process ?? '—'} · <strong className="tabular-nums">{amount(task?.quantity ?? NaN)}</strong></p>{reviewedField('已核对报检来源、批次、数量和已发布 SIP')}</>}
        {kind === 'reinspect' && <>{selectField('issueId', '已完成处置的不良单', availableIssues.map((item) => ({ id: item.id, label: `${item.code} · ${item.dispositionCode || t('处置单待补齐')}` })))}{issue && <div className="iaf-source min-w-0 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5"><dl className="grid grid-cols-2 gap-2"><div><dt className="text-muted-foreground">{t('原检验号')}</dt><dd className="break-words">{initialRecord?.code ?? '—'}</dd></div><div><dt className="text-muted-foreground">{t('处置单号')}</dt><dd className="break-words">{issue.dispositionCode || t('待补齐')}</dd></div></dl><details className="iaf-disclosure mt-1.5"><summary>{t('原 SIP 与处置说明')}</summary><p className="mt-1.5 break-words">{t('原检验 SIP')}：{initialRecord ? `${initialRecord.sipCode} · ${initialRecord.sipVersion}` : t('待补齐')}</p><p className="mt-1 text-pretty text-muted-foreground">{issue.dispositionNote || t('处置说明待补齐')}</p></details></div>}</>}
        {checking && <>
          <div className="iaf-short min-w-0 space-y-1.5">{labelFor('date', '检验日期')}<Input {...propsFor('date')} type="date" required value={draft.date} max={inspectionToday()} onChange={(event) => change('date', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('date')}</div>
          {numericField('quantity', `${kind === 'inspect' ? '初检' : '复验'}数量（${task?.unit ?? ''}）`)}{numericField('good', `合格数量（${task?.unit ?? ''}）`)}{numericField('bad', `不良数量（${task?.unit ?? ''}）`)}
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t(kind === 'inspect' ? '本任务尚未初检' : '当前可复验')} <strong className="tabular-nums text-foreground">{amount(kind === 'inspect' ? progress?.uninspected ?? 0 : issue ? getReinspectable(state, issue.id) : 0)}</strong> · {t('本次结论')}：<strong className={cn(validCounts && bad > 0 ? 'text-destructive' : 'text-foreground')}>{t(conclusion)}</strong></p>
          {paragraphField('evidence', '现场读数 / 检验记录依据')}
          <details ref={optionalRef} className="iaf-disclosure iaf-optional"><summary>{t('备注与照片（选填）')}</summary><div className="space-y-3 pt-3">{paragraphField('note', '检验备注（选填）', false)}
          <div className="min-w-0 space-y-2">{labelFor('photos', '检验证据照片（选填）', false)}<Input {...propsFor('photos')} type="file" multiple accept="image/jpeg,image/png" onChange={choosePhotos} className="h-auto min-h-9 py-2 text-xs" /><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('最多 3 张 JPG / PNG，每张不超过 10 MB；照片仅保留在本页演示。')}</p>{photoBusy && <p role="status" className="text-xs leading-5">{t('正在读取照片…')}</p>}{fieldError('photos')}{photos.length > 0 && <ul className="iaf-photos">{photos.map((photo) => <li key={photo.id}><img src={photo.dataUrl} alt={t('检验证据：{name}', { name: photo.name })} /><div><span className="min-w-0 break-words text-xs leading-5">{photo.name}</span><Button type="button" size="icon" variant="ghost" disabled={locked} aria-label={t('移除照片 {name}', { name: photo.name })} onClick={() => removePhoto(photo.id)} className="size-8 shrink-0"><X aria-hidden="true" className="size-3.5" /></Button></div></li>)}</ul>}</div>
          </div></details>
          {reviewedField('已按本次显示的 SIP 版本核对检验项目、数量和依据')}
        </>}
        {kind === 'transfer' && <>
          {selectField('recordId', '待转不良的检验记录', availableRecords.map((item) => ({ id: item.id, label: `${item.code} · ${t(item.kind === 'initial' ? '初检' : '复验')} · ${amount(getTransferable(state, item.id))}` })))}
          <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{t('本次转交当前记录全部尚未转出不良')} <strong className="tabular-nums">{amount(sourceRecord ? getTransferable(state, sourceRecord.id) : 0)}</strong>。</p>
          <fieldset className="min-w-0 space-y-2"><legend className="iaf-field-label mb-2 text-sm font-medium">{t('不良现象')} <span aria-hidden="true" className="text-destructive">*</span></legend><div className="flex flex-wrap gap-2">{fieldPhenomena.map((phenomenon, index) => <Button key={phenomenon} type="button" {...(index === 0 ? propsFor('phenomenon') : { disabled: locked })} variant={draft.phenomenon === phenomenon ? 'default' : 'outline'} size="sm" aria-pressed={draft.phenomenon === phenomenon} onClick={() => change('phenomenon', phenomenon)}>{t(phenomenon)}</Button>)}</div>{fieldError('phenomenon')}</fieldset>
          {paragraphField('description', draft.phenomenon === '其他' ? '其他现象说明' : '现象说明（选填）', draft.phenomenon === '其他')}{reviewedField('已核对原检验与不良数量，按当前记录转交处理')}
        </>}
        {kind === 'release' && <><p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{t('当前检验合格')} <strong className="tabular-nums">{amount(progress?.qualified ?? 0)}</strong> · {t('已授权放行')} <strong className="tabular-nums">{amount(progress?.released ?? 0)}</strong><br />{t('本次最多可放行')} <strong className="tabular-nums">{amount(progress?.releasable ?? 0)}</strong>。</p>{numericField('quantity', `本次放行数量（${task?.unit ?? ''}）`)}{paragraphField('basis', 'QA 授权依据')}{paragraphField('note', '放行备注（选填）', false)}{reviewedField('已核对当前合格数量和独立质量授权依据')}</>}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(kind === 'release' ? 'QA 放行记录已保存，实际出货仍需另行登记。' : '检验操作已保存，原始记录已保留。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || photoBusy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !photoBusyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="inspection-action-confirm proc-horizon-overlay min-w-0" overlayClassName="inspection-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t(descriptionLabels[kind])}</AlertDialogDescription></AlertDialogHeader>
      <dl className="iaf-summary min-w-0 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className={cn('min-w-0', ['本次 SIP 版本', '原检验 SIP', '不良 / 处置单', '现场读数 / 记录依据', '备注', '照片', '现象说明', '授权依据'].includes(label) && 'iaf-summary-wide')}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty font-medium">{value}</dd></div>)}</dl>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
