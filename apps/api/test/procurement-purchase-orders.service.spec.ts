import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

test('多供应商采购单在同一事务中保存并只流转一次任务状态', async () => {
  const created: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-1', status: 'priced' };
  const tx = {
    procPurchaseOrderRef: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
    procTask: {
      update: async (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return task;
      },
    },
  };
  const prisma = {
    procTask: {
      findUnique: async () => task,
    },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'in_transit' }) as never;

  const result = await service.linkPurchaseOrders(
    task.id,
    [
      { tpOrderNo: ' PO-001 ', supplierName: '供应商甲', orderedQty: 100, etaDate: '2026-08-10' },
      { tpOrderNo: 'PO-002', supplierName: '供应商乙', orderedQty: 50, etaDate: '2026-08-12' },
    ],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );

  assert.equal(created.length, 2);
  assert.deepEqual(created.map((item) => item.tpOrderNo), ['PO-001', 'PO-002']);
  assert.deepEqual(created.map((item) => item.supplierName), ['供应商甲', '供应商乙']);
  assert.deepEqual(created.map((item) => Number(item.orderedQty)), [100, 50]);
  assert.equal(taskUpdates.length, 1);
  const updateData = taskUpdates[0]?.data as {
    status: string;
    logs: { create: { text: string; fromStatus: string; toStatus: string } };
  };
  assert.equal(updateData.status, 'in_transit');
  assert.equal(updateData.logs.create.fromStatus, 'priced');
  assert.equal(updateData.logs.create.toStatus, 'in_transit');
  assert.match(updateData.logs.create.text, /PO-001、PO-002/);
  assert.deepEqual(result, { id: task.id, status: 'in_transit' });
});
