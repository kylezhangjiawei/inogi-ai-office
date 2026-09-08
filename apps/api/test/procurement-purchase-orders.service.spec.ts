import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';

import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { PROC_PO_LINKABLE_STATUSES, PROC_STATUS_TRANSITIONS } from '../src/modules/procurement/procurement.types';

function withOrderTransactionReads<T extends { procTask: object; procPurchaseOrderRef: object }>(tx: T, task: Record<string, unknown>) {
  return {
    ...tx,
    $queryRaw: async () => [{ id: task.id }],
    procTask: { findUnique: async () => task, ...tx.procTask },
    procPurchaseOrderRef: { findMany: async () => [], ...tx.procPurchaseOrderRef },
  };
}

function withArrivalTransaction<T extends { procTask: object }>(client: T) {
  const tx = { ...client, $queryRaw: async () => [] };
  return { ...client, $transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx) };
}

function orderLinkHarness(initialRefs: Array<Record<string, unknown>> = []) {
  const task: Record<string, unknown> = { id: 'task-safe', status: 'priced', quantity: 100 };
  const refs = [...initialRefs];
  const locks: unknown[][] = [];
  let tail = Promise.resolve();
  const tx = {
    $queryRaw: async (...args: unknown[]) => { locks.push(args); return [{ id: task.id }]; },
    procTask: {
      findUnique: async () => ({ ...task }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(task, data),
    },
    procPurchaseOrderRef: {
      findMany: async () => [...refs],
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { refs.push(...data); return { count: data.length }; },
    },
  };
  const prisma = {
    procTask: { findUnique: async () => ({ ...task }) },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await run(tx); } finally { release(); }
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  service.getTask = async () => ({ ...task }) as never;
  return { service, refs, locks, task };
}

test('连续或并发关联同一采购单行只允许一次，行号空白与历史空串等价', async () => {
  const actor = { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] };
  const h = orderLinkHarness();
  const link = () => h.service.linkPurchaseOrders('task-safe', [{ tpOrderNo: ' PO-001 ', tpLineNo: ' 1 ', orderedQty: 100 }], actor);
  const result = await Promise.allSettled([link(), link()]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(h.refs.length, 1);
  assert.equal(h.refs[0].tpLineNo, '1');
  await assert.rejects(link(), /已关联|重复关联/);
  assert.ok(h.locks.every((args) => args[1] === 'task-safe'));
  const legacy = orderLinkHarness([{ tpOrderNo: 'PO-002', tpLineNo: '' }]);
  await assert.rejects(legacy.service.linkPurchaseOrders('task-safe', [{ tpOrderNo: 'PO-002' }], actor), /已关联|重复关联/);
});

test('同一采购单不能混用未指定行号和明确行号，不同明确行号仍可关联', async () => {
  const actor = { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] };
  for (const refs of [[{ tpOrderNo: 'PO-001', tpLineNo: null }], [{ tpOrderNo: 'PO-001', tpLineNo: '1' }]]) {
    const h = orderLinkHarness(refs);
    const tpLineNo = refs[0].tpLineNo ? undefined : '2';
    await assert.rejects(h.service.linkPurchaseOrders('task-safe', [{ tpOrderNo: 'PO-001', tpLineNo }], actor), /行号/);
    assert.equal(h.refs.length, 1);
  }
  const batch = orderLinkHarness();
  await assert.rejects(batch.service.linkPurchaseOrders('task-safe', [{ tpOrderNo: 'PO-001' }, { tpOrderNo: 'PO-001', tpLineNo: '1' }], actor), /行号/);
  assert.equal(batch.refs.length, 0);
  await batch.service.linkPurchaseOrders('task-safe', [{ tpOrderNo: 'PO-001', tpLineNo: '1' }, { tpOrderNo: 'PO-001', tpLineNo: '2' }], actor);
  assert.equal(batch.refs.length, 2);
});

test('免费样品清除表单残留的 ERP 单号和行号，仍保留样品登记数量', async () => {
  const h = orderLinkHarness();
  await h.service.linkPurchaseOrders('task-safe', [
    { tpOrderNo: 'PO-OLD', tpLineNo: '1', isFreeSample: true, orderedQty: 2 },
    { tpOrderNo: 'PO-OLD', tpLineNo: '1', isFreeSample: true, orderedQty: 3 },
  ], { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] }, { syncTaskQuantity: true });
  assert.deepEqual(h.refs.map((row) => row.tpOrderNo), ['', '']);
  assert.deepEqual(h.refs.map((row) => row.tpLineNo), [null, null]);
  assert.deepEqual(h.refs.map((row) => Number(row.orderedQty)), [2, 3]);
  assert.equal(h.task.quantity, 100);
});

test('ERP 到货下降完整重算状态与完成标记，并仅汇总历史重复行的最新同步值', async () => {
  for (const [receivedQty, expectedStatus] of [[0, 'in_transit'], [50, 'partial_arrival'], [100, 'completed']] as const) {
    const task = { id: 'task-1', status: 'completed', quantity: 100, businessDone: true,
      purchaseOrderRefs: [{ id: 'ref-1', tpOrderNo: 'PO-001', tpLineNo: '1', receivedQty, etaDate: null }],
    };
    let saved: Record<string, unknown> = {};
    const service = new ProcurementService(withArrivalTransaction({ procTask: {
      findUnique: async () => task,
      update: async ({ data }: { data: Record<string, unknown> }) => { saved = data; },
    } }) as never, {} as never, {} as never, {} as never);
    await service.recomputeArrival(task.id);
    assert.equal(saved.status, expectedStatus);
    assert.equal(saved.businessDone, receivedQty >= 100);
    assert.equal(Number(saved.arrivedQty), receivedQty);
  }
  let saved: Record<string, unknown> = {};
  const service = new ProcurementService(withArrivalTransaction({ procTask: {
    findUnique: async () => ({ id: 'task-1', status: 'completed', quantity: 100, businessDone: true, purchaseOrderRefs: [
      { id: 'old', tpOrderNo: 'PO-001', tpLineNo: '1', receivedQty: 100, syncedAt: new Date('2026-09-01'), etaDate: null },
      { id: 'new', tpOrderNo: 'PO-001', tpLineNo: '1', receivedQty: 40, syncedAt: new Date('2026-09-02'), etaDate: null },
      { id: 'other-line', tpOrderNo: 'PO-001', tpLineNo: '2', receivedQty: 10, etaDate: null },
    ] }),
    update: async ({ data }: { data: Record<string, unknown> }) => { saved = data; },
  } }) as never, {} as never, {} as never, {} as never);
  await service.recomputeArrival('task-1');
  assert.equal(Number(saved.arrivedQty), 50);
  assert.equal(saved.status, 'partial_arrival');
  assert.equal(saved.businessDone, false);
});

test('样品到货重算保留等待/测试/定价状态，忽略免费样品且保持预计到货语义', async () => {
  for (const status of ['pending_sample', 'testing', 'priced']) {
    const earliest = new Date('2026-09-08T00:00:00Z');
    const task = { id: 'sample-arrival', status, quantity: 2, businessDone: false, expectedArrivalDate: new Date('2026-09-20'),
      purchaseOrderRefs: [
        { id: 'paid', tpOrderNo: 'PO-SAMPLE', receivedQty: 2, etaDate: earliest, metadata: {} },
        { id: 'free', tpOrderNo: '', receivedQty: 50, etaDate: new Date('2026-09-10'), metadata: { freeSample: true } },
      ],
    };
    let saved: Record<string, unknown> = {};
    const service = new ProcurementService(withArrivalTransaction({ procTask: {
      findUnique: async () => task,
      update: async ({ data }: { data: Record<string, unknown> }) => { saved = data; },
    } }) as never, {} as never, {} as never, {} as never);
    assert.deepEqual(await service.recomputeArrival(task.id), { taskId: task.id, arrivedQty: 2, status });
    assert.equal(saved.status, status);
    assert.equal(saved.businessDone, false);
    assert.equal(Number(saved.arrivedQty), 2);
    assert.equal(saved.expectedArrivalDate, earliest);
    task.purchaseOrderRefs = [];
    await service.recomputeArrival(task.id);
    assert.equal(saved.expectedArrivalDate, task.expectedArrivalDate);
  }
});

test('到货重算遇到已删除任务返回null且不写入', async () => {
  const service = new ProcurementService(withArrivalTransaction({ procTask: {
    findUnique: async () => null,
    update: async () => assert.fail('已删除任务不应更新'),
  } }) as never, {} as never, {} as never, {} as never);
  assert.equal(await service.recomputeArrival('deleted-task'), null);
});

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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
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

// 原先这条锁的是「登记集合 == 匹配集合」。现在两者被刻意拆开：询价两档只可能挂免费样品，
// T+ 里没有对应单据，放进匹配候选只会制造误匹配。改为分别锁住各自的完整内容，
// 任一份被顺手改动仍然会在这里失败。
test('可登记采购单的状态白名单包含「待到样」与询价两档', () => {
  assert.deepEqual(PROC_PO_LINKABLE_STATUSES, [
    'pending_inquiry',
    'inquiring',
    'pending_sample',
    'priced',
    'pending_purchase',
    'in_transit',
    'partial_arrival',
  ]);
});

test('T+ 单据匹配候选不含询价两档', async () => {
  const { PROC_PO_MATCHABLE_STATUSES } = await import('../src/modules/procurement/procurement.types');
  assert.deepEqual(PROC_PO_MATCHABLE_STATUSES, [
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
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

// ── 免费样品登记与实际收样是两个独立步骤 ───────────────────────────────────

test('「待询价」登记免费样品后进入「待到样」，等待实际收样', async () => {
  const created: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const task = { id: 'task-fs-1', status: 'pending_inquiry', quantity: 500 };
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(withOrderTransactionReads(tx, task)),
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  service.getTask = async () => ({ id: task.id, status: 'pending_sample' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [{ isFreeSample: true, supplierName: '供应商甲', orderedQty: 1, etaDate: '2026-09-01' }],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );

  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.metadata, { freeSample: true });
  assert.equal(created[0]?.tpOrderNo, '');
  const updateData = taskUpdates[0]?.data as { status: string; needSample: boolean; logs: { create: { text: string } } };
  assert.equal(updateData.status, 'pending_sample');
  assert.equal(updateData.needSample, true);
  assert.match(updateData.logs.create.text, /等待实际到样/);
  // 免费样品不是需求量的一部分，500 件的任务不能被 1 件样品改写
  assert.doesNotMatch(updateData.logs.create.text, /采购数量由/);
});

test('「待询价」提交带采购单号的行被拒，且提示点名当前状态', async () => {
  const prisma = {
    procTask: { findUnique: async () => ({ id: 'task-fs-2', status: 'pending_inquiry', quantity: 1 }) },
    $transaction: async () => {
      throw new Error('不应进入事务');
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);

  await assert.rejects(
    () => service.linkPurchaseOrders(
      'task-fs-2',
      [{ tpOrderNo: 'CGDD-2026-0001', supplierName: '供应商甲', orderedQty: 500 }],
      { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
    ),
    /「待询价」只能登记免费样品来货/,
  );
});

test('「询价中」同样只收免费样品，正式采购单仍被拒', async () => {
  const prisma = {
    procTask: { findUnique: async () => ({ id: 'task-fs-3', status: 'inquiring', quantity: 1 }) },
    $transaction: async () => {
      throw new Error('不应进入事务');
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);

  await assert.rejects(
    () => service.linkPurchaseOrders(
      'task-fs-3',
      [{ tpOrderNo: 'CGDD-2026-0002', supplierName: '供应商甲', orderedQty: 500 }],
      { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
    ),
    /「询价中」只能登记免费样品来货/,
  );
});

type SampleRow = Record<string, any>;
const sampleActor = { id: 'buyer-1', name: '采购员', permissions: ['proc-task:inquiry', 'proc-task:order', 'proc-task:select-quote'] };

function sampleFlowHarness(initialTask: SampleRow, initialRefs: SampleRow[] = []) {
  const task: SampleRow = { id: 'sample-flow', status: 'pending_inquiry', needSample: false,
    quantity: new Prisma.Decimal(500), arrivedQty: new Prisma.Decimal(0), businessDone: false,
    selectedQuotationId: 'quote-1', quotationSubtotal: new Prisma.Decimal(1000),
    quotationDiscount: new Prisma.Decimal(10), quotationTotal: new Prisma.Decimal(990), quotationCurrency: 'CNY',
    ...initialTask };
  const refs = initialRefs.map((row) => ({ ...row }));
  const quotes = [{ id: 'quote-1', taskId: task.id, supplierName: '供应商甲', isSelected: true,
    unitPrice: new Prisma.Decimal(2), quantity: new Prisma.Decimal(500), currency: 'CNY' }];
  const logs: SampleRow[] = [];
  const locks: unknown[][] = [];
  const hooks: { beforeTransaction?: () => void } = {};
  const view = () => ({ ...task, attachments: [], criticalMaterials: [], purchaseOrderRefs: [...refs],
    logs: [...logs], createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-07') });
  const updateTask = ({ data }: SampleRow) => {
    const { logs: nestedLogs, ...fields } = data;
    Object.assign(task, fields);
    if (nestedLogs?.create) logs.push({ ...nestedLogs.create, createdAt: new Date() });
    return view();
  };
  const tx = {
    $queryRaw: async (...args: unknown[]) => { locks.push(args); return [{ id: task.id }]; },
    procTask: {
      findUnique: async () => view(),
      findUniqueOrThrow: async () => view(),
      update: async (args: SampleRow) => updateTask(args),
      updateMany: async ({ where, data }: SampleRow) => {
        if (task.id !== where.id || (where.status && task.status !== where.status)) return { count: 0 };
        updateTask({ data });
        return { count: 1 };
      },
    },
    procPurchaseOrderRef: {
      findMany: async ({ where }: SampleRow) => refs.filter((row) =>
        !where.metadata || row.metadata?.freeSample === true).map((row) => ({ ...row })),
      createMany: async ({ data }: { data: SampleRow[] }) => {
        refs.push(...data.map((row, index) => ({ id: `new-ref-${index}`, receivedQty: new Prisma.Decimal(0), ...row })));
        return { count: data.length };
      },
    },
    procQuotation: {
      findMany: async () => quotes.filter((quote) => quote.isSelected),
      findUnique: async ({ where }: SampleRow) => quotes.find((quote) => quote.id === where.id),
      updateMany: async ({ data }: SampleRow) => { quotes.forEach((quote) => Object.assign(quote, data)); return { count: quotes.length }; },
      update: async ({ where, data }: SampleRow) => Object.assign(quotes.find((quote) => quote.id === where.id)!, data),
    },
    procTaskLog: { create: async ({ data }: SampleRow) => { logs.push({ ...data, createdAt: new Date() }); } },
  };
  let tail = Promise.resolve();
  const prisma = { ...tx, $transaction: async (run: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) => {
    if (Array.isArray(run)) return Promise.all(run);
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      hooks.beforeTransaction?.();
      return await run(tx);
    } finally { release(); }
  } };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  service.getTask = async () => (service as unknown as { serializeTask: (row: SampleRow) => never }).serializeTask(view());
  return { service, task, refs, quotes, logs, locks, hooks };
}

test('询价两档登记免费样品原子进入待到样，指定测试人员前不能直接进入测试，保留报价和采购数量', async () => {
  for (const status of ['pending_inquiry', 'inquiring']) {
    const h = sampleFlowHarness({ status }, [{ id: 'old-ref', tpOrderNo: '', supplierName: '旧供应商',
      orderedQty: new Prisma.Decimal(1), receivedQty: new Prisma.Decimal(0), metadata: { freeSample: true } }]);
    const originalQuotes = structuredClone(h.quotes.map((quote) => ({ ...quote, unitPrice: Number(quote.unitPrice), quantity: Number(quote.quantity) })));
    const registered = await h.service.linkPurchaseOrders(h.task.id, [{ isFreeSample: true, orderedQty: 2, supplierName: '供应商甲' }], sampleActor, { syncTaskQuantity: true });
    assert.equal(registered.status, 'pending_sample');
    assert.equal(registered.needSample, true);
    assert.equal(registered.quantity, 500);
    assert.equal(registered.arrivedQty, 0);
    assert.equal(registered.selectedQuotationId, 'quote-1');
    assert.equal(registered.quotationTotal, 990);
    assert.equal(h.refs.length, 2);
    assert.equal(Number(h.refs[1].orderedQty), 2);
    assert.equal(Number(h.refs[1].receivedQty), 0);
    assert.deepEqual(h.quotes.map((quote) => ({ ...quote, unitPrice: Number(quote.unitPrice), quantity: Number(quote.quantity) })), originalQuotes);
    assert.match(h.logs[0].text, /等待实际到样/);
    assert.equal(h.logs[0].fromStatus, status);
    assert.equal(h.logs[0].toStatus, 'pending_sample');
    assert.ok(h.locks.some((args) => args[1] === h.task.id));
    await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'pending_sample', status: 'testing', note: '样品已到，进入测试' }, sampleActor), /须指定测试人员/);
    assert.equal(h.task.status, 'pending_sample');
    assert.equal(Number(h.task.quantity), 500);
    assert.equal(h.refs.length, 2);
    assert.equal(h.logs.length, 1);
  }
});

test('历史免费样品可从询价两档纠正到待到样，未填供应商名也保留登记事实', async () => {
  for (const status of ['pending_inquiry', 'inquiring', 'testing']) {
    const h = sampleFlowHarness({ status }, [{ id: 'legacy-free', tpOrderNo: '', supplierName: '', orderedQty: 3,
      receivedQty: 0, metadata: { freeSample: true } }, { id: 'legacy-paid', tpOrderNo: 'PO-SAMPLE', orderedQty: 2, receivedQty: 0 }]);
    const refsBefore = structuredClone(h.refs);
    const corrected = await h.service.transitionTask(h.task.id, {
      from_status: status, status: 'pending_sample', note: '确认本轮样品尚未收到，纠正到待到样',
    }, sampleActor);
    assert.equal(corrected.status, 'pending_sample');
    assert.equal(corrected.needSample, true);
    assert.equal(corrected.quantity, 500);
    assert.equal(corrected.quotationTotal, 990);
    assert.equal(corrected.quotationDiscount, 10);
    assert.equal(corrected.selectedQuotationId, 'quote-1');
    assert.deepEqual(h.refs, refsBefore);
    assert.equal(h.quotes.length, 1);
    assert.match(h.logs[0].text, /本轮样品尚未收到/);
  }
});

test('待询价没有免费登记时拒绝纠正，普通需样询价及重新出样仍可进待到样', async () => {
  for (const refs of [[], [{ id: 'paid', tpOrderNo: 'PO-1', supplierName: '供应商甲', metadata: {} }]]) {
    const h = sampleFlowHarness({ status: 'pending_inquiry' }, refs);
    await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'pending_inquiry', status: 'pending_sample' }, sampleActor), /没有登记免费样品/);
    assert.equal(h.task.status, 'pending_inquiry');
    assert.equal(h.logs.length, 0);
  }
  for (const status of ['inquiring', 'testing']) {
    const h = sampleFlowHarness({ status, needSample: true });
    const result = await h.service.transitionTask(h.task.id, { from_status: status, status: 'pending_sample' }, sampleActor);
    assert.equal(result.status, 'pending_sample');
  }
});

test('询价中不能仅凭免费登记跳过实际收样，未登记同样拒绝', async () => {
  for (const refs of [[], [{ id: 'free', tpOrderNo: '', supplierName: '供应商甲', metadata: { freeSample: true } }]]) {
    const h = sampleFlowHarness({ status: 'inquiring', needSample: true }, refs);
    await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'inquiring', status: 'testing' }, sampleActor), /不允许从「询价中」流转到「测试中」/);
    assert.equal(h.task.status, 'inquiring');
    assert.equal(h.logs.length, 0);
  }
});

test('并发推进不能让过期来源状态覆盖新状态或重复确认收样', async () => {
  const h = sampleFlowHarness({ status: 'inquiring', needSample: true });
  const originalFind = (h.service as any).prisma.procTask.findUnique;
  (h.service as any).prisma.procTask.findUnique = async (...args: unknown[]) => {
    const preflight = await originalFind(...args);
    h.task.status = 'testing';
    return preflight;
  };
  await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'inquiring', status: 'pending_sample' }, sampleActor), /已被其他操作更新|页面数据已过期/);
  assert.equal(h.task.status, 'testing');
  assert.equal(h.logs.length, 0);

  const receiving = sampleFlowHarness({ status: 'pending_sample', needSample: true });
  const receive = () => receiving.service.transitionTask(receiving.task.id, { from_status: 'pending_sample', status: 'testing' }, sampleActor);
  const results = await Promise.allSettled([receive(), receive()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 0);
  assert.ok(results.every((result) => result.status === 'rejected' && /须指定测试人员/.test(String(result.reason))));
  assert.equal(receiving.logs.length, 0);
});

test('历史纠正进入事务后重新检查免费登记，已解除的登记不能放行', async () => {
  const h = sampleFlowHarness({ status: 'pending_inquiry' }, [{ id: 'free', tpOrderNo: '', supplierName: '供应商甲', metadata: { freeSample: true } }]);
  h.hooks.beforeTransaction = () => { h.refs.splice(0); };
  await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'pending_inquiry', status: 'pending_sample' }, sampleActor), /没有登记免费样品/);
  assert.equal(h.task.status, 'pending_inquiry');
  assert.equal(h.logs.length, 0);
});

test('免费登记并发遇到任务状态更新时不新增样品，也不回写旧状态', async () => {
  const h = sampleFlowHarness({ status: 'pending_inquiry' });
  h.hooks.beforeTransaction = () => { h.task.status = 'testing'; };
  await assert.rejects(h.service.linkPurchaseOrders(h.task.id, [{ isFreeSample: true, orderedQty: 1 }], sampleActor), /任务状态或采购数量已被更新/);
  assert.equal(h.refs.length, 0);
  assert.equal(h.task.status, 'testing');
});

test('空登记不能把待询价任务推进到待到样', async () => {
  const h = sampleFlowHarness({ status: 'pending_inquiry' });
  await assert.rejects(h.service.linkPurchaseOrders(h.task.id, [], sampleActor), /请至少登记一条/);
  assert.equal(h.task.status, 'pending_inquiry');
  assert.equal(h.refs.length, 0);
  assert.equal(h.logs.length, 0);
});

test('共享状态写入保留采购确认的询价与直购分支', async () => {
  for (const [method, expected] of [['inquiry', 'pending_inquiry'], ['direct', 'pending_purchase']]) {
    const h = sampleFlowHarness({ status: 'pending_confirm', source: 'manual', method });
    const result = await h.service.confirmTask(h.task.id, sampleActor);
    assert.equal(result.status, expected);
    assert.equal(h.logs[0].fromStatus, 'pending_confirm');
    assert.equal(h.logs[0].toStatus, expected);
  }
});

test('询价两档可登记免费样品，但不进 T+ 单据匹配候选', async () => {
  const { PROC_FREE_SAMPLE_ONLY_STATUSES, PROC_PO_MATCHABLE_STATUSES } = await import(
    '../src/modules/procurement/procurement.types'
  );
  for (const status of ['pending_inquiry', 'inquiring'] as const) {
    assert.ok(PROC_PO_LINKABLE_STATUSES.includes(status), `${status} 应可登记`);
    assert.ok(PROC_FREE_SAMPLE_ONLY_STATUSES.includes(status), `${status} 应只收免费样品`);
    // 这两档 T+ 里没有采购单，进候选只会让真实采购单被建议关联到还在询价的任务上
    assert.ok(!PROC_PO_MATCHABLE_STATUSES.includes(status), `${status} 不应进匹配候选`);
  }
  assert.ok(!PROC_STATUS_TRANSITIONS.inquiring.includes('testing'));
  assert.ok(PROC_STATUS_TRANSITIONS.pending_inquiry.includes('pending_sample'));
  // 原有两条路不能被挤掉
  assert.ok(PROC_STATUS_TRANSITIONS.inquiring.includes('pending_sample'));
  assert.ok(PROC_STATUS_TRANSITIONS.inquiring.includes('priced'));
});

test('选定报价和完成询价均按需样情况流转，免费登记不能替代实际收样', async () => {
  for (const entry of ['selectQuotation', 'completeInquiry'] as const) {
    for (const needSample of [true, false]) {
      for (const supplierName of ['供应商甲', '供应商乙', '']) {
        const h = sampleFlowHarness({ status: 'inquiring', needSample }, [{ id: 'free', tpOrderNo: '', supplierName, metadata: { freeSample: true } }]);
        const result = entry === 'selectQuotation'
          ? await h.service.selectQuotation(h.task.id, 'quote-1', sampleActor)
          : await h.service.completeInquiry(h.task.id, sampleActor);
        assert.equal(result.status, needSample ? 'pending_sample' : 'priced', `${entry} / ${supplierName}`);
        assert.equal(result.quantity, 500);
        assert.equal(h.refs.length, 1);
        assert.equal(h.quotes.length, 1);
      }
    }
  }
});

test('历史样品核对标记只识别最后一次询价直接跳测，正常收样与重新出样后收样不提示', async () => {
  const cases = [
    { name: '旧版直接跳测', transitions: [['inquiring', 'testing']], expected: true },
    { name: '明确收样', transitions: [['pending_sample', 'testing']], expected: false },
    { name: '跳测后的普通日志不改变判据', transitions: [['inquiring', 'testing'], [null, null], ['testing', 'testing']], expected: true },
    { name: '跳测后重新出样并明确收样', transitions: [['inquiring', 'testing'], ['testing', 'pending_sample'], ['pending_sample', 'testing']], expected: false },
    { name: '无迁移记录不能推断跳测', transitions: [], expected: false },
  ];
  for (const { name, transitions, expected } of cases) {
    const h = sampleFlowHarness({ status: 'testing' });
    h.logs.push(...transitions.map(([fromStatus, toStatus], index) => ({
      fromStatus, toStatus, kind: 'system', text: '不依赖日志文案', createdAt: new Date(2026, 8, index + 1),
    })));
    const result = await h.service.getTask(h.task.id, sampleActor);
    assert.equal((result as unknown as { sampleStatusNeedsReview?: boolean }).sampleStatusNeedsReview, expected, name);
  }
  const corrected = sampleFlowHarness({ status: 'pending_sample' });
  corrected.logs.push({ fromStatus: 'inquiring', toStatus: 'testing', kind: 'system', text: '旧记录', createdAt: new Date() });
  const result = await corrected.service.getTask(corrected.task.id, sampleActor);
  assert.equal((result as unknown as { sampleStatusNeedsReview?: boolean }).sampleStatusNeedsReview, false);
});
