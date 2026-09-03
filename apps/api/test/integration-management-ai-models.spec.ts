import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagnoseAiConnectionError } from '../src/modules/integration-management/ai-connection-error';
import { IntegrationManagementService } from '../src/modules/integration-management/integration-management.service';

test('模型列表合并最新网关延迟并按上海日期重置旧的今日计数', async () => {
  const latestAttemptAt = new Date('2099-08-14T01:02:03.000Z');
  let latestAttemptSql = '';
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
      groupBy: async (query: Record<string, unknown>) => {
        todayAttemptQuery = query;
        return [{ connectionId: model.id, _count: { _all: 4 } }];
      },
    },
    $queryRaw: async (query: { strings?: readonly string[] }) => {
      latestAttemptSql = query.strings?.join(' ') ?? '';
      return [{
        connectionId: model.id,
        status: 'success',
        latencyMs: 321,
        errorCode: null,
        errorMessage: null,
        createdAt: latestAttemptAt,
      }];
    },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    {} as never,
    {} as never,
  );

  const result = await service.listAiModels({ page: 1, page_size: 9 });

  // 最新尝试必须由数据库 DISTINCT ON 收敛并只取用到的列，否则列表翻页会整表回传。
  assert.match(latestAttemptSql, /DISTINCT ON \("connectionId"\)/);
  assert.match(latestAttemptSql, /ORDER BY "connectionId", "createdAt" DESC/);
  assert.doesNotMatch(latestAttemptSql, /SELECT \*/);
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

test('单价保存进 metadata；本次未提交单价时保留原值而不是清零', async () => {
  const existing = {
    id: 'model-1',
    kind: 'openai',
    name: 'Qwen 主连接',
    accountIdentifier: null,
    provider: 'Qwen',
    model: 'qwen-plus',
    encryptedSecret: 'encrypted-key',
    metadata: {
      base_url: 'https://example.com/v1',
      usage_kind: 'text',
      input_price_per_1k: 0.002,
      output_price_per_1k: 0.006,
      current_status: '运行正常',
    },
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const writes: Array<Record<string, unknown>> = [];
  const prisma = {
    integrationConfig: {
      findFirst: async () => existing,
      findMany: async () => [],
      update: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        return { ...existing, metadata: args.data.metadata };
      },
    },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    {} as never,
    {} as never,
  );
  const basePayload = {
    id: 'model-1',
    name: 'Qwen 主连接',
    provider: 'Qwen',
    model: 'qwen-plus',
    enabled: true,
    is_default_enabled: false,
  };

  // 显式改价：写入新单价
  await service.saveAiModel({ ...basePayload, input_price_per_1k: 0.003, output_price_per_1k: 0.009 } as never);
  const changed = writes[0]?.metadata as Record<string, unknown>;
  assert.equal(changed.input_price_per_1k, 0.003);
  assert.equal(changed.output_price_per_1k, 0.009);

  // 表单没带单价字段（例如只改了名字）：不能把已配的单价清零
  await service.saveAiModel(basePayload as never);
  const untouched = writes[1]?.metadata as Record<string, unknown>;
  assert.equal(untouched.input_price_per_1k, 0.002, '未提交单价时应保留原值');
  assert.equal(untouched.output_price_per_1k, 0.006);

  // 显式传 0 表示取消计价
  await service.saveAiModel({ ...basePayload, input_price_per_1k: 0, output_price_per_1k: 0 } as never);
  const cleared = writes[2]?.metadata as Record<string, unknown>;
  assert.equal(cleared.input_price_per_1k, 0, '显式传 0 应清空单价');
  assert.equal(cleared.output_price_per_1k, 0);
});

test('网关表不可用时模型列表降级为仅显示配置，而不是整页 500', async () => {
  const model = {
    id: 'model-1',
    kind: 'openai',
    name: 'Qwen 主连接',
    accountIdentifier: null,
    provider: 'Qwen',
    model: 'qwen-plus',
    encryptedSecret: 'encrypted-key',
    metadata: {
      base_url: 'https://example.com/v1',
      usage_kind: 'text',
      current_status: '运行正常',
      last_latency_ms: 210,
      input_price_per_1k: 0.002,
    },
    isActive: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  // 迁移尚未执行时 Prisma 抛的就是这个：relation "AiGatewayAttempt" does not exist
  const missingTable = Object.assign(new Error('relation "AiGatewayAttempt" does not exist'), { code: 'P2010' });
  const prisma = {
    integrationConfig: {
      count: async () => 1,
      findMany: async () => [model],
    },
    aiGatewayAttempt: {
      groupBy: async () => { throw missingTable; },
    },
    $queryRaw: async () => { throw missingTable; },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    {} as never,
    {} as never,
  );

  const result = await service.listAiModels({ page: 1, page_size: 9 });

  assert.equal(result.total, 1, '配置本身必须照常返回——这是配置模型的唯一入口');
  assert.equal(result.items[0]?.name, 'Qwen 主连接');
  assert.equal(result.items[0]?.current_status, '运行正常', '降级后沿用 metadata 里的状态');
  assert.equal(result.items[0]?.last_latency_ms, 210);
  assert.equal(result.items[0]?.today_requests, 0, '取不到网关数据时今日调用数按 0 显示');
  assert.equal(result.items[0]?.input_price_per_1k, 0.002, '单价来自 metadata，不受网关表影响');
});

test('连通性测试失败时返回中文诊断，并按 disable_on_failure 决定是否停用模型', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const model = {
    id: 'glm-5',
    kind: 'openai',
    name: '智谱AI glm-5',
    accountIdentifier: null,
    provider: 'Zhipu',
    model: 'glm-5',
    encryptedSecret: 'encrypted-key',
    metadata: {
      base_url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      usage_kind: 'text',
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    integrationConfig: {
      findFirst: async () => model,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return model;
      },
    },
  };
  // 百炼第三方模型走 Responses 接口时的真实报错形态（OpenAI SDK APIError 带 status / code / type）
  const upstreamError = Object.assign(
    new Error('400 <400> InternalError.Algo.InvalidParameter: Agent capabilities are not enabled for the current model.'),
    { status: 400, code: 'InvalidParameter', type: 'invalid_request_error' },
  );
  const openAi = {
    testConnection: async () => {
      throw upstreamError;
    },
  };
  const service = new IntegrationManagementService(
    prisma as never,
    { decryptFromStorage: () => 'plain-key' } as never,
    openAi as never,
    {} as never,
  );

  const result = await service.testAiModelConnection({
    id: 'glm-5',
    provider: 'Zhipu',
    model: 'glm-5',
    disable_on_failure: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'API_MODE_UNSUPPORTED');
  assert.match(result.error_reason ?? '', /Responses/, '结论要点明是接口形态不被支持');
  assert.ok((result.error_causes?.length ?? 0) >= 2, '至少给出两条可能情况');
  assert.match(result.error_causes?.[0] ?? '', /glm-5/, '可能情况要带上具体模型');
  assert.match(result.message, /可能情况：1）/);
  assert.match(result.message, /原始错误：400 <400> InternalError/);
  assert.equal(result.raw_error?.includes('status=400, code=InvalidParameter'), true, '原始错误保留 SDK 元信息');
  assert.equal(result.disabled, true);
  assert.equal(updates[0]?.isActive, false, '带 disable_on_failure 时应把模型停用');
  const metadata = updates[0]?.metadata as { current_status: string; last_error_message: string };
  assert.equal(metadata.current_status, '连接异常');
  assert.match(metadata.last_error_message, /^服务商不支持用当前接口形态/, '落库的也是中文诊断');

  // 编辑对话框里的测试不带标记：只记录失败，不动启用状态
  const untouched = await service.testAiModelConnection({ id: 'glm-5', provider: 'Zhipu', model: 'glm-5' });
  assert.equal(untouched.disabled, false);
  assert.equal('isActive' in (updates[1] ?? {}), false, '不带标记时不能碰 isActive');
});

test('连通性错误诊断按状态码和错误签名归类为中文原因', () => {
  const ctx = { provider: 'OpenAI', model: 'gpt-5.5', baseUrl: 'https://api.openai.com/v1' };
  const codeOf = (error: unknown, raw: string) => diagnoseAiConnectionError(error, raw, ctx).code;
  const withMeta = (message: string, meta: Record<string, unknown>) => Object.assign(new Error(message), meta);

  assert.equal(codeOf(withMeta('401 Incorrect API key provided', { status: 401 }), '401 Incorrect API key provided'), 'AUTH_FAILED');
  assert.equal(codeOf(new Error('Invalid API-key provided. · InvalidApiKey'), 'Invalid API-key provided. · InvalidApiKey'), 'AUTH_FAILED', '百炼原生接口没有 status，只能靠文本');
  assert.equal(codeOf(withMeta('429 Rate limit reached', { status: 429 }), '429 Rate limit reached'), 'RATE_LIMITED');
  assert.equal(codeOf(withMeta('429 You exceeded your current quota', { status: 429, code: 'insufficient_quota' }), '429 You exceeded your current quota (status=429, code=insufficient_quota)'), 'BILLING', '欠费要先于限流判断');
  assert.equal(codeOf(withMeta('403 Access denied, please make sure your account is in good standing.', { status: 403 }), '403 Access denied, please make sure your account is in good standing.'), 'BILLING', '百炼欠费是 403 但文案指向账户状态');
  assert.equal(codeOf(withMeta('403 Forbidden', { status: 403 }), '403 Forbidden'), 'PERMISSION_DENIED');
  assert.equal(codeOf(withMeta('404 The model `gpt-9` does not exist', { status: 404, code: 'model_not_found' }), '404 The model `gpt-9` does not exist'), 'MODEL_NOT_FOUND');
  assert.equal(codeOf(withMeta('400 Model not exist.', { status: 400, code: 'InvalidParameter' }), '400 Model not exist. (status=400, code=InvalidParameter)'), 'MODEL_NOT_FOUND');
  assert.equal(codeOf(withMeta('400 Range of max_tokens for this model is [1, 8192]', { status: 400, code: 'InvalidParameter' }), '400 Range of max_tokens for this model is [1, 8192] (status=400, code=InvalidParameter)'), 'BAD_REQUEST', '括号里的 code=InvalidParameter 不能被当成"模型不存在"');
  assert.equal(codeOf(withMeta('404 Not Found', { status: 404 }), '404 Not Found'), 'ENDPOINT_NOT_FOUND');
  assert.equal(codeOf(withMeta('Connection error.', { name: 'APIConnectionError', cause: { code: 'ENOTFOUND' } }), 'Connection error.'), 'NETWORK_UNREACHABLE');
  assert.equal(codeOf(withMeta('Request timed out.', { name: 'APIConnectionTimeoutError' }), 'Request timed out.'), 'TIMEOUT');
  assert.equal(codeOf(withMeta("500 InternalError.Algo: 'agent_api_metadata'", { status: 500 }), "500 InternalError.Algo: 'agent_api_metadata'"), 'API_MODE_UNSUPPORTED', 'MiniMax 的 500 也是同一类接口形态问题');
  assert.equal(codeOf(withMeta('503 Service Unavailable', { status: 503 }), '503 Service Unavailable'), 'UPSTREAM_ERROR');
  assert.equal(codeOf(new Error('DashScope 原生接口返回 HTTP 502'), 'DashScope 原生接口返回 HTTP 502'), 'UPSTREAM_ERROR', '没有 status 字段时从文本里解析状态码');
  assert.equal(codeOf(new Error('OPENAI_API_KEY is not configured.'), 'OPENAI_API_KEY is not configured.'), 'CONFIG_MISSING');
  assert.equal(codeOf(new Error('Model returned empty content'), 'Model returned empty content'), 'EMPTY_RESPONSE');
  assert.equal(codeOf(new Error('something odd'), 'something odd'), 'UNKNOWN');

  const diagnosis = diagnoseAiConnectionError(withMeta('400 Bad Request', { status: 400 }), '400 Bad Request', ctx);
  assert.equal(diagnosis.code, 'BAD_REQUEST');
  assert.match(diagnosis.message, /^请求参数被服务商拒绝。可能情况：1）/);
  assert.match(diagnosis.message, /。原始错误：400 Bad Request$/);
});
