import { Button } from "./components/ui/button";
import React, { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Download,
  FileSearch,
  Gauge,
  GitBranch,
  ListTree,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
import { Checkbox } from "./components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import {
  AiGatewayConnectionOverview,
  AiGatewayOverview,
  AiGatewayRange,
  AiGatewayCircuit,
  AiGatewayRequestItem,
  AiGatewayRequestPage,
  AiGatewayRoute,
  AiGatewayStrategy,
  AiModelItem,
  integrationManagementApi,
} from "./lib/integrationManagementApi";
import { dictionaryApi } from "./lib/dictionaryApi";
import { cn } from "./components/ui/utils";
import { resolveExplicitUsage, resolveModelUsageKind } from "./lib/aiModelOptions";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
} from "./components/horizon/HorizonPage";
import { Input } from "./components/ui/input";

const AI_PROVIDER_DICT_KEY = "ai_provider";

const PAGE_SIZE = 9;
const BULK_TEST_CONCURRENCY = 3;

type BulkTestProgress = {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
};

type DialogMode = "create" | "edit" | "delete" | null;
type WorkspaceTab = "connections" | "routes" | "monitor" | "requests";

const GATEWAY_TABS: Array<{
  value: WorkspaceTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "connections", label: "模型连接", description: "密钥与服务地址", icon: ServerCog },
  { value: "routes", label: "路由策略", description: "主备优先级与超时", icon: Route },
  { value: "monitor", label: "运行监控", description: "成功率与延迟", icon: Activity },
  { value: "requests", label: "请求明细", description: "逐次故障切换记录", icon: ListTree },
];

const RANGE_OPTIONS: Array<{ value: AiGatewayRange; label: string }> = [
  { value: "today", label: "今日" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
];

const RADIX_ALL_VALUE = "__all__";

function RadixSelectField({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value || RADIX_ALL_VALUE} onValueChange={(nextValue) => onValueChange(nextValue === RADIX_ALL_VALUE ? "" : nextValue)} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn("h-9 min-w-32 rounded-lg border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-none hover:border-primary/25 focus:ring-primary/25", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="z-[80] max-h-72 rounded-xl border-slate-200 bg-white shadow-xl">
        {options.map((option) => (
          <SelectItem key={option.value || RADIX_ALL_VALUE} value={option.value || RADIX_ALL_VALUE} disabled={option.disabled} className="cursor-pointer text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const GATEWAY_SCENES = [
  {
    value: "rd.task_brief",
    label: "研发任务简报",
    description: "任务详情中的领导摘要与风险提炼",
    defaultTimeoutMs: 120000,
  },
  {
    value: "ops.error_analysis",
    label: "运维错误分析",
    description: "接口异常的根因、影响与修复建议",
    defaultTimeoutMs: 60000,
  },
  {
    value: "external_docs.version_compare",
    label: "对外资料版本比对",
    description: "版本差异分类、风险判断与归档摘要",
    defaultTimeoutMs: 60000,
  },
  {
    value: "rag.knowledge_answer",
    label: "知识库综合问答",
    description: "基于权限过滤后的企业知识生成引用答案",
    defaultTimeoutMs: 60000,
  },
  {
    value: "image.prompt_optimization",
    label: "图像提示词优化",
    description: "对话式优化图像生成提示词与约束",
    defaultTimeoutMs: 60000,
  },
  {
    value: "hr.resume_screening",
    label: "简历智能筛选",
    description: "岗位提取、候选人评估、追问与二次筛选",
    defaultTimeoutMs: 120000,
  },
  {
    value: "rd.reporting",
    label: "研发报表总结",
    description: "成员日报与月报的结构化管理摘要",
    defaultTimeoutMs: 120000,
  },
  {
    value: "rd.performance_review",
    label: "研发绩效分析",
    description: "绩效结论、考核事项与评价标准生成",
    defaultTimeoutMs: 120000,
  },
  {
    value: "rd.progress_assessment",
    label: "研发进度评估",
    description: "进度判断、完成质量评分与任务描述归并",
    defaultTimeoutMs: 120000,
  },
  {
    value: "rd.project_structuring",
    label: "研发项目结构化",
    description: "任务提取、立项微调、项目归类与知识文件分类",
    defaultTimeoutMs: 300000,
  },
  {
    value: "procurement.requirement_parse",
    label: "采购需求解析",
    description: "将采购描述解析为物料、数量、交期与采购方式",
    defaultTimeoutMs: 120000,
  },
  {
    value: "procurement.material_intelligence",
    label: "采购物料智能",
    description: "物料分类与常备物料判断",
    defaultTimeoutMs: 120000,
  },
  {
    value: "procurement.erp_matching",
    label: "采购单据匹配",
    description: "T+ 采购单行与内部采购任务匹配",
    defaultTimeoutMs: 120000,
  },
  {
    value: "i18n.translation",
    label: "界面与内容翻译",
    description: "企业界面批量翻译、校对与用户内容翻译",
    defaultTimeoutMs: 120000,
  },
  {
    value: "chat.completion",
    label: "主对话流式回答",
    description: "MateChat 对话的流式生成与 ReAct 工具调用（含图片时不参与跨模型降级）",
    defaultTimeoutMs: 300000,
  },
  {
    value: "chat.daily_motivation",
    label: "每日激励文案",
    description: "MateChat 每日主题激励与连续使用反馈",
    defaultTimeoutMs: 8000,
  },
  {
    value: "chat.utility_completion",
    label: "通用文本补全",
    description: "未单独标注业务场景的非流式文本调用兜底",
    defaultTimeoutMs: 120000,
  },
] as const;

const GATEWAY_STRATEGIES: Array<{ value: AiGatewayStrategy; label: string; description: string }> = [
  { value: "priority", label: "优先级", description: "始终先调用排序第一的连接" },
  { value: "round_robin", label: "轮询", description: "在可用连接之间均匀轮换" },
  { value: "weighted", label: "加权", description: "按权重概率选择首个连接" },
  { value: "lowest_latency", label: "低延迟", description: "优先选择历史成功延迟最低的连接" },
];

type GatewayScene = (typeof GATEWAY_SCENES)[number]["value"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/** 空串或非法输入统一归 0，后端把 0 当作「未配单价」，该模型不计入成本合计。 */
function parsePriceInput(value: string) {
  const price = Number(value.trim());
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/** 成本按元展示；金额很小时多留几位小数，避免全是 ¥0.00 看不出差异。 */
function formatCost(value: number) {
  const digits = value > 0 && value < 1 ? 4 : 2;
  return `¥${value.toFixed(digits)}`;
}

function formatGatewayScene(scene: string) {
  return GATEWAY_SCENES.find((item) => item.value === scene)?.label ?? scene;
}

function gatewayStatusLabel(status: string) {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "circuit_open") return "熔断跳过";
  return status;
}

/**
 * 选模来源展示。与「故障转移」(fallback_used) 是两个独立维度：
 * 前者回答「targets 是谁定的」（路由 / 回落默认 / 用户指定 / 视觉直连），
 * 后者回答「一次调用是否跨连接切换过」。此前明细只展示后者且文案叫「首选命中」，
 * 让人误以为它能证明路由生效——实际上路由从未参与时它也显示「首选命中」。
 */
const ROUTE_SOURCE_LABELS: Record<string, string> = {
  route: "走路由",
  fallback: "走默认",
  user: "用户指定",
  vision: "视觉直连",
};
const STRATEGY_LABELS: Record<string, string> = {
  priority: "优先级",
  round_robin: "轮询",
  weighted: "权重",
  lowest_latency: "最低延迟",
};
function routeSourceLabel(item: { route_source: string | null; strategy: string | null }): string {
  if (!item.route_source) return "未知（旧数据）";
  const base = ROUTE_SOURCE_LABELS[item.route_source] ?? item.route_source;
  return item.route_source === "route" && item.strategy
    ? `${base} · ${STRATEGY_LABELS[item.strategy] ?? item.strategy}`
    : base;
}

// ── 百炼 Token Plan 预设模型目录 ──────────────────────────────────────────────
// 与阿里云百炼「可使用模型」页面一一对应；usageKind 按页面标注的模型能力显式指定
// （含视觉理解 → multimodal，图片生成 → image，其余 → text），避免自动推断漂移。

const BAILIAN_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

type PresetModel = {
  brand: string;
  provider: string;
  model: string;
  capability: string;
  usageKind: "text" | "multimodal" | "image" | "video" | "audio";
};

const BAILIAN_PRESET_MODELS: PresetModel[] = [
  { brand: "千问", provider: "Qwen", model: "qwen3.8-max", capability: "文本生成、推理模型、视觉理解", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen3.7-plus", capability: "文本生成、推理模型、视觉理解", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen3.7-max", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "千问", provider: "Qwen", model: "qwen3.6-plus", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen3.6-flash", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "千问", provider: "Qwen", model: "qwen-image-2.0", capability: "图片生成", usageKind: "image" },
  { brand: "千问", provider: "Qwen", model: "qwen-image-2.0-pro", capability: "图片生成", usageKind: "image" },
  { brand: "千问", provider: "Qwen", model: "qwen-audio-3.0-tts-plus", capability: "实时语音合成", usageKind: "audio" },
  { brand: "千问", provider: "Qwen", model: "qwen-audio-3.0-realtime-plus", capability: "实时语音对话", usageKind: "audio" },
  { brand: "万相", provider: "Wanx", model: "wan2.7-image", capability: "图片生成", usageKind: "image" },
  { brand: "万相", provider: "Wanx", model: "wan2.7-image-pro", capability: "图片生成", usageKind: "image" },
  { brand: "HappyHorse", provider: "HappyHorse", model: "happyhorse-1.1-i2v", capability: "视频生成", usageKind: "video" },
  { brand: "HappyHorse", provider: "HappyHorse", model: "happyhorse-1.1-t2v", capability: "视频生成", usageKind: "video" },
  { brand: "HappyHorse", provider: "HappyHorse", model: "happyhorse-1.1-r2v", capability: "视频生成", usageKind: "video" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v4-pro", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v4-flash-0731", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v4-flash", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "DeepSeek", provider: "DeepSeek", model: "deepseek-v3.2", capability: "推理模型、文本生成", usageKind: "text" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.7-code", capability: "文本生成、视觉理解、推理模型", usageKind: "multimodal" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.6", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "月之暗面", provider: "Moonshot", model: "kimi-k2.5", capability: "推理模型、视觉理解、文本生成", usageKind: "multimodal" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5.2", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5.1", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "智谱AI", provider: "Zhipu", model: "glm-5", capability: "文本生成、推理模型", usageKind: "text" },
  { brand: "MiniMax", provider: "MiniMax", model: "MiniMax-M2.5", capability: "推理模型、文本生成", usageKind: "text" },
];

const PRESET_BRANDS = Array.from(new Set(BAILIAN_PRESET_MODELS.map((item) => item.brand)));

// ── 导入 / 导出 ───────────────────────────────────────────────────────────────
// 导出文件不含 API Key（密文不可回读）；导入时可统一补一个 Key，或导入后逐条编辑。

const EXPORT_USAGE_KINDS = new Set(["auto", "text", "multimodal", "image", "embedding", "document", "video", "audio"]);

type ExportedModel = {
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  usage_kind?: string;
  enabled?: boolean;
};

type ImportEntry = ExportedModel & { duplicate: boolean };

/** 翻页拉全量模型配置（列表接口 page_size 上限 100），用于导出与去重 */
async function fetchAllAiModels(): Promise<AiModelItem[]> {
  const all: AiModelItem[] = [];
  let page = 1;
  for (;;) {
    const response = await integrationManagementApi.listAiModels({ page, pageSize: 100 });
    all.push(...response.items);
    if (page >= response.total_pages || response.items.length === 0) break;
    page += 1;
  }
  return all;
}

function parseImportedModels(raw: string): ExportedModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("文件不是合法的 JSON");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
      ? ((parsed as { models: unknown[] }).models)
      : null;
  if (!list) {
    throw new Error("JSON 结构不符合导出格式（应为数组或 { models: [...] }）");
  }

  const entries: ExportedModel[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const model = typeof record.model === "string" ? record.model.trim() : "";
    if (!name || !provider || !model) continue;
    const usageKind = typeof record.usage_kind === "string" && EXPORT_USAGE_KINDS.has(record.usage_kind)
      ? record.usage_kind
      : "auto";
    entries.push({
      name,
      provider,
      model,
      base_url: typeof record.base_url === "string" ? record.base_url.trim() : undefined,
      usage_kind: usageKind,
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    });
  }
  if (entries.length === 0) {
    throw new Error("文件中没有可导入的模型配置（每条至少需要 name / provider / model）");
  }
  return entries;
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRefreshTime(value?: string | null) {
  if (!value) return "等待首次刷新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

const statusToneMap: Record<string, string> = {
  运行正常: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  连接异常: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
  未配置: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

const usageToneMap: Record<string, string> = {
  text: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  multimodal: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  image: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  embedding: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200",
  document: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  video: "bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200",
  audio: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
};

const connectionStatusMeta: Record<AiGatewayConnectionOverview["status"], { label: string; className: string }> = {
  healthy: { label: "健康", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  warning: { label: "需关注", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  error: { label: "异常", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  idle: { label: "待观察", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  disabled: { label: "已停用", className: "bg-slate-100 text-slate-500 ring-slate-200" },
  circuit_open: { label: "熔断中", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

function GatewayMetricCard({
  icon,
  label,
  value,
  hint,
  tone = "blue",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "blue" | "emerald" | "amber" | "sky";
}) {
  const toneClasses = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
  };
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white/90 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
        <span className={cn("flex size-7 items-center justify-center rounded-lg ring-1", toneClasses[tone])}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-slate-500">{hint}</div>
    </div>
  );
}

function WorkspaceErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-rose-900">数据读取失败</div>
          <p className="mt-1 text-sm leading-6 text-rose-700 text-pretty">{message}</p>
          <Button variant="unstyled"
            type="button"
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            onClick={onRetry}
          >
            重新加载
          </Button>
        </div>
      </div>
    </div>
  );
}

function GatewayRouteWorkspace({
  routes,
  models,
  usage,
  loading,
  onReload,
}: {
  routes: AiGatewayRoute[];
  models: AiModelItem[];
  /** 近 24h 各场景按选模来源的调用计数（scene → route/fallback/user/vision/unknown → count） */
  usage: Record<string, Record<string, number>>;
  loading: boolean;
  onReload: () => Promise<void>;
}) {
  // 默认选中主对话：全仓流量最高的场景。原默认 rd.task_brief 是最低频场景（唯一入口为任务
  // 详情领导摘要），照着它配路由再验证，几乎必然「配了没感觉」。
  const [selectedScene, setSelectedScene] = useState<GatewayScene>("chat.completion");
  const sceneDefinition = GATEWAY_SCENES.find((item) => item.value === selectedScene) ?? GATEWAY_SCENES[0];
  const existing = routes.find((route) => route.scene === selectedScene);
  const [name, setName] = useState(existing?.name ?? sceneDefinition.label);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [timeoutMs, setTimeoutMs] = useState(existing?.timeout_ms ?? sceneDefinition.defaultTimeoutMs);
  const [strategy, setStrategy] = useState<AiGatewayStrategy>(existing?.strategy ?? "priority");
  const [failureThreshold, setFailureThreshold] = useState(existing?.failure_threshold ?? 3);
  const [cooldownMs, setCooldownMs] = useState(existing?.cooldown_ms ?? 60000);
  const [connectionIds, setConnectionIds] = useState<string[]>(
    () => existing?.targets.map((target) => target.connection_id) ?? [],
  );
  const [weights, setWeights] = useState<Record<string, number>>(
    () => Object.fromEntries(existing?.targets.map((target) => [target.connection_id, target.weight]) ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [fallbackScenesOpen, setFallbackScenesOpen] = useState(false);
  const controlInputClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-muted-foreground hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/25";
  const iconButtonClass = "flex size-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-35";

  useEffect(() => {
    const definition = GATEWAY_SCENES.find((item) => item.value === selectedScene) ?? GATEWAY_SCENES[0];
    const route = routes.find((item) => item.scene === selectedScene);
    setName(route?.name ?? definition.label);
    setEnabled(route?.enabled ?? true);
    setTimeoutMs(route?.timeout_ms ?? definition.defaultTimeoutMs);
    setStrategy(route?.strategy ?? "priority");
    setFailureThreshold(route?.failure_threshold ?? 3);
    setCooldownMs(route?.cooldown_ms ?? 60000);
    setConnectionIds(route?.targets.map((target) => target.connection_id) ?? []);
    setWeights(Object.fromEntries(route?.targets.map((target) => [target.connection_id, target.weight]) ?? []));
  }, [routes, selectedScene]);

  const availableModels = models.filter((model) => {
    const usage = resolveModelUsageKind(model);
    return model.enabled && (usage === "text" || usage === "multimodal") && !connectionIds.includes(model.id);
  });
  const selectedModels = connectionIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is AiModelItem => Boolean(model));
  const suggestedModel = availableModels.find((model) => model.is_default_enabled) ?? availableModels[0];
  const hasUsableDedicatedRoute = (scene: GatewayScene) => {
    const route = routes.find((item) => item.scene === scene);
    return Boolean(route?.enabled && route.targets.some((target) => target.enabled && target.connection_enabled));
  };
  const dedicatedScenes = GATEWAY_SCENES.filter((scene) => hasUsableDedicatedRoute(scene.value));
  const fallbackScenes = GATEWAY_SCENES.filter((scene) => !hasUsableDedicatedRoute(scene.value));

  function renderSceneOption(scene: (typeof GATEWAY_SCENES)[number]) {
    const route = routes.find((item) => item.scene === scene.value);
    const active = selectedScene === scene.value;
    const usableTargets = route?.targets.filter((target) => target.enabled && target.connection_enabled).length ?? 0;
    const hasDedicatedRoute = Boolean(route?.enabled && usableTargets > 0);
    const status = hasDedicatedRoute
      ? `${usableTargets} 条专用连接`
      : route?.enabled && route.targets.length > 0
        ? "连接不可用"
        : route && !route.enabled
          ? "专用路由已停用"
          : "默认回退";
    return (
      <Button variant="unstyled"
        key={scene.value}
        type="button"
        onClick={() => setSelectedScene(scene.value)}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          active
            ? "border-primary/25 bg-white shadow-sm"
            : "border-transparent hover:border-slate-200 hover:bg-white/80",
        )}
      >
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", active ? "bg-blue-700 text-white shadow-sm" : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200")}>
          {scene.value === "rd.task_brief"
            ? <ListTree className="size-4" />
            : scene.value === "ops.error_analysis"
              ? <Gauge className="size-4" />
              : <FileSearch className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{scene.label}</span>
            <span className={cn(
              "material-chip",
              hasDedicatedRoute
                ? "bg-emerald-50 text-emerald-700"
                : route?.enabled && route.targets.length > 0
                  ? "bg-rose-50 text-rose-700"
                  : "bg-slate-100 text-slate-500",
            )}>
              {status}
            </span>
          </span>
          <span className="mt-1 block truncate text-[10px] text-slate-500">{scene.description}</span>
        </span>
        <ChevronRight className={cn("size-4 shrink-0", active ? "text-blue-700" : "text-muted-foreground")} />
      </Button>
    );
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= connectionIds.length) return;
    setConnectionIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  async function save() {
    if (enabled && connectionIds.length === 0) {
      toast.error("启用专用路由前，请至少添加一条模型连接");
      return;
    }
    setSaving(true);
    try {
      await integrationManagementApi.saveAiGatewayRoute({
        scene: selectedScene,
        name: name.trim() || sceneDefinition.label,
        enabled,
        timeout_ms: timeoutMs,
        strategy,
        failure_threshold: failureThreshold,
        cooldown_ms: cooldownMs,
        connection_ids: connectionIds,
        target_weights: connectionIds.map((id) => weights[id] ?? 100),
      });
      toast.success(`${sceneDefinition.label}路由已更新`);
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存路由失败");
    } finally {
      setSaving(false);
    }
  }

  /** 删除已保存的路由：场景回到「默认回退」态（各业务用自带模型），与从未配置过等价。 */
  async function removeRoute() {
    if (!existing) return;
    if (!window.confirm(`确定删除「${sceneDefinition.label}」的专用路由？删除后该场景回到默认回退（各业务使用自带模型）。`)) return;
    setSaving(true);
    try {
      await integrationManagementApi.deleteAiGatewayRoute(selectedScene);
      toast.success(`${sceneDefinition.label}路由已删除，场景回到默认回退`);
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除路由失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 管辖范围说明：避免误以为路由是「所有 AI 的总控」——生图/视频/向量化/OCR 走各自专用通道 */}
      <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-[11px] leading-5 text-slate-500">
        路由策略仅覆盖<span className="font-medium text-slate-700">文本对话类调用</span>（chat.completions）。文生图、视频生成、向量化（Embedding）、OCR 与文档直读走各自的专用通道，不经网关路由——它们的模型与密钥仍由「模型连接」统一管理。
      </p>
      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {dedicatedScenes.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {dedicatedScenes.map(renderSceneOption)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-600">
            当前没有生效中的专用路由。业务不会中断，仍使用各场景原有的模型配置。
          </div>
        )}
        <Collapsible open={fallbackScenesOpen} onOpenChange={setFallbackScenesOpen} className="mt-2">
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-primary/25 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span>
              <span className="block text-sm font-semibold text-slate-800">默认回退场景</span>
              <span className="mt-0.5 block text-xs text-slate-500">{fallbackScenes.length} 个场景沿用各业务模块原有模型，展开后可配置专用路由。</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-slate-500", fallbackScenesOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {fallbackScenes.map(renderSceneOption)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="border-b border-slate-100 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <GitBranch className="size-4 text-blue-700" />
                故障切换链
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-500">从上到下依次调用；失败、限流或熔断时自动进入下一连接。</p>
            </div>
            <span className={cn(
              "material-chip",
              existing?.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
            )}>
              {existing ? (existing.enabled ? "策略生效中" : "策略已停用") : "等待配置"}
            </span>
          </div>
          {/* 运行期反馈：该场景近 24h 实际的选模来源分布。「策略生效中」只是配置回显，
              这一行才回答「路由到底有没有接管调用」。 */}
          {(() => {
            const sceneUsage = usage[selectedScene] ?? {};
            const parts = [
              ["route", "走路由"],
              ["fallback", "走默认"],
              ["user", "用户指定"],
              ["vision", "视觉直连"],
              ["unknown", "旧数据"],
            ] as const;
            const rendered = parts
              .filter(([key]) => (sceneUsage[key] ?? 0) > 0)
              .map(([key, label]) => `${label} ${sceneUsage[key]} 次`);
            return (
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                近 24 小时：{rendered.length > 0 ? rendered.join(" · ") : "无调用"}
                {existing?.enabled && (sceneUsage.fallback ?? 0) > 0 && (sceneUsage.route ?? 0) === 0 ? (
                  <span className="ml-1 font-medium text-amber-600">——路由已启用但没有一次走路由，请检查连接可用性</span>
                ) : null}
              </p>
            );
          })()}
        </div>
        <div className="space-y-2.5 p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">正在读取路由策略...</div>
          ) : selectedModels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center">
              <Route className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-3 text-sm font-semibold text-slate-700">尚未配置专用路由</div>
              <div className="mt-1 text-xs text-slate-500">系统当前继续使用原有场景模型配置。添加 1 条连接可固定主模型，添加 2 条以上才会形成故障切换链。</div>
              {suggestedModel ? (
                <Button variant="unstyled"
                  type="button"
                  className="mt-4 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-primary/25 bg-white px-3 text-xs font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                  onClick={() => {
                    setConnectionIds([suggestedModel.id]);
                    setWeights({ [suggestedModel.id]: 100 });
                  }}
                >
                  使用{suggestedModel.is_default_enabled ? "当前默认" : "首个可用"}连接：{suggestedModel.name}
                </Button>
              ) : (
                <div className="mt-3 text-xs font-medium text-amber-700">请先在“模型连接”中启用至少一个文本或多模态模型。</div>
              )}
            </div>
          ) : selectedModels.map((model, index) => (
            <div key={model.id} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 transition-colors hover:border-primary/25 hover:bg-accent/30">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold", index === 0 ? "bg-blue-700 text-white" : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200")}>{index + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{model.name}</span>
                  {index === 0 ? <span className="material-chip bg-blue-50 text-blue-700">主连接</span> : <span className="material-chip bg-amber-50 text-amber-700">备用 {index}</span>}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-slate-500">{model.provider} · {model.model}</div>
              </div>
              {strategy === "weighted" ? (
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  权重
                  <Input
                    className={cn(controlInputClass, "!h-8 !w-16 !px-2 text-center")}
                    type="number"
                    min={1}
                    max={1000}
                    value={weights[model.id] ?? 100}
                    onChange={(event) => setWeights((current) => ({
                      ...current,
                      [model.id]: Math.min(1000, Math.max(1, Number(event.target.value) || 1)),
                    }))}
                  />
                </label>
              ) : null}
              <div className="flex items-center gap-1">
                <Button variant="unstyled" type="button" className={iconButtonClass} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`上移 ${model.name}`}><ArrowUp className="size-3.5" /></Button>
                <Button variant="unstyled" type="button" className={iconButtonClass} disabled={index === selectedModels.length - 1} onClick={() => move(index, 1)} aria-label={`下移 ${model.name}`}><ArrowDown className="size-3.5" /></Button>
                <Button variant="unstyled" type="button" className={cn(iconButtonClass, "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600")} onClick={() => setConnectionIds((current) => current.filter((id) => id !== model.id))} aria-label={`移除 ${model.name}`}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))}
          <RadixSelectField
            value=""
            onValueChange={(connectionId) => {
              if (!connectionId) return;
              setConnectionIds((current) => [...current, connectionId]);
              setWeights((current) => ({ ...current, [connectionId]: 100 }));
            }}
            options={[
              { value: "", label: "＋ 添加启用中的模型连接" },
              ...availableModels.map((item) => ({ value: item.id, label: `${item.name} · ${item.provider}/${item.model}` })),
            ]}
            ariaLabel="添加启用中的模型连接"
            className="mt-3 w-full"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="size-4 text-blue-700" />策略参数</div>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="gateway-route-name" className="mb-1.5 block text-xs font-semibold text-slate-600">策略名称</label>
            <Input id="gateway-route-name" className={controlInputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600" title="流式场景下该超时只保护「到首个字节」；正文传输阶段由业务层的流空闲看门狗兜底">单次调用超时（首包）</label>
            <RadixSelectField value={String(timeoutMs)} onValueChange={(value) => setTimeoutMs(Number(value))} options={[
              { value: "30000", label: "30 秒" },
              { value: "60000", label: "60 秒" },
              { value: "120000", label: "120 秒" },
              { value: "300000", label: "300 秒" },
            ]} ariaLabel="单次调用超时" className="w-full" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">调度策略</label>
            <RadixSelectField value={strategy} onValueChange={(value) => setStrategy(value as AiGatewayStrategy)} options={GATEWAY_STRATEGIES.map((option) => ({ value: option.value, label: `${option.label} · ${option.description}` }))} ariaLabel="调度策略" className="w-full" disabled={connectionIds.length < 2} />
            {connectionIds.length < 2 && (
              <p className="mt-1 text-[10px] leading-4 text-amber-600">只有 1 条连接时所有策略行为完全相同（无从调度）；添加第 2 条连接后策略才会生效。</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gateway-failure-threshold" className="mb-1.5 block text-xs font-semibold text-slate-600">失败阈值</label>
              <Input id="gateway-failure-threshold" className={controlInputClass} type="number" min={1} max={20} value={failureThreshold} onChange={(event) => setFailureThreshold(Number(event.target.value))} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-600">冷却时间</div>
              <RadixSelectField value={String(cooldownMs)} onValueChange={(value) => setCooldownMs(Number(value))} options={[
                { value: "30000", label: "30 秒" },
                { value: "60000", label: "60 秒" },
                { value: "120000", label: "2 分钟" },
                { value: "300000", label: "5 分钟" },
              ]} ariaLabel="冷却时间" className="w-full" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <div><div className="text-sm font-medium text-slate-700">启用专用路由</div><div className="mt-0.5 text-xs text-slate-500">关闭后回退原场景配置</div></div>
            <Switch checked={enabled} onCheckedChange={setEnabled} className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-slate-300" aria-label="启用专用路由" />
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800">
            连续失败达到阈值后连接会进入临时熔断，冷却期间直接跳到下一连接，避免重复等待故障服务。
          </div>
          <Button type="button" className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-xl text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={saving} onClick={() => void save()}>{saving ? "保存中..." : "保存路由策略"}</Button>
          {existing && (
            <Button variant="unstyled" type="button" className="mt-2 inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-xl border border-rose-200 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={saving} onClick={() => void removeRoute()}>删除此路由（回到默认回退）</Button>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}

function GatewayMonitorWorkspace({
  range,
  overview,
  circuits,
  loading,
  autoRefresh,
  lastUpdatedAt,
  onRangeChange,
  onAutoRefreshChange,
  onReload,
  onInspectScene,
  onInspectConnection,
}: {
  range: AiGatewayRange;
  overview: AiGatewayOverview | null;
  circuits: AiGatewayCircuit[];
  loading: boolean;
  autoRefresh: boolean;
  lastUpdatedAt: string | null;
  onRangeChange: (range: AiGatewayRange) => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onReload: () => void;
  onInspectScene: (scene: string) => void;
  onInspectConnection: (connectionId: string) => void;
}) {
  const [resettingCircuit, setResettingCircuit] = useState<string | null>(null);
  const [connectionKeyword, setConnectionKeyword] = useState("");
  const [connectionProvider, setConnectionProvider] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionPage, setConnectionPage] = useState(1);
  const [connectionPageSize, setConnectionPageSize] = useState(9);
  const [selectedConnection, setSelectedConnection] = useState<AiGatewayConnectionOverview | null>(null);
  const connectionDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const totals = overview?.totals;
  const trend = overview?.trend.slice(-14) ?? [];
  const maxTrendRequests = Math.max(1, ...trend.map((item) => item.requests));
  const openCircuitCount = circuits.filter((circuit) => circuit.state === "open").length;
  const diagnostics = overview?.diagnostics;
  const abnormalScenes = diagnostics?.scenes.filter((scene) => scene.status === "critical" || scene.status === "warning") ?? [];
  const waitingForFirstLoad = loading && !overview;
  const connections = overview?.connections ?? [];
  const connectionProviders = Array.from(new Set(connections.map((connection) => connection.provider).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const normalizedConnectionKeyword = connectionKeyword.trim().toLowerCase();
  const filteredConnections = connections.filter((connection) => {
    if (connectionProvider && connection.provider !== connectionProvider) return false;
    if (connectionStatus && connection.status !== connectionStatus) return false;
    if (!normalizedConnectionKeyword) return true;
    return [connection.name, connection.provider, connection.model].some((value) => value.toLowerCase().includes(normalizedConnectionKeyword));
  });
  const connectionTotalPages = Math.max(1, Math.ceil(filteredConnections.length / connectionPageSize));
  const safeConnectionPage = Math.min(connectionPage, connectionTotalPages);
  const visibleConnections = filteredConnections.slice((safeConnectionPage - 1) * connectionPageSize, safeConnectionPage * connectionPageSize);

  async function resetCircuit(circuit?: AiGatewayCircuit) {
    const key = circuit ? `${circuit.scene}:${circuit.targetKey}` : "all";
    setResettingCircuit(key);
    try {
      const result = await integrationManagementApi.resetAiGatewayCircuits(circuit ? {
        scene: circuit.scene,
        target_key: circuit.targetKey,
      } : {});
      toast.success(result.reset > 0 ? `已重置 ${result.reset} 条熔断状态` : "当前没有需要重置的熔断状态");
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重置熔断状态失败");
    } finally {
      setResettingCircuit(null);
    }
  }

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="relative p-4 md:p-5">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700"><Zap className="size-3.5" />Gateway Pulse</div>
              <h3 className="mt-1.5 text-xl font-semibold text-slate-950">AI 路由运行态</h3>
              <p className="mt-1 text-xs text-slate-600">观察业务请求在连接之间的真实流动，而不只是单个模型是否在线。</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm hover:border-primary/25">
                  <Switch
                    checked={autoRefresh}
                    onCheckedChange={onAutoRefreshChange}
                    className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-slate-300"
                    aria-label="每 30 秒自动刷新监控"
                  />
                  自动刷新
                </label>
                <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  {RANGE_OPTIONS.map((option) => (
                    <Button variant="unstyled" key={option.value} type="button" onClick={() => onRangeChange(option.value)} className={cn("rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25", range === option.value ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-slate-100")}>{option.label}</Button>
                  ))}
                </div>
                <Button variant="unstyled" type="button" className="flex size-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-primary/25 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={onReload} aria-label="刷新监控"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className={cn("size-1.5 rounded-full", autoRefresh ? "animate-pulse bg-emerald-500" : "bg-slate-300")} />
                <span>{autoRefresh ? "每 30 秒更新" : "自动刷新已暂停"}</span>
                <span>· 最近更新 {formatRefreshTime(lastUpdatedAt)}</span>
              </div>
            </div>
          </div>
          <div className="relative mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <GatewayMetricCard icon={<Activity className="size-4" />} label="请求总量" value={waitingForFirstLoad ? "—" : formatNumber(totals?.requests ?? 0)} hint="进入统一网关的业务请求" />
            <GatewayMetricCard icon={<CheckCircle2 className="size-4" />} label="成功率" value={waitingForFirstLoad ? "—" : `${totals?.success_rate ?? 0}%`} hint="最终获得有效响应" tone="emerald" />
            <GatewayMetricCard icon={<GitBranch className="size-4" />} label="降级率" value={waitingForFirstLoad ? "—" : `${totals?.fallback_rate ?? 0}%`} hint="使用了备用连接" tone="amber" />
            <GatewayMetricCard icon={<Clock3 className="size-4" />} label="平均延迟" value={waitingForFirstLoad ? "—" : `${formatNumber(totals?.average_latency_ms ?? 0)} ms`} hint="从请求到最终结果" tone="sky" />
            <GatewayMetricCard icon={<Zap className="size-4" />} label="Token 消耗" value={waitingForFirstLoad ? "—" : formatNumber(totals?.total_tokens ?? 0)} hint="统计区间内总消耗" />
            <GatewayMetricCard icon={<ShieldCheck className="size-4" />} label="熔断跳过" value={waitingForFirstLoad ? "—" : formatNumber(totals?.circuit_skips ?? 0)} hint={`${openCircuitCount} 条当前开启 · 熔断状态存于内存，服务重启后归零`} tone="amber" />
            <GatewayMetricCard
              icon={<Coins className="size-4" />}
              label="成本合计"
              value={waitingForFirstLoad ? "—" : formatCost(totals?.total_cost ?? 0)}
              hint={
                (totals?.unpriced_models ?? 0) > 0
                  ? `${totals?.unpriced_models} 个模型未配单价，未计入`
                  : "按已配单价实时折算"
              }
              tone="emerald"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle className="size-4 text-amber-500" />场景健康诊断</div>
            <div className="mt-1 text-xs text-slate-500">综合最终失败、降级、延迟和熔断状态，给出可解释的运行告警。</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="material-chip bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200">严重 {diagnostics?.summary.critical ?? 0}</span>
            <span className="material-chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">关注 {diagnostics?.summary.warning ?? 0}</span>
            <span className="material-chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">健康 {diagnostics?.summary.healthy ?? 0}</span>
            <span className="material-chip bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">待观察 {diagnostics?.summary.idle ?? 0}</span>
          </div>
        </div>
        {abnormalScenes.length ? (
          <div className="grid gap-2.5 p-4 lg:grid-cols-2">
            {abnormalScenes.slice(0, 8).map((scene) => {
              const critical = scene.status === "critical";
              return (
                <article key={scene.scene} className={cn("rounded-xl border p-3.5", critical ? "border-rose-200 bg-rose-50/55" : "border-amber-200 bg-amber-50/55")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{formatGatewayScene(scene.scene)}</div>
                      <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{scene.scene}</div>
                    </div>
                    <span className={cn("material-chip shrink-0", critical ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}>{critical ? "严重" : "需关注"}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 border-y border-slate-200 py-2.5 text-xs">
                    <div><div className="text-slate-500">成功率</div><div className="mt-1 font-semibold tabular-nums text-slate-800">{scene.success_rate}%</div></div>
                    <div><div className="text-slate-500">降级率</div><div className="mt-1 font-semibold tabular-nums text-slate-800">{scene.fallback_rate}%</div></div>
                    <div><div className="text-slate-500">平均延迟</div><div className="mt-1 font-semibold tabular-nums text-slate-800">{formatNumber(scene.average_latency_ms)} ms</div></div>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-xs leading-5 text-slate-600">
                    {scene.reasons.slice(0, 3).map((reason) => <li key={reason} className="flex gap-2"><span className={cn("mt-2 size-1.5 shrink-0 rounded-full", critical ? "bg-rose-500" : "bg-amber-500")} />{reason}</li>)}
                  </ul>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-[11px] tabular-nums text-muted-foreground">{formatNumber(scene.requests)} 次请求 · {scene.failed_requests} 次最终失败</span>
                    <Button variant="unstyled" type="button" className="cursor-pointer text-xs font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={() => onInspectScene(scene.scene)}>查看调用明细 →</Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : diagnostics && diagnostics.scenes.length > 0 ? (
          <div className="flex items-center gap-3 px-5 py-6 text-sm text-emerald-700"><CheckCircle2 className="size-5" />当前统计区间没有需要处理的异常场景。</div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">暂无足够调用数据，产生真实请求后将自动诊断。</div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="全部 AI 模型连接监控">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ServerCog className="size-4 text-blue-700" />全部模型连接</div>
            <div className="mt-1 text-xs text-slate-500">覆盖全部已配置 AI 模型；未产生调用的连接也会显示为“待观察”。点击连接查看完整监控详情。</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1 xl:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={connectionKeyword} onChange={(event) => { setConnectionKeyword(event.target.value); setConnectionPage(1); }} className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none hover:border-primary/25 focus:border-primary focus:ring-2 focus:ring-primary/25 xl:w-56" placeholder="搜索名称、供应商、模型" aria-label="搜索模型连接" />
            </label>
            <RadixSelectField value={connectionProvider} onValueChange={(value) => { setConnectionProvider(value); setConnectionPage(1); }} options={[
              { value: "", label: "全部供应商" },
              ...connectionProviders.map((provider) => ({ value: provider, label: provider })),
            ]} ariaLabel="按供应商筛选模型连接" className="min-w-32" />
            <RadixSelectField value={connectionStatus} onValueChange={(value) => { setConnectionStatus(value); setConnectionPage(1); }} options={[
              { value: "", label: "全部状态" },
              ...Object.entries(connectionStatusMeta).map(([value, item]) => ({ value, label: item.label })),
            ]} ariaLabel="按状态筛选模型连接" className="min-w-28" />
          </div>
        </div>
        {visibleConnections.length ? (
          <div className="grid gap-2.5 p-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleConnections.map((connection) => {
              const statusMeta = connectionStatusMeta[connection.status];
              return (
                <Button variant="unstyled" key={connection.id} type="button" onClick={(event) => { connectionDialogTriggerRef.current = event.currentTarget; setSelectedConnection(connection); }} className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-left transition-colors hover:border-primary/25 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" aria-label={`查看 ${connection.name} 监控详情`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{connection.name}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-500">{connection.provider} / {connection.model}</div></div>
                    <span className={cn("material-chip shrink-0 ring-1 ring-inset", statusMeta.className)}>{statusMeta.label}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-xs">
                    <div><dt className="text-[10px] text-slate-500">连接尝试</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{formatNumber(connection.requests)}</dd></div>
                    <div><dt className="text-[10px] text-slate-500">成功率</dt><dd className={cn("mt-1 font-semibold tabular-nums", connection.success_rate >= 90 ? "text-emerald-700" : connection.requests ? "text-amber-700" : "text-slate-500")}>{connection.requests ? `${connection.success_rate}%` : "—"}</dd></div>
                    <div><dt className="text-[10px] text-slate-500">平均延迟</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{connection.requests ? `${formatNumber(connection.average_latency_ms)} ms` : "—"}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-500"><span>{connection.last_called_at ? `最近调用 ${formatDate(connection.last_called_at)}` : "尚无网关调用"}</span><span className="font-semibold text-blue-700">查看详情 →</span></div>
                </Button>
              );
            })}
          </div>
        ) : <div className="px-6 py-14 text-center text-sm text-muted-foreground">暂无符合筛选条件的模型连接</div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2"><span>共 {filteredConnections.length} 条 · 第 {safeConnectionPage} / {connectionTotalPages} 页</span><RadixSelectField value={String(connectionPageSize)} onValueChange={(value) => { setConnectionPageSize(Number(value)); setConnectionPage(1); }} options={[{ value: "6", label: "6 条/页" }, { value: "9", label: "9 条/页" }, { value: "12", label: "12 条/页" }]} ariaLabel="每页模型监控数量" className="h-8 min-w-24" /></div>
          <div className="flex gap-2"><Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" disabled={safeConnectionPage <= 1 || loading} onClick={() => setConnectionPage(safeConnectionPage - 1)}>上一页</Button><Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" disabled={safeConnectionPage >= connectionTotalPages || loading} onClick={() => setConnectionPage(safeConnectionPage + 1)}>下一页</Button></div>
        </div>
      </section>

      <Dialog open={Boolean(selectedConnection)} onOpenChange={(open) => !open && setSelectedConnection(null)}>
        <DialogContent className="horizon-portal max-h-[88dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); window.setTimeout(() => connectionDialogTriggerRef.current?.focus(), 0); }}>
          <DialogHeader>
            <DialogTitle>{selectedConnection?.name ?? "模型连接详情"}</DialogTitle>
            <DialogDescription>{selectedConnection ? `${selectedConnection.provider} / ${selectedConnection.model}` : "查看模型连接运行状态"}</DialogDescription>
          </DialogHeader>
          {selectedConnection ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div><div className="text-xs text-slate-500">当前健康状态</div><div className="mt-1 text-sm font-semibold text-slate-900">{connectionStatusMeta[selectedConnection.status].label}</div></div>
                <span className={cn("material-chip ring-1 ring-inset", connectionStatusMeta[selectedConnection.status].className)}>{selectedConnection.enabled ? "连接已启用" : "连接已停用"}</span>
              </div>
              <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">连接尝试</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatNumber(selectedConnection.requests)}</dd></div>
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">成功 / 失败</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{selectedConnection.successful_requests} / {selectedConnection.failed_requests}</dd></div>
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">成功率</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">{selectedConnection.requests ? `${selectedConnection.success_rate}%` : "—"}</dd></div>
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">平均 / 最近延迟</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{selectedConnection.requests ? `${formatNumber(selectedConnection.average_latency_ms)} / ${formatNumber(selectedConnection.last_latency_ms ?? 0)} ms` : "—"}</dd></div>
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">熔断跳过 / 开启</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{selectedConnection.circuit_skips} / {selectedConnection.open_circuits}</dd></div>
                <div className="rounded-xl border border-slate-200 p-3"><dt className="text-slate-500">模型用途</dt><dd className="mt-1 font-semibold text-slate-900">{resolveExplicitUsage(resolveModelUsageKind({ model: selectedConnection.model, usage_kind: selectedConnection.usage_kind })).label}</dd></div>
              </dl>
              <dl className="grid gap-x-4 gap-y-3 rounded-xl border border-slate-200 p-4 text-xs sm:grid-cols-2">
                <div><dt className="text-slate-500">最近调用</dt><dd className="mt-1 text-slate-800">{selectedConnection.last_called_at ? formatDate(selectedConnection.last_called_at) : "暂无"}</dd></div>
                <div><dt className="text-slate-500">最近成功</dt><dd className="mt-1 text-slate-800">{selectedConnection.last_success_at ? formatDate(selectedConnection.last_success_at) : "暂无"}</dd></div>
                <div><dt className="text-slate-500">最近失败</dt><dd className="mt-1 text-slate-800">{selectedConnection.last_failure_at ? formatDate(selectedConnection.last_failure_at) : "暂无"}</dd></div>
                <div><dt className="text-slate-500">连接 ID</dt><dd className="mt-1 break-all font-mono text-[10px] text-slate-700">{selectedConnection.id}</dd></div>
              </dl>
              {selectedConnection.last_error_code || selectedConnection.last_error_message ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><div className="font-semibold">{selectedConnection.last_error_code ?? "UPSTREAM_ERROR"}</div><div className="mt-1 break-words">{selectedConnection.last_error_message ?? "上游调用失败"}</div></div> : null}
            </div>
          ) : null}
          <DialogFooter><Button variant="unstyled" type="button" className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={() => setSelectedConnection(null)}>关闭</Button><Button type="button" className="h-9 rounded-lg px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2" onClick={() => { if (selectedConnection) onInspectConnection(selectedConnection.id); setSelectedConnection(null); }}>查看该连接的调用明细</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5">
            <div><div className="text-sm font-semibold text-slate-900">请求趋势</div><div className="mt-1 text-xs text-slate-500">最近 14 个有调用记录的日期；柱高表示请求量</div></div>
            <span className="material-chip bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200">{trend.length} 个数据点</span>
          </div>
          <div className="material-scrollbar overflow-x-auto px-4 py-4">
            {trend.length ? (
              <div className="flex min-w-[640px] items-end gap-2" style={{ height: 220 }}>
                {trend.map((item) => (
                  <div key={item.date} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                    <div className="pointer-events-none absolute z-10 hidden -translate-y-3 rounded-xl bg-slate-950 px-3 py-2 text-[11px] leading-5 text-white shadow-xl group-hover:block">
                      <div>{formatNumber(item.requests)} 次请求 · 成功率 {item.success_rate}%</div>
                      <div className="text-slate-300">降级率 {item.fallback_rate}% · {formatNumber(item.total_tokens)} Token</div>
                    </div>
                    <div className="flex h-40 w-full items-end rounded-lg bg-slate-100 p-1">
                      <div className="w-full rounded-md bg-blue-600 transition-colors duration-200 group-hover:bg-primary-hover" style={{ height: `${Math.max(8, (item.requests / maxTrendRequests) * 100)}%` }} />
                    </div>
                    <div className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{new Date(item.date).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</div>
                  </div>
                ))}
              </div>
            ) : <div className="py-16 text-center text-sm text-muted-foreground">当前区间暂无趋势数据</div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-100 px-4 py-3.5"><div className="text-sm font-semibold text-slate-900">失败类型</div><div className="mt-1 text-xs text-slate-500">定位最常见的上游故障</div></div>
          <div className="divide-y divide-slate-100">
            {overview?.by_error.length ? overview.by_error.slice(0, 8).map((item) => (
              <div key={item.error_code} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><XCircle className="size-4" /></span><span className="truncate font-mono text-xs font-semibold text-slate-700">{item.error_code}</span></div>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(item.requests)}</span>
              </div>
            )) : <div className="px-6 py-16 text-center text-sm text-muted-foreground">当前区间没有失败请求</div>}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5">
          <div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="size-4 text-emerald-600" />连接熔断状态</div><div className="mt-1 text-xs text-slate-500">按业务场景隔离故障；开启时请求会直接尝试下一连接</div></div>
          <Button variant="unstyled" type="button" className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" disabled={!circuits.length || resettingCircuit !== null} onClick={() => void resetCircuit()}><RefreshCw className={cn("size-3.5", resettingCircuit === "all" && "animate-spin")} />全部重置</Button>
        </div>
        {circuits.length ? (
          <div className="grid gap-2.5 p-4 md:grid-cols-2 xl:grid-cols-3">
            {circuits.map((circuit) => {
              const key = `${circuit.scene}:${circuit.targetKey}`;
              return (
                <article key={key} className={cn("rounded-xl border p-3.5", circuit.state === "open" ? "border-rose-200 bg-rose-50/55" : "border-slate-200 bg-slate-50/60")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{circuit.provider} / {circuit.model}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-500">{circuit.targetKey}</div></div>
                    <span className={cn("material-chip shrink-0", circuit.state === "open" ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700")}>{circuit.state === "open" ? "熔断中" : "已关闭"}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><div className="text-slate-500">业务场景</div><div className="mt-1 font-medium text-slate-700">{formatGatewayScene(circuit.scene)}</div></div><div><div className="text-slate-500">连续失败</div><div className="mt-1 font-semibold tabular-nums text-slate-800">{circuit.consecutiveFailures} 次</div></div></div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-3"><div className="text-[11px] text-slate-500">最近失败 {formatDate(circuit.lastFailureAt)}</div><Button variant="unstyled" type="button" className="cursor-pointer text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50" disabled={resettingCircuit !== null} onClick={() => void resetCircuit(circuit)}>{resettingCircuit === key ? "重置中..." : "手动重置"}</Button></div>
                </article>
              );
            })}
          </div>
        ) : <div className="px-6 py-14 text-center text-sm text-muted-foreground">当前进程没有记录到连接失败，所有路由均可正常调度</div>}
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-100 px-4 py-3.5"><div className="text-sm font-semibold text-slate-900">按业务场景</div><div className="mt-1 text-xs text-slate-500">识别哪条业务链最需要优化</div></div>
          <div className="divide-y divide-slate-100">
            {overview?.by_scene.length ? overview.by_scene.map((item) => (
              <div key={item.scene} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800">{formatGatewayScene(item.scene)}</div><div className="mt-1 font-mono text-[10px] text-slate-500">{item.scene}</div></div>
                <div className="text-right"><div className="text-sm font-semibold tabular-nums text-emerald-700">{item.success_rate}%</div><div className="text-[10px] text-slate-500">成功率</div></div>
                <div className="w-20 text-right"><div className="text-sm font-semibold tabular-nums text-slate-800">{item.average_latency_ms} ms</div><div className="text-[10px] text-slate-500">平均延迟</div></div>
              </div>
            )) : <div className="px-6 py-14 text-center text-sm text-muted-foreground">当前区间暂无网关调用</div>}
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-100 px-4 py-3.5"><div className="text-sm font-semibold text-slate-900">按供应商与模型</div><div className="mt-1 text-xs text-slate-500">对比连接质量、Token 消耗与成本</div></div>
          <div className="divide-y divide-slate-100">
            {overview?.by_provider.length ? overview.by_provider.map((item) => (
              <div key={`${item.provider}:${item.model}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 px-4 py-3">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800">{item.provider}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-500">{item.model}</div></div>
                <div className="text-right"><div className="text-sm font-semibold tabular-nums text-emerald-700">{item.success_rate}%</div><div className="text-[10px] text-slate-500">{formatNumber(item.requests)} 次</div></div>
                <div className="w-20 text-right"><div className="text-sm font-semibold tabular-nums text-blue-700">{formatNumber(item.total_tokens)}</div><div className="text-[10px] text-slate-500">入 {formatNumber(item.prompt_tokens)} / 出 {formatNumber(item.completion_tokens)}</div></div>
                <div className="w-20 text-right">
                  {item.cost === null
                    ? <><div className="text-sm font-semibold tabular-nums text-muted-foreground">—</div><div className="text-[10px] text-muted-foreground">未配价</div></>
                    : <><div className="text-sm font-semibold tabular-nums text-blue-700">{formatCost(item.cost)}</div><div className="text-[10px] text-slate-500">成本</div></>}
                </div>
              </div>
            )) : <div className="px-6 py-14 text-center text-sm text-muted-foreground">当前区间暂无模型调用</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function GatewayRequestDetail({ item }: { item: AiGatewayRequestItem }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileSearch className="size-4 text-blue-700" />
            请求摘要
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-slate-500">请求时间</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{formatDate(item.created_at)}</dd></div>
            <div><dt className="text-slate-500">业务场景</dt><dd className="mt-1 font-medium text-slate-800">{formatGatewayScene(item.scene)}</dd></div>
            <div><dt className="text-slate-500">场景标识</dt><dd className="mt-1 truncate font-mono text-[11px] text-slate-700" title={item.scene}>{item.scene}</dd></div>
            <div><dt className="text-slate-500">最终模型</dt><dd className="mt-1 font-medium text-slate-800">{item.provider ? `${item.provider} / ${item.model ?? "—"}` : "未完成"}</dd></div>
            <div><dt className="text-slate-500">总延迟</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{formatNumber(item.latency_ms)} ms</dd></div>
            <div><dt className="text-slate-500">选模来源</dt><dd className={cn("mt-1 font-medium", item.route_source === "route" ? "text-blue-700" : "text-slate-800")}>{routeSourceLabel(item)}</dd></div>
            <div><dt className="text-slate-500">故障转移</dt><dd className={cn("mt-1 font-medium", item.fallback_used ? "text-amber-700" : "text-slate-800")}>{item.fallback_used ? `跨连接切换，第 ${item.attempt_count} 次尝试成功` : "无（首个连接直接成功）"}</dd></div>
          </dl>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-[10px] text-slate-500">请求 ID</div>
            <div className="mt-1 break-all font-mono text-[11px] text-slate-700">{item.id}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Zap className="size-4 text-blue-700" />
            Token 用量
          </div>
          <dl className="mt-3 grid grid-cols-3 divide-x divide-slate-100 rounded-lg bg-slate-50 py-3 text-center">
            <div className="px-2"><dt className="text-[10px] text-slate-500">输入</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-slate-800">{formatNumber(item.prompt_tokens)}</dd></div>
            <div className="px-2"><dt className="text-[10px] text-slate-500">输出</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-slate-800">{formatNumber(item.completion_tokens)}</dd></div>
            <div className="px-2"><dt className="text-[10px] text-slate-500">合计</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-blue-700">{formatNumber(item.total_tokens)}</dd></div>
          </dl>
          <div className="mt-3 text-xs leading-5 text-slate-500">Token 由最终成功的上游响应返回。失败请求或未返回 usage 的兼容接口可能显示为 0。</div>
        </div>
      </div>

      {item.error_code || item.error_message ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <div className="font-semibold">最终错误：{item.error_code ?? "UPSTREAM_ERROR"}</div>
          {item.error_message ? <div className="mt-1 break-words leading-5">{item.error_message}</div> : null}
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900">逐次尝试链</div>
          <div className="text-xs tabular-nums text-slate-500">共 {item.attempt_count} 次</div>
        </div>
        <div className="relative ml-3 space-y-3 border-l border-slate-300 pl-6">
          {item.attempts.map((attempt) => (
            <div key={attempt.sequence} className="relative rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className={cn("absolute -left-[31px] top-4 size-3 rounded-full ring-4 ring-slate-50", attempt.status === "success" ? "bg-emerald-500" : attempt.status === "failed" ? "bg-rose-500" : "bg-amber-500")} />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div><span className="text-xs font-bold text-slate-500">#{attempt.sequence}</span><span className="ml-2 text-sm font-semibold text-slate-800">{attempt.provider} / {attempt.model}</span></div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={attempt.connection_id ?? "未关联模型连接"}>连接 ID：{attempt.connection_id ?? "未关联模型连接"}</div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={cn("font-medium", attempt.status === "success" ? "text-emerald-700" : attempt.status === "failed" ? "text-rose-700" : "text-amber-700")}>{gatewayStatusLabel(attempt.status)}</span>
                  <span className="tabular-nums text-slate-500">{formatNumber(attempt.latency_ms)} ms</span>
                </div>
              </div>
              {attempt.error_code ? <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{attempt.error_code}{attempt.error_message ? ` · ${attempt.error_message}` : ""}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GatewayRequestWorkspace({
  data,
  models,
  loading,
  scene,
  status,
  connectionId,
  page,
  pageSize,
  onSceneChange,
  onStatusChange,
  onConnectionChange,
  onPageChange,
  onPageSizeChange,
  onReload,
}: {
  data: AiGatewayRequestPage | null;
  models: AiModelItem[];
  loading: boolean;
  scene: string;
  status: "" | "success" | "failed";
  connectionId: string;
  page: number;
  pageSize: number;
  onSceneChange: (scene: string) => void;
  onStatusChange: (status: "" | "success" | "failed") => void;
  onConnectionChange: (connectionId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onReload: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="text-sm font-semibold text-slate-900">逐次调用明细</div><div className="mt-1 text-xs text-slate-500">展开请求可查看主连接失败后如何切换到备用连接。</div></div>
        <div className="flex flex-wrap items-center gap-2">
          <RadixSelectField value={scene} onValueChange={onSceneChange} options={[{ value: "", label: "全部场景" }, ...GATEWAY_SCENES.map((item) => ({ value: item.value, label: item.label }))]} ariaLabel="按业务场景筛选请求" className="min-w-40" />
          <RadixSelectField value={connectionId} onValueChange={onConnectionChange} options={[{ value: "", label: "全部模型连接" }, ...models.map((item) => ({ value: item.id, label: `${item.name} · ${item.model}` }))]} ariaLabel="按模型连接筛选请求" className="min-w-48" />
          <RadixSelectField value={status} onValueChange={(value) => onStatusChange(value as "" | "success" | "failed")} options={[{ value: "", label: "全部状态" }, { value: "success", label: "成功" }, { value: "failed", label: "失败" }]} ariaLabel="按状态筛选请求" className="min-w-28" />
          <Button variant="unstyled" type="button" className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={onReload} aria-label="刷新请求明细"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
        </div>
      </div>
      <div className="material-scrollbar overflow-x-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500"><tr><th scope="col" className="w-12 px-5 py-3"><span className="sr-only">展开</span></th><th scope="col" className="px-3 py-3">时间 / 请求 ID</th><th scope="col" className="px-3 py-3">场景</th><th scope="col" className="px-3 py-3">最终模型</th><th scope="col" className="px-3 py-3">状态</th><th scope="col" className="px-3 py-3">路由</th><th scope="col" className="px-3 py-3 text-right">延迟</th><th scope="col" className="px-5 py-3 text-right">Token</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !data ? <tr><td colSpan={8} className="px-6 py-14 text-center text-sm text-muted-foreground">正在读取调用明细...</td></tr> : data?.items.length ? data.items.map((item) => {
              const expanded = expandedId === item.id;
              return (
                <React.Fragment key={item.id}>
                  <tr className="hover:bg-accent/40">
                    <td className="px-5 py-4 text-muted-foreground">
                      <Button variant="unstyled"
                        type="button"
                        className="flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "收起" : "展开"}请求 ${item.id} 明细`}
                      >
                        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    </td>
                    <td className="px-3 py-3"><div className="text-xs text-slate-700">{formatDate(item.created_at)}</div><div className="mt-1 max-w-48 truncate font-mono text-[9px] text-muted-foreground" title={item.id}>{item.id}</div></td>
                    <td className="px-3 py-3"><div className="text-xs font-medium text-slate-800">{formatGatewayScene(item.scene)}</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">{item.scene}</div></td>
                    <td className="px-3 py-3"><div className="text-xs text-slate-700">{item.provider ?? "—"}</div><div className="mt-1 max-w-48 truncate font-mono text-[9px] text-muted-foreground">{item.model ?? "未完成"}</div></td>
                    <td className="px-3 py-3"><span className={cn("material-chip", item.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{item.status === "success" ? <CheckCircle2 className="mr-1 size-3" /> : <XCircle className="mr-1 size-3" />}{gatewayStatusLabel(item.status)}</span></td>
                    <td className="px-3 py-3"><div className="text-xs font-semibold tabular-nums text-slate-800">{item.attempt_count} 次</div><div className="mt-1 text-[10px]"><span className={cn(item.route_source === "route" ? "font-medium text-blue-700" : "text-slate-500")}>{routeSourceLabel(item)}</span>{item.fallback_used && <span className="ml-1 text-amber-700">· 故障转移</span>}</div></td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-slate-700">{formatNumber(item.latency_ms)} ms</td>
                    <td className="px-5 py-3 text-right text-xs tabular-nums text-blue-700">{formatNumber(item.total_tokens)}</td>
                  </tr>
                  {expanded ? <tr><td colSpan={8} className="bg-slate-50/80 px-6 py-5"><GatewayRequestDetail item={item} /></td></tr> : null}
                </React.Fragment>
              );
            }) : <tr><td colSpan={8} className="px-6 py-14 text-center text-sm text-muted-foreground">暂无符合条件的网关请求</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-500"><div className="flex items-center gap-2"><span>共 {data?.pagination.total ?? 0} 条 · 第 {page} / {data?.pagination.total_pages ?? 1} 页</span><RadixSelectField value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))} options={[{ value: "10", label: "10 条/页" }, { value: "20", label: "20 条/页" }, { value: "50", label: "50 条/页" }]} ariaLabel="每页请求明细数量" className="h-8 min-w-24" /></div><div className="flex gap-2"><Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>上一页</Button><Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= (data?.pagination.total_pages ?? 1) || loading} onClick={() => onPageChange(page + 1)}>下一页</Button></div></div>
    </section>
  );
}

export function AiModelManagementPage() {
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("connections");
  const [gatewayRoutes, setGatewayRoutes] = useState<AiGatewayRoute[]>([]);
  /** 近 24h 各场景按选模来源的调用计数（scene → source → count），路由页运行期反馈用 */
  const [gatewayUsage, setGatewayUsage] = useState<Record<string, Record<string, number>>>({});
  const [gatewayModels, setGatewayModels] = useState<AiModelItem[]>([]);
  const [gatewayOverview, setGatewayOverview] = useState<AiGatewayOverview | null>(null);
  const [gatewayCircuits, setGatewayCircuits] = useState<AiGatewayCircuit[]>([]);
  const [gatewayRequests, setGatewayRequests] = useState<AiGatewayRequestPage | null>(null);
  const [gatewayRange, setGatewayRange] = useState<AiGatewayRange>("today");
  const [gatewayRequestScene, setGatewayRequestScene] = useState("");
  const [gatewayRequestStatus, setGatewayRequestStatus] = useState<"" | "success" | "failed">("");
  const [gatewayRequestConnectionId, setGatewayRequestConnectionId] = useState("");
  const [gatewayRequestPage, setGatewayRequestPage] = useState(1);
  const [gatewayRequestPageSize, setGatewayRequestPageSize] = useState(20);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayLoadedTab, setGatewayLoadedTab] = useState<WorkspaceTab | null>(null);
  const [gatewayReloadKey, setGatewayReloadKey] = useState(0);
  const [gatewayAutoRefresh, setGatewayAutoRefresh] = useState(true);
  const [gatewayLastUpdatedAt, setGatewayLastUpdatedAt] = useState<string | null>(null);
  const [gatewayError, setGatewayError] = useState("");
  const [rows, setRows] = useState<AiModelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  // 行内"测试连通性"按钮的 loading 标记（每行独立）
  const [rowTestingId, setRowTestingId] = useState<string | null>(null);
  const [bulkTestProgress, setBulkTestProgress] = useState<BulkTestProgress | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRow, setSelectedRow] = useState<AiModelItem | null>(null);
  const [providerOptions, setProviderOptions] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OpenAI");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [usageKind, setUsageKind] = useState("auto");
  // 单价以字符串保存：允许中途为空，提交时才归一成数字，避免输入过程被强制成 0
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isDefaultEnabled, setIsDefaultEnabled] = useState(true);
  const [dialogError, setDialogError] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const normalizedKeyword = deferredKeyword.trim();

  // ── 百炼预设 / 导入 / 导出 ──────────────────────────────────────────────────
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetSelected, setPresetSelected] = useState<Set<string>>(new Set());
  const [presetExisting, setPresetExisting] = useState<Set<string>>(new Set());
  const [presetApiKey, setPresetApiKey] = useState("");
  const [presetBaseUrl, setPresetBaseUrl] = useState(BAILIAN_BASE_URL);
  const [presetSaving, setPresetSaving] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRows, setExportRows] = useState<AiModelItem[]>([]);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());
  const [exportLoading, setExportLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importEntries, setImportEntries] = useState<ImportEntry[]>([]);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  const [importApiKey, setImportApiKey] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);

  function rememberDialogTrigger() {
    dialogReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    window.setTimeout(() => dialogReturnFocusRef.current?.focus(), 0);
  }

  const loadRows = useCallback(async (targetPage = page) => {
    setLoading(true);
    setRowsError("");
    try {
      const response = await integrationManagementApi.listAiModels({
        page: targetPage,
        pageSize,
        keyword: normalizedKeyword,
      });
      setRows(response.items);
      setTotal(response.total);
      setTotalPages(Math.max(1, response.total_pages));
      if (targetPage > response.total_pages) {
        setPage(Math.max(1, response.total_pages));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 AI 模型列表失败";
      setRowsError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [normalizedKeyword, page, pageSize]);

  const loadGatewayRoutes = useCallback(async () => {
    setGatewayLoading(true);
    setGatewayError("");
    try {
      const [routeResponse, models] = await Promise.all([
        integrationManagementApi.listAiGatewayRoutes(),
        fetchAllAiModels(),
      ]);
      setGatewayRoutes(routeResponse.items);
      setGatewayUsage(routeResponse.usage_24h ?? {});
      setGatewayModels(models);
      setGatewayLoadedTab("routes");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 AI 路由失败";
      setGatewayError(message);
      toast.error(message);
    } finally {
      setGatewayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceTab === "connections") return;
    let cancelled = false;
    setGatewayLoading(true);
    setGatewayError("");
    if (workspaceTab !== "monitor") setGatewayLoadedTab(null);
    if (workspaceTab === "routes") {
      Promise.all([integrationManagementApi.listAiGatewayRoutes(), fetchAllAiModels()])
        .then(([routeResponse, models]) => {
          if (cancelled) return;
          setGatewayRoutes(routeResponse.items);
          setGatewayUsage(routeResponse.usage_24h ?? {});
          setGatewayModels(models);
          setGatewayLoadedTab("routes");
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : "读取 AI 路由失败";
          setGatewayError(message);
          toast.error(message);
        })
        .finally(() => !cancelled && setGatewayLoading(false));
    } else if (workspaceTab === "monitor") {
      Promise.all([
        integrationManagementApi.getAiGatewayOverview(gatewayRange),
        integrationManagementApi.listAiGatewayCircuits(),
      ])
        .then(([response, circuitResponse]) => {
          if (!cancelled) {
            setGatewayOverview(response);
            setGatewayCircuits(circuitResponse.items);
            setGatewayLoadedTab("monitor");
            setGatewayLastUpdatedAt(new Date().toISOString());
          }
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : "读取网关监控失败";
          setGatewayError(message);
          toast.error(message);
        })
        .finally(() => !cancelled && setGatewayLoading(false));
    } else {
      Promise.all([
        integrationManagementApi.listAiGatewayRequests({
          scene: gatewayRequestScene,
          status: gatewayRequestStatus,
          connectionId: gatewayRequestConnectionId,
          page: gatewayRequestPage,
          pageSize: gatewayRequestPageSize,
        }),
        fetchAllAiModels(),
      ])
        .then(([response, models]) => {
          if (!cancelled) {
            setGatewayRequests(response);
            setGatewayModels(models);
            setGatewayLoadedTab("requests");
          }
        })
        .catch((error) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : "读取网关请求失败";
          setGatewayError(message);
          toast.error(message);
        })
        .finally(() => !cancelled && setGatewayLoading(false));
    }
    return () => { cancelled = true; };
  }, [workspaceTab, gatewayRange, gatewayRequestScene, gatewayRequestStatus, gatewayRequestConnectionId, gatewayRequestPage, gatewayRequestPageSize, gatewayReloadKey]);

  useEffect(() => {
    if (workspaceTab !== "monitor" || !gatewayAutoRefresh || gatewayLoading) return;
    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setGatewayReloadKey((key) => key + 1);
      }
    };
    const timerId = window.setInterval(reloadWhenVisible, 30_000);
    document.addEventListener("visibilitychange", reloadWhenVisible);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
    };
  }, [workspaceTab, gatewayAutoRefresh, gatewayLoading]);

  useEffect(() => {
    setPage(1);
  }, [normalizedKeyword, pageSize]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const types = await dictionaryApi.listTypes();
        const providerType = types.find((type) => type.key === AI_PROVIDER_DICT_KEY);
        if (!providerType) return;
        const response = await dictionaryApi.listItems(providerType.id, { page: 1, pageSize: 100 });
        if (cancelled) return;
        const labels = response.items
          .map((item) => (item.kind === "generic" ? item.label.trim() : ""))
          .filter((label) => label.length > 0);
        setProviderOptions(Array.from(new Set(labels)));
      } catch {
        // 字典不可用时静默降级为纯文本输入
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setName("");
    setProvider("OpenAI");
    setModel("");
    setBaseUrl("");
    setApiKey("");
    setUsageKind("auto");
    setInputPrice("");
    setOutputPrice("");
    setEnabled(true);
    setIsDefaultEnabled(true);
    setDialogError("");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRow(null);
    resetForm();
  }

  function openCreate() {
    rememberDialogTrigger();
    setSelectedRow(null);
    resetForm();
    setDialogMode("create");
  }

  /**
   * 快捷新增 Embedding 模型（RAG 向量检索专用）。
   * 预填通义 text-embedding-v3，用户只需填 name + API Key 即可保存。
   */
  function openCreateEmbedding() {
    rememberDialogTrigger();
    setSelectedRow(null);
    setName("通义 Embedding");
    setProvider("Qwen");
    setModel("text-embedding-v3");
    setBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
    setApiKey("");
    setUsageKind("embedding");
    setEnabled(true);
    setIsDefaultEnabled(false);
    setDialogError("");
    setDialogMode("create");
  }

  function openEdit(row: AiModelItem) {
    rememberDialogTrigger();
    setSelectedRow(row);
    setName(row.name);
    setProvider(row.provider || "OpenAI");
    setModel(row.model);
    setBaseUrl(row.base_url || "");
    setApiKey("");
    setUsageKind(row.usage_kind || "auto");
    setInputPrice(row.input_price_per_1k > 0 ? String(row.input_price_per_1k) : "");
    setOutputPrice(row.output_price_per_1k > 0 ? String(row.output_price_per_1k) : "");
    setEnabled(row.enabled);
    setIsDefaultEnabled(row.is_default_enabled);
    setDialogMode("edit");
  }

  function openDelete(row: AiModelItem) {
    rememberDialogTrigger();
    setSelectedRow(row);
    setDialogMode("delete");
  }

  async function handleSave() {
    if (!name.trim() || !provider.trim() || !model.trim()) {
      const message = "请先填写模型名称、服务商和模型标识";
      setDialogError(message);
      toast.error(message);
      window.requestAnimationFrame(() => {
        const targetId = !name.trim() ? "ai-model-name" : "ai-model-identifier";
        document.getElementById(targetId)?.focus();
      });
      return;
    }

    setDialogError("");
    setSaving(true);
    try {
      await integrationManagementApi.saveAiModel({
        id: selectedRow?.id,
        name: name.trim(),
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        usage_kind: usageKind,
        input_price_per_1k: parsePriceInput(inputPrice),
        output_price_per_1k: parsePriceInput(outputPrice),
        api_key: apiKey.trim() || undefined,
        enabled,
        current_status: selectedRow?.current_status ?? "未配置",
        is_default_enabled: isDefaultEnabled,
      });
      toast.success(dialogMode === "edit" ? "AI 模型已更新" : "AI 模型已新增");
      closeDialog();
      if (page !== 1) {
        setPage(1);
      } else {
        await loadRows(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 AI 模型失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!model.trim()) {
      const message = "请先填写模型标识";
      setDialogError(message);
      toast.error(message);
      window.requestAnimationFrame(() => document.getElementById("ai-model-identifier")?.focus());
      return;
    }

    setDialogError("");
    setTestingConnection(true);
    try {
      const result = await integrationManagementApi.testAiModelConnection({
        id: selectedRow?.id,
        provider: provider.trim(),
        model: model.trim(),
        base_url: baseUrl.trim() || undefined,
        usage_kind: usageKind,
        api_key: apiKey.trim() || undefined,
      });

      if (result.success) {
        toast.success(
          `测试成功${typeof result.duration_ms === "number" ? `，耗时 ${result.duration_ms} ms` : ""}`,
        );
      } else {
        toast.error(result.message);
      }

      await loadRows(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 连通性测试失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setTestingConnection(false);
    }
  }

  /**
   * 列表操作栏的"测试连通性"——直接用 row 数据测试，不弹编辑对话框。
   * API Key 走已保存的密文，base_url / provider / model 都从 row 取。
   */
  async function handleTestRowConnection(row: AiModelItem) {
    if (rowTestingId || bulkTestProgress) return;
    setRowTestingId(row.id);
    try {
      const result = await integrationManagementApi.testAiModelConnection({
        id: row.id,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        usage_kind: row.usage_kind || "auto",
      });
      if (result.success) {
        toast.success(
          `${row.name} 连通性正常${typeof result.duration_ms === "number" ? `，耗时 ${result.duration_ms} ms` : ""}`,
        );
      } else {
        toast.error(`${row.name} 测试失败：${result.message}`);
      }
      await loadRows(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 连通性测试失败");
    } finally {
      setRowTestingId(null);
    }
  }

  async function handleTestAllConnections() {
    if (bulkTestProgress || rowTestingId || testingConnection) return;

    setBulkTestProgress({ completed: 0, total: 0, succeeded: 0, failed: 0 });
    try {
      const models = await fetchAllAiModels();
      if (models.length === 0) {
        toast.info("暂无可测试的 AI 模型");
        return;
      }

      setBulkTestProgress({ completed: 0, total: models.length, succeeded: 0, failed: 0 });
      const failures: string[] = [];
      let nextIndex = 0;

      const worker = async () => {
        for (;;) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= models.length) return;

          const row = models[index];
          let succeeded = false;
          try {
            const result = await integrationManagementApi.testAiModelConnection({
              id: row.id,
              provider: row.provider,
              model: row.model,
              base_url: row.base_url || undefined,
              usage_kind: row.usage_kind || "auto",
            });
            succeeded = result.success;
            if (!result.success) failures.push(`${row.name}：${result.message}`);
          } catch (error) {
            failures.push(`${row.name}：${error instanceof Error ? error.message : "测试失败"}`);
          } finally {
            setBulkTestProgress((current) => current ? {
              ...current,
              completed: current.completed + 1,
              succeeded: current.succeeded + (succeeded ? 1 : 0),
              failed: current.failed + (succeeded ? 0 : 1),
            } : current);
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(BULK_TEST_CONCURRENCY, models.length) },
          () => worker(),
        ),
      );

      const succeededCount = models.length - failures.length;
      if (failures.length === 0) {
        toast.success(`全部 ${models.length} 个 AI 模型连通性正常`);
      } else {
        const failurePreview = failures.slice(0, 3).join("；");
        const remaining = failures.length > 3 ? `；另有 ${failures.length - 3} 个失败` : "";
        toast.warning(
          `全部测试完成：成功 ${succeededCount}，失败 ${failures.length}。${failurePreview}${remaining}`,
          { duration: 10_000 },
        );
      }

      await loadRows(page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量测试 AI 连通性失败");
    } finally {
      setBulkTestProgress(null);
    }
  }

  async function handleToggleEnabled(row: AiModelItem, checked: boolean) {
    try {
      const saved = await integrationManagementApi.saveAiModel({
        id: row.id,
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        enabled: checked,
        current_status: row.current_status,
        is_default_enabled: row.is_default_enabled,
      });
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)));
      if (selectedRow?.id === row.id) {
        setSelectedRow(saved);
      }
      toast.success(checked ? "AI 模型已启用" : "AI 模型已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新 AI 模型启用状态失败");
    }
  }

  async function handleDelete() {
    if (!selectedRow) return;

    setDeleting(true);
    try {
      const result = await integrationManagementApi.deleteAiModel(selectedRow.id);
      // 该连接曾挂在网关路由里：级联删除已把对应 target 一并移除，明示受影响场景，
      // 否则那些路由会静默回落默认，无从排查
      if (result.affected_routes && result.affected_routes.length > 0) {
        toast.warning(
          `AI 模型已删除。注意：它已从 ${result.affected_routes.length} 条路由中移除（${result.affected_routes
            .map((route) => route.name || route.scene)
            .join("、")}），相关场景可能回落到默认模型，请到「路由策略」确认。`,
          { duration: 10000 },
        );
      } else {
        toast.success("AI 模型已删除");
      }
      closeDialog();
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除 AI 模型失败");
    } finally {
      setDeleting(false);
    }
  }

  // ── 百炼预设新增 ────────────────────────────────────────────────────────────

  async function openPresetDialog() {
    rememberDialogTrigger();
    setPresetApiKey("");
    setPresetBaseUrl(BAILIAN_BASE_URL);
    try {
      const all = await fetchAllAiModels();
      const existingModels = new Set(all.map((item) => item.model.trim().toLowerCase()));
      setPresetExisting(existingModels);
      setPresetSelected(new Set(BAILIAN_PRESET_MODELS.filter((item) => !existingModels.has(item.model.toLowerCase())).map((item) => item.model)));
    } catch (error) {
      // 拉全量失败时降级为不去重（只影响"已存在"标记，不影响新增本身）
      setPresetExisting(new Set());
      setPresetSelected(new Set(BAILIAN_PRESET_MODELS.map((item) => item.model)));
      toast.error(error instanceof Error ? error.message : "读取现有模型列表失败");
    }
    setPresetOpen(true);
  }

  function togglePresetModel(model: string) {
    setPresetSelected((current) => {
      const next = new Set(current);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  function selectAllPresetModels() {
    setPresetSelected(new Set(
      BAILIAN_PRESET_MODELS
        .filter((item) => !presetExisting.has(item.model.toLowerCase()))
        .map((item) => item.model),
    ));
  }

  async function handlePresetCreate() {
    const targets = BAILIAN_PRESET_MODELS.filter((item) => presetSelected.has(item.model));
    if (targets.length === 0) {
      toast.error("请先勾选要新增的模型");
      return;
    }
    if (!presetBaseUrl.trim()) {
      toast.error("请填写 Base URL");
      return;
    }

    setPresetSaving(true);
    const sharedApiKey = presetApiKey.trim();
    const failures: string[] = [];
    try {
      for (const item of targets) {
        try {
          await integrationManagementApi.saveAiModel({
            name: `${item.brand} ${item.model}`,
            provider: item.provider,
            model: item.model,
            base_url: presetBaseUrl.trim(),
            api_key: sharedApiKey || undefined,
            usage_kind: item.usageKind,
            // 未填写 Token 时先以停用状态建档，管理员补录 Token 后再启用。
            enabled: Boolean(sharedApiKey),
            current_status: "未配置",
            // 只做新增：不抢默认模型，避免影响现有配置
            is_default_enabled: false,
          });
        } catch (error) {
          failures.push(`${item.model}：${error instanceof Error ? error.message : "保存失败"}`);
        }
      }
      const successCount = targets.length - failures.length;
      if (successCount > 0) {
        toast.success(sharedApiKey ? `已新增 ${successCount} 个模型配置` : `已新增 ${successCount} 个模型配置，请补录 Token 后启用`);
      }
      if (failures.length > 0) {
        toast.error(`有 ${failures.length} 个模型新增失败：${failures[0]}`);
      }
      if (successCount > 0) {
        setPresetOpen(false);
        setPresetApiKey("");
        if (page !== 1) setPage(1);
        else await loadRows(1);
      }
    } finally {
      setPresetSaving(false);
    }
  }

  // ── 导出 ────────────────────────────────────────────────────────────────────

  async function openExportDialog() {
    rememberDialogTrigger();
    setExportLoading(true);
    try {
      const all = await fetchAllAiModels();
      if (all.length === 0) {
        toast.error("暂无可导出的模型配置");
        return;
      }
      setExportRows(all);
      setExportSelected(new Set(all.map((item) => item.id)));
      setExportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取模型列表失败");
    } finally {
      setExportLoading(false);
    }
  }

  function toggleExportRow(id: string) {
    setExportSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExport() {
    const selected = exportRows.filter((row) => exportSelected.has(row.id));
    if (selected.length === 0) {
      toast.error("请先勾选要导出的模型配置");
      return;
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    downloadJsonFile(`ai-models-export-${stamp}.json`, {
      version: 1,
      exported_at: now.toISOString(),
      models: selected.map((row) => ({
        name: row.name,
        provider: row.provider,
        model: row.model,
        base_url: row.base_url || undefined,
        usage_kind: row.usage_kind || "auto",
        enabled: row.enabled,
      }) satisfies ExportedModel),
    });
    toast.success(`已导出 ${selected.length} 个模型配置（不含 API Key）`);
    setExportOpen(false);
  }

  // ── 导入 ────────────────────────────────────────────────────────────────────

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const [entries, all] = await Promise.all([
        file.text().then(parseImportedModels),
        fetchAllAiModels().catch(() => [] as AiModelItem[]),
      ]);
      const existing = new Set(all.map((item) => item.model.trim().toLowerCase()));
      const marked = entries.map((entry) => ({
        ...entry,
        duplicate: existing.has(entry.model.toLowerCase()),
      }));
      setImportEntries(marked);
      // 与现有模型标识重复的条目默认不勾选，避免无意间导入重复配置
      setImportSelected(new Set(marked.map((entry, index) => (entry.duplicate ? -1 : index)).filter((index) => index >= 0)));
      setImportApiKey("");
      setImportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "解析导入文件失败");
    }
  }

  function toggleImportEntry(index: number) {
    setImportSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleImportCreate() {
    const targets = importEntries.filter((_, index) => importSelected.has(index));
    if (targets.length === 0) {
      toast.error("请先勾选要导入的模型配置");
      return;
    }

    setImportSaving(true);
    const failures: string[] = [];
    try {
      for (const entry of targets) {
        try {
          await integrationManagementApi.saveAiModel({
            name: entry.name,
            provider: entry.provider,
            model: entry.model,
            base_url: entry.base_url || undefined,
            api_key: importApiKey.trim() || undefined,
            usage_kind: entry.usage_kind || "auto",
            enabled: entry.enabled ?? true,
            current_status: "未配置",
            // 只做新增：导入不抢默认模型，避免清掉现有默认项
            is_default_enabled: false,
          });
        } catch (error) {
          failures.push(`${entry.model}：${error instanceof Error ? error.message : "保存失败"}`);
        }
      }
      const successCount = targets.length - failures.length;
      if (successCount > 0) {
        toast.success(`已导入 ${successCount} 个模型配置`);
      }
      if (failures.length > 0) {
        toast.error(`有 ${failures.length} 个模型导入失败：${failures[0]}`);
      }
      if (successCount > 0) {
        setImportOpen(false);
        setImportEntries([]);
        if (page !== 1) setPage(1);
        else await loadRows(1);
      }
    } finally {
      setImportSaving(false);
    }
  }

  function handleJump() {
    const value = Number.parseInt(jumpInput, 10);
    if (Number.isNaN(value)) {
      setJumpInput("");
      return;
    }

    setPage(Math.min(totalPages, Math.max(1, value)));
    setJumpInput("");
  }

  const visibleEnabledCount = rows.filter((row) => row.enabled).length;
  const visibleHealthyCount = rows.filter((row) => row.current_status === "运行正常").length;
  const visibleIssueCount = rows.filter((row) => row.current_status === "连接异常").length;
  const visibleConfiguredCount = rows.filter((row) => Boolean(row.base_url)).length;
  const headerActionButtonClass = "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="horizon-theme hz-page mx-auto w-full max-w-[1680px] min-w-0">
      <HorizonPageHeader
        Icon={ServerCog}
        eyebrow="平台治理 · AI 基础设施"
        title="AI 模型控制台"
        description="统一管理模型连接、路由优先级、运行状态与逐次故障切换记录。"
        meta={<span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />INOGI 内置服务</span>}
        actions={workspaceTab === "connections" ? <div className="flex max-w-full flex-wrap items-center justify-end gap-2" aria-label="模型配置操作">
            <Button variant="unstyled"
              type="button"
              className={headerActionButtonClass}
              onClick={() => void handleTestAllConnections()}
              disabled={bulkTestProgress !== null || rowTestingId !== null || testingConnection}
              title="对全部已存在的 AI 模型进行连通性测试（最多同时测试 3 个）"
            >
              <Wifi className={cn("h-4 w-4", bulkTestProgress && "animate-pulse text-sky-600")} />
              <span aria-live="polite">
                {bulkTestProgress
                  ? `测试中 ${bulkTestProgress.completed}/${bulkTestProgress.total || "-"}`
                  : "全部测试"}
              </span>
            </Button>
            <Button variant="unstyled"
              type="button"
              className={headerActionButtonClass}
              onClick={() => { rememberDialogTrigger(); importFileRef.current?.click(); }}
              title="从 JSON 文件导入模型配置（只新增，不修改现有配置）"
            >
              <Upload className="h-4 w-4" />
              导入
            </Button>
            <Button variant="unstyled"
              type="button"
              className={headerActionButtonClass}
              onClick={() => void openExportDialog()}
              disabled={exportLoading}
              title="勾选现有模型配置并导出为 JSON 文件（不含 API Key）"
            >
              <Download className="h-4 w-4" />
              {exportLoading ? "读取中..." : "导出"}
            </Button>
            <Button variant="unstyled"
              type="button"
              className={headerActionButtonClass}
              onClick={() => void openPresetDialog()}
              title="从阿里云百炼 Token Plan 可使用模型目录中批量新增"
            >
              <PackagePlus className="h-4 w-4" />
              百炼预设
            </Button>
            <Input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="选择模型配置 JSON 文件"
              onChange={(event) => void handleImportFile(event)}
            />
            <Button variant="unstyled"
              type="button"
              className={headerActionButtonClass}
              onClick={openCreateEmbedding}
              title="一键新增 Embedding 模型，用于知识库 RAG 向量检索"
            >
              <Plus className="h-4 w-4" />
              新增 Embedding
            </Button>
            <Button type="button" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新增模型
            </Button>
          </div> : null}
      />

      <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
        <HorizonMetric Icon={ServerCog} label="模型连接" value={loading && total === 0 ? "—" : total} note={`当前筛选共 ${total} 条配置`} tone="brand" />
        <HorizonMetric Icon={Wifi} label="本页启用" value={loading && rows.length === 0 ? "—" : `${visibleEnabledCount}/${rows.length}`} note="按当前页实际启用状态计算" tone="success" />
        <HorizonMetric Icon={CheckCircle2} label="连接正常" value={loading && rows.length === 0 ? "—" : visibleHealthyCount} note={`当前页 ${visibleConfiguredCount} 条使用自定义地址`} tone="success" />
        <HorizonMetric Icon={AlertTriangle} label="连接异常" value={loading && rows.length === 0 ? "—" : visibleIssueCount} note="最近一次连通性结果为异常" tone={visibleIssueCount > 0 ? "danger" : "neutral"} />
      </HorizonMetricGrid>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 text-slate-900 shadow-sm" aria-label="AI 模型与网关工作台">

      <Tabs value={workspaceTab} onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)} className="gap-0">
      <TabsList className="relative flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-slate-100 bg-slate-50/80 px-3 py-2" aria-label="AI 控制台工作区">
        {GATEWAY_TABS.map((tab) => {
          const Icon = tab.icon;
          return <TabsTrigger key={tab.value} value={tab.value} title={tab.description} className="group h-10 flex-none cursor-pointer gap-2 rounded-lg border border-transparent px-3 text-left text-slate-500 data-[state=active]:border-primary/25 data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm hover:border-slate-200 hover:bg-white hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-primary/25"><Icon className="size-4 text-muted-foreground group-data-[state=active]:text-primary" /><span className="text-xs font-semibold">{tab.label}</span></TabsTrigger>;
        })}
      </TabsList>

      <div className="relative bg-slate-50/55 p-3 md:p-4">

      <TabsContent value="routes" className="mt-0"><GatewayRouteWorkspace routes={gatewayRoutes} models={gatewayModels} usage={gatewayUsage} loading={gatewayLoading || gatewayLoadedTab !== "routes"} onReload={loadGatewayRoutes} /></TabsContent>
      <TabsContent value="monitor" className="mt-0"><GatewayMonitorWorkspace range={gatewayRange} overview={gatewayLoadedTab === "monitor" && gatewayOverview?.range === gatewayRange ? gatewayOverview : null} circuits={gatewayLoadedTab === "monitor" ? gatewayCircuits : []} loading={gatewayLoading || gatewayLoadedTab !== "monitor"} autoRefresh={gatewayAutoRefresh} lastUpdatedAt={gatewayLastUpdatedAt} onRangeChange={(nextRange) => { setGatewayLastUpdatedAt(null); setGatewayRange(nextRange); }} onAutoRefreshChange={setGatewayAutoRefresh} onReload={() => setGatewayReloadKey((key) => key + 1)} onInspectScene={(scene) => { setGatewayRequestScene(scene); setGatewayRequestStatus(""); setGatewayRequestConnectionId(""); setGatewayRequestPage(1); setWorkspaceTab("requests"); }} onInspectConnection={(connectionId) => { setGatewayRequestScene(""); setGatewayRequestStatus(""); setGatewayRequestConnectionId(connectionId); setGatewayRequestPage(1); setWorkspaceTab("requests"); }} /></TabsContent>
      <TabsContent value="requests" className="mt-0"><GatewayRequestWorkspace data={gatewayLoadedTab === "requests" ? gatewayRequests : null} models={gatewayModels} loading={gatewayLoading || gatewayLoadedTab !== "requests"} scene={gatewayRequestScene} status={gatewayRequestStatus} connectionId={gatewayRequestConnectionId} page={gatewayRequestPage} pageSize={gatewayRequestPageSize} onSceneChange={(value) => { setGatewayRequestScene(value); setGatewayRequestPage(1); }} onStatusChange={(value) => { setGatewayRequestStatus(value); setGatewayRequestPage(1); }} onConnectionChange={(value) => { setGatewayRequestConnectionId(value); setGatewayRequestPage(1); }} onPageChange={setGatewayRequestPage} onPageSizeChange={(value) => { setGatewayRequestPageSize(value); setGatewayRequestPage(1); }} onReload={() => setGatewayReloadKey((key) => key + 1)} /></TabsContent>

      <TabsContent value="connections" className="mt-0"><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="AI 模型连接列表" aria-busy={loading}>
        <div className="border-b border-slate-100 p-3 md:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-muted-foreground hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/25"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索模型、服务商或模型标识"
                aria-label="搜索模型连接"
              />
            </div>
            <p className="text-xs text-slate-500" aria-live="polite">当前页 {rows.length} 条 · 自定义地址 {visibleConfiguredCount} 条<span className="sr-only"> · 本页启用 {visibleEnabledCount}/{rows.length}</span></p>
          </div>
        </div>

        <div className="p-3 md:p-4">
          {rowsError ? (
            <WorkspaceErrorState message={rowsError} onRetry={() => void loadRows(page)} />
          ) : loading ? (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-live="polite" aria-label="正在读取模型连接">
              <span className="sr-only">正在读取模型连接</span>
              {Array.from({ length: Math.min(pageSize, 6) }, (_, index) => <div key={index} className="h-52 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />)}
            </div>
          ) : rows.length === 0 ? (
            <HorizonEmptyState Icon={ServerCog} title="没有找到模型连接" description={normalizedKeyword ? "调整搜索条件，或清空关键词后重试。" : "新增一个模型连接，或从百炼预设批量导入。"} action={!normalizedKeyword ? <Button variant="unstyled" type="button" className="material-button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={openCreate}>新增模型</Button> : undefined} />
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => {
                const explicitKind = row.usage_kind && row.usage_kind !== "auto" ? row.usage_kind : null;
                const usage = resolveExplicitUsage(resolveModelUsageKind(row));
                const healthy = row.current_status === "运行正常";
                const failed = row.current_status === "连接异常";
                const providerMark = (row.provider || row.name).trim().slice(0, 2).toUpperCase();
                return (
                  <article key={row.id} className="group relative min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-colors hover:border-primary/25">
                    <div className={cn("absolute inset-x-0 top-0 h-0.5", healthy ? "bg-emerald-500" : failed ? "bg-rose-500" : "bg-slate-300")} />
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-mono text-[11px] font-bold text-blue-700 ring-1 ring-inset ring-blue-100">{providerMark}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-slate-900" title={row.name}>{row.name}</h3>
                          <span className={cn("size-1.5 shrink-0 rounded-full", healthy ? "bg-emerald-500" : failed ? "bg-rose-500" : "bg-amber-500")} />
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={`${row.provider} / ${row.model}`}>{row.provider} / {row.model}</div>
                      </div>
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(checked) => void handleToggleEnabled(row, checked)}
                        aria-label={`${row.enabled ? "停用" : "启用"} ${row.name}`}
                        className="shrink-0 data-[state=checked]:bg-primary data-[state=unchecked]:bg-slate-300"
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className={cn("material-chip shrink-0", statusToneMap[row.current_status] ?? statusToneMap.未配置)}>{row.current_status}</span>
                      <span className={cn("material-chip shrink-0", usageToneMap[usage.kind])}>{usage.label}</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">{explicitKind ? "手动" : "自动"}</span>
                      {row.is_default_enabled ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">默认</span> : null}
                    </div>

                    {row.last_error_message ? <div className="mt-2 truncate rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-700" title={row.last_error_message}>{row.last_error_message}</div> : null}

                    <div className="mt-3 grid grid-cols-4 divide-x divide-slate-100 border-y border-slate-100 py-2.5 text-center">
                      <div className="px-1"><div className="text-[9px] font-medium text-muted-foreground">延迟</div><div className="mt-1 truncate text-xs font-semibold tabular-nums text-slate-800">{typeof row.last_latency_ms === "number" ? `${row.last_latency_ms}ms` : "—"}</div></div>
                      <div className="px-1"><div className="text-[9px] font-medium text-muted-foreground">请求</div><div className="mt-1 text-xs font-semibold tabular-nums text-sky-700">{formatNumber(row.today_requests)}</div></div>
                      <div className="px-1"><div className="text-[9px] font-medium text-muted-foreground">今日 Token</div><div className="mt-1 text-xs font-semibold tabular-nums text-blue-700">{formatNumber(row.today_tokens)}</div></div>
                      <div className="px-1"><div className="text-[9px] font-medium text-muted-foreground">累计</div><div className="mt-1 text-xs font-semibold tabular-nums text-amber-700">{formatNumber(row.total_tokens ?? row.today_tokens ?? 0)}</div></div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[10px] leading-4 text-slate-500">
                        <div className="truncate" title={row.base_url || "未配置 Base URL，默认走官方地址"}>{row.base_url || "默认官方地址"}</div>
                        <div className="truncate">最近成功 {formatDate(row.last_success_at)} · {row.operator_name}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="unstyled" type="button" className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void handleTestRowConnection(row)} disabled={rowTestingId !== null || bulkTestProgress !== null} title="测试连通性" aria-label={`测试 ${row.name} 连通性`}><Wifi className={cn("size-3.5", (rowTestingId === row.id || bulkTestProgress !== null) && "animate-pulse text-blue-600")} /></Button>
                        <Button variant="unstyled" type="button" className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25" onClick={() => openEdit(row)} title="编辑" aria-label={`编辑 ${row.name}`}><Pencil className="size-3.5" /></Button>
                        <Button variant="unstyled" type="button" className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200" onClick={() => openDelete(row)} title="删除" aria-label={`删除 ${row.name}`}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-3 py-3 text-xs text-slate-500 md:flex-row md:items-center md:justify-between md:px-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>共 {total} 条 · 第 {page} / {totalPages} 页</span>
            <div className="flex items-center gap-1.5">每页<RadixSelectField value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))} options={[9, 18, 36, 90].map((size) => ({ value: String(size), label: `${size} 条` }))} ariaLabel="每页模型数量" className="h-8 min-w-20" /></div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading}>上一页</Button>
            <Button variant="unstyled" type="button" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-primary/25 hover:bg-accent hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages || loading}>下一页</Button>
            <label className="ml-1 flex items-center gap-1.5">
              跳转
              <Input className="h-8 w-12 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs text-slate-600 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25" value={jumpInput} onChange={(event) => setJumpInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleJump()} placeholder={String(page)} inputMode="numeric" aria-label="跳转页码" />
            </label>
            <Button type="button" className="h-8 cursor-pointer rounded-lg px-2.5 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40" onClick={handleJump} disabled={loading}>跳转</Button>
          </div>
        </div>
      </section></TabsContent>

      </div>
      </Tabs>
      </section>

      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onOpenChange={(open) => { if (!open && !saving && !testingConnection) closeDialog(); }}
      >
        <DialogContent className="horizon-portal max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader>
            <DialogTitle>{dialogMode === "edit" ? "编辑 AI 模型" : "新增 AI 模型"}</DialogTitle>
            <DialogDescription>配置模型身份、服务地址、用途与启用状态。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 pt-1 md:grid-cols-2">
            <div>
              <label htmlFor="ai-model-name" className="mb-1.5 block text-xs font-semibold text-slate-600">模型名称</label>
              <Input id="ai-model-name" className="material-input w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="如：GPT-5 主模型" />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-600">服务商</div>
              <RadixSelectField value={provider} onValueChange={setProvider} options={Array.from(new Set([provider, "OpenAI", "Qwen", "DeepSeek", "Zhipu", "Moonshot", "MiniMax", "HappyHorse", "Wanx", ...providerOptions].filter(Boolean))).map((option) => ({ value: option, label: option }))} ariaLabel="模型服务商" className="w-full" />
            </div>
            <div>
              <label htmlFor="ai-model-identifier" className="mb-1.5 block text-xs font-semibold text-slate-600">模型标识</label>
              <Input id="ai-model-identifier" className="material-input w-full" value={model} onChange={(event) => setModel(event.target.value)} placeholder="如：gpt-5" />
            </div>
            <div>
              <label htmlFor="ai-model-api-key" className="mb-1.5 block text-xs font-semibold text-slate-600">API Key</label>
              <Input
                id="ai-model-api-key"
                className="material-input w-full"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={dialogMode === "edit" && selectedRow?.has_api_key ? "留空则保留原 API Key" : "请输入 API Key"}
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="ai-model-base-url" className="mb-1.5 block text-xs font-semibold text-slate-600">Base URL</label>
              <Input
                id="ai-model-base-url"
                className="material-input w-full"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="如：https://api.openai.com/v1 或你的代理/网关地址"
              />
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                不填写时默认走后端环境中的官方地址；如果浏览器能通、服务端不能通，优先在这里配置代理或网关地址。
              </p>
            </div>
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs font-semibold text-slate-600">
                用途类型
              </div>
              <RadixSelectField
                value={usageKind}
                onValueChange={setUsageKind}
                options={[
                  { value: "auto", label: "自动识别（根据模型名称推断）" },
                  { value: "text", label: "文本 — 纯文字对话、摘要、提取" },
                  { value: "multimodal", label: "文本/图片 — 多模态理解（可接收图片输入）" },
                  { value: "image", label: "图片生成 — 文生图、参考图生图" },
                  { value: "video", label: "视频生成 — 图生视频 / 文生视频" },
                  { value: "audio", label: "音频 — 实时语音合成 / 语音对话" },
                  { value: "embedding", label: "向量 — 知识库 RAG 向量化检索" },
                  { value: "document", label: "文档解析 — 读取附件 / 文件内容" },
                ]}
                ariaLabel="模型用途类型"
                className="w-full"
              />
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                手动指定后，系统将精准分配此模型到对应场景（对话、图片生成等），避免模型出现在不兼容的选择列表中。
              </p>
            </div>
            <div>
              <label htmlFor="ai-model-input-price" className="mb-1.5 block text-xs font-semibold text-slate-600">
                输入单价（元 / 千 token）
              </label>
              <Input
                id="ai-model-input-price"
                className="material-input w-full"
                type="number"
                min="0"
                step="0.0001"
                value={inputPrice}
                onChange={(event) => setInputPrice(event.target.value)}
                placeholder="留空表示不统计成本"
              />
            </div>
            <div>
              <label htmlFor="ai-model-output-price" className="mb-1.5 block text-xs font-semibold text-slate-600">
                输出单价（元 / 千 token）
              </label>
              <Input
                id="ai-model-output-price"
                className="material-input w-full"
                type="number"
                min="0"
                step="0.0001"
                value={outputPrice}
                onChange={(event) => setOutputPrice(event.target.value)}
                placeholder="留空表示不统计成本"
              />
            </div>
            <div className="md:col-span-2 -mt-2">
              <p className="text-xs leading-5 text-muted-foreground">
                按服务商计费页填写。成本在查询时按用量实时折算，改价后历史成本会跟着重算；两项都留空的模型不计入成本合计。
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm text-slate-700">{enabled ? "已启用" : "已停用"}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Checkbox id="is_default_enabled" checked={isDefaultEnabled} onCheckedChange={(checked) => setIsDefaultEnabled(checked === true)} />
              <label htmlFor="is_default_enabled" className="text-sm text-slate-700">
                默认启用
              </label>
            </div>
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-500 md:col-span-2">
              当前状态、最近成功时间、最近失败时间、最近延迟、今日请求数、今日 Token 和 Token 总使用量都由系统自动获取或自动计算。
            </div>
            {dialogError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 md:col-span-2" role="alert">
                {dialogError}
              </div>
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-100 pt-4">
          <Button variant="unstyled" type="button" className="material-button-secondary" onClick={closeDialog} disabled={saving || testingConnection}>
            取消
          </Button>
          <Button variant="unstyled" type="button" className="material-button-secondary" onClick={() => void handleTestConnection()} disabled={saving || testingConnection}>
            <Wifi className="h-4 w-4" />
            {testingConnection ? "测试中..." : "测试连通性"}
          </Button>
          <Button variant="unstyled" type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving || testingConnection}>
            {saving ? "保存中..." : "确认"}
          </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialogMode === "delete"} onOpenChange={(open) => { if (!open && !deleting) closeDialog(); }}>
        <AlertDialogContent className="horizon-portal" onCloseAutoFocus={restoreDialogFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 AI 模型</AlertDialogTitle>
            <AlertDialogDescription>确认删除 AI 模型“{selectedRow?.name ?? "-"}”吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 text-white hover:bg-red-600" onClick={(event) => { event.preventDefault(); void handleDelete(); }} disabled={deleting}>{deleting ? "删除中..." : "删除"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 百炼预设批量新增 */}
      <Dialog open={presetOpen} onOpenChange={(open) => { if (!open && !presetSaving) setPresetOpen(false); }}>
        <DialogContent className="horizon-portal max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader><DialogTitle>从百炼预设新增模型</DialogTitle><DialogDescription>从模型目录批量创建独立连接，Token 可在此统一填写，也可保存后逐条补充。</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              以下目录与阿里云百炼 Token Plan「可使用模型」页面对应。勾选后将逐条<span className="font-semibold text-slate-800">新增</span>为独立模型配置，不会修改或覆盖任何现有配置；API Key 与 Base URL 应用到本次勾选的全部模型，保存后可逐条再编辑。
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="preset-api-key" className="mb-1.5 block text-xs font-semibold text-slate-600">API Key（Token，可稍后填写）</label>
                <Input
                  id="preset-api-key"
                  className="material-input w-full"
                  type="password"
                  value={presetApiKey}
                  onChange={(event) => setPresetApiKey(event.target.value)}
                  placeholder="留空则先以停用状态创建"
                />
              </div>
              <div>
                <label htmlFor="preset-base-url" className="mb-1.5 block text-xs font-semibold text-slate-600">Base URL</label>
                <Input
                  id="preset-base-url"
                  className="material-input w-full"
                  value={presetBaseUrl}
                  onChange={(event) => setPresetBaseUrl(event.target.value)}
                  placeholder={BAILIAN_BASE_URL}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">已选 {presetSelected.size} 个模型</div>
              <div className="flex gap-2">
                <Button variant="unstyled" type="button" className="material-button-secondary !px-3 !py-2" onClick={selectAllPresetModels}>
                  全选未添加
                </Button>
                <Button variant="unstyled" type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setPresetSelected(new Set())}>
                  清空
                </Button>
              </div>
            </div>
            <div className="material-scrollbar max-h-[360px] space-y-4 overflow-y-auto rounded-2xl border border-slate-200 p-4">
              {PRESET_BRANDS.map((brand) => (
                <div key={brand}>
                  <div className="mb-2 text-xs font-semibold text-slate-600">{brand}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {BAILIAN_PRESET_MODELS.filter((item) => item.brand === brand).map((item) => {
                      const exists = presetExisting.has(item.model.toLowerCase());
                      const checked = presetSelected.has(item.model);
                      return (
                        <label
                          key={item.model}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                            exists
                              ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
                              : checked
                                ? "border-blue-200 bg-blue-50/60"
                                : "border-slate-200 hover:bg-slate-50",
                          )}
                        >
                          <Checkbox
                            className="mt-1"
                            checked={checked}
                            disabled={exists}
                            onCheckedChange={() => togglePresetModel(item.model)}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                              <span className="truncate">{item.model}</span>
                              {exists && <span className="material-chip shrink-0 bg-slate-100 text-slate-500">已存在</span>}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{item.capability}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="border-t border-slate-100 pt-4">
          <Button variant="unstyled" type="button" className="material-button-secondary" onClick={() => setPresetOpen(false)} disabled={presetSaving}>
            取消
          </Button>
          <Button variant="unstyled" type="button" className="material-button-primary" onClick={() => void handlePresetCreate()} disabled={presetSaving}>
            {presetSaving ? "新增中..." : `新增所选（${presetSelected.size}）`}
          </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出模型配置 */}
      <Dialog open={exportOpen} onOpenChange={(open) => !open && setExportOpen(false)}>
        <DialogContent className="horizon-portal max-h-[88dvh] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader><DialogTitle>导出模型配置</DialogTitle><DialogDescription>选择要写入 JSON 文件的模型连接；API Key 不会被导出。</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              勾选要导出的模型配置，导出为 JSON 文件。出于安全考虑，<span className="font-semibold text-slate-800">API Key 不会包含在导出文件中</span>，导入时可统一补填。
            </p>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">已选 {exportSelected.size} / {exportRows.length}</div>
              <div className="flex gap-2">
                <Button variant="unstyled" type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setExportSelected(new Set(exportRows.map((row) => row.id)))}>
                  全选
                </Button>
                <Button variant="unstyled" type="button" className="material-button-secondary !px-3 !py-2" onClick={() => setExportSelected(new Set())}>
                  清空
                </Button>
              </div>
            </div>
            <div className="material-scrollbar max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
              {exportRows.map((row) => (
                <label
                  key={row.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                    exportSelected.has(row.id) ? "border-blue-200 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <Checkbox className="mt-1" checked={exportSelected.has(row.id)} onCheckedChange={() => toggleExportRow(row.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{row.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {row.provider} / {row.model}{row.base_url ? ` · ${row.base_url}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="border-t border-slate-100 pt-4">
          <Button variant="unstyled" type="button" className="material-button-secondary" onClick={() => setExportOpen(false)}>
            取消
          </Button>
          <Button variant="unstyled" type="button" className="material-button-primary" onClick={handleExport}>
            导出所选（{exportSelected.size}）
          </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入模型配置 */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open && !importSaving) setImportOpen(false); }}>
        <DialogContent className="horizon-portal max-h-[88dvh] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={restoreDialogFocus}>
          <DialogHeader><DialogTitle>导入模型配置</DialogTitle><DialogDescription>只新增模型，不覆盖现有连接；重复模型默认不勾选。</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-6 text-slate-600">
              导入只会<span className="font-semibold text-slate-800">新增</span>模型配置，不会修改或覆盖任何现有配置。与现有模型标识相同的条目已标记为「重复」并默认不勾选。
            </p>
            <div>
              <label htmlFor="import-api-key" className="mb-1.5 block text-xs font-semibold text-slate-600">统一 API Key（可选）</label>
              <Input
                id="import-api-key"
                className="material-input w-full"
                type="password"
                value={importApiKey}
                onChange={(event) => setImportApiKey(event.target.value)}
                placeholder="留空则导入后逐条编辑补填"
              />
            </div>
            <div className="text-sm text-slate-500">已选 {importSelected.size} / {importEntries.length}</div>
            <div className="material-scrollbar max-h-[300px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3">
              {importEntries.map((entry, index) => (
                <label
                  key={`${entry.model}-${index}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                    importSelected.has(index) ? "border-blue-200 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <Checkbox className="mt-1" checked={importSelected.has(index)} onCheckedChange={() => toggleImportEntry(index)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <span className="truncate">{entry.name}</span>
                      {entry.duplicate && <span className="material-chip shrink-0 bg-amber-50 text-amber-700">重复</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {entry.provider} / {entry.model}{entry.base_url ? ` · ${entry.base_url}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter className="border-t border-slate-100 pt-4">
          <Button variant="unstyled" type="button" className="material-button-secondary" onClick={() => setImportOpen(false)} disabled={importSaving}>
            取消
          </Button>
          <Button variant="unstyled" type="button" className="material-button-primary" onClick={() => void handleImportCreate()} disabled={importSaving}>
            {importSaving ? "导入中..." : `导入所选（${importSelected.size}）`}
          </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
