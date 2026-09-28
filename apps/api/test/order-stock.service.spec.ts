import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { OrderStockService } from '../src/modules/order-processing/order-stock.service';
import { sourceOrderFingerprint } from '../src/modules/order-processing/order-material-mapping';
import { OrderProcessingService } from '../src/modules/order-processing/order-processing.service';
const actor = { id: 'u', name: '核对员', permissions: ['page:order-workbench', 'order-processing:material-map'] };
function fixture() {
  const line: any = { id: 'l', orderId: 'o', sku: 'ERP-V1', name: '阀', spec: '', unit: '件', orderQty: 3, stockQty: 999, updatedAt: new Date('2026-09-01'), materialId: null, mappingEvidence: null };
  const material: any = { id: 'm', name: '阀', tpInventoryCode: 'ERP-V1', spec: '', unit: '件', reviewStatus: 'approved' };
  const requests = new Map<string, any>(), audits: any[] = [];
  const db: any = {
    $transaction: async (run: any) => run(db),
    orderProcessingOrderProduct: { findMany: async () => [line], findUnique: async () => line, updateMany: async ({ where, data }: any) => { if (where.updatedAt.getTime() !== line.updatedAt.getTime()) return { count: 0 }; Object.assign(line, data, { updatedAt: new Date('2026-09-22') }); return { count: 1 }; } },
    procMaterial: { findMany: async () => [material], findUnique: async () => material },
    runtimeState: { findUnique: async ({ where }: any) => requests.get(where.key) ?? null, create: async ({ data }: any) => { requests.set(data.key, data); return data; } },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  const stock: any = { read: async ({ scope }: any) => ({ readAt: new Date().toISOString(), sourceToken: 's', scope, missingCodes: [], rows: [{ code: material.tpInventoryCode, warehouse: '成品仓', unit: '件', available: 2, state: 'known', issues: [] }] }) };
  const service = new OrderStockService(db, stock);
  const input = () => ({ materialId: 'm', expectedUpdatedAt: line.updatedAt.toISOString(), expectedSourceFingerprint: sourceOrderFingerprint(line), requestId: 'mapping-request-00001', reason: '与原始订单规格逐项核对' });
  return { service, db, line, material, audits, requests, input };
}
test('live shared stock, not historical 999; empty warehouse selection remains unknown', async () => {
  const f = fixture(); const [known] = await f.service.check([f.line], { kind: 'selected', warehouses: ['成品仓'] });
  assert.equal(known.availableQty, 2); assert.equal(known.sufficient, false); assert.equal(known.mappingState, 'exact');
  const [unknown] = await f.service.check([f.line], { kind: 'selected', warehouses: [] });
  assert.equal(unknown.availableQty, null); assert.equal(unknown.sufficient, null);
});
test('confirm permissions, source CAS, order ownership and idempotency; changed material invalidates mapping', async () => {
  const f = fixture(); f.line.sku = 'CUSTOMER-V';
  await assert.rejects(f.service.confirm('o', 'l', f.input(), { ...actor, permissions: ['page:order-workbench'] }));
  await assert.rejects(f.service.confirm('another-order', 'l', f.input(), actor));
  await assert.rejects(f.service.confirm('o', 'l', { ...f.input(), expectedSourceFingerprint: '0'.repeat(64) }, actor));
  assert.equal(f.audits.length, 0);
  const input = f.input(); await f.service.confirm('o', 'l', input, actor); await f.service.confirm('o', 'l', input, actor);
  assert.equal(f.audits.length, 1); assert.equal(f.line.materialId, 'm');
  await assert.rejects(f.service.confirm('o', 'l', { ...input, reason: 'changed' }, actor));
  f.material.tpInventoryCode = 'NEW';
  assert.equal((await f.service.check([f.line], { kind: 'selected', warehouses: ['成品仓'] }))[0].mappingState, 'stale');
});
test('read cannot call any write delegate; same customer-like SKU never gets name matched', async () => {
  const f = fixture(); f.line.sku = 'CUSTOMER';
  const fail = () => { throw new Error('READ_PATH_WROTE_DATABASE'); };
  for (const delegate of [f.db.orderProcessingOrderProduct, f.db.procMaterial, f.db.runtimeState, f.db.auditLog]) for (const key of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) delegate[key] = fail;
  const [result] = await f.service.check([f.line], { kind: 'selected', warehouses: ['成品仓'] });
  assert.equal(result.mappingState, 'unmatched'); assert.equal(result.availableQty, null);
});

test('empty workbench and missing templates/settings stay read-only', async () => {
  const fail = () => { throw new Error('READ_PATH_WROTE_DATABASE'); };
  const writes = { create: fail, createMany: fail, update: fail, updateMany: fail, upsert: fail, delete: fail, deleteMany: fail };
  const db: any = { orderProcessingOrder: { ...writes, count: async () => 0, findMany: async () => [] }, orderProcessingInvoiceTemplate: { ...writes, findMany: async () => [] }, orderProcessingSetting: { ...writes, findUnique: async () => null }, integrationConfig: { ...writes, count: async () => 0 } };
  const service = new OrderProcessingService(db, {} as any, {} as any, {} as any);
  const view = await service.getWorkbench({}, actor);
  assert.equal(view.orderDetails, null); assert.ok(view.templates.length); assert.ok(view.activeTemplateId);
});

test('quantity changes recheck sufficiency; deleted material evidence remains stale rather than rematched', async () => {
  const f = fixture(); f.line.sku = 'CUSTOMER'; await f.service.confirm('o', 'l', f.input(), actor);
  f.line.orderQty = 1;
  assert.equal((await f.service.check([f.line], { kind: 'selected', warehouses: ['成品仓'] }))[0].sufficient, true);
  f.line.materialId = null;
  const [deleted] = await f.service.check([f.line], { kind: 'selected', warehouses: ['成品仓'] });
  assert.equal(deleted.mappingState, 'stale'); assert.equal(deleted.availableQty, null);
});
