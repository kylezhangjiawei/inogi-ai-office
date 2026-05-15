import { authFetch, readErrorMessage } from "./authSession";

const RD_API_BASE = "/api/research-development";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(`${RD_API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "研发模块接口请求失败"));
  }
  return (await response.json()) as T;
}

export type RdWorkspacePayload<TTask = unknown, TSuggestion = unknown, TNotification = unknown> = {
  myTasks: TTask[];
  collabTasks: TTask[];
  todayTodos: Array<{ text: string; task_id?: string }>;
  aiSuggestions: TSuggestion[];
  notifications: TNotification[];
};

export type RdDirectorDashboardPayload<TCategory = unknown, TPerson = unknown, TBlocked = unknown, TPending = unknown> = {
  categoryProgress: TCategory[];
  personLoads: TPerson[];
  blockedTasks: TBlocked[];
  pendingAssign: TPending[];
};

export type RdAiSceneConfig = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  model_id: string;
  fallback_model_id: string;
  prompt_version: string;
  confidence_threshold: number;
  require_human_review: boolean;
  show_to_user: boolean;
};

export type RdAiFileRule = {
  id: string;
  label: string;
  extensions: string[];
  strategy: string;
  ai_after_parse: boolean;
  ocr_fallback: boolean;
  direct_ai: boolean;
};

export type RdAiSettingsPayload = {
  version: number;
  updated_at?: string;
  updated_by?: string;
  scenes: RdAiSceneConfig[];
  file_policy: {
    ocr_provider: string;
    ocr_service_key: string;
    ocr_confidence_threshold: number;
    low_confidence_action: string;
    allow_vision_fallback: boolean;
    save_original_text: boolean;
    save_ocr_text: boolean;
    save_ai_result: boolean;
    require_confirmation_before_write: boolean;
    rules: RdAiFileRule[];
  };
  disclosure: {
    show_provider: boolean;
    show_model: boolean;
    show_prompt_version: boolean;
    show_confidence: boolean;
    show_fallback: boolean;
    show_source_document: boolean;
  };
  runtime?: {
    ocr?: {
      provider: string;
      ready: boolean;
    };
    models?: Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      enabled: boolean;
      is_default_enabled?: boolean;
    }>;
  };
};

export function fetchRdTaskCategories<TCategory = unknown>() {
  return requestJson<TCategory[]>("/task-categories");
}

export function saveRdTaskCategories<TCategory>(payload: TCategory[]) {
  return requestJson<TCategory[]>("/task-categories", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchRdWorkspace<TPayload>() {
  return requestJson<TPayload>("/workspace");
}

export function fetchRdDirectorDashboard<TPayload>() {
  return requestJson<TPayload>("/director-dashboard");
}

export function fetchRdPeople<TPerson = unknown>() {
  return requestJson<TPerson[]>("/people");
}

export function createRdPerson<TPerson>(payload: TPerson) {
  return requestJson<TPerson>("/people", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRdPerson<TPerson extends { id: string }>(payload: TPerson) {
  return requestJson<TPerson>(`/people/${encodeURIComponent(payload.id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRdPerson(id: string) {
  return requestJson<{ ok: true }>(`/people/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchRdApprovalFlows<TFlow = unknown>() {
  return requestJson<TFlow[]>("/approval-flows");
}

export function saveRdApprovalFlows<TFlow>(payload: TFlow[]) {
  return requestJson<TFlow[]>("/approval-flows", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchRdAuditLogs<TLog = unknown>() {
  return requestJson<TLog[]>("/audit-logs");
}

export function createRdAuditLog<TLog>(payload: Omit<TLog, "id" | "timestamp"> | TLog) {
  return requestJson<TLog>("/audit-logs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function clearRdAuditLogs() {
  return requestJson<{ ok: true }>("/audit-logs", {
    method: "DELETE",
  });
}

export function fetchRdAiSettings() {
  return requestJson<RdAiSettingsPayload>("/ai-settings");
}

export function saveRdAiSettings(payload: RdAiSettingsPayload) {
  return requestJson<RdAiSettingsPayload>("/ai-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function planRdFileIngestion(files: Array<{ name: string; mime_type?: string; size?: number; has_text_layer?: boolean; text_length?: number }>) {
  return requestJson<unknown>("/file-ingestion/plan", {
    method: "POST",
    body: JSON.stringify({ files }),
  });
}
