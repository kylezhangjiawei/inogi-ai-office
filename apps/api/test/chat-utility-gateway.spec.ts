import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

test('主对话流式回答走网关，并把 ReAct 多轮钉在同一个连接上', () => {
  const source = readFileSync(resolve(__dirname, '../src/modules/chat/chat.service.ts'), 'utf8');

  // 流式主链路必须经过网关，否则成功率/延迟/用量统计会漏掉最大的流量来源
  assert.match(source, /this\.aiGateway\.stream\(\{/);
  assert.doesNotMatch(source, /client\.chat\.completions\.create\(\s*\{[^}]*stream:\s*true/s);

  // ReAct 多轮必须复用首轮定下的连接：换模型会让上一轮 tool_call 的上下文对不上
  assert.match(source, /targets:\s*pinnedTarget\s*\?\s*\[pinnedTarget\]\s*:\s*streamTargets/);
  assert.match(source, /onTargetSettled:\s*\(target\)\s*=>\s*\{[\s\S]{0,600}?pinnedTarget = target;/);

  // 自动态下路由改道要把实际模型告知前端（气泡徽标如实），且只在首次钉定时发一次
  assert.match(source, /type:\s*'modelSwitched',\s*from:\s*model,\s*to:\s*target\.model,\s*reason:\s*'route'/);

  // 需要视觉能力、或用户显式选了模型（用户意志优先于路由）时不参与跨模型路由
  assert.match(source, /needsVisionModel\s*\|\|\s*explicitModelChoice\s*\n?\s*\?\s*\{\s*targets:\s*\[chatFallbackTarget\]/);
  assert.match(source, /explicitModelChoice = Boolean\(dto\.model\?\.trim\(\)\)/);

  // 上游拒绝 tools 由网关在同一连接上摘掉重试，并回调让后续轮次不再挂载
  assert.match(source, /retryWithoutTools:\s*true/);
  assert.match(source, /onToolsDropped:\s*\(\)\s*=>/);
});
