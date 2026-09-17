import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Film,
  FolderCog,
  FolderTree,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { cn } from "./components/ui/utils";
import { AssignCategoryModal, MediaCategorySidebar } from "./components/MediaCategorySidebar";
import { MediaUploadButton, MediaUploadDialog } from "./components/MediaUploadDialog";
import { Pager } from "./components/Pager";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
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
import { NativeSelect } from "./components/ui/native-select";
import { Input } from "./components/ui/input";

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
    <section className="hz-surface overflow-hidden">
      <Button variant="unstyled"
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="video-cost-gate-panel"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="size-5 text-primary" />
          <span className="text-balance text-base font-semibold text-slate-900">视频成本闸门</span>
        </div>
        <span className="text-sm font-medium text-slate-500">{open ? "收起" : "展开"}</span>
      </Button>

      {open && (
        <div id="video-cost-gate-panel" className="border-t border-slate-100 px-4 py-4 sm:px-5">
          {loading || !config ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-slate-500" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> 正在读取成本策略…
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="video-gate-mode" className="mb-2 block text-xs font-semibold text-slate-700">
                  闸门模式
                </label>
                <NativeSelect
                  id="video-gate-mode"
                  value={config.mode}
                  onChange={(event) => setConfig({ ...config, mode: event.target.value as VideoCostGateConfig["mode"] })}
                  className="material-input h-11 w-full rounded-xl px-3 text-sm text-slate-700"
                >
                  <option value="off">关闭 — 不拦，直接生成</option>
                  <option value="threshold">阈值 — 超过阈值才确认</option>
                  <option value="always">始终 — 每次都确认</option>
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="video-gate-threshold" className="mb-2 block text-xs font-semibold text-slate-700">
                  自动放行阈值（元）
                </label>
                <Input
                  id="video-gate-threshold"
                  type="number"
                  min={0}
                  step={0.5}
                  className="material-input h-11 w-full rounded-xl px-3 tabular-nums"
                  value={config.autoThresholdYuan}
                  disabled={config.mode !== "threshold"}
                  onChange={(e) =>
                    setConfig({ ...config, autoThresholdYuan: Number(e.target.value) || 0 })
                  }
                />
                <p className="mt-1.5 text-pretty text-xs text-slate-500">预计消耗 ≤ 此值免确认（仅阈值模式生效）</p>
              </div>
              <div>
                <label htmlFor="video-gate-budget" className="mb-2 block text-xs font-semibold text-slate-700">
                  预算上限（元）
                </label>
                <Input
                  id="video-gate-budget"
                  type="number"
                  min={0}
                  step={100}
                  className="material-input h-11 w-full rounded-xl px-3 tabular-nums"
                  value={config.budgetCapYuan ?? ""}
                  placeholder="不填 = 不设上限"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setConfig({ ...config, budgetCapYuan: e.target.value && n > 0 ? n : null });
                  }}
                />
                <p className="mt-1.5 text-pretty text-xs text-slate-500">超预算的生成会被拦在确认卡并提示</p>
              </div>
            </div>
          )}
          {config && (
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                className="hz-primary-action"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {saving ? "保存中..." : "保存配置"}
              </Button>
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
  const activeTaskCount = items.filter((item) => item.status === "pending" || item.status === "running").length;
  const hasActive = activeTaskCount > 0;

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
  const completedTaskCount = items.filter((item) => item.status === "succeeded").length;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "generate" | "library")}
      className={cn(
        "horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1800px] min-w-0 flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5",
        isLibraryTab && "xl:h-full xl:min-h-0 xl:overflow-hidden",
      )}
    >
      <HorizonPageHeader
        Icon={Clapperboard}
        eyebrow="AI CREATIVE · VIDEO STUDIO"
        title="AI 视频创作"
        description="统一完成文生、图生与参考生视频，实时查看预算评估、异步进度和入库作品。"
        meta={(
          <>
            <span>分钟级异步任务</span>
            <span aria-hidden="true">·</span>
            <span>{activeTaskCount > 0 ? `当前页 ${activeTaskCount} 个任务自动同步` : "任务完成后站内通知"}</span>
            <span aria-hidden="true">·</span>
            <span>{isLibraryTab ? "作品资产视图" : "生成工作台"}</span>
          </>
        )}
        actions={(
          <TabsList aria-label="视频创作视图" className="h-auto rounded-full border border-slate-200 bg-white p-1">
            <TabsTrigger value="generate" className="h-8 rounded-full px-3 data-[state=active]:bg-primary data-[state=active]:text-white">
              <Sparkles className="size-3.5" />生成视频
            </TabsTrigger>
            <TabsTrigger value="library" className="h-8 rounded-full px-3 data-[state=active]:bg-primary data-[state=active]:text-white">
              <Film className="size-3.5" />视频作品库
            </TabsTrigger>
          </TabsList>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
        <HorizonMetric Icon={Film} label="视频总量" value={totalCount} note="生成与上传统一入库" tone="brand" />
        <HorizonMetric Icon={Clock3} label="生成中" value={activeTaskCount} note="当前页每 15 秒同步" tone={activeTaskCount > 0 ? "warning" : "success"} />
        <HorizonMetric Icon={CheckCircle2} label="已完成" value={completedTaskCount} note="当前页可播放作品" tone="success" />
        <HorizonMetric Icon={FolderTree} label="未分类" value={uncategorizedCount} note="待整理的视频资产" tone={uncategorizedCount > 0 ? "warning" : "neutral"} />
      </HorizonMetricGrid>

      <TabsContent value="generate" className="m-0 min-w-0 space-y-3">
        <section className="hz-surface shrink-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={Sparkles}
            title="创建视频任务"
            description="选择生成方式并完善素材、提示词与输出规格，提交前会即时核算预计消耗。"
            trailing={<span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-primary">预算前置校验</span>}
          />
          <div className="p-4 sm:p-5">
            <VideoGenerateForm
              onSubmitted={() => {
                setTab("library");
                setPage(1);
                void load(1);
              }}
            />
          </div>
        </section>

        {/* 闸门管的是「生成」这一侧的花费，跟着生成表单放；作品库页签把高度全留给列表 */}
        {isAdmin ? <CostGatePanel /> : null}
      </TabsContent>

      <TabsContent value="library" className="m-0 flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1">
        <section className="flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1 xl:flex-row">
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
          <section className="hz-surface flex min-w-0 flex-1 flex-col overflow-hidden xl:min-h-0">
            <HorizonSectionHeader
              Icon={Film}
              title={activeCategory ? activeCategory.name : categoryFilter === UNCATEGORIZED_FILTER ? "未分类视频" : "视频资产库"}
              description={activeCategory ? `${activeCategory.path}，筛选结果包含其子分类。` : "集中管理生成任务与上传片源，支持播放、归类和安全删除。"}
              trailing={<span className="text-xs text-slate-500 tabular-nums">{total.toLocaleString("zh-CN")} 件</span>}
            />

            <div className="hz-toolbar flex shrink-0 flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-pretty text-xs leading-5 text-slate-500">
                生成任务与上传的本地视频同库同分类，分钟级任务完成后会站内通知你。
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {canUpload ? <MediaUploadButton kind="video" onClick={() => setUploadOpen(true)} /> : null}

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => void load(page)}
                  disabled={loading}
                  aria-label="刷新列表"
                >
                  <RefreshCw className={cn("size-4", loading ? "animate-spin motion-reduce:animate-none" : "")} />
                </Button>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                    共 <span className="tabular-nums">{total.toLocaleString("zh-CN")}</span> 件
                  </span>
                  {activeCategory || categoryFilter === UNCATEGORIZED_FILTER ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-semibold text-primary">
                      {activeCategory
                        ? `${activeCategory.path}${(activeCategory.children ?? []).length > 0 ? "（含子分类）" : ""}`
                        : "未分类"}
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => setCategoryFilter("")}
                        aria-label="清除分类筛选"
                        className="cursor-pointer rounded text-primary transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <X className="size-3" />
                      </Button>
                    </span>
                  ) : null}
                </span>
                {totalPages > 1 ? <span className="tabular-nums">第 {page} / {totalPages} 页</span> : null}
            </div>

            {/* 视频列表吃掉剩余高度并独立滚动，分页条固定在底部不随之滚走 */}
            <div className="flex min-h-[32rem] flex-none flex-col gap-3 p-3 sm:p-4 xl:min-h-0 xl:flex-1">
              <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                {items.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {items.map((item) => {
                      const status = STATUS_META[item.status];
                      const uploaded = item.mode === UPLOADED_VIDEO_MODE;
                      const category = item.category_id ? categoryById.get(item.category_id) ?? null : null;
                      return (
                        <article
                          key={item.id}
                          id={`video-card-${item.id}`}
                          className={cn(
                            "group/video overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow",
                            highlightId === item.id
                              ? "border-blue-500 ring-2 ring-blue-200 ring-offset-2"
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
                                aria-label={item.prompt ? `播放视频：${item.prompt}` : "播放未命名视频"}
                              />
                            ) : item.status === "failed" ? (
                              <div className="flex flex-col items-center gap-2 px-4 text-center text-rose-300">
                                <AlertCircle className="size-8" />
                                <span className="line-clamp-3 text-xs">{item.error_message ?? "生成失败"}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-slate-300">
                                <Loader2 className="size-8 animate-spin motion-reduce:animate-none" />
                                <span className="text-xs">{status.label}，约需几分钟...</span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-2 p-4">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                  uploaded ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700",
                                )}
                              >
                                {MODE_LABEL[item.mode] ?? item.mode}
                              </span>
                              {uploaded ? null : (
                                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", status.tone)}>{status.label}</span>
                              )}
                            </div>
                            <p className="line-clamp-2 text-pretty text-sm text-slate-700" title={item.prompt}>
                              {item.prompt || "（无描述）"}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-slate-500">
                              {item.resolution ? <span>{item.resolution}</span> : null}
                              {item.duration > 0 ? <span>{item.duration}s</span> : null}
                              {!uploaded && item.status === "succeeded" ? <span>计费 ¥{item.cost_yuan}</span> : null}
                              <span>{formatDate(item.created_at)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span
                                className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500"
                                title={category?.path}
                              >
                                <FolderTree
                                  className="size-3.5 shrink-0"
                                  style={{ color: category?.color || undefined }}
                                />
                                <span className="truncate">{category?.name ?? "未分类"}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setAssigningItem(item)}
                                  title="设置分类"
                                  aria-label={`设置分类：${item.prompt || "未命名视频"}`}
                                  className="size-8 text-slate-500 hover:bg-accent hover:text-primary"
                                >
                                  <FolderCog className="size-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      disabled={deletingId === item.id}
                                      title="删除视频"
                                      aria-label={`删除视频：${item.prompt || "未命名视频"}`}
                                      className="size-8 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                                    >
                                      {deletingId === item.id ? (
                                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                                      ) : (
                                        <Trash2 className="size-4" />
                                      )}
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="horizon-portal">
                                    <AlertDialogHeader>
                                      <AlertDialogTitle className="text-balance text-slate-900">确认永久删除该视频？</AlertDialogTitle>
                                      <AlertDialogDescription className="text-pretty">
                                        “{item.prompt?.trim() || "未命名视频"}”及其视频文件会一并从存储中删除，此操作无法撤销。
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>取消</AlertDialogCancel>
                                      <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void handleDeleteVideo(item)}>
                                        确认删除
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : loading ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="status" aria-label="正在加载视频作品">
                    <span className="sr-only">正在加载视频作品</span>
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="aspect-video bg-slate-100" />
                        <div className="space-y-3 p-4"><div className="h-4 w-20 rounded bg-slate-100" /><div className="h-4 w-4/5 rounded bg-slate-100" /><div className="h-3 w-2/3 rounded bg-slate-100" /></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <HorizonEmptyState
                    Icon={Film}
                    title={emptyTitle}
                    description={emptyHint}
                    action={<Button type="button" className="hz-primary-action" onClick={() => setTab("generate")}><Sparkles className="size-4" />去生成视频</Button>}
                  />
                )}
              </div>

              <Pager
                page={page}
                totalPages={totalPages}
                onChange={(target) => setPage(target)}
                disabled={loading}
              />
            </div>
          </section>
        </section>
      </TabsContent>

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
    </Tabs>
  );
}
