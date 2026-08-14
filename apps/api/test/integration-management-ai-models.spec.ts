import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { IntegrationManagementService } from '../src/modules/integration-management/integration-management.service';

test('模型列表合并最新网关延迟并按上海日期重置旧的今日计数', async () => {
  const latestAttemptAt = new Date('2099-08-14T01:02:03.000Z');
  let latestAttemptQuery: Record<string, unknown> | undefined;
  let todayAttemptQuery: Record<string, unknown> | undefined;
  const model = {
    id: 'model-1',
    kind: 'openai',
    name: 'Qwen 主连接',
    accountIdentifier: null,
    provider: 'Qwen',
    model: 'qwen-plus',
    encryptedSecret: 'encrypted-key',
    metadata: {
      operator_name: '管理员',
      base_url: 'https://example.com/v1',
      current_status: '未配置',
      last_success_at: null,
      last_failure_at: null,
      last_latency_ms: null,
      today_requests: 99,
      today_tokens: 999,
      total_tokens: 999,
      daily_token_usage: [],
      is_default_enabled: true,
      today_usage_date: '2000-01-01',
      last_error_message: null,
      usage_kind: 'text',
    },
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const prisma = {
    integrationConfig: {
      count: async () => 1,
      findMany: async () => [model],
    },
    aiGatewayAttempt: {
      findMany: async (query: Record<string, unknown>) => {
        latestAttemptQuery = query;
        return [{
          connectionId: model.id,
          status: 'success',
          latencyMs: 321,
          errorCode: null,
          errorMessage: null,
          createdAt: latestAttemptAt,
        }];
      },
      groupBy: async (query: Record<string, unknown>) => {
        todayAttemptQuery = query;
        return [{ connectionId: model.id, _count: { _all: 4 } }];
      },
    },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    {} as never,
    {} as never,
  );

  const result = await service.listAiModels({ page: 1, page_size: 9 });

  assert.deepEqual(latestAttemptQuery?.distinct, ['connectionId']);
  assert.deepEqual(todayAttemptQuery?.by, ['connectionId']);
  assert.ok(((todayAttemptQuery?.where as { createdAt?: { gte?: unknown } })?.createdAt?.gte) instanceof Date);
  assert.equal(result.items[0]?.current_status, '运行正常');
  assert.equal(result.items[0]?.last_latency_ms, 321);
  assert.equal(result.items[0]?.last_success_at, latestAttemptAt.toISOString());
  assert.equal(result.items[0]?.today_requests, 4, '旧日期元数据应归零，再叠加今日网关调用');
  assert.equal(result.items[0]?.today_tokens, 0, '旧日期 Token 不应继续显示为今日用量');
});

test('连通性测试按显式用途将图片、视频和音频模型分流到 DashScope 原生协议', async () => {
  const nativeKinds: string[] = [];
  let chatCalls = 0;
  const rows = new Map(
    (['image', 'video', 'audio'] as const).map((usageKind) => [usageKind, {
      id: usageKind,
      kind: 'openai',
      name: `${usageKind} model`,
      accountIdentifier: null,
      provider: 'Qwen',
      model: `test-${usageKind}`,
      encryptedSecret: 'encrypted-key',
      metadata: {
        base_url: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        usage_kind: usageKind,
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]),
  );
  const prisma = {
    integrationConfig: {
      findFirst: async ({ where }: { where: { id?: string } }) =>
        rows.get((where.id ?? '') as 'image' | 'video' | 'audio') ?? null,
      update: async () => ({}),
    },
  };
  const openAi = {
    testDashScopeNativeConnection: async (
      usageKind: 'image' | 'video' | 'audio',
      _apiKey: string,
      model: string,
    ) => {
      nativeKinds.push(usageKind);
      return {
        modelName: model,
        baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/probe',
        durationMs: 12,
        outputText: 'probe ok',
        usage: { totalTokens: 0 },
      };
    },
    testConnection: async () => {
      chatCalls += 1;
      throw new Error('媒体模型不应进入聊天接口');
    },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    openAi as never,
    {} as never,
  );

  for (const usageKind of ['image', 'video', 'audio'] as const) {
    const result = await service.testAiModelConnection({
      id: usageKind,
      provider: 'Qwen',
      model: `test-${usageKind}`,
      usage_kind: usageKind,
    });
    assert.equal(result.success, true);
  }

  assert.deepEqual(nativeKinds, ['image', 'video', 'audio']);
  assert.equal(chatCalls, 0);
});
