import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';
import type { AiGatewayChatRequest } from '../src/modules/ai-gateway/ai-gateway.types';

const rawUrl = process.env.CANDIDATE_FILTER_TEST_DATABASE_URL;
type ScoreRow = { candidate_id: string; score: number; decision: string; next_step: boolean; summary: string; change_reason: string };
type ScoreCall = { ids: string[]; batch: number; attempt: number };
type ScoreBehavior = (call: ScoreCall, rows: ScoreRow[]) => unknown;
const valid = (rows: ScoreRow[]) => ({ action: 'filter', candidate_updates: rows });

async function fixture(t: TestContext, count: number) {
  const url = new URL(rawUrl!);
  // Never inherit DATABASE_URL or create/drop tables outside this dedicated local test DB.
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55439');
  assert.equal(url.pathname, '/resume_filter_test');
  assert.equal(url.searchParams.has('host'), false);
  const schema = `candidate_filter_format_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '6');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const otherDb = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const services: ResumeScreeningService[] = [];
  let schemaCreated = false;
  t.after(async () => {
    for (const service of services) service.onModuleDestroy();
    for (let i = 0; i < 200 && services.some((service) => (service as any).filterWorkers.size); i += 1) await delay(10);
    try { if (schemaCreated) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await Promise.all([db.$disconnect(), otherDb.$disconnect()]); }
  });
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const migration = await readFile(`${__dirname}/../prisma/migrations/20260910120000_candidate_filter_durable_tasks/migration.sql`, 'utf8');
  for (const sql of migration.split(';').map((part) => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(sql);
  await db.$executeRawUnsafe('CREATE TABLE "PublishedCandidate" ("candidateId" TEXT NOT NULL, "version" TEXT NOT NULL, "payload" JSONB NOT NULL, PRIMARY KEY ("candidateId", "version"))');

  const jobRule = { id: 'job-format', name: '测试岗位', jdText: '美国医疗市场经验。' };
  const candidates = Array.from({ length: count }, (_, i) => ({
    id: `candidate-${String(i).padStart(3, '0')}`, jobRuleId: jobRule.id, jobRule, screenings: [],
    name: '匿名候选人', rawEmailText: '美国医疗市场经验。', uniqueKey: `format-test-${i}`,
    sourceSubject: '应聘', parsedCandidateProfile: {},
  }));
  const state = {
    analysisCalls: 0, active: 0, peak: 0, publicationChunks: 0,
    calls: [] as ScoreCall[], requests: [] as AiGatewayChatRequest[],
    attempts: new Map<number, number>(),
    score: ((_call, rows) => valid(rows)) as ScoreBehavior,
  };
  const gateway = {
    resolveTargets: async (_scene: string, targets: unknown[]) => ({ targets, timeoutMs: 60_000, source: 'fallback' }),
    complete: async (request: AiGatewayChatRequest) => {
      request.signal?.throwIfAborted();
      state.requests.push(request);
      const input = JSON.parse(String(request.messages[1].content));
      let output: unknown;
      if (input.phase === 'analyze') {
        state.analysisCalls += 1;
        assert.equal(input.candidates.length, 0);
        assert.equal(input.job_context.total_count, count);
        output = { action: 'filter', answer: '按统一规则筛选。', filter_summary: '美国医疗市场经验', criteria: ['美国医疗市场经验优先'], global_selection: null };
      } else {
        const ids = input.candidates.map((candidate: any) => candidate.candidate_id) as string[];
        const batch = Math.floor(Number(ids[0].slice(-3)) / 8);
        const attempt = (state.attempts.get(batch) ?? 0) + 1;
        state.attempts.set(batch, attempt);
        const call = { ids, batch, attempt };
        state.calls.push(call);
        assert.deepEqual(ids, candidates.slice(batch * 8, batch * 8 + 8).map((candidate) => candidate.id), '纠正必须重用同一个候选人组');
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        try {
          await delay(2);
          request.signal?.throwIfAborted();
          output = state.score(call, ids.map((id) => ({ candidate_id: id, score: 85, decision: 'recommend', next_step: true, summary: '符合要求。', change_reason: '按统一规则核对。' })));
        } finally { state.active -= 1; }
      }
      return { requestId: `synthetic-format-${state.requests.length}`, scene: request.scene, content: JSON.stringify(output), model: 'synthetic-model', provider: 'synthetic', usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } };
    },
  };
  // The real worker, leases, checkpoints and publication transaction use PostgreSQL.
  // Only candidate/permission/config reads and the paid AI provider are synthetic.
  const wrap = (client: any): any => new Proxy(client, { get(target, name) {
    if (name === 'candidate') return { findMany: async () => candidates };
    if (name === 'jobRule') return { findUnique: async () => jobRule };
    if (name === 'integrationConfig') return { findMany: async () => [] };
    if (name === 'user') return { findUnique: async () => ({ status: 'ACTIVE', role: { permissions: ['resume:screen'] } }) };
    if (name === 'candidateScreening') return { createMany: async ({ data }: { data: Prisma.CandidateScreeningCreateManyInput[] }) => {
      await target.$executeRaw(Prisma.sql`INSERT INTO "PublishedCandidate" ("candidateId", "version", "payload") VALUES ${Prisma.join(data.map((row) => Prisma.sql`(${row.candidateId}, ${row.promptVersion}, ${JSON.stringify(row)}::jsonb)`))}`);
      state.publicationChunks += 1;
      return { count: data.length };
    } };
    if (name === '$transaction') return (run: any, options: any) => target.$transaction((tx: any) => run(wrap(tx)), options);
    const value = Reflect.get(target, name);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const makeService = (client = db) => {
    const ai = new OpenAiScreeningService(new ConfigService({ OPENAI_API_KEY: 'synthetic-key-not-for-persistence', OPENAI_TIMEOUT_MS: 60_000 }), gateway as never);
    const service = new ResumeScreeningService(wrap(client), {} as never, {} as never, {} as never,
      { extractCandidateProfile: () => ({}) } as never, ai, {} as never, { filterDisabled: async (codes: string[]) => codes } as never);
    services.push(service);
    return service;
  };
  const waitTerminal = async (service: ResumeScreeningService, id: string) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const task = await service.getCandidateFilterTask('format-user', id);
      if (['failed', 'completed'].includes(task.status) && !(service as any).filterWorkers.size) return task;
      await delay(10);
    }
    assert.fail(`worker did not settle: ${JSON.stringify(await service.getCandidateFilterTask('format-user', id))}`);
  };
  const submit = (service: ResumeScreeningService) => service.createCandidateFilterTask('format-user', { instruction: '优先美国医疗市场经验', job_rule_id: jobRule.id });
  const checkpoint = (id: string) => db.candidateFilterTask.findUniqueOrThrow({ where: { id }, include: { batches: { orderBy: { batchIndex: 'asc' } } } });
  const published = () => db.$queryRaw<Array<{ candidateId: string; version: string; payload: unknown }>>`SELECT * FROM "PublishedCandidate"`;
  const assertPublished = async (id: string) => {
    const rows = await published();
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map((row) => row.candidateId)).size, count);
    assert.ok(rows.every((row) => row.version === `iterative-filter:filter-${id}`));
    assert.equal(await db.candidateFilterTask.count(), 1);
    assert.equal(await db.candidateFilterTaskBatch.count(), 0);
    assert.equal((await checkpoint(id)).snapshotJson, null);
    assert.equal(state.peak, 2);
  };
  return { db, otherDb, state, makeService, waitTerminal, submit, checkpoint, published, assertPublished };
}

test('真实PG：101人已存8人旧检查点，后续批次格式错误自动纠正并完整发布', { skip: !rawUrl }, async (t) => {
  const f = await fixture(t, 101);
  f.state.score = (call, rows) => {
    if (call.batch === 1) throw new ServiceUnavailableException('synthetic initial interruption');
    return valid(rows);
  };
  const first = f.makeService();
  const task = await f.submit(first);
  const interrupted = await f.waitTerminal(first, task.task_id);
  assert.equal(interrupted.status, 'failed');
  assert.equal(interrupted.processed_count, 8);
  assert.equal(f.state.attempts.get(1), 1, '网关错误不应进入格式纠正循环');
  const oldCheckpoint = await f.checkpoint(task.task_id);
  assert.deepEqual(oldCheckpoint.batches.map((batch) => [batch.batchIndex, batch.candidateCount]), [[0, 8]]);
  assert.equal((await f.published()).length, 0);
  first.onModuleDestroy();

  const beforeRetry = f.state.calls.length;
  f.state.score = (call, rows) => call.batch === 1 && call.attempt === 2 ? { candidate_updates: rows } : valid(rows);
  const resumed = f.makeService(f.otherDb);
  await resumed.retryCandidateFilterTask('format-user', task.task_id);
  const completed = await f.waitTerminal(resumed, task.task_id);
  assert.equal(completed.status, 'completed', completed.error ?? undefined);
  assert.equal(completed.processed_count, 101);
  assert.equal(completed.result?.total_count, 101);
  assert.equal(f.state.analysisCalls, 1);
  assert.equal(f.state.attempts.get(0), 1, '旧成功检查点不能重算');
  assert.equal(f.state.attempts.get(1), 3, '中断1次、格式错误1次、纠正成功1次');
  assert.equal(f.state.calls.length - beforeRetry, 13, '剩余12批加一次格式纠正');
  assert.ok(f.state.calls.slice(beforeRetry).every((call) => call.batch !== 0));
  await f.assertPublished(task.task_id);
});

test('真实PG：500人多个批次偶发结构错误，纠正后只发布一个完整版本', { skip: !rawUrl }, async (t) => {
  const f = await fixture(t, 500);
  const malformed = new Map<number, (rows: ScoreRow[]) => unknown>([
    [0, (rows) => ({ candidate_updates: rows })],
    [3, () => ({ action: 'clarify', candidate_updates: [] })],
    [9, (rows) => ({ action: 'filter', candidate_updates: { rows } })],
    [17, (rows) => ({ action: 'filter', candidates: rows })],
    [25, () => null],
    [37, (rows) => ({ data: valid(rows) })],
    [48, (rows) => JSON.stringify(valid(rows))],
    [61, (rows) => rows],
  ]);
  f.state.score = (call, rows) => call.attempt === 1 && malformed.has(call.batch) ? malformed.get(call.batch)!(rows) : valid(rows);
  const service = f.makeService();
  const task = await f.submit(service);
  const completed = await f.waitTerminal(service, task.task_id);
  assert.equal(completed.status, 'completed', completed.error ?? undefined);
  assert.equal(completed.processed_count, 500);
  assert.equal(completed.result?.total_count, 500);
  assert.equal(f.state.analysisCalls, 1);
  assert.equal(f.state.calls.length, 63 + malformed.size);
  for (let batch = 0; batch < 63; batch += 1) assert.equal(f.state.attempts.get(batch), malformed.has(batch) ? 2 : 1);
  assert.equal(f.state.publicationChunks, 5);
  await f.assertPublished(task.task_id);
});

test('真实PG：持续格式错误最多3次后只保留成功批，人工跨实例恢复不重算已存评分', { skip: !rawUrl }, async (t) => {
  const f = await fixture(t, 101);
  f.state.score = (call, rows) => call.batch === 1 ? { action: 'clarify', candidate_updates: [] } : valid(rows);
  const first = f.makeService();
  const task = await f.submit(first);
  const failed = await f.waitTerminal(first, task.task_id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.equal(failed.processed_count, 8);
  assert.equal(f.state.attempts.get(1), 3, '无效输出纠正有界，不能无限调用模型');
  assert.equal(f.state.calls.length, 4, '一批成功与同波另一批最多3次，不能继续后续波次');
  assert.equal((await f.published()).length, 0);
  assert.equal(f.state.publicationChunks, 0);
  const checkpoint = await f.checkpoint(task.task_id);
  assert.deepEqual(checkpoint.batches.map((batch) => [batch.batchIndex, batch.candidateCount]), [[0, 8]]);
  assert.ok(checkpoint.snapshotJson);
  assert.ok(checkpoint.analysisJson);
  assert.doesNotMatch(JSON.stringify(checkpoint), /synthetic-key-not-for-persistence/);
  first.onModuleDestroy();

  const callsBeforeRetry = f.state.calls.length;
  f.state.score = (_call, rows) => valid(rows);
  const resumed = f.makeService(f.otherDb);
  await resumed.retryCandidateFilterTask('format-user', task.task_id);
  const completed = await f.waitTerminal(resumed, task.task_id);
  assert.equal(completed.status, 'completed', completed.error ?? undefined);
  assert.equal(completed.processed_count, 101);
  assert.equal(f.state.analysisCalls, 1);
  assert.equal(f.state.calls.length - callsBeforeRetry, 12);
  assert.ok(f.state.calls.slice(callsBeforeRetry).every((call) => call.batch !== 0));
  assert.equal(f.state.attempts.get(0), 1);
  await f.assertPublished(task.task_id);
});
