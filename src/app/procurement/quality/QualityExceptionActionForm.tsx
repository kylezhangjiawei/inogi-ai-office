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
import { allowedQualityActions, qualityCloseBlockers, qualityVerificationBlockers } from './qualityExceptionPreviewModel';
import { qualityActionLabels, qualityCauseLabels, qualityDemoPeople, qualityMethodLabels, qualitySourceLabels, type QualityActionInput, type QualityActionKind, type QualityCause, type QualityIssue, type QualityMethod, type QualitySource } from './qualityExceptionTypes';
import './quality-exception-action-form.css';

export interface QualityExceptionActionFormProps {
  issue: QualityIssue;
  kind: QualityActionKind;
  onSubmit: (input: QualityActionInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}

type Draft = Record<'owner' | 'verifier' | 'dueDate' | 'category' | 'detail' | 'responsibility' | 'evidence' | 'method' | 'handledQty' | 'quantity' | 'result' | 'note' | 'source' | 'reference', string>;
type Field = keyof Draft;
type Errors = Partial<Record<Field | 'submit', string>>;
const FIELDS: Record<QualityActionKind, Field[]> = {
  assign: ['owner', 'verifier', 'dueDate', 'note'],
  cause: ['category', 'detail', 'responsibility', 'evidence'],
  disposition: ['method', 'handledQty', 'detail', 'evidence'],
  submit_verification: ['note'], verify: ['quantity', 'result', 'note', 'evidence'],
  close: ['note'], feedback: ['source', 'reference', 'note'],
};
const DESCRIPTIONS: Record<QualityActionKind, string> = {
  assign: '指定经办、验证人和处理期限。经办分派不代表责任认定。',
  cause: '登记人工核对后的原因、责任说明与依据。',
  disposition: '登记已完成处置的演示事实。退换货计划不等同于已经完成处置。',
  submit_verification: '核对原因与全部不良数量的处置记录，提交验证人复检。',
  verify: '登记本轮复检数量、结果和依据；复检不通过将返回处理中。',
  close: '核对当前原因、处置及全量通过的复检记录后，填写关闭说明。',
  feedback: '关联来源反馈与单据，补充追溯信息。本次不增加异常的不良数量。',
};

function initialDraft(issue: QualityIssue, kind: QualityActionKind): Draft {
  return {
    owner: issue.owner, verifier: issue.verifier, dueDate: issue.dueDate,
    category: issue.causeCategory, responsibility: issue.responsibility,
    detail: kind === 'cause' ? issue.causeDetail : kind === 'disposition' ? issue.dispositionDetail : '',
    evidence: kind === 'cause' ? issue.causeEvidence : kind === 'disposition' ? issue.dispositionEvidence : '',
    method: issue.dispositionMethod, handledQty: issue.handledQty > 0 ? String(issue.handledQty) : '',
    quantity: '', result: '', note: '', source: '', reference: '',
  };
}

function validDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function quantityValue(value: string) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const quantity = Number(value.trim());
  return Number.isFinite(quantity) && quantity <= Number.MAX_SAFE_INTEGER / 1000 ? quantity : NaN;
}

export function QualityExceptionActionForm({ issue, kind, onSubmit, onDirtyChange, onCancel }: QualityExceptionActionFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => initialDraft(issue, kind));
  const cleanDraft = useRef(JSON.stringify(draft));
  const initialScope = useRef(`${issue.id}:${kind}`);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const invalidFocus = useRef<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmation, setConfirmation] = useState<{ input: QualityActionInput; issueId: string; version: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const locked = busy || Boolean(confirmation);
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const fieldId = (field: Field) => `quality-action-${field}`;
  const numberLabel = (value: number) => Number.isFinite(value) ? value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 }) : '—';
  const blockers = initialScope.current !== `${issue.id}:${kind}` ? [t('当前异常或操作已变化，请重新打开操作表单。')]
    : !allowedQualityActions(issue).includes(kind) ? [t('当前异常状态不支持此操作，请核对最新处理记录。')]
      : kind === 'submit_verification' ? qualityVerificationBlockers(issue)
        : kind === 'close' ? qualityCloseBlockers(issue) : [];

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function focusField(field: Field) {
    const element = formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  function change(field: Field, value: string) {
    if (busyRef.current || confirmation) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, submit: undefined }));
    setSaved(false);
  }

  function validate(): QualityActionInput | null {
    const next: Errors = {};
    if (blockers.length) next.submit = blockers.map((message) => t(message)).join('；');
    const requireText = (field: Field, label: string, limit = 2000) => {
      if (!draft[field].trim()) next[field] = t('请填写{label}。', { label });
      else if (draft[field].trim().length > limit) next[field] = t('{label}不能超过 {limit} 个字符。', { label, limit });
    };
    if (kind === 'assign') {
      if (!qualityDemoPeople.includes(draft.owner)) next.owner = t('请选择演示经办人员。');
      if (!qualityDemoPeople.includes(draft.verifier)) next.verifier = t('请选择演示验证人员。');
      if (!validDate(draft.dueDate) || draft.dueDate < issue.discoveredDate) next.dueDate = t('处理期限须为不早于发现日的有效日期。');
      requireText('note', t('分派说明'));
    } else if (kind === 'cause') {
      if (!Object.hasOwn(qualityCauseLabels, draft.category)) next.category = t('请选择原因类别。');
      requireText('detail', t('原因说明')); requireText('responsibility', t('责任说明')); requireText('evidence', t('原因依据'));
    } else if (kind === 'disposition') {
      if (!Object.hasOwn(qualityMethodLabels, draft.method)) next.method = t('请选择处置方式。');
      const quantity = quantityValue(draft.handledQty);
      if (!Number.isFinite(quantity) || quantity <= 0) next.handledQty = t('请填写大于 0 的累计已处置数量，最多保留 3 位小数。');
      else if (!Number.isFinite(issue.defectiveQty) || !Number.isFinite(issue.handledQty) || quantity > issue.defectiveQty || quantity < issue.handledQty) next.handledQty = t('累计已处置数量不得少于已有的 {handled} {unit}，也不得超过不良数量 {defective} {unit}。', { handled: numberLabel(issue.handledQty), defective: numberLabel(issue.defectiveQty), unit: issue.unit });
      requireText('detail', t('已完成处置说明')); requireText('evidence', t('处置依据'));
    } else if (kind === 'verify') {
      const quantity = quantityValue(draft.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) next.quantity = t('请填写大于 0 的复检数量，最多保留 3 位小数。');
      else if (!Number.isFinite(issue.defectiveQty) || quantity > issue.defectiveQty) next.quantity = t('复检数量不得超过不良数量 {quantity} {unit}。', { quantity: numberLabel(issue.defectiveQty), unit: issue.unit });
      else if (draft.result === 'passed' && Math.round(quantity * 1000) !== Math.round(issue.defectiveQty * 1000)) next.quantity = t('通过复检须覆盖全部不良数量 {quantity} {unit}。', { quantity: numberLabel(issue.defectiveQty), unit: issue.unit });
      if (!['passed', 'failed'].includes(draft.result)) next.result = t('请选择复检结果。');
      requireText('note', t('复检结论说明')); requireText('evidence', t('复检依据'));
    } else if (kind === 'feedback') {
      if (!Object.hasOwn(qualitySourceLabels, draft.source)) next.source = t('请选择反馈来源。');
      requireText('reference', t('关联单据号'), 120); requireText('note', t('反馈摘要'));
    } else requireText('note', t(kind === 'close' ? '关闭说明' : '提交复检说明'));
    setErrors(next);
    invalidFocus.current = FIELDS[kind].find((field) => next[field]) ?? null;
    if (Object.keys(next).length) {
      if (invalidFocus.current && !confirmation) focusField(invalidFocus.current);
      return null;
    }
    const text = (field: Field) => draft[field].trim();
    switch (kind) {
      case 'assign': return { kind, owner: draft.owner, verifier: draft.verifier, dueDate: draft.dueDate, note: text('note') };
      case 'cause': return { kind, category: draft.category as QualityCause, detail: text('detail'), responsibility: text('responsibility'), evidence: text('evidence') };
      case 'disposition': return { kind, method: draft.method as QualityMethod, handledQty: quantityValue(draft.handledQty), detail: text('detail'), evidence: text('evidence') };
      case 'verify': return { kind, quantity: quantityValue(draft.quantity), result: draft.result as 'passed' | 'failed', note: text('note'), evidence: text('evidence') };
      case 'feedback': return { kind, source: draft.source as QualitySource, reference: text('reference'), note: text('note') };
      default: return { kind, note: text('note') };
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || confirmation) return;
    setSaved(false);
    const input = validate();
    if (input) setConfirmation({ input, issueId: issue.id, version: issue.version });
  }

  async function confirm() {
    if (!confirmation || busyRef.current) return;
    const input = validate();
    if (!input) { setConfirmation(null); return; }
    if (confirmation.issueId !== issue.id || confirmation.version !== issue.version || JSON.stringify(input) !== JSON.stringify(confirmation.input)) {
      setConfirmation(null);
      setErrors({ submit: t('异常记录或填写内容已变化，请核对后重新保存。填写内容已保留。') });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    try {
      await onSubmit(input);
      if (!alive.current) return;
      cleanDraft.current = JSON.stringify(draft);
      setConfirmation(null);
      setSaved(true);
      onDirtyChange?.(false);
    } catch (cause) {
      if (alive.current) {
        setConfirmation(null);
        setErrors({ submit: cause instanceof Error ? cause.message : t('演示记录未保存，填写内容已保留，请重试。') });
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const fieldError = (field: Field) => errors[field] ? <p id={`${fieldId(field)}-error`} role="alert" className="text-pretty text-xs leading-5 text-destructive">{errors[field]}</p> : null;
  const propsFor = (field: Field) => ({ id: fieldId(field), disabled: locked, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined });
  const labelFor = (field: Field, label: string) => <Label htmlFor={fieldId(field)}>{label}<span aria-hidden="true" className="text-destructive"> *</span></Label>;
  const selectField = (field: Field, label: string, options: Record<string, string>) => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<Select value={draft[field]} disabled={locked} onValueChange={(value) => change(field, value)}><SelectTrigger {...propsFor(field)} aria-required="true" className="w-full min-w-0"><SelectValue placeholder={t('请选择')} /></SelectTrigger><SelectContent>{Object.entries(options).map(([value, name]) => <SelectItem key={value} value={value}>{t(name)}</SelectItem>)}</SelectContent></Select>{fieldError(field)}</div>;
  const paragraphField = (field: Field, label: string, placeholder = '') => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<Textarea {...propsFor(field)} required maxLength={2000} value={draft[field]} placeholder={placeholder} onChange={(event) => change(field, event.target.value)} className="min-h-20 resize-y" />{fieldError(field)}</div>;
  const quantityField = (field: 'quantity' | 'handledQty', label: string) => <div className="min-w-0 space-y-1.5">{labelFor(field, label)}<div className="relative min-w-0"><Input {...propsFor(field)} type="text" inputMode="decimal" required value={draft[field]} onChange={(event) => change(field, event.target.value)} placeholder="0.000" className="min-w-0 pr-12 tabular-nums" /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{issue.unit}</span></div>{fieldError(field)}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('最多 3 位小数')}</p></div>;
  const people = Object.fromEntries(qualityDemoPeople.map((name) => [name, name]));
  const summary = (input: QualityActionInput): [string, string][] => {
    switch (input.kind) {
      case 'assign': return [['经办', input.owner], ['验证人', input.verifier], ['处理期限', input.dueDate], ['分派说明', input.note]];
      case 'cause': return [['原因类别', t(qualityCauseLabels[input.category])], ['原因说明', input.detail], ['责任说明', input.responsibility], ['原因依据', input.evidence]];
      case 'disposition': return [['处置方式', t(qualityMethodLabels[input.method])], ['累计已处置数量', `${numberLabel(input.handledQty)} ${issue.unit}`], ['已完成处置说明', input.detail], ['处置依据', input.evidence]];
      case 'verify': return [['复检数量', `${numberLabel(input.quantity)} ${issue.unit}`], ['复检结果', t(input.result === 'passed' ? '通过' : '不通过')], ['复检结论说明', input.note], ['复检依据', input.evidence]];
      case 'feedback': return [['反馈来源', t(qualitySourceLabels[input.source])], ['关联单据号', input.reference], ['反馈摘要', input.note]];
      default: return [[input.kind === 'close' ? '关闭说明' : '提交复检说明', input.note]];
    }
  };
  const currentEvidence: [string, string][] = [
    ['当前原因说明', issue.causeDetail], ['当前责任说明', issue.responsibility], ['当前原因依据', issue.causeEvidence],
    ['当前处置方式', issue.dispositionMethod ? t(qualityMethodLabels[issue.dispositionMethod]) : '—'],
    ['当前处置说明', issue.dispositionDetail], ['当前处置依据', issue.dispositionEvidence],
    ...(kind === 'close' ? [['当前复检结论', issue.verificationNote], ['当前复检依据', issue.verificationEvidence]] as [string, string][] : []),
  ];

  return <>
    <form ref={formRef} onSubmit={submit} noValidate aria-labelledby="quality-action-title" aria-busy={busy} className="quality-exception-action-form min-w-0 rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-4 sm:px-5"><h3 id="quality-action-title" className="flex items-center gap-2 text-balance text-base font-semibold"><ClipboardCheck aria-hidden="true" className="size-4 text-primary" />{t(qualityActionLabels[kind])}</h3><p className="mt-1.5 text-pretty text-xs leading-5 text-muted-foreground">{t(DESCRIPTIONS[kind])}</p></header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-5"><p className="break-words font-medium">{issue.code} · {issue.materialName}</p><p className="text-pretty text-muted-foreground">{t('不良数量')} <span className="font-medium tabular-nums text-foreground">{numberLabel(issue.defectiveQty)} {issue.unit}</span>{kind === 'disposition' && <> · {t('已完成处置')} <span className="font-medium tabular-nums text-foreground">{numberLabel(issue.handledQty)} {issue.unit}</span></>}</p></div>
        {kind === 'submit_verification' || kind === 'close' ? <section aria-label={t('保存前核对')} className="space-y-2 rounded-lg border border-border px-3 py-3"><h4 className="text-balance text-xs font-semibold">{t(kind === 'close' ? '关闭前核对' : '提交复检前核对')}</h4><dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs leading-5"><div className="min-w-0"><dt className="text-muted-foreground">{t('经办 / 验证人')}</dt><dd className="break-words">{issue.owner || '—'} / {issue.verifier || '—'}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">{t('累计已处置')}</dt><dd className="tabular-nums">{numberLabel(issue.handledQty)} / {numberLabel(issue.defectiveQty)} {issue.unit}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">{t('当前原因')}</dt><dd className="break-words">{issue.causeCategory ? t(qualityCauseLabels[issue.causeCategory]) : t('未确认')}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">{t('当前复检')}</dt><dd className="break-words tabular-nums">{t(issue.verificationResult === 'passed' ? '通过' : issue.verificationResult === 'failed' ? '不通过' : '待复检')} · {numberLabel(issue.verificationQty)} {issue.unit}</dd></div></dl>{blockers.length === 0 && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t(kind === 'close' ? '当前原因、处置及复检依据已填写，全量复检通过。' : '经办、原因与处置依据已填写，全部不良数量已完成处置。')}</p>}</section> : null}
        {(kind === 'submit_verification' || kind === 'close') && <details className="rounded-lg border border-border px-3 py-3 text-xs leading-5"><summary className="cursor-pointer rounded text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t(kind === 'close' ? '查看原因、处置与复检依据' : '查看当前原因与处置依据')}</summary><dl className="mt-3 min-w-0 space-y-3">{currentEvidence.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-pretty">{value || t('未填写')}</dd></div>)}</dl></details>}
        {blockers.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 text-amber-900"><p className="text-pretty text-xs font-medium">{t('暂不能保存此操作')}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-pretty text-xs leading-5">{blockers.map((message, index) => <li key={index}>{t(message)}</li>)}</ul></div>}
        <p className="text-xs text-muted-foreground">{t('标 * 为必填')}</p>
        {kind === 'assign' && <><div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{selectField('owner', t('演示经办'), people)}{selectField('verifier', t('演示验证人'), people)}</div><div className="min-w-0 space-y-1.5">{labelFor('dueDate', t('处理期限'))}<Input {...propsFor('dueDate')} type="date" min={issue.discoveredDate} value={draft.dueDate} required onChange={(event) => change('dueDate', event.target.value)} className="min-w-0 tabular-nums" />{fieldError('dueDate')}</div>{paragraphField('note', t('分派说明'))}</>}
        {kind === 'cause' && <>{selectField('category', t('原因类别'), qualityCauseLabels)}{paragraphField('detail', t('原因说明'), t('填写已核对的主因及具体情况'))}{paragraphField('responsibility', t('责任说明'), t('说明已确认的责任结论与认定依据'))}{paragraphField('evidence', t('原因依据'), t('填写核对说明或关联单据号'))}</>}
        {kind === 'disposition' && <>{selectField('method', t('处置方式'), qualityMethodLabels)}{quantityField('handledQty', t('累计已处置数量'))}<p className="text-pretty text-xs leading-5 text-muted-foreground">{t('填写截至本次已完成的累计数量，不能减少已有处置数量。退货已退回、换补已完成等事实须在说明与依据中写明。')}</p>{paragraphField('detail', t('已完成处置说明'))}{paragraphField('evidence', t('处置依据'), t('填写完成情况核对说明或关联单据号'))}</>}
        {kind === 'submit_verification' && paragraphField('note', t('提交复检说明'))}
        {kind === 'verify' && <><div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">{quantityField('quantity', t('本轮复检数量'))}{selectField('result', t('复检结果'), { passed: '通过', failed: '不通过' })}</div><p className="text-pretty text-xs leading-5 text-muted-foreground">{t('通过须覆盖全部不良数量；不通过会返回处理中，重新登记处置后再提交复检。')}</p>{paragraphField('note', t('复检结论说明'))}{paragraphField('evidence', t('复检依据'), t('填写复检记录说明或关联检验单号'))}</>}
        {kind === 'close' && paragraphField('note', t('关闭说明'))}
        {kind === 'feedback' && <>{selectField('source', t('反馈来源'), qualitySourceLabels)}<div className="min-w-0 space-y-1.5">{labelFor('reference', t('关联单据号'))}<Input {...propsFor('reference')} value={draft.reference} required maxLength={120} placeholder={t('填写生产反馈单或售后记录编号')} onChange={(event) => change('reference', event.target.value)} />{fieldError('reference')}</div>{paragraphField('note', t('反馈摘要'))}</>}
        {['cause', 'disposition', 'verify'].includes(kind) && <p className="text-pretty text-xs leading-5 text-muted-foreground">{t('本次依据为文字说明或关联单据号，不提供附件上传。')}</p>}
        {errors.submit && <p role="alert" className="text-pretty text-sm leading-6 text-destructive">{errors.submit}</p>}
        {saved && <p role="status" className="text-pretty text-sm leading-6 text-primary">{t('演示记录已保存。')}</p>}
      </div>
      <footer className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5"><Button type="button" variant="outline" disabled={locked} onClick={() => { if (!busyRef.current && !confirmation) onCancel(); }}>{t('取消填写')}</Button><Button ref={submitRef} type="submit" disabled={locked || blockers.length > 0}>{t(busy ? '保存中…' : '保存演示记录')}</Button></footer>
    </form>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busyRef.current) { invalidFocus.current = null; setConfirmation(null); } }}>
      <AlertDialogContent className="quality-action-confirm proc-horizon-overlay min-w-0" overlayClassName="quality-action-confirm-overlay" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); const field = invalidFocus.current; invalidFocus.current = null; if (field) focusField(field); else submitRef.current?.focus(); }}>
        <AlertDialogHeader><AlertDialogTitle>{t('确认保存演示记录')}</AlertDialogTitle><AlertDialogDescription>{t('请核对异常、操作和本次填写。保存后会更新本页演示记录。')}</AlertDialogDescription></AlertDialogHeader>
        <div className="min-w-0 space-y-3 text-xs leading-5"><div className="rounded-lg bg-muted/40 px-3 py-2.5"><p className="break-words font-semibold">{issue.code} · {issue.materialName}</p><p className="mt-1 break-words text-muted-foreground">{t('批次')} {issue.batchNo || '—'} · {t(qualityActionLabels[confirmation?.input.kind ?? kind])}</p></div><dl className="min-w-0 space-y-3">{confirmation && summary(confirmation.input).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{t(label)}</dt><dd className={cn('mt-0.5 whitespace-pre-wrap break-words text-pretty font-medium', ['累计已处置数量', '复检数量', '处理期限'].includes(label) && 'tabular-nums')}>{value}</dd></div>)}</dl></div>
        <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={(event) => { if (busyRef.current) event.preventDefault(); }}>{t('继续修改')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{t(busy ? '保存中…' : '确认保存演示记录')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
