import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readStockPlanExecution, stockTaskStage, signedArrival } from '../src/modules/procurement/stock-plan-execution';
test('备货采购按签收完成，部分签收保留在途，不等待检验', () => {
  assert.equal(stockTaskStage(100, 100, 20), '部分到货');
  assert.equal(stockTaskStage(100, 100, 100), '已到货');
  assert.equal(stockTaskStage(100, 110, 100), '部分到货');
  assert.equal(stockTaskStage(100, 100, null), '待核对');
  assert.equal(stockTaskStage(100, 0, 0), '待下单');
  assert.equal(stockTaskStage(100, 100, 0), '在途');
});
test('本地签收与 ERP 到货不相加，未核对的退货调整不计完成', () => {
  const summary: any = { effectiveOrderedQty: 100, effectiveReceivedQty: 20, localNetReceivedQty: 20, qualifiedAvailableQty: null };
  assert.equal(signedArrival(summary, true), 20);
  assert.equal(signedArrival({ ...summary, localNetReceivedQty: 100 }, true), 100);
  assert.equal(signedArrival({ ...summary, effectiveOrderedQty: null }, true), null);
  assert.equal(signedArrival(summary, false), 20);
});

test('执行明细不把其他任务共用的订单行或不同单位计入已到货', async () => {
  const task: any = { id: 't1', code: 'PR1', materialId: 'm1', materialName: '组件', material: { tpInventoryCode: 'C1' }, quantity: 10, unit: '件', status: 'in_transit', purchaseOrderRefs: [{ tpOrderNo: 'PO1', tpLineNo: '1' }] };
  const line: any = { id: 'line1', tpOrderNo: 'PO1', tpLineNo: '1', inventoryCode: 'C1', unit: '件', receivedQty: 10, receipts: [] };
  let refs: any[] = [{ taskId: 't2', tpOrderNo: 'PO1', tpLineNo: '1' }];
  const db: any = { procStockPlan: { findUnique: async () => ({ tasks: [task] }) }, procPurchaseOrderMirror: { findMany: async () => [line] }, procPurchaseOrderRef: { findMany: async () => refs }, runtimeState: { findMany: async () => [] } };
  let row = (await readStockPlanExecution(db, 'plan1')).tasks[0];
  assert.equal(row.stage, '待核对'); assert.equal(row.signedQty, null); assert.match(row.orders[0].issues[0], /重复关联/);
  refs = []; line.unit = '箱';
  row = (await readStockPlanExecution(db, 'plan1')).tasks[0];
  assert.equal(row.inTransitQty, null); assert.match(row.orders[0].issues[0], /单位不一致/);
  task.purchaseOrderRefs = [];
  row = (await readStockPlanExecution(db, 'plan1')).tasks[0];
  assert.equal(row.stage, '待下单'); assert.equal(row.orderedQty, 0);
});
