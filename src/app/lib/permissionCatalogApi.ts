import { authFetch, readErrorMessage } from "./authSession";

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
