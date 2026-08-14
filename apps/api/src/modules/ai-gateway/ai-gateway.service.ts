import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  AiGatewayStrategy,
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
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly circuits = new Map<string, CircuitState>();
  private readonly roundRobinCursor = new Map<string, number>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly adapter: OpenAiCompatibleAdapter,
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    this.failureThreshold = this.positiveInteger(config.get('AI_GATEWAY_FAILURE_THRESHOLD'), 3);
    this.cooldownMs = this.positiveInteger(config.get('AI_GATEWAY_CIRCUIT_COOLDOWN_MS'), 60_000);
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

      const attemptStartedAt = Date.now();
      try {
        const adapterRequest = {
          scene,
          messages: request.messages,
          responseFormat: request.responseFormat,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          timeoutMs: request.timeoutMs,
        };
        let result: AiGatewayAdapterResult;
        try {
          result = await this.adapter.complete(target, adapterRequest);
        } catch (error) {
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
          fallbackUsed: attempts.length > 1,
          usage: result.usage,
          attempts,
        };
        await this.recordResult(gatewayResult);
        return gatewayResult;
      } catch (error) {
        lastError = error;
        const errorCode = this.errorCode(error);
        attempts.push({
          targetKey,
          connectionId: target.connectionId,
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - attemptStartedAt,
          status: 'failed',
          errorCode,
          errorMessage: this.errorMessage(error),
        });
        this.recordCircuitFailure(scene, target, targetKey, error);
        this.logger.warn(
          `[${requestId}] ${scene} failed via ${target.provider}/${target.model} (${errorCode}); trying fallback`,
        );
      }
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
    });
    const exception = new ServiceUnavailableException({
      message: 'AI 服务暂时不可用，请稍后重试',
      request_id: requestId,
      scene,
      error_code: finalCode,
    });
    throw exception;
  }

  async resolveTargets(
    sceneInput: string,
    fallbackTargets: AiGatewayTarget[],
    options: { advanceRoundRobin?: boolean } = {},
  ): Promise<{
    targets: AiGatewayTarget[];
    timeoutMs?: number;
    source: 'route' | 'fallback';
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
      if (!route?.enabled) return { targets: fallbackTargets, source: 'fallback' };
      const targets: AiGatewayTarget[] = route.targets
        .flatMap(({ connection, weight }) => {
          const target = this.toRuntimeTarget(connection);
          return target ? [{
            ...target,
            weight,
            failureThreshold: route.failureThreshold,
            cooldownMs: route.cooldownMs,
          }] : [];
        });
      return targets.length > 0
        ? {
            targets: await this.orderTargets(
              scene,
              route.strategy as AiGatewayStrategy,
              targets,
              options.advanceRoundRobin !== false,
            ),
            timeoutMs: route.timeoutMs,
            source: 'route',
          }
        : { targets: fallbackTargets, source: 'fallback' };
    } catch (error) {
      this.logger.warn(`Failed to resolve persisted route for ${scene}; using fallback: ${this.errorMessage(error)}`);
      return { targets: fallbackTargets, source: 'fallback' };
    }
  }

  private recordResult(result: AiGatewayChatResult): Promise<void> {
    return this.persistRequest({
      requestId: result.requestId,
      scene: result.scene,
      status: 'success',
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
  }): Promise<void> {
    return this.persistRequest({
      requestId: input.requestId,
      scene: input.scene,
      status: 'failed',
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

  private shouldRetryWithoutJsonMode(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status ?? record.statusCode);
    const message = this.errorMessage(error).toLowerCase();
    return status === 400 && /response[_ -]?format|json[_ -]?mode|json_object/.test(message);
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
    let apiKey = '';
    try {
      apiKey = this.secureConfigService.decryptFromStorage(config.encryptedSecret);
    } catch {
      return null;
    }
    if (!apiKey) return null;
    const metadata = config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
      ? config.metadata as Record<string, unknown>
      : {};
    return {
      id: config.id,
      connectionId: config.id,
      provider: config.provider?.trim() || 'openai',
      model,
      apiKey,
      baseUrl: typeof metadata.base_url === 'string' ? metadata.base_url.trim() : undefined,
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
  }): Promise<void> {
    try {
      await this.prisma.aiGatewayRequest.create({
        data: {
          id: input.requestId,
          scene: input.scene,
          status: input.status,
          provider: input.provider,
          model: input.model,
          latencyMs: input.latencyMs,
          attemptCount: input.attempts.length,
          fallbackUsed: input.attempts.length > 1,
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
}
