import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeReplenishRows,
  isVoidedOrderStatus,
  type ReplenishMirrorInput,
  type ReplenishTaskInput,
} from '../src/modules/procurement/replenish-core';

const material = (over: Partial<Parameters<typeof computeReplenishRows>[0][number]> = {}) => ({
  id: 'm1',
  erpCode: 'A07-062',
  name: '黑色硅胶塞',
  spec: '',
  unit: '个',
  safeStock: 1000,
  stock: 0,
  ...over,
});

const mirror = (over: Partial<ReplenishMirrorInput> = {}): ReplenishMirrorInput => ({
  materialId: 'm1',
  orderedQty: 2000,
  receivedQty: 0,
  supplierName: '明博',
  unitPrice: 1.5,
  status: '01',
  approvalStatus: '生效',
  ...over,
});

const orderRef = (over: Partial<NonNullable<ReplenishTaskInput['purchaseOrderRefs']>[number]> = {}) => ({
  tpOrderNo: 'PO-100', tpLineNo: '1', orderedQty: 100, receivedQty: 0, ...over,
});

const linkedTask = (over: Partial<ReplenishTaskInput> = {}): ReplenishTaskInput => ({
  materialId: 'm1', quantity: 100, arrivedQty: 0, purchaseOrderRefs: [orderRef()], ...over,
});

const linkedMirror = (over: Partial<ReplenishMirrorInput> = {}) => mirror({
  tpOrderNo: 'PO-100', tpLineNo: '1', orderedQty: 100, ...over,
});

test('同一笔在途采购单已关联任务：100 件供给只扣一次，150 件安全库存仍缺 50', () => {
  const [row] = computeReplenishRows([material({ safeStock: 150 })], [linkedMirror()], [linkedTask()]);
  assert.equal(row.inTransit, 100);
  assert.equal(row.openTaskQty, 0);
  assert.equal(row.suggestQty, 50);
  assert.equal(row.covered, false);
});

test('部分关联、部分到货：保留任务尚未下单的份额', () => {
  const [row] = computeReplenishRows(
    [material({ safeStock: 200, stock: 20 })],
    [linkedMirror({ receivedQty: 20 })],
    [linkedTask({ quantity: 150, arrivedQty: 20, purchaseOrderRefs: [orderRef({ receivedQty: 20 })] })],
  );
  assert.equal(row.inTransit, 80);
  assert.equal(row.openTaskQty, 50);
  assert.equal(row.suggestQty, 50);
});

test('多个任务引用同一采购单：不把同一供给按任务数量复制', () => {
  const [row] = computeReplenishRows(
    [material({ safeStock: 250 })], [linkedMirror()], [linkedTask(), linkedTask()],
  );
  assert.equal(row.inTransit, 100);
  assert.equal(row.openTaskQty, 0);
  assert.equal(row.suggestQty, 150);
});

test('单任务同一行重复引用只去重一次，保留真正尚未下单的 50 件', () => {
  const [row] = computeReplenishRows(
    [material({ safeStock: 200 })], [linkedMirror()],
    [linkedTask({ quantity: 150, purchaseOrderRefs: [orderRef(), orderRef()] })],
  );
  assert.equal(row.openTaskQty, 50);
  assert.equal(row.suggestQty, 50);
});

test('不同订单、不同明细行和无关联任务各自保留，不能只按物料名称合并', () => {
  for (const ref of [orderRef({ tpOrderNo: 'PO-other' }), orderRef({ tpLineNo: '2' })]) {
    const [row] = computeReplenishRows(
      [material({ safeStock: 250 })], [linkedMirror()], [linkedTask({ purchaseOrderRefs: [ref] })],
    );
    assert.equal(row.openTaskQty, 100);
    assert.equal(row.suggestQty, 50);
  }
  const [row] = computeReplenishRows(
    [material({ safeStock: 300 })], [linkedMirror()],
    [linkedTask(), linkedTask({ purchaseOrderRefs: [] })],
  );
  assert.equal(row.openTaskQty, 100);
  assert.equal(row.suggestQty, 100);
});

test('同订单中不同物料不能彼此抵扣任务量', () => {
  const rows = computeReplenishRows(
    [material({ safeStock: 150 }), material({ id: 'm2', safeStock: 150 })],
    [linkedMirror({ materialId: 'm2' })], [linkedTask()],
  );
  assert.equal(rows.find((row) => row.materialId === 'm1')?.openTaskQty, 100);
  assert.equal(rows.find((row) => row.materialId === 'm2')?.inTransit, 100);
});

test('无行号的历史关联仅匹配同订单同物料唯一一行，多行时不猜测', () => {
  const task = linkedTask({ purchaseOrderRefs: [orderRef({ tpLineNo: null })] });
  const [unique] = computeReplenishRows([material()], [linkedMirror()], [task]);
  assert.equal(unique.openTaskQty, 0);
  const [ambiguous] = computeReplenishRows(
    [material()], [linkedMirror(), linkedMirror({ tpLineNo: '2', orderedQty: 50 })], [task],
  );
  assert.equal(ambiguous.openTaskQty, 100);
});

test('无行号与明确行号指向同一行时不重复抵扣，引用未填数量时使用镜像量', () => {
  const [row] = computeReplenishRows(
    [material({ safeStock: 200 })], [linkedMirror()],
    [linkedTask({ quantity: 150, purchaseOrderRefs: [orderRef({ tpLineNo: null }), orderRef({ orderedQty: 0 })] })],
  );
  assert.equal(row.openTaskQty, 50);
  assert.equal(row.suggestQty, 50);
});

test('已作废或已到齐的镜像单不会借滞后任务再次覆盖缺口', () => {
  for (const order of [linkedMirror({ status: '作废' }), linkedMirror({ receivedQty: 100 })]) {
    const [row] = computeReplenishRows([material({ safeStock: 150 })], [order], [linkedTask()]);
    assert.equal(row.inTransit, 0);
    assert.equal(row.openTaskQty, 0);
    assert.equal(row.suggestQty, 150);
  }
});

test('尚未同步镜像的有效任务仍计入，明确作废的关联部分不计入', () => {
  const [valid] = computeReplenishRows([material({ safeStock: 150 })], [], [linkedTask()]);
  assert.equal(valid.openTaskQty, 100);
  assert.equal(valid.suggestQty, 50);
  const [voided] = computeReplenishRows(
    [material({ safeStock: 200 })], [],
    [linkedTask({ quantity: 150, purchaseOrderRefs: [orderRef({ approvalStatus: '已取消' })] })],
  );
  assert.equal(voided.openTaskQty, 50);
  assert.equal(voided.suggestQty, 150);
});

test('免费样品空单号不会误命中 ERP 镜像，任务剩余量不会扣为负数', () => {
  const [sample] = computeReplenishRows(
    [material()], [linkedMirror({ tpOrderNo: '' })],
    [linkedTask({ purchaseOrderRefs: [orderRef({ tpOrderNo: '' })] })],
  );
  assert.equal(sample.openTaskQty, 100);
  const [small] = computeReplenishRows([material()], [linkedMirror()], [linkedTask({ quantity: 20 })]);
  assert.equal(small.openTaskQty, 0);
});

// 模拟 Prisma select：若入口漏取订单身份或关联明细，行为测试会重新出现重复扣减。
type FixtureSelect = { [key: string]: boolean | { select: FixtureSelect } };
function selectFixture(row: Record<string, unknown>, select: FixtureSelect): Record<string, unknown> {
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [
    key,
    typeof value === 'object' && Array.isArray(row[key])
      ? (row[key] as Record<string, unknown>[]).map((item) => selectFixture(item, value.select))
      : row[key],
  ]));
}

function replenishPrismaFixture() {
  const findMany = (rows: Record<string, unknown>[]) => async ({ select }: { select: FixtureSelect }) => (
    rows.map((row) => selectFixture(row, select))
  );
  return {
    procMaterial: { findMany: findMany([{ ...material({ safeStock: 150 }), safeStock: '150', balances: [{ stockQty: '0' }] }]) },
    procPurchaseOrderMirror: { findMany: findMany([{ ...linkedMirror(), orderedQty: '100', receivedQty: '0', unitPrice: '1.5' }]) },
    procTask: { findMany: findMany([{
      ...linkedTask(), quantity: '100', arrivedQty: '0',
      purchaseOrderRefs: [{ ...orderRef(), orderedQty: '100', receivedQty: '0' }],
    }]) },
  };
}

test('补货建议接口读取并传递真实关联身份，返回缺口 50 而非已覆盖', async () => {
  const { MaterialReplenishService } = await import('../src/modules/procurement/material-replenish.service');
  const service = new MaterialReplenishService(
    replenishPrismaFixture() as unknown as ConstructorParameters<typeof MaterialReplenishService>[0],
    {} as ConstructorParameters<typeof MaterialReplenishService>[1],
  );
  const { rows } = await service.suggestions();
  assert.equal(rows[0].openTaskQty, 0);
  assert.equal(rows[0].suggestQty, 50);
});

test('MateChat 缺料查询沿用去重口径，向用户报告建议补 50', async () => {
  const { ChatToolsService } = await import('../src/modules/chat/chat-tools.service');
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => InstanceType<typeof ChatToolsService>;
  const service = new ctor(replenishPrismaFixture(), undefined, undefined, undefined, undefined, undefined);
  const result = await (service as unknown as {
    queryProcurement: (args: Record<string, unknown>, user: { userId: string; name: string; permissions: string[] }) => Promise<{ ok: boolean; content: string }>;
  }).queryProcurement({ view: 'shortage' }, { userId: 'u1', name: '采购员', permissions: ['page:proc-cockpit'] });
  assert.equal(result.ok, true);
  assert.match(result.content, /在途 100，任务中 0，建议补 50/);
});

test('作废单不计在途：缺口不该被一张永远不会到货的单抵消掉', () => {
  const voided = computeReplenishRows(
    [material()],
    [mirror({ approvalStatus: '作废' })],
    [],
  );
  assert.equal(voided.length, 1);
  assert.equal(voided[0].inTransit, 0, '作废单的未到量不能计入在途');
  assert.equal(voided[0].suggestQty, 1000, '扣掉作废单后缺口应完整暴露');
  assert.equal(voided[0].covered, false);

  // 作废单也不该充当「最近一单」的供应商/单价参考——那次采购从未真正发生
  assert.equal(voided[0].lastSupplier, null);
  assert.equal(voided[0].lastPrice, null);

  // 生效单仍照常扣减，避免过度收紧
  const live = computeReplenishRows([material()], [mirror()], []);
  assert.equal(live[0].inTransit, 2000);
  assert.equal(live[0].lastSupplier, '明博');
});

test('状态与审批状态任一命中作废词都算无效单', () => {
  assert.equal(isVoidedOrderStatus('生效', '01'), false);
  assert.equal(isVoidedOrderStatus(null, undefined), false);
  assert.equal(isVoidedOrderStatus('作废', '01'), true);
  assert.equal(isVoidedOrderStatus('01', '已取消'), true);
  assert.equal(isVoidedOrderStatus('终止'), true);
  assert.equal(isVoidedOrderStatus('Cancelled'), true);
  assert.equal(isVoidedOrderStatus('void'), true);
});

test('缺口被在途覆盖的物料保留在清单里并标记，而不是静默消失', () => {
  // 线上真实形态：库存 0 / 安全库存 1000 / 陈旧在途 2000 —— 修复前这条会被 continue 丢掉
  const rows = computeReplenishRows([material()], [mirror({ orderedQty: 2000 })], []);
  assert.equal(rows.length, 1, '低于安全库存的物料必须出现在清单里，哪怕暂时不需要下单');
  assert.equal(rows[0].covered, true);
  assert.equal(rows[0].suggestQty, 0, 'covered 行不给出建议量，避免被误当成要下单的数');
  assert.equal(rows[0].inTransit, 2000, '把可疑的在途量摆到台面上，这是发现数据过时的唯一线索');
  assert.equal(rows[0].stock, 0);
  assert.equal(rows[0].safeStock, 1000);
});

test('进行中采购任务同样能覆盖缺口，覆盖判定对两个来源一致', () => {
  const rows = computeReplenishRows(
    [material()],
    [],
    [{ materialId: 'm1', quantity: 1200, arrivedQty: 0 }],
  );
  assert.equal(rows[0].covered, true);
  assert.equal(rows[0].openTaskQty, 1200);
  assert.equal(rows[0].suggestQty, 0);
});

test('可下单的排前面，被覆盖的沉到末尾', () => {
  const rows = computeReplenishRows(
    [
      material({ id: 'covered', erpCode: 'A07-062', safeStock: 1000, stock: 0 }),
      material({ id: 'actionable', erpCode: 'B03-114', safeStock: 800, stock: 120 }),
    ],
    [mirror({ materialId: 'covered', orderedQty: 2000 })],
    [],
  );
  assert.deepEqual(rows.map((r) => r.materialId), ['actionable', 'covered']);
  assert.equal(rows[0].suggestQty, 680);
  assert.equal(rows[0].covered, false);
  assert.equal(rows[1].covered, true);
});

test('包装粒度只对可下单行生效，且作废单的数量不参与粒度推断', () => {
  // 两张 500 的生效单已到齐（不计在途），缺口 680 应向上取整到 1000
  const rows = computeReplenishRows(
    [material({ safeStock: 800, stock: 120 })],
    [
      mirror({ orderedQty: 500, receivedQty: 500 }),
      mirror({ orderedQty: 500, receivedQty: 500 }),
    ],
    [],
  );
  assert.equal(rows[0].inTransit, 0);
  assert.equal(rows[0].packStep, 500);
  assert.equal(rows[0].suggestQty, 1000, '680 按 500 的粒度向上取整');

  // 掺入一张 333 的作废单不应把粒度打乱成 1
  const withVoided = computeReplenishRows(
    [material({ safeStock: 800, stock: 120 })],
    [
      mirror({ orderedQty: 500, receivedQty: 500 }),
      mirror({ orderedQty: 500, receivedQty: 500 }),
      mirror({ orderedQty: 333, receivedQty: 333, status: '作废' }),
    ],
    [],
  );
  assert.equal(withVoided[0].packStep, 500, '作废单整行跳过，不参与包装粒度');
  assert.equal(withVoided[0].suggestQty, 1000);
});

test('缺少状态字段的历史镜像行按有效单处理，不因缺字段被误判为作废', () => {
  const rows = computeReplenishRows(
    [material()],
    [{ materialId: 'm1', orderedQty: 300, receivedQty: 0, supplierName: '精研', unitPrice: 2 }],
    [],
  );
  assert.equal(rows[0].inTransit, 300);
  assert.equal(rows[0].suggestQty, 700);
  assert.equal(rows[0].covered, false);
});
