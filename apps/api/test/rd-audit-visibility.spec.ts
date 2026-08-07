import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

type RecordValue = Record<string, unknown>;

const logs: RecordValue[] = [
  {
    id: 'other-newer',
    timestamp: '2026-08-06T09:00:00.000Z',
    actor: { id: 'user-other', name: '其他成员' },
  },
  {
    id: 'own-by-id',
    timestamp: '2026-08-06T08:00:00.000Z',
    actor: { id: 'user-member', name: '当前成员旧名称' },
  },
  {
    id: 'same-name-different-id',
    timestamp: '2026-08-06T07:00:00.000Z',
    actor: { id: 'user-other-duplicate', name: '当前成员（研发部）' },
  },
  {
    id: 'legacy-own-by-name',
    timestamp: '2026-08-06T06:00:00.000Z',
    actor: { name: '当前成员（研发部）' },
  },
];

function createService() {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readArray = async (key: string) => {
    assert.equal(key, 'rd.auditLogs');
    return structuredClone(logs);
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
    user: { id: 'member', name: '普通成员', permissions: ['page:rd-audit-log'] },
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
