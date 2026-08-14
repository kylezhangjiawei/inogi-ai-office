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
