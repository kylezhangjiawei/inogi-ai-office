import { authFetch, readErrorMessage } from "./authSession";

export type VideoTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface VideoTask {
  id: string;
  mode: "i2v" | "t2v" | "r2v";
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
  created_at: string;
  updated_at: string;
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

  listVideos(page = 1, pageSize = 12) {
    return request<VideoListResponse>(
      `/api/video-generation/videos?page=${page}&pageSize=${pageSize}`,
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
