import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import type {
  AiGatewayAdapterResult,
  AiGatewayAttempt,
  AiGatewayChatRequest,
  AiGatewayChatResult,
  AiGatewayCircuitSnapshot,
  AiGatewayRouteMeta,
  AiGatewayStrategy,
  AiGatewayStreamChunk,
  AiGatewayStreamRequest,
  AiGatewayTarget,
} from './ai-gateway.types';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

type CircuitState = {
  scene: string;
  targetKey: string;
  connectionId?: string;
  provider: string;
  model: string;
  consecutiveFailures: number;
  openUntil: number;
  lastFailureAt: number;
};

@Injectable()
export class AiGatewayService {
  /** 单批删除量，避免保留任务一次性锁住整张表。 */
  private static readonly RETENTION_BATCH_SIZE = 1_000;

  private readonly logger = new Logger(AiGatewayService.name);
  private readonly circuits = new Map<string, CircuitState>();
  private readonly roundRobinCursor = new Map<string, number>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly maxRetriesPerTarget: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly retentionDays: number;
  /** 路由 target 的密钥/地址环境变量兜底（与主对话选模路径对称），见 toRuntimeTarget */
  private readonly envQwenApiKey?: string;
  private readonly envOpenaiApiKey?: string;
  private readonly envQwenBaseUrl?: string;

  constructor(
    private readonly adapter: OpenAiCompatibleAdapter,
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    // 变量名与 chat.service 完全同口径（DASHSCOPE_* 优先），保证「主对话能用 ⇒ 路由 target 也能用」
    this.envQwenApiKey =
      (config.get<string>('DASHSCOPE_API_KEY') ?? config.get<string>('QWEN_API_KEY'))?.trim() || undefined;
    this.envOpenaiApiKey = config.get<string>('OPENAI_API_KEY')?.trim() || undefined;
    this.envQwenBaseUrl = config.get<string>('DASHSCOPE_BASE_URL')?.trim().replace(/\/$/, '') || undefined;
    this.failureThreshold = this.positiveInteger(config.get('AI_GATEWAY_FAILURE_THRESHOLD'), 3);
    this.cooldownMs = this.positiveInteger(config.get('AI_GATEWAY_CIRCUIT_COOLDOWN_MS'), 60_000);
    this.maxRetriesPerTarget = this.nonNegativeInteger(config.get('AI_GATEWAY_MAX_RETRIES_PER_TARGET'), 1);
    this.retryBaseDelayMs = this.nonNegativeInteger(config.get('AI_GATEWAY_RETRY_BASE_DELAY_MS'), 500);
    this.maxRetryDelayMs = this.nonNegativeInteger(config.get('AI_GATEWAY_MAX_RETRY_DELAY_MS'), 10_000);
    this.retentionDays = this.positiveInteger(config.get('AI_GATEWAY_RETENTION_DAYS'), 90);
  }

  async complete(request: AiGatewayChatRequest): Promise<AiGatewayChatResult> {
    const scene = request.scene.trim();
    const targets = this.deduplicateTargets(request.targets);
    if (!scene || targets.length === 0) {
      throw new ServiceUnavailableException('AI 网关没有可用的场景或模型连接');
    }

    const requestId = request.requestId?.trim() || randomUUID();
    const startedAt = Date.now();
    const attempts: AiGatewayAttempt[] = [];
    let lastError: unknown;

    for (const target of targets) {
      request.signal?.throwIfAborted();
      const targetKey = this.targetKey(target);
      const circuitKey = this.circuitKey(scene, targetKey);
      const circuit = this.circuits.get(circuitKey);
      if (circuit && circuit.openUntil > Date.now()) {
        attempts.push({
          targetKey,
          connectionId: target.connectionId,
          provider: target.provider,
          model: target.model,
          latencyMs: 0,
          status: 'circuit_open',
          errorCode: 'CIRCUIT_OPEN',
        });
        continue;
      }

      // 被限流（429）时先原地退避重试，退避不划算才切下一个连接；否则一次限流高峰
      // 会在几秒内把所有连接依次打成失败。其余错误仍然立即降级，不在坏连接上耗时间。
      let targetError: unknown;
      for (let retry = 0; ; retry += 1) {
        request.signal?.throwIfAborted();
        const attemptStartedAt = Date.now();
        try {
          const adapterRequest = {
            scene,
            messages: request.messages,
            responseFormat: request.responseFormat,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            timeoutMs: request.timeoutMs,
            signal: request.signal,
          };
          let result: AiGatewayAdapterResult;
          try {
            result = await this.adapter.complete(target, adapterRequest);
          } catch (error) {
            if (request.signal?.aborted) throw error;
            if (!request.retryWithoutResponseFormat || !request.responseFormat || !this.shouldRetryWithoutJsonMode(error)) {
              throw error;
            }
            this.logger.warn(
              `[${requestId}] ${scene} JSON mode unsupported via ${target.provider}/${target.model}; retrying without response_format`,
            );
            result = await this.adapter.complete(target, { ...adapterRequest, responseFormat: undefined });
          }
          if (!result.content) throw new Error('AI provider returned empty content');

          this.circuits.delete(circuitKey);
          attempts.push({
            targetKey,
            connectionId: target.connectionId,
            provider: target.provider,
            model: target.model,
            latencyMs: Date.now() - attemptStartedAt,
            status: 'success',
          });
          const gatewayResult: AiGatewayChatResult = {
            requestId,
            scene,
            content: result.content,
            provider: target.provider,
            model: target.model,
            latencyMs: Date.now() - startedAt,
            attemptCount: attempts.length,
            fallbackUsed: this.usedFallback(attempts),
            usage: result.usage,
            attempts,
          };
          await this.recordResult(gatewayResult, request.routeMeta);
          return gatewayResult;
        } catch (error) {
          if (request.signal?.aborted) throw error;
          targetError = error;
          lastError = error;
          attempts.push({
            targetKey,
            connectionId: target.connectionId,
            provider: target.provider,
            model: target.model,
            latencyMs: Date.now() - attemptStartedAt,
            status: 'failed',
            errorCode: this.errorCode(error),
            errorMessage: this.errorMessage(error),
          });

          const retryDelayMs = retry < this.maxRetriesPerTarget ? this.retryDelayMs(error, retry) : null;
          if (retryDelayMs === null) break;
          this.logger.warn(
            `[${requestId}] ${scene} rate limited by ${target.provider}/${target.model}; retrying same target in ${retryDelayMs} ms`,
          );
          await this.sleep(retryDelayMs);
        }
      }

      // 同一连接的多次重试只算一次熔断失败，否则一次限流就会把阈值消耗掉。
      this.recordCircuitFailure(scene, target, targetKey, targetError);
      this.logger.warn(
        `[${requestId}] ${scene} failed via ${target.provider}/${target.model} (${this.errorCode(targetError)}); trying fallback`,
      );
    }

    const finalAttempt = attempts[attempts.length - 1];
    const finalCode = lastError === undefined
      ? finalAttempt?.errorCode ?? 'NO_AVAILABLE_TARGET'
      : this.errorCode(lastError);
    const finalMessage = lastError === undefined
      ? finalAttempt?.errorMessage
      : this.errorMessage(lastError);
    this.logger.error(`[${requestId}] ${scene} exhausted ${attempts.length} gateway attempts (${finalCode})`);
    await this.recordFailure({
      requestId,
      scene,
      latencyMs: Date.now() - startedAt,
      errorCode: finalCode,
      errorMessage: finalMessage,
      attempts,
      routeMeta: request.routeMeta,
    });
    const exception = new ServiceUnavailableException({
      message: 'AI 服务暂时不可用，请稍后重试',
      request_id: requestId,
      scene,
      error_code: finalCode,
    });
    throw exception;
  }

  /**
   * 流式补全。与 complete 的关键差别：一旦第一个分片已经吐给调用方，就不能再换模型重来
   * ——用户已经看到半句话了。因此降级和限流重试只在首个分片之前可用，之后任何异常都直接
   * 上抛。用户主动中断不算目标故障：不熔断、不降级，已产生的用量照常入账。
   */
  async *stream(request: AiGatewayStreamRequest): AsyncGenerator<AiGatewayStreamChunk> {
    const scene = request.scene.trim();
    const targets = this.deduplicateTargets(request.targets);
    if (!scene || targets.length === 0) {
      throw new ServiceUnavailableException('AI 网关没有可用的场景或模型连接');
    }

    const requestId = request.requestId?.trim() || randomUUID();
    const startedAt = Date.now();
    const attempts: AiGatewayAttempt[] = [];
    let lastError: unknown;
    let recorded = false;
    let settledTarget: AiGatewayTarget | undefined;
    let streamedUsage: AiGatewayChatResult['usage'] | undefined;

    const recordOnce = async (status: 'success' | 'failed', errorCode?: string, errorMessage?: string) => {
      if (recorded) return;
      recorded = true;
      await this.persistRequest({
        requestId,
        scene,
        status,
        routeMeta: request.routeMeta,
        provider: settledTarget?.provider,
        model: settledTarget?.model,
        latencyMs: Date.now() - startedAt,
        attempts,
        usage: streamedUsage,
        errorCode,
        errorMessage,
      });
    };

    try {
      for (const target of targets) {
        const targetKey = this.targetKey(target);
        const circuitKey = this.circuitKey(scene, targetKey);
        const circuit = this.circuits.get(circuitKey);
        if (circuit && circuit.openUntil > Date.now()) {
          attempts.push({
            targetKey,
            connectionId: target.connectionId,
            provider: target.provider,
            model: target.model,
            latencyMs: 0,
            status: 'circuit_open',
            errorCode: 'CIRCUIT_OPEN',
          });
          continue;
        }

        let targetError: unknown;
        let streamed = false;
        let toolsDropped = false;
        let retry = 0;
        for (;;) {
          const attemptStartedAt = Date.now();
          try {
            const chunks = await this.adapter.stream(target, {
              scene,
              messages: request.messages,
              tools: toolsDropped ? undefined : request.tools,
              webSearch: request.webSearch,
              temperature: request.temperature,
              maxTokens: request.maxTokens,
              timeoutMs: request.timeoutMs,
              signal: request.signal,
            });
            for await (const chunk of chunks) {
              if (!streamed) {
                streamed = true;
                settledTarget = target;
                this.circuits.delete(circuitKey);
                request.onTargetSettled?.(target);
              }
              if (chunk.usage) {
                streamedUsage = {
                  promptTokens: chunk.usage.prompt_tokens ?? 0,
                  completionTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0,
                };
              }
              yield chunk;
            }

            attempts.push({
              targetKey,
              connectionId: target.connectionId,
              provider: target.provider,
              model: target.model,
              latencyMs: Date.now() - attemptStartedAt,
              status: 'success',
            });
            await recordOnce('success');
            return;
          } catch (error) {
            // 用户中断：上游没有故障，已经吐出的内容也照常保留，不能记成失败或触发熔断。
            if (request.signal?.aborted) throw error;

            targetError = error;
            lastError = error;
            attempts.push({
              targetKey,
              connectionId: target.connectionId,
              provider: target.provider,
              model: target.model,
              latencyMs: Date.now() - attemptStartedAt,
              status: 'failed',
              errorCode: this.errorCode(error),
              errorMessage: this.errorMessage(error),
            });

            // 已经有分片吐出去了，换模型或重发都会让用户看到两段不连贯的回答。
            if (streamed) {
              this.recordCircuitFailure(scene, target, targetKey, error);
              await recordOnce('failed', this.errorCode(error), this.errorMessage(error));
              throw error;
            }

            // 换个模型解决不了「这个模型不支持 tools」，先摘掉 tools 原地重来一次。
            if (request.retryWithoutTools && !toolsDropped && (request.tools?.length ?? 0) > 0) {
              toolsDropped = true;
              request.onToolsDropped?.();
              this.logger.warn(
                `[${requestId}] ${scene} upstream rejected tools via ${target.provider}/${target.model}; retrying same target without tools`,
              );
              continue;
            }

            const retryDelayMs = retry < this.maxRetriesPerTarget ? this.retryDelayMs(error, retry) : null;
            if (retryDelayMs === null) break;
            retry += 1;
            this.logger.warn(
              `[${requestId}] ${scene} rate limited by ${target.provider}/${target.model}; retrying same target in ${retryDelayMs} ms`,
            );
            await this.sleep(retryDelayMs);
          }
        }

        this.recordCircuitFailure(scene, target, targetKey, targetError);
        this.logger.warn(
          `[${requestId}] ${scene} stream failed via ${target.provider}/${target.model} (${this.errorCode(targetError)}); trying fallback`,
        );
      }

      const finalAttempt = attempts[attempts.length - 1];
      const finalCode = lastError === undefined
        ? finalAttempt?.errorCode ?? 'NO_AVAILABLE_TARGET'
        : this.errorCode(lastError);
      this.logger.error(`[${requestId}] ${scene} exhausted ${attempts.length} gateway stream attempts (${finalCode})`);
      await recordOnce(
        'failed',
        finalCode,
        lastError === undefined ? finalAttempt?.errorMessage : this.errorMessage(lastError),
      );
      throw new ServiceUnavailableException({
        message: 'AI 服务暂时不可用，请稍后重试',
        request_id: requestId,
        scene,
        error_code: finalCode,
      });
    } finally {
      // 调用方提前 break（用户中断）时生成器在这里收尾。内容已经交付，按成功入账，
      // 否则这次调用的 token 用量会整个丢掉。
      if (!recorded && settledTarget) {
        attempts.push({
          targetKey: this.targetKey(settledTarget),
          connectionId: settledTarget.connectionId,
          provider: settledTarget.provider,
          model: settledTarget.model,
          latencyMs: Date.now() - startedAt,
          status: 'success',
        });
        await recordOnce('success');
      }
    }
  }

  async resolveTargets(
    sceneInput: string,
    fallbackTargets: AiGatewayTarget[],
    options: { advanceRoundRobin?: boolean } = {},
  ): Promise<{
    targets: AiGatewayTarget[];
    timeoutMs?: number;
    source: 'route' | 'fallback';
    strategy?: AiGatewayStrategy;
  }> {
    const scene = sceneInput.trim();
    if (!scene) return { targets: fallbackTargets, source: 'fallback' };
    try {
      const route = await this.prisma.aiGatewayRoute.findUnique({
        where: { scene },
        include: {
          targets: {
            where: { enabled: true, connection: { isActive: true, kind: 'openai' } },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            include: { connection: true },
          },
        },
      });
      // 回落必须有日志：静默回落曾让「配了路由却不生效」完全无从排查。
      // 无路由是常态走 debug；停用是管理动作走 log；配了却全不可用是异常走 warn。
      if (!route) {
        this.logger.debug(`场景 ${scene} 未配置路由，使用调用方默认连接`);
        return { targets: fallbackTargets, source: 'fallback' };
      }
      if (!route.enabled) {
        this.logger.log(`场景 ${scene} 的路由已停用，使用调用方默认连接`);
        return { targets: fallbackTargets, source: 'fallback' };
      }
      const dropped: string[] = [];
      const targets: AiGatewayTarget[] = [];
      for (const { connection, weight } of route.targets) {
        const target = this.toRuntimeTarget(connection);
        if (!target) {
          // toRuntimeTarget 只在缺 API Key / 缺模型名 / 解密失败时返回 null
          dropped.push(`${connection.name || connection.id}（缺 API Key 或模型名）`);
          continue;
        }
        targets.push({
          ...target,
          weight,
          failureThreshold: route.failureThreshold,
          cooldownMs: route.cooldownMs,
        });
      }
      if (targets.length === 0) {
        this.logger.warn(
          `场景 ${scene} 的路由存在但无可用目标（${
            dropped.length > 0 ? `被丢弃：${dropped.join('、')}` : '目标为空或连接已停用/非 openai 类型'
          }），回落到调用方默认连接`,
        );
        return { targets: fallbackTargets, source: 'fallback' };
      }
      const strategy = route.strategy as AiGatewayStrategy;
      const ordered = await this.orderTargets(scene, strategy, targets, options.advanceRoundRobin !== false);
      // 调用方自带的默认连接追加为「最后一环」（按连接+模型去重）：路由目标全部失败/熔断时
      // 降级到调用方本来就能用的模型，而不是直接 503 全场不可用。策略排序只作用于路由目标，
      // 追加项永远排在最后，不改变路由的调度语义。
      const seenKeys = new Set(ordered.map((target) => this.targetKey(target)));
      const lastResort = fallbackTargets.filter((target) => !seenKeys.has(this.targetKey(target)));
      return {
        targets: [...ordered, ...lastResort],
        timeoutMs: route.timeoutMs,
        source: 'route',
        strategy,
      };
    } catch (error) {
      this.logger.warn(`Failed to resolve persisted route for ${scene}; using fallback: ${this.errorMessage(error)}`);
      return { targets: fallbackTargets, source: 'fallback' };
    }
  }

  private recordResult(result: AiGatewayChatResult, routeMeta?: AiGatewayRouteMeta): Promise<void> {
    return this.persistRequest({
      requestId: result.requestId,
      scene: result.scene,
      status: 'success',
      routeMeta,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      usage: result.usage,
    });
  }

  private recordFailure(input: {
    requestId: string;
    scene: string;
    latencyMs: number;
    errorCode: string;
    errorMessage?: string;
    attempts: AiGatewayAttempt[];
    routeMeta?: AiGatewayRouteMeta;
  }): Promise<void> {
    return this.persistRequest({
      requestId: input.requestId,
      scene: input.scene,
      status: 'failed',
      routeMeta: input.routeMeta,
      latencyMs: input.latencyMs,
      attempts: input.attempts,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
  }

  private deduplicateTargets(targets: AiGatewayTarget[]): AiGatewayTarget[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
      if (!target.apiKey?.trim() || !target.model?.trim()) return false;
      const key = this.targetKey(target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private targetKey(target: AiGatewayTarget): string {
    return target.id?.trim() || [target.provider, target.model, target.baseUrl ?? ''].join(':').toLowerCase();
  }

  getCircuitSnapshots(): AiGatewayCircuitSnapshot[] {
    const now = Date.now();
    return [...this.circuits.values()]
      .map((circuit) => ({
        scene: circuit.scene,
        targetKey: circuit.targetKey,
        connectionId: circuit.connectionId,
        provider: circuit.provider,
        model: circuit.model,
        consecutiveFailures: circuit.consecutiveFailures,
        state: circuit.openUntil > now ? 'open' as const : 'closed' as const,
        openUntil: circuit.openUntil > now ? new Date(circuit.openUntil).toISOString() : undefined,
        lastFailureAt: new Date(circuit.lastFailureAt).toISOString(),
      }))
      .sort((a, b) => b.lastFailureAt.localeCompare(a.lastFailureAt));
  }

  resetCircuits(scene?: string, targetKey?: string): number {
    let reset = 0;
    for (const [key, circuit] of this.circuits) {
      if (scene && circuit.scene !== scene) continue;
      if (targetKey && circuit.targetKey !== targetKey) continue;
      this.circuits.delete(key);
      reset += 1;
    }
    return reset;
  }

  private circuitKey(scene: string, targetKey: string): string {
    return `${scene}\u0000${targetKey}`;
  }

  private recordCircuitFailure(scene: string, target: AiGatewayTarget, targetKey: string, error: unknown): void {
    if (!this.shouldOpenCircuit(error)) return;
    const key = this.circuitKey(scene, targetKey);
    const previous = this.circuits.get(key);
    const failures = (previous?.consecutiveFailures ?? 0) + 1;
    const failureThreshold = this.positiveInteger(target.failureThreshold, this.failureThreshold);
    const cooldownMs = this.positiveInteger(target.cooldownMs, this.cooldownMs);
    this.circuits.set(key, {
      scene,
      targetKey,
      connectionId: target.connectionId,
      provider: target.provider,
      model: target.model,
      consecutiveFailures: failures,
      openUntil: failures >= failureThreshold ? Date.now() + cooldownMs : 0,
      lastFailureAt: Date.now(),
    });
  }

  private async orderTargets(
    scene: string,
    strategyInput: AiGatewayStrategy,
    targets: AiGatewayTarget[],
    advanceRoundRobin: boolean,
  ): Promise<AiGatewayTarget[]> {
    const strategy = this.normalizeStrategy(strategyInput);
    if (targets.length < 2 || strategy === 'priority') return targets;
    if (strategy === 'round_robin') {
      const cursor = this.roundRobinCursor.get(scene) ?? 0;
      const offset = cursor % targets.length;
      if (advanceRoundRobin) this.roundRobinCursor.set(scene, (offset + 1) % targets.length);
      return [...targets.slice(offset), ...targets.slice(0, offset)];
    }
    if (strategy === 'weighted') {
      const totalWeight = targets.reduce((sum, target) => sum + this.positiveInteger(target.weight, 100), 0);
      let selection = Math.random() * totalWeight;
      let selectedIndex = 0;
      for (let index = 0; index < targets.length; index += 1) {
        selection -= this.positiveInteger(targets[index]?.weight, 100);
        if (selection <= 0) {
          selectedIndex = index;
          break;
        }
      }
      return [targets[selectedIndex], ...targets.filter((_, index) => index !== selectedIndex)];
    }
    try {
      const connectionIds = targets.map((target) => target.connectionId).filter((id): id is string => Boolean(id));
      if (connectionIds.length === 0) return targets;
      const latencyGroups = await this.prisma.aiGatewayAttempt.groupBy({
        by: ['connectionId'],
        where: {
          connectionId: { in: connectionIds },
          status: 'success',
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _avg: { latencyMs: true },
      });
      const latencyByConnection = new Map(
        latencyGroups.map((group) => [group.connectionId, group._avg.latencyMs ?? Number.MAX_SAFE_INTEGER]),
      );
      return [...targets].sort((a, b) => {
        const aLatency = a.connectionId ? latencyByConnection.get(a.connectionId) : undefined;
        const bLatency = b.connectionId ? latencyByConnection.get(b.connectionId) : undefined;
        return (aLatency ?? Number.MAX_SAFE_INTEGER) - (bLatency ?? Number.MAX_SAFE_INTEGER);
      });
    } catch (error) {
      this.logger.warn(`Failed to rank ${scene} targets by latency; using priority: ${this.errorMessage(error)}`);
      return targets;
    }
  }

  private normalizeStrategy(strategy: AiGatewayStrategy | string): AiGatewayStrategy {
    return strategy === 'round_robin' || strategy === 'weighted' || strategy === 'lowest_latency'
      ? strategy
      : 'priority';
  }

  private shouldOpenCircuit(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status ?? record.statusCode);
    const code = String(record.code ?? record.type ?? '').toUpperCase();
    if ([401, 403, 408, 429].includes(status) || status >= 500) return true;
    return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].some((item) => code.includes(item));
  }

  /** 降级口径按「用过几个不同连接」算，同一连接的限流重试不应计入降级率。 */
  private usedFallback(attempts: AiGatewayAttempt[]): boolean {
    return new Set(attempts.map((attempt) => attempt.targetKey)).size > 1;
  }

  /**
   * 返回原地重试前应等待的毫秒数；返回 null 表示不该重试（非限流错误，或等待时间
   * 长到不如直接切下一个连接）。
   */
  private retryDelayMs(error: unknown, retryIndex: number): number | null {
    if (!this.isRateLimited(error)) return null;
    const retryAfterMs = this.retryAfterMs(error);
    if (retryAfterMs !== null) {
      return retryAfterMs <= this.maxRetryDelayMs ? retryAfterMs : null;
    }
    // 无 Retry-After 时指数退避，并加 ±25% 抖动，避免并发请求同时重试同一个被限流的连接。
    const backoffMs = this.retryBaseDelayMs * 2 ** retryIndex;
    const jittered = Math.round(backoffMs * (0.75 + Math.random() * 0.5));
    return jittered <= this.maxRetryDelayMs ? jittered : null;
  }

  private isRateLimited(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    if (Number(record.status ?? record.statusCode) === 429) return true;
    return /RATE[_ -]?LIMIT/i.test(String(record.code ?? record.type ?? ''));
  }

  private retryAfterMs(error: unknown): number | null {
    const raw = this.headerValue((error as { headers?: unknown })?.headers, 'retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const retryAt = Date.parse(raw);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
  }

  /** OpenAI SDK 抛出的是 WHATWG Headers；测试与部分上游封装用的是普通对象。 */
  private headerValue(headers: unknown, name: string): string | null {
    if (!headers || typeof headers !== 'object') return null;
    const getter = (headers as Headers).get;
    if (typeof getter === 'function') return getter.call(headers, name);
    const record = headers as Record<string, unknown>;
    const key = Object.keys(record).find((item) => item.toLowerCase() === name);
    return key === undefined ? null : String(record[key]);
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  /**
   * 网关每次调用都会写入一条 AiGatewayRequest 和若干 AiGatewayAttempt，没有保留策略时
   * 这两张表会无限增长，并拖慢监控页依赖它们的聚合查询。attempts 通过外键级联删除。
   */
  @Cron('15 4 * * *', { name: 'ai-gateway-telemetry-retention', timeZone: 'Asia/Shanghai' })
  async purgeExpiredTelemetry(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    try {
      for (;;) {
        const batch = await this.prisma.aiGatewayRequest.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: AiGatewayService.RETENTION_BATCH_SIZE,
        });
        if (batch.length === 0) break;
        const { count } = await this.prisma.aiGatewayRequest.deleteMany({
          where: { id: { in: batch.map((item) => item.id) } },
        });
        deleted += count;
        // count 为 0 说明另一个实例已经删掉了这批，继续循环只会空转。
        if (count === 0 || batch.length < AiGatewayService.RETENTION_BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.warn(`AI 网关调用记录清理失败：${this.errorMessage(error)}`);
      return deleted;
    }
    if (deleted > 0) {
      this.logger.log(`已清理 ${deleted} 条超过 ${this.retentionDays} 天的 AI 网关调用记录`);
    }
    return deleted;
  }

  private shouldRetryWithoutJsonMode(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status ?? record.statusCode);
    const message = this.errorMessage(error).toLowerCase();
    return status === 400 && /response[_ -]?format|json[_ -]?mode|json_object|json_schema/.test(message);
  }

  private errorCode(error: unknown): string {
    if (!error) return 'UNKNOWN';
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status ?? record.statusCode);
    if (Number.isFinite(status) && status > 0) return `HTTP_${status}`;
    const code = String(record.code ?? record.type ?? '').trim();
    if (code) return code.slice(0, 60).toUpperCase();
    return error instanceof Error && /empty content/i.test(error.message) ? 'EMPTY_RESPONSE' : 'UPSTREAM_ERROR';
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.trim().slice(0, 500);
  }

  private toRuntimeTarget(config: {
    id: string;
    provider: string | null;
    model: string | null;
    encryptedSecret: string;
    metadata: Prisma.JsonValue;
  }): AiGatewayTarget | null {
    const model = config.model?.trim();
    if (!model) return null;
    const provider = config.provider?.trim() || 'openai';
    // qwen 判定与 chat.service 同口径：厂商名或模型名带 qwen/通义/dashscope 即视为阿里系
    const isQwen = /qwen|tongyi|dashscope|阿里|通义/i.test(`${provider} ${model}`);
    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch {
      apiKey = '';
    }
    // 环境变量兜底，与主对话选模路径（chat.service resolveModelConfig）对称：
    // 同一条连接在 MateChat 里「明明能用」（靠 env 兜底），配进路由却被整条丢掉，
    // 这种不对称此前让路由 target 静默消失、无从排查。
    if (!apiKey) apiKey = isQwen ? (this.envQwenApiKey ?? this.envOpenaiApiKey ?? '') : (this.envOpenaiApiKey ?? '');
    if (!apiKey) return null;
    const metadata = config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
      ? config.metadata as Record<string, unknown>
      : {};
    const storedBaseUrl = typeof metadata.base_url === 'string' ? metadata.base_url.trim() : '';
    // qwen 连接缺 base_url 会被打到 api.openai.com → 401 → 熔断；兜到 DashScope 兼容端点
    const baseUrl = storedBaseUrl
      || (isQwen ? (this.envQwenBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1') : '');
    return {
      id: config.id,
      connectionId: config.id,
      provider,
      model,
      apiKey,
      baseUrl: baseUrl || undefined,
    };
  }

  private async persistRequest(input: {
    requestId: string;
    scene: string;
    status: 'success' | 'failed';
    provider?: string;
    model?: string;
    latencyMs: number;
    attempts: AiGatewayAttempt[];
    usage?: AiGatewayChatResult['usage'];
    errorCode?: string;
    errorMessage?: string;
    routeMeta?: AiGatewayRouteMeta;
  }): Promise<void> {
    try {
      await this.prisma.aiGatewayRequest.create({
        data: {
          id: input.requestId,
          scene: input.scene,
          status: input.status,
          provider: input.provider,
          model: input.model,
          // 选模来源与策略：让「路由是否生效」可查可看。存量行为 NULL（未知）。
          routeSource: input.routeMeta?.source,
          strategy: input.routeMeta?.strategy,
          latencyMs: input.latencyMs,
          attemptCount: input.attempts.length,
          fallbackUsed: this.usedFallback(input.attempts),
          promptTokens: input.usage?.promptTokens ?? 0,
          completionTokens: input.usage?.completionTokens ?? 0,
          totalTokens: input.usage?.totalTokens ?? 0,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          attempts: {
            create: input.attempts.map((attempt, index) => ({
              sequence: index + 1,
              connectionId: attempt.connectionId,
              targetKey: attempt.targetKey,
              provider: attempt.provider,
              model: attempt.model,
              status: attempt.status,
              latencyMs: attempt.latencyMs,
              errorCode: attempt.errorCode,
              errorMessage: attempt.errorMessage,
            })),
          },
        },
      });
    } catch (error) {
      this.logger.warn(`[${input.requestId}] failed to persist gateway telemetry: ${this.errorMessage(error)}`);
    }
  }

  private positiveInteger(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  /** 0 是合法配置（关闭重试 / 不等待），因此不能复用 positiveInteger。 */
  private nonNegativeInteger(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }
}
