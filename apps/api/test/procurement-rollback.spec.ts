import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_PERMISSION_CATALOG } from '../src/modules/permission-catalog/permission-catalog.defaults';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import {
  rollbackCleanupFor,
  rollbackTargetsOf,
  type ProcStatus,
} from '../src/modules/procurement/procurement.types';

type Json = Record<string, unknown>;

/**
 * 采购流程「跳步」与「回退」。
 *
 * 用户反复反馈：在「待询价」确认报价后，任务直接显示成「已定价」，中间的「询价中」被跳过。
 * 根因是确认报价那一步同时干了两件事——存价格快照 + 决定下一站，于是一次点击跨了两个节点。
 * 现在拆开：确认报价只到「询价中」，去哪一档由 completeInquiry 单独决定。
 *
 * 回退是纠错入口：可以跨节点往回退，但绝不能借它往前跳，且必须清掉目标节点下不该存在的数据。
 */
const actor = { id: 'u1', name: '采购员', permissions: ['proc-task:inquiry'] };

function makeService(task: Json, options: { selectedQuotes?: string[] } = {}) {
  const calls: Json[] = [];
  const service = Object.create(ProcurementService.prototype) as any;
  const tx = {
    procTask: {
      updateMany: async (args: Json) => { calls.push({ op: 'updateTask', ...args }); return { count: 1 }; },
      update: async (args: Json) => { calls.push({ op: 'update', ...args }); return task; },
      findUniqueOrThrow: async () => ({ ...task }),
    },
    procQuotation: {
      deleteMany: async (args: Json) => { calls.push({ op: 'deleteQuotes', ...args }); return { count: 2 }; },
    },
    procPurchaseOrderRef: {
      deleteMany: async (args: Json) => { calls.push({ op: 'deletePos', ...args }); return { count: 1 }; },
    },
    procTaskLog: { create: async (args: Json) => { calls.push({ op: 'log', ...args }); } },
  };
  service.prisma = {
    procTask: { findUniqueOrThrow: async () => ({ ...task }) },
    procQuotation: {
      findMany: async () => (options.selectedQuotes ?? []).map((supplierName) => ({ supplierName })),
    },
    procPurchaseOrderRef: { findMany: async () => [] },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  service.requireTask = async () => task;
  service.serializeTask = (row: Json) => row;
  return { service: service as ProcurementService, calls };
}

// ── 跳步 ──────────────────────────────────────────────────────────────────────

test('完成询价按需样情况决定去向，且只走一格', async () => {
  // 免样：询价中 → 已定价
  const noSample = makeService({ id: 'p1', status: 'inquiring', needSample: false }, { selectedQuotes: ['明博'] });
  const priced = (await noSample.service.completeInquiry('p1', actor)) as Json;
  assert.equal(priced.status, 'inquiring', 'serializeTask 返回的是 findUniqueOrThrow 的桩数据');
  const pricedUpdate = noSample.calls.find((c) => c.op === 'updateTask') as Json;
  assert.equal((pricedUpdate.data as Json).status, 'priced');

  // 需样且未寄样：询价中 → 待到样
  const needSample = makeService({ id: 'p2', status: 'inquiring', needSample: true }, { selectedQuotes: ['明博'] });
  (needSample.service as any).freeSampleSuppliers = async () => new Set<string>();
  await needSample.service.completeInquiry('p2', actor);
  const sampleUpdate = needSample.calls.find((c) => c.op === 'updateTask') as Json;
  assert.equal((sampleUpdate.data as Json).status, 'pending_sample');

  // 需样且所选供应商都已寄样：询价中 → 测试中
  const arrived = makeService({ id: 'p3', status: 'inquiring', needSample: true }, { selectedQuotes: ['明博'] });
  (arrived.service as any).freeSampleSuppliers = async () => new Set(['明博']);
  await arrived.service.completeInquiry('p3', actor);
  const testingUpdate = arrived.calls.find((c) => c.op === 'updateTask') as Json;
  assert.equal((testingUpdate.data as Json).status, 'testing');
});

test('非「询价中」不能完成询价，没有已确认报价也不行', async () => {
  const wrongStatus = makeService({ id: 'p1', status: 'pending_inquiry', needSample: false }, { selectedQuotes: ['明博'] });
  await assert.rejects(wrongStatus.service.completeInquiry('p1', actor), /只有「询价中」的任务可完成询价/);

  const noQuotes = makeService({ id: 'p2', status: 'inquiring', needSample: false }, { selectedQuotes: [] });
  await assert.rejects(noQuotes.service.completeInquiry('p2', actor), /还没有已确认的报价/);
});

// ── 回退目标 ──────────────────────────────────────────────────────────────────

test('回退目标只含当前节点之前的节点，不能借回退往前跳', () => {
  assert.deepEqual(rollbackTargetsOf('priced'), [
    'pending_confirm', 'pending_inquiry', 'inquiring', 'pending_sample', 'testing',
  ]);
  // 已完成的任务能退到之前任意一个节点——这正是用户要的「已发生问题的数据可回退」
  assert.ok(rollbackTargetsOf('completed').includes('pending_inquiry'));
  assert.ok(rollbackTargetsOf('completed').includes('partial_arrival'));
  // 往前的节点一个都不能出现
  assert.equal(rollbackTargetsOf('inquiring').includes('priced'), false);
  assert.equal(rollbackTargetsOf('inquiring').includes('inquiring'), false);
  // 流程起点与不可回退状态给空集
  assert.deepEqual(rollbackTargetsOf('pending_confirm'), []);
  assert.deepEqual(rollbackTargetsOf('pending_rd_review'), []);
  assert.deepEqual(rollbackTargetsOf('cancelled'), []);
});

test('直购任务走自己的旁路序列，不会退到询价节点', () => {
  const targets = rollbackTargetsOf('in_transit', 'direct');
  assert.deepEqual(targets, ['pending_confirm', 'pending_purchase']);
  assert.equal(targets.includes('inquiring'), false, '直购从来没经过询价，退到那里没有意义');
});

test('回退清理范围按目标节点判定', () => {
  // 退到询价之前：报价、采购单、到货全清
  assert.deepEqual(rollbackCleanupFor('pending_inquiry'), { quotations: true, purchaseOrders: true, arrivals: true });
  // 退到已定价：价格是这一档的产物要保留，采购单和到货必须清
  assert.deepEqual(rollbackCleanupFor('priced'), { quotations: false, purchaseOrders: true, arrivals: true });
  // 退到已下单：采购单是这一档的产物，都保留
  assert.deepEqual(rollbackCleanupFor('in_transit'), { quotations: false, purchaseOrders: false, arrivals: false });
  // 直购的待购买与已定价同档
  assert.deepEqual(rollbackCleanupFor('pending_purchase'), { quotations: false, purchaseOrders: true, arrivals: true });
});

// ── 回退执行 ──────────────────────────────────────────────────────────────────

test('从已完成回退到待询价：清报价、清采购单关联、撤完成标记', async () => {
  const { service, calls } = makeService({ id: 'p1', status: 'completed', method: 'inquiry' });
  await service.rollbackTask(
    'p1',
    { status: 'pending_inquiry', from_status: 'completed', reason: '供应商报错价，整单重做' },
    actor,
  );

  const update = calls.find((c) => c.op === 'updateTask') as Json;
  // 条件更新带原状态：并发下别人刚推进时这次回退的前提已不成立
  assert.deepEqual(update.where, { id: 'p1', status: 'completed' });
  const data = update.data as Json;
  assert.equal(data.status, 'pending_inquiry');
  assert.equal(data.businessDone, false, '离开终态必须撤掉完成标记，否则仍按已完成计入统计');
  assert.equal(data.selectedQuotationId, null);
  assert.ok(calls.some((c) => c.op === 'deleteQuotes'), '报价要清');

  const deletePos = calls.find((c) => c.op === 'deletePos') as Json;
  assert.ok(deletePos, '采购单关联要清');
  // 免费样品登记是「样品已到手」的事实，与采购单无关，清掉会让重做时白等一轮待到样
  assert.deepEqual(
    (deletePos.where as Json).NOT,
    { metadata: { path: ['freeSample'], equals: true } },
  );

  const log = calls.find((c) => c.op === 'log') as { data: { text: string; fromStatus: string; toStatus: string } };
  assert.match(log.data.text, /供应商报错价/);
  assert.match(log.data.text, /已清理/);
  assert.equal(log.data.fromStatus, 'completed');
  assert.equal(log.data.toStatus, 'pending_inquiry');
});

test('回退到已下单不动采购单与到货数据', async () => {
  const { service, calls } = makeService({ id: 'p1', status: 'completed', method: 'inquiry' });
  await service.rollbackTask(
    'p1',
    { status: 'in_transit', from_status: 'completed', reason: '到货数量登记错了' },
    actor,
  );
  assert.equal(calls.some((c) => c.op === 'deleteQuotes'), false);
  assert.equal(calls.some((c) => c.op === 'deletePos'), false);
  const data = (calls.find((c) => c.op === 'updateTask') as Json).data as Json;
  assert.equal(data.status, 'in_transit');
  assert.equal('arrivedQty' in data, false, '这一档不该动到货量');
});

test('不能借回退往前跳，也不能回退审核中与已取消的任务', async () => {
  const forward = makeService({ id: 'p1', status: 'inquiring', method: 'inquiry' });
  await assert.rejects(
    forward.service.rollbackTask('p1', { status: 'priced', from_status: 'inquiring', reason: '想直接定价' }, actor),
    /只能回退到当前流程中更早的节点/,
  );

  const review = makeService({ id: 'p2', status: 'pending_rd_review', method: 'inquiry' });
  await assert.rejects(
    review.service.rollbackTask('p2', { status: 'pending_confirm', from_status: 'pending_rd_review', reason: '退回' }, actor),
    /不在采购流程内/,
  );

  const cancelled = makeService({ id: 'p3', status: 'cancelled', method: 'inquiry' });
  await assert.rejects(
    cancelled.service.rollbackTask('p3', { status: 'pending_inquiry', from_status: 'cancelled', reason: '恢复' }, actor),
    /不能回退/,
  );
});

test('页面数据过期时拒绝回退，并发改动时不误删数据', async () => {
  const stale = makeService({ id: 'p1', status: 'completed', method: 'inquiry' });
  await assert.rejects(
    // 用户界面上看到的是「已下单」，实际已经完成——他选的回退目标未必是他真正想要的
    stale.service.rollbackTask('p1', { status: 'priced', from_status: 'in_transit', reason: '退回改价' }, actor),
    /页面数据已过期/,
  );

  const raced = makeService({ id: 'p2', status: 'completed', method: 'inquiry' });
  (raced.service as any).prisma.$transaction = async (fn: (t: unknown) => Promise<unknown>) =>
    fn({
      procTask: { updateMany: async () => ({ count: 0 }) },
      procQuotation: { deleteMany: async () => { throw new Error('不该走到删除'); } },
      procPurchaseOrderRef: { deleteMany: async () => { throw new Error('不该走到删除'); } },
      procTaskLog: { create: async () => undefined },
    });
  await assert.rejects(
    raced.service.rollbackTask('p2', { status: 'pending_inquiry', from_status: 'completed', reason: '重做' }, actor),
    /请刷新后重试/,
  );
});

test('回退是独立权限码并已登记进权限目录，管理员才能按角色分配', () => {
  // 没登记进目录，权限配置页就看不到这一项，管理员无从分配，功能等于只有超管能用
  const permission = DEFAULT_PERMISSION_CATALOG.find((item) => item.code === 'proc-task:rollback');
  assert.ok(permission, 'proc-task:rollback 必须登记进权限目录');
  assert.equal(permission.type, 'action');
  assert.equal(permission.groupLabel, '操作权限 · 供应链管理');
  // 回退会删报价与采购单关联，不能与日常推进流程共用一档权限
  assert.notEqual(permission.code, 'proc-task:inquiry');
  const codes = DEFAULT_PERMISSION_CATALOG.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, '权限码不允许重复');
});

test('主干每个节点的回退目标都严格是它的前缀', () => {
  const flow: ProcStatus[] = [
    'pending_confirm', 'pending_inquiry', 'inquiring', 'pending_sample',
    'testing', 'priced', 'in_transit', 'partial_arrival', 'completed',
  ];
  flow.forEach((status, index) => {
    assert.deepEqual(rollbackTargetsOf(status), flow.slice(0, index), `${status} 的回退目标应是它之前的全部节点`);
  });
});
