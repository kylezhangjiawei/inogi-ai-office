import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AiGatewayService } from '../src/modules/ai-gateway/ai-gateway.service';
import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { OpsAiService, type OpsErrorContext } from '../src/modules/ops-center/ops-ai.service';

const context: OpsErrorContext = {
  method: 'POST',
  path: '/api/tasks',
  statusCode: 500,
  errorName: 'DatabaseError',
  errorMessage: 'connection timeout',
  occurrences: 3,
  affectedUsers: 2,
};

const storedConnection = {
  id: 'ops-primary',
  provider: 'Qwen',
  model: 'qwen-plus',
  encryptedSecret: 'encrypted-key',
  metadata: { base_url: 'https://example.com/v1' },
};

function createService(input: {
  stored?: typeof storedConnection | null;
  resolvedTargets?: AiGatewayTarget[];
  timeoutMs?: number;
  complete?: (request: AiGatewayChatRequest) => Promise<{
    content: string;
    model: string;
  }>;
}) {
  const prisma = {
    integrationConfig: {
      findFirst: async () => input.stored === undefined ? storedConnection : input.stored,
    },
  };
  const secureConfig = { decryptFromStorage: (value: string) => `plain:${value}` };
  const calls: AiGatewayChatRequest[] = [];
  const aiGateway = {
    resolveTargets: async (_scene: string, fallback: AiGatewayTarget[]) => ({
      targets: input.resolvedTargets ?? fallback,
      timeoutMs: input.timeoutMs,
      source: input.resolvedTargets ? 'route' : 'fallback',
    }),
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      if (input.complete) return input.complete(request);
      return {
        content: JSON.stringify({
          summary: '数据库连接池耗尽',
          probable_causes: ['连接未释放'],
          impact: '任务创建失败',
          investigation_steps: ['检查连接池'],
          fix_suggestions: ['修复连接释放'],
        }),
        model: request.targets[0]?.model ?? 'unknown',
      };
    },
  };
  const service = new OpsAiService(
    prisma as never,
    secureConfig as never,
    aiGateway as unknown as AiGatewayService,
  );
  return { service, calls };
}

test('运维错误分析通过统一网关使用场景路由及专用超时', async () => {
  const routedTarget: AiGatewayTarget = {
    id: 'ops-route',
    connectionId: 'ops-route',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const { service, calls } = createService({ resolvedTargets: [routedTarget], timeoutMs: 45_000 });

  const result = await service.analyze(context);

  assert.equal(result.generated_by, 'ai');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(result.summary, '数据库连接池耗尽');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.scene, 'ops.error_analysis');
  assert.equal(calls[0]?.timeoutMs, 45_000);
  assert.deepEqual(calls[0]?.responseFormat, { type: 'json_object' });
  assert.equal(calls[0]?.targets[0]?.connectionId, 'ops-route');
});

test('未配置模型且场景路由为空时返回现有不可用兜底', async () => {
  const { service, calls } = createService({ stored: null, resolvedTargets: [] });

  const result = await service.analyze(context);

  assert.equal(result.generated_by, 'unavailable');
  assert.equal(result.model, null);
  assert.match(result.summary, /尚未配置/);
  assert.equal(calls.length, 0);
});

test('网关调用失败时保留运维分析的非阻断兜底', async () => {
  const { service } = createService({
    complete: async () => {
      throw new Error('gateway timeout');
    },
  });

  const result = await service.analyze(context);

  assert.equal(result.generated_by, 'unavailable');
  assert.equal(result.model, 'qwen-plus');
  assert.match(result.summary, /AI 调用失败/);
  assert.deepEqual(result.investigation_steps, ['gateway timeout']);
});
