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
  total_tokens: number;
  daily_token_usage: Array<{
    date: string;
    requests: number;
    tokens: number;
  }>;
  is_default_enabled: boolean;
  /** 显式用途类型：text | multimodal | image | embedding | document | video | audio | auto */
  usage_kind: string;
  /** 输入单价（元 / 千 token），0 表示未配置 */
  input_price_per_1k: number;
  /** 输出单价（元 / 千 token），0 表示未配置 */
  output_price_per_1k: number;
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
  is_default_enabled: boolean;
  /** 显式用途类型：text | multimodal | image | embedding | document | video | audio | auto */
  usage_kind?: string;
  input_price_per_1k?: number;
  output_price_per_1k?: number;
}

export interface TestAiModelConnectionPayload {
  id?: string;
  provider?: string;
  model: string;
  base_url?: string;
  usage_kind?: string;
  api_key?: string;
  /** 测试失败时由后端直接停用该模型（仅对已保存配置的测试使用） */
  disable_on_failure?: boolean;
}

export interface TestAiModelConnectionResult {
  success: boolean;
  message: string;
  model: string;
  base_url?: string | null;
  duration_ms?: number;
  output_text?: string;
  total_tokens?: number | null;
  /** 归一化错误码（失败时） */
  error_code?: string;
  /** 中文一句话结论（失败时） */
  error_reason?: string;
  /** 可能造成失败的具体情况，按可能性排序（失败时） */
  error_causes?: string[];
  /** 上游原始错误（失败时） */
  raw_error?: string;
  /** 本次测试把模型从启用改成了停用 */
  disabled?: boolean;
}

export type AiGatewayRange = "today" | "month" | "year";
export type AiGatewayStrategy = "priority" | "round_robin" | "weighted" | "lowest_latency";

export interface AiGatewayRouteTarget {
  id: string;
  connection_id: string;
  connection_name: string;
  provider: string;
  model: string;
  priority: number;
  weight: number;
  enabled: boolean;
  connection_enabled: boolean;
}

export interface AiGatewayRoute {
  id: string;
  scene: string;
  name: string;
  enabled: boolean;
  timeout_ms: number;
  strategy: AiGatewayStrategy;
  failure_threshold: number;
  cooldown_ms: number;
  targets: AiGatewayRouteTarget[];
  created_at: string;
  updated_at: string;
}

export interface AiGatewayOverviewGroup {
  requests: number;
  success_rate: number;
  average_latency_ms: number;
}

export interface AiGatewayConnectionOverview {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
  usage_kind: string;
  status: "healthy" | "warning" | "error" | "idle" | "disabled" | "circuit_open";
  requests: number;
  successful_requests: number;
  failed_requests: number;
  circuit_skips: number;
  success_rate: number;
  average_latency_ms: number;
  last_latency_ms: number | null;
  last_called_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  open_circuits: number;
  last_error_code: string | null;
  last_error_message: string | null;
}

export interface AiGatewayOverview {
  range: AiGatewayRange;
  totals: {
    requests: number;
    failed_requests: number;
    success_rate: number;
    fallback_rate: number;
    average_latency_ms: number;
    total_tokens: number;
    circuit_skips: number;
    /** 仅累计已配单价的模型（元） */
    total_cost: number;
    /** 未配单价、因而未计入 total_cost 的模型数 */
    unpriced_models: number;
  };
  by_scene: Array<AiGatewayOverviewGroup & { scene: string }>;
  by_provider: Array<AiGatewayOverviewGroup & {
    provider: string;
    model: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    /** null = 该模型未配单价 */
    cost: number | null;
  }>;
  by_error: Array<{ error_code: string; requests: number }>;
  /** 包含所有已配置连接，即使统计区间内尚未被调用。 */
  connections: AiGatewayConnectionOverview[];
  diagnostics: {
    summary: {
      critical: number;
      warning: number;
      healthy: number;
      idle: number;
    };
    scenes: Array<{
      scene: string;
      name: string;
      status: "critical" | "warning" | "healthy" | "idle";
      requests: number;
      failed_requests: number;
      success_rate: number;
      fallback_rate: number;
      average_latency_ms: number;
      circuit_skips: number;
      open_circuits: number;
      reasons: string[];
    }>;
  };
  trend: Array<{
    date: string;
    requests: number;
    success_rate: number;
    fallback_rate: number;
    total_tokens: number;
    average_latency_ms: number;
  }>;
}

export interface AiGatewayCircuit {
  scene: string;
  targetKey: string;
  connectionId?: string;
  provider: string;
  model: string;
  consecutiveFailures: number;
  state: "closed" | "open";
  openUntil?: string;
  lastFailureAt: string;
}

export interface AiGatewayRequestAttempt {
  sequence: number;
  connection_id: string | null;
  provider: string;
  model: string;
  status: "success" | "failed" | "circuit_open";
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
}

export interface AiGatewayRequestItem {
  id: string;
  scene: string;
  status: "success" | "failed";
  provider: string | null;
  model: string | null;
  latency_ms: number;
  attempt_count: number;
  fallback_used: boolean;
  /** 选模来源：route=命中路由 / fallback=回落默认 / user=用户显式选模 / vision=视觉跳过路由；null=存量数据未知 */
  route_source: "route" | "fallback" | "user" | "vision" | null;
  /** 命中路由时的调度策略 */
  strategy: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  attempts: AiGatewayRequestAttempt[];
}

export interface AiGatewayRequestPage {
  items: AiGatewayRequestItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export interface OcrSupportedAction {
  key: string;
  label: string;
  default_action: string;
}

export interface OcrConfigItem {
  /** database=已迁入数据库；env=仍在用环境变量；none=完全未配置 */
  source: "database" | "env" | "none";
  enabled: boolean;
  secret_id: string;
  has_secret_key: boolean;
  region: string;
  endpoint: string;
  invoice_action: string;
  operator_name: string;
  updated_at: string | null;
  supported_actions: OcrSupportedAction[];
}

export interface SaveOcrConfigPayload {
  enabled: boolean;
  secret_id?: string;
  /** 明文 SecretKey；留空表示保留原密钥 */
  secret_key?: string;
  region?: string;
  endpoint?: string;
  invoice_action?: string;
}

type SecurityPublicKeyResponse = {
  algorithm: "RSA-OAEP";
  public_key: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const LEGACY_PLAIN_SECRET_ERROR = "plain_secret should not exist";
let cachedPublicKey: Promise<CryptoKey> | null = null;

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

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function canEncryptInBrowser() {
  return typeof window !== "undefined" && window.isSecureContext && Boolean(window.crypto?.subtle);
}

async function getSecurityPublicKey() {
  const response = await request<SecurityPublicKeyResponse>("/api/integration-management/security/public-key");
  return window.crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(response.public_key),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"],
  );
}

async function encryptSensitiveValue(value: string) {
  if (!canEncryptInBrowser()) {
    return null;
  }

  if (!cachedPublicKey) {
    cachedPublicKey = getSecurityPublicKey();
  }

  const publicKey = await cachedPublicKey;
  const encodedValue = new TextEncoder().encode(value);
  const encrypted = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, encodedValue);
  return window.btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

function prepareSecretPayload(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }

  return { plain_secret: normalized };
}

async function prepareLegacySecretPayload(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }

  const encryptedSecret = await encryptSensitiveValue(normalized);
  if (!encryptedSecret) {
    return null;
  }

  return { encrypted_secret: encryptedSecret };
}

function shouldRetryWithLegacySecret(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.toLowerCase().includes(LEGACY_PLAIN_SECRET_ERROR);
}

function buildLegacyVersionMismatchError() {
  return new Error(
    "线上后端仍在使用旧版接口，暂不接受 plain_secret；当前浏览器环境又无法回退到旧版浏览器加密。请先部署最新后端，或使用 HTTPS / localhost 后重试。",
  );
}

export const integrationManagementApi = {
  listMailboxes(params: { page: number; pageSize: number; keyword?: string }) {
    return request<PaginatedResponse<MailboxItem>>(`/api/integration-management/mailboxes?${buildQuery(params)}`);
  },
  async saveMailbox(payload: SaveMailboxPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
      id: payload.id,
      email: payload.email,
      enabled: payload.enabled,
      ...secretPayload,
    });

    try {
      return await request<MailboxItem>("/api/integration-management/mailboxes", {
        method: "POST",
        body: JSON.stringify(buildBody(prepareSecretPayload(payload.password))),
      });
    } catch (error) {
      if (!shouldRetryWithLegacySecret(error) || !payload.password?.trim()) {
        throw error;
      }

      const legacySecretPayload = await prepareLegacySecretPayload(payload.password);
      if (!legacySecretPayload) {
        throw buildLegacyVersionMismatchError();
      }

      return request<MailboxItem>("/api/integration-management/mailboxes", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
  deleteMailbox(mailboxId: string) {
    return request<{ id: string }>(`/api/integration-management/mailboxes/${mailboxId}`, {
      method: "DELETE",
    });
  },
  listAiModels(params: { page: number; pageSize: number; keyword?: string }) {
    return request<PaginatedResponse<AiModelItem>>(`/api/integration-management/ai-models?${buildQuery(params)}`);
  },
  async saveAiModel(payload: SaveAiModelPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
        id: payload.id,
        name: payload.name,
        provider: payload.provider,
        model: payload.model,
        base_url: payload.base_url,
        usage_kind: payload.usage_kind,
        input_price_per_1k: payload.input_price_per_1k,
        output_price_per_1k: payload.output_price_per_1k,
        enabled: payload.enabled,
        current_status: payload.current_status,
        last_success_at: payload.last_success_at,
        last_failure_at: payload.last_failure_at,
        last_latency_ms: payload.last_latency_ms,
        today_requests: payload.today_requests,
        today_tokens: payload.today_tokens,
        is_default_enabled: payload.is_default_enabled,
        ...secretPayload,
    });

    try {
      return await request<AiModelItem>("/api/integration-management/ai-models", {
        method: "POST",
        body: JSON.stringify(buildBody(prepareSecretPayload(payload.api_key))),
      });
    } catch (error) {
      if (!shouldRetryWithLegacySecret(error) || !payload.api_key?.trim()) {
        throw error;
      }

      const legacySecretPayload = await prepareLegacySecretPayload(payload.api_key);
      if (!legacySecretPayload) {
        throw buildLegacyVersionMismatchError();
      }

      return request<AiModelItem>("/api/integration-management/ai-models", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
  async testAiModelConnection(payload: TestAiModelConnectionPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
        id: payload.id,
        provider: payload.provider,
        model: payload.model,
        base_url: payload.base_url,
        usage_kind: payload.usage_kind,
        disable_on_failure: payload.disable_on_failure,
        ...secretPayload,
      });

    try {
      return await request<TestAiModelConnectionResult>("/api/integration-management/ai-models/test", {
        method: "POST",
        body: JSON.stringify(buildBody(prepareSecretPayload(payload.api_key))),
      });
    } catch (error) {
      if (!shouldRetryWithLegacySecret(error) || !payload.api_key?.trim()) {
        throw error;
      }

      const legacySecretPayload = await prepareLegacySecretPayload(payload.api_key);
      if (!legacySecretPayload) {
        throw buildLegacyVersionMismatchError();
      }

      return request<TestAiModelConnectionResult>("/api/integration-management/ai-models/test", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
  deleteAiModel(modelId: string) {
    return request<{ id: string; affected_routes?: Array<{ scene: string; name: string }> }>(
      `/api/integration-management/ai-models/${modelId}`,
      { method: "DELETE" },
    );
  },
  listAiGatewayRoutes() {
    // usage_24h：近 24h 各场景按选模来源（route/fallback/user/vision/unknown）的调用计数，
    // 路由页据此展示运行期反馈（「策略生效中」不再只是配置回显）
    return request<{ items: AiGatewayRoute[]; usage_24h?: Record<string, Record<string, number>> }>(
      "/api/ai-gateway/routes",
    );
  },
  saveAiGatewayRoute(payload: {
    scene: string;
    name: string;
    enabled: boolean;
    timeout_ms: number;
    strategy: AiGatewayStrategy;
    failure_threshold: number;
    cooldown_ms: number;
    connection_ids: string[];
    target_weights: number[];
  }) {
    return request<{ id: string; scene: string; updated_at: string }>("/api/ai-gateway/routes", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  /** 删除路由（场景回到「默认回退」态）。此前只能停用不能删，试探性配置会永久残留。 */
  deleteAiGatewayRoute(scene: string) {
    return request<{ ok: boolean; scene: string }>(`/api/ai-gateway/routes/${encodeURIComponent(scene)}`, {
      method: "DELETE",
    });
  },
  getAiGatewayOverview(range: AiGatewayRange) {
    return request<AiGatewayOverview>(`/api/ai-gateway/overview?range=${range}`);
  },
  listAiGatewayCircuits() {
    return request<{ items: AiGatewayCircuit[] }>("/api/ai-gateway/circuits");
  },
  resetAiGatewayCircuits(payload: { scene?: string; target_key?: string }) {
    return request<{ reset: number }>("/api/ai-gateway/circuits/reset", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listAiGatewayRequests(params: {
    scene?: string;
    status?: "success" | "failed" | "";
    connectionId?: string;
    page: number;
    pageSize: number;
  }) {
    const search = new URLSearchParams({
      page: String(params.page),
      page_size: String(params.pageSize),
    });
    if (params.scene?.trim()) search.set("scene", params.scene.trim());
    if (params.status) search.set("status", params.status);
    if (params.connectionId?.trim()) search.set("connection_id", params.connectionId.trim());
    return request<AiGatewayRequestPage>(`/api/ai-gateway/requests?${search.toString()}`);
  },
  getOcrConfig() {
    return request<OcrConfigItem>("/api/integration-management/ocr-config");
  },
  async saveOcrConfig(payload: SaveOcrConfigPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
      enabled: payload.enabled,
      secret_id: payload.secret_id,
      region: payload.region,
      endpoint: payload.endpoint,
      invoice_action: payload.invoice_action,
      ...secretPayload,
    });

    try {
      return await request<OcrConfigItem>("/api/integration-management/ocr-config", {
        method: "POST",
        body: JSON.stringify(buildBody(prepareSecretPayload(payload.secret_key))),
      });
    } catch (error) {
      if (!shouldRetryWithLegacySecret(error) || !payload.secret_key?.trim()) {
        throw error;
      }

      const legacySecretPayload = await prepareLegacySecretPayload(payload.secret_key);
      if (!legacySecretPayload) {
        throw buildLegacyVersionMismatchError();
      }

      return request<OcrConfigItem>("/api/integration-management/ocr-config", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
};
