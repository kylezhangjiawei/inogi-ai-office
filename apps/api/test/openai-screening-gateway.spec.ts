import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';

import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';

test('岗位规则提取通过简历筛选场景路由，并返回实际命中的模型', async () => {
  const fallbackTargets: AiGatewayTarget[][] = [];
  const calls: AiGatewayChatRequest[] = [];
  const routedTarget: AiGatewayTarget = {
    id: 'hr-route',
    connectionId: 'hr-route',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const gateway = {
    resolveTargets: async (scene: string, fallback: AiGatewayTarget[]) => {
      assert.equal(scene, 'hr.resume_screening');
      fallbackTargets.push(fallback);
      return { targets: [routedTarget], timeoutMs: 45_000, source: 'route' as const };
    },
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      return {
        requestId: 'request-1',
        scene: request.scene,
        content: JSON.stringify({ name: '后端工程师', jd_text: '负责企业应用研发' }),
        provider: 'DeepSeek',
        model: 'deepseek-chat',
        latencyMs: 120,
        attemptCount: 1,
        fallbackUsed: false,
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        attempts: [],
      };
    },
  };
  const config = new ConfigService({ OPENAI_TIMEOUT_MS: 120_000 });
  const service = new OpenAiScreeningService(config, gateway as never);

  const result = await service.extractJobRuleDraft(
    '招聘后端工程师，负责企业应用研发',
    'fallback-key',
    'qwen-plus',
    'https://example.com/v1',
    'Qwen',
  );

  assert.equal(fallbackTargets.length, 1);
  assert.deepEqual(fallbackTargets[0], [{
    provider: 'Qwen',
    model: 'qwen-plus',
    apiKey: 'fallback-key',
    baseUrl: 'https://example.com/v1',
  }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.scene, 'hr.resume_screening');
  assert.equal(calls[0]?.timeoutMs, 45_000);
  assert.deepEqual(calls[0]?.responseFormat, { type: 'json_object' });
  assert.equal(calls[0]?.retryWithoutResponseFormat, true);
  assert.equal(result.modelName, 'deepseek-chat');
  assert.equal(result.result.name, '后端工程师');
  assert.equal(result.usage.totalTokens, 30);
});
