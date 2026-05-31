// 任务"逾期"统一判定（方案 B）。前端三处页面（任务驾驶舱 / 主管驾驶舱 / 个人工作台）
// 统一引用本模块，避免各算各的导致口径不一致。
//
// 规则：
// - 已归档 / 已完成 / 无截止日 → 不逾期。
// - 待审核(pending_review)：申请者已提交，责任在审核侧。
//     只有"提交审核的日期晚于截止日"（逾期提交）才算其逾期，逾期天数 = 提交日 − 截止日；
//     按时提交、或缺少提交时间戳（旧数据）→ 视为按时，不逾期。
// - 其它（进行中等）：截止日已过即逾期，逾期天数 = 今天 − 截止日。

export type TaskDueInput = {
  archived?: boolean;
  status?: string | null;
  due_date?: string | null;
  submitted_for_review_at?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayMs(value: string | Date): number {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return NaN;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 返回任务"逾期天数"：>0 表示逾期，0 表示不逾期。 */
export function taskOverdueDays(task: TaskDueInput, now: Date = new Date()): number {
  if (task.archived || task.status === "completed" || !task.due_date) return 0;
  const dueMs = startOfDayMs(task.due_date);
  if (Number.isNaN(dueMs)) return 0;

  if (task.status === "pending_review") {
    // 待审核：按"提交时间是否晚于截止日"判定，而非"今天是否过了截止日"
    if (!task.submitted_for_review_at) return 0; // 旧数据无时间戳 → 给申请者 benefit of doubt
    const submittedMs = startOfDayMs(task.submitted_for_review_at);
    if (Number.isNaN(submittedMs)) return 0;
    const late = Math.round((submittedMs - dueMs) / DAY_MS);
    return late > 0 ? late : 0;
  }

  const over = Math.round((startOfDayMs(now) - dueMs) / DAY_MS);
  return over > 0 ? over : 0;
}

/** 任务是否逾期（方案 B）。 */
export function isTaskOverdue(task: TaskDueInput, now?: Date): boolean {
  return taskOverdueDays(task, now) > 0;
}
