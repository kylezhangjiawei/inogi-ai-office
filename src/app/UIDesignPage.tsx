import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Heart,
  ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { cn } from "./components/ui/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type GeneratedImage = {
  id: string;
  prompt: string;
  revisedPrompt: string;
  style: "vivid" | "natural";
  size: "1024x1024" | "1792x1024" | "1024x1792";
  quality: "standard" | "hd";
  imageData: string;
  model: string;
  isFavorite: boolean;
  createdAt: string;
  fromCache?: boolean;
  similarity?: number;
};

type ListResponse = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: GeneratedImage[];
};

type Style = "vivid" | "natural";
type Size = "1024x1024" | "1792x1024" | "1024x1792";
type Quality = "standard" | "hd";
type Tab = "generate" | "gallery";

const SIZE_OPTIONS: { value: Size; label: string; desc: string; ratio: string }[] = [
  { value: "1024x1024", label: "正方形", desc: "1:1", ratio: "aspect-square" },
  { value: "1792x1024", label: "横版", desc: "16:9", ratio: "aspect-video" },
  { value: "1024x1792", label: "竖版", desc: "9:16", ratio: "aspect-[9/16]" },
];

const STYLE_OPTIONS: { value: Style; label: string; desc: string }[] = [
  { value: "vivid", label: "超真实", desc: "戏剧性、鲜艳、超现实" },
  { value: "natural", label: "自然风", desc: "写实、柔和、贴近自然" },
];

const QUICK_PROMPTS = [
  "现代简约风格办公室室内设计，大落地窗，白色调",
  "科技感产品展示图，蓝紫渐变背景，金属质感",
  "企业品牌宣传图，专业商务风，蓝色主色调",
  "团队协作插画，温暖色调，扁平化设计风格",
];

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiGenerate(body: {
  prompt: string;
  style: Style;
  size: Size;
  quality: Quality;
}): Promise<GeneratedImage> {
  const res = await authFetch("/api/image-generation/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "生成失败");
  }
  return res.json() as Promise<GeneratedImage>;
}

async function apiList(page: number, pageSize: number, favorite: boolean): Promise<ListResponse> {
  const res = await authFetch(
    `/api/image-generation/images?page=${page}&pageSize=${pageSize}&favorite=${favorite}`,
  );
  if (!res.ok) throw new Error("加载失败");
  return res.json() as Promise<ListResponse>;
}

async function apiToggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const res = await authFetch(`/api/image-generation/images/${id}/favorite`, { method: "PATCH" });
  if (!res.ok) throw new Error("操作失败");
  return res.json() as Promise<{ id: string; isFavorite: boolean }>;
}

async function apiDelete(id: string): Promise<void> {
  const res = await authFetch(`/api/image-generation/images/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除失败");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UIDesignPage() {
  const [tab, setTab] = useState<Tab>("generate");

  // Generate form
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("vivid");
  const [size, setSize] = useState<Size>("1024x1024");
  const [quality, setQuality] = useState<Quality>("standard");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedImage | null>(null);

  // Gallery
  const [galleryItems, setGalleryItems] = useState<GeneratedImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotal, setGalleryTotal] = useState(0);
  const [galleryPages, setGalleryPages] = useState(1);
  const [onlyFavorite, setOnlyFavorite] = useState(false);
  const [gallerySearch, setGallerySearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Preview modal
  const [preview, setPreview] = useState<GeneratedImage | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Gallery loader ──────────────────────────────────────────────────────────

  const loadGallery = useCallback(
    async (page = 1, fav = onlyFavorite) => {
      setGalleryLoading(true);
      try {
        const data = await apiList(page, 12, fav);
        setGalleryItems(data.items);
        setGalleryTotal(data.total);
        setGalleryPages(data.totalPages);
        setGalleryPage(page);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "加载失败");
      } finally {
        setGalleryLoading(false);
      }
    },
    [onlyFavorite],
  );

  useEffect(() => {
    if (tab === "gallery") void loadGallery(1, onlyFavorite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, onlyFavorite]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async (overridePrompt?: string) => {
    const p = (overridePrompt ?? prompt).trim();
    if (!p) { toast.error("请输入图片描述"); return; }
    if (generating) return;

    setGenerating(true);
    setResult(null);
    try {
      const img = await apiGenerate({ prompt: p, style, size, quality });
      setResult(img);
      if (img.fromCache) {
        toast.success("命中缓存，直接返回相似图片", { icon: "⚡" });
      } else {
        toast.success("图片生成成功");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  // ── Favorite ────────────────────────────────────────────────────────────────

  const handleFavorite = async (img: GeneratedImage) => {
    try {
      const updated = await apiToggleFavorite(img.id);
      if (result?.id === img.id) setResult((r) => r ? { ...r, isFavorite: updated.isFavorite } : r);
      setGalleryItems((prev) =>
        prev.map((item) => (item.id === img.id ? { ...item, isFavorite: updated.isFavorite } : item)),
      );
      if (preview?.id === img.id) setPreview((p) => p ? { ...p, isFavorite: updated.isFavorite } : p);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(id);
      setGalleryItems((prev) => prev.filter((item) => item.id !== id));
      setGalleryTotal((t) => t - 1);
      if (result?.id === id) setResult(null);
      if (preview?.id === id) setPreview(null);
      setDeleteConfirm(null);
      toast.success("已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  // ── Download ────────────────────────────────────────────────────────────────

  const handleDownload = (img: GeneratedImage) => {
    const a = document.createElement("a");
    a.href = img.imageData;
    a.download = `inogi-design-${img.id.slice(-8)}.png`;
    a.click();
  };

  const selectedSizeOpt = SIZE_OPTIONS.find((s) => s.value === size)!;

  // ── Gallery filtered ─────────────────────────────────────────────────────────

  const filteredGallery = gallerySearch.trim()
    ? galleryItems.filter((item) =>
        item.prompt.toLowerCase().includes(gallerySearch.toLowerCase()),
      )
    : galleryItems;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[linear-gradient(135deg,#f0f4ff_0%,#f7f9ff_50%,#eef6ff_100%)]">
      {/* ── 左侧控制面板 ── */}
      <aside className="flex w-[320px] flex-shrink-0 flex-col overflow-y-auto border-r border-slate-200/80 bg-white/80 backdrop-blur-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#6366f1_0%,#8b5cf6_100%)] shadow-md">
              <Wand2 className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">AI Studio</div>
              <div className="text-sm font-bold text-slate-900">UI 设计生成</div>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-5 px-6 py-5">
          {/* 描述输入 */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-600">图片描述</label>
            <textarea
              ref={textareaRef}
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleGenerate();
              }}
              placeholder="描述你想要的图片内容、风格、配色…&#10;例如：现代科技感APP界面，深色背景，蓝紫渐变"
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Ctrl+Enter 生成</span>
              <span className={cn("text-[11px]", prompt.length > 900 ? "text-red-400" : "text-slate-400")}>
                {prompt.length}/1000
              </span>
            </div>
          </div>

          {/* 快捷提示 */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-600">快捷提示</label>
            <div className="space-y-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPrompt(p); textareaRef.current?.focus(); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 transition hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-700"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 风格 */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-600">风格</label>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition",
                    style === opt.value
                      ? "border-violet-400 bg-violet-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <div className={cn("text-xs font-semibold", style === opt.value ? "text-violet-700" : "text-slate-700")}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 尺寸 */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-600">尺寸比例</label>
            <div className="grid grid-cols-3 gap-2">
              {SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSize(opt.value)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-3 transition",
                    size === opt.value
                      ? "border-violet-400 bg-violet-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1.5 rounded border-2",
                      size === opt.value ? "border-violet-500 bg-violet-100" : "border-slate-300 bg-slate-100",
                      opt.value === "1024x1024" ? "h-7 w-7" : opt.value === "1792x1024" ? "h-5 w-8" : "h-8 w-5",
                    )}
                  />
                  <div className={cn("text-[10px] font-semibold", size === opt.value ? "text-violet-700" : "text-slate-600")}>
                    {opt.label}
                  </div>
                  <div className="text-[9px] text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 画质 */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-600">画质</label>
            <div className="grid grid-cols-2 gap-2">
              {([["standard", "标准", "速度更快"] as const, ["hd", "高清 HD", "更多细节"] as const]).map(
                ([val, label, desc]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setQuality(val)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition",
                      quality === val
                        ? "border-violet-400 bg-violet-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <div className={cn("flex items-center gap-1 text-xs font-semibold", quality === val ? "text-violet-700" : "text-slate-700")}>
                      {val === "hd" && <Zap className="h-3 w-3 text-amber-500" />}
                      {label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{desc}</div>
                  </button>
                ),
              )}
            </div>
          </div>
        </div>

        {/* 生成按钮 */}
        <div className="border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !prompt.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#6366f1_0%,#8b5cf6_100%)] py-3.5 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(99,102,241,0.4)] transition hover:shadow-[0_6px_28px_rgba(99,102,241,0.5)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 正在创作…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                生成图片
              </>
            )}
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            相似提示词优先使用缓存图片 · 约 10-30 秒
          </p>
        </div>
      </aside>

      {/* ── 右侧主区域 ── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Tab 导航 */}
        <div className="flex items-center gap-1 border-b border-slate-200/80 bg-white/70 px-6 py-4 backdrop-blur-sm">
          {(["generate", "gallery"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition",
                tab === t
                  ? "bg-violet-100 text-violet-700"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
              )}
            >
              {t === "generate" ? <ImageIcon className="h-4 w-4" /> : <Star className="h-4 w-4" />}
              {t === "generate" ? "当前生成" : `图片库${galleryTotal > 0 ? ` (${galleryTotal})` : ""}`}
            </button>
          ))}
        </div>

        {/* ── 生成结果视图 ── */}
        {tab === "generate" && (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
            {generating ? (
              <div className="flex flex-col items-center gap-4 text-slate-500">
                <div className="relative flex h-24 w-24 items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-violet-200" />
                  <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-violet-500" />
                  <Wand2 className="h-8 w-8 text-violet-500" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-700">AI 正在创作中…</p>
                  <p className="mt-1 text-sm text-slate-400">DALL-E 3 通常需要 10-30 秒</p>
                </div>
              </div>
            ) : result ? (
              <div className="w-full max-w-2xl space-y-4">
                {/* 缓存/新生成 badge */}
                <div className="flex items-center gap-3">
                  {result.fromCache ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                      <Zap className="h-3.5 w-3.5" />
                      命中缓存
                      {result.similarity !== undefined && (
                        <span className="text-sky-500">· 相似度 {Math.round(result.similarity * 100)}%</span>
                      )}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      <Sparkles className="h-3.5 w-3.5" />
                      AI 全新生成
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    {selectedSizeOpt.label} · {style === "vivid" ? "超真实" : "自然风"} · {quality === "hd" ? "HD" : "标准"}
                  </span>
                </div>

                {/* 图片 */}
                <div
                  className="group relative cursor-zoom-in overflow-hidden rounded-3xl shadow-[0_20px_60px_rgba(99,102,241,0.2)] ring-1 ring-violet-200/50"
                  onClick={() => setPreview(result)}
                >
                  <img
                    src={result.imageData}
                    alt={result.prompt}
                    className="w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
                    <Search className="h-8 w-8 text-white drop-shadow" />
                  </div>
                </div>

                {/* 操作栏 */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleFavorite(result)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition",
                      result.isFavorite
                        ? "border-red-200 bg-red-50 text-red-600"
                        : "border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:text-red-500",
                    )}
                  >
                    <Heart className={cn("h-3.5 w-3.5", result.isFavorite && "fill-current")} />
                    {result.isFavorite ? "已收藏" : "收藏"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(result)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPrompt(result.prompt); void handleGenerate(result.prompt); }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新生成
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(result.id)}
                    className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-500 transition hover:border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>

                {/* 提示词信息 */}
                <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm">
                  <div className="mb-1 text-xs font-semibold text-slate-400">原始提示词</div>
                  <p className="text-slate-700">{result.prompt}</p>
                  {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
                    <>
                      <div className="mb-1 mt-3 text-xs font-semibold text-slate-400">AI 优化后</div>
                      <p className="text-xs leading-5 text-slate-500">{result.revisedPrompt}</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-center text-slate-400">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100">
                  <ImageIcon className="h-10 w-10 text-slate-300" />
                </div>
                <div>
                  <p className="font-semibold text-slate-500">输入描述，点击生成</p>
                  <p className="mt-1 text-sm">系统会优先从历史图库中匹配相似图片</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 图片库视图 ── */}
        {tab === "gallery" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* 工具栏 */}
            <div className="flex items-center gap-3 border-b border-slate-200/80 bg-white/60 px-6 py-3.5">
              <div className="relative flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={gallerySearch}
                  onChange={(e) => setGallerySearch(e.target.value)}
                  placeholder="搜索提示词"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyFavorite((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition",
                  onlyFavorite
                    ? "border-red-200 bg-red-50 text-red-600"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                )}
              >
                <Heart className={cn("h-3.5 w-3.5", onlyFavorite && "fill-current")} />
                {onlyFavorite ? "已收藏" : "全部"}
              </button>
              <button
                type="button"
                onClick={() => void loadGallery(galleryPage, onlyFavorite)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", galleryLoading && "animate-spin")} />
                刷新
              </button>
              <span className="ml-auto text-xs text-slate-400">共 {galleryTotal} 张</span>
            </div>

            {/* 图片网格 */}
            <div className="flex-1 overflow-y-auto p-6">
              {galleryLoading ? (
                <div className="flex h-40 items-center justify-center text-slate-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  加载中…
                </div>
              ) : filteredGallery.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
                  <ImageIcon className="h-10 w-10 text-slate-300" />
                  <p>{gallerySearch ? "没有匹配结果" : "暂无图片，去生成第一张吧"}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredGallery.map((img) => (
                    <div
                      key={img.id}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg hover:-translate-y-1"
                    >
                      <div
                        className="relative cursor-zoom-in overflow-hidden"
                        onClick={() => setPreview(img)}
                      >
                        <img
                          src={img.imageData}
                          alt={img.prompt}
                          className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100">
                          <p className="line-clamp-2 p-2.5 text-[11px] text-white">{img.prompt}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="truncate text-[10px] text-slate-400">
                          {new Date(img.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleFavorite(img); }}
                            className={cn(
                              "rounded-lg p-1 transition hover:bg-red-50",
                              img.isFavorite ? "text-red-500" : "text-slate-400 hover:text-red-400",
                            )}
                          >
                            <Heart className={cn("h-3.5 w-3.5", img.isFavorite && "fill-current")} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDownload(img); }}
                            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(img.id); }}
                            className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 分页 */}
              {galleryPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadGallery(galleryPage - 1)}
                    disabled={galleryPage <= 1}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="text-xs text-slate-500">
                    {galleryPage} / {galleryPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadGallery(galleryPage + 1)}
                    disabled={galleryPage >= galleryPages}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── 删除确认 ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-80 rounded-3xl border border-white/80 bg-white p-6 shadow-2xl">
            <div className="mb-1 text-base font-bold text-slate-900">确认删除</div>
            <p className="text-sm text-slate-500">此操作不可恢复，图片将被永久删除。</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => void handleDelete(deleteConfirm)}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 预览弹窗 ── */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative mx-4 max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={preview.imageData}
              alt={preview.prompt}
              className="max-h-[75vh] w-auto object-contain"
            />
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="text-sm text-slate-700 line-clamp-2">{preview.prompt}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleFavorite(preview)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                    preview.isFavorite ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-slate-600",
                  )}
                >
                  <Heart className={cn("h-3.5 w-3.5", preview.isFavorite && "fill-current")} />
                  {preview.isFavorite ? "取消收藏" : "收藏"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(preview)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载原图
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
