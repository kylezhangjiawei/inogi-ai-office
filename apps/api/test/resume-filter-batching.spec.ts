import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiScreeningService, CandidateFilterExecution, CandidateFilterCompletion } from '../src/modules/resume-screening/openai-screening.service';
import type { AiGatewayChatRequest } from '../src/modules/ai-gateway/ai-gateway.types';

const instruction = '海外品牌与内容营销经理，如果没有美国经验、没有医疗背景，一律低分';
const criteria = ['仅调整海外品牌与内容营销经理岗位；美国经验和医疗背景缺一项即低于40分。'];
const jobContext = { scope: 'all_jobs', job_rules: [
  { id: 'job-a', name: '海外品牌与内容营销经理', jd_text: '美国医疗行业品牌营销' },
  { id: 'job-b', name: '机械设计师', jd_text: '机械设计经验' },
] };

function candidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    candidate_id: `candidate-${String(index).padStart(3, '0')}`,
    name: '匿名候选人',
    job_rule_id: Math.floor(index / 8) % 2 ? 'job-b' : 'job-a',
    current_score: 60,
    current_decision: 'hold',
    current_summary: '既往筛选摘要。'.repeat(80),
    resume_excerpt: '美国市场医疗品牌营销经验。'.repeat(80),
  }));
}

type Payload = { phase?: string; candidates: ReturnType<typeof candidates>; criteria?: string[]; job_context: typeof jobContext };
type Update = { candidate_id: string; score: number; decision: string; next_step: boolean; summary: string; change_reason: string };

function fixture(options: {
  analysis?: Record<string, unknown>;
  score?: (payload: Payload, number: number, updates: Update[]) => unknown | Promise<unknown>;
} = {}) {
  const calls: Array<{ request: AiGatewayChatRequest; payload: Payload }> = [];
  let scoreCalls = 0;
  let active = 0;
  let peakActive = 0;
  const gateway = {
    resolveTargets: async (_scene: string, targets: unknown[]) => ({ targets, timeoutMs: 60_000, source: 'fallback' }),
    complete: async (request: AiGatewayChatRequest) => {
      const payload = JSON.parse(String(request.messages[1].content)) as Payload;
      calls.push({ request, payload });
      let output: unknown;
      if (payload.phase === 'analyze') {
        output = { action: 'filter', answer: '按统一条件评分。', filter_summary: '美国医疗营销背景', criteria, global_selection: null, ...options.analysis };
      } else {
        // Reproduce the oversized scoring request that exhausted the 60-second upstream budget.
        if (payload.candidates.length > 8) throw new Error('Request timed out.');
        const number = ++scoreCalls;
        active += 1;
        peakActive = Math.max(peakActive, active);
        try {
          await setImmediate();
          const updates = payload.candidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            score: 50 + Number(candidate.candidate_id.slice(-3)) % 50,
            decision: 'recommend', next_step: true,
            summary: '已核对背景', change_reason: '依据本轮规则',
          }));
          output = options.score ? await options.score(payload, number, updates) : { action: 'filter', candidate_updates: updates.reverse() };
        } finally { active -= 1; }
      }
      return {
        requestId: `request-${calls.length}`, scene: request.scene,
        content: JSON.stringify(output), model: 'qwen3.8-max-preview', provider: 'Qwen',
        usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      };
    },
  };
  const service = new OpenAiScreeningService(new ConfigService({ OPENAI_TIMEOUT_MS: 60_000 }), gateway as never);
  const run = (count = 80, execution: CandidateFilterExecution = {}) => service.iterateCandidateFilter(
    jobContext, candidates(count), instruction, [], 'test-key', 'qwen3.8-max-preview', 'https://example.com/v1', 'Qwen', execution,
  );
  return { run, calls, peak: () => peakActive, active: () => active };
}

test('80人先分析共同条件再分10批评分，保持60秒预算且完整聚合实际用量', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(f.calls.length, 11);
  assert.equal(f.calls[0].payload.phase, 'analyze');
  assert.equal(f.calls[0].request.maxTokens, 1600);
  assert.equal(f.calls[0].payload.candidates.length, 0, '意图分析不随候选人数增长而输入更多简历');
  assert.equal((f.calls[0].payload.job_context as unknown as { total_count: number }).total_count, 80);
  const scoring = f.calls.slice(1);
  assert.ok(scoring.every(({ payload, request }) => payload.phase === 'score' && payload.candidates.length === 8 && request.maxTokens === 6000));
  assert.ok(f.calls.every(({ request }) => request.timeoutMs === 60_000));
  assert.equal(f.peak(), 2);
  assert.equal(f.active(), 0);
  for (const { payload } of scoring) {
    assert.deepEqual(payload.criteria, criteria);
    assert.ok(payload.candidates.every((candidate) => candidate.resume_excerpt.length > 500));
    assert.deepEqual(payload.job_context.job_rules.map((job) => job.id), [payload.candidates[0].job_rule_id]);
  }
  assert.deepEqual(result.result.candidate_updates.map((item) => item.candidate_id), candidates(80).map((item) => item.candidate_id));
  assert.equal(result.result.action, 'filter');
  assert.equal(result.modelName, 'qwen3.8-max-preview');
  assert.deepEqual(result.usage, { inputTokens: 77, outputTokens: 33, totalTokens: 110 });
});

test('条件不清楚只返回澄清问题，不发起候选人评分', async () => {
  const f = fixture({ analysis: { action: 'clarify', answer: '美国经验是必须条件吗？', criteria: [] } });
  const result = await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(result.result.action, 'clarify');
  assert.equal(result.result.answer, '美国经验是必须条件吗？');
  assert.deepEqual(result.result.candidate_updates, []);
});

test('后续批次超时会等待当前并发结束并停止后续评分，不返回部分成功', async () => {
  const failure = new ServiceUnavailableException({ message: 'AI 服务暂时不可用', request_id: 'timeout-request', error_code: 'UPSTREAM_ERROR' });
  const f = fixture({ score: async (_payload, number, updates) => {
    if (number === 3) throw failure;
    await setImmediate();
    return { action: 'filter', candidate_updates: updates };
  } });
  await assert.rejects(f.run(), (error) => error === failure);
  assert.equal(f.calls.length, 5, '只执行分析和前两波，不继续后面的批次');
  assert.equal(f.active(), 0, '失败任务结束前已耗尽当前并发');
});

test('批次必须返回每个候选人恰好一次以及有效的分数和结论', async (t) => {
  const invalid: Array<[string, (updates: Update[]) => unknown]> = [
    ['漏掉候选人', (rows) => rows.slice(1)],
    ['重复候选人', (rows) => [...rows, rows[0]]],
    ['其他批次候选人', (rows) => [{ ...rows[0], candidate_id: 'other-candidate' }, ...rows.slice(1)]],
    ['字符串分数', (rows) => [{ ...rows[0], score: '30' }, ...rows.slice(1)]],
    ['小数分数', (rows) => [{ ...rows[0], score: 30.5 }, ...rows.slice(1)]],
    ['分数越界', (rows) => [{ ...rows[0], score: 101 }, ...rows.slice(1)]],
    ['非法结论', (rows) => [{ ...rows[0], decision: 'unknown' }, ...rows.slice(1)]],
    ['数组结论', (rows) => [{ ...rows[0], decision: ['reject'] }, ...rows.slice(1)]],
  ];
  for (const [name, mutate] of invalid) await t.test(name, async () => {
    const f = fixture({ score: (_payload, _number, rows) => ({ action: 'filter', candidate_updates: mutate(rows) }) });
    await assert.rejects(f.run(8), /AI/);
  });
});

test('全池名额在收齐所有批次评分后统一分配，不能每批各留前三', async () => {
  const f = fixture({ analysis: { global_selection: { top_n: 3 } } });
  const result = await f.run(20);
  assert.deepEqual(result.result.candidate_updates.filter((item) => item.decision === 'recommend').map((item) => item.candidate_id), ['candidate-017', 'candidate-018', 'candidate-019']);
  const excluded = result.result.candidate_updates.filter((item) => item.decision === 'reject');
  assert.equal(excluded.length, 17);
  assert.ok(excluded.every((item) => item.next_step === false && typeof item.change_reason === 'string' && item.change_reason.length > '依据本轮规则'.length));
});

test('指定岗位名额不影响其他岗位，且不会复活已有拒绝结果', async () => {
  const f = fixture({
    analysis: { global_selection: { top_n: 2, job_rule_id: 'job-a' } },
    score: (_payload, _number, updates) => ({ action: 'filter', candidate_updates: updates.map((row) => row.candidate_id === 'candidate-019' ? { ...row, decision: 'reject', next_step: false } : row) }),
  });
  const result = await f.run(20);
  const recommend = result.result.candidate_updates.filter((item) => item.decision === 'recommend').map((item) => item.candidate_id);
  assert.deepEqual(recommend, [...candidates(20).slice(8, 16).map((item) => item.candidate_id), 'candidate-017', 'candidate-018']);
  assert.equal(result.result.candidate_updates[19].decision, 'reject');
});

test('统一名额遇到同分使用稳定候选人ID打破平局', async () => {
  const f = fixture({ analysis: { global_selection: { top_n: 2 } }, score: (_payload, _number, rows) => ({ action: 'filter', candidate_updates: rows.map((row) => ({ ...row, score: 80 })).reverse() }) });
  const result = await f.run(20);
  assert.deepEqual(result.result.candidate_updates.filter((item) => item.decision === 'recommend').map((item) => item.candidate_id), ['candidate-000', 'candidate-001']);
});

test('名额大于当前候选人数时全部保留，不随意拒绝候选人', async () => {
  const f = fixture({ analysis: { global_selection: { top_n: 100 } } });
  const result = await f.run(9);
  assert.equal(result.result.candidate_updates.length, 9);
  assert.ok(result.result.candidate_updates.every((item) => item.decision === 'recommend'));
});

test('无效分析结果和越界名额在评分前拒绝', async (t) => {
  const invalid = [
    { action: 'unknown' }, { criteria: [] },
    { global_selection: [] }, { global_selection: { top_n: '3' } },
    { global_selection: { top_n: -1 } }, { global_selection: { top_n: 0 } },
    { global_selection: { top_n: 1.5 } }, { global_selection: { top_n: 10001 } },
    { global_selection: { top_n: 2, job_rule_id: 'unknown-job' } },
  ];
  for (const analysis of invalid) await t.test(JSON.stringify(analysis), async () => {
    const f = fixture({ analysis });
    await assert.rejects(f.run(9), /AI/);
    assert.equal(f.calls.length, 1);
  });
});

test('无法化为绝对规则或单个名额的相对条件先澄清，不能按批次误算', async () => {
  const f = fixture({ analysis: { action: 'clarify', answer: '请指定明确分数线或全池保留人数。', criteria: [], global_selection: null } });
  const result = await f.run(20);
  assert.equal(result.result.action, 'clarify');
  assert.equal(f.calls.length, 1);
  assert.equal(result.result.candidate_updates.length, 0);
});

test('500人分63批，分析输入大小与人数基本无关', async () => {
  const small = fixture(); await small.run(8);
  const large = fixture(); const result = await large.run(500);
  assert.equal(result.result.candidate_updates.length, 500);
  assert.equal(large.calls.length, 64);
  assert.equal(large.peak(), 2);
  const size = (f: ReturnType<typeof fixture>) => JSON.stringify(f.calls[0].payload).length;
  assert.ok(size(large) - size(small) < 100, '不得把几百人摘要重新塞入意图分析');
  assert.ok(large.calls.slice(1).every(({ payload }) => payload.candidates.length <= 8));
});

test('500人中途失败后复用分析与已完成批次，仅请求未完成候选人', async () => {
  let analysis: CandidateFilterCompletion | undefined;
  const batches: Record<number, CandidateFilterCompletion> = {};
  let processed = 0;
  const hooks: CandidateFilterExecution = {
    onAnalysis: async (completion) => { analysis = structuredClone(completion); },
    onBatch: async (index, completion, count) => { assert.equal(batches[index], undefined); batches[index] = structuredClone(completion); processed += count; },
  };
  const interrupted = fixture({ score: (_payload, number, updates) => {
    if (number === 3) throw new Error('Request timed out.');
    return { action: 'filter', candidate_updates: updates };
  } });
  await assert.rejects(interrupted.run(500, hooks), /timed out/);
  assert.equal(processed, 24);
  const completedIds = new Set(Object.values(batches).flatMap((batch) => JSON.parse(batch.content).candidate_updates.map((item: Update) => item.candidate_id)));
  const resumed = fixture();
  const result = await resumed.run(500, { ...hooks, analysis, batches });
  assert.equal(processed, 500);
  assert.equal(result.result.candidate_updates.length, 500);
  assert.equal(new Set(result.result.candidate_updates.map((item) => item.candidate_id)).size, 500);
  assert.equal(resumed.calls.length, 60, '已有3批及条件分析不重复调用');
  assert.ok(resumed.calls.every(({ payload }) => payload.phase === 'score' && payload.candidates.every((candidate) => !completedIds.has(candidate.candidate_id))));
  assert.deepEqual(result.usage, { inputTokens: 448, outputTokens: 192, totalTokens: 640 });
});

test('执行权丢失时终止下一批调用，不能继续消耗模型额度', async () => {
  const abort = new AbortController();
  const f = fixture();
  await assert.rejects(f.run(500, { signal: abort.signal, onAnalysis: async () => { abort.abort(new Error('lease lost')); } }), /lease lost/);
  assert.equal(f.calls.length, 1);
});
