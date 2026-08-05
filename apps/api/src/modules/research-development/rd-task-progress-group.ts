export type RdTaskRelationRecord = Record<string, unknown>;

export type RdTaskProgressGroupNode = {
  task: RdTaskRelationRecord;
  taskId: string;
  title: string;
  path: string[];
  joinedAt: string | null;
};

export type RdTaskProgressRelationGroup = {
  rootTaskId: string;
  currentTaskId: string;
  tasks: RdTaskProgressGroupNode[];
};

function isRecord(value: unknown): value is RdTaskRelationRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function laterIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
}

/**
 * Resolve the complete relation tree containing a task.
 *
 * Structural nesting is the source of truth. Historical tasks may not have a
 * parent_task_id field, so building the parent index from subtasks is required.
 * joinedAt is inherited by descendants because attaching a task moves its
 * entire existing subtree into the new relation group.
 */
export function buildRdTaskProgressRelationGroup(
  categories: unknown[],
  rawCurrentTaskId: string,
): RdTaskProgressRelationGroup | null {
  const currentTaskId = rawCurrentTaskId.trim();
  if (!currentTaskId) return null;

  const taskById = new Map<string, RdTaskRelationRecord>();
  const parentById = new Map<string, string>();

  const indexTasks = (tasks: unknown[], parentTaskId: string | null): void => {
    for (const candidate of tasks) {
      if (!isRecord(candidate)) continue;
      const taskId = cleanText(candidate.task_id);
      if (!taskId || taskById.has(taskId)) continue;
      taskById.set(taskId, candidate);
      if (parentTaskId) parentById.set(taskId, parentTaskId);
      indexTasks(asArray(candidate.subtasks), taskId);
    }
  };

  for (const category of categories) {
    if (!isRecord(category)) continue;
    for (const subProject of asArray(category.children)) {
      if (isRecord(subProject)) indexTasks(asArray(subProject.tasks), null);
    }
  }

  if (!taskById.has(currentTaskId)) return null;

  let rootTaskId = currentTaskId;
  const visited = new Set([rootTaskId]);
  while (parentById.has(rootTaskId)) {
    const parentTaskId = parentById.get(rootTaskId)!;
    if (visited.has(parentTaskId)) break;
    visited.add(parentTaskId);
    rootTaskId = parentTaskId;
  }

  const rootTask = taskById.get(rootTaskId);
  if (!rootTask) return null;

  const tasks: RdTaskProgressGroupNode[] = [];
  const collect = (
    task: RdTaskRelationRecord,
    parentPath: string[],
    inheritedJoinedAt: string | null,
  ): void => {
    const taskId = cleanText(task.task_id);
    if (!taskId) return;
    const title = cleanText(task.title) || '未命名任务';
    const ownJoinedAt = cleanText(task.subtask_attached_at) || null;
    const joinedAt = laterIso(inheritedJoinedAt, ownJoinedAt);
    const path = [...parentPath, title];
    tasks.push({ task, taskId, title, path, joinedAt });
    for (const child of asArray(task.subtasks)) {
      if (isRecord(child)) collect(child, path, joinedAt);
    }
  };

  collect(rootTask, [], null);
  return { rootTaskId, currentTaskId, tasks };
}
