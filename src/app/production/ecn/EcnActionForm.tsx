import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { useI18n } from '../../lib/i18n';
import { getArchiveBlockers, validateEcnAction } from './ecnModel';
import { dispositionLabels, dispositionOptions, ecnActionLabels, legacyKindLabels, type DispositionChoice, type EcnAction, type EcnActionContext, type EcnState } from './ecnTypes';
import './ecn-action-form.css';
import { Checkbox } from "../../components/ui/checkbox";

export interface EcnActionFormProps {
  state: EcnState; recordId: string; actorId: string; context: EcnActionContext; readOnly?: boolean;
  onSubmit: (input: EcnAction) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; onCancel: () => void;
}
type TextField = 'targetId' | 'choice' | 'impactId' | 'ownerId' | 'dueDate' | 'description' | 'taskId' | 'resolution' | 'result' | 'evidenceId' | 'note' | 'reason';
type Field = TextField | 'reviewed' | 'impactIds';
type Draft = Record<TextField, string> & { reviewed: boolean; impactIds: string[] };
type Errors = Partial<Record<Field | 'submit', string>>;
const fieldOrder: Field[] = ['reviewed', 'impactIds', 'targetId', 'choice', 'impactId', 'ownerId', 'dueDate', 'description', 'taskId', 'resolution', 'result', 'evidenceId', 'note', 'reason'];
const effects = {
  acknowledge: '已阅确认记录您核对的适用范围，旧版保留批次也需明确；已阅不代表执行验证通过。',
  disposition: '记录旧版处置决定及依据。实物返工、退料、报废或订单变更仍需后续业务单据。',
  feedback: '保存后生成本页可跟进的协同待办，记录负责人和期限，不向外部发送通知。',
  'resolve-task': '记录本次处理结果并关闭协同待办。处理结果不代替质量执行验证。',
  verify: '依据已发布且覆盖本适用批次的验证单据，分别记录验证通过或未通过。',
  archive: '核对岗位确认、旧版处置、协同待办和执行验证后归档，保留全部操作记录。',
};
const saveLabels = { acknowledge: '保存已阅确认', disposition: '保存处置决定', feedback: '生成协同待办', 'resolve-task': '保存处理结果', verify: '保存执行验证', archive: '归档变更' };
const confirmLabels = { acknowledge: '确认保存已阅记录', disposition: '确认保存处置决定', feedback: '确认生成协同待办', 'resolve-task': '确认保存处理结果', verify: '确认保存执行验证', archive: '确认归档变更' };
function initialDraft({ context }: EcnActionFormProps): Draft {
  return { reviewed: false, impactIds: [], targetId: context.targetId ?? '', choice: '', impactId: context.impactId ?? '', ownerId: '', dueDate: '', description: '', taskId: context.taskId ?? '', resolution: '', result: '', evidenceId: '', note: '', reason: '' };
}

export function EcnActionForm(props: EcnActionFormProps) {
  const { state, recordId, actorId, context, readOnly, onSubmit, onDirtyChange, onCancel } = props;
  const { kind } = context;
  const { t } = useI18n();
  const record = state.records.find((item) => item.id === recordId);
  const actor = state.actors.find((item) => item.id === actorId);
  const scopeKey = JSON.stringify([recordId, actorId, context]);
  const [draft, setDraft] = useState(() => initialDraft(props));
  const clean = useRef(JSON.stringify(draft));
  const initialScope = useRef(scopeKey);
  const initialVersion = useRef(state.version);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: EcnAction; scopeKey: string; version: number } | null>(null);
  const dirty = JSON.stringify(draft) !== clean.current;
  const locked = Boolean(readOnly) || busy || Boolean(confirmation) || saved;
  const target = record?.legacyTargets.find((item) => item.id === draft.targetId);
  const task = record?.tasks.find((item) => item.id === draft.taskId);
  const impact = record?.impacts.find((item) => item.id === draft.impactId);
  const evidence = record?.documents.find((item) => item.id === draft.evidenceId);
  const eligibleEvidence = record?.documents.filter((item) => item.kind === 'verification' && item.status === 'published' && item.impactIds.includes(draft.impactId)) ?? [];
  const archiveBlockers = kind === 'archive' && record ? getArchiveBlockers(state, recordId) : [];
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存操作。');
  if (initialScope.current !== scopeKey) blockers.push('当前变更、操作人或操作已变化，请重新打开表单。填写内容已保留。');
  if (initialVersion.current !== state.version) blockers.push('变更记录已更新，请重新打开表单后核对。填写内容已保留。');
  if (!record) blockers.push('未找到该变更记录，请重新选择。');
  else if (record.status !== 'published') blockers.push(record.status === 'archived' ? '变更已归档，不能继续修改。' : '变更尚未发布，不能记录执行操作。');
  if (!actor) blockers.push('请选择有效的演示操作人。');
  if (actor && ['verify', 'archive'].includes(kind) && actor.team !== 'quality') blockers.push('此操作需要质量岗位人员完成。');
  if (actor && kind === 'disposition' && !['engineering', 'quality'].includes(actor.team)) blockers.push('旧版处置决定需要工艺或质量岗位人员记录。');
  if (kind === 'resolve-task' && task && actor && task.ownerId !== actor.id && !['engineering', 'quality'].includes(actor.team)) blockers.push('请由待办负责人、工艺或质量岗位人员更新处理结果。');
  if (kind === 'archive') blockers.push(...archiveBlockers);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const fieldId = (field: Field) => `ecn-action-${field}`;
  function focusField(field: Field) {
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  const isContextBound = (field: Field) => (field === 'targetId' && Boolean(context.targetId)) || (field === 'taskId' && Boolean(context.taskId)) || (field === 'impactId' && Boolean(context.impactId));
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || locked || isContextBound(field)) return;
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'targetId' ? { choice: '' } : {}), ...(field === 'impactId' ? { evidenceId: '' } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined, ...(field === 'targetId' ? { choice: undefined } : {}), ...(field === 'impactId' ? { evidenceId: undefined } : {}), submit: undefined }));
  }
  function validate(): EcnAction | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((value) => t(value)).join('；');
    const required = (field: TextField, label: string, limit = 1000) => {
      if (!draft[field].trim()) next[field] = t('请填写{label}。', { label: t(label) });
      else if (draft[field].trim().length > limit) next[field] = t('最多填写 {limit} 个字符。', { limit });
    };
    if (kind === 'acknowledge') {
      if (!draft.reviewed) next.reviewed = t('请先核对变更内容并勾选已阅。');
      if (!draft.impactIds.length || draft.impactIds.some((id) => !record?.impacts.some((item) => item.id === id))) next.impactIds = t('请选择您已核对的适用范围。');
      if (draft.note.trim().length > 1000) next.note = t('最多填写 1000 个字符。');
    }
    if (kind === 'disposition') {
      if (!target) next.targetId = t('请选择需要处置的旧版对象。');
      if (!target || !dispositionOptions[target.kind].includes(draft.choice as DispositionChoice)) next.choice = t('请选择该对象允许的处置方式。');
      required('reason', '处置原因与依据');
    }
    if (kind === 'feedback' || kind === 'verify') {
      if (!impact || (kind === 'verify' && impact.applicability !== 'apply')) next.impactId = t(kind === 'verify' ? '请选择执行新版的适用批次。' : '请选择问题涉及的适用范围。');
    }
    if (kind === 'feedback') {
      if (!state.actors.some((item) => item.id === draft.ownerId)) next.ownerId = t('请选择待办负责人。');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) || Number.isNaN(Date.parse(`${draft.dueDate}T00:00:00Z`)) || new Date(`${draft.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== draft.dueDate) next.dueDate = t('请填写有效的计划完成日期。');
      required('description', '执行问题与待办要求', 2000);
    }
    if (kind === 'resolve-task') {
      if (!task || task.status !== 'open') next.taskId = t('请选择尚未完成的协同待办。');
      required('resolution', '处理结果');
    }
    if (kind === 'verify') {
      if (!['passed', 'failed'].includes(draft.result)) next.result = t('请选择本次验证结果。');
      if (!eligibleEvidence.some((item) => item.id === draft.evidenceId)) next.evidenceId = t('请选择已发布且覆盖该批次的验证依据。');
      required('note', '验证说明');
    }
    if (kind === 'archive') required('reason', '归档说明');
    let input: EcnAction;
    if (kind === 'acknowledge') input = { kind, actorId, reviewed: draft.reviewed, impactIds: [...draft.impactIds], note: draft.note.trim() };
    else if (kind === 'disposition') input = { kind, actorId, targetId: draft.targetId, choice: draft.choice as DispositionChoice, reason: draft.reason.trim() };
    else if (kind === 'feedback') input = { kind, actorId, impactId: draft.impactId, ownerId: draft.ownerId, dueDate: draft.dueDate, description: draft.description.trim() };
    else if (kind === 'resolve-task') input = { kind, actorId, taskId: draft.taskId, resolution: draft.resolution.trim() };
    else if (kind === 'verify') input = { kind, actorId, impactId: draft.impactId, result: draft.result as 'passed' | 'failed', evidenceId: draft.evidenceId, note: draft.note.trim() };
    else input = { kind, actorId, reason: draft.reason.trim() };
    if (!Object.keys(next).length) {
      try { validateEcnAction(state, recordId, input); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : t('请核对本次操作后重试。');
        const field: Field | 'submit' = kind === 'feedback' && /日期|期限/.test(message) ? 'dueDate' : kind === 'verify' && /依据|证据/.test(message) ? 'evidenceId' : kind === 'acknowledge' && /范围/.test(message) ? 'impactIds' : 'submit';
        next[field] = message;
      }
    }
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
      setConfirmation(null); setErrors({ submit: t('本次操作内容已变化，请重新核对后保存。填写内容已保留。') }); return;
    }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      clean.current = JSON.stringify(draft); setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) { if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('操作未保存，填写内容已保留，请重试。') }); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked || isContextBound(field), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = true) => <Label htmlFor={fieldId(field)}>{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const selectField = (field: TextField, label: string, options: { id: string; label: string }[]) => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<Select value={draft[field]} disabled={locked || isContextBound(field)} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择{label}', { label: t(label) })} /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const textField = (field: 'note' | 'reason' | 'description' | 'resolution', label: string, required = true) => <div className="min-w-0 space-y-1.5">{labelFor(field, label, required)}<Textarea {...propsFor(field)} required={required} maxLength={field === 'description' ? 2000 : 1000} value={draft[field]} onChange={(event) => change(field, event.target.value)} className="min-h-24 resize-y" />{fieldError(field)}</div>;
  const impactLabel = (id: string) => { const item = record?.impacts.find((entry) => entry.id === id); return item ? `${item.batchNo} · ${item.range} · ${t(item.applicability === 'apply' ? '执行新版' : item.applicability === 'retain' ? '保留旧版' : '待判定')}` : '—'; };
  const summary: [string, string][] = [['变更单', record?.code ?? '—'], ['操作人', actor ? `${actor.name} · ${actor.role}` : '—']];
  if (kind === 'acknowledge') summary.push(['已核对范围', draft.impactIds.map(impactLabel).join('\n')], ['说明', draft.note.trim() || '—']);
  if (kind === 'disposition') summary.push(['旧版对象', target ? `${target.code} · ${target.label} · ${target.quantity} ${target.unit}` : '—'], ['处置决定', dispositionLabels[draft.choice as DispositionChoice] ?? '—'], ['处置原因与依据', draft.reason.trim()]);
  if (kind === 'feedback') summary.push(['问题范围', impactLabel(draft.impactId)], ['待办负责人', state.actors.find((item) => item.id === draft.ownerId)?.name ?? '—'], ['计划完成日期', draft.dueDate], ['执行问题与待办要求', draft.description.trim()]);
  if (kind === 'resolve-task') summary.push(['协同待办', task?.code ?? '—'], ['待办要求', task?.description ?? '—'], ['处理结果', draft.resolution.trim()]);
  if (kind === 'verify') summary.push(['验证批次', impactLabel(draft.impactId)], ['验证结果', draft.result === 'passed' ? '验证通过' : draft.result === 'failed' ? '验证未通过' : '—'], ['验证依据', evidence ? `${evidence.code} · ${evidence.title} · ${evidence.revision}` : '—'], ['验证说明', draft.note.trim()]);
  if (kind === 'archive') summary.push(['归档说明', draft.reason.trim()]);

  return <>
    <form ref={formRef} noValidate onSubmit={submit} aria-labelledby="ecn-action-title" aria-busy={busy} className="ecn-action-form min-w-0">
      <header className="border-b border-border pb-3"><h3 id="ecn-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{t(ecnActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(effects[kind])}</p></header>
      <div className="grid min-w-0 gap-4 py-4">
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('操作人')}：<span className="font-medium text-foreground">{actor ? `${actor.name} · ${actor.role}` : t('待选择')}</span></p>
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-xs leading-5 text-amber-900"><p className="font-medium">{t(kind === 'archive' ? '归档前还需完成' : '当前操作暂不可保存')}</p><ul className="mt-1 list-disc space-y-1 pl-4">{[...new Set(blockers)].map((message) => <li className="text-pretty" key={message}>{t(message)}</li>)}</ul></div>}
        {kind === 'acknowledge' && <>
          <div className="space-y-1.5"><label className="flex cursor-pointer items-start gap-2 text-pretty text-sm leading-6"><Checkbox {...propsFor('reviewed')}  required checked={draft.reviewed} onCheckedChange={(checkedValue) => change('reviewed', (checkedValue === true))} className="mt-1 size-4 shrink-0 accent-primary" /><span>{t('我已核对已发布的变更内容和相关技术资料')}</span></label>{fieldError('reviewed')}</div>
          <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium">{t('已核对的适用范围')} <span aria-hidden="true" className="text-destructive">*</span></legend>{record?.impacts.map((item, index) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-pretty text-xs leading-5"><Checkbox {...(index === 0 ? propsFor('impactIds') : { disabled: locked })}  checked={draft.impactIds.includes(item.id)} onCheckedChange={(checkedValue) => change('impactIds', (checkedValue === true) ? [...draft.impactIds, item.id] : draft.impactIds.filter((id) => id !== item.id))} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0"><span className="font-medium">{item.batchNo}</span> · {t(item.applicability === 'apply' ? '执行新版' : item.applicability === 'retain' ? '保留旧版' : '待判定')}<span className="mt-0.5 block text-muted-foreground">{item.range} · <span className="tabular-nums">{item.quantity} {item.unit}</span></span></span></label>)}{fieldError('impactIds')}</fieldset>
          {textField('note', '核对说明（选填）', false)}
        </>}
        {kind === 'disposition' && <>
          {selectField('targetId', '旧版处置对象', record?.legacyTargets.map((item) => ({ id: item.id, label: `${t(legacyKindLabels[item.kind])} · ${item.code} · ${item.label}` })) ?? [])}
          {target && <p className="rounded-lg bg-muted/40 px-3 py-2 text-pretty text-xs leading-5">{t('当前版本')}：{target.oldVersion} · <span className="tabular-nums">{target.quantity} {target.unit}</span></p>}
          {selectField('choice', '处置方式', target ? dispositionOptions[target.kind].map((choice) => ({ id: choice, label: t(dispositionLabels[choice]) })) : [])}
          {textField('reason', '处置原因与依据')}
        </>}
        {(kind === 'feedback' || kind === 'verify') && selectField('impactId', kind === 'verify' ? '验证批次' : '问题涉及范围', record?.impacts.filter((item) => kind !== 'verify' || item.applicability === 'apply').map((item) => ({ id: item.id, label: impactLabel(item.id) })) ?? [])}
        {kind === 'feedback' && <>
          {selectField('ownerId', '待办负责人', state.actors.map((item) => ({ id: item.id, label: `${item.name} · ${item.role}` })))}
          <div className="min-w-0 space-y-1.5">{labelFor('dueDate', '计划完成日期')}<Input {...propsFor('dueDate')} type="date" required value={draft.dueDate} onChange={(event) => change('dueDate', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('dueDate')}</div>
          {textField('description', '执行问题与待办要求')}
        </>}
        {kind === 'resolve-task' && <>
          {selectField('taskId', '协同待办', record?.tasks.filter((item) => item.status === 'open').map((item) => ({ id: item.id, label: `${item.code} · ${state.actors.find((person) => person.id === item.ownerId)?.name ?? '—'}` })) ?? [])}
          {task && <p className="rounded-lg bg-muted/40 px-3 py-2 text-pretty text-xs leading-5">{task.description}</p>}{textField('resolution', '处理结果')}
        </>}
        {kind === 'verify' && <>
          {selectField('result', '验证结果', [{ id: 'passed', label: t('验证通过') }, { id: 'failed', label: t('验证未通过') }])}
          {selectField('evidenceId', '验证依据', eligibleEvidence.map((item) => ({ id: item.id, label: `${item.code} · ${item.title}` })))}
          {draft.impactId && eligibleEvidence.length === 0 && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('该批次暂无已发布的验证依据，请先核对技术资料与适用范围。')}</p>}{textField('note', '验证说明')}
        </>}
        {kind === 'archive' && <>{!archiveBlockers.length && <p className="rounded-lg bg-muted/40 px-3 py-2.5 text-pretty text-xs leading-5">{t('岗位确认、旧版处置、协同待办和执行验证已满足归档条件。')}</p>}{textField('reason', '归档说明')}</>}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t(kind === 'feedback' ? '协同待办已生成，可在本页继续跟进。' : kind === 'archive' ? '变更已归档。' : '操作已保存，处理记录已保留。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : saveLabels[kind])}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="ecn-action-confirm proc-horizon-overlay min-w-0" overlayClassName="ecn-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t(confirmLabels[kind])}</AlertDialogTitle><AlertDialogDescription>{t(effects[kind])}</AlertDialogDescription></AlertDialogHeader>
      <dl className="min-w-0 space-y-3 text-xs leading-5">{summary.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-pretty font-medium">{value}</dd></div>)}</dl>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : confirmLabels[kind])}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
