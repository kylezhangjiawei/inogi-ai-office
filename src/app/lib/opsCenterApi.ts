import { authFetch, readErrorMessage } from "./authSession";

export type OpsSectionKey = "overview" | "api-errors" | "database" | "services-tasks" | "alerts-audit";

export type OpsCenterSectionData = Record<string, unknown>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }

  return response.json() as Promise<T>;
}

export type ApiErrorQueryParams = {
  from?: string;
  to?: string;
  statusClass?: "2xx" | "4xx" | "5xx" | "all";
  method?: string;
  keyword?: string;
  errorsOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type OpsErrorAnalysis = {
  summary: string;
  probable_causes: string[];
  impact: string;
  investigation_steps: string[];
  fix_suggestions: string[];
  generated_by: "ai" | "unavailable";
  model?: string | null;
  signature: string;
  occurrences: number;
  cached: boolean;
  analyzed_at: string;
};

const endpointMap: Record<OpsSectionKey, string> = {
  overview: "/api/ops-center/overview",
  "api-errors": "/api/ops-center/api-errors",
  database: "/api/ops-center/database",
  "services-tasks": "/api/ops-center/services-tasks",
  "alerts-audit": "/api/ops-center/alerts-audit",
};

export const opsCenterApi = {
  getSection(section: OpsSectionKey) {
    return request<OpsCenterSectionData>(endpointMap[section]);
  },

  /** 错误日志服务端查询（时间范围/状态类/方法/关键字/仅错误/分页）。 */
  getApiErrors(params: ApiErrorQueryParams = {}) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.statusClass && params.statusClass !== "all") qs.set("statusClass", params.statusClass);
    if (params.method && params.method !== "全部") qs.set("method", params.method);
    if (params.keyword?.trim()) qs.set("keyword", params.keyword.trim());
    if (params.errorsOnly) qs.set("errorsOnly", "true");
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const q = qs.toString();
    return request<OpsCenterSectionData>(`/api/ops-center/api-errors${q ? `?${q}` : ""}`);
  },

  getEndpointStats(params: { from?: string; to?: string; sort?: "errors" | "calls" | "latency" } = {}) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.sort) qs.set("sort", params.sort);
    const q = qs.toString();
    return request<{ endpoints: any[]; window: { from: string; to: string } }>(`/api/ops-center/endpoint-stats${q ? `?${q}` : ""}`);
  },

  analyzeApiError(payload: { request_id: string; force?: boolean }) {
    return request<OpsErrorAnalysis>("/api/ops-center/api-errors/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
