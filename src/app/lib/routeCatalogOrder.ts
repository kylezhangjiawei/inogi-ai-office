import type { PermissionCatalogItem } from "./permissionCatalogApi";

type RouteTreeBranch = {
  key: string;
  label: string;
  items: PermissionCatalogItem[];
};

type RouteTreeRoot = {
  label: string;
  items: PermissionCatalogItem[];
  branches: RouteTreeBranch[];
};

export type RouteOrderTarget = { branchKey: string; itemId?: string };

function compareCatalogItems(a: PermissionCatalogItem, b: PermissionCatalogItem) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function splitGroupLabel(groupLabel: string) {
  const parts = groupLabel
    .split(/[·>／\/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    root: parts[0] || "未分组",
    branch: parts.slice(1).join(" · ") || "默认分组",
  };
}

export function buildRouteTree(items: PermissionCatalogItem[]): RouteTreeRoot[] {
  const roots = new Map<string, RouteTreeRoot>();

  for (const item of items) {
    const group = splitGroupLabel(item.groupLabel);
    const root = roots.get(group.root) ?? { label: group.root, items: [], branches: [] };
    root.items.push(item);
    let branch = root.branches.find((candidate) => candidate.label === group.branch);
    if (!branch) {
      branch = { key: `${group.root}::${group.branch}`, label: group.branch, items: [] };
      root.branches.push(branch);
    }
    branch.items.push(item);
    roots.set(group.root, root);
  }

  return Array.from(roots.values())
    .map((root) => ({
      ...root,
      items: root.items.slice().sort(compareCatalogItems),
      branches: root.branches
        .map((branch) => ({ ...branch, items: branch.items.slice().sort(compareCatalogItems) }))
        .sort((a, b) => {
          const firstPageA = a.items.find((item) => item.type === "page");
          const firstPageB = b.items.find((item) => item.type === "page");
          return firstPageA && firstPageB
            ? compareCatalogItems(firstPageA, firstPageB) || a.label.localeCompare(b.label, "zh-CN")
            : a.label.localeCompare(b.label, "zh-CN");
        }),
    }))
    .sort((a, b) => {
      const left = Math.min(...a.items.map((item) => item.sortOrder));
      const right = Math.min(...b.items.map((item) => item.sortOrder));
      return left - right || a.label.localeCompare(b.label, "zh-CN");
    });
}

/** Reorder complete page groups so filtered, hidden and disabled entries are never lost. */
export function moveRoutePages(items: PermissionCatalogItem[], branchKey: string, direction: -1 | 1, itemId?: string): string[] | null {
  const tree = buildRouteTree(items.filter((item) => item.type === "page"));
  const root = tree.find((candidate) => candidate.branches.some((branch) => branch.key === branchKey));
  if (!root) return null;
  const branchIndex = root.branches.findIndex((branch) => branch.key === branchKey);
  const branch = root.branches[branchIndex];
  const targets = itemId ? branch.items : root.branches;
  const index = itemId ? branch.items.findIndex((item) => item.id === itemId) : branchIndex;
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= targets.length) return null;
  // The tree owns fresh arrays; the source catalog remains untouched until saving succeeds.
  if (itemId) {
    [branch.items[index], branch.items[destination]] = [branch.items[destination], branch.items[index]];
  } else {
    [root.branches[index], root.branches[destination]] = [root.branches[destination], root.branches[index]];
  }
  return tree.flatMap((entry) => entry.branches.flatMap((group) => group.items.map((item) => item.id)));
}

/** Insert a page or complete group without changing its membership or omitting hidden pages. */
export function dropRoutePages(
  items: PermissionCatalogItem[],
  source: RouteOrderTarget,
  target: RouteOrderTarget,
  placement: "before" | "after",
): string[] | null {
  const movingPage = source.itemId !== undefined;
  if (movingPage !== (target.itemId !== undefined)) return null;
  const tree = buildRouteTree(items.filter((item) => item.type === "page"));
  const root = tree.find((entry) => entry.branches.some((branch) => branch.key === source.branchKey));
  const branch = root?.branches.find((entry) => entry.key === source.branchKey);
  const targetBranch = root?.branches.find((entry) => entry.key === target.branchKey);
  if (!root || !branch || !targetBranch || (movingPage && branch !== targetBranch)) return null;
  const entries: (PermissionCatalogItem | RouteTreeBranch)[] = movingPage ? branch.items : root.branches;
  const sourceIndex = movingPage ? branch.items.findIndex((item) => item.id === source.itemId) : root.branches.indexOf(branch);
  const targetIndex = movingPage ? branch.items.findIndex((item) => item.id === target.itemId) : root.branches.indexOf(targetBranch);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  const destination = targetIndex + (placement === "after" ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  if (destination === sourceIndex) return null;
  entries.splice(destination, 0, ...entries.splice(sourceIndex, 1));
  return tree.flatMap((entry) => entry.branches.flatMap((group) => group.items.map((item) => item.id)));
}
