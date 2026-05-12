import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { AiModelItem, integrationManagementApi } from "./integrationManagementApi";
import { buildImageModelOptions, buildTextModelOptions } from "./aiModelOptions";

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

  const imageModelOptions = useMemo(() => buildImageModelOptions(modelRows), [modelRows]);
  const textModelOptions = useMemo(() => buildTextModelOptions(modelRows), [modelRows]);
  const preferredManagedImageModelValue = useMemo(
    () => imageModelOptions.find((item) => item.managed)?.value ?? "",
    [imageModelOptions],
  );

  return {
    modelRows,
    modelsLoading,
    loadModels,
    imageModelOptions,
    textModelOptions,
    preferredManagedImageModelValue,
  };
}
