export type ParentLinkedTask = {
  task_id: string;
  parent_task_id?: string | null;
};

export type TaskTreeNode<T extends ParentLinkedTask> = {
  task: T;
  children: TaskTreeNode<T>[];
};

/**
 * Build a stable tree from a flat, visibility-filtered task list.
 * Missing parents promote children to roots; invalid self/cyclic links are cut so no task disappears.
 */
export function buildTaskTree<T extends ParentLinkedTask>(
  tasks: readonly T[],
  compare: (left: T, right: T) => number,
): TaskTreeNode<T>[] {
  const sorted = [...tasks].sort(compare);
  const byId = new Map<string, T>();
  for (const task of sorted) {
    if (!byId.has(task.task_id)) byId.set(task.task_id, task);
  }
  const ordered = [...byId.values()];
  const childrenByParent = new Map<string, T[]>();

  for (const task of ordered) {
    const parentId = task.parent_task_id;
    if (!parentId || parentId === task.task_id || !byId.has(parentId)) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(task);
    childrenByParent.set(parentId, children);
  }

  const emitted = new Set<string>();
  const buildNode = (task: T, ancestors: Set<string>): TaskTreeNode<T> => {
    emitted.add(task.task_id);
    const nextAncestors = new Set(ancestors).add(task.task_id);
    const children = (childrenByParent.get(task.task_id) ?? [])
      .filter((child) => !nextAncestors.has(child.task_id) && !emitted.has(child.task_id))
      .map((child) => buildNode(child, nextAncestors));
    return { task, children };
  };

  const roots = ordered.filter((task) => {
    const parentId = task.parent_task_id;
    return !parentId || parentId === task.task_id || !byId.has(parentId);
  });
  const result: TaskTreeNode<T>[] = [];
  for (const task of roots) {
    if (!emitted.has(task.task_id)) result.push(buildNode(task, new Set<string>()));
  }
  for (const task of ordered) {
    if (!emitted.has(task.task_id)) result.push(buildNode(task, new Set<string>()));
  }
  return result;
}

/** Keep matching nodes plus every ancestor needed to preserve their hierarchy. */
export function filterTaskTree<T extends ParentLinkedTask>(
  nodes: readonly TaskTreeNode<T>[],
  matches: (task: T) => boolean,
): TaskTreeNode<T>[] {
  const filtered: TaskTreeNode<T>[] = [];
  for (const node of nodes) {
    const children = filterTaskTree(node.children, matches);
    if (matches(node.task) || children.length > 0) {
      filtered.push({ task: node.task, children });
    }
  }
  return filtered;
}

export function collectTaskTreeIds<T extends ParentLinkedTask>(
  nodes: readonly TaskTreeNode<T>[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (items: readonly TaskTreeNode<T>[]) => {
    for (const item of items) {
      ids.add(item.task.task_id);
      visit(item.children);
    }
  };
  visit(nodes);
  return ids;
}
