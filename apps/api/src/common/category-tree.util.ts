/**
 * 作品库分类树的纯计算部分（不碰 Prisma）：图像作品库与视频作品库共用同一套
 * 「最多 3 层、同级不重名、删父连子、作品转未分类」的目录规则，把层号/子树/成树
 * 这些算法放在这里，两边服务只保留各自的 Prisma 读写。
 */

/** 作品库「未分类」筛选值：与真实分类 id 区分开（cuid 不会等于该字面量）。 */
export const UNCATEGORIZED_FILTER = 'uncategorized';
/** 分类树最大层数（根为第 1 层）。 */
export const MAX_CATEGORY_DEPTH = 3;
export const DEFAULT_CATEGORY_COLOR = '#3b82f6';

/** 算法只需要父子关系，故最小约束到这两个字段。 */
export type CategoryLink = { id: string; parentId: string | null };

export type CategoryTreeNode<T> = T & {
  /** 直接挂在该节点上的作品数 */
  itemCount: number;
  /** 含所有子孙分类的作品数，与「选中父分类看到的列表」同口径 */
  totalItemCount: number;
  /** 层号，根为 1 */
  depth: number;
  /** 从根到本节点的名称路径，如「产品图 / 详情页」 */
  path: string;
  children: Array<CategoryTreeNode<T>>;
};

/** 节点自身的层号，根为 1。 */
export function categoryDepth(id: string, categories: CategoryLink[]): number {
  const byId = new Map(categories.map((item) => [item.id, item]));
  let depth = 1;
  let cursor = byId.get(id)?.parentId ?? null;
  // 上限兜底：数据异常成环时不至于死循环
  while (cursor && depth <= MAX_CATEGORY_DEPTH + 1) {
    depth += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return depth;
}

/**
 * 子树自身的高度（只有自己 = 1）。
 * visited 是防环保护：父子关系一旦成环（并发移动的历史遗留数据），没有它这里会无限
 * 互递归到爆栈，把接口打成 500。同文件的 categoryDepth / collectSubtreeIds 同样做了防护。
 */
export function subtreeHeight(
  id: string,
  categories: CategoryLink[],
  visited: Set<string> = new Set(),
): number {
  if (visited.has(id)) return 1;
  visited.add(id);
  const children = categories.filter((item) => item.parentId === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(child.id, categories, visited)));
}

/** 自己 + 所有子孙的 id。 */
export function collectSubtreeIds(id: string, categories: CategoryLink[]): string[] {
  const ids = [id];
  for (let cursor = 0; cursor < ids.length; cursor += 1) {
    for (const item of categories) {
      if (item.parentId === ids[cursor] && !ids.includes(item.id)) ids.push(item.id);
    }
  }
  return ids;
}

/** 平铺记录 → 嵌套树，同时把直接计数汇总成含子孙的 totalItemCount。 */
export function buildCategoryTree<T extends CategoryLink & { name: string }>(
  categories: T[],
  counts: Map<string | null, number>,
): Array<CategoryTreeNode<T>> {
  const byParent = new Map<string | null, T[]>();
  for (const category of categories) {
    const siblings = byParent.get(category.parentId) ?? [];
    siblings.push(category);
    byParent.set(category.parentId, siblings);
  }

  const build = (parentId: string | null, depth: number, parentPath: string): Array<CategoryTreeNode<T>> =>
    (byParent.get(parentId) ?? []).map((category) => {
      const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
      const children = build(category.id, depth + 1, path);
      const itemCount = counts.get(category.id) ?? 0;
      return {
        ...category,
        itemCount,
        totalItemCount: children.reduce((sum, child) => sum + child.totalItemCount, itemCount),
        depth,
        path,
        children,
      };
    });

  return build(null, 1, '');
}
