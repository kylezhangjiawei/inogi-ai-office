import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { useI18n } from '../../lib/i18n';
import { defectToday } from '../defects/defectModel';
import type { DefectState } from '../defects/defectTypes';
import { getRdVerifiers, validateRdAction } from './rdModel';
import { rdActionLabels, type RdAction, type RdActionKind, type RdState } from './rdTypes';
import { Textarea } from "../../components/ui/textarea";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import { Checkbox } from "../../components/ui/checkbox";

interface Props { state: RdState; defects: DefectState; issueId: string; actorId: string; kind: RdActionKind; onDirtyChange: (value: boolean) => void; onSubmit: (action: RdAction) => Promise<void>; onCancel: () => void }
type Fields = Record<string, string>;
export function RdActionForm({ state, defects, issueId, actorId, kind, onDirtyChange, onSubmit, onCancel }: Props) {
  const { t } = useI18n(); const issue = defects.issues.find((item) => item.id === issueId)!;
  const [values, setValues] = useState<Fields>(() => ({ ownerId: issue.direction === 'rd' ? issue.ownerId ?? '' : '', dueDate: issue.dueDate && issue.dueDate >= defectToday() ? issue.dueDate : defectToday(), drawingChange: '', sopChange: '', verifierId: '', plannedDate: defectToday(), date: defectToday(), result: '' }));
  const [reviewed, setReviewed] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const busyRef = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (Object.keys(errors).length) errorRef.current?.focus(); }, [errors]);
  const update = (name: string, value: string) => { setValues((old) => ({ ...old, [name]: value })); onDirtyChange(true); setErrors({}); };
  const field = (name: string, label: string, input: ReactNode, optional = false) => <div className="prd-field" key={name}><label htmlFor={`prd-${name}`}>{t(label)}{optional ? <small>{t('选填')}</small> : <span aria-hidden="true"> *</span>}</label>{input}{errors[name] ? <p id={`prd-${name}-error`} className="prd-field-error">{t(errors[name])}</p> : null}</div>;
  const attrs = (name: string) => ({ id: `prd-${name}`, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `prd-${name}-error` : undefined, disabled: busy, value: values[name] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => update(name, event.target.value) });
  const text = (name: string, label: string, placeholder: string, optional = false) => field(name, label, <Textarea {...attrs(name)} rows={name === 'text' ? 4 : 3} maxLength={2000} placeholder={t(placeholder)}/>, optional);
  const date = (name: string, label: string, actual = false) => field(name, label, <Input type="date" {...attrs(name)} min={actual ? issue.date : defectToday()} max={actual ? defectToday() : undefined}/>);
  const select = (name: string, label: string, options: Array<[string, string]>) => field(name, label, <NativeSelect {...attrs(name)}><option value="">{t('请选择')}</option>{options.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</NativeSelect>);
  function action(): RdAction {
    const base = { issueId, actorId, reviewed }; const value = (key: string) => values[key] ?? '';
    if (kind === 'assign') return { ...base, kind, ownerId: value('ownerId'), dueDate: value('dueDate'), description: value('description') };
    if (kind === 'request-info') return { ...base, kind, request: value('request') };
    if (kind === 'provide-info') return { ...base, kind, response: value('response'), evidence: value('evidence') };
    if (kind === 'opinion') return { ...base, kind, text: value('text'), basis: value('basis'), drawingChange: value('drawingChange') as 'yes' | 'no', drawingReference: value('drawingReference'), sopChange: value('sopChange') as 'yes' | 'no', sopReference: value('sopReference') };
    if (kind === 'send-verification') return { ...base, kind, verifierId: value('verifierId'), plannedDate: value('plannedDate') };
    if (kind === 'verify') return { ...base, kind, date: value('date'), result: value('result') as 'passed' | 'failed', evidence: value('evidence'), note: value('note') };
    return { ...base, kind, summary: value('summary') };
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busyRef.current) return;
    const input = action(); const nextErrors = validateRdAction(state, defects, input);
    setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    busyRef.current = true; setBusy(true);
    try { await onSubmit(input); } catch (error) { setErrors({ _form: error instanceof Error ? error.message : '保存未完成，填写已保留，请重试' }); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <form className="prd-action-form" onSubmit={submit} noValidate>
    <div className="prd-section-heading"><h3>{t(rdActionLabels[kind])}</h3><span>{issue.code}</span></div>
    {Object.keys(errors).length ? <p className="prd-error-summary" role="alert" tabIndex={-1} ref={errorRef}>{t(errors._form ?? '请检查下方标记项，填写内容已保留。')}</p> : null}
    <fieldset disabled={busy}>
      {kind === 'assign' ? <>{select('ownerId', '研发处理人', defects.actors.filter((actor) => actor.role === 'rd').map((actor) => [actor.id, actor.name]))}{date('dueDate', '处理截止日期')}{text('description', '交接说明', '说明研发需要解决的问题，以及已完成的排查')}</> : null}
      {kind === 'request-info' ? text('request', '补充资料要求', '明确需要的尺寸、复现条件、照片或记录编号') : null}
      {kind === 'provide-info' ? <>{text('response', '补充说明', '逐项回应研发提出的问题')}{text('evidence', '资料编号或证据摘要', '记录编号、图纸版本及补充发现')}</> : null}
      {kind === 'opinion' ? <>{text('text', '技术分析与处理建议', '写明技术判断、建议措施与现场验证方法')}{text('basis', '技术判断依据', '记录图纸版本、测量记录或试验依据')}{select('drawingChange', '是否需要更新图纸', [['no', '不需要'], ['yes', '需要']])}{values.drawingChange === 'yes' ? text('drawingReference', '图纸变更依据或 ECN 编号', '填写后续变更依据，提交意见不会自动更新受控图纸') : null}{select('sopChange', '是否需要更新 SOP', [['no', '不需要'], ['yes', '需要']])}{values.sopChange === 'yes' ? text('sopReference', 'SOP 变更依据或任务编号', '填写受控作业文件的变更依据') : null}</> : null}
      {kind === 'send-verification' ? <>{select('verifierId', '现场验证人', getRdVerifiers(defects, issueId).map((actor) => [actor.id, actor.name]))}{date('plannedDate', '计划验证日期')}<p className="prd-note">{t('本次安排绑定最新技术意见；未通过时返回研发重新分析。')}</p></> : null}
      {kind === 'verify' ? <>{date('date', '实际验证日期', true)}{select('result', '现场验证结果', [['passed', '技术方案验证通过'], ['failed', '未通过，退回研发']])}{text('note', '现场验证结论', '记录复现条件、执行措施与实际结果')}{text('evidence', '验证证据编号或摘要', '写明现场记录编号与核对依据')}<p className="prd-note">{t('现场技术验证不登记 QC 合格数量，不替代 QA 放行。')}</p></> : null}
      {kind === 'close' ? <>{text('summary', '技术协同关闭说明', '说明最新技术意见与验证结果已完成核对')}<p className="prd-note">{t('仅关闭本次技术协同。原不良仍按 P08 的整改与 QC 回执处理。')}</p></> : null}
      <label className="prd-review"><Checkbox checked={reviewed} onCheckedChange={(checkedValue) => { setReviewed((checkedValue === true)); onDirtyChange(true); setErrors({}); }} aria-invalid={!!errors.reviewed} aria-describedby={errors.reviewed ? 'prd-reviewed-error' : undefined}/><span>{t('已核对原异常及本次操作依据')}</span></label>
      {errors.reviewed ? <p id="prd-reviewed-error" className="prd-field-error">{t(errors.reviewed)}</p> : null}
    </fieldset>
    <div className="prd-form-buttons"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('取消填写')}</Button><Button type="submit" disabled={busy}>{t(busy ? '正在保存…' : rdActionLabels[kind])}</Button></div>
  </form>;
}
