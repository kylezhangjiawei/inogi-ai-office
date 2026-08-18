import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronRight,
  Edit3,
  Eye,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Heart,
  Images,
  LayoutGrid,
  List,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { useAuth } from "./auth";
import { DEFAULT_IMAGE_MODEL_OPTION } from "./lib/aiModelOptions";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
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
  apiUsage,
  downloadGeneratedImage,
  flattenCategoryTree,
  formatImageCost,
  formatTime,
  getDateRangeBounds,
  glassCard,
  ImageEditModal,
  ImagePreviewModal,
  ImageUsagePanel,
  MAX_CATEGORY_DEPTH,
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
const DEFAULT_CATEGORY_COLOR = "#3b82f6";
const CATEGORY_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#6366f1", "#0ea5e9", "#64748b"];

/** 侧边栏选中态：与研发知识库同款主色块 */
const SELECTED_ROW = "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.16)]";
const UNSELECTED_ROW = "text-slate-600 hover:bg-slate-50";
const SURFACE_CARD = "rounded-lg border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const ICON_BTN = "flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700";
/**
 * 悬停浮出层。基线保持可见，只有在真正支持 hover 的设备上才隐藏并靠 hover/focus 唤出。
 * 不能直接写 opacity-0 + group-hover：触控设备没有 hover，那层会永远透明却仍在最上层
 * 接收点击（点封面/页脚会误触到看不见的按钮）；键盘用户 tab 进去也看不到焦点在哪。
 */
const HOVER_REVEAL =
  "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

type CategoryDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: ImageCategory };

/** 节点自己 + 所有子孙的 id：判断作品改归属后是否还落在当前筛选下。 */
function subtreeIds(category?: ImageCategory | null): string[] {
  if (!category) return [];
  return flattenCategoryTree([category]).map((item) => item.id);
}

/** 子树自身高度（叶子 = 1），用于判断移动后会不会超层。 */
function subtreeHeight(category: ImageCategory): number {
  const children = category.children ?? [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map(subtreeHeight));
}

export function ImageLibraryPage() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("作品库");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const { user } = useAuth();
  const userPermissions = user?.permissions ?? [];
  const canCreateCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_CREATE);
  const canEditCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_EDIT);
  const canDeleteCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_DELETE);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeKey>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const normalizedSearchKeyword = searchKeyword.trim();

  const [items, setItems] = useState<GeneratedImage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);

  const [categories, setCategories] = useState<ImageCategory[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  // 默认全展开，只记录被主动折叠的节点：分类树刷新后不用重新播种展开状态
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [assigningItem, setAssigningItem] = useState<GeneratedImage | null>(null);

  const [usage, setUsage] = useState<ImageUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);

  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories]);
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

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  async function handleSubmitCategory(payload: { name: string; color: string; parentId: string | null }) {
    if (!categoryDialog) return;
    setCategorySaving(true);
    try {
      let movedParent = false;
      if (categoryDialog.mode === "create") {
        await apiCreateCategory({ name: payload.name, color: payload.color, parentId: payload.parentId });
        toast.success("分类已创建");
      } else {
        movedParent = (categoryDialog.category.parentId ?? null) !== payload.parentId;
        await apiUpdateCategory(categoryDialog.category.id, {
          name: payload.name,
          color: payload.color,
          parentId: payload.parentId,
        });
        toast.success("分类已更新");
      }
      setCategoryDialog(null);
      await loadCategories();
      // 移动分类会改变「父分类含子孙」的筛选集合：光刷新分类树的话，侧边栏计数变了、
      // 列表里却还留着已经移走的作品，直到用户手动改筛选才纠正。
      if (movedParent && categoryFilter) await loadGallery(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类保存失败");
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleDeleteCategory(category: ImageCategory) {
    const subtree = flattenCategoryTree([category]);
    const childCount = subtree.length - 1;
    const imageCount = subtree.reduce((sum, node) => sum + node.imageCount, 0);
    const detail = [
      childCount > 0 ? `连同 ${childCount} 个子分类` : "",
      imageCount > 0 ? `${imageCount} 件作品将转为未分类` : "",
    ]
      .filter(Boolean)
      .join("，");
    if (!window.confirm(`确定删除分类「${category.name}」？${detail ? `${detail}。` : ""}作品本身不会被删除。`)) {
      return;
    }

    setCategoryBusyId(category.id);
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
    } finally {
      setCategoryBusyId(null);
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

  const cardHandlers = {
    onPreview: setPreviewItem,
    onDownload: (target: GeneratedImage) => void downloadGeneratedImage(target),
    onEdit: setEditingItem,
    onAssign: setAssigningItem,
    onFavorite: (target: GeneratedImage) => void handleFavorite(target),
  };

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
          to={routePath("page:ui-design", "/ui-design")}
          className="inline-flex h-9 w-fit shrink-0 cursor-pointer items-center gap-1.5 rounded-[12px] border border-border bg-surface-container-low px-3.5 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <ArrowLeft className="h-4 w-4" />
          返回生成器
        </Link>
      </div>

      {isGalleryTab ? (
        <section className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* ── 分类侧边栏（同研发知识库：白卡片 + 行内悬停操作 + 子级左边线缩进）── */}
          <aside className={cn("flex w-full flex-col gap-1 p-2.5 lg:w-72 lg:shrink-0", SURFACE_CARD)}>
            <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] font-semibold uppercase text-slate-400">
              <span>分类</span>
              {canCreateCategory ? (
                <button
                  type="button"
                  onClick={() => setCategoryDialog({ mode: "create", parentId: null })}
                  title="新增一级分类"
                  aria-label="新增一级分类"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setCategoryFilter("")}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                categoryFilter === "" ? SELECTED_ROW : UNSELECTED_ROW,
              )}
            >
              <span className="flex items-center gap-2">
                <Images className="h-4 w-4" />
                全部
              </span>
              <span className="text-[11px] tabular-nums opacity-70">{totalCount}</span>
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                categoryFilter === UNCATEGORIZED_FILTER ? SELECTED_ROW : UNSELECTED_ROW,
              )}
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                未分类
              </span>
              <span className="text-[11px] tabular-nums opacity-70">{uncategorizedCount}</span>
            </button>

            {categories.map((category) => (
              <CategoryTreeNode
                key={category.id}
                category={category}
                selectedId={categoryFilter}
                collapsedIds={collapsedIds}
                busyId={categoryBusyId}
                canCreate={canCreateCategory}
                canEdit={canEditCategory}
                canDelete={canDeleteCategory}
                onSelect={setCategoryFilter}
                onToggle={toggleCollapsed}
                onCreateChild={(parentId) => setCategoryDialog({ mode: "create", parentId })}
                onEdit={(target) => setCategoryDialog({ mode: "edit", category: target })}
                onDelete={(target) => void handleDeleteCategory(target)}
              />
            ))}

            {categories.length === 0 ? (
              <p className="px-3 py-3 text-xs leading-5 text-slate-400">
                {categoriesLoading
                  ? "分类加载中…"
                  : canCreateCategory
                    ? "还没有分类，点右上角 + 新建。"
                    : "还没有分类。"}
              </p>
            ) : null}
          </aside>

          {/* ── 内容区 ────────────────────────────────────────────────────── */}
          <div className="min-w-0 flex-1 space-y-4">
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

                  {/* 网格 / 列表 视图切换 */}
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      aria-pressed={viewMode === "grid"}
                      title="网格视图"
                      className={cn(
                        "flex h-8 w-9 cursor-pointer items-center justify-center rounded-md transition",
                        viewMode === "grid" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600",
                      )}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      aria-pressed={viewMode === "list"}
                      title="列表视图"
                      className={cn(
                        "flex h-8 w-9 cursor-pointer items-center justify-center rounded-md transition",
                        viewMode === "list" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600",
                      )}
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>

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

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                    共 <span className="tabular-nums">{total.toLocaleString("zh-CN")}</span> 件
                  </span>
                  {normalizedSearchKeyword ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      搜索“{normalizedSearchKeyword}”
                    </span>
                  ) : null}
                  {activeCategory || categoryFilter === UNCATEGORIZED_FILTER ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-600">
                      {activeCategory
                        ? `${activeCategory.path}${(activeCategory.children ?? []).length > 0 ? "（含子分类）" : ""}`
                        : "未分类"}
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("")}
                        aria-label="清除分类筛选"
                        className="cursor-pointer text-indigo-400 transition hover:text-indigo-700 focus-visible:outline-none"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </span>
                {totalPages > 1 ? <span>第 {page} / {totalPages} 页</span> : null}
              </div>
            </div>

            {items.length > 0 ? (
              <>
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => (
                      <ArtworkGridCard
                        key={item.id}
                        item={item}
                        busy={favoriteBusyId === item.id}
                        category={item.categoryId ? categoryById.get(item.categoryId) ?? null : null}
                        {...cardHandlers}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <ArtworkListRow
                        key={item.id}
                        item={item}
                        busy={favoriteBusyId === item.id}
                        category={item.categoryId ? categoryById.get(item.categoryId) ?? null : null}
                        {...cardHandlers}
                      />
                    ))}
                  </div>
                )}
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
              <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-6 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary-container text-on-primary-container">
                  <Images className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-sm font-semibold text-slate-950">{emptyTitle}</h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                  {favoriteOnly
                    ? "在生成器或这里把喜欢的作品加入收藏，方便后续复用。"
                    : categoryFilter
                      ? "把鼠标移到作品上，点「分类」即可把作品归到这个分类下。"
                      : "前往生成器创建你的第一张图像，作品会自动归档到这里。"}
                </p>
                <Link
                  to={routePath("page:ui-design", "/ui-design")}
                  className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-primary px-5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25"
                >
                  去生成图像
                </Link>
              </div>
            )}
          </div>
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

      {assigningItem ? (
        <AssignCategoryModal
          item={assigningItem}
          categories={flatCategories}
          onClose={() => setAssigningItem(null)}
          onSelect={(categoryId) => void handleAssignCategory(assigningItem, categoryId)}
        />
      ) : null}

      {categoryDialog ? (
        <CategoryFormDialog
          state={categoryDialog}
          categories={flatCategories}
          saving={categorySaving}
          onSubmit={(payload) => void handleSubmitCategory(payload)}
          onClose={() => setCategoryDialog(null)}
        />
      ) : null}
    </div>
  );
}

// ── 分类树节点 ────────────────────────────────────────────────────────────────

function CategoryTreeNode({
  category,
  selectedId,
  collapsedIds,
  busyId,
  canCreate,
  canEdit,
  canDelete,
  onSelect,
  onToggle,
  onCreateChild,
  onEdit,
  onDelete,
}: {
  category: ImageCategory;
  selectedId: string;
  collapsedIds: Set<string>;
  busyId: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onEdit: (category: ImageCategory) => void;
  onDelete: (category: ImageCategory) => void;
}) {
  const children = category.children ?? [];
  const hasChildren = children.length > 0;
  const expanded = !collapsedIds.has(category.id);
  const selected = selectedId === category.id;
  const busy = busyId === category.id;
  const canAddChild = canCreate && category.depth < MAX_CATEGORY_DEPTH;
  const hasActions = canAddChild || canEdit || canDelete;

  const actionClass = cn(
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
    selected ? "text-white/80 hover:bg-white/15 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
  );

  return (
    <div className="group/category w-full">
      <div className={cn("flex items-center rounded-md transition-colors duration-200", selected ? SELECTED_ROW : UNSELECTED_ROW)}>
        <button
          type="button"
          onClick={() => {
            onSelect(category.id);
            if (hasChildren) onToggle(category.id);
          }}
          title={category.path}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 py-2 pl-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            hasActions ? "rounded-l-md pr-1" : "rounded-md pr-3",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderTree
              className="h-4 w-4 shrink-0"
              style={selected ? undefined : { color: category.color || undefined }}
            />
            <span className="truncate">{category.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[11px] tabular-nums opacity-70">{category.totalImageCount}</span>
            <span className="flex h-4 w-3.5 items-center justify-center">
              {hasChildren ? (
                <ChevronRight className={cn("h-3.5 w-3.5 opacity-45 transition-transform", expanded && "rotate-90")} />
              ) : null}
            </span>
          </span>
        </button>

        {hasActions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 pr-1 transition-opacity",
              !selected && "lg:opacity-55 lg:group-hover/category:opacity-100",
            )}
          >
            {canAddChild ? (
              <button
                type="button"
                onClick={() => onCreateChild(category.id)}
                title="新增子分类"
                aria-label={`在 ${category.name} 下新增子分类`}
                className={actionClass}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => onEdit(category)}
                title="编辑分类"
                aria-label={`编辑分类 ${category.name}`}
                className={actionClass}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => onDelete(category)}
                disabled={busy}
                title="删除分类"
                aria-label={`删除分类 ${category.name}`}
                className={cn(actionClass, selected ? "hover:text-white" : "hover:bg-red-50 hover:text-red-600", "disabled:cursor-not-allowed disabled:opacity-40")}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasChildren && expanded ? (
        <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
          {children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              category={child}
              selectedId={selectedId}
              collapsedIds={collapsedIds}
              busyId={busyId}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
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
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_14px_30px_-12px_rgba(79,70,229,0.28)]">
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
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/95 text-indigo-700 shadow transition hover:bg-white"
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
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/95 text-slate-700 shadow transition hover:bg-white hover:text-indigo-700"
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
          className="block max-w-full cursor-pointer truncate text-left text-sm font-semibold text-slate-900 transition-colors group-hover:text-indigo-600"
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
            <button type="button" onClick={() => onEdit(item)} title="修改" className={ICON_BTN}>
              <PencilLine className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onAssign(item)} title="设置分类" className={ICON_BTN}>
              <FolderTree className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onFavorite(item)}
              disabled={busy}
              title={item.isFavorite ? "取消收藏" : "收藏"}
              className={cn(
                "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-60",
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
    </div>
  );
}

function ArtworkListRow({ item, busy, category, onPreview, onDownload, onEdit, onAssign, onFavorite }: ArtworkItemProps) {
  const title = item.revisedPrompt || item.prompt;
  const src = item.thumbnailUrl || item.imageUrl || item.imageData;

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-indigo-200 hover:shadow-[0_8px_18px_-10px_rgba(79,70,229,0.25)]">
      <button
        type="button"
        onClick={() => onPreview(item)}
        title="预览"
        className="h-11 w-14 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-200/80 bg-slate-50"
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
          className="block max-w-full cursor-pointer truncate text-left text-sm font-semibold text-slate-900 transition hover:text-indigo-600"
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
        <button type="button" onClick={() => onPreview(item)} title="预览" className={ICON_BTN}>
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onDownload(item)} title="下载" className={ICON_BTN}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </button>
        <span className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" onClick={() => onEdit(item)} title="修改" className={ICON_BTN}>
            <PencilLine className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onAssign(item)} title="设置分类" className={ICON_BTN}>
            <FolderTree className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onFavorite(item)}
            disabled={busy}
            title={item.isFavorite ? "取消收藏" : "收藏"}
            className={cn(
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-60",
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
    </div>
  );
}

// ── 弹窗 ──────────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  description,
  onClose,
  children,
  widthClass = "max-w-md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn("flex max-h-[82vh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.32)]", widthClass)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-[11px] text-slate-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssignCategoryModal({
  item,
  categories,
  onClose,
  onSelect,
}: {
  item: GeneratedImage;
  /** 已按前序平铺的分类，depth 决定缩进 */
  categories: ImageCategory[];
  onClose: () => void;
  onSelect: (categoryId: string | null) => void;
}) {
  const currentId = item.categoryId ?? null;
  const rowClass = (active: boolean) =>
    cn(
      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
      active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200/70 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50",
    );

  return (
    <ModalShell title="设置分类" onClose={onClose}>
      <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
        <p className="line-clamp-2 pb-2 text-xs leading-5 text-slate-500">{item.revisedPrompt || item.prompt}</p>

        <button type="button" onClick={() => onSelect(null)} className={rowClass(currentId === null)}>
          <span className="flex items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5" />
            未分类
          </span>
          {currentId === null ? <Check className="h-4 w-4" /> : null}
        </button>

        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            title={category.path}
            // 缩进走 padding：按钮是 w-full，用 margin 会把行推出容器右边缘
            style={{ paddingLeft: `${0.75 + (category.depth - 1) * 0.875}rem` }}
            className={rowClass(currentId === category.id)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderTree className="h-3.5 w-3.5 shrink-0" style={{ color: category.color || undefined }} />
              <span className="truncate">{category.name}</span>
            </span>
            {currentId === category.id ? <Check className="h-4 w-4 shrink-0" /> : null}
          </button>
        ))}

        {categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">还没有分类，请先在左侧新建。</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

function CategoryFormDialog({
  state,
  categories,
  saving,
  onSubmit,
  onClose,
}: {
  state: CategoryDialogState;
  /** 已按前序平铺的分类 */
  categories: ImageCategory[];
  saving: boolean;
  onSubmit: (payload: { name: string; color: string; parentId: string | null }) => void;
  onClose: () => void;
}) {
  const isEdit = state.mode === "edit";
  const [name, setName] = useState(isEdit ? state.category.name : "");
  const [color, setColor] = useState(isEdit ? state.category.color || DEFAULT_CATEGORY_COLOR : DEFAULT_CATEGORY_COLOR);
  const [parentId, setParentId] = useState(
    isEdit ? state.category.parentId ?? "" : state.parentId ?? "",
  );

  const parentCategory = categories.find((item) => item.id === (isEdit ? state.category.parentId : state.parentId));

  /** 移动目标：排除自己和自己的子孙，并保证移动后整棵子树不超过层数上限。 */
  const parentOptions = useMemo(() => {
    if (!isEdit) return [];
    const blocked = new Set(subtreeIds(state.category));
    const height = subtreeHeight(state.category);
    return categories.filter((option) => !blocked.has(option.id) && option.depth + height <= MAX_CATEGORY_DEPTH);
  }, [categories, isEdit, state]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("请输入分类名称");
      return;
    }
    onSubmit({ name: trimmed, color, parentId: parentId || null });
  }

  return (
    <ModalShell
      title={isEdit ? "编辑分类" : parentCategory ? `在「${parentCategory.name}」下新增子分类` : "新增一级分类"}
      description={`分类最多 ${MAX_CATEGORY_DEPTH} 层，同级不能重名`}
      onClose={onClose}
    >
      <div className="space-y-4 px-5 py-4">
        <div className="space-y-1.5">
          <label htmlFor="image-category-name" className="text-xs font-semibold text-slate-600">
            分类名称 <span className="text-red-500">*</span>
          </label>
          <input
            id="image-category-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            maxLength={40}
            placeholder="如：产品图"
            className="material-input h-10 w-full rounded-md px-3 text-xs"
          />
        </div>

        {isEdit ? (
          <div className="space-y-1.5">
            <label htmlFor="image-category-parent" className="text-xs font-semibold text-slate-600">
              父分类
            </label>
            <select
              id="image-category-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="material-input h-10 w-full rounded-md px-2 text-xs"
            >
              <option value="">根分类</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-600">颜色</span>
          <div className="flex items-center gap-1.5">
            {CATEGORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color === option}
                className={cn(
                  "h-6 w-6 cursor-pointer rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                  color === option ? "border-slate-900" : "border-transparent hover:border-slate-300",
                )}
                style={{ backgroundColor: option }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          保存
        </button>
      </div>
    </ModalShell>
  );
}
