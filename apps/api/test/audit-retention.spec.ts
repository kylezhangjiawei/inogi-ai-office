import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuditRetentionCron } from '../src/modules/audit/audit-retention.cron';
import { OpsCenterService } from '../src/modules/ops-center/ops-center.service';

type Json = Record<string, unknown>;

/**
 * 保留期清理是唯一会主动删审计数据的地方，配置读错就是静默删数据，
 * 因此把「配置解析」和「分批删除」两件事都钉住。
 */
function makeCron(retention: string | undefined, rows: Array<{ id: string; createdAt: Date }>) {
  const deleted: string[] = [];
  const queries: Json[] = [];
  const cron = Object.create(AuditRetentionCron.prototype) as any;
  cron.logger = { log() {}, warn() {}, error() {} };
  cron.config = { get: () => retention };
  cron.prisma = {
    auditLog: {
      findMany: async (args: Json) => {
        queries.push(args);
        const where = args.where as { createdAt: { lt: Date } };
        const take = args.take as number;
        return rows
          .filter((r) => r.createdAt < where.createdAt.lt && !deleted.includes(r.id))
          .slice(0, take)
          .map((r) => ({ id: r.id }));
      },
      deleteMany: async (args: Json) => {
        const ids = ((args.where as Json).id as { in: string[] }).in;
        deleted.push(...ids);
        return { count: ids.length };
      },
    },
  };
  return { cron: cron as AuditRetentionCron, deleted, queries };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

test('运维页面展示实际保留策略，未接入的告警不能显示已启用', async () => {
  const previous = process.env.AUDIT_LOG_RETENTION_DAYS;
  const ops = new OpsCenterService({ auditLog: { findMany: async () => [] } } as never, {} as never);
  try {
    for (const [raw, expected] of [['', '730 天'], ['0', '永久保留'], ['7', '90 天'], ['180', '180 天'], ['invalid', '730 天']]) {
      process.env.AUDIT_LOG_RETENTION_DAYS = raw;
      const settings = await ops.getAlertsAuditSettings();
      assert.equal(settings.log_policies.find((policy) => policy.name === '操作审计日志')?.retention, expected);
      assert.equal(settings.log_policies.find((policy) => policy.name === '接口访问日志')?.retention, '未配置自动清理');
      assert.ok(settings.alert_rules.every((rule) => rule.enabled === false && rule.status === '未接入'));
    }
  } finally {
    if (previous === undefined) delete process.env.AUDIT_LOG_RETENTION_DAYS;
    else process.env.AUDIT_LOG_RETENTION_DAYS = previous;
  }
});

test('保留天数缺省为 730，超期记录被删、期内记录保留', async () => {
  const { cron, deleted } = makeCron(undefined, [
    { id: 'old', createdAt: daysAgo(800) },
    { id: 'edge', createdAt: daysAgo(731) },
    { id: 'keep', createdAt: daysAgo(700) },
    { id: 'fresh', createdAt: daysAgo(1) },
  ]);
  await cron.run();
  assert.deepEqual(deleted.sort(), ['edge', 'old']);
});

test('配置 0 表示永不清理，一行都不删', async () => {
  const { cron, deleted, queries } = makeCron('0', [{ id: 'ancient', createdAt: daysAgo(5000) }]);
  await cron.run();
  assert.deepEqual(deleted, []);
  assert.equal(queries.length, 0);
});

test('低于下限按 90 天处理，非法值回落默认值——绝不按错误配置删数据', async () => {
  const tooShort = makeCron('7', [
    { id: 'd120', createdAt: daysAgo(120) },
    { id: 'd30', createdAt: daysAgo(30) },
  ]);
  await tooShort.cron.run();
  // 若真按 7 天执行，d30 也会被删；按下限 90 天则只删 d120
  assert.deepEqual(tooShort.deleted, ['d120']);

  const invalid = makeCron('abc', [
    { id: 'd800', createdAt: daysAgo(800) },
    { id: 'd400', createdAt: daysAgo(400) },
  ]);
  await invalid.cron.run();
  assert.deepEqual(invalid.deleted, ['d800']);
});

test('分批删除：超过单批上限时继续删，不会只删第一批就收工', async () => {
  const rows = Array.from({ length: 12000 }, (_, i) => ({ id: `x${i}`, createdAt: daysAgo(900) }));
  const { cron, deleted, queries } = makeCron('730', rows);
  await cron.run();
  assert.equal(deleted.length, 12000);
  assert.ok(queries.length >= 3, `应至少分 3 批，实际 ${queries.length} 批`);
});
