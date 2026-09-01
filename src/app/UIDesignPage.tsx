import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import {
  Download,
  Eye,
  Heart,
  Images,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Sparkles,
  Upload,
  Wand2,
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
import { cn } from "./components/ui/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  DEFAULT_IMAGE_MODEL_OPTION,
  DEFAULT_IMAGE_MODEL_VALUE,
  formatAiModelOptionLabel,
} from "./lib/aiModelOptions";
import { useAiModelOptions } from "./lib/useAiModelOptions";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";
import {
  apiEditImage,
  apiGenerate,
  apiList,
  apiPromptChat,
  apiToggleFavorite,
  compressDataUrlForUpstream,
  downloadGeneratedImage,
  formatFileSize,
  formatImageCost,
  formatTime,
  getTodayBounds,
  ImageEditModal,
  ImagePreviewModal,
  MAX_PROMPT_LENGTH,
  MAX_REFERENCE_IMAGES,
  MAX_UPSTREAM_REFERENCE_IMAGE_BYTES,
  prepareReferenceImage,
  prepareReferenceImagesForSubmit,
  ratios,
  type GeneratedImage,
  type ReferenceImageItem,
  type Size,
  type Style,
} from "./imageStudioShared";

// 内联「优化」按钮发给文本模型的默认要求：保留原意，补全图像生成所需的专业要素。
const DEFAULT_OPTIMIZE_INSTRUCTION =
  "请在保留我原意的前提下，把这段描述优化成主体、构图、镜头、材质、光影、风格、色彩和背景都更完整、可直接用于图像生成模型的专业中文提示词。";

// 用户请求气泡（右对齐）：把这一轮的提示词/修改要求当作「用户消息」展示。
function UserRequestBubble({ text, isEdit }: { text: string; isEdit: boolean }) {
  if (!text) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[18px] rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
        {isEdit ? (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
            <PencilLine className="h-3 w-3" />
            改上一张
          </span>
        ) : null}
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}

// AI 头像（左侧）：聊天回复气泡前的标识。
function AssistantAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

// 中央对话流的一轮：右侧「用户」请求气泡 + 左侧「AI」图片回复气泡。
function ChatTurn({
  item,
  busy,
  onPreview,
  onDownload,
  onEdit,
  onFavorite,
  onReuse,
}: {
  item: GeneratedImage;
  busy: boolean;
  onPreview: (item: GeneratedImage) => void;
  onDownload: (item: GeneratedImage) => void;
  onEdit: (item: GeneratedImage) => void;
  onFavorite: (item: GeneratedImage) => void;
  onReuse: (item: GeneratedImage) => void;
}) {
  // 这一轮是「改上一张」还是「新建一张」：有修改说明 / 编辑深度 / 父图任意一项即视为修改。
  const isEdit = Boolean(item.editInstruction?.trim() || (item.editDepth ?? 0) > 0 || item.parentImageId);
  const requestText = ((isEdit ? item.editInstruction : item.prompt) || item.prompt || "").trim();
  const actionButtonClass =
    "inline-flex cursor-pointer items-center gap-1 rounded-[10px] px-2.5 py-1.5 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
  return (
    <div className="space-y-2.5">
      <UserRequestBubble text={requestText} isEdit={isEdit} />
      <div className="flex items-start gap-2.5">
        <AssistantAvatar />
        <div className="min-w-0 flex-1 overflow-hidden rounded-[18px] rounded-tl-md border border-border/85 bg-surface-container-lowest shadow-[0_18px_44px_rgba(15,23,42,0.06)] ring-1 ring-white/70">
          <button
            type="button"
            onClick={() => onPreview(item)}
            className="group relative block w-full cursor-zoom-in overflow-hidden bg-slate-100"
          >
            <img
              src={item.thumbnailUrl || item.imageUrl || item.imageData}
              loading="lazy"
              decoding="async"
              alt={item.prompt}
              className="mx-auto max-h-[56vh] w-full object-contain transition duration-200 group-hover:opacity-95"
            />
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2.5 text-[11px] text-slate-500">
            <span>{item.model}</span>
            <span>{formatTime(item.createdAt)}</span>
            <span className="font-mono tabular-nums text-slate-700">{formatImageCost(item)}</span>
            {item.fromCache ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                缓存命中
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/70 px-2 py-1.5 text-[11px] font-semibold text-slate-600">
            <button type="button" onClick={() => onPreview(item)} className={actionButtonClass}>
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            <button type="button" onClick={() => onDownload(item)} className={actionButtonClass}>
              <Download className="h-3.5 w-3.5" />
              下载
            </button>
            <button type="button" onClick={() => onEdit(item)} className={actionButtonClass}>
              <PencilLine className="h-3.5 w-3.5" />
              修改
            </button>
            <button
              type="button"
              onClick={() => onFavorite(item)}
              disabled={busy}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] px-2.5 py-1.5 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-rose-500 text-rose-500" : "")} />
              )}
              收藏
            </button>
            <span className="flex-1" />
            <button type="button" onClick={() => onReuse(item)} className={cn(actionButtonClass, "text-slate-500")}>
              复用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UIDesignPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState("");
  const [selectedRatio, setSelectedRatio] = useState<Size>("1792x1024");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_IMAGE_MODEL_VALUE);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [referenceImageBusy, setReferenceImageBusy] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  // 聊天式生成：create=新建一张，edit=改上一张（编辑最新作品）。
  const [composerMode, setComposerMode] = useState<"create" | "edit">("create");
  // 内联「优化」按钮的加载态。
  const [optimizing, setOptimizing] = useState(false);
  // 同步防抖：在 React 状态刷新前拦住连点，避免重复提交导致重复计费。
  const submitLockRef = useRef(false);

  const [feedImages, setFeedImages] = useState<GeneratedImage[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  // 生成中的「用户消息」：提交后立刻作为请求气泡上屏，生成结束清空。
  const [pendingRequest, setPendingRequest] = useState("");
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);

  const { loadModels, imageModelOptions, preferredManagedImageModelValue } = useAiModelOptions();

  const selectedModelOption = useMemo(
    () => imageModelOptions.find((item) => item.value === selectedModel) ?? DEFAULT_IMAGE_MODEL_OPTION,
    [imageModelOptions, selectedModel],
  );
  const selectedRatioOption = ratios.find((item) => item.value === selectedRatio) ?? ratios[1];
  // 列表按时间正序排列（最新在末尾），最新一张即为「改上一张」的目标。
  const latestImage = feedImages.length > 0 ? feedImages[feedImages.length - 1] : null;
  const editModeAvailable = Boolean(latestImage);

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const today = getTodayBounds();
      const response = await apiList(1, 24, { dateFrom: today.start, dateTo: today.end });
      // 接口按时间倒序返回（最新在前）；这里反转为正序，让最新作品显示在列表最下方
      setFeedImages(response.items.slice().reverse());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片列表加载失败");
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
    void loadFeed();
  }, [loadFeed, loadModels]);

  // 作品按时间正序排列（最新在最下方）：列表新增或开始生成时自动滚到底部，确保最新作品/生成中占位卡可见。
  // 仅依赖长度与生成状态，收藏切换等原地更新不会触发滚动。
  useEffect(() => {
    const container = feedScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [feedImages.length, generating]);

  useEffect(() => {
    const currentOption = imageModelOptions.find((item) => item.value === selectedModel);
    if (!currentOption) {
      setSelectedModel(imageModelOptions[0]?.value ?? DEFAULT_IMAGE_MODEL_VALUE);
      return;
    }
    if (selectedModel !== DEFAULT_IMAGE_MODEL_VALUE) return;
    if (preferredManagedImageModelValue) {
      setSelectedModel(preferredManagedImageModelValue);
    }
  }, [imageModelOptions, preferredManagedImageModelValue, selectedModel]);

  // 内联「优化」：把当前输入交给文本模型优化一次，直接回填，不再打开独立面板/会话。
  async function handleInlineOptimize() {
    const source = prompt.trim();
    if (!source) {
      setPromptError("请先填写提示词，再使用 AI 优化描述。");
      composerRef.current?.focus();
      return;
    }
    setPromptError("");
    if (optimizing) return;
    setOptimizing(true);
    try {
      const response = await apiPromptChat({
        current_prompt: source,
        message: DEFAULT_OPTIMIZE_INSTRUCTION,
      });
      if (response.optimizedPrompt.trim()) {
        setPrompt(response.optimizedPrompt.trim());
        toast.success("已优化提示词");
      } else {
        toast.info(response.reply || "未生成优化结果，请补充更多描述后重试");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化失败");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleReferenceFiles(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      toast.error(`参考图最多支持 ${MAX_REFERENCE_IMAGES} 张`);
      return;
    }
    const selectedFiles = files.slice(0, remaining);
    if (selectedFiles.length < files.length) {
      toast.warning(`最多保留 ${MAX_REFERENCE_IMAGES} 张参考图，已忽略多余文件`);
    }

    setReferenceImageBusy(true);
    try {
      const preparedItems: ReferenceImageItem[] = [];
      for (const file of selectedFiles) {
        const prepared = await prepareReferenceImage(file);
        preparedItems.push({
          id: `${Date.now()}-${file.name}-${preparedItems.length}`,
          name: file.name,
          dataUrl: prepared.dataUrl,
          size: prepared.size,
          compressed: prepared.compressed,
        });
      }
      setReferenceImages((current) => [...current, ...preparedItems]);
      const compressedCount = preparedItems.filter((item) => item.compressed).length;
      toast.success(
        compressedCount > 0
          ? `已添加 ${preparedItems.length} 张参考图，${compressedCount} 张已压缩`
          : `已添加 ${preparedItems.length} 张参考图`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图处理失败");
    } finally {
      setReferenceImageBusy(false);
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => current.filter((item) => item.id !== id));
  }

  async function handleGenerate() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setPromptError("请先描述想要生成的画面。");
      composerRef.current?.focus();
      return;
    }
    if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
      setPromptError(`提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符。`);
      composerRef.current?.focus();
      return;
    }
    if (referenceImageBusy) {
      toast.error("参考图仍在处理中，请稍后再生成");
      return;
    }

    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setPromptError("");

    setPendingRequest(normalizedPrompt);
    setGenerating(true);
    try {
      const submitReferences = await prepareReferenceImagesForSubmit(referenceImages);
      if (submitReferences.compressedCount > 0) {
        toast.info(`已为代理压缩 ${submitReferences.compressedCount} 张参考图，总大小 ${formatFileSize(submitReferences.totalSize)}`);
      }
      const result = await apiGenerate({
        prompt: normalizedPrompt,
        style: "vivid" as Style,
        size: selectedRatio,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data_list: submitReferences.dataUrls.length > 0 ? submitReferences.dataUrls : undefined,
        // 网页改为聊天式生成后，始终重新生成，不再走相似度缓存。
        skip_cache: true,
      });
      // 追加到列表末尾：最新生成的图片显示在最下方
      setFeedImages((current) => [...current.filter((item) => item.id !== result.id), result]);
      toast.success("已生成 1 张图像");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setGenerating(false);
      setPendingRequest("");
      submitLockRef.current = false;
    }
  }

  // 「改上一张」：用最新作品作为底图 + 参考图，复用 apiEditImage 走编辑链路（无需后端改动）。
  async function handleEditLatest() {
    const target = latestImage;
    if (!target) {
      setPromptError("还没有可修改的作品，请先生成一张图片。");
      return;
    }
    const message = prompt.trim();
    if (!message) {
      setPromptError("请先描述要如何修改上一张图片。");
      composerRef.current?.focus();
      return;
    }
    if (message.length > MAX_PROMPT_LENGTH) {
      setPromptError(`修改要求不能超过 ${MAX_PROMPT_LENGTH} 个字符。`);
      composerRef.current?.focus();
      return;
    }
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setPromptError("");

    setPendingRequest(message);
    setGenerating(true);
    try {
      let referenceDataUrl: string | undefined;
      if (target.imageData) {
        const sourceReference = await compressDataUrlForUpstream(target.imageData, MAX_UPSTREAM_REFERENCE_IMAGE_BYTES);
        if (sourceReference.compressed) {
          toast.info(`已压缩上一张图片用于提交，大小 ${formatFileSize(sourceReference.size)}`);
        }
        referenceDataUrl = sourceReference.dataUrl;
      }
      const result = await apiEditImage(target.id, {
        message,
        style: "vivid",
        size: target.size,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data: referenceDataUrl,
      });
      // 追加新版本到列表末尾，并清空输入，便于继续对最新版本接力修改。
      setFeedImages((current) => [...current.filter((item) => item.id !== result.id), result]);
      setPrompt("");
      toast.success("已根据修改要求生成新版本");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片修改失败");
    } finally {
      setGenerating(false);
      setPendingRequest("");
      submitLockRef.current = false;
    }
  }

  function handleReuse(item: GeneratedImage) {
    setPrompt(item.revisedPrompt || item.prompt);
    setPromptError("");
    setSelectedRatio(item.size);
    toast.success("已复用该图片提示词");
  }

  async function handleFavorite(item: GeneratedImage) {
    setFavoriteBusyId(item.id);
    try {
      const updated = await apiToggleFavorite(item.id);
      setFeedImages((images) =>
        images.map((image) => (image.id === updated.id ? { ...image, isFavorite: updated.isFavorite } : image)),
      );
      toast.success(updated.isFavorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏状态更新失败");
    } finally {
      setFavoriteBusyId(null);
    }
  }

  function handleComposerSubmit() {
    if (composerMode === "edit") {
      void handleEditLatest();
    } else {
      void handleGenerate();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!generating) handleComposerSubmit();
    }
  }

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1800px] min-w-0 flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5 xl:h-full xl:min-h-0">
      <HorizonPageHeader
        Icon={Wand2}
        eyebrow="AI CREATIVE · IMAGE STUDIO"
        title="AI 图像生成"
        description="在一个连续工作台中完成模型选择、参考图准备、提示词优化、图像生成与版本接力。"
        meta={(
          <>
            <span>{selectedModelOption.provider}</span>
            <span aria-hidden="true">·</span>
            <span>{selectedModelOption.model}</span>
            <span aria-hidden="true">·</span>
            <span>Ctrl / ⌘ + Enter 提交</span>
          </>
        )}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link to={routePath("page:image-library", "/image-library")}><Images className="size-4" />图像作品库</Link>
            </Button>
            <Button asChild className="hz-primary-action">
              <Link to={routePath("page:video-library", "/video-library")}><Sparkles className="size-4" />视频创作</Link>
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 lg:!grid-cols-4">
        <HorizonMetric Icon={Images} label="本页已加载" value={`${feedImages.length}张`} note="今日最近 24 条窗口" tone="brand" />
        <HorizonMetric Icon={Upload} label="参考图" value={`${referenceImages.length}/${MAX_REFERENCE_IMAGES}`} note="提交前自动压缩" />
        <HorizonMetric Icon={Eye} label="当前画幅" value={selectedRatioOption.shortLabel} note={selectedRatioOption.label.replace(/^[\d:]+\s*/, "")} />
        <HorizonMetric Icon={Sparkles} label="生成状态" value={generating ? "处理中" : "就绪"} note={editModeAvailable ? "支持接力修改最新作品" : "等待首张作品"} tone={generating ? "warning" : "success"} />
      </HorizonMetricGrid>

      <div className="flex min-h-[48rem] min-w-0 flex-none flex-col gap-3 xl:min-h-0 xl:flex-1 xl:flex-row">
      {/* 左侧：生成设置（可收起） */}
      {settingsCollapsed ? (
        <aside className="hz-surface flex w-full shrink-0 flex-row items-center gap-3 p-2.5 xl:w-14 xl:flex-col">
          <button
            type="button"
            onClick={() => setSettingsCollapsed(false)}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[12px] border border-border bg-surface-container-low text-slate-600 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="展开生成设置"
            title="展开生成设置"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-primary text-primary-foreground" title="AI 图像生成">
            <Wand2 className="h-4 w-4" />
          </div>
          <Link
            to={routePath("page:image-library", "/image-library")}
            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-border bg-surface-container-low text-slate-600 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="打开图像作品库"
            title="图像作品库"
          >
            <Images className="h-4 w-4" />
          </Link>
        </aside>
      ) : (
        <aside className="hz-surface flex max-h-[32rem] w-full shrink-0 flex-col overflow-hidden xl:max-h-none xl:w-[300px]">
          <HorizonSectionHeader
            Icon={Wand2}
            title="生成设置"
            description="选择模型、画幅与参考图。"
            trailing={(
              <button
                type="button"
                onClick={() => setSettingsCollapsed(true)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-surface-container-low text-slate-500 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label="收起生成设置"
                title="收起生成设置"
              >
                <PanelLeftClose className="size-4" />
              </button>
            )}
          />

          <div className="material-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {/* 模型 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="image-model">
                模型
              </label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger
                  id="image-model"
                  className="material-input h-11 w-full cursor-pointer rounded-[14px] px-4 text-xs font-semibold text-slate-700"
                >
                  <SelectValue placeholder="选择图片模型" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-[14px]">
                  {(imageModelOptions.length > 0 ? imageModelOptions : [DEFAULT_IMAGE_MODEL_OPTION]).map((item) => (
                    <SelectItem key={item.value} value={item.value} className="rounded-[10px] text-xs font-medium">
                      {formatAiModelOptionLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">{selectedModelOption.provider} · {selectedModelOption.model}</p>
            </div>

            {/* 纵横比 */}
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-700">纵横比</div>
              <div className="grid grid-cols-3 gap-2">
                {ratios.map((item) => {
                  const active = item.value === selectedRatio;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setSelectedRatio(item.value)}
                      aria-pressed={active}
                      className={cn(
                        "cursor-pointer rounded-[12px] border px-2 py-2.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                        active
                          ? "border-primary/40 bg-primary-container text-on-primary-container"
                          : "border-border bg-surface-container-low text-slate-600 hover:border-primary/25 hover:bg-white",
                      )}
                    >
                      <div className="text-sm font-semibold">{item.shortLabel}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">{item.label.replace(/^[\d:]+\s*/, "")}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 参考图像 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">参考图像</span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handleReferenceFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={referenceImageBusy || referenceImages.length >= MAX_REFERENCE_IMAGES}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-border bg-surface-container-low px-3 py-4 text-center transition hover:border-primary/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {referenceImageBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                ) : (
                  <Upload className="h-4 w-4 text-slate-400" />
                )}
                <span className="text-xs font-semibold text-slate-600">
                  {referenceImageBusy ? "处理中..." : "上传参考图"}
                </span>
                <span className="text-[10px] text-slate-400">PNG / JPG / WebP，可多选</span>
              </button>
              {referenceImages.length > 0 ? (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {referenceImages.map((item) => (
                    <div key={item.id} className="group relative aspect-square overflow-hidden rounded-[10px] border border-border bg-slate-100">
                      <img src={item.dataUrl} alt={item.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeReferenceImage(item.id)}
                        className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                        aria-label={`移除参考图 ${item.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 p-3">
            <Link
              to={routePath("page:image-library", "/image-library")}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-surface-container-low px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Images className="h-4 w-4" />
              图像作品库（作品 / 用量）
            </Link>
          </div>
        </aside>
      )}

      {/* 中央：生成流 + 底部输入框 */}
      <section className="hz-surface flex min-h-[42rem] min-w-0 flex-1 flex-col overflow-hidden xl:min-h-0">
        <HorizonSectionHeader
          Icon={Sparkles}
          title="生成对话"
          description="请求与结果按时间顺序排列，最新作品位于最下方。"
          trailing={<span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{generating ? "正在生成" : `${feedImages.length} 个结果`}</span>}
        />
        <div ref={feedScrollRef} className="material-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {feedImages.length > 0 ? (
              feedImages.map((item) => (
                <ChatTurn
                  key={item.id}
                  item={item}
                  busy={favoriteBusyId === item.id}
                  onPreview={setPreviewItem}
                  onDownload={(target) => void downloadGeneratedImage(target)}
                  onEdit={setEditingItem}
                  onFavorite={(target) => void handleFavorite(target)}
                  onReuse={handleReuse}
                />
              ))
            ) : !generating ? (
              <div className="flex min-h-[34rem] flex-col items-center justify-center rounded-[16px] border border-dashed border-border bg-surface-container-lowest/70 px-6 py-8 text-center">
                <HorizonEmptyState
                  Icon={Sparkles}
                  title="从一段画面描述开始"
                  description="选择模型、画幅与参考图后，输入想要的画面；生成结果会按时间顺序出现在这里。"
                  action={<Button type="button" variant="outline" onClick={() => composerRef.current?.focus()}>开始描述画面</Button>}
                />
                <div className="mt-5 w-full max-w-sm space-y-2 text-left">
                  <div className="flex items-start gap-2.5 rounded-[12px] border border-border/70 bg-surface-container-lowest px-3 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-container text-[11px] font-semibold text-on-primary-container">
                      1
                    </span>
                    <p className="text-xs leading-5 text-slate-600">
                      写下你想要的画面。<span className="text-slate-400">（可选）</span>点
                      <span className="font-semibold text-slate-800"> 优化描述 </span>
                      让 AI 帮你补成更专业的提示词——
                      <span className="font-semibold text-slate-800">这一步只改文字、不出图</span>。
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5 rounded-[12px] border border-border/70 bg-surface-container-lowest px-3 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      2
                    </span>
                    <p className="text-xs leading-5 text-slate-600">
                      点
                      <span className="font-semibold text-slate-800"> 生成图片 </span>
                      才会真正产出图像；之后还能切到「改上一张」继续微调。
                    </p>
                  </div>
                </div>
                {feedLoading ? (
                  <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    正在加载今天的作品...
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* 生成中：把这一轮当作一条对话，用户气泡 + AI「正在生成」气泡始终在最下方 */}
            {generating ? (
              <div className="space-y-2.5">
                <UserRequestBubble text={pendingRequest} isEdit={composerMode === "edit"} />
                <div className="flex items-start gap-2.5">
                  <AssistantAvatar />
                  <div className="inline-flex items-center gap-2 rounded-[18px] rounded-tl-md border border-border/85 bg-surface-container-lowest px-4 py-3 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-white/70">
                    <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                    正在生成图像，请稍候…
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* 底部输入框 */}
        <div className="shrink-0">
          <div className="hz-surface mx-auto w-full max-w-3xl p-3">
            {/* 模式切换：新建一张 / 改上一张 */}
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-border bg-surface-container-low p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setComposerMode("create")}
                  disabled={generating}
                  aria-pressed={composerMode === "create"}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
                    composerMode === "create" ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建一张
                </button>
                <button
                  type="button"
                  onClick={() => setComposerMode("edit")}
                  disabled={!editModeAvailable || generating}
                  aria-pressed={composerMode === "edit"}
                  title={editModeAvailable ? "在最新一张作品上继续修改" : "先生成一张图片后才能修改"}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
                    composerMode === "edit" ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  改上一张
                </button>
              </div>
              {composerMode === "edit" && latestImage ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-container-low py-0.5 pl-0.5 pr-2.5 text-[11px] font-semibold text-slate-500">
                  <img
                    src={latestImage.imageUrl || latestImage.imageData}
                    alt="上一张作品"
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                  <span className="truncate">正在修改最新作品</span>
                </span>
              ) : null}
            </div>

            <label htmlFor="image-studio-prompt" className="sr-only">图像生成提示词</label>
            <textarea
              ref={composerRef}
              id="image-studio-prompt"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (promptError) setPromptError("");
              }}
              onKeyDown={handleComposerKeyDown}
              maxLength={MAX_PROMPT_LENGTH}
              aria-invalid={Boolean(promptError)}
              aria-describedby={promptError ? "image-studio-prompt-error" : undefined}
              placeholder={
                composerMode === "edit"
                  ? "描述要怎么修改上一张图片，例如：把背景换成纯白、增加暖色灯光、把主体放大一些…"
                  : "描述你想要的画面，例如：放在原木桌面上的智能手表产品图，柔和自然光，电商主图风格…"
              }
              className="h-24 w-full resize-none rounded-[14px] border border-border bg-surface-container-lowest px-3.5 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10 aria-invalid:border-red-300 aria-invalid:ring-red-100"
            />
            {promptError ? <p id="image-studio-prompt-error" role="alert" className="mt-2 text-pretty text-xs font-medium text-red-600">{promptError}</p> : null}
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                <span className="truncate rounded-full border border-border bg-surface-container-low px-2.5 py-1">
                  {formatAiModelOptionLabel(selectedModelOption)}
                </span>
                <span className="rounded-full border border-border bg-surface-container-low px-2.5 py-1">{selectedRatioOption.shortLabel}</span>
                {referenceImages.length > 0 ? (
                  <span className="rounded-full border border-border bg-surface-container-low px-2.5 py-1">参考图 {referenceImages.length}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {composerMode === "create" ? (
                  <button
                    type="button"
                    onClick={() => void handleInlineOptimize()}
                    disabled={optimizing || generating || !prompt.trim()}
                    title="只改文字不出图：让 AI 把当前描述补全为更专业的提示词并回填"
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[14px] border border-border bg-surface-container-low px-3 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {optimizing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Wand2 className="h-4 w-4" />}
                    {optimizing ? "优化中..." : "优化描述"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleComposerSubmit}
                  disabled={generating || !prompt.trim() || (composerMode === "edit" && !editModeAvailable)}
                  title={composerMode === "edit" ? "在最新一张作品上按描述生成新版本" : "按当前描述真正产出一张图片"}
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  ) : composerMode === "edit" ? (
                    <PencilLine className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generating
                    ? composerMode === "edit"
                      ? "修改中..."
                      : "生成中..."
                    : composerMode === "edit"
                      ? "修改上一张"
                      : "生成图片"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* 弹窗：图片预览 / 图片修改 */}
      {previewItem ? <ImagePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} /> : null}

      {editingItem ? (
        <ImageEditModal
          item={editingItem}
          modelOption={selectedModelOption}
          onClose={() => setEditingItem(null)}
          onUpdated={(updated) => {
            setFeedImages((images) => {
              const exists = images.some((image) => image.id === updated.id);
              return exists
                ? images.map((image) => (image.id === updated.id ? updated : image))
                : [...images, updated];
            });
          }}
          onReuse={(target) => {
            handleReuse(target);
            setEditingItem(null);
          }}
        />
      ) : null}
    </div>
  );
}
