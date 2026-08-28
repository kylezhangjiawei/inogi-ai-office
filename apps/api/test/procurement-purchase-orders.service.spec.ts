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

// ── 供应商提前寄样：待询价 / 询价中登记免费样品来货 ──────────────────────────
// 放开这两档只为让「样品先到、报价后谈」当场留痕，正式采购单仍必须等定价之后。

test('「待询价」可登记免费样品来货，任务状态原地不动', async () => {
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
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  service.getTask = async () => ({ id: task.id, status: 'pending_inquiry' }) as never;

  await service.linkPurchaseOrders(
    task.id,
    [{ isFreeSample: true, supplierName: '供应商甲', orderedQty: 1, etaDate: '2026-09-01' }],
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] },
  );

  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.metadata, { freeSample: true });
  assert.equal(created[0]?.tpOrderNo, '');
  const updateData = taskUpdates[0]?.data as { status: string; logs: { create: { text: string } } };
  // 登记免费样品不是流转：待询价必须还是待询价，否则会跳过询价直接被推着走
  assert.equal(updateData.status, 'pending_inquiry');
  assert.match(updateData.logs.create.text, /免费样品来货/);
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

test('已登记免费样品的任务可从「询价中」直接进「测试中」', async () => {
  const task = { id: 'task-fs-4', status: 'inquiring' };
  const queryArgs: unknown[] = [];
  const prisma = {
    procTask: { findUnique: async () => task },
    procPurchaseOrderRef: {
      findMany: async (args: unknown) => {
        queryArgs.push(args);
        return [{ supplierName: '供应商甲' }];
      },
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  const applied: unknown[][] = [];
  (service as unknown as { applyTransition: unknown }).applyTransition = async (...args: unknown[]) => {
    applied.push(args);
    return { id: task.id, status: 'testing' };
  };

  await service.transitionTask(
    task.id,
    { from_status: 'inquiring', status: 'testing' } as never,
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:inquiry'] },
  );

  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.[1], 'testing');
  // 判据必须是「登记过免费样品」，不是任意采购单关联
  assert.deepEqual(queryArgs, [{
    where: { taskId: task.id, metadata: { path: ['freeSample'], equals: true } },
    select: { supplierName: true },
  }]);
});

test('没有免费样品来货时不许从「询价中」跳过「待到样」', async () => {
  const task = { id: 'task-fs-5', status: 'inquiring' };
  const prisma = {
    procTask: { findUnique: async () => task },
    procPurchaseOrderRef: { findMany: async () => [] },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  (service as unknown as { applyTransition: unknown }).applyTransition = async () => {
    throw new Error('不应执行流转');
  };

  await assert.rejects(
    () => service.transitionTask(
      task.id,
      { from_status: 'inquiring', status: 'testing' } as never,
      { id: 'buyer-1', name: '采购员', permissions: ['proc-task:inquiry'] },
    ),
    /没有登记免费样品来货，不能跳过「待到样」/,
  );
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
  // 跳过「待到样」的静态放行；充分条件由 transitionTask 校验
  assert.ok(PROC_STATUS_TRANSITIONS.inquiring.includes('testing'));
  // 原有两条路不能被挤掉
  assert.ok(PROC_STATUS_TRANSITIONS.inquiring.includes('pending_sample'));
  assert.ok(PROC_STATUS_TRANSITIONS.inquiring.includes('priced'));
});

// ── 跳过「待到样」按供应商核对 ───────────────────────────────────────────────
// 决策函数单独测；两个选定入口是否把供应商传进来，由 scripts/procurement-cockpit-ui.test.mjs
// 的源码断言锁住（漏传会静默退化回旧判据，类型检查看不出来）。
function serviceWithSamples(suppliers: string[]) {
  const prisma = { procPurchaseOrderRef: { findMany: async () => suppliers.map((supplierName) => ({ supplierName })) } };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  return (task: { id: string; needSample: boolean }, selected: string[]) =>
    (service as unknown as {
      nextAfterQuoteSelected: (t: typeof task, s: string[]) => Promise<string>;
    }).nextAfterQuoteSelected(task, selected);
}

test('选定的供应商已寄样 → 跳过「待到样」直接进「测试中」', async () => {
  const next = serviceWithSamples(['供应商甲']);
  assert.equal(await next({ id: 't', needSample: true }, ['供应商甲']), 'testing');
  // 首尾空格不该让判断落空
  assert.equal(await next({ id: 't', needSample: true }, ['  供应商甲 ']), 'testing');
});

test('手上是别家的样时仍进「待到样」', async () => {
  // 重新维护报价换供应商后再次选定，走的就是这条路：甲家的样不能替乙家背书
  const next = serviceWithSamples(['供应商甲']);
  assert.equal(await next({ id: 't', needSample: true }, ['供应商乙']), 'pending_sample');
});

test('多家一起选定时，只要有一家没寄样就仍进「待到样」', async () => {
  const next = serviceWithSamples(['供应商甲']);
  assert.equal(await next({ id: 't', needSample: true }, ['供应商甲', '供应商乙']), 'pending_sample');
  const both = serviceWithSamples(['供应商甲', '供应商乙']);
  assert.equal(await both({ id: 't', needSample: true }, ['供应商甲', '供应商乙']), 'testing');
});

test('不需打样时不看样品，直接「已定价」', async () => {
  const next = serviceWithSamples(['供应商甲']);
  assert.equal(await next({ id: 't', needSample: false }, ['供应商乙']), 'priced');
});

test('供应商名为空时不算已寄样，避免空串互相匹配', async () => {
  // 关联行允许不填供应商；空串若参与匹配，两个「未指定供应商」会互相认账
  const next = serviceWithSamples(['', '   ']);
  assert.equal(await next({ id: 't', needSample: true }, ['']), 'pending_sample');
});
