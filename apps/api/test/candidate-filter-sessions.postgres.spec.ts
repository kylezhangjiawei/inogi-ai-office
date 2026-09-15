import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';

const rawUrl = process.env.CANDIDATE_FILTER_TEST_DATABASE_URL;

test('隔离 PostgreSQL：历史筛选版本完整统计及有界元数据读取', { skip: !rawUrl }, async (t) => {
  const url = new URL(rawUrl!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/resume_filter_test');
  assert.equal(url.searchParams.has('host'), false);
  const schema = `candidate_filter_sessions_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('schema', schema);
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const observed: Array<{ sql: Prisma.Sql; rows: Array<Record<string, unknown>> }> = [];
  const service = Object.create(ResumeScreeningService.prototype) as ResumeScreeningService;
  Object.assign(service, { prisma: {
    $queryRaw: async (sql: Prisma.Sql) => {
      const rows = await client.$queryRaw<Array<Record<string, unknown>>>(sql);
      observed.push({ sql, rows });
      return rows;
    },
    candidateScreening: { findMany: () => { throw new Error('不能载入全部评分行进行内存聚合'); } },
  } });

  try {
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    // 只创建此方法使用的列，不依赖业务库或业务数据。
    await client.$executeRawUnsafe(`CREATE TABLE "CandidateScreening" (
      "id" TEXT NOT NULL PRIMARY KEY, "promptVersion" TEXT NOT NULL, "jobRuleId" TEXT,
      "decision" TEXT, "createdAt" TIMESTAMP(3) NOT NULL,
      "requestPayload" JSONB NOT NULL, "responsePayload" JSONB NOT NULL
    )`);
    await client.$executeRaw`
      INSERT INTO "CandidateScreening" ("id", "promptVersion", "jobRuleId", "decision", "createdAt", "requestPayload", "responsePayload")
      SELECT 'version-' || v || '-candidate-' || n, 'iterative-filter:version-' || v,
        CASE WHEN n <= CASE WHEN v = 55 THEN 3000 ELSE 1000 END THEN 'job-a' ELSE 'job-b' END,
        CASE n % 3 WHEN 0 THEN 'RECOMMEND' WHEN 1 THEN 'HOLD' ELSE 'REJECT' END,
        TIMESTAMP '2026-01-01 00:00:00' + v * INTERVAL '1 day' + n * INTERVAL '1 millisecond',
        jsonb_build_object('instruction', '历史条件-' || v, 'filter_summary', '历史摘要-' || v, 'all_candidates', repeat('must-not-transfer-request', 20)),
        CASE WHEN v = 54 THEN jsonb_build_object('legacy_score', n % 100, 'raw_output', repeat('must-not-transfer-response', 20))
        ELSE jsonb_build_object('filter_session', jsonb_build_object(
          'instruction', '条件-' || v || '-' || n, 'answer', '说明-' || v, 'filter_summary', '摘要-' || v,
          'criteria', jsonb_build_array('条件一', '条件二')),
          'candidate_profile', repeat('must-not-transfer-response', 20)) END
      FROM generate_series(1, 55) AS versions(v)
      CROSS JOIN LATERAL generate_series(1, CASE WHEN v = 55 THEN 5000 ELSE 1300 END) AS candidates(n)
    `;
    await client.$executeRaw`
      INSERT INTO "CandidateScreening" ("id", "promptVersion", "jobRuleId", "decision", "createdAt", "requestPayload", "responsePayload")
      VALUES ('initial-screening', 'initial-v1', 'job-a', 'RECOMMEND', TIMESTAMP '2030-01-01', '{}', '{}'),
        ('empty-version', 'iterative-filter:', 'job-a', 'RECOMMEND', TIMESTAMP '2030-01-01', '{}', '{}'),
        ('blank-version', 'iterative-filter:   ', 'job-a', 'RECOMMEND', TIMESTAMP '2030-01-01', '{}', '{}')
    `;

    await t.test('一轮 5000 人及最近 50 个完整版本均不受 1000 行截断', async () => {
      const sessions = await service.listCandidateFilterSessions();
      assert.equal(sessions.length, 50);
      assert.equal(sessions[0].version_id, 'version-55');
      assert.equal(sessions[49].version_id, 'version-6');
      assert.equal(sessions[0].total_count, 5000);
      assert.equal(sessions[0].recommend_count, 1666);
      assert.equal(sessions[0].hold_count, 1667);
      assert.equal(sessions[0].reject_count, 1667);
      for (const session of sessions.slice(1)) {
        assert.equal(session.total_count, 1300);
        assert.equal(session.recommend_count, 433);
        assert.equal(session.hold_count, 434);
        assert.equal(session.reject_count, 433);
      }
      assert.equal(sessions[0].instruction, '条件-55-5000');
      assert.equal(sessions[0].answer, '说明-55');
      assert.deepEqual(sessions[0].criteria, ['条件一', '条件二']);
      assert.equal(sessions[0].created_at, '2026-02-25T00:00:05.000Z');
    });

    await t.test('岗位过滤在版本完整计数与代表元数据选择前生效', async () => {
      const sessions = await service.listCandidateFilterSessions(' job-a ');
      assert.equal(sessions.length, 50);
      assert.equal(sessions[0].total_count, 3000);
      assert.equal(sessions[0].recommend_count, 1000);
      assert.equal(sessions[0].hold_count, 1000);
      assert.equal(sessions[0].reject_count, 1000);
      assert.equal(sessions[0].instruction, '条件-55-3000');
      assert.equal(sessions[0].created_at, '2026-02-25T00:00:03.000Z');
      assert.ok(sessions.slice(1).every((session) => session.total_count === 1000));
      assert.deepEqual(await service.listCandidateFilterSessions("job-a' OR TRUE --"), []);
    });

    await t.test('历史版本兼容 requestPayload 中的条件与摘要', async () => {
      const sessions = await service.listCandidateFilterSessions();
      const legacy = sessions.find((session) => session.version_id === 'version-54');
      assert.equal(legacy?.instruction, '历史条件-54');
      assert.equal(legacy?.filter_summary, '历史摘要-54');
      assert.equal(legacy?.answer, '');
      assert.deepEqual(legacy?.criteria, []);
      assert.equal(legacy?.total_count, 1300);
    });

    await t.test('数据库每次只返回每个版本一份必要元数据', async () => {
      assert.equal(observed.length, 4);
      for (const result of observed) {
        assert.ok(result.rows.length <= 50);
        assert.equal(new Set(result.rows.map((row) => row.promptVersion)).size, result.rows.length);
        assert.equal(JSON.stringify(result.rows).includes('must-not-transfer'), false);
        assert.ok(result.rows.every((row) => !('requestPayload' in row) && !('responsePayload' in row)));
      }
      const filteredSql = observed[1].sql;
      assert.ok(filteredSql.values.includes('job-a'));
      assert.equal(filteredSql.strings.some((part) => part.includes('job-a')), false);
    });
  } finally {
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.$disconnect();
  }
});
