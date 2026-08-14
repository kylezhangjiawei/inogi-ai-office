import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigService } from '@nestjs/config';

import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { RdAiService } from '../src/modules/research-development/rd-ai.service';

test('研发日报与绩效分析使用独立网关场景，并回传实际命中模型', async () => {
  const resolvedScenes: Array<{ scene: string; fallback: AiGatewayTarget[] }> = [];
  const calls: AiGatewayChatRequest[] = [];
  const routedTarget: AiGatewayTarget = {
    id: 'rd-route',
    connectionId: 'rd-route',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const legacyConnection = {
    id: 'legacy-model',
    name: 'Legacy Qwen',
    provider: 'Qwen',
    model: 'qwen-plus',
    encryptedSecret: 'encrypted-key',
    metadata: { base_url: 'https://example.com/v1', is_default_enabled: true },
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
  };
  const prisma = {
    systemSetting: { findUnique: async () => ({ value: { scenes: [] } }) },
    integrationConfig: { findMany: async () => [legacyConnection] },
  };
  const gateway = {
    resolveTargets: async (scene: string, fallback: AiGatewayTarget[]) => {
      resolvedScenes.push({ scene, fallback });
      return { targets: [routedTarget], timeoutMs: 45_000, source: 'route' as const };
    },
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      return {
        requestId: `request-${calls.length}`,
        scene: request.scene,
        content: request.scene === 'rd.reporting' ? '研发日报正文' : '绩效评价正文',
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
  const service = new RdAiService(
    new ConfigService({ OPENAI_TIMEOUT_MS: 120_000 }),
    prisma as never,
    {} as never,
    { decryptFromStorage: () => 'legacy-key' } as never,
    gateway as never,
  );

  const daily = await service.summarizeDailyReport({
    userName: '张三',
    date: '2026-08-13',
    stats: { totalTasks: 0, inProgress: 0, completed: 0, blocked: 0, pending: 0, notesCount: 0 },
    tasks: [],
  });
  const performance = await service.assessPerformance({
    userName: '张三',
    monthLabel: '2026-08',
    score: 88,
    grade: 'A',
    metrics: {
      total_tasks: 0,
      owner_tasks: 0,
      collab_tasks: 0,
      completed: 0,
      in_progress: 0,
      blocked: 0,
      stalled: 0,
      pending: 0,
      notes_count: 0,
      attachments_count: 0,
      overdue_tasks: 0,
      completion_rate: 0,
    },
    tasks: [],
  });

  assert.deepEqual(resolvedScenes.map((item) => item.scene), ['rd.reporting', 'rd.performance_review']);
  assert.equal(resolvedScenes[0]?.fallback[0]?.connectionId, 'legacy-model');
  assert.deepEqual(calls.map((call) => call.scene), ['rd.reporting', 'rd.performance_review']);
  assert.deepEqual(calls.map((call) => call.timeoutMs), [45_000, 45_000]);
  assert.deepEqual(daily, { text: '研发日报正文', model: 'deepseek-chat', provider: 'openai' });
  assert.deepEqual(performance, { text: '绩效评价正文', model: 'deepseek-chat', provider: 'openai' });
});

test('文本任务提取及空结果修复复用项目结构化网关路由', async () => {
  const calls: AiGatewayChatRequest[] = [];
  const routedTarget: AiGatewayTarget = {
    id: 'structured-route',
    connectionId: 'structured-route',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const prisma = {
    systemSetting: {
      findUnique: async () => ({ value: [] }),
      upsert: async () => ({}),
    },
    integrationConfig: { findMany: async () => [] },
  };
  const gateway = {
    resolveTargets: async (scene: string) => {
      assert.equal(scene, 'rd.project_structuring');
      return { targets: [routedTarget], timeoutMs: 300_000, source: 'route' as const };
    },
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      return {
        requestId: `extract-${calls.length}`,
        scene: request.scene,
        content: calls.length === 1
          ? '{"tasks":[],"summary":"empty"}'
          : '{"tasks":[{"title":"完成阀组验证","owner":"待指派","due_date":"2026-08-15","priority":"high","category_path":"310阀系统 / 310阀组 / 测试验证","estimated_days":2,"owner_reason":"待分配"}],"summary":"已修复"}',
        provider: 'DeepSeek',
        model: 'deepseek-chat',
        latencyMs: 100,
        attemptCount: 1,
        fallbackUsed: false,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        attempts: [],
      };
    },
  };
  const service = new RdAiService(
    new ConfigService({ OPENAI_TIMEOUT_MS: 120_000 }),
    prisma as never,
    {} as never,
    { decryptFromStorage: () => '' } as never,
    gateway as never,
  );

  const result = await service.extract({ text: '请在 8 月 15 日前完成阀组验证。' });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.scene), ['rd.project_structuring', 'rd.project_structuring']);
  assert.deepEqual(calls.map((call) => call.targets), [[routedTarget], [routedTarget]]);
  assert.deepEqual(calls.map((call) => call.timeoutMs), [300_000, 300_000]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0]?.title, '完成阀组验证');
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'deepseek-chat');
});
