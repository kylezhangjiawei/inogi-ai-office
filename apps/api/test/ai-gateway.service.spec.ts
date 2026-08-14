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

function createService(
  complete: OpenAiCompatibleAdapter['complete'],
  settings: Record<string, unknown> = {},
  overrides: {
    prisma?: Record<string, unknown>;
    decryptFromStorage?: (value: string) => string;
  } = {},
) {
  const adapter = { complete } as OpenAiCompatibleAdapter;
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
    if (target.id === 'primary') throw Object.assign(new Error('rate limited'), { status: 429 });
    return { content: '备用模型结果', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  });

  const result = await service.complete({
    scene: 'rd.task_brief',
    targets: [primary, fallback],
    messages: [{ role: 'user', content: '总结任务' }],
  });

  assert.deepEqual(called, ['primary', 'fallback']);
  assert.equal(result.content, '备用模型结果');
  assert.equal(result.provider, 'DeepSeek');
  assert.equal(result.model, 'deepseek-fallback');
  assert.equal(result.attemptCount, 2);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['failed', 'success']);
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
