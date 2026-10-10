import { useMemo } from "react";
import { useAuth } from "../auth";
import { navGroups, withHrPreviewNavigation, type NavGroup, type NavItem } from "../routesConfig";
import { hasPermission } from "./permissions";
import { useNavMeta, type NavMetaItem } from "./permissionCatalogApi";

const EMPTY_PERMISSIONS: string[] = [];

// 聚合入口和操作权限入口没有独立页面排序，保留原位置，仅交换已配置项。
function sortConfiguredSlots<T>(items: T[], getRank: (item: T) => number | undefined, getTieRank: (item: T) => number = () => 0): T[] {
  const ranked = items.map((item) => ({ item, rank: getRank(item) }));
  const ordered = ranked.filter(({ rank }) => Number.isFinite(rank)).sort((a, b) => a.rank! - b.rank! || getTieRank(a.item) - getTieRank(b.item));
  let index = 0;
  return ranked.map(({ item, rank }) => Number.isFinite(rank) ? ordered[index++].item : item);
}

export function buildVisibleNavigation(groups: NavGroup[], permissions: string[], metadata: NavMetaItem[]): NavGroup[] {
  const byCode = new Map(metadata.map((item, index) => [item.code, { ...item, index }]));
  const hiddenCodes = new Set(metadata.filter((item) => item.navHidden).map((item) => item.code));
  const groupRanks = new Map<string, number>();
  for (const item of metadata) {
    if (!item.code.startsWith("page:") || !Number.isFinite(item.sortOrder)) continue;
    const branch = item.groupLabel?.split(/[·>／\/|]/).map((part) => part.trim()).filter(Boolean).slice(1).join(" · ");
    if (branch) groupRanks.set(branch, Math.min(groupRanks.get(branch) ?? Infinity, item.sortOrder));
  }
  const pageRank = (item: NavItem) => item.requiredPermission
    ? byCode.get(item.requiredPermission)?.sortOrder
    : undefined;
  const orderedGroups = sortConfiguredSlots(groups, (group) => {
    const configuredRank = groupRanks.get(group.label);
    if (configuredRank !== undefined) return configuredRank;
    // Older metadata responses lack group labels; retain their direct-page fallback.
    const ranks = group.items.map(pageRank).filter((rank) => Number.isFinite(rank));
    return ranks.length ? Math.min(...ranks) : undefined;
  });

  return orderedGroups
    .map((group) => ({
      ...group,
      items: sortConfiguredSlots(group.items, pageRank, (item) => byCode.get(item.requiredPermission)?.index ?? 0).filter((item) => {
        if (item.requiredPermissionAll?.some((code) => !hasPermission(permissions, code))) return false;
        if (item.requiredPermissionAny?.length) {
          return item.requiredPermissionAny.some(
            (code) => hasPermission(permissions, code) && !hiddenCodes.has(code),
          );
        }
        return !item.requiredPermission || (
          hasPermission(permissions, item.requiredPermission) && !hiddenCodes.has(item.requiredPermission)
        );
      }),
    }))
    .filter((group) => group.items.length > 0);
}

/** Keep page search and both navigation surfaces on the same order and permission rules. */
export function useVisibleNavigation(includeHrPreview = false) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? EMPTY_PERMISSIONS;
  const metadata = useNavMeta(user?.id);
  return useMemo(() => buildVisibleNavigation(includeHrPreview ? withHrPreviewNavigation(navGroups) : navGroups, permissions, metadata), [includeHrPreview, permissions, metadata]);
}
