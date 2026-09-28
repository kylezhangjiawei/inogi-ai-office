import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { deliveryDatePage, purchaseTiming } from '../src/modules/procurement/purchase-timing';
import { deliverySourceIdentity, type SupplierDeliveryState } from '../src/modules/procurement/purchase-delivery-store';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import { ProductionScenarioService, scenarioProposals } from '../src/modules/procurement/production-scenario.service';
import { uniqueManagementRisks, ManagementRiskService, type ManagementRisk } from '../src/modules/procurement/management-risk.service';
const source: any = { tpOrderId: 'order', tpOrderNo: 'PO', tpLineNo: '1', inventoryCode: 'M', inventoryName: '料', spec: '', unit: '件', supplierName: '供方', orderedQty: 60, receivedQty: 0, etaDate: new Date('2026-09-10T00:00:00Z'), status: null, approvalStatus: null };
const availability: any = { availableDate: new Date('2026-09-16T00:00:00Z'), confirmedAt: new Date(), confirmedByName: '采购', version: 1, note: '检验排程', sourceFingerprint: purchaseOrderSourceFingerprint(source) };
const promise = (date: string | null): SupplierDeliveryState => ({ version: 1, currentDate: date, originalDate: '2026-09-10', sourceIdentity: deliverySourceIdentity(source), lastEntry: {} as any });
test('F11: ERP 10, promise 15, available 16 remain distinct; demand 14 cannot be on time', () => {
  const value = purchaseTiming(source, availability, promise('2026-09-15'));
  assert.equal(value.erpDate, '2026-09-10'); assert.equal(value.latestDate, '2026-09-15'); assert.equal(value.confirmedAvailableDate, '2026-09-16'); assert.ok(value.confirmedAvailableDate! > '2026-09-14');
  const conflict = purchaseTiming(source, { ...availability, availableDate: new Date('2026-09-11T00:00:00Z') }, promise('2026-09-15'));
  assert.equal(conflict.confirmedAvailableDate, null); assert.equal(conflict.timingConflict, true);
});
test('F11: withdrawn or obsolete commitments do not revive ERP date, missing commitments can use labelled ERP fallback', () => {
  assert.equal(purchaseTiming(source, availability, null).latestDate, '2026-09-10');
  assert.equal(purchaseTiming(source, availability, promise(null)).latestDate, null);
  assert.equal(purchaseTiming({ ...source, supplierName: '另一供方' }, availability, promise('2026-09-15')).confirmedAvailableDate, null);
});
test('review: cancelled orders retain date evidence but never appear as confirmed available supply', () => {
  const cancelled = { ...source, status: '已取消' }, saved = { ...availability, sourceFingerprint: purchaseOrderSourceFingerprint(cancelled) };
  const result = purchaseTiming(cancelled, saved, null);
  assert.equal(result.availableDate, '2026-09-16'); assert.equal(result.confirmedAvailableDate, null); assert.equal(result.needsReconfirmation, true); assert.match(result.note, /取消/);
});
test('F11: selected calendar basis determines counts, missing dates, ordering, and page clamping together', () => {
  const rows = [{ lineId: 'a', calendarDate: '2026-09-15' }, { lineId: 'b', calendarDate: null }, { lineId: 'c', calendarDate: '2026-10-01' }, { lineId: 'd', calendarDate: '2026-09-15' }];
  const result = deliveryDatePage(rows, '2026-09', 'month', null, 9, 1);
  assert.deepEqual(result.summary, { all: 4, inMonth: 2, undated: 1, outside: 1 }); assert.equal(result.rows.page, 2); assert.equal(result.rows.items[0].lineId, 'd'); assert.deepEqual(result.days, [{ date: '2026-09-15', count: 2 }]);
  assert.equal(deliveryDatePage(rows, '2026-09', 'all', '2026-09-10', 1, 20).rows.total, 0);
});
test('F17: invalid, duplicate and foreign hypothetical supply fails and late proposal remains explicit', () => {
  const codes = new Set(['M']);
  assert.throws(() => scenarioProposals([{ code: 'X', quantity: 2, availableDate: '2026-10-01' }], codes, '2026-10-02'));
  assert.throws(() => scenarioProposals([{ code: 'M', quantity: -2, availableDate: '2026-10-01' }], codes, '2026-10-02'));
  const input = { code: 'M', quantity: 2, availableDate: '2026-10-05' };
  assert.throws(() => scenarioProposals([input, input], codes, '2026-10-02'));
  assert.equal(scenarioProposals([input], codes, '2026-10-02')[0].onTime, false);
});
test('F17: no formal plan required; scenario supply remains separate and no command/write capability is used', async () => {
  const service = new ProductionScenarioService({ bom: async () => ({ items: [{ id: 'M', code: 'M', name: '料', unit: '件', qtyPer: 1 }], invalid: 0 }) } as any,
    { simulate: async (plan: any) => { assert.equal(plan.version, 0); assert.equal(plan.tasks.length, 0); return { currentSets: 240, lines: [{ code: 'M', qtyPer: 1, remainingDemand: 1000, current: 240, projected: 240, problems: [] }] }; } } as any);
  const base = { month: '2026-10', date: '2026-10-14', productLine: 'Q7', targetQty: 1000 };
  const onTime = await service.simulate({ ...base, proposals: [{ code: 'M', quantity: 760, availableDate: '2026-10-13' }] }, { id: 'u', name: 'u', permissions: ['*'] });
  assert.equal(onTime.currentSets, 240); assert.equal(onTime.scenarioSets, 1000); assert.equal(onTime.lines[0].scenarioGap, 0); assert.equal(onTime.kind, 'draft-scenario');
  const late = await service.simulate({ ...base, proposals: [{ code: 'M', quantity: 760, availableDate: '2026-10-15' }] }, { id: 'u', name: 'u', permissions: ['*'] });
  assert.equal(late.scenarioSets, 240); assert.equal(late.lines[0].scenarioGap, 760);
  await assert.rejects(service.simulate({ ...base, date: '2026-11-01' }, { id: 'u', name: 'u', permissions: ['*'] }), /所选月份/);
});
test('F02: same original quality ID is one risk, affected batch set merges, no inferred owner or deadline', () => {
  const row: ManagementRisk = { id: 'quality:original', kind: 'quality', title: '同6件', owner: null, dueDate: null, planId: 'p', batchCodes: ['A'], product: 'Q7', note: '' };
  const rows = uniqueManagementRisks([row, { ...row, batchCodes: ['B','A'] }]);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].batchCodes, ['A','B']); assert.equal(rows[0].owner, null); assert.equal(rows[0].dueDate, null);
});
test('F02: assigned-only actor cannot obtain management wide records', async () => {
  const service = new ManagementRiskService({} as any, { list: () => { throw new Error('must not query'); } } as any, {} as any);
  await assert.rejects(service.read('2026-09', undefined, { id: 'worker', name: 'worker', permissions: ['page:production-execution','proc-production:report'] }), /权限/);
});

function riskPlan(id: string, month = '2026-09', productId = 'P'): any {
  return { id, month, productId, productName: productId, productLine: 'Q7', targetQty: 100, shipmentTargetQty: 0, bom: [], bomFingerprint: 'bom', version: 1, batches: [], tasks: [], events: [], summary: { completedQty: 0, remainingQty: 100 } };
}
function riskFixture(visible: any[], historical = visible, calculate: any = async () => ({ remainingQty: 100, currentSets: 0, projectedSets: 0, lines: [] })) {
  const prisma = { procQualityRecord: { findMany: async () => [] }, runtimeState: { findUnique: async () => null, findMany: async () => historical.map(plan => ({ value: JSON.stringify(plan) })) } };
  return new ManagementRiskService(prisma as any, { list: async () => visible } as any, { calculate } as any);
}
const managementActor = { id: 'manager', name: '计划', permissions: ['page:production-execution', 'production:view-all'] };

test('review: first-final denominator includes completed carryover, excludes process/legacy/cancelled/other-product/future-month records', async () => {
  const current = riskPlan('current'), completedCarryover = riskPlan('carryover', '2026-08'), other = riskPlan('other', '2026-09', 'OTHER'), future = riskPlan('future', '2026-10');
  const task = (id: string, inspections: any[]) => ({ id, output: 'whole', status: 'dispatched', quantity: 100, date: '2999-01-01', reports: [], inspections, fieldIssues: [] });
  const inspect = (kind: string, quantity: number, goodQty: number) => ({ kind, quantity, goodQty, date: '2026-09-10', quality: null });
  current.tasks = [task('current-task', [inspect('final', 80, 72), inspect('process', 60, 60), inspect('legacy', 10, 10)]), { ...task('cancelled', [inspect('final', 1000, 1000)]), status: 'cancelled' }];
  completedCarryover.tasks = [task('done-task', [inspect('final', 20, 18)])];
  other.tasks = [task('other-task', [inspect('final', 500, 500)])]; future.tasks = [task('future-task', [inspect('final', 500, 500)])];
  const service = riskFixture([current], [current, completedCarryover, other, future]);
  const result = await service.read('2026-09', 'P', managementActor);
  assert.deepEqual(result.firstFinal, { quantity: 100, goodQty: 90, firstPassRate: 90 });
});

test('review: failed batch readiness stays a pending risk and retains inspected remaining quantity', async () => {
  const plan = riskPlan('plan'); plan.batches = [{ id: 'B', code: 'B1', quantity: 100, dueDate: '2026-09-30' }];
  plan.tasks = [{ id: 'task', batchId: 'B', output: 'whole', status: 'dispatched', quantity: 100, unit: '台', date: '2999-01-01', reports: [{ quantity: 60, goodQty: 56 }], fieldIssues: [], inspections: [{ kind: 'final', quantity: 60, goodQty: 56, verifiedGoodQty: 0, date: '2026-09-20', quality: null }] }];
  const result = await riskFixture([plan], [plan], async () => { throw new Error('snapshot unavailable'); }).read('2026-09', undefined, managementActor);
  assert.equal(result.batches[0].remaining, 44); assert.equal(result.batches[0].current, null); assert.equal(result.risks[0].kind, 'material'); assert.match(result.risks[0].note, /读取失败/);
});

test('review: complete reporting plus process-only inspection cannot clear an overdue completion risk', async () => {
  const plan = riskPlan('plan'); plan.tasks = [{ id: 'task', batchId: 'B', name: '整机装配', output: 'whole', status: 'dispatched', quantity: 100, unit: '台', date: '2000-01-01', reports: [{ quantity: 100 }], fieldIssues: [], inspections: [{ kind: 'process', quantity: 100, goodQty: 100, date: '2026-09-20', quality: null }] }];
  const result = await riskFixture([plan]).read('2026-09', undefined, managementActor);
  assert.equal(result.risks[0].kind, 'schedule'); assert.match(result.risks[0].note, /待终检或复验/); assert.ok(result.firstFinal); assert.equal(result.firstFinal.quantity, 0);
});

test('review: scenario rejects non-finite and duplicate BOM before invoking any supply read', async () => {
  for (const items of [[{ id: 'M', code: 'M', name: '料', unit: '件', qtyPer: Infinity }], [{ id: 'M1', code: 'M', name: '料', unit: '件', qtyPer: 1 }, { id: 'M2', code: 'M', name: '料', unit: '件', qtyPer: 2 }]]) {
    const service = new ProductionScenarioService({ bom: async () => ({ items, invalid: 0 }) } as any, { simulate: () => assert.fail('must reject before supply read') } as any);
    await assert.rejects(service.simulate({ month: '2026-10', date: '2026-10-14', productLine: 'Q7', targetQty: 1000 }, { id: 'u', name: 'u', permissions: ['*'] }), /BOM/);
  }
});

test('review: an empty or unknown readiness basis is not a complete BOM and cannot disappear from risk counts', async () => {
  const plan = riskPlan('plan'); plan.batches = [{ id: 'B', code: 'B1', quantity: 100, dueDate: '2026-09-30' }];
  const result = await riskFixture([plan], [plan], async () => ({ remainingQty: 100, currentSets: null, projectedSets: null, lines: [] })).read('2026-09', undefined, managementActor);
  assert.equal(result.risks.length, 1); assert.equal(result.risks[0].kind, 'material'); assert.match(result.batches[0].note, /待核对/); assert.ok(!result.batches[0].note.includes('已核对'));
});
