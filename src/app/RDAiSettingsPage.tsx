import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { Checkbox } from "./components/ui/checkbox";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Switch } from "./components/ui/switch";
import { cn } from "./components/ui/utils";
import { useAnyPermission } from "./hooks/usePermission";
import {
  fetchRdAiSettings,
  isProductionWorkspace,
  isUsCollabWorkspace,
  saveRdAiSettings,
  type RdApiError,
  type RdAiFileRule,
  type RdAiSceneConfig,
  type RdAiSettingsPayload,
} from "./lib/rdApi";
import { resolveExplicitUsage, resolveModelUsageKind } from "./lib/aiModelOptions";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { PERMISSIONS } from "./lib/permissions";

type ModelRef = NonNullable<NonNullable<RdAiSettingsPayload["runtime"]>["models"]>[number];

/** 模型用途在下拉里的聚合顺序：对话类在前，专用类（图片/向量/文档解析）在后。 */
const USAGE_GROUP_ORDER: Record<string, number> = {
  text: 0,
  multimodal: 1,
  image: 2,
  embedding: 3,
  document: 4,
};

const PIPELINE_STEPS = [
  { id: "detect", label: "类型识别", icon: FileText },
  { id: "extract", label: "文本/表格/OCR", icon: ScanSearch },
  { id: "structure", label: "AI 结构化", icon: Bot },
  { id: "confirm", label: "人工确认", icon: ShieldCheck },
  { id: "audit", label: "留痕落库", icon: Database },
] as const;

const FILE_RULE_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; accent: string; description: string }
> = {
  spreadsheet: {
    icon: Database,
    accent: "bg-[#eef3ff] text-[#002fa7] ring-blue-100",
    description: "结构化表格优先，适合 CSV 和 Excel 批量解析。",
  },
  document: {
    icon: FileText,
    accent: "bg-[#eef3ff] text-[#002fa7] ring-blue-100",
    description: "先抽取正文，再交给 AI 做字段归一化。",
  },
  archive: {
    icon: SlidersHorizontal,
    accent: "bg-[#eef3ff] text-[#002fa7] ring-blue-100",
    description: "先解压，再按内部文件类型继续分流。",
  },
  pdf: {
    icon: FileText,
    accent: "bg-[#eef3ff] text-[#002fa7] ring-blue-100",
    description: "优先读取文本层，低质量 PDF 再进入 OCR。",
  },
  image: {
    icon: ScanSearch,
    accent: "bg-[#eef3ff] text-[#002fa7] ring-blue-100",
    description: "图片和扫描件先走 OCR，再进入结构化处理。",
  },
};

const STRATEGY_LABELS: Record<string, string> = {
  structured_parse: "结构化解析",
  text_extract: "文本抽取",
  archive_extract_then_parse: "解压后解析",
  text_extract_then_ocr: "文本优先，OCR 兜底",
  ocr_first: "OCR 优先",
};

function formatDate(value?: string) {
  if (!value) return t("未保存");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(i18nLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function modelLabel(modelId: string, models: ModelRef[]) {
  if (!modelId) return t("未指定");
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
    <div className="rd-ai-empty-model flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">{t("当前没有可用模型")}</div>
        <div className="mt-1 text-pretty text-xs leading-5 text-amber-700">{t("请先在 AI 模型管理中新增并启用模型，再回到这里绑定研发场景。")}</div>
      </div>
    </div>
  );
}

function ModelSelect({
  value,
  models,
  isHorizon,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: string;
  models: ModelRef[];
  isHorizon: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selectedMissing = value && !models.some((item) => item.id === value);
  // 按用途类型聚合排序，并在每个选项后标注用途（文本/多模态/图片/向量/文档解析），
  // 用途判定复用共享逻辑（usage_kind 权威 + 名称兜底），便于在研发场景里区分模型用途，
  // 避免把 embedding / 图片模型误选成对话模型。NativeSelect 是 Radix 封装、不支持 optgroup，
  // 故以「排序聚合 + 行内标签」实现可区分的分组观感。
  const sorted = useMemo(
    () =>
      models
        .map((model) => ({ model, usage: resolveExplicitUsage(resolveModelUsageKind(model)) }))
        .sort((a, b) => (USAGE_GROUP_ORDER[a.usage.kind] ?? 9) - (USAGE_GROUP_ORDER[b.usage.kind] ?? 9)),
    [models],
  );
  return (
    <NativeSelect
      className={cn(
        "h-9 w-full rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50",
        isHorizon && "rd-ai-select-trigger",
      )}
      contentClassName={isHorizon ? "rd-horizon-ai-select-content" : undefined}
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("跟随默认模型")}</option>
      {selectedMissing ? <option value={value}>{value}</option> : null}
      {sorted.map(({ model, usage }) => (
        <option key={model.id} value={model.id}>
          {model.name || model.model} / {model.model} · {t(usage.label)}
        </option>
      ))}
    </NativeSelect>
  );
}

function SceneRow({
  scene,
  models,
  isHorizon,
  disabled,
  onChange,
}: {
  scene: RdAiSceneConfig;
  models: ModelRef[];
  isHorizon: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<RdAiSceneConfig>) => void;
}) {
  return (
    <div className="rd-ai-scene-row grid gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm xl:grid-cols-[1.2fr_1fr_1fr_140px_120px_120px] xl:items-center" data-enabled={scene.enabled}>
      <div className="rd-ai-scene-identity min-w-0">
        <div className="flex items-center gap-2">
          <Switch disabled={disabled} aria-label={t("启用场景：{name}", { name: t(scene.name) })} checked={scene.enabled} onCheckedChange={(checked) => onChange({ enabled: checked })} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{t(scene.name)}</div>
            <div className="mt-1 line-clamp-2 text-pretty text-xs leading-5 text-slate-500">{t(scene.description)}</div>
          </div>
        </div>
      </div>
      <div className="rd-ai-scene-primary-model">
        <ModelSelect value={scene.model_id} models={models} isHorizon={isHorizon} ariaLabel={t("{name}主模型", { name: t(scene.name) })} disabled={disabled} onChange={(model_id) => onChange({ model_id })} />
      </div>
      <div className="rd-ai-scene-fallback-model">
        <ModelSelect value={scene.fallback_model_id} models={models} isHorizon={isHorizon} ariaLabel={t("{name}兜底模型", { name: t(scene.name) })} disabled={disabled} onChange={(fallback_model_id) => onChange({ fallback_model_id })} />
      </div>
      <Input
        aria-label={t("{name} Prompt 版本", { name: t(scene.name) })}
        className="rd-ai-scene-prompt h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={scene.prompt_version}
        disabled={disabled}
        onChange={(event) => onChange({ prompt_version: event.target.value })}
      />
      <Input
        type="number"
        min={0}
        max={1}
        step={0.01}
        aria-label={t("{name}置信度阈值", { name: t(scene.name) })}
        className="rd-ai-scene-threshold h-9 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        value={scene.confidence_threshold}
        disabled={disabled}
        onChange={(event) => onChange({ confidence_threshold: clampThreshold(Number(event.target.value)) })}
      />
      <div className="rd-ai-scene-flags flex items-center justify-end gap-4 text-xs font-medium text-slate-600 xl:justify-start">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={scene.require_human_review}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ require_human_review: Boolean(checked) })}
          />
          {t("复核")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={scene.show_to_user}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ show_to_user: Boolean(checked) })}
          />
          {t("可见")}
        </label>
      </div>
    </div>
  );
}

function FileCapabilityToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "rd-ai-capability-toggle flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-xs font-semibold transition-colors",
        checked
          ? "border-[#002fa7]/25 bg-[#eef3ff] text-[#002fa7]"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-70",
      )}
      data-active={checked}
    >
      <span className="min-w-0">{label}</span>
      <Checkbox
        className="size-4 shrink-0 cursor-pointer rounded border-slate-300"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(nextChecked) => onChange(Boolean(nextChecked))}
      />
    </label>
  );
}

function FileRuleRow({
  rule,
  disabled,
  onChange,
}: {
  rule: RdAiFileRule;
  disabled?: boolean;
  onChange: (patch: Partial<RdAiFileRule>) => void;
}) {
  useI18n(); // 订阅语言切换（行内文案经 t()）
  const meta = FILE_RULE_META[rule.id] ?? {
    icon: FileText,
    accent: "bg-slate-100 text-slate-600 ring-slate-200",
    description: "按当前策略处理此类文件。",
  };
  const Icon = meta.icon;
  const strategyInputId = `file-rule-${rule.id}-strategy`;
  const extensionsInputId = `file-rule-${rule.id}-extensions`;

  return (
    <div className="rd-ai-file-rule border-b border-slate-100 px-5 py-5 last:border-b-0" data-rule={rule.id}>
      <div className="rd-ai-file-rule-grid grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)_240px] xl:items-start">
        <div className="rd-ai-file-rule-identity min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("rd-ai-file-rule-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ring-1", meta.accent)}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-5 text-slate-950">{t(rule.label)}</div>
              <div className="mt-1 text-pretty text-xs leading-5 text-slate-500">{t(meta.description)}</div>
            </div>
          </div>
          <div className="rd-ai-file-extensions mt-3 flex flex-wrap gap-1.5">
            {rule.extensions.map((extension) => (
              <span
                key={extension}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600"
              >
                .{extension}
              </span>
            ))}
          </div>
        </div>

        <div className="rd-ai-file-rule-fields grid min-w-0 gap-3 lg:grid-cols-2">
          <label htmlFor={strategyInputId} className="block min-w-0">
            <span className="text-xs font-semibold text-slate-500">{t("处理策略")}</span>
            <Input
              id={strategyInputId}
              className="mt-1.5 h-10 w-full rounded-[8px] border border-slate-200 bg-white px-3 font-mono text-sm text-slate-800 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              value={rule.strategy}
              disabled={disabled}
              onChange={(event) => onChange({ strategy: event.target.value })}
            />
            <span className="mt-1 block text-xs text-slate-400">{t(STRATEGY_LABELS[rule.strategy] ?? "自定义策略")}</span>
          </label>
          <label htmlFor={extensionsInputId} className="block min-w-0">
            <span className="text-xs font-semibold text-slate-500">{t("扩展名")}</span>
            <Input
              id={extensionsInputId}
              className="mt-1.5 h-10 w-full rounded-[8px] border border-slate-200 bg-white px-3 font-mono text-sm text-slate-800 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              value={rule.extensions.join(", ")}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  extensions: event.target.value
                    .split(",")
                    .map((item) => item.trim().replace(/^\./, "").toLowerCase())
                    .filter(Boolean),
                })
              }
            />
            <span className="mt-1 block text-xs text-slate-400">{t("用逗号分隔，不需要写点号。")}</span>
          </label>
        </div>

        <div className="rd-ai-file-rule-capabilities grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
          <FileCapabilityToggle label={t("AI 结构化")} checked={rule.ai_after_parse} disabled={disabled} onChange={(checked) => onChange({ ai_after_parse: checked })} />
          <FileCapabilityToggle label={t("OCR 兜底")} checked={rule.ocr_fallback} disabled={disabled} onChange={(checked) => onChange({ ocr_fallback: checked })} />
          <FileCapabilityToggle label={t("直传 AI")} checked={rule.direct_ai} disabled={disabled} onChange={(checked) => onChange({ direct_ai: checked })} />
        </div>
      </div>
    </div>
  );
}

export function RDAiSettingsPage() {
  useI18n(); // 订阅语言切换：本页文案全部经 t()
  const usCollabWorkspace = isUsCollabWorkspace();
  const productionWorkspace = isProductionWorkspace();
  const isHorizon = !productionWorkspace;
  const canEdit = useAnyPermission(PERMISSIONS.RD_AI_CONFIGURE, PERMISSIONS.PAGE_AI_MODEL_MANAGEMENT);
  const [settings, setSettings] = useState<RdAiSettingsPayload | null>(null);
  const [savedSettings, setSavedSettings] = useState<RdAiSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const loadRequestRef = useRef(0);
  const savingRef = useRef(false);
  const settingsRef = useRef<RdAiSettingsPayload | null>(null);
  const baseUpdatedAtRef = useRef("");

  const loadSettings = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchRdAiSettings();
      if (requestId !== loadRequestRef.current) return;
      settingsRef.current = payload;
      baseUpdatedAtRef.current = payload.updated_at ?? "";
      setSettings(payload);
      setSavedSettings(payload);
      setSaveError(null);
      setSaveConflict(false);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = error instanceof Error ? error.message : t("读取研发 AI 策略失败");
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  /** 冲突后只刷新服务器基线；当前页面草稿继续保留，用户可再次保存或撤销到最新服务器版。 */
  const reloadSettingsKeepingDraft = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchRdAiSettings();
      if (requestId !== loadRequestRef.current) return;
      const currentDraft = settingsRef.current;
      if (currentDraft) {
        const preservedDraft: RdAiSettingsPayload = {
          ...currentDraft,
          updated_at: payload.updated_at,
          updated_by: payload.updated_by,
          runtime: payload.runtime,
        };
        settingsRef.current = preservedDraft;
        setSettings(preservedDraft);
      } else {
        settingsRef.current = payload;
        setSettings(payload);
      }
      baseUpdatedAtRef.current = payload.updated_at ?? "";
      setSavedSettings(payload);
      setSaveConflict(false);
      setSaveError(null);
      toast.success(t("已重新读取服务器版本，当前页面草稿仍保留；请确认后再次保存"));
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = error instanceof Error ? error.message : t("重新读取研发 AI 策略失败");
      setSaveError(t("{message} 当前页面草稿仍保留，请稍后重试。", { message }));
      toast.error(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadSettings]);

  const modelOptions = useMemo(
    () =>
      (settings?.runtime?.models ?? []).filter((m) => {
        if (!m.enabled || !m.model) return false;
        // 图片生成模型不适用于研发 AI 场景
        if (m.usage_kind === 'image') return false;
        if (m.usage_kind && m.usage_kind !== 'auto') return true;
        const n = m.model.toLowerCase();
        return !(n.includes('gpt-image') || n.includes('image-to-image') || n === 'dall-e-2' || n.startsWith('dall-e-'));
      }),
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

  const fileRuleStats = useMemo(() => {
    const rules = settings?.file_policy.rules ?? [];
    return {
      total: rules.length,
      ai: rules.filter((rule) => rule.ai_after_parse).length,
      ocr: rules.filter((rule) => rule.ocr_fallback).length,
      directAi: rules.filter((rule) => rule.direct_ai).length,
    };
  }, [settings?.file_policy.rules]);

  const selectedFileScene = useMemo(() => {
    const scene = settings?.scenes.find((item) => item.id === "file_task_extract");
    if (!scene) return t("未配置");
    return modelLabel(scene.model_id, modelOptions);
  }, [modelOptions, settings?.scenes]);

  function patchScene(sceneId: string, patch: Partial<RdAiSceneConfig>) {
    if (!canEdit) return;
    setSettings((current) => {
      const next = current
        ? {
            ...current,
            scenes: current.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
          }
        : current;
      settingsRef.current = next;
      return next;
    });
  }

  function patchRule(ruleId: string, patch: Partial<RdAiFileRule>) {
    if (!canEdit) return;
    setSettings((current) => {
      const next = current
        ? {
            ...current,
            file_policy: {
              ...current.file_policy,
              rules: current.file_policy.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
            },
          }
        : current;
      settingsRef.current = next;
      return next;
    });
  }

  function patchFilePolicy(patch: Partial<RdAiSettingsPayload["file_policy"]>) {
    if (!canEdit) return;
    setSettings((current) => {
      const next = current
        ? {
            ...current,
            file_policy: { ...current.file_policy, ...patch },
          }
        : current;
      settingsRef.current = next;
      return next;
    });
  }

  function patchDisclosure(patch: Partial<RdAiSettingsPayload["disclosure"]>) {
    if (!canEdit) return;
    setSettings((current) => {
      const next = current
        ? {
            ...current,
            disclosure: { ...current.disclosure, ...patch },
          }
        : current;
      settingsRef.current = next;
      return next;
    });
  }

  async function handleSave() {
    if (!settings || !canEdit || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveConflict(false);
    const submittedSettings = settings;
    const submittedBaseUpdatedAt = baseUpdatedAtRef.current;
    try {
      const saved = await saveRdAiSettings(submittedSettings, submittedBaseUpdatedAt);
      baseUpdatedAtRef.current = saved.updated_at ?? submittedBaseUpdatedAt;
      const hasNewerEdits = settingsRef.current !== submittedSettings;
      if (!hasNewerEdits) {
        settingsRef.current = saved;
        setSettings(saved);
      } else {
        setSettings((current) => {
          if (!current) return current;
          const next = {
            ...current,
            updated_at: saved.updated_at,
            updated_by: saved.updated_by,
            runtime: saved.runtime,
          };
          settingsRef.current = next;
          return next;
        });
      }
      setSavedSettings(saved);
      toast.success(hasNewerEdits ? t("提交版本已保存，保存期间的新改动仍待保存") : t("研发 AI 策略已保存"));
    } catch (error) {
      const conflict = (error as RdApiError).status === 409;
      setSaveConflict(conflict);
      const baseMessage = error instanceof Error ? error.message : t("保存研发 AI 策略失败");
      const message = conflict
        ? t("{message} 当前页面草稿仍保留，请重新读取服务器版本后再决定保存或撤销。", { message: baseMessage })
        : baseMessage;
      setSaveError(message);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const dirty = settings !== savedSettings;

  if (loading && !settings) {
    return (
      <main
        className={cn(
          "mx-auto w-full max-w-7xl",
          isHorizon && "horizon-theme hz-page",
          isHorizon && "rd-horizon-module rd-horizon-ai-settings rd-horizon-ai-state",
        )}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <section className="hz-surface min-h-[22rem] overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <div className="h-4 w-32 rounded bg-slate-100" aria-hidden="true" />
            <div className="mt-3 h-8 w-64 max-w-full rounded bg-slate-100" aria-hidden="true" />
            <div className="mt-3 h-4 w-full max-w-2xl rounded bg-slate-100" aria-hidden="true" />
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-lg border border-slate-200 bg-slate-50" />)}
          </div>
          <p className="px-5 pb-5 text-pretty text-sm text-slate-500">{t("正在加载研发 AI 策略...")}</p>
        </section>
      </main>
    );
  }

  if (!settings) {
    return (
      <main
        className={cn(
          "mx-auto w-full max-w-7xl",
          isHorizon && "horizon-theme hz-page",
          isHorizon && "rd-horizon-module rd-horizon-ai-settings rd-horizon-ai-state",
        )}
      >
        <section className="hz-surface flex min-h-[22rem] flex-col items-center justify-center px-6 py-10 text-center" role={loadError ? "alert" : "status"}>
          <span className={cn("flex size-10 items-center justify-center rounded-lg", loadError ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500")} aria-hidden="true">
            {loadError ? <AlertTriangle className="size-5" /> : <Bot className="size-5" />}
          </span>
          <h2 className="mt-4 text-balance text-lg font-semibold text-slate-900">{loadError ? t("研发 AI 策略读取失败") : t("暂无研发 AI 策略配置")}</h2>
          <p className="mt-2 max-w-lg text-pretty text-sm text-slate-600">{loadError ?? t("当前工作区尚未提供策略配置，请稍后重新读取。")}</p>
          <Button type="button" className="mt-5 bg-[#002fa7] text-white hover:bg-[#002581]" onClick={() => void loadSettings()}>
            <RefreshCw className="size-4" aria-hidden="true" />{t("重新读取")}
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "mx-auto w-full max-w-7xl space-y-5",
        isHorizon && "horizon-theme hz-page",
        isHorizon && "rd-horizon-module rd-horizon-ai-settings",
      )}
      data-visual-variant={isHorizon ? "rd-horizon" : "default"}
      aria-busy={saving || loading}
    >
      <section className="rd-ai-command material-card overflow-hidden">
        <div className="rd-ai-command-body border-b border-slate-100 bg-white px-6 py-6">
          <div className="rd-ai-command-layout flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="rd-ai-command-copy">
              <span className="rd-ai-command-chip material-chip bg-blue-50 text-blue-700">{usCollabWorkspace ? "Collab AI Policy" : "R&D AI Policy"}</span>
              <h2 className="mt-3 text-balance text-2xl font-bold text-slate-900 sm:text-[2rem]">{t(usCollabWorkspace ? "协同 AI 策略" : "研发 AI 策略")}</h2>
              <p className="mt-2 max-w-3xl text-pretty text-sm leading-6 text-slate-600">{t("集中维护模型绑定、文件解析、OCR 兜底与用户侧披露规则；保存后仅作用于当前工作区。")}</p>
              <div className="rd-ai-command-meta mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{t("最后保存：")}{formatDate(settings.updated_at)}</span>
                <span>{t("文件任务解析：")}{selectedFileScene}</span>
                <span>{dirty ? t("有未保存改动") : t("已与服务器同步")}</span>
              </div>
            </div>
            <div className="rd-ai-command-actions flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="rd-ai-restore"
                onClick={() => {
                  if (savedSettings) {
                    settingsRef.current = savedSettings;
                    setSettings(savedSettings);
                  }
                  setSaveError(null);
                }}
                disabled={!canEdit || saving || saveConflict || !savedSettings || !dirty}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("撤销改动")}
              </Button>
              <Button type="button" className="rd-ai-save bg-[#002fa7] text-white hover:bg-[#002581]" onClick={() => void handleSave()} disabled={!canEdit || saving || saveConflict || !dirty} aria-describedby={saveError ? "rd-ai-save-error" : undefined}>
                {saving ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {saving ? t("保存中...") : t("保存策略")}
              </Button>
            </div>
          </div>
          {saveError ? (
            <div id="rd-ai-save-error" role="alert" className="mt-4 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-pretty text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span>{saveError}</span>
              {saveConflict ? (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-red-200 bg-white text-red-700 hover:bg-red-100"
                  onClick={() => void reloadSettingsKeepingDraft()}
                  disabled={loading || saving}
                >
                  <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
                  {loading ? t("重新读取中...") : t("重新读取并保留草稿")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rd-ai-kpis grid gap-0 divide-y divide-slate-100 bg-slate-50/50 md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            { label: t("启用场景"), value: `${stats.enabledScenes}/${stats.totalScenes}`, tone: "text-blue-600", semantic: "brand" },
            { label: t("已绑定模型"), value: stats.boundScenes, tone: "text-slate-900", semantic: "neutral" },
            { label: t("人工复核"), value: stats.reviewScenes, tone: "text-amber-600", semantic: "review" },
            {
              label: t("腾讯 OCR"),
              value: settings.runtime?.ocr?.ready ? t("就绪") : t("未就绪"),
              tone: settings.runtime?.ocr?.ready ? "text-emerald-600" : "text-rose-600",
              semantic: settings.runtime?.ocr?.ready ? "ready" : "error",
            },
          ].map((item) => (
            <div key={item.label} className="rd-ai-kpi px-6 py-4" data-tone={item.semantic}>
              <div className="text-xs font-semibold text-slate-500">{item.label}</div>
              <div className={cn("mt-2 text-2xl font-semibold tabular-nums", item.tone)}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <EmptyModelNotice hasModel={modelOptions.length > 0} />

      {!canEdit ? (
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" role="status">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t("当前为只读模式")}</p>
            <p className="mt-1 text-pretty text-xs leading-5 text-slate-600">{t("你可以查看研发 AI 策略，但需要“研发 AI 配置”或“AI 模型管理”权限才能修改并保存。")}</p>
          </div>
        </div>
      ) : null}

      <section className="rd-ai-pipeline material-card p-6">
        <div className="rd-ai-section-header mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-balance text-base font-semibold text-slate-900">{t("文件处理链路")}</h2>
            <p className="mt-1 text-pretty text-sm text-slate-600">{t("文件先解析或 OCR，再进入 AI 结构化与人工确认。")}</p>
          </div>
          <SlidersHorizontal className="h-5 w-5 text-slate-400" />
        </div>
        <div className="rd-ai-pipeline-steps grid gap-3 md:grid-cols-5">
          {PIPELINE_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="rd-ai-pipeline-step relative rounded-[8px] border border-slate-200 bg-white px-4 py-4" data-step={step.id}>
                <div className="flex items-center gap-3">
                  <span className="rd-ai-pipeline-icon flex h-9 w-9 items-center justify-center rounded-[8px] bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-400">0{index + 1}</div>
                    <div className="text-sm font-semibold text-slate-900">{t(step.label)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rd-ai-scenes material-card p-6">
        <div className="rd-ai-scenes-header mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-balance text-base font-semibold text-slate-900">{t("AI 场景模型")}</h2>
            <p className="mt-1 text-pretty text-sm text-slate-600">{t("主模型、兜底模型、提示词版本、置信度阈值和复核策略集中维护。")}</p>
          </div>
          <div className="rd-ai-scenes-columns hidden grid-cols-[1fr_1fr_140px_120px_120px] gap-3 pr-4 text-xs font-semibold text-slate-500 xl:grid">
            <span>{t("主模型")}</span>
            <span>{t("兜底模型")}</span>
            <span>Prompt</span>
            <span>{t("阈值")}</span>
            <span>{t("复核/展示")}</span>
          </div>
        </div>
        <div className="rd-ai-scene-list space-y-3">
          {settings.scenes.map((scene) => (
            <SceneRow key={scene.id} scene={scene} models={modelOptions} isHorizon={isHorizon} disabled={!canEdit || saving} onChange={(patch) => patchScene(scene.id, patch)} />
          ))}
        </div>
      </section>

      <section className="rd-ai-policy-grid grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rd-ai-ocr-panel material-card p-6">
          <h2 className="text-balance text-base font-semibold text-slate-900">{t("OCR 与兜底")}</h2>
          <div className="rd-ai-ocr-content mt-5 space-y-4">
            <div className="rd-ai-ocr-runtime rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-600">{t("OCR 凭据")}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{t("由后端 .env 托管")}</div>
                  <p className="mt-1 text-pretty text-xs leading-5 text-slate-600">
                    {t("SecretId / SecretKey 不在系统页面展示或编辑，仅显示运行状态。")}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                    settings.runtime?.ocr?.ready
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                      : "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
                  )}
                >
                  {settings.runtime?.ocr?.ready ? t("已配置") : t("未就绪")}
                </span>
              </div>
              <div className="rd-ai-ocr-runtime-meta mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                  {t("服务：")}{settings.runtime?.ocr?.provider ?? "tencent_ocr"}
                </div>
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                  {t("服务 Key：系统默认策略")}
                </div>
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">{t("OCR 置信度阈值")}</span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                className="material-input mt-1.5 w-full"
                value={settings.file_policy.ocr_confidence_threshold}
                disabled={!canEdit || saving}
                onChange={(event) => patchFilePolicy({ ocr_confidence_threshold: clampThreshold(Number(event.target.value)) })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">{t("低置信度动作")}</span>
              <NativeSelect
                className={cn("material-input mt-1.5 w-full", isHorizon && "rd-ai-select-trigger")}
                contentClassName={isHorizon ? "rd-horizon-ai-select-content" : undefined}
                value={settings.file_policy.low_confidence_action}
                disabled={!canEdit || saving}
                onChange={(event) => patchFilePolicy({ low_confidence_action: event.target.value })}
              >
                <option value="manual_review">{t("人工确认")}</option>
                <option value="reject">{t("阻止落库")}</option>
                <option value="allow_with_warning">{t("允许但标警告")}</option>
              </NativeSelect>
            </label>
            <div className="rd-ai-ocr-switches space-y-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {[
                ["allow_vision_fallback", "允许视觉模型兜底"],
                ["save_original_text", "保存原始文本"],
                ["save_ocr_text", "保存 OCR 文本"],
                ["save_ai_result", "保存 AI 结构化结果"],
                ["require_confirmation_before_write", "写入前必须人工确认"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3">
                  <span>{t(label)}</span>
                  <Switch
                    checked={Boolean(settings.file_policy[key as keyof RdAiSettingsPayload["file_policy"]])}
                    disabled={!canEdit || saving}
                    onCheckedChange={(checked) => patchFilePolicy({ [key]: checked } as Partial<RdAiSettingsPayload["file_policy"]>)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rd-ai-file-policy material-card min-w-0 overflow-hidden">
          <div className="rd-ai-file-policy-header border-b border-slate-100 px-6 py-5">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
              <div className="min-w-0">
                <h2 className="text-balance text-base font-semibold text-slate-900">{t("文件类型策略")}</h2>
                <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-slate-600">{t("按扩展名决定结构化解析、文本抽取、OCR 优先或兜底。每一行保留真实策略值，同时把扩展名和能力开关拆开显示，避免中等宽度下挤压变形。")}</p>
              </div>
              <div className="rd-ai-file-stats grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [t("规则"), fileRuleStats.total],
                  ["AI", fileRuleStats.ai],
                  ["OCR", fileRuleStats.ocr],
                  [t("直传"), fileRuleStats.directAi],
                ].map(([label, value]) => (
                  <div key={label} className="rd-ai-file-stat rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                    <div className="text-xs font-semibold text-slate-500">{label}</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rd-ai-file-rules">
            {settings.file_policy.rules.map((rule) => (
              <FileRuleRow key={rule.id} rule={rule} disabled={!canEdit || saving} onChange={(patch) => patchRule(rule.id, patch)} />
            ))}
          </div>
        </div>
      </section>

      <section className="rd-ai-disclosure material-card p-6">
        <div className="rd-ai-disclosure-header mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <h2 className="text-balance text-base font-semibold text-slate-900">{t("用户侧披露")}</h2>
        </div>
        <div className="rd-ai-disclosure-grid grid gap-3 md:grid-cols-3">
          {[
            ["show_provider", "服务商"],
            ["show_model", "模型"],
            ["show_prompt_version", "Prompt 版本"],
            ["show_confidence", "置信度"],
            ["show_fallback", "兜底状态"],
            ["show_source_document", "来源文件"],
          ].map(([key, label]) => (
            <label key={key} className="rd-ai-disclosure-item flex items-center justify-between rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
              <span>{t(label)}</span>
              <Switch
                checked={Boolean(settings.disclosure[key as keyof RdAiSettingsPayload["disclosure"]])}
                disabled={!canEdit || saving}
                onCheckedChange={(checked) => patchDisclosure({ [key]: checked } as Partial<RdAiSettingsPayload["disclosure"]>)}
              />
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}
