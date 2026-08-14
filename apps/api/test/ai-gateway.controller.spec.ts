import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { AiGatewayController } from '../src/modules/ai-gateway/ai-gateway.controller';

function createController(prisma: Record<string, unknown> = {}, aiGateway: Record<string, unknown> = {}) {
  return new AiGatewayController(prisma as never, aiGateway as never);
}

test('全部重置熔断器时不再要求场景或目标参数', () => {
  const calls: Array<[string | undefined, string | undefined]> = [];
  const controller = createController({}, {
    resetCircuits: (scene?: string, targetKey?: string) => {
      calls.push([scene, targetKey]);
      return 3;
    },
  });

  const result = controller.resetCircuits({} as never);

  assert.deepEqual(calls, [[undefined, undefined]]);
  assert.deepEqual(result, { reset: 3 });
});

test('概览错误类型按失败尝试统计，包含最终成功请求中的上游失败', async () => {
  let failedAttemptGroupByCalled = false;
  const requestCount = async ({ where }: { where: { status?: string; fallbackUsed?: boolean } }) => {
    if (where.status === 'success') return 8;
    if (where.status === 'failed') return 2;
    if (where.fallbackUsed) return 3;
    return 10;
  };
  const controller = createController({
    aiGatewayRequest: {
      count: requestCount,
      aggregate: async (args: { _avg?: unknown; _sum?: unknown }) => (
        args._avg ? { _avg: { latencyMs: 126.4 } } : { _sum: { totalTokens: 900 } }
      ),
      groupBy: async ({ by }: { by: string[] }) => {
        if (by.includes('scene')) {
          return [
            { scene: 'rd.task_brief', status: 'success', fallbackUsed: false, _count: { _all: 5 }, _avg: { latencyMs: 100 } },
            { scene: 'rd.task_brief', status: 'success', fallbackUsed: true, _count: { _all: 3 }, _avg: { latencyMs: 100 } },
            { scene: 'rd.task_brief', status: 'failed', fallbackUsed: false, _count: { _all: 2 }, _avg: { latencyMs: 200 } },
          ];
        }
        return [
          {
            provider: 'Qwen',
            model: 'qwen-plus',
            status: 'success',
            _count: { _all: 8 },
            _sum: { totalTokens: 900 },
            _avg: { latencyMs: 100 },
          },
          {
            provider: 'Qwen',
            model: 'qwen-plus',
            status: 'failed',
            _count: { _all: 2 },
            _sum: { totalTokens: 0 },
            _avg: { latencyMs: 200 },
          },
        ];
      },
    },
    aiGatewayAttempt: {
      count: async () => 1,
      groupBy: async (args: { by: string[]; where: { status?: string } }) => {
        if (args.by.includes('connectionId')) {
          return [
            { connectionId: 'model-qwen', status: 'success', _count: { _all: 8 }, _avg: { latencyMs: 100 } },
            { connectionId: 'model-qwen', status: 'failed', _count: { _all: 2 }, _avg: { latencyMs: 200 } },
          ];
        }
        failedAttemptGroupByCalled = args.by.includes('errorCode') && args.where.status === 'failed';
        return [
          { errorCode: 'HTTP_429', _count: { _all: 3 } },
          { errorCode: 'HTTP_503', _count: { _all: 1 } },
        ];
      },
      findMany: async () => [
        { connectionId: 'model-qwen', status: 'success', latencyMs: 100, errorCode: null, errorMessage: null, createdAt: new Date('2026-08-13T08:00:00.000Z') },
        { connectionId: 'model-qwen', status: 'failed', latencyMs: 200, errorCode: 'HTTP_429', errorMessage: 'rate limit', createdAt: new Date('2026-08-13T07:00:00.000Z') },
      ],
    },
    integrationConfig: {
      findMany: async () => [
        { id: 'model-qwen', name: '千问主模型', provider: 'Qwen', model: 'qwen-plus', metadata: { usage_kind: 'text' }, isActive: true },
        { id: 'model-idle', name: '待启用模型', provider: 'DeepSeek', model: 'deepseek-chat', metadata: {}, isActive: false },
      ],
    },
    aiGatewayRoute: {
      findMany: async () => [
        { scene: 'rd.task_brief', name: '研发任务简报', timeoutMs: 30_000 },
        { scene: 'rd.reporting', name: '研发报表总结', timeoutMs: 120_000 },
      ],
    },
    $queryRaw: async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(' ') ?? '';
      if (sql.includes('AiGatewayAttempt')) return [{ scene: 'rd.task_brief', skips: 1n }];
      return [{
        bucket: new Date('2026-08-13T00:00:00.000Z'),
        requests: 10n,
        successes: 8n,
        fallbacks: 3n,
        total_tokens: 900n,
        average_latency_ms: 126.4,
      }];
    },
  }, {
    getCircuitSnapshots: () => [],
  });

  const result = await controller.getOverview('today');

  assert.equal(failedAttemptGroupByCalled, true);
  assert.deepEqual(result.totals, {
    requests: 10,
    failed_requests: 2,
    success_rate: 80,
    fallback_rate: 30,
    average_latency_ms: 126,
    total_tokens: 900,
    circuit_skips: 1,
  });
  assert.deepEqual(result.by_error, [
    { error_code: 'HTTP_429', requests: 3 },
    { error_code: 'HTTP_503', requests: 1 },
  ]);
  assert.deepEqual(result.connections[0], {
    id: 'model-qwen',
    name: '千问主模型',
    provider: 'Qwen',
    model: 'qwen-plus',
    enabled: true,
    usage_kind: 'text',
    status: 'warning',
    requests: 10,
    successful_requests: 8,
    failed_requests: 2,
    circuit_skips: 0,
    success_rate: 80,
    average_latency_ms: 120,
    last_latency_ms: 100,
    last_called_at: '2026-08-13T08:00:00.000Z',
    last_success_at: '2026-08-13T08:00:00.000Z',
    last_failure_at: '2026-08-13T07:00:00.000Z',
    open_circuits: 0,
    last_error_code: 'HTTP_429',
    last_error_message: 'rate limit',
  });
  assert.equal(result.connections[1]?.status, 'disabled');
  assert.equal(result.by_scene[0]?.success_rate, 80);
  assert.equal(result.by_provider[0]?.average_latency_ms, 120);
  assert.deepEqual(result.diagnostics.summary, {
    critical: 0,
    warning: 1,
    healthy: 0,
    idle: 1,
  });
  assert.deepEqual(result.diagnostics.scenes[0], {
    scene: 'rd.task_brief',
    name: '研发任务简报',
    status: 'warning',
    requests: 10,
    failed_requests: 2,
    success_rate: 80,
    fallback_rate: 30,
    average_latency_ms: 120,
    circuit_skips: 1,
    open_circuits: 0,
    reasons: ['2 次请求最终失败', '降级率达到 30%', '1 次请求跳过熔断连接'],
  });
  assert.equal(result.diagnostics.scenes[1]?.status, 'idle');
  assert.deepEqual(result.trend[0], {
    date: '2026-08-13',
    requests: 10,
    success_rate: 80,
    fallback_rate: 30,
    total_tokens: 900,
    average_latency_ms: 126,
  });
});

test('场景健康诊断把开启熔断和低成功率判为严重', async () => {
  const controller = createController({
    aiGatewayRequest: {
      count: async ({ where }: { where: { status?: string; fallbackUsed?: boolean } }) => {
        if (where.status === 'success') return 1;
        if (where.status === 'failed') return 4;
        return 5;
      },
      aggregate: async (args: { _avg?: unknown }) => args._avg ? { _avg: { latencyMs: 9000 } } : { _sum: { totalTokens: 100 } },
      groupBy: async ({ by }: { by: string[] }) => by.includes('scene')
        ? [
            { scene: 'ops.error_analysis', status: 'success', fallbackUsed: false, _count: { _all: 1 }, _avg: { latencyMs: 5000 } },
            { scene: 'ops.error_analysis', status: 'failed', fallbackUsed: false, _count: { _all: 4 }, _avg: { latencyMs: 10000 } },
          ]
        : [],
    },
    aiGatewayAttempt: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async () => [],
    },
    integrationConfig: { findMany: async () => [] },
    aiGatewayRoute: {
      findMany: async () => [{ scene: 'ops.error_analysis', name: '运维错误分析', timeoutMs: 10_000 }],
    },
    $queryRaw: async () => [],
  }, {
    getCircuitSnapshots: () => [{ scene: 'ops.error_analysis', state: 'open' }],
  });

  const result = await controller.getOverview('today');

  assert.deepEqual(result.diagnostics.summary, { critical: 1, warning: 0, healthy: 0, idle: 0 });
  assert.equal(result.diagnostics.scenes[0]?.status, 'critical');
  assert.deepEqual(result.diagnostics.scenes[0]?.reasons, [
    '1 条连接正在熔断',
    '成功率仅 20%',
    '平均延迟 9000 ms，已接近超时阈值',
    '4 次请求最终失败',
  ]);
});

test('请求明细可按模型连接过滤并保留分页参数', async () => {
  let capturedWhere: unknown;
  let capturedSkip = -1;
  let capturedTake = -1;
  const controller = createController({
    aiGatewayRequest: {
      count: async ({ where }: { where: unknown }) => {
        capturedWhere = where;
        return 0;
      },
      findMany: async ({ skip, take }: { skip: number; take: number }) => {
        capturedSkip = skip;
        capturedTake = take;
        return [];
      },
    },
  });

  const result = await controller.listRequests('rd.reporting', 'failed', 'model-qwen', '2', '10');

  assert.deepEqual(capturedWhere, {
    scene: 'rd.reporting',
    status: 'failed',
    attempts: { some: { connectionId: 'model-qwen' } },
  });
  assert.equal(capturedSkip, 10);
  assert.equal(capturedTake, 10);
  assert.deepEqual(result.pagination, { page: 2, page_size: 10, total: 0, total_pages: 1 });
});

test('路由保存拒绝与连接数量不一致的模型权重', async () => {
  let transactionCalled = false;
  const controller = createController({
    $transaction: async () => {
      transactionCalled = true;
    },
  });

  await assert.rejects(
    controller.saveRoute({
      scene: 'rd.task_brief',
      name: '研发任务简报',
      enabled: true,
      timeout_ms: 30_000,
      strategy: 'weighted',
      failure_threshold: 3,
      cooldown_ms: 60_000,
      connection_ids: ['model-a', 'model-b'],
      target_weights: [100],
    } as never),
    BadRequestException,
  );
  assert.equal(transactionCalled, false);
});

test('路由保存按去重后的连接顺序持久化优先级和权重', async () => {
  let createdTargets: Array<{ routeId: string; connectionId: string; priority: number; weight: number }> = [];
  const updatedAt = new Date('2026-08-13T08:00:00.000Z');
  const tx = {
    aiGatewayRoute: {
      upsert: async () => ({ id: 'route-1', scene: 'rd.task_brief', updatedAt }),
    },
    aiGatewayRouteTarget: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: typeof createdTargets }) => {
        createdTargets = data;
        return { count: data.length };
      },
    },
  };
  const controller = createController({
    integrationConfig: { count: async () => 2 },
    $transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
  });

  const result = await controller.saveRoute({
    scene: 'rd.task_brief',
    name: '研发任务简报',
    enabled: true,
    timeout_ms: 30_000,
    strategy: 'weighted',
    failure_threshold: 3,
    cooldown_ms: 60_000,
    connection_ids: [' model-a ', 'model-b', 'model-a'],
    target_weights: [70, 30, 99],
  } as never);

  assert.deepEqual(createdTargets, [
    { routeId: 'route-1', connectionId: 'model-a', priority: 0, weight: 70 },
    { routeId: 'route-1', connectionId: 'model-b', priority: 1, weight: 30 },
  ]);
  assert.deepEqual(result, {
    id: 'route-1',
    scene: 'rd.task_brief',
    updated_at: '2026-08-13T08:00:00.000Z',
  });
});
