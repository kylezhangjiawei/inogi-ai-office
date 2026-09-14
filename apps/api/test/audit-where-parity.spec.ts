import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';

import { AuditService, type AuditViewer } from '../src/modules/audit/audit.service';
import { AuditLogQueryDto } from '../src/modules/audit/dto/audit-log-query.dto';
import { auditReceiptsTestDatabaseUrl } from './helpers/audit-receipts-database';

/**
 * 「涉及对象」的去重计数走裸 SQL（Prisma 拿不到 count(distinct)），于是筛选条件存在两份实现：
 * buildWhere（Prisma）与 buildSqlWhere（SQL）。两份里都含可见范围规则，改一处漏一处就是越权。
 *
 * 这个用例用同一批 fixture 同时跑两条路径，断言命中的记录集完全一致 —— 把两份实现钉死。
 *
 * 只由 npm run test:audit-receipts:postgres 创建的临时数据库执行，不读取 DATABASE_URL。
 * 默认部署套件不运行数据库写入；专用套件初始化当前结构，缺表/缺列须直接失败。
 * 即便在隔离库中，也保留事务回滚及残留检查。
 */
const PREFIX = 'parity-test-';
const databaseUrl = process.env.AUDIT_RECEIPTS_TEST_DATABASE_URL;

/** 用来强制回滚的哨兵：Prisma 只认「回调抛错」这一种回滚方式。 */
const ROLLBACK = Symbol('rollback');

const FIXTURES = [
  { id: `${PREFIX}rd-alice`, module: 'rd', source: 'web', action: 'task.updated', resource: 'task', resourceId: 'T-1', resourceName: '电池测试', actorName: '张三', userId: null, summary: '更新任务进度' },
  { id: `${PREFIX}rd-bob`, module: 'rd', source: 'web', action: 'task.created', resource: 'task', resourceId: 'T-2', resourceName: '结构件评审', actorName: '李四', userId: null, summary: '新建任务' },
  { id: `${PREFIX}proc-alice`, module: 'procurement', source: 'api', action: 'POST', resource: 'procurement', resourceId: 'tasks', resourceName: null, actorName: '张三', userId: null, summary: null },
  { id: `${PREFIX}auth-none`, module: 'auth', source: 'api', action: 'POST', resource: 'auth', resourceId: 'login', resourceName: null, actorName: null, userId: null, summary: null },
  { id: `${PREFIX}uscollab-bob`, module: 'us-collab', source: 'ai', action: 'ai.parse_triggered', resource: 'proposal', resourceId: 'P-1', resourceName: 'AI 立项', actorName: '李四', userId: null, summary: 'AI 解析' },
];

/** 覆盖每一个筛选维度，以及三类可见范围（超管 / 分模块管理者 / 只看自己）。 */
const CASES: Array<{ name: string; query: Partial<AuditLogQueryDto>; viewer: AuditViewer }> = [
  { name: '超管无筛选', query: {}, viewer: { permissions: ['*'] } },
  { name: '超管筛模块', query: { module: 'rd' }, viewer: { permissions: ['*'] } },
  { name: '超管筛来源', query: { source: 'api' }, viewer: { permissions: ['*'] } },
  { name: '超管筛资源类型', query: { resource: 'task' }, viewer: { permissions: ['*'] } },
  { name: '超管筛具体对象', query: { resourceId: 'T-1' }, viewer: { permissions: ['*'] } },
  { name: '超管筛动作码列表', query: { actions: 'task.updated, task.created ,' }, viewer: { permissions: ['*'] } },
  { name: '超管筛关键字（摘要）', query: { keyword: '任务' }, viewer: { permissions: ['*'] } },
  { name: '超管筛关键字（姓名）', query: { keyword: '李四' }, viewer: { permissions: ['*'] } },
  { name: '超管筛关键字（无命中）', query: { keyword: '不存在的词' }, viewer: { permissions: ['*'] } },
  { name: '研发管理者', query: {}, viewer: { userId: 'nobody', userName: '张三', permissions: ['rd-people:manage'] } },
  { name: '采购管理者', query: {}, viewer: { userId: 'nobody', userName: '李四', permissions: ['proc-task:reassign'] } },
  { name: '普通成员只看自己', query: {}, viewer: { userId: 'nobody', userName: '张三', permissions: ['page:audit-log'] } },
  { name: '既无 id 也无姓名', query: {}, viewer: { permissions: ['page:audit-log'] } },
  { name: '组合筛选', query: { module: 'rd', source: 'web', keyword: '张三' }, viewer: { userId: 'nobody', userName: '张三', permissions: ['rd-people:manage'] } },
  // 研发的五个管理码逐个覆盖：漏掉任何一个，SQL 版的模块集合就会与 Prisma 版不同
  { name: '管理码 rd-task:reassign', query: {}, viewer: { userId: 'x', userName: '张三', permissions: ['rd-task:reassign'] } },
  { name: '管理码 rd-project:direct', query: {}, viewer: { userId: 'x', userName: '张三', permissions: ['rd-project:direct'] } },
  { name: '管理码 rd-project:review-l1', query: {}, viewer: { userId: 'x', userName: '张三', permissions: ['rd-project:review-l1'] } },
  { name: '管理码 rd-project:review-l2', query: {}, viewer: { userId: 'x', userName: '张三', permissions: ['rd-project:review-l2'] } },
  { name: '管理码 rd-procurement:review', query: {}, viewer: { userId: 'x', userName: '李四', permissions: ['rd-procurement:review'] } },
  // 同时持有研发与采购管理码：两个模块集合要并起来
  { name: '跨模块管理者', query: {}, viewer: { userId: 'x', userName: '张三', permissions: ['rd-people:manage', 'proc-task:reassign'] } },
  // 只有 id 没有姓名 / 只有姓名没有 id：两个兜底分支各自走一遍
  { name: '只有 id 无姓名', query: {}, viewer: { userId: 'x', permissions: ['page:audit-log'] } },
  { name: '只有姓名无 id', query: {}, viewer: { userName: '张三', permissions: ['page:audit-log'] } },
  // 时间窗与 actorUserId 也各覆盖一次
  { name: '时间窗', query: { dateFrom: new Date(Date.now() - 86400_000).toISOString(), dateTo: new Date(Date.now() + 86400_000).toISOString() }, viewer: { permissions: ['*'] } },
  { name: '指定操作人', query: { actorUserId: 'nobody' }, viewer: { permissions: ['*'] } },
  { name: '普通成员叠加关键字', query: { keyword: '任务' }, viewer: { userId: 'x', userName: '张三', permissions: ['page:audit-log'] } },
];

test('buildWhere 与 buildSqlWhere 命中的记录集必须完全一致', { skip: !databaseUrl, timeout: 30_000 }, async () => {
  const url = auditReceiptsTestDatabaseUrl(databaseUrl!);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });

  const service = Object.create(AuditService.prototype) as any;
  const snapshotAt = new Date(Date.now() + 60_000);

  try {
    // 隔离数据库仍保留回滚断言，避免测试执行之间互相污染。
    await prisma.$transaction(async (tx) => {
      service.prisma = tx;
      await tx.auditLog.createMany({ data: FIXTURES });

      for (const item of CASES) {
        const query = item.query as AuditLogQueryDto;
        const where = service.buildWhere(query, item.viewer, snapshotAt) as Prisma.AuditLogWhereInput;
        const sqlWhere = service.buildSqlWhere(query, item.viewer, snapshotAt) as Prisma.Sql;

        const viaPrisma = await tx.auditLog.findMany({
          where: { AND: [where, { id: { startsWith: PREFIX } }] },
          select: { id: true },
        });
        const viaSql = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AuditLog" WHERE ${sqlWhere} AND "id" LIKE ${`${PREFIX}%`}
        `;

        assert.deepEqual(
          viaSql.map((r) => r.id).sort(),
          viaPrisma.map((r) => r.id).sort(),
          `「${item.name}」两份 where 结果不一致`,
        );
      }
      throw ROLLBACK;
    });
    assert.fail('事务应当被回滚');
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  } finally {
    await prisma.$disconnect();
  }

  // 使用同一隔离连接检查回滚结果，绝不回退到应用数据库。
  const verifier = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    const leftover = await verifier.auditLog.count({ where: { id: { startsWith: PREFIX } } });
    assert.equal(leftover, 0, 'fixture 必须随事务回滚，一条都不能留在库里');
  } finally {
    await verifier.$disconnect();
  }
});
