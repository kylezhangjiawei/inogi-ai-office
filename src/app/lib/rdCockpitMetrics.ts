import type { RdCategory, RdTask } from "./rdApi";
import { taskOverdueDays } from "./taskDue";
import { t } from "./i18n";
import { rootTasksFromCategories } from "./rdTaskTreeVisibility";

const now = new Date();
const today = new Date(
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
);

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
  name: string;
  count: number;
  max: number;
  onLeave: boolean;
  user_id?: string | null;
};

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function getTaskRiskReason(task: RdTask): { type: Risk["type"]; reason: string } | null {
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

export function computePersonLoads(categories: RdCategory[], maxPerPerson = 8): PersonLoad[] {
  const counts = new Map<string, number>();
  const onLeave = new Set<string>();
  const userIds = new Map<string, string>();

  for (const task of rootTasksFromCategories(categories)) {
    const archived = task.archived || task.status === "archived";
    const active = !archived && task.status !== "completed";
    if (active && !/已离职|待指派/.test(task.primary_owner)) {
      counts.set(task.primary_owner, (counts.get(task.primary_owner) ?? 0) + 1);
      if (task.status === "paused_leave") onLeave.add(task.primary_owner);
      if (task.primary_owner_user_id && !userIds.has(task.primary_owner)) {
        userIds.set(task.primary_owner, task.primary_owner_user_id);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      max: maxPerPerson,
      onLeave: onLeave.has(name),
      user_id: userIds.get(name) ?? null,
    }))
    .sort((a, b) => b.count - a.count);
}
