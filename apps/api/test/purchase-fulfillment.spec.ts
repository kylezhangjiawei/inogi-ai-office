import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { PurchaseFulfillmentService, parseFulfillmentState, recalculateStockPlanFulfillment } from '../src/modules/procurement/purchase-fulfillment.service';
import { calculatePurchaseFulfillment, emptyFulfillmentState } from '../src/modules/procurement/purchase-fulfillment.model';
import { PurchaseReceiptsService } from '../src/modules/procurement/purchase-receipts.service';
const decimal = (value: number) => new Prisma.Decimal(value);
const actor = { id: 'actor-1', name: '采购甲', permissions: ['page:purchase-order-detail', 'proc-purchase-order:adjust-fulfillment', 'proc-purchase-order:approve-fulfillment', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'] };
const instant = new Date('2026-09-10T01:00:00.000Z');
type Row = Record<string, any>;
function fixture() {
  const line: Row = { id: 'line-1', tpOrderId: 'ERP-1', tpOrderNo: 'PO-1', tpLineNo: '1', inventoryCode: 'SKU-1', inventoryName: '轴承', unit: '件', spec: 'V1', supplierName: '供应商甲', orderedQty: decimal(20), receivedQty: decimal(10), updatedAt: instant, status: 'approved', approvalStatus: 'approved' };
  const receipts: Row[] = [{ id: 'receipt-1', lineId: line.id, deliveryNo: 'DEL-1', receivedDate: new Date('2026-09-01'), receivedQty: decimal(10), version: 1, createdAt: instant, createdByName: '仓管', note: '', sourceOrderId: line.tpOrderId, sourceOrderNo: line.tpOrderNo, sourceLineNo: line.tpLineNo, sourceInventoryCode: line.inventoryCode, sourceInventoryName: line.inventoryName, sourceSpec: line.spec, sourceUnit: line.unit, sourceSupplierName: line.supplierName, sourceOrderedQty: line.orderedQty, sourceUpdatedAt: instant,
    inspections: [{ id: 'inspection-1', version: 1, inspectionDate: new Date('2026-09-02'), qualifiedQty: decimal(6), defectiveQty: decimal(1), pendingJudgmentQty: decimal(2), basis: '规范 A', note: '检验', createdByName: '检验员', createdAt: instant }] }];
  let states = new Map<string, string>(), audits: Row[] = [], failAudit = false, tail = Promise.resolve();
  const withReceipts = () => ({ ...line, receipts });
  const db: Row = {
    procMaterial: { findUnique: async () => ({ id: 'material-1', tpInventoryCode: 'SKU-1' }) },
    procPurchaseOrderMirror: { findUnique: async () => withReceipts(), findMany: async () => [withReceipts()] },
    procPurchaseReceipt: { findMany: async () => receipts, findUnique: async ({ where }: Row) => receipts.find((r) => r.requestId === where.requestId) ?? null,
      create: async ({ data }: Row) => { const saved = { ...data, id: `receipt-${receipts.length + 1}`, version: 0, inspections: [], createdAt: instant }; receipts.push(saved); return saved; },
      updateMany: async ({ where, data }: Row) => { const r = receipts.find((r) => r.id === where.id && r.version === where.version); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; } },
    procPurchaseReceiptInspection: { findUnique: async () => null, create: async ({ data }: Row) => { const r = receipts.find((r) => r.id === data.receiptId)!; const saved = { ...data, id: `inspection-${data.version}`, createdAt: instant }; r.inspections.unshift(saved); return saved; } },
    runtimeState: { findUnique: async ({ where }: Row) => states.has(where.key) ? { key: where.key, value: states.get(where.key) } : null,
      findMany: async () => [...states].map(([key, value]) => ({ key, value })), upsert: async ({ where, create, update }: Row) => { const value = states.has(where.key) ? update.value : create.value; states.set(where.key, value); return { key: where.key, value }; } },
    procStockPlan: { findMany: async () => [] }, auditLog: { create: async ({ data }: Row) => { if (failAudit) throw new Error('audit unavailable'); audits.push(data); return data; } }, $queryRaw: async () => [],
    $transaction: async (fn: (db: Row) => Promise<unknown>) => { const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous; const old = new Map(states), oldAudits = [...audits], oldReceipts = receipts.map((r) => ({ ...r, inspections: [...r.inspections] }));
      try { return await fn(db); } catch (e) { states = old; audits = oldAudits; receipts.splice(0, receipts.length, ...oldReceipts); throw e; } finally { release(); } },
  };
  const service = new PurchaseFulfillmentService(db as never); let counter = 0;
  const input = async (reason = 'QA 核对依据') => ({ requestId: `fulfillment-request-${++counter}`, expectedVersion: (await service.list(line.id, actor)).version, expectedSourceUpdatedAt: line.updatedAt.toISOString(), reason });
  const propose = async (kind: 'cancel' | 'return' | 'reversal' | 'coverage', quantity: number, extra: Row = {}) => service.propose(line.id, { ...await input(), kind, quantity, reflectedEntryIds: [], ...extra }, actor);
  const approve = async (id: string) => service.decide(line.id, id, 'approved', await input(), actor);
  return { line, receipts, db, service, input, propose, approve, audits: () => audits, failAudit: () => { failAudit = true; }, receiptsService: new PurchaseReceiptsService(db as never) };
}

test('ERP and local receipts are not added; unchecked coverage cannot yield available stock', async () => {
  const f = fixture(), view = await f.service.list('line-1', actor);
  assert.equal(view.summary.erpReceivedQty, 10); assert.equal(view.summary.localGrossReceivedQty, 10);
  assert.equal(view.summary.effectiveReceivedQty, 10); assert.equal(view.summary.remainingQty, 10); assert.equal(view.summary.qualifiedAvailableQty, null);
});
test('pending cancel has no effect; approved cancel reduces obligation and revocation restores it', async () => {
  const f = fixture(), proposed = await f.propose('cancel', 4); assert.equal(proposed.summary.remainingQty, 10);
  const id = proposed.entries[0].id, approved = await f.approve(id); assert.equal(approved.summary.remainingQty, 6);
  const revoked = await f.service.decide('line-1', id, 'revoked', await f.input('撤销协议'), actor);
  assert.equal(revoked.summary.remainingQty, 10); assert.deepEqual(revoked.entries[0].history.map((h) => h.action), ['proposed', 'approved', 'revoked']); assert.equal(f.audits().length, 3);
});
test('return preserves ordered obligation, deducts only chosen receipt bucket, and needs explicit ERP coverage', async () => {
  const f = fixture(), p = await f.propose('return', 2, { receiptId: 'receipt-1', bucket: 'qualified' });
  const adjusted = await f.approve(p.entries[0].id); assert.equal(adjusted.summary.localNetReceivedQty, 8); assert.equal(adjusted.summary.localQualifiedQty, 4); assert.equal(adjusted.summary.remainingQty, null);
  const c = await f.propose('coverage', 0); const covered = await f.approve(c.entries.at(-1)!.id);
  assert.equal(covered.summary.effectiveOrderedQty, 20); assert.equal(covered.summary.effectiveReceivedQty, 8); assert.equal(covered.summary.remainingQty, 12); assert.equal(covered.summary.qualifiedAvailableQty, 4);
});
test('ERP reflecting a return invalidates old coverage and recheck prevents deducting the same return twice', async () => {
  const f = fixture(), p = await f.propose('return', 2, { receiptId: 'receipt-1', bucket: 'qualified' }), id = p.entries[0].id;
  await f.approve(id); const c = await f.propose('coverage', 0); await f.approve(c.entries.at(-1)!.id);
  f.line.receivedQty = decimal(8); f.line.updatedAt = new Date('2026-09-11T01:00:00Z');
  assert.equal((await f.service.list('line-1', actor)).summary.remainingQty, null);
  await assert.rejects(f.propose('coverage', 0), /不一致/);
  const reflected = await f.propose('coverage', 0, { reflectedEntryIds: [id] }); const final = await f.approve(reflected.entries.at(-1)!.id);
  assert.equal(final.summary.effectiveReceivedQty, 8); assert.equal(final.summary.remainingQty, 12); assert.equal(final.summary.qualifiedAvailableQty, 4);
});
test('inspection revision makes coverage stale and cannot erase an approved returned bucket', async () => {
  const f = fixture(), p = await f.propose('return', 2, { receiptId: 'receipt-1', bucket: 'qualified' }); await f.approve(p.entries[0].id);
  const c = await f.propose('coverage', 0); await f.approve(c.entries.at(-1)!.id);
  await assert.rejects(f.receiptsService.inspect('line-1', 'receipt-1', { requestId: 'inspection-conflict-001', expectedSourceUpdatedAt: instant.toISOString(), expectedVersion: 1, inspectionDate: '2026-09-03', qualifiedQty: 1, defectiveQty: 5, pendingJudgmentQty: 2, basis: '复核', note: '改变判定' }, actor), /扣减/);
  f.receipts[0].version++; assert.equal((await f.service.list('line-1', actor)).summary.qualifiedAvailableQty, null);
});
test('reversal frees local receipt capacity for replacement delivery without changing raw receipt history', async () => {
  const f = fixture(); f.line.orderedQty = decimal(10);
  const p = await f.propose('reversal', 2, { receiptId: 'receipt-1', bucket: 'qualified' }); await f.approve(p.entries[0].id); const c = await f.propose('coverage', 0); await f.approve(c.entries.at(-1)!.id);
  const result = await f.receiptsService.receive('line-1', { requestId: 'replacement-receipt-0001', expectedSourceUpdatedAt: instant.toISOString(), deliveryNo: 'DEL-REPLACEMENT', receivedDate: '2026-09-03', receivedQty: 2, note: '补交' }, actor);
  assert.equal(result.receipts.length, 2); assert.equal(f.receipts[0].receivedQty.toNumber(), 10); assert.equal(result.fulfillment!.localNetReceivedQty, 10); assert.equal(result.fulfillment!.qualifiedAvailableQty, null);
});
test('cancel and bucket reductions reject excessive quantities, unsupported units and invalid decimals', async () => {
  const f = fixture(); await assert.rejects(f.propose('cancel', 11), /不能超过/);
  await assert.rejects(f.propose('return', 7, { receiptId: 'receipt-1', bucket: 'qualified' }), /超过/);
  await assert.rejects(f.propose('reversal', 1, { receiptId: 'wrong', bucket: 'pending' }), /超过/);
  for (const quantity of [NaN, -1, Infinity, 0.0001]) await assert.rejects(f.propose('cancel', quantity));
  f.line.unit = ''; await assert.rejects(f.propose('cancel', 1));
});
test('permission checks apply in service, approval and revoking approved entries need approval permission', async () => {
  const f = fixture(); await assert.rejects(f.service.list('line-1', { ...actor, permissions: ['proc-purchase-order:adjust-fulfillment'] }), /权限/);
  const p = await f.propose('cancel', 1); const noApprove = { ...actor, permissions: ['page:purchase-order-detail', 'proc-purchase-order:adjust-fulfillment'] };
  await assert.rejects(f.service.decide('line-1', p.entries[0].id, 'approved', await f.input(), noApprove), /权限/); await f.approve(p.entries[0].id);
  await assert.rejects(f.service.decide('line-1', p.entries[0].id, 'revoked', await f.input(), noApprove), /权限/);
});
test('stale version fails; same idempotency key and exact actor/payload retries without duplicating history', async () => {
  const f = fixture(), input = { ...await f.input(), kind: 'cancel' as const, quantity: 2, reflectedEntryIds: [] };
  await f.service.propose('line-1', input, actor); const retry = await f.service.propose('line-1', input, actor); assert.equal(retry.entries.length, 1); assert.equal(f.audits().length, 1);
  await assert.rejects(f.service.propose('line-1', { ...input, reason: '不同' }, actor), /提交标识/);
  await assert.rejects(f.service.propose('line-1', { ...input, requestId: 'new-stale-request-001' }, actor), /已更新/);
});
test('audit failure rolls back ledger; concurrent approve attempts cannot double-apply', async () => {
  const f = fixture(), p = await f.propose('cancel', 4), input = await f.input();
  const result = await Promise.allSettled([f.service.decide('line-1', p.entries[0].id, 'approved', input, actor), f.service.decide('line-1', p.entries[0].id, 'approved', { ...input, requestId: 'another-approval-001' }, actor)]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1); assert.equal((await f.service.list('line-1', actor)).summary.cancelledQty, 4);
  f.failAudit(); await assert.rejects(f.propose('cancel', 1), /audit/); assert.equal((await f.service.list('line-1', actor)).entries.length, 1);
});
test('corrupt persisted ledger fails closed rather than assuming zero adjustment', () => {
  for (const value of ['broken', '{}', '{"version":0,"entries":[{}],"requests":[]}']) assert.throws(() => parseFulfillmentState(value), /格式异常/);
});
test('plan totals do not let one over-received line offset another outstanding line; mixed units remain unknown', async () => {
  const f = fixture(); f.line.orderedQty = decimal(10); f.line.receivedQty = decimal(0); f.receipts.splice(0);
  const second: Row = { ...f.line, id: 'line-2', tpLineNo: '2', orderedQty: decimal(10), receivedQty: decimal(15), receipts: [] };
  f.db.procPurchaseOrderMirror.findMany = async () => [{ ...f.line, receipts: [] }, second];
  const batch = (id: string) => ({ id: `batch-${id}`, purchaseOrderMirrorId: id, purchaseOrderNo: 'PO-1', purchaseQty: decimal(10), receivedQty: decimal(0), qualifiedQty: decimal(0) });
  const plan = { id: 'plan-1', materialId: 'material-1', unit: '件', targetQty: decimal(20), batches: [batch('line-1'), batch('line-2')] };
  const result = await recalculateStockPlanFulfillment(f.db as never, plan); assert.equal(result.remainingToReceiveQty, 10); assert.equal(result.qualifiedQty, null);
  second.unit = '套'; const mixed = await recalculateStockPlanFulfillment(f.db as never, plan); assert.equal(mixed.orderedQty, null); assert.equal(mixed.remainingToReceiveQty, null);
});
test('pure calculation retains receipt identity and does not mutate source arrays', () => {
  const f = fixture(), state = emptyFulfillmentState(), before = JSON.stringify(f.receipts);
  const result = calculatePurchaseFulfillment(f.line as never, f.receipts as never, state);
  assert.equal(result.receipts[0].id, 'receipt-1'); assert.equal(JSON.stringify(f.receipts), before); assert.equal(state.entries.length, 0);
});
test('duplicate mirror references cannot count the same order supply twice', async () => {
  const f = fixture();
  const batch = { id: 'batch-1', purchaseOrderMirrorId: 'line-1', purchaseOrderNo: 'PO-1', purchaseQty: decimal(20), receivedQty: decimal(10), qualifiedQty: decimal(0) };
  const result = await recalculateStockPlanFulfillment(f.db as never, { id: 'plan-1', materialId: 'material-1', unit: '件', targetQty: decimal(40), batches: [batch, { ...batch, id: 'batch-2' }] });
  assert.equal(result.orderedQty, null); assert.equal(result.remainingToPurchaseQty, null); assert.match(result.issues.join(' '), /重复关联/);
});
test('revoking an adjustment already reflected in ERP cannot silently restore certain quantities', async () => {
  const f = fixture(), p = await f.propose('return', 2, { receiptId: 'receipt-1', bucket: 'qualified' }), id = p.entries[0].id; await f.approve(id);
  f.line.receivedQty = decimal(8); f.line.updatedAt = new Date('2026-09-11T01:00:00Z');
  const c = await f.propose('coverage', 0, { reflectedEntryIds: [id] }); await f.approve(c.entries.at(-1)!.id);
  const result = await f.service.decide('line-1', id, 'revoked', await f.input('撤销退货，ERP 尚未核对'), actor);
  assert.equal(result.summary.effectiveReceivedQty, null); assert.equal(result.summary.remainingQty, null); assert.equal(result.summary.qualifiedAvailableQty, null);
});
test('cancellation cannot erase locally recorded receipt even when ERP has not caught up', async () => {
  const f = fixture(); f.line.receivedQty = decimal(0);
  await assert.rejects(f.propose('cancel', 15), /本地实收/);
  const p = await f.propose('cancel', 10); const result = await f.approve(p.entries[0].id);
  assert.equal(result.summary.effectiveOrderedQty, 10);
});
test('same mirror ID changing ERP material no longer supplies the original stock plan', async () => {
  const f = fixture(); f.line.inventoryCode = 'SKU-DIFFERENT'; f.receipts.splice(0);
  const result = await recalculateStockPlanFulfillment(f.db as never, { id: 'plan-1', materialId: 'material-1', unit: '件', targetQty: decimal(20), batches: [{ id: 'batch-1', purchaseOrderMirrorId: 'line-1', purchaseOrderNo: 'PO-1', purchaseQty: decimal(20), receivedQty: decimal(10), qualifiedQty: decimal(0) }] });
  assert.equal(result.orderedQty, null); assert.equal(result.remainingToPurchaseQty, null); assert.match(result.issues.join(' '), /物料不一致/);
});
test('order-detail permission alone does not expose linked stock plans or even query them', async () => {
  const f = fixture(); f.db.procStockPlan.findMany = async () => { throw new Error('must not read plans'); };
  const result = await f.service.list('line-1', actor); assert.equal(result.canReadAffectedPlans, false); assert.deepEqual(result.affectedPlans, []);
});
