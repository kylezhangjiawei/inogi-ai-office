import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Clipboard,
  Clock3,
  Copy,
  Download,
  Eye,
  Heart,
  Layers3,
  Loader2,
  MessageSquare,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { authFetch, readErrorMessage } from "./lib/authSession";
import { AiModelItem, integrationManagementApi } from "./lib/integrationManagementApi";

type ArtworkVariant = "product" | "brand" | "ui" | "metallic";
type Style = "vivid" | "natural";
type Size = "1024x1024" | "1792x1024" | "1024x1792";
type StudioTab = "当前" | "历史" | "收藏";

type GeneratedImage = {
  id: string;
  prompt: string;
  revisedPrompt: string;
  style: Style;
  size: Size;
  quality: string;
  imageData: string;
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

type ImageEditMessage = {
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

type ImageConversationResponse = {
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

type PromptChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  optimizedPrompt?: string;
  model?: string | null;
  requestId?: string | null;
  createdAt?: string;
};

type PromptChatSession = {
  id: string;
  title: string;
  sourcePrompt: string;
  currentPrompt: string;
  model?: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type PromptChatSessionDetail = {
  session: PromptChatSession;
  messages: PromptChatMessage[];
};

type ReferenceImageItem = {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  compressed: boolean;
};

type ListResponse = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: GeneratedImage[];
};

type ImageUsageEntry = {
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

type ImageUsageResponse = {
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

type ModelOption = {
  value: string;
  label: string;
  description: string;
  provider: string;
  model: string;
  modelId?: string;
  managed: boolean;
};

const DEFAULT_MODEL_VALUE = "__openai_image_to_image__";
const DEFAULT_MODEL_OPTION: ModelOption = {
  value: DEFAULT_MODEL_VALUE,
  label: "OpenAI Image 2 Image",
  description: "默认使用 OpenAI gpt-image-1，支持参考图生图与高质量图片生成。",
  provider: "OpenAI",
  model: "gpt-image-1",
  managed: false,
};

const defaultPrompt =
  "未来科技产品展示，蓝紫渐变背景，玻璃拟态，金属材质，高端商业海报";
const MAX_PROMPT_LENGTH = 32_000;
const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_UPSTREAM_REFERENCE_IMAGE_BYTES = 850 * 1024;
const MAX_REFERENCE_IMAGE_DIMENSION = 2048;
const MIN_REFERENCE_IMAGE_DIMENSION = 768;
const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const ratios: Array<{ label: string; value: Size; shortLabel: string }> = [
  { label: "1:1 方图", value: "1024x1024", shortLabel: "1:1" },
  { label: "16:9 横图", value: "1792x1024", shortLabel: "16:9" },
  { label: "9:16 竖图", value: "1024x1792", shortLabel: "9:16" },
];

const suggestions = [
  { title: "补充主体细节", prompt: "主体细节更明确，包含形态、材质、比例和核心卖点" },
  { title: "强化光影风格", prompt: "增加电影级布光、柔和边缘光和高级反射质感" },
  { title: "突出品牌色彩", prompt: "统一蓝紫品牌色，加入细腻渐变和商业海报层次" },
];

const promptOptimizerSuggestions = [
  "更适合电商主图，突出产品卖点和干净背景",
  "增强商业海报质感，补充构图、材质和电影级光影",
  "保持原意，压缩成更清晰可控的专业图像提示词",
];

const glassCard =
  "border border-slate-200/80 bg-white/92 shadow-[0_14px_34px_rgba(15,23,42,0.07)] backdrop-blur-xl";

async function apiGenerate(body: {
  prompt: string;
  style: Style;
  size: Size;
  model_id?: string;
  model?: string;
  reference_image_data?: string;
  reference_image_data_list?: string[];
  skip_cache?: boolean;
}): Promise<GeneratedImage> {
  const response = await authFetch("/api/image-generation/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片生成失败"));
  }
  return response.json() as Promise<GeneratedImage>;
}

async function apiEditImage(
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
  const response = await authFetch(`/api/image-generation/images/${id}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片修改失败"));
  }
  return response.json() as Promise<GeneratedImage>;
}

async function apiImageConversation(id: string): Promise<ImageConversationResponse> {
  const response = await authFetch(`/api/image-generation/images/${id}/conversation`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片对话加载失败"));
  }
  return response.json() as Promise<ImageConversationResponse>;
}

async function apiPromptSessions(): Promise<PromptChatSession[]> {
  const response = await authFetch("/api/image-generation/prompt-sessions");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化会话加载失败"));
  }
  return response.json() as Promise<PromptChatSession[]>;
}

async function apiCreatePromptSession(body: {
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

async function apiPromptSession(id: string): Promise<PromptChatSessionDetail> {
  const response = await authFetch(`/api/image-generation/prompt-sessions/${id}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "提示词优化会话加载失败"));
  }
  return response.json() as Promise<PromptChatSessionDetail>;
}

async function apiPromptChat(body: {
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

async function apiList(
  page: number,
  pageSize: number,
  options: { favorite?: boolean; dateFrom?: string; dateTo?: string } = {},
): Promise<ListResponse> {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    favorite: String(Boolean(options.favorite)),
  });
  if (options.dateFrom) search.set("dateFrom", options.dateFrom);
  if (options.dateTo) search.set("dateTo", options.dateTo);

  const response = await authFetch(`/api/image-generation/images?${search.toString()}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片列表加载失败"));
  }
  return response.json() as Promise<ListResponse>;
}

async function apiUsage(): Promise<ImageUsageResponse> {
  const response = await authFetch("/api/image-generation/usage");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片用量加载失败"));
  }
  return response.json() as Promise<ImageUsageResponse>;
}

async function apiToggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const response = await authFetch(`/api/image-generation/images/${id}/favorite`, { method: "PATCH" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "收藏状态更新失败"));
  }
  return response.json() as Promise<{ id: string; isFavorite: boolean }>;
}

function isImageToImageModel(model: string) {
  const normalized = model.toLowerCase();
  return normalized.includes("gpt-image") || normalized.includes("image-to-image") || normalized === "dall-e-2";
}

function toModelOption(item: AiModelItem): ModelOption {
  return {
    value: item.id,
    label: item.name || item.model,
    description: `${item.provider || "OpenAI"} / ${item.model}${item.current_status ? ` · ${item.current_status}` : ""}`,
    provider: item.provider || "OpenAI",
    model: item.model,
    modelId: item.id,
    managed: true,
  };
}

function formatModelOptionLabel(item: ModelOption) {
  const label = item.label.trim() || item.provider || item.model;
  const model = item.model.trim();
  if (!model || label === model) return label;
  return `${label}（${model}）`;
}

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatImageCost(item: GeneratedImage) {
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

async function prepareReferenceImage(file: File) {
  if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(file.type)) {
    throw new Error("参考图仅支持 PNG、JPG 或 WebP");
  }

  const image = await loadImageFromFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const initialScale = Math.min(1, MAX_REFERENCE_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));

  if (file.size <= MAX_REFERENCE_IMAGE_BYTES && initialScale === 1) {
    return {
      dataUrl: await readFileAsDataUrl(file),
      size: file.size,
      compressed: false,
    };
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
        return {
          dataUrl: await blobToDataUrl(blob),
          size: blob.size,
          compressed: true,
        };
      }
    }

    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
  }

  if (bestBlob && bestBlob.size <= MAX_REFERENCE_IMAGE_BYTES * 1.2) {
    return {
      dataUrl: await blobToDataUrl(bestBlob),
      size: bestBlob.size,
      compressed: true,
    };
  }

  throw new Error(`参考图压缩后仍超过 ${formatFileSize(MAX_REFERENCE_IMAGE_BYTES)}，请上传更小的图片`);
}

async function compressDataUrlForUpstream(dataUrl: string, targetBytes: number, minDimension = 512) {
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
        return {
          dataUrl: await blobToDataUrl(blob),
          size: blob.size,
          compressed: true,
        };
      }
    }

    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
  }

  if (bestBlob && bestBlob.size <= targetBytes * 1.15) {
    return {
      dataUrl: await blobToDataUrl(bestBlob),
      size: bestBlob.size,
      compressed: true,
    };
  }

  throw new Error(`参考图压缩后仍超过代理限制，请减少参考图数量或调大 nginx client_max_body_size`);
}

async function prepareReferenceImagesForSubmit(items: ReferenceImageItem[]) {
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

function MiniPreview({ variant, imageData }: { variant?: ArtworkVariant; imageData?: string }) {
  return (
    <div className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl border border-white/70 bg-slate-100">
      {imageData ? (
        <img src={imageData} alt="作品缩略图" className="h-full w-full object-cover" />
      ) : (
        <ArtworkVisual variant={variant ?? "product"} compact />
      )}
    </div>
  );
}

function ArtworkVisual({ variant, compact = false }: { variant: ArtworkVariant; compact?: boolean }) {
  const base =
    variant === "product"
      ? "linear-gradient(135deg,#201a54 0%,#4662ff 48%,#49d5ff 100%)"
      : variant === "brand"
        ? "linear-gradient(135deg,#f8fbff 0%,#dfe8ff 42%,#bba7ff 100%)"
        : variant === "ui"
          ? "linear-gradient(135deg,#101a40 0%,#2746b8 52%,#8d6bff 100%)"
          : "linear-gradient(135deg,#f7f2ff 0%,#dee8ff 36%,#aeb9cc 100%)";

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: base }}>
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),transparent_34%,rgba(255,255,255,0.16)_72%,transparent)]" />

      {variant === "product" ? (
        <>
          <div
            className={cn(
              "absolute rounded-[24px] border border-white/34 bg-white/18 shadow-2xl backdrop-blur-md",
              compact ? "left-5 top-3 h-9 w-6" : "left-[38%] top-[18%] h-[58%] w-[24%]",
            )}
          />
          <div className={cn("absolute rounded-full bg-cyan-200/80 blur-md", compact ? "right-3 top-5 h-5 w-5" : "right-[22%] top-[25%] h-20 w-20")} />
          <div
            className={cn(
              "absolute border border-white/28 bg-white/14 backdrop-blur-md",
              compact ? "bottom-2 left-2 h-3 w-9 rounded-md" : "bottom-[16%] left-[18%] h-14 w-[42%] rounded-2xl",
            )}
          />
          <div className={cn("absolute bg-white/70", compact ? "bottom-3 right-3 h-px w-7" : "bottom-[24%] right-[16%] h-px w-[26%]")} />
        </>
      ) : null}

      {variant === "brand" ? (
        <>
          <div className={cn("absolute rotate-[-14deg] rounded-[32px] bg-gradient-to-br from-white/85 to-violet-200/80 shadow-xl", compact ? "left-3 top-3 h-7 w-7" : "left-[16%] top-[16%] h-[34%] w-[24%]")} />
          <div className={cn("absolute rounded-full bg-gradient-to-br from-blue-400 to-violet-500 shadow-2xl", compact ? "right-3 top-4 h-6 w-6" : "right-[18%] top-[20%] h-[30%] w-[24%]")} />
          <div className={cn("absolute rotate-[18deg] rounded-[28px] bg-white/54 backdrop-blur-md", compact ? "bottom-2 left-5 h-4 w-8" : "bottom-[18%] left-[32%] h-[24%] w-[34%]")} />
        </>
      ) : null}

      {variant === "ui" ? (
        <>
          <div className={cn("absolute rounded-2xl border border-white/24 bg-white/16 backdrop-blur-md", compact ? "left-2 top-2 h-5 w-9" : "left-[13%] top-[18%] h-[24%] w-[36%]")} />
          <div className={cn("absolute rounded-2xl border border-cyan-200/26 bg-cyan-100/14 backdrop-blur-md", compact ? "right-2 top-5 h-6 w-8" : "right-[12%] top-[32%] h-[30%] w-[34%]")} />
          <div className={cn("absolute rounded-full bg-cyan-200/90", compact ? "left-4 bottom-3 h-1 w-8" : "left-[18%] bottom-[22%] h-1.5 w-[46%]")} />
          <div className={cn("absolute rounded-full bg-violet-200/90", compact ? "left-4 bottom-5 h-1 w-6" : "left-[22%] bottom-[32%] h-1.5 w-[34%]")} />
        </>
      ) : null}

      {variant === "metallic" ? (
        <>
          <div className={cn("absolute rounded-full bg-[linear-gradient(135deg,#ffffff_0%,#aeb8d6_42%,#798299_100%)] shadow-2xl", compact ? "left-3 top-3 h-7 w-7" : "left-[21%] top-[20%] h-[38%] w-[28%]")} />
          <div className={cn("absolute rotate-[12deg] rounded-[28px] bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(125,139,171,0.52))] shadow-xl", compact ? "right-3 bottom-3 h-5 w-8" : "right-[16%] bottom-[20%] h-[26%] w-[34%]")} />
          <div className={cn("absolute bg-white/76 blur-sm", compact ? "left-2 bottom-2 h-px w-10" : "left-[18%] bottom-[18%] h-1 w-[54%]")} />
        </>
      ) : null}
    </div>
  );
}

function ArtworkCard({
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
    <article className="group overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition duration-200 hover:border-blue-200 hover:shadow-[0_18px_42px_rgba(25,118,210,0.13)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <img src={item.imageData} alt={item.prompt} className="h-full w-full object-cover" />
        <div className="absolute left-4 top-4 rounded-full border border-white/70 bg-slate-950/58 px-3 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md">
          {String(index + 1).padStart(2, "0")}
        </div>
        {item.fromCache ? (
          <div className="absolute right-4 top-4 rounded-full border border-emerald-100 bg-emerald-50/88 px-3 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur-md">
            缓存命中
          </div>
        ) : null}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-2xl border border-white/80 bg-white/88 px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-[0_12px_28px_rgba(30,41,80,0.16)] backdrop-blur-xl">
          <button className="flex cursor-pointer items-center gap-1.5 transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => onPreview(item)}>
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button className="flex cursor-pointer items-center gap-1.5 transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => onDownload(item)}>
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
          <button className="flex cursor-pointer items-center gap-1.5 transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => onEdit(item)}>
            <PencilLine className="h-3.5 w-3.5" />
            修改
          </button>
          <button className="flex cursor-pointer items-center gap-1.5 transition hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => onFavorite(item)} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-rose-500 text-rose-500" : "")} />}
            收藏
          </button>
        </div>
      </div>
      <div className="px-5 py-4">
        <h3 className="truncate text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 truncate text-xs leading-5 text-slate-500">{description}</p>
        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-800">{formatImageCost(item)}</span>
          <span className="truncate">
            {editDepth > 0 ? `累计 ${formatUsd(cumulativeCost)}` : `output ${outputTokens > 0 ? outputTokens.toLocaleString("zh-CN") : "-"}`}
            {retryCount > 0 ? ` · 重试 ${retryCount}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}

function GeneratingImageCard() {
  return (
    <div className="relative min-h-[260px] overflow-hidden rounded-[18px] border border-blue-100 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(30,136,229,0.14),rgba(16,185,129,0.12),rgba(255,255,255,0.72))]" />
      <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_30%_24%,rgba(255,255,255,0.78),transparent_28%),radial-gradient(circle_at_68%_38%,rgba(30,136,229,0.22),transparent_32%)] motion-reduce:animate-none" />
      <div className="absolute inset-x-5 top-5 flex items-center justify-between">
        <span className="rounded-full border border-blue-100 bg-white/86 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
          生成中
        </span>
        <Loader2 className="h-5 w-5 animate-spin text-blue-600 motion-reduce:animate-none" />
      </div>
      <div className="relative flex h-full min-h-[260px] flex-col items-center justify-center px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/90 text-blue-600 shadow-[0_14px_32px_rgba(25,118,210,0.16)]">
          <Sparkles className="h-7 w-7" />
        </div>
        <div className="mt-5 text-base font-semibold text-slate-950">AI 正在生成图片</div>
        <div className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
          已提交到图像模型，生成高清图片通常需要几十秒，请保持当前页面。
        </div>
        <div className="mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-white/60">
          <div className="h-full w-1/2 animate-[pulse_1.3s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,#1e88e5,#10b981)] motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

export function UIDesignPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedRatio, setSelectedRatio] = useState<Size>("1792x1024");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_VALUE);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [modelRows, setModelRows] = useState<AiModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [referenceImageBusy, setReferenceImageBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>("当前");
  const [currentImages, setCurrentImages] = useState<GeneratedImage[]>([]);
  const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([]);
  const [favoriteImages, setFavoriteImages] = useState<GeneratedImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [usage, setUsage] = useState<ImageUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [conversation, setConversation] = useState<ImageConversationResponse | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
  const [promptOptimizerSourcePrompt, setPromptOptimizerSourcePrompt] = useState("");
  const [promptChatSessions, setPromptChatSessions] = useState<PromptChatSession[]>([]);
  const [activePromptChatSessionId, setActivePromptChatSessionId] = useState("");
  const [promptChatSessionsLoading, setPromptChatSessionsLoading] = useState(false);
  const [promptChatMessages, setPromptChatMessages] = useState<PromptChatMessage[]>([]);
  const [promptChatInput, setPromptChatInput] = useState("");
  const [promptChatLoading, setPromptChatLoading] = useState(false);
  const [promptChatModel, setPromptChatModel] = useState("");
  const deferredSearchKeyword = useDeferredValue(searchKeyword);

  const modelOptions = useMemo(() => {
    const managedOptions = modelRows
      .filter((item) => item.enabled && item.model && isImageToImageModel(item.model))
      .map(toModelOption);
    const hasManagedDefault = managedOptions.some(
      (item) => item.provider === DEFAULT_MODEL_OPTION.provider && item.model === DEFAULT_MODEL_OPTION.model,
    );
    return hasManagedDefault ? managedOptions : [DEFAULT_MODEL_OPTION, ...managedOptions];
  }, [modelRows]);

  const selectedModelOption = useMemo(
    () => modelOptions.find((item) => item.value === selectedModel) ?? DEFAULT_MODEL_OPTION,
    [modelOptions, selectedModel],
  );

  const promptModelOptions = useMemo(
    () =>
      modelRows
        .filter((item) => item.enabled && item.model && !isImageToImageModel(item.model))
        .map(toModelOption),
    [modelRows],
  );

  const selectedPromptModelOption = useMemo(
    () => promptModelOptions.find((item) => item.value === promptChatModel) ?? promptModelOptions[0],
    [promptModelOptions, promptChatModel],
  );

  const selectedRatioOption = ratios.find((item) => item.value === selectedRatio) ?? ratios[1];
  const promptSummary = prompt.trim() || "填写提示词后会显示摘要";
  const latestOptimizedPrompt = [...promptChatMessages].reverse().find((item) => item.optimizedPrompt)?.optimizedPrompt ?? "";
  const activePromptChatSession = promptChatSessions.find((item) => item.id === activePromptChatSessionId) ?? null;

  const generationSettings = [
    ["模型", formatModelOptionLabel(selectedModelOption)],
    ["服务商", selectedModelOption.provider],
    ["模型标识", selectedModelOption.model],
    ["比例", selectedRatioOption.shortLabel],
  ];

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await integrationManagementApi.listAiModels({ page: 1, pageSize: 100 });
      setModelRows(response.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型列表加载失败");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadGallery = useCallback(async (target: "current" | "history" | "favorite") => {
    setGalleryLoading(true);
    try {
      const today = getTodayBounds();
      const response = await apiList(1, 12, {
        favorite: target === "favorite",
        dateFrom: target === "current" ? today.start : undefined,
        dateTo: target === "current" ? today.end : target === "history" ? today.start : undefined,
      });
      if (target === "favorite") {
        setFavoriteImages(response.items);
      } else if (target === "current") {
        setCurrentImages(response.items);
      } else {
        setHistoryImages(response.items);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片列表加载失败");
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      setUsage(await apiUsage());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片用量加载失败");
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (imageId: string) => {
    setConversationLoading(true);
    try {
      setConversation(await apiImageConversation(imageId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片对话加载失败");
      setConversation(null);
    } finally {
      setConversationLoading(false);
    }
  }, []);

  const loadPromptSessions = useCallback(async () => {
    setPromptChatSessionsLoading(true);
    try {
      const sessions = await apiPromptSessions();
      setPromptChatSessions(sessions);
      if (!activePromptChatSessionId && sessions[0]) {
        const detail = await apiPromptSession(sessions[0].id);
        setActivePromptChatSessionId(detail.session.id);
        setPromptOptimizerSourcePrompt(detail.session.sourcePrompt || prompt.trim());
        setPromptChatMessages(detail.messages);
        if (detail.session.currentPrompt.trim()) {
          setPrompt(detail.session.currentPrompt.trim());
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化会话加载失败");
    } finally {
      setPromptChatSessionsLoading(false);
    }
  }, [activePromptChatSessionId, prompt]);

  const openPromptChatSession = useCallback(async (sessionId: string) => {
    setPromptChatSessionsLoading(true);
    try {
      const detail = await apiPromptSession(sessionId);
      setActivePromptChatSessionId(detail.session.id);
      setPromptOptimizerSourcePrompt(detail.session.sourcePrompt || prompt.trim());
      setPromptChatMessages(detail.messages);
      if (detail.session.currentPrompt.trim()) {
        setPrompt(detail.session.currentPrompt.trim());
      }
      setPromptChatInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化会话加载失败");
    } finally {
      setPromptChatSessionsLoading(false);
    }
  }, [prompt]);

  const createPromptChatSession = useCallback(async () => {
    setPromptChatSessionsLoading(true);
    try {
      const sourcePrompt = prompt.trim();
      const detail = await apiCreatePromptSession({
        source_prompt: sourcePrompt,
        current_prompt: sourcePrompt,
      });
      setPromptChatSessions((current) => [detail.session, ...current.filter((item) => item.id !== detail.session.id)]);
      setActivePromptChatSessionId(detail.session.id);
      setPromptOptimizerSourcePrompt(detail.session.sourcePrompt);
      setPromptChatMessages(detail.messages);
      setPromptChatInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化会话创建失败");
    } finally {
      setPromptChatSessionsLoading(false);
    }
  }, [prompt]);

  useEffect(() => {
    void loadModels();
    void loadGallery("current");
    void loadGallery("history");
    void loadUsage();
  }, [loadGallery, loadModels, loadUsage]);

  useEffect(() => {
    const currentOption = modelOptions.find((item) => item.value === selectedModel);
    if (!currentOption) {
      setSelectedModel(modelOptions[0]?.value ?? DEFAULT_MODEL_VALUE);
      return;
    }
    if (selectedModel !== DEFAULT_MODEL_VALUE) return;
    const managedImageModel = modelOptions.find((item) => item.managed && isImageToImageModel(item.model));
    if (managedImageModel) {
      setSelectedModel(managedImageModel.value);
    }
  }, [modelOptions, selectedModel]);

  useEffect(() => {
    if (promptChatModel && promptModelOptions.some((item) => item.value === promptChatModel)) {
      return;
    }
    setPromptChatModel(promptModelOptions[0]?.value ?? "");
  }, [promptChatModel, promptModelOptions]);

  useEffect(() => {
    if (activeTab === "当前") {
      void loadGallery("current");
    }
    if (activeTab === "历史") {
      void loadGallery("history");
    }
    if (activeTab === "收藏") {
      void loadGallery("favorite");
    }
  }, [activeTab, loadGallery]);

  useEffect(() => {
    if (!previewItem) {
      setConversation(null);
      setEditInstruction("");
      return;
    }
    setConversation(previewItem.conversation ?? null);
    setEditInstruction("");
    void loadConversation(previewItem.id);
  }, [loadConversation, previewItem]);

  function appendPrompt(fragment: string) {
    setPrompt((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}，${fragment}` : fragment;
    });
  }

  function openPromptOptimizer() {
    setPromptOptimizerSourcePrompt(prompt.trim());
    setPromptOptimizerOpen(true);
    setPromptChatInput((current) =>
      current.trim()
        ? current
        : "",
    );
    void loadPromptSessions();
  }

  async function handlePromptChatSend() {
    const message = promptChatInput.trim();
    if (!message) {
      toast.error("请先输入优化要求");
      return;
    }

    const userMessage: PromptChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
    };
    const history = promptChatMessages.map((item) => ({
      role: item.role,
      content: item.optimizedPrompt ? `${item.content}\n优化结果：${item.optimizedPrompt}` : item.content,
    }));
    setPromptChatMessages((current) => [...current, userMessage]);
    setPromptChatInput("");
    setPromptChatLoading(true);

    try {
      let sessionId = activePromptChatSessionId;
      if (!sessionId) {
        const sourcePrompt = prompt.trim();
        const detail = await apiCreatePromptSession({
          source_prompt: sourcePrompt,
          current_prompt: sourcePrompt,
        });
        sessionId = detail.session.id;
        setPromptChatSessions((current) => [detail.session, ...current.filter((item) => item.id !== detail.session.id)]);
        setActivePromptChatSessionId(detail.session.id);
        setPromptOptimizerSourcePrompt(detail.session.sourcePrompt);
      }
      const response = await apiPromptChat({
        session_id: sessionId,
        current_prompt: prompt.trim(),
        message,
        history,
        model_id: selectedPromptModelOption?.managed ? selectedPromptModelOption.modelId : undefined,
        model: selectedPromptModelOption?.model,
      });
      setPromptChatSessions((current) => [
        response.session,
        ...current.filter((item) => item.id !== response.session.id),
      ]);
      setActivePromptChatSessionId(response.session.id);
      setPromptOptimizerSourcePrompt(response.session.sourcePrompt);
      setPromptChatMessages(response.messages);
      if (response.optimizedPrompt.trim()) {
        setPrompt(response.optimizedPrompt.trim());
        toast.success("优化后的提示词已回填");
      }
    } catch (error) {
      setPromptChatMessages((current) => current.filter((item) => item.id !== userMessage.id));
      toast.error(error instanceof Error ? error.message : "提示词优化失败");
    } finally {
      setPromptChatLoading(false);
    }
  }

  async function handleReferenceFiles(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      toast.error(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张`);
      return;
    }
    const selectedFiles = files.slice(0, remaining);
    if (selectedFiles.length < files.length) {
      toast.warning(`最多保留 ${MAX_REFERENCE_IMAGES} 张参考图，已忽略多余文件`);
    }

    setReferenceImageBusy(true);
    try {
      const preparedItems: ReferenceImageItem[] = [];
      for (const file of selectedFiles) {
        const prepared = await prepareReferenceImage(file);
        preparedItems.push({
          id: `${Date.now()}-${file.name}-${preparedItems.length}`,
          name: file.name,
          dataUrl: prepared.dataUrl,
          size: prepared.size,
          compressed: prepared.compressed,
        });
      }
      setReferenceImages((current) => [...current, ...preparedItems]);
      const compressedCount = preparedItems.filter((item) => item.compressed).length;
      toast.success(
        compressedCount > 0
          ? `已添加 ${preparedItems.length} 张参考图，${compressedCount} 张已压缩`
          : `已添加 ${preparedItems.length} 张参考图`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图处理失败");
    } finally {
      setReferenceImageBusy(false);
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => current.filter((item) => item.id !== id));
  }

  async function handleGenerate(skipCache = false) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      toast.error("请先填写图像提示词");
      return;
    }
    if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
      toast.error(`提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符`);
      return;
    }
    if (referenceImageBusy) {
      toast.error("参考图仍在处理中，请稍后再生成");
      return;
    }

    setGenerating(true);
    try {
      const submitReferences = await prepareReferenceImagesForSubmit(referenceImages);
      if (submitReferences.compressedCount > 0) {
        toast.info(`已为代理压缩 ${submitReferences.compressedCount} 张参考图，总大小 ${formatFileSize(submitReferences.totalSize)}`);
      }
      const payload = {
        prompt: normalizedPrompt,
        style: "vivid" as Style,
        size: selectedRatio,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data_list: submitReferences.dataUrls.length > 0 ? submitReferences.dataUrls : undefined,
        skip_cache: skipCache,
      };
      const result = await apiGenerate(payload);
      setCurrentImages([result]);
      setActiveTab("当前");
      toast.success("已生成 1 张图像");
      void loadGallery("current");
      void loadGallery("history");
      void loadUsage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(promptSummary);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  function handleDownload(item: GeneratedImage) {
    const link = document.createElement("a");
    link.href = item.imageData;
    link.download = `ai-image-${item.id}.png`;
    link.click();
  }

  function handleOpenEdit(item: GeneratedImage) {
    setPreviewItem(item);
  }

  async function handleEditImage() {
    if (!previewItem) return;
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
      const sourceReference = await compressDataUrlForUpstream(previewItem.imageData, MAX_UPSTREAM_REFERENCE_IMAGE_BYTES);
      if (sourceReference.compressed) {
        toast.info(`已压缩当前图片用于提交，大小 ${formatFileSize(sourceReference.size)}`);
      }
      const result = await apiEditImage(previewItem.id, {
        message,
        style: "vivid",
        size: previewItem.size,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data: sourceReference.dataUrl,
      });
      setEditInstruction("");
      setPreviewItem(result);
      setCurrentImages((images) => [result, ...images.filter((item) => item.id !== result.id)]);
      setActiveTab("当前");
      if (result.conversation) {
        setConversation(result.conversation);
      } else {
        void loadConversation(result.id);
      }
      toast.success("已生成新的修改版本");
      void loadGallery("current");
      void loadGallery("history");
      void loadUsage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片修改失败");
      void loadConversation(previewItem.id);
    } finally {
      setEditingImage(false);
    }
  }

  function handleReuse(item: GeneratedImage) {
    setPrompt(item.revisedPrompt || item.prompt);
    setSelectedRatio(item.size);
    toast.success("已复用该图片提示词");
  }

  async function handleFavorite(item: GeneratedImage) {
    setFavoriteBusyId(item.id);
    try {
      const updated = await apiToggleFavorite(item.id);
      const patch = (images: GeneratedImage[]) =>
        images.map((image) => (image.id === updated.id ? { ...image, isFavorite: updated.isFavorite } : image));
      setCurrentImages(patch);
      setHistoryImages(patch);
      setFavoriteImages((images) =>
        updated.isFavorite ? patch(images) : images.filter((image) => image.id !== updated.id),
      );
      toast.success(updated.isFavorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏状态更新失败");
    } finally {
      setFavoriteBusyId(null);
    }
  }

  const tabItems: GeneratedImage[] =
    activeTab === "当前"
      ? currentImages
      : activeTab === "历史"
        ? historyImages
        : favoriteImages;

  const displayedItems = deferredSearchKeyword.trim()
    ? tabItems.filter((item) => {
        const keyword = deferredSearchKeyword.trim().toLowerCase();
        const searchable = `${item.prompt} ${item.revisedPrompt} ${item.model}`;
        return searchable.toLowerCase().includes(keyword);
      })
    : tabItems;

  const recentItems = historyImages.slice(0, 3);
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <div className="relative flex h-full min-h-[760px] w-full flex-col overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fd_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(25,118,210,0.08),transparent_38%,rgba(16,185,129,0.07)_76%,transparent)]" />

      <section className="relative z-10 shrink-0 border-b border-slate-200/80 bg-white/82 px-4 py-4 backdrop-blur-xl lg:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#42a5f5_0%,#1565c0_100%)] shadow-[0_14px_28px_rgba(21,101,192,0.22)]">
              <Wand2 className="h-[18px] w-[18px] text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">AI STUDIO</div>
              <h2 className="truncate text-xl font-bold tracking-tight text-slate-950">AI 图像生成器</h2>
              <p className="mt-1 text-xs text-slate-500">创作、管理、复用和迭代生成图像</p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center xl:w-auto">
            <div className="relative w-full md:min-w-[280px] xl:w-[420px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                className="material-input h-11 rounded-[18px] pl-11 pr-4"
                placeholder="搜索提示词、模型或作品"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-11 items-center gap-2 rounded-[18px] border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-600 shadow-sm">
                <Zap className="h-3.5 w-3.5 text-emerald-500" />
                2,840 点数
              </div>
              <div className="flex h-11 items-center gap-2 rounded-[18px] border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-600 shadow-sm">
                <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                {todayLabel}
              </div>
              <button
                className="material-button-secondary h-11 cursor-pointer !rounded-[18px] !px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={usageLoading || galleryLoading}
                onClick={() => {
                  void loadUsage();
                  void loadGallery(activeTab === "收藏" ? "favorite" : activeTab === "历史" ? "history" : "current");
                }}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", usageLoading || galleryLoading ? "animate-spin motion-reduce:animate-none" : "")} />
                刷新
              </button>
            </div>
          </div>
        </div>
      </section>

      <main className="relative z-10 grid min-h-0 flex-1 items-stretch gap-5 overflow-hidden p-4 lg:p-5 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-[20px] p-5", glassCard)}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-950">创建图像</div>
              <div className="mt-1 text-xs text-slate-500">提示词、模型、参考图和输出控制</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-[16px] bg-blue-50 text-blue-600">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>

          <div className="material-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <section>
              <label className="mb-2 block text-xs font-semibold text-slate-700">AI 模型</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="material-input h-11 w-full cursor-pointer appearance-none rounded-[18px] pr-10 font-semibold text-slate-800"
                >
                  {modelOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {formatModelOptionLabel(item)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {modelsLoading ? "正在加载模型列表..." : selectedModelOption.description}
              </p>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">图像提示词</label>
                <button className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={openPromptOptimizer}>
                  <Wand2 className="h-3 w-3" />
                  优化提示词
                </button>
              </div>
              <textarea
                className="material-input h-[150px] w-full resize-none rounded-[18px] leading-6"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder="描述主体、风格、场景、色彩、光照..."
              />
              <div className="mt-1.5 text-right text-[11px] font-medium text-slate-400">
                {prompt.length.toLocaleString("zh-CN")} / {MAX_PROMPT_LENGTH.toLocaleString("zh-CN")}
              </div>
            </section>

            <section>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  const input = event.currentTarget;
                  void handleReferenceFiles(input.files).finally(() => {
                    input.value = "";
                  });
                }}
              />
              <button
                className="flex w-full cursor-pointer items-center gap-3 rounded-[18px] border border-dashed border-blue-200 bg-slate-50/80 px-4 py-4 text-left transition hover:border-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-70"
                type="button"
                disabled={referenceImageBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[16px] bg-blue-50 text-blue-600">
                  {referenceImageBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : referenceImages.length > 0 ? (
                    <span className="relative block h-full w-full">
                      <img src={referenceImages[0].dataUrl} alt={referenceImages[0].name} className="h-full w-full object-cover" />
                      {referenceImages.length > 1 ? (
                        <span className="absolute bottom-0 right-0 rounded-tl-lg bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {referenceImages.length}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {referenceImageBusy
                      ? "正在处理参考图..."
                      : referenceImages.length > 0
                        ? `已选择 ${referenceImages.length} 张参考图`
                        : "上传参考图"}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">支持多选，最多 16 张，用于参考风格、产品或构图</span>
                </span>
              </button>
              {referenceImages.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    {referenceImages.map((item) => (
                      <div key={item.id} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <img src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={`移除参考图 ${item.name}`}
                          className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-slate-950/75 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                          onClick={() => removeReferenceImage(item.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="cursor-pointer text-xs font-semibold text-slate-500 transition hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200" type="button" onClick={() => setReferenceImages([])}>
                    清除全部参考图
                  </button>
                </div>
              ) : null}
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold text-slate-700">画面比例</div>
              <div className="grid grid-cols-3 gap-2">
                {ratios.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSelectedRatio(item.value)}
                    className={cn(
                      "cursor-pointer rounded-[16px] border px-2 py-3 text-center text-[11px] font-semibold leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                      selectedRatio === item.value
                        ? "border-blue-400 bg-blue-50 text-blue-800 shadow-[0_10px_24px_rgba(59,130,246,0.12)]"
                        : "border-slate-200 bg-white/80 text-slate-600 hover:border-blue-200 hover:bg-white",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="shrink-0 border-t border-slate-100 pt-4">
            <button
              className="flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(135deg,#1e88e5_0%,#1565c0_100%)] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(21,101,192,0.26)] transition hover:shadow-[0_18px_36px_rgba(21,101,192,0.32)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-70"
              type="button"
              disabled={generating || referenceImageBusy}
              onClick={() => void handleGenerate()}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "正在生成..." : "生成图像"}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">预计耗时：10-30 秒</p>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="mb-4 flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-fit rounded-[18px] border border-slate-200 bg-white/90 p-1 shadow-sm">
              {(["当前", "历史", "收藏"] as StudioTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "cursor-pointer rounded-[14px] px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                    activeTab === tab ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Layers3 className="h-4 w-4" />
              {activeTab === "当前" ? `今日 ${displayedItems.length} 张` : `${displayedItems.length} 张结果`}
            </div>
          </div>

          <div className={cn("mb-5 flex shrink-0 flex-col gap-4 rounded-[20px] px-5 py-4 md:flex-row md:items-center md:justify-between", glassCard)}>
            <div className="min-w-0">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">提示词摘要</div>
              <p className="truncate text-sm font-medium text-slate-700">{promptSummary}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={generating || referenceImageBusy} onClick={() => void handleGenerate(true)}>
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
                重新生成
              </button>
              <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => void handleCopyPrompt()}>
                <Copy className="h-3.5 w-3.5" />
                复制提示词
              </button>
            </div>
          </div>

          <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            {generating && activeTab === "当前" ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <GeneratingImageCard />
                {displayedItems.slice(0, 3).map((item, index) => (
                  <ArtworkCard
                    key={item.id}
                    item={item}
                    index={index + 1}
                    busy={favoriteBusyId === item.id}
                    onPreview={setPreviewItem}
                    onDownload={handleDownload}
                    onEdit={handleOpenEdit}
                    onFavorite={(target) => void handleFavorite(target)}
                  />
                ))}
              </div>
            ) : galleryLoading ? (
              <div className={cn("flex h-56 items-center justify-center rounded-[20px] text-sm font-semibold text-slate-500", glassCard)}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                正在加载图片...
              </div>
            ) : displayedItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {displayedItems.map((item, index) => (
                  <ArtworkCard
                    key={item.id}
                    item={item}
                    index={index}
                    busy={favoriteBusyId === item.id}
                    onPreview={setPreviewItem}
                    onDownload={handleDownload}
                    onEdit={handleOpenEdit}
                    onFavorite={(target) => void handleFavorite(target)}
                  />
                ))}
              </div>
            ) : (
              <div className={cn("flex h-56 flex-col items-center justify-center rounded-[20px] text-center", glassCard)}>
                <Sparkles className="h-6 w-6 text-blue-500" />
                <div className="mt-3 text-sm font-semibold text-slate-800">
                  {activeTab === "当前" ? "今日暂无图片" : "暂无图片"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {activeTab === "当前" ? "今天生成的图片会显示在这里，历史图片请切换到历史。" : "生成图片后会自动出现在这里"}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="material-scrollbar grid min-h-0 gap-5 overflow-y-auto pr-1 xl:col-span-2 xl:grid-cols-2 2xl:col-span-1 2xl:block 2xl:space-y-5">
          {/*<section className={cn("rounded-[20px] p-5", glassCard)}>*/}
          {/*  <div className="mb-4 flex items-center justify-between">*/}
          {/*    <div>*/}
          {/*      <h2 className="text-sm font-semibold text-slate-950">提示词增强</h2>*/}
          {/*      <p className="mt-1 text-xs text-slate-500">模板提供输出建议</p>*/}
          {/*    </div>*/}
          {/*    <Sparkles className="h-4 w-4 text-blue-500" />*/}
          {/*  </div>*/}
          {/*  <div className="space-y-2">*/}
          {/*    {suggestions.map((item) => (*/}
          {/*      <div key={item.title} className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">*/}
          {/*        <div className="text-xs font-semibold text-slate-700">{item.title}</div>*/}
          {/*        <button className="mt-2 cursor-pointer rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => appendPrompt(item.prompt)}>*/}
          {/*          应用*/}
          {/*        </button>*/}
          {/*      </div>*/}
          {/*    ))}*/}
          {/*  </div>*/}
          {/*</section>*/}

          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-950">生成设置</h2>
            </div>
            <div className="space-y-3">
              {generationSettings.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className="truncate text-right text-xs font-semibold text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">用量监控</h2>
                <p className="mt-1 text-xs text-slate-500">按 UTC 日统计上游调用</p>
              </div>
              <button
                type="button"
                className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void loadUsage()}
                disabled={usageLoading}
              >
                {usageLoading ? "刷新中" : "刷新"}
              </button>
            </div>
            {usage ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="text-[11px] font-semibold text-slate-500">预估费用</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">
                      {formatUsd(usage.summary.estimatedCostUsd)}
                    </div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="text-[11px] font-semibold text-slate-500">上游调用</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{usage.summary.upstreamCalls}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="text-[11px] font-semibold text-slate-500">输出 tokens</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">
                      {usage.summary.outputTokens.toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="text-[11px] font-semibold text-slate-500">参考图 tokens</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">
                      {usage.summary.inputImageTokens.toLocaleString("zh-CN")}
                    </div>
                  </div>
                </div>
                <div className="rounded-[16px] border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-500">
                  成功 {usage.summary.successCalls} 次，失败 {usage.summary.errorCalls} 次，重试 {usage.summary.retryCalls} 次；图生图 {usage.summary.editCalls} 次。
                </div>
                {usage.entries.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        {entry.operation === "edit" ? "图生图" : "文生图"} · {entry.normalizedSize || "-"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">{formatUsd(entry.estimatedCostUsd)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {entry.status} · output {entry.outputTokens.toLocaleString("zh-CN")} · {formatTime(entry.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-xs leading-5 text-slate-500">
                暂无上游调用记录。新生成图片后会显示 token 和预估费用。
              </div>
            )}
          </section>

          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center gap-2">
              <Clipboard className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-950">最近创作</h2>
            </div>
            <div className="space-y-3">
              {recentItems.length > 0 ? recentItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-[16px] border border-slate-200 bg-slate-50/80 p-2.5 text-left transition hover:border-blue-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <MiniPreview imageData={item.imageData} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">
                      {item.prompt}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {formatTime(item.createdAt)} · {formatImageCost(item)}
                    </div>
                  </div>
                </button>
              )) : (
                <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-xs leading-5 text-slate-500">
                  暂无历史创作，今天之前生成的图片会显示在这里。
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>

      {promptOptimizerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/42 p-3 backdrop-blur-sm md:p-5" role="dialog" aria-modal="true">
          <div className="flex max-h-[calc(100vh-32px)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  AI 提示词优化
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-700">
                    自动回填
                  </span>
                  <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    {latestOptimizedPrompt ? "已有优化结果" : "等待优化"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                    {selectedPromptModelOption ? formatModelOptionLabel(selectedPromptModelOption) : "默认文本模型"}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {latestOptimizedPrompt ? (
                  <button
                    type="button"
                    className="h-9 cursor-pointer rounded-[14px] border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                    onClick={() => {
                      setPrompt(latestOptimizedPrompt);
                      toast.success("已应用最新优化提示词");
                    }}
                  >
                    应用最新结果
                  </button>
                ) : null}
                <button
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  type="button"
                  onClick={() => setPromptOptimizerOpen(false)}
                  aria-label="关闭提示词优化"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
              <aside className="flex min-h-0 max-h-[34vh] flex-col border-b border-slate-200 bg-white lg:max-h-none lg:border-b-0 lg:border-r">
                <div className="shrink-0 border-b border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">优化会话</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">
                        {promptChatSessions.length.toLocaleString("zh-CN")} 个记录
                      </div>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] bg-blue-600 text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void createPromptChatSession()}
                      disabled={promptChatSessionsLoading || promptChatLoading}
                      aria-label="新建提示词优化对话"
                    >
                      {promptChatSessionsLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="material-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {promptChatSessionsLoading && promptChatSessions.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs font-semibold text-slate-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-500 motion-reduce:animate-none" />
                      加载会话...
                    </div>
                  ) : promptChatSessions.length > 0 ? (
                    promptChatSessions.map((session) => {
                      const active = session.id === activePromptChatSessionId;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={cn(
                            "w-full cursor-pointer rounded-[16px] border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                            active
                              ? "border-blue-200 bg-blue-50 text-blue-900"
                              : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-blue-100 hover:bg-white",
                          )}
                          onClick={() => void openPromptChatSession(session.id)}
                          disabled={promptChatLoading}
                        >
                          <div className="line-clamp-2 text-xs font-semibold leading-5">{session.title || "新提示词对话"}</div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {session.messageCount}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatTime(session.updatedAt)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-xs leading-5 text-slate-500">
                      暂无历史对话。点击上方加号创建一个新的提示词优化聊天框。
                    </div>
                  )}
                </div>
              </aside>
              <div className="flex min-h-0 flex-col bg-[linear-gradient(180deg,#fbfdff_0%,#f5f8fd_100%)]">
                <div className="material-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                  {promptChatMessages.length > 0 ? (
                    promptChatMessages.map((message) => {
                      const isUser = message.role === "user";
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "max-w-[86%] rounded-[18px] px-4 py-3 text-sm leading-6 shadow-sm",
                            isUser
                              ? "ml-auto bg-blue-600 text-white"
                              : "mr-auto border border-slate-200 bg-white text-slate-700",
                          )}
                        >
                          <div>{message.content}</div>
                          {message.optimizedPrompt ? (
                            <div className="mt-3 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-slate-700">
                              <div className="mb-1 font-semibold text-emerald-700">已回填到输入框</div>
                              <div className="whitespace-pre-wrap">{message.optimizedPrompt}</div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-slate-200 bg-white/82 p-5">
                      <div className="text-sm font-semibold text-slate-800">选择一个方向或直接输入</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {promptOptimizerSuggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                            onClick={() => setPromptChatInput(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {promptChatLoading ? (
                    <div className="mr-auto inline-flex items-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500 motion-reduce:animate-none" />
                      正在优化提示词...
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                  <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="prompt-optimizer-input">
                    优化要求
                  </label>
                  <textarea
                    id="prompt-optimizer-input"
                    className="h-24 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                    value={promptChatInput}
                    onChange={(event) => setPromptChatInput(event.target.value)}
                    maxLength={8000}
                    placeholder="例如：更突出产品卖点，补充材质、构图和灯光细节"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-400">{promptChatInput.length.toLocaleString("zh-CN")} / 8,000</div>
                    <button
                      type="button"
                      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={promptChatLoading || !promptChatInput.trim()}
                      onClick={() => void handlePromptChatSend()}
                    >
                      {promptChatLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
                      发送优化要求
                    </button>
                  </div>
                </div>
              </div>

              <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0">
                <div className="grid shrink-0 grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-semibold text-slate-500">对话轮次</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{promptChatMessages.filter((item) => item.role === "user").length}</div>
                  </div>
                  <div className="rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <div className="font-semibold text-emerald-700">回填状态</div>
                    <div className="mt-1 text-sm font-semibold text-emerald-800">{latestOptimizedPrompt ? "已更新" : "未更新"}</div>
                  </div>
                </div>

                <div className="mt-4 shrink-0">
                  <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="prompt-optimizer-model">
                    优化模型
                  </label>
                  <div className="relative">
                    <select
                      id="prompt-optimizer-model"
                      value={promptChatModel}
                      onChange={(event) => setPromptChatModel(event.target.value)}
                      className="material-input h-11 w-full cursor-pointer appearance-none rounded-[16px] pr-9 text-xs font-semibold"
                      disabled={promptChatLoading || promptModelOptions.length === 0}
                    >
                      {promptModelOptions.length > 0 ? (
                        promptModelOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {formatModelOptionLabel(item)}
                          </option>
                        ))
                      ) : (
                        <option value="">使用后端默认文本模型</option>
                      )}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    这里仅显示文本 AI 模型；图像模型仍在左侧“AI 模型”中选择。
                  </p>
                </div>

                <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-hidden">
                  <div className="flex min-h-0 flex-col">
                    <div className="mb-2 text-xs font-semibold text-slate-700">打开弹框时的提示词</div>
                    <div className="material-scrollbar max-h-[150px] overflow-y-auto rounded-[16px] border border-slate-200 bg-slate-50/80 p-3 text-xs leading-6 text-slate-500">
                      {promptOptimizerSourcePrompt || "打开时提示词为空"}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">当前回填提示词</span>
                      <button
                        type="button"
                        className="cursor-pointer rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                        onClick={() => void handleCopyPrompt()}
                      >
                        复制
                      </button>
                    </div>
                    <div className="material-scrollbar max-h-[260px] overflow-y-auto rounded-[16px] border border-blue-100 bg-blue-50/70 p-3 text-xs leading-6 text-slate-700">
                      {prompt.trim() || "AI 会根据你的优化要求创建一版完整提示词。"}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-3 backdrop-blur-sm md:p-4 xl:p-8" role="dialog" aria-modal="true">
          <div className="flex max-h-[calc(100vh-24px)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] xl:max-h-[calc(100vh-64px)]">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200/70 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-950">图片预览</div>
                <div className="mt-1 max-w-2xl truncate text-xs text-slate-500">{previewItem.prompt}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    成本 {formatImageCost(previewItem)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    output {(previewItem.outputTokens ?? 0) > 0 ? (previewItem.outputTokens ?? 0).toLocaleString("zh-CN") : "-"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    调用 {previewItem.upstreamCallCount ?? 0}
                    {(previewItem.upstreamRetryCount ?? 0) > 0 ? ` · 重试 ${previewItem.upstreamRetryCount}` : ""}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button className="h-9 cursor-pointer rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => handleReuse(previewItem)}>
                  复用提示词
                </button>
                <button className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" type="button" onClick={() => setPreviewItem(null)} aria-label="关闭图片预览">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative min-h-[260px] bg-slate-100 md:min-h-0">
                <img src={previewItem.imageData} alt={previewItem.prompt} className="h-full w-full object-contain" />
              </div>
              <aside className="flex min-h-0 max-h-[46vh] flex-col border-t border-slate-200/70 bg-white md:max-h-none md:border-l md:border-t-0">
                <div className="shrink-0 border-b border-slate-200/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    AI 修改对话
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                      <div className="text-slate-500">当前版本</div>
                      <div className="mt-1 font-semibold text-slate-900">v{(previewItem.editDepth ?? 0) + 1}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                      <div className="text-slate-500">累计费用</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatUsd(conversation?.summary.estimatedCostUsd ?? previewItem.cumulativeEstimatedCostUsd ?? previewItem.estimatedCostUsd ?? 0)}
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
                          message.role === "user"
                            ? "ml-8 bg-slate-950 text-white"
                            : "mr-8 border border-slate-200 bg-white text-slate-700",
                        )}
                      >
                        <div>{message.content}</div>
                        {message.role === "assistant" ? (
                          <div className={cn("mt-1 text-[11px]", message.role === "user" ? "text-white/70" : "text-slate-500")}>
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
                    className="h-24 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                    value={editInstruction}
                    onChange={(event) => setEditInstruction(event.target.value)}
                    maxLength={MAX_PROMPT_LENGTH}
                    placeholder="告诉 AI 如何修改当前图片..."
                  />
                  <button
                    type="button"
                    className="mt-3 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
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
      ) : null}
    </div>
  );
}
