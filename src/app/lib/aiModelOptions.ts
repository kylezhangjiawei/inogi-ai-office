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

export type AiModelUsageKind = "text" | "multimodal" | "image";

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

/**
 * 将后端 AiModelItem 转换为前端 AiModelOption。
 * 优先使用 item.usage_kind（管理员显式设置），仅当为 'auto' 或未设置时回退到正则推断。
 */
export function toAiModelOption(item: AiModelItem): AiModelOption {
  const explicitKind = item.usage_kind && item.usage_kind !== "auto" ? item.usage_kind : null;
  const usage = explicitKind
    ? resolveExplicitUsage(explicitKind as AiModelUsageKind)
    : getAiModelUsage(item.model);

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

function resolveExplicitUsage(kind: AiModelUsageKind): { kind: AiModelUsageKind; label: string; description: string } {
  switch (kind) {
    case "image":
      return { kind: "image", label: "图片", description: "适合图片生成、参考图生图或图片编辑任务。" };
    case "multimodal":
      return { kind: "multimodal", label: "文本/图片", description: "适合文本任务，也适合带图片输入的理解、分析和问答。" };
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
  const hasManagedDefault = managedOptions.some(
    (item) => item.provider === DEFAULT_IMAGE_MODEL_OPTION.provider && item.model === DEFAULT_IMAGE_MODEL_OPTION.model,
  );
  return hasManagedDefault ? managedOptions : [DEFAULT_IMAGE_MODEL_OPTION, ...managedOptions];
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
