import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { PROC_PO_LINKABLE_STATUSES, PROC_STATUS_TRANSITIONS } from '../src/modules/procurement/procurement.types';

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
  // getTask 少传 actor 会一律判无权限抛 404：写入已提交、接口却报错。这里盯住回参。
  const getTaskArgs: unknown[][] = [];
  service.getTask = (async (...args: unknown[]) => {
    getTaskArgs.push(args);
    return { id: task.id, status: 'in_transit' };
  }) as never;

  const result = await service.linkPurchaseOrders(
    task.id,
    [
      { tpOrderNo: ' PO-001 ', supplierName: '供应商甲', orderedQty: 100, etaDate: '2026-08-10' },
      { tpOrderNo: 'PO-002', supplierName: '供应商乙', orderedQty: 50, etaDate: '2026-08-12' },
    ],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );
  assert.deepEqual(getTaskArgs, [[task.id, { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] }]]);

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

test('免费样品来货无单号也能登记，且多条免费样品不判重复', async () => {
  const created: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-2', status: 'priced' };
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
    procTask: { findUnique: async () => task },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'in_transit' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [
      { isFreeSample: true, supplierName: '淘宝', orderedQty: 1, etaDate: '2026-08-20' },
      { isFreeSample: true, supplierName: '供应商乙', orderedQty: 2 },
    ],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );

  assert.equal(created.length, 2);
  assert.deepEqual(created.map((item) => item.tpOrderNo), ['', '']);
  assert.deepEqual(created.map((item) => item.metadata), [{ freeSample: true }, { freeSample: true }]);
  const updateData = taskUpdates[0]?.data as { status: string; logs: { create: { text: string } } };
  assert.equal(updateData.status, 'in_transit');
  assert.match(updateData.logs.create.text, /免费样品/);
  assert.match(updateData.logs.create.text, /淘宝、供应商乙/);
});

test('非免费样品的行漏填采购单号仍然拒绝', async () => {
  const prisma = {
    procTask: { findUnique: async () => ({ id: 'task-3', status: 'priced' }) },
    $transaction: async () => {
      throw new Error('不应进入事务');
    },
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    () => service.linkPurchaseOrders(
      'task-3',
      [
        { isFreeSample: true, supplierName: '淘宝', orderedQty: 1 },
        { tpOrderNo: '  ', supplierName: '供应商乙', orderedQty: 2 },
      ],
      { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
    ),
    /采购单号不能为空/,
  );
});

test('「待到样」登记出样单只落关联，不改任务状态，并回填预计到样', async () => {
  const created: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-4', status: 'pending_sample', quantity: 1 };
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
    procTask: { findUnique: async () => task },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'pending_sample' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [{ tpOrderNo: 'PO-SAMPLE-01', supplierName: '中山市精研', orderedQty: 1, etaDate: '2026-09-03' }],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );

  assert.equal(created.length, 1);
  const updateData = taskUpdates[0]?.data as {
    status: string;
    quantity?: unknown;
    expectedArrivalDate?: Date;
    logs: { create: { text: string; fromStatus: string; toStatus: string } };
  };
  // 出样单不是「已下单」：样品没到之前任务必须还停在「待到样」
  assert.equal(updateData.status, 'pending_sample');
  assert.equal(updateData.logs.create.fromStatus, 'pending_sample');
  assert.equal(updateData.logs.create.toStatus, 'pending_sample');
  assert.match(updateData.logs.create.text, /出样单/);
  assert.equal(updateData.expectedArrivalDate?.toISOString().slice(0, 10), '2026-09-03');
  assert.equal(updateData.quantity, undefined);
});

test('批量下单数量与需求不一致时同步任务采购数量', async () => {
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-5', status: 'priced', quantity: 1 };
  const tx = {
    procPurchaseOrderRef: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    procTask: {
      update: async (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return task;
      },
    },
  };
  const prisma = {
    procTask: { findUnique: async () => task },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'in_transit' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [{ tpOrderNo: 'PO-BATCH-01', supplierName: '中山市精研', orderedQty: 500 }],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
    { syncTaskQuantity: true },
  );

  const updateData = taskUpdates[0]?.data as { quantity?: { toString(): string }; logs: { create: { text: string } } };
  assert.equal(Number(updateData.quantity), 500);
  assert.match(updateData.logs.create.text, /任务采购数量由 1 更新为 500/);
});

test('测试不通过的两条出路都在状态机里', () => {
  assert.deepEqual(PROC_STATUS_TRANSITIONS.testing, ['priced', 'inquiring', 'pending_sample']);
});

test('可登记采购单的状态白名单包含「待到样」，单据匹配与登记接口同源', () => {
  assert.deepEqual(PROC_PO_LINKABLE_STATUSES, [
    'pending_sample',
    'priced',
    'pending_purchase',
    'in_transit',
    'partial_arrival',
  ]);
});

test('同步任务数量时免费样品不计入登记总量', async () => {
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-6', status: 'priced', quantity: 1 };
  const tx = {
    procPurchaseOrderRef: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    procTask: {
      update: async (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return task;
      },
    },
  };
  const prisma = {
    procTask: { findUnique: async () => task },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'in_transit' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [
      { isFreeSample: true, supplierName: '淘宝', orderedQty: 1 },
      { tpOrderNo: 'PO-BATCH-02', supplierName: '中山市精研', orderedQty: 500 },
    ],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
    { syncTaskQuantity: true },
  );

  const updateData = taskUpdates[0]?.data as { quantity?: { toString(): string }; logs: { create: { text: string } } };
  // 样品 1 件 + 批量 500 件 ≠ 需要 501 件
  assert.equal(Number(updateData.quantity), 500);
  assert.match(updateData.logs.create.text, /由 1 更新为 500/);
});
