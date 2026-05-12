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
    normalized.includes("vl") ||
    normalized.includes("multimodal") ||
    normalized.includes("gpt-4o") ||
    normalized.includes("gpt-4.1") ||
    normalized.includes("gpt-5") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
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
  return normalized.includes("gpt-image") || normalized.includes("image-to-image") || normalized === "dall-e-2";
}

export function toAiModelOption(item: AiModelItem): AiModelOption {
  const usage = getAiModelUsage(item.model);
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

export function buildImageModelOptions(items: AiModelItem[]) {
  const managedOptions = items.filter((item) => item.enabled && item.model && isImageToImageModel(item.model)).map(toAiModelOption);
  const hasManagedDefault = managedOptions.some(
    (item) => item.provider === DEFAULT_IMAGE_MODEL_OPTION.provider && item.model === DEFAULT_IMAGE_MODEL_OPTION.model,
  );
  return hasManagedDefault ? managedOptions : [DEFAULT_IMAGE_MODEL_OPTION, ...managedOptions];
}

export function buildTextModelOptions(items: AiModelItem[]) {
  return items.filter((item) => item.enabled && item.model && !isImageToImageModel(item.model)).map(toAiModelOption);
}
