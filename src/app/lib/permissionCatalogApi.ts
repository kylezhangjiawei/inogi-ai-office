import { useEffect, useState } from "react";

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
    return request<Array<{ code: string; routePath: string; navHidden: boolean }>>(
      "/api/permission-catalog/nav-meta",
    );
  },
  saveItem(payload: SavePermissionCatalogItemPayload) {
    return request<PermissionCatalogItem>("/api/permission-catalog/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteItem(id: string) {
    return request<{ ok: true }>(`/api/permission-catalog/items/${id}`, {
      method: "DELETE",
    });
  },
};

type NavMetaItem = { code: string; routePath: string; navHidden: boolean };

/**
 * 同一用户内共享一次 nav-meta 请求：侧栏与知识库统一入口都要按 navHidden 过滤，
 * 各发各的既多一次往返，也可能拿到两份不同快照（侧栏藏了、下拉里还列着）。
 */
let navMetaCache: { userId: string; promise: Promise<NavMetaItem[]> } | null = null;

function loadNavMeta(userId: string) {
  if (navMetaCache?.userId !== userId) {
    navMetaCache = { userId, promise: permissionCatalogApi.getNavMeta() };
  }
  return navMetaCache.promise;
}

const EMPTY_CODES: ReadonlySet<string> = new Set<string>();

/**
 * 「导航隐藏」的权限码集合。传 undefined（未登录）时返回空集。
 * 接口失败一律当作「没有隐藏项」，不能因为目录接口挂了把导航锁死。
 */
export function useNavHiddenCodes(userId: string | undefined): ReadonlySet<string> {
  const [codes, setCodes] = useState<ReadonlySet<string>>(EMPTY_CODES);

  useEffect(() => {
    if (!userId) {
      setCodes(EMPTY_CODES);
      return;
    }
    let cancelled = false;
    loadNavMeta(userId)
      .then((items) => {
        if (cancelled) return;
        setCodes(new Set(items.filter((item) => item.navHidden).map((item) => item.code)));
        // 顺带把自定义路径写入缓存，供**下次加载**建路由时使用（本次会话的路由表已定型）
        cacheRoutePaths(items);
      })
      .catch(() => { /* silently ignore — show all items on error */ });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return codes;
}
