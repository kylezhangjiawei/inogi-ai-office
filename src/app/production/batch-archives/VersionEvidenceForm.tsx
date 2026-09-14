import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FilePenLine, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { validateVersionAmendment } from './batchArchiveModel';
import { archiveVersionLabels, type ArchiveVersions, type BatchArchiveState, type VersionAmendment } from './batchArchiveTypes';
import './version-evidence-form.css';

export interface VersionEvidenceFormProps {
  state: BatchArchiveState;
  batchId: string;
  scopeId?: string;
  readOnly?: boolean;
  onSubmit: (input: VersionAmendment) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}
type Field = 'name' | 'quantity' | keyof ArchiveVersions | 'serialNumbers' | 'evidenceIds' | 'actor' | 'reason';
type Draft = Record<Exclude<Field, 'evidenceIds'>, string> & { evidenceIds: string[] };
type Errors = Partial<Record<Field | 'submit', string>>;
const versionFields = Object.keys(archiveVersionLabels) as (keyof ArchiveVersions)[];
const coreFields: (keyof ArchiveVersions)[] = ['software', 'hardware', 'bom'];
const optionalFields: (keyof ArchiveVersions)[] = ['drawing', 'sop', 'sip'];
const fieldOrder: Field[] = ['name', 'quantity', ...versionFields, 'evidenceIds', 'serialNumbers', 'actor', 'reason'];
const splitSerials = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const canonicalSn = (value: string) => value.trim().toLocaleUpperCase('en-US');
function wholeQuantity(value: string) {
  const number = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
}
function initialDraft({ state, batchId, scopeId }: VersionEvidenceFormProps): Draft {
  const scope = state.batches.find((item) => item.id === batchId)?.versionScopes.find((item) => item.id === scopeId);
  return {
    name: scope?.name ?? '', quantity: scope ? String(scope.quantity) : '',
    software: scope?.versions.software ?? '', hardware: scope?.versions.hardware ?? '', bom: scope?.versions.bom ?? '',
    drawing: scope?.versions.drawing ?? '', sop: scope?.versions.sop ?? '', sip: scope?.versions.sip ?? '',
    serialNumbers: scope?.serialNumbers.join('\n') ?? '', evidenceIds: [...scope?.evidenceIds ?? []], actor: '', reason: '',
  };
}

export function VersionEvidenceForm(props: VersionEvidenceFormProps) {
  const { state, batchId, scopeId, readOnly, onSubmit, onDirtyChange, onCancel } = props;
  const { t } = useI18n();
  const batch = state.batches.find((item) => item.id === batchId);
  const scope = batch?.versionScopes.find((item) => item.id === scopeId);
  const scopeKey = `${batchId}:${scopeId ?? ''}`;
  const [draft, setDraft] = useState(() => initialDraft(props));
  const clean = useRef(JSON.stringify(draft));
  const initialScope = useRef(scopeKey);
  const initialVersion = useRef(state.version);
  const initialScopeData = useRef(JSON.stringify(scope));
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [serialOpen, setSerialOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: VersionAmendment; scopeKey: string; version: number } | null>(null);
  const dirty = JSON.stringify(draft) !== clean.current;
  const locked = Boolean(readOnly) || busy || Boolean(confirmation) || saved;
  const quantity = wholeQuantity(draft.quantity);
  const serialNumbers = splitSerials(draft.serialNumbers);
  const otherScopes = batch?.versionScopes.filter((item) => item.id !== scopeId) ?? [];
  const availableQuantity = Math.max(0, (batch?.completedQty ?? 0) - otherScopes.reduce((total, item) => total + item.quantity, 0));
  const missingVersions = coreFields.filter((field) => !draft[field].trim());
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale()) : '—';
  const blockers: string[] = [];
  if (readOnly) blockers.push('当前为只读预览，不能保存版本依据。');
  if (scopeKey !== initialScope.current) blockers.push('当前批次或版本范围已变化，请重新打开表单。填写内容已保留。');
  if (state.version !== initialVersion.current || JSON.stringify(scope) !== initialScopeData.current) blockers.push('批次档案已变化，请重新打开表单后核对。填写内容已保留。');
  if (!batch) blockers.push('未找到该批次，请重新选择。');
  else if (scopeId && !scope) blockers.push('未找到该版本范围，请重新选择。');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!confirmation && invalidFocus.current && ((serialOpen && invalidFocus.current === 'serialNumbers') || (optionalOpen && optionalFields.includes(invalidFocus.current as keyof ArchiveVersions)))) focusField(invalidFocus.current);
  }, [optionalOpen, serialOpen, confirmation]);
  const fieldId = (field: Field) => `version-evidence-${field}`;
  function focusField(field: Field) {
    const node = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    node?.focus(); node?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    if (busyRef.current || locked) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
  }
  function validate(): VersionAmendment | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((item) => t(item)).join('；');
    for (const [field, label, limit] of [['name', '版本范围名称', 120], ['actor', '操作人', 80], ['reason', '补充或修订原因', 1000]] as const) {
      if (!draft[field].trim()) next[field] = t('请填写{label}。', { label: t(label) });
      else if (draft[field].trim().length > limit) next[field] = t('最多填写 {limit} 个字符。', { limit });
    }
    if (!Number.isFinite(quantity)) next.quantity = t('请填写大于 0 的整台数量。');
    else if (quantity > availableQuantity) next.quantity = t('本范围最多可覆盖 {quantity} 台，请核对其他范围和完工数量。', { quantity: numberLabel(availableQuantity) });
    if (versionFields.every((field) => !draft[field].trim())) next.software = t('请至少填写一项有依据的版本；其余版本继续标记待确认。');
    for (const field of versionFields) if (draft[field].trim().length > 80) next[field] = t('版本最多填写 80 个字符。');
    if (!draft.evidenceIds.length) next.evidenceIds = t('请选择至少一份现有单据作为依据。');
    else if (draft.evidenceIds.some((id) => !batch?.documents.some((document) => document.id === id))) next.evidenceIds = t('所选依据已不存在，请重新选择。');
    const known = new Set(batch?.serials.map((item) => canonicalSn(item.sn)) ?? []);
    const assigned = new Set(otherScopes.flatMap((item) => item.serialNumbers.map(canonicalSn)));
    if (new Set(serialNumbers.map(canonicalSn)).size !== serialNumbers.length) next.serialNumbers = t('存在重复 SN，请删除重复项。');
    else if (serialNumbers.some((sn) => !known.has(canonicalSn(sn)))) next.serialNumbers = t('只能关联本批次已有 SN，请按下方清单核对。');
    else if (serialNumbers.some((sn) => assigned.has(canonicalSn(sn)))) next.serialNumbers = t('部分 SN 已属于其他版本范围，请先核对对应范围。');
    else if (serialNumbers.length > quantity) next.serialNumbers = t('关联 SN 数量不得超过本范围数量。');
    const input: VersionAmendment = {
      ...(scopeId ? { scopeId } : {}), name: draft.name.trim(), quantity,
      versions: Object.fromEntries(versionFields.map((field) => [field, draft[field].trim()])) as unknown as ArchiveVersions,
      serialNumbers, evidenceIds: [...draft.evidenceIds], actor: draft.actor.trim(), reason: draft.reason.trim(),
    };
    if (!Object.keys(next).length) {
      try { validateVersionAmendment(state, batchId, input); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : t('请核对版本依据后重试。');
        const field = message.includes('SN') ? 'serialNumbers' : message.includes('数量') ? 'quantity' : message.includes('依据') && !message.includes('变化') ? 'evidenceIds' : 'submit';
        next[field] = message;
      }
    }
    setErrors(next); invalidFocus.current = fieldOrder.find((field) => next[field]) ?? null;
    if (optionalFields.some((field) => next[field])) setOptionalOpen(true);
    if (next.serialNumbers) setSerialOpen(true);
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
      setConfirmation(null); setErrors({ submit: t('当前版本依据已变化，请重新核对后保存。填写内容已保留。') }); return;
    }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      await onSubmit(input); if (!alive.current) return;
      clean.current = JSON.stringify(draft); setConfirmation(null); setSaved(true); onDirtyChange?.(false);
    } catch (cause) {
      if (alive.current) { setConfirmation(null); setErrors({ submit: cause instanceof Error ? cause.message : t('版本依据未保存，填写内容已保留，请重试。') }); }
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const labelFor = (field: Field, label: string, required = false) => <Label htmlFor={fieldId(field)}>{t(label)}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</Label>;
  const inputField = (field: Exclude<Field, 'serialNumbers' | 'evidenceIds' | 'reason'>, label: string, required = false) => <div className="version-evidence-field min-w-0 space-y-1.5">{labelFor(field, label, required)}<Input {...propsFor(field)} value={draft[field]} required={required} inputMode={field === 'quantity' ? 'numeric' : undefined} maxLength={field === 'name' ? 120 : 80} placeholder={versionFields.includes(field as keyof ArchiveVersions) ? t('待确认') : undefined} onChange={(event) => change(field, event.target.value)} className={cn('min-w-0', field === 'quantity' && 'tabular-nums')} />{fieldError(field)}</div>;
  const selectedDocuments = draft.evidenceIds.map((id) => ({ id, document: batch?.documents.find((item) => item.id === id) }));
  const comparison: [string, string, string][] = [
    ['版本范围', scope?.name ?? '—', draft.name.trim()], ['覆盖数量', scope ? `${numberLabel(scope.quantity)} 台` : '—', `${numberLabel(quantity)} 台`],
    ...versionFields.map((field) => [archiveVersionLabels[field], scope?.versions[field] || t('待确认'), draft[field].trim() || t('待确认')] as [string, string, string]),
  ];
  return <>
    <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="version-evidence-title" aria-busy={busy} className="version-evidence-form min-w-0">
      <header className="border-b border-border pb-3"><h3 id="version-evidence-title" className="flex items-center gap-2 text-balance text-base font-semibold"><FilePenLine className="size-4 shrink-0 text-primary" aria-hidden="true" />{t(scopeId ? '修订版本依据' : '补充版本范围')}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t('按本批次实际使用版本填写；未确认项留空，并保留依据与修订原因。')}</p></header>
      <div className="version-evidence-fields py-4">
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-pretty text-xs leading-5 text-amber-900">{blockers.map((message) => <p key={message}>{t(message)}</p>)}</div>}
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{batch?.batchNo ?? t('批次待选择')} · {t('本范围可覆盖')} <strong className="tabular-nums font-medium text-foreground">{numberLabel(availableQuantity)} {t('台')}</strong><span className="ml-2">{t('标 * 为必填')}</span></p>
        {inputField('name', '版本范围名称', true)}{inputField('quantity', '覆盖数量（台）', true)}
        {coreFields.map((field) => <div key={field} className="version-evidence-field">{inputField(field, archiveVersionLabels[field])}</div>)}
        <p className="text-pretty text-xs leading-5 text-muted-foreground">{missingVersions.length ? t('仍待确认：{versions}。', { versions: missingVersions.map((field) => t(archiveVersionLabels[field])).join('、') }) : t('软件、硬件和 BOM 版本已填写，保存后仍可追溯所选依据。')}</p>
        <details open={optionalOpen} onToggle={(event) => setOptionalOpen(event.currentTarget.open)} className="min-w-0 rounded-lg border border-border px-3 py-2.5"><summary className="cursor-pointer rounded text-xs font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('图纸、SOP 与 SIP 版本（选填）')}</summary><div className="mt-3 grid min-w-0 gap-3">{optionalFields.map((field) => <div key={field}>{inputField(field, archiveVersionLabels[field])}</div>)}</div></details>
        <div className="min-w-0 space-y-2">{labelFor('evidenceIds', '现有依据单据', true)}<Select value="" disabled={locked || !batch?.documents.length} onValueChange={(id) => { if (!draft.evidenceIds.includes(id)) change('evidenceIds', [...draft.evidenceIds, id]); }}><SelectTrigger {...propsFor('evidenceIds')} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('选择并添加依据单据')} /></SelectTrigger><SelectContent>{batch?.documents.filter((document) => !draft.evidenceIds.includes(document.id)).map((document) => <SelectItem key={document.id} value={document.id}>{document.code} · {document.title}</SelectItem>)}</SelectContent></Select>{selectedDocuments.length > 0 && <ul className="space-y-1">{selectedDocuments.map(({ id, document }) => <li key={id} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/40 pl-2.5 text-xs leading-5"><span className="min-w-0 flex-1 break-words">{document?.code ?? t('依据已不存在')} · {document?.title ?? id}</span><Button type="button" size="icon" variant="ghost" disabled={locked} aria-label={t('移除依据 {code}', { code: document?.code ?? id })} onClick={() => change('evidenceIds', draft.evidenceIds.filter((value) => value !== id))} className="size-9 shrink-0"><X aria-hidden="true" className="size-3.5" /></Button></li>)}</ul>}{!batch?.documents.length && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本批次暂无可选依据，请先关闭表单并核对档案来源。')}</p>}{fieldError('evidenceIds')}</div>
        <details open={serialOpen} onToggle={(event) => setSerialOpen(event.currentTarget.open)} className="min-w-0 rounded-lg border border-border px-3 py-2.5"><summary className="cursor-pointer rounded text-xs font-medium leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('关联已有 SN（选填）')}<span className="ml-2 tabular-nums text-muted-foreground">{serialNumbers.length} {t('个')}</span></summary><div className="mt-3 space-y-2">{labelFor('serialNumbers', '本范围已有 SN')}<Textarea {...propsFor('serialNumbers')} value={draft.serialNumbers} onChange={(event) => change('serialNumbers', event.target.value)} placeholder={t('每行一个本批次已有 SN')} className="min-h-24 resize-y tabular-nums" />{fieldError('serialNumbers')}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本批已有清单')}：<span className="break-words">{batch?.serials.length ? batch.serials.slice(0, 6).map((item) => item.sn).join('、') : t('暂无')}{(batch?.serials.length ?? 0) > 6 ? t('等 {count} 个，可在档案中查看完整清单', { count: batch?.serials.length ?? 0 }) : ''}</span></p><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('仅关联已有记录；数量不足时保留待补齐状态。')}</p></div></details>
        {Number.isFinite(quantity) && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本范围已有 SN {known} 个，待补齐 {missing} 台。', { known: numberLabel(serialNumbers.length), missing: numberLabel(Math.max(0, quantity - serialNumbers.length)) })}</p>}
        {inputField('actor', '操作人', true)}
        <div className="min-w-0 space-y-1.5">{labelFor('reason', '补充或修订原因', true)}<Textarea {...propsFor('reason')} value={draft.reason} maxLength={1000} required onChange={(event) => change('reason', event.target.value)} className="min-h-20 resize-y" />{fieldError('reason')}</div>
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t('版本依据已保存，原记录与本次修订原因已保留。')}</p>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="outline" disabled={busy || Boolean(confirmation)} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t(saved ? '关闭' : '取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : '保存版本依据')}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}><AlertDialogContent className="version-evidence-confirm proc-horizon-overlay min-w-0" overlayClassName="version-evidence-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>{t('确认保存版本依据')}</AlertDialogTitle><AlertDialogDescription>{t('核对本批次的实际版本与适用范围。保存会保留修订历史，仅更新本页演示档案。')}</AlertDialogDescription></AlertDialogHeader>
      <p className="text-sm font-medium">{batch?.batchNo ?? '—'}</p>
      <div className="min-w-0 overflow-x-auto"><table className="version-evidence-comparison w-full text-left text-xs leading-5"><thead><tr><th scope="col">{t('字段')}</th><th scope="col">{t('原记录')}</th><th scope="col">{t('本次记录')}</th></tr></thead><tbody>{comparison.map(([label, before, after]) => <tr key={label}><th scope="row">{t(label)}</th><td>{before}</td><td className={cn(before !== after && 'font-medium text-primary')}>{after}</td></tr>)}</tbody></table></div>
      <dl className="min-w-0 space-y-3 text-xs leading-5"><div><dt className="text-muted-foreground">{t('现有依据')}</dt><dd className="mt-1 break-words">{selectedDocuments.map(({ document, id }) => document?.code ?? id).join('、') || '—'}</dd></div><div><dt className="text-muted-foreground">{t('关联 SN / 待补齐')}</dt><dd className="mt-1 tabular-nums">{serialNumbers.length} / {numberLabel(Math.max(0, quantity - serialNumbers.length))} {t('台')}</dd>{serialNumbers.length > 0 && <dd className="mt-1 break-words">{serialNumbers.join('、')}</dd>}</div><div><dt className="text-muted-foreground">{t('操作人')}</dt><dd className="mt-1 break-words">{draft.actor.trim()}</dd></div><div><dt className="text-muted-foreground">{t('补充或修订原因')}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{draft.reason.trim()}</dd></div></dl>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : '确认保存版本依据')}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
