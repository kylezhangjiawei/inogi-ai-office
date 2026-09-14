import type { ProcurementTask, ProcLog, ProcSampleTestAssignment, ProcStatus } from './procurementApi';

export type ProcSampleFactsInput = Pick<ProcurementTask, 'status'> & Partial<Pick<
  ProcurementTask, 'needSample' | 'sampleTest' | 'sampleStatusNeedsReview' | 'logs'
>>;

export interface ProcSampleFacts {
  state: 'waiting' | 'confirmed' | 'unknown' | 'cancelled' | 'not_required';
  label: string;
  description: string;
  evidence: {
    kind: 'workflow' | 'test_assignment' | 'test_result' | 'none';
    /** The time of the supporting action, never the physical arrival time. */
    at: string | null;
    roundId: string | null;
  };
  /** Only an independently registered current-round time; never ETA, assignment or order receipt time. */
  arrivedAt: string | null;
}

const PRE_SAMPLE_STATUSES = new Set<ProcStatus>([
  'pending_rd_review', 'pending_confirm', 'pending_inquiry', 'inquiring', 'pending_purchase',
]);
const AFTER_SAMPLE_STATUSES = new Set<ProcStatus>(['priced', 'in_transit', 'partial_arrival', 'completed']);
const SAMPLE_STAGE: Record<ProcStatus, number> = {
  pending_rd_review: 0, pending_confirm: 1, pending_inquiry: 2, inquiring: 3,
  pending_sample: 4, testing: 5, priced: 6, pending_purchase: 6,
  in_transit: 7, partial_arrival: 8, completed: 9, cancelled: 10,
};

function timestamp(value: unknown): number | null {
  // Date-only legacy log labels cannot establish which action happened first within the day.
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  // Date.parse normalizes impossible calendar days; reject them before comparing action times.
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAssignment(sample: ProcSampleTestAssignment | null | undefined): sample is ProcSampleTestAssignment {
  return Boolean(sample && [sample.roundId, sample.testerUserId, sample.testerName, sample.assignedByName]
    .every((value) => typeof value === 'string' && value.trim()) && timestamp(sample.assignedAt) !== null);
}

function roundWasReset(logs: ProcLog[] | undefined, assignedAt: number): boolean {
  return (logs ?? []).some((log) => {
    const { fromStatus, toStatus } = log;
    if (!fromStatus || !toStatus || fromStatus === toStatus) return false;
    // A rollback that stays after sample testing (for example in_transit -> priced)
    // retains the sample's evidence. Restarting before/at testing or cancelling does not.
    const resetsSample = toStatus === 'cancelled'
      || (SAMPLE_STAGE[toStatus] <= SAMPLE_STAGE.testing && SAMPLE_STAGE[toStatus] < SAMPLE_STAGE[fromStatus]);
    if (!resetsSample) return false;
    const at = timestamp(log.createdAt);
    // If a recorded restart has no precise time, the current round cannot be verified safely.
    return at === null || at >= assignedAt;
  });
}

function facts(
  state: ProcSampleFacts['state'], label: string, description: string,
  evidence: ProcSampleFacts['evidence'] = { kind: 'none', at: null, roundId: null },
): ProcSampleFacts {
  return { state, label, description, evidence, arrivedAt: null };
}

/** Read-only display facts. This never advances a task or infers a receipt from order quantities or log text. */
export function getProcSampleFacts(task: ProcSampleFactsInput): ProcSampleFacts {
  const sample = task.sampleTest;
  const workflow = { kind: 'workflow' as const, at: null, roundId: null };
  if (task.status === 'cancelled') {
    return facts('cancelled', '已取消', '任务已取消，保留的历史测试记录不代表当前仍在收样。', workflow);
  }
  if (task.status === 'pending_sample') {
    return facts('waiting', '待到样', sample?.result === 'failed_resample'
      ? '上一轮测试未通过，当前等待重新送样；旧轮测试不代表本轮已到样。'
      : '当前等待确认到样；出样登记和预计到样日期不代表已经收到样品。', workflow);
  }
  if (PRE_SAMPLE_STATUSES.has(task.status)) {
    if (task.needSample === false && !sample) {
      return facts('not_required', '未要求样品', '当前任务未要求样品，不依据采购进度推定样品到样。', workflow);
    }
    return facts('unknown', '到样状态待确认', sample
      ? '当前已回到采购准备或询价阶段，历史测试记录不能确认当前样品已到。'
      : '当前尚无本轮到样确认依据；采购准备或询价状态不代表样品已到。');
  }
  if (sample?.result === 'failed_resample' || sample?.result === 'failed_requote') {
    return facts('unknown', '到样状态待确认', '保留的是上一轮未通过结论，重新送样或重新询价后的到样需另行确认。');
  }
  if (hasAssignment(sample)) {
    const assignedAt = timestamp(sample.assignedAt)!;
    if (roundWasReset(task.logs, assignedAt)) {
      return facts('unknown', '到样状态待确认', '存在回退或取消记录，无法确认保留的测试分派仍属于当前轮次。');
    }
    if (sample.recordsVersion === 1 && timestamp(sample.arrivedAt) === null) {
      return facts('unknown', '实际到样待登记', '已分派测试人员，但本轮实际到样时间尚未登记或无效，请由采购核对。');
    }
    if (task.status === 'testing' && sample.result === null && sample.confirmedAt === null
      && !sample.note?.trim() && !sample.confirmedByName?.trim()) {
      const confirmed = facts('confirmed', '已确认到样', sample.recordsVersion === 1 ? '依据采购独立登记的本轮实际到样时间确认。' : '依据本轮已记录的测试分派确认到样；分派时间不是实际到样日期。', {
        kind: 'test_assignment', at: sample.assignedAt, roundId: sample.roundId,
      });
      return { ...confirmed, arrivedAt: sample.recordsVersion === 1 ? sample.arrivedAt! : null };
    }
    const confirmedAt = timestamp(sample.confirmedAt);
    if (AFTER_SAMPLE_STATUSES.has(task.status) && sample.result === 'passed'
      && confirmedAt !== null && confirmedAt >= assignedAt
      && Boolean(sample.confirmedByName?.trim()) && Boolean(sample.note?.trim())) {
      if (!Array.isArray(task.logs)) {
        return facts('unknown', '到样状态待确认', '已保留测试通过结论，但缺少状态流转记录，无法确认其仍属于当前轮次。');
      }
      const confirmed = facts('confirmed', '已确认到样', '依据本人已确认的本轮测试结论确认到样；测试确认时间不是实际到样日期。', {
        kind: 'test_result', at: sample.confirmedAt, roundId: sample.roundId,
      });
      return { ...confirmed, arrivedAt: sample.recordsVersion === 1 ? sample.arrivedAt! : null };
    }
  }
  if (task.sampleStatusNeedsReview) {
    return facts('unknown', '到样状态待确认', '历史任务可能跳过待到样阶段，请核对本轮样品与测试分派记录。');
  }
  if (task.needSample === false && !sample && task.status !== 'testing') {
    return facts('not_required', '未要求样品', '当前任务未要求样品，不依据采购进度推定样品到样。', workflow);
  }
  return facts('unknown', '到样状态待确认', task.status === 'testing'
    ? '当前为测试中，但没有可核对的本轮测试分派依据。'
    : '当前资料不足以确认样品已到；采购进度和订单到货数量不是样品到样凭据。');
}
