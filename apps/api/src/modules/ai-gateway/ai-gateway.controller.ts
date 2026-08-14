import { BadRequestException, Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { PrismaService } from '../../prisma/prisma.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AiGatewayService } from './ai-gateway.service';

class SaveAiGatewayRouteDto {
  @IsString()
  @MaxLength(100)
  scene!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1000)
  @Max(600000)
  timeout_ms!: number;

  @IsString()
  @IsIn(['priority', 'round_robin', 'weighted', 'lowest_latency'])
  strategy!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  failure_threshold!: number;

  @IsInt()
  @Min(1000)
  @Max(3600000)
  cooldown_ms!: number;

  @IsArray()
  @IsString({ each: true })
  connection_ids!: string[];

  @IsArray()
  @IsInt({ each: true })
  target_weights!: number[];
}

class ResetAiGatewayCircuitsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scene?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  target_key?: string;
}

@Controller('ai-gateway')
@Permissions('page:ai-model-management')
export class AiGatewayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  @Get('routes')
  async listRoutes() {
    const items = await this.prisma.aiGatewayRoute.findMany({
      orderBy: [{ scene: 'asc' }],
      include: {
        targets: {
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          include: { connection: true },
        },
      },
    });
    return {
      items: items.map((route) => ({
        id: route.id,
        scene: route.scene,
        name: route.name,
        enabled: route.enabled,
        timeout_ms: route.timeoutMs,
        strategy: route.strategy,
        failure_threshold: route.failureThreshold,
        cooldown_ms: route.cooldownMs,
        targets: route.targets.map((target) => ({
          id: target.id,
          connection_id: target.connectionId,
          connection_name: target.connection.name,
          provider: target.connection.provider ?? '',
          model: target.connection.model ?? '',
          priority: target.priority,
          weight: target.weight,
          enabled: target.enabled,
          connection_enabled: target.connection.isActive,
        })),
        created_at: route.createdAt.toISOString(),
        updated_at: route.updatedAt.toISOString(),
      })),
    };
  }

  @Put('routes')
  async saveRoute(@Body() payload: SaveAiGatewayRouteDto) {
    const scene = payload.scene.trim();
    const name = payload.name.trim();
    if (!scene || !name) throw new BadRequestException('场景标识和名称不能为空');
    const connectionIds = [...new Set(payload.connection_ids.map((id) => id.trim()).filter(Boolean))];
    if (payload.target_weights.length !== payload.connection_ids.length) {
      throw new BadRequestException('每个模型连接都必须提供对应权重');
    }
    const weightByConnection = new Map<string, number>();
    payload.connection_ids.forEach((id, index) => {
      const normalizedId = id.trim();
      const weight = payload.target_weights[index];
      if (normalizedId && Number.isInteger(weight) && weight >= 1 && weight <= 1000 && !weightByConnection.has(normalizedId)) {
        weightByConnection.set(normalizedId, weight);
      }
    });
    if (weightByConnection.size !== connectionIds.length) {
      throw new BadRequestException('模型权重必须是 1 到 1000 的整数');
    }
    const availableConnections = connectionIds.length === 0
      ? 0
      : await this.prisma.integrationConfig.count({
          where: { id: { in: connectionIds }, kind: 'openai' },
        });
    if (availableConnections !== connectionIds.length) {
      throw new BadRequestException('路由包含不存在或非 AI 模型的连接');
    }

    const route = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.aiGatewayRoute.upsert({
        where: { scene },
        create: {
          scene,
          name,
          enabled: payload.enabled,
          timeoutMs: payload.timeout_ms,
          strategy: payload.strategy,
          failureThreshold: payload.failure_threshold,
          cooldownMs: payload.cooldown_ms,
        },
        update: {
          name,
          enabled: payload.enabled,
          timeoutMs: payload.timeout_ms,
          strategy: payload.strategy,
          failureThreshold: payload.failure_threshold,
          cooldownMs: payload.cooldown_ms,
        },
      });
      await tx.aiGatewayRouteTarget.deleteMany({ where: { routeId: saved.id } });
      if (connectionIds.length > 0) {
        await tx.aiGatewayRouteTarget.createMany({
          data: connectionIds.map((connectionId, priority) => ({
            routeId: saved.id,
            connectionId,
            priority,
            weight: weightByConnection.get(connectionId) ?? 100,
          })),
        });
      }
      return saved;
    });
    return { id: route.id, scene: route.scene, updated_at: route.updatedAt.toISOString() };
  }

  @Get('overview')
  async getOverview(@Query('range') range?: string) {
    const since = this.rangeSince(range);
    const circuitSnapshots = this.aiGateway.getCircuitSnapshots();
    const [totals, successful, failed, fallback, latency, tokenTotals, circuitSkips, byScene, byProvider, byError, circuitEvents, routes, trend, connections, connectionAttemptGroups, latestConnectionAttempts] = await Promise.all([
      this.prisma.aiGatewayRequest.count({ where: { createdAt: { gte: since } } }),
      this.prisma.aiGatewayRequest.count({ where: { createdAt: { gte: since }, status: 'success' } }),
      this.prisma.aiGatewayRequest.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
      this.prisma.aiGatewayRequest.count({ where: { createdAt: { gte: since }, fallbackUsed: true } }),
      this.prisma.aiGatewayRequest.aggregate({
        where: { createdAt: { gte: since } },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiGatewayRequest.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { totalTokens: true },
      }),
      this.prisma.aiGatewayAttempt.count({
        where: { createdAt: { gte: since }, status: 'circuit_open' },
      }),
      this.prisma.aiGatewayRequest.groupBy({
        by: ['scene', 'status', 'fallbackUsed'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiGatewayRequest.groupBy({
        by: ['provider', 'model', 'status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        // 输入/输出分开汇总：两者单价不同，合并成 totalTokens 就算不出成本了。
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiGatewayAttempt.groupBy({
        by: ['errorCode'],
        where: { createdAt: { gte: since }, status: 'failed' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ scene: string; skips: bigint }>>(Prisma.sql`
        SELECT request.scene, COUNT(*) AS skips
        FROM "AiGatewayAttempt" AS attempt
        INNER JOIN "AiGatewayRequest" AS request ON request.id = attempt."requestId"
        WHERE attempt."createdAt" >= ${since} AND attempt.status = 'circuit_open'
        GROUP BY request.scene
      `),
      this.prisma.aiGatewayRoute.findMany({
        where: { enabled: true },
        select: { scene: true, name: true, timeoutMs: true },
        orderBy: { scene: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{
        bucket: Date;
        requests: bigint;
        successes: bigint;
        fallbacks: bigint;
        total_tokens: bigint;
        average_latency_ms: number | null;
      }>>(Prisma.sql`
        SELECT
          DATE_TRUNC('day', "createdAt" + INTERVAL '8 hours') AS bucket,
          COUNT(*) AS requests,
          COUNT(*) FILTER (WHERE status = 'success') AS successes,
          COUNT(*) FILTER (WHERE "fallbackUsed" = true) AS fallbacks,
          COALESCE(SUM("totalTokens"), 0) AS total_tokens,
          AVG("latencyMs") AS average_latency_ms
        FROM "AiGatewayRequest"
        WHERE "createdAt" >= ${since}
        GROUP BY bucket
        ORDER BY bucket ASC
      `),
      this.prisma.integrationConfig.findMany({
        where: { kind: 'openai' },
        select: {
          id: true,
          name: true,
          provider: true,
          model: true,
          metadata: true,
          isActive: true,
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.aiGatewayAttempt.groupBy({
        by: ['connectionId', 'status'],
        where: { createdAt: { gte: since }, connectionId: { not: null } },
        _count: { _all: true },
        _avg: { latencyMs: true },
      }),
      // DISTINCT ON 让数据库只回传「每个连接每种状态的最新一条」（每连接最多 3 行）。
      // Prisma 的 distinct 在 orderBy 与 distinct 字段不一致时会退化成全表回传后在内存去重，
      // 而本查询没有时间窗，监控页每 30 秒轮询一次，随 AiGatewayAttempt 增长会线性变慢。
      this.prisma.$queryRaw<Array<{
        connectionId: string | null;
        status: string;
        latencyMs: number;
        errorCode: string | null;
        errorMessage: string | null;
        createdAt: Date;
      }>>(Prisma.sql`
        SELECT DISTINCT ON ("connectionId", status)
          "connectionId", status, "latencyMs", "errorCode", "errorMessage", "createdAt"
        FROM "AiGatewayAttempt"
        WHERE "connectionId" IS NOT NULL
        ORDER BY "connectionId", status, "createdAt" DESC
      `),
    ]);
    const priceIndex = this.buildPriceIndex(connections);
    const providerBreakdown = this.aggregateProviderGroups(byProvider, priceIndex);
    const pricedBreakdown = providerBreakdown.filter((item) => item.cost !== null);
    return {
      range: range === 'month' || range === 'year' ? range : 'today',
      totals: {
        requests: totals,
        failed_requests: failed,
        success_rate: totals > 0 ? Number(((successful / totals) * 100).toFixed(2)) : 0,
        fallback_rate: totals > 0 ? Number(((fallback / totals) * 100).toFixed(2)) : 0,
        average_latency_ms: Math.round(latency._avg.latencyMs ?? 0),
        total_tokens: tokenTotals._sum.totalTokens ?? 0,
        circuit_skips: circuitSkips,
        // 只累计已配单价的模型；未配价的模型数一并回传，否则用户会以为总额就是全部花费。
        total_cost: Number(pricedBreakdown.reduce((sum, item) => sum + (item.cost ?? 0), 0).toFixed(4)),
        unpriced_models: providerBreakdown.length - pricedBreakdown.length,
      },
      by_scene: this.aggregateGroups(byScene, 'scene'),
      by_provider: providerBreakdown,
      by_error: byError
        .map((item) => ({ error_code: item.errorCode || 'UNKNOWN', requests: item._count._all }))
        .sort((a, b) => b.requests - a.requests),
      diagnostics: this.buildSceneDiagnostics(
        byScene,
        circuitEvents,
        routes,
        circuitSnapshots,
      ),
      connections: this.buildConnectionOverview(
        connections,
        connectionAttemptGroups,
        latestConnectionAttempts,
        circuitSnapshots,
      ),
      trend: trend.map((item) => ({
        date: item.bucket.toISOString().slice(0, 10),
        requests: Number(item.requests),
        success_rate: Number(item.requests) > 0
          ? Number(((Number(item.successes) / Number(item.requests)) * 100).toFixed(2))
          : 0,
        fallback_rate: Number(item.requests) > 0
          ? Number(((Number(item.fallbacks) / Number(item.requests)) * 100).toFixed(2))
          : 0,
        total_tokens: Number(item.total_tokens),
        average_latency_ms: Math.round(Number(item.average_latency_ms ?? 0)),
      })),
    };
  }

  @Get('circuits')
  getCircuits() {
    return { items: this.aiGateway.getCircuitSnapshots() };
  }

  @Post('circuits/reset')
  resetCircuits(@Body() payload: ResetAiGatewayCircuitsDto) {
    const scene = payload.scene?.trim() || undefined;
    const targetKey = payload.target_key?.trim() || undefined;
    return { reset: this.aiGateway.resetCircuits(scene, targetKey) };
  }

  @Get('requests')
  async listRequests(
    @Query('scene') scene?: string,
    @Query('status') status?: string,
    @Query('connection_id') connectionId?: string,
    @Query('page') pageInput?: string,
    @Query('page_size') pageSizeInput?: string,
  ) {
    const page = Math.max(1, Number.parseInt(pageInput ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(pageSizeInput ?? '20', 10) || 20));
    const where: Prisma.AiGatewayRequestWhereInput = {};
    if (scene?.trim()) where.scene = scene.trim();
    if (status === 'success' || status === 'failed') where.status = status;
    if (connectionId?.trim()) {
      where.attempts = { some: { connectionId: connectionId.trim() } };
    }
    const [total, items] = await Promise.all([
      this.prisma.aiGatewayRequest.count({ where }),
      this.prisma.aiGatewayRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { attempts: { orderBy: { sequence: 'asc' } } },
      }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        scene: item.scene,
        status: item.status,
        provider: item.provider,
        model: item.model,
        latency_ms: item.latencyMs,
        attempt_count: item.attemptCount,
        fallback_used: item.fallbackUsed,
        prompt_tokens: item.promptTokens,
        completion_tokens: item.completionTokens,
        total_tokens: item.totalTokens,
        error_code: item.errorCode,
        error_message: item.errorMessage,
        created_at: item.createdAt.toISOString(),
        attempts: item.attempts.map((attempt) => ({
          sequence: attempt.sequence,
          connection_id: attempt.connectionId,
          provider: attempt.provider,
          model: attempt.model,
          status: attempt.status,
          latency_ms: attempt.latencyMs,
          error_code: attempt.errorCode,
          error_message: attempt.errorMessage,
        })),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  private rangeSince(range?: string): Date {
    const shanghaiOffsetMs = 8 * 3600 * 1000;
    const shanghaiNow = new Date(Date.now() + shanghaiOffsetMs);
    const year = shanghaiNow.getUTCFullYear();
    const month = shanghaiNow.getUTCMonth();
    const day = shanghaiNow.getUTCDate();
    if (range === 'year') return new Date(Date.UTC(year, 0, 1) - shanghaiOffsetMs);
    if (range === 'month') return new Date(Date.UTC(year, month, 1) - shanghaiOffsetMs);
    return new Date(Date.UTC(year, month, day) - shanghaiOffsetMs);
  }

  private buildConnectionOverview(
    connections: Array<{
      id: string;
      name: string;
      provider: string | null;
      model: string | null;
      metadata: Prisma.JsonValue;
      isActive: boolean;
    }>,
    attemptGroups: Array<{
      connectionId: string | null;
      status: string;
      _count: { _all: number };
      _avg: { latencyMs: number | null };
    }>,
    latestAttempts: Array<{
      connectionId: string | null;
      status: string;
      latencyMs: number;
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: Date;
    }>,
    circuits: Array<{ connectionId?: string; state: string }>,
  ) {
    const aggregates = new Map<string, {
      requests: number;
      successes: number;
      failures: number;
      circuitSkips: number;
      latencyTotal: number;
      measuredAttempts: number;
    }>();
    for (const group of attemptGroups) {
      if (!group.connectionId) continue;
      const aggregate = aggregates.get(group.connectionId) ?? {
        requests: 0,
        successes: 0,
        failures: 0,
        circuitSkips: 0,
        latencyTotal: 0,
        measuredAttempts: 0,
      };
      const calls = group._count._all;
      aggregate.requests += calls;
      if (group.status === 'success') aggregate.successes += calls;
      if (group.status === 'failed') aggregate.failures += calls;
      if (group.status === 'circuit_open') aggregate.circuitSkips += calls;
      if (group.status !== 'circuit_open') {
        aggregate.latencyTotal += (group._avg.latencyMs ?? 0) * calls;
        aggregate.measuredAttempts += calls;
      }
      aggregates.set(group.connectionId, aggregate);
    }

    const latestByConnection = new Map<string, typeof latestAttempts>();
    for (const attempt of latestAttempts) {
      if (!attempt.connectionId) continue;
      const current = latestByConnection.get(attempt.connectionId) ?? [];
      current.push(attempt);
      latestByConnection.set(attempt.connectionId, current);
    }
    const openCircuits = new Map<string, number>();
    for (const circuit of circuits) {
      if (!circuit.connectionId || circuit.state !== 'open') continue;
      openCircuits.set(circuit.connectionId, (openCircuits.get(circuit.connectionId) ?? 0) + 1);
    }

    return connections.map((connection) => {
      const aggregate = aggregates.get(connection.id) ?? {
        requests: 0,
        successes: 0,
        failures: 0,
        circuitSkips: 0,
        latencyTotal: 0,
        measuredAttempts: 0,
      };
      const attempts = latestByConnection.get(connection.id) ?? [];
      const latest = attempts.reduce<(typeof attempts)[number] | null>(
        (current, attempt) => !current || attempt.createdAt > current.createdAt ? attempt : current,
        null,
      );
      const latestSuccess = attempts.find((attempt) => attempt.status === 'success');
      const latestFailure = attempts.find((attempt) => attempt.status === 'failed');
      const openCircuitCount = openCircuits.get(connection.id) ?? 0;
      const completed = aggregate.successes + aggregate.failures;
      const successRate = completed > 0 ? Number(((aggregate.successes / completed) * 100).toFixed(2)) : 0;
      const metadata = connection.metadata && typeof connection.metadata === 'object' && !Array.isArray(connection.metadata)
        ? connection.metadata as Record<string, unknown>
        : {};
      const usageKind = typeof metadata.usage_kind === 'string' ? metadata.usage_kind : 'auto';
      const status = !connection.isActive
        ? 'disabled'
        : openCircuitCount > 0
          ? 'circuit_open'
          : latest?.status === 'failed'
            ? 'error'
            : completed === 0
              ? 'idle'
              : successRate < 90
                ? 'warning'
                : 'healthy';
      return {
        id: connection.id,
        name: connection.name,
        provider: connection.provider ?? '',
        model: connection.model ?? '',
        enabled: connection.isActive,
        usage_kind: usageKind,
        status,
        requests: aggregate.requests,
        successful_requests: aggregate.successes,
        failed_requests: aggregate.failures,
        circuit_skips: aggregate.circuitSkips,
        success_rate: successRate,
        average_latency_ms: aggregate.measuredAttempts > 0
          ? Math.round(aggregate.latencyTotal / aggregate.measuredAttempts)
          : 0,
        last_latency_ms: latest?.latencyMs ?? null,
        last_called_at: latest?.createdAt.toISOString() ?? null,
        last_success_at: latestSuccess?.createdAt.toISOString() ?? null,
        last_failure_at: latestFailure?.createdAt.toISOString() ?? null,
        open_circuits: openCircuitCount,
        last_error_code: latestFailure?.errorCode ?? null,
        last_error_message: latestFailure?.errorMessage ?? null,
      };
    });
  }

  private aggregateGroups<T extends { status: string; _count: { _all: number }; _avg: { latencyMs: number | null } }>(
    groups: T[],
    key: 'scene' | 'provider',
  ) {
    const aggregated = new Map<string, { key: string; requests: number; successes: number; latencyTotal: number }>();
    for (const group of groups) {
      const value = String((group as Record<string, unknown>)[key] ?? 'unknown') || 'unknown';
      const current = aggregated.get(value) ?? { key: value, requests: 0, successes: 0, latencyTotal: 0 };
      const calls = group._count._all;
      current.requests += calls;
      if (group.status === 'success') current.successes += calls;
      current.latencyTotal += (group._avg.latencyMs ?? 0) * calls;
      aggregated.set(value, current);
    }
    return [...aggregated.values()]
      .map((item) => ({
        [key]: item.key,
        requests: item.requests,
        success_rate: item.requests > 0 ? Number(((item.successes / item.requests) * 100).toFixed(2)) : 0,
        average_latency_ms: item.requests > 0 ? Math.round(item.latencyTotal / item.requests) : 0,
      }))
      .sort((a, b) => b.requests - a.requests);
  }

  private buildSceneDiagnostics(
    requestGroups: Array<{
      scene: string;
      status: string;
      fallbackUsed: boolean;
      _count: { _all: number };
      _avg: { latencyMs: number | null };
    }>,
    circuitEvents: Array<{ scene: string; skips: bigint }>,
    routes: Array<{ scene: string; name: string; timeoutMs: number }>,
    runtimeCircuits: Array<{ scene: string; state: 'closed' | 'open' }>,
  ) {
    const configured = new Map(routes.map((route) => [route.scene, route]));
    const metrics = new Map<string, {
      requests: number;
      successes: number;
      failedRequests: number;
      fallbacks: number;
      latencyTotal: number;
    }>();
    for (const group of requestGroups) {
      const current = metrics.get(group.scene) ?? {
        requests: 0,
        successes: 0,
        failedRequests: 0,
        fallbacks: 0,
        latencyTotal: 0,
      };
      const calls = group._count._all;
      current.requests += calls;
      if (group.status === 'success') current.successes += calls;
      if (group.status === 'failed') current.failedRequests += calls;
      if (group.fallbackUsed) current.fallbacks += calls;
      current.latencyTotal += (group._avg.latencyMs ?? 0) * calls;
      metrics.set(group.scene, current);
    }

    const circuitSkips = new Map<string, number>();
    for (const event of circuitEvents) {
      circuitSkips.set(event.scene, (circuitSkips.get(event.scene) ?? 0) + Number(event.skips));
    }
    const openCircuits = new Map<string, number>();
    for (const circuit of runtimeCircuits) {
      if (circuit.state !== 'open') continue;
      openCircuits.set(circuit.scene, (openCircuits.get(circuit.scene) ?? 0) + 1);
    }

    const sceneIds = new Set([
      ...configured.keys(),
      ...metrics.keys(),
      ...circuitSkips.keys(),
      ...openCircuits.keys(),
    ]);
    const severity = { critical: 0, warning: 1, healthy: 2, idle: 3 } as const;
    const scenes = [...sceneIds].map((scene) => {
      const route = configured.get(scene);
      const metric = metrics.get(scene) ?? {
        requests: 0,
        successes: 0,
        failedRequests: 0,
        fallbacks: 0,
        latencyTotal: 0,
      };
      const successRate = metric.requests > 0
        ? Number(((metric.successes / metric.requests) * 100).toFixed(2))
        : 0;
      const fallbackRate = metric.requests > 0
        ? Number(((metric.fallbacks / metric.requests) * 100).toFixed(2))
        : 0;
      const averageLatencyMs = metric.requests > 0 ? Math.round(metric.latencyTotal / metric.requests) : 0;
      const timeoutMs = route?.timeoutMs ?? 120_000;
      const warningLatencyMs = Math.min(15_000, Math.max(1_000, Math.round(timeoutMs * 0.5)));
      const criticalLatencyMs = Math.min(45_000, Math.max(3_000, Math.round(timeoutMs * 0.8)));
      const sceneCircuitSkips = circuitSkips.get(scene) ?? 0;
      const sceneOpenCircuits = openCircuits.get(scene) ?? 0;
      const criticalReasons: string[] = [];
      const warningReasons: string[] = [];

      if (sceneOpenCircuits > 0) criticalReasons.push(`${sceneOpenCircuits} 条连接正在熔断`);
      if (metric.requests >= 3 && successRate < 80) criticalReasons.push(`成功率仅 ${successRate}%`);
      if (averageLatencyMs >= criticalLatencyMs) criticalReasons.push(`平均延迟 ${averageLatencyMs} ms，已接近超时阈值`);
      if (metric.failedRequests > 0) warningReasons.push(`${metric.failedRequests} 次请求最终失败`);
      if (fallbackRate >= 20) warningReasons.push(`降级率达到 ${fallbackRate}%`);
      if (averageLatencyMs >= warningLatencyMs && averageLatencyMs < criticalLatencyMs) {
        warningReasons.push(`平均延迟达到 ${averageLatencyMs} ms`);
      }
      if (sceneCircuitSkips > 0) warningReasons.push(`${sceneCircuitSkips} 次请求跳过熔断连接`);

      let status: 'critical' | 'warning' | 'healthy' | 'idle';
      let reasons: string[];
      if (metric.requests === 0 && sceneOpenCircuits === 0) {
        status = 'idle';
        reasons = ['当前统计区间暂无调用数据'];
      } else if (criticalReasons.length > 0) {
        status = 'critical';
        reasons = [...criticalReasons, ...warningReasons];
      } else if (warningReasons.length > 0) {
        status = 'warning';
        reasons = warningReasons;
      } else {
        status = 'healthy';
        reasons = ['调用表现稳定，未触发健康告警阈值'];
      }
      return {
        scene,
        name: route?.name ?? scene,
        status,
        requests: metric.requests,
        failed_requests: metric.failedRequests,
        success_rate: successRate,
        fallback_rate: fallbackRate,
        average_latency_ms: averageLatencyMs,
        circuit_skips: sceneCircuitSkips,
        open_circuits: sceneOpenCircuits,
        reasons,
      };
    }).sort((left, right) => severity[left.status] - severity[right.status] || right.requests - left.requests || left.scene.localeCompare(right.scene));

    return {
      summary: {
        critical: scenes.filter((item) => item.status === 'critical').length,
        warning: scenes.filter((item) => item.status === 'warning').length,
        healthy: scenes.filter((item) => item.status === 'healthy').length,
        idle: scenes.filter((item) => item.status === 'idle').length,
      },
      scenes,
    };
  }

  /**
   * 单价配在模型连接上，而调用记录只留了 provider/model，所以按 provider+model 建价目。
   * 同一 provider+model 配了多条连接且单价不同时取先命中的那条——这种配法本身就有歧义。
   * 未配单价的连接不参与成本统计，避免把 0 当成「免费」混进总额。
   */
  private buildPriceIndex(connections: Array<{
    provider: string | null;
    model: string | null;
    metadata: Prisma.JsonValue;
  }>) {
    const prices = new Map<string, { input: number; output: number }>();
    for (const connection of connections) {
      const metadata = connection.metadata && typeof connection.metadata === 'object' && !Array.isArray(connection.metadata)
        ? connection.metadata as Record<string, unknown>
        : {};
      const input = this.positivePrice(metadata.input_price_per_1k);
      const output = this.positivePrice(metadata.output_price_per_1k);
      if (input === 0 && output === 0) continue;
      const key = `${(connection.provider ?? '').toLowerCase()}\u0000${(connection.model ?? '').toLowerCase()}`;
      if (!prices.has(key)) prices.set(key, { input, output });
    }
    return prices;
  }

  private positivePrice(value: unknown): number {
    const price = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  private aggregateProviderGroups(
    groups: Array<{
      provider: string | null;
      model: string | null;
      status: string;
      _count: { _all: number };
      _sum: { totalTokens: number | null; promptTokens: number | null; completionTokens: number | null };
      _avg: { latencyMs: number | null };
    }>,
    prices: Map<string, { input: number; output: number }>,
  ) {
    const aggregated = new Map<string, {
      provider: string;
      model: string;
      requests: number;
      successes: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
      latencyTotal: number;
    }>();
    for (const group of groups) {
      const provider = group.provider || 'unknown';
      const model = group.model || 'unknown';
      const groupKey = `${provider}\u0000${model}`;
      const current = aggregated.get(groupKey) ?? {
        provider,
        model,
        requests: 0,
        successes: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencyTotal: 0,
      };
      const calls = group._count._all;
      current.requests += calls;
      if (group.status === 'success') current.successes += calls;
      current.tokens += group._sum.totalTokens ?? 0;
      current.promptTokens += group._sum.promptTokens ?? 0;
      current.completionTokens += group._sum.completionTokens ?? 0;
      current.latencyTotal += (group._avg.latencyMs ?? 0) * calls;
      aggregated.set(groupKey, current);
    }
    return [...aggregated.values()]
      .map((item) => {
        const price = prices.get(`${item.provider.toLowerCase()}\u0000${item.model.toLowerCase()}`);
        return {
          provider: item.provider,
          model: item.model,
          requests: item.requests,
          success_rate: item.requests > 0 ? Number(((item.successes / item.requests) * 100).toFixed(2)) : 0,
          average_latency_ms: item.requests > 0 ? Math.round(item.latencyTotal / item.requests) : 0,
          total_tokens: item.tokens,
          prompt_tokens: item.promptTokens,
          completion_tokens: item.completionTokens,
          // null = 未配单价，前端显示「未配价」而不是 0 元
          cost: price === undefined
            ? null
            : Number(((item.promptTokens / 1000) * price.input + (item.completionTokens / 1000) * price.output).toFixed(4)),
        };
      })
      .sort((a, b) => b.requests - a.requests);
  }
}
