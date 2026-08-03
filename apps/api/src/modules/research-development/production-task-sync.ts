type JsonRecord = Record<string, unknown>;

export const PRODUCTION_WORKSPACE = 'production';
export const PRODUCTION_SYNC_PERMISSION = 'rd-task:sync-production';

export type ProductionMirrorMetadata = {
  source_workspace: 'rd';
  source_task_id: string;
  root_source_task_id: string;
  synced_at: string;
  read_only: true;
};

export type ProductionMirrorPlacement = {
  categoryId: string;
  categoryLabel: string;
  subProjectId: string;
  subProjectLabel: string;
  task: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
  ) as T;
}

export function isProductionMirrorTask(value: unknown): value is JsonRecord & {
  production_sync: ProductionMirrorMetadata;
} {
  if (!isRecord(value) || !isRecord(value.production_sync)) return false;
  const metadata = value.production_sync;
  return metadata.source_workspace === 'rd'
    && typeof metadata.source_task_id === 'string'
    && metadata.source_task_id.length > 0
    && metadata.read_only === true;
}

/** Build a detached read-only snapshot. Every descendant is marked so no nested write can bypass the guard. */
export function buildProductionMirrorTask(
  sourceTask: JsonRecord,
  options: { rootTaskId: string; syncedAt: string },
): JsonRecord {
  const task = cloneJson(sourceTask);
  const taskId = String(task.task_id ?? '').trim();
  task.production_sync = {
    source_workspace: 'rd',
    source_task_id: taskId,
    root_source_task_id: options.rootTaskId,
    synced_at: options.syncedAt,
    read_only: true,
  } satisfies ProductionMirrorMetadata;
  task.subtasks = (Array.isArray(task.subtasks) ? task.subtasks : [])
    .filter(isRecord)
    .map((subtask) => buildProductionMirrorTask(subtask, options));
  return task;
}

function stripProductionMirrorsFromTasks(tasks: unknown[]): JsonRecord[] {
  return tasks
    .filter(isRecord)
    .filter((task) => !isProductionMirrorTask(task))
    .map((task) => ({
      ...cloneJson(task),
      subtasks: stripProductionMirrorsFromTasks(Array.isArray(task.subtasks) ? task.subtasks : []),
    }));
}

/**
 * Replace the complete mirror projection while leaving production-native tasks untouched.
 * Re-running with the same placements is byte-for-byte idempotent; an empty placement list revokes every mirror.
 */
export function mergeProductionMirrorTasks(
  productionCategories: JsonRecord[],
  placements: ProductionMirrorPlacement[],
): JsonRecord[] {
  const categories: JsonRecord[] = productionCategories.map((category): JsonRecord => ({
    ...cloneJson(category),
    children: (Array.isArray(category.children) ? category.children : [])
      .filter(isRecord)
      .map((child): JsonRecord => ({
        ...cloneJson(child),
        tasks: stripProductionMirrorsFromTasks(Array.isArray(child.tasks) ? child.tasks : []),
      })),
  }));

  for (const placement of placements) {
    let category = categories.find((item) => String(item.id ?? '') === placement.categoryId);
    if (!category) {
      category = {
        id: placement.categoryId,
        label: placement.categoryLabel,
        children: [],
      };
      categories.push(category);
    }
    const children = (Array.isArray(category.children) ? category.children : []).filter(isRecord);
    category.children = children;
    let subProject = children.find((item) => String(item.id ?? '') === placement.subProjectId);
    if (!subProject) {
      subProject = {
        id: placement.subProjectId,
        label: placement.subProjectLabel,
        tasks: [],
      };
      children.push(subProject);
    }
    const tasks = (Array.isArray(subProject.tasks) ? subProject.tasks : []).filter(isRecord);
    subProject.tasks = [...tasks, cloneJson(placement.task)];
  }

  return categories;
}
