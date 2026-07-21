import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Eye,
  Heart,
  Loader2,
  MessageSquare,
  PencilLine,
  RefreshCw,
  Send,
  Sparkles,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { authFetch, readErrorMessage } from "./lib/authSession";
import type { AiModelOption } from "./lib/aiModelOptions";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ArtworkVariant = "product" | "brand" | "ui" | "metallic";
export type Style = "vivid" | "natural";
export type Size = "1024x1024" | "1792x1024" | "1024x1792";

export type GeneratedImage = {
  id: string;
  prompt: string;
  revisedPrompt: string;
  style: Style;
  size: Size;
  quality: string;
  imageData?: string;
  imageUrl?: string | null;
  model: string;
  isFavorite: boolean;
  createdAt: string;
  requestId?: string | null;
  parentImageId?: string | null;
  rootImageId?: string | null;
  editInstruction?: string;
  editDepth?: number;
  upstreamCallCount?: number;
  upstreamRetryCount?: number;
  upstreamErrorCount?: number;
  inputTokens?: number;
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  cumulativeEstimatedCostUsd?: number;
  usageDetails?: unknown;
  conversation?: ImageConversationResponse;
  fromCache?: boolean;
  similarity?: number;
};

export type ImageEditMessage = {
  id: string;
  role: string;
  content: string;
  model?: string | null;
  requestId?: string | null;
  sourceImageId?: string | null;
  resultImageId?: string | null;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cumulativeEstimatedCostUsd: number;
  createdAt: string;
};

export type ImageConversationResponse = {
  rootImageId: string;
  currentImageId: string;
  summary: {
    versionCount: number;
    editCount: number;
    estimatedCostUsd: number;
  };
  versions: GeneratedImage[];
  messages: ImageEditMessage[];
};

export type PromptChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  optimizedPrompt?: string;
  model?: string | null;
  requestId?: string | null;
  createdAt?: string;
};

export type PromptChatSession = {
  id: string;
  title: string;
  sourcePrompt: string;
  currentPrompt: string;
  model?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptChatSessionDetail = {
  session: PromptChatSession;
  messages: PromptChatMessage[];
};

export type ReferenceImageItem = {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  compressed: boolean;
};

export type ListResponse = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: GeneratedImage[];
};

export type ImageUsageEntry = {
  id: string;
  createdAt: string;
  status: string;
  operation: string;
  model: string;
  normalizedSize?: string | null;
  attempt: number;
  inputImageTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  errorMessage?: string | null;
};

export type ImageUsageResponse = {
  date: string;
  timezone: string;
  summary: {
    upstreamCalls: number;
    successCalls: number;
    errorCalls: number;
    retryCalls: number;
    generateCalls: number;
    editCalls: number;
    inputImageTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  entries: ImageUsageEntry[];
};

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_PROMPT_LENGTH = 32_000;
export const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPSTREAM_REFERENCE_IMAGE_BYTES = 850 * 1024;
const MAX_REFERENCE_IMAGE_DIMENSION = 2048;
const MIN_REFERENCE_IMAGE_DIMENSION = 768;
const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const ratios: Array<{ label: string; value: Size; shortLabel: string }> = [
  { label: "1:1 方图", value: "1024x1024", shortLabel: "1:1" },
  { label: "16:9 横图", value: "1792x1024", shortLabel: "16:9" },
  { label: "9:16 竖图", value: "1024x1792", shortLabel: "9:16" },
];

export const glassCard =
  "border border-border/85 bg-surface-container-lowest/94 shadow-[0_18px_44px_rgba(15,23,42,0.055)] ring-1 ring-white/75 backdrop-blur-xl";

// ─── API ────────────────────────────────────────────────────────────────────

type GenerateTaskStatus = "pending" | "processing" | "completed" | "failed";

type GenerateTaskResponse = {
  taskId: string;
  status: GenerateTaskStatus;
  result?: GeneratedImage;
  error?: string;
};

const GENERATE_POLL_INTERVAL_MS = 2000;
// 前端轮询兜底超时与后端图片上游超时对齐（后端默认 20min，env OPENAI_IMAGE_TIMEOUT_MS），
// 给偏慢的生成（gpt-image 实测可达 ~300s+）留足时间，避免在后端跑完前被前端误判为「图片处理超时」。
const GENERATE_POLL_TIMEOUT_MS = 20 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// 轮询异步图片任务（生成 / 编辑通用），直到完成或失败。
async function pollImageTask(taskId: string, fallbackMessage: string): Promise<GeneratedImage> {
  const deadline = Date.now() + GENERATE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(GENERATE_POLL_INTERVAL_MS);
    const poll = await authFetch(`/api/image-generation/tasks/${taskId}`);
    if (!poll.ok) {
      throw new Error(await readErrorMessage(poll, fallbackMessage));
    }
    const task = (await poll.json()) as GenerateTaskResponse;
    if (task.status === "completed" && task.result) {
      return task.result;
    }
    if (task.status === "failed") {
      throw new Error(task.error || fallbackMessage);
    }
  }
  throw new Error("图片处理超时，请稍后重试");
}

// 异步生成：先提交任务拿到 taskId，再轮询任务状态直到完成/失败。
// 函数签名与返回值（GeneratedImage）保持不变，调用方无需改动；
// 这样生成请求不再保持长连接，避免网关 504。
export async function apiGenerate(body: {
  prompt: string;
  style: Style;
  size: Size;
  model_id?: string;
  model?: string;
  reference_image_data?: string;
  reference_image_data_list?: string[];
  skip_cache?: boolean;
}): Promise<GeneratedImage> {
  const submit = await authFetch("/api/image-generation/generate/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    throw new Error(await readErrorMessage(submit, "图片生成失败"));
  }
  const { taskId } = (await submit.json()) as GenerateTaskResponse;
  if (!taskId) {
    throw new Error("图片生成任务创建失败，请重试");
  }
  return pollImageTask(taskId, "图片生成失败");
}

// 异步编辑：与 apiGenerate 相同的「提交 + 轮询」模式，签名/返回值不变。
export async function apiEditImage(
  id: string,
  body: {
    message: string;
    style?: Style;
    size?: Size;
    model_id?: string;
    model?: string;
    reference_image_data?: string;
  },
): Promise<GeneratedImage> {
  const submit = await authFetch(`/api/image-generation/images/${id}/edit/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    throw new Error(await readErrorMessage(submit, "图片修改失败"));
  }
  const { taskId } = (await submit.json()) as GenerateTaskResponse;
  if (!taskId) {
    throw new Error("图片修改任务创建失败，请重试");
  }
  return pollImageTask(taskId, "图片修改失败");
}

export async function apiImageConversation(id: string): Promise<ImageConversationResponse> {
  const response = await authFetch(`/api/image-generation/images/${id}/conversation`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片对话加载失败"));
  }
  return response.json() as Promise<ImageConversationResponse>;
}

export async function apiPromptSessions(): Promise<PromptChatSession[]> {
  const response = await authFetch("/api/image-generation/prompt-sessions");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化会话加载失败"));
  }
  return response.json() as Promise<PromptChatSession[]>;
}

export async function apiCreatePromptSession(body: {
  title?: string;
  source_prompt?: string;
  current_prompt?: string;
}): Promise<PromptChatSessionDetail> {
  const response = await authFetch("/api/image-generation/prompt-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化会话创建失败"));
  }
  return response.json() as Promise<PromptChatSessionDetail>;
}

export async function apiPromptSession(id: string): Promise<PromptChatSessionDetail> {
  const response = await authFetch(`/api/image-generation/prompt-sessions/${id}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化会话加载失败"));
  }
  return response.json() as Promise<PromptChatSessionDetail>;
}

export async function apiPromptChat(body: {
  session_id?: string;
  current_prompt: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model_id?: string;
  model?: string;
}): Promise<{
  reply: string;
  optimizedPrompt: string;
  model: string;
  requestId: string;
  session: PromptChatSession;
  messages: PromptChatMessage[];
}> {
  const response = await authFetch("/api/image-generation/prompt-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化失败"));
  }
  return response.json() as Promise<{
    reply: string;
    optimizedPrompt: string;
    model: string;
    requestId: string;
    session: PromptChatSession;
    messages: PromptChatMessage[];
  }>;
}

export async function apiList(
  page: number,
  pageSize: number,
  options: { favorite?: boolean; dateFrom?: string; dateTo?: string; query?: string } = {},
): Promise<ListResponse> {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    favorite: String(Boolean(options.favorite)),
  });
  if (options.dateFrom) search.set("dateFrom", options.dateFrom);
  if (options.dateTo) search.set("dateTo", options.dateTo);
  const query = options.query?.trim();
  if (query) search.set("query", query);

  const response = await authFetch(`/api/image-generation/images?${search.toString()}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片列表加载失败"));
  }
  return response.json() as Promise<ListResponse>;
}

export async function apiUsage(): Promise<ImageUsageResponse> {
  const response = await authFetch("/api/image-generation/usage");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片用量加载失败"));
  }
  return response.json() as Promise<ImageUsageResponse>;
}

export async function apiToggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const response = await authFetch(`/api/image-generation/images/${id}/favorite`, { method: "PATCH" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "收藏状态更新失败"));
  }
  return response.json() as Promise<{ id: string; isFavorite: boolean }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type DateRangeKey = "all" | "today" | "7d" | "30d";

/** Local-day bounds for a relative range; `dateTo` is the exclusive next-midnight. */
export function getDateRangeBounds(range: DateRangeKey): { dateFrom?: string; dateTo?: string } {
  if (range === "all") return {};
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (range === "7d") start.setDate(start.getDate() - 6);
  else if (range === "30d") start.setDate(start.getDate() - 29);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatUsd(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function formatImageCost(item: GeneratedImage) {
  const cost = item.estimatedCostUsd ?? 0;
  if (cost > 0) return formatUsd(cost);
  return (item.upstreamCallCount ?? 0) > 0 ? "未返回用量" : "无新增成本";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("参考图解析失败，请更换图片后重试"));
    };
    image.src = url;
  });
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("参考图解析失败，请更换图片后重试"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("参考图压缩失败，请更换图片后重试"));
    }, type, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(blob);
  });
}

function getDataUrlByteSize(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export async function prepareReferenceImage(file: File) {
  if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(file.type)) {
    throw new Error("参考图仅支持 PNG、JPG 或 WebP");
  }

  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const initialScale = Math.min(1, MAX_REFERENCE_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));

  if (file.size <= MAX_REFERENCE_IMAGE_BYTES && initialScale === 1) {
    return { dataUrl: await readFileAsDataUrl(file), size: file.size, compressed: false };
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持参考图压缩");
  }

  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));
  let bestBlob: Blob | null = null;
  const qualities = [0.86, 0.78, 0.68, 0.58];

  while (Math.max(width, height) >= MIN_REFERENCE_IMAGE_DIMENSION) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      bestBlob = blob;
      if (blob.size <= MAX_REFERENCE_IMAGE_BYTES) {
        return { dataUrl: await blobToDataUrl(blob), size: blob.size, compressed: true };
      }
    }

    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
  }

  if (bestBlob && bestBlob.size <= MAX_REFERENCE_IMAGE_BYTES * 1.2) {
    return { dataUrl: await blobToDataUrl(bestBlob), size: bestBlob.size, compressed: true };
  }

  throw new Error(`参考图压缩后仍超过 ${formatFileSize(MAX_REFERENCE_IMAGE_BYTES)}，请上传更小的图片`);
}

export async function compressDataUrlForUpstream(dataUrl: string, targetBytes: number, minDimension = 512) {
  const currentSize = getDataUrlByteSize(dataUrl);
  if (currentSize <= targetBytes) {
    return { dataUrl, size: currentSize, compressed: false };
  }

  const image = await loadImageFromDataUrl(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const initialScale = Math.min(1, MAX_REFERENCE_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持参考图压缩");
  }

  let width = Math.max(1, Math.round(sourceWidth * initialScale));
  let height = Math.max(1, Math.round(sourceHeight * initialScale));
  let bestBlob: Blob | null = null;
  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42];

  while (Math.max(width, height) >= minDimension) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      bestBlob = blob;
      if (blob.size <= targetBytes) {
        return { dataUrl: await blobToDataUrl(blob), size: blob.size, compressed: true };
      }
    }

    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
  }

  if (bestBlob && bestBlob.size <= targetBytes * 1.15) {
    return { dataUrl: await blobToDataUrl(bestBlob), size: bestBlob.size, compressed: true };
  }

  throw new Error(`参考图压缩后仍超过代理限制，请减少参考图数量或调大 nginx client_max_body_size`);
}

export async function prepareReferenceImagesForSubmit(items: ReferenceImageItem[]) {
  if (items.length === 0) return { dataUrls: [] as string[], compressedCount: 0, totalSize: 0 };

  const perImageBudget = Math.max(48 * 1024, Math.floor(MAX_UPSTREAM_REFERENCE_IMAGE_BYTES / items.length) - 2048);
  const minDimension = items.length > 8 ? 256 : items.length > 4 ? 384 : 512;
  const prepared = await Promise.all(
    items.map((item) => compressDataUrlForUpstream(item.dataUrl, perImageBudget, minDimension)),
  );
  const totalSize = prepared.reduce((sum, item) => sum + item.size, 0);
  if (totalSize > MAX_UPSTREAM_REFERENCE_IMAGE_BYTES * 1.1) {
    throw new Error(`参考图总大小 ${formatFileSize(totalSize)} 超过代理限制，请减少参考图数量或调大 nginx client_max_body_size`);
  }
  return {
    dataUrls: prepared.map((item) => item.dataUrl),
    compressedCount: prepared.filter((item) => item.compressed).length,
    totalSize,
  };
}

// ─── Presentational components ────────────────────────────────────────────────

export function MiniPreview({ imageData, imageUrl }: { imageData?: string; imageUrl?: string | null }) {
  const src = imageUrl || imageData;
  return (
    <div className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl border border-white/70 bg-slate-100">
      {src ? <img src={src} alt="作品缩略图" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

export function ArtworkCard({
  item,
  index,
  busy,
  onPreview,
  onDownload,
  onEdit,
  onFavorite,
}: {
  item: GeneratedImage;
  index: number;
  busy?: boolean;
  onPreview: (item: GeneratedImage) => void;
  onDownload: (item: GeneratedImage) => void;
  onEdit: (item: GeneratedImage) => void;
  onFavorite: (item: GeneratedImage) => void;
}) {
  const title = item.revisedPrompt || item.prompt;
  const description = `${item.model} · ${formatTime(item.createdAt)}`;
  const outputTokens = item.outputTokens ?? 0;
  const retryCount = item.upstreamRetryCount ?? 0;
  const editDepth = item.editDepth ?? 0;
  const cumulativeCost = item.cumulativeEstimatedCostUsd ?? item.estimatedCostUsd ?? 0;

  return (
    <article className="group overflow-hidden rounded-[10px] border border-border/80 bg-surface-container-lowest shadow-[0_16px_34px_rgba(15,23,42,0.055)] ring-1 ring-white/70 transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_24px_48px_rgba(15,23,42,0.1)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <img src={item.imageUrl || item.imageData} alt={item.prompt} className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.04)_0%,transparent_42%,rgba(15,23,42,0.2)_100%)] opacity-80 transition group-hover:opacity-60" />
        <div className="absolute left-4 top-4 rounded-[8px] border border-white/25 bg-slate-950/68 px-3 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md">
          {String(index + 1).padStart(2, "0")}
        </div>
        {item.fromCache ? (
          <div className="absolute right-4 top-4 rounded-[8px] border border-emerald-100 bg-emerald-50/88 px-3 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur-md">
            缓存命中
          </div>
        ) : null}
        <div className="absolute inset-x-4 bottom-4 grid grid-cols-4 overflow-hidden rounded-[8px] border border-white/60 bg-white/88 text-[11px] font-semibold text-slate-700 opacity-95 shadow-[0_16px_32px_rgba(15,23,42,0.2)] backdrop-blur-xl transition md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
          <button className="flex cursor-pointer items-center justify-center gap-1.5 px-2 py-2 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="button" onClick={() => onPreview(item)}>
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button className="flex cursor-pointer items-center justify-center gap-1.5 px-2 py-2 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="button" onClick={() => onDownload(item)}>
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
          <button className="flex cursor-pointer items-center justify-center gap-1.5 px-2 py-2 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="button" onClick={() => onEdit(item)}>
            <PencilLine className="h-3.5 w-3.5" />
            修改
          </button>
          <button className="flex cursor-pointer items-center justify-center gap-1.5 px-2 py-2 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => onFavorite(item)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-rose-500 text-rose-500" : "")} />}
            收藏
          </button>
        </div>
      </div>
      <div className="px-5 py-4">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 tracking-tight text-slate-950">{title}</h3>
        <p className="mt-2 truncate text-xs leading-5 text-slate-500">{description}</p>
        <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[8px] border border-border bg-surface-container-low px-3 py-2 text-[11px] text-slate-500">
          <span className="font-mono font-semibold tabular-nums text-slate-900">{formatImageCost(item)}</span>
          <span className="truncate text-right font-mono tabular-nums">
            {editDepth > 0 ? `累计 ${formatUsd(cumulativeCost)}` : `output ${outputTokens > 0 ? outputTokens.toLocaleString("zh-CN") : "-"}`}
            {retryCount > 0 ? ` · 重试 ${retryCount}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}

export function GeneratingImageCard() {
  return (
    <div className="relative min-h-[260px] overflow-hidden rounded-[10px] border border-primary/15 bg-surface-container-lowest shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--surface-container-lowest)_0%,var(--surface-container-low)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-primary motion-reduce:animate-none" />
      <div className="absolute inset-x-5 top-5 flex items-center justify-between">
        <span className="rounded-[8px] border border-primary/15 bg-white/86 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
          生成中
        </span>
        <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" />
      </div>
      <div className="relative flex h-full min-h-[260px] flex-col items-center justify-center px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[10px] bg-white text-slate-950 shadow-[0_14px_30px_rgba(15,23,42,0.12)]">
          <Sparkles className="h-7 w-7" />
        </div>
        <div className="mt-5 text-base font-semibold text-slate-950">AI 正在生成图片</div>
        <div className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
          已提交到图像模型，生成高清图片通常需要几十秒，请保持当前页面。
        </div>
        <div className="mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/60">
          <div className="h-full w-1/2 animate-[pulse_1.3s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

export async function downloadGeneratedImage(item: GeneratedImage) {
  const src = item.imageUrl || item.imageData;
  if (!src) return;
  const link = document.createElement("a");
  if (item.imageUrl) {
    try {
      const resp = await fetch(item.imageUrl);
      const blob = await resp.blob();
      link.href = URL.createObjectURL(blob);
      link.download = `ai-image-${item.id}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    } catch {
      window.open(item.imageUrl, "_blank");
      return;
    }
  }
  link.href = src;
  link.download = `ai-image-${item.id}.png`;
  link.click();
}

export function ImagePreviewModal({ item, onClose }: { item: GeneratedImage; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex h-[70dvh] w-[70dvw] max-w-[calc(100vw-32px)] items-center justify-center overflow-hidden rounded-[18px] border border-white/15 bg-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.42)]"
        onClick={(event) => event.stopPropagation()}
      >
        <img src={item.imageUrl || item.imageData} alt={item.prompt} className="h-full w-full object-contain" />
        <button
          className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/92 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          type="button"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Self-contained image edit modal: loads its own conversation, runs edits, and
 * bubbles each new version up via onUpdated so the host page can refresh lists.
 */
export function ImageEditModal({
  item,
  modelOption,
  onClose,
  onUpdated,
  onReuse,
}: {
  item: GeneratedImage;
  modelOption: AiModelOption;
  onClose: () => void;
  onUpdated: (updated: GeneratedImage) => void;
  onReuse?: (item: GeneratedImage) => void;
}) {
  const [current, setCurrent] = useState<GeneratedImage>(item);
  const [editInstruction, setEditInstruction] = useState("");
  const [editingImage, setEditingImage] = useState(false);
  const [conversation, setConversation] = useState<ImageConversationResponse | null>(item.conversation ?? null);
  const [conversationLoading, setConversationLoading] = useState(false);

  useEffect(() => {
    setCurrent(item);
    setEditInstruction("");
    setConversation(item.conversation ?? null);
    let cancelled = false;
    setConversationLoading(true);
    apiImageConversation(item.id)
      .then((response) => {
        if (!cancelled) setConversation(response);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "图片对话加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setConversationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  async function handleEditImage() {
    const message = editInstruction.trim();
    if (!message) {
      toast.error("请先输入修改要求");
      return;
    }
    if (message.length > MAX_PROMPT_LENGTH) {
      toast.error(`修改要求不能超过 ${MAX_PROMPT_LENGTH} 个字符`);
      return;
    }

    setEditingImage(true);
    try {
      let referenceDataUrl: string | undefined;
      if (current.imageData) {
        const sourceReference = await compressDataUrlForUpstream(current.imageData, MAX_UPSTREAM_REFERENCE_IMAGE_BYTES);
        if (sourceReference.compressed) {
          toast.info(`已压缩当前图片用于提交，大小 ${formatFileSize(sourceReference.size)}`);
        }
        referenceDataUrl = sourceReference.dataUrl;
      }
      const result = await apiEditImage(current.id, {
        message,
        style: "vivid",
        size: current.size,
        model_id: modelOption.managed ? modelOption.modelId : undefined,
        model: modelOption.model,
        reference_image_data: referenceDataUrl,
      });
      setEditInstruction("");
      setCurrent(result);
      if (result.conversation) {
        setConversation(result.conversation);
      } else {
        try {
          setConversation(await apiImageConversation(result.id));
        } catch {
          /* keep previous conversation */
        }
      }
      onUpdated(result);
      toast.success("已生成新的修改版本");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片修改失败");
    } finally {
      setEditingImage(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-3 backdrop-blur-sm md:p-4 xl:p-8" role="dialog" aria-modal="true">
      <div className="flex max-h-[calc(100vh-24px)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] xl:max-h-[calc(100vh-64px)]">
        <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200/70 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-950">图片修改</div>
            <div className="mt-1 max-w-2xl truncate text-xs text-slate-500">{current.prompt}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
              <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">成本 {formatImageCost(current)}</span>
              <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                output {(current.outputTokens ?? 0) > 0 ? (current.outputTokens ?? 0).toLocaleString("zh-CN") : "-"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                调用 {current.upstreamCallCount ?? 0}
                {(current.upstreamRetryCount ?? 0) > 0 ? ` · 重试 ${current.upstreamRetryCount}` : ""}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onReuse ? (
              <button className="h-9 cursor-pointer rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" type="button" onClick={() => onReuse(current)}>
                复用提示词
              </button>
            ) : null}
            <button className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" type="button" onClick={onClose} aria-label="关闭图片修改">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[260px] bg-slate-100 md:min-h-0">
            <img src={current.imageUrl || current.imageData} alt={current.prompt} className="h-full w-full object-contain" />
          </div>
          <aside className="flex min-h-0 max-h-[46vh] flex-col border-t border-slate-200/70 bg-white md:max-h-none md:border-l md:border-t-0">
            <div className="shrink-0 border-b border-slate-200/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <MessageSquare className="h-4 w-4 text-indigo-500" />
                AI 修改对话
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                  <div className="text-slate-500">当前版本</div>
                  <div className="mt-1 font-semibold text-slate-900">v{(current.editDepth ?? 0) + 1}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                  <div className="text-slate-500">累计费用</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {formatUsd(conversation?.summary.estimatedCostUsd ?? current.cumulativeEstimatedCostUsd ?? current.estimatedCostUsd ?? 0)}
                  </div>
                </div>
              </div>
            </div>
            <div className="material-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
              {conversationLoading ? (
                <div className="flex h-24 items-center justify-center text-xs font-semibold text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                  正在加载对话...
                </div>
              ) : conversation?.messages.length ? (
                conversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-2xl px-3 py-2 text-xs leading-5",
                      message.role === "user" ? "ml-8 bg-slate-950 text-white" : "mr-8 border border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    <div>{message.content}</div>
                    {message.role === "assistant" ? (
                      <div className="mt-1 text-[11px] text-slate-500">
                        本次 {message.estimatedCostUsd > 0 ? formatUsd(message.estimatedCostUsd) : "未返回用量"} · 累计 {formatUsd(message.cumulativeEstimatedCostUsd)}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-xs leading-5 text-slate-500">
                  输入修改要求后会保存完整上下文。后续可以继续说“再亮一点”“保持构图但换成蓝色背景”等，AI 会结合前文和当前图片处理。
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-slate-200/70 p-4">
              <textarea
                className="h-24 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                value={editInstruction}
                onChange={(event) => setEditInstruction(event.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder="告诉 AI 如何修改当前图片..."
              />
              <button
                type="button"
                className="mt-3 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editingImage || !editInstruction.trim()}
                onClick={() => void handleEditImage()}
              >
                {editingImage ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
                {editingImage ? "正在修改..." : "发送并生成新版本"}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function buildPageList(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

/** Numbered pager in the glass visual language; renders nothing for a single page. */
export function Pager({
  page,
  totalPages,
  onChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (totalPages <= 1) return null;
  const base =
    "flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-[12px] border px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";
  const inactive = "border-border bg-surface-container-lowest text-slate-600 hover:border-primary/30 hover:text-primary";
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label="分页">
      <button
        type="button"
        className={cn(base, inactive)}
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="上一页"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {buildPageList(page, totalPages).map((entry, index) =>
        entry === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="flex h-9 min-w-9 items-center justify-center text-xs text-slate-400">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            aria-current={entry === page ? "page" : undefined}
            className={cn(base, entry === page ? "border-transparent bg-primary text-primary-foreground shadow-sm" : inactive)}
            disabled={disabled}
            onClick={() => onChange(entry)}
          >
            {entry}
          </button>
        ),
      )}
      <button
        type="button"
        className={cn(base, inactive)}
        disabled={disabled || page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="下一页"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

const USAGE_LOG_PAGE_SIZE = 8;
const OPERATION_COLORS: Record<string, string> = { 文生图: "#4f46e5", 图生图: "#06b6d4" };
const MODEL_BAR_COLORS = ["#4f46e5", "#6366f1", "#818cf8", "#06b6d4", "#22d3ee", "#14b8a6"];
const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
} as const;

function formatDurationMs(ms: number) {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortenModelName(model: string) {
  return model.length > 16 ? `${model.slice(0, 15)}…` : model;
}

function UsageStatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-container-low p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-slate-950">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function ImageUsagePanel({
  usage,
  loading,
  onRefresh,
}: {
  usage: ImageUsageResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [logPage, setLogPage] = useState(1);
  const summary = usage?.summary ?? null;
  const entries = usage?.entries ?? [];

  const successRate =
    summary && summary.upstreamCalls > 0 ? Math.round((summary.successCalls / summary.upstreamCalls) * 100) : 0;
  const avgDurationMs = entries.length
    ? Math.round(entries.reduce((acc, entry) => acc + (entry.durationMs || 0), 0) / entries.length)
    : 0;

  const operationData = useMemo(() => {
    if (!summary) return [] as Array<{ name: string; value: number }>;
    return [
      { name: "文生图", value: summary.generateCalls },
      { name: "图生图", value: summary.editCalls },
    ].filter((item) => item.value > 0);
  }, [summary]);

  const modelData = useMemo(() => {
    const map = new Map<string, { model: string; cost: number; calls: number }>();
    for (const entry of entries) {
      const key = entry.model || "未知模型";
      const current = map.get(key) ?? { model: key, cost: 0, calls: 0 };
      current.cost += entry.estimatedCostUsd || 0;
      current.calls += 1;
      map.set(key, current);
    }
    return Array.from(map.values())
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6);
  }, [entries]);

  const logTotalPages = Math.max(1, Math.ceil(entries.length / USAGE_LOG_PAGE_SIZE));
  useEffect(() => {
    if (logPage > logTotalPages) setLogPage(1);
  }, [logPage, logTotalPages]);
  const pagedEntries = useMemo(
    () => entries.slice((logPage - 1) * USAGE_LOG_PAGE_SIZE, logPage * USAGE_LOG_PAGE_SIZE),
    [entries, logPage],
  );

  return (
    <section className={cn("relative overflow-hidden rounded-[16px] p-5", glassCard)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">用量监控</h2>
          <p className="mt-1 text-xs text-slate-500">
            {usage ? `${usage.date} · ${usage.timezone} · 按 UTC 日统计上游调用` : "按 UTC 日统计上游调用"}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[12px] border border-border bg-surface-container-lowest px-3 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading ? "animate-spin motion-reduce:animate-none" : "")} />
          {loading ? "刷新中" : "刷新"}
        </button>
      </div>

      {!usage || !summary ? (
        <div className="rounded-[12px] border border-dashed border-border bg-surface-container-lowest/70 px-4 py-12 text-center text-xs leading-5 text-slate-500">
          {loading ? "正在加载用量..." : "暂无上游调用记录。新生成图片后会显示 token 和预估费用。"}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            <UsageStatCard icon={Coins} label="预估费用" value={formatUsd(summary.estimatedCostUsd)} />
            <UsageStatCard
              icon={Activity}
              label="上游调用"
              value={String(summary.upstreamCalls)}
              hint={`成功 ${summary.successCalls} · 失败 ${summary.errorCalls}`}
            />
            <UsageStatCard icon={CheckCircle2} label="成功率" value={`${successRate}%`} hint={`重试 ${summary.retryCalls} 次`} />
            <UsageStatCard icon={Timer} label="平均耗时" value={formatDurationMs(avgDurationMs)} />
            <UsageStatCard icon={Sparkles} label="文生图 / 图生图" value={`${summary.generateCalls} / ${summary.editCalls}`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[12px] border border-border bg-surface-container-lowest/70 p-4">
              <div className="text-xs font-semibold text-slate-700">操作构成</div>
              {operationData.length ? (
                <div className="mt-1">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={operationData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {operationData.map((entry) => (
                          <Cell key={entry.name} fill={OPERATION_COLORS[entry.name] ?? "#a5b4fc"} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number, name: string) => [`${value} 次`, name]} contentStyle={CHART_TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-xs text-slate-400">今日暂无调用</div>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                {operationData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: OPERATION_COLORS[entry.name] ?? "#a5b4fc" }} />
                    {entry.name} · {entry.value}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[12px] border border-border bg-surface-container-lowest/70 p-4">
              <div className="text-xs font-semibold text-slate-700">按模型预估费用</div>
              {modelData.length ? (
                <div className="mt-1">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={modelData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid horizontal={false} stroke="#eef2f7" />
                      <XAxis type="number" tickFormatter={(value) => formatUsd(value as number)} style={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis type="category" dataKey="model" width={120} tickFormatter={shortenModelName} style={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip
                        formatter={(value: number) => [formatUsd(value), "预估费用"]}
                        cursor={{ fill: "rgba(79,70,229,0.06)" }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                      />
                      <Bar dataKey="cost" radius={[0, 6, 6, 0]}>
                        {modelData.map((entry, index) => (
                          <Cell key={entry.model} fill={MODEL_BAR_COLORS[index % MODEL_BAR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[200px] items-center justify-center text-xs text-slate-400">今日暂无调用</div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-border bg-white/60">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
              <div className="text-xs font-semibold text-slate-700">调用明细</div>
              <div className="text-[11px] text-slate-400">共 {entries.length} 条</div>
            </div>
            {entries.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[11px]">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="px-4 py-2 font-medium">时间</th>
                        <th className="px-3 py-2 font-medium">操作</th>
                        <th className="px-3 py-2 font-medium">尺寸</th>
                        <th className="px-3 py-2 font-medium">模型</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 text-right font-medium">输出 tokens</th>
                        <th className="px-3 py-2 text-right font-medium">耗时</th>
                        <th className="px-4 py-2 text-right font-medium">费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => {
                        const ok = entry.status === "success" || entry.status === "succeeded" || entry.status === "ok";
                        const failed = entry.status === "error" || entry.status === "failed";
                        return (
                          <tr key={entry.id} className="border-t border-border/60 text-slate-600">
                            <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatTime(entry.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{entry.operation === "edit" ? "图生图" : "文生图"}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-500">{entry.normalizedSize || "—"}</td>
                            <td className="px-3 py-2 text-slate-500">{shortenModelName(entry.model || "—")}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  ok ? "bg-emerald-50 text-emerald-600" : failed ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500",
                                )}
                              >
                                {entry.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                              {entry.outputTokens.toLocaleString("zh-CN")}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                              {formatDurationMs(entry.durationMs)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums font-semibold text-slate-700">
                              {formatUsd(entry.estimatedCostUsd)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {logTotalPages > 1 ? (
                  <div className="border-t border-border/60 px-4 py-3">
                    <Pager page={logPage} totalPages={logTotalPages} onChange={setLogPage} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="px-4 py-10 text-center text-xs text-slate-400">今日暂无调用明细</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
