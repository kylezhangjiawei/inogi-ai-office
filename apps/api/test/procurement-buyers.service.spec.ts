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

test('采购负责人候选默认仅包含采购部门或显式名录成员', async () => {
  const prisma = {
    user: {
      findMany: async () => [
        { id: 'buyer-dept', name: '采购甲', department: '采购部' },
        { id: 'buyer-roster', name: '采购乙', department: '研发部' },
        { id: 'other', name: '研发甲', department: '研发部' },
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
  const all = await service.listBuyerCandidates(true);

  assert.deepEqual(
    eligible.map((candidate) => candidate.id).sort(),
    ['buyer-dept', 'buyer-roster'],
  );
  assert.deepEqual(
    all.map((candidate) => candidate.id).sort(),
    ['buyer-dept', 'buyer-roster', 'other'],
  );
  assert.ok(eligible.every((candidate) => candidate.inRoster));
});

test('未分配采购任务按在制负载均衡分配并记录日志', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    user: {
      findMany: async () => [
        { id: 'buyer-a', name: '采购甲', department: '采购部' },
        { id: 'buyer-b', name: '采购乙', department: '采购部' },
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
