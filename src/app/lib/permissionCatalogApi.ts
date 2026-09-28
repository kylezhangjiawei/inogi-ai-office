import { useEffect, useMemo, useState } from "react";

import { authFetch, readErrorMessage } from "./authSession";
import { cacheRoutePaths } from "./routePaths";

export type PermissionCatalogPermission = {
  code: string;
  label: string;
  description?: string;
  type?: "page" | "action";
  routePath?: string;
};

export type PermissionCatalogGroup = {
  label: string;
  permissions: PermissionCatalogPermission[];
};

export type PermissionCatalogItem = {
  id: string;
  code: string;
  label: string;
  description: string;
  groupLabel: string;
  type: "page" | "action";
  routePath: string;
  enabled: boolean;
  /** When true the page is accessible but hidden from the sidebar navigation. */
  navHidden: boolean;
  /**
   * 随代码发布的内置条目。删除无效——ensureDefaults 会在下次加载时补回，
   * 且页面组件本就由代码提供。需要下线请用「停用」。前端据此隐藏删除入口。
   */
  builtIn?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SavePermissionCatalogItemPayload = {
  id?: string;
  code: string;
  label: string;
  description?: string;
  groupLabel: string;
  type: "page" | "action";
  routePath?: string;
  enabled: boolean;
  /** When true the page is accessible but hidden from the sidebar navigation. */
  navHidden?: boolean;
  sortOrder: number;
};

export type NavMetaItem = { code: string; routePath: string; navHidden: boolean; sortOrder: number; groupLabel: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const permissionCatalogApi = {
  listGroups() {
    return request<PermissionCatalogGroup[]>("/api/permission-catalog/groups");
  },
  listItems() {
    return request<PermissionCatalogItem[]>("/api/permission-catalog/items");
  },
  /**
   * 导航与路由元数据（任意登录用户可读）：既决定侧边栏显隐，也提供各页面的自定义访问路径。
   * 取代原 getNavHiddenCodes —— 两份数据同源同一次请求，避免显隐与路径来自不同快照。
   */
  getNavMeta() {
    return request<NavMetaItem[]>("/api/permission-catalog/nav-meta");
  },
  async saveItem(payload: SavePermissionCatalogItemPayload) {
    const item = await request<PermissionCatalogItem>("/api/permission-catalog/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refreshNavMeta();
    return item;
  },
  async reorderItems(ids: string[]) {
    const items = await request<PermissionCatalogItem[]>("/api/permission-catalog/items/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    refreshNavMeta();
    return items;
  },
  async deleteItem(id: string) {
    const result = await request<{ ok: true }>(`/api/permission-catalog/items/${id}`, {
      method: "DELETE",
    });
    refreshNavMeta();
    return result;
  },
};

/**
 * 同一用户内共享一次 nav-meta 请求：侧栏与知识库统一入口都要按 navHidden 过滤，
 * 各发各的既多一次往返，也可能拿到两份不同快照（侧栏藏了、下拉里还列着）。
 */
let navMetaCache: { userId: string; promise: Promise<NavMetaItem[]> } | null = null;
const navMetaListeners = new Set<() => void>();

function refreshNavMeta() {
  navMetaCache = null;
  navMetaListeners.forEach((listener) => listener());
}

function loadNavMeta(userId: string) {
  if (navMetaCache?.userId !== userId) {
    const promise = permissionCatalogApi.getNavMeta().catch((error) => {
      if (navMetaCache?.promise === promise) navMetaCache = null;
      throw error;
    });
    navMetaCache = { userId, promise };
  }
  return navMetaCache.promise;
}

const EMPTY_NAV_META: NavMetaItem[] = [];

/** 页面配置保存后，各导航入口共享刷新；读取失败保留现有导航，不阻断页面访问。 */
export function useNavMeta(userId: string | undefined): NavMetaItem[] {
  const [snapshot, setSnapshot] = useState<{ userId: string; items: NavMetaItem[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let requestId = 0;
    const refresh = () => {
      const currentRequest = ++requestId;
      loadNavMeta(userId)
        .then((items) => {
          if (currentRequest !== requestId) return;
          setSnapshot({ userId, items });
          // 路径仍在下次加载建路由时生效，显隐和排序立即更新。
          cacheRoutePaths(items);
        })
        .catch(() => { /* keep the current navigation when metadata is unavailable */ });
    };
    navMetaListeners.add(refresh);
    refresh();
    return () => {
      requestId++;
      navMetaListeners.delete(refresh);
    };
  }, [userId]);

  return snapshot && snapshot.userId === userId ? snapshot.items : EMPTY_NAV_META;
}

/** 「导航隐藏」的权限码集合，供知识库聚合入口复用同一份导航快照。 */
export function useNavHiddenCodes(userId: string | undefined): ReadonlySet<string> {
  const items = useNavMeta(userId);
  return useMemo(() => new Set(items.filter((item) => item.navHidden).map((item) => item.code)), [items]);
}
