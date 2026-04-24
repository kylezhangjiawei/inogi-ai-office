import { authFetch, readErrorMessage } from "./authSession";

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface MailboxItem {
  id: string;
  email: string;
  has_password: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  operator_name: string;
}

export interface SaveMailboxPayload {
  id?: string;
  email: string;
  password?: string;
  enabled: boolean;
}

export interface AiModelItem {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string;
  enabled: boolean;
  current_status: string;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_latency_ms?: number | null;
  today_requests: number;
  today_tokens: number;
  today_estimated_cost: number;
  current_balance_or_quota: string;
  is_default_enabled: boolean;
  created_at: string;
  updated_at: string;
  operator_name: string;
  has_api_key: boolean;
  last_error_message?: string | null;
}

export interface SaveAiModelPayload {
  id?: string;
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
  enabled: boolean;
  current_status: string;
  last_success_at?: string;
  last_failure_at?: string;
  last_latency_ms?: number;
  today_requests?: number;
  today_tokens?: number;
  today_estimated_cost?: number;
  current_balance_or_quota?: string;
  is_default_enabled: boolean;
}

export interface TestAiModelConnectionPayload {
  id?: string;
  provider?: string;
  model: string;
  base_url?: string;
  api_key?: string;
}

export interface TestAiModelConnectionResult {
  success: boolean;
  message: string;
  model: string;
  base_url?: string | null;
  duration_ms?: number;
  output_text?: string;
  total_tokens?: number | null;
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

function buildQuery(params: { page: number; pageSize: number; keyword?: string }) {
  const search = new URLSearchParams();
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  if (params.keyword?.trim()) {
    search.set("keyword", params.keyword.trim());
  }
  return search.toString();
}

function prepareSecretPayload(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }

  return { plain_secret: normalized };
}

export const integrationManagementApi = {
  listMailboxes(params: { page: number; pageSize: number; keyword?: string }) {
    return request<PaginatedResponse<MailboxItem>>(`/api/integration-management/mailboxes?${buildQuery(params)}`);
  },
  saveMailbox(payload: SaveMailboxPayload) {
    const secretPayload = prepareSecretPayload(payload.password);
    return request<MailboxItem>("/api/integration-management/mailboxes", {
      method: "POST",
      body: JSON.stringify({
        id: payload.id,
        email: payload.email,
        enabled: payload.enabled,
        ...secretPayload,
      }),
    });
  },
  deleteMailbox(mailboxId: string) {
    return request<{ id: string }>(`/api/integration-management/mailboxes/${mailboxId}`, {
      method: "DELETE",
    });
  },
  listAiModels(params: { page: number; pageSize: number; keyword?: string }) {
    return request<PaginatedResponse<AiModelItem>>(`/api/integration-management/ai-models?${buildQuery(params)}`);
  },
  saveAiModel(payload: SaveAiModelPayload) {
    const secretPayload = prepareSecretPayload(payload.api_key);
    return request<AiModelItem>("/api/integration-management/ai-models", {
      method: "POST",
      body: JSON.stringify({
        id: payload.id,
        name: payload.name,
        provider: payload.provider,
        model: payload.model,
        base_url: payload.base_url,
        enabled: payload.enabled,
        current_status: payload.current_status,
        last_success_at: payload.last_success_at,
        last_failure_at: payload.last_failure_at,
        last_latency_ms: payload.last_latency_ms,
        today_requests: payload.today_requests,
        today_tokens: payload.today_tokens,
        today_estimated_cost: payload.today_estimated_cost,
        current_balance_or_quota: payload.current_balance_or_quota,
        is_default_enabled: payload.is_default_enabled,
        ...secretPayload,
      }),
    });
  },
  testAiModelConnection(payload: TestAiModelConnectionPayload) {
    const secretPayload = prepareSecretPayload(payload.api_key);
    return request<TestAiModelConnectionResult>("/api/integration-management/ai-models/test", {
      method: "POST",
      body: JSON.stringify({
        id: payload.id,
        provider: payload.provider,
        model: payload.model,
        base_url: payload.base_url,
        ...secretPayload,
      }),
    });
  },
  deleteAiModel(modelId: string) {
    return request<{ id: string }>(`/api/integration-management/ai-models/${modelId}`, {
      method: "DELETE",
    });
  },
};
