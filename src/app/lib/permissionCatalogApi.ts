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
  /** Returns array of permission codes whose pages are hidden from sidebar navigation. */
  getNavHiddenCodes() {
    return request<string[]>("/api/permission-catalog/nav-hidden");
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
