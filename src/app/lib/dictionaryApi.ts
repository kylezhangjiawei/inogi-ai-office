import { authFetch, readErrorMessage } from "./authSession";

export type DictionaryKind = "email" | "generic";

export interface DictionaryType {
  id: string;
  key: string;
  label: string;
  kind: DictionaryKind;
  created_at: string;
  updated_at: string;
}

export interface EmailDictionaryItem {
  id: string;
  kind: "email";
  account: string;
  password: string;
  updated_at: string;
  updated_by: string;
}

export interface GenericDictionaryItem {
  id: string;
  kind: "generic";
  code: string;
  label: string;
  remark: string;
  updated_at: string;
  updated_by: string;
}

export type DictionaryItem = EmailDictionaryItem | GenericDictionaryItem;

export interface DictionaryItemsResponse {
  type: DictionaryType;
  items: DictionaryItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  operators: string[];
}

export interface SaveDictionaryTypePayload {
  id?: string;
  label: string;
  kind?: DictionaryKind;
}

export interface SaveDictionaryItemPayload {
  id?: string;
  code?: string;
  label?: string;
  remark?: string;
  account?: string;
  password?: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const dictionaryApi = {
  listTypes() {
    return request<DictionaryType[]>("/api/dictionaries/types");
  },
  saveType(payload: SaveDictionaryTypePayload) {
    return request<DictionaryType>("/api/dictionaries/types", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteType(typeId: string) {
    return request<{ id: string }>(`/api/dictionaries/types/${typeId}`, {
      method: "DELETE",
    });
  },
  listItems(typeId: string, filters: { page: number; pageSize: number; keyword?: string; operator?: string }) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page));
    params.set("page_size", String(filters.pageSize));
    if (filters.keyword?.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.operator?.trim() && filters.operator !== "ALL") params.set("operator", filters.operator.trim());
    return request<DictionaryItemsResponse>(`/api/dictionaries/types/${typeId}/items?${params.toString()}`);
  },
  saveItem(typeId: string, payload: SaveDictionaryItemPayload) {
    return request<DictionaryItem>(`/api/dictionaries/types/${typeId}/items`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteItem(itemId: string) {
    return request<{ id: string }>(`/api/dictionaries/items/${itemId}`, {
      method: "DELETE",
    });
  },
};
