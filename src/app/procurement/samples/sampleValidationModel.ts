import type { ProcSampleValidation, ProcSampleValidationReference } from '../../lib/procurementApi';

export const SAMPLE_VALIDATION_ITEMS = [
  ['drawing', '图纸 / 规格'], ['sip', 'SIP 检验规范'], ['sop', 'SOP 作业指导'], ['fixture', '治具依据'], ['trial', '试装 / 小批验证'],
] as const;
export function emptySampleValidation(kind: ProcSampleValidation['kind']): ProcSampleValidation {
  return { kind, checks: SAMPLE_VALIDATION_ITEMS.map(([key]) => ({ key, applicability: 'required', reason: '', referenceId: '' })) };
}
export function sampleValidationIssues(value: ProcSampleValidation | null, references: ProcSampleValidationReference[]): string[] {
  if (!value) return ['请选择研发探索或转产验证'];
  return SAMPLE_VALIDATION_ITEMS.flatMap(([key, label]) => {
    const check = value.checks.find((entry) => entry.key === key);
    if (!check) return [`请核对${label}`];
    if (check.applicability === 'not_applicable') {
      if (value.kind === 'transfer' && key !== 'fixture') return [`转产验证必须确认${label}`];
      return check.reason?.trim() ? [] : [`请说明${label}不适用的原因`];
    }
    const reference = references.find((entry) => entry.id === check.referenceId);
    if (!reference) return [`请选择${label}依据`];
    if (value.kind === 'transfer' && key !== 'trial' && (!reference.technicalDocumentVersionId || !reference.version)) return [`${label}需要固定版本`];
    if (key === 'trial' && (check.outcome !== 'passed' || !check.reason?.trim())) return ['请确认试装 / 小批验证通过并填写结果说明'];
    return [];
  });
}
