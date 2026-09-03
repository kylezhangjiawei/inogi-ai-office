import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeReplenishRows,
  isVoidedOrderStatus,
  type ReplenishMirrorInput,
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
