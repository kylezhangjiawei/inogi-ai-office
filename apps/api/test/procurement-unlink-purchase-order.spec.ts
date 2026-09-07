import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

const ACTOR = { id: 'buyer-1', name: '采购员', permissions: ['proc-task:order'] };

type RefRow = {
  id: string;
  taskId: string;
  tpOrderNo: string;
  tpLineNo: string | null;
  supplierName: string;
  orderedQty: number;
  receivedQty: number;
  etaDate: Date | null;
  metadata: Record<string, unknown>;
};

/**
 * 假 Prisma：只实现 unlinkPurchaseOrder 走到的那几张表的操作，
 * 并把任务行当成可变对象，让条件占位（where 带 status/arrivedQty）真正生效。
 */
function harness(opts: {
  task: Record<string, unknown>;
  refs: RefRow[];
  mirrors?: Array<Record<string, unknown>>;
  /** 任务行被读出之后、写回之前触发一次，用来制造并发窗口 */
  onAfterTaskRead?: (row: Record<string, unknown>) => void;
}) {
  const task = { arrivedQty: 0, quantity: 0, expectedArrivalDate: null, businessDone: false, ...opts.task } as Record<string, unknown>;
  let refs = [...opts.refs];
  const mirrors = [...(opts.mirrors ?? [])];
  const logs: Array<Record<string, unknown>> = [];

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const actual = row[k];
      if (v instanceof Date && actual instanceof Date) return v.getTime() === actual.getTime();
      // Decimal 在真库里是对象，这里用数字近似，比较时统一成数字
      if (typeof v === 'number' || typeof actual === 'number') return Number(actual) === Number(v);
      return actual === v;
    });

  const tx = {
    $queryRaw: async () => [{ id: task.id }],
    procPurchaseOrderRef: {
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = refs.length;
        refs = refs.filter((r) => !matches(r as never, where));
        return { count: before - refs.length };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => refs.filter((r) => matches(r as never, where)),
      count: async ({ where }: { where: Record<string, unknown> }) => refs.filter((r) => matches(r as never, where)).length,
    },
    procTask: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { id, ...cond } = where;
        if (id !== task.id || !matches(task, cond)) return { count: 0 };
        Object.assign(task, data);
        return { count: 1 };
      },
    },
    procPurchaseOrderMirror: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = mirrors.filter((m) => matches(m, where));
        hit.forEach((m) => Object.assign(m, data));
        return { count: hit.length };
      },
    },
    procTaskLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => { logs.push(data); return data; },
    },
  };

  let read = 0;
  const prisma = {
    // 真库返回的是脱离对象，后续写入不会回灌到调用方手里那份快照
    procTask: {
      findUnique: async () => {
        const snapshot = { ...task };
        if (read++ === 0) opts.onAfterTaskRead?.(task);
        return snapshot;
      },
    },
    procPurchaseOrderRef: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => refs.find((r) => matches(r as never, where)) ?? null,
    },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };

  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  service.getTask = (async () => ({ id: task.id })) as never;
  return { service, task, mirrors, logs, refsNow: () => refs };
}

const ref = (over: Partial<RefRow> = {}): RefRow => ({
  id: 'ref-1',
  taskId: 'task-1',
  tpOrderNo: 'PO-001',
  tpLineNo: '1',
  supplierName: '供应商甲',
  orderedQty: 100,
  receivedQty: 0,
  etaDate: null,
  metadata: {},
  ...over,
});

test('历史重复关联只计一份到货，删除其中一条不扣数量，最后一条才扣减', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'partial_arrival', quantity: 100, arrivedQty: 50 },
    refs: [ref({ id: 'ref-a', receivedQty: 50 }), ref({ id: 'ref-b', receivedQty: 50 })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-a', ACTOR);
  assert.equal(Number(h.task.arrivedQty), 50);
  assert.equal(h.task.status, 'partial_arrival');
  assert.equal(h.refsNow().length, 1);
  await h.service.unlinkPurchaseOrder('task-1', 'ref-b', ACTOR);
  assert.equal(Number(h.task.arrivedQty), 0);
  assert.equal(h.task.status, 'in_transit');
  assert.equal(h.refsNow().length, 0);
});

test('撤销未到货的那一条：到货量与状态都不动，剩余关联不受影响', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'partial_arrival', quantity: 500, arrivedQty: 200 },
    refs: [
      ref({ id: 'ref-a', tpOrderNo: 'PO-A', receivedQty: 200 }),
      ref({ id: 'ref-b', tpOrderNo: 'PO-B', receivedQty: 0 }),
    ],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-b', ACTOR as never);

  assert.equal(Number(h.task.arrivedQty), 200, '删的这条本就没到货，到货量一个字节都不该动');
  assert.equal(h.task.status, 'partial_arrival');
  assert.deepEqual(h.refsNow().map((r) => r.id), ['ref-a']);
  assert.match(String(h.logs[0].text), /本单无已同步到货量/);
});

test('撤销唯一一条已到货的关联：已完成的任务降回在途并复位完成标记', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'completed', quantity: 100, arrivedQty: 100, businessDone: true },
    refs: [ref({ receivedQty: 100 })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never);

  // 「配错单 → 同步回全量到货 → 任务自动完成」正是要解除关联的典型场景，不能拦
  assert.equal(Number(h.task.arrivedQty), 0);
  assert.equal(h.task.status, 'in_transit');
  assert.equal(h.task.businessDone, false, '离开已完成必须复位业务完成标记，否则留下矛盾行');
  assert.match(String(h.logs[0].text), /已扣减到货量 100/);
  assert.equal(h.logs[0].fromStatus, 'completed');
  assert.equal(h.logs[0].toStatus, 'in_transit');
});

test('部分扣减后仍有到货：状态保持部分到货，不误降到在途', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'completed', quantity: 500, arrivedQty: 500, businessDone: true },
    refs: [
      ref({ id: 'ref-a', tpOrderNo: 'PO-A', receivedQty: 200 }),
      ref({ id: 'ref-b', tpOrderNo: 'PO-B', receivedQty: 300 }),
    ],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-b', ACTOR as never);

  assert.equal(Number(h.task.arrivedQty), 200);
  assert.equal(h.task.status, 'partial_arrival', '还剩 200 已到货，应停在部分到货而不是在途');
  assert.equal(h.task.businessDone, false);
});

test('免费样品登记：状态与到货数量都不受影响，与弹窗承诺一致', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'pending_sample', quantity: 500, arrivedQty: 30 },
    refs: [ref({ id: 'ref-fs', tpOrderNo: '', tpLineNo: null, receivedQty: 0, metadata: { freeSample: true } })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-fs', ACTOR as never);

  assert.equal(Number(h.task.arrivedQty), 30, '免费样品行不扣到货量');
  assert.equal(h.task.status, 'pending_sample', '待到样原地不动，与出样单登记不改状态对称');
  assert.equal(h.refsNow().length, 0);
  assert.match(String(h.logs[0].text), /免费样品·供应商甲/);
  assert.doesNotMatch(String(h.logs[0].text), /采购数量/, '免费样品不谈采购数量');
});

test('永不还原任务采购数量，但把当前值与本单下单数写进留痕', async () => {
  // 关联时同步把数量改成 500，之后有人手工改成 300：任何按日志回滚的做法都会毁掉这个 300
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 300, arrivedQty: 0 },
    refs: [ref({ orderedQty: 500 })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never);

  assert.equal(Number(h.task.quantity), 300, '数量是完成判定的分母，猜错代价大于不还原');
  assert.match(String(h.logs[0].text), /任务采购数量 300 保持不变（本单原下单数 500）/);
});

test('预计到货只在能证明归属时收窄，回落到剩余关联的最早日期', async () => {
  const mine = new Date('2026-10-01T00:00:00.000Z');
  const other = new Date('2026-11-05T00:00:00.000Z');
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0, expectedArrivalDate: mine },
    refs: [
      ref({ id: 'ref-a', tpOrderNo: 'PO-A', etaDate: mine }),
      ref({ id: 'ref-b', tpOrderNo: 'PO-B', etaDate: other }),
    ],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-a', ACTOR as never);
  assert.equal((h.task.expectedArrivalDate as Date).getTime(), other.getTime());
});

test('预计到货与本条关联对不上时不动它——可能是别条带来的或用户手填的', async () => {
  const handEntered = new Date('2026-12-24T00:00:00.000Z');
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0, expectedArrivalDate: handEntered },
    refs: [ref({ etaDate: new Date('2026-10-01T00:00:00.000Z') })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never);
  assert.equal((h.task.expectedArrivalDate as Date).getTime(), handEntered.getTime());
});

test('最后一条关联被撤销且日期归属本条时，预计到货清空而不是留下幽灵日期', async () => {
  const eta = new Date('2026-10-01T00:00:00.000Z');
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0, expectedArrivalDate: eta },
    refs: [ref({ etaDate: eta })],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never);
  assert.equal(h.task.expectedArrivalDate, null, '已无任何采购单却留着日期，会被算进「本周到货」');
});

test('T+ 镜像行复位为未匹配，否则这张单据在系统里彻底死锁', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0 },
    refs: [ref({ tpOrderNo: 'PO-001', tpLineNo: '2' })],
    mirrors: [
      { tpOrderNo: 'PO-001', tpLineNo: '2', matchTaskId: 'task-1', matchStatus: 'confirmed', matchConfidence: 0.9, matchReason: '编码一致' },
      { tpOrderNo: 'PO-001', tpLineNo: '3', matchTaskId: 'task-9', matchStatus: 'confirmed', matchConfidence: 0.8, matchReason: '编码一致' },
    ],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never);

  assert.equal(h.mirrors[0].matchStatus, 'unmatched');
  assert.equal(h.mirrors[0].matchTaskId, null);
  assert.equal(h.mirrors[0].matchConfidence, null);
  assert.equal(h.mirrors[1].matchStatus, 'confirmed', '同一张单的兄弟行属于别的任务，不能被连带刷掉');
});

test('同单同行存在重复关联时，删掉一条不释放镜像——剩下那条还指着它', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0 },
    refs: [
      ref({ id: 'dup-1', tpOrderNo: 'PO-001', tpLineNo: '1' }),
      ref({ id: 'dup-2', tpOrderNo: 'PO-001', tpLineNo: '1' }),
    ],
    mirrors: [{ tpOrderNo: 'PO-001', tpLineNo: '1', matchTaskId: 'task-1', matchStatus: 'confirmed' }],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'dup-1', ACTOR as never);
  assert.equal(h.mirrors[0].matchStatus, 'confirmed');
});

test('并发：到货量在读到写之间被改过则整笔拒绝，不基于陈旧读数扣减', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 500, arrivedQty: 200 },
    refs: [ref({ receivedQty: 200 })],
    // 夜间同步在读到写之间把到货量重算成 260，状态没变——只守 status 的占位挡不住
    onAfterTaskRead: (row) => { row.arrivedQty = 260; },
  });

  await assert.rejects(
    () => h.service.unlinkPurchaseOrder('task-1', 'ref-1', ACTOR as never),
    /已被其他操作更新/,
    '条件占位必须连 arrivedQty 一起守',
  );
});

test('关联已不存在时保持幂等：不报错、不写留痕', async () => {
  const h = harness({
    task: { id: 'task-1', status: 'in_transit', quantity: 100, arrivedQty: 0 },
    refs: [],
  });
  await h.service.unlinkPurchaseOrder('task-1', 'ref-gone', ACTOR as never);
  assert.equal(h.logs.length, 0, '双击垃圾桶不该变成红字报错，也不该留下重复留痕');
});
