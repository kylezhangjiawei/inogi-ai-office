import type { ProcSampleTestDetail } from "../../lib/procurementApi";
import { getProcSampleFacts } from "../../lib/procSampleFacts";

type TimingInput = Pick<ProcSampleTestDetail, "task" | "sampleTest">;
export interface SampleTimeValue { value: string | null; state: "recorded" | "missing" | "invalid" }

function calendarDate(value: string): boolean {
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** An operation time must include a timezone; date-only legacy labels are not timestamps. */
export function sampleOperationTime(value: unknown): SampleTimeValue {
  if (value === null || value === undefined || value === "") return { value: null, state: "missing" };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !calendarDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return { value: null, state: "invalid" };
  return { value, state: "recorded" };
}

function expectedDate(value: unknown): SampleTimeValue {
  if (value === null || value === undefined || value === "") return { value: null, state: "missing" };
  if (typeof value === "string" && (calendarDate(value) || sampleOperationTime(value).state === "recorded")) {
    return { value: value.slice(0, 10), state: "recorded" };
  }
  return { value: null, state: "invalid" };
}

export function sampleTiming(detail: TimingInput) {
  const sample = detail.sampleTest;
  const assigned = sampleOperationTime(sample?.assignedAt);
  const submitted = sampleOperationTime(sample?.confirmedAt);
  const hasResult = Boolean(sample && ["passed", "failed_resample", "failed_requote"].includes(sample.result ?? ""));
  const inconsistent = Boolean(sample && (!sample.roundId?.trim() || !sample.testerUserId?.trim() || !sample.testerName?.trim()
    || !sample.assignedByName?.trim() || assigned.state !== "recorded"
    || (hasResult && (submitted.state !== "recorded" || !sample.confirmedByName?.trim() || !sample.note?.trim()))
    || (!hasResult && (sample.result !== null || sample.confirmedAt !== null || submitted.state !== "missing" || Boolean(sample.confirmedByName?.trim()) || Boolean(sample.note?.trim())))
    || (assigned.value && submitted.value && Date.parse(submitted.value) < Date.parse(assigned.value))));
  const facts = getProcSampleFacts({ ...detail.task, sampleTest: sample });
  const scope = !sample ? "none" : inconsistent ? "unverified"
    : facts.state === "confirmed" && facts.evidence.roundId === sample.roundId ? "current" : "retained";
  return { expected: expectedDate(detail.task.expectedArrivalDate), assigned, submitted, scope,
    tester: sample?.testerName || null, confirmedBy: hasResult && submitted.state === "recorded" ? sample?.confirmedByName || null : null,
    factsDescription: facts.description } as const;
}
