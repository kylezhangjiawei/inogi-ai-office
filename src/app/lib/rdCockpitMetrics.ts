import type { RdCategory, RdTask } from "./rdApi";
import { daysUntilDue, taskOverdueDays } from "./taskDue";
import { t } from "./i18n";
import { rootTasksFromCategories } from "./rdTaskTreeVisibility";
import { isTaskOwnerMember, memberIdentityKey, type RdMemberDirectoryEntry } from "./rdMemberIdentity";

export type Risk = {
  task: RdTask;
  category: RdCategory;
  type: "overdue" | "due_soon" | "blocked" | "pending" | "slow";
  severity: "critical" | "warning";
  reason: string;
};

export type CatStat = {
  cat: RdCategory;
  total: number;
  inProgress: number;
  done: number;
  blocked: number;
  progress: number;
  risks: number;
  riskItems: Risk[];
};

export type PersonLoad = {
  /** 身份主键（memberIdentityKey）。同名同事靠它区分，勿用 name 当索引。 */
  key: string;
  name: string;
  count: number;
  max: number;
  onLeave: boolean;
  user_id?: string | null;
};

function daysUntil(dateStr?: string): number | null {
  return daysUntilDue(dateStr);
}

export function getTaskRiskReason(task: RdTask): { type: Risk["type"]; reason: string } | null {
  if (task.archived || task.status === "completed") return null;
  const daysLeft = daysUntil(task.due_date);
  if (task.status === "pending_review") {
    const late = taskOverdueDays(task);
    return late > 0 ? { type: "overdue", reason: t("逾期提交 {days} 天", { days: late }) } : null;
  }
  if (daysLeft !== null && daysLeft < 0) {
    return { type: "overdue", reason: t("已逾期 {days} 天", { days: -daysLeft }) };
  }
  if (task.status === "paused_blocked") return { type: "blocked", reason: t("阻塞中") };
  if (daysLeft !== null && daysLeft <= 2) {
    return {
      type: "due_soon",
      reason: daysLeft === 0 ? t("今日到期") : t("{days} 天内到期", { days: daysLeft }),
    };
  }
  if (task.status === "pending_assign") return { type: "pending", reason: t("待人工指派") };
  if (task.final_priority === "high" && task.progress < 30 && task.status === "in_progress") {
    return { type: "slow", reason: t("高优先级·进度偏低") };
  }
  return null;
}

function riskSeverity(task: RdTask, type: Risk["type"]): Risk["severity"] {
  if (type === "overdue" || type === "blocked") return "critical";
  if (type === "due_soon") {
    const daysLeft = daysUntil(task.due_date);
    return daysLeft !== null && daysLeft <= 1 ? "critical" : "warning";
  }
  return "warning";
}

function collectTaskRisks(task: RdTask, category: RdCategory): Risk[] {
  const own = getTaskRiskReason(task);
  const risks: Risk[] = own
    ? [{
        task,
        category,
        type: own.type,
        severity: riskSeverity(task, own.type),
        reason: own.reason,
      }]
    : [];
  for (const subtask of task.subtasks ?? []) risks.push(...collectTaskRisks(subtask, category));
  return risks;
}

export function flattenTasks(tasks: RdTask[]): RdTask[] {
  const result: RdTask[] = [];
  const walk = (items: RdTask[]) => {
    for (const task of items) {
      result.push(task);
      if (task.subtasks?.length) walk(task.subtasks);
    }
  };
  walk(tasks);
  return result;
}

export function computeRisks(categories: RdCategory[]): Risk[] {
  const risks = categories.flatMap((category) =>
    category.children.flatMap((subProject) =>
      subProject.tasks.flatMap((rootTask) => {
        const nestedRisks = collectTaskRisks(rootTask, category).sort((a, b) => {
          if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
          return (b.task.updated_at ?? "").localeCompare(a.task.updated_at ?? "");
        });
        const primary = nestedRisks[0];
        if (!primary) return [];
        return [{
          ...primary,
          task: rootTask,
          reason: primary.task.task_id === rootTask.task_id
            ? primary.reason
            : t("子任务风险：{reason}", { reason: primary.reason }),
        }];
      }),
    ),
  );
  return risks.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    const aTime = a.task.updated_at ?? "";
    const bTime = b.task.updated_at ?? "";
    return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
  });
}

export function buildCatStats(categories: RdCategory[], risks: Risk[]): CatStat[] {
  return categories.map((category) => {
    const tasks = rootTasksFromCategories([category]);
    const active = tasks.filter((task) => !task.archived && task.status !== "archived");
    const categoryRisks = risks.filter((risk) => risk.category.id === category.id);
    const progress = active.length
      ? Math.round(active.reduce((sum, task) => sum + task.progress, 0) / active.length)
      : 0;
    return {
      cat: category,
      total: active.length,
      inProgress: active.filter((task) => task.status === "in_progress").length,
      done: active.filter((task) => task.status === "completed").length,
      blocked: active.filter((task) =>
        task.status === "paused_blocked" || task.status === "pending_assign",
      ).length,
      progress,
      risks: categoryRisks.length,
      riskItems: categoryRisks,
    };
  });
}

export function computePersonLoads(
  categories: RdCategory[],
  maxPerPerson = 8,
  peopleDirectory?: readonly RdMemberDirectoryEntry[],
): PersonLoad[] {
  // 按身份主键聚合：同名同事各自成条，不再把两人的负载相加。
  const rows = new Map<string, { name: string; userId: string | null; count: number; onLeave: boolean }>();

  for (const task of rootTasksFromCategories(categories)) {
    const archived = task.archived || task.status === "archived";
    const active = !archived && task.status !== "completed";
    if (!active) continue;
    // 必须传人员目录：不传时 isTaskOwnerMember 只挡黑名单占位值，驾驶舱配置的成员白名单会整段失效。
    if (!isTaskOwnerMember(task.primary_owner, task.primary_owner_user_id, peopleDirectory)) continue;

    const key = memberIdentityKey(task.primary_owner, task.primary_owner_user_id);
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      if (task.status === "paused_leave") row.onLeave = true;
      if (!row.userId && task.primary_owner_user_id) row.userId = task.primary_owner_user_id;
    } else {
      rows.set(key, {
        name: task.primary_owner,
        userId: task.primary_owner_user_id ?? null,
        count: 1,
        onLeave: task.status === "paused_leave",
      });
    }
  }

  return Array.from(rows.entries())
    .map(([key, row]) => ({
      key,
      name: row.name,
      count: row.count,
      max: maxPerPerson,
      onLeave: row.onLeave,
      user_id: row.userId,
    }))
    .sort((a, b) => b.count - a.count);
}
