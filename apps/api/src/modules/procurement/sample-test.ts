import type { Prisma } from '@prisma/client';

export const SAMPLE_TEST_RESULTS = ['passed', 'failed_resample', 'failed_requote'] as const;
export type SampleTestResult = typeof SAMPLE_TEST_RESULTS[number];
export interface SampleCommercialConditions {
  priceUnit: string;
  taxBasis: 'inclusive' | 'exclusive' | 'unspecified';
  taxRate: number | null;
  paymentTerms: string;
  freightTerms: string;
  leadTimeStart: 'order' | 'deposit' | 'approval' | 'agreed_date' | 'other' | 'unspecified';
  leadTimeStartDate: string | null;
  note: string;
}
export interface SampleRecordRevision {
  recordedAt: string; recordedById: string; recordedByName: string;
  arrivedAt: string | null; startedAt: string | null; finishedAt: string | null;
  commercial?: SampleCommercialConditions | null;
}
export interface ProcurementSampleTest {
  roundId: string;
  testerUserId: string;
  testerName: string;
  assignedAt: string;
  assignedByName: string;
  result: SampleTestResult | null;
  note: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  recordsVersion?: 1;
  arrivedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  commercial?: SampleCommercialConditions | null;
  revisions?: SampleRecordRevision[];
  archivedAt?: string;
  archiveReason?: 'reassigned' | 'new_sample' | 'workflow_ended';
}

export const SAMPLE_TEST_RESULT_LABELS: Record<SampleTestResult, string> = {
  passed: '测试通过',
  failed_resample: '测试不通过，重新送样',
  failed_requote: '测试不通过，重新询价',
};

function commercialOf(value: Prisma.JsonValue | undefined): SampleCommercialConditions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['priceUnit', 'paymentTerms', 'freightTerms', 'note'].every((key) => typeof value[key] === 'string')
    || !['inclusive', 'exclusive', 'unspecified'].includes(String(value.taxBasis))
    || !['order', 'deposit', 'approval', 'agreed_date', 'other', 'unspecified'].includes(String(value.leadTimeStart))
    || (value.taxRate != null && (typeof value.taxRate !== 'number' || !Number.isFinite(value.taxRate)))) return null;
  return { priceUnit: value.priceUnit as string, paymentTerms: value.paymentTerms as string, freightTerms: value.freightTerms as string, note: value.note as string,
    taxBasis: value.taxBasis as SampleCommercialConditions['taxBasis'], taxRate: value.taxRate as number | null ?? null,
    leadTimeStart: value.leadTimeStart as SampleCommercialConditions['leadTimeStart'], leadTimeStartDate: typeof value.leadTimeStartDate === 'string' ? value.leadTimeStartDate : null };
}

export function sampleTestOf(metadata: Prisma.JsonValue | undefined): ProcurementSampleTest | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata.sampleTest;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['roundId', 'testerUserId', 'testerName', 'assignedAt', 'assignedByName'].every((key) => typeof value[key] === 'string')) return null;
  if (value.result !== null && !SAMPLE_TEST_RESULTS.includes(value.result as SampleTestResult)) return null;
  return {
    roundId: value.roundId as string, testerUserId: value.testerUserId as string, testerName: value.testerName as string,
    assignedAt: value.assignedAt as string, assignedByName: value.assignedByName as string,
    result: value.result as SampleTestResult | null,
    note: typeof value.note === 'string' ? value.note : null,
    confirmedAt: typeof value.confirmedAt === 'string' ? value.confirmedAt : null,
    confirmedByName: typeof value.confirmedByName === 'string' ? value.confirmedByName : null,
    ...(value.recordsVersion === 1 ? {
      recordsVersion: 1 as const,
      arrivedAt: typeof value.arrivedAt === 'string' ? value.arrivedAt : null,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
      finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
      commercial: commercialOf(value.commercial),
      revisions: Array.isArray(value.revisions) ? value.revisions.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
          || !['recordedAt', 'recordedById', 'recordedByName'].every((key) => typeof entry[key] === 'string')) return [];
        return [{ recordedAt: entry.recordedAt as string, recordedById: entry.recordedById as string, recordedByName: entry.recordedByName as string,
          arrivedAt: typeof entry.arrivedAt === 'string' ? entry.arrivedAt : null, startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : null,
          finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : null,
          ...(Object.prototype.hasOwnProperty.call(entry, 'commercial') ? { commercial: commercialOf(entry.commercial) } : {}) }];
      }) : [],
    } : {}),
    ...(typeof value.archivedAt === 'string' ? { archivedAt: value.archivedAt } : {}),
    ...(['reassigned', 'new_sample', 'workflow_ended'].includes(String(value.archiveReason))
      ? { archiveReason: value.archiveReason as ProcurementSampleTest['archiveReason'] } : {}),
  };
}

export function sampleTestHistoryOf(metadata: Prisma.JsonValue | undefined): ProcurementSampleTest[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !Array.isArray(metadata.sampleTestHistory)) return [];
  return metadata.sampleTestHistory.flatMap((sampleTest) => {
    const parsed = sampleTestOf({ sampleTest });
    return parsed ? [parsed] : [];
  });
}

/** Preserve raw previous entries too: a legacy malformed row must not be silently deleted by a later write. */
export function archiveSampleTest(metadata: Prisma.JsonValue, reason: NonNullable<ProcurementSampleTest['archiveReason']>): Prisma.JsonObject {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const current = sampleTestOf(metadata);
  const history = Array.isArray(source.sampleTestHistory) ? source.sampleTestHistory : [];
  if (!current) {
    if (source.sampleTest && typeof source.sampleTest === 'object' && !Array.isArray(source.sampleTest)) return {
      ...source, sampleTestHistory: [...history, { ...source.sampleTest, archivedAt: new Date().toISOString(), archiveReason: reason }],
    };
    return { ...source };
  }
  if (history.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.roundId === current.roundId)) return { ...source };
  return { ...source, sampleTestHistory: [...history, { ...(source.sampleTest as Prisma.JsonObject), archivedAt: new Date().toISOString(), archiveReason: reason }] };
}

/** R&D receives timing and conclusions, never commercial fields (including their revisions). */
export function sampleTestWithoutCommercial(sample: ProcurementSampleTest | null): ProcurementSampleTest | null {
  if (!sample) return null;
  const { commercial: _commercial, ...visible } = sample;
  return { ...visible, ...(sample.revisions ? { revisions: sample.revisions.map(({ commercial: _terms, ...revision }) => revision) } : {}) };
}

export function sampleTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function sampleTimingError(sample: Pick<ProcurementSampleTest, 'arrivedAt' | 'startedAt' | 'finishedAt'>, now = Date.now()): string | null {
  for (const value of [sample.arrivedAt, sample.startedAt, sample.finishedAt]) {
    if (value != null && (!sampleTimestamp(value) || Date.parse(value) > now)) return '实际时间必须是有效且不晚于当前时间的日期时间';
  }
  if (sample.startedAt && !sample.arrivedAt) return '请先由采购登记实际到样时间';
  if (sample.finishedAt && !sample.startedAt) return '请先登记实际开测时间';
  if (sample.arrivedAt && sample.startedAt && Date.parse(sample.startedAt) < Date.parse(sample.arrivedAt)) return '实际开测时间不能早于到样时间';
  if (sample.startedAt && sample.finishedAt && Date.parse(sample.finishedAt) < Date.parse(sample.startedAt)) return '实际结束时间不能早于开测时间';
  return null;
}
