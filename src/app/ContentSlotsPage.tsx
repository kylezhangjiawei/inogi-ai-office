import { useCallback, useEffect, useRef, useState } from "react";
import { History, ImageIcon, Loader2, Palette, RefreshCw, RotateCcw, Sparkles, Type, Upload } from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { contentSlotsApi, uploadSlotImage, type ContentSlot, type SlotMode } from "./lib/contentSlotsApi";

const MODE_LABEL: Record<SlotMode, string> = {
  ai_daily: "AI 每日生成",
  static: "固定素材",
  off: "关闭",
};

function SlotCard({ slot, onChanged }: { slot: ContentSlot; onChanged: () => void }) {
  const [mode, setMode] = useState<SlotMode>(slot.mode);
  const [prompt, setPrompt] = useState(slot.prompt_template);
  const [staticText, setStaticText] = useState(slot.static_text);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(slot.current?.image_url ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ date: string; url: string | null; source: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) {
      setHistoryLoading(true);
      try {
        const r = await contentSlotsApi.history(slot.key);
        setHistory(r.items);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "读取历史失败");
      } finally {
        setHistoryLoading(false);
      }
    }
  }

  const dirty = mode !== slot.mode || prompt !== slot.prompt_template || staticText !== slot.static_text;

  async function handleSave() {
    setSaving(true);
    try {
      await contentSlotsApi.updateConfig(slot.key, { mode, promptTemplate: prompt, staticText });
      toast.success("已保存");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片");
      return;
    }
    setBusy(true);
    try {
      const objectKey = await uploadSlotImage(file);
      await contentSlotsApi.updateConfig(slot.key, { mode: "static", staticImageObjectKey: objectKey });
      setMode("static");
      toast.success("已上传固定素材");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    setPreviewText(null);
    try {
      if (dirty) await contentSlotsApi.updateConfig(slot.key, { mode, promptTemplate: prompt, staticText });
      const r = await contentSlotsApi.regenerate(slot.key);
      if (r.image_url !== undefined) {
        setPreviewImg(r.image_url ?? null);
        toast.success(r.image_url ? "已重新生成" : "已触发，稍后刷新查看");
      }
      if (r.sample_text) {
        setPreviewText(r.sample_text);
        toast.success("已生成示例文案");
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  const isImage = slot.type === "image";

  return (
    <section className="material-card p-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 预览 */}
        <div className="shrink-0 lg:w-64">
          {isImage ? (
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-900/95">
              {mode === "off" ? (
                <span className="text-xs text-slate-400">已关闭</span>
              ) : previewImg ? (
                <img src={previewImg} alt={slot.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <ImageIcon className="h-8 w-8" />
                  <span className="text-xs">{mode === "static" ? "未上传固定图" : "尚无图片"}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
              {mode === "static" ? (
                <span className="text-sm font-medium text-slate-700">“{staticText || "（未填写固定文案）"}”</span>
              ) : previewText ? (
                <span className="text-sm font-medium text-slate-700">“{previewText}”</span>
              ) : (
                <span className="flex flex-col items-center gap-2 text-xs text-slate-400">
                  <Type className="h-7 w-7" /> 点「预览文案」看效果
                </span>
              )}
            </div>
          )}
          {slot.current?.date && mode === "ai_daily" && (
            <div className="mt-1.5 text-center text-[11px] text-slate-400">当前：{slot.current.date}</div>
          )}
        </div>

        {/* 配置 */}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("material-chip", isImage ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700")}>
                {isImage ? "图片" : "文案"}
              </span>
              <h3 className="text-base font-semibold text-slate-900">{slot.name}</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">{slot.location}</p>
          </div>

          {/* 模式切换 */}
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {slot.modes.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          {/* AI 模式：prompt */}
          {mode === "ai_daily" && slot.default_prompt && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {isImage ? "生成提示词" : "文案生成提示词（system）"}
                </label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => setPrompt(slot.default_prompt)}
                >
                  <RotateCcw className="h-3 w-3" /> 默认
                </button>
              </div>
              <textarea
                rows={4}
                className="material-input w-full resize-none text-sm"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {slot.prompt_vars.length > 0 && (
                <p className="mt-1.5 text-xs text-slate-400">
                  可用变量：{slot.prompt_vars.map((v) => <code key={v} className="mx-0.5 rounded bg-slate-100 px-1">{v}</code>)} · {slot.note}
                </p>
              )}
            </div>
          )}

          {/* 固定模式：文案 / 图片上传 */}
          {mode === "static" && !isImage && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">固定文案</label>
              <textarea
                rows={2}
                className="material-input w-full resize-none text-sm"
                placeholder="固定展示的文案"
                value={staticText}
                onChange={(e) => setStaticText(e.target.value)}
              />
            </div>
          )}
          {mode === "static" && isImage && (
            <div>
              <button
                type="button"
                className="material-button-secondary disabled:opacity-50"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {slot.has_static_image ? "更换固定图片" : "上传固定图片"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleUpload(f);
                }}
              />
            </div>
          )}

          {mode === "off" && <p className="text-sm text-slate-400">{slot.note}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="material-button-primary disabled:opacity-50"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存
            </button>
            {mode === "ai_daily" && slot.default_prompt && (
              <button
                type="button"
                className="material-button-secondary disabled:opacity-50"
                onClick={() => void handleRegenerate()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isImage ? "立即重新生成" : "预览文案"}
              </button>
            )}
            {isImage && (
              <button
                type="button"
                className="material-button-secondary !px-3"
                onClick={() => void toggleHistory()}
              >
                <History className="h-4 w-4" />
                历史
              </button>
            )}
          </div>

          {/* 历史记录 */}
          {isImage && historyOpen && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              {historyLoading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> 读取历史...
                </div>
              ) : history.length === 0 ? (
                <div className="py-3 text-center text-xs text-slate-400">暂无历史记录</div>
              ) : (
                <div className="material-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {history.map((h, i) => (
                    <div key={`${h.date}-${i}`} className="shrink-0 text-center">
                      <div className="h-16 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-900/90">
                        {h.url ? (
                          <img src={h.url} alt={h.date} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-slate-400">失效</div>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {h.date}
                        {h.source === "upload" ? " · 上传" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ContentSlotsPage() {
  const [slots, setSlots] = useState<ContentSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contentSlotsApi.list();
      setSlots(res.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-indigo-50 text-indigo-700">Content Slots</span>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[2rem] font-bold tracking-tight text-slate-900">
            <Palette className="h-7 w-7 text-indigo-600" />
            运营素材管理
          </h2>
          <button type="button" className="material-button-secondary w-fit" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
          </button>
        </div>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          统一管理项目里 AI 每日生成 / 动态刷新的素材位（MateChat 吉祥物图、激励文案、登录页背景等）。每个素材位可选
          <b> AI 每日生成 / 固定素材 / 关闭</b> 三种模式：AI 模式可改提示词并立即重新生成；固定模式可上传图片或填写文案。改动即时生效，无需发版。
        </p>
      </section>

      {loading && slots.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> 加载中...
        </div>
      ) : (
        <div className="space-y-5">
          {slots.map((slot) => (
            <SlotCard key={slot.key} slot={slot} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
