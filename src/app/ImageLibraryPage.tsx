import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderTree,
  Heart,
  Images,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { useAuth } from "./auth";
import { DEFAULT_IMAGE_MODEL_OPTION } from "./lib/aiModelOptions";
import { hasAnyPermission, hasPermission, PERMISSIONS } from "./lib/permissions";
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
  ArtworkCard,
  downloadGeneratedImage,
  flattenCategoryTree,
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

const TABS: LibraryTab[] = ["作品库", "用量监控"];
const DATE_RANGES: Array<{ key: DateRangeKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "7d", label: "近7天" },
  { key: "30d", label: "近30天" },
];
const PAGE_SIZE = 18;
const DEFAULT_CATEGORY_COLOR = "#3b82f6";
const CATEGORY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9", "#64748b"];
/** 每深一层的缩进量（rem），侧边树与弹窗共用，保证视觉层级一致。 */
const INDENT_REM = 0.875;

/** 按折叠状态把树展开成可见行；折叠节点的子孙不出现在结果里。 */
function visibleCategoryRows(categories: ImageCategory[], collapsedIds: Set<string>): ImageCategory[] {
  const rows: ImageCategory[] = [];
  const walk = (nodes: ImageCategory[]) => {
    for (const node of nodes) {
      rows.push(node);
      if (!collapsedIds.has(node.id)) walk(node.children ?? []);
    }
  };
  walk(categories);
  return rows;
}

export function ImageLibraryPage() {
  const [activeTab, setActiveTab] = useState<LibraryTab>("作品库");

  const { user } = useAuth();
  const userPermissions = user?.permissions ?? [];
  const canCreateCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_CREATE);
  const canEditCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_EDIT);
  const canDeleteCategory = hasPermission(userPermissions, PERMISSIONS.IMAGE_CATEGORY_DELETE);
  const canManageCategory = hasAnyPermission(userPermissions, [
    PERMISSIONS.IMAGE_CATEGORY_CREATE,
    PERMISSIONS.IMAGE_CATEGORY_EDIT,
    PERMISSIONS.IMAGE_CATEGORY_DELETE,
  ]);

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
  const [managerOpen, setManagerOpen] = useState(false);
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
  const visibleRows = useMemo(() => visibleCategoryRows(categories, collapsedIds), [categories, collapsedIds]);
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
      return response.items;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类加载失败");
      return null;
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

  /** 分类（及其子分类）被删除后：清掉失效的筛选、把列表里这些分类的作品标回未分类。 */
  function handleCategoryDeleted(deletedIds: string[]) {
    if (categoryFilter && deletedIds.includes(categoryFilter)) setCategoryFilter("");
    setItems((images) =>
      images.map((image) =>
        image.categoryId && deletedIds.includes(image.categoryId) ? { ...image, categoryId: null } : image,
      ),
    );
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
          <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:w-60">
            <div className={cn("rounded-[16px] px-3 py-3", glassCard)}>
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <FolderTree className="h-3.5 w-3.5" />
                  分类
                </span>
                {canManageCategory ? (
                  <button
                    type="button"
                    onClick={() => setManagerOpen(true)}
                    aria-label="管理分类"
                    title="管理分类"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[8px] text-slate-400 transition hover:bg-surface-container-low hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {/* 应用外壳固定 min-w-[1024px]，窄视口是整体横向平移而非重排，
                  所以分类树始终展示，不做视口断点级的折叠 */}
              <div className="space-y-0.5">
                <CategoryTreeRow
                  label="全部"
                  count={totalCount}
                  active={categoryFilter === ""}
                  onSelect={() => setCategoryFilter("")}
                />
                <CategoryTreeRow
                  label="未分类"
                  count={uncategorizedCount}
                  active={categoryFilter === UNCATEGORIZED_FILTER}
                  onSelect={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
                />

                {visibleRows.map((category) => {
                  const hasChildren = (category.children ?? []).length > 0;
                  return (
                    <CategoryTreeRow
                      key={category.id}
                      label={category.name}
                      title={category.path}
                      count={category.totalImageCount}
                      color={category.color}
                      depth={category.depth}
                      hasChildren={hasChildren}
                      collapsed={collapsedIds.has(category.id)}
                      onToggle={() => toggleCollapsed(category.id)}
                      active={categoryFilter === category.id}
                      onSelect={() => setCategoryFilter(category.id)}
                    />
                  );
                })}

                {categories.length === 0 ? (
                  <p className="px-2 py-3 text-xs leading-5 text-slate-400">
                    {categoriesLoading
                      ? "分类加载中…"
                      : canCreateCategory
                        ? "还没有分类，点右上角齿轮新建。"
                        : "还没有分类。"}
                  </p>
                ) : null}
              </div>
            </div>
          </aside>

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
                  <span>
                    共 {total.toLocaleString("zh-CN")} 件
                    {normalizedSearchKeyword ? `（搜索“${normalizedSearchKeyword}”）` : ""}
                  </span>
                  {activeCategory ? (
                    <span className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-surface-container-low px-2 py-0.5 font-semibold text-slate-600">
                      {activeCategory.path}
                      {(activeCategory.children ?? []).length > 0 ? "（含子分类）" : ""}
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("")}
                        aria-label="清除分类筛选"
                        className="cursor-pointer text-slate-400 transition hover:text-slate-700 focus-visible:outline-none"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                  {categoryFilter === UNCATEGORIZED_FILTER ? (
                    <span className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-surface-container-low px-2 py-0.5 font-semibold text-slate-600">
                      未分类
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("")}
                        aria-label="清除分类筛选"
                        className="cursor-pointer text-slate-400 transition hover:text-slate-700 focus-visible:outline-none"
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
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {items.map((item, index) => (
                    <ArtworkCard
                      key={item.id}
                      item={item}
                      index={index}
                      busy={favoriteBusyId === item.id}
                      category={item.categoryId ? categoryById.get(item.categoryId) ?? null : null}
                      onPreview={setPreviewItem}
                      onDownload={(target) => void downloadGeneratedImage(target)}
                      onEdit={setEditingItem}
                      onFavorite={(target) => void handleFavorite(target)}
                      onAssignCategory={setAssigningItem}
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
                    : categoryFilter
                      ? "在作品卡片上点「分类」即可把作品归到这个分类下。"
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

      {managerOpen ? (
        <CategoryManagerModal
          categories={flatCategories}
          canCreate={canCreateCategory}
          canEdit={canEditCategory}
          canDelete={canDeleteCategory}
          onClose={() => setManagerOpen(false)}
          onChanged={() => void loadCategories()}
          onDeleted={handleCategoryDeleted}
        />
      ) : null}
    </div>
  );
}

/** 节点自己 + 所有子孙的 id（前端侧的同口径实现，用于判断作品是否还落在当前筛选下）。 */
function subtreeIds(category?: ImageCategory | null): string[] {
  if (!category) return [];
  return flattenCategoryTree([category]).map((item) => item.id);
}

/** 子树自身的高度（叶子 = 1），用于判断移动后会不会超层。 */
function subtreeHeight(category: ImageCategory): number {
  const children = category.children ?? [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map(subtreeHeight));
}

function CategoryTreeRow({
  label,
  title,
  count,
  color,
  depth = 1,
  hasChildren = false,
  collapsed = false,
  active,
  onToggle,
  onSelect,
}: {
  label: string;
  title?: string;
  count: number;
  color?: string;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  active: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5" style={{ paddingLeft: `${(depth - 1) * INDENT_REM}rem` }}>
      {hasChildren && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? `展开 ${label}` : `折叠 ${label}`}
          aria-expanded={!collapsed}
          className="flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-slate-400 transition hover:bg-surface-container-low hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="h-6 w-5 shrink-0" />
      )}

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        title={title || label}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          active ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:bg-surface-container-low",
        )}
      >
        {color ? (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", active ? "ring-1 ring-white/70" : "")}
            style={{ backgroundColor: color }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cn("shrink-0 tabular-nums", active ? "text-primary-foreground/75" : "text-slate-400")}>
          {count}
        </span>
      </button>
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[16px] border border-border bg-surface-container-lowest shadow-[0_28px_80px_rgba(15,23,42,0.32)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-950">设置分类</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] text-slate-400 transition hover:bg-surface-container-low hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
          <p className="line-clamp-2 pb-2 text-xs leading-5 text-slate-500">{item.revisedPrompt || item.prompt}</p>

          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border px-3 py-2.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              currentId === null
                ? "border-primary/40 bg-primary-container text-on-primary-container"
                : "border-border bg-surface-container-lowest text-slate-600 hover:border-primary/30",
            )}
          >
            <span>未分类</span>
            {currentId === null ? <Check className="h-4 w-4" /> : null}
          </button>

          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelect(category.id)}
              title={category.path}
              // 缩进走 padding：按钮是 w-full，用 margin 会把行推出容器右边缘
              style={{ paddingLeft: `${0.75 + (category.depth - 1) * INDENT_REM}rem` }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border px-3 py-2.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                currentId === category.id
                  ? "border-primary/40 bg-primary-container text-on-primary-container"
                  : "border-border bg-surface-container-lowest text-slate-600 hover:border-primary/30",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {category.depth > 1 ? <CornerDownRight className="h-3 w-3 shrink-0 text-slate-300" /> : null}
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                <span className="truncate">{category.name}</span>
              </span>
              {currentId === category.id ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          ))}

          {categories.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">还没有分类，请先联系管理员创建。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CategoryManagerModal({
  categories,
  canCreate,
  canEdit,
  canDelete,
  onClose,
  onChanged,
  onDeleted,
}: {
  /** 已按前序平铺的分类，depth 决定缩进 */
  categories: ImageCategory[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  // 新建草稿：parentId 决定这行输入框渲染在顶部（根分类）还是某个节点下面
  const [draft, setDraft] = useState<{ parentId: string | null; name: string; color: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_CATEGORY_COLOR);
  const [editParentId, setEditParentId] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  async function handleCreate() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("请输入分类名称");
      return;
    }
    setCreating(true);
    try {
      await apiCreateCategory({ name, parentId: draft.parentId, color: draft.color });
      setDraft(null);
      onChanged();
      toast.success("分类已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(category: ImageCategory) {
    const name = editName.trim();
    if (!name) {
      toast.error("请输入分类名称");
      return;
    }
    setBusyId(category.id);
    try {
      await apiUpdateCategory(category.id, {
        name,
        color: editColor,
        parentId: editParentId || null,
      });
      setEditingId(null);
      onChanged();
      toast.success("分类已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类更新失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(category: ImageCategory) {
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
    setBusyId(category.id);
    try {
      const result = await apiDeleteCategory(category.id);
      onDeleted(result.deletedCategoryIds ?? [category.id]);
      onChanged();
      toast.success(
        result.detachedImageCount > 0
          ? `已删除 ${result.deletedCategoryCount} 个分类，${result.detachedImageCount} 件作品转为未分类`
          : `已删除 ${result.deletedCategoryCount} 个分类`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类删除失败");
    } finally {
      setBusyId(null);
    }
  }

  /** 移动目标：排除自己和自己的子孙，并保证移动后整棵子树不超过层数上限。 */
  function parentOptions(category: ImageCategory) {
    const blocked = new Set(subtreeIds(category));
    const height = subtreeHeight(category);
    return categories.filter(
      (option) => !blocked.has(option.id) && option.depth + height <= MAX_CATEGORY_DEPTH,
    );
  }

  const draftRow = (parentId: string | null) => (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/30 bg-primary-container/30 px-3 py-2"
      style={{ marginLeft: `${(parentId ? (categoryById.get(parentId)?.depth ?? 0) : 0) * INDENT_REM}rem` }}
    >
      <input
        autoFocus
        value={draft?.name ?? ""}
        onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
        onKeyDown={(event) => {
          if (event.key === "Enter") void handleCreate();
          if (event.key === "Escape") setDraft(null);
        }}
        placeholder={parentId ? `在「${categoryById.get(parentId)?.name ?? ""}」下新建子分类` : "新建根分类"}
        maxLength={40}
        className="material-input h-9 min-w-[8rem] flex-1 rounded-[12px] px-3 text-xs"
      />
      <ColorPicker
        value={draft?.color ?? DEFAULT_CATEGORY_COLOR}
        onChange={(color) => setDraft((current) => (current ? { ...current, color } : current))}
      />
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[12px] bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        创建
      </button>
      <button
        type="button"
        onClick={() => setDraft(null)}
        className="inline-flex h-9 cursor-pointer items-center rounded-[12px] border border-border px-3 text-xs font-semibold text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        取消
      </button>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-border bg-surface-container-lowest shadow-[0_28px_80px_rgba(15,23,42,0.32)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">管理分类</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">最多 {MAX_CATEGORY_DEPTH} 层，删除父分类会连同子分类一起删除</p>
          </div>
          <div className="flex items-center gap-2">
            {canCreate ? (
              <button
                type="button"
                onClick={() => setDraft({ parentId: null, name: "", color: DEFAULT_CATEGORY_COLOR })}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[12px] bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <Plus className="h-4 w-4" />
                新建根分类
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] text-slate-400 transition hover:bg-surface-container-low hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
          {draft && draft.parentId === null ? draftRow(null) : null}

          {categories.map((category) => {
            const editing = editingId === category.id;
            const busy = busyId === category.id;
            const canAddChild = canCreate && category.depth < MAX_CATEGORY_DEPTH;
            return (
              <div key={category.id} className="space-y-1.5">
                <div
                  className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-surface-container-lowest px-3 py-2"
                  style={{ marginLeft: `${(category.depth - 1) * INDENT_REM}rem` }}
                >
                  {editing ? (
                    <>
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        maxLength={40}
                        className="material-input h-9 min-w-[7rem] flex-1 rounded-[12px] px-3 text-xs"
                      />
                      <select
                        value={editParentId}
                        onChange={(event) => setEditParentId(event.target.value)}
                        aria-label="父分类"
                        className="material-input h-9 max-w-[11rem] rounded-[12px] px-2 text-xs"
                      >
                        <option value="">根分类</option>
                        {parentOptions(category).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.path}
                          </option>
                        ))}
                      </select>
                      <ColorPicker value={editColor} onChange={setEditColor} />
                      <button
                        type="button"
                        onClick={() => void handleSaveEdit(category)}
                        disabled={busy}
                        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[12px] bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="inline-flex h-9 cursor-pointer items-center rounded-[12px] border border-border px-3 text-xs font-semibold text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      {category.depth > 1 ? <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-300" /> : null}
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800" title={category.path}>
                        {category.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                        {category.imageCount} 件
                        {category.totalImageCount !== category.imageCount ? `（含子 ${category.totalImageCount}）` : ""}
                      </span>
                      {canAddChild ? (
                        <button
                          type="button"
                          onClick={() => setDraft({ parentId: category.id, name: "", color: category.color })}
                          aria-label={`在 ${category.name} 下新建子分类`}
                          title="新建子分类"
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-slate-400 transition hover:bg-surface-container-low hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(category.id);
                            setEditName(category.name);
                            setEditColor(category.color || DEFAULT_CATEGORY_COLOR);
                            setEditParentId(category.parentId ?? "");
                          }}
                          aria-label={`编辑分类 ${category.name}`}
                          title="编辑"
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-slate-400 transition hover:bg-surface-container-low hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void handleDelete(category)}
                          disabled={busy}
                          aria-label={`删除分类 ${category.name}`}
                          title="删除"
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>

                {draft && draft.parentId === category.id ? draftRow(category.id) : null}
              </div>
            );
          })}

          {categories.length === 0 && !draft ? (
            <p className="py-8 text-center text-xs text-slate-400">
              还没有分类{canCreate ? "，点右上角「新建根分类」开始。" : "。"}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {CATEGORY_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`选择颜色 ${color}`}
          aria-pressed={value === color}
          className={cn(
            "h-5 w-5 cursor-pointer rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            value === color ? "border-slate-900" : "border-transparent hover:border-slate-300",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
