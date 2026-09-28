import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

function createService(prisma: Record<string, unknown>) {
  return new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

test('采购负责人候选仅允许采购部门内且具备个人工作台权限的在职账号', async () => {
  const prisma = {
    department: {
      findUnique: async () => ({ name: '供应链采购中心' }),
    },
    user: {
      findMany: async () => [
        { id: 'buyer-dept', name: '采购甲', department: '供应链采购中心', role: { permissions: ['page:proc-my-workspace'] } },
        { id: 'buyer-no-page', name: '采购乙', department: '供应链采购中心', role: { permissions: [] } },
        { id: 'false-positive', name: '采购协同甲', department: '采购协同组', role: { permissions: ['page:proc-my-workspace'] } },
        { id: 'buyer-roster', name: '采购丙', department: '研发部', role: { permissions: ['page:proc-my-workspace'] } },
        { id: 'other', name: '研发甲', department: '研发部', role: { permissions: [] } },
      ],
    },
    runtimeState: {
      findUnique: async () => ({
        value: JSON.stringify([{ userId: 'buyer-roster' }]),
      }),
    },
  };
  const service = createService(prisma);

  const eligible = await service.listBuyerCandidates();
  const department = await service.listBuyerCandidates('department');
  const all = await service.listBuyerCandidates('all');

  assert.deepEqual(
    eligible.map((candidate) => candidate.id).sort(),
    ['buyer-dept'],
  );
  assert.deepEqual(
    all.map((candidate) => candidate.id).sort(),
    ['buyer-dept', 'buyer-no-page', 'buyer-roster', 'false-positive', 'other'],
  );
  assert.deepEqual(department.map((candidate) => candidate.id), ['buyer-dept', 'buyer-no-page']);
  assert.equal(department.find((candidate) => candidate.id === 'buyer-no-page')?.canReceiveTasks, false);
  assert.ok(eligible.every((candidate) => candidate.inRoster));
});

test('服务端拒绝把任务分配给采购部门外或缺少个人工作台权限的账号', async () => {
  const service = createService({});
  (service as any).listBuyerCandidates = async () => [
    { id: 'buyer-ok', name: '采购甲', department: '采购部', canReceiveTasks: true },
  ];

  await assert.rejects(
    () => (service as any).resolveAssignableBuyer('outside', '研发甲'),
    /采购负责人必须是采购部门内/,
  );
  assert.deepEqual(
    await (service as any).resolveAssignableBuyer('buyer-ok', '采购甲'),
    { id: 'buyer-ok', name: '采购甲', department: '采购部', canReceiveTasks: true },
  );
});

test('成员名录使用系统用户，支持跨部门添加、备注和持久移出，不修改账号或任务', async () => {
  let value = JSON.stringify(['legacy']);
  const users = [
    { id: 'buyer', name: '采购甲', department: '采购部', status: 'ACTIVE' },
    { id: 'legacy', name: '研发甲', department: '研发部', status: 'ACTIVE' },
    { id: 'new', name: '研发甲', department: '研发部', status: 'ACTIVE' },
    { id: 'inactive', name: '停用人员', department: '研发部', status: 'INACTIVE' },
  ];
  const service = createService({
    department: { findUnique: async () => ({ name: '采购部' }) },
    user: {
      findUnique: async ({ where }: any) => users.find(user => user.id === where.id),
      findMany: async ({ where }: any) => users.filter(user => {
        if (!where.OR) return !where.status || user.status === where.status;
        return !where.id.notIn.includes(user.id) && (
          (user.status === where.OR[0].status && user.department === where.OR[0].department)
          || where.OR[1].id.in.includes(user.id)
        );
      }),
    },
    runtimeState: {
      findUnique: async () => ({ value }),
      upsert: async ({ update }: any) => { value = update.value; },
    },
  });
  const ids = async () => (await service.getBuyerRoster()).members.map(member => member.id).sort();
  assert.deepEqual(await ids(), ['buyer', 'legacy']);
  const candidates = await service.listBuyerCandidates('all');
  assert.deepEqual(candidates.map(user => user.id).sort(), users.map(user => user.id).sort());
  assert.equal(candidates.find(user => user.id === 'inactive')?.disabled, true);
  assert.ok(!(await service.listBuyerCandidates('department')).some(user => user.id === 'inactive'));
  await assert.rejects(() => service.addBuyerRosterMember('inactive'), /已启用/);
  await assert.rejects(() => service.addBuyerRosterMember('missing'), /已启用/);
  await service.addBuyerRosterMember('new');
  await service.addBuyerRosterMember('new');
  assert.deepEqual(await ids(), ['buyer', 'legacy', 'new']);
  assert.equal(JSON.parse(value).filter((entry: any) => entry.userId === 'new').length, 1);
  await service.updateBuyerRosterMember('new', '  物料协调  ');
  assert.equal((await service.getBuyerRoster()).members.find(member => member.id === 'new')?.note, '物料协调');
  await service.removeBuyerRosterMember('buyer');
  await service.removeBuyerRosterMember('legacy');
  assert.deepEqual(await ids(), ['new'], '部门默认成员和旧格式成员移出后均不重新出现');
  await assert.rejects(() => service.updateBuyerRosterMember('buyer', '已移出'), /不在/);
  await service.addBuyerRosterMember('buyer');
  assert.deepEqual(await ids(), ['buyer', 'new']);
  users.find(user => user.id === 'new')!.status = 'INACTIVE';
  assert.equal((await service.getBuyerRoster()).members.find(member => member.id === 'new')?.disabled, true);
  await service.removeBuyerRosterMember('new');
  assert.deepEqual(await ids(), ['buyer']);
});

test('未分配采购任务按在制负载均衡分配并记录日志', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    department: {
      findUnique: async () => ({ name: '采购部' }),
    },
    user: {
      findMany: async () => [
        { id: 'buyer-a', name: '采购甲', department: '采购部', role: { permissions: ['page:proc-my-workspace'] } },
        { id: 'buyer-b', name: '采购乙', department: '采购部', role: { permissions: ['page:proc-my-workspace'] } },
      ],
    },
    runtimeState: {
      findUnique: async () => null,
    },
    procTask: {
      findMany: async () => [
        { id: 'task-1', code: 'PR-001' },
        { id: 'task-2', code: 'PR-002' },
        { id: 'task-3', code: 'PR-003' },
      ],
      groupBy: async () => [
        { buyerUserId: 'buyer-a', _count: { _all: 2 } },
        { buyerUserId: 'buyer-b', _count: { _all: 0 } },
      ],
      update: async (args: Record<string, unknown>) => {
        updates.push(args);
        return args;
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  const service = createService(prisma);

  const result = await service.autoAssignUnassigned({
    id: 'admin',
    name: '管理员',
    permissions: ['proc-task:reassign'],
  });

  assert.equal(result.assigned, 3);
  assert.deepEqual(
    result.distribution.map(({ name, count }) => ({ name, count })),
    [
      { name: '采购乙', count: 2 },
      { name: '采购甲', count: 1 },
    ],
  );
  assert.equal(updates.length, 3);
  const assignees = updates.map((update) => {
    const data = update.data as { buyer: string; logs: { create: { text: string } } };
    assert.match(data.logs.create.text, /系统按负载自动分配/);
    return data.buyer;
  });
  assert.deepEqual(assignees, ['采购乙', '采购乙', '采购甲']);
});
