import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Gauge,
  History,
  ImageIcon,
  Layers3,
  ListChecks,
  Loader2,
  Palette,
  Pin,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Type,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { contentSlotsApi, uploadSlotImage, type ContentSlot, type SlotMode } from "./lib/contentSlotsApi";

const HEALTHY_AUTOMATION_STATUSES = new Set<ContentSlot["automation"]["status"]>([
  "ready",
  "on_demand",
  "live",
]);

function modeLabel(slot: ContentSlot, mode: SlotMode): string {
  if (slot.key === "matechat_quick_suggestions" && mode === "off") return "系统自动";
  if (mode === "ai_daily") return "自动每日更新";
  if (mode === "static") return "人工固定";
  return "停用";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function hasCurrentContent(slot: ContentSlot) {
  return Boolean(
    slot.current?.image_url
      || slot.current?.text
      || (slot.current?.list && slot.current.list.length > 0),
  );
}

function isAutomaticSlot(slot: ContentSlot) {
  return slot.mode === "ai_daily" || (slot.key === "matechat_quick_suggestions" && slot.mode === "off");
}

function SlotCard({ slot, onChanged }: { slot: ContentSlot; onChanged: () => void }) {
  const [mode, setMode] = useState<SlotMode>(slot.mode);
  const [prompt, setPrompt] = useState(slot.prompt_template);
  const [staticText, setStaticText] = useState(slot.static_text);
  const [staticList, setStaticList] = useState<string[]>(slot.static_list ?? []);
  const [pool, setPool] = useState<Array<{ object_key: string; url: string | null }>>(slot.static_image_pool ?? []);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(slot.current?.image_url ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ date: string; url: string | null; source: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idBase = useId();
  const promptId = idBase + "-prompt";
  const promptHelpId = idBase + "-prompt-help";
  const staticTextId = idBase + "-static-text";
  const fileInputId = idBase + "-file";
  const uploadErrorId = idBase + "-upload-error";
  const historyPanelId = idBase + "-history";

  // 保存、重生成或手动刷新后，父级会返回新的 slot；同步本地预览，避免仍显示旧日期/旧图片。
  useEffect(() => {
    setMode(slot.mode);
    setPrompt(slot.prompt_template);
    setStaticText(slot.static_text);
    setStaticList(slot.static_list ?? []);
    setPool(slot.static_image_pool ?? []);
    setPreviewImg(slot.current?.image_url ?? null);
    setPreviewText(null);
    setOperationError(null);
    setUploadError(null);
  }, [slot]);

  const dirty =
    mode !== slot.mode
    || prompt !== slot.prompt_template
    || staticText !== slot.static_text
    || JSON.stringify(staticList) !== JSON.stringify(slot.static_list ?? []);

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    setOperationError(null);
    if (next && history.length === 0) {
      setHistoryLoading(true);
      try {
        const response = await contentSlotsApi.history(slot.key);
        setHistory(response.items);
      } catch (error) {
        const message = errorMessage(error, "读取历史失败");
        setOperationError(message);
        toast.error(message);
      } finally {
        setHistoryLoading(false);
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    setOperationError(null);
    try {
      await contentSlotsApi.updateConfig(slot.key, { mode, promptTemplate: prompt, staticText, staticList });
      toast.success("已保存");
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "保存失败");
      setOperationError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    setUploadError(null);
    setOperationError(null);
    if (!file.type.startsWith("image/")) {
      const message = "请选择图片格式的文件。";
      setUploadError(message);
      toast.error(message);
      return;
    }
    if (pool.length >= 12) {
      const message = "图片池最多保存 12 张图片。";
      setUploadError(message);
      toast.error(message);
      return;
    }
    setBusy(true);
    try {
      const objectKey = await uploadSlotImage(file);
      const nextKeys = [...pool.map((item) => item.object_key), objectKey];
      await contentSlotsApi.updateConfig(slot.key, { mode: "static", staticImagePool: nextKeys });
      setMode("static");
      toast.success("已添加图片");
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "上传失败");
      setUploadError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function removePoolImage(objectKey: string) {
    setBusy(true);
    setOperationError(null);
    try {
      const nextKeys = pool.map((item) => item.object_key).filter((key) => key !== objectKey);
      await contentSlotsApi.updateConfig(slot.key, { staticImagePool: nextKeys });
      setPool((current) => current.filter((item) => item.object_key !== objectKey));
      toast.success("已移除");
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "移除失败");
      setOperationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    setPreviewText(null);
    setOperationError(null);
    try {
      if (dirty) await contentSlotsApi.updateConfig(slot.key, { mode, promptTemplate: prompt, staticText });
      const response = await contentSlotsApi.regenerate(slot.key);
      if (response.image_url !== undefined) {
        setPreviewImg(response.image_url ?? null);
        toast.success(response.image_url ? "已重新生成" : "已触发，稍后刷新查看");
      }
      if (response.sample_text) {
        setPreviewText(response.sample_text);
        toast.success("已生成示例文案");
      }
      onChanged();
    } catch (error) {
      const message = errorMessage(error, "生成失败");
      setOperationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const isImage = slot.type === "image";
  const isList = slot.type === "list";
  const SlotIcon = isImage ? ImageIcon : isList ? ListChecks : Type;
  const slotTypeLabel = isImage ? "图片" : isList ? "建议列表" : "文案";
  const automation = mode === slot.mode ? slot.automation : null;
  const automationPending = mode !== slot.mode;
  const automationHealthy = automation ? HEALTHY_AUTOMATION_STATUSES.has(automation.status) : false;
  const automationCatchingUp = automation?.status === "catching_up";

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#002fa7]" aria-hidden="true">
            <SlotIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{slot.name}</h3>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">{slotTypeLabel}</span>
              {dirty ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">有未保存更改</span> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">{slot.location}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          当前：{modeLabel(slot, mode)}
        </span>
      </header>

      <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0" aria-label={slot.name + "当前预览"}>
          <div className="mb-2 text-sm font-semibold text-slate-700">当前预览</div>
          {isImage ? (
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
              {mode === "off" ? (
                <span className="text-xs text-slate-300">已停用</span>
              ) : previewImg ? (
                <img src={previewImg} alt={slot.name + "当前图片"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-300">
                  <ImageIcon className="size-8" aria-hidden="true" />
                  <span className="text-xs">{mode === "static" ? "未上传固定图" : "尚无图片"}</span>
                </div>
              )}
            </div>
          ) : isList ? (
            <div className="min-h-36 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-medium text-slate-500">{mode === "off" ? "系统通用兜底" : "当前建议列表"}</div>
              {(slot.current?.list?.length ?? 0) > 0 ? (
                <ul className="space-y-1.5">
                  {(slot.current?.list ?? []).slice(0, 5).map((item, index) => (
                    <li key={item + "-" + index} className="truncate rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-xs text-slate-600" title={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : <div className="flex min-h-24 items-center justify-center text-xs text-slate-400">暂无预览条目</div>}
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
              {mode === "static" ? (
                <span className="text-sm font-medium leading-6 text-slate-700">“{staticText || "（未填写固定文案）"}”</span>
              ) : previewText ? (
                <span className="text-sm font-medium leading-6 text-slate-700">“{previewText}”</span>
              ) : (
                <span className="flex flex-col items-center gap-2 text-xs text-slate-400">
                  <Type className="size-7" aria-hidden="true" />点击“预览今日文案”查看效果
                </span>
              )}
            </div>
          )}
          {slot.current?.date && mode === "ai_daily" ? (
            <div className="mt-2 text-center text-xs text-slate-500">
              当前日期：<time dateTime={slot.current.date} className="tabular-nums">{slot.current.date}</time>
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-700">更新方式</div>
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={slot.name + "更新方式"}>
              {slot.modes.map((candidate) => (
                <Button
                  key={candidate}
                  type="button"
                  variant="outline"
                  aria-pressed={mode === candidate}
                  onClick={() => {
                    setMode(candidate);
                    setOperationError(null);
                  }}
                  className={cn(
                    "h-10 min-w-0 rounded-xl px-3",
                    mode === candidate
                      ? "border-[#002fa7] bg-[#002fa7] text-white hover:bg-[#002581] hover:text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7]",
                  )}
                >
                  {modeLabel(slot, candidate)}
                </Button>
              ))}
            </div>
          </div>

          {automationPending ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800" role="status">
              <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <div className="font-semibold">模式尚未保存</div>
                <div className="mt-1 text-xs leading-5">
                  {mode === "ai_daily"
                    ? "保存后恢复自动生成，并立即检查、补齐今天的素材。"
                    : mode === "static"
                      ? "保存后改为人工固定，后续不会自动替换这项内容。"
                      : slot.key === "matechat_quick_suggestions"
                        ? "保存后由系统在每次打开 MateChat 时自动更新个性化建议。"
                        : "保存后停用该素材位的自动更新。"}
                </div>
              </div>
            </div>
          ) : automation ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-3 text-sm",
                automationHealthy && "border-emerald-200 bg-emerald-50 text-emerald-800",
                automationCatchingUp && "border-amber-200 bg-amber-50 text-amber-800",
                !automationHealthy && !automationCatchingUp && "border-slate-200 bg-slate-50 text-slate-600",
              )}
              role="status"
            >
              {automationHealthy ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : automationCatchingUp ? (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <div>
                <div className="font-semibold">{automation.title}</div>
                <div className="mt-1 text-xs leading-5 opacity-80">{automation.detail}</div>
              </div>
            </div>
          ) : null}

          {mode === "ai_daily" && slot.default_prompt ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor={promptId} className="text-sm font-semibold text-slate-700">
                  {isImage ? "自动生成规则（提示词）" : "自动文案规则（system 提示词）"}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={"恢复 " + slot.name + " 的默认生成规则"}
                  onClick={() => setPrompt(slot.default_prompt)}
                  className="rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />恢复默认
                </Button>
              </div>
              <Textarea
                id={promptId}
                rows={4}
                value={prompt}
                aria-describedby={promptHelpId}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setOperationError(null);
                }}
                className="min-h-28 rounded-xl border-slate-200 bg-white text-sm leading-6"
              />
              <div id={promptHelpId} className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                {slot.prompt_vars.length > 0 ? (
                  <p>
                    可用变量：{slot.prompt_vars.map((variable) => <code key={variable} className="mx-0.5 rounded bg-slate-100 px-1.5 py-0.5">{variable}</code>)} · {slot.note}
                  </p>
                ) : null}
                <p>这里保存的是每天自动生成时使用的规则，不是固定成品；保存后明天仍会生成新内容。</p>
              </div>
            </div>
          ) : null}

          {mode === "static" && slot.type === "text" ? (
            <div>
              <label htmlFor={staticTextId} className="mb-2 block text-sm font-semibold text-slate-700">固定文案</label>
              <Textarea
                id={staticTextId}
                rows={2}
                placeholder="固定展示的文案"
                value={staticText}
                onChange={(event) => {
                  setStaticText(event.target.value);
                  setOperationError(null);
                }}
                className="rounded-xl border-slate-200 bg-white text-sm leading-6"
              />
            </div>
          ) : null}

          {mode === "static" && isList ? (
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold text-slate-700">自定义建议列表（最多 12 条）</legend>
              <div className="space-y-2">
                {staticList.map((item, index) => {
                  const itemId = idBase + "-suggestion-" + index;
                  return (
                    <div key={index} className="flex min-w-0 items-center gap-2">
                      <label htmlFor={itemId} className="sr-only">第 {index + 1} 条建议</label>
                      <Input
                        id={itemId}
                        value={item}
                        placeholder="一条建议，如：帮我写本周周报"
                        onChange={(event) => {
                          setStaticList((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value));
                          setOperationError(null);
                        }}
                        className="h-10 rounded-xl border-slate-200 bg-white"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label={"删除第 " + (index + 1) + " 条建议"}
                        onClick={() => setStaticList((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        className="size-10 rounded-xl border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
                {staticList.length === 0 ? <p className="text-xs text-slate-500">尚未添加建议，保存后将使用空列表。</p> : null}
                {staticList.length < 12 ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setStaticList((current) => [...current, ""])} className="rounded-lg border-slate-200">
                    添加一条
                  </Button>
                ) : null}
              </div>
            </fieldset>
          ) : null}

          {mode === "static" && isImage ? (
            <fieldset className="min-w-0" aria-describedby={uploadError ? uploadErrorId : undefined}>
              <legend className="mb-2 text-sm font-semibold text-slate-700">
                固定图片池 <span className="font-normal text-slate-500 tabular-nums">{pool.length}/12，多张时每天轮换一张</span>
              </legend>
              <div className="flex flex-wrap gap-3">
                {pool.map((item, index) => (
                  <div key={item.object_key} className="relative h-24 w-32 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    {item.url ? (
                      <img src={item.url} alt={slot.name + "固定图片 " + (index + 1)} className="h-full w-full object-cover" />
                    ) : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-slate-500">图片暂不可用</div>}
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label={"移除 " + slot.name + " 的第 " + (index + 1) + " 张固定图片"}
                      onClick={() => void removePoolImage(item.object_key)}
                      disabled={busy}
                      className="absolute right-1 top-1 size-8 rounded-lg border-white/80 bg-white/95 text-rose-600 shadow-sm hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {pool.length < 12 ? (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={"向 " + slot.name + " 固定图片池添加图片"}
                    aria-controls={fileInputId}
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="h-24 w-32 flex-col rounded-xl border-dashed border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-[#002fa7]"
                  >
                    {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Upload className="size-5" aria-hidden="true" />}
                    <span className="text-xs">添加图片</span>
                  </Button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                id={fileInputId}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-label={"选择要上传到 " + slot.name + " 的图片"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleUpload(file);
                }}
              />
              {uploadError ? <p id={uploadErrorId} className="mt-2 text-xs text-rose-600" role="alert">{uploadError}</p> : null}
            </fieldset>
          ) : null}

          {mode === "off" && slot.key !== "matechat_quick_suggestions" ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">{slot.note}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              aria-busy={saving}
              className="bg-[#002fa7] hover:bg-[#002581]"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              保存配置
            </Button>
            {mode === "ai_daily" && slot.default_prompt ? (
              <Button type="button" variant="outline" onClick={() => void handleRegenerate()} disabled={busy} aria-busy={busy} className="border-slate-200">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {isImage ? "重新生成今天" : "预览今日文案"}
              </Button>
            ) : null}
            {isImage ? (
              <Button
                type="button"
                variant="outline"
                aria-expanded={historyOpen}
                aria-controls={historyPanelId}
                onClick={() => void toggleHistory()}
                className="border-slate-200"
              >
                <History className="size-4" aria-hidden="true" />
                {historyOpen ? "收起历史" : "查看历史"}
              </Button>
            ) : null}
            {operationError ? <p className="basis-full text-xs text-rose-600" role="alert">{operationError}</p> : null}
          </div>

          {isImage && historyOpen ? (
            <section id={historyPanelId} className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label={slot.name + "历史记录"}>
              {historyLoading ? (
                <div className="space-y-3" aria-live="polite" aria-busy="true">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />正在读取历史记录
                  </div>
                  <div className="flex gap-2" aria-hidden="true">
                    {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 w-28 animate-pulse rounded-lg bg-slate-200" />)}
                  </div>
                </div>
              ) : history.length === 0 ? (
                <HorizonEmptyState Icon={History} title="暂无历史记录" description="完成首次生成或上传后，历史素材会显示在这里。" />
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {history.map((item, index) => (
                    <figure key={item.date + "-" + index} className="shrink-0 text-center">
                      <div className="h-20 w-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
                        {item.url ? (
                          <img src={item.url} alt={slot.name + " " + item.date + " 历史图片"} className="h-full w-full object-cover" />
                        ) : <div className="flex h-full items-center justify-center text-xs text-slate-300">图片已失效</div>}
                      </div>
                      <figcaption className="mt-1 text-xs text-slate-500">
                        <time dateTime={item.date} className="tabular-nums">{item.date}</time>{item.source === "upload" ? " · 上传" : ""}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function GenBudgetCard() {
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const budgetId = useId();
  const budgetHelpId = budgetId + "-help";

  const loadBudget = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const budget = await contentSlotsApi.getGenBudget();
      setCap(budget.monthly_cap);
      setUsed(budget.used_this_month);
      setLoaded(true);
    } catch (error) {
      setLoadError(errorMessage(error, "读取生成预算失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await contentSlotsApi.saveGenBudget(cap);
      setCap(response.monthly_cap);
      toast.success("已保存生成上限");
    } catch (error) {
      const message = errorMessage(error, "保存生成上限失败");
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const over = cap > 0 && used >= cap;
  const usagePercent = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  return (
    <section className="hz-surface overflow-hidden">
      <HorizonSectionHeader
        Icon={Gauge}
        title="AI 生成成本闸门"
        description="限制自动图片生成与手动重生成的月度总量；设置为 0 表示不限制。"
        trailing={loaded ? (
          <span className={cn(
            "rounded-lg border px-2.5 py-1 text-xs font-semibold",
            over ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
          )}>
            {over ? "已达上限" : "预算可用"}
          </span>
        ) : null}
      />
      {loading && !loaded ? (
        <div className="space-y-4 p-4 sm:p-5" aria-live="polite" aria-busy="true">
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" aria-hidden="true" />正在读取本月预算</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]" aria-hidden="true">
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          </div>
        </div>
      ) : loadError && !loaded ? (
        <HorizonEmptyState
          Icon={AlertCircle}
          title="预算信息读取失败"
          description={loadError}
          action={<Button type="button" variant="outline" onClick={() => void loadBudget()}><RefreshCw className="size-4" aria-hidden="true" />重新读取</Button>}
        />
      ) : (
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-500">本月已生成</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
                  {used} <span className="text-sm font-normal text-slate-500">张</span>
                </div>
              </div>
              <div className="text-right text-sm text-slate-500">
                {cap > 0 ? <>上限 <span className="font-semibold text-slate-800 tabular-nums">{cap}</span> 张</> : "当前不设上限"}
              </div>
            </div>
            {cap > 0 ? (
              <div className="mt-3">
                <div
                  className="h-2 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="本月生成预算使用进度"
                  aria-valuemin={0}
                  aria-valuemax={cap}
                  aria-valuenow={Math.min(used, cap)}
                >
                  <div className={cn("h-full rounded-full", over ? "bg-rose-500" : "bg-[#002fa7]")} style={{ width: usagePercent + "%" }} />
                </div>
                <p id={budgetHelpId} className={cn("mt-2 text-xs", over ? "text-rose-600" : "text-slate-500")}>
                  {over ? "自动生成已暂停，手动重生成也会被拒绝。" : "已使用 " + usagePercent + "%，剩余 " + Math.max(0, cap - used) + " 张。"}
                </p>
              </div>
            ) : <p id={budgetHelpId} className="mt-2 text-xs text-slate-500">所有生成任务继续按现有自动化规则运行。</p>}
          </div>
          <div>
            <label htmlFor={budgetId} className="mb-2 block text-sm font-semibold text-slate-700">月度生成上限</label>
            <div className="flex items-center gap-2">
              <Input
                id={budgetId}
                type="number"
                min={0}
                value={cap}
                placeholder="0 = 不限"
                aria-describedby={budgetHelpId}
                aria-invalid={Boolean(saveError)}
                onChange={(event) => {
                  setCap(Math.max(0, Number(event.target.value) || 0));
                  setSaveError(null);
                }}
                className="h-10 rounded-xl border-slate-200 bg-white tabular-nums"
              />
              <Button type="button" variant="outline" onClick={() => void save()} disabled={saving} aria-busy={saving} className="h-10 rounded-xl border-slate-200">
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}保存
              </Button>
            </div>
            {saveError ? <p className="mt-2 text-xs text-rose-600" role="alert">{saveError}</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

export function ContentSlotsPage() {
  const [slots, setSlots] = useState<ContentSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await contentSlotsApi.list();
      setSlots(response.items);
    } catch (error) {
      const message = errorMessage(error, "读取素材位失败");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const automaticCount = slots.filter(isAutomaticSlot).length;
  const staticCount = slots.filter((slot) => slot.mode === "static").length;
  const currentCount = slots.filter(hasCurrentContent).length;

  return (
    <main className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Palette}
        eyebrow="AI CONTENT · OPERATIONS"
        title="运营素材管理"
        description="统一维护 MateChat 图片、文案与快捷建议的自动生成规则、固定内容和历史版本。"
        meta={(
          <>
            <span>按上海时间执行每日更新</span>
            <span aria-hidden="true">·</span>
            <span>打开或保存页面不会停止自动化</span>
            <span aria-hidden="true">·</span>
            <span aria-live="polite">{loading ? "正在同步" : "配置已就绪"}</span>
          </>
        )}
        actions={(
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} aria-busy={loading} className="rounded-xl border-slate-200 bg-white">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />刷新
          </Button>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
        <HorizonMetric Icon={Layers3} label="素材位" value={loading && slots.length === 0 ? "—" : slots.length} note="图片、文案与建议列表" tone="brand" />
        <HorizonMetric Icon={Sparkles} label="自动运行" value={loading && slots.length === 0 ? "—" : automaticCount} note="含 MateChat 系统自动建议" tone="success" />
        <HorizonMetric Icon={Pin} label="人工固定" value={loading && slots.length === 0 ? "—" : staticCount} note="保存后不再自动替换" tone="neutral" />
        <HorizonMetric Icon={CheckCircle2} label="已有成品" value={loading && slots.length === 0 ? "—" : currentCount} note="当前可展示的素材位" tone={currentCount > 0 ? "success" : "warning"} />
      </HorizonMetricGrid>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700">
        保持“自动每日更新”时，人工重生成只替换今天的内容，明天仍会继续自动更新。只有明确切换到“人工固定”或“停用”并保存，才会停止对应自动生成；MateChat 快捷建议的“系统自动”仍会在每次打开时按用户更新。
      </div>

      <GenBudgetCard />

      <section className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader
          Icon={Layers3}
          title="素材位配置"
          description="逐项确认更新方式、生成规则、固定素材和今日预览。"
          trailing={<span className="text-xs text-slate-500 tabular-nums">共 {slots.length} 项</span>}
        />

        {loadError && slots.length > 0 ? (
          <div className="mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>刷新失败：{loadError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()} className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100">重试</Button>
          </div>
        ) : null}

        {loading && slots.length === 0 ? (
          <div className="space-y-4 p-4 sm:p-5" aria-live="polite" aria-busy="true">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />正在加载素材位配置
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[240px_minmax(0,1fr)]" aria-hidden="true">
                <div className="h-36 animate-pulse rounded-xl bg-slate-100" />
                <div className="space-y-3">
                  <div className="h-8 w-1/3 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError && slots.length === 0 ? (
          <HorizonEmptyState
            Icon={AlertCircle}
            title="素材位读取失败"
            description={loadError}
            action={<Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />重新加载</Button>}
          />
        ) : slots.length === 0 ? (
          <HorizonEmptyState
            Icon={Layers3}
            title="暂无可配置素材位"
            description="刷新后仍为空时，请确认服务端已登记运营素材位。"
            action={<Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className="size-4" aria-hidden="true" />刷新</Button>}
          />
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            {slots.map((slot) => <SlotCard key={slot.key} slot={slot} onChanged={load} />)}
          </div>
        )}
      </section>
    </main>
  );
}
