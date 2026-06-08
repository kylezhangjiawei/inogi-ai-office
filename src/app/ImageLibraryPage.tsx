import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Heart, Images, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { DEFAULT_IMAGE_MODEL_OPTION } from "./lib/aiModelOptions";
import { useAiModelOptions } from "./lib/useAiModelOptions";
import {
  apiList,
  apiToggleFavorite,
  apiUsage,
  ArtworkCard,
  downloadGeneratedImage,
  getDateRangeBounds,
  glassCard,
  ImageEditModal,
  ImagePreviewModal,
  ImageUsagePanel,
  Pager,
  type DateRangeKey,
  type GeneratedImage,
  type ImageUsageResponse,
} from "./imageStudioShared";

type LibraryTab = "作品库" | "用量监控";

const TABS: LibraryTab[] = ["作品库", "用量监控"];
const DATE_RANGES: Array<{ key: DateRangeKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "7d", label: "近7天" },
  { key: "30d", label: "近30天" },
];
const PAGE_SIZE = 18;

export function ImageLibraryPage() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("作品库");

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeKey>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const normalizedSearchKeyword = searchKeyword.trim();

  const [items, setItems] = useState<GeneratedImage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);

  const [usage, setUsage] = useState<ImageUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);

  const { loadModels, imageModelOptions, preferredManagedImageModelValue } = useAiModelOptions();
  const editModelOption = useMemo(
    () =>
      imageModelOptions.find((item) => item.value === preferredManagedImageModelValue) ??
      imageModelOptions[0] ??
      DEFAULT_IMAGE_MODEL_OPTION,
    [imageModelOptions, preferredManagedImageModelValue],
  );

  const isGalleryTab = activeTab === "作品库";

  const loadGallery = useCallback(
    async (targetPage: number) => {
      setGalleryLoading(true);
      try {
        const response = await apiList(targetPage, PAGE_SIZE, {
          favorite: favoriteOnly,
          query: normalizedSearchKeyword,
          ...getDateRangeBounds(dateRange),
        });
        setTotal(response.total);
        setTotalPages(response.totalPages);
        setPage(response.page);
        setItems(response.items);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "图片列表加载失败");
      } finally {
        setGalleryLoading(false);
      }
    },
    [favoriteOnly, normalizedSearchKeyword, dateRange],
  );

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      setUsage(await apiUsage());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片用量加载失败");
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // Debounce the free-text search box into the committed keyword.
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchKeyword(searchInput), searchInput ? 280 : 0);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  // Reload page 1 whenever a filter changes (keyword / date range / favorite).
  useEffect(() => {
    if (!isGalleryTab) return;
    void loadGallery(1);
  }, [isGalleryTab, loadGallery]);

  useEffect(() => {
    if (activeTab === "用量监控" && !usage) {
      void loadUsage();
    }
  }, [activeTab, usage, loadUsage]);

  async function handleFavorite(item: GeneratedImage) {
    setFavoriteBusyId(item.id);
    try {
      const updated = await apiToggleFavorite(item.id);
      setItems((images) => {
        if (favoriteOnly && !updated.isFavorite) {
          return images.filter((image) => image.id !== updated.id);
        }
        return images.map((image) => (image.id === updated.id ? { ...image, isFavorite: updated.isFavorite } : image));
      });
      toast.success(updated.isFavorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏状态更新失败");
    } finally {
      setFavoriteBusyId(null);
    }
  }

  const emptyTitle = favoriteOnly
    ? "还没有收藏的作品"
    : normalizedSearchKeyword
      ? "没有匹配的作品"
      : dateRange !== "all"
        ? "该时间段没有作品"
        : "还没有生成记录";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[14px] border border-border bg-surface-container-lowest p-1">
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "cursor-pointer rounded-[10px] px-4 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:bg-surface-container-low",
                )}
              >
                {tab}
              </button>
            );
          })}
        </div>
        <Link
          to="/ui-design"
          className="inline-flex h-9 w-fit shrink-0 cursor-pointer items-center gap-1.5 rounded-[12px] border border-border bg-surface-container-low px-3.5 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <ArrowLeft className="h-4 w-4" />
          返回生成器
        </Link>
      </div>

      {isGalleryTab ? (
        <section className="space-y-4">
          <div className={cn("flex flex-col gap-3 rounded-[16px] px-4 py-3.5", glassCard)}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="搜索提示词…"
                  className="material-input h-10 w-full rounded-[14px] pl-9 pr-3 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 rounded-[14px] border border-border bg-surface-container-lowest p-1">
                  {DATE_RANGES.map((range) => {
                    const active = range.key === dateRange;
                    return (
                      <button
                        key={range.key}
                        type="button"
                        onClick={() => setDateRange(range.key)}
                        className={cn(
                          "cursor-pointer rounded-[10px] px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                          active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:bg-surface-container-low",
                        )}
                      >
                        {range.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setFavoriteOnly((value) => !value)}
                  aria-pressed={favoriteOnly}
                  className={cn(
                    "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[14px] border px-3.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    favoriteOnly
                      ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-surface-container-low text-slate-600 hover:border-primary/30 hover:text-primary",
                  )}
                >
                  <Heart className={cn("h-4 w-4", favoriteOnly ? "fill-current" : "")} />
                  仅收藏
                </button>

                <button
                  type="button"
                  onClick={() => void loadGallery(page)}
                  disabled={galleryLoading}
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[14px] border border-border bg-surface-container-low text-slate-500 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="刷新列表"
                >
                  <RefreshCw className={cn("h-4 w-4", galleryLoading ? "animate-spin motion-reduce:animate-none" : "")} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                共 {total.toLocaleString("zh-CN")} 件
                {normalizedSearchKeyword ? `（搜索“${normalizedSearchKeyword}”）` : ""}
              </span>
              {totalPages > 1 ? <span>第 {page} / {totalPages} 页</span> : null}
            </div>
          </div>

          {items.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item, index) => (
                  <ArtworkCard
                    key={item.id}
                    item={item}
                    index={index}
                    busy={favoriteBusyId === item.id}
                    onPreview={setPreviewItem}
                    onDownload={(target) => void downloadGeneratedImage(target)}
                    onEdit={setEditingItem}
                    onFavorite={(target) => void handleFavorite(target)}
                  />
                ))}
              </div>
              <Pager
                page={page}
                totalPages={totalPages}
                onChange={(target) => void loadGallery(target)}
                disabled={galleryLoading}
              />
            </>
          ) : galleryLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center text-xs font-semibold text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
              正在加载...
            </div>
          ) : (
            <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-[16px] border border-dashed border-border bg-surface-container-lowest/70 px-6 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary-container text-on-primary-container">
                <Images className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-950">{emptyTitle}</h2>
              <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                {favoriteOnly
                  ? "在生成器或这里把喜欢的作品加入收藏，方便后续复用。"
                  : "前往生成器创建你的第一张图像，作品会自动归档到这里。"}
              </p>
              <Link
                to="/ui-design"
                className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-primary px-5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25"
              >
                去生成图像
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ImageUsagePanel usage={usage} loading={usageLoading} onRefresh={() => void loadUsage()} />
      )}

      {previewItem ? <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} /> : null}

      {editingItem ? (
        <ImageEditModal
          item={editingItem}
          modelOption={editModelOption}
          onClose={() => setEditingItem(null)}
          onUpdated={(updated) => {
            setItems((images) => {
              const exists = images.some((image) => image.id === updated.id);
              return exists ? images.map((image) => (image.id === updated.id ? updated : image)) : [updated, ...images];
            });
          }}
        />
      ) : null}
    </div>
  );
}
