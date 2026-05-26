import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { AiModelItem, integrationManagementApi } from "./integrationManagementApi";
import {
  buildChatModelOptions,
  buildImageModelOptions,
  buildMultimodalModelOptions,
  buildTextModelOptions,
} from "./aiModelOptions";

export function useAiModelOptions(pageSize = 100) {
  const [modelRows, setModelRows] = useState<AiModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await integrationManagementApi.listAiModels({ page: 1, pageSize });
      setModelRows(response.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型列表加载失败");
    } finally {
      setModelsLoading(false);
    }
  }, [pageSize]);

  /** 图片生成模型（usageKind === 'image'），附默认托管选项 */
  const imageModelOptions = useMemo(() => buildImageModelOptions(modelRows), [modelRows]);

  /** 纯文本模型（usageKind === 'text'） */
  const textModelOptions = useMemo(() => buildTextModelOptions(modelRows), [modelRows]);

  /** 多模态模型（usageKind === 'multimodal'，可理解图片） */
  const multimodalModelOptions = useMemo(() => buildMultimodalModelOptions(modelRows), [modelRows]);

  /**
   * 对话 / 提示词优化等场景：文本 + 多模态（排除图片生成）。
   * 替代旧的 textModelOptions 用于对话、提示词优化、RD 场景等页面。
   */
  const chatModelOptions = useMemo(() => buildChatModelOptions(modelRows), [modelRows]);

  const preferredManagedImageModelValue = useMemo(
    () => imageModelOptions.find((item) => item.managed)?.value ?? "",
    [imageModelOptions],
  );

  return {
    modelRows,
    modelsLoading,
    loadModels,
    /** 图片生成模型 */
    imageModelOptions,
    /** 纯文本模型 */
    textModelOptions,
    /** 多模态（图文理解）模型 */
    multimodalModelOptions,
    /** 文本 + 多模态（适合对话、提示词优化、研发场景配置等） */
    chatModelOptions,
    preferredManagedImageModelValue,
  };
}
