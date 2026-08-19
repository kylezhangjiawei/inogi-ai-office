/**
 * 图像 / 视频作品库共用的分类目录约定。
 * 两个库的后端分类接口是同构的（最多 3 层树、同级不重名、删分类保留作品），
 * 前端把「树的形状 + 纯计算」收在这里，UI 由 components/MediaCategorySidebar 复用。
 */

/** 作品库「未分类」筛选值，与后端 buildCategoryFilter 约定一致。 */
export const UNCATEGORIZED_FILTER = "uncategorized";
/** 分类树最大层数，与后端 MAX_CATEGORY_DEPTH 一致。 */
export const MAX_CATEGORY_DEPTH = 3;
export const DEFAULT_CATEGORY_COLOR = "#3b82f6";
export const CATEGORY_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#6366f1", "#0ea5e9", "#64748b"];

/** 侧栏组件需要的最小分类形状；各作品库把自己的接口字段映射到这里。 */
export type MediaCategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  /** 层号，根为 1 */
  depth: number;
  /** 从根到本节点的名称路径，如「产品图 / 详情页」 */
  path: string;
  /** 当前用户直接挂在该节点上的作品数 */
  itemCount: number;
  /** 含所有子孙分类的作品数，与「选中父分类看到的列表」同口径 */
  totalItemCount: number;
  children: MediaCategoryNode[];
};

export type CategoryFormPayload = {
  name: string;
  color: string;
  parentId: string | null;
};

/** 把嵌套树按前序展开成平铺数组，便于渲染缩进列表与做 id 索引。 */
export function flattenCategories<T extends { children?: T[] }>(categories: T[]): T[] {
  const flat: T[] = [];
  const walk = (nodes: T[]) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children ?? []);
    }
  };
  walk(categories);
  return flat;
}

/** 节点自己 + 所有子孙的 id：判断作品改归属后是否还落在当前筛选下。 */
export function subtreeIds<T extends { id: string; children?: T[] }>(category?: T | null): string[] {
  if (!category) return [];
  return flattenCategories([category]).map((item) => item.id);
}

/** 子树自身高度（叶子 = 1），用于判断移动后会不会超层。 */
export function subtreeHeight<T extends { children?: T[] }>(category: T): number {
  const children = category.children ?? [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(child)));
}
