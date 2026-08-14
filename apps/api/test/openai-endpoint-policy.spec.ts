import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';

import {
  isAliyunOpenAiEndpoint,
  usesDeepSeekChatCompletions,
} from '../src/modules/ai-gateway/openai-endpoint-policy';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';

test('Alibaba Cloud OpenAI-compatible endpoints bypass the overseas proxy regardless of model brand', () => {
  assert.equal(
    isAliyunOpenAiEndpoint('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
    true,
  );
  assert.equal(
    isAliyunOpenAiEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    true,
  );
  assert.equal(isAliyunOpenAiEndpoint('https://api.openai.com/v1'), false);
  assert.equal(isAliyunOpenAiEndpoint('not-a-url'), false);
});

test('DeepSeek OpenAI-compatible models use Chat Completions', () => {
  assert.equal(usesDeepSeekChatCompletions('DeepSeek', 'deepseek-v4-pro'), true);
  assert.equal(usesDeepSeekChatCompletions('Custom', 'deepseek-v4-flash'), true);
  assert.equal(usesDeepSeekChatCompletions('OpenAI', 'gpt-5.5'), false);
});

test('DeepSeek connection test calls chat completions instead of responses', async () => {
  let chatCalls = 0;
  let responseCalls = 0;
  const fakeClient = {
    chat: {
      completions: {
        create: async () => {
          chatCalls += 1;
          return {
            choices: [{ message: { content: 'OK' } }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          };
        },
      },
    },
    responses: {
      create: async () => {
        responseCalls += 1;
        return { output_text: 'OK', usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } };
      },
    },
  };
  const service = new OpenAiScreeningService(
    new ConfigService({ OPENAI_TIMEOUT_MS: 120_000 }),
    {} as never,
  );
  const internal = service as unknown as {
    createClient: () => typeof fakeClient;
  };
  internal.createClient = () => fakeClient;

  const result = await service.testConnection(
    'test-key',
    'deepseek-v4-pro',
    'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    'DeepSeek',
  );

  assert.equal(chatCalls, 1);
  assert.equal(responseCalls, 0);
  assert.equal(result.outputText, 'OK');
  assert.equal(result.usage.totalTokens, 5);
});
