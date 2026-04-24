import { authFetch, readErrorMessage } from "./authSession";

export type Decision = "recommend" | "hold" | "reject";

export interface JobRule {
  id: string;
  name: string;
  jd_text: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SaveJobRulePayload {
  id?: string;
  name?: string;
  jd_text: string;
  enabled: boolean;
}

export interface MailSyncRunResult {
  scanned_count?: number;
  matched_count?: number;
  processed: number;
  created_candidates: number;
  skipped: number;
  failed: number;
  queued_for_ai?: number;
  latest_uid?: number | null;
  job_rule_id?: string | null;
  mail_config_id?: string | null;
  openai_config_id?: string | null;
  actual_screening_model?: string | null;
  message: string;
  mail_previews?: Array<{
    unique_key?: string;
    candidate_id?: string;
    subject: string;
    sender_name: string;
    sender_email: string;
    received_at: string;
    preview: string;
    candidate_name: string;
    status: string;
    error_message?: string;
  }>;
}

export interface ResumeUploadRunResult {
  uploaded_count: number;
  processed: number;
  created_candidates: number;
  skipped: number;
  failed: number;
  queued_for_ai?: number;
  job_rule_id?: string | null;
  openai_config_id?: string | null;
  actual_extract_model?: string | null;
  actual_screening_model?: string | null;
  file_previews?: Array<{
    unique_key?: string;
    candidate_id?: string;
    file_name: string;
    file_type: string;
    received_at: string;
    preview: string;
    candidate_name: string;
    status: string;
    error_message?: string;
  }>;
  message: string;
}

export interface ResumeUploadStatusItem {
  unique_key: string;
  candidate_id?: string | null;
  status: string;
  error_message?: string;
}

export interface CandidateListItem {
  id: string;
  unique_key?: string | null;
  job_rule_id?: string | null;
  job_rule_name?: string | null;
  name: string;
  email: string;
  phone: string;
  gender: string;
  birth_or_age: string;
  city: string;
  hukou: string;
  education: string;
  status: string;
  target_job: string;
  ai_job?: string | null;
  received_at: string;
  source_subject: string;
  source_sender_email?: string | null;
  avatar_url?: string | null;
  score?: number | null;
  decision?: Decision | null;
  summary?: string | null;
  next_step?: boolean | null;
  active_screening_status?: string | null;
  screening_status?: string | null;
  screening_error_message?: string | null;
}

export interface CandidateProfile {
  name: string;
  gender: string;
  birth_or_age: string;
  education: string;
  status: string;
  city: string;
  hukou: string;
  target_job: string;
  target_city: string;
  salary_expectation: string;
  recent_company: string;
  recent_title: string;
  years_experience: string;
  work_summary: string;
  language_skills: string[];
  email: string;
  phone: string;
  raw_text: string;
  avatar_url?: string | null;
}

export interface InterviewQaItem {
  question: string;
  answer: string;
}

export interface CandidateScreeningHistory {
  id: string;
  ai_job?: string | null;
  score?: number | null;
  decision?: Decision | null;
  matched_points: string[];
  risks: string[];
  summary?: string | null;
  next_step?: boolean | null;
  status: string;
  error_message?: string | null;
  model_name: string;
  prompt_version: string;
  created_at: string;
  duration_ms?: number | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
}

export interface CandidateDetail {
  id: string;
  unique_key?: string | null;
  job_rule_id?: string | null;
  job_rule_name?: string | null;
  source_subject: string;
  source_sender_name: string;
  source_sender_email: string;
  received_at: string;
  raw_email_text: string;
  parsed_candidate_profile: CandidateProfile;
  interview_qa?: InterviewQaItem[];
  active_screening?: CandidateScreeningHistory | null;
  screenings: CandidateScreeningHistory[];
}

export interface ClearCandidatesResponse {
  deleted_candidates: number;
  deleted_screenings: number;
  deleted_logs: number;
}

export interface HealthResponse {
  ok: boolean;
  mail_configured: boolean;
  openai_configured: boolean;
  database_path: string;
}

export interface MailConfigItem {
  id: string;
  kind: "mail";
  name: string;
  email: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface OpenAiConfigItem {
  id: string;
  kind: "openai";
  provider: "openai";
  name: string;
  model: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SaveMailConfigPayload {
  id?: string;
  email: string;
  password?: string;
  enabled: boolean;
}

export interface SaveOpenAiConfigPayload {
  id?: string;
  name: string;
  model: string;
  api_key?: string;
  enabled: boolean;
}

export interface MailSyncSchedule {
  enabled: boolean;
  run_at: string;
  since_hours: number;
  limit: number;
  job_rule_id?: string | null;
  mail_config_id?: string | null;
  openai_config_id?: string | null;
  last_run_at?: string | null;
  last_run_result?: string | null;
}

export interface SaveMailSyncSchedulePayload {
  enabled: boolean;
  run_at: string;
  since_hours: number;
  limit: number;
  job_rule_id?: string | null;
  mail_config_id?: string | null;
  openai_config_id?: string | null;
}

type SecurityPublicKeyResponse = {
  algorithm: "RSA-OAEP";
  public_key: string;
};

const API_BASE = (import.meta.env.VITE_RECRUITMENT_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const LEGACY_PLAIN_SECRET_ERROR = "plain_secret should not exist";
let cachedPublicKey: Promise<CryptoKey> | null = null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormDataRequest = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await authFetch(`${API_BASE}${path}`, {
    headers: {
      ...(isFormDataRequest ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `请求失败：${response.status}`));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function prepareSecretPayload(value?: string) {
  const normalized = value?.trim();
  if (!normalized) {
    return {};
  }

  return { plain_secret: normalized };
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
  const response = await request<SecurityPublicKeyResponse>("/api/recruitment/security/public-key");
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

export const recruitmentApi = {
  getHealth() {
    return request<HealthResponse>("/api/recruitment/health");
  },
  listMailConfigs() {
    return request<MailConfigItem[]>("/api/recruitment/integrations/mail");
  },
  async saveMailConfig(payload: SaveMailConfigPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
      id: payload.id,
      email: payload.email,
      enabled: payload.enabled,
      ...secretPayload,
    });

    try {
      return await request<MailConfigItem>("/api/recruitment/integrations/mail", {
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

      return request<MailConfigItem>("/api/recruitment/integrations/mail", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
  listOpenAiConfigs() {
    return request<OpenAiConfigItem[]>("/api/recruitment/integrations/openai");
  },
  async saveOpenAiConfig(payload: SaveOpenAiConfigPayload) {
    const buildBody = (secretPayload: Record<string, string>) => ({
        id: payload.id,
        name: payload.name,
        model: payload.model,
        enabled: payload.enabled,
        ...secretPayload,
    });

    try {
      return await request<OpenAiConfigItem>("/api/recruitment/integrations/openai", {
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

      return request<OpenAiConfigItem>("/api/recruitment/integrations/openai", {
        method: "POST",
        body: JSON.stringify(buildBody(legacySecretPayload)),
      });
    }
  },
  deleteIntegrationConfig(configId: string) {
    return request<{ id: string }>(`/api/recruitment/integrations/${configId}`, {
      method: "DELETE",
    });
  },
  listJobRules() {
    return request<JobRule[]>("/api/recruitment/job-rules");
  },
  saveJobRule(payload: SaveJobRulePayload) {
    return request<JobRule>("/api/recruitment/job-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  deleteJobRule(jobRuleId: string) {
    return request<{ id: string }>(`/api/recruitment/job-rules/${jobRuleId}`, {
      method: "DELETE",
    });
  },
  runMailSync(payload: { job_rule_id?: string; mail_config_id?: string; openai_config_id?: string; ignore_last_uid?: boolean; since_hours: number; limit: number }) {
    return request<MailSyncRunResult>("/api/recruitment/mail-sync/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getMailSyncSchedule() {
    return request<MailSyncSchedule>("/api/recruitment/mail-sync/schedule");
  },
  saveMailSyncSchedule(payload: SaveMailSyncSchedulePayload) {
    return request<MailSyncSchedule>("/api/recruitment/mail-sync/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  uploadResumeFiles(payload: FormData) {
    return request<ResumeUploadRunResult>("/api/recruitment/resume-upload/run", {
      method: "POST",
      body: payload,
    });
  },
  getResumeUploadStatuses(uniqueKeys: string[]) {
    return request<ResumeUploadStatusItem[]>("/api/recruitment/resume-upload/statuses", {
      method: "POST",
      body: JSON.stringify({ unique_keys: uniqueKeys }),
    });
  },
  listCandidates(filters: { keyword?: string; decision?: Decision | ""; minScore?: number; jobRuleId?: string | "" }) {
    const params = new URLSearchParams();
    if (typeof filters.keyword === "string" && filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.decision) params.set("decision", filters.decision);
    if (typeof filters.minScore === "number") params.set("min_score", String(filters.minScore));
    if (typeof filters.jobRuleId === "string" && filters.jobRuleId) params.set("job_rule_id", String(filters.jobRuleId));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<CandidateListItem[]>(`/api/recruitment/candidates${suffix}`);
  },
  clearCandidates() {
    return request<ClearCandidatesResponse>("/api/recruitment/candidates", {
      method: "DELETE",
    });
  },
  getCandidateDetail(candidateId: string) {
    return request<CandidateDetail>(`/api/recruitment/candidates/${candidateId}`);
  },
};
