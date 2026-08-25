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
 * 需要可用的数据库；连不上时跳过（本地与部署环境都有库，CI 无库时不因此失败）。
 */
const PREFIX = 'parity-test-';

async function reachable(prisma: PrismaClient) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
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
];

test('buildWhere 与 buildSqlWhere 命中的记录集必须完全一致', async (t) => {
  const prisma = new PrismaClient();
  if (!(await reachable(prisma))) {
    await prisma.$disconnect();
    t.skip('数据库不可用，跳过 where 一致性用例');
    return;
  }

  const service = Object.create(AuditService.prototype) as any;
  service.prisma = prisma;

  try {
    await prisma.auditLog.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.auditLog.createMany({ data: FIXTURES });
    const snapshotAt = new Date(Date.now() + 60_000);

    for (const item of CASES) {
      const query = item.query as AuditLogQueryDto;
      const where = service.buildWhere(query, item.viewer, snapshotAt) as Prisma.AuditLogWhereInput;
      const sqlWhere = service.buildSqlWhere(query, item.viewer, snapshotAt) as Prisma.Sql;

      const viaPrisma = await prisma.auditLog.findMany({
        where: { AND: [where, { id: { startsWith: PREFIX } }] },
        select: { id: true },
      });
      const viaSql = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AuditLog" WHERE ${sqlWhere} AND "id" LIKE ${`${PREFIX}%`}
      `;

      assert.deepEqual(
        viaSql.map((r) => r.id).sort(),
        viaPrisma.map((r) => r.id).sort(),
        `「${item.name}」两份 where 结果不一致`,
      );
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  }
});
