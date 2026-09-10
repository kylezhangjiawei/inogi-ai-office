import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import {
  CandidateFilterClaim,
  CandidateFilterLeaseLostError,
  CandidateFilterTaskRecord,
  CandidateFilterTaskStore,
} from '../src/modules/resume-screening/candidate-filter-task.store';

const rawUrl = process.env.CANDIDATE_FILTER_TEST_DATABASE_URL;
const completion = { content: '{"action":"filter"}', modelName: 'test-model', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } };
const claimOf = (task: CandidateFilterTaskRecord | null): CandidateFilterClaim => {
  assert.ok(task?.claimToken);
  return { id: task.id, claimToken: task.claimToken };
};

test('隔离 PostgreSQL：二次筛选持久队列、多实例并发、租约隔离与原子发布', { skip: !rawUrl }, async (t) => {
  const url = new URL(rawUrl!);
  // 仅允许显式指定的本地专用测试库，绝不读取业务 DATABASE_URL。
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/resume_filter_test');
  assert.equal(url.searchParams.has('host'), false);
  const schema = `candidate_filter_test_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '6');
  const first = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const second = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const a = new CandidateFilterTaskStore(first as never);
  const b = new CandidateFilterTaskStore(second as never);
  try {
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migration = await readFile(`${__dirname}/../prisma/migrations/20260910120000_candidate_filter_durable_tasks/migration.sql`, 'utf8');
    for (const sql of migration.split(';').map((part) => part.trim()).filter(Boolean)) await first.$executeRawUnsafe(sql);
    await first.$executeRawUnsafe('CREATE TABLE "PublishedFilter" ("taskId" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)');

    const clear = () => first.candidateFilterTask.deleteMany();
    const stored = (id: string) => first.candidateFilterTask.findUniqueOrThrow({ where: { id }, include: { batches: { orderBy: { batchIndex: 'asc' } } } });
    const expire = (id: string) => first.candidateFilterTask.update({ where: { id }, data: { leaseUntil: new Date(0) } });
    const create = (userId: string, fingerprint = 'same') => a.create(userId, fingerprint, { instruction: '固定筛选规则' }, { snapshot: { candidates: ['c1', 'c2', 'c3', 'c4'] }, totalCount: 4 });
    const finishBatches = async (claim: CandidateFilterClaim) => { await a.saveAnalysis(claim, completion); await a.saveBatch(claim, 0, completion, 4); };

    await t.test('并发重复提交只创建一次，并阻止不同条件占用同一账号', async () => {
      const tasks = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? a : b).create('user-a', 'fingerprint', { instruction: '规则' }, { snapshot: { ids: ['one'] }, totalCount: 1 })));
      assert.equal(new Set(tasks.map((task) => task.id)).size, 1);
      assert.equal(await first.candidateFilterTask.count(), 1);
      await assert.rejects(create('user-a', 'different'), { status: 409 });
      await assert.rejects(b.getOwned(tasks[0].id, 'user-b'), { status: 404 });
      assert.equal((await a.getCurrent('user-a'))?.id, tasks[0].id);
      await clear();
    });

    await t.test('多个服务实例同时领取，全局仅两个任务处于有效 processing', async () => {
      await Promise.all(['user-a', 'user-b', 'user-c', 'user-d'].map((user) => create(user)));
      const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? a : b).claim()));
      assert.equal(claims.filter(Boolean).length, 2);
      assert.equal(new Set(claims.filter(Boolean).map((task) => task!.id)).size, 2);
      assert.equal(await first.candidateFilterTask.count({ where: { status: 'processing' } }), 2);
      assert.equal(await first.candidateFilterTask.count({ where: { status: 'pending' } }), 2);
      await clear();
    });

    await t.test('重复批次只计数一次，快照和规则只保存一次，连接密钥不会进入 checkpoint', async () => {
      const task = await create('checkpoint-user');
      const claim = claimOf(await a.claim());
      await a.saveSnapshot(claim, { ignored: true }, 99);
      assert.deepEqual((await stored(task.id)).snapshotJson, { candidates: ['c1', 'c2', 'c3', 'c4'] });
      const withSecrets = { ...completion, apiKey: 'must-not-persist', target: { apiKey: 'must-not-persist' }, usage: { ...completion.usage, secret: 'must-not-persist' } };
      await a.saveAnalysis(claim, withSecrets);
      await b.saveAnalysis(claim, { ...completion, content: 'must-not-overwrite' });
      await Promise.all([a.saveBatch(claim, 0, withSecrets, 2), b.saveBatch(claim, 0, withSecrets, 2)]);
      const saved = await stored(task.id);
      assert.equal(saved.processedCount, 2);
      assert.equal(saved.totalCount, 4);
      assert.equal(saved.batches.length, 1);
      assert.deepEqual(saved.analysisJson, completion);
      assert.deepEqual(saved.batches[0].completionJson, completion);
      assert.equal(JSON.stringify(saved).includes('must-not-persist'), false);
      const metadata = await a.getOwned(task.id, task.userId);
      assert.equal(metadata.snapshotJson, null);
      assert.equal(metadata.analysisJson, null);
      assert.deepEqual(metadata.batches, []);
      await assert.rejects(a.saveBatch(claim, 1, completion, 3), { status: 400 });
      assert.equal((await a.getOwned(task.id, task.userId)).processedCount, 2);
      await clear();
    });

    await t.test('失效租约无法心跳、存批次或发布；新实例接管保留所有已完成 checkpoint', async () => {
      const task = await create('recover-user');
      const stale = claimOf(await a.claim());
      await a.saveAnalysis(stale, completion);
      await a.saveBatch(stale, 0, completion, 2);
      await expire(task.id);
      assert.equal(await a.heartbeat(stale), false);
      assert.equal(await a.fail(stale, 'stale failure'), false);
      await assert.rejects(a.saveSnapshot(stale, {}, 4), CandidateFilterLeaseLostError);
      await assert.rejects(a.saveAnalysis(stale, completion), CandidateFilterLeaseLostError);
      await assert.rejects(a.saveBatch(stale, 1, completion, 2), CandidateFilterLeaseLostError);
      await assert.rejects(a.setPhase(stale, 'saving'), CandidateFilterLeaseLostError);
      let stalePublication = false;
      await assert.rejects(a.finalize(stale, async () => { stalePublication = true; return {}; }), CandidateFilterLeaseLostError);
      assert.equal(stalePublication, false);
      const resumed = await b.claim();
      assert.equal(resumed?.id, task.id);
      assert.notEqual(resumed?.claimToken, stale.claimToken);
      assert.equal(resumed?.phase, 'scoring');
      assert.equal(resumed?.attempts, 2);
      assert.equal(resumed?.processedCount, 2);
      assert.equal(resumed?.batches.length, 1);
      assert.deepEqual(resumed?.analysisJson, completion);
      assert.deepEqual(resumed?.snapshotJson, { candidates: ['c1', 'c2', 'c3', 'c4'] });
      await assert.rejects(a.saveBatch(stale, 1, completion, 2), CandidateFilterLeaseLostError);
      await b.saveBatch(claimOf(resumed), 1, completion, 2);
      assert.equal((await b.getOwned(task.id, task.userId)).processedCount, 4);
      await clear();
    });

    await t.test('三次领取中断后可见失败，显式重试保留成功批次并重置领取次数', async () => {
      const task = await create('retry-user');
      let claim = claimOf(await a.claim());
      await a.saveAnalysis(claim, completion);
      await a.saveBatch(claim, 0, completion, 2);
      for (let attempt = 1; attempt < 3; attempt += 1) {
        await expire(task.id);
        claim = claimOf(await b.claim());
      }
      await expire(task.id);
      assert.equal(await a.claim(), null);
      const failed = await b.getOwned(task.id, task.userId);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.activeUserId, null);
      assert.equal(failed.attempts, 3);
      assert.equal(failed.processedCount, 2);
      assert.equal(await a.getCurrent(task.userId), null);
      assert.equal((await a.latest(task.userId))?.id, task.id);
      const other = await create(task.userId, 'new-request');
      await assert.rejects(a.retry(task.id, task.userId), { status: 409 });
      const otherClaim = claimOf(await b.claim());
      assert.equal(otherClaim.id, other.id);
      await b.fail(otherClaim, 'explicit failure');
      const retried = await a.retry(task.id, task.userId);
      assert.equal(retried.status, 'pending');
      assert.equal(retried.phase, 'queued');
      assert.equal(retried.attempts, 0);
      assert.equal(retried.processedCount, 2);
      assert.equal((await stored(task.id)).batches.length, 1);
      assert.deepEqual((await stored(task.id)).analysisJson, completion);
      assert.equal((await b.retry(task.id, task.userId)).id, task.id);
      assert.equal((await a.claim())?.attempts, 1);
      await clear();
    });

    await t.test('等待行锁跨过租约截止时刻，晚到心跳不能复活任务或写入结果', async () => {
      const task = await create('lock-wait-user');
      const claim = claimOf(await a.claim());
      await first.candidateFilterTask.update({ where: { id: task.id }, data: { leaseUntil: new Date(Date.now() + 150) } });
      let reportLocked!: () => void;
      let releaseLock!: () => void;
      const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
      const release = new Promise<void>((resolve) => { releaseLock = resolve; });
      const holding = first.$transaction(async (tx) => {
        await tx.candidateFilterTask.update({ where: { id: task.id }, data: { phase: 'scoring' } });
        reportLocked();
        await release;
      });
      await locked;
      let published = false;
      const heartbeat = b.heartbeat(claim);
      const batch = assert.rejects(b.saveBatch(claim, 0, completion, 4), CandidateFilterLeaseLostError);
      const publish = assert.rejects(b.finalize(claim, async () => { published = true; return { action: 'filter' }; }), CandidateFilterLeaseLostError);
      await delay(220);
      releaseLock();
      await holding;
      assert.equal(await heartbeat, false);
      await Promise.all([batch, publish]);
      assert.equal(published, false);
      assert.equal((await stored(task.id)).batches.length, 0);
      assert.equal((await stored(task.id)).processedCount, 0);
      const next = await a.claim();
      assert.equal(next?.id, task.id);
      assert.notEqual(next?.claimToken, claim.claimToken);
      await clear();
    });

    await t.test('业务写入失败时事务回滚，再次发布只创建一个完整版本', async () => {
      const task = await create('publish-user');
      const claim = claimOf(await a.claim());
      await finishBatches(claim);
      await assert.rejects(a.finalize(claim, async (tx) => {
        await tx.$executeRaw`INSERT INTO "PublishedFilter" ("taskId", "value") VALUES (${task.id}, 'partial')`;
        throw new Error('simulated publication failure');
      }), /simulated publication failure/);
      const rows = await first.$queryRaw<Array<{ taskId: string }>>`SELECT "taskId" FROM "PublishedFilter" WHERE "taskId" = ${task.id}`;
      assert.equal(rows.length, 0);
      assert.equal((await a.getOwned(task.id, task.userId)).status, 'processing');
      let publications = 0;
      const publish = async (tx: Parameters<Parameters<CandidateFilterTaskStore['finalize']>[1]>[0]) => {
        publications += 1;
        await tx.$executeRaw`INSERT INTO "PublishedFilter" ("taskId", "value") VALUES (${task.id}, 'complete')`;
        return { action: 'filter', version_id: task.id };
      };
      const outcomes = await Promise.allSettled([a.finalize(claim, publish), b.finalize(claim, publish)]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.equal(publications, 1);
      const done = await a.getOwned(task.id, task.userId);
      assert.equal(done.status, 'completed');
      assert.equal(done.phase, 'complete');
      assert.equal(done.activeUserId, null);
      assert.deepEqual(done.resultJson, { action: 'filter', version_id: task.id });
      const compact = await stored(task.id);
      assert.equal(compact.snapshotJson, null);
      assert.equal(compact.analysisJson, null);
      assert.equal(compact.batches.length, 0, '发布成功清理冗余断点，失败事务仍保留断点');
      assert.equal((await create(task.userId, 'next-request')).status, 'pending');
      await clear();
    });

    await t.test('部分批次不能发布，澄清任务可在零批次时完成', async () => {
      const task = await create('partial-user');
      const claim = claimOf(await a.claim());
      await a.saveAnalysis(claim, completion);
      await a.saveBatch(claim, 0, completion, 2);
      await assert.rejects(a.finalize(claim, async (tx) => {
        await tx.$executeRaw`INSERT INTO "PublishedFilter" ("taskId", "value") VALUES (${task.id}, 'incomplete')`;
        return { action: 'filter', version_id: task.id };
      }), { status: 400 });
      assert.equal((await first.$queryRaw<unknown[]>`SELECT "taskId" FROM "PublishedFilter" WHERE "taskId" = ${task.id}`).length, 0);
      assert.equal((await a.getOwned(task.id, task.userId)).status, 'processing');
      await clear();
      const clarifyTask = await create('clarify-user');
      const clarifyClaim = claimOf(await b.claim());
      await b.saveAnalysis(clarifyClaim, { ...completion, content: '```json\n{"action":"clarify"}\n```' });
      await b.finalize(clarifyClaim, async () => ({ action: 'clarify', answer: '请明确具体岗位' }));
      const done = await a.getOwned(clarifyTask.id, clarifyTask.userId);
      assert.equal(done.status, 'completed');
      assert.equal(done.processedCount, 0);
      await clear();
    });

    await t.test('发布过程中租约过期会回滚业务写入，不允许旧 worker 完成任务', async () => {
      const task = await create('late-publish-user');
      const claim = claimOf(await a.claim());
      await finishBatches(claim);
      let entered = false;
      await assert.rejects(a.finalize(claim, async (tx) => {
        entered = true;
        await tx.candidateFilterTask.update({ where: { id: task.id }, data: { leaseUntil: new Date(Date.now() + 50) } });
        await tx.$executeRaw`INSERT INTO "PublishedFilter" ("taskId", "value") VALUES (${task.id}, 'late')`;
        await delay(100);
        return { version_id: task.id };
      }), CandidateFilterLeaseLostError);
      assert.equal(entered, true);
      assert.equal((await first.$queryRaw<unknown[]>`SELECT "taskId" FROM "PublishedFilter" WHERE "taskId" = ${task.id}`).length, 0);
      assert.equal((await a.getOwned(task.id, task.userId)).status, 'processing');
    });
  } finally {
    await first.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
});
