/** Server-derived task scope. Page permissions alone do not grant cross-person access. */
export type RdTaskAccessActor = { userId?: string; userName?: string; permissions?: string[] };
export type RdTaskReadViewer = {
  userId?: string;
  userName?: string;
  hasFullAccess?: boolean;
  canReadAll?: boolean;
  canEditAttachments?: boolean;
  enforceTaskScope?: boolean;
};

export const RD_TASK_MANAGEMENT_PERMISSIONS = [
  'rd-task:reassign', 'rd-project:direct', 'rd-project:review-l1',
  'rd-project:review-l2', 'rd-people:manage',
] as const;

export function rdTaskReadViewer(actor: RdTaskAccessActor): RdTaskReadViewer {
  const permissions = actor.permissions ?? [];
  const hasFullAccess = permissions.includes('*')
    || RD_TASK_MANAGEMENT_PERMISSIONS.some((permission) => permissions.includes(permission));
  return { userId: actor.userId, userName: actor.userName, hasFullAccess,
    canReadAll: hasFullAccess || permissions.includes('rd-task:view-all'),
    canEditAttachments: hasFullAccess, enforceTaskScope: true };
}

type Task = Record<string, unknown>;
const record = (value: unknown): value is Task => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const records = (value: unknown): Task[] => Array.isArray(value) ? value.filter(record) : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
/** Display names are editable and must never establish account ownership. */
export function isRdTaskOwner(task: Task, userId?: string): boolean {
  return Boolean(text(userId)) && text(task.primary_owner_user_id ?? task.owner_user_id) === text(userId);
}

export function isTaskParticipant(task: Task, userId?: string, _userName?: string): boolean {
  return isRdTaskOwner(task, userId)
    || Boolean(text(userId)) && records(task.collaborators).some((person) => text(person.user_id) === text(userId));
}

export function canReadRdTask(task: Task, viewer: RdTaskReadViewer): boolean {
  if (viewer.hasFullAccess || viewer.canReadAll) return true;
  return isTaskParticipant(task, viewer.userId);
}

/** Hidden ancestors are omitted, not exposed as context; their visible descendants are promoted. */
export function filterRdTaskCategories(categories: Task[], viewer: RdTaskReadViewer): Task[] {
  if (viewer.hasFullAccess || viewer.canReadAll) return categories;
  const visibleIds = new Set<string>();
  const collect = (tasks: Task[]) => {
    for (const task of tasks) {
      if (canReadRdTask(task, viewer)) visibleIds.add(text(task.task_id));
      collect(records(task.subtasks));
    }
  };
  for (const category of categories) for (const child of records(category.children)) collect(records(child.tasks));
  const filterTasks = (tasks: Task[], parentId: string | null): Task[] => tasks.flatMap((task) => {
    if (!canReadRdTask(task, viewer)) return filterTasks(records(task.subtasks), parentId);
    const next: Task = { ...task, parent_task_id: parentId, subtasks: filterTasks(records(task.subtasks), text(task.task_id)) };
    for (const key of ['merged_into', 'pending_merge_target']) {
      if (text(next[key]) && !visibleIds.has(text(next[key]))) delete next[key];
    }
    if (Array.isArray(next.merged_from)) next.merged_from = next.merged_from.filter((id) => visibleIds.has(text(id)));
    if (!parentId) {
      delete next.subtask_origin;
      delete next.subtask_attached_at;
      delete next.subtask_attached_by;
      delete next.subtask_attached_by_id;
    }
    return [next];
  });
  return categories.flatMap((category) => {
    const children = records(category.children).flatMap((child) => {
      const tasks = filterTasks(records(child.tasks), null);
      return tasks.length ? [{ ...child, tasks }] : [];
    });
    return children.length ? [{ ...category, children }] : [];
  });
}
