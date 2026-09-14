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
import { canOperateDefect, defectToday, getDefectOwners, getDefectProgress, getHandoffAvailable, validateDefectAction } from './defectModel';
import { defectActionLabels, defectDirectionLabels, type DefectAction, type DefectActionContext, type DefectPhoto, type DefectState } from './defectTypes';
import './defect-action-form.css';

export interface DefectActionFormProps {
  state: DefectState; actorId: string; context: DefectActionContext; readOnly?: boolean;
  onSubmit: (action: DefectAction) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onCancel: () => void;
}
type TextField = 'ownerId' | 'dueDate' | 'priority' | 'reason' | 'direction' | 'description' | 'causeStatus' | 'cause' | 'date' | 'quantity' | 'basis' | 'repairId' | 'summary';
type Field = TextField | 'reviewed' | 'photos';
type Draft = Record<TextField, string> & { reviewed: boolean };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['direction', 'ownerId', 'dueDate', 'priority', 'reason', 'causeStatus', 'cause', 'description', 'repairId', 'date', 'quantity', 'basis', 'photos', 'summary', 'reviewed'];
const intros = { assign: '明确责任人与期限，保留原不良来源。', route: '确定处理方向；根因未明确时可继续排查。', repair: '记录已完成整改的实物数量和依据。', handoff: '将已整改数量交给 QC，等待独立复验结果。', close: '核对全部不良已解决后，记录关闭结论。' };
const descriptions = { assign: '本次仅更新责任人、期限与优先级，来源数量和历史记录保持不变。', route: '保留原不良关联。研发或采购协同仅创建本页协同记录，不代表对方已完成处理。根因待确认不妨碍继续排查。', repair: '记录现场整改及依据，整改完成不表示复验合格，也不自动产生 QA 放行。', handoff: '本次提交后等待 QC 复验回执。提交复验不改写原检验结果，不自动更新合格数量。', close: '仅在全部不良均有合格复验回执且无在途交接时关闭。关闭不良不代表 QA 放行或已经出货。' };
const saveLabels = { assign: '保存指派', route: '保存处理方向', repair: '保存整改记录', handoff: '提交复验', close: '关闭不良' };
const confirmLabels = { assign: '确认保存指派', route: '确认处理方向', repair: '确认保存整改记录', handoff: '确认提交复验', close: '确认关闭不良' };
const whole = (value: string) => /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim())) ? Number(value.trim()) : NaN;
function initialDraft(state: DefectState, context: DefectActionContext): Draft {
  const issue = state.issues.find((item) => item.id === context.issueId);
  const direction = context.direction ?? (issue?.direction === 'pending' ? '' : issue?.direction ?? '');
  const matchingOwner = getDefectOwners(state, context.issueId, (direction || 'pending') as keyof typeof defectDirectionLabels).some((item) => item.id === issue?.ownerId);
  return { ownerId: context.kind === 'route' && !matchingOwner ? '' : issue?.ownerId ?? '', dueDate: issue?.dueDate ?? '', priority: issue?.priority ?? 'medium', reason: '', direction, description: '', causeStatus: issue?.causeStatus ?? 'pending', cause: issue?.cause ?? '', date: defectToday(), quantity: '', basis: '', repairId: context.repairId ?? '', summary: '', reviewed: false };
}

export function DefectActionForm({ state, actorId, context, readOnly, onSubmit, onDirtyChange, onCancel }: DefectActionFormProps) {
  const { kind, issueId } = context;
  const { t } = useI18n();
  const issue = state.issues.find((item) => item.id === issueId);
  const actor = state.actors.find((item) => item.id === actorId);
  const scopeKey = JSON.stringify([actorId, kind, issueId, context.repairId ?? '', context.direction ?? '']);
  const liveScope = useRef({ scopeKey, version: state.version, readOnly }); liveScope.current = { scopeKey, version: state.version, readOnly };
  const [draft, setDraft] = useState(() => initialDraft(state, context));
  const [photos, setPhotos] = useState<DefectPhoto[]>([]);
  const snapshot = JSON.stringify({ draft, photos });
  const clean = useRef(snapshot), initialScope = useRef(scopeKey), initialVersion = useRef(state.version);
  const formRef = useRef<HTMLFormElement>(null), optionalRef = useRef<HTMLDetailsElement>(null), submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null), busyRef = useRef(false), photoBusyRef = useRef(false), alive = useRef(true), photoSequence = useRef(0);
  const readers = useRef<FileReader[]>([]);
  const [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: DefectAction; scopeKey: string; version: number } | null>(null);
  const dirty = snapshot !== clean.current || photoBusy;
  const locked = Boolean(readOnly) || busy || photoBusy || Boolean(confirmation) || saved;
  const progress = issue ? getDefectProgress(state, issueId) : null;
  const quantity = whole(draft.quantity);
  const repair = state.repairs.find((item) => item.id === draft.repairId && item.issueId === issueId);
  const repairs = state.repairs.filter((item) => item.issueId === issueId && getHandoffAvailable(state, item.id) > 0);
  const owners = getDefectOwners(state, issueId, kind === 'route' ? (draft.direction || 'pending') as keyof typeof defectDirectionLabels : undefined);
  const ownerName = state.actors.find((item) => item.id === draft.ownerId)?.name ?? '—';
  const amount = (value: number) => `${Number.isFinite(value) ? value.toLocaleString(i18nLocale()) : '—'} ${issue?.unit ?? ''}`.trim();
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存不良处理操作。');
  if (!issue) blockers.push('未找到当前不良单，请重新选择。');
  else if (issue.closedAt) blockers.push('当前不良单已关闭，仅可查看。');
  if (!canOperateDefect(state, actorId, issueId, kind)) blockers.push('当前岗位无权进行此操作，请切换有权限的责任岗位。');
  if (initialScope.current !== scopeKey) blockers.push('当前不良、操作人或关联对象已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version) blockers.push('不良记录已更新，请重新打开表单后核对。填写内容已保留。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; readers.current.forEach((reader) => { if (reader.readyState === 1) reader.abort(); }); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `defect-action-${field}`;
  const fixed = (field: Field) => (field === 'repairId' && Boolean(context.repairId)) || (field === 'direction' && Boolean(context.direction));
  function focusField(field: Field) {
    if (field === 'photos' && optionalRef.current) optionalRef.current.open = true;
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || photoBusyRef.current || locked || fixed(field)) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field !== 'reviewed' ? { reviewed: false } : {}), ...(field === 'direction' ? { ownerId: '' } : {}), ...(field === 'repairId' ? { quantity: '' } : {}), ...(field === 'causeStatus' && value === 'pending' ? { cause: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
  }
  function inputFor(): DefectAction {
    const base = { actorId, issueId, reviewed: draft.reviewed };
    if (kind === 'assign') return { ...base, kind, ownerId: draft.ownerId, dueDate: draft.dueDate, priority: draft.priority as 'high' | 'medium' | 'low', reason: draft.reason.trim() };
    if (kind === 'route') return { ...base, kind, direction: draft.direction as 'onsite' | 'rd' | 'procurement', ownerId: draft.ownerId, dueDate: draft.dueDate, description: draft.description.trim(), causeStatus: draft.causeStatus as 'pending' | 'confirmed', cause: draft.causeStatus === 'confirmed' ? draft.cause.trim() : '' };
    if (kind === 'repair') return { ...base, kind, date: draft.date, quantity, description: draft.description.trim(), basis: draft.basis.trim(), photos: photos.map((photo) => ({ ...photo })) };
    if (kind === 'handoff') return { ...base, kind, repairId: draft.repairId, quantity };
    return { ...base, kind, summary: draft.summary.trim() };
  }
  function validate(): DefectAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((value) => t(value)).join('；');
    const visible: Field[] = kind === 'assign' ? ['ownerId', 'dueDate', 'priority', 'reason', 'reviewed'] : kind === 'route' ? ['direction', 'ownerId', 'dueDate', 'description', 'causeStatus', 'cause', 'reviewed'] : kind === 'repair' ? ['date', 'quantity', 'description', 'basis', 'photos', 'reviewed'] : kind === 'handoff' ? ['repairId', 'quantity', 'reviewed'] : ['summary', 'reviewed'];
    const input = inputFor();
    try {
      for (const [field, message] of Object.entries(validateDefectAction(state, input))) {
        if (!message) continue;
        if (visible.includes(field as Field) && !fixed(field as Field)) next[field as Field] = t(message);
        else next.submit = [next.submit, t(message)].filter(Boolean).join('；');
      }
    } catch (cause) { next.submit = cause instanceof Error ? cause.message : t('请核对不良记录后重试。'); }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (Object.keys(next).length) { if (invalidFocus.current && !confirmation) focusField(invalidFocus.current); return null; }
    return input;
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || photoBusyRef.current || locked) return;
    if (liveScope.current.scopeKey !== scopeKey || liveScope.current.version !== state.version || liveScope.current.readOnly) return;
    const input = validate(); if (input) setConfirmation({ input, scopeKey, version: state.version });
  }
  async function confirm() {
    if (!confirmation || busyRef.current || photoBusyRef.current || saved) return;
    if (liveScope.current.scopeKey !== scopeKey || liveScope.current.version !== state.version || liveScope.current.readOnly) { setConfirmation(null); setErrors({ submit: t('当前不良或岗位已变化，请重新核对后保存。填写内容已保留。') }); return; }
    const input = validate(); if (!input) { setConfirmation(null); return; }
    if (confirmation.scopeKey !== scopeKey || confirmation.version !== state.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) { setConfirmation(null); setErrors({ submit: t('本次操作内容已变化，请重新核对后保存。填写内容已保留。') }); return; }
    busyRef.current = true; setBusy(true); setErrors({});
    const submissionScope = liveScope.current;
    try {
      await onSubmit(input); if (!alive.current || submissionScope.scopeKey !== liveScope.current.scopeKey || submissionScope.version !== liveScope.current.version || liveScope.current.readOnly) return;
      clean.current = snapshot; setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) { if (alive.current && submissionScope.scopeKey === liveScope.current.scopeKey) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('不良处理未保存，填写内容已保留，请重试。') }); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  async function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length || busyRef.current || photoBusyRef.current || locked) return;
    if (optionalRef.current) optionalRef.current.open = true;
    const error = photos.length + files.length > 3 ? t('每次整改最多保留 3 张照片。') : files.some((file) => !['image/png', 'image/jpeg'].includes(file.type)) ? t('请选择 JPG 或 PNG 照片。') : files.some((file) => file.size <= 0 || file.size > 10 * 1024 * 1024) ? t('每张照片须大于 0 且不超过 10 MB。') : '';
    if (error) { setErrors((current) => ({ ...current, photos: error })); focusField('photos'); return; }
    photoBusyRef.current = true; setPhotoBusy(true); setErrors((current) => ({ ...current, photos: undefined }));
    const selectionScope = liveScope.current;
    try {
      const selected = await Promise.all(files.map((file) => new Promise<DefectPhoto>((resolve, reject) => {
        const reader = new FileReader(); readers.current.push(reader);
        reader.onerror = () => reject(new Error(t('照片读取失败，请重新选择。')));
        reader.onabort = () => reject(new Error(t('照片读取已取消。')));
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '');
          if (!dataUrl.startsWith(`data:${file.type};base64,`)) { reject(new Error(t('照片内容无效，请重新选择。'))); return; }
          resolve({ id: `defect-photo-${Date.now()}-${++photoSequence.current}`, name: file.name, type: file.type as DefectPhoto['type'], size: file.size, dataUrl });
        };
        reader.readAsDataURL(file);
      })));
      if (alive.current && selectionScope.scopeKey === liveScope.current.scopeKey && selectionScope.version === liveScope.current.version && !liveScope.current.readOnly) { setPhotos((current) => [...current, ...selected]); setDraft((current) => ({ ...current, reviewed: false })); }
    } catch (cause) { if (alive.current && selectionScope.scopeKey === liveScope.current.scopeKey) setErrors((current) => ({ ...current, photos: cause instanceof Error ? cause.message : t('照片读取失败，请重新选择。') })); }
    finally { readers.current = readers.current.filter((reader) => reader.readyState === 1); photoBusyRef.current = false; if (alive.current) setPhotoBusy(false); }
  }
  function removePhoto(id: string) { if (busyRef.current || photoBusyRef.current || locked) return; setPhotos((current) => current.filter((photo) => photo.id !== id)); setDraft((current) => ({ ...current, reviewed: false })); setErrors((current) => ({ ...current, photos: undefined, submit: undefined })); }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked || fixed(field), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)} className="daf-field-label">{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const selectField = (field: 'ownerId' | 'priority' | 'direction' | 'causeStatus' | 'repairId', label: string, options: { id: string; label: string }[], short = false) => <div className={cn('min-w-0 space-y-1.5', short && 'daf-short')}>{labelFor(field, label)}<Select value={draft[field]} disabled={locked || fixed(field)} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择{label}', { label: t(label) })} /></SelectTrigger><SelectContent className="defect-action-select proc-horizon-overlay">{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const dateField = (field: 'date' | 'dueDate', label: string) => <div className="daf-short min-w-0 space-y-1.5">{labelFor(field, label)}<Input {...propsFor(field)} type="date" required value={draft[field]} min={field === 'dueDate' ? defectToday() : issue?.date} max={field === 'date' ? defectToday() : undefined} onChange={(event) => change(field, event.target.value)} className="min-w-0 tabular-nums" />{fieldError(field)}</div>;
  const numericField = (label: string) => <div className="daf-short min-w-0 space-y-1.5">{labelFor('quantity', label)}<Input {...propsFor('quantity')} required inputMode="numeric" value={draft.quantity} onChange={(event) => change('quantity', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('quantity')}</div>;
  const paragraphField = (field: 'reason' | 'description' | 'basis' | 'cause' | 'summary', label: string) => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<Textarea {...propsFor(field)} required maxLength={2000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" />{fieldError(field)}</div>;
  const reviewedField = (label: string) => <div className="space-y-1.5"><label className="flex cursor-pointer items-start gap-2 text-pretty text-sm leading-6"><input {...propsFor('reviewed')} type="checkbox" required checked={draft.reviewed} onChange={(event) => change('reviewed', event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" /><span>{t(label)}</span></label>{fieldError('reviewed')}</div>;
  const summary: [string, string][] = [['操作人', actor?.name ?? '—'], ['不良单号', issue?.code ?? '—'], ['生产批次', issue?.batchCode ?? '—'], ['原始不良数量', amount(issue?.quantity ?? NaN)], ['来源单号', issue?.sourceCode ?? '—']];
  if (kind === 'assign' || kind === 'route') summary.push(['责任人', ownerName], ['处理期限', draft.dueDate]);
  if (kind === 'assign') summary.push(['优先级', t(draft.priority === 'high' ? '高' : draft.priority === 'low' ? '低' : '中')], ['指派说明', draft.reason.trim()]);
  if (kind === 'route') summary.push(['处理方向', t(defectDirectionLabels[draft.direction as keyof typeof defectDirectionLabels] ?? '待确定')], ['根因状态', t(draft.causeStatus === 'confirmed' ? '已确认' : '待确认')], ...(draft.causeStatus === 'confirmed' ? [['确认根因', draft.cause.trim()] as [string, string]] : []), ['处理要求', draft.description.trim()]);
  if (kind === 'repair') summary.push(['整改日期', draft.date], ['本次整改数量', amount(quantity)], ['整改说明', draft.description.trim()], ['整改依据', draft.basis.trim()], ['照片', photos.length ? photos.map((photo) => photo.name).join('、') : '未添加']);
  if (kind === 'handoff') summary.push(['整改记录', repair?.code ?? '—'], ['本次交接数量', amount(quantity)], ['提交后状态', t('待 QC 复验')]);
  if (kind === 'close') summary.push(['已复验解决', amount(progress?.resolved ?? 0)], ['关闭说明', draft.summary.trim()]);

  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="defect-action-title" aria-busy={busy || photoBusy} className="defect-action-form min-w-0">
      <header className="daf-heading border-b border-border pb-2.5"><h3 id="defect-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(defectActionLabels[kind])}</h3><p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">{t(intros[kind])}</p></header>
      <div className="daf-fields py-3">
        <p className="truncate text-xs leading-5 text-muted-foreground" title={`${issue?.code ?? '—'} · ${actor?.name ?? '—'} · ${issue?.batchCode ?? '—'}`}>{issue?.code ?? '—'} · {actor?.name ?? '—'} · {issue?.batchCode ?? '—'}</p>
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-pretty text-xs leading-5 text-amber-900">{[...new Set(blockers)].map((message) => <p key={message}>{t(message)}</p>)}</div>}
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5"><p>{t('原始不良')} <strong className="tabular-nums">{amount(issue?.quantity ?? NaN)}</strong> · {issue?.phenomenon ?? '—'}</p><p className="mt-1 break-words text-muted-foreground">{t('来源')}：{issue?.sourceCode ?? '—'} · {issue?.process ?? '—'}</p></div>
        {(kind === 'assign' || kind === 'route') && <>
          {kind === 'route' && selectField('direction', '处理方向', ['onsite', 'rd', 'procurement'].map((id) => ({ id, label: t(defectDirectionLabels[id as 'onsite' | 'rd' | 'procurement']) })))}
          {selectField('ownerId', '责任人', owners.map((item) => ({ id: item.id, label: item.name })), true)}{dateField('dueDate', '处理期限')}
          {kind === 'assign' && <>{selectField('priority', '优先级', [{ id: 'high', label: t('高') }, { id: 'medium', label: t('中') }, { id: 'low', label: t('低') }], true)}{paragraphField('reason', '指派说明')}</>}
          {kind === 'route' && <>{selectField('causeStatus', '根因状态', [{ id: 'pending', label: t('待确认') }, { id: 'confirmed', label: t('已确认') }], true)}{draft.causeStatus === 'confirmed' ? paragraphField('cause', '确认根因') : <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('根因待确认时可先明确责任人与排查要求。')}</p>}{paragraphField('description', draft.direction === 'rd' ? '研发协同要求' : draft.direction === 'procurement' ? '采购协同要求' : '整改要求')}</>}
          {reviewedField('已核对责任人、处理期限与本次处理要求')}
        </>}
        {kind === 'repair' && <>
          {dateField('date', '整改日期')}{numericField(`整改数量（${issue?.unit ?? ''}）`)}
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本次最多可登记')} <strong className="tabular-nums text-foreground">{amount(progress?.availableToRepair ?? 0)}</strong> · {t('已有整改记录')} <strong className="tabular-nums text-foreground">{state.repairs.filter((item) => item.issueId === issueId).length}</strong> {t('条')}</p>
          {paragraphField('description', '整改说明')}{paragraphField('basis', '整改依据')}
          <details ref={optionalRef} className="daf-disclosure daf-optional"><summary>{t('整改照片（选填）')}</summary><div className="min-w-0 space-y-2 pt-3">{labelFor('photos', '整改照片（选填）', false)}<Input {...propsFor('photos')} type="file" multiple accept="image/jpeg,image/png" onChange={choosePhotos} className="h-auto min-h-9 py-2 text-xs" /><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('最多 3 张 JPG / PNG，每张不超过 10 MB；照片仅保留在本页演示。')}</p>{photoBusy && <p role="status" className="text-xs leading-5">{t('正在读取照片…')}</p>}{fieldError('photos')}{photos.length > 0 && <ul className="daf-photos">{photos.map((photo) => <li key={photo.id}><img src={photo.dataUrl} alt={t('整改证据：{name}', { name: photo.name })} /><div><span className="min-w-0 break-words text-xs leading-5">{photo.name}</span><Button type="button" size="icon" variant="ghost" disabled={locked} aria-label={t('移除照片 {name}', { name: photo.name })} onClick={() => removePhoto(photo.id)} className="size-8 shrink-0"><X aria-hidden="true" className="size-3.5" /></Button></div></li>)}</ul>}</div></details>
          {reviewedField('已核对实际整改数量及依据，完成后仍需 QC 复验')}
        </>}
        {kind === 'handoff' && <>
          {selectField('repairId', '待交接的整改记录', repairs.map((item) => ({ id: item.id, label: `${item.code} · ${amount(getHandoffAvailable(state, item.id))}` })))}
          {repair && <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5"><p>{t('原整改数量')} <strong className="tabular-nums">{amount(repair.quantity)}</strong> · {t('尚可交接')} <strong className="tabular-nums">{amount(getHandoffAvailable(state, repair.id))}</strong></p><details className="daf-disclosure mt-1.5"><summary>{t('查看整改说明与依据')}</summary><p className="mt-1.5 whitespace-pre-wrap break-words">{repair.description}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{repair.basis}</p></details></div>}
          {numericField(`本次交接数量（${issue?.unit ?? ''}）`)}
          <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('提交后保持待 QC 复验；合格、不良及 SIP 由独立复验回执记录。')}</p>
          {reviewedField('已核对整改记录与本次交接数量，实物已准备复验')}
        </>}
        {kind === 'close' && <><dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5"><div><dt className="text-muted-foreground">{t('已复验解决')}</dt><dd className="font-medium tabular-nums">{amount(progress?.resolved ?? 0)}</dd></div><div><dt className="text-muted-foreground">{t('待解决')}</dt><dd className="font-medium tabular-nums">{amount(progress?.remaining ?? 0)}</dd></div><div><dt className="text-muted-foreground">{t('待 QC 复验')}</dt><dd className="font-medium tabular-nums">{amount(progress?.pendingReinspection ?? 0)}</dd></div><div><dt className="text-muted-foreground">{t('待交接')}</dt><dd className="font-medium tabular-nums">{amount(progress?.ready ?? 0)}</dd></div></dl>{paragraphField('summary', '关闭说明')}{reviewedField('已核对全部不良均已解决，关闭不代表 QA 放行或出货')}</>}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(kind === 'handoff' ? '已提交复验，等待 QC 复验回执。' : '不良处理已保存，原始记录已保留。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || photoBusy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !photoBusyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="defect-action-confirm proc-horizon-overlay min-w-0" overlayClassName="defect-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t(descriptions[kind])}</AlertDialogDescription></AlertDialogHeader>
      <dl className="daf-summary min-w-0 text-xs leading-5">{summary.map(([label, value]) => <div key={label} className={cn('min-w-0', ['指派说明', '确认根因', '处理要求', '整改说明', '整改依据', '照片', '关闭说明'].includes(label) && 'daf-summary-wide')}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty font-medium">{value}</dd></div>)}</dl>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
