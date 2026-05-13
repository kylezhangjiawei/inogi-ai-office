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
