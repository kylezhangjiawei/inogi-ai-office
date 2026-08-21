import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  AlertCircle,
  Clapperboard,
  Film,
  FolderCog,
  FolderTree,
  Loader2,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { cn } from "./components/ui/utils";
import { MaterialSelect } from "./components/MaterialFields";
import { AssignCategoryModal, MediaCategorySidebar } from "./components/MediaCategorySidebar";
import { MediaUploadButton, MediaUploadDialog } from "./components/MediaUploadDialog";
import { Pager } from "./components/Pager";
import {
  flattenCategories,
  subtreeIds,
  UNCATEGORIZED_FILTER,
  type CategoryFormPayload,
  type MediaCategoryNode,
} from "./lib/mediaCategory";
import { VideoGenerateForm } from "./VideoGenerateForm";
import {
  videoGenerationApi,
  type VideoCategory,
  type VideoCostGateConfig,
  type VideoTask,
  type VideoTaskStatus,
} from "./lib/videoGenerationApi";

const PAGE_SIZE = 12;
const POLL_INTERVAL_MS = 15_000;

/** 上传入库的视频在 mode 上的标记，与后端 UPLOADED_VIDEO_MODE 一致。 */
const UPLOADED_VIDEO_MODE = "upload";

const MODE_LABEL: Record<string, string> = {
  i2v: "图生视频",
  t2v: "文生视频",
  r2v: "参考生视频",
  [UPLOADED_VIDEO_MODE]: "上传",
};

const STATUS_META: Record<VideoTaskStatus, { label: string; tone: string }> = {
  pending: { label: "排队中", tone: "bg-slate-100 text-slate-600" },
  running: { label: "生成中", tone: "bg-sky-50 text-sky-700" },
  succeeded: { label: "已完成", tone: "bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", tone: "bg-rose-50 text-rose-700" },
};

function formatDate(value?: string | null) {
  if (!value) return "-";
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

/** 管理端成本闸门配置面板 */
function CostGatePanel() {
  const [config, setConfig] = useState<VideoCostGateConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await videoGenerationApi.getCostGateConfig());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取闸门配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !config) void load();
  }, [open, config, load]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await videoGenerationApi.saveCostGateConfig({
        mode: config.mode,
        autoThresholdYuan: config.autoThresholdYuan,
        budgetCapYuan: config.budgetCapYuan,
      });
      setConfig(saved);
      toast.success("成本闸门配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="material-card p-6">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900">视频成本闸门</h3>
        </div>
        <span className="text-sm text-slate-400">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="mt-5">
          {loading || !config ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 读取中...
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  闸门模式
                </label>
                <MaterialSelect
                  value={config.mode}
                  onValueChange={(v) =>
                    setConfig({ ...config, mode: v as VideoCostGateConfig["mode"] })
                  }
                  options={[
                    { value: "off", label: "关闭 — 不拦，直接生成" },
                    { value: "threshold", label: "阈值 — 超过阈值才确认" },
                    { value: "always", label: "始终 — 每次都确认" },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  自动放行阈值（元）
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className="material-input w-full"
                  value={config.autoThresholdYuan}
                  disabled={config.mode !== "threshold"}
                  onChange={(e) =>
                    setConfig({ ...config, autoThresholdYuan: Number(e.target.value) || 0 })
                  }
                />
                <p className="mt-1.5 text-xs text-slate-400">预计消耗 ≤ 此值免确认（仅阈值模式生效）</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  预算上限（元）
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="material-input w-full"
                  value={config.budgetCapYuan ?? ""}
                  placeholder="不填 = 不设上限"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setConfig({ ...config, budgetCapYuan: e.target.value && n > 0 ? n : null });
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-400">超预算的生成会被拦在确认卡并提示</p>
              </div>
            </div>
          )}
          {config && (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="material-button-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存配置"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function VideoLibraryPage() {
  const { user } = useAuth();
  const userPermissions = user?.permissions ?? [];
  const isAdmin = hasPermission(userPermissions, "page:ai-model-management");
  const canCreateCategory = hasPermission(userPermissions, PERMISSIONS.VIDEO_CATEGORY_CREATE);
  const canEditCategory = hasPermission(userPermissions, PERMISSIONS.VIDEO_CATEGORY_EDIT);
  const canDeleteCategory = hasPermission(userPermissions, PERMISSIONS.VIDEO_CATEGORY_DELETE);
  const canUpload = hasPermission(userPermissions, PERMISSIONS.VIDEO_LIBRARY_UPLOAD);

  const [items, setItems] = useState<VideoTask[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [categories, setCategories] = useState<VideoCategory[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [assigningItem, setAssigningItem] = useState<VideoTask | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  // 从通知跳转进来时携带 ?video=<id>：加载后滚动到该视频并高亮
  const [searchParams] = useSearchParams();
  const targetVideoId = searchParams.get("video");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // 从通知跳转进来直接看库，否则默认停在生成工作台
  const [tab, setTab] = useState<"generate" | "library">(targetVideoId ? "library" : "generate");

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const categoryById = useMemo(
    () => new Map(flatCategories.map((category) => [category.id, category])),
    [flatCategories],
  );
  const activeCategory = categoryFilter ? categoryById.get(categoryFilter) ?? null : null;

  const load = useCallback(
    async (targetPage = page, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await videoGenerationApi.listVideos(targetPage, PAGE_SIZE, categoryFilter);
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(Math.max(1, res.total_pages));
      } catch (error) {
        if (!silent) toast.error(error instanceof Error ? error.message : "读取视频列表失败");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, categoryFilter],
  );

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const res = await videoGenerationApi.listCategories();
      setCategories(res.items);
      setUncategorizedCount(res.uncategorizedCount);
      setTotalCount(res.totalCount);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类加载失败");
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [page, load]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // 换分类筛选时回到第 1 页重新拉
  useEffect(() => {
    setPage(1);
  }, [categoryFilter]);

  // 有未完成任务时轮询刷新（静默，不打扰）
  const hasActive = useMemo(
    () => items.some((it) => it.status === "pending" || it.status === "running"),
    [items],
  );

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hasActive) {
      pollRef.current = setInterval(() => void load(page, true), POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActive, page, load]);

  // 通知跳转定位：目标视频在当前列表时，滚动到它并短暂高亮
  useEffect(() => {
    if (!targetVideoId || !items.some((it) => it.id === targetVideoId)) return;
    const el = document.getElementById(`video-card-${targetVideoId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(targetVideoId);
    const timer = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(timer);
  }, [targetVideoId, items]);

  async function handleCreateCategory(payload: CategoryFormPayload) {
    try {
      await videoGenerationApi.createCategory({
        name: payload.name,
        color: payload.color,
        parentId: payload.parentId,
      });
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
      await videoGenerationApi.updateCategory(category.id, {
        name: payload.name,
        color: payload.color,
        parentId: payload.parentId,
      });
      await loadCategories();
      // 移动分类会改变「父分类含子孙」的筛选集合，列表要跟着重拉一次
      if (movedParent && categoryFilter) await load(page);
      toast.success("分类已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类保存失败");
      throw error;
    }
  }

  async function handleDeleteCategory(category: MediaCategoryNode) {
    try {
      const result = await videoGenerationApi.deleteCategory(category.id);
      const deletedIds = result.deletedCategoryIds ?? [category.id];
      if (categoryFilter && deletedIds.includes(categoryFilter)) setCategoryFilter("");
      setItems((videos) =>
        videos.map((video) =>
          video.category_id && deletedIds.includes(video.category_id) ? { ...video, category_id: null } : video,
        ),
      );
      await loadCategories();
      toast.success(
        result.detachedVideoCount > 0
          ? `已删除 ${result.deletedCategoryCount} 个分类，${result.detachedVideoCount} 个视频转为未分类`
          : `已删除 ${result.deletedCategoryCount} 个分类`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类删除失败");
    }
  }

  async function handleDeleteVideo(item: VideoTask) {
    const label = item.prompt?.trim() ? `「${item.prompt.trim().slice(0, 20)}」` : "这个视频";
    if (!window.confirm(`确定删除${label}？视频文件会一并从存储里删除，且不可恢复。`)) return;

    setDeletingId(item.id);
    try {
      await videoGenerationApi.deleteVideo(item.id);
      setItems((videos) => videos.filter((video) => video.id !== item.id));
      setTotal((current) => Math.max(0, current - 1));
      await loadCategories();
      toast.success("视频已删除");
      // 删到本页空了就回退一页，避免停在没有内容的页码上
      if (items.length === 1 && page > 1) setPage((p) => p - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAssignCategory(item: VideoTask, categoryId: string | null) {
    try {
      const updated = await videoGenerationApi.assignCategory(item.id, categoryId);
      setItems((videos) => {
        // 正在按分类筛选时，改归属后不再匹配的视频要从当前列表里移除。
        // 父分类的筛选含子孙，所以这里比对的是选中节点的整棵子树。
        if (categoryFilter) {
          const stillMatches =
            categoryFilter === UNCATEGORIZED_FILTER
              ? !updated.categoryId
              : Boolean(updated.categoryId) &&
                subtreeIds(categoryById.get(categoryFilter)).includes(updated.categoryId!);
          if (!stillMatches) return videos.filter((video) => video.id !== updated.id);
        }
        return videos.map((video) =>
          video.id === updated.id ? { ...video, category_id: updated.categoryId } : video,
        );
      });
      setAssigningItem(null);
      await loadCategories();
      toast.success(updated.categoryId ? "已更新分类" : "已移出分类");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分类归属更新失败");
    }
  }

  const isLibraryTab = tab === "library";

  const emptyTitle =
    categoryFilter === UNCATEGORIZED_FILTER
      ? "未分类下还没有视频"
      : categoryFilter
        ? "该分类下还没有视频"
        : "还没有视频任务";
  const emptyHint = categoryFilter
    ? "把鼠标移到视频卡片上，点右下角「设置分类」即可把视频归到这个分类下。"
    : "在「生成视频」里创建，或用上方「上传视频」把本地片源传进来，作品会自动归档到这里。";

  const tabSwitcher = (
    <div className="inline-flex items-center gap-1 rounded-[14px] border border-border bg-surface-container-lowest p-1">
      {([
        ["generate", "生成视频"],
        ["library", "视频作品库"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setTab(value)}
          className={cn(
            "cursor-pointer rounded-[10px] px-4 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            tab === value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-slate-600 hover:bg-surface-container-low",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    // 作品库页签下让页面吃满外壳高度、自身不滚动，把滚动条交给下面的作品列表（与图像作品库一致）；
    // lg 以下不启用，窄视口仍走整页滚动。
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-4",
        isLibraryTab && "lg:h-full lg:overflow-hidden",
      )}
    >
      {/* 作品库页签下不铺大卡头图：顶部只留一条页签，把高度让给分类侧栏与作品列表（同图像作品库） */}
      {isLibraryTab ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          {tabSwitcher}
          <span className="text-xs text-slate-400">
            生成任务与上传的本地视频同库同分类，完成后会站内通知你
          </span>
        </div>
      ) : (
        <section className="material-card shrink-0 p-6 md:p-8">
          <span className="material-chip bg-indigo-50 text-indigo-700">Video Studio</span>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[2rem] font-bold tracking-tight text-slate-900">
              <Clapperboard className="h-7 w-7 text-indigo-600" />
              视频工作台
            </h2>
          </div>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            直接在这里生成视频（文生 / 图生 / 参考生），或到「视频作品库」查看历史，也可以把本地视频上传进来统一归类。视频为分钟级异步任务，完成后会站内通知你，也可在 MateChat 对话里生成。
          </p>
          <div className="mt-5">{tabSwitcher}</div>
        </section>
      )}

      {tab === "generate" && (
        <>
          <section className="material-card shrink-0 p-6">
            <VideoGenerateForm
              onSubmitted={() => {
                setTab("library");
                setPage(1);
                void load(1);
              }}
            />
          </section>

          {/* 闸门管的是「生成」这一侧的花费，跟着生成表单放；作品库页签把高度全留给列表 */}
          {isAdmin && <CostGatePanel />}
        </>
      )}

      {isLibraryTab && (
        <section className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
          <MediaCategorySidebar
            categories={categories}
            loading={categoriesLoading}
            selectedId={categoryFilter}
            onSelect={setCategoryFilter}
            totalCount={totalCount}
            uncategorizedCount={uncategorizedCount}
            canCreate={canCreateCategory}
            canEdit={canEditCategory}
            canDelete={canDeleteCategory}
            itemNoun="视频"
            allIcon={Film}
            onCreate={handleCreateCategory}
            onUpdate={handleUpdateCategory}
            onDelete={handleDeleteCategory}
          />

          {/* ── 内容区 ────────────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:min-h-0">
            <div className="material-card flex shrink-0 flex-col gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-xs leading-5 text-slate-500">
                  生成任务与上传的本地视频同库同分类，分钟级任务完成后会站内通知你。
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {canUpload ? <MediaUploadButton kind="video" onClick={() => setUploadOpen(true)} /> : null}

                  <button
                    type="button"
                    onClick={() => void load(page)}
                    disabled={loading}
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[14px] border border-border bg-surface-container-low text-slate-500 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="刷新列表"
                  >
                    <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin motion-reduce:animate-none" : "")} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                    共 <span className="tabular-nums">{total.toLocaleString("zh-CN")}</span> 件
                  </span>
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

            {/* 视频列表吃掉剩余高度并独立滚动，分页条固定在底部不随之滚走 */}
            <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                {items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => {
                      const status = STATUS_META[item.status];
                      const uploaded = item.mode === UPLOADED_VIDEO_MODE;
                      const category = item.category_id ? categoryById.get(item.category_id) ?? null : null;
                      return (
                        <div
                          key={item.id}
                          id={`video-card-${item.id}`}
                          className={cn(
                            "group/video overflow-hidden rounded-2xl border bg-white transition-shadow",
                            highlightId === item.id
                              ? "border-indigo-400 ring-2 ring-indigo-300 ring-offset-2"
                              : "border-slate-200",
                          )}
                        >
                          <div className="flex aspect-video items-center justify-center bg-slate-900/95">
                            {item.status === "succeeded" && item.video_url ? (
                              <video
                                controls
                                preload="metadata"
                                className="h-full w-full object-contain"
                                src={item.video_url}
                              />
                            ) : item.status === "failed" ? (
                              <div className="flex flex-col items-center gap-2 px-4 text-center text-rose-300">
                                <AlertCircle className="h-8 w-8" />
                                <span className="line-clamp-3 text-xs">{item.error_message ?? "生成失败"}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-slate-300">
                                <Loader2 className="h-8 w-8 animate-spin" />
                                <span className="text-xs">{status.label}，约需几分钟...</span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-2 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  "material-chip",
                                  uploaded ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700",
                                )}
                              >
                                {MODE_LABEL[item.mode] ?? item.mode}
                              </span>
                              {uploaded ? null : (
                                <span className={cn("material-chip", status.tone)}>{status.label}</span>
                              )}
                            </div>
                            <p className="line-clamp-2 text-sm text-slate-700" title={item.prompt}>
                              {item.prompt || "（无描述）"}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                              {item.resolution ? <span>{item.resolution}</span> : null}
                              {item.duration > 0 ? <span>{item.duration}s</span> : null}
                              {!uploaded && item.status === "succeeded" && <span>计费 ¥{item.cost_yuan}</span>}
                              <span>{formatDate(item.created_at)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span
                                className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500"
                                title={category?.path}
                              >
                                <FolderTree
                                  className="h-3.5 w-3.5 shrink-0"
                                  style={{ color: category?.color || undefined }}
                                />
                                <span className="truncate">{category?.name ?? "未分类"}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setAssigningItem(item)}
                                  title="设置分类"
                                  aria-label={`设置分类：${item.prompt || "未命名视频"}`}
                                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                                >
                                  <FolderCog className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteVideo(item)}
                                  disabled={deletingId === item.id}
                                  title="删除视频"
                                  aria-label={`删除视频：${item.prompt || "未命名视频"}`}
                                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {deletingId === item.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </button>
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : loading ? (
                  <div className="flex min-h-[40vh] items-center justify-center text-xs font-semibold text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                    正在加载...
                  </div>
                ) : (
                  <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-6 py-12 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary-container text-on-primary-container">
                      <Film className="h-6 w-6" />
                    </div>
                    <h2 className="mt-4 text-sm font-semibold text-slate-950">{emptyTitle}</h2>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">{emptyHint}</p>
                    <button
                      type="button"
                      onClick={() => setTab("generate")}
                      className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-primary px-5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25"
                    >
                      去生成视频
                    </button>
                  </div>
                )}
              </div>

              <Pager
                page={page}
                totalPages={totalPages}
                onChange={(target) => setPage(target)}
                disabled={loading}
              />
            </div>
          </div>
        </section>
      )}

      {assigningItem ? (
        <AssignCategoryModal
          subtitle={assigningItem.prompt || "（无描述）"}
          currentId={assigningItem.category_id ?? null}
          categories={flatCategories}
          onClose={() => setAssigningItem(null)}
          onSelect={(categoryId) => void handleAssignCategory(assigningItem, categoryId)}
        />
      ) : null}

      {uploadOpen ? (
        <MediaUploadDialog
          kind="video"
          categories={categories}
          defaultCategoryId={categoryFilter && categoryFilter !== UNCATEGORIZED_FILTER ? categoryFilter : null}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            void loadCategories();
            setPage(1);
            void load(1);
          }}
          register={async ({ fileId, title, categoryId, probe }) => {
            await videoGenerationApi.uploadVideo({
              fileId,
              title,
              categoryId,
              duration: probe.duration,
              resolution: probe.size,
            });
          }}
        />
      ) : null}
    </div>
  );
}
