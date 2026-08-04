export type RdTaskTreeCategory<TTask> = {
  children: ReadonlyArray<{
    tasks: ReadonlyArray<TTask>;
  }>;
};

/**
 * 驾驶舱列表与 KPI 只认分类/部件下的根任务。
 * 子任务仍保留在父任务的 subtasks 中，供任务详情和合并关系展示。
 */
export function rootTasksFromCategories<TTask>(
  categories: ReadonlyArray<RdTaskTreeCategory<TTask>>,
): TTask[] {
  return categories.flatMap((category) =>
    category.children.flatMap((subProject) => [...subProject.tasks]),
  );
}
