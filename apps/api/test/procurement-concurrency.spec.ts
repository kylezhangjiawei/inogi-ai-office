import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

type Row = Record<string, any>;
const actor = { id: 'buyer-1', name: '采购员', permissions: ['proc-task:rollback', 'proc-task:confirm'] };

/** 实际执行服务方法；内存层仅控制读写交错，真实行锁另由隔离 PostgreSQL 验证。 */
function harness(status: string, extra: Row = {}) {
  let row: Row = { id: 'task-1', code: 'PO-001', status, method: 'inquiry', source: 'self',
    quantity: new Prisma.Decimal(10), arrivedQty: new Prisma.Decimal(5), businessDone: false,
    buyer: '采购员', buyerUserId: actor.id, ...extra };
  let refs: Row[] = [{ id: 'po-1', tpOrderNo: 'PO-001', tpLineNo: '1', receivedQty: new Prisma.Decimal(10), metadata: {} }];
  const logs: Row[] = [];
  const notices: string[] = [];
  let beforeArrivalRead: (() => Promise<void>) | undefined;
  const snapshot = (): Row & { purchaseOrderRefs: Row[] } => ({ ...row, purchaseOrderRefs: refs.map((ref) => ({ ...ref })) });
  const arrivalInterleave = async () => { const run = beforeArrivalRead; beforeArrivalRead = undefined; await run?.(); };
  const taskStore = {
    findUnique: async () => snapshot(),
    findUniqueOrThrow: async () => snapshot(),
    updateMany: async ({ where, data }: Row) => {
      if (Object.entries(where).some(([key, value]) => row[key] !== value)) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    },
    update: async ({ data }: Row) => { row = { ...row, ...data }; return snapshot(); },
  };
  const tx = {
    $queryRaw: async () => { await arrivalInterleave(); return [{ id: row.id }]; },
    procTask: taskStore,
    procQuotation: { deleteMany: async () => ({ count: 1 }), findMany: async () => [{ supplierName: '已确认供应商' }] },
    procPurchaseOrderRef: {
      findMany: async () => refs.map((ref) => ({ ...ref })),
      deleteMany: async ({ where }: Row) => {
        const oldCount = refs.length;
        refs = refs.filter((ref) => !where.id.in.includes(ref.id));
        return { count: oldCount - refs.length };
      },
    },
    procTaskLog: { create: async ({ data }: Row) => { logs.push(data); } },
    rdMessage: { updateMany: async () => ({ count: 0 }) },
  };
  const service = Object.create(ProcurementService.prototype) as ProcurementService;
  Object.assign(service, {
    prisma: {
      ...tx,
      procTask: { ...taskStore, findUnique: async () => {
        const stale = snapshot();
        await arrivalInterleave();
        return stale;
      } },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    requireTask: async () => snapshot(),
    serializeTask: (value: Row) => value,
    notifyRdTransferReturned: async () => { notices.push('rd-review'); },
    notifyProcReviewResult: async () => { notices.push('confirmed'); },
  });
  const rollback = (target: string) => service.rollbackTask(row.id, { status: target, from_status: row.status, reason: '重新核对需求' }, actor);
  const rollbackAfterInitialRead = (target: string) => {
    let once = true;
    Object.assign(service, { requireTask: async () => {
      const before = snapshot();
      if (once) { once = false; await rollback(target); }
      return before;
    } });
  };
  return { service, rollback, rollbackAfterInitialRead, logs, notices, snapshot,
    beforeArrival: (run: () => Promise<void>) => { beforeArrivalRead = run; },
    replaceReferences: (values: Row[]) => { refs = values; },
  };
}

test('采购确认使用原阶段：并发退回研发审核后返回冲突，不跳过重新审核', async () => {
  const h = harness('pending_confirm', { source: 'rd', rdTaskId: 'RD-001' });
  h.rollbackAfterInitialRead('pending_rd_review');
  await assert.rejects(h.service.confirmTask('task-1', actor), (error: any) => error.getStatus() === 409);
  assert.equal(h.snapshot().status, 'pending_rd_review');
  assert.equal(h.snapshot().buyerUserId, null);
  assert.deepEqual(h.logs.map((log) => log.toStatus), ['pending_rd_review']);
  assert.deepEqual(h.notices, ['rd-review']);
});

test('普通推进使用原阶段：并发回退后拒绝旧推进且只保留回退留痕', async () => {
  const h = harness('testing');
  h.rollbackAfterInitialRead('pending_inquiry');
  await assert.rejects(h.service.transitionTask('task-1', { status: 'priced', from_status: 'testing' }, actor),
    (error: any) => error.getStatus() === 409);
  assert.equal(h.snapshot().status, 'pending_inquiry');
  assert.deepEqual(h.logs.map((log) => log.toStatus), ['pending_inquiry']);
});

test('回退先完成时到货重算读取新关联，不恢复旧到货量或错误结项', async () => {
  const h = harness('partial_arrival');
  h.beforeArrival(async () => { await h.rollback('pending_inquiry'); });
  await h.service.recomputeArrival('task-1');
  assert.equal(h.snapshot().status, 'pending_inquiry');
  assert.equal(Number(h.snapshot().arrivedQty), 0);
  assert.equal(h.snapshot().businessDone, false);
  assert.equal(h.snapshot().purchaseOrderRefs.length, 0);
  assert.deepEqual(h.logs.map((log) => log.toStatus), ['pending_inquiry']);
});

test('回退保留的免费收样不能被同步重新计入采购到货量', async () => {
  const h = harness('partial_arrival');
  h.replaceReferences([
    { id: 'formal-order', tpOrderNo: 'PO-002', tpLineNo: '1', receivedQty: new Prisma.Decimal(10), metadata: {} },
    { id: 'free-sample', receivedQty: new Prisma.Decimal(2), metadata: { freeSample: true } },
  ]);
  h.beforeArrival(async () => { await h.rollback('pending_inquiry'); });
  await h.service.recomputeArrival('task-1');
  assert.equal(h.snapshot().status, 'pending_inquiry');
  assert.equal(Number(h.snapshot().arrivedQty), 0);
  assert.deepEqual(h.snapshot().purchaseOrderRefs.map((ref: Row) => ref.id), ['free-sample']);
});

test('正常出样单继续更新样品到货量，正式采购到齐仍正常结项', async () => {
  const sample = harness('pending_sample');
  sample.replaceReferences([{ id: 'sample-order', tpOrderNo: 'PO-SAMPLE', tpLineNo: '1', receivedQty: new Prisma.Decimal(2), metadata: {} }]);
  await sample.service.recomputeArrival('task-1');
  assert.equal(sample.snapshot().status, 'pending_sample');
  assert.equal(Number(sample.snapshot().arrivedQty), 2);
  const purchase = harness('partial_arrival');
  await purchase.service.recomputeArrival('task-1');
  assert.equal(purchase.snapshot().status, 'completed');
  assert.equal(Number(purchase.snapshot().arrivedQty), 10);
  assert.equal(purchase.snapshot().businessDone, true);
  await assert.rejects(purchase.rollback('pending_inquiry'), /已完成的任务不能回退/);
});

test('合法确认和推进仍正常落状态及留痕，普通推进保留独立结算标记', async () => {
  for (const method of ['inquiry', 'direct']) {
    const h = harness('pending_confirm', { method });
    const result = await h.service.confirmTask('task-1', actor);
    assert.equal(result.status, method === 'direct' ? 'pending_purchase' : 'pending_inquiry');
    assert.equal(h.logs[0].fromStatus, 'pending_confirm');
  }
  const h = harness('inquiring', { businessDone: true });
  await h.service.completeInquiry('task-1', actor);
  assert.equal(h.snapshot().status, 'priced');
  assert.equal(h.snapshot().businessDone, true);
});

test('通用接口拒绝绕过报价、需样、订单和到货依据，即使来源状态正确也不写入', async () => {
  for (const [from, to] of [
    ['pending_confirm', 'pending_purchase'], ['pending_inquiry', 'inquiring'],
    ['inquiring', 'priced'], ['priced', 'in_transit'], ['pending_purchase', 'in_transit'],
    ['in_transit', 'partial_arrival'], ['in_transit', 'completed'], ['partial_arrival', 'completed'],
  ]) {
    const h = harness(from, { needSample: true, arrivedQty: new Prisma.Decimal(0) });
    await assert.rejects(h.service.transitionTask('task-1', { from_status: from, status: to }, actor),
      (error: any) => error.getStatus() === 400 && /不能直接修改状态/.test(error.message));
    assert.equal(h.snapshot().status, from);
    assert.equal(Number(h.snapshot().arrivedQty), 0);
    assert.equal(h.logs.length, 0);
  }
});
