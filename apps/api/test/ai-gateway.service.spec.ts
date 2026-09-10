import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';

import { AiGatewayService } from '../src/modules/ai-gateway/ai-gateway.service';
import type { AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { OpenAiCompatibleAdapter } from '../src/modules/ai-gateway/openai-compatible.adapter';

const primary: AiGatewayTarget = {
  id: 'primary',
  provider: 'Qwen',
  model: 'qwen-primary',
  apiKey: 'test-key',
};
const fallback: AiGatewayTarget = {
  id: 'fallback',
  provider: 'DeepSeek',
  model: 'deepseek-fallback',
  apiKey: 'test-key',
};

test('后台租约取消透传到适配器，停止备用调用且不污染模型熔断状态', async () => {
  const controller = new AbortController();
  const reason = new Error('worker lease lost');
  const called: string[] = [];
  const service = createService(async (target, request) => {
    called.push(target.id!);
    assert.equal(request.signal, controller.signal);
    controller.abort(reason);
    throw Object.assign(new Error('response_format unsupported'), { status: 400 });
  });
  await assert.rejects(service.complete({
    scene: 'hr.resume_screening', targets: [primary, fallback], messages: [{ role: 'user', content: '匿名测试' }],
    responseFormat: { type: 'json_object' }, retryWithoutResponseFormat: true, signal: controller.signal,
  }));
  assert.deepEqual(called, ['primary']);
  assert.deepEqual(service.getCircuitSnapshots(), []);
});

test('已取消的后台任务不启动任何模型请求', async () => {
  const controller = new AbortController(); controller.abort(new Error('worker stopped'));
  let called = false;
  const service = createService(async () => { called = true; throw new Error('must not call'); });
  await assert.rejects(service.complete({ scene: 'hr.resume_screening', targets: [primary, fallback],
    messages: [{ role: 'user', content: '匿名测试' }], signal: controller.signal }), /worker stopped/);
  assert.equal(called, false);
});

function createService(
  complete: OpenAiCompatibleAdapter['complete'],
  settings: Record<string, unknown> = {},
  overrides: {
    prisma?: Record<string, unknown>;
    decryptFromStorage?: (value: string) => string;
    stream?: OpenAiCompatibleAdapter['stream'];
  } = {},
) {
  const adapter = { complete, stream: overrides.stream } as OpenAiCompatibleAdapter;
  const config = { get: (key: string) => settings[key] } as ConfigService;
  const prisma = overrides.prisma ?? {
    aiGatewayRequest: { create: async () => ({}) },
    aiGatewayRoute: { findUnique: async () => null },
  };
  const secureConfig = { decryptFromStorage: overrides.decryptFromStorage ?? ((value: string) => value) };
  return new AiGatewayService(adapter, config, prisma as never, secureConfig as never);
}

test('主模型失败后自动切换到备用模型并返回真实路由信息', async () => {
  const called: string[] = [];
  const service = createService(async (target) => {
    called.push(target.id ?? '');
    if (target.id === 'primary') throw Object.assign(new Error('upstream down'), { status: 503 });
    return { content: '备用模型结果', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  });

  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.deepEqual(called, ['primary', 'fallback'], '非限流错误立即降级，不在坏连接上重试');
  assert.equal(result.content, '备用模型结果');
  assert.equal(result.provider, 'DeepSeek');
  assert.equal(result.model, 'deepseek-fallback');
  assert.equal(result.attemptCount, 2);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['failed', 'success']);
});

test('被限流时先原地退避重试同一连接，重试成功不计入降级率', async () => {
  const called: string[] = [];
  const service = createService(async (target) => {
    called.push(target.id ?? '');
    if (called.length === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
    return { content: '主模型结果', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  }, { AI_GATEWAY_RETRY_BASE_DELAY_MS: 0 });

  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.deepEqual(called, ['primary', 'primary'], '限流应重试同一连接而不是立刻烧掉备用连接');
  assert.equal(result.provider, 'Qwen');
  assert.equal(result.attemptCount, 2);
  assert.equal(result.fallbackUsed, false, '同一连接的重试不是降级');
});

test('限流重试耗尽后才切换备用连接，且只消耗一次熔断计数', async () => {
  const called: string[] = [];
  const service = createService(async (target) => {
    called.push(target.id ?? '');
    if (target.id === 'primary') throw Object.assign(new Error('rate limited'), { status: 429 });
    return { content: '备用模型结果', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }, {
    AI_GATEWAY_RETRY_BASE_DELAY_MS: 0,
    AI_GATEWAY_MAX_RETRIES_PER_TARGET: 2,
    AI_GATEWAY_FAILURE_THRESHOLD: 2,
  });

  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.deepEqual(called, ['primary', 'primary', 'primary', 'fallback']);
  assert.equal(result.fallbackUsed, true, '换到另一个连接才算降级');
  const circuits = service.getCircuitSnapshots().filter((circuit) => circuit.targetKey === 'primary');
  assert.equal(circuits[0]?.consecutiveFailures, 1, '三次限流尝试只算一次熔断失败');
  assert.equal(circuits[0]?.state, 'closed', '未达阈值不应直接熔断');
});

test('Retry-After 超过上限时直接降级，不阻塞等待', async () => {
  const called: string[] = [];
  const service = createService(async (target) => {
    called.push(target.id ?? '');
    if (target.id === 'primary') {
      throw Object.assign(new Error('rate limited'), {
        status: 429,
        headers: { 'Retry-After': '600' },
      });
    }
    return { content: '备用模型结果', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }, { AI_GATEWAY_MAX_RETRY_DELAY_MS: 10_000 });

  const startedAt = Date.now();
  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.deepEqual(called, ['primary', 'fallback']);
  assert.equal(result.provider, 'DeepSeek');
  assert.ok(Date.now() - startedAt < 1_000, '不应真的等待 Retry-After 指定的 600 秒');
});

test('Retry-After 在上限内时按其指定时长等待后重试同一连接', async () => {
  const called: string[] = [];
  const service = createService(async () => {
    called.push('primary');
    if (called.length === 1) {
      throw Object.assign(new Error('rate limited'), {
        status: 429,
        headers: new Headers({ 'retry-after': '0.05' }),
      });
    }
    return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }, { AI_GATEWAY_MAX_RETRY_DELAY_MS: 10_000 });

  const startedAt = Date.now();
  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.equal(called.length, 2);
  assert.equal(result.content, 'ok');
  assert.ok(Date.now() - startedAt >= 50, '应尊重 Retry-After 指定的等待时长');
});

test('保留任务按批删除过期调用记录，attempts 由外键级联清理', async () => {
  const remaining = [
    { id: 'old-1', createdAt: new Date('2020-01-01T00:00:00Z') },
    { id: 'old-2', createdAt: new Date('2020-01-02T00:00:00Z') },
  ];
  const cutoffs: Date[] = [];
  const service = createService(async () => ({ content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), {
    AI_GATEWAY_RETENTION_DAYS: 30,
  }, {
    prisma: {
      aiGatewayRequest: {
        create: async () => ({}),
        findMany: async ({ where, select, take }: {
          where: { createdAt: { lt: Date } };
          select: { id: boolean };
          take: number;
        }) => {
          cutoffs.push(where.createdAt.lt);
          assert.deepEqual(select, { id: true }, '只取主键，不整行回传');
          assert.ok(take > 0, '必须分批取，不能一次性拉全表');
          return remaining.slice(0, take).map((item) => ({ id: item.id }));
        },
        deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          const ids = new Set(where.id.in);
          const before = remaining.length;
          for (let index = remaining.length - 1; index >= 0; index -= 1) {
            if (ids.has(remaining[index]!.id)) remaining.splice(index, 1);
          }
          return { count: before - remaining.length };
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
  });

  const deleted = await service.purgeExpiredTelemetry();

  assert.equal(deleted, 2);
  assert.equal(remaining.length, 0);
  const expectedCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(cutoffs[0]!.getTime() - expectedCutoff) < 5_000, '保留窗口应按配置的 30 天计算');
});

test('连接连续失败达到阈值后进入熔断并在后续请求中跳过', async () => {
  let primaryCalls = 0;
  const service = createService(async (target) => {
    if (target.id === 'primary') {
      primaryCalls += 1;
      throw Object.assign(new Error('upstream down'), { status: 503 });
    }
    return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }, {
    AI_GATEWAY_FAILURE_THRESHOLD: 2,
    AI_GATEWAY_CIRCUIT_COOLDOWN_MS: 60_000,
  });

  const request = {
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user' as const, content: '总结任务' }],
  };
  await service.complete(request);
  await service.complete(request);
  const third = await service.complete(request);

  assert.equal(primaryCalls, 2, '第三次请求应跳过已熔断的主连接');
  assert.equal(third.attempts[0]?.status, 'circuit_open');
  assert.equal(third.provider, 'DeepSeek');
});

test('重复目标只调用一次，避免配置重复造成重复计费', async () => {
  let calls = 0;
  const service = createService(async () => {
    calls += 1;
    return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  });

  await service.complete({
    scene: 'test',
    targets: [primary, { ...primary }],
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(calls, 1);
});

test('兼容端点拒绝 JSON Mode 时同一连接去除 response_format 后重试', async () => {
  const responseFormats: unknown[] = [];
  const service = createService(async (_target, request) => {
    responseFormats.push(request.responseFormat);
    if (request.responseFormat) {
      throw Object.assign(new Error('response_format json_object is not supported'), { status: 400 });
    }
    return { content: '{"summary":"ok"}', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
  });

  const result = await service.complete({
    scene: 'external_docs.version_compare',
    targets: [primary],
    messages: [{ role: 'user', content: 'classify diff' }],
    responseFormat: { type: 'json_object' },
    retryWithoutResponseFormat: true,
  });

  assert.equal(result.content, '{"summary":"ok"}');
  assert.deepEqual(responseFormats, [{ type: 'json_object' }, undefined]);
  assert.equal(result.attemptCount, 1, '兼容重试仍属于同一连接的一次网关尝试');
});

test('持久化场景路由按优先级解析现有模型连接并解密密钥', async () => {
  const connections = [
    { id: 'secondary', provider: 'DeepSeek', model: 'deepseek-chat', encryptedSecret: 'enc-2', metadata: { base_url: 'https://secondary.example/v1' } },
    { id: 'primary', provider: 'Qwen', model: 'qwen-plus', encryptedSecret: 'enc-1', metadata: { base_url: 'https://primary.example/v1' } },
  ];
  const service = createService(async () => ({
    content: 'ok',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }), {}, {
    prisma: {
      aiGatewayRequest: { create: async () => ({}) },
      aiGatewayRoute: {
        findUnique: async () => ({
          enabled: true,
          timeoutMs: 45_000,
          strategy: 'priority',
          failureThreshold: 4,
          cooldownMs: 90_000,
          targets: connections.map((connection, index) => ({ connection, weight: index === 0 ? 200 : 100 })),
        }),
      },
    },
    decryptFromStorage: (value) => `plain:${value}`,
  });

  const resolved = await service.resolveTargets('rd.task_brief', [primary]);

  assert.equal(resolved.source, 'route');
  assert.equal(resolved.timeoutMs, 45_000);
  assert.deepEqual(resolved.targets.map((target) => target.connectionId), ['secondary', 'primary']);
  assert.deepEqual(resolved.targets.map((target) => target.apiKey), ['plain:enc-2', 'plain:enc-1']);
  assert.deepEqual(resolved.targets.map((target) => target.weight), [200, 100]);
  assert.deepEqual(resolved.targets.map((target) => target.failureThreshold), [4, 4]);
});

test('轮询策略按场景在连接之间依次切换首选目标', async () => {
  const connections = [
    { id: 'first', provider: 'OpenAI', model: 'model-a', encryptedSecret: 'key-a', metadata: {} },
    { id: 'second', provider: 'OpenAI', model: 'model-b', encryptedSecret: 'key-b', metadata: {} },
    { id: 'third', provider: 'OpenAI', model: 'model-c', encryptedSecret: 'key-c', metadata: {} },
  ];
  const service = createService(async () => ({ content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), {}, {
    prisma: {
      aiGatewayRequest: { create: async () => ({}) },
      aiGatewayRoute: {
        findUnique: async () => ({
          enabled: true,
          timeoutMs: 30_000,
          strategy: 'round_robin',
          failureThreshold: 3,
          cooldownMs: 60_000,
          targets: connections.map((connection) => ({ connection, weight: 100 })),
        }),
      },
    },
  });

  const readinessCheck = await service.resolveTargets('round-robin-scene', [], { advanceRoundRobin: false });
  const first = await service.resolveTargets('round-robin-scene', []);
  const second = await service.resolveTargets('round-robin-scene', []);
  const third = await service.resolveTargets('round-robin-scene', []);

  assert.equal(readinessCheck.targets[0]?.id, 'first');
  assert.deepEqual([first.targets[0]?.id, second.targets[0]?.id, third.targets[0]?.id], ['first', 'second', 'third']);
});

test('权重策略按配置权重选择首选目标并保留其余目标作为降级链', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.75;
  try {
    const connections = [
      { id: 'light', provider: 'OpenAI', model: 'model-light', encryptedSecret: 'key-a', metadata: {} },
      { id: 'heavy', provider: 'OpenAI', model: 'model-heavy', encryptedSecret: 'key-b', metadata: {} },
    ];
    const service = createService(async () => ({ content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), {}, {
      prisma: {
        aiGatewayRequest: { create: async () => ({}) },
        aiGatewayRoute: {
          findUnique: async () => ({
            enabled: true,
            timeoutMs: 30_000,
            strategy: 'weighted',
            failureThreshold: 3,
            cooldownMs: 60_000,
            targets: [
              { connection: connections[0], weight: 1 },
              { connection: connections[1], weight: 9 },
            ],
          }),
        },
      },
    });

    const resolved = await service.resolveTargets('weighted-scene', []);

    assert.deepEqual(resolved.targets.map((target) => target.id), ['heavy', 'light']);
  } finally {
    Math.random = originalRandom;
  }
});

test('最低延迟策略使用最近成功调用统计排列目标', async () => {
  const connections = [
    { id: 'slow', provider: 'OpenAI', model: 'model-slow', encryptedSecret: 'key-a', metadata: {} },
    { id: 'fast', provider: 'OpenAI', model: 'model-fast', encryptedSecret: 'key-b', metadata: {} },
  ];
  let latencyWhere: Record<string, unknown> | undefined;
  const service = createService(async () => ({ content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), {}, {
    prisma: {
      aiGatewayRequest: { create: async () => ({}) },
      aiGatewayRoute: {
        findUnique: async () => ({
          enabled: true,
          timeoutMs: 30_000,
          strategy: 'lowest_latency',
          failureThreshold: 3,
          cooldownMs: 60_000,
          targets: connections.map((connection) => ({ connection, weight: 100 })),
        }),
      },
      aiGatewayAttempt: {
        groupBy: async (payload: { where: Record<string, unknown> }) => {
          latencyWhere = payload.where;
          return [
            { connectionId: 'slow', _avg: { latencyMs: 900 } },
            { connectionId: 'fast', _avg: { latencyMs: 120 } },
          ];
        },
      },
    },
  });

  const resolved = await service.resolveTargets('latency-scene', []);

  assert.deepEqual(resolved.targets.map((target) => target.id), ['fast', 'slow']);
  assert.ok((latencyWhere?.createdAt as { gte?: Date })?.gte instanceof Date);
});

test('熔断按场景隔离，支持查询状态和手动重置', async () => {
  const service = createService(async (target) => {
    if (target.id === 'primary') throw Object.assign(new Error('upstream down'), { status: 503 });
    return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  });
  const routedPrimary = { ...primary, failureThreshold: 1, cooldownMs: 60_000 };

  await service.complete({
    scene: 'scene-a',
    targets: [routedPrimary, fallback],
    messages: [{ role: 'user', content: 'hello' }],
  });

  const snapshots = service.getCircuitSnapshots();
  const opened = snapshots.find((snapshot) => snapshot.scene === 'scene-a' && snapshot.targetKey === 'primary');
  assert.equal(opened?.state, 'open');
  assert.equal(opened?.consecutiveFailures, 1);
  assert.equal(service.getCircuitSnapshots().some((snapshot) => snapshot.scene === 'scene-b'), false);
  assert.equal(service.resetCircuits('scene-a', 'primary'), 1);
  assert.deepEqual(service.getCircuitSnapshots(), []);
});

test('网关成功调用后异步写入请求和逐次尝试明细', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = createService(async () => ({
    content: 'ok',
    usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
  }), {}, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
  });

  await service.complete({
    requestId: 'request-1',
    scene: 'rd.task_brief',
    targets: [{ ...primary, connectionId: 'primary' }],
    messages: [{ role: 'user', content: 'summary' }],
  });
  assert.equal(writes.length, 1);
  const data = writes[0]?.data as Record<string, unknown>;
  assert.equal(data.id, 'request-1');
  assert.equal(data.status, 'success');
  assert.equal(data.totalTokens, 10);
  const attempts = (data.attempts as { create: Array<Record<string, unknown>> }).create;
  assert.equal(attempts[0]?.connectionId, 'primary');
  assert.equal(attempts[0]?.status, 'success');
});

test('所有连接失败时写入失败请求及错误码', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = createService(async () => {
    throw Object.assign(new Error('service unavailable'), { status: 503 });
  }, {}, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
  });

  await assert.rejects(() => service.complete({
    requestId: 'request-failed',
    scene: 'rd.task_brief',
    targets: [{ ...primary, connectionId: 'primary' }],
    messages: [{ role: 'user', content: 'summary' }],
  }));
  const data = writes[0]?.data as Record<string, unknown>;
  assert.equal(data.id, 'request-failed');
  assert.equal(data.status, 'failed');
  assert.equal(data.errorCode, 'HTTP_503');
});

test('唯一目标已熔断时透传 CIRCUIT_OPEN，而不是记录成 UNKNOWN', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = createService(async () => {
    throw Object.assign(new Error('service unavailable'), { status: 503 });
  }, {}, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
  });
  const onlyTarget = { ...primary, connectionId: 'primary', failureThreshold: 1, cooldownMs: 60_000 };
  const request = {
    scene: 'single-target-scene',
    targets: [onlyTarget],
    messages: [{ role: 'user' as const, content: 'summary' }],
  };

  await assert.rejects(() => service.complete(request));
  await assert.rejects(
    () => service.complete(request),
    (error: unknown) => {
      const response = (error as { getResponse(): unknown }).getResponse() as { error_code?: string };
      return response.error_code === 'CIRCUIT_OPEN';
    },
  );

  const secondWrite = writes[1]?.data as Record<string, unknown>;
  assert.equal(secondWrite.errorCode, 'CIRCUIT_OPEN');
  const attempts = (secondWrite.attempts as { create: Array<Record<string, unknown>> }).create;
  assert.equal(attempts[0]?.status, 'circuit_open');
});

// ── 流式：首字节前可降级，首字节后必须钉死 ──────────────────────────────────

const NOT_STREAMED = async () => {
  throw new Error('本用例不应调用非流式接口');
};

function streamChunk(content: string, usage?: { prompt: number; completion: number; total: number }) {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    ...(usage
      ? { usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.total } }
      : {}),
  } as never;
}

async function collect(stream: AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>) {
  const parts: string[] = [];
  for await (const chunk of stream) parts.push(chunk.choices[0]?.delta?.content ?? '');
  return parts.join('');
}

test('流式在首个分片之前失败时降级到备用连接', async () => {
  const called: string[] = [];
  const service = createService(NOT_STREAMED, {}, {
    stream: (async (target) => {
      called.push(target.id ?? '');
      if (target.id === 'primary') throw Object.assign(new Error('upstream down'), { status: 503 });
      return (async function* () {
        yield streamChunk('备用');
        yield streamChunk('模型');
      })();
    }) as never,
  });

  const settled: string[] = [];
  const text = await collect(service.stream({
    scene: 'chat.completion',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '你好' }],
    onTargetSettled: (target) => settled.push(target.id ?? ''),
  }) as never);

  assert.deepEqual(called, ['primary', 'fallback']);
  assert.equal(text, '备用模型');
  assert.deepEqual(settled, ['fallback'], '钉住的应是真正出字的那个连接');
});

test('流式在首个分片之后失败时直接上抛，不切换模型重来', async () => {
  const called: string[] = [];
  const service = createService(NOT_STREAMED, {}, {
    stream: (async (target) => {
      called.push(target.id ?? '');
      return (async function* () {
        yield streamChunk('已经开口');
        throw Object.assign(new Error('connection reset'), { status: 503 });
      })();
    }) as never,
  });

  const received: string[] = [];
  await assert.rejects(async () => {
    for await (const chunk of service.stream({
      scene: 'chat.completion',
      targets: [primary, fallback],
      messages: [{ role: 'user', content: '你好' }],
    }) as never as AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>) {
      received.push(chunk.choices[0]?.delta?.content ?? '');
    }
  }, /connection reset/);

  assert.deepEqual(called, ['primary'], '已经吐字后不能再试备用连接');
  assert.deepEqual(received, ['已经开口']);
});

test('流式把最后一个分片回传的真实用量写入调用记录', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = createService(NOT_STREAMED, {}, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
    stream: (async () => (async function* () {
      yield streamChunk('回答');
      yield streamChunk('', { prompt: 120, completion: 30, total: 150 });
    })()) as never,
  });

  await collect(service.stream({
    requestId: 'stream-1',
    scene: 'chat.completion',
    targets: [{ ...primary, connectionId: 'primary' }],
    messages: [{ role: 'user', content: '你好' }],
  }) as never);

  assert.equal(writes.length, 1);
  const data = writes[0]?.data as Record<string, unknown>;
  assert.equal(data.id, 'stream-1');
  assert.equal(data.status, 'success');
  assert.equal(data.promptTokens, 120);
  assert.equal(data.totalTokens, 150, '流式用量取自 stream_options 回传的真实值，不再按字数估算');
});

test('用户中断不算连接故障：不熔断、不降级，已产生的用量照常入账', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const called: string[] = [];
  const service = createService(NOT_STREAMED, { AI_GATEWAY_FAILURE_THRESHOLD: 1 }, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
    stream: (async (target) => {
      called.push(target.id ?? '');
      return (async function* () {
        yield streamChunk('前半句');
        controller.abort();
        throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
      })();
    }) as never,
  });

  const received: string[] = [];
  await assert.rejects(async () => {
    for await (const chunk of service.stream({
      scene: 'chat.completion',
      targets: [{ ...primary, connectionId: 'primary' }, fallback],
      messages: [{ role: 'user', content: '你好' }],
      signal: controller.signal,
    }) as never as AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>) {
      received.push(chunk.choices[0]?.delta?.content ?? '');
    }
  }, /aborted/);

  assert.deepEqual(called, ['primary'], '中断不应触发降级');
  assert.deepEqual(received, ['前半句']);
  assert.equal(service.getCircuitSnapshots().length, 0, '中断不应消耗熔断计数');
  assert.equal(writes.length, 1, '中断也要落一条调用记录，否则用量会整个丢掉');
  assert.equal((writes[0]?.data as Record<string, unknown>).status, 'success');
});

test('消费方提前 break 时补记调用，避免用量丢失', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = createService(NOT_STREAMED, {}, {
    prisma: {
      aiGatewayRequest: {
        create: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return {};
        },
      },
      aiGatewayRoute: { findUnique: async () => null },
    },
    stream: (async () => (async function* () {
      yield streamChunk('第一段');
      yield streamChunk('第二段');
      yield streamChunk('第三段');
    })()) as never,
  });

  const received: string[] = [];
  for await (const chunk of service.stream({
    scene: 'chat.completion',
    targets: [{ ...primary, connectionId: 'primary' }],
    messages: [{ role: 'user', content: '你好' }],
  }) as never as AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>) {
    received.push(chunk.choices[0]?.delta?.content ?? '');
    if (received.length === 2) break;
  }

  assert.deepEqual(received, ['第一段', '第二段']);
  assert.equal(writes.length, 1);
  assert.equal((writes[0]?.data as Record<string, unknown>).status, 'success');
});

test('上游拒绝 tools 时摘掉 tools 原地重试，而不是换一个模型', async () => {
  const attemptsSeen: Array<{ target: string; hasTools: boolean }> = [];
  let toolsDroppedNotified = 0;
  const service = createService(NOT_STREAMED, {}, {
    stream: (async (target, request) => {
      const hasTools = (request.tools?.length ?? 0) > 0;
      attemptsSeen.push({ target: target.id ?? '', hasTools });
      if (hasTools) throw Object.assign(new Error('Unrecognized request argument supplied: tools'), { status: 400 });
      return (async function* () {
        yield streamChunk('无工具回答');
      })();
    }) as never,
  });

  const text = await collect(service.stream({
    scene: 'chat.completion',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '你好' }],
    tools: [{ type: 'function', function: { name: 'search', parameters: {} } }] as never,
    retryWithoutTools: true,
    onToolsDropped: () => { toolsDroppedNotified += 1; },
  }) as never);

  assert.equal(text, '无工具回答');
  assert.deepEqual(attemptsSeen, [
    { target: 'primary', hasTools: true },
    { target: 'primary', hasTools: false },
  ], '应在同一个连接上摘掉 tools 重来，不应切到 fallback');
  assert.equal(toolsDroppedNotified, 1, '需要通知调用方后续轮次别再挂 tools');
});

test('摘掉 tools 后仍失败才降级到下一个连接', async () => {
  const attemptsSeen: string[] = [];
  const service = createService(NOT_STREAMED, {}, {
    stream: (async (target) => {
      attemptsSeen.push(target.id ?? '');
      if (target.id === 'primary') throw Object.assign(new Error('bad request'), { status: 400 });
      return (async function* () {
        yield streamChunk('备用回答');
      })();
    }) as never,
  });

  const text = await collect(service.stream({
    scene: 'chat.completion',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '你好' }],
    tools: [{ type: 'function', function: { name: 'search', parameters: {} } }] as never,
    retryWithoutTools: true,
  }) as never);

  assert.equal(text, '备用回答');
  assert.deepEqual(attemptsSeen, ['primary', 'primary', 'fallback']);
});
