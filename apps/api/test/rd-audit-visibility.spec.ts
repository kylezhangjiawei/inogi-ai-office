import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

type RecordValue = Record<string, unknown>;

// 语义留痕已从 SystemSetting KV 迁到 AuditLog 表：actor.id 变成 userId 外键，
// 姓名落在 actorName 快照上（账号注销后 userId 被置空，仍要认得出是谁的记录）。
const rows = [
  {
    id: 'other-newer',
    userId: 'user-other',
    actorName: '其他成员',
    createdAt: new Date('2026-08-06T09:00:00.000Z'),
  },
  {
    id: 'own-by-id',
    userId: 'user-member',
    actorName: '当前成员旧名称',
    createdAt: new Date('2026-08-06T08:00:00.000Z'),
  },
  {
    id: 'same-name-different-id',
    userId: 'user-other-duplicate',
    actorName: '当前成员（研发部）',
    createdAt: new Date('2026-08-06T07:00:00.000Z'),
  },
  {
    id: 'legacy-own-by-name',
    userId: null,
    actorName: '当前成员（研发部）',
    createdAt: new Date('2026-08-06T06:00:00.000Z'),
  },
].map((row) => ({
  action: 'task.updated',
  resource: 'task',
  resourceId: 'RD-1',
  resourceName: '任务',
  summary: null,
  source: 'web',
  meta: {},
  notes: [],
  ...row,
}));

const queries: RecordValue[] = [];

function createService() {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.prisma = {
    auditLog: {
      findMany: async (args: RecordValue) => {
        queries.push(args);
        return rows.map((row) => ({ ...row }));
      },
    },
  };
  return service as ResearchDevelopmentService;
}

test('non-admin audit reads only return the current actor while administrators retain the full stream', async () => {
  const service = createService();

  const memberLogs = await service.getAuditLogs({
    userId: 'user-member',
    userName: '当前成员',
    canReadAll: false,
  }) as RecordValue[];
  assert.deepEqual(memberLogs.map((log) => log.id), ['own-by-id', 'legacy-own-by-name']);

  const anonymousLogs = await service.getAuditLogs({ canReadAll: false }) as RecordValue[];
  assert.deepEqual(anonymousLogs, []);

  // 只读当前工作区，且排除拦截器写的 HTTP 原始留痕——否则研发快照会混进一堆裸 POST 记录
  assert.deepEqual(queries[0].where, { module: 'rd', source: { not: 'api' } });

  const adminLogs = await service.getAuditLogs({ canReadAll: true }) as RecordValue[];
  assert.deepEqual(adminLogs.map((log) => log.id), [
    'other-newer',
    'own-by-id',
    'same-name-different-id',
    'legacy-own-by-name',
  ]);
});

test('audit and snapshot controllers derive visibility from authenticated administrator permissions', async () => {
  const auditViewers: RecordValue[] = [];
  const snapshotViewers: RecordValue[] = [];
  const controller = new ResearchDevelopmentController(
    {
      getAuditLogs: async (viewer: RecordValue) => {
        auditViewers.push(viewer);
        return [];
      },
      snapshot: async (viewer: RecordValue) => {
        snapshotViewers.push(viewer);
        return {};
      },
    } as unknown as ResearchDevelopmentService,
    {} as never,
    {} as never,
  );

  await controller.auditLogs({
    user: { id: 'member', name: '普通成员', permissions: ['page:rd-my-workspace', 'rd-task:edit'] },
  });
  await controller.auditLogs({
    user: { id: 'rd-admin', name: '研发管理员', permissions: ['rd-project:review-l1'] },
  });
  await controller.auditLogs({
    user: { id: 'system-admin', name: '系统管理员', permissions: ['*'] },
  });
  await controller.snapshot({
    user: { id: 'member', name: '普通成员', permissions: ['page:rd-my-workspace'] },
  });

  assert.deepEqual(auditViewers, [
    { userId: 'member', userName: '普通成员', canReadAll: false },
    { userId: 'rd-admin', userName: '研发管理员', canReadAll: true },
    { userId: 'system-admin', userName: '系统管理员', canReadAll: true },
  ]);
  assert.deepEqual(snapshotViewers, [
    { userId: 'member', userName: '普通成员', canReadAll: false },
  ]);
});
