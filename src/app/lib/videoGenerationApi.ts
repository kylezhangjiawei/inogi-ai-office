import { authFetch, readErrorMessage } from "./authSession";

export type VideoTaskStatus = "pending" | "running" | "succeeded" | "failed";

/** 生成模式三种 + upload（本地上传入库，不是生成任务）。 */
export type VideoTaskMode = "i2v" | "t2v" | "r2v" | "upload";

export interface VideoTask {
  id: string;
  mode: VideoTaskMode;
  model: string;
  prompt: string;
  resolution: string;
  ratio: string | null;
  duration: number;
  status: VideoTaskStatus;
  video_url: string | null;
  billed_seconds: number;
  cost_yuan: number;
  error_message: string | null;
  conversation_id: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 视频作品库分类（与图像作品库同构：最多 3 层树、同级不重名）。 */
export interface VideoCategory {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  color: string;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 当前用户直接挂在该节点上的视频数 */
  itemCount: number;
  /** 含所有子孙分类的视频数，与「选中父分类看到的列表」同口径 */
  totalItemCount: number;
  /** 层号，根为 1 */
  depth: number;
  /** 从根到本节点的名称路径 */
  path: string;
  children: VideoCategory[];
}

export interface VideoCategoryListResponse {
  items: VideoCategory[];
  uncategorizedCount: number;
  totalCount: number;
}

export interface VideoListResponse {
  items: VideoTask[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface VideoGateEvaluation {
  mode: "off" | "threshold" | "always";
  estimate_yuan: number;
  auto_threshold_yuan: number;
  budget_cap_yuan: number | null;
  spent_yuan: number | null;
  remaining_yuan: number | null;
  require_confirm: boolean;
  blocked: boolean;
}

export interface VideoCostGateConfig {
  mode: "off" | "threshold" | "always";
  autoThresholdYuan: number;
  budgetCapYuan: number | null;
}

export interface CreateVideoPayload {
  mode: "i2v" | "t2v" | "r2v";
  prompt: string;
  source_image_urls?: string[];
  source_image_refs?: string[];
  /** 上传文件 id（工作台上传图片后传入），服务端解析为 OSS 直连 URL */
  source_file_ids?: string[];
  resolution?: "720P" | "1080P";
  ratio?: string;
  duration?: number;
  watermark?: boolean;
  seed?: number;
  model_id?: string;
  conversation_id?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `请求失败：${response.status}`));
  }
  return (await response.json()) as T;
}

export const videoGenerationApi = {
  submit(payload: CreateVideoPayload) {
    return request<VideoTask>("/api/video-generation/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  getTask(id: string) {
    return request<VideoTask>(`/api/video-generation/tasks/${id}`);
  },

  listVideos(page = 1, pageSize = 12, categoryId?: string) {
    const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (categoryId) search.set("categoryId", categoryId);
    return request<VideoListResponse>(`/api/video-generation/videos?${search.toString()}`);
  },

  /** 本地视频入库：fileId 来自 uploadResourceFile（businessType=library/videos）。 */
  uploadVideo(payload: {
    fileId: string;
    categoryId?: string | null;
    title?: string;
    duration?: number;
    resolution?: string;
  }) {
    return request<VideoTask>("/api/video-generation/videos/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  /** 删除自己的视频（含 OSS 上的文件）。 */
  deleteVideo(id: string) {
    return request<{ ok: boolean }>(`/api/video-generation/videos/${id}`, { method: "DELETE" });
  },

  // ── 作品库分类 ──────────────────────────────────────────────────────────
  listCategories() {
    return request<VideoCategoryListResponse>("/api/video-generation/categories");
  },

  createCategory(payload: { name: string; parentId?: string | null; description?: string; color?: string }) {
    return request<VideoCategory>("/api/video-generation/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updateCategory(
    id: string,
    payload: { name?: string; parentId?: string | null; description?: string; color?: string },
  ) {
    return request<VideoCategory>(`/api/video-generation/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteCategory(id: string) {
    return request<{
      ok: boolean;
      detachedVideoCount: number;
      deletedCategoryCount: number;
      deletedCategoryIds: string[];
    }>(`/api/video-generation/categories/${id}`, { method: "DELETE" });
  },

  assignCategory(videoId: string, categoryId: string | null) {
    return request<{ id: string; categoryId: string | null }>(
      `/api/video-generation/videos/${videoId}/category`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      },
    );
  },

  costGate(resolution: string, duration: number) {
    return request<VideoGateEvaluation>(
      `/api/video-generation/cost-gate?resolution=${encodeURIComponent(resolution)}&duration=${duration}`,
    );
  },

  getCostGateConfig() {
    return request<VideoCostGateConfig>("/api/video-generation/cost-gate/config");
  },

  saveCostGateConfig(payload: {
    mode: "off" | "threshold" | "always";
    autoThresholdYuan?: number;
    budgetCapYuan?: number | null;
  }) {
    return request<VideoCostGateConfig>("/api/video-generation/cost-gate/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  /** 图片/视频反推提示词：传 base64 data URL（视频传关键帧），返回可用于生成的提示词 */
  reversePrompt(images: string[], kind: "image" | "video") {
    return request<{ prompt: string; model: string }>("/api/chat/reverse-video-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, kind }),
    });
  },
};
