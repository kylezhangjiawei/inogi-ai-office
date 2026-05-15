import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileText,
  RefreshCw,
  Save,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { cn } from "./components/ui/utils";
import {
  fetchRdAiSettings,
  saveRdAiSettings,
  type RdAiFileRule,
  type RdAiSceneConfig,
  type RdAiSettingsPayload,
} from "./lib/rdApi";

type ModelRef = NonNullable<NonNullable<RdAiSettingsPayload["runtime"]>["models"]>[number];

const PIPELINE_STEPS = [
  { id: "detect", label: "类型识别", icon: FileText },
  { id: "extract", label: "文本/表格/OCR", icon: ScanSearch },
  { id: "structure", label: "AI 结构化", icon: Bot },
  { id: "confirm", label: "人工确认", icon: ShieldCheck },
  { id: "audit", label: "留痕落库", icon: Database },
] as const;

function formatDate(value?: string) {
  if (!value) return "未保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function modelLabel(modelId: string, models: ModelRef[]) {
  if (!modelId) return "未指定";
  const model = models.find((item) => item.id === modelId);
  if (!model) return modelId;
  return `${model.name || model.model} / ${model.model}`;
}

function clampThreshold(value: number) {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

function EmptyModelNotice({ hasModel }: { hasModel: boolean }) {
  if (hasModel) return null;
  return (
    <div className="flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">当前没有可用模型</div>
        <div className="mt-1 text-xs leading-5 text-amber-700">请先在 AI 模型管理中新增并启用模型，再回到这里绑定研发场景。</div>
      </div>
    </div>
  );
}

function ModelSelect({
  value,
  models,
  onChange,
}: {
  value: string;
  models: ModelRef[];
  onChange: (value: string) => void;
}) {
  const selectedMissing = value && !models.some((item) => item.id === value);
  return (
    <select
      className="h-9 w-full rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">跟随默认模型</option>
      {selectedMissing ? <option value={value}>{value}</option> : null}
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name || model.model} / {model.model}
        </option>
      ))}
    </select>
  );
}

function SceneRow({
  scene,
  models,
  onChange,
}: {
  scene: RdAiSceneConfig;
  models: ModelRef[];
  onChange: (patch: Partial<RdAiSceneConfig>) => void;
}) {
  return (
    <div className="grid gap-3 rounded-[8px] border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] xl:grid-cols-[1.2fr_1fr_1fr_140px_120px_120px] xl:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Switch checked={scene.enabled} onCheckedChange={(checked) => onChange({ enabled: checked })} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{scene.name}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{scene.description}</div>
          </div>
        </div>
      </div>
      <ModelSelect value={scene.model_id} models={models} onChange={(model_id) => onChange({ model_id })} />
      <ModelSelect value={scene.fallback_model_id} models={models} onChange={(fallback_model_id) => onChange({ fallback_model_id })} />
      <input
        className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={scene.prompt_version}
        onChange={(event) => onChange({ prompt_version: event.target.value })}
      />
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={scene.confidence_threshold}
        onChange={(event) => onChange({ confidence_threshold: clampThreshold(Number(event.target.value)) })}
      />
      <div className="flex items-center justify-end gap-4 text-xs font-medium text-slate-600 xl:justify-start">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={scene.require_human_review}
            onChange={(event) => onChange({ require_human_review: event.target.checked })}
          />
          复核
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={scene.show_to_user}
            onChange={(event) => onChange({ show_to_user: event.target.checked })}
          />
          可见
        </label>
      </div>
    </div>
  );
}

function FileRuleRow({
  rule,
  onChange,
}: {
  rule: RdAiFileRule;
  onChange: (patch: Partial<RdAiFileRule>) => void;
}) {
  return (
    <div className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[1fr_1.1fr_1.1fr_110px_110px_110px] md:items-center">
      <div>
        <div className="text-sm font-semibold text-slate-900">{rule.label}</div>
        <div className="mt-1 text-xs text-slate-400">{rule.extensions.join(", ")}</div>
      </div>
      <input
        className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={rule.strategy}
        onChange={(event) => onChange({ strategy: event.target.value })}
      />
      <input
        className="h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={rule.extensions.join(", ")}
        onChange={(event) =>
          onChange({
            extensions: event.target.value
              .split(",")
              .map((item) => item.trim().replace(/^\./, "").toLowerCase())
              .filter(Boolean),
          })
        }
      />
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" checked={rule.ai_after_parse} onChange={(event) => onChange({ ai_after_parse: event.target.checked })} />
        AI
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" checked={rule.ocr_fallback} onChange={(event) => onChange({ ocr_fallback: event.target.checked })} />
        OCR
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" checked={rule.direct_ai} onChange={(event) => onChange({ direct_ai: event.target.checked })} />
        直传
      </label>
    </div>
  );
}

export function RDAiSettingsPage() {
  const [settings, setSettings] = useState<RdAiSettingsPayload | null>(null);
  const [savedSettings, setSavedSettings] = useState<RdAiSettingsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchRdAiSettings();
      setSettings(payload);
      setSavedSettings(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取研发 AI 策略失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const modelOptions = useMemo(
    () => settings?.runtime?.models?.filter((model) => model.enabled && model.model) ?? [],
    [settings?.runtime?.models],
  );

  const stats = useMemo(() => {
    const scenes = settings?.scenes ?? [];
    return {
      totalScenes: scenes.length,
      enabledScenes: scenes.filter((scene) => scene.enabled).length,
      reviewScenes: scenes.filter((scene) => scene.require_human_review).length,
      boundScenes: scenes.filter((scene) => scene.model_id).length,
    };
  }, [settings?.scenes]);

  const selectedFileScene = useMemo(() => {
    const scene = settings?.scenes.find((item) => item.id === "file_task_extract");
    if (!scene) return "未配置";
    return modelLabel(scene.model_id, modelOptions);
  }, [modelOptions, settings?.scenes]);

  function patchScene(sceneId: string, patch: Partial<RdAiSceneConfig>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            scenes: current.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
          }
        : current,
    );
  }

  function patchRule(ruleId: string, patch: Partial<RdAiFileRule>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            file_policy: {
              ...current.file_policy,
              rules: current.file_policy.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
            },
          }
        : current,
    );
  }

  function patchFilePolicy(patch: Partial<RdAiSettingsPayload["file_policy"]>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            file_policy: { ...current.file_policy, ...patch },
          }
        : current,
    );
  }

  function patchDisclosure(patch: Partial<RdAiSettingsPayload["disclosure"]>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            disclosure: { ...current.disclosure, ...patch },
          }
        : current,
    );
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await saveRdAiSettings(settings);
      setSettings(saved);
      setSavedSettings(saved);
      toast.success("研发 AI 策略已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存研发 AI 策略失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        正在加载研发 AI 策略...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
        暂无研发 AI 策略配置
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card overflow-hidden">
        <div className="border-b border-slate-100 bg-white px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="material-chip bg-blue-50 text-blue-700">R&D AI Policy</span>
              <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">研发 AI 策略</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>最后保存：{formatDate(settings.updated_at)}</span>
                <span>文件任务解析：{selectedFileScene}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="material-button-secondary"
                onClick={() => savedSettings && setSettings(savedSettings)}
                disabled={saving || !savedSettings}
              >
                <RefreshCw className="h-4 w-4" />
                恢复
              </button>
              <button type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "保存中..." : "保存策略"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-0 divide-y divide-slate-100 bg-slate-50/50 md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            { label: "启用场景", value: `${stats.enabledScenes}/${stats.totalScenes}`, tone: "text-blue-600" },
            { label: "已绑定模型", value: stats.boundScenes, tone: "text-slate-900" },
            { label: "人工复核", value: stats.reviewScenes, tone: "text-amber-600" },
            {
              label: "腾讯 OCR",
              value: settings.runtime?.ocr?.ready ? "就绪" : "未就绪",
              tone: settings.runtime?.ocr?.ready ? "text-emerald-600" : "text-rose-600",
            },
          ].map((item) => (
            <div key={item.label} className="px-6 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
              <div className={cn("mt-2 text-2xl font-semibold tabular-nums", item.tone)}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <EmptyModelNotice hasModel={modelOptions.length > 0} />

      <section className="material-card p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">文件处理链路</h3>
            <p className="mt-1 text-sm text-slate-500">文件先解析或 OCR，再进入 AI 结构化与人工确认。</p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-slate-400" />
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {PIPELINE_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="relative rounded-[8px] border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-400">0{index + 1}</div>
                    <div className="text-sm font-semibold text-slate-900">{step.label}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="material-card p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">AI 场景模型</h3>
            <p className="mt-1 text-sm text-slate-500">主模型、兜底模型、提示词版本、置信度阈值和复核策略集中维护。</p>
          </div>
          <div className="hidden grid-cols-[1fr_1fr_140px_120px_120px] gap-3 pr-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 xl:grid">
            <span>主模型</span>
            <span>兜底模型</span>
            <span>Prompt</span>
            <span>阈值</span>
            <span>复核/展示</span>
          </div>
        </div>
        <div className="space-y-3">
          {settings.scenes.map((scene) => (
            <SceneRow key={scene.id} scene={scene} models={modelOptions} onChange={(patch) => patchScene(scene.id, patch)} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="material-card p-6 lg:col-span-2">
          <h3 className="text-base font-semibold text-slate-900">OCR 与兜底</h3>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">OCR 服务</span>
              <input className="material-input mt-1.5 w-full" value={settings.file_policy.ocr_provider} onChange={(event) => patchFilePolicy({ ocr_provider: event.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">服务 Key</span>
              <input className="material-input mt-1.5 w-full" value={settings.file_policy.ocr_service_key} onChange={(event) => patchFilePolicy({ ocr_service_key: event.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">OCR 置信度阈值</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className="material-input mt-1.5 w-full"
                value={settings.file_policy.ocr_confidence_threshold}
                onChange={(event) => patchFilePolicy({ ocr_confidence_threshold: clampThreshold(Number(event.target.value)) })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">低置信度动作</span>
              <select
                className="material-input mt-1.5 w-full"
                value={settings.file_policy.low_confidence_action}
                onChange={(event) => patchFilePolicy({ low_confidence_action: event.target.value })}
              >
                <option value="manual_review">人工确认</option>
                <option value="reject">阻止落库</option>
                <option value="allow_with_warning">允许但标警告</option>
              </select>
            </label>
            <div className="space-y-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {[
                ["allow_vision_fallback", "允许视觉模型兜底"],
                ["save_original_text", "保存原始文本"],
                ["save_ocr_text", "保存 OCR 文本"],
                ["save_ai_result", "保存 AI 结构化结果"],
                ["require_confirmation_before_write", "写入前必须人工确认"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3">
                  <span>{label}</span>
                  <Switch
                    checked={Boolean(settings.file_policy[key as keyof RdAiSettingsPayload["file_policy"]])}
                    onCheckedChange={(checked) => patchFilePolicy({ [key]: checked } as Partial<RdAiSettingsPayload["file_policy"]>)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="material-card overflow-hidden lg:col-span-3">
          <div className="border-b border-slate-100 px-6 py-5">
            <h3 className="text-base font-semibold text-slate-900">文件类型策略</h3>
            <p className="mt-1 text-sm text-slate-500">按扩展名决定结构化解析、文本抽取、OCR 优先或兜底。</p>
          </div>
          <div>
            {settings.file_policy.rules.map((rule) => (
              <FileRuleRow key={rule.id} rule={rule} onChange={(patch) => patchRule(rule.id, patch)} />
            ))}
          </div>
        </div>
      </section>

      <section className="material-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <h3 className="text-base font-semibold text-slate-900">用户侧披露</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["show_provider", "服务商"],
            ["show_model", "模型"],
            ["show_prompt_version", "Prompt 版本"],
            ["show_confidence", "置信度"],
            ["show_fallback", "兜底状态"],
            ["show_source_document", "来源文件"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
              <span>{label}</span>
              <Switch
                checked={Boolean(settings.disclosure[key as keyof RdAiSettingsPayload["disclosure"]])}
                onCheckedChange={(checked) => patchDisclosure({ [key]: checked } as Partial<RdAiSettingsPayload["disclosure"]>)}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
