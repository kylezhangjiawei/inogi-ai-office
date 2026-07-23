import { AiModelItem } from "./integrationManagementApi";

export type AiModelOption = {
  value: string;
  label: string;
  description: string;
  provider: string;
  model: string;
  modelId?: string;
  managed: boolean;
  usageKind: AiModelUsageKind;
  usageLabel: string;
  usageDescription: string;
};

export type AiModelUsageKind = "text" | "multimodal" | "image" | "embedding" | "document" | "video";

export type AiModelConfigLike = {
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  current_status?: string | null;
};

export const DEFAULT_IMAGE_MODEL_VALUE = "__openai_image_to_image__";

export const DEFAULT_IMAGE_MODEL_OPTION: AiModelOption = {
  value: DEFAULT_IMAGE_MODEL_VALUE,
  label: "OpenAI Image 2 Image",
  description: "默认使用 OpenAI gpt-image-1，支持参考图生图与高质量图片生成。",
  provider: "OpenAI",
  model: "gpt-image-1",
  managed: false,
  usageKind: "image",
  usageLabel: "图片",
  usageDescription: "适合图片生成、参考图生图或图片编辑任务。",
};

/**
 * 根据模型名称自动推断用途（仅当 usage_kind 为 'auto' 或未设置时使用）。
 */
export function getAiModelUsage(model?: string | null) {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return {
      kind: "text" as const,
      label: "文本",
      description: "适合文本对话、摘要、筛选和结构化提取任务。",
    };
  }

  if (isEmbeddingModelName(normalized)) {
    return {
      kind: "embedding" as const,
      label: "向量",
      description: "用于知识库向量化检索，不能用于对话或图片任务。",
    };
  }

  if (isDocumentModelName(normalized)) {
    return {
      kind: "document" as const,
      label: "文档解析",
      description: "用于读取解析文档 / 附件内容，不能用于对话或图片任务。",
    };
  }

  if (isVideoModelName(normalized)) {
    return {
      kind: "video" as const,
      label: "视频",
      description: "用于图生视频 / 文生视频，不能用于对话或图片任务。",
    };
  }

  if (isImageToImageModel(normalized)) {
    return {
      kind: "image" as const,
      label: "图片",
      description: "适合图片生成、参考图生图或图片编辑任务。",
    };
  }

  if (
    normalized.includes("vision") ||
    normalized.includes("-vl") ||
    normalized.includes("multimodal") ||
    normalized.includes("gpt-4o") ||
    normalized.includes("gpt-4.1") ||
    normalized.includes("gpt-5") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.includes("claude-3") ||
    normalized.includes("gemini") ||
    normalized.includes("qwen-vl") ||
    normalized.includes("internvl") ||
    normalized.includes("minicpm-v")
  ) {
    return {
      kind: "multimodal" as const,
      label: "文本/图片",
      description: "适合文本任务，也适合带图片输入的理解、分析和问答。",
    };
  }

  return {
    kind: "text" as const,
    label: "文本",
    description: "适合文本对话、摘要、筛选和结构化提取任务。",
  };
}

export function isImageToImageModel(model: string) {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("gpt-image") ||
    normalized.includes("image-to-image") ||
    normalized === "dall-e-2" ||
    normalized.startsWith("dall-e-")
  );
}

/** 名称推断：是否为向量化（embedding）模型。仅当 usage_kind=auto 未显式标注时兜底使用。 */
export function isEmbeddingModelName(model: string) {
  const normalized = model.toLowerCase();
  return normalized.includes("embedding") || /(^|[-_/])embed(?:ding)?s?($|[-_/])/.test(normalized);
}

/** 名称推断：是否为文档解析模型（如 qwen-doc 系列）。仅当 usage_kind=auto 未显式标注时兜底使用。 */
export function isDocumentModelName(model: string) {
  return /qwen-doc/i.test(model);
}

/** 名称推断：是否为视频生成模型（happyhorse 系列、i2v/t2v/r2v 后缀）。仅当 usage_kind=auto 未显式标注时兜底使用。 */
export function isVideoModelName(model: string) {
  const normalized = model.toLowerCase();
  return normalized.includes("happyhorse") || /(^|[-_/])(i2v|t2v|r2v)($|[-_/])/.test(normalized);
}

const USAGE_KINDS: readonly AiModelUsageKind[] = ["text", "multimodal", "image", "embedding", "document", "video"];

function isUsageKind(value: string): value is AiModelUsageKind {
  return (USAGE_KINDS as readonly string[]).includes(value);
}

/**
 * 用途判定的单一真源：usage_kind 显式（非 auto 且合法）时以它为准，
 * 否则回退到按模型名正则推断（getAiModelUsage）。
 * 任何「这个模型是什么用途 / 能不能用于某场景」的判断都应经由此函数，
 * 避免各处各写一套 name-regex 特判（如 qwen-doc）导致逻辑漂移。
 */
export function resolveModelUsageKind(input: { model?: string | null; usage_kind?: string | null }): AiModelUsageKind {
  const explicit = input.usage_kind && input.usage_kind !== "auto" ? input.usage_kind : null;
  if (explicit && isUsageKind(explicit)) return explicit;
  return getAiModelUsage(input.model).kind;
}

/** 是否可用于对话/聊天（文本或多模态，排除 image / embedding / document）。 */
export function isChatUsableModel(input: { model?: string | null; usage_kind?: string | null }): boolean {
  const kind = resolveModelUsageKind(input);
  return kind === "text" || kind === "multimodal";
}

/**
 * 将后端 AiModelItem 转换为前端 AiModelOption。
 * 优先使用 item.usage_kind（管理员显式设置），仅当为 'auto' 或未设置时回退到正则推断。
 */
export function toAiModelOption(item: AiModelItem): AiModelOption {
  const usage = resolveExplicitUsage(resolveModelUsageKind(item));

  return {
    value: item.id,
    label: item.name || item.model,
    description: `${usage.label} · ${usage.description} ${item.provider || "OpenAI"} / ${item.model}${
      item.current_status ? ` · ${item.current_status}` : ""
    }`,
    provider: item.provider || "OpenAI",
    model: item.model,
    modelId: item.id,
    managed: true,
    usageKind: usage.kind,
    usageLabel: usage.label,
    usageDescription: usage.description,
  };
}

export function resolveExplicitUsage(kind: AiModelUsageKind): { kind: AiModelUsageKind; label: string; description: string } {
  switch (kind) {
    case "image":
      return { kind: "image", label: "图片", description: "适合图片生成、参考图生图或图片编辑任务。" };
    case "multimodal":
      return { kind: "multimodal", label: "文本/图片", description: "适合文本任务，也适合带图片输入的理解、分析和问答。" };
    case "embedding":
      return { kind: "embedding", label: "向量", description: "用于知识库向量化检索，不能用于对话或图片任务。" };
    case "document":
      return { kind: "document", label: "文档解析", description: "用于读取解析文档 / 附件内容，不能用于对话或图片任务。" };
    case "video":
      return { kind: "video", label: "视频", description: "用于图生视频 / 文生视频，不能用于对话或图片任务。" };
    default:
      return { kind: "text", label: "文本", description: "适合文本对话、摘要、筛选和结构化提取任务。" };
  }
}

export function formatAiModelOptionLabel(item: AiModelOption) {
  const label = item.label.trim() || item.provider || item.model;
  const model = item.model.trim();
  const usageLabel = item.usageLabel ? ` · ${item.usageLabel}` : "";
  if (!model || label === model) return `${label}${usageLabel}`;
  return `${label}（${model}）${usageLabel}`;
}

export function formatAiModelConfigLabel(item: AiModelConfigLike) {
  const model = item.model?.trim() ?? "";
  const label = item.name?.trim() || item.provider?.trim() || model || "AI 模型";
  const usage = getAiModelUsage(model);
  if (!model || label === model) return `${label} · ${usage.label}`;
  return `${label} / ${model} · ${usage.label}`;
}

// ── 各场景专用的 builder ──────────────────────────────────────────────────────

/** 图片生成模型（usageKind === 'image'） */
export function buildImageModelOptions(items: AiModelItem[]) {
  const managedOptions = items
    .filter((item) => item.enabled && item.model && toAiModelOption(item).usageKind === "image")
    .map(toAiModelOption);
  // 管理员已配置任意托管图片模型时，列表只展示这些托管模型；
  // 仅当没有任何托管图片模型时，才回退到内置的 OpenAI 图生图默认项，避免出现
  // 「内置 gpt-image-1」与「托管 gpt-image-2」并存这类看似重复的困惑条目。
  return managedOptions.length > 0 ? managedOptions : [DEFAULT_IMAGE_MODEL_OPTION];
}

/** 纯文本模型（usageKind === 'text'） */
export function buildTextModelOptions(items: AiModelItem[]) {
  return items
    .filter((item) => item.enabled && item.model && toAiModelOption(item).usageKind === "text")
    .map(toAiModelOption);
}

/** 多模态模型（usageKind === 'multimodal'） */
export function buildMultimodalModelOptions(items: AiModelItem[]) {
  return items
    .filter((item) => item.enabled && item.model && toAiModelOption(item).usageKind === "multimodal")
    .map(toAiModelOption);
}

/**
 * 对话/聊天场景：文本 + 多模态（排除图片生成）。
 * 适用于：MateChatBubble、提示词优化、RD 场景配置等。
 */
export function buildChatModelOptions(items: AiModelItem[]) {
  return items
    .filter((item) => {
      if (!item.enabled || !item.model) return false;
      const kind = toAiModelOption(item).usageKind;
      return kind === "text" || kind === "multimodal";
    })
    .map(toAiModelOption);
}

/** 向量化模型（usageKind === 'embedding'），用于知识库检索配置 */
export function buildEmbeddingModelOptions(items: AiModelItem[]) {
  return items
    .filter((item) => item.enabled && item.model && toAiModelOption(item).usageKind === "embedding")
    .map(toAiModelOption);
}

/** 文档解析模型（usageKind === 'document'），用于附件 / 文件读取配置 */
export function buildDocumentModelOptions(items: AiModelItem[]) {
  return items
    .filter((item) => item.enabled && item.model && toAiModelOption(item).usageKind === "document")
    .map(toAiModelOption);
}
