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
import {
  DEFAULT_IMAGE_MODEL_OPTION,
  DEFAULT_IMAGE_MODEL_VALUE,
  formatAiModelOptionLabel,
} from "./lib/aiModelOptions";
import { useAiModelOptions } from "./lib/useAiModelOptions";

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
  imageData?: string;     // base64，新图片有 imageUrl 后可能为空
  imageUrl?: string | null; // OSS 公网 URL，优先使用
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
  "border border-border/85 bg-surface-container-lowest/94 shadow-[0_18px_44px_rgba(15,23,42,0.055)] ring-1 ring-white/75 backdrop-blur-xl";

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

function MiniPreview({ variant, imageData, imageUrl }: { variant?: ArtworkVariant; imageData?: string; imageUrl?: string | null }) {
  const src = imageUrl || imageData;
  return (
    <div className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl border border-white/70 bg-slate-100">
      {src ? (
        <img src={src} alt="作品缩略图" className="h-full w-full object-cover" />
      ) : (
        <ArtworkVisual variant={variant ?? "product"} compact />
      )}
    </div>
  );
}

function ArtworkVisual({ variant, compact = false }: { variant: ArtworkVariant; compact?: boolean }) {
  const base =
    variant === "product"
      ? "linear-gradient(135deg,var(--primary) 0%,var(--chart-2) 52%,var(--primary-container) 100%)"
      : variant === "brand"
        ? "linear-gradient(135deg,var(--surface-container-lowest) 0%,var(--primary-container) 48%,var(--surface-container-highest) 100%)"
        : variant === "ui"
          ? "linear-gradient(135deg,var(--on-surface) 0%,var(--primary) 52%,var(--chart-2) 100%)"
          : "linear-gradient(135deg,var(--surface-container-lowest) 0%,var(--surface-container-high) 36%,var(--outline-variant) 100%)";

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
          <div className={cn("absolute rounded-full bg-primary-container/80 blur-md", compact ? "right-3 top-5 h-5 w-5" : "right-[22%] top-[25%] h-20 w-20")} />
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
          <div className={cn("absolute rotate-[-14deg] rounded-[32px] bg-gradient-to-br from-white/85 to-primary-container/90 shadow-xl", compact ? "left-3 top-3 h-7 w-7" : "left-[16%] top-[16%] h-[34%] w-[24%]")} />
          <div className={cn("absolute rounded-full bg-gradient-to-br from-chart-2 to-primary shadow-2xl", compact ? "right-3 top-4 h-6 w-6" : "right-[18%] top-[20%] h-[30%] w-[24%]")} />
          <div className={cn("absolute rotate-[18deg] rounded-[28px] bg-white/54 backdrop-blur-md", compact ? "bottom-2 left-5 h-4 w-8" : "bottom-[18%] left-[32%] h-[24%] w-[34%]")} />
        </>
      ) : null}

      {variant === "ui" ? (
        <>
          <div className={cn("absolute rounded-2xl border border-white/24 bg-white/16 backdrop-blur-md", compact ? "left-2 top-2 h-5 w-9" : "left-[13%] top-[18%] h-[24%] w-[36%]")} />
          <div className={cn("absolute rounded-2xl border border-primary-container/30 bg-primary-container/20 backdrop-blur-md", compact ? "right-2 top-5 h-6 w-8" : "right-[12%] top-[32%] h-[30%] w-[34%]")} />
          <div className={cn("absolute rounded-full bg-primary-container/90", compact ? "left-4 bottom-3 h-1 w-8" : "left-[18%] bottom-[22%] h-1.5 w-[46%]")} />
          <div className={cn("absolute rounded-full bg-primary-container/90", compact ? "left-4 bottom-5 h-1 w-6" : "left-[22%] bottom-[32%] h-1.5 w-[34%]")} />
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

function GeneratingImageCard() {
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

export function UIDesignPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedRatio, setSelectedRatio] = useState<Size>("1792x1024");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_IMAGE_MODEL_VALUE);
  const [searchKeyword, setSearchKeyword] = useState("");
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
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);
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
  const normalizedSearchKeyword = deferredSearchKeyword.trim();
  const {
    modelsLoading,
    loadModels,
    imageModelOptions,
    chatModelOptions,
    preferredManagedImageModelValue,
  } = useAiModelOptions();

  const selectedModelOption = useMemo(
    () => imageModelOptions.find((item) => item.value === selectedModel) ?? DEFAULT_IMAGE_MODEL_OPTION,
    [imageModelOptions, selectedModel],
  );

  // 提示词优化：文本 + 多模态模型均可（chatModelOptions）
  const selectedPromptModelOption = useMemo(
    () => chatModelOptions.find((item) => item.value === promptChatModel) ?? chatModelOptions[0],
    [chatModelOptions, promptChatModel],
  );

  const selectedRatioOption = ratios.find((item) => item.value === selectedRatio) ?? ratios[1];
  const promptSummary = prompt.trim() || "填写提示词后会显示摘要";
  const latestOptimizedPrompt = [...promptChatMessages].reverse().find((item) => item.optimizedPrompt)?.optimizedPrompt ?? "";
  const activePromptChatSession = promptChatSessions.find((item) => item.id === activePromptChatSessionId) ?? null;

  const generationSettings = [
    ["模型", formatAiModelOptionLabel(selectedModelOption)],
    ["服务商", selectedModelOption.provider],
    ["模型标识", selectedModelOption.model],
    ["比例", selectedRatioOption.shortLabel],
  ];

  const loadGallery = useCallback(async (target: "current" | "history" | "favorite", query = "") => {
    setGalleryLoading(true);
    try {
      const today = getTodayBounds();
      const response = await apiList(1, 12, {
        favorite: target === "favorite",
        dateFrom: target === "current" ? today.start : undefined,
        dateTo: target === "current" ? today.end : target === "history" ? today.start : undefined,
        query,
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
    const currentOption = imageModelOptions.find((item) => item.value === selectedModel);
    if (!currentOption) {
      setSelectedModel(imageModelOptions[0]?.value ?? DEFAULT_IMAGE_MODEL_VALUE);
      return;
    }
    if (selectedModel !== DEFAULT_IMAGE_MODEL_VALUE) return;
    if (preferredManagedImageModelValue) {
      setSelectedModel(preferredManagedImageModelValue);
    }
  }, [imageModelOptions, preferredManagedImageModelValue, selectedModel]);

  useEffect(() => {
    if (promptChatModel && chatModelOptions.some((item) => item.value === promptChatModel)) {
      return;
    }
    setPromptChatModel(chatModelOptions[0]?.value ?? "");
  }, [promptChatModel, chatModelOptions]);

  useEffect(() => {
    const target = activeTab === "收藏" ? "favorite" : activeTab === "历史" ? "history" : "current";
    const timeout = window.setTimeout(() => {
      void loadGallery(target, normalizedSearchKeyword);
    }, normalizedSearchKeyword ? 280 : 0);
    return () => window.clearTimeout(timeout);
  }, [activeTab, loadGallery, normalizedSearchKeyword]);

  useEffect(() => {
    if (!editingItem) {
      setConversation(null);
      setEditInstruction("");
      return;
    }
    setConversation(editingItem.conversation ?? null);
    setEditInstruction("");
    void loadConversation(editingItem.id);
  }, [editingItem, loadConversation]);

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

  async function handleDownload(item: GeneratedImage) {
    const src = item.imageUrl || item.imageData;
    if (!src) return;
    // OSS URL 是 HTTPS 跨域地址，需 fetch 后转 blob 才能触发 download
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
        // 降级：直接用 URL 打开（由浏览器决定行为）
        window.open(item.imageUrl, "_blank");
        return;
      }
    }
    link.href = src;
    link.download = `ai-image-${item.id}.png`;
    link.click();
  }

  function handleOpenEdit(item: GeneratedImage) {
    setEditingItem(item);
  }

  async function handleEditImage() {
    if (!editingItem) return;
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
      // 有 imageData（base64）时压缩后作为参考图发送；无 imageData 时后端直接从 DB 读取
      let referenceDataUrl: string | undefined;
      if (editingItem.imageData) {
        const sourceReference = await compressDataUrlForUpstream(editingItem.imageData, MAX_UPSTREAM_REFERENCE_IMAGE_BYTES);
        if (sourceReference.compressed) {
          toast.info(`已压缩当前图片用于提交，大小 ${formatFileSize(sourceReference.size)}`);
        }
        referenceDataUrl = sourceReference.dataUrl;
      }
      const result = await apiEditImage(editingItem.id, {
        message,
        style: "vivid",
        size: editingItem.size,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data: referenceDataUrl,
      });
      setEditInstruction("");
      setEditingItem(result);
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
      void loadConversation(editingItem.id);
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

  const displayedItems = normalizedSearchKeyword
    ? tabItems.filter((item) => {
        const keyword = normalizedSearchKeyword.toLowerCase();
        const searchable = [
          item.prompt,
          item.revisedPrompt,
          item.model,
          item.style,
          item.size,
          item.quality,
          item.editInstruction,
          item.requestId,
        ].join(" ");
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
    <div className="relative flex min-h-screen w-full flex-col overflow-y-auto bg-background text-on-surface xl:h-full xl:min-h-[760px] xl:overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-slate-50/60" />
      <div className="pointer-events-none absolute inset-0 opacity-75 [background-image:linear-gradient(rgba(15,23,42,0.034)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.034)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:linear-gradient(180deg,black,transparent_74%)]" />

      <section className="relative z-10 shrink-0 overflow-hidden border-b border-slate-200/70 bg-white px-3 py-3 text-on-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-4 lg:px-5">
        <div className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary" />
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(79,70,229,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(79,70,229,0.04)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:linear-gradient(90deg,black,transparent_72%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--primary),transparent)]" />
        <div className="relative grid gap-3 min-[1440px]:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)] min-[1440px]:items-center 2xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-primary/15 bg-primary-container text-on-primary-container shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <Wand2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 xl:flex xl:items-center xl:gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-primary">AI Studio</div>
                <h1 className="mt-1 truncate text-2xl font-semibold leading-tight tracking-tight text-on-surface md:text-3xl xl:text-[1.7rem]">AI 图像生成器</h1>
              </div>
            </div>
          </div>

          <div className="overflow-auto flex w-full max-w-full flex-col gap-2 rounded-[10px] border border-border bg-white/90 p-2 shadow-[0_14px_34px_rgba(15,23,42,0.065)] ring-1 ring-white/80 backdrop-blur-sm lg:flex-row lg:items-center lg:gap-2.5">
            <div className="relative min-w-0 flex-1 lg:min-w-[220px] 2xl:min-w-[300px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                className="material-input h-10 w-full min-w-0 rounded-[8px] border-border bg-white pl-11 pr-10 text-slate-900 shadow-none"
                placeholder="搜索提示词、模型或作品"
              />
              {searchKeyword ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[6px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onClick={() => setSearchKeyword("")}
                  aria-label="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0 min-[1440px]:justify-end">
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-border bg-white px-3 text-xs font-semibold text-slate-600">
                <Layers3 className="h-3.5 w-3.5 text-primary" />
                当前 {currentImages.length}
              </div>
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-border bg-white px-3 text-xs font-semibold text-slate-600">
                <Heart className="h-3.5 w-3.5 text-rose-500" />
                收藏 {favoriteImages.length}
              </div>
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-border bg-white px-3 text-xs font-semibold text-slate-600">
                <Zap className="h-3.5 w-3.5 text-primary" />
                {usage ? formatUsd(usage.summary.estimatedCostUsd) : "2,840 点数"}
              </div>
              <div className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-border bg-white px-3 text-xs font-semibold text-slate-600">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                {todayLabel}
              </div>
              <button
                className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-border bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-primary/25 hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={usageLoading || galleryLoading}
                onClick={() => {
                  void loadUsage();
                  void loadGallery(
                    activeTab === "收藏" ? "favorite" : activeTab === "历史" ? "history" : "current",
                    searchKeyword.trim(),
                  );
                }}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", usageLoading || galleryLoading ? "animate-spin motion-reduce:animate-none" : "")} />
                刷新
              </button>
              <button
                className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-indigo-600 px-3 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-indigo-700 hover:shadow-[0_10px_22px_-8px_rgba(79,70,229,0.18)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={generating || referenceImageBusy}
                onClick={() => void handleGenerate()}
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">生成图像</span>
                <span className="sm:hidden">生成</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <main className="relative z-10 grid flex-1 items-start gap-4 overflow-visible p-3 sm:p-4 lg:p-4 xl:min-h-0 xl:items-stretch xl:overflow-hidden min-[1280px]:grid-cols-[280px_minmax(0,1fr)] min-[1440px]:grid-cols-[280px_minmax(0,1fr)_260px] min-[1536px]:grid-cols-[300px_minmax(0,1fr)_280px] 2xl:p-5">
        <aside className={cn("relative flex flex-col overflow-hidden rounded-[10px] p-4 xl:min-h-0 2xl:p-5", glassCard)}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold tracking-tight text-slate-950">创建图像</div>
              <div className="mt-1 text-xs text-slate-500">提示词、模型、参考图和输出控制</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary-container text-on-primary-container">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>

          <div className="material-scrollbar space-y-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            <section>
              <label className="mb-2 block text-xs font-semibold text-slate-700">AI 模型</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="material-input h-11 w-full cursor-pointer appearance-none rounded-[8px] border-slate-200 bg-surface-container-lowest pr-10 font-semibold text-slate-800 focus:border-primary/35 focus:ring-primary/10"
                >
                  {imageModelOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {formatAiModelOptionLabel(item)}
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
                <button className="inline-flex cursor-pointer items-center gap-1 rounded-[8px] border border-primary/15 bg-primary-container px-2.5 py-1 text-[11px] font-semibold text-on-primary-container transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="button" onClick={openPromptOptimizer}>
                  <Wand2 className="h-3 w-3" />
                  优化提示词
                </button>
              </div>
              <textarea
                className="material-input h-[156px] w-full resize-none rounded-[8px] border-slate-200 bg-surface-container-lowest leading-6 focus:border-primary/35 focus:ring-primary/10"
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
                className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-primary/25 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70"
                type="button"
                disabled={referenceImageBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[8px] bg-primary-container text-on-primary-container">
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
                      "cursor-pointer rounded-[8px] border px-2 py-3 text-center text-[11px] font-semibold leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      selectedRatio === item.value
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-surface-container-lowest text-slate-600 hover:border-primary/25 hover:bg-white",
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
              className="flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-indigo-600 text-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(79,70,229,0.30)] transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
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

        <section className="flex min-w-0 flex-col rounded-[10px] border border-border/70 bg-white/48 p-3 shadow-[0_16px_38px_rgba(15,23,42,0.045)] ring-1 ring-white/60 backdrop-blur-sm xl:min-h-0 xl:overflow-hidden">
          <div className="mb-4 flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full rounded-[10px] border border-slate-200/80 bg-white/90 p-1 shadow-[0_12px_30px_rgba(15,23,42,0.05)] sm:w-fit">
              {(["当前", "历史", "收藏"] as StudioTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setGalleryLoading(true); setActiveTab(tab); }}
                  className={cn(
                    "flex-1 cursor-pointer rounded-[6px] px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:flex-none",
                    activeTab === tab ? "bg-primary text-primary-foreground shadow-[0_8px_18px_-6px_rgba(79,70,229,0.20)]" : "text-slate-500 hover:bg-surface-container-low hover:text-slate-900",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center md:justify-end">
              <div className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                <Layers3 className="h-4 w-4 text-primary" />
                {activeTab === "当前" ? `今日 ${displayedItems.length} 张` : `${displayedItems.length} 张结果`}
              </div>
              <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/25 hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={generating || referenceImageBusy} onClick={() => void handleGenerate(true)}>
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
                重新生成
              </button>
              <button className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-primary/25 hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" type="button" onClick={() => void handleCopyPrompt()}>
                <Copy className="h-3.5 w-3.5" />
                复制提示词
              </button>
            </div>
          </div>

          <div className="material-scrollbar xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
            {generating && activeTab === "当前" ? (
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
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
              <div className={cn("flex h-56 items-center justify-center rounded-[10px] text-sm font-semibold text-slate-500", glassCard)}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                正在加载图片...
              </div>
            ) : displayedItems.length > 0 ? (
              <div className={cn("grid grid-cols-1 gap-5", displayedItems.length > 1 ? "2xl:grid-cols-2" : "")}>
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
              <div className={cn("flex h-56 flex-col items-center justify-center rounded-[10px] text-center", glassCard)}>
                <Sparkles className="h-6 w-6 text-primary" />
                <div className="mt-3 text-sm font-semibold text-slate-800">
                  {normalizedSearchKeyword ? "没有匹配的图片" : activeTab === "当前" ? "今日暂无图片" : "暂无图片"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {normalizedSearchKeyword
                    ? "换个关键词，或切换到其他 tab 继续搜索。"
                    : activeTab === "当前"
                      ? "今天生成的图片会显示在这里，历史图片请切换到历史。"
                      : "生成图片后会自动出现在这里"}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="material-scrollbar grid gap-4 min-[1280px]:col-span-2 min-[1280px]:grid-cols-3 min-[1280px]:pr-1 min-[1440px]:col-span-1 min-[1440px]:flex min-[1440px]:flex-col min-[1440px]:min-h-0 min-[1440px]:gap-3 min-[1440px]:overflow-y-auto">
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

          <section className={cn("relative overflow-hidden rounded-[10px] p-5", glassCard)}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-slate-950">生成设置</h2>
            </div>
            <div className="relative space-y-2">
              {generationSettings.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 last:pb-0">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className="truncate text-right text-xs font-semibold text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={cn("relative overflow-hidden rounded-[10px] p-5", glassCard)}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">用量监控</h2>
                <p className="mt-1 text-xs text-slate-500">按 UTC 日统计上游调用</p>
              </div>
              <button
                type="button"
                className="cursor-pointer rounded-[8px] border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-primary/25 hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void loadUsage()}
                disabled={usageLoading}
              >
                {usageLoading ? "刷新中" : "刷新"}
              </button>
            </div>
            {usage ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[8px] border border-border bg-surface-container-low p-3">
                    <div className="text-[11px] font-semibold text-slate-500">预估费用</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-950">
                      {formatUsd(usage.summary.estimatedCostUsd)}
                    </div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-surface-container-low p-3">
                    <div className="text-[11px] font-semibold text-slate-500">上游调用</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-950">{usage.summary.upstreamCalls}</div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-surface-container-low p-3">
                    <div className="text-[11px] font-semibold text-slate-500">输出 tokens</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-950">
                      {usage.summary.outputTokens.toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <div className="rounded-[8px] border border-border bg-surface-container-low p-3">
                    <div className="text-[11px] font-semibold text-slate-500">参考图 tokens</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-950">
                      {usage.summary.inputImageTokens.toLocaleString("zh-CN")}
                    </div>
                  </div>
                </div>
                <div className="rounded-[8px] border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-500">
                  成功 {usage.summary.successCalls} 次，失败 {usage.summary.errorCalls} 次，重试 {usage.summary.retryCalls} 次；图生图 {usage.summary.editCalls} 次。
                </div>
                {usage.entries.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="rounded-[8px] border border-slate-200 bg-slate-50/80 p-3">
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
              <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-xs leading-5 text-slate-500">
                暂无上游调用记录。新生成图片后会显示 token 和预估费用。
              </div>
            )}
          </section>

          <section className={cn("rounded-[10px] p-5 min-[1440px]:flex min-[1440px]:flex-1 min-[1440px]:flex-col", glassCard)}>
            <div className="mb-4 flex items-center gap-2">
              <Clipboard className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-slate-950">最近创作</h2>
            </div>
            <div className="space-y-3">
              {recentItems.length > 0 ? recentItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-[8px] border border-slate-200 bg-surface-container-low p-2.5 text-left transition hover:border-primary/25 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <MiniPreview imageData={item.imageData} imageUrl={item.imageUrl} />
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
                <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-xs leading-5 text-slate-500">
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
                  <MessageSquare className="h-4 w-4 text-indigo-500" />
                  AI 提示词优化
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-indigo-700">
                    自动回填
                  </span>
                  <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    {latestOptimizedPrompt ? "已有优化结果" : "等待优化"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                    {selectedPromptModelOption ? formatAiModelOptionLabel(selectedPromptModelOption) : "默认文本模型"}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {latestOptimizedPrompt ? (
                  <button
                    type="button"
                    className="h-9 cursor-pointer rounded-[14px] border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    onClick={() => {
                      setPrompt(latestOptimizedPrompt);
                      toast.success("已应用最新优化提示词");
                    }}
                  >
                    应用最新结果
                  </button>
                ) : null}
                <button
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
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
                      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] bg-indigo-600 text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
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
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-indigo-500 motion-reduce:animate-none" />
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
                            "w-full cursor-pointer rounded-[16px] border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                            active
                              ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                              : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-indigo-100 hover:bg-white",
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
              <div className="flex min-h-0 flex-col bg-slate-50/60">
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
                              ? "ml-auto bg-indigo-600 text-white"
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
                            className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
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
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500 motion-reduce:animate-none" />
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
                    className="h-24 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                    value={promptChatInput}
                    onChange={(event) => setPromptChatInput(event.target.value)}
                    maxLength={8000}
                    placeholder="例如：更突出产品卖点，补充材质、构图和灯光细节"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-400">{promptChatInput.length.toLocaleString("zh-CN")} / 8,000</div>
                    <button
                      type="button"
                      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
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
                      disabled={promptChatLoading || chatModelOptions.length === 0}
                    >
                      {chatModelOptions.length > 0 ? (
                        chatModelOptions.map((item) => (
                          <option key={item.value} value={item.value}>
                            {formatAiModelOptionLabel(item)}
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
                        className="cursor-pointer rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                        onClick={() => void handleCopyPrompt()}
                      >
                        复制
                      </button>
                    </div>
                    <div className="material-scrollbar max-h-[260px] overflow-y-auto rounded-[16px] border border-indigo-100 bg-indigo-50/70 p-3 text-xs leading-6 text-slate-700">
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="relative flex h-[50dvh] w-[50dvw] max-w-[calc(100vw-32px)] items-center justify-center overflow-hidden rounded-[18px] border border-white/15 bg-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.42)]"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={previewItem.imageUrl || previewItem.imageData} alt={previewItem.prompt} className="h-full w-full object-contain" />
            <button
              className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/92 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              type="button"
              onClick={() => setPreviewItem(null)}
              aria-label="关闭图片预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {editingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-3 backdrop-blur-sm md:p-4 xl:p-8" role="dialog" aria-modal="true">
          <div className="flex max-h-[calc(100vh-24px)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] xl:max-h-[calc(100vh-64px)]">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200/70 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-950">图片修改</div>
                <div className="mt-1 max-w-2xl truncate text-xs text-slate-500">{editingItem.prompt}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    成本 {formatImageCost(editingItem)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    output {(editingItem.outputTokens ?? 0) > 0 ? (editingItem.outputTokens ?? 0).toLocaleString("zh-CN") : "-"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1">
                    调用 {editingItem.upstreamCallCount ?? 0}
                    {(editingItem.upstreamRetryCount ?? 0) > 0 ? ` · 重试 ${editingItem.upstreamRetryCount}` : ""}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button className="h-9 cursor-pointer rounded-[14px] border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" type="button" onClick={() => handleReuse(editingItem)}>
                  复用提示词
                </button>
                <button className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" type="button" onClick={() => setEditingItem(null)} aria-label="关闭图片修改">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative min-h-[260px] bg-slate-100 md:min-h-0">
                <img src={editingItem.imageUrl || editingItem.imageData} alt={editingItem.prompt} className="h-full w-full object-contain" />
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
                      <div className="mt-1 font-semibold text-slate-900">v{(editingItem.editDepth ?? 0) + 1}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-2">
                      <div className="text-slate-500">累计费用</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatUsd(conversation?.summary.estimatedCostUsd ?? editingItem.cumulativeEstimatedCostUsd ?? editingItem.estimatedCostUsd ?? 0)}
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
      ) : null}
    </div>
  );
}
