import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { warehouseStockExposure, pendingWarehouseIssues, type StockLedgerRecord } from '../src/modules/procurement/warehouse-stock-ledger.model';
import { warehouseBatchAllocation, validateSignedBatches, warehouseBatchTotals } from '../src/modules/procurement/warehouse-batches.model';
import { WarehouseRecordsService, WAREHOUSE_RECORD_PREFIX } from '../src/modules/procurement/warehouse-records.service';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
const record = (patch: Partial<StockLedgerRecord> = {}): StockLedgerRecord => ({ id: 'r1', kind: 'freeze', status: 'confirmed', code: 'V1', warehouse: '量产仓', unit: '件', quantity: 6, ...patch });
test('local restrictions deduplicate, validate units and require a strictly later ERP snapshot', () => {
  const freeze = record(), scrap = record({ id: 'r2', kind: 'scrap', quantity: 4, reconciliation: { at: '2026-09-20T00:00:00Z' } });
  assert.equal(warehouseStockExposure([freeze, freeze, scrap], 'V1', '量产仓', '件', new Date('2026-09-20')).frozenAndScrappedPending, 10);
  assert.equal(warehouseStockExposure([freeze, scrap], 'V1', '量产仓', '件', new Date('2026-09-21')).frozenAndScrappedPending, 6);
  assert.equal(warehouseStockExposure([record({ releasedAt: '2026-09-21' })], 'V1', '量产仓', '件', null).frozenAndScrappedPending, 0);
  assert.match(warehouseStockExposure([record({ unit: '箱' })], 'V1', '量产仓', '件', null).issues[0], /单位/);
  assert.match(warehouseStockExposure([freeze, record({ quantity: 7 })], 'V1', '量产仓', '件', null).issues[0], /冲突/);
});
test('receipts and returns remain non-additive while count losses stay a separate reduction', () => {
  const rows = [record({ kind: 'receipt', quantity: 62, qualifiedQty: 56, defectiveQty: 6 }), record({ id: 'r2', kind: 'count', quantity: -22 })];
  const result = warehouseStockExposure(rows, 'V1', '量产仓', '件', new Date('2026-09-20'));
  assert.equal(result.qualifiedPending, 56); assert.equal(result.defectivePending, 6); assert.equal(result.countReduction, 22); assert.equal(result.frozenAndScrappedPending, 0);
});
test('real stock batch allocation conserves quantity; unknown and legacy remain pending', () => {
  assert.deepEqual(warehouseBatchAllocation(10, {}), { batches: [], batchPendingQty: 10 });
  assert.deepEqual(warehouseBatchAllocation(10, { batches: [{ batchNo: 'STOCK-01', quantity: 6 }] }), { batches: [{ batchNo: 'STOCK-01', quantity: 6 }], batchPendingQty: 4 });
  assert.throws(() => warehouseBatchAllocation(10, { batches: [{ batchNo: 'B', quantity: 7 }, { batchNo: 'B', quantity: 3 }] }), /重复/);
  assert.throws(() => warehouseBatchAllocation(10, { batches: [{ batchNo: 'B', quantity: 11 }] }), /合计/);
  const issued = warehouseBatchAllocation(10, { batches: [{ batchNo: 'STOCK-01', quantity: 6 }] });
  assert.throws(() => validateSignedBatches(warehouseBatchAllocation(7, { batches: [{ batchNo: 'STOCK-01', quantity: 7 }] }), issued, { batches: [], batchPendingQty: 0 }), /超过/);
  assert.throws(() => validateSignedBatches(warehouseBatchAllocation(5, {}), issued, { batches: [], batchPendingQty: 0 }), /待补/);
  assert.deepEqual(warehouseBatchTotals([], 'V1', 'sign', 12), { batches: [], batchPendingQty: 12 });
});
test('issue coverage requires latest matched reconciliation plus subsequent sync; duplicate source is counted once', () => {
  const issue = { id: 'I', status: 'signed', lines: [{ code: 'V1', unit: '件' }], history: [{ id: 'e', action: 'issue', at: '2026-09-20', lines: [{ code: 'V1', warehouse: '量产仓', quantity: 4 }] }, { id: 'c', action: 'reconcile', at: '2026-09-21', reconciliation: { eventId: 'e', result: 'matched' } }] };
  assert.equal(pendingWarehouseIssues([issue, issue], 'V1', '量产仓', '件', new Date('2026-09-21')).quantity, 4);
  assert.equal(pendingWarehouseIssues([issue], 'V1', '量产仓', '件', new Date('2026-09-22')).quantity, 0);
});
test('freeze command protects quantity, permission, CAS and replay; converting to scrap preserves one restriction', async () => {
  const state = new Map<string, { key: string; value: string }>();
  const db: any = { runtimeState: {
    findUnique: async ({ where }: any) => state.get(where.key) ?? null,
    findMany: async ({ where }: any) => [...state.values()].filter(row => where.OR ? where.OR.some((scope: any) => row.key.startsWith(scope.key.startsWith)) : row.key.startsWith(where.key.startsWith)),
    create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, data); },
    updateMany: async ({ where, data }: any) => { if (state.get(where.key)?.value !== where.value) return { count: 0 }; state.set(where.key, { key: where.key, ...data }); return { count: 1 }; },
  }, procInventoryBalance: { findUnique: async () => ({ id: 'balance', unit: '件', availableQty: new Prisma.Decimal(10), syncedAt: new Date('2026-09-19'), material: { name: '阀体' } }) }, auditLog: { create: async () => {} } };
  db.$transaction = async (run: any) => run(db);
  const service = new WarehouseRecordsService(db), actor = { id: 'w', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:adjust'] };
  const input = { action: 'freeze', requestId: 'freeze-request-00001', data: { code: 'V1', warehouse: '量产仓', quantity: 6, reason: '质量隔离', stockBatchNo: 'REAL-1' } };
  await assert.rejects(service.command(input, { ...actor, permissions: ['page:warehouse-flow'] }), /权限/);
  const result = await service.command(input, actor); assert.deepEqual(await service.command(input, actor), result);
  await assert.rejects(service.command({ ...input, requestId: 'freeze-request-00002', data: { ...input.data, quantity: 5 } }, actor), /不足/);
  await assert.rejects(service.command({ action: 'scrap-freeze', requestId: 'scrap-request-00001', id: result.id, version: 99, data: { reason: '确认报废' } }, actor), /更新/);
  await service.command({ action: 'scrap-freeze', requestId: 'scrap-request-00001', id: result.id, version: 1, data: { reason: '确认报废' } }, actor);
  const row = JSON.parse(state.get(WAREHOUSE_RECORD_PREFIX + 'record:' + result.id)!.value);
  assert.equal(row.kind, 'scrap'); assert.equal(row.events.length, 2); assert.equal(row.stockBatchNo, 'REAL-1');
  assert.equal(warehouseStockExposure([row], 'V1', '量产仓', '件', null).frozenAndScrappedPending, 6);
});
test('inventory uses ERP baseline with non-additive receipt and links event provenance', async () => {
  const local = { ...record({ kind: 'receipt', quantity: 56, qualifiedQty: 56 }), name: '阀体', events: [{ action: 'receipt', at: '2026-09-20', actorName: '仓管', reason: '验收' }] };
  const loss = { ...record({ id: 'loss', kind: 'count', quantity: -22 }), name: '阀体', events: [] };
  const db: any = { runtimeState: { findMany: async () => [local, loss].map(row => ({ key: WAREHOUSE_RECORD_PREFIX + 'record:' + row.id, value: JSON.stringify(row) })) }, procInventoryBalance: { findMany: async () => [{ tpInventoryCode: 'V1', warehouse: '量产仓', materialName: '阀体', unit: '件', stockQty: 200, availableQty: 200, inTransitQty: 0, syncedAt: new Date('2026-09-19'), material: null }] }, procPurchaseOrderMirror: { findMany: async () => [] } };
  db.$transaction = async (run: any) => run(db);
  const result = await new TplusOperationsService(db).getInventoryDetail('V1');
  assert.equal(result.item.available, 178); assert.equal(result.item.erpAvailable, 200); assert.equal(result.item.warehouses[0].qualifiedPending, 56);
  assert.equal(result.movements.length, 1); assert.equal((result.movements[0] as any).recordId, 'r1');
});
