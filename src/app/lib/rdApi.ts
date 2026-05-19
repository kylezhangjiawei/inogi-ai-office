import { authFetch, readErrorMessage } from "./authSession";

const RD_API_BASE = "/api/research-development";

/** Default per-request timeout for RD module. AI and file-upload calls override via `timeoutMs`. */
const RD_DEFAULT_TIMEOUT_MS = 30_000;
/** Longer timeout for AI inference / large file ingestion — must comfortably exceed server-side `OPENAI_TIMEOUT_MS` (120s). */
const RD_AI_TIMEOUT_MS = 180_000;

type RequestJsonOptions = RequestInit & { timeoutMs?: number };

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fallbackErrorMessage: string,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await authFetch(`${RD_API_BASE}${path}`, { ...rest, signal: controller.signal });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, fallbackErrorMessage));
    }
    return response;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || controller.signal.aborted)) {
      throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s），请检查网络或稍后再试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson<T>(path: string, init?: RequestJsonOptions): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const response = await fetchWithTimeout(
    path,
    rest,
    timeoutMs ?? RD_DEFAULT_TIMEOUT_MS,
    "研发模块接口请求失败",
  );
  return (await response.json()) as T;
}

// ── Shared enums ──────────────────────────────────────────────────────────────

/**
 * 研发任务标准状态枚举（权威定义）。
 * 所有模块（任务管理、个人工作台、研发主管看板）的持久化数据均以此为准。
 */
export type RdTaskStatus =
  | "draft"          // 草稿，尚未正式下达
  | "in_progress"    // 进行中
  | "pending_review" // 待审核（提交成果后等待确认）
  | "paused_leave"   // 暂停：负责人请假
  | "paused_blocked" // 暂停：依赖阻塞
  | "on_hold"        // 暂停：主动挂起
  | "completed"      // 已完成
  | "pending_assign" // 待指派
  | "archived";      // 已归档

export type RdPriority = "high" | "medium" | "low";

// ── Task / Category shapes ────────────────────────────────────────────────────

export type RdCollaborator = { id: string; name: string; role: string; user_id?: string | null };

export type RdTask = {
  task_id: string;
  title: string;
  description?: string;
  primary_owner: string;
  primary_owner_user_id?: string | null;
  collaborators: RdCollaborator[];
  status: RdTaskStatus;
  progress: number;
  ai_priority: RdPriority;
  final_priority: RdPriority;
  final_duration?: number;
  category_path: string;
  archived: boolean;
  attachments: number;
  due_date?: string;
  ai_modified?: boolean;
  subtasks?: RdTask[];
};

export type RdSubProject = { id: string; label: string; tasks: RdTask[] };
export type RdCategory = { id: string; label: string; children: RdSubProject[] };

// ── Workspace payload ─────────────────────────────────────────────────────────

export type RdTodayTodo = { text: string; task_id?: string };

export type RdWorkspaceTask = {
  task_id: string;
  title: string;
  priority: RdPriority;
  progress: number;
  due_date: string;
  status: RdTaskStatus;
  status_label: string;
  role: "primary" | "collaborator";
  category_path: string;
  owner: string;
  owner_user_id?: string | null;
  collab_role?: string;
  on_leave?: boolean;
  ai_pending?: boolean;
  description: string;
  next_action: string;
  deliverables: string[];
  blockers: string[];
  timeline: { label: string; time: string; state: "done" | "current" | "todo" }[];
};

export type RdAiSuggestion = {
  id: string;
  type: "task_create" | "summary";
  title: string;
  preview: string;
  confidence: number;
  source: string;
  generated_tasks: { title: string; owner: string; due: string; priority: RdPriority }[];
};

export type RdWorkspaceNotification = {
  id: string;
  type: "blocked" | "due_soon" | "pending_ai" | "transfer" | "message";
  title: string;
  message: string;
  time: string;
  related_task_id?: string;
  /** Present when type === "message" — sender info from rd.messages */
  sender_id?: string | null;
  sender_name?: string;
  sender_role?: string | null;
  read?: boolean;
  created_at?: string | null;
};

export type RdWorkspacePayload<
  TTask = RdWorkspaceTask,
  TSuggestion = RdAiSuggestion,
  TNotification = RdWorkspaceNotification,
> = {
  myTasks: TTask[];
  collabTasks: TTask[];
  todayTodos: RdTodayTodo[];
  aiSuggestions: TSuggestion[];
  notifications: TNotification[];
};

// ── Director dashboard payload ────────────────────────────────────────────────

export type RdCategoryProgress = {
  id: string;
  label: string;
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  color: string;
};

export type RdPersonLoad = {
  id: string;
  user_id?: string | null;
  name: string;
  position: string;
  task_count: number;
  max_tasks: number;
  on_leave?: boolean;
  tasks: string[];
  task_ids?: string[];
  email?: string;
  username?: string | null;
  user_status?: "ACTIVE" | "INVITED" | "DISABLED" | string | null;
  phone?: string;
  department?: string;
  joined_at?: string;
  completed_this_month?: number;
  blocked_count?: number;
  avg_completion?: number;
  recent_activities?: { date: string; action: string }[];
};

export type RdIdentityUser = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  department: string | null;
  status: "ACTIVE" | "INVITED" | "DISABLED" | string;
};

export type RdAiPersonContext = Pick<
  RdPersonLoad,
  | "id"
  | "user_id"
  | "name"
  | "position"
  | "task_count"
  | "max_tasks"
  | "on_leave"
  | "tasks"
  | "department"
  | "completed_this_month"
  | "blocked_count"
  | "avg_completion"
>;

export type RdBlockedTask = {
  task_id: string;
  title: string;
  owner: string;
  reason: string;
  days_blocked: number;
};

export type RdPendingAssignTask = {
  task_id: string;
  title: string;
  category_path: string;
  ai_priority: RdPriority;
};

export type RdDirectorDashboardPayload<
  TCategory = RdCategoryProgress,
  TPerson = RdPersonLoad,
  TBlocked = RdBlockedTask,
  TPending = RdPendingAssignTask,
> = {
  categoryProgress: TCategory[];
  personLoads: TPerson[];
  blockedTasks: TBlocked[];
  pendingAssign: TPending[];
};

// ── AI settings ───────────────────────────────────────────────────────────────

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
    ocr?: { provider: string; ready: boolean };
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

// ── File ingestion plan ───────────────────────────────────────────────────────

export type RdFileIngestionStep = {
  name: string;
  mime_type: string;
  extension: string;
  rule_id: string;
  rule_label: string;
  strategy: string;
  steps: string[];
  requires_ocr: boolean;
  requires_ai: boolean;
  direct_ai: boolean;
  requires_human_review: boolean;
  ocr_provider: string | null;
  ocr_service_key: string | null;
  ai_scene_id: string;
  model_id: string;
  fallback_model_id: string;
  prompt_version: string;
  confidence_threshold: number;
};

export type RdFileIngestionPlan = {
  policy: RdAiSettingsPayload["file_policy"];
  files: RdFileIngestionStep[];
};

// ── API functions ─────────────────────────────────────────────────────────────

export function fetchRdTaskCategories() {
  return requestJson<RdCategory[]>("/task-categories");
}

export function saveRdTaskCategories(payload: RdCategory[]) {
  return requestJson<RdCategory[]>("/task-categories", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function createRdTask(payload: {
  category_id?: string;
  sub_project_id?: string;
  title: string;
  primary_owner: string;
  primary_owner_user_id?: string | null;
  status?: RdTaskStatus;
  progress?: number;
  final_priority?: RdPriority;
  ai_priority?: RdPriority;
  due_date?: string;
  description?: string;
  category_path?: string;
}) {
  return requestJson<RdTask>("/task-categories/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRdTask(taskId: string, patch: Partial<Omit<RdTask, "task_id">>) {
  return requestJson<{ ok: true; task_id: string }>(
    `/task-categories/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function deleteRdTask(taskId: string) {
  return requestJson<{ ok: true }>(
    `/task-categories/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
  );
}

export function clearRdAllTaskData() {
  return requestJson<{ ok: true }>("/task-data", { method: "DELETE" });
}

export function fetchRdWorkspace() {
  return requestJson<RdWorkspacePayload>("/workspace");
}

export function saveRdWorkspace(payload: RdWorkspacePayload) {
  return requestJson<RdWorkspacePayload>("/workspace", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchRdDirectorDashboard() {
  return requestJson<RdDirectorDashboardPayload>("/director-dashboard");
}

export function recomputeRdDirectorDashboard() {
  return requestJson<{ ok: true }>("/director-dashboard/recompute", { method: "POST" });
}

export function saveRdDirectorDashboard(payload: RdDirectorDashboardPayload) {
  return requestJson<RdDirectorDashboardPayload>("/director-dashboard", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchRdPeople() {
  return requestJson<RdPersonLoad[]>("/people");
}

export function fetchRdPeopleUserOptions() {
  return requestJson<RdIdentityUser[]>("/people/user-options");
}

export function createRdPerson(payload: Omit<RdPersonLoad, "id">) {
  return requestJson<RdPersonLoad>("/people", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRdPerson(payload: RdPersonLoad) {
  return requestJson<RdPersonLoad>(`/people/${encodeURIComponent(payload.id)}`, {
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

export function fetchRdApprovalPools<TMember = unknown>(permissionCodes: string[]) {
  const params = new URLSearchParams();
  params.set("permissions", permissionCodes.join(","));
  return requestJson<Record<string, TMember[]>>(`/approval-pools?${params.toString()}`);
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
  return requestJson<RdFileIngestionPlan>("/file-ingestion/plan", {
    method: "POST",
    body: JSON.stringify({ files }),
  });
}

// ── AI: 立项任务抽取 ─────────────────────────────────────────────────────────

export type RdAiTaskDraft = {
  title: string;
  description?: string;
  owner: string;
  owner_reason: string;
  due_date: string;
  priority: "high" | "medium" | "low";
  category_path: string;
  estimated_days: number;
};

export type RdAiExtractResult = {
  tasks: RdAiTaskDraft[];
  suggested_category?: string;
  summary?: string;
  provider: "openai" | "qwen" | "local";
  model: string;
  raw_text_length: number;
  source: "text" | "file_text" | "file_ocr" | "file_doc_model";
};

export function extractRdTasksFromText(payload: {
  text: string;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  proposalTitle?: string;
}) {
  return requestJson<RdAiExtractResult>("/ai/extract-tasks", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: RD_AI_TIMEOUT_MS,
  });
}

export async function extractRdTasksFromFile(payload: {
  file: File;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  proposalTitle?: string;
}): Promise<RdAiExtractResult> {
  const form = new FormData();
  form.append("file", payload.file);
  if (payload.peopleNames) form.append("peopleNames", JSON.stringify(payload.peopleNames));
  if (payload.peopleProfiles) form.append("peopleProfiles", JSON.stringify(payload.peopleProfiles));
  if (payload.categoryLabels) form.append("categoryLabels", JSON.stringify(payload.categoryLabels));
  if (payload.proposalTitle) form.append("proposalTitle", payload.proposalTitle);

  const response = await fetchWithTimeout(
    "/ai/extract-from-file",
    { method: "POST", body: form },
    RD_AI_TIMEOUT_MS,
    "AI 文件解析失败",
  );
  return (await response.json()) as RdAiExtractResult;
}

// ── AI: 任务进度判断 ─────────────────────────────────────────────────────────

export type RdAiProgressAssessment = {
  progress: number;
  stage: string;
  confidence: number;
  basis: string[];
  recommendation: string;
  provider: "openai" | "qwen" | "local";
  model: string;
  source: "text" | "file_text" | "file_ocr" | "file_doc_model";
  raw_text_length: number;
};

export async function assessRdTaskProgress(payload: {
  file?: File;
  text?: string;
  task: {
    task_id?: string;
    title: string;
    description?: string;
    category_path?: string;
    current_progress?: number;
    current_status?: string;
  };
}): Promise<RdAiProgressAssessment> {
  const form = new FormData();
  if (payload.file) form.append("file", payload.file);
  if (payload.text) form.append("text", payload.text);
  if (payload.task.task_id) form.append("task_id", payload.task.task_id);
  form.append("title", payload.task.title);
  if (payload.task.description) form.append("description", payload.task.description);
  if (payload.task.category_path) form.append("category_path", payload.task.category_path);
  if (typeof payload.task.current_progress === "number") {
    form.append("current_progress", String(payload.task.current_progress));
  }
  if (payload.task.current_status) form.append("current_status", payload.task.current_status);

  const response = await fetchWithTimeout(
    "/ai/assess-progress",
    { method: "POST", body: form },
    RD_AI_TIMEOUT_MS,
    "AI 进度判断失败",
  );
  return (await response.json()) as RdAiProgressAssessment;
}

// ── 任务进度记录（文本+附件） ────────────────────────────────────────────────

export type RdTaskProgressAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  data_url: string;
};

export type RdTaskProgressNote = {
  id: string;
  task_id: string;
  text: string;
  progress?: number;
  attachments: RdTaskProgressAttachment[];
  actor: { id: string | null; name: string; role: string };
  created_at: string;
};

export function fetchRdTaskProgressNotes(taskId: string) {
  return requestJson<RdTaskProgressNote[]>(`/task-progress-notes/${encodeURIComponent(taskId)}`);
}

export async function createRdTaskProgressNote(payload: {
  task_id: string;
  text: string;
  progress?: number;
  files?: File[];
}): Promise<RdTaskProgressNote> {
  const form = new FormData();
  form.append("task_id", payload.task_id);
  form.append("text", payload.text);
  if (typeof payload.progress === "number") form.append("progress", String(payload.progress));
  (payload.files ?? []).forEach((file) => form.append("files", file));

  const response = await fetchWithTimeout(
    "/task-progress-notes",
    { method: "POST", body: form },
    60_000,
    "进度记录保存失败",
  );
  return (await response.json()) as RdTaskProgressNote;
}

// ── 每日工作日报 ─────────────────────────────────────────────────────────────

export type RdDailyReportNoteRef = {
  note_id: string;
  task_id: string;
  progress: number | null;
  excerpt: string;
  attachments_count: number;
};

export type RdDailyReport = {
  id: string;
  user_id: string | null;
  user_name: string;
  date: string;
  trigger: "manual" | "cron";
  summary: {
    text: string;
    stats: {
      total_tasks: number;
      in_progress: number;
      completed: number;
      blocked: number;
      pending: number;
      notes_count: number;
    };
    note_refs: RdDailyReportNoteRef[];
  };
  created_at: string;
};

export function fetchRdDailyReports(filters?: { user_id?: string; date?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.user_id) params.set("user_id", filters.user_id);
  if (filters?.date) params.set("date", filters.date);
  if (typeof filters?.limit === "number") params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestJson<RdDailyReport[]>(`/daily-reports${qs ? `?${qs}` : ""}`);
}

export function createRdDailyReport(payload: { user_id?: string; user_name?: string; date?: string }) {
  return requestJson<RdDailyReport>("/daily-reports", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function regenerateAllRdDailyReports(date?: string) {
  return requestJson<{ date: string; count: number }>("/daily-reports/regenerate-all", {
    method: "POST",
    body: JSON.stringify({ date }),
    timeoutMs: 90_000,
  });
}

// ── 站内消息 ────────────────────────────────────────────────────────────────

export type RdMessage = {
  id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string | null;
  recipient_id: string | null;
  recipient_person_id: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  read: boolean;
  created_at: string;
};

export function fetchRdMessages(filters?: { recipient_id?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.recipient_id) params.set("recipient_id", filters.recipient_id);
  if (typeof filters?.limit === "number") params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestJson<RdMessage[]>(`/messages${qs ? `?${qs}` : ""}`);
}

export function sendRdMessage(payload: {
  recipient_id?: string | null;
  recipient_person_id?: string | null;
  recipient_name?: string | null;
  subject?: string;
  body: string;
}) {
  return requestJson<RdMessage>("/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── AI 立项草稿 ─────────────────────────────────────────────────────────────

export type RdProposalDraft = {
  id: string;
  title: string;
  description: string | null;
  comment: string | null;
  parent_project_id: string | null;
  new_project_name: string | null;
  tasks: unknown[];
  file_names: string[];
  author: { id: string | null; name: string; role: string | null };
  created_at: string;
  updated_at: string;
};

export function fetchRdProposalDrafts() {
  return requestJson<RdProposalDraft[]>("/proposal-drafts");
}

export function saveRdProposalDraft(payload: {
  draft_id?: string;
  title?: string;
  description?: string;
  comment?: string;
  parent_project_id?: string;
  new_project_name?: string;
  tasks?: unknown[];
  file_names?: string[];
}) {
  return requestJson<RdProposalDraft>("/proposal-drafts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteRdProposalDraft(draftId: string) {
  return requestJson<{ ok: true }>(`/proposal-drafts/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
  });
}
