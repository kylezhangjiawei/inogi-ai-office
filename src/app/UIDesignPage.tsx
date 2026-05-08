import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  Eye,
  Heart,
  Layers3,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "./components/ui/utils";
import { authFetch, readErrorMessage } from "./lib/authSession";
import { AiModelItem, integrationManagementApi } from "./lib/integrationManagementApi";

type ArtworkVariant = "product" | "brand" | "ui" | "metallic";
type Style = "vivid" | "natural";
type Size = "1024x1024" | "1792x1024" | "1024x1792";
type Quality = "standard" | "hd";
type StudioTab = "当前" | "历史" | "收藏";

type GeneratedImage = {
  id: string;
  prompt: string;
  revisedPrompt: string;
  style: Style;
  size: Size;
  quality: Quality;
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

type MockArtwork = {
  id: number;
  title: string;
  description: string;
  variant: ArtworkVariant;
};

type ModelOption = {
  value: string;
  label: string;
  description: string;
  provider: string;
  model: string;
  modelId?: string;
  managed: boolean;
};

const DEFAULT_MODEL_VALUE = "__openai_image_to_image__";
const DEFAULT_MODEL_OPTION: ModelOption = {
  value: DEFAULT_MODEL_VALUE,
  label: "OpenAI Image 2 Image",
  description: "默认使用 OpenAI gpt-image-1，支持参考图生图与高质量图片生成。",
  provider: "OpenAI",
  model: "gpt-image-1",
  managed: false,
};

const defaultPrompt =
  "未来科技产品展示，蓝紫渐变背景，玻璃拟态，金属材质，高端商业海报";
const MAX_PROMPT_LENGTH = 32_000;

const templates = [
  { label: "产品海报", prompt: "商业产品海报，突出主体卖点、材质细节和高端质感" },
  { label: "品牌视觉", prompt: "品牌 Campaign 主视觉，统一蓝紫品牌色和高级光影" },
  { label: "社媒封面", prompt: "适合社媒传播的封面图，主体清晰，画面有记忆点" },
  { label: "UI 概念", prompt: "未来感 UI 概念图，悬浮卡片、发光线条和空间层次" },
  { label: "电商主图", prompt: "电商商品主图，干净背景，突出产品细节与购买欲" },
];

const styleOptions: Array<{ label: string; apiStyle: Style; prompt: string }> = [
  { label: "超写实", apiStyle: "vivid", prompt: "超写实渲染，真实材质，电影级布光" },
  { label: "极简商务", apiStyle: "natural", prompt: "极简商务风格，留白克制，构图清晰" },
  { label: "未来科技", apiStyle: "vivid", prompt: "未来科技风格，蓝紫光效，玻璃拟态和金属材质" },
  { label: "柔和插画", apiStyle: "natural", prompt: "柔和插画风格，温和色彩，细腻层次" },
];

const ratios: Array<{ label: string; value: Size; shortLabel: string }> = [
  { label: "1:1 方图", value: "1024x1024", shortLabel: "1:1" },
  { label: "16:9 横图", value: "1792x1024", shortLabel: "16:9" },
  { label: "9:16 竖图", value: "1024x1792", shortLabel: "9:16" },
];

const mockArtworks: MockArtwork[] = [
  {
    id: 1,
    title: "未来科技产品海报",
    description: "蓝紫渐变、玻璃拟态、旗舰产品主视觉",
    variant: "product",
  },
  {
    id: 2,
    title: "现代品牌战役视觉",
    description: "抽象 3D 几何形体与精修商业光感",
    variant: "brand",
  },
  {
    id: 3,
    title: "未来感 UI 横幅",
    description: "发光界面线条与悬浮信息卡片",
    variant: "ui",
  },
  {
    id: 4,
    title: "高端商业质感视觉",
    description: "金属材质、柔和棚拍光、精致成片质感",
    variant: "metallic",
  },
];

const suggestions = [
  { title: "补充主体细节", prompt: "主体细节更明确，包含形态、材质、比例和核心卖点" },
  { title: "强化光影风格", prompt: "增加电影级布光、柔和边缘光和高级反射质感" },
  { title: "突出品牌色彩", prompt: "统一蓝紫品牌色，加入细腻渐变和商业海报层次" },
];

const glassCard =
  "border border-white/70 bg-white/68 shadow-[0_20px_60px_rgba(78,91,148,0.14)] backdrop-blur-2xl";

async function apiGenerate(body: {
  prompt: string;
  style: Style;
  size: Size;
  quality: Quality;
  model_id?: string;
  model?: string;
  reference_image_data?: string;
  skip_cache?: boolean;
}): Promise<GeneratedImage> {
  const response = await authFetch("/api/image-generation/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片生成失败"));
  }
  return response.json() as Promise<GeneratedImage>;
}

async function apiList(page: number, pageSize: number, favorite = false): Promise<ListResponse> {
  const response = await authFetch(
    `/api/image-generation/images?page=${page}&pageSize=${pageSize}&favorite=${favorite}`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "图片列表加载失败"));
  }
  return response.json() as Promise<ListResponse>;
}

async function apiToggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const response = await authFetch(`/api/image-generation/images/${id}/favorite`, { method: "PATCH" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "收藏状态更新失败"));
  }
  return response.json() as Promise<{ id: string; isFavorite: boolean }>;
}

function isImageToImageModel(model: string) {
  const normalized = model.toLowerCase();
  return normalized.includes("gpt-image") || normalized.includes("image-to-image") || normalized === "dall-e-2";
}

function toModelOption(item: AiModelItem): ModelOption {
  return {
    value: item.id,
    label: item.name || item.model,
    description: `${item.provider || "OpenAI"} / ${item.model}${item.current_status ? ` · ${item.current_status}` : ""}`,
    provider: item.provider || "OpenAI",
    model: item.model,
    modelId: item.id,
    managed: true,
  };
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function MiniPreview({ variant, imageData }: { variant?: ArtworkVariant; imageData?: string }) {
  return (
    <div className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl border border-white/70 bg-slate-100">
      {imageData ? (
        <img src={imageData} alt="" className="h-full w-full object-cover" />
      ) : (
        <ArtworkVisual variant={variant ?? "product"} compact />
      )}
    </div>
  );
}

function ArtworkVisual({ variant, compact = false }: { variant: ArtworkVariant; compact?: boolean }) {
  const base =
    variant === "product"
      ? "linear-gradient(135deg,#201a54 0%,#4662ff 48%,#49d5ff 100%)"
      : variant === "brand"
        ? "linear-gradient(135deg,#f8fbff 0%,#dfe8ff 42%,#bba7ff 100%)"
        : variant === "ui"
          ? "linear-gradient(135deg,#101a40 0%,#2746b8 52%,#8d6bff 100%)"
          : "linear-gradient(135deg,#f7f2ff 0%,#dee8ff 36%,#aeb9cc 100%)";

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: base }}>
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18),transparent_34%,rgba(255,255,255,0.16)_72%,transparent)]" />

      {variant === "product" ? (
        <>
          <div
            className={cn(
              "absolute rounded-[24px] border border-white/34 bg-white/18 shadow-2xl backdrop-blur-md",
              compact ? "left-5 top-3 h-9 w-6" : "left-[38%] top-[18%] h-[58%] w-[24%]",
            )}
          />
          <div className={cn("absolute rounded-full bg-cyan-200/80 blur-md", compact ? "right-3 top-5 h-5 w-5" : "right-[22%] top-[25%] h-20 w-20")} />
          <div
            className={cn(
              "absolute border border-white/28 bg-white/14 backdrop-blur-md",
              compact ? "bottom-2 left-2 h-3 w-9 rounded-md" : "bottom-[16%] left-[18%] h-14 w-[42%] rounded-2xl",
            )}
          />
          <div className={cn("absolute bg-white/70", compact ? "bottom-3 right-3 h-px w-7" : "bottom-[24%] right-[16%] h-px w-[26%]")} />
        </>
      ) : null}

      {variant === "brand" ? (
        <>
          <div className={cn("absolute rotate-[-14deg] rounded-[32px] bg-gradient-to-br from-white/85 to-violet-200/80 shadow-xl", compact ? "left-3 top-3 h-7 w-7" : "left-[16%] top-[16%] h-[34%] w-[24%]")} />
          <div className={cn("absolute rounded-full bg-gradient-to-br from-blue-400 to-violet-500 shadow-2xl", compact ? "right-3 top-4 h-6 w-6" : "right-[18%] top-[20%] h-[30%] w-[24%]")} />
          <div className={cn("absolute rotate-[18deg] rounded-[28px] bg-white/54 backdrop-blur-md", compact ? "bottom-2 left-5 h-4 w-8" : "bottom-[18%] left-[32%] h-[24%] w-[34%]")} />
        </>
      ) : null}

      {variant === "ui" ? (
        <>
          <div className={cn("absolute rounded-2xl border border-white/24 bg-white/16 backdrop-blur-md", compact ? "left-2 top-2 h-5 w-9" : "left-[13%] top-[18%] h-[24%] w-[36%]")} />
          <div className={cn("absolute rounded-2xl border border-cyan-200/26 bg-cyan-100/14 backdrop-blur-md", compact ? "right-2 top-5 h-6 w-8" : "right-[12%] top-[32%] h-[30%] w-[34%]")} />
          <div className={cn("absolute rounded-full bg-cyan-200/90", compact ? "left-4 bottom-3 h-1 w-8" : "left-[18%] bottom-[22%] h-1.5 w-[46%]")} />
          <div className={cn("absolute rounded-full bg-violet-200/90", compact ? "left-4 bottom-5 h-1 w-6" : "left-[22%] bottom-[32%] h-1.5 w-[34%]")} />
        </>
      ) : null}

      {variant === "metallic" ? (
        <>
          <div className={cn("absolute rounded-full bg-[linear-gradient(135deg,#ffffff_0%,#aeb8d6_42%,#798299_100%)] shadow-2xl", compact ? "left-3 top-3 h-7 w-7" : "left-[21%] top-[20%] h-[38%] w-[28%]")} />
          <div className={cn("absolute rotate-[12deg] rounded-[28px] bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(125,139,171,0.52))] shadow-xl", compact ? "right-3 bottom-3 h-5 w-8" : "right-[16%] bottom-[20%] h-[26%] w-[34%]")} />
          <div className={cn("absolute bg-white/76 blur-sm", compact ? "left-2 bottom-2 h-px w-10" : "left-[18%] bottom-[18%] h-1 w-[54%]")} />
        </>
      ) : null}
    </div>
  );
}

function ArtworkCard({
  item,
  index,
  busy,
  onPreview,
  onDownload,
  onEdit,
  onFavorite,
}: {
  item: GeneratedImage | MockArtwork;
  index: number;
  busy?: boolean;
  onPreview: (item: GeneratedImage | MockArtwork) => void;
  onDownload: (item: GeneratedImage | MockArtwork) => void;
  onEdit: (item: GeneratedImage | MockArtwork) => void;
  onFavorite: (item: GeneratedImage | MockArtwork) => void;
}) {
  const generated = "imageData" in item;
  const title = generated ? item.revisedPrompt || item.prompt : item.title;
  const description = generated ? `${item.model} · ${formatTime(item.createdAt)}` : item.description;

  return (
    <article className="group overflow-hidden rounded-[20px] border border-white/72 bg-white/72 shadow-[0_20px_52px_rgba(51,65,120,0.16)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_70px_rgba(82,91,170,0.22)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        {generated ? (
          <img src={item.imageData} alt={item.prompt} className="h-full w-full object-cover" />
        ) : (
          <ArtworkVisual variant={item.variant} />
        )}
        <div className="absolute left-4 top-4 rounded-full border border-white/45 bg-white/28 px-3 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md">
          {String(index + 1).padStart(2, "0")}
        </div>
        {generated && item.fromCache ? (
          <div className="absolute right-4 top-4 rounded-full border border-emerald-100 bg-emerald-50/88 px-3 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur-md">
            缓存命中
          </div>
        ) : null}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-2xl border border-white/54 bg-white/34 px-3 py-2 text-[11px] font-semibold text-slate-800 opacity-95 shadow-[0_12px_28px_rgba(30,41,80,0.18)] backdrop-blur-xl">
          <button className="flex items-center gap-1.5 transition hover:text-violet-700" type="button" onClick={() => onPreview(item)}>
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button className="flex items-center gap-1.5 transition hover:text-violet-700" type="button" onClick={() => onDownload(item)} disabled={!generated}>
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
          <button className="flex items-center gap-1.5 transition hover:text-violet-700" type="button" onClick={() => onEdit(item)}>
            <PencilLine className="h-3.5 w-3.5" />
            复用
          </button>
          <button className="flex items-center gap-1.5 transition hover:text-rose-600 disabled:opacity-60" type="button" onClick={() => onFavorite(item)} disabled={!generated || busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", generated && item.isFavorite ? "fill-rose-500 text-rose-500" : "")} />}
            收藏
          </button>
        </div>
      </div>
      <div className="px-5 py-4">
        <h3 className="truncate text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 truncate text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </article>
  );
}

export function UIDesignPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [selectedTemplate, setSelectedTemplate] = useState("品牌视觉");
  const [selectedStyle, setSelectedStyle] = useState("未来科技");
  const [selectedRatio, setSelectedRatio] = useState<Size>("1792x1024");
  const [quality, setQuality] = useState<Quality>("hd");
  const [imageCount, setImageCount] = useState(4);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_VALUE);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [modelRows, setModelRows] = useState<AiModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [referenceImageData, setReferenceImageData] = useState("");
  const [referenceImageName, setReferenceImageName] = useState("");
  const [activeTab, setActiveTab] = useState<StudioTab>("当前");
  const [currentImages, setCurrentImages] = useState<GeneratedImage[]>([]);
  const [historyImages, setHistoryImages] = useState<GeneratedImage[]>([]);
  const [favoriteImages, setFavoriteImages] = useState<GeneratedImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GeneratedImage | MockArtwork | null>(null);

  const modelOptions = useMemo(() => {
    const managedOptions = modelRows.filter((item) => item.enabled && item.model).map(toModelOption);
    return [DEFAULT_MODEL_OPTION, ...managedOptions];
  }, [modelRows]);

  const selectedModelOption = useMemo(
    () => modelOptions.find((item) => item.value === selectedModel) ?? DEFAULT_MODEL_OPTION,
    [modelOptions, selectedModel],
  );

  const selectedStyleOption = styleOptions.find((item) => item.label === selectedStyle) ?? styleOptions[2];
  const selectedRatioOption = ratios.find((item) => item.value === selectedRatio) ?? ratios[1];
  const promptSummary = prompt.trim() || defaultPrompt;

  const generationSettings = [
    ["模型", selectedModelOption.label],
    ["服务商", selectedModelOption.provider],
    ["模型标识", selectedModelOption.model],
    ["风格", selectedStyle],
    ["比例", selectedRatioOption.shortLabel],
    ["质量", quality === "hd" ? "HD" : "标准"],
    ["数量", `${imageCount} 张`],
  ];

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await integrationManagementApi.listAiModels({ page: 1, pageSize: 100 });
      setModelRows(response.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模型列表加载失败");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadGallery = useCallback(async (target: "history" | "favorite") => {
    setGalleryLoading(true);
    try {
      const response = await apiList(1, 12, target === "favorite");
      if (target === "favorite") {
        setFavoriteImages(response.items);
      } else {
        setHistoryImages(response.items);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片列表加载失败");
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
    void loadGallery("history");
  }, [loadGallery, loadModels]);

  useEffect(() => {
    if (selectedModel !== DEFAULT_MODEL_VALUE) return;
    const managedImageModel = modelOptions.find((item) => item.managed && isImageToImageModel(item.model));
    if (managedImageModel) {
      setSelectedModel(managedImageModel.value);
    }
  }, [modelOptions, selectedModel]);

  useEffect(() => {
    if (activeTab === "历史") {
      void loadGallery("history");
    }
    if (activeTab === "收藏") {
      void loadGallery("favorite");
    }
  }, [activeTab, loadGallery]);

  function appendPrompt(fragment: string) {
    setPrompt((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}，${fragment}` : fragment;
    });
  }

  function enhancePrompt() {
    setPrompt((current) => {
      const base = current.trim() || defaultPrompt;
      return `${base}，主体细节清晰，电影级布光，蓝紫品牌色，玻璃拟态与金属材质，高端商业海报，适合专业商业投放`;
    });
    toast.success("提示词已增强");
  }

  function handleTemplateClick(template: (typeof templates)[number]) {
    setSelectedTemplate(template.label);
    appendPrompt(template.prompt);
  }

  function handleStyleClick(style: (typeof styleOptions)[number]) {
    setSelectedStyle(style.label);
    appendPrompt(style.prompt);
  }

  function handleReferenceFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceImageData(String(reader.result ?? ""));
      setReferenceImageName(file.name);
      toast.success("参考图已上传");
    };
    reader.onerror = () => toast.error("参考图读取失败");
    reader.readAsDataURL(file);
  }

  async function handleGenerate(skipCache = imageCount > 1) {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      toast.error("请先填写图像提示词");
      return;
    }
    if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
      toast.error(`提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符`);
      return;
    }

    setGenerating(true);
    try {
      const payload = {
        prompt: normalizedPrompt,
        style: selectedStyleOption.apiStyle,
        size: selectedRatio,
        quality,
        model_id: selectedModelOption.managed ? selectedModelOption.modelId : undefined,
        model: selectedModelOption.model,
        reference_image_data: referenceImageData || undefined,
        skip_cache: skipCache,
      };
      const results = await Promise.all(Array.from({ length: imageCount }, () => apiGenerate(payload)));
      setCurrentImages(results);
      setActiveTab("当前");
      toast.success(`已生成 ${results.length} 张图像`);
      void loadGallery("history");
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

  function handleDownload(item: GeneratedImage | MockArtwork) {
    if (!("imageData" in item)) {
      toast.info("示例图不可下载，请先生成真实图片");
      return;
    }
    const link = document.createElement("a");
    link.href = item.imageData;
    link.download = `ai-image-${item.id}.png`;
    link.click();
  }

  function handleReuse(item: GeneratedImage | MockArtwork) {
    if ("imageData" in item) {
      setPrompt(item.revisedPrompt || item.prompt);
      setSelectedRatio(item.size);
      setQuality(item.quality);
      toast.success("已复用该图片提示词");
      return;
    }
    setPrompt(`${item.title}，${item.description}`);
    toast.success("已复用示例方向");
  }

  async function handleFavorite(item: GeneratedImage | MockArtwork) {
    if (!("imageData" in item)) {
      toast.info("示例图不可收藏，请先生成真实图片");
      return;
    }
    setFavoriteBusyId(item.id);
    try {
      const updated = await apiToggleFavorite(item.id);
      const patch = (images: GeneratedImage[]) =>
        images.map((image) => (image.id === updated.id ? { ...image, isFavorite: updated.isFavorite } : image));
      setCurrentImages(patch);
      setHistoryImages(patch);
      setFavoriteImages((images) =>
        updated.isFavorite ? patch(images) : images.filter((image) => image.id !== updated.id),
      );
      toast.success(updated.isFavorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏状态更新失败");
    } finally {
      setFavoriteBusyId(null);
    }
  }

  const tabItems: Array<GeneratedImage | MockArtwork> =
    activeTab === "当前"
      ? currentImages.length > 0
        ? currentImages
        : mockArtworks
      : activeTab === "历史"
        ? historyImages
        : favoriteImages;

  const displayedItems = searchKeyword.trim()
    ? tabItems.filter((item) => {
        const keyword = searchKeyword.trim().toLowerCase();
        const searchable = "imageData" in item
          ? `${item.prompt} ${item.revisedPrompt} ${item.model}`
          : `${item.title} ${item.description}`;
        return searchable.toLowerCase().includes(keyword);
      })
    : tabItems;

  const recentItems = historyImages.slice(0, 3);

  return (
    <div className="relative flex h-full min-h-[900px] min-w-[1180px] flex-col overflow-hidden bg-[linear-gradient(135deg,#f7f9ff_0%,#eef3ff_44%,#f6f0ff_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(117,92,255,0.16),transparent_42%),linear-gradient(115deg,rgba(79,132,255,0.08),transparent_38%,rgba(178,118,255,0.1)_76%,transparent)]" />

      <header className="relative z-10 flex h-16 shrink-0 items-center border-b border-white/62 bg-white/58 px-6 shadow-[0_1px_0_rgba(255,255,255,0.82)] backdrop-blur-2xl">
        <div className="flex w-[320px] items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#5d7cff_0%,#8d5cf6_58%,#27c8f5_100%)] shadow-[0_12px_30px_rgba(99,102,241,0.28)]">
            <Wand2 className="h-[18px] w-[18px] text-white" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">AI STUDIO</div>
            <div className="text-sm font-semibold text-slate-950">AI 图像生成器</div>
          </div>
        </div>

        <div className="mx-auto flex w-[480px] items-center gap-3 rounded-full border border-white/74 bg-white/58 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="搜索作品、模板、项目"
          />
        </div>

        <div className="ml-auto flex w-[320px] items-center justify-end gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/74 bg-white/56 px-3 py-2 text-xs font-semibold text-slate-600">
            <Zap className="h-3.5 w-3.5 text-violet-500" />
            2,840 点数
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-full border border-white/72 bg-white/56 text-slate-500 shadow-sm transition hover:bg-white" type="button">
            <Bell className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1e293b,#64748b)] text-xs font-bold text-white shadow-md">
            AR
          </div>
          <div className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 xl:flex">
            <CalendarDays className="h-3.5 w-3.5" />
            2026年5月7日
          </div>
        </div>
      </header>

      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_280px] gap-5 p-5">
        <aside className={cn("flex min-h-0 flex-col rounded-[20px] p-5", glassCard)}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-950">创建图像</div>
              <div className="mt-1 text-xs text-slate-500">提示词、模型、参考图和输出控制</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-violet-600">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>

          <div className="material-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <section>
              <label className="mb-2 block text-xs font-semibold text-slate-700">AI 模型</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="h-11 w-full appearance-none rounded-2xl border border-white/72 bg-white/62 px-4 pr-10 text-sm font-semibold text-slate-800 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100/80"
                >
                  {modelOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {modelsLoading ? "正在加载模型列表..." : selectedModelOption.description}
              </p>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">图像提示词</label>
                <button className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100" type="button" onClick={enhancePrompt}>
                  <Wand2 className="h-3 w-3" />
                  优化提示词
                </button>
              </div>
              <textarea
                className="h-[150px] w-full resize-none rounded-2xl border border-white/72 bg-white/62 px-4 py-3 text-sm leading-6 text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100/80"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder="描述主体、风格、场景、色彩、光照..."
              />
              <div className="mt-1.5 text-right text-[11px] font-medium text-slate-400">
                {prompt.length.toLocaleString("zh-CN")} / {MAX_PROMPT_LENGTH.toLocaleString("zh-CN")}
              </div>
            </section>

            <section>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => handleReferenceFile(event.target.files?.[0])}
              />
              <button
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-violet-200/90 bg-white/44 px-4 py-4 text-left transition hover:border-violet-300 hover:bg-white/64"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-violet-50 text-violet-600">
                  {referenceImageData ? <img src={referenceImageData} alt="" className="h-full w-full object-cover" /> : <Upload className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {referenceImageName || "上传参考图"}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">用于参考风格、产品或构图</span>
                </span>
              </button>
              {referenceImageData ? (
                <button className="mt-2 text-xs font-semibold text-slate-500 transition hover:text-rose-600" type="button" onClick={() => { setReferenceImageData(""); setReferenceImageName(""); }}>
                  清除参考图
                </button>
              ) : null}
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold text-slate-700">灵感模板</div>
              <div className="flex flex-wrap gap-2">
                {templates.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleTemplateClick(item)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      selectedTemplate === item.label
                        ? "border-violet-300 bg-violet-100 text-violet-800"
                        : "border-violet-100 bg-violet-50/70 text-violet-600 hover:bg-violet-100",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold text-slate-700">视觉风格</div>
              <div className="grid grid-cols-2 gap-2">
                {styleOptions.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleStyleClick(item)}
                    className={cn(
                      "min-h-[64px] rounded-2xl border px-3 py-3 text-left text-xs font-semibold transition",
                      selectedStyle === item.label
                        ? "border-violet-400 bg-violet-50 text-violet-800 shadow-[0_10px_24px_rgba(124,58,237,0.12)]"
                        : "border-white/74 bg-white/48 text-slate-600 hover:bg-white/72",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold text-slate-700">画面比例</div>
              <div className="grid grid-cols-3 gap-2">
                {ratios.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSelectedRatio(item.value)}
                    className={cn(
                      "rounded-2xl border px-2 py-3 text-center text-[11px] font-semibold leading-4 transition",
                      selectedRatio === item.value
                        ? "border-blue-400 bg-blue-50 text-blue-800 shadow-[0_10px_24px_rgba(59,130,246,0.12)]"
                        : "border-white/74 bg-white/48 text-slate-600 hover:bg-white/72",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQuality((current) => (current === "hd" ? "standard" : "hd"))}
                  className="rounded-2xl border border-white/74 bg-white/52 px-3 py-3 text-left transition hover:bg-white/72"
                >
                  <div className="text-[11px] font-semibold text-slate-500">质量</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{quality === "hd" ? "HD" : "标准"}</div>
                </button>
                <div className="rounded-2xl border border-white/74 bg-white/52 px-3 py-3">
                  <div className="text-[11px] font-semibold text-slate-500">图片数</div>
                  <div className="mt-2 flex items-center justify-between">
                    {[1, 2, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setImageCount(count)}
                        className={cn(
                          "h-7 w-8 rounded-full text-xs font-bold transition",
                          imageCount === count ? "bg-slate-950 text-white" : "bg-white/72 text-slate-500 hover:text-slate-900",
                        )}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-5 border-t border-white/62 pt-4">
            <button
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(135deg,#8b5cf6_0%,#4f7cff_100%)] text-sm font-semibold text-white shadow-[0_18px_36px_rgba(91,89,226,0.32)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_48px_rgba(91,89,226,0.38)] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
              type="button"
              disabled={generating}
              onClick={() => void handleGenerate()}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "正在生成..." : "生成图像"}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">预计耗时：10-30 秒</p>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex rounded-full border border-white/70 bg-white/52 p-1 shadow-sm backdrop-blur-xl">
              {(["当前", "历史", "收藏"] as StudioTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    activeTab === tab ? "bg-slate-950 text-white shadow-md" : "text-slate-500 hover:text-slate-900",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Layers3 className="h-4 w-4" />
              {activeTab === "当前" && currentImages.length === 0 ? "示例结果" : `${displayedItems.length} 张结果`}
            </div>
          </div>

          <div className={cn("mb-5 flex items-center justify-between gap-4 rounded-[20px] px-5 py-4", glassCard)}>
            <div className="min-w-0">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-500">提示词摘要</div>
              <p className="truncate text-sm font-medium text-slate-700">{promptSummary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-full border border-white/74 bg-white/56 px-4 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-60" type="button" disabled={generating} onClick={() => void handleGenerate(true)}>
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                重新生成
              </button>
              <button className="inline-flex h-10 items-center gap-2 rounded-full border border-white/74 bg-white/56 px-4 text-xs font-semibold text-slate-700 transition hover:bg-white" type="button" onClick={() => void handleCopyPrompt()}>
                <Copy className="h-3.5 w-3.5" />
                复制提示词
              </button>
            </div>
          </div>

          <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
            {galleryLoading && activeTab !== "当前" ? (
              <div className={cn("flex h-56 items-center justify-center rounded-[20px] text-sm font-semibold text-slate-500", glassCard)}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在加载图片...
              </div>
            ) : displayedItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-5">
                {displayedItems.map((item, index) => (
                  <ArtworkCard
                    key={"imageData" in item ? item.id : `mock-${item.id}`}
                    item={item}
                    index={index}
                    busy={"imageData" in item && favoriteBusyId === item.id}
                    onPreview={setPreviewItem}
                    onDownload={handleDownload}
                    onEdit={handleReuse}
                    onFavorite={(target) => void handleFavorite(target)}
                  />
                ))}
              </div>
            ) : (
              <div className={cn("flex h-56 flex-col items-center justify-center rounded-[20px] text-center", glassCard)}>
                <Sparkles className="h-6 w-6 text-violet-500" />
                <div className="mt-3 text-sm font-semibold text-slate-800">暂无图片</div>
                <div className="mt-1 text-xs text-slate-500">生成图片后会自动出现在这里</div>
              </div>
            )}
          </div>
        </section>

        <aside className="material-scrollbar min-h-0 space-y-5 overflow-y-auto pr-1">
          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">提示词增强</h2>
                <p className="mt-1 text-xs text-slate-500">AI 提供更强输出建议</p>
              </div>
              <Sparkles className="h-4 w-4 text-violet-500" />
            </div>
            <div className="space-y-2">
              {suggestions.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/72 bg-white/48 p-3">
                  <div className="text-xs font-semibold text-slate-700">{item.title}</div>
                  <button className="mt-2 rounded-full bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100" type="button" onClick={() => appendPrompt(item.prompt)}>
                    应用
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-950">生成设置</h2>
            </div>
            <div className="space-y-3">
              {generationSettings.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-white/60 pb-2 last:border-b-0 last:pb-0">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className="truncate text-right text-xs font-semibold text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={cn("rounded-[20px] p-5", glassCard)}>
            <div className="mb-4 flex items-center gap-2">
              <Clipboard className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-slate-950">最近创作</h2>
            </div>
            <div className="space-y-3">
              {(recentItems.length > 0 ? recentItems : mockArtworks.slice(0, 3)).map((item) => (
                <button
                  key={"imageData" in item ? item.id : `recent-${item.id}`}
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/66 bg-white/42 p-2.5 text-left transition hover:bg-white/70"
                >
                  <MiniPreview variant={"imageData" in item ? undefined : item.variant} imageData={"imageData" in item ? item.imageData : undefined} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">
                      {"imageData" in item ? item.prompt : item.title}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {"imageData" in item ? formatTime(item.createdAt) : item.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </main>

      {previewItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-8 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-5xl overflow-hidden rounded-[24px] border border-white/74 bg-white/88 shadow-[0_32px_90px_rgba(15,23,42,0.35)] backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-950">图片预览</div>
                <div className="mt-1 max-w-2xl truncate text-xs text-slate-500">
                  {"imageData" in previewItem ? previewItem.prompt : previewItem.description}
                </div>
              </div>
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200" type="button" onClick={() => setPreviewItem(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative aspect-[16/9] bg-slate-100">
              {"imageData" in previewItem ? (
                <img src={previewItem.imageData} alt={previewItem.prompt} className="h-full w-full object-contain" />
              ) : (
                <ArtworkVisual variant={previewItem.variant} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
