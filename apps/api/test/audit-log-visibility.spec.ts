import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuditService, auditViewAllModules, canViewAllAuditLogs } from '../src/modules/audit/audit.service';

type RecordValue = Record<string, unknown>;

/**
 * 统一操作留痕的可见范围。三个留痕页合并成一个页面码后，「谁能看到谁的记录」
 * 全靠服务层这一处判定——判错就是越权，所以单独钉住。
 */
function createService(distinctRows = 0) {
  const captured: { where?: RecordValue; count: RecordValue[]; findMany: RecordValue[] } = { count: [], findMany: [] };
  const service = Object.create(AuditService.prototype) as any;
  const table = {
    count: async (args: RecordValue) => {
      captured.count.push(args);
      return 0;
    },
    findMany: async (args: RecordValue) => {
      captured.findMany.push(args);
      // 模拟去重统计：返回 take 允许的最大行数，用来验证封顶行为
      if (!args.distinct) return [];
      const take = (args.take as number) ?? distinctRows;
      return Array.from({ length: Math.min(distinctRows, take) }, () => ({}));
    },
    groupBy: async () => [],
  };
  service.prisma = {
    auditLog: table,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ auditLog: table }),
  };
  const original = AuditService.prototype['buildWhere' as keyof AuditService] as unknown as (
    ...args: unknown[]
  ) => RecordValue;
  service.buildWhere = (...args: unknown[]) => {
    const where = original.apply(service, args);
    captured.where = where;
    return where;
  };
  return { service: service as AuditService, captured };
}

/** where.AND 里的可见范围条件（buildWhere 把它放在第一位）。 */
function scopeOf(captured: { where?: RecordValue }) {
  return (captured.where?.AND as RecordValue[])[0];
}

test('通配符与研发管理权限可看全部，普通成员不可', () => {
  assert.equal(canViewAllAuditLogs(['*']), true);
  assert.equal(canViewAllAuditLogs(['rd-project:review-l1']), true);
  assert.equal(canViewAllAuditLogs(['rd-people:manage']), true);
  assert.equal(canViewAllAuditLogs(['page:audit-log']), false);
  assert.equal(canViewAllAuditLogs([]), false);
});

test('「看全部」按模块授权，管理权限不会顺带打开别的模块', () => {
  assert.equal(auditViewAllModules(['*']), '*');
  assert.deepEqual(auditViewAllModules(['rd-people:manage']), ['rd', 'us-collab', 'production']);
  // 采购管理者只该看到采购——合并成一个页面不能顺手把研发留痕也放开
  assert.deepEqual(auditViewAllModules(['proc-task:reassign']), ['procurement']);
  assert.deepEqual(auditViewAllModules(['page:audit-log']), []);
});

test('采购管理者看得到全部采购留痕，其余模块只看得到自己的', async () => {
  const buyer = createService();
  await buyer.service.listLogs({}, {
    userId: 'user-buyer',
    userName: '采购主管',
    permissions: ['page:audit-log', 'proc-task:reassign'],
  });
  assert.deepEqual(scopeOf(buyer.captured), {
    OR: [
      { module: { in: ['procurement'] } },
      { userId: 'user-buyer' },
      { userId: null, actorName: '采购主管' },
    ],
  });
});

test('管理员不带可见范围限制，普通成员只查得到自己的记录', async () => {
  const admin = createService();
  await admin.service.listLogs({}, { userId: 'admin', userName: '管理员', permissions: ['*'] });
  assert.deepEqual(scopeOf(admin.captured), {});

  const member = createService();
  await member.service.listLogs({}, {
    userId: 'user-member',
    userName: '当前成员',
    permissions: ['page:audit-log'],
  });
  assert.deepEqual(scopeOf(member.captured), {
    OR: [
      { userId: 'user-member' },
      // 账号注销后 userId 被置空，只能靠姓名快照认回自己的历史留痕；
      // 精确匹配而非模糊匹配，避免把重名同事的操作算给别人看
      { userId: null, actorName: '当前成员' },
    ],
  });
});

test('既无 id 又无姓名时查不出任何记录，而不是放行全表', async () => {
  const anonymous = createService();
  await anonymous.service.listLogs({}, { permissions: ['page:audit-log'] });
  assert.deepEqual(scopeOf(anonymous.captured), { id: '__no_audit_visibility__' });
});

test('普通成员传 actorUserId 也越不过可见范围', async () => {
  const member = createService();
  await member.service.listLogs({ actorUserId: 'someone-else' }, {
    userId: 'user-member',
    userName: '当前成员',
    permissions: ['page:audit-log'],
  });
  const filters = member.captured.where?.AND as RecordValue[];
  // 自己的可见范围仍在第一条：与 actorUserId 是 AND 关系，交集为空而非替换
  assert.deepEqual(scopeOf(member.captured), {
    OR: [{ userId: 'user-member' }, { userId: null, actorName: '当前成员' }],
  });
  assert.ok(filters.some((item) => JSON.stringify(item) === JSON.stringify({ userId: 'someone-else' })));
});

test('模块、来源与动作码列表逐项落到查询条件上', async () => {
  const admin = createService();
  await admin.service.listLogs(
    { module: 'procurement', source: 'web', actions: 'task.created, task.updated ,', resource: 'task' },
    { userId: 'admin', permissions: ['*'] },
  );
  const filters = admin.captured.where?.AND as RecordValue[];
  const flat = JSON.stringify(filters);
  assert.ok(flat.includes('"module":"procurement"'));
  assert.ok(flat.includes('"source":"web"'));
  assert.ok(flat.includes('"resource":"task"'));
  // 逗号列表去空白去空项后做 IN 过滤
  assert.ok(filters.some((item) => JSON.stringify(item) === JSON.stringify({ action: { in: ['task.created', 'task.updated'] } })));
});

test('概览统计的去重查询必须封顶，且到顶时如实标记', async () => {
  // 去重结果远超上限：不封顶就会把整批拉进内存只为求个长度
  const big = createService(999999);
  const page = (await big.service.listLogs({ withStats: true }, { userId: 'admin', permissions: ['*'] })) as {
    stats: { uniqueActors: number; uniqueResources: number; actorsCapped: boolean; resourcesCapped: boolean } | null;
  };
  const distinctQueries = big.captured.findMany.filter((q) => q.distinct);
  assert.equal(distinctQueries.length, 2);
  assert.ok(distinctQueries.every((q) => typeof q.take === 'number' && (q.take as number) <= 2000));
  assert.equal(page.stats?.uniqueActors, 2000);
  assert.equal(page.stats?.actorsCapped, true);
  assert.equal(page.stats?.resourcesCapped, true);

  const small = createService(3);
  const smallPage = (await small.service.listLogs({ withStats: true }, { userId: 'admin', permissions: ['*'] })) as {
    stats: { uniqueActors: number; actorsCapped: boolean } | null;
  };
  assert.equal(smallPage.stats?.uniqueActors, 3);
  assert.equal(smallPage.stats?.actorsCapped, false);
});

test('withStats=false 时不跑聚合查询，返回 null 而不是 0', async () => {
  const skipped = createService(10);
  const page = (await skipped.service.listLogs({ withStats: false }, { userId: 'admin', permissions: ['*'] })) as {
    stats: unknown;
  };
  assert.equal(page.stats, null);
  // 统计的 4 条查询一条都不该发出：翻页时重复算纯属白花
  assert.equal(skipped.captured.findMany.filter((q) => q.distinct).length, 0);
  assert.equal(skipped.captured.count.length, 1, '只剩列表自己的总数统计');
});
