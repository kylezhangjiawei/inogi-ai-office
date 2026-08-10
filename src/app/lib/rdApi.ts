import { authFetch, readErrorMessage } from "./authSession";
import { buildRdTaskAttachmentPayload } from "./rdAttachmentPayload";
import { compressImageFile } from "./resourceImage";

export { buildRdTaskAttachmentPayload } from "./rdAttachmentPayload";

const RD_API_BASE = "/api/research-development";

/** Default per-request timeout for RD module. AI and file-upload calls override via `timeoutMs`. */
const RD_DEFAULT_TIMEOUT_MS = 30_000;
/** Longer timeout for AI inference / large file ingestion — must exceed server-side `RD_EXTRACT_TIMEOUT_MS` (300s). */
const RD_AI_TIMEOUT_MS = 360_000;
/** 全量任务归纳采用后台任务；覆盖 200+ 任务的多批分析与跨批汇总。 */
const RD_AI_JOB_TIMEOUT_MS = 20 * 60_000;
/**
 * The high-fidelity workbook can contain base64-encoded images and exceed 30 MB.
 * On a typical remote connection its transfer alone can take longer than the
 * default 30-second RD request timeout.
 */
const RD_SHEET_WORKBOOK_TIMEOUT_MS = 180_000;

type RequestJsonOptions = RequestInit & { timeoutMs?: number };

/** 研发接口错误：message 为服务端可读文案，status 为 HTTP 状态码（网络层失败时为 undefined）。 */
export type RdApiError = Error & { status?: number };

/**
 * 任务工作区：中美协同路由（/us-collab-*）下所有研发接口自动带 ?workspace=us-collab，
 * 后端据此切换到独立的协同任务池（任务/人员/审批流/AI 策略/留痕与研发池完全隔离）。
 * 研发原路由不带参数 → 默认研发池，行为不变。
 */
/** 当前是否处于中美协同工作区（/us-collab-* 路由）。协同专属 UI（AI 小结/导出报告/阻塞天数等）据此条件渲染，避免波及其他驾驶舱。 */
export function isUsCollabWorkspace(): boolean {
  return currentRdWorkspace() === "us-collab";
}

/** 当前是否处于生产驾驶舱及其任务详情页。 */
export function isProductionWorkspace(): boolean {
  return currentRdWorkspace() === "production";
}

/**
 * 工作项功能开关：控制「工作项区块 / 留痕分 Tab / 卡片完成度徽标 / 留痕关联下拉 / AI 归属预选」
 * 的所有 UI 入口。当前仅中美协同模块启用；其他模块需要时改这一个函数即可放开
 * （return true 全模块启用）。数据层无需迁移：隐藏期间已有的 work_items 字段与
 * 带标签的留痕原样保留，重新放开即恢复展示。
 */
export function workItemsFeatureEnabled(): boolean {
  return isUsCollabWorkspace();
}

export function currentRdWorkspace(): "us-collab" | "production" | null {
  if (typeof window === "undefined") return null;
  if (window.location.pathname.startsWith("/us-collab")) return "us-collab";
  if (window.location.pathname.startsWith("/production-")) return "production";
  return null;
}

function withWorkspace(path: string): string {
  const workspace = currentRdWorkspace();
  if (!workspace) return path;
  return `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspace)}`;
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fallbackErrorMessage: string,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  try {
    const response = await authFetch(`${RD_API_BASE}${withWorkspace(path)}`, { ...rest, signal: controller.signal });
    if (!response.ok) {
      // 附带 HTTP 状态码：调用方据此区分「可重试的网络/网关错误」与「业务拒绝」（如 409 保存冲突）
      const error: RdApiError = new Error(await readErrorMessage(response, fallbackErrorMessage));
      error.status = response.status;
      throw error;
    }
    return response;
  } catch (err) {
    if (timedOut) {
      throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s），请检查网络或稍后再试`);
    }
    if (err instanceof TypeError) {
      throw new Error(`${fallbackErrorMessage}：网络连接中断，请确认服务可用后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
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

export type RdLatestProgressSummary = {
  text: string;
  progress: number | null;
  actor_name: string;
  actor_user_id?: string | null;
  created_at: string;
  attachments_count: number;
};

export type RdTask = {
  task_id: string;
  /** 聚合视图中的任务来源；普通单池接口可缺省为当前工作区。 */
  source_workspace?: "rd" | "us-collab";
  title: string;
  description?: string;
  primary_owner: string;
  primary_owner_user_id?: string | null;
  collaborators: RdCollaborator[];
  pending_review_type?: "collaboration" | "result" | "proposal" | "due_date" | "abandon" | string | null;
  /** 进入"待审核"的时间戳（方案B 逾期判定）：与 due_date 比较，判断申请者是否逾期提交。 */
  submitted_for_review_at?: string | null;
  pending_collaborators?: RdCollaborator[];
  pending_collaboration_reason?: string | null;
  pending_collaboration_requested_at?: string | null;
  /** 待审核的截止日期变更：申请值 + 原因 + 提交时间。审核通过后才写入 due_date。 */
  pending_due_date?: string | null;
  pending_due_date_reason?: string | null;
  pending_due_date_requested_at?: string | null;
  /** 待审核的放弃申请：原因 + 提交时间。审核通过后任务被移除（等同删除）。 */
  pending_abandon_reason?: string | null;
  pending_abandon_requested_at?: string | null;
  /** 待审核的合并申请：目标任务 / 原因 / 发起人（审核通过后本任务并入目标并归档）。 */
  pending_merge_target?: string | null;
  pending_merge_reason?: string | null;
  pending_merge_requested_at?: string | null;
  pending_merge_requested_by?: string | null;
  pending_merge_requested_by_id?: string | null;
  /** 合并结果：本任务已并入的目标任务 id（源任务归档后带此指针）。 */
  merged_into?: string | null;
  merged_at?: string | null;
  /** 目标任务累积并入的源任务 id 列表。 */
  merged_from?: string[];
  status: RdTaskStatus;
  progress: number;
  ai_priority: RdPriority;
  final_priority: RdPriority;
  final_duration?: number;
  category_path: string;
  archived: boolean;
  attachments: number;
  start_date?: string;
  due_date?: string;
  ai_modified?: boolean;
  latest_progress_summary?: RdLatestProgressSummary | null;
  subtasks?: RdTask[];
  /**
   * 子任务树标记。父任务侧仍以递归 subtasks 数组为结构事实源；这些字段用于展示直接父子关系：
   * - parent_task_id：所属父任务（顶层任务为 null / 缺省）
   * - subtask_origin：'created' 在父任务下直建 | 'attached' 由已有任务挂载进来
   * - subtask_attached_*：挂载留痕（仅 attached 有值）
   * ⚠️ 存量子任务没有这些字段，判断"是不是子任务"须以结构（父任务的 subtasks）为准。
   */
  parent_task_id?: string | null;
  subtask_origin?: "created" | "attached" | null;
  subtask_attached_at?: string | null;
  subtask_attached_by?: string | null;
  subtask_attached_by_id?: string | null;
  /** 任务内部的轻量工作项清单（见 RdWorkItem）：随任务对象持久化，全系统统计对其零感知。 */
  work_items?: RdWorkItem[];
  /** 进入 paused_blocked 的时间点（离开时清除），协同模块显示"已阻塞 N 天"。 */
  blocked_since?: string | null;
  /** 兼容旧任务数据中的阻塞说明与风险标记。 */
  blocked_reason?: string | null;
  risk_flag?: boolean;
  updated_at?: string;
  /** 后端派生：max(updated_at, 最新进度留痕时间)。排序与「最近更新」显示共用此口径，避免逆序。 */
  last_activity_at?: string;
  /** 后端派生（仅读取时计算）：进度留痕里的图片附件 URL，按留痕时间倒序、上限 6 张，供移动端流式卡片做封面缩略图。 */
  cover_images?: string[];
  /** 与 cover_images 一一对应的 480px WebP；卡片只加载此数组，点开预览后再加载原图。 */
  cover_image_thumbnails?: string[];
  /** 后端派生（仅读取时计算）：已完成任务的 AI 复盘评分摘要（总分 + 等级）。 */
  completion_score?: { total: number; grade: string } | null;
  /** 生产工作区中的研发同步镜像。存在时前后端均强制只读。 */
  production_sync?: {
    source_workspace: "rd";
    source_task_id: string;
    root_source_task_id: string;
    synced_at: string;
    read_only: true;
  } | null;
};

export function isProductionMirrorTask(task: Pick<RdTask, "production_sync"> | null | undefined): boolean {
  return task?.production_sync?.source_workspace === "rd" && task.production_sync.read_only === true;
}

export type RdSubProject = { id: string; label: string; tasks: RdTask[] };
export type RdCategory = { id: string; label: string; children: RdSubProject[] };

// ── Products (产品线) ──────────────────────────────────────────────────────────

export type RdProductStatus = 'active' | 'developing' | 'paused' | 'archived';

export type RdProductDef = {
  id: string;
  name: string;
  description?: string;
  status?: RdProductStatus;
  createdAt: string;
  updatedAt: string;
};

export function fetchRdProducts() {
  return requestJson<RdProductDef[]>('/products');
}

export function saveRdProducts(products: RdProductDef[]) {
  return requestJson<{ ok: boolean }>('/products', {
    method: 'PUT',
    body: JSON.stringify(products),
  });
}

export function fetchProductTaskCategories(productId: string) {
  return requestJson<RdCategory[]>(`/product-task-categories/${encodeURIComponent(productId)}`)
    .then(normalizeArchivedFlags);
}

export function saveProductTaskCategories(productId: string, categories: RdCategory[]) {
  return requestJson<{ ok: boolean }>(`/product-task-categories/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: JSON.stringify(categories),
  });
}

/** 为普通立项安全地补一个空分类容器；服务端不会接收或覆盖任何任务数据。 */
export function ensureRdProposalTarget(
  productId: string,
  categoryLabel: string,
  subProjectLabel = "立项任务",
) {
  return requestJson<{ category_id: string; sub_project_id: string }>("/task-categories/proposal-target", {
    method: "POST",
    body: JSON.stringify({
      product_id: productId,
      category_label: categoryLabel,
      sub_project_label: subProjectLabel,
    }),
  });
}

// ── Workspace payload ─────────────────────────────────────────────────────────

export type RdTodayTodo = { text: string; task_id?: string };

/** 个人工作台的子任务清单条目：只带展示所需字段，不是完整任务对象。 */
export type RdWorkspaceSubtask = {
  task_id: string;
  title: string;
  status: RdTaskStatus;
  status_label: string;
  progress: number;
  owner: string;
  owner_user_id?: string | null;
  subtask_origin?: "created" | "attached" | null;
};

export type RdWorkspaceTask = {
  task_id: string;
  /** 个人工作台聚合研发与协同任务时标记真实数据源，点击后据此进入正确详情页。 */
  source_workspace?: "rd" | "us-collab";
  title: string;
  priority: RdPriority;
  progress: number;
  /** 立项时间（任务创建时刻，ISO），个人工作台排序首选键；存量旧任务可能为空。 */
  created_at?: string;
  /** 立项时设置的开始日期（YYYY-MM-DD），排序兜底键；旧数据可能为空。 */
  start_date?: string;
  due_date: string;
  status: RdTaskStatus;
  status_label: string;
  role: "primary" | "collaborator";
  /** 服务端按真实父子结构计算，根任务为 1；不受当前用户筛选造成的视觉提升影响。 */
  tree_depth?: number;
  category_path: string;
  /** 稳定类目身份：分组使用 id/key，名称只负责展示，避免类目改名后分组漂移。 */
  category_id?: string | null;
  category_key?: string | null;
  category_label?: string | null;
  sub_project_id?: string | null;
  sub_project_label?: string | null;
  owner: string;
  owner_user_id?: string | null;
  collaborators?: RdCollaborator[];
  pending_review_type?: "collaboration" | "result" | "proposal" | "due_date" | "abandon" | string | null;
  /** 进入"待审核"的时间戳（方案B 逾期判定）。 */
  submitted_for_review_at?: string | null;
  pending_collaborators?: RdCollaborator[];
  pending_collaboration_reason?: string | null;
  pending_due_date?: string | null;
  pending_due_date_reason?: string | null;
  pending_due_date_requested_at?: string | null;
  pending_abandon_reason?: string | null;
  pending_abandon_requested_at?: string | null;
  collab_role?: string;
  on_leave?: boolean;
  ai_pending?: boolean;
  /** 任务全部留痕附件数量；个人工作台卡片只加载少量预览，不在列表接口内下发附件正文。 */
  attachments?: number;
  latest_progress_summary?: RdLatestProgressSummary | null;
  /** 已完成任务的 AI 完成评分摘要；聚合接口原样透传，不参与分组计算。 */
  completion_score?: { total: number; grade: string } | null;
  /** 工作项清单（任务内部轻量拆分），留痕表单据此提供「关联工作项」选择。 */
  work_items?: RdWorkItem[];
  /**
   * 子任务树关系。服务端按「结构位置」解析直接父任务后下发，不是回读 parent_task_id 字段——
   * 存量子任务没有该字段。parent_task_id 非空即表示本任务是某个任务的子任务。
   */
  parent_task_id?: string | null;
  parent_title?: string | null;
  /** 'created' 在父任务下直建 | 'attached' 由已有任务并入；存量子任务为 null（渲染中性徽标）。 */
  subtask_origin?: "created" | "attached" | null;
  subtask_attached_at?: string | null;
  subtask_attached_by?: string | null;
  /** 是否带直接子任务（含已归档）；用于工作台展示任务树摘要。 */
  has_subtasks?: boolean;
  /** 本任务的子任务清单（本任务是父任务时非空），已排除归档项，仅供展示。 */
  subtasks?: RdWorkspaceSubtask[];
  /** 进入 paused_blocked 的时间点（离开时清除），协同工作台显示"已阻塞 N 天"。 */
  blocked_since?: string | null;
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
  /** Whether the message has been approved/rejected (review handled) */
  handled?: boolean;
  /** Full raw body string — present for inbox messages so the UI can parse JSON review requests */
  raw_body?: string;
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
  status?: "active" | "on_leave" | "resigned" | string;
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
  /** KB 知识库访问分值：0（公开）~ 100（最高权限）。成员分值 >= 文件分值时可见。 */
  kb_level?: number;
  kb_level_scale?: "score" | string;
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
      /** 显式用途类型：text | multimodal | image | auto */
      usage_kind?: string;
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

/**
 * 任务树读取归一：把「只有 status==='archived'、却没有 archived 标志」的任务补齐标志位。
 *
 * 后端判归档是 `archived === true || status === 'archived'`（isArchivedTask），而前端有 60+ 处
 * 直接读 `t.archived`。逐个改成复合判断既啰嗦又必然漏改，所以在唯一的数据入口归一一次，
 * 下游所有判断自动与后端对齐。子任务同样递归处理。
 *
 * ⚠️ 副作用：若某处把读到的树原样 PUT 回去（saveRdTaskCategories），补齐的标志位会被持久化。
 * 这只是把本就为真的事实写实，幂等且无害，但需知晓。
 */
function normalizeArchivedFlags(categories: RdCategory[]): RdCategory[] {
  let touched = false;
  const fixTask = (task: RdTask): RdTask => {
    let subtasks = task.subtasks;
    if (task.subtasks?.length) {
      const mapped = task.subtasks.map(fixTask);
      // ⚠️ map 一定产生新数组，必须逐项比对才知道是否真的变了；
      //    直接用 `mapped !== task.subtasks` 会让每个带子任务的任务都被判定为已变更，
      //    引用稳定性优化随之失效（每次拉取都返回全新对象，打断上游 useMemo）。
      if (mapped.some((sub, i) => sub !== task.subtasks![i])) subtasks = mapped;
    }
    const needsFlag = task.status === "archived" && task.archived !== true;
    if (!needsFlag && subtasks === task.subtasks) return task;
    touched = true;
    return { ...task, ...(needsFlag ? { archived: true } : {}), ...(subtasks ? { subtasks } : {}) };
  };
  const next = categories.map((cat) => ({
    ...cat,
    children: cat.children.map((sub) => ({ ...sub, tasks: sub.tasks.map(fixTask) })),
  }));
  // 无脏数据时返回原引用，避免每次读取都产生新对象、打断上游 useMemo 的引用相等优化
  return touched ? next : categories;
}

export function fetchRdTaskCategories(options: { includeCovers?: boolean; signal?: AbortSignal } = {}) {
  return requestJson<RdCategory[]>(
    `/task-categories${options.includeCovers ? "?include_covers=1" : ""}`,
    options.signal ? { signal: options.signal } : undefined,
  ).then(normalizeArchivedFlags);
}

/** 主库 + 所有产品库合并的分类树。用于驾驶舱概览「人员任务」跨产品聚合（与个人工作台主责同源）。 */
export function fetchMergedTaskCategories() {
  return requestJson<RdCategory[]>("/merged-task-categories").then(normalizeArchivedFlags);
}

export function saveRdTaskCategories(payload: RdCategory[]) {
  return requestJson<RdCategory[]>("/task-categories", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ── 研发数据表（类 WPS 表格 · 行级密级管控）──────────────────────────────────
// 后端按 viewer 的 kb_level 行级裁剪：低分值的人只拿到密级 <= 自己的行，且密级列
// 整列对其隐藏（headers 里不含该列）。编辑者（rd-sheet:edit / 超管）拿全量。

/** 研发数据表整簿快照（Univer IWorkbookData，前端 opaque 透传；图片以 base64 内嵌其中）。 */
export type RdSheetWorkbook = {
  snapshot: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
};

/** 保存成功只返回元数据，避免将几十 MB 的快照再次下载一遍。 */
export type RdSheetWorkbookSaveResult = {
  updated_at: string;
  updated_by: string | null;
};

/** 读取整簿快照（page:rd-sheet 只读 / rd-sheet:edit 可编辑，均拿全量；已无行级密级）。 */
export function fetchRdSheetWorkbook(signal?: AbortSignal) {
  return requestJson<RdSheetWorkbook>("/sheet-workbook", {
    signal,
    timeoutMs: RD_SHEET_WORKBOOK_TIMEOUT_MS,
  });
}

/**
 * 保存整簿快照（仅 rd-sheet:edit / 超管）。
 * baseUpdatedAt：乐观锁基线（加载/上次保存时的 updated_at）；服务器版本不一致时返回 409，
 * 防止多人编辑时后保存者无声覆盖先保存者。force=true 显式覆盖。
 */
export function saveRdSheetWorkbook(
  snapshot: unknown,
  opts?: { baseUpdatedAt?: string | null; force?: boolean },
) {
  return requestJson<RdSheetWorkbookSaveResult>("/sheet-workbook", {
    method: "PUT",
    body: JSON.stringify({
      snapshot,
      base_updated_at: opts?.baseUpdatedAt ?? null,
      force: !!opts?.force,
    }),
    timeoutMs: RD_SHEET_WORKBOOK_TIMEOUT_MS,
  });
}

/**
 * 上传数据表图片资产（图片出仓）：返回可长期使用的同源资产 URL（HMAC 能力链接）。
 * url=null 表示未上传成功（reason=oss_disabled 时 OSS 未配置，调用方应停止后续上传）。
 */
export async function uploadRdSheetAsset(
  blob: Blob,
  filename: string,
  mime?: string,
): Promise<{ url: string | null; reason?: string }> {
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: mime || blob.type || "image/png" }));
  const response = await fetchWithTimeout(
    "/sheet-workbook/assets",
    { method: "POST", body: form },
    120_000,
    "图片资产上传失败",
  );
  return (await response.json()) as { url: string | null; reason?: string };
}

/** 历史版本元数据（服务器每次保存自动留档，最多保留最近 10 版）。 */
export type RdSheetVersionMeta = {
  id: string;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  size_bytes: number;
};

export function fetchRdSheetVersions() {
  return requestJson<RdSheetVersionMeta[]>("/sheet-workbook/versions");
}

/** 恢复到某个历史版本（当前版本会先入历史，可再次恢复回来）。 */
export function restoreRdSheetVersion(id: string) {
  return requestJson<RdSheetWorkbookSaveResult>("/sheet-workbook/versions/restore", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export type RdSheetExtractAssetsResult = {
  total: number;
  converted: number;
  failed: number;
  size_before: number;
  size_after: number;
};

/**
 * 服务端「存量快照图片出仓」：把当前已存储快照里的 base64 图片迁移到 OSS（管理员一次性操作）。
 * 上线后调用一次即可让旧数据立刻瘦身，不必等编辑者重新保存。
 */
export function extractRdSheetAssets() {
  return requestJson<RdSheetExtractAssetsResult>("/sheet-workbook/extract-assets", {
    method: "POST",
    timeoutMs: RD_AI_TIMEOUT_MS,
  });
}

export type RdMoveTasksResult = {
  ok: true;
  movedCount: number;
  /** 主产品移动后的最新分类树（含进度计数），用于刷新驾驶舱。 */
  categories: RdCategory[];
  targetProductId: string;
  targetCategoryLabel: string;
  targetSubLabel: string;
};

/**
 * 跨产品 / 跨系统移动任务（后端原子裁决）。
 * 目标用 (产品 → 系统categoryId → 子项subId) 三段定位；主产品与其它产品共用同一套 15 个系统。
 */
export function moveRdTasks(input: {
  taskIds: string[];
  targetProductId: string;
  targetCategoryId: string;
  targetSubId: string;
}) {
  return requestJson<RdMoveTasksResult>("/task-categories/tasks/move", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type RdCreateTaskInput = {
  /** 立项目标产品。缺省/主产品 → 主库；其余 → 对应产品库（后端按此选择 store）。 */
  product_id?: string;
  category_id?: string;
  sub_project_id?: string;
  /**
   * 直建子任务：传父任务 id。此时产品/分类/category_path 全部继承父任务，
   * 无需传 product_id / category_id。父任务可以是任意层级节点，服务端统一限制整树最多 5 层。
   */
  parent_task_id?: string;
  title: string;
  primary_owner: string;
  primary_owner_user_id?: string | null;
  /** 立项时可一次性分配多个协作人（任务-人 1:N 关系）。 */
  collaborators?: RdCollaborator[];
  status?: RdTaskStatus;
  progress?: number;
  final_priority?: RdPriority;
  ai_priority?: RdPriority;
  due_date?: string;
  description?: string;
  category_path?: string;
  /**
   * 待审核任务的审核类型。个人立项提交时传 "proposal"，使管理员审批通过后
   * 任务进入 in_progress（保留在发起人任务列表），而非默认的 result→completed（会被工作台过滤掉）。
   */
  pending_review_type?: "collaboration" | "result" | "proposal" | string | null;
};

export function createRdTask(payload: RdCreateTaskInput) {
  return requestJson<RdTask>("/task-categories/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 节点立项原子批量建子任务；requestId 在超时重试时保证同一批次不会重复落库。 */
export function createRdSubtasks(
  parentTaskId: string,
  tasks: Omit<RdCreateTaskInput, "parent_task_id">[],
  requestId: string,
) {
  return requestJson<{ ok: true; parent_task_id: string; tasks: RdTask[] }>(
    "/task-categories/tasks/create-children-batch",
    {
      method: "POST",
      body: JSON.stringify({ parent_task_id: parentTaskId, request_id: requestId, tasks }),
    },
  ).then((result) => result.tasks);
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

/**
 * 把已有顶层任务（可自带完整子任务树）整体挂为目标任务的子任务，直接生效不走审批。
 * 任务本体完整保留（标题/主责/进度/留痕/附件），仅改变在任务树中的位置。
 * 与「合并申请」(updateRdTask + pending_merge_target) 不同：那个会归档源任务并改写目标描述。
 */
export function attachRdTaskToParent(taskId: string, parentTaskId: string) {
  return requestJson<{ ok: true; task_id: string; parent_task_id: string }>(
    `/task-categories/tasks/${encodeURIComponent(taskId)}/attach-parent`,
    { method: "POST", body: JSON.stringify({ parent_task_id: parentTaskId }) },
  );
}

/** 原子批量并入：来源必须是顶层独立任务，目标可以是任意层级任务。 */
export function attachRdTasksToParent(taskIds: string[], parentTaskId: string) {
  return requestJson<{ ok: true; task_ids: string[]; parent_task_id: string }>(
    "/task-categories/tasks/attach-parent-batch",
    { method: "POST", body: JSON.stringify({ task_ids: taskIds, parent_task_id: parentTaskId }) },
  );
}

/** 取消子任务关系：提升为顶层任务，落在原父任务所在子项目里（与父任务同级）。 */
export function detachRdSubtask(taskId: string) {
  return requestJson<{ ok: true; task_id: string }>(
    `/task-categories/tasks/${encodeURIComponent(taskId)}/detach-parent`,
    { method: "POST" },
  );
}

/** 原子批量取消同一父任务下的直接子任务关系，所选子树整体提升为顶层任务。 */
export function detachRdSubtasks(taskIds: string[], parentTaskId: string) {
  return requestJson<{ ok: true; task_ids: string[]; parent_task_id: string }>(
    "/task-categories/tasks/detach-parent-batch",
    { method: "POST", body: JSON.stringify({ task_ids: taskIds, parent_task_id: parentTaskId }) },
  );
}

export function clearRdAllTaskData() {
  return requestJson<{ ok: true }>("/task-data", { method: "DELETE" });
}

export function fetchRdWorkspace(options?: { includeCollaboration?: boolean }) {
  return requestJson<RdWorkspacePayload>(
    options?.includeCollaboration && !currentRdWorkspace() ? "/workspace/combined" : "/workspace",
  );
}

/** 研发管理员人员视角：研发全产品任务 + 协同任务，只用于展示聚合，不参与研发 KPI 或 AI 分析。 */
export function fetchRdMemberTaskCategories() {
  return requestJson<RdCategory[]>("/member-task-categories").then(normalizeArchivedFlags);
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

// ── 团队绩效考核（按人聚合）─────────────────────────────────────────────────────

export type RdPerformanceGradeDist = { A: number; B: number; C: number; D: number };

export type RdPerformanceRow = {
  person_id: string;
  user_id: string | null;
  name: string;
  position: string;
  department: string;
  /** 本人作为主责人的已完成任务数 */
  completed_count: number;
  /** 其中已被 AI 评分的数量 */
  scored_count: number;
  /** 已评分任务平均分（0~100），无则 null */
  avg_score: number | null;
  grade_dist: RdPerformanceGradeDist;
  /** 四维度平均分（各满分 25），无评分则 null */
  dimension_avg: {
    timeliness: number;
    process: number;
    evidence: number;
    collaboration: number;
  } | null;
  /** MateChat 累计发言条数 */
  chat_total: number;
  /** MateChat 近 30 天发言条数 */
  chat_recent: number;
  /** 近 30 天均分 */
  recent_avg: number | null;
  /** 前 30 天均分 */
  prev_avg: number | null;
  /** 趋势差（近 − 前），数据不足为 null */
  trend_delta: number | null;
  /** 最近若干次完成评分点（升序），用于迷你趋势图 */
  score_series: Array<{ at: string; total: number }>;
  /** 交付质量分（= avg_score） */
  delivery_score: number | null;
  /** 交付吞吐分（饱和曲线） */
  throughput_score: number;
  /** AI 工具活跃度分（饱和曲线） */
  chat_score: number;
  /** 综合考核分（0~100），无评分任务则 null（不参与排名） */
  composite: number | null;
  /** 排名（仅有综合分者，1 起），否则 null */
  rank: number | null;
};

export type RdPerformanceAssessment = {
  generated_at: string;
  window_days: number;
  weights: { delivery: number; throughput: number; chat: number };
  saturation: { throughput_k: number; chat_k: number };
  team: {
    ranked_people: number;
    avg_composite: number | null;
    avg_score: number | null;
    median_score: number | null;
    grade_dist: RdPerformanceGradeDist;
    total_completed: number;
    total_scored: number;
    chat_total: number;
    score_months: Array<{ month: string; avg: number; count: number }>;
  };
  rows: RdPerformanceRow[];
  notes: string[];
};

/** 团队绩效考核聚合（仅主管驾驶舱权限可读）。 */
export function fetchRdPerformanceAssessment() {
  return requestJson<RdPerformanceAssessment>("/performance-assessment");
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

/**
 * 取当前登录用户自己的知识库权限分值（kb_level）。
 * 研发成员无权读取完整 /people 列表，故用此"只取自己"的端点作为上传弹窗默认值来源。
 */
export function fetchMyKbPermissionLevel() {
  return requestJson<{ permission_level: number }>("/knowledge/my-permission-level");
}

export function fetchRdPeopleUserOptions() {
  return requestJson<RdIdentityUser[]>("/people/user-options");
}

export type RdPersonMutation = {
  id?: string;
  user_id?: string | null;
  name: string;
  position: string;
  department?: string;
  email?: string;
  username?: string | null;
  user_status?: string | null;
  phone?: string;
  status?: "active" | "on_leave" | "resigned" | string;
  on_leave?: boolean;
  max_tasks: number;
  joined_at?: string;
  kb_level?: number;
  kb_level_scale?: "score" | string;
};

export function createRdPerson(payload: RdPersonMutation) {
  return requestJson<RdPersonLoad>("/people", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRdPerson(payload: RdPersonMutation & { id: string }) {
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

/** 「添加审核人」候选（本工作区有审批能力的人；仅审批流管理员可拉取） */
export function fetchRdApprovalCandidates<TMember = unknown>() {
  return requestJson<TMember[]>("/approval-candidates");
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

/** 给某条操作留痕追加一条备注（仅研发管理员）。返回更新后的留痕记录。 */
export function addRdAuditLogNote<TLog>(logId: string, payload: { text: string; actor: unknown }) {
  return requestJson<TLog>(`/audit-logs/${encodeURIComponent(logId)}/notes`, {
    method: "POST",
    body: JSON.stringify(payload),
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
  id?: string;
  title: string;
  description?: string;
  owner: string;
  owner_reason: string;
  start_date?: string;
  due_date: string;
  due_date_original?: string;
  priority: "high" | "medium" | "low";
  category_path: string;
  estimated_days: number;
  ai_estimated_days?: number;
  duration_basis?: string;
};

export type RdAiProductOption = { id: string; name: string };

export type RdAiExtractResult = {
  tasks: RdAiTaskDraft[];
  suggested_category?: string;
  /** AI 推断本次立项最匹配的产品 id（从传入的 products 中选）；不确定时省略，前端回退主产品。 */
  suggested_product?: string;
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
  products?: RdAiProductOption[];
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
  products?: RdAiProductOption[];
}): Promise<RdAiExtractResult> {
  const form = new FormData();
  form.append("file", payload.file);
  if (payload.peopleNames) form.append("peopleNames", JSON.stringify(payload.peopleNames));
  if (payload.peopleProfiles) form.append("peopleProfiles", JSON.stringify(payload.peopleProfiles));
  if (payload.categoryLabels) form.append("categoryLabels", JSON.stringify(payload.categoryLabels));
  if (payload.proposalTitle) form.append("proposalTitle", payload.proposalTitle);
  if (payload.products) form.append("products", JSON.stringify(payload.products));

  const response = await fetchWithTimeout(
    "/ai/extract-from-file",
    { method: "POST", body: form },
    RD_AI_TIMEOUT_MS,
    "AI 文件解析失败",
  );
  return (await response.json()) as RdAiExtractResult;
}

export type RdAiProposalRefineScope = "all" | "selected" | "single";

export type RdAiProposalRefineResult = {
  tasks: RdAiTaskDraft[];
  change_summary: string[];
  warnings: string[];
  provider: "openai" | "qwen" | "local";
  model: string;
};

export function refineRdProposalTasks(payload: {
  proposalTitle?: string;
  originalInput?: string;
  currentTasks: RdAiTaskDraft[];
  instruction: string;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  scope?: RdAiProposalRefineScope;
  selectedTaskIds?: string[];
}) {
  return requestJson<RdAiProposalRefineResult>("/ai/refine-proposal", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: RD_AI_TIMEOUT_MS,
  });
}

// ── AI: 全量线上任务归纳与合并候选（只读建议）────────────────────────────────

export type RdAiProjectClassificationResult = {
  scope: {
    product_id: string;
    category_id: string;
    sub_project_id?: string;
    label: string;
    task_count: number;
    analyzed_task_count: number;
    attachment_count: number;
  };
  summary: string;
  categories: Array<{
    label: string;
    rationale: string;
    task_ids: string[];
  }>;
  duplicate_groups: Array<{
    title: string;
    confidence: number;
    reason: string;
    task_ids: string[];
    recommended_primary_task_id: string | null;
    action: string;
  }>;
  homogeneous_clusters: Array<{
    label: string;
    reason: string;
    task_ids: string[];
    recommended_primary_task_id: string | null;
    consolidation_advice: string;
  }>;
  member_task_lines: Array<{
    primary_owner: string;
    line_title: string;
    rationale: string;
    task_ids: string[];
    recommended_primary_task_id: string | null;
  }>;
  recommendations: string[];
  warnings: string[];
  provider: "openai" | "qwen" | "local";
  model: string;
  generated_at: string;
};

export async function classifyRdProject(payload: {
  productId?: string;
  categoryId?: string;
  subProjectId?: string;
  instruction?: string;
  files?: File[];
}): Promise<RdAiProjectClassificationResult> {
  const form = new FormData();
  if (payload.productId) form.append("product_id", payload.productId);
  if (payload.categoryId) form.append("category_id", payload.categoryId);
  if (payload.subProjectId) form.append("sub_project_id", payload.subProjectId);
  if (payload.instruction?.trim()) form.append("instruction", payload.instruction.trim());
  for (const file of payload.files ?? []) form.append("files", file);

  const response = await fetchWithTimeout(
    "/ai/classify-project-jobs",
    { method: "POST", body: form },
    RD_AI_TIMEOUT_MS,
    "AI 全量任务归纳失败",
  );
  const created = (await response.json()) as { job_id: string; status: "queued" };
  if (!created.job_id) throw new Error("AI 全量任务归纳失败：服务端未返回分析任务编号");

  const deadline = Date.now() + RD_AI_JOB_TIMEOUT_MS;
  let pollDelayMs = 1_000;
  let consecutivePollFailures = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));
    let job: {
      status: "queued" | "running" | "completed" | "failed";
      result?: RdAiProjectClassificationResult;
      error?: string;
    };
    try {
      job = await requestJson(`/ai/classify-project-jobs/${encodeURIComponent(created.job_id)}`);
      consecutivePollFailures = 0;
    } catch (pollError) {
      const status = (pollError as RdApiError).status;
      if (status !== undefined && ![500, 502, 503, 504].includes(status)) throw pollError;
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= 3) throw pollError;
      pollDelayMs = Math.min(5_000, Math.round(pollDelayMs * 1.35));
      continue;
    }
    if (job.status === "completed") {
      if (!job.result) throw new Error("AI 全量任务归纳失败：分析结果为空");
      return job.result;
    }
    if (job.status === "failed") {
      throw new Error(job.error?.trim() || "AI 全量任务归纳失败，请稍后重试");
    }
    pollDelayMs = Math.min(5_000, Math.round(pollDelayMs * 1.35));
  }

  throw new Error("AI 全量任务归纳等待超时（>20 分钟），请稍后重新生成");
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
  /** AI 判断本次进展归属的工作项 id（任务带 work_items 时才有）；仅作预选建议，人工可改。 */
  work_item_id?: string | null;
};

export async function assessRdTaskProgress(payload: {
  files?: File[];
  text?: string;
  task: {
    task_id?: string;
    title: string;
    description?: string;
    category_path?: string;
    current_progress?: number;
    current_status?: string;
    /** 工作项清单：传入后 AI 会顺带判断本次进展归属哪一项（work_item_id 返回） */
    work_items?: RdWorkItem[];
  };
}): Promise<RdAiProgressAssessment> {
  const form = new FormData();
  if (payload.files) {
    for (const file of payload.files) form.append("files", file);
  }
  if (payload.text) form.append("text", payload.text);
  if (payload.task.task_id) form.append("task_id", payload.task.task_id);
  form.append("title", payload.task.title);
  if (payload.task.description) form.append("description", payload.task.description);
  if (payload.task.category_path) form.append("category_path", payload.task.category_path);
  if (payload.task.work_items?.length) form.append("work_items", JSON.stringify(payload.task.work_items));
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
  /** OSS 永久对象标识；新附件直接保存，旧附件由后端从历史 URL 自动恢复。 */
  object_key?: string;
  /** 历史兼容用 OSS 签名 URL；可能过期，展示时优先使用后端动态 preview_url。 */
  oss_url?: string;
  /** 同源内联预览代理 URL（后端 HMAC 签名）。iframe 预览用，规避 OSS 强制下载。 */
  preview_url?: string;
  /** CDN/OSS 下载地址；与内联预览分离，确保跨域链接也能触发下载。 */
  download_url?: string;
  /** base64 data URI（OSS 未配置时的降级方案）。 */
  data_url?: string;
  /** 图片附件的 OSS 实时缩放缩略图（列表 240px、详情 320px、移动卡片 480px WebP）。 */
  thumb_url?: string;
  /** AI 抽取出的文本内容（OCR/文档抽取/视觉模型），用于 AI 评分上下文。上传后由后台异步填充。 */
  extracted_text?: string;
  /** 抽取来源：ocr / vision / doc_extract / doc_model / text / failed。 */
  extracted_source?: "ocr" | "vision" | "doc_extract" | "doc_model" | "text" | "failed" | "skipped";
  /** 抽取时间，便于审计；可能晚于 attachment 创建时间。 */
  extracted_at?: string;
};

/** 取附件的可用 URL：后端动态代理 > 历史 OSS 签名链接 > base64 data URI > 空串。 */
// ── OSS 域名预连接：首次遇到外域附件 URL 时注入 <link rel="preconnect">，省去后续图片的 DNS+TLS 握手 ──
const preconnectedOrigins = new Set<string>();
/** 已处理过的完整 URL（渲染热路径高频重复调用，先按字符串短路，避免每次 new URL 解析） */
const preconnectSeenUrls = new Set<string>();
export function ensurePreconnect(url: string): void {
  if (typeof document === "undefined" || !url.startsWith("http")) return;
  if (preconnectSeenUrls.has(url)) return;
  preconnectSeenUrls.add(url);
  if (preconnectSeenUrls.size > 2000) preconnectSeenUrls.clear();
  try {
    const origin = new URL(url).origin;
    if (origin === window.location.origin || preconnectedOrigins.has(origin)) return;
    preconnectedOrigins.add(origin);
    for (const rel of ["preconnect", "dns-prefetch"]) {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = origin;
      if (rel === "preconnect") link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  } catch { /* URL 解析失败忽略 */ }
}

export function getAttachmentUrl(
  att: { preview_url?: string; oss_url?: string; data_url?: string } | null | undefined,
): string {
  if (!att) return "";
  // `oss_url` stored in historical progress notes expires after 30 days. Every
  // notes response includes a newly signed same-origin `preview_url`, so all
  // Image/fullscreen call sites prefer it as well as iframes do; downloads use download_url.
  const url = att.preview_url ?? att.oss_url ?? att.data_url ?? "";
  if (url) ensurePreconnect(url);
  return url;
}

export type RdProductionTaskSync = {
  task_id: string;
  active: boolean;
  first_synced_at: string;
  synced_at: string;
  synced_by_id: string | null;
  synced_by_name: string;
  revoked_at: string | null;
  revoked_by_id: string | null;
  revoked_by_name: string | null;
};

export function fetchRdProductionTaskSyncs() {
  return requestJson<RdProductionTaskSync[]>("/production-task-syncs");
}

export function syncRdTaskToProduction(taskId: string) {
  return requestJson<RdProductionTaskSync>(
    `/tasks/${encodeURIComponent(taskId)}/sync-production`,
    { method: "POST" },
  );
}

export function revokeRdTaskProductionSync(taskId: string) {
  return requestJson<RdProductionTaskSync>(
    `/tasks/${encodeURIComponent(taskId)}/sync-production`,
    { method: "DELETE" },
  );
}

/** 下载地址与内联预览分开，CDN 跨域时不依赖浏览器对 download 属性的兼容行为。 */
export function getAttachmentDownloadUrl(
  att: {
    download_url?: string;
    preview_url?: string;
    oss_url?: string;
    data_url?: string;
  } | null | undefined,
): string {
  if (!att) return "";
  const url = att.download_url ?? getAttachmentUrl(att);
  if (url) ensurePreconnect(url);
  return url;
}

/** 取附件缩略图 URL：图片附件优先用 OSS 实时缩放图（480px webp），否则回退原图/内嵌数据。 */
export function getAttachmentThumbUrl(
  att: { thumb_url?: string; preview_url?: string; oss_url?: string; data_url?: string } | null | undefined,
): string {
  if (!att) return "";
  if (att.thumb_url) {
    ensurePreconnect(att.thumb_url);
    return att.thumb_url;
  }
  return getAttachmentUrl(att);
}

/**
 * 取附件的「内联预览」URL：优先用同源代理（preview_url，规避 OSS 强制下载），
 * 否则回退到普通 URL。用于 iframe / PDF 预览；下载仍用 getAttachmentUrl。
 */
export function getAttachmentPreviewUrl(
  att: { preview_url?: string; oss_url?: string; data_url?: string } | null | undefined,
): string {
  if (!att) return "";
  return att.preview_url ?? getAttachmentUrl(att);
}

export type RdTaskProgressNote = {
  id: string;
  task_id: string;
  text: string;
  progress?: number;
  attachments: RdTaskProgressAttachment[];
  actor: { id: string | null; name: string; role: string };
  created_at: string;
  /** 可选：关联的工作项 id（任务内部拆分的小子集，如某个文档），详情留痕区按此分 Tab。 */
  work_item_id?: string | null;
  /** 可选：评论中 @ 提及的成员（结构化，渲染高亮与通知均以此为准） */
  mentions?: Array<{ user_id: string | null; name: string | null }>;
  /**
   * 当前登录人是否可管理本条留痕的附件（新增/替换/删除）。由服务端按
   * 「留痕作者/任务主责人/管理员 + 任务未完成未归档」统一计算下发，
   * 前端只认此标记渲染入口，避免前后端权限口径漂移。
   */
  can_edit_attachments?: boolean;
  /** Present when notes are loaded as one merged-task relation feed. */
  source_task?: {
    task_id: string;
    title: string;
    path: string[];
    joined_at: string | null;
    is_before_merge: boolean;
  };
};

export type RdTaskProgressGroupTask = {
  task_id: string;
  title: string;
  path: string[];
  joined_at: string | null;
  can_post: boolean;
  note_count: number;
};

export type RdTaskProgressNoteGroup = {
  root_task_id: string;
  current_task_id: string;
  tasks: RdTaskProgressGroupTask[];
  notes: RdTaskProgressNote[];
};

/**
 * 工作项：任务内部的轻量拆分（如文档类任务的各个文件），不是独立任务——
 * 无独立审批/优先级/截止日，不进任务树，统计/驾驶舱/负载对其零感知。
 * 存于任务对象的 work_items 字段，随 PATCH 持久化（后端 spread 保留未知字段）。
 */
export type RdWorkItem = {
  id: string;
  title: string;
  owner_name?: string | null;
  done: boolean;
};

export function fetchRdTaskProgressNotes(taskId: string, signal?: AbortSignal) {
  return requestJson<RdTaskProgressNote[]>(
    `/task-progress-notes/${encodeURIComponent(taskId)}`,
    signal ? { signal } : undefined,
  );
}

export function fetchRdTaskProgressNoteGroup(taskId: string, signal?: AbortSignal) {
  return requestJson<RdTaskProgressNoteGroup>(
    `/task-progress-note-groups/${encodeURIComponent(taskId)}`,
    signal ? { signal } : undefined,
  );
}

export type RdTaskAttachmentPreview = {
  attachment_count: number;
  attachments: RdTaskProgressAttachment[];
};

const RD_ATTACHMENT_CACHE_TTL_MS = 5 * 60_000;
const rdAttachmentPreviewCache = new Map<string, { at: number; data: RdTaskAttachmentPreview }>();
const rdAttachmentPreviewInflight = new Map<string, Promise<Record<string, RdTaskAttachmentPreview>>>();
const rdTaskAttachmentCache = new Map<string, { at: number; data: RdTaskAttachmentPreview }>();
const rdTaskAttachmentInflight = new Map<string, Promise<RdTaskAttachmentPreview>>();
let rdAttachmentCacheGeneration = 0;

function rdAttachmentCacheKey(taskId: string): string {
  return `${currentRdWorkspace() ?? "rd"}|${taskId}`;
}

/** Invalidate cached attachment metadata after create/add/replace/delete mutations. */
export function clearRdTaskAttachmentCache(taskId?: string) {
  rdAttachmentCacheGeneration += 1;
  if (!taskId) {
    rdAttachmentPreviewCache.clear();
    rdAttachmentPreviewInflight.clear();
    rdTaskAttachmentCache.clear();
    rdTaskAttachmentInflight.clear();
    return;
  }
  const key = rdAttachmentCacheKey(taskId);
  rdAttachmentPreviewCache.delete(key);
  rdTaskAttachmentCache.delete(key);
  rdTaskAttachmentInflight.delete(key);
  for (const inflightKey of rdAttachmentPreviewInflight.keys()) {
    if (inflightKey.split("|").slice(1).includes(taskId)) {
      rdAttachmentPreviewInflight.delete(inflightKey);
    }
  }
}

/** 驾驶舱卡片批量摘要：单请求返回最多 60 个任务、每任务最多 5 个轻量附件预览。 */
export async function fetchRdTaskAttachmentPreviews(
  taskIds: string[],
  options?: { signal?: AbortSignal },
) {
  const ids = Array.from(new Set(taskIds.map((id) => id.trim()).filter(Boolean))).slice(0, 60);
  if (ids.length === 0) return {};
  const now = Date.now();
  const output: Record<string, RdTaskAttachmentPreview> = {};
  const missing: string[] = [];
  for (const taskId of ids) {
    const cached = rdAttachmentPreviewCache.get(rdAttachmentCacheKey(taskId));
    if (cached && now - cached.at < RD_ATTACHMENT_CACHE_TTL_MS) output[taskId] = cached.data;
    else missing.push(taskId);
  }
  if (missing.length === 0) return output;

  const wsKey = currentRdWorkspace() ?? "rd";
  const sortedMissing = missing.slice().sort();
  const inflightKey = `${wsKey}|${sortedMissing.join("|")}`;
  const generation = rdAttachmentCacheGeneration;
  const query = new URLSearchParams({ task_ids: sortedMissing.join(",") });
  const loadMissing = (signal?: AbortSignal) => requestJson<Record<string, RdTaskAttachmentPreview>>(
    `/task-attachment-previews?${query.toString()}`,
    signal ? { signal } : undefined,
  ).then((data) => {
    if (generation !== rdAttachmentCacheGeneration) return data;
    const cachedAt = Date.now();
    for (const [taskId, preview] of Object.entries(data)) {
      rdAttachmentPreviewCache.set(rdAttachmentCacheKey(taskId), { at: cachedAt, data: preview });
    }
    return data;
  });

  // A view-scoped request must be independently abortable. It deliberately does not join the
  // global in-flight promise, because unmounting one cockpit must not cancel another consumer.
  if (options?.signal) {
    return { ...output, ...await loadMissing(options.signal) };
  }

  let request = rdAttachmentPreviewInflight.get(inflightKey);
  if (!request) {
    request = loadMissing()
      .finally(() => {
        if (rdAttachmentPreviewInflight.get(inflightKey) === request) {
          rdAttachmentPreviewInflight.delete(inflightKey);
        }
      });
    rdAttachmentPreviewInflight.set(inflightKey, request);
  }
  return { ...output, ...await request };
}

/** Load every attachment for one task only after an explicit view-all/gallery action. */
export async function fetchRdTaskAttachments(taskId: string) {
  const key = rdAttachmentCacheKey(taskId);
  const cached = rdTaskAttachmentCache.get(key);
  if (cached && Date.now() - cached.at < RD_ATTACHMENT_CACHE_TTL_MS) return cached.data;
  const existing = rdTaskAttachmentInflight.get(key);
  if (existing) return existing;
  const generation = rdAttachmentCacheGeneration;
  const request = (async () => {
    try {
      return await requestJson<RdTaskAttachmentPreview>(`/task-attachments/${encodeURIComponent(taskId)}`);
    } catch (error) {
      if ((error as RdApiError).status !== 404) throw error;
      return buildRdTaskAttachmentPayload(await fetchRdTaskProgressNotes(taskId));
    }
  })()
    .then((data) => {
      if (generation === rdAttachmentCacheGeneration) {
        rdTaskAttachmentCache.set(key, { at: Date.now(), data });
      }
      return data;
    })
    .finally(() => {
      if (rdTaskAttachmentInflight.get(key) === request) rdTaskAttachmentInflight.delete(key);
    });
  rdTaskAttachmentInflight.set(key, request);
  return request;
}

/**
 * 一次性拉取「全部任务」的进度留痕（task_id → 留痕列表），后端按当前用户权限过滤
 * （管理员/只读全览看全部、成员仅看本人）。用于日报/主管驾驶舱等需要按多任务聚合的场景，
 * 替代「逐任务并发 N 个 GET」——后者任务多时会瞬间打爆后端限流触发 429。
 *
 * 这里再加一层「短 TTL 内存缓存 + 同发去重」：驾驶舱页、日报面板、月报面板会各自调用本函数，
 * 同一时间窗内复用同一份结果，避免重复请求继续挤占限流配额。写留痕后调用
 * clearRdTaskProgressNoteMapCache() 失效缓存，保证新附件即时可见。
 */
const NOTE_MAP_CACHE_TTL_MS = 15_000;
// ⚠️ 缓存必须按工作区分键：研发池与协同池的留痕 map 完全不同，共享单例缓存会导致
// 跨驾驶舱切换时数据互相污染（曾发生：协同页拉的留痕在研发页 60s 内被复用）。
const noteMapCacheByWs = new Map<string, { at: number; data: Record<string, RdTaskProgressNote[]> }>();
const noteMapInflightByWs = new Map<string, Promise<Record<string, RdTaskProgressNote[]>>>();

export function clearRdTaskProgressNoteMapCache() {
  noteMapCacheByWs.clear();
  noteMapInflightByWs.clear();
  clearRdTaskAttachmentCache();
}

export function fetchRdTaskProgressNoteMap(options?: { force?: boolean }) {
  const wsKey = currentRdWorkspace() ?? "rd";
  const now = Date.now();
  const cached = noteMapCacheByWs.get(wsKey);
  if (!options?.force && cached && now - cached.at < NOTE_MAP_CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  // 同发去重：多个组件同帧调用时只发一个请求。
  const inflight = noteMapInflightByWs.get(wsKey);
  if (!options?.force && inflight) return inflight;

  const p = requestJson<Record<string, RdTaskProgressNote[]>>(`/task-progress-notes`)
    .then((data) => {
      noteMapCacheByWs.set(wsKey, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (noteMapInflightByWs.get(wsKey) === p) noteMapInflightByWs.delete(wsKey);
    });
  noteMapInflightByWs.set(wsKey, p);
  return p;
}

// ── 已完成任务 AI 复盘评分 ───────────────────────────────────────────────────

export type RdTaskCompletionScoreDimensionKey =
  | "timeliness"
  | "process"
  | "evidence"
  | "collaboration";

export type RdTaskCompletionScoreDimension = {
  key: RdTaskCompletionScoreDimensionKey;
  label: string;
  score: number;
  max: number;
  comment: string;
};

export type RdTaskCompletionScore = {
  total: number;
  grade: "A" | "B" | "C" | "D";
  grade_label: string;
  summary: string;
  dimensions: RdTaskCompletionScoreDimension[];
  highlights: string[];
  improvements: string[];
  provider: "openai" | "qwen" | "local";
  model: string;
  computed_at: string;
  fallback_reason?: string;
};

/** 拉取已完成任务的 AI 复盘评分；404 / null 表示尚未评分或当前用户无权查看。 */
export async function fetchRdTaskCompletionScore(
  taskId: string,
  signal?: AbortSignal,
): Promise<RdTaskCompletionScore | null> {
  const result = await requestJson<RdTaskCompletionScore | null>(
    `/task-completion-scores/${encodeURIComponent(taskId)}`,
    signal ? { signal } : undefined,
  );
  return result ?? null;
}

/** One permission-filtered request for every visible completed task. */
export async function fetchRdTaskCompletionScores(
  taskIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, RdTaskCompletionScore | null>> {
  const ids = Array.from(new Set(taskIds.map((id) => id.trim()).filter(Boolean))).slice(0, 60);
  if (ids.length === 0) return {};
  const query = new URLSearchParams({ task_ids: ids.join(",") });
  return requestJson<Record<string, RdTaskCompletionScore | null>>(
    `/task-completion-scores?${query.toString()}`,
    signal ? { signal } : undefined,
  );
}

export type RdTaskCompletionScoreDebug = RdTaskCompletionScore & {
  _debug?: {
    system_prompt: string;
    user_message: string;
    raw_response: string;
    request_started_at: string;
    request_finished_at: string;
    duration_ms: number;
  };
};

/** 超管专用：拉取 AI 评分的原始 prompt 和 AI 响应（用于审查/调试）。403 时返回 null。 */
export async function fetchRdTaskCompletionScoreDebug(
  taskId: string,
): Promise<RdTaskCompletionScoreDebug | null> {
  try {
    const result = await requestJson<RdTaskCompletionScoreDebug | null>(
      `/task-completion-scores/${encodeURIComponent(taskId)}/debug`,
    );
    return result ?? null;
  } catch {
    return null;
  }
}

export type RdTaskCompletionScoreBackfillResult = {
  total: number;
  scored: number;
  skipped: number;
  failed: number;
  failed_ids: string[];
};

/** 管理员批量为现存已完成任务补跑 AI 评分。已评分任务会跳过。 */
export function backfillRdTaskCompletionScores(
  opts: { force?: boolean } = {},
): Promise<RdTaskCompletionScoreBackfillResult> {
  // force=true：评分标准升级后，强制对所有已完成任务按新标准重新评分（覆盖旧分）
  return requestJson<RdTaskCompletionScoreBackfillResult>(
    `/task-completion-scores/backfill`,
    { method: "POST", body: JSON.stringify({ force: !!opts.force }) },
  );
}

export type RdProgressNoteExtractionBackfillResult = {
  total_pending: number;
  processed: number;
  succeeded: number;
  failed: number;
  has_more: boolean;
  failed_ids: string[];
};

/**
 * 管理员批量为现存进度留痕的附件补做 AI 抽取（OCR/文档/视觉）。
 * 已抽取过的（含失败标记）会跳过。单次最多 N 个，剩余 has_more=true 时再点一次。
 */
export function backfillRdTaskProgressNoteExtraction(
  payload: { max_items?: number } = {},
): Promise<RdProgressNoteExtractionBackfillResult> {
  return requestJson<RdProgressNoteExtractionBackfillResult>(
    `/task-progress-notes/backfill-extraction`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

type DirectProgressNoteUpload = {
  objectKey: string;
  originalname: string;
  mimetype: string;
  size: number;
  cleanupExp?: number;
  cleanupSig?: string;
};

type DirectProgressNotePresign = {
  enabled: boolean;
  files: Array<{
    objectKey: string;
    putUrl: string | null;
    contentType: string;
    cacheControl?: string;
    cleanupExp?: number;
    cleanupSig?: string;
  }>;
};

const RD_IMAGE_COMPRESSION_TRIGGER_BYTES = 8 * 1024 * 1024;
const RD_IMAGE_COMPRESSION_TARGET_BYTES = 4 * 1024 * 1024;
const RD_IMAGE_HARD_LIMIT_BYTES = 25 * 1024 * 1024;
const RD_IMAGE_MAX_EDGE = 2560;

export type PreparedRdProgressNoteFiles = {
  files: File[];
  compressedCount: number;
  savedBytes: number;
};

async function compressTaskImage(file: File): Promise<File> {
  const compressed = await compressImageFile(file, {
    triggerBytes: RD_IMAGE_COMPRESSION_TRIGGER_BYTES,
    targetBytes: RD_IMAGE_COMPRESSION_TARGET_BYTES,
    hardLimitBytes: RD_IMAGE_HARD_LIMIT_BYTES,
    maxEdge: RD_IMAGE_MAX_EDGE,
    minEdge: 720,
    outputType: "image/webp",
    qualities: [0.86, 0.78, 0.7, 0.62],
  });
  if (compressed) return compressed;
  throw new Error(`图片 ${file.name} 自动压缩后仍超过 25MB，请裁剪或转换为 JPG/PNG/WebP 后重试`);
}

/**
 * Compress oversized task images before AI analysis or upload. Concurrency is capped at two to
 * avoid decoding several 20MB+ images into hundreds of megabytes of bitmap memory at once.
 */
export async function prepareRdProgressNoteFiles(files: File[]): Promise<PreparedRdProgressNoteFiles> {
  const prepared = new Array<File>(files.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor++;
      prepared[index] = await compressTaskImage(files[index]!);
    }
  });
  await Promise.all(workers);
  const compressedCount = prepared.reduce((count, file, index) => count + (file !== files[index] ? 1 : 0), 0);
  const originalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const preparedBytes = prepared.reduce((sum, file) => sum + file.size, 0);
  return {
    files: prepared,
    compressedCount,
    savedBytes: Math.max(0, originalBytes - preparedBytes),
  };
}

async function cleanupProgressNoteUploads(files: DirectProgressNoteUpload[]): Promise<void> {
  if (files.length === 0) return;
  await requestJson("/task-progress-notes/abort-upload", {
    method: "POST",
    body: JSON.stringify({ files }),
  }).catch(() => undefined);
}

async function putProgressNoteFile(
  file: File,
  signed: DirectProgressNotePresign["files"][number],
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(signed.putUrl!, {
        method: "PUT",
        headers: {
          "Content-Type": signed.contentType,
          ...(signed.cacheControl ? { "Cache-Control": signed.cacheControl } : {}),
        },
        body: file,
        signal: controller.signal,
      });
      if (response.ok) return;
      lastError = new Error(`附件 ${file.name} 上传 OSS 失败（HTTP ${response.status}）`);
      if (
        response.status >= 400
        && response.status < 500
        && response.status !== 408
        && response.status !== 429
      ) break;
    } catch (error) {
      lastError = controller.signal.aborted
        ? new Error(`附件 ${file.name} 上传超时，请检查网络后重试`)
        : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`附件 ${file.name} 上传失败`);
}

/**
 * Upload note attachments straight to OSS with a small concurrency cap. Returns null only when
 * OSS is disabled, allowing the existing API-buffered path to remain a local-development fallback.
 */
async function uploadProgressNoteFilesDirect(files: File[]): Promise<{
  files: File[];
  directUploads: DirectProgressNoteUpload[] | null;
}> {
  const prepared = await prepareRdProgressNoteFiles(files);
  if (prepared.files.length === 0) return { files: [], directUploads: [] };
  const presign = await requestJson<DirectProgressNotePresign>("/task-progress-notes/presign-upload", {
    method: "POST",
    body: JSON.stringify({
      files: prepared.files.map((file) => ({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        file_size: file.size,
      })),
    }),
  });
  if (!presign.enabled) return { files: prepared.files, directUploads: null };
  if (
    presign.files.length !== prepared.files.length
    || presign.files.some((file) => !file.objectKey || !file.putUrl)
  ) {
    throw new Error("附件直传签名不完整，请稍后重试");
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, prepared.files.length) }, async () => {
    while (cursor < prepared.files.length) {
      const index = cursor++;
      const file = prepared.files[index]!;
      const signed = presign.files[index]!;
      await putProgressNoteFile(file, signed);
    }
  });
  const directUploads = presign.files.map((signed, index) => ({
    objectKey: signed.objectKey,
    originalname: prepared.files[index]!.name,
    mimetype: signed.contentType,
    size: prepared.files[index]!.size,
    cleanupExp: signed.cleanupExp,
    cleanupSig: signed.cleanupSig,
  }));
  const results = await Promise.allSettled(workers);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    await cleanupProgressNoteUploads(directUploads);
    throw failed.reason;
  }
  return {
    files: prepared.files,
    directUploads,
  };
}

export async function createRdTaskProgressNote(payload: {
  task_id: string;
  text: string;
  progress?: number;
  files?: File[];
  /** 可选：本条进展关联到任务的哪个工作项（详情留痕区按工作项分 Tab 查看）。 */
  work_item_id?: string;
  /** 可选：@ 提及的成员（服务端存结构化字段并给每人发站内消息）。 */
  mentions?: Array<{ user_id?: string; name: string }>;
}): Promise<RdTaskProgressNote> {
  const files = payload.files ?? [];
  const upload = await uploadProgressNoteFilesDirect(files);
  const form = new FormData();
  form.append("task_id", payload.task_id);
  form.append("text", payload.text);
  if (typeof payload.progress === "number") form.append("progress", String(payload.progress));
  if (payload.work_item_id) form.append("work_item_id", payload.work_item_id);
  if (payload.mentions && payload.mentions.length > 0) form.append("mentions", JSON.stringify(payload.mentions));
  if (upload.directUploads) form.append("oss_files", JSON.stringify(upload.directUploads));
  else upload.files.forEach((file) => form.append("files", file));

  const response = await fetchWithTimeout(
    "/task-progress-notes",
    { method: "POST", body: form },
    upload.directUploads ? 30_000 : 60_000,
    "进度记录保存失败",
  );
  // 新增留痕后失效聚合缓存，保证新附件在驾驶舱/日报等处即时可见。
  clearRdTaskProgressNoteMapCache();
  return (await response.json()) as RdTaskProgressNote;
}

// ── 评论未读红点（微信式）────────────────────────────────────────────────────

/** 我的全部任务未读评论数（仅含 >0 的项）；工作台/移动端列表据此渲染角标。 */
export function fetchRdNoteUnreadSummary() {
  return requestJson<Record<string, number>>("/note-unread-summary");
}

/** 标记某任务的评论已读（任何入口打开留痕区都调用，全端红点同步消失）。 */
export function markRdTaskNotesRead(taskId: string) {
  return requestJson<{ ok: boolean }>(`/task-progress-notes/${encodeURIComponent(taskId)}/read`, { method: "POST" });
}

// ── 任务协作对话（主会话 + 进度/消息原位线程）────────────────────────────

export type RdDiscussionAnchorType = "task" | "progress_note" | "message";

export type RdTaskDiscussionMessage = {
  id: string;
  author_id: string | null;
  author_name: string;
  author_role: string | null;
  body: string;
  attachments: RdTaskProgressAttachment[];
  mentions: Array<{ user_id: string | null; name: string | null }>;
  reply_to_id: string | null;
  reply_to: { id: string; author_name: string; body: string } | null;
  created_at: string;
  edited_at: string | null;
};

export type RdTaskDiscussionThreadSummary = {
  thread_id: string;
  anchor_type: RdDiscussionAnchorType;
  anchor_id: string | null;
  message_count: number;
  unread_count: number;
  last_message_at: string | null;
};

export type RdTaskDiscussionAnchorPreview = {
  type: Exclude<RdDiscussionAnchorType, "task">;
  id: string | null;
  author_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
  attachments: RdTaskProgressAttachment[];
};

export type RdTaskDiscussionResponse = {
  can_post: boolean;
  access_scope: "task" | "thread_invitee";
  task_title: string;
  invitation: {
    invited_by_id: string | null;
    invited_by_name: string;
    invited_at: string;
  } | null;
  anchor_preview: RdTaskDiscussionAnchorPreview | null;
  thread: {
    id: string;
    task_id: string;
    anchor_type: RdDiscussionAnchorType;
    anchor_id: string | null;
    message_count: number;
    unread_count: number;
  };
  messages: RdTaskDiscussionMessage[];
  thread_summaries: RdTaskDiscussionThreadSummary[];
  page_info: {
    has_more: boolean;
    next_cursor: string | null;
  };
};

function discussionQuery(
  anchor?: { type: RdDiscussionAnchorType; id?: string | null },
  page?: { cursor?: string | null; limit?: number },
) {
  const params = new URLSearchParams();
  if (anchor?.type && anchor.type !== "task") {
    params.set("anchor_type", anchor.type);
    if (anchor.id) params.set("anchor_id", anchor.id);
  }
  if (page?.cursor) params.set("cursor", page.cursor);
  if (page?.limit) params.set("limit", String(page.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchRdTaskDiscussion(
  taskId: string,
  anchor?: { type: RdDiscussionAnchorType; id?: string | null },
  page?: { cursor?: string | null; limit?: number },
) {
  return requestJson<RdTaskDiscussionResponse>(
    `/task-discussions/${encodeURIComponent(taskId)}${discussionQuery(anchor, page)}`,
  );
}

export function createRdTaskDiscussionMessage(payload: {
  task_id: string;
  anchor: { type: RdDiscussionAnchorType; id?: string | null };
  text: string;
  reply_to_id?: string | null;
  mentions?: Array<{ user_id?: string; name: string }>;
  files?: File[];
}) {
  const form = new FormData();
  form.append("anchor_type", payload.anchor.type);
  if (payload.anchor.id) form.append("anchor_id", payload.anchor.id);
  form.append("text", payload.text);
  if (payload.reply_to_id) form.append("reply_to_id", payload.reply_to_id);
  if (payload.mentions?.length) form.append("mentions", JSON.stringify(payload.mentions));
  for (const file of payload.files ?? []) form.append("files", file);
  return requestJson<{ message: RdTaskDiscussionMessage; thread_id: string }>(
    `/task-discussions/${encodeURIComponent(payload.task_id)}/messages`,
    {
      method: "POST",
      body: form,
      // 图片/视频会明显大于纯文本，给移动网络预留更充足的上传时间。
      timeoutMs: 180_000,
    },
  );
}

export function markRdTaskDiscussionRead(taskId: string, threadId: string) {
  return requestJson<{ ok: boolean }>(
    `/task-discussions/${encodeURIComponent(taskId)}/read`,
    {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId }),
    },
  );
}

/** 驾驶舱备注回执：管理员/他人给任务留的备注，目标人是否已查看/已跟进（三态：待查看/已查看/已闭环隐藏）。 */
export type RdTaskNoteReceipt = {
  author_name: string;
  target_name: string;
  state: "unread" | "read";
  excerpt: string;
  created_at: string;
};
export function fetchRdTaskNoteReceipts() {
  return requestJson<Record<string, RdTaskNoteReceipt>>("/task-note-receipts");
}

// ── 留痕附件管理（工作台）：新增 / 替换 / 删除 ────────────────────────────────
// 权限与锁定口径由后端收口（留痕作者/任务主责人/管理员；已完成或归档任务锁定）。
// 三个操作都返回更新后的完整留痕，调用方据此原位更新本地状态。

export async function addRdNoteAttachments(taskId: string, noteId: string, files: File[]): Promise<RdTaskProgressNote> {
  const upload = await uploadProgressNoteFilesDirect(files);
  const form = new FormData();
  if (upload.directUploads) form.append("oss_files", JSON.stringify(upload.directUploads));
  else upload.files.forEach((file) => form.append("files", file));
  const response = await fetchWithTimeout(
    `/task-progress-notes/${encodeURIComponent(taskId)}/${encodeURIComponent(noteId)}/attachments`,
    { method: "POST", body: form },
    upload.directUploads ? 30_000 : 60_000,
    "附件新增失败",
  );
  clearRdTaskProgressNoteMapCache();
  return (await response.json()) as RdTaskProgressNote;
}

export async function replaceRdNoteAttachment(taskId: string, noteId: string, attachmentId: string, file: File): Promise<RdTaskProgressNote> {
  const upload = await uploadProgressNoteFilesDirect([file]);
  const form = new FormData();
  if (upload.directUploads) form.append("oss_files", JSON.stringify(upload.directUploads));
  else form.append("file", upload.files[0]!);
  const response = await fetchWithTimeout(
    `/task-progress-notes/${encodeURIComponent(taskId)}/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "PUT", body: form },
    upload.directUploads ? 30_000 : 60_000,
    "附件替换失败",
  );
  clearRdTaskProgressNoteMapCache();
  return (await response.json()) as RdTaskProgressNote;
}

export async function deleteRdNoteAttachment(taskId: string, noteId: string, attachmentId: string): Promise<RdTaskProgressNote> {
  const response = await fetchWithTimeout(
    `/task-progress-notes/${encodeURIComponent(taskId)}/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
    30_000,
    "附件删除失败",
  );
  clearRdTaskProgressNoteMapCache();
  return (await response.json()) as RdTaskProgressNote;
}

// ── 单任务 AI 小结（协同模块纵向视图） ────────────────────────────────────────

export type RdTaskBrief = {
  text: string;
  model: string;
  provider: string;
  /** 'ai' = 模型生成；'local' = AI 未配置/失败时的本地事实兜底 */
  source: "ai" | "local";
  generated_at: string;
};

export function generateRdTaskBrief(taskId: string) {
  return requestJson<RdTaskBrief>(`/tasks/${encodeURIComponent(taskId)}/brief`, { method: "POST" });
}

/** 已阻塞天数：status=paused_blocked 且有 blocked_since 时返回天数，否则 null。 */
export function blockedDaysOf(task: { status?: string; blocked_since?: string | null }): number | null {
  if (task.status !== "paused_blocked" || !task.blocked_since) return null;
  const start = new Date(task.blocked_since).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

// ── 每日工作日报 ─────────────────────────────────────────────────────────────

export type RdDailyReportNoteRef = {
  note_id: string;
  task_id: string;
  progress: number | null;
  excerpt: string;
  attachments_count: number;
};

export type RdDailyReportGroup = "completed_today" | "progressed" | "stalled" | "blocked";

// 当日某成员单个任务的画像（新版日报按分组展示的最小单元）。
export type RdDailyReportTaskItem = {
  task_id: string;
  title: string;
  status: string;
  status_label: string;
  progress: number | null;
  due_date: string | null;
  role: "owner" | "collaborator";
  group: RdDailyReportGroup;
  today_note_id: string | null;
  today_excerpt: string | null;
  today_progress: number | null;
  today_attachments: number;
  blocked_reason: string | null;
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
      // 新增（旧日报无此字段，故可选）
      stalled?: number;
      as_collaborator?: number;
    };
    note_refs: RdDailyReportNoteRef[];
    // 新版按任务分组的明细（旧日报无此字段，渲染时回退到 note_refs）
    tasks?: RdDailyReportTaskItem[];
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

// ── 每月工作月报 ─────────────────────────────────────────────────────────────

export type RdMonthlyReportGroup = "completed" | "progressed" | "stalled" | "blocked";

// 当月某成员单个任务的画像（月报按分组展示的最小单元）。
export type RdMonthlyReportTaskItem = {
  task_id: string;
  title: string;
  status: string;
  status_label: string;
  progress: number | null;
  due_date: string | null;
  role: "owner" | "collaborator";
  group: RdMonthlyReportGroup;
  month_notes_count: number;
  month_excerpt: string | null;
  month_progress: number | null;
  month_attachments: number;
  blocked_reason: string | null;
  overdue: boolean;
};

export type RdMonthlyReport = {
  id: string;
  user_id: string | null;
  user_name: string;
  month: string; // YYYY-MM
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
      stalled: number;
      as_collaborator: number;
      progressed: number;
    };
    note_refs: RdDailyReportNoteRef[];
    tasks?: RdMonthlyReportTaskItem[];
  };
  created_at: string;
};

export function fetchRdMonthlyReports(filters?: { user_id?: string; month?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.user_id) params.set("user_id", filters.user_id);
  if (filters?.month) params.set("month", filters.month);
  if (typeof filters?.limit === "number") params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestJson<RdMonthlyReport[]>(`/monthly-reports${qs ? `?${qs}` : ""}`);
}

export function createRdMonthlyReport(payload: { user_id?: string; user_name?: string; month?: string }) {
  return requestJson<RdMonthlyReport>("/monthly-reports", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 120_000,
  });
}

export function regenerateAllRdMonthlyReports(month?: string) {
  return requestJson<{ month: string; count: number }>("/monthly-reports/regenerate-all", {
    method: "POST",
    body: JSON.stringify({ month }),
    timeoutMs: 180_000,
  });
}

// ── 月度绩效报表 ─────────────────────────────────────────────────────────────

export type RdPerformanceMetrics = {
  total_tasks: number;
  owner_tasks: number;
  collab_tasks: number;
  completed: number;
  in_progress: number;
  blocked: number;
  stalled: number;
  pending: number;
  notes_count: number;
  attachments_count: number;
  overdue_tasks: number;
  completion_rate: number;
};

/** 绩效考核的 5 个评分维度（自评与主管评分共用同一套，各维度 0-100）。 */
export const PERF_SCORE_DIMENSIONS = [
  { key: "delivery", label: "交付", hint: "任务交付与完成度" },
  { key: "quality", label: "质量", hint: "工作质量" },
  { key: "collaboration", label: "协作", hint: "协作与沟通" },
  { key: "initiative", label: "主动性", hint: "主动性与担当" },
  { key: "norm", label: "规范", hint: "过程规范（进度同步、材料留痕等）" },
] as const;

export type PerfScoreDimension = (typeof PERF_SCORE_DIMENSIONS)[number]["key"];
export type RdPerfDimensionScores = Record<PerfScoreDimension, number>;

/** 逐考核项打分：key=考核项名称（事项动态项 + 行为固定项），value=该项得分（0..该项权重）。 */
export type RdPerfItemScores = Record<string, number>;

/** 行为指标（20分）固定六项——评分弹窗与下载文件共用（写死，不走 AI）。 */
export const PERF_BEHAVIOR_KPIS: ReadonlyArray<{ name: string; weight: string; item: string; standard: string }> = [
  { name: "担当", weight: "2", item: "对自己行为的担当意识", standard: "主动承担工作任务，并按时完成。" },
  { name: "专注", weight: "2", item: "对工作的高度集中", standard: "在工作中保持高度集中，减少干扰。" },
  { name: "坚持", weight: "2", item: "对问题的不断探索", standard: "遇到困难问题时持续跟进，直至解决。" },
  { name: "极致", weight: "2", item: "对工作的极致效率", standard: "追求工作质量和效率的持续优化。" },
  { name: "务实", weight: "2", item: "对事情的务实态度", standard: "以实际效果和可执行结果为导向完成工作。" },
  { name: "创新", weight: "10", item: "使用AI智能办公工具", standard: "AI智能办公软件使用频率：每周≤5次，1分每周6—10次，5分\n几乎每天都使用，10分" },
];

export type RdPerfSelfAssessment = {
  scores: RdPerfItemScores;
  comment: string;
  submitted_at: string;
  by_id: string | null;
  by_name: string;
};

export type RdPerfSupervisorAssessment = {
  scores: RdPerfItemScores;
  comment: string;
  submitted_at: string;
  reviewer_id: string | null;
  reviewer_name: string;
};

export type RdPerformanceReport = {
  id: string;
  user_id: string | null;
  user_name: string;
  month: string; // YYYY-MM
  trigger: "manual" | "cron";
  summary: {
    period: string;
    period_label: string;
    score: number;
    grade: string;
    metrics: RdPerformanceMetrics;
    text: string;
    /** 事项指标逐项内容（AI 结合本月任务生成）；旧报表可能缺失。 */
    item_kpis?: Array<{ name: string; weight: string; business: string; standard: string }>;
    /** 行为指标逐项内容（AI 结合本月任务生成，缺失时前端回退固定文案）。 */
    behavior_kpis?: Array<{ name: string; weight: string; business: string; standard: string }>;
    generated_by: "ai" | "local";
    self_assessment?: RdPerfSelfAssessment | null;
    supervisor_assessment?: RdPerfSupervisorAssessment | null;
  };
  created_at: string;
};

export function fetchRdPerformanceReports(filters?: { user_id?: string; month?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.user_id) params.set("user_id", filters.user_id);
  if (filters?.month) params.set("month", filters.month);
  if (typeof filters?.limit === "number") params.set("limit", String(filters.limit));
  const qs = params.toString();
  return requestJson<RdPerformanceReport[]>(`/performance-reports${qs ? `?${qs}` : ""}`);
}

export function createRdPerformanceReport(payload: { user_id?: string; user_name?: string; month?: string }) {
  return requestJson<RdPerformanceReport>("/performance-reports", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 120_000,
  });
}

/** 成员提交本人绩效自评（逐考核项打分 + 说明）。 */
export function submitRdSelfAssessment(
  reportId: string,
  payload: { scores: RdPerfItemScores; comment: string },
) {
  return requestJson<RdPerformanceReport>(`/performance-reports/${encodeURIComponent(reportId)}/self-assessment`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** 主管提交对某成员绩效的逐考核项评分。 */
export function submitRdSupervisorAssessment(
  reportId: string,
  payload: { scores: RdPerfItemScores; comment: string },
) {
  return requestJson<RdPerformanceReport>(`/performance-reports/${encodeURIComponent(reportId)}/supervisor-assessment`, {
    method: "PATCH",
    body: JSON.stringify(payload),
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
  handled?: boolean;
  /** 结构化元数据（如视频完成通知的跳转信息 { kind, video_id, route }），供 UI 渲染跳转按钮 */
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type RdDiscussionMentionBody = {
  type: "discussion_mention";
  task_id: string;
  task_title: string;
  thread_id: string;
  anchor_type: RdDiscussionAnchorType;
  anchor_id: string | null;
  message_id: string;
  actor_name: string;
  excerpt: string;
  access_scope: "thread_invitee";
};

export function parseRdDiscussionMention(raw?: string | null): RdDiscussionMentionBody | null {
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as Partial<RdDiscussionMentionBody>;
    if (
      body.type !== "discussion_mention"
      || typeof body.task_id !== "string"
      || typeof body.anchor_type !== "string"
    ) return null;
    if (!["task", "progress_note", "message"].includes(body.anchor_type)) return null;
    return {
      type: "discussion_mention",
      task_id: body.task_id,
      task_title: typeof body.task_title === "string" ? body.task_title : body.task_id,
      thread_id: typeof body.thread_id === "string" ? body.thread_id : "",
      anchor_type: body.anchor_type,
      anchor_id: typeof body.anchor_id === "string" ? body.anchor_id : null,
      message_id: typeof body.message_id === "string" ? body.message_id : "",
      actor_name: typeof body.actor_name === "string" ? body.actor_name : "任务成员",
      excerpt: typeof body.excerpt === "string" ? body.excerpt : "",
      access_scope: "thread_invitee",
    };
  } catch {
    return null;
  }
}

export function rdDiscussionMentionHref(
  body: RdDiscussionMentionBody,
  options?: { notificationId?: string; createdAt?: string | null },
) {
  const params = new URLSearchParams({
    anchor_type: body.anchor_type,
    task_title: body.task_title,
    actor_name: body.actor_name,
    excerpt: body.excerpt,
  });
  if (body.anchor_id) params.set("anchor_id", body.anchor_id);
  if (body.message_id) params.set("message_id", body.message_id);
  if (options?.notificationId) params.set("notification_id", options.notificationId);
  if (options?.createdAt) params.set("created_at", options.createdAt);
  const route = isUsCollabWorkspace() ? "/us-collab-rd-discussion" : "/rd-discussion";
  return `${route}/${encodeURIComponent(body.task_id)}?${params.toString()}`;
}

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

export function patchRdMessage(messageId: string, patch: { read?: boolean; handled?: boolean }) {
  return requestJson<RdMessage>(`/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
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

// ── Knowledge Base ────────────────────────────────────────────────────────────

/**
 * 知识库 API 路径前缀。
 *   kbId 缺省 = 研发知识库，走 /knowledge/*（行为完全不变）；
 *   kbId = 部门 id（如 'finance'）= 部门知识库，走 /dept-knowledge/{kbId}/*。
 * 同一组前端函数 + RDKnowledgeBasePage 同时服务两者，仅靠 kbId 区分。
 */
function kbBase(kbId?: string): string {
  return kbId ? `/dept-knowledge/${encodeURIComponent(kbId)}` : '/knowledge';
}

export type KbVisibility = 'public' | 'internal' | 'restricted';
export type KbSource = 'task_attachment' | 'manual' | 'import';

export type KbCategory = {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  order?: number;
  /** Direct files in this category. Returned by the API for sidebar rules/counts. */
  entry_count?: number;
  /** Files in this category and all children. Returned by the API for edit/delete locks. */
  total_entry_count?: number;
  children?: KbCategory[];
};

export type KbEntry = {
  id: string;
  title: string;
  description?: string;
  category_id: string;
  tags: string[];
  visibility: KbVisibility;
  /** 数值访问权限分值：0（完全公开）~ 100（绝密）。用户分值 ≥ 此值方可访问。 */
  permission_level?: number;
  source: KbSource;
  source_task_id?: string | null;
  source_task_title?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  /** Only present on single-entry detail fetch; stripped from list for performance. */
  data_url?: string | null;
  /** True when this entry has a base64 file stored server-side (data_url not included in list). */
  has_data_file?: boolean;
  oss_url?: string | null;
  /** Same-origin inline-preview proxy URL (规避 OSS bucket 强制下载)；仅当 oss_url 存在时由后端注入。 */
  preview_url?: string | null;
  external_url?: string | null;
  view_count: number;
  download_count: number;
  created_by_id?: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
};

export function fetchKbCategories(kbId?: string): Promise<KbCategory[]> {
  return requestJson<KbCategory[]>(`${kbBase(kbId)}/categories`);
}

export function saveKbCategories(categories: KbCategory[], kbId?: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`${kbBase(kbId)}/categories`, {
    method: 'PUT',
    body: JSON.stringify(categories),
  });
}

// ── 部门库成员分值（按人分级可见，仅下列库启用）──────────────────────────────────

/** 启用「按人分值过滤」的部门库（与后端 LEVEL_FILTERED_DEPT_KB_IDS 保持一致）。 */
export const LEVEL_FILTERED_DEPT_KB_IDS: ReadonlySet<string> = new Set(['us-collab', 'purchasing']);

export type DeptKbMemberLevel = { user_id: string; name: string; level: number };
export type DeptKbMemberCandidate = { id: string; name: string; username: string; department: string };

export function fetchDeptKbMemberLevels(kbId: string): Promise<DeptKbMemberLevel[]> {
  return requestJson<DeptKbMemberLevel[]>(`${kbBase(kbId)}/member-levels`);
}

export function saveDeptKbMemberLevels(kbId: string, members: DeptKbMemberLevel[]): Promise<DeptKbMemberLevel[]> {
  return requestJson<DeptKbMemberLevel[]>(`${kbBase(kbId)}/member-levels`, {
    method: 'PUT',
    body: JSON.stringify({ members }),
  });
}

export function fetchDeptKbMemberCandidates(kbId: string): Promise<DeptKbMemberCandidate[]> {
  return requestJson<DeptKbMemberCandidate[]>(`${kbBase(kbId)}/member-levels/candidates`);
}

export type KbCategoryMutationResult = {
  ok: boolean;
  categories: KbCategory[];
  category?: KbCategory;
};

export function createKbCategory(payload: {
  label: string;
  parent_id?: string;
  icon?: string;
  color?: string;
}, kbId?: string): Promise<KbCategoryMutationResult> {
  return requestJson<KbCategoryMutationResult>(`${kbBase(kbId)}/categories`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateKbCategory(
  id: string,
  payload: { label?: string; icon?: string; color?: string },
  kbId?: string,
): Promise<KbCategoryMutationResult> {
  return requestJson<KbCategoryMutationResult>(`${kbBase(kbId)}/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteKbCategory(id: string, kbId?: string): Promise<KbCategoryMutationResult> {
  return requestJson<KbCategoryMutationResult>(`${kbBase(kbId)}/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchKbEntries(params?: {
  category_id?: string;
  keyword?: string;
  source?: string;
  file_type?: string;
  visibility?: string;
  permission_level?: number;
}, kbId?: string): Promise<KbEntry[]> {
  const qs = params ? new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]
  ).toString() : '';
  return requestJson<KbEntry[]>(`${kbBase(kbId)}/entries${qs ? `?${qs}` : ''}`);
}

/** Fetch a single KB entry including its full data_url (for download of base64 files). */
export function fetchKbEntry(id: string, kbId?: string): Promise<KbEntry> {
  return requestJson<KbEntry>(`${kbBase(kbId)}/entries/${encodeURIComponent(id)}`);
}

export function updateKbEntry(id: string, payload: Partial<Pick<KbEntry, 'title' | 'description' | 'category_id' | 'tags' | 'visibility' | 'permission_level' | 'archived'>>, kbId?: string): Promise<KbEntry> {
  return requestJson<KbEntry>(`${kbBase(kbId)}/entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function moveKbEntry(id: string, categoryId: string, kbId?: string): Promise<KbEntry> {
  return requestJson<KbEntry>(`${kbBase(kbId)}/entries/${encodeURIComponent(id)}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export function deleteKbEntry(id: string, kbId?: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`${kbBase(kbId)}/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export type KbClassifyResult = Array<{
  filename: string;
  category_id: string | null;
  confidence: number;
  method: 'rule' | 'ai' | 'none';
}>;

export function classifyKbFiles(filenames: string[], kbId?: string): Promise<KbClassifyResult> {
  return requestJson<KbClassifyResult>(`${kbBase(kbId)}/classify-files`, {
    method: 'POST',
    body: JSON.stringify({ filenames }),
    timeoutMs: RD_AI_TIMEOUT_MS,
  });
}

type PresignResult = {
  enabled: boolean;
  files: Array<{
    objectKey: string;
    putUrl: string | null;
    contentType: string;
    cacheControl?: string;
    cleanupExp?: number;
    cleanupSig?: string;
  }>;
};

// ── 大文件分片上传 ────────────────────────────────────────────────────────────
//
// 为什么需要：presign-upload 签出的单次 PUT 走 OSS「简单上传」，单个对象上限 5GB，
// 超过会被 OSS 直接拒绝（EntityTooLarge），和网速快慢、超时设置都无关。超过阈值的
// 文件改走分片：切片逐片直传，最后由服务端合并。小文件仍走原路径，行为一行未变。
//
// ETag：合并分片需要每片的 ETag，但浏览器要读到 PUT 响应的 ETag 头得靠 bucket CORS
// 的 ExposeHeader（本 bucket 未配）。所以前端完全不碰 ETag，由服务端 listParts 取回。

/**
 * 超过此大小走分片。取 100MB 而非贴着 5GB 硬上限：大文件即便没到 5GB 也值得拥有
 * 逐片重试和断点续传——单次 PUT 传到 90% 断一次，就得整个从头再来。
 */
export const KB_MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
/**
 * 能接受的最大文件。与后端 pickPartSize 的真实上限逐字节对齐：分片数上限 10000 ×
 * 单片最大 4GiB（32MB 翻倍到 4GiB 就到头，8GiB 超单片 5GB 上限）≈ 40TB。
 * 超过这个数后端 init 必然抛错，选中时就该拦下，避免传很久才撞后端拒绝。
 */
export const KB_MAX_UPLOAD_BYTES = 10000 * 4 * 1024 ** 3;
/** 同时在传的分片数 */
const KB_PART_CONCURRENCY = 4;
/** 每批向服务端签多少片的 URL。一次签几百个既慢、又可能没轮到传就先过期了 */
const KB_SIGN_BATCH = 20;
/** 单片失败重试次数 */
const KB_PART_MAX_RETRY = 3;
/** 断点续传记录的保留期 */
const KB_CHECKPOINT_TTL_MS = 7 * 24 * 3600 * 1000;

type KbMultipartInit = {
  enabled: boolean;
  objectKey?: string;
  uploadId?: string;
  partSize?: number;
  partCount?: number;
  contentType?: string;
  cleanupExp?: number;
  cleanupSig?: string;
};

type KbCheckpoint = {
  objectKey: string;
  uploadId: string;
  partSize: number;
  savedAt: number;
  cleanupExp?: number;
  cleanupSig?: string;
};

type KbUploadedObject = {
  objectKey: string;
  contentType: string;
  cleanupExp?: number;
  cleanupSig?: string;
};

/** 断点续传靠这个 key 认出「还是上次那个文件」 */
function kbCheckpointKey(file: File, kbId?: string): string {
  return `kb-multipart:${kbId ?? 'rd'}:${file.name}:${file.size}:${file.lastModified}`;
}

function readKbCheckpoint(file: File, kbId?: string): KbCheckpoint | null {
  try {
    const raw = localStorage.getItem(kbCheckpointKey(file, kbId));
    if (!raw) return null;
    const cp = JSON.parse(raw) as KbCheckpoint;
    if (!cp?.uploadId || !cp?.objectKey || !cp?.partSize) return null;
    if (Date.now() - (cp.savedAt ?? 0) > KB_CHECKPOINT_TTL_MS) {
      localStorage.removeItem(kbCheckpointKey(file, kbId));
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

function writeKbCheckpoint(file: File, kbId: string | undefined, cp: KbCheckpoint): void {
  try {
    localStorage.setItem(kbCheckpointKey(file, kbId), JSON.stringify(cp));
  } catch {
    // localStorage 写不进去（隐私模式/配额满）只影响续传能力，不该让上传失败
  }
}

function clearKbCheckpoint(file: File, kbId?: string): void {
  try {
    localStorage.removeItem(kbCheckpointKey(file, kbId));
  } catch {
    // 同上，忽略
  }
}

const kbSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 固定并发地跑完一批任务。任一任务抛错即整体抛错。 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

/** 传一片，带退避重试。签名里不含 Content-Type，故这里也不能带，否则签名不匹配。 */
async function putKbPartWithRetry(
  url: string,
  blob: Blob,
  partNumber: number,
  filename: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= KB_PART_MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: blob });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
      // 4xx 是签名/权限问题，重试多少次都一样
      if (res.status >= 400 && res.status < 500) break;
    } catch (err) {
      lastError = err; // 网络抖动，值得重试
    }
    if (attempt < KB_PART_MAX_RETRY) await kbSleep(500 * 2 ** attempt);
  }
  const detail = lastError instanceof Error ? lastError.message : '未知错误';
  throw new Error(`分片上传失败（${filename} 第 ${partNumber} 片）：${detail}`);
}

/**
 * 分片上传单个大文件，返回 objectKey。
 * 传到一半中断后，重新选同一个文件会自动跳过 OSS 上已存在的分片接着传。
 */
async function putKbFileWithRetry(
  signed: PresignResult['files'][number],
  file: File,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= KB_PART_MAX_RETRY; attempt += 1) {
    try {
      const response = await fetch(signed.putUrl!, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': signed.contentType,
          ...(signed.cacheControl ? { 'Cache-Control': signed.cacheControl } : {}),
        },
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
      if (
        response.status >= 400
        && response.status < 500
        && response.status !== 408
        && response.status !== 429
      ) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < KB_PART_MAX_RETRY) await kbSleep(500 * 2 ** attempt);
  }
  const detail = lastError instanceof Error ? lastError.message : '未知错误';
  throw new Error(`OSS 直传失败（${file.name}）：${detail}`);
}

async function uploadKbFileInParts(
  file: File,
  kbId: string | undefined,
  onProgress?: (loaded: number, total: number) => void,
): Promise<KbUploadedObject> {
  const contentType = file.type || 'application/octet-stream';
  let checkpoint = readKbCheckpoint(file, kbId);
  let donePartNumbers = new Set<number>();

  // 有存档就先问 OSS 已经传了哪些片
  if (checkpoint) {
    try {
      const status = await requestJson<{ parts: Array<{ partNumber: number }> }>(
        `${kbBase(kbId)}/multipart/status`,
        {
          method: 'POST',
          body: JSON.stringify({ object_key: checkpoint.objectKey, upload_id: checkpoint.uploadId }),
        },
      );
      donePartNumbers = new Set(status.parts.map((p) => p.partNumber));
      // listParts 对已失效的 uploadId（被 OSS 生命周期规则中止/清理）返回空而非报错，
      // 所以上面的 catch 兜不住这种情况。续传发现一片都没有时，既无收益、又可能是拿着
      // 废 uploadId 去传导致每片 404 卡死 —— 直接丢弃存档重新 init 才安全。
      if (donePartNumbers.size === 0) {
        clearKbCheckpoint(file, kbId);
        checkpoint = null;
      }
    } catch {
      // uploadId 可能已被中止或清理，丢掉存档重新开始
      clearKbCheckpoint(file, kbId);
      checkpoint = null;
    }
  }

  if (!checkpoint) {
    const init = await requestJson<KbMultipartInit>(`${kbBase(kbId)}/multipart/init`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, content_type: contentType, file_size: file.size }),
    });
    if (!init.enabled || !init.objectKey || !init.uploadId || !init.partSize) {
      throw new Error('服务器未配置 OSS，无法上传大文件');
    }
    checkpoint = {
      objectKey: init.objectKey,
      uploadId: init.uploadId,
      partSize: init.partSize,
      savedAt: Date.now(),
      cleanupExp: init.cleanupExp,
      cleanupSig: init.cleanupSig,
    };
    writeKbCheckpoint(file, kbId, checkpoint);
  }

  const { objectKey, uploadId, partSize } = checkpoint;
  const partCount = Math.ceil(file.size / partSize);
  let loaded = Math.min(donePartNumbers.size * partSize, file.size);
  onProgress?.(loaded, file.size);

  const pending: number[] = [];
  for (let n = 1; n <= partCount; n++) {
    if (!donePartNumbers.has(n)) pending.push(n);
  }

  // 分批签名 + 批内并发上传
  for (let i = 0; i < pending.length; i += KB_SIGN_BATCH) {
    const batch = pending.slice(i, i + KB_SIGN_BATCH);
    const { urls } = await requestJson<{ urls: Array<{ partNumber: number; url: string | null }> }>(
      `${kbBase(kbId)}/multipart/sign`,
      {
        method: 'POST',
        body: JSON.stringify({ object_key: objectKey, upload_id: uploadId, part_numbers: batch }),
      },
    );

    await runWithConcurrency(urls, KB_PART_CONCURRENCY, async (item) => {
      if (!item.url) throw new Error(`第 ${item.partNumber} 片签名失败`);
      const start = (item.partNumber - 1) * partSize;
      const blob = file.slice(start, Math.min(start + partSize, file.size));
      await putKbPartWithRetry(item.url, blob, item.partNumber, file.name);
      loaded = Math.min(loaded + blob.size, file.size);
      onProgress?.(loaded, file.size);
    });
  }

  // 合并。几百片的合并比普通接口慢，用长超时，别让 30s 默认值误杀。
  await requestJson<{ ok: boolean; objectKey: string }>(`${kbBase(kbId)}/multipart/complete`, {
    method: 'POST',
    body: JSON.stringify({ object_key: objectKey, upload_id: uploadId, part_count: partCount }),
    timeoutMs: RD_AI_TIMEOUT_MS,
  });

  clearKbCheckpoint(file, kbId);
  return {
    objectKey,
    contentType,
    cleanupExp: checkpoint.cleanupExp,
    cleanupSig: checkpoint.cleanupSig,
  };
}

async function cleanupKbObjects(objects: KbUploadedObject[], kbId?: string): Promise<void> {
  if (objects.length === 0) return;
  await requestJson(`${kbBase(kbId)}/objects/cleanup`, {
    method: 'POST',
    body: JSON.stringify({
      files: objects.map((object) => ({
        object_key: object.objectKey,
        cleanup_exp: object.cleanupExp,
        cleanup_sig: object.cleanupSig,
      })),
    }),
  }).catch(() => undefined);
}

/**
 * Upload KB files with automatic path selection:
 *
 * When OSS is configured → browser-direct-upload (fast):
 *   1. GET presigned PUT URLs from server (tiny JSON)
 *   2. PUT files directly from browser to OSS in parallel (single hop, no server bottleneck)
 *   3. POST object keys to server to create KB entries (tiny JSON)
 *
 * 超过 KB_MULTIPART_THRESHOLD_BYTES 的文件自动改走分片上传（见上方），因为单次 PUT
 * 有 5GB 硬上限；其余文件维持原来的单次 PUT。
 *
 * When OSS is not configured → server-mediated fallback (original behavior):
 *   POST files as multipart/form-data to server → server stores as base64
 *
 * Prerequisite for direct upload: OSS bucket must have a CORS rule:
 *   AllowedOrigin: *   AllowedMethod: PUT   AllowedHeader: *
 */
export async function uploadKbFiles(params: {
  files: File[];
  category_id: string;
  description?: string;
  visibility?: string;
  permission_level?: number;
  tags?: string;
  /** 分片上传的进度回调。小文件走单次 PUT，拿不到进度，不会触发。 */
  onProgress?: (progress: { filename: string; loaded: number; total: number }) => void;
}, kbId?: string): Promise<KbEntry[]> {
  const largeIndexes: number[] = [];
  const smallIndexes: number[] = [];
  params.files.forEach((f, i) => {
    (f.size > KB_MULTIPART_THRESHOLD_BYTES ? largeIndexes : smallIndexes).push(i);
  });

  // 每个文件传完后的 objectKey，下标与 params.files 对齐
  const uploaded: Array<KbUploadedObject | null> = params.files.map(() => null);

  // ── 大文件：逐个分片传。单文件内部已并发 4 片，多个文件再并行只会互相抢带宽
  for (const i of largeIndexes) {
    const file = params.files[i]!;
    uploaded[i] = await uploadKbFileInParts(file, kbId, (loaded, total) =>
      params.onProgress?.({ filename: file.name, loaded, total }),
    );
  }

  // ── Step 1: request presigned PUT URLs（仅小文件需要）─────────────────────────
  let presign: PresignResult = { enabled: false, files: [] };
  if (smallIndexes.length > 0) {
    try {
      presign = await requestJson<PresignResult>(`${kbBase(kbId)}/presign-upload`, {
        method: 'POST',
        body: JSON.stringify({
          files: smallIndexes.map((i) => ({
            filename: params.files[i]!.name,
            content_type: params.files[i]!.type || 'application/octet-stream',
          })),
        }),
      });
    } catch (err) {
      // 已有大文件传上 OSS 时不能再回退到服务端中转：两条路径没法在一次建条目里表达，
      // 而且大文件本来就过不了 nginx 的 body 上限。直接把错误抛出去。
      if (largeIndexes.length > 0) {
        await cleanupKbObjects(uploaded.filter((item): item is KbUploadedObject => item !== null), kbId);
        throw err;
      }
      // 纯小文件时维持原行为：presign 失败就走服务端中转
      presign = { enabled: false, files: [] };
    }
  }

  // ── Path A: browser direct upload to OSS ───────────────────────────────────
  const canDirectUpload =
    smallIndexes.length === 0 ||
    (presign.enabled && presign.files.length === smallIndexes.length && presign.files.every((pf) => pf.putUrl));

  if (canDirectUpload) {
    // Upload all files to OSS in parallel — one HTTP hop per file, no server involved
    try {
      await Promise.all(
        presign.files.map((pf, k) => {
          const file = params.files[smallIndexes[k]!]!;
          return putKbFileWithRetry(pf, file);
        }),
      );
    } catch (error) {
      await cleanupKbObjects([
        ...uploaded.filter((item): item is KbUploadedObject => item !== null),
        ...presign.files.map((file) => ({
          objectKey: file.objectKey,
          contentType: file.contentType,
          cleanupExp: file.cleanupExp,
          cleanupSig: file.cleanupSig,
        })),
      ], kbId);
      throw error;
    }
    presign.files.forEach((pf, k) => {
      uploaded[smallIndexes[k]!] = {
        objectKey: pf.objectKey,
        contentType: pf.contentType,
        cleanupExp: pf.cleanupExp,
        cleanupSig: pf.cleanupSig,
      };
    });

    // Notify server to create KB entries for the already-uploaded objects
    return requestJson<KbEntry[]>(`${kbBase(kbId)}/entries/from-oss-keys`, {
      method: 'POST',
      body: JSON.stringify({
        oss_files: uploaded.map((u, i) => ({
          oss_key: u!.objectKey,
          filename: params.files[i]!.name,
          file_size: params.files[i]!.size,
          content_type: u!.contentType,
          cleanup_exp: u!.cleanupExp,
          cleanup_sig: u!.cleanupSig,
        })),
        category_id: params.category_id,
        description: params.description,
        visibility: params.visibility,
        permission_level: params.permission_level,
        tags: params.tags,
      }),
    });
  }

  // ── Path B: server-mediated upload (OSS not configured, or presign failed) ──
  if (largeIndexes.length > 0) {
    throw new Error('服务器未配置 OSS，无法上传大文件');
  }
  const fd = new FormData();
  for (const f of params.files) fd.append('files', f);
  fd.append('category_id', params.category_id);
  if (params.description) fd.append('description', params.description);
  if (params.visibility) fd.append('visibility', params.visibility);
  if (typeof params.permission_level === 'number') fd.append('permission_level', String(params.permission_level));
  if (params.tags) fd.append('tags', params.tags);
  // authFetch/readErrorMessage 顶部已经 import，无需 dynamic import（之前的写法会触发 Rollup 警告）
  const response = await authFetch(`${RD_API_BASE}${withWorkspace(`${kbBase(kbId)}/entries`)}`, { method: 'POST', body: fd });
  if (!response.ok) throw new Error(await readErrorMessage(response, '上传失败'));
  return (await response.json()) as KbEntry[];
}

export function recordKbView(id: string, kbId?: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`${kbBase(kbId)}/entries/${encodeURIComponent(id)}/view`, { method: 'POST' });
}

/** One-shot: ask the backend to fix garbled Latin-1 filenames on all KB entries. */
export function repairKbFilenames(): Promise<{ fixed: number; total: number }> {
  return requestJson<{ fixed: number; total: number }>('/knowledge/repair-filenames', { method: 'POST' });
}
