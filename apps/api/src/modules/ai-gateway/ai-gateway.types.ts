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
