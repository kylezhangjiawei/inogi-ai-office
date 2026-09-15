import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';
import type { AiGatewayChatRequest } from '../src/modules/ai-gateway/ai-gateway.types';

const rawUrl = process.env.CANDIDATE_FILTER_TEST_DATABASE_URL;

test('真实 PostgreSQL worker：500人超时、跨实例续跑、发布回滚后零AI调用重试', { skip: !rawUrl }, async () => {
  const url = new URL(rawUrl!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/resume_filter_test');
  assert.equal(url.searchParams.has('host'), false);
  const schema = `candidate_filter_worker_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '6');
  const first = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const second = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const services: ResumeScreeningService[] = [];
  const jobRule = { id: 'job-1', name: '海外品牌与内容营销经理', jdText: '负责美国医疗市场品牌营销。' };
  const candidates = Array.from({ length: 500 }, (_, i) => ({
    id: `candidate-${String(i).padStart(3, '0')}`, jobRuleId: jobRule.id, jobRule, screenings: [],
    name: '匿名候选人', rawEmailText: '美国市场医疗营销经验。', uniqueKey: `test-${i}`,
    sourceSubject: '应聘', parsedCandidateProfile: {},
  }));
  let analysisCalls = 0;
  let scoringCalls = 0;
  let completedScoringCalls = 0;
  let activeCalls = 0;
  let peakCalls = 0;
  let publicationFailure = true;
  let publicationChunks = 0;
  const requestedIds: string[][] = [];
  const gateway = {
    resolveTargets: async (_scene: string, targets: unknown[]) => ({ targets, timeoutMs: 60_000, source: 'fallback' }),
    complete: async (request: AiGatewayChatRequest) => {
      request.signal?.throwIfAborted();
      const input = JSON.parse(String(request.messages[1].content));
      let output: unknown;
      if (input.phase === 'analyze') {
        analysisCalls += 1;
        assert.equal(input.candidates.length, 0);
        assert.equal(input.job_context.total_count, 500);
        output = { action: 'filter', answer: '按统一规则筛选。', filter_summary: '美国医疗市场经验', criteria: ['缺少美国市场经验或医疗背景，评分低于40。'], global_selection: null };
      } else {
        assert.ok(input.candidates.length <= 8);
        const number = ++scoringCalls;
        requestedIds.push(input.candidates.map((candidate: any) => candidate.candidate_id));
        activeCalls += 1;
        peakCalls = Math.max(peakCalls, activeCalls);
        try {
          await delay(2);
          if (number === 3) throw new ServiceUnavailableException({ message: 'Request timed out.', error_code: 'UPSTREAM_ERROR', request_id: 'simulated-timeout' });
          completedScoringCalls += 1;
          output = { action: 'filter', candidate_updates: input.candidates.map((candidate: any) => ({
            candidate_id: candidate.candidate_id, score: 85, decision: 'recommend', next_step: true,
            summary: '符合美国医疗市场经验要求。', change_reason: '按统一规则核对。',
          })) };
        } finally { activeCalls -= 1; }
      }
      return { requestId: `mock-${analysisCalls + scoringCalls}`, scene: request.scene, content: JSON.stringify(output),
        model: 'mock-model', provider: 'mock', usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } };
    },
  };
  // Business reads use anonymous fixtures. Queue/checkpoint/publishing transactions use real PostgreSQL.
  const wrap = (db: any): any => new Proxy(db, { get(target, name) {
    if (name === 'candidate') return { findMany: async () => candidates };
    if (name === 'jobRule') return { findUnique: async () => jobRule };
    if (name === 'integrationConfig') return { findMany: async () => [] };
    if (name === 'user') return { findUnique: async () => ({ status: 'ACTIVE', role: { permissions: ['resume:screen'] } }) };
    if (name === 'candidateScreening') return { createMany: async ({ data }: { data: Prisma.CandidateScreeningCreateManyInput[] }) => {
      await target.$executeRaw(Prisma.sql`INSERT INTO "PublishedCandidate" ("candidateId", "version", "payload") VALUES ${Prisma.join(data.map((row) => Prisma.sql`(${row.candidateId}, ${row.promptVersion}, ${JSON.stringify(row)}::jsonb)`))}`);
      publicationChunks += 1;
      if (publicationFailure) { publicationFailure = false; throw new Error('simulated publication failure after first SQL chunk'); }
      return { count: data.length };
    } };
    if (name === '$transaction') return (run: any, options: any) => target.$transaction((tx: any) => run(wrap(tx)), options);
    const value = Reflect.get(target, name);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const makeService = (db: PrismaClient) => {
    const ai = new OpenAiScreeningService(new ConfigService({ OPENAI_API_KEY: 'fake-key-must-not-persist', OPENAI_TIMEOUT_MS: 60_000 }), gateway as never);
    const service = new ResumeScreeningService(wrap(db), {} as never, {} as never, {} as never,
      { extractCandidateProfile: () => ({}) } as never, ai, {} as never, { filterDisabled: async (codes: string[]) => codes } as never);
    services.push(service);
    return service;
  };
  const waitFor = async (service: ResumeScreeningService, id: string, status: string) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const task = await service.getCandidateFilterTask('user-1', id);
      if (task.status === status && !(service as any).filterWorkers.size) return task;
      await delay(10);
    }
    assert.fail(`worker did not reach ${status}: ${JSON.stringify(await service.getCandidateFilterTask('user-1', id))}`);
  };
  const published = () => first.$queryRaw<Array<{ candidateId: string; version: string; payload: unknown }>>`SELECT * FROM "PublishedCandidate"`;
  try {
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migration = await readFile(`${__dirname}/../prisma/migrations/20260910120000_candidate_filter_durable_tasks/migration.sql`, 'utf8');
    for (const sql of migration.split(';').map((part) => part.trim()).filter(Boolean)) await first.$executeRawUnsafe(sql);
    await first.$executeRawUnsafe('CREATE TABLE "PublishedCandidate" ("candidateId" TEXT NOT NULL, "version" TEXT NOT NULL, "payload" JSONB NOT NULL, PRIMARY KEY ("candidateId", "version"))');
    const a = makeService(first);
    const submitted = await a.createCandidateFilterTask('user-1', { instruction: '没有美国经验或医疗背景，一律低分', job_rule_id: jobRule.id });
    assert.equal(submitted.total_count, 500);
    const failed = await waitFor(a, submitted.task_id, 'failed');
    assert.equal(failed.processed_count, 24);
    assert.match(failed.error!, /status=503.*request_id=simulated-timeout/);
    assert.equal((await published()).length, 0);
    const checkpoint = await first.candidateFilterTask.findUniqueOrThrow({ where: { id: submitted.task_id }, include: { batches: true } });
    const savedIds = new Set(checkpoint.batches.flatMap((batch) => JSON.parse((batch.completionJson as any).content).candidate_updates.map((item: any) => item.candidate_id)));
    assert.equal(savedIds.size, 24);
    assert.doesNotMatch(JSON.stringify(checkpoint), /fake-key-must-not-persist/);
    a.onModuleDestroy();

    const b = makeService(second);
    assert.equal((await b.getCurrentCandidateFilterTask('user-1'))?.task_id, submitted.task_id);
    await assert.rejects(b.getCandidateFilterTask('other-user', submitted.task_id), { status: 404 });
    const requestsBeforeRetry = requestedIds.length;
    candidates.push({ ...candidates[0], id: 'new-after-submit' });
    await b.retryCandidateFilterTask('user-1', submitted.task_id);
    const publishFailed = await waitFor(b, submitted.task_id, 'failed');
    assert.equal(publishFailed.processed_count, 500);
    assert.equal(analysisCalls, 1);
    assert.equal(completedScoringCalls, 63);
    assert.ok(requestedIds.slice(requestsBeforeRetry).flat().every((id) => !savedIds.has(id)));
    assert.equal((await published()).length, 0, '首个100人写入后抛错必须全部回滚');
    assert.match(publishFailed.error!, /simulated publication failure/);
    b.onModuleDestroy();

    const c = makeService(first);
    const callsBeforePublicationRetry = scoringCalls;
    await c.retryCandidateFilterTask('user-1', submitted.task_id);
    const completed = await waitFor(c, submitted.task_id, 'completed');
    const rows = await published();
    assert.equal(rows.length, 500);
    assert.equal(new Set(rows.map((row) => row.candidateId)).size, 500);
    assert.ok(rows.every((row) => row.version === `iterative-filter:filter-${submitted.task_id}`));
    assert.equal(completed.result?.total_count, 500);
    assert.equal(completed.result?.recommend_count, 500);
    assert.equal(completed.processed_count, 500);
    assert.equal(scoringCalls, callsBeforePublicationRetry, '发布重试复用所有评分，不重复调用AI');
    assert.equal(analysisCalls, 1);
    assert.equal(peakCalls, 2);
    assert.equal(publicationChunks, 6, '一次回滚写入和最终五次批量写入');
    assert.equal(await first.candidateFilterTask.count(), 1);
    assert.equal(await first.candidateFilterTaskBatch.count(), 0);
    assert.equal((await first.candidateFilterTask.findUniqueOrThrow({ where: { id: submitted.task_id } })).snapshotJson, null);
    assert.equal((await c.getCandidateFilterTask('user-1', submitted.task_id)).status, 'completed');
    assert.equal((await published()).length, 500);
  } finally {
    for (const service of services) service.onModuleDestroy();
    for (let i = 0; i < 200 && services.some((service) => (service as any).filterWorkers.size); i += 1) await delay(10);
    await first.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
