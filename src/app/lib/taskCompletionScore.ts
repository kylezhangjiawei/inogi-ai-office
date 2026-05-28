import type { RdTask, RdTaskProgressNote } from "./rdApi";

export type TaskScoreDimensionKey =
  | "timeliness"
  | "progress_notes"
  | "evidence"
  | "collaboration";

export type TaskScoreDimension = {
  key: TaskScoreDimensionKey;
  label: string;
  score: number;
  max: number;
  detail: string;
};

export type TaskCompletionGrade = "A" | "B" | "C" | "D";

export type TaskCompletionScore = {
  total: number;
  grade: TaskCompletionGrade;
  gradeLabel: string;
  dimensions: TaskScoreDimension[];
  computedAt: string;
};

const DIM_MAX = {
  timeliness: 35,
  progress_notes: 30,
  evidence: 20,
  collaboration: 15,
} as const;

function dayDiff(a: string | undefined | null, b: string | undefined | null): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.floor((ta - tb) / 86_400_000);
}

function scoreTimeliness(task: RdTask, notes: RdTaskProgressNote[]): TaskScoreDimension {
  // 取最晚一次进度留痕时间作为完成时间，缺失则退化到 updated_at
  const latestNoteTime = notes.length > 0
    ? notes.reduce<string | null>((acc, n) => (!acc || n.created_at > acc ? n.created_at : acc), null)
    : null;
  const completedAt = latestNoteTime ?? task.updated_at ?? null;

  if (!task.due_date) {
    return {
      key: "timeliness",
      label: "时效性",
      score: 25,
      max: DIM_MAX.timeliness,
      detail: "未设截止日期，按中性分计",
    };
  }
  const diff = dayDiff(completedAt, task.due_date);
  if (diff === null) {
    return {
      key: "timeliness",
      label: "时效性",
      score: 20,
      max: DIM_MAX.timeliness,
      detail: "缺少完成时间，无法精确判定",
    };
  }
  if (diff <= 0) {
    return {
      key: "timeliness",
      label: "时效性",
      score: 35,
      max: DIM_MAX.timeliness,
      detail: diff < 0 ? `提前 ${-diff} 天完成` : "按时完成",
    };
  }
  if (diff <= 3) {
    return { key: "timeliness", label: "时效性", score: 25, max: DIM_MAX.timeliness, detail: `逾期 ${diff} 天` };
  }
  if (diff <= 7) {
    return { key: "timeliness", label: "时效性", score: 15, max: DIM_MAX.timeliness, detail: `逾期 ${diff} 天` };
  }
  return { key: "timeliness", label: "时效性", score: 5, max: DIM_MAX.timeliness, detail: `严重逾期 ${diff} 天` };
}

function scoreProgressNotes(notes: RdTaskProgressNote[]): TaskScoreDimension {
  const count = notes.length;
  let score: number;
  if (count >= 5) score = 30;
  else if (count >= 3) score = 22;
  else if (count >= 1) score = 12;
  else score = 0;
  return {
    key: "progress_notes",
    label: "进度留痕",
    score,
    max: DIM_MAX.progress_notes,
    detail: `${count} 条进度记录`,
  };
}

function scoreEvidence(task: RdTask, notes: RdTaskProgressNote[]): TaskScoreDimension {
  const noteAttachments = notes.reduce((sum, n) => sum + (n.attachments?.length ?? 0), 0);
  const total = noteAttachments + (task.attachments ?? 0);
  let score: number;
  if (total >= 3) score = 20;
  else if (total >= 1) score = 12;
  else score = 0;
  return {
    key: "evidence",
    label: "交付证据",
    score,
    max: DIM_MAX.evidence,
    detail: `${total} 个附件`,
  };
}

function scoreCollaboration(task: RdTask): TaskScoreDimension {
  const count = task.collaborators?.length ?? 0;
  let score: number;
  let detail: string;
  if (count >= 2) {
    score = 15;
    detail = `${count} 位协作人`;
  } else if (count === 1) {
    score = 8;
    detail = "1 位协作人";
  } else {
    score = 5;
    detail = "独立完成";
  }
  return { key: "collaboration", label: "协作度", score, max: DIM_MAX.collaboration, detail };
}

function gradeOf(total: number): { grade: TaskCompletionGrade; label: string } {
  if (total >= 90) return { grade: "A", label: "优秀" };
  if (total >= 75) return { grade: "B", label: "良好" };
  if (total >= 60) return { grade: "C", label: "合格" };
  return { grade: "D", label: "需改进" };
}

export function computeTaskCompletionScore(
  task: RdTask,
  notes: RdTaskProgressNote[] = [],
): TaskCompletionScore {
  const dimensions: TaskScoreDimension[] = [
    scoreTimeliness(task, notes),
    scoreProgressNotes(notes),
    scoreEvidence(task, notes),
    scoreCollaboration(task),
  ];
  const total = dimensions.reduce((sum, d) => sum + d.score, 0);
  const { grade, label } = gradeOf(total);
  return {
    total,
    grade,
    gradeLabel: label,
    dimensions,
    computedAt: new Date().toISOString(),
  };
}

export function getGradeTone(grade: TaskCompletionGrade): {
  bg: string;
  text: string;
  border: string;
  ring: string;
  bar: string;
} {
  switch (grade) {
    case "A":
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        ring: "ring-emerald-200",
        bar: "bg-emerald-500",
      };
    case "B":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
        ring: "ring-blue-200",
        bar: "bg-blue-500",
      };
    case "C":
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        ring: "ring-amber-200",
        bar: "bg-amber-500",
      };
    case "D":
      return {
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        ring: "ring-rose-200",
        bar: "bg-rose-500",
      };
  }
}
