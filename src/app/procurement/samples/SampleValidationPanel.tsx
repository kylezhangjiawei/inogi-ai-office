import { useId } from 'react';
import { NativeSelect } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import { useI18n } from '../../lib/i18n';
import type { ProcSampleValidation, ProcSampleValidationReference } from '../../lib/procurementApi';
import { emptySampleValidation, SAMPLE_VALIDATION_ITEMS } from './sampleValidationModel';

export function SampleValidationPanel({ value, references, onChange, disabled, readOnly = false }: {
  value: ProcSampleValidation | null; references: ProcSampleValidationReference[];
  onChange?: (value: ProcSampleValidation) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const { t } = useI18n();
  const prefix = useId();
  const edit = (key: ProcSampleValidation['checks'][number]['key'], patch: Partial<ProcSampleValidation['checks'][number]>) => {
    if (value && !disabled && !readOnly) onChange?.({ ...value, checks: value.checks.map((entry) => entry.key === key ? { ...entry, ...patch } : entry) });
  };
  return <section className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label={t('验证类型与依据')}>
    <div className="max-w-2xl space-y-2"><h3 className="text-sm font-semibold">{t('验证类型与依据')}</h3>
      <p className="text-xs leading-5 text-muted-foreground">{t('选择本轮用途，逐项核对适用资料。确认结论时保存版本和本人核对记录。')}</p>
      {readOnly ? <p className="text-sm font-medium">{t(value?.kind === 'transfer' ? '转产验证' : value?.kind === 'exploration' ? '研发探索' : '历史未分类 · 未保存验证依据')}</p> : <NativeSelect aria-label={t('验证类型')} value={value?.kind || ''} disabled={disabled} onChange={(event) => {
        const kind = event.target.value as ProcSampleValidation['kind'];
        onChange?.(value ? { ...value, kind } : emptySampleValidation(kind));
      }}><option value="">{t('请选择验证类型')}</option><option value="exploration">{t('研发探索')}</option><option value="transfer">{t('转产验证')}</option></NativeSelect>}
      {value?.kind === 'transfer' && <p className="text-xs leading-5 text-muted-foreground">{t('转产验证的图纸、SIP、SOP及适用治具需固定资料版本，试装 / 小批需通过结果及证据。该确认不替代生产端独立转产验证。')}</p>}
    </div>
    {value && <div className="divide-y divide-border">{SAMPLE_VALIDATION_ITEMS.map(([key, label]) => {
      const check = value.checks.find((entry) => entry.key === key);
      const reference = check?.reference || references.find((entry) => entry.id === check?.referenceId);
      return <div key={key} className="grid min-w-0 gap-3 py-4 first:pt-0 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <h4 className="text-sm font-medium">{t(label)}</h4>
        {readOnly ? <div className="min-w-0 space-y-1 text-sm"><p>{t(check?.applicability === 'not_applicable' ? '不适用' : reference ? '已核对' : '未记录依据')}{reference ? ` · ${reference.fileName} · ${reference.version || t('未登记版本')}` : ''}</p>{check?.outcome && <p>{t(check.outcome === 'passed' ? '验证通过' : '验证未通过')}</p>}{check?.reason && <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{check.reason}</p>}</div> : <div className="min-w-0 space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <NativeSelect aria-label={`${t(label)}${t('适用性')}`} value={check?.applicability || 'required'} disabled={disabled} onChange={(event) => edit(key, { applicability: event.target.value as 'required' | 'not_applicable', referenceId: '', outcome: undefined })}>
              <option value="required">{t('适用 · 需核对')}</option><option value="not_applicable" disabled={value.kind === 'transfer' && key !== 'fixture'}>{t('不适用')}</option>
            </NativeSelect>
            {check?.applicability !== 'not_applicable' && <NativeSelect aria-label={`${t(label)}${t('依据文件')}`} value={check?.referenceId || ''} disabled={disabled} onChange={(event) => edit(key, { referenceId: event.target.value })}>
              <option value="">{t('选择交付版本或本任务附件')}</option>{references.map((entry) => <option key={entry.id} value={entry.id}>{entry.fileName} · {entry.version || t('未登记版本')}</option>)}
            </NativeSelect>}
          </div>
          {key === 'trial' && check?.applicability !== 'not_applicable' && <NativeSelect aria-label={t('试装 / 小批验证结果')} value={check?.outcome || ''} disabled={disabled} onChange={(event) => edit(key, { outcome: event.target.value as 'passed' | 'failed' })}><option value="">{t('选择验证结果')}</option><option value="passed">{t('通过')}</option><option value="failed">{t('未通过')}</option></NativeSelect>}
          {(key === 'trial' || check?.applicability === 'not_applicable') && <div><label htmlFor={`${prefix}-${key}`} className="mb-1 block text-xs text-muted-foreground">{t(check?.applicability === 'not_applicable' ? '不适用原因（必填）' : '试装 / 小批结果说明（必填）')}</label><Textarea id={`${prefix}-${key}`} value={check?.reason || ''} disabled={disabled} maxLength={500} rows={2} onChange={(event) => edit(key, { reason: event.target.value })} /></div>}
        </div>}
      </div>;
    })}</div>}
    {!readOnly && !references.length && <p role="status" className="rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">{t('暂无可选择的依据。请先在原研发任务登记资料版本并交付，或在采购任务上传本轮试验附件。缺少依据时可提交未通过结论，不能确认转产验证通过。')}</p>}
  </section>;
}
