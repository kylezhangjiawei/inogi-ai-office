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

// ─── 「今天」的统一取值 ────────────────────────────────────────────────────────
// 两条铁律，三处页面（任务驾驶舱 / 主管驾驶舱 / 个人工作台）必须共用：
//
// 1. 每次调用都重新求值。存成模块级常量会在页面跨零点后失效 —— 台账类页面常年挂着
//    不关，冻结的「今天」会让逾期判定、到期文案、风险严重度全部静默算错。
// 2. 取本地日历日，绝不能用 toISOString()。后者取 UTC 日期，UTC+8 时区每天 0–8 点
//    会得到「昨天」，导致今日到期漏计、到期筛选器筛不出、页面顶部显示错误日期。

/** 今天的本地日历日，格式 YYYY-MM-DD。 */
export function todayLocalDateStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 把日期解析成「本地日历日零点」的时间戳。
 * 纯日期串（YYYY-MM-DD）显式按本地日历日构造 —— new Date("YYYY-MM-DD") 按 UTC 零点解析，
 * 在负时区会整体错一天。带时间的时间戳仍按真实瞬间换算到本地日历日。
 */
function localDayStartMs(value: string | Date): number {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? NaN
      : new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return NaN;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

/**
 * 距截止日还剩几天：0 = 今日到期，负数 = 已过期，null = 无截止日或日期非法。
 * 与 taskOverdueDays 同源同口径，两者不会再各算一个「今天」。
 */
export function daysUntilDue(dateStr?: string | null, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const dueMs = localDayStartMs(dateStr);
  if (Number.isNaN(dueMs)) return null;
  return Math.round((dueMs - localDayStartMs(now)) / DAY_MS);
}
