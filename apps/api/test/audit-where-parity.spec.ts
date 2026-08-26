import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';

import { AuditService, type AuditViewer } from '../src/modules/audit/audit.service';
import { AuditLogQueryDto } from '../src/modules/audit/dto/audit-log-query.dto';

/**
 * 「涉及对象」的去重计数走裸 SQL（Prisma 拿不到 count(distinct)），于是筛选条件存在两份实现：
 * buildWhere（Prisma）与 buildSqlWhere（SQL）。两份里都含可见范围规则，改一处漏一处就是越权。
 *
 * 这个用例用同一批 fixture 同时跑两条路径，断言命中的记录集完全一致 —— 把两份实现钉死。
 *
 * 两条安全约束（都是踩过才加的）：
 * 1. 全程在事务里跑、结束一律回滚 —— 部署脚本会在服务器上执行 `npm test`，那里的
 *    DATABASE_URL 指向**生产库**。往真表插 fixture 再删，一旦中途失败就会留下脏数据。
 * 2. 先检查 schema 是否已含新列再跑 —— 部署顺序是「跑测试 → 再迁移」（deploy.sh:813 / 868），
 *    所以测试执行时生产库可能还没有 module/source/summary 这些列，此时应跳过而不是失败。
 */
const PREFIX = 'parity-test-';

/** 用来强制回滚的哨兵：Prisma 只认「回调抛错」这一种回滚方式。 */
const ROLLBACK = Symbol('rollback');

async function reachable(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function schemaReady(prisma: PrismaClient): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM information_schema.columns
      WHERE table_name = 'AuditLog' AND column_name IN ('module', 'source', 'summary')
    `;
    return Number(rows[0]?.n ?? 0) === 3;
  } catch {
    return false;
  }
}

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

test('buildWhere 与 buildSqlWhere 命中的记录集必须完全一致', async (t) => {
  const prisma = new PrismaClient();
  if (!(await reachable(prisma))) {
    await prisma.$disconnect();
    t.skip('数据库不可用，跳过 where 一致性用例');
    return;
  }
  // 部署顺序是「先跑测试、再执行迁移」（deploy.sh:813 / 868），
  // 所以服务器上跑到这里时库里可能还没有 module/source/summary 这几列。
  // 那种情况下跳过 —— 用还没迁移的 schema 去插新字段必然失败，但那不是回归。
  if (!(await schemaReady(prisma))) {
    await prisma.$disconnect();
    t.skip('AuditLog 尚未包含合并后的新列（迁移未执行），跳过 where 一致性用例');
    return;
  }

  const service = Object.create(AuditService.prototype) as any;
  const snapshotAt = new Date(Date.now() + 60_000);

  try {
    // 整段放进事务并强制回滚：这段代码会在部署机上跑，而那里的 DATABASE_URL 指向生产库，
    // 绝不能留下任何 fixture。回滚由抛哨兵触发，Prisma 只认这一种方式。
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

  // 回滚是否真的生效：留一条 fixture 都说明这套写法在生产上会留脏数据
  const verifier = new PrismaClient();
  try {
    const leftover = await verifier.auditLog.count({ where: { id: { startsWith: PREFIX } } });
    assert.equal(leftover, 0, 'fixture 必须随事务回滚，一条都不能留在库里');
  } finally {
    await verifier.$disconnect();
  }
});
