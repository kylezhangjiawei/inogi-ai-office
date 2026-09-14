import type { ProcSampleCommercialConditions, ProcSampleTestAssignment } from '../../lib/procurementApi';

export const EMPTY_SAMPLE_CONDITIONS: ProcSampleCommercialConditions = {
  priceUnit: '', taxBasis: 'unspecified', taxRate: null, paymentTerms: '', freightTerms: '',
  leadTimeStart: 'unspecified', leadTimeStartDate: null, note: '',
};

export function sampleLocalTime(value: string | null | undefined): string {
  if (!value || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return '';
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return '';
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

export function sampleInputTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || sampleLocalTime(date.toISOString()) !== (value.length === 16 ? `${value}:00` : value)) return null;
  return date.toISOString();
}

export function sampleRecordsDraft(sample: ProcSampleTestAssignment | null) {
  return { arrivedAt: sampleLocalTime(sample?.arrivedAt), startedAt: sampleLocalTime(sample?.startedAt), finishedAt: sampleLocalTime(sample?.finishedAt),
    commercial: { ...EMPTY_SAMPLE_CONDITIONS, ...sample?.commercial } };
}

export function sampleDraftTimingError(draft: ReturnType<typeof sampleRecordsDraft>): string | null {
  const values = [draft.arrivedAt, draft.startedAt, draft.finishedAt].map((value) => value ? sampleInputTimestamp(value) : null);
  if ([draft.arrivedAt, draft.startedAt, draft.finishedAt].some((value, index) => value && (!values[index] || Date.parse(values[index]!) > Date.now()))) return '实际时间必须有效且不晚于当前时间';
  if (values[1] && !values[0]) return '请先由采购登记实际到样时间';
  if (values[2] && !values[1]) return '请先登记实际开测时间';
  if (values[0] && values[1] && values[0] > values[1]) return '实际开测时间不能早于到样时间';
  if (values[1] && values[2] && values[1] > values[2]) return '实际结束时间不能早于开测时间';
  return null;
}
