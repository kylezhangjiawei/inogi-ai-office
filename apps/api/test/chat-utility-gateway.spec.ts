import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';

import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { ChatService } from '../src/modules/chat/chat.service';

test('通用非流式文本补全通过业务场景网关并回传实际命中模型', async () => {
  const fallbackTargets: AiGatewayTarget[][] = [];
  const calls: AiGatewayChatRequest[] = [];
  const configuredConnection = {
    id: 'selected-model',
    provider: 'OpenAI',
    model: 'gpt-4.1-mini',
    encryptedSecret: 'encrypted-key',
    metadata: { base_url: 'https://selected.example/v1', usage_kind: 'chat' },
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
  };
  const routedTarget: AiGatewayTarget = {
    id: 'routed-model',
    connectionId: 'routed-model',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const gateway = {
    resolveTargets: async (scene: string, fallback: AiGatewayTarget[]) => {
      assert.equal(scene, 'procurement.requirement_parse');
      fallbackTargets.push(fallback);
      return { targets: [routedTarget], timeoutMs: 45_000, source: 'route' as const };
    },
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      return {
        requestId: 'utility-request',
        scene: request.scene,
        content: '{"materialName":"阀组"}',
        provider: routedTarget.provider,
        model: routedTarget.model,
        latencyMs: 50,
        attemptCount: 1,
        fallbackUsed: false,
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
        attempts: [],
      };
    },
  };
  const service = new ChatService(
    { integrationConfig: { findFirst: async () => configuredConnection } } as never,
    {} as never,
    new ConfigService({}),
    { decryptFromStorage: () => 'selected-key' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    gateway as never,
  );

  const result = await service.complete({
    scene: 'procurement.requirement_parse',
    modelId: configuredConnection.id,
    system: 'Return JSON.',
    messages: [{ role: 'user', content: '采购阀组' }],
    json: true,
    maxTokens: 500,
  });

  assert.equal(fallbackTargets[0]?.[0]?.connectionId, configuredConnection.id);
  assert.equal(fallbackTargets[0]?.[0]?.model, configuredConnection.model);
  assert.equal(calls[0]?.scene, 'procurement.requirement_parse');
  assert.equal(calls[0]?.timeoutMs, 45_000);
  assert.deepEqual(calls[0]?.responseFormat, { type: 'json_object' });
  assert.deepEqual(result, {
    content: '{"materialName":"阀组"}',
    model: 'deepseek-chat',
    visionUsed: false,
  });
});
