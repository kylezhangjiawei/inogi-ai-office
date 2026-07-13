import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Download, PackagePlus, Pencil, Plus, Search, Trash2, Upload, Wifi } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { MaterialSelect } from "./components/MaterialFields";
import { AiModelItem, integrationManagementApi } from "./lib/integrationManagementApi";
import { dictionaryApi } from "./lib/dictionaryApi";
import { cn } from "./components/ui/utils";
import { resolveExplicitUsage, resolveModelUsageKind } from "./lib/aiModelOptions";

const AI_PROVIDER_DICT_KEY = "ai_provider";

const PAGE_SIZE = 8;

type DialogMode = "create" | "edit" | "delete" | null;

// ── 百炼 Token Plan 预设模型目录 ──────────────────────────────────────────────
// 与阿里云百炼「可使用模型」页面一一对应；usageKind 按页面标注的模型能力显式指定
// （含视觉理解 → multimodal，图片生成 → image，其余 → text），避免自动推断漂移。

const BAILIAN_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

type PresetModel = {
  brand: string;
  provider: string;
  model: string;
  capability: string;
  usageKind: "text" | "multimodal" | "image";
};

const BAILIAN_PRESET_MODELS: PresetModel[] = [
  { brand: "千问", provider: "Qwen", model: "qwen3.7-plus", capability: "文本生成、推理模型、视觉理解", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen3.7-max", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "千问", provider: "Qwen", model: "qwen3.6-plus", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen3.6-flash", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen-image-2.0", capability: "图片生成", usageKind: "image" },
  { brand: "千问", provider: "Qwen", model: "qwen-image-2.0-pro", capability: "图片生成", usageKind: "image" },
  { brand: "万相", provider: "Wanx", model: "wan2.7-image", capability: "图片生成", usageKind: "image" },
  { brand: "万相", provider: "Wanx", model: "wan2.7-image-pro", capability: "图片生成", usageKind: "image" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v4-pro", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v4-flash", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v3.2", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.7-code", capability: "文本生成、视觉理解、推理模型", usageKind: "multimodal" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.6", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.5", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5.2", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5.1", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "MiniMax", provider: "MiniMax", model: "MiniMax-M2.5", capability: "推理模型、文本生成", usageKind: "text" },
];

const PRESET_BRANDS = Array.from(new Set(BAILIAN_PRESET_MODELS.map((item) => item.brand)));

// ── 导入 / 导出 ───────────────────────────────────────────────────────────────
// 导出文件不含 API Key（密文不可回读）；导入时可统一补一个 Key，或导入后逐条编辑。

const EXPORT_USAGE_KINDS = new Set(["auto", "text", "multimodal", "image", "embedding", "document"]);

type ExportedModel = {
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  usage_kind?: string;
  enabled?: boolean;
};

type ImportEntry = ExportedModel & { duplicate: boolean };

/** 翻页拉全量模型配置（列表接口 page_size 上限 100），用于导出与去重 */
async function fetchAllAiModels(): Promise<AiModelItem[]> {
  const all: AiModelItem[] = [];
  let page = 1;
  for (;;) {
    const response = await integrationManagementApi.listAiModels({ page, pageSize: 100 });
    all.push(...response.items);
    if (page >= response.total_pages || response.items.length === 0) break;
    page += 1;
  }
  return all;
}

function parseImportedModels(raw: string): ExportedModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是合法的 JSON");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
      ? ((parsed as { models: unknown[] }).models)
      : null;
  if (!list) {
    throw new Error("JSON 结构不符合导出格式（应为数组或 { models: [...] }）");
  }

  const entries: ExportedModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const model = typeof record.model === "string" ? record.model.trim() : "";
    if (!name || !provider || !model) continue;
    const usageKind = typeof record.usage_kind === "string" && EXPORT_USAGE_KINDS.has(record.usage_kind)
      ? record.usage_kind
      : "auto";
    entries.push({
      name,
      provider,
      model,
      base_url: typeof record.base_url === "string" ? record.base_url.trim() : undefined,
      usage_kind: usageKind,
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    });
  }
  if (entries.length === 0) {
    throw new Error("文件中没有可导入的模型配置（每条至少需要 name / provider / model）");
  }
  return entries;
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const statusToneMap: Record<string, string> = {
  运行正常: "bg-emerald-50 text-emerald-700",
  连接异常: "bg-rose-50 text-rose-700",
  未配置: "bg-slate-100 text-slate-600",
};

const usageToneMap: Record<string, string> = {
  text: "bg-sky-50 text-sky-700",
  multimodal: "bg-violet-50 text-violet-700",
  image: "bg-amber-50 text-amber-700",
  embedding: "bg-teal-50 text-teal-700",
  document: "bg-indigo-50 text-indigo-700",
};

export function AiModelManagementPage() {
  const [rows, setRows] = useState<AiModelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  // 行内"测试连通性"按钮的 loading 标记（每行独立）
  const [rowTestingId, setRowTestingId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRow, setSelectedRow] = useState<AiModelItem | null>(null);
  const [providerOptions, setProviderOptions] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OpenAI");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [usageKind, setUsageKind] = useState("auto");
  const [enabled, setEnabled] = useState(true);
  const [isDefaultEnabled, setIsDefaultEnabled] = useState(true);
  const [dialogError, setDialogError] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const normalizedKeyword = deferredKeyword.trim();

  // ── 百炼预设 / 导入 / 导出 ──────────────────────────────────────────────────
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetSelected, setPresetSelected] = useState<Set<string>>(new Set());
  const [presetExisting, setPresetExisting] = useState<Set<string>>(new Set());
  const [presetApiKey, setPresetApiKey] = useState("");
  const [presetBaseUrl, setPresetBaseUrl] = useState(BAILIAN_BASE_URL);
  const [presetSaving, setPresetSaving] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRows, setExportRows] = useState<AiModelItem[]>([]);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());
  const [exportLoading, setExportLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importEntries, setImportEntries] = useState<ImportEntry[]>([]);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  const [importApiKey, setImportApiKey] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const loadRows = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const response = await integrationManagementApi.listAiModels({
        page: targetPage,
        pageSize,
        keyword: normalizedKeyword,
      });
      setRows(response.items);
      setTotal(response.total);
      setTotalPages(Math.max(1, response.total_pages));
      if (targetPage > response.total_pages) {
        setPage(Math.max(1, response.total_pages));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取 AI 模型列表失败");
    } finally {
      setLoading(false);
    }
  }, [normalizedKeyword, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [normalizedKeyword, pageSize]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const types = await dictionaryApi.listTypes();
        const providerType = types.find((type) => type.key === AI_PROVIDER_DICT_KEY);
        if (!providerType) return;
        const response = await dictionaryApi.listItems(providerType.id, { page: 1, pageSize: 100 });
        if (cancelled) return;
        const labels = response.items
          .map((item) => (item.kind === "generic" ? item.label.trim() : ""))
          .filter((label) => label.length > 0);
        setProviderOptions(Array.from(new Set(labels)));
      } catch {
        // 字典不可用时静默降级为纯文本输入
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setName("");
    setProvider("OpenAI");
    setModel("");
    setBaseUrl("");
    setApiKey("");
    setUsageKind("auto");
    setEnabled(true);
    setIsDefaultEnabled(true);
    setDialogError("");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRow(null);
    resetForm();
  }

  function openCreate() {
    setSelectedRow(null);
    resetForm();
    setDialogMode("create");
  }

  /**
   * 快捷新增 Embedding 模型（RAG 向量检索专用）。
   * 预填通义 text-embedding-v3，用户只需填 name + API Key 即可保存。
   */
  function openCreateEmbedding() {
    setSelectedRow(null);
    setName("通义 Embedding");
    setProvider("Qwen");
    setModel("text-embedding-v3");
    setBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
    setApiKey("");
    setUsageKind("embedding");
    setEnabled(true);
    setIsDefaultEnabled(false);
    setDialogError("");
    setDialogMode("create");
  }

  function openEdit(row: AiModelItem) {
    setSelectedRow(row);
    setName(row.name);
    setProvider(row.provider || "OpenAI");
    setModel(row.model);
    setBaseUrl(row.base_url || "");
    setApiKey("");
    setUsageKind(row.usage_kind || "auto");
    setEnabled(row.enabled);
    setIsDefaultEnabled(row.is_default_enabled);
    setDialogMode("edit");
  }

  function openDelete(row: AiModelItem) {
    setSelectedRow(row);
    setDialogMode("delete");
  }

  async function handleSave() {
    if (!name.trim() || !provider.trim() || !model.trim()) {
      toast.error("请先填写模型名称、服务商和模型标识");
      return;
    }

    setDialogError("");
    setSaving(true);
    try {
      await integrationManagementApi.saveAiModel({
        id: selectedRow?.id,
        name: name.trim(),
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        enabled,
        current_status: selectedRow?.current_status ?? "未配置",
        is_default_enabled: isDefaultEnabled,
        usage_kind: usageKind,
      });
      toast.success(dialogMode === "edit" ? "AI 模型已更新" : "AI 模型已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadRows(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 AI 模型失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!model.trim()) {
      toast.error("请先填写模型标识");
      return;
    }

    setDialogError("");
    setTestingConnection(true);
    try {
      const result = await integrationManagementApi.testAiModelConnection({
        id: selectedRow?.id,
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
      });

      if (result.success) {
        toast.success(
          `测试成功${typeof result.duration_ms === "number" ? `，耗时 ${result.duration_ms} ms` : ""}`,
        );
      } else {
        toast.error(result.message);
      }

      await loadRows(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 连通性测试失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setTestingConnection(false);
    }
  }

  /**
   * 列表操作栏的"测试连通性"——直接用 row 数据测试，不弹编辑对话框。
   * API Key 走已保存的密文，base_url / provider / model 都从 row 取。
   */
  async function handleTestRowConnection(row: AiModelItem) {
    if (rowTestingId) return;
    setRowTestingId(row.id);
    try {
      const result = await integrationManagementApi.testAiModelConnection({
        id: row.id,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
      });
      if (result.success) {
        toast.success(
          `${row.name} 连通性正常${typeof result.duration_ms === "number" ? `，耗时 ${result.duration_ms} ms` : ""}`,
        );
      } else {
        toast.error(`${row.name} 测试失败：${result.message}`);
      }
      await loadRows(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 连通性测试失败");
    } finally {
      setRowTestingId(null);
    }
  }

  async function handleToggleEnabled(row: AiModelItem, checked: boolean) {
    try {
      const saved = await integrationManagementApi.saveAiModel({
        id: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        enabled: checked,
        current_status: row.current_status,
        is_default_enabled: row.is_default_enabled,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)));
      if (selectedRow?.id === row.id) {
        setSelectedRow(saved);
      }
      toast.success(checked ? "AI 模型已启用" : "AI 模型已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新 AI 模型启用状态失败");
    }
  }

  async function handleDelete() {
    if (!selectedRow) return;

    setDeleting(true);
    try {
      await integrationManagementApi.deleteAiModel(selectedRow.id);
      toast.success("AI 模型已删除");
      closeDialog();
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 AI 模型失败");
    } finally {
      setDeleting(false);
    }
  }

  // ── 百炼预设新增 ────────────────────────────────────────────────────────────

  async function openPresetDialog() {
    setPresetApiKey("");
    setPresetBaseUrl(BAILIAN_BASE_URL);
    setPresetSelected(new Set());
    try {
      const all = await fetchAllAiModels();
      setPresetExisting(new Set(all.map((item) => item.model.trim().toLowerCase())));
    } catch (error) {
      // 拉全量失败时降级为不去重（只影响"已存在"标记，不影响新增本身）
      setPresetExisting(new Set());
      toast.error(error instanceof Error ? error.message : "读取现有模型列表失败");
    }
    setPresetOpen(true);
  }

  function togglePresetModel(model: string) {
    setPresetSelected((current) => {
      const next = new Set(current);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  function selectAllPresetModels() {
    setPresetSelected(new Set(
      BAILIAN_PRESET_MODELS
        .filter((item) => !presetExisting.has(item.model.toLowerCase()))
        .map((item) => item.model),
    ));
  }

  async function handlePresetCreate() {
    const targets = BAILIAN_PRESET_MODELS.filter((item) => presetSelected.has(item.model));
    if (targets.length === 0) {
      toast.error("请先勾选要新增的模型");
      return;
    }
    if (!presetApiKey.trim()) {
      toast.error("请填写 API Key（百炼 Token Plan 的令牌）");
      return;
    }
    if (!presetBaseUrl.trim()) {
      toast.error("请填写 Base URL");
      return;
    }

    setPresetSaving(true);
    const failures: string[] = [];
    try {
      for (const item of targets) {
        try {
          await integrationManagementApi.saveAiModel({
            name: `${item.brand} ${item.model}`,
            provider: item.provider,
            model: item.model,
            base_url: presetBaseUrl.trim(),
            api_key: presetApiKey.trim(),
            usage_kind: item.usageKind,
            enabled: true,
            current_status: "未配置",
            // 只做新增：不抢默认模型，避免影响现有配置
            is_default_enabled: false,
          });
        } catch (error) {
          failures.push(`${item.model}：${error instanceof Error ? error.message : "保存失败"}`);
        }
      }
      const successCount = targets.length - failures.length;
      if (successCount > 0) {
        toast.success(`已新增 ${successCount} 个模型配置`);
      }
      if (failures.length > 0) {
        toast.error(`有 ${failures.length} 个模型新增失败：${failures[0]}`);
      }
      if (successCount > 0) {
        setPresetOpen(false);
        setPresetApiKey("");
        if (page !== 1) setPage(1);
        else await loadRows(1);
      }
    } finally {
      setPresetSaving(false);
    }
  }

  // ── 导出 ────────────────────────────────────────────────────────────────────

  async function openExportDialog() {
    setExportLoading(true);
    try {
      const all = await fetchAllAiModels();
      if (all.length === 0) {
        toast.error("暂无可导出的模型配置");
        return;
      }
      setExportRows(all);
      setExportSelected(new Set(all.map((item) => item.id)));
      setExportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取模型列表失败");
    } finally {
      setExportLoading(false);
    }
  }

  function toggleExportRow(id: string) {
    setExportSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExport() {
    const selected = exportRows.filter((row) => exportSelected.has(row.id));
    if (selected.length === 0) {
      toast.error("请先勾选要导出的模型配置");
      return;
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    downloadJsonFile(`ai-models-export-${stamp}.json`, {
      version: 1,
      exported_at: now.toISOString(),
      models: selected.map((row) => ({
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        usage_kind: row.usage_kind || "auto",
        enabled: row.enabled,
      }) satisfies ExportedModel),
    });
    toast.success(`已导出 ${selected.length} 个模型配置（不含 API Key）`);
    setExportOpen(false);
  }

  // ── 导入 ────────────────────────────────────────────────────────────────────

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const [entries, all] = await Promise.all([
        file.text().then(parseImportedModels),
        fetchAllAiModels().catch(() => [] as AiModelItem[]),
      ]);
      const existing = new Set(all.map((item) => item.model.trim().toLowerCase()));
      const marked = entries.map((entry) => ({
        ...entry,
        duplicate: existing.has(entry.model.toLowerCase()),
      }));
      setImportEntries(marked);
      // 与现有模型标识重复的条目默认不勾选，避免无意间导入重复配置
      setImportSelected(new Set(marked.map((entry, index) => (entry.duplicate ? -1 : index)).filter((index) => index >= 0)));
      setImportApiKey("");
      setImportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "解析导入文件失败");
    }
  }

  function toggleImportEntry(index: number) {
    setImportSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleImportCreate() {
    const targets = importEntries.filter((_, index) => importSelected.has(index));
    if (targets.length === 0) {
      toast.error("请先勾选要导入的模型配置");
      return;
    }

    setImportSaving(true);
    const failures: string[] = [];
    try {
      for (const entry of targets) {
        try {
          await integrationManagementApi.saveAiModel({
            name: entry.name,
            provider: entry.provider,
            model: entry.model,
            base_url: entry.base_url || undefined,
            api_key: importApiKey.trim() || undefined,
            usage_kind: entry.usage_kind || "auto",
            enabled: entry.enabled ?? true,
            current_status: "未配置",
            // 只做新增：导入不抢默认模型，避免清掉现有默认项
            is_default_enabled: false,
          });
        } catch (error) {
          failures.push(`${entry.model}：${error instanceof Error ? error.message : "保存失败"}`);
        }
      }
      const successCount = targets.length - failures.length;
      if (successCount > 0) {
        toast.success(`已导入 ${successCount} 个模型配置`);
      }
      if (failures.length > 0) {
        toast.error(`有 ${failures.length} 个模型导入失败：${failures[0]}`);
      }
      if (successCount > 0) {
        setImportOpen(false);
        setImportEntries([]);
        if (page !== 1) setPage(1);
        else await loadRows(1);
      }
    } finally {
      setImportSaving(false);
    }
  }

  function handleJump() {
    const value = Number.parseInt(jumpInput, 10);
    if (Number.isNaN(value)) {
      setJumpInput("");
      return;
    }

    setPage(Math.min(totalPages, Math.max(1, value)));
    setJumpInput("");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-indigo-50 text-indigo-700">AI Model Management</span>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">AI 模型管理</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={() => importFileRef.current?.click()}
              title="从 JSON 文件导入模型配置（只新增，不修改现有配置）"
            >
              <Upload className="h-4 w-4" />
              导入
            </button>
            <button
              type="button"
              className="material-button-secondary w-fit disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void openExportDialog()}
              disabled={exportLoading}
              title="勾选现有模型配置并导出为 JSON 文件（不含 API Key）"
            >
              <Download className="h-4 w-4" />
              {exportLoading ? "读取中..." : "导出"}
            </button>
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={() => void openPresetDialog()}
              title="从阿里云百炼 Token Plan 可使用模型目录中批量新增"
            >
              <PackagePlus className="h-4 w-4" />
              百炼预设
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleImportFile(event)}
            />
            <button
              type="button"
              className="material-button-secondary w-fit"
              onClick={openCreateEmbedding}
              title="一键新增 Embedding 模型，用于知识库 RAG 向量检索"
            >
              <Plus className="h-4 w-4" />
              新增 Embedding
            </button>
            <button className="material-button-primary w-fit" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增模型
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          维护模型服务商、Base URL、运行状态、延迟和自动统计信息，支持按不同模型独立切换网关或代理地址。
        </p>
      </section>

      <section className="material-card p-6">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索模型名称、服务商、模型标识..."
            />
          </div>
          <div className="text-sm text-slate-500">共 {total} 个模型配置</div>
        </div>

        <div className="material-scrollbar overflow-x-auto">
          <Table className="min-w-[1560px] text-left">
            <TableHeader className="bg-slate-50">
              <TableRow>
                {[
                  "供应商",
                  "模型名称",
                  "服务商",
                  "适用场景",
                  "启用",
                  "当前状态",
                  "最近成功时间",
                  "最近失败时间",
                  "最近延迟",
                  "今日请求数",
                  "今日 Token",
                  "Token 总使用量",
                  "默认启用",
                  "操作人",
                  "操作",
                ].map((title) => (
                  <TableHead key={title} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
            {loading ? (
              <TableRow>
                <TableCell colSpan={15} className="px-4 py-8 text-center text-sm text-slate-400">
                  正在加载 AI 模型...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="px-4 py-8 text-center text-sm text-slate-400">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                  // 用途判定复用共享逻辑：usage_kind 权威 + 名称兜底，覆盖全部类型
                  //（文本/多模态/图片/向量/文档解析），避免此处再各写一套映射而漂移。
                  const explicitKind = row.usage_kind && row.usage_kind !== "auto" ? row.usage_kind : null;
                  const usage = resolveExplicitUsage(resolveModelUsageKind(row));
                  return (
                    <TableRow key={row.id} className="hover:bg-slate-50/70">
                      <TableCell className="px-4 py-3 text-sm font-medium text-slate-800">
                        <div>{row.name}</div>
                        <div
                          className="mt-1 max-w-[260px] truncate text-xs text-slate-400"
                          title={row.base_url || "未配置 Base URL，默认走官方地址"}
                        >
                          {row.base_url || "默认官方地址"}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm">
                        <span className="inline-flex max-w-[220px] items-center rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-700">
                          <span className="truncate" title={row.model}>{row.model}</span>
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.provider}</TableCell>
                      <TableCell className="px-4 py-3 text-sm w-[220px] max-w-[220px]">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("material-chip shrink-0", usageToneMap[usage.kind])}>{usage.label}</span>
                            {explicitKind
                              ? <span className="text-[10px] text-emerald-600 font-medium shrink-0">手动</span>
                              : <span className="text-[10px] text-slate-400 shrink-0">自动</span>
                            }
                          </div>
                          <div className="w-[188px] text-xs leading-5 text-slate-400 whitespace-normal">{usage.description}</div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm w-[100px] min-w-[100px]">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Switch checked={row.enabled} onCheckedChange={(checked) => void handleToggleEnabled(row, checked)} />
                          <span>{row.enabled ? "启用" : "停用"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm">
                        <div className="space-y-2">
                          <span className={cn("material-chip", statusToneMap[row.current_status] ?? "bg-slate-100 text-slate-600")}>
                            {row.current_status}
                          </span>
                          {row.last_error_message ? (
                            <div className="max-w-[220px] truncate text-xs text-rose-500" title={row.last_error_message}>
                              {row.last_error_message}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.last_success_at)}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-500">{formatDate(row.last_failure_at)}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">
                        {typeof row.last_latency_ms === "number" ? `${row.last_latency_ms} ms` : "-"}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.today_requests}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.today_tokens}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.total_tokens ?? row.today_tokens ?? 0}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.is_default_enabled ? "是" : "否"}</TableCell>
                      <TableCell className="px-4 py-3 text-sm text-slate-700">{row.operator_name}</TableCell>
                      <TableCell className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button
                            className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleTestRowConnection(row)}
                            disabled={rowTestingId === row.id}
                            title="测试连通性"
                          >
                            <Wifi className={`h-3.5 w-3.5 ${rowTestingId === row.id ? "animate-pulse text-indigo-500" : ""}`} />
                          </button>
                          <button className="material-button-secondary !px-3 !py-2" onClick={() => openEdit(row)} title="编辑">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="material-button-secondary !px-3 !py-2 text-red-500 hover:border-red-200 hover:bg-red-50"
                            onClick={() => openDelete(row)}
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
            )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>共 {total} 条，当前第 {page} / {totalPages} 页</span>
            <span className="flex items-center gap-1.5">
              每页
              <select
                className="material-input !w-auto !px-2 !py-1.5 text-sm"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {[8, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              条
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading}>
              上一页
            </button>
            <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages || loading}>
              下一页
            </button>
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
              跳转
              <input
                className="material-input w-14 text-center"
                value={jumpInput}
                onChange={(event) => setJumpInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleJump()}
                placeholder={String(page)}
              />
              页
              <button className="material-button-secondary !px-3 !py-2" onClick={handleJump} disabled={loading}>
                GO
              </button>
            </span>
          </div>
        </div>
      </section>

      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onClose={closeDialog}
        fullWidth
        maxWidth="md"
        // Radix Select 的下拉用 Portal 渲染到 body，MUI 默认的焦点陷阱会把焦点抢回 Dialog
        // 导致下拉一打开就被关闭；关掉 enforceFocus 后下拉才能正常交互。
        disableEnforceFocus
      >
        <DialogTitle>{dialogMode === "edit" ? "编辑 AI 模型" : "新增 AI 模型"}</DialogTitle>
        <DialogContent dividers>
          <div className="grid gap-4 pt-1 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">模型名称</label>
              <input className="material-input w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="如：GPT-5 主模型" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">服务商</label>
              <input
                className="material-input w-full"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="如：OpenAI"
                list="ai-provider-options"
              />
              {providerOptions.length > 0 && (
                <datalist id="ai-provider-options">
                  {providerOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">模型标识</label>
              <input className="material-input w-full" value={model} onChange={(event) => setModel(event.target.value)} placeholder="如：gpt-5" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">API Key</label>
              <input
                className="material-input w-full"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={dialogMode === "edit" && selectedRow?.has_api_key ? "留空则保留原 API Key" : "请输入 API Key"}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Base URL</label>
              <input
                className="material-input w-full"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="如：https://api.openai.com/v1 或你的代理/网关地址"
              />
              <p className="mt-1.5 text-xs leading-5 text-slate-400">
                不填写时默认走后端环境中的官方地址；如果浏览器能通、服务端不能通，优先在这里配置代理或网关地址。
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                用途类型
              </label>
              <MaterialSelect
                value={usageKind}
                onValueChange={setUsageKind}
                contentClassName="z-[1400]"
                options={[
                  { value: "auto", label: "自动识别（根据模型名称推断）" },
                  { value: "text", label: "文本 — 纯文字对话、摘要、提取" },
                  { value: "multimodal", label: "文本/图片 — 多模态理解（可接收图片输入）" },
                  { value: "image", label: "图片生成 — 文生图、参考图生图" },
                  { value: "embedding", label: "向量 — 知识库 RAG 向量化检索" },
                  { value: "document", label: "文档解析 — 读取附件 / 文件内容" },
                ]}
              />
              <p className="mt-1.5 text-xs leading-5 text-slate-400">
                手动指定后，系统将精准分配此模型到对应场景（对话、图片生成等），避免模型出现在不兼容的选择列表中。
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm text-slate-700">{enabled ? "已启用" : "已停用"}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input id="is_default_enabled" type="checkbox" checked={isDefaultEnabled} onChange={(event) => setIsDefaultEnabled(event.target.checked)} />
              <label htmlFor="is_default_enabled" className="text-sm text-slate-700">
                默认启用
              </label>
            </div>
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-500 md:col-span-2">
              当前状态、最近成功时间、最近失败时间、最近延迟、今日请求数、今日 Token 和 Token 总使用量都由系统自动获取或自动计算。
            </div>
            {dialogError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 md:col-span-2">
                {dialogError}
              </div>
            ) : null}
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={saving || testingConnection}>
            取消
          </button>
          <button type="button" className="material-button-secondary" onClick={() => void handleTestConnection()} disabled={saving || testingConnection}>
            <Wifi className="h-4 w-4" />
            {testingConnection ? "测试中..." : "测试连通性"}
          </button>
          <button type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving || testingConnection}>
            {saving ? "保存中..." : "确认"}
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "delete"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>删除 AI 模型</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">确认删除 AI 模型“{selectedRow?.name ?? "-"}”吗？此操作不可撤销。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog} disabled={deleting}>
            取消
          </button>
          <button type="button" className="material-button-primary !bg-red-500 hover:!bg-red-600" onClick={() => void handleDelete()} disabled={deleting}>
            删除
          </button>
        </DialogActions>
      </Dialog>

      {/* 百炼预设批量新增 */}
      <Dialog open={presetOpen} onClose={() => !presetSaving && setPresetOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>从百炼预设新增模型</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              以下目录与阿里云百炼 Token Plan「可使用模型」页面对应。勾选后将逐条<span className="font-semibold text-slate-800">新增</span>为独立模型配置，不会修改或覆盖任何现有配置；API Key 与 Base URL 应用到本次勾选的全部模型，保存后可逐条再编辑。
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">API Key（Token）</label>
                <input
                  className="material-input w-full"
                  type="password"
                  value={presetApiKey}
                  onChange={(event) => setPresetApiKey(event.target.value)}
                  placeholder="请输入百炼 Token Plan 的 API Key"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Base URL</label>
                <input
                  className="material-input w-full"
                  value={presetBaseUrl}
                  onChange={(event) => setPresetBaseUrl(event.target.value)}
                  placeholder={BAILIAN_BASE_URL}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">已选 {presetSelected.size} 个模型</div>
              <div className="flex gap-2">
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={selectAllPresetModels}>
                  全选未添加
                </button>
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setPresetSelected(new Set())}>
                  清空
                </button>
              </div>
            </div>
            <div className="material-scrollbar max-h-[360px] space-y-4 overflow-y-auto rounded-2xl border border-slate-200 p-4">
              {PRESET_BRANDS.map((brand) => (
                <div key={brand}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{brand}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {BAILIAN_PRESET_MODELS.filter((item) => item.brand === brand).map((item) => {
                      const exists = presetExisting.has(item.model.toLowerCase());
                      const checked = presetSelected.has(item.model);
                      return (
                        <label
                          key={item.model}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                            exists
                              ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                              : checked
                                ? "border-indigo-200 bg-indigo-50/60"
                                : "border-slate-200 hover:bg-slate-50",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            disabled={exists}
                            onChange={() => togglePresetModel(item.model)}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                              <span className="truncate">{item.model}</span>
                              {exists && <span className="material-chip shrink-0 bg-slate-100 text-slate-500">已存在</span>}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-400">{item.capability}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setPresetOpen(false)} disabled={presetSaving}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => void handlePresetCreate()} disabled={presetSaving}>
            {presetSaving ? "新增中..." : `新增所选（${presetSelected.size}）`}
          </button>
        </DialogActions>
      </Dialog>

      {/* 导出模型配置 */}
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>导出模型配置</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              勾选要导出的模型配置，导出为 JSON 文件。出于安全考虑，<span className="font-semibold text-slate-800">API Key 不会包含在导出文件中</span>，导入时可统一补填。
            </p>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">已选 {exportSelected.size} / {exportRows.length}</div>
              <div className="flex gap-2">
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setExportSelected(new Set(exportRows.map((row) => row.id)))}>
                  全选
                </button>
                <button type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setExportSelected(new Set())}>
                  清空
                </button>
              </div>
            </div>
            <div className="material-scrollbar max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
              {exportRows.map((row) => (
                <label
                  key={row.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                    exportSelected.has(row.id) ? "border-indigo-200 bg-indigo-50/60" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input type="checkbox" className="mt-1" checked={exportSelected.has(row.id)} onChange={() => toggleExportRow(row.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{row.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {row.provider} / {row.model}{row.base_url ? ` · ${row.base_url}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setExportOpen(false)}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={handleExport}>
            导出所选（{exportSelected.size}）
          </button>
        </DialogActions>
      </Dialog>

      {/* 导入模型配置 */}
      <Dialog open={importOpen} onClose={() => !importSaving && setImportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>导入模型配置</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              导入只会<span className="font-semibold text-slate-800">新增</span>模型配置，不会修改或覆盖任何现有配置。与现有模型标识相同的条目已标记为「重复」并默认不勾选。
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">统一 API Key（可选）</label>
              <input
                className="material-input w-full"
                type="password"
                value={importApiKey}
                onChange={(event) => setImportApiKey(event.target.value)}
                placeholder="留空则导入后逐条编辑补填"
              />
            </div>
            <div className="text-sm text-slate-500">已选 {importSelected.size} / {importEntries.length}</div>
            <div className="material-scrollbar max-h-[300px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
              {importEntries.map((entry, index) => (
                <label
                  key={`${entry.model}-${index}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                    importSelected.has(index) ? "border-indigo-200 bg-indigo-50/60" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input type="checkbox" className="mt-1" checked={importSelected.has(index)} onChange={() => toggleImportEntry(index)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <span className="truncate">{entry.name}</span>
                      {entry.duplicate && <span className="material-chip shrink-0 bg-amber-50 text-amber-700">重复</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {entry.provider} / {entry.model}{entry.base_url ? ` · ${entry.base_url}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setImportOpen(false)} disabled={importSaving}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => void handleImportCreate()} disabled={importSaving}>
            {importSaving ? "导入中..." : `导入所选（${importSelected.size}）`}
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
