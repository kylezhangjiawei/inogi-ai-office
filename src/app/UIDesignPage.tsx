import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import {
  Clock3,
  Download,
  Eye,
  Heart,
  Images,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  apiCreatePromptSession,
  apiGenerate,
  apiList,
  apiPromptChat,
  apiPromptSession,
  apiPromptSessions,
  apiToggleFavorite,
  downloadGeneratedImage,
  formatFileSize,
  formatImageCost,
  formatTime,
  GeneratingImageCard,
  getTodayBounds,
  glassCard,
  ImageEditModal,
  ImagePreviewModal,
  MAX_PROMPT_LENGTH,
  MAX_REFERENCE_IMAGES,
  prepareReferenceImage,
  prepareReferenceImagesForSubmit,
  ratios,
  type GeneratedImage,
  type PromptChatMessage,
  type PromptChatSession,
  type ReferenceImageItem,
  type Size,
  type Style,
} from "./imageStudioShared";

const promptOptimizerSuggestions = [
  "更适合电商主图，突出产品卖点和干净背景",
  "增强商业海报质感，补充构图、材质和电影级光影",
  "保持原意，压缩成更清晰可控的专业图像提示词",
];

// 中央生成流的单条作品卡：图片为主角，动作常驻可见。
function FeedBlock({
  item,
  index,
  busy,
  onPreview,
  onDownload,
  onEdit,
  onFavorite,
  onReuse,
}: {
  item: GeneratedImage;
  index: number;
  busy: boolean;
  onPreview: (item: GeneratedImage) => void;
  onDownload: (item: GeneratedImage) => void;
  onEdit: (item: GeneratedImage) => void;
  onFavorite: (item: GeneratedImage) => void;
  onReuse: (item: GeneratedImage) => void;
}) {
  const title = item.revisedPrompt || item.prompt;
  return (
    <article className="overflow-hidden rounded-[16px] border border-border/85 bg-surface-container-lowest shadow-[0_18px_44px_rgba(15,23,42,0.06)] ring-1 ring-white/70">
      <div className="flex items-start gap-3 px-5 pt-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-[11px] font-semibold text-on-primary-container">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>{item.model}</span>
            <span>{formatTime(item.createdAt)}</span>
            <span className="font-mono tabular-nums text-slate-700">{formatImageCost(item)}</span>
            {item.fromCache ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                缓存命中
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onReuse(item)}
          className="shrink-0 cursor-pointer rounded-[10px] border border-border bg-surface-container-low px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          复用
        </button>
      </div>
      <button
        type="button"
        onClick={() => onPreview(item)}
        className="group relative mt-3 block w-full cursor-zoom-in overflow-hidden bg-slate-100"
      >
        <img
          src={item.imageUrl || item.imageData}
          alt={item.prompt}
          className="mx-auto max-h-[58vh] w-full object-contain transition duration-200 group-hover:opacity-95"
        />
      </button>
      <div className="grid grid-cols-4 border-t border-border/70 text-xs font-semibold text-slate-600">
        <button
          type="button"
          onClick={() => onPreview(item)}
          className="flex cursor-pointer items-center justify-center gap-1.5 py-2.5 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
          <Eye className="h-3.5 w-3.5" />
          预览
        </button>
        <button
          type="button"
          onClick={() => onDownload(item)}
          className="flex cursor-pointer items-center justify-center gap-1.5 border-l border-border/70 py-2.5 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
          <Download className="h-3.5 w-3.5" />
          下载
        </button>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="flex cursor-pointer items-center justify-center gap-1.5 border-l border-border/70 py-2.5 transition hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
          <PencilLine className="h-3.5 w-3.5" />
          修改
        </button>
        <button
          type="button"
          onClick={() => onFavorite(item)}
          disabled={busy}
          className="flex cursor-pointer items-center justify-center gap-1.5 border-l border-border/70 py-2.5 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Heart className={cn("h-3.5 w-3.5", item.isFavorite ? "fill-rose-500 text-rose-500" : "")} />
          )}
          收藏
        </button>
      </div>
    </article>
  );
}

export function UIDesignPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedRatio, setSelectedRatio] = useState<Size>("1792x1024");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_IMAGE_MODEL_VALUE);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [referenceImageBusy, setReferenceImageBusy] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [skipCache, setSkipCache] = useState(false);

  const [feedImages, setFeedImages] = useState<GeneratedImage[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | null>(null);
  const [editingItem, setEditingItem] = useState<GeneratedImage | null>(null);

  const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
  const [promptOptimizerSourcePrompt, setPromptOptimizerSourcePrompt] = useState("");
  const [promptChatSessions, setPromptChatSessions] = useState<PromptChatSession[]>([]);
  const [activePromptChatSessionId, setActivePromptChatSessionId] = useState("");
  const [promptChatSessionsLoading, setPromptChatSessionsLoading] = useState(false);
  const [promptChatMessages, setPromptChatMessages] = useState<PromptChatMessage[]>([]);
  const [promptChatInput, setPromptChatInput] = useState("");
  const [promptChatLoading, setPromptChatLoading] = useState(false);
  const [promptChatModel, setPromptChatModel] = useState("");

  const { loadModels, imageModelOptions, chatModelOptions, preferredManagedImageModelValue } = useAiModelOptions();

  const selectedModelOption = useMemo(
    () => imageModelOptions.find((item) => item.value === selectedModel) ?? DEFAULT_IMAGE_MODEL_OPTION,
    [imageModelOptions, selectedModel],
  );
  const selectedPromptModelOption = useMemo(
    () => chatModelOptions.find((item) => item.value === promptChatModel) ?? chatModelOptions[0],
    [chatModelOptions, promptChatModel],
  );
  const selectedRatioOption = ratios.find((item) => item.value === selectedRatio) ?? ratios[1];
  const promptSummary = prompt.trim() || "填写提示词后会显示摘要";
  const latestOptimizedPrompt =
    [...promptChatMessages].reverse().find((item) => item.optimizedPrompt)?.optimizedPrompt ?? "";

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const today = getTodayBounds();
      const response = await apiList(1, 24, { dateFrom: today.start, dateTo: today.end });
      setFeedImages(response.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片列表加载失败");
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadPromptSessions = useCallback(async () => {
    setPromptChatSessionsLoading(true);
    try {
      const sessions = await apiPromptSessions();
      setPromptChatSessions(sessions);
      if (!activePromptChatSessionId && sessions[0]) {
        const detail = await apiPromptSession(sessions[0].id);
        setActivePromptChatSessionId(detail.session.id);
        setPromptOptimizerSourcePrompt(detail.session.sourcePrompt || prompt.trim());
        setPromptChatMessages(detail.messages);
        if (detail.session.currentPrompt.trim()) {
          setPrompt(detail.session.currentPrompt.trim());
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化会话加载失败");
    } finally {
      setPromptChatSessionsLoading(false);
    }
  }, [activePromptChatSessionId, prompt]);

  const openPromptChatSession = useCallback(
    async (sessionId: string) => {
      setPromptChatSessionsLoading(true);
      try {
        const detail = await apiPromptSession(sessionId);
        setActivePromptChatSessionId(detail.session.id);
        setPromptOptimizerSourcePrompt(detail.session.sourcePrompt || prompt.trim());
        setPromptChatMessages(detail.messages);
        if (detail.session.currentPrompt.trim()) {
          setPrompt(detail.session.currentPrompt.trim());
        }
        setPromptChatInput("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "提示词优化会话加载失败");
      } finally {
        setPromptChatSessionsLoading(false);
      }
    },
    [prompt],
  );

  const createPromptChatSession = useCallback(async () => {
    setPromptChatSessionsLoading(true);
    try {
      const sourcePrompt = prompt.trim();
      const detail = await apiCreatePromptSession({ source_prompt: sourcePrompt, current_prompt: sourcePrompt });
      setPromptChatSessions((current) => [detail.session, ...current.filter((item) => item.id !== detail.session.id)]);
      setActivePromptChatSessionId(detail.session.id);
      setPromptOptimizerSourcePrompt(detail.session.sourcePrompt);
      setPromptChatMessages(detail.messages);
      setPromptChatInput("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提示词优化会话创建失败");
    } finally {
      setPromptChatSessionsLoading(false);
    }
  }, [prompt]);

  useEffect(() => {
    void loadModels();
    void loadFeed();
  }, [loadFeed, loadModels]);

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

  useEffect(() => {
    if (promptChatModel && chatModelOptions.some((item) => item.value === promptChatModel)) return;
    setPromptChatModel(chatModelOptions[0]?.value ?? "");
  }, [promptChatModel, chatModelOptions]);

  function openPromptOptimizer() {
    setPromptOptimizerSourcePrompt(prompt.trim());
    setPromptOptimizerOpen(true);
    void loadPromptSessions();
  }

  async function handlePromptChatSend() {
    const message = promptChatInput.trim();
    if (!message) {
      toast.error("请先输入优化要求");
      return;
    }

    const userMessage: PromptChatMessage = { id: `user-${Date.now()}`, role: "user", content: message };
    const history = promptChatMessages.map((item) => ({
      role: item.role,
      content: item.optimizedPrompt ? `${item.content}\n优化结果：${item.optimizedPrompt}` : item.content,
    }));
    setPromptChatMessages((current) => [...current, userMessage]);
    setPromptChatInput("");
    setPromptChatLoading(true);

    try {
      let sessionId = activePromptChatSessionId;
      if (!sessionId) {
        const sourcePrompt = prompt.trim();
        const detail = await apiCreatePromptSession({ source_prompt: sourcePrompt, current_prompt: sourcePrompt });
        sessionId = detail.session.id;
        setPromptChatSessions((current) => [detail.session, ...current.filter((item) => item.id !== detail.session.id)]);
        setActivePromptChatSessionId(detail.session.id);
        setPromptOptimizerSourcePrompt(detail.session.sourcePrompt);
      }
      const response = await apiPromptChat({
        session_id: sessionId,
        current_prompt: prompt.trim(),
        message,
        history,
        model_id: selectedPromptModelOption?.managed ? selectedPromptModelOption.modelId : undefined,
        model: selectedPromptModelOption?.model,
      });
      setPromptChatSessions((current) => [response.session, ...current.filter((item) => item.id !== response.session.id)]);
      setActivePromptChatSessionId(response.session.id);
      setPromptOptimizerSourcePrompt(response.session.sourcePrompt);
      setPromptChatMessages(response.messages);
      if (response.optimizedPrompt.trim()) {
        setPrompt(response.optimizedPrompt.trim());
        toast.success("优化后的提示词已回填");
      }
    } catch (error) {
      setPromptChatMessages((current) => current.filter((item) => item.id !== userMessage.id));
      toast.error(error instanceof Error ? error.message : "提示词优化失败");
    } finally {
      setPromptChatLoading(false);
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
      toast.error("请先填写图像提示词");
      return;
    }
    if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
      toast.error(`提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符`);
      return;
    }
    if (referenceImageBusy) {
      toast.error("参考图仍在处理中，请稍后再生成");
      return;
    }

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
        skip_cache: skipCache,
      });
      setFeedImages((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      toast.success(result.fromCache ? "命中缓存，已返回相同图像" : "已生成 1 张图像");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(promptSummary);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  function handleReuse(item: GeneratedImage) {
    setPrompt(item.revisedPrompt || item.prompt);
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!generating) void handleGenerate();
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* 左侧：生成设置（可收起） */}
      {settingsCollapsed ? (
        <aside className={cn("flex w-14 shrink-0 flex-col items-center gap-3 rounded-[16px] p-2.5", glassCard)}>
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
            to="/image-library"
            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-border bg-surface-container-low text-slate-600 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="打开图像作品库"
            title="图像作品库"
          >
            <Images className="h-4 w-4" />
          </Link>
        </aside>
      ) : (
        <aside className={cn("flex w-[300px] shrink-0 flex-col rounded-[16px]", glassCard)}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
                <Wand2 className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-950">AI 图像生成</div>
                <div className="text-[11px] text-slate-500">设置好后在下方输入提示词</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsCollapsed(true)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-surface-container-low text-slate-500 transition hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              aria-label="收起生成设置"
              title="收起生成设置"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

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
              to="/image-library"
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-surface-container-low px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <Images className="h-4 w-4" />
              图像作品库（作品 / 用量）
            </Link>
          </div>
        </aside>
      )}

      {/* 中央：生成流 + 底部输入框 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {generating ? <GeneratingImageCard /> : null}
            {feedImages.length > 0 ? (
              feedImages.map((item, index) => (
                <FeedBlock
                  key={item.id}
                  item={item}
                  index={index}
                  busy={favoriteBusyId === item.id}
                  onPreview={setPreviewItem}
                  onDownload={(target) => void downloadGeneratedImage(target)}
                  onEdit={setEditingItem}
                  onFavorite={(target) => void handleFavorite(target)}
                  onReuse={handleReuse}
                />
              ))
            ) : !generating ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-[16px] border border-dashed border-border bg-surface-container-lowest/70 px-6 py-12 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-primary-container text-on-primary-container">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-base font-semibold text-slate-950">在下方输入提示词，开始生成图像</h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                  选好左侧的模型、纵横比与参考图，描述你想要的画面即可。今天生成的作品会按时间倒序出现在这里。
                </p>
                {feedLoading ? (
                  <div className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    正在加载今天的作品...
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 底部输入框 */}
        <div className="shrink-0">
          <div className={cn("mx-auto w-full max-w-3xl rounded-[18px] p-3", glassCard)}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="描述你想要的画面，例如：放在原木桌面上的智能手表产品图，柔和自然光，电商主图风格…"
              className="h-24 w-full resize-none rounded-[14px] border border-border bg-surface-container-lowest px-3.5 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
            />
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                <span className="truncate rounded-full border border-border bg-surface-container-low px-2.5 py-1">
                  {formatAiModelOptionLabel(selectedModelOption)}
                </span>
                <span className="rounded-full border border-border bg-surface-container-low px-2.5 py-1">{selectedRatioOption.shortLabel}</span>
                {referenceImages.length > 0 ? (
                  <span className="rounded-full border border-border bg-surface-container-low px-2.5 py-1">参考图 {referenceImages.length}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSkipCache((value) => !value)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    skipCache
                      ? "border-primary/40 bg-primary-container text-on-primary-container"
                      : "border-border bg-surface-container-low text-slate-500 hover:border-primary/25",
                  )}
                  title="开启后忽略缓存，强制重新生成"
                >
                  <RefreshCw className="h-3 w-3" />
                  跳过缓存
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openPromptOptimizer}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[14px] border border-border bg-surface-container-low px-3 text-xs font-semibold text-slate-600 transition hover:border-primary/30 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <MessageSquare className="h-4 w-4" />
                  优化提示词
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={generating || !prompt.trim()}
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[14px] bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="h-4 w-4" />}
                  {generating ? "生成中..." : "生成"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 弹窗：图片预览 / 图片修改 / 提示词优化 */}
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
                : [updated, ...images];
            });
          }}
          onReuse={(target) => {
            handleReuse(target);
            setEditingItem(null);
          }}
        />
      ) : null}

      {promptOptimizerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/42 p-3 backdrop-blur-sm md:p-5" role="dialog" aria-modal="true">
          <div className="flex max-h-[calc(100vh-32px)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <MessageSquare className="h-4 w-4 text-indigo-500" />
                  AI 提示词优化
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-indigo-700">自动回填</span>
                  <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                    {latestOptimizedPrompt ? "已有优化结果" : "等待优化"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600">
                    {selectedPromptModelOption ? formatAiModelOptionLabel(selectedPromptModelOption) : "默认文本模型"}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {latestOptimizedPrompt ? (
                  <button
                    type="button"
                    className="h-9 cursor-pointer rounded-[14px] border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    onClick={() => {
                      setPrompt(latestOptimizedPrompt);
                      toast.success("已应用最新优化提示词");
                    }}
                  >
                    应用最新结果
                  </button>
                ) : null}
                <button
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                  type="button"
                  onClick={() => setPromptOptimizerOpen(false)}
                  aria-label="关闭提示词优化"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
              <aside className="flex min-h-0 max-h-[34vh] flex-col border-b border-slate-200 bg-white lg:max-h-none lg:border-b-0 lg:border-r">
                <div className="shrink-0 border-b border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">优化会话</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">
                        {promptChatSessions.length.toLocaleString("zh-CN")} 个记录
                      </div>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[14px] bg-indigo-600 text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void createPromptChatSession()}
                      disabled={promptChatSessionsLoading || promptChatLoading}
                      aria-label="新建提示词优化对话"
                    >
                      {promptChatSessionsLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="material-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {promptChatSessionsLoading && promptChatSessions.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-xs font-semibold text-slate-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-indigo-500 motion-reduce:animate-none" />
                      加载会话...
                    </div>
                  ) : promptChatSessions.length > 0 ? (
                    promptChatSessions.map((session) => {
                      const active = session.id === activePromptChatSessionId;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={cn(
                            "w-full cursor-pointer rounded-[16px] border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                            active
                              ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                              : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-indigo-100 hover:bg-white",
                          )}
                          onClick={() => void openPromptChatSession(session.id)}
                          disabled={promptChatLoading}
                        >
                          <div className="line-clamp-2 text-xs font-semibold leading-5">{session.title || "新提示词对话"}</div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {session.messageCount}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatTime(session.updatedAt)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/80 p-4 text-xs leading-5 text-slate-500">
                      暂无历史对话。点击上方加号创建一个新的提示词优化聊天框。
                    </div>
                  )}
                </div>
              </aside>
              <div className="flex min-h-0 flex-col bg-slate-50/60">
                <div className="material-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                  {promptChatMessages.length > 0 ? (
                    promptChatMessages.map((message) => {
                      const isUser = message.role === "user";
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "max-w-[86%] rounded-[18px] px-4 py-3 text-sm leading-6 shadow-sm",
                            isUser ? "ml-auto bg-indigo-600 text-white" : "mr-auto border border-slate-200 bg-white text-slate-700",
                          )}
                        >
                          <div>{message.content}</div>
                          {message.optimizedPrompt ? (
                            <div className="mt-3 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-slate-700">
                              <div className="mb-1 font-semibold text-emerald-700">已回填到输入框</div>
                              <div className="whitespace-pre-wrap">{message.optimizedPrompt}</div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-slate-200 bg-white/82 p-5">
                      <div className="text-sm font-semibold text-slate-800">选择一个方向或直接输入</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {promptOptimizerSuggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                            onClick={() => setPromptChatInput(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {promptChatLoading ? (
                    <div className="mr-auto inline-flex items-center gap-2 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500 motion-reduce:animate-none" />
                      正在优化提示词...
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                  <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="prompt-optimizer-input">
                    优化要求
                  </label>
                  <textarea
                    id="prompt-optimizer-input"
                    className="h-24 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                    value={promptChatInput}
                    onChange={(event) => setPromptChatInput(event.target.value)}
                    maxLength={8000}
                    placeholder="例如：更突出产品卖点，补充材质、构图和灯光细节"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-400">{promptChatInput.length.toLocaleString("zh-CN")} / 8,000</div>
                    <button
                      type="button"
                      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={promptChatLoading || !promptChatInput.trim()}
                      onClick={() => void handlePromptChatSend()}
                    >
                      {promptChatLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
                      发送优化要求
                    </button>
                  </div>
                </div>
              </div>

              <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0">
                <div className="grid shrink-0 grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-semibold text-slate-500">对话轮次</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{promptChatMessages.filter((item) => item.role === "user").length}</div>
                  </div>
                  <div className="rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <div className="font-semibold text-emerald-700">回填状态</div>
                    <div className="mt-1 text-sm font-semibold text-emerald-800">{latestOptimizedPrompt ? "已更新" : "未更新"}</div>
                  </div>
                </div>

                <div className="mt-4 shrink-0">
                  <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="prompt-optimizer-model">
                    优化模型
                  </label>
                  <Select
                    value={promptChatModel || undefined}
                    onValueChange={setPromptChatModel}
                    disabled={promptChatLoading || chatModelOptions.length === 0}
                  >
                    <SelectTrigger
                      id="prompt-optimizer-model"
                      className="material-input h-11 w-full cursor-pointer rounded-[16px] px-4 text-xs font-semibold text-slate-700"
                    >
                      <SelectValue placeholder="使用后端默认文本模型" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 rounded-[14px]">
                      {chatModelOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value} className="rounded-[10px] text-xs font-medium">
                          {formatAiModelOptionLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    这里仅显示文本 AI 模型；图像模型仍在左侧设置中选择。
                  </p>
                </div>

                <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-hidden">
                  <div className="flex min-h-0 flex-col">
                    <div className="mb-2 text-xs font-semibold text-slate-700">打开弹框时的提示词</div>
                    <div className="material-scrollbar max-h-[150px] overflow-y-auto rounded-[16px] border border-slate-200 bg-slate-50/80 p-3 text-xs leading-6 text-slate-500">
                      {promptOptimizerSourcePrompt || "打开时提示词为空"}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">当前回填提示词</span>
                      <button
                        type="button"
                        className="cursor-pointer rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                        onClick={() => void handleCopyPrompt()}
                      >
                        复制
                      </button>
                    </div>
                    <div className="material-scrollbar max-h-[260px] overflow-y-auto rounded-[16px] border border-indigo-100 bg-indigo-50/70 p-3 text-xs leading-6 text-slate-700">
                      {prompt.trim() || "AI 会根据你的优化要求创建一版完整提示词。"}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
