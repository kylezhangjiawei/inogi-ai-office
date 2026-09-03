import type OpenAI from 'openai';

export type AiGatewayTarget = {
  /** Stable connection id when one exists; otherwise the gateway derives a runtime key. */
  id?: string;
  /** IntegrationConfig id used for persisted routing and telemetry. */
  connectionId?: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Relative selection weight when the route uses weighted scheduling. */
  weight?: number;
  /** Route-scoped circuit breaker settings copied onto runtime targets. */
  failureThreshold?: number;
  cooldownMs?: number;
};

export type AiGatewayStrategy = 'priority' | 'round_robin' | 'weighted' | 'lowest_latency';

/**
 * 网关场景白名单——路由保存接口据此校验，堵住「scene 写错一个字符 → 死路由静默不生效」。
 * ⚠️ 与前端 src/app/AiModelManagementPage.tsx 的 GATEWAY_SCENES 是同一份清单的两个副本：
 * 后端新增场景字面量时必须同步两处（前端负责展示文案，这里负责准入）。
 */
export const AI_GATEWAY_SCENES = [
  'chat.completion',
  'chat.daily_motivation',
  'chat.utility_completion',
  'rd.task_brief',
  'rd.reporting',
  'rd.performance_review',
  'rd.progress_assessment',
  'rd.project_structuring',
  'ops.error_analysis',
  'external_docs.version_compare',
  'rag.knowledge_answer',
  'image.prompt_optimization',
  'hr.resume_screening',
  'procurement.requirement_parse',
  'procurement.material_intelligence',
  'procurement.erp_matching',
  'i18n.translation',
] as const;

/**
 * 本次调用的选模来源，随请求落库（AiGatewayRequest.routeSource/strategy）。
 * 没有它，「路由策略是否生效」在系统里完全不可观测——resolveTargets 算出的 source
 * 曾经全仓无人消费，控制台只能展示与之语义完全不同的 fallbackUsed（跨连接故障转移）。
 * - route:    命中网关路由，targets 由路由决定
 * - fallback: 场景未配路由/路由停用/目标全不可用，回落调用方自带目标
 * - user:     用户显式选择了模型，按「用户意志优先」跳过路由（仅主对话）
 * - vision:   需要视觉能力而跳过路由（路由目标可能是纯文本连接，仅主对话）
 */
export type AiGatewayRouteMeta = {
  source: 'route' | 'fallback' | 'user' | 'vision';
  strategy?: AiGatewayStrategy;
};

export type AiGatewayChatRequest = {
  requestId?: string;
  scene: string;
  targets: AiGatewayTarget[];
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  responseFormat?: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming['response_format'];
  /** Retry the same target without JSON mode when an OpenAI-compatible endpoint rejects response_format. */
  retryWithoutResponseFormat?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 选模来源（route/fallback/user/vision），仅用于观测落库，不影响调用行为。 */
  routeMeta?: AiGatewayRouteMeta;
};

export type AiGatewayStreamRequest = {
  requestId?: string;
  scene: string;
  targets: AiGatewayTarget[];
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /**
   * 让走阿里 compatible-mode 的目标按需联网检索；OpenAI 官方端点和自定义部署会拒绝
   * 未知参数，因此由适配器按实际目标判断是否下发，而不是调用方按选中的连接判断。
   */
  webSearch?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 用户中断：中断不算目标故障，不触发熔断，也不降级到下一个连接。 */
  signal?: AbortSignal;
  /**
   * 部分自定义部署 / 旧模型不认 tools 参数。首个分片之前失败且挂了 tools 时，先去掉
   * tools 原地重试一次，失败才降级——直接换模型解决不了「这个模型不支持工具」。
   */
  retryWithoutTools?: boolean;
  /** tools 被摘掉时回调，调用方据此在后续轮次不再挂载，避免每轮都白跑一次。 */
  onToolsDropped?: () => void;
  /**
   * 首个分片到达后回调。ReAct 多轮必须钉在同一个目标上——换模型会让 tool_call
   * 的上下文对不上，调用方据此把后续轮次的 targets 固定成这一个。
   */
  onTargetSettled?: (target: AiGatewayTarget) => void;
  /** 选模来源（route/fallback/user/vision），仅用于观测落库，不影响调用行为。 */
  routeMeta?: AiGatewayRouteMeta;
};

export type AiGatewayStreamChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

export type AiGatewayAttempt = {
  targetKey: string;
  connectionId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: 'success' | 'failed' | 'circuit_open';
  errorCode?: string;
  errorMessage?: string;
};

export type AiGatewayChatResult = {
  requestId: string;
  scene: string;
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
  attemptCount: number;
  fallbackUsed: boolean;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  attempts: AiGatewayAttempt[];
};

export type AiGatewayAdapterResult = {
  content: string;
  usage: AiGatewayChatResult['usage'];
};

export type AiGatewayCircuitSnapshot = {
  scene: string;
  targetKey: string;
  connectionId?: string;
  provider: string;
  model: string;
  consecutiveFailures: number;
  state: 'closed' | 'open';
  openUntil?: string;
  lastFailureAt: string;
};
