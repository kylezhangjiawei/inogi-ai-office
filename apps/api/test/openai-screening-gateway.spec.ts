import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ConfigService } from '@nestjs/config';

import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { AiGatewayService } from '../src/modules/ai-gateway/ai-gateway.service';
import { OpenAiCompatibleAdapter } from '../src/modules/ai-gateway/openai-compatible.adapter';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';
import type { CandidateFilterExecution } from '../src/modules/resume-screening/openai-screening.service';

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

type WirePayload = { phase: string; candidates: Array<{ candidate_id: string }> };
type WireRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string; json_schema?: {
    name: string; strict: boolean; schema: {
      required: string[];
      properties: { action: { enum: string[] }; candidate_updates: {
        minItems: number; maxItems: number; items: { properties: { candidate_id: { enum: string[] } } };
      } };
    };
  } };
  max_tokens?: number;
};
type WireReply = { content?: string; status?: number; error?: string; hang?: boolean };

function wireCandidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    candidate_id: `anonymous-${index}`, job_rule_id: 'wire-job', name: '匿名测试候选人',
    current_score: 60, current_decision: 'hold', current_summary: '既有匿名测试记录',
    resume_excerpt: '具有美国医疗行业品牌营销工作经验。',
  }));
}

function validWireScores(payload: WirePayload) {
  return { action: 'filter', candidate_updates: payload.candidates.map(({ candidate_id }) => ({
    candidate_id, ai_job: '海外品牌经理', score: 80, decision: 'recommend', next_step: true,
    summary: '已核对匿名背景证据', change_reason: '符合本轮条件', tags: [], matched_points: [], risks: [],
  })) };
}

/** Real HTTP, OpenAI SDK, adapter and gateway; only the remote model and Prisma are fixtures. */
async function wireFixture(
  reply: (body: WireRequest, payload: WirePayload, scoreCall: number) => WireReply,
  timeoutMs = 5_000,
) {
  const calls: Array<{ body: WireRequest; payload: WirePayload; url: string | undefined }> = [];
  const telemetry: Array<Record<string, any>> = [];
  const serverErrors: unknown[] = [];
  let scoreCalls = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireRequest;
      const payload = JSON.parse(body.messages[1].content) as WirePayload;
      calls.push({ body, payload, url: request.url });
      const result = payload.phase === 'analyze'
        ? { content: JSON.stringify({ action: 'filter', answer: '按同一条件评分', filter_summary: '美国医疗行业背景',
          criteria: ['依据美国医疗行业工作经验证据评分'], global_selection: null }) }
        : reply(body, payload, ++scoreCalls);
      if (result.hang) return;
      response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.status && result.status >= 400
        ? { error: { message: result.error, type: 'invalid_request_error' } }
        : { id: `wire-${calls.length}`, object: 'chat.completion', model: 'qwen-wire-fixture',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: result.content ?? '' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }));
    } catch (error) {
      serverErrors.push(error);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Local fixture failed' } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const config = new ConfigService({ OPENAI_TIMEOUT_MS: timeoutMs, AI_GATEWAY_MAX_RETRIES_PER_TARGET: 0 });
  const prisma = {
    aiGatewayRoute: { findUnique: async () => null },
    aiGatewayRequest: { create: async ({ data }: { data: Record<string, unknown> }) => { telemetry.push(data); return {}; } },
  };
  const gateway = new AiGatewayService(new OpenAiCompatibleAdapter(config), config, prisma as never,
    { decryptFromStorage: (value: string) => value } as never);
  const service = new OpenAiScreeningService(config, gateway);
  return {
    calls, telemetry, serverErrors,
    run: (count = 8, execution: CandidateFilterExecution = {}) => service.iterateCandidateFilter(
      { scope: 'all_jobs', job_rules: [{ id: 'wire-job', name: '海外品牌经理', jd_text: '美国医疗行业品牌营销' }] },
      wireCandidates(count), '美国医疗行业背景不足的候选人低分', [],
      'anonymous-local-test-key', 'qwen-wire-fixture', baseUrl, 'Qwen', execution,
    ),
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test('真实HTTP：旧模型仅报告json_schema不支持时回退，并仍校验完整评分', async () => {
  const fixture = await wireFixture((body, payload) => body.response_format
    ? { status: 400, error: 'json_schema is not supported' }
    : { content: JSON.stringify(validWireScores(payload)) });
  try {
    const result = await fixture.run();
    assert.equal(result.result.candidate_updates.length, 8);
    const scoring = fixture.calls.filter(({ payload }) => payload.phase === 'score');
    assert.equal(scoring.length, 2);
    assert.equal(scoring[0].body.response_format?.type, 'json_schema');
    assert.equal(scoring[1].body.response_format, undefined);
    assert.ok(scoring[1].body.messages[0].content.includes('candidate_updates'), '删参回退仍携带完整评分协议');
    assert.deepEqual(fixture.serverErrors, []);
  } finally { await fixture.close(); }
});

test('真实HTTP：分析与评分协议分开，101人中错误澄清仅重做该批并完整完成', async () => {
  const fixture = await wireFixture((_body, payload, scoreCall) => ({ content: JSON.stringify(scoreCall === 1
    ? { action: 'clarify', answer: '请说明评分条件', candidate_updates: [] }
    : validWireScores(payload)) }));
  const checkpoints = new Map<number, number>();
  try {
    const result = await fixture.run(101, { onBatch: async (index, completion, count) => {
      assert.equal(checkpoints.has(index), false, '每个合格批次只写一次检查点');
      const scores = JSON.parse(completion.content);
      assert.equal(scores.action, 'filter', '错误澄清不得保存成有效评分');
      assert.equal(scores.candidate_updates.length, count);
      checkpoints.set(index, count);
    } });
    assert.deepEqual(result.result.candidate_updates.map((item) => item.candidate_id),
      wireCandidates(101).map((item) => item.candidate_id));
    assert.equal(checkpoints.size, 13);
    assert.equal([...checkpoints.values()].reduce((total, count) => total + count, 0), 101);
    const analysis = fixture.calls.filter(({ payload }) => payload.phase === 'analyze');
    const scoring = fixture.calls.filter(({ payload }) => payload.phase === 'score');
    assert.equal(analysis.length, 1);
    assert.deepEqual(analysis[0].body.response_format, { type: 'json_object' });
    assert.equal(scoring.length, 14, '13个原始批次，加一次出错批次纠正');
    assert.ok(fixture.calls.every(({ url }) => url === '/v1/chat/completions'));
    for (const { body, payload } of scoring) {
      assert.equal(body.response_format?.type, 'json_schema');
      const schema = body.response_format!.json_schema!;
      assert.equal(schema.strict, true);
      assert.deepEqual(schema.schema.properties.action.enum, ['filter']);
      assert.deepEqual(schema.schema.required, ['action', 'candidate_updates']);
      const updates = schema.schema.properties.candidate_updates;
      assert.equal(updates.minItems, payload.candidates.length);
      assert.equal(updates.maxItems, payload.candidates.length);
      assert.deepEqual(updates.items.properties.candidate_id.enum, payload.candidates.map((item) => item.candidate_id));
      assert.equal(body.max_tokens, 6000);
    }
    const firstBatch = scoring.filter(({ payload }) => payload.candidates[0].candidate_id === 'anonymous-0');
    assert.equal(firstBatch.length, 2);
    assert.deepEqual(firstBatch[0].body.response_format, firstBatch[1].body.response_format);
    assert.deepEqual(firstBatch[0].payload, firstBatch[1].payload, '纠正时保持原始证据与统一条件');
    assert.match(firstBatch[1].body.messages[0].content, /INVALID_ACTION/);
    assert.equal(fixture.telemetry.length, 15, '包括格式错误的HTTP成功响应，真实调用均有调用记录');
    assert.equal(new Set(fixture.telemetry.map((item) => item.id)).size, 15);
    assert.deepEqual(result.usage, { inputTokens: 105, outputTokens: 45, totalTokens: 150 });
    assert.deepEqual(fixture.serverErrors, []);
  } finally { await fixture.close(); }
});

test('真实HTTP：旧模型删去response_format后仍必须通过评分校验，连续无效结果不保存', async () => {
  const fixture = await wireFixture((body) => body.response_format
    ? { status: 400, error: 'json_schema is not supported' }
    : { content: JSON.stringify({ action: 'clarify', candidate_updates: [] }) });
  let checkpoints = 0;
  try {
    await assert.rejects(fixture.run(8, { onBatch: async () => { checkpoints += 1; } }), (error: any) => {
      assert.equal(error.getStatus(), 503);
      assert.equal(error.getResponse().error_code, 'INVALID_BATCH_OUTPUT');
      assert.match(error.getResponse().message, /连续 3 次/);
      assert.equal(error.getResponse().request_id, fixture.telemetry.at(-1)?.id);
      return true;
    });
    const scoring = fixture.calls.filter(({ payload }) => payload.phase === 'score');
    assert.equal(scoring.length, 6, '最多三次评分调用，各带一次明确的不支持格式回退');
    assert.equal(scoring.filter(({ body }) => body.response_format?.type === 'json_schema').length, 3);
    assert.equal(scoring.filter(({ body }) => body.response_format === undefined).length, 3);
    assert.equal(checkpoints, 0);
    assert.deepEqual(fixture.serverErrors, []);
  } finally { await fixture.close(); }
});

test('真实HTTP：非格式400、403、超时和空content保持网关失败，不进入业务格式重试', async (t) => {
  const failures: Array<{ name: string; reply: WireReply; errorCode: string; timeoutMs?: number }> = [
    { name: '非格式400', reply: { status: 400, error: 'context length exceeded' }, errorCode: 'HTTP_400' },
    { name: '403', reply: { status: 403, error: 'Access denied' }, errorCode: 'HTTP_403' },
    { name: '请求超时', reply: { hang: true }, errorCode: 'UPSTREAM_ERROR', timeoutMs: 250 },
    { name: 'HTTP200空content', reply: { content: '' }, errorCode: 'EMPTY_RESPONSE' },
  ];
  for (const failure of failures) await t.test(failure.name, async () => {
    const fixture = await wireFixture(() => failure.reply, failure.timeoutMs);
    let checkpoints = 0;
    try {
      await assert.rejects(fixture.run(8, { onBatch: async () => { checkpoints += 1; } }), (error: any) => {
        assert.equal(error.getStatus(), 503);
        assert.equal(error.getResponse().error_code, failure.errorCode);
        assert.equal(error.getResponse().request_id, fixture.telemetry.at(-1)?.id);
        return true;
      });
      assert.equal(fixture.calls.filter(({ payload }) => payload.phase === 'score').length, 1,
        'SDK与业务层都不能把网关失败乘成三次格式纠正');
      assert.equal(checkpoints, 0);
      assert.equal(fixture.telemetry.at(-1)?.status, 'failed');
      assert.deepEqual(fixture.serverErrors, []);
    } finally { await fixture.close(); }
  });
});
