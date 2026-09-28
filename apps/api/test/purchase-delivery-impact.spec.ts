import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PurchaseDeliveryService } from '../src/modules/procurement/purchase-delivery.service';
import { batchScopeId } from '../src/modules/procurement/readiness-scope';

type Row = Record<string, any>;
const actor = { id: 'planner', name: '计划员', permissions: ['page:purchase-order-detail', 'page:production-execution', 'production:view-all'] };
const line = { id: 'line-1', tpOrderNo: 'PO-real', inventoryCode: 'MAT-real', unit: '件' };
const plan = (id = 'plan-real', batches: Row[] = []) => ({ id, month: '2026-09', productName: '真实产品', productLine: 'Q7', batches });
const batch = { id: 'batch-real', code: 'B-0920', dueDate: '2026-09-25' };
const order = (extra: Row = {}) => ({ id: line.id, canAllocate: true, allocationStatus: 'confirmed', allocatedQty: 15, date: '2026-09-24', note: '当前正式依据', ...extra });
function fixture({ plans = [plan('plan-real', [batch])], allocations = [{ planId: batchScopeId('plan-real', batch.id), quantity: 15 }], result = order(), fail = false }: { plans?: Row[]; allocations?: Row[] | null; result?: Row | null; fail?: boolean } = {}) {
  const calls: Row[] = [], queries: Row[] = [], transactions: Row[] = [];
  const db: Row = {
    procPurchaseOrderMirror: { findFirst: async ({ where }: Row) => { queries.push({ kind: 'line', where }); return where.id === line.id && where.tpOrderNo === line.tpOrderNo ? line : null; } },
    runtimeState: {
      findUnique: async ({ where }: Row) => { queries.push({ kind: 'ledger', where }); assert.equal(where.key, `procurement:readiness:v1:purchase:${line.id}`); return allocations === null ? null : { value: JSON.stringify({ version: 1, allocations, history: [] }) }; },
      findMany: async ({ where }: Row) => { queries.push({ kind: 'plans', where }); assert.equal(where.key.startsWith, 'procurement:execution:v1:plan:'); return plans.map(row => ({ value: JSON.stringify(row) })); },
    },
    $transaction: async (run: (tx: Row) => unknown, options: Row) => { transactions.push(options); return run(db); },
  };
  const readiness = { calculate: async (_db: Row, planId: string, date: string, batchId?: string) => { assert.equal(_db, db); calls.push({ planId, date, batchId }); if (fail) throw new Error('unavailable'); return { lines: [{ code: line.inventoryCode, purchase: result ? [result] : [] }] }; } };
  return { service: new PurchaseDeliveryService(db as never, readiness as never), calls, queries, transactions };
}
const read = (f: ReturnType<typeof fixture>, extra: Row = {}, who = actor) => f.service.impacts(line.id, { orderNo: line.tpOrderNo, ...extra }, who);

test('F11 impact requires original order and full readiness read permissions before querying', async () => {
  for (const permissions of [[], ['page:purchase-order-detail'], ['page:production-execution', 'production:view-all'], ['page:purchase-orders', 'page:production-execution'], ['page:purchase-orders', 'production:view-all']]) {
    const f = fixture(); await assert.rejects(read(f, {}, { ...actor, permissions }), /权限/); assert.equal(f.queries.length, 0); assert.equal(f.transactions.length, 0);
  }
  for (const permissions of [['*'], ['page:purchase-orders', 'page:production-execution', 'production:inspect'], ['page:purchase-orders', 'page:production-execution', 'production:plan']]) assert.equal((await read(fixture(), {}, { ...actor, permissions })).total, 1);
});
test('F11 exact original line/order identity and page validation cannot expose plans', async () => {
  const f = fixture(); await assert.rejects(read(f, { orderNo: 'PO-other' }), /不存在/); assert.equal(f.queries.length, 1); assert.equal(f.calls.length, 0);
  for (const page of [0, -1, 1.5, 'invalid']) { const g = fixture(); await assert.rejects(read(g, { page }), /分页/); assert.equal(g.queries.length, 0); }
});
test('F11 no ledger or released allocation does not guess relationships from identical materials', async () => {
  for (const allocations of [null, [{ planId: 'plan-real', quantity: 0 }]]) {
    const f = fixture({ allocations }); const result = await read(f); assert.equal(result.total, 0); assert.deepEqual(result.items, []); assert.equal(f.calls.length, 0); assert.equal(f.queries.some(row => row.kind === 'plans'), false);
  }
});
test('F11 actual batch identity, demand day and inspection-adjusted supply are recalculated in one read snapshot', async () => {
  const f = fixture(), result = await read(f), row = result.items[0];
  assert.equal(row.planId, 'plan-real'); assert.equal(row.batchId, batch.id); assert.equal(row.batchCode, batch.code); assert.equal(row.month, '2026-09');
  assert.equal(row.needDate, batch.dueDate); assert.equal(row.availableDate, '2026-09-24'); assert.equal(row.assignedQty, 15); assert.equal(row.effectiveQty, 15); assert.equal(row.onTimeQty, 15); assert.equal(row.status, 'on_time');
  assert.deepEqual(f.calls, [{ planId: 'plan-real', date: batch.dueDate, batchId: batch.id }]); assert.equal(f.transactions[0].isolationLevel, 'RepeatableRead');
  const late = (await read(fixture({ result: order({ date: '2026-09-28' }) }))).items[0]; assert.equal(late.effectiveQty, 15); assert.equal(late.onTimeQty, 0); assert.equal(late.delayDays, 3); assert.equal(late.status, 'late');
});
test('F11 source invalidation, missing association and failed calculation stay unknown rather than zero', async () => {
  for (const options of [{ result: order({ allocationStatus: 'stale', allocatedQty: 0 }) }, { result: order({ canAllocate: false, allocatedQty: 15 }) }, { result: null }, { fail: true }]) {
    const row = (await read(fixture(options))).items[0]; assert.equal(row.assignedQty, 15); assert.equal(row.effectiveQty, null); assert.equal(row.onTimeQty, null); assert.equal(row.status, 'pending');
  }
});
test('F11 monthly scope has no invented demand day; removed batches are counted without fake links', async () => {
  const f = fixture({ allocations: [{ planId: 'plan-real', quantity: 15 }, { planId: batchScopeId('plan-real', 'deleted'), quantity: 9 }, { planId: 'deleted-plan', quantity: 1 }, { planId: batchScopeId('plan-real', batch.id), quantity: 0 }] });
  const result = await read(f); assert.equal(result.total, 1); assert.equal(result.unresolvedCount, 2); assert.equal(result.items[0].needDate, null); assert.equal(result.items[0].batchId, null); assert.equal(result.items[0].onTimeQty, null); assert.equal(result.items[0].effectiveQty, 15); assert.equal(result.items[0].status, 'pending');
});
test('F11 pages perform at most ten current-scope calculations and clamp stale pages', async () => {
  const plans = Array.from({ length: 13 }, (_, i) => plan(`plan-${String(i).padStart(2, '0')}`)), allocations = plans.map(row => ({ planId: row.id, quantity: 1 }));
  const f = fixture({ plans, allocations }), first = await read(f), second = await read(f, { page: 99 });
  assert.equal(first.total, 13); assert.equal(first.items.length, 10); assert.equal(second.page, 2); assert.equal(second.items.length, 3); assert.equal(f.calls.length, 13); assert.equal(new Set([...first.items, ...second.items].map(row => row.scopeId)).size, 13);
});
test('F11 malformed or duplicate allocation quantities are rejected instead of presented as coverage', async () => {
  for (const allocations of [[{ planId: 'plan-real', quantity: -1 }], [{ planId: 'plan-real', quantity: null }], [{ planId: 'plan-real', quantity: 10 }, { planId: 'plan-real', quantity: 20 }]]) await assert.rejects(read(fixture({ allocations })), /分配记录异常/);
});
