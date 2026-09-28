import {
  type RdCategory,
  type RdCollaborator,
  type RdPriority,
  type RdSubProject,
  type RdTask,
  type RdTaskStatus,
  type RdProductDef,
} from "../lib/rdApi";
import { t } from "../lib/i18n";

// ─── Types (aliased from rdApi shared types) ─────────────────────────────────
export type TaskStatus = RdTaskStatus;

export type Priority = RdPriority;

export type Collaborator = RdCollaborator;

export type Task = RdTask;

export type SubProject = RdSubProject;

export type Category = RdCategory;

export type ProductDef = RdProductDef;

export type PersonProfile = {
  id: string;
  user_id?: string | null;
  name: string;
  position: string;
  department?: string;
  email?: string;
  phone?: string;
  max_tasks?: number;
  on_leave?: boolean;
  status?: string;
  /** 账号状态（ACTIVE / INVITED / DISABLED）：@ 候选据此排除已停用账号 */
  user_status?: string | null;
  joined_at?: string;
};

// ─── Status / Priority config ────────────────────────────────────────────────
export const STATUS_CONFIG: Record<TaskStatus, { label: string; dot: string; text: string; bg: string }> = {
  draft: { label: "草稿", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100" },
  in_progress: { label: "进行中", dot: "bg-indigo-500", text: "text-indigo-700", bg: "bg-indigo-50" },
  paused_leave: { label: "暂停·请假", dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
  paused_blocked: { label: "暂停·阻塞", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  completed: { label: "已完成", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  pending_assign: { label: "待指派", dot: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50" },
  pending_review: { label: "待审核", dot: "bg-purple-500", text: "text-purple-700", bg: "bg-purple-50" },
  on_hold: { label: "已挂起", dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-100" },
  archived: { label: "已封存", dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-100" },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; text: string; bg: string }> = {
  high: { label: "高", text: "text-white", bg: "border-red-600 bg-red-600" },
  medium: { label: "中", text: "text-amber-700", bg: "border-amber-200 bg-amber-50" },
  low: { label: "低", text: "text-slate-500", bg: "border-slate-200 bg-slate-50" },
};

/**
 * 「已归档」的统一判定，与后端 isArchivedTask 完全一致：archived 标志 **或** status==='archived'。
 * 只认 archived 标志会漏判——虽然当前唯一的归档写入路径（applyTaskMerge）两个字段都会写，
 * 但历史/导入数据未必，统计口径按两者取或才不会被歪掉。
 */
export function isArchivedTask(task: Pick<Task, "archived" | "status">): boolean {
  return task.archived === true || task.status === "archived";
}

/**
 * 父子索引：子任务 task_id → 其父任务。以「结构位置」为准（谁在谁的 subtasks 里），
 * 不看 parent_task_id 字段——存量子任务没有该字段，只认字段会把它们误判成顶层任务。
 */
export function buildSubtaskParentIndex(categories: Category[]): Map<string, Task> {
  const index = new Map<string, Task>();
  const walk = (tasks: Task[], parent: Task | null) => {
    for (const task of tasks) {
      if (parent) index.set(task.task_id, parent);
      if (task.subtasks?.length) walk(task.subtasks, task);
    }
  };
  for (const cat of categories) for (const sub of cat.children) walk(sub.tasks, null);
  return index;
}

/** 顶层任务（不在任何任务的 subtasks 里）。用于「并入已有任务」的候选列表与统计口径标注。 */
export function collectTopLevelTasks(categories: Category[]): Task[] {
  return categories.flatMap((cat) => cat.children.flatMap((sub) => sub.tasks));
}

/** 只翻译系统占位名（待指派等），真人名原样返回——防止人名恰好撞上字典 key 被误翻（如单字名「高」→High）。 */
export function displayPersonName(name: string): string {
  const raw = name ?? "";
  return /^待指派$|^未指派$|^外部机构$|已离职/.test(raw) ? t(raw) : raw;
}

export function taskVisibleTitle(task: Pick<Task, "task_id" | "title">) {
  const title = typeof task.title === "string" ? task.title.trim() : "";
  if (title) return title;
  const taskId = typeof task.task_id === "string" ? task.task_id.trim() : "";
  return taskId
    ? t("未命名任务（{id}）", { id: taskId })
    : t("未命名任务");
}

// ─── SystemPanorama ───────────────────────────────────────────────────────────

/** prod-portable-o2 的任务数据存在主 rd.taskCategories 里，直接用全局 catStats */
export const MAIN_PRODUCT_ID = "prod-portable-o2";
