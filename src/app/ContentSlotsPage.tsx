import { useCallback, useEffect, useRef, useState } from "react";
import { History, ImageIcon, Loader2, Palette, RefreshCw, RotateCcw, Sparkles, Type, Upload, X } from "lucide-react";
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
  const [staticList, setStaticList] = useState<string[]>(slot.static_list ?? []);
  const [pool, setPool] = useState<Array<{ object_key: string; url: string | null }>>(slot.static_image_pool ?? []);
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

  const dirty =
    mode !== slot.mode ||
    prompt !== slot.prompt_template ||
    staticText !== slot.static_text ||
    JSON.stringify(staticList) !== JSON.stringify(slot.static_list ?? []);

  async function handleSave() {
    setSaving(true);
    try {
      await contentSlotsApi.updateConfig(slot.key, { mode, promptTemplate: prompt, staticText, staticList });
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
    if (pool.length >= 12) {
      toast.error("图片池最多 12 张");
      return;
    }
    setBusy(true);
    try {
      const objectKey = await uploadSlotImage(file);
      const nextKeys = [...pool.map((p) => p.object_key), objectKey];
      await contentSlotsApi.updateConfig(slot.key, { mode: "static", staticImagePool: nextKeys });
      setMode("static");
      toast.success("已添加图片");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function removePoolImage(objectKey: string) {
    setBusy(true);
    try {
      const nextKeys = pool.map((p) => p.object_key).filter((k) => k !== objectKey);
      await contentSlotsApi.updateConfig(slot.key, { staticImagePool: nextKeys });
      setPool((prev) => prev.filter((p) => p.object_key !== objectKey));
      toast.success("已移除");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败");
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
  const isList = slot.type === "list";

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
          ) : isList ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1.5 text-[11px] font-medium text-slate-400">当前展示</div>
              <ul className="space-y-1">
                {(slot.current?.list ?? []).slice(0, 5).map((s, i) => (
                  <li key={i} className="truncate rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600" title={s}>
                    {s}
                  </li>
                ))}
              </ul>
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

          {/* 固定模式：文案 / 图片上传 / 列表 */}
          {mode === "static" && slot.type === "text" && (
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
          {mode === "static" && isList && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                自定义建议列表（最多 12 条）
              </label>
              <div className="space-y-2">
                {staticList.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="material-input w-full text-sm"
                      value={s}
                      placeholder="一条建议，如：帮我写本周周报"
                      onChange={(e) => setStaticList((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                      onClick={() => setStaticList((prev) => prev.filter((_, j) => j !== i))}
                      title="删除"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {staticList.length < 12 && (
                  <button
                    type="button"
                    className="material-button-secondary !px-3 !py-1.5 text-xs"
                    onClick={() => setStaticList((prev) => [...prev, ""])}
                  >
                    + 添加一条
                  </button>
                )}
              </div>
            </div>
          )}
          {mode === "static" && isImage && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                固定图片池（{pool.length}/12，多张时每天轮换一张）
              </label>
              <div className="flex flex-wrap gap-2">
                {pool.map((p) => (
                  <div key={p.object_key} className="group relative h-16 w-24 overflow-hidden rounded-lg border border-slate-200">
                    {p.url ? <img src={p.url} alt="" className="h-full w-full object-cover" /> : null}
                    <button
                      type="button"
                      onClick={() => void removePoolImage(p.object_key)}
                      disabled={busy}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100"
                      title="移除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {pool.length < 12 && (
                  <button
                    type="button"
                    className="flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-indigo-300 hover:text-indigo-500 disabled:opacity-50"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span className="text-[10px]">添加图片</span>
                  </button>
                )}
              </div>
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

function GenBudgetCard() {
  const [cap, setCap] = useState(0);
  const [used, setUsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void contentSlotsApi
      .getGenBudget()
      .then((b) => {
        setCap(b.monthly_cap);
        setUsed(b.used_this_month);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await contentSlotsApi.saveGenBudget(cap);
      setCap(r.monthly_cap);
      toast.success("已保存生成上限");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  const over = cap > 0 && used >= cap;
  return (
    <section className="material-card flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <div className="text-sm font-semibold text-slate-800">AI 生成成本闸门</div>
        <div className="mt-0.5 text-xs text-slate-400">
          本月已生成 <span className={cn("font-medium", over ? "text-rose-600" : "text-slate-600")}>{used}</span> 张
          {cap > 0 ? ` / 上限 ${cap} 张` : "（未设上限）"}
          {over ? " · 已达上限，自动生成暂停、手动重生成被拒" : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">月度上限</label>
        <input
          type="number"
          min={0}
          className="material-input !w-28 text-sm"
          value={cap}
          placeholder="0=不限"
          onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))}
        />
        <button type="button" className="material-button-secondary !px-3 !py-2" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          保存
        </button>
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

      <GenBudgetCard />

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
