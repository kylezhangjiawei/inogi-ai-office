import type { Prisma } from '@prisma/client';

export const SAMPLE_TEST_RESULTS = ['passed', 'failed_resample', 'failed_requote'] as const;
export type SampleTestResult = typeof SAMPLE_TEST_RESULTS[number];
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
}

export const SAMPLE_TEST_RESULT_LABELS: Record<SampleTestResult, string> = {
  passed: '测试通过',
  failed_resample: '测试不通过，重新送样',
  failed_requote: '测试不通过，重新询价',
};

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
  };
}
