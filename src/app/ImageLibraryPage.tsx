import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  FolderOpen,
  FolderTree,
  Heart,
  Images,
  LayoutGrid,
  List,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./components/ui/utils";
import { AssignCategoryModal, MediaCategorySidebar } from "./components/MediaCategorySidebar";
import { MediaUploadButton, MediaUploadDialog } from "./components/MediaUploadDialog";
import { useAuth } from "./auth";
import { DEFAULT_IMAGE_MODEL_OPTION } from "./lib/aiModelOptions";
import { t, useI18n } from "./lib/i18n";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { flattenCategories, subtreeIds, type CategoryFormPayload, type MediaCategoryNode } from "./lib/mediaCategory";
import { useAiModelOptions } from "./lib/useAiModelOptions";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import {
  apiAssignImageCategory,
  apiCreateCategory,
  apiDeleteCategory,
  apiList,
  apiListCategories,
  apiToggleFavorite,
  apiUpdateCategory,
  apiUploadImage,
  apiUsage,
  downloadGeneratedImage,
  flattenCategoryTree,
  formatImageCost,
  formatTime,
  formatUsd,
  getDateRangeBounds,
  ImageEditModal,
  ImagePreviewModal,
  Pager,
  UNCATEGORIZED_FILTER,
  type DateRangeKey,
  type GeneratedImage,
  type ImageCategory,
  type ImageUsageResponse,
} from "./imageStudioShared";

type LibraryTab = "作品库" | "用量监控";
type ViewMode = "grid" | "list";

const TABS: LibraryTab[] = ["作品库", "用量监控"];
const DATE_RANGES: Array<{ key: DateRangeKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "7d", label: "近7天" },
  { key: "30d", label: "近30天" },
];
const PAGE_SIZE = 18;
const USAGE_LOG_PAGE_SIZE = 12;
const ICON_BTN = "flex size-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#eef3ff] hover:text-[#002fa7]";
/**
 * 悬停浮出层。基线保持可见，只有在真正支持 hover 的设备上才隐藏并靠 hover/focus 唤出。
 * 不能直接写 opacity-0 + group-hover：触控设备没有 hover，那层会永远透明却仍在最上层
 * 接收点击（点封面/页脚会误触到看不见的按钮）；键盘用户 tab 进去也看不到焦点在哪。
 */
const HOVER_REVEAL =
  "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

/** 图像库的分类树 → 侧栏通用形状：把 imageCount / totalImageCount 对齐成通用字段名。 */
function toMediaCategoryNodes(categories: ImageCategory[]): MediaCategoryNode[] {
  return categories.map((category) => ({
    ...category,
    itemCount: category.imageCount,
    totalItemCount: category.totalImageCount,
    children: toMediaCategoryNodes(category.children ?? []),
  }));
}

export function ImageLibraryPage() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("作品库");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const { user } = useAuth();
  const userPermissions = user?.permissions ?? [];
  const canCreateCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_CREATE);
  const canEditCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_EDIT);
  const canDeleteCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_DELETE);
  const canUpload = hasPermission(userPermissions, PERMISSIONS.IMAGE_LIBRARY_UPLOAD);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeKey>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const normalizedSearchKeyword = searchKeyword.trim();

  useI18n(); // 订阅语言切换，下方 t() 文案随之重渲染
  const [items, setItems] = useState<GeneratedImage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // 中文长词严格搜不到时后端会放宽匹配，得让用户知道这批不是精确结果
  const [relaxedMatch, setRelaxedMatch] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);

  const [categories, setCategories] = useState<ImageCategory[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [assigningItem, setAssigningItem] = useState<GeneratedImage | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const [usage, setUsage] = useState<ImageUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);

  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
  /** 侧栏 / 归类弹窗用的通用分类树：作品数字段名与视频库对齐。 */
  const sidebarCategories = useMemo(() => toMediaCategoryNodes(categories), [categories]);
  const flatSidebarCategories = useMemo(() => flattenCategories(sidebarCategories), [sidebarCategories]);
  const categoryById = useMemo(
    () => new Map(flatCategories.map((category) => [category.id, category])),
    [flatCategories],
  );
  const activeCategory = categoryFilter ? categoryById.get(categoryFilter) ?? null : null;

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
          categoryId: categoryFilter,
          ...getDateRangeBounds(dateRange),
        });
        setTotal(response.total);
        setTotalPages(response.totalPages);
        setPage(response.page);
        setItems(response.items);
        setRelaxedMatch(Boolean(response.relaxed));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "图片列表加载失败");
      } finally {
        setGalleryLoading(false);
      }
    },
    [favoriteOnly, normalizedSearchKeyword, dateRange, categoryFilter],
  );

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const response = await apiListCategories();
      setCategories(response.items);
      setUncategorizedCount(response.uncategorizedCount);
      setTotalCount(response.totalCount);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类加载失败");
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // Debounce the free-text search box into the committed keyword.
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchKeyword(searchInput), searchInput ? 280 : 0);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  // Reload page 1 whenever a filter changes (keyword / date range / favorite / category).
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

  async function handleAssignCategory(item: GeneratedImage, categoryId: string | null) {
    try {
      const updated = await apiAssignImageCategory(item.id, categoryId);
      setItems((images) => {
        // 正在按分类筛选时，改归属后不再匹配的作品要从当前列表里移除。
        // 父分类的筛选含子孙，所以这里比对的是选中节点的整棵子树。
        if (categoryFilter) {
          const stillMatches =
            categoryFilter === UNCATEGORIZED_FILTER
              ? !updated.categoryId
              : Boolean(updated.categoryId) && subtreeIds(categoryById.get(categoryFilter)).includes(updated.categoryId!);
          if (!stillMatches) return images.filter((image) => image.id !== updated.id);
        }
        return images.map((image) =>
          image.id === updated.id ? { ...image, categoryId: updated.categoryId } : image,
        );
      });
      setAssigningItem(null);
      await loadCategories();
      toast.success(updated.categoryId ? "已更新分类" : "已移出分类");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类归属更新失败");
    }
  }

  async function handleCreateCategory(payload: CategoryFormPayload) {
    try {
      await apiCreateCategory({ name: payload.name, color: payload.color, parentId: payload.parentId });
      await loadCategories();
      toast.success("分类已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类保存失败");
      throw error;
    }
  }

  async function handleUpdateCategory(category: MediaCategoryNode, payload: CategoryFormPayload) {
    try {
      const movedParent = (category.parentId ?? null) !== payload.parentId;
      await apiUpdateCategory(category.id, {
        name: payload.name,
        color: payload.color,
        parentId: payload.parentId,
      });
      await loadCategories();
      // 移动分类会改变「父分类含子孙」的筛选集合：光刷新分类树的话，侧边栏计数变了、
      // 列表里却还留着已经移走的作品，直到用户手动改筛选才纠正。
      if (movedParent && categoryFilter) await loadGallery(page);
      toast.success("分类已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类保存失败");
      throw error;
    }
  }

  async function handleDeleteCategory(category: MediaCategoryNode) {
    try {
      const result = await apiDeleteCategory(category.id);
      const deletedIds = result.deletedCategoryIds ?? [category.id];
      if (categoryFilter && deletedIds.includes(categoryFilter)) setCategoryFilter("");
      setItems((images) =>
        images.map((image) =>
          image.categoryId && deletedIds.includes(image.categoryId) ? { ...image, categoryId: null } : image,
        ),
      );
      await loadCategories();
      toast.success(
        result.detachedImageCount > 0
          ? `已删除 ${result.deletedCategoryCount} 个分类，${result.detachedImageCount} 件作品转为未分类`
          : `已删除 ${result.deletedCategoryCount} 个分类`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类删除失败");
    }
  }

  const emptyTitle = favoriteOnly
    ? "还没有收藏的作品"
    : normalizedSearchKeyword
      ? "没有匹配的作品"
      : categoryFilter
        ? "该分类下还没有作品"
          : dateRange !== "all"
            ? "该时间段没有作品"
            : "还没有生成记录";

  const hasActiveFilters = Boolean(
    normalizedSearchKeyword || searchInput.trim() || favoriteOnly || categoryFilter || dateRange !== "all",
  );
  const usageSummary = usage?.summary ?? null;
  const usageSuccessRate = usageSummary?.upstreamCalls
    ? Math.round((usageSummary.successCalls / usageSummary.upstreamCalls) * 100)
    : 0;

  function clearGalleryFilters() {
    setSearchInput("");
    setSearchKeyword("");
    setDateRange("all");
    setFavoriteOnly(false);
    setCategoryFilter("");
  }

  const cardHandlers = {
    onPreview: setPreviewItem,
    onDownload: (target: GeneratedImage) => void downloadGeneratedImage(target),
    onEdit: setEditingItem,
    onAssign: setAssigningItem,
    onFavorite: (target: GeneratedImage) => void handleFavorite(target),
  };

  return (
    // 作品库页签下让页面吃满外壳高度、自身不滚动，把滚动条交给作品区域；
    // 用量监控是长内容，仍走页面的常规滚动。
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as LibraryTab)}
      className={cn(
        "horizon-theme hz-page flex min-w-0 flex-col !gap-4 px-3 py-3 sm:px-4 lg:px-5",
        isGalleryTab && "lg:h-full lg:min-h-0 lg:overflow-hidden",
      )}
    >
      <HorizonPageHeader
        Icon={Images}
        eyebrow="CREATIVE OPERATIONS · IMAGE LIBRARY"
        title="图像作品库"
        description="统一检索、归类和复用生成作品，并追踪模型调用质量与成本。"
        meta={
          <>
            <span>分类树与生成器自动同步</span>
            <span aria-hidden="true">·</span>
            <span>{activeTab === "作品库" ? "当前查看作品资产" : "当前查看当日上游用量"}</span>
          </>
        }
        actions={
          <>
            <TabsList aria-label="图像作品库视图" className="h-10 rounded-xl border border-slate-200 bg-slate-100 p-1">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="h-8 min-w-20 rounded-lg px-3 text-xs font-semibold text-slate-600 data-[state=active]:bg-[#002fa7] data-[state=active]:text-white"
                >
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
            {isGalleryTab && canUpload ? <MediaUploadButton kind="image" onClick={() => setUploadOpen(true)} /> : null}
            <Button asChild variant="outline">
              <Link to={routePath("page:ui-design", "/ui-design")}>
                <ArrowLeft className="size-4" />
                返回生成器
              </Link>
            </Button>
          </>
        }
      />

      <HorizonMetricGrid className="shrink-0">
        {isGalleryTab ? (
          <>
            <HorizonMetric Icon={Images} label="作品总量" value={totalCount.toLocaleString("zh-CN")} note="当前账号归档" tone="brand" />
            <HorizonMetric Icon={Search} label="当前结果" value={total.toLocaleString("zh-CN")} note={`第 ${page} / ${totalPages} 页`} />
            <HorizonMetric Icon={FolderTree} label="分类节点" value={flatCategories.length.toLocaleString("zh-CN")} note="支持父子分类联动" />
            <HorizonMetric Icon={FolderOpen} label="待归类" value={uncategorizedCount.toLocaleString("zh-CN")} note="尚未分配分类" tone={uncategorizedCount > 0 ? "warning" : "success"} />
          </>
        ) : (
          <>
            <HorizonMetric Icon={Activity} label="上游调用" value={usageSummary ? usageSummary.upstreamCalls.toLocaleString("zh-CN") : "—"} note="按 UTC 日统计" tone="brand" />
            <HorizonMetric Icon={CheckCircle2} label="成功率" value={usageSummary ? `${usageSuccessRate}%` : "—"} note={usageSummary ? `${usageSummary.successCalls} 次成功` : "等待用量数据"} tone={usageSummary && usageSummary.errorCalls > 0 ? "warning" : "success"} />
            <HorizonMetric Icon={RefreshCw} label="重试次数" value={usageSummary ? usageSummary.retryCalls.toLocaleString("zh-CN") : "—"} note={usageSummary ? `${usageSummary.errorCalls} 次失败` : "等待用量数据"} tone={usageSummary && usageSummary.retryCalls > 0 ? "warning" : "neutral"} />
            <HorizonMetric Icon={CircleDollarSign} label="预估费用" value={usageSummary ? formatUsd(usageSummary.estimatedCostUsd) : "—"} note={usage?.date ?? "当日累计"} />
          </>
        )}
      </HorizonMetricGrid>

      <TabsContent value="作品库" className="mt-0 min-h-0 data-[state=inactive]:hidden lg:flex-1">
        <section className="flex h-full flex-col gap-4 lg:min-h-0 lg:flex-row" aria-label="图像作品区">
          <MediaCategorySidebar
            categories={sidebarCategories}
            loading={categoriesLoading}
            selectedId={categoryFilter}
            onSelect={setCategoryFilter}
            totalCount={totalCount}
            uncategorizedCount={uncategorizedCount}
            canCreate={canCreateCategory}
            canEdit={canEditCategory}
            canDelete={canDeleteCategory}
            itemNoun="作品"
            allIcon={Images}
            onCreate={handleCreateCategory}
            onUpdate={handleUpdateCategory}
            onDelete={handleDeleteCategory}
            className="hz-surface"
          />

          {/* ── 内容区 ────────────────────────────────────────────────────── */}
          <div className="hz-surface flex min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
            <HorizonSectionHeader
              Icon={Images}
              title={activeCategory ? activeCategory.name : categoryFilter === UNCATEGORIZED_FILTER ? "未分类作品" : "作品浏览"}
              description={activeCategory ? `${activeCategory.path}，筛选范围包含其子分类。` : "通过提示词、时间与收藏状态快速定位可复用作品。"}
              trailing={
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 tabular-nums" aria-live="polite">
                    {total.toLocaleString("zh-CN")} 件
                  </span>
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="作品展示方式">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      aria-pressed={viewMode === "grid"}
                      aria-label="切换为网格视图"
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md transition-colors",
                        viewMode === "grid" ? "bg-white text-[#002fa7] shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      <LayoutGrid className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      aria-pressed={viewMode === "list"}
                      aria-label="切换为列表视图"
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md transition-colors",
                        viewMode === "list" ? "bg-white text-[#002fa7] shadow-sm" : "text-slate-500 hover:text-slate-700",
                      )}
                    >
                      <List className="size-4" />
                    </button>
                  </div>
                </div>
              }
            />

            <div className="hz-toolbar shrink-0 border-b border-slate-100 px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative w-full xl:max-w-sm">
                  <label htmlFor="image-library-search" className="sr-only">搜索作品提示词</label>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                  <input
                    id="image-library-search"
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="搜索提示词、模型或作品描述"
                    className="material-input h-10 w-full rounded-xl bg-white pl-9 pr-3 text-xs"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <fieldset className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                    <legend className="sr-only">生成时间范围</legend>
                    {DATE_RANGES.map((range) => {
                      const active = range.key === dateRange;
                      return (
                        <button
                          key={range.key}
                          type="button"
                          onClick={() => setDateRange(range.key)}
                          aria-pressed={active}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                            active ? "bg-[#002fa7] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
                          )}
                        >
                          {range.label}
                        </button>
                      );
                    })}
                  </fieldset>

                  <button
                    type="button"
                    onClick={() => setFavoriteOnly((value) => !value)}
                    aria-pressed={favoriteOnly}
                    className={cn(
                      "inline-flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors",
                      favoriteOnly
                        ? "border-[#002fa7] bg-[#002fa7] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-[#002fa7]",
                    )}
                  >
                    <Heart className={cn("size-4", favoriteOnly ? "fill-current" : "")} />
                    仅收藏
                  </button>

                  {hasActiveFilters ? (
                    <Button type="button" size="sm" variant="ghost" onClick={clearGalleryFilters}>清除筛选</Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => void loadGallery(page)}
                    disabled={galleryLoading}
                    aria-label="刷新作品列表"
                  >
                    <RefreshCw className={cn("size-4", galleryLoading ? "animate-spin motion-reduce:animate-none" : "")} />
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600" aria-live="polite">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {normalizedSearchKeyword ? (
                    <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">搜索“{normalizedSearchKeyword}”</span>
                  ) : null}
                  {relaxedMatch ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700" role="status">
                      {t("没有完全匹配的作品，以下是相近结果")}
                    </span>
                  ) : null}
                  {activeCategory || categoryFilter === UNCATEGORIZED_FILTER ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[#eef3ff] px-2 py-1 text-[11px] font-semibold text-[#002fa7]">
                      {activeCategory
                        ? `${activeCategory.path}${(activeCategory.children ?? []).length > 0 ? "（含子分类）" : ""}`
                        : "未分类"}
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("")}
                        aria-label="清除分类筛选"
                        className="text-blue-600 transition-colors hover:text-[#002581]"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums">第 {page} / {totalPages} 页</span>
              </div>
            </div>

            {/* 作品列表吃掉剩余高度并自带滚动条，分页条固定在底部。 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" aria-busy={galleryLoading}>
              {items.length > 0 ? (
                viewMode === "grid" ? (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-label="图像作品网格">
                    {items.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <ArtworkGridCard
                          item={item}
                          busy={favoriteBusyId === item.id}
                          category={item.categoryId ? categoryById.get(item.categoryId) ?? null : null}
                          {...cardHandlers}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="flex flex-col gap-2" aria-label="图像作品列表">
                    {items.map((item) => (
                      <li key={item.id}>
                        <ArtworkListRow
                          item={item}
                          busy={favoriteBusyId === item.id}
                          category={item.categoryId ? categoryById.get(item.categoryId) ?? null : null}
                          {...cardHandlers}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : galleryLoading ? (
                <div className="flex min-h-[40vh] items-center justify-center text-xs font-semibold text-slate-600" role="status" aria-live="polite">
                  <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
                  正在加载作品…
                </div>
              ) : (
                <HorizonEmptyState
                  Icon={Images}
                  title={emptyTitle}
                  description={
                    hasActiveFilters
                      ? "当前筛选条件下没有可展示的作品，清除筛选后可恢复全部资产。"
                      : "前往生成器创建第一张图像，生成结果会自动归档到这里。"
                  }
                  action={
                    hasActiveFilters ? (
                      <Button type="button" size="sm" variant="outline" onClick={clearGalleryFilters}>清除筛选</Button>
                    ) : (
                      <Button asChild size="sm">
                        <Link to={routePath("page:ui-design", "/ui-design")}>去生成图像</Link>
                      </Button>
                    )
                  }
                />
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 px-4 py-3">
              <Pager
                page={page}
                totalPages={totalPages}
                onChange={(target) => void loadGallery(target)}
                disabled={galleryLoading}
              />
            </div>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="用量监控" className="mt-0 data-[state=inactive]:hidden">
        <LibraryUsagePanel usage={usage} loading={usageLoading} onRefresh={() => void loadUsage()} />
      </TabsContent>

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

      {assigningItem ? (
        <AssignCategoryModal
          subtitle={assigningItem.revisedPrompt || assigningItem.prompt}
          currentId={assigningItem.categoryId ?? null}
          categories={flatSidebarCategories}
          onClose={() => setAssigningItem(null)}
          onSelect={(categoryId) => void handleAssignCategory(assigningItem, categoryId)}
        />
      ) : null}

      {uploadOpen ? (
        <MediaUploadDialog
          kind="image"
          categories={sidebarCategories}
          defaultCategoryId={categoryFilter && categoryFilter !== UNCATEGORIZED_FILTER ? categoryFilter : null}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            void loadCategories();
            void loadGallery(1);
          }}
          register={async ({ fileId, title, categoryId, probe }) => {
            await apiUploadImage({ fileId, title, categoryId, size: probe.size });
          }}
        />
      ) : null}
    </Tabs>
  );
}

function formatUsageDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
}

function shortenUsageModel(model: string) {
  if (!model) return "未知模型";
  return model.length > 28 ? `${model.slice(0, 25)}…` : model;
}

function LibraryUsagePanel({
  usage,
  loading,
  onRefresh,
}: {
  usage: ImageUsageResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [logPage, setLogPage] = useState(1);
  const summary = usage?.summary ?? null;
  const entries = usage?.entries ?? [];

  const operationData = useMemo(() => {
    if (!summary) return [] as Array<{ label: string; value: number; color: string }>;
    return [
      { label: "文生图", value: summary.generateCalls, color: "#002fa7" },
      { label: "图生图", value: summary.editCalls, color: "#0891b2" },
    ];
  }, [summary]);

  const modelData = useMemo(() => {
    const byModel = new Map<string, { model: string; calls: number; cost: number }>();
    for (const entry of entries) {
      const model = entry.model || "未知模型";
      const current = byModel.get(model) ?? { model, calls: 0, cost: 0 };
      current.calls += 1;
      current.cost += entry.estimatedCostUsd || 0;
      byModel.set(model, current);
    }
    return Array.from(byModel.values())
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls)
      .slice(0, 6);
  }, [entries]);

  const averageDuration = entries.length
    ? Math.round(entries.reduce((sum, entry) => sum + (entry.durationMs || 0), 0) / entries.length)
    : 0;
  const operationTotal = Math.max(1, operationData.reduce((sum, item) => sum + item.value, 0));
  const hasModelCost = modelData.some((item) => item.cost > 0);
  const maxModelMagnitude = Math.max(
    Number.EPSILON,
    ...modelData.map((item) => (hasModelCost ? item.cost : item.calls)),
  );
  const logTotalPages = Math.max(1, Math.ceil(entries.length / USAGE_LOG_PAGE_SIZE));
  const safeLogPage = Math.min(logPage, logTotalPages);
  const pagedEntries = entries.slice(
    (safeLogPage - 1) * USAGE_LOG_PAGE_SIZE,
    safeLogPage * USAGE_LOG_PAGE_SIZE,
  );

  return (
    <section className="hz-surface overflow-hidden" aria-label="图像用量监控">
      <HorizonSectionHeader
        Icon={Activity}
        title="模型调用与成本"
        description={usage ? `${usage.date} · ${usage.timezone} · 按 UTC 日汇总上游调用。` : "查看调用质量、模型分布和逐次请求明细。"}
        trailing={
          <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn("size-4", loading ? "animate-spin motion-reduce:animate-none" : "")} />
            {loading ? "刷新中" : "刷新用量"}
          </Button>
        }
      />

      {!usage || !summary ? (
        loading ? (
          <div className="flex min-h-64 items-center justify-center text-sm font-medium text-slate-600" role="status" aria-live="polite">
            <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
            正在加载用量数据…
          </div>
        ) : (
          <HorizonEmptyState
            Icon={Activity}
            title="暂无上游调用记录"
            description="生成或编辑图像后，这里会显示调用成功率、模型分布和预估费用。"
            action={<Button type="button" size="sm" variant="outline" onClick={onRefresh}>重新加载</Button>}
          />
        )
      ) : (
        <div className="space-y-4 p-3 sm:p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-100 bg-slate-50/70 p-4" aria-labelledby="image-operation-composition">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="image-operation-composition" className="text-sm font-semibold text-slate-800">调用构成</h3>
                  <p className="mt-1 text-xs text-pretty text-slate-600">文生图与图生图占比，以及本日平均上游耗时。</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 tabular-nums">
                  均耗时 {formatUsageDuration(averageDuration)}
                </span>
              </div>
              <div className="mt-5 space-y-4">
                {operationData.map((item) => {
                  const ratio = Math.round((item.value / operationTotal) * 100);
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-700">{item.label}</span>
                        <span className="text-slate-600 tabular-nums">{item.value.toLocaleString("zh-CN")} 次 · {ratio}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={`${item.label}调用占比`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}>
                        <div className="h-full rounded-full" style={{ width: `${ratio}%`, backgroundColor: item.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-100 bg-slate-50/70 p-4" aria-labelledby="image-model-distribution">
              <div>
                <h3 id="image-model-distribution" className="text-sm font-semibold text-slate-800">模型分布</h3>
                <p className="mt-1 text-xs text-pretty text-slate-600">按预估费用排序，费用为零时改用调用次数比较。</p>
              </div>
              {modelData.length > 0 ? (
                <ul className="mt-4 space-y-3" aria-label="图像模型调用分布">
                  {modelData.map((item) => {
                    const magnitude = hasModelCost ? item.cost : item.calls;
                    const ratio = Math.max(4, Math.round((magnitude / maxModelMagnitude) * 100));
                    return (
                      <li key={item.model}>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate font-semibold text-slate-700" title={item.model}>{shortenUsageModel(item.model)}</span>
                          <span className="shrink-0 text-slate-600 tabular-nums">{item.calls} 次 · {formatUsd(item.cost)}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                          <div className="h-full rounded-full bg-[#002fa7]" style={{ width: `${ratio}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <HorizonEmptyState Icon={Images} title="暂无模型分布" description="产生首条调用后会按模型汇总次数与费用。" action={<Button type="button" size="sm" variant="outline" onClick={onRefresh}>刷新数据</Button>} />
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white" aria-labelledby="image-usage-log-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h3 id="image-usage-log-heading" className="text-sm font-semibold text-slate-800">调用日志</h3>
                <p className="mt-1 text-xs text-slate-600">逐次核对操作类型、模型、状态、tokens、耗时与费用。</p>
              </div>
              <span className="text-xs text-slate-600 tabular-nums">共 {entries.length.toLocaleString("zh-CN")} 条</span>
            </div>

            {entries.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <caption className="sr-only">图像生成上游调用明细</caption>
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold">时间</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">操作</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">尺寸</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">模型</th>
                        <th scope="col" className="px-3 py-2.5 font-semibold">状态</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">输出 tokens</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold">耗时</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => {
                        const ok = entry.status === "success" || entry.status === "succeeded" || entry.status === "ok";
                        const failed = entry.status === "error" || entry.status === "failed";
                        return (
                          <tr key={entry.id} className="border-t border-slate-100 text-slate-700">
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600 tabular-nums">{formatTime(entry.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">{entry.operation === "edit" ? "图生图" : "文生图"}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{entry.normalizedSize || "—"}</td>
                            <td className="max-w-48 truncate px-3 py-2.5 text-slate-600" title={entry.model || "未知模型"}>{shortenUsageModel(entry.model || "未知模型")}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                  ok ? "bg-emerald-50 text-emerald-700" : failed ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600",
                                )}
                                title={entry.errorMessage || undefined}
                              >
                                {entry.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600 tabular-nums">{entry.outputTokens.toLocaleString("zh-CN")}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600 tabular-nums">{formatUsageDuration(entry.durationMs)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-slate-700 tabular-nums">{formatUsd(entry.estimatedCostUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {logTotalPages > 1 ? (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <Pager page={safeLogPage} totalPages={logTotalPages} onChange={setLogPage} disabled={loading} />
                  </div>
                ) : null}
              </>
            ) : (
              <HorizonEmptyState Icon={Activity} title="今日暂无调用明细" description="完成一次图像生成或编辑后，调用日志会在这里出现。" action={<Button type="button" size="sm" variant="outline" onClick={onRefresh}>刷新数据</Button>} />
            )}
          </section>
        </div>
      )}
    </section>
  );
}

// ── 作品卡片 / 列表行 ─────────────────────────────────────────────────────────

type ArtworkItemProps = {
  item: GeneratedImage;
  busy?: boolean;
  category?: ImageCategory | null;
  onPreview: (item: GeneratedImage) => void;
  onDownload: (item: GeneratedImage) => void;
  onEdit: (item: GeneratedImage) => void;
  onAssign: (item: GeneratedImage) => void;
  onFavorite: (item: GeneratedImage) => void;
};

function CategoryTag({ category, className }: { category?: ImageCategory | null; className?: string }) {
  if (!category) {
    return (
      <span className={cn("shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400", className)}>
        未分类
      </span>
    );
  }
  return (
    <span
      className={cn("max-w-[10rem] shrink-0 truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", className)}
      style={{ borderColor: `${category.color}40`, backgroundColor: `${category.color}14`, color: category.color }}
      // 徽标只显示末级名称，完整路径放 title，避免深层分类把卡片撑开
      title={category.path || category.name}
    >
      {category.name}
    </span>
  );
}

function ArtworkGridCard({ item, busy, category, onPreview, onDownload, onEdit, onAssign, onFavorite }: ArtworkItemProps) {
  const title = item.revisedPrompt || item.prompt;
  const src = item.thumbnailUrl || item.imageUrl || item.imageData;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-blue-200 hover:shadow-md">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-50">
        <img src={src} alt={item.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
          {item.size}
        </span>
        {item.isFavorite ? (
          <span className="absolute right-2 top-2 inline-flex items-center rounded-md bg-white/90 px-1.5 py-0.5 text-rose-500 shadow-sm ring-1 ring-rose-200/70 backdrop-blur">
            <Heart className="h-3 w-3 fill-current" />
          </span>
        ) : null}

        {/* 悬停浮出：预览 / 下载 —— 与知识库封面操作一致。
            触控设备上没有 hover，此时不铺深色遮罩，只把两枚圆钮常驻在图上；
            整层点击等于预览，所以点图片本身也能看大图。 */}
        <div
          onClick={() => onPreview(item)}
          className={cn(
            "absolute inset-0 flex cursor-pointer items-center justify-center gap-2 transition-opacity duration-200 [@media(hover:hover)]:bg-slate-900/35 [@media(hover:hover)]:backdrop-blur-[1px]",
            HOVER_REVEAL,
          )}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPreview(item);
            }}
            title="预览"
            aria-label={`预览作品：${title}`}
            className="flex size-9 items-center justify-center rounded-full bg-white/95 text-[#002fa7] shadow transition-colors hover:bg-white"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              // 不 stopPropagation 的话会冒泡到整层的"点击预览"，下载完还顺手弹个大图
              event.stopPropagation();
              onDownload(item);
            }}
            title="下载"
            aria-label={`下载作品：${title}`}
            className="flex size-9 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow transition-colors hover:bg-white hover:text-[#002fa7]"
          >
            <ArrowDownToLine className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <button
          type="button"
          onClick={() => onPreview(item)}
          title={title}
          className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 transition-colors group-hover:text-[#002fa7]"
        >
          {title}
        </button>
        <p className="truncate text-xs leading-relaxed text-slate-500">
          {item.model} · {formatTime(item.createdAt)}
        </p>

        {/* Footer：分类 + 成本 + 管理操作同排常驻。
            之前是一层 opacity-0 的绝对定位遮罩盖住整个页脚，触控设备上看不见却照样吃点击，
            点一下就会静默改收藏或弹出编辑弹窗；这里改成常驻按钮，静置时压暗、悬停复原。 */}
        <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-2">
          <CategoryTag category={category} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold tabular-nums text-slate-500">
            {formatImageCost(item)}
          </span>

          <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button type="button" onClick={() => onEdit(item)} title="修改" aria-label={`修改作品：${title}`} className={ICON_BTN}>
              <PencilLine className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onAssign(item)} title="设置分类" aria-label={`设置作品分类：${title}`} className={ICON_BTN}>
              <FolderTree className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onFavorite(item)}
              disabled={busy}
              title={item.isFavorite ? "取消收藏" : "收藏"}
              aria-label={`${item.isFavorite ? "取消收藏" : "收藏"}作品：${title}`}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                item.isFavorite ? "text-rose-500 hover:bg-rose-50" : "text-slate-500 hover:bg-rose-50 hover:text-rose-600",
              )}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-current" : "")} />
              )}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ArtworkListRow({ item, busy, category, onPreview, onDownload, onEdit, onAssign, onFavorite }: ArtworkItemProps) {
  const title = item.revisedPrompt || item.prompt;
  const src = item.thumbnailUrl || item.imageUrl || item.imageData;

  return (
    <article className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-blue-200 hover:shadow-md">
      <button
        type="button"
        onClick={() => onPreview(item)}
        title="预览"
        aria-label={`预览作品：${title}`}
        className="h-11 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200/80 bg-slate-50"
      >
        <img src={src} alt={item.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </button>

      <span className="hidden shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200/70 sm:inline-flex">
        {item.size}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onPreview(item)}
          title={title}
          className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 transition-colors hover:text-[#002fa7]"
        >
          {title}
        </button>
        <p className="truncate text-xs text-slate-500">
          {item.model} · {formatTime(item.createdAt)}
        </p>
      </div>

      <CategoryTag category={category} className="hidden lg:inline-flex" />

      <span className="hidden shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-500 md:block">
        {formatImageCost(item)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" onClick={() => onPreview(item)} title="预览" aria-label={`预览作品：${title}`} className={ICON_BTN}>
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onDownload(item)} title="下载" aria-label={`下载作品：${title}`} className={ICON_BTN}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </button>
        <span className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" onClick={() => onEdit(item)} title="修改" aria-label={`修改作品：${title}`} className={ICON_BTN}>
            <PencilLine className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onAssign(item)} title="设置分类" aria-label={`设置作品分类：${title}`} className={ICON_BTN}>
            <FolderTree className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onFavorite(item)}
            disabled={busy}
            title={item.isFavorite ? "取消收藏" : "收藏"}
            aria-label={`${item.isFavorite ? "取消收藏" : "收藏"}作品：${title}`}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              item.isFavorite ? "text-rose-500 hover:bg-rose-50" : "text-slate-500 hover:bg-rose-50 hover:text-rose-600",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-current" : "")} />
            )}
          </button>
        </span>
      </div>
    </article>
  );
}
