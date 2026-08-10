// 研发任务驾驶舱「按时间段导出所有人员任务完成情况」。
//
// 纯前端：复用驾驶舱已加载的任务树（allTasks），按「该时间段内有活动」过滤，
// 生成两个工作表（人员汇总 + 任务明细）的 .xlsx 并触发下载。
// 完成时间口径：任务无真正的 completed_at 字段，故以 last_activity_at（退化 updated_at）
// 作为「最近活动 / 完成时间」近似——已与用户确认采用此口径。
import type { RdTask } from "./rdApi";
import { isTaskOwnerMember, type RdMemberDirectoryEntry } from "./rdMemberIdentity";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  in_progress: "进行中",
  pending_review: "待审核",
  paused_leave: "暂停·请假",
  paused_blocked: "暂停·阻塞",
  on_hold: "暂停·挂起",
  completed: "已完成",
  pending_assign: "待指派",
};

const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

function activityTime(t: RdTask): string | undefined {
  return t.last_activity_at ?? t.updated_at;
}

function fmtDay(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 递归展开任务树（含子任务），防止上游传入未展开的层级。 */
function flatten(tasks: RdTask[]): RdTask[] {
  const out: RdTask[] = [];
  const walk = (list: RdTask[]) => {
    for (const t of list) {
      out.push(t);
      if (t.subtasks?.length) walk(t.subtasks);
    }
  };
  walk(tasks ?? []);
  return out;
}

export type RdExportRange = { start: string; end: string }; // YYYY-MM-DD（含端点）

/**
 * 生成并下载 xlsx。返回纳入导出的任务数（0 表示该区间无数据，调用方可据此提示）。
 * 过滤口径：当前研发驾驶舱配置人员主责 + 非封存 + 最近活动时间落在指定区间内。
 */
export function filterRdTasksForExport(
  allTasks: RdTask[],
  range: RdExportRange,
  peopleDirectory: readonly RdMemberDirectoryEntry[],
): RdTask[] {
  if (peopleDirectory.length === 0) {
    throw new Error("研发人员目录尚未加载，已阻止导出以避免包含非研发人员数据");
  }

  const startMs = new Date(`${range.start}T00:00:00`).getTime();
  const endMs = new Date(`${range.end}T23:59:59.999`).getTime();

  return flatten(allTasks).filter((task) => {
    if (task.archived) return false;
    if (!isTaskOwnerMember(task.primary_owner, task.primary_owner_user_id, peopleDirectory)) return false;
    const at = activityTime(task);
    if (!at) return false;
    const ms = new Date(at).getTime();
    return !Number.isNaN(ms) && ms >= startMs && ms <= endMs;
  });
}

export async function exportRdTasksXlsx(
  allTasks: RdTask[],
  range: RdExportRange,
  peopleDirectory: readonly RdMemberDirectoryEntry[],
): Promise<number> {
  const inRange = filterRdTasksForExport(allTasks, range, peopleDirectory);

  // 明细：一任务一行，按主责人。
  const detail = inRange
    .slice()
    .sort((a, b) => (a.primary_owner || "").localeCompare(b.primary_owner || "", "zh-CN"))
    .map((t) => ({
      人员: t.primary_owner || "未指派",
      协作人: (t.collaborators ?? []).map((c) => c.name).filter(Boolean).join("、"),
      任务编号: t.task_id,
      任务名称: t.title,
      所属分类: t.category_path || "",
      优先级: PRIORITY_LABEL[t.final_priority] ?? t.final_priority,
      状态: STATUS_LABEL[t.status] ?? t.status,
      是否完成: t.status === "completed" ? "是" : "否",
      "进度(%)": typeof t.progress === "number" ? t.progress : 0,
      开始日期: fmtDay(t.start_date),
      截止日期: fmtDay(t.due_date),
      "最近活动/完成时间": fmtDateTime(activityTime(t)),
      完成评分: t.status === "completed" && t.completion_score
        ? `${t.completion_score.total}（${t.completion_score.grade}）`
        : "",
    }));

  // 汇总：按主责人聚合。
  const byPerson = new Map<string, RdTask[]>();
  for (const t of inRange) {
    const key = t.primary_owner || "未指派";
    const arr = byPerson.get(key);
    if (arr) arr.push(t);
    else byPerson.set(key, [t]);
  }
  const summary = [...byPerson.entries()]
    .map(([person, ts]) => {
      const total = ts.length;
      const done = ts.filter((t) => t.status === "completed").length;
      const inProgress = ts.filter((t) => t.status === "in_progress").length;
      const blocked = ts.filter((t) => t.status === "paused_blocked" || t.status === "pending_assign").length;
      const scores = ts
        .filter((t) => t.status === "completed" && t.completion_score)
        .map((t) => t.completion_score!.total);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "";
      return {
        人员: person,
        任务数: total,
        已完成: done,
        完成率: total ? `${Math.round((done / total) * 100)}%` : "0%",
        进行中: inProgress,
        "阻塞/待派": blocked,
        平均完成评分: avgScore,
      };
    })
    .sort((a, b) => b.已完成 - a.已完成 || b.任务数 - a.任务数);

  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");

  const wb = XLSX.utils.book_new();
  const emptyMark = [{ 提示: "该时间段内没有有活动记录的任务" }];

  const wsSummary = XLSX.utils.json_to_sheet(summary.length ? summary : emptyMark);
  wsSummary["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "人员汇总");

  const wsDetail = XLSX.utils.json_to_sheet(detail.length ? detail : emptyMark);
  wsDetail["!cols"] = [
    { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 24 },
    { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, "任务明细");

  XLSX.writeFile(wb, `研发任务完成情况_${range.start}_至_${range.end}.xlsx`);
  return inRange.length;
}
