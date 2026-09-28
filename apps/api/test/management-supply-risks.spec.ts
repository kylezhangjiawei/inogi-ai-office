import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ManagementRiskService } from '../src/modules/procurement/management-risk.service';
import { deliveryKey, deliverySource, deliverySourceIdentity } from '../src/modules/procurement/purchase-delivery-store';
import { KEY_MATERIAL_CLUES } from '../src/modules/procurement/key-material-clues';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const actor = (permissions: string[]) => ({ id: 'viewer', name: '查看人', permissions });
const task = (id: string, patch = {}) => ({ id, code: `TASK-${id}`, productId: 'P1', materialId: 'M1', materialName: '同名料', unit: '件', quantity: 10, arrivedQty: 0, status: 'in_transit', businessDone: false, buyer: '真实采购', deadline: null, needDate: date('2026-09-01'), expectedArrivalDate: date('2026-09-01'), createdAt: date('2026-08-01'), purchaseOrderRefs: [], ...patch });
const order = (id: string, patch = {}) => ({ id, tpOrderNo: `PO/${id}`, tpOrderId: id, tpLineNo: '1', materialId: 'M1', inventoryCode: 'M-1', inventoryName: '同名料', spec: '', unit: '件', supplierName: '供方', orderedQty: 10, receivedQty: 0, orderDate: date('2026-08-01'), etaDate: date('2026-09-01'), status: null, approvalStatus: null, availability: null, syncedAt: date('2026-09-10'), ...patch });
const quality = (id: string, patch = {}) => ({ id, productId: 'P1', materialId: 'M1', taskId: null, source: 'procurement', issue: '原不良6件', batchNo: 'LOT-A', inspectionDate: date('2026-08-20'), defectiveQty: 6, unit: '件', status: 'open', ...patch });
function fixture() {
  const tasks: any[] = [], orders: any[] = [], qualityRows: any[] = [], plans: any[] = [], states = new Map<string, string>(), calls: string[] = [];
  const db = {
    systemSetting: { findUnique: async () => ({ value: [{ id: 'P1', name: '同名产品' }, { id: 'P2', name: '同名产品' }, { id: 'PRIVATE', name: '未授权来源产品' }] }) },
    procTask: { findMany: async ({ where }: any) => { calls.push('tasks'); return tasks.filter(row => row.createdAt < where.createdAt.lt); } },
    procPurchaseOrderMirror: { findMany: async ({ where }: any) => { calls.push('orders'); return orders.filter(row => !row.orderDate || row.orderDate < where.OR[0].orderDate.lt); } },
    procQualityRecord: { findMany: async ({ where }: any) => { calls.push('quality'); return qualityRows.filter(row => row.status !== 'closed' && row.inspectionDate < where.inspectionDate.lt && row.inspectionDate <= where.inspectionDate.lte); } },
    runtimeState: {
      findUnique: async ({ where }: any) => states.has(where.key) ? { key: where.key, value: states.get(where.key) } : null,
      findMany: async ({ where }: any) => { if (where.key.startsWith) { calls.push('production-history'); return plans.map(plan => ({ value: JSON.stringify(plan) })); } return [...states].filter(([key]) => where.key.in.includes(key)).map(([key,value]) => ({key,value})); },
    },
  };
  const service = new ManagementRiskService(db as never, { list: async () => { calls.push('production'); return plans; } } as never, { calculate: async () => assert.fail('fixture has no batches') } as never);
  return { service, tasks, orders, qualityRows, plans, states, calls };
}

test('F02: supply-only permissions read only original permitted sources; production figures are null, not zero', async () => {
  const f = fixture(); f.tasks.push(task('own')); f.orders.push(order('hidden')); f.qualityRows.push(quality('open'));
  const result = await f.service.read('2026-09', undefined, actor(['page:proc-cockpit']));
  assert.deepEqual(result.risks.map(row => row.id).sort(), ['procurement:own', 'quality:open']);
  assert.deepEqual(f.calls, ['tasks', 'quality']); assert.equal(result.scopes.production, false); assert.equal(result.completed, null); assert.equal(result.remaining, null); assert.equal(result.firstFinal, null); assert.deepEqual(result.batches, []);
  await assert.rejects(f.service.read('2026-09', undefined, actor(['page:proc-my-workspace'])), /权限/);
  await assert.rejects(f.service.read('2026-09', undefined, { ...actor(['*']), id: '' }), /权限/);
});

test('F02: only overdue incomplete procurement dates count, without using demand date as missing arrival fallback', async () => {
  const f = fixture(); f.tasks.push(task('overdue'), task('arrived', { arrivedQty: 10 }), task('cancelled', { status: 'cancelled' }), task('completed', { status: 'completed' }), task('business-done', { businessDone: true }), task('undated', { expectedArrivalDate: null }), task('future', { expectedArrivalDate: date('2999-01-01') }), task('inquiry', { status: 'inquiring', deadline: date('2026-09-02') }));
  const result = await f.service.read('2026-09', undefined, actor(['page:proc-cockpit']));
  assert.deepEqual(result.risks.map(row => row.id), ['procurement:overdue', 'procurement:inquiry']); assert.equal(result.risks[0].owner, '真实采购');
  assert.deepEqual(result.risks[0].target, { type: 'procurement', taskId: 'overdue' });
});

test('F02: outstanding PO lines use latest valid commitment; withdrawal/stale/void/received/missing are not fabricated overdue risks', async () => {
  const f = fixture();
  for (const row of [order('erp'), order('promise'), order('withdraw'), order('stale'), order('void', { status: '已取消' }), order('received', { receivedQty: 10 }), order('undated', { etaDate: null }), order('future', { etaDate: date('2999-01-01') })]) f.orders.push(row);
  for (const id of ['promise','withdraw','stale']) {
    const row = f.orders.find(item => item.id === id), sourceIdentity = deliverySourceIdentity(id === 'stale' ? { ...row, supplierName: '旧供方' } : row), after = id === 'withdraw' ? null : '2026-09-05';
    const lastEntry = { version: 1, kind: after ? 'revision' : 'withdrawal', before: null, after, communicatedOn: '2026-09-01', evidence: '真实沟通凭据', reason: '供应商更新', actorId: 'recorder', actorName: '登记人不是采购负责人', recordedAt: '2026-09-01T01:00:00.000Z', sourceIdentity, source: deliverySource(row) };
    f.states.set(deliveryKey('supplier', id), JSON.stringify({ version: 1, sourceIdentity, currentDate: after, originalDate: null, lastEntry }));
  }
  const result = await f.service.read('2026-09', undefined, actor(['page:purchase-orders']));
  assert.deepEqual(result.risks.map(row => row.id), ['purchase-order:erp','purchase-order:promise']); assert.equal(result.risks[1].dueDate, '2026-09-05');
  assert.ok(result.risks.every(row => row.owner === null)); assert.deepEqual(f.calls, ['orders']); assert.match(result.risks[0].note, /ERP 未收 10 件/);
});

test('F02: confirmed exact PO line links collapse arrival risk, but same-name unrelated material and separate deadlines do not merge', async () => {
  const f = fixture(), po = order('shared'); f.orders.push(po);
  const refs = [{ tpOrderNo: po.tpOrderNo, tpOrderId: po.tpOrderId, tpLineNo: po.tpLineNo }];
  f.tasks.push(task('a', { purchaseOrderRefs: refs }), task('b', { purchaseOrderRefs: refs }), task('wrong-material', { materialId: 'OTHER', purchaseOrderRefs: refs }), task('deadline', { status: 'inquiring', purchaseOrderRefs: refs, deadline: date('2026-09-01') }));
  const result = await f.service.read('2026-09', 'P1', actor(['page:proc-cockpit', 'page:purchase-order-detail']));
  assert.deepEqual(result.risks.map(row => row.id).sort(), ['procurement:deadline','procurement:wrong-material','purchase-order:shared']);
  assert.deepEqual(result.risks.find(row => row.kind === 'purchase-order')!.target, { type: 'purchase-order', orderNo: 'PO/shared', lineId: 'shared' });
});

test('F02: product filtering uses stable IDs; unmapped PO remains only in all products, no task data without task permission', async () => {
  const f = fixture(), po = order('linked'); f.orders.push(po, order('unmapped'));
  f.tasks.push(task('linked-task', { purchaseOrderRefs: [{ tpOrderNo: po.tpOrderNo, tpLineNo: po.tpLineNo }] }), task('other-product', { productId: 'P2' }));
  const result = await f.service.read('2026-09', 'P1', actor(['page:proc-cockpit', 'page:purchase-orders']));
  assert.deepEqual(result.risks.map(row => row.id), ['purchase-order:linked']);
  assert.deepEqual(result.products.map(row => row.id), ['P1','P2']); assert.ok(result.products.every(row => row.name === '同名产品'));
  const ordersOnly = await f.service.read('2026-09', 'P1', actor(['page:purchase-orders'])); assert.deepEqual(ordersOnly.risks, []);
  const all = await f.service.read('2026-09', undefined, actor(['page:purchase-orders'])); assert.equal(all.risks.length, 2); assert.ok(all.risks.every(row => row.product === '产品归属待确认'));
});

test('F02: quality records include independent sources and carryover, retain true units and explicit collaborator, exclude closed/future records', async () => {
  const f = fixture(); f.qualityRows.push(quality('proc'), quality('warehouse', { source: 'warehouse', unit: '台', inspectionDate: date('2026-09-02') }), quality('closed', { status: 'closed' }), quality('future', { inspectionDate: date('2999-01-01') }));
  f.states.set('procurement:execution:v1:collaboration:warehouse', JSON.stringify({ ownerName: '质量协同人', dueDate: '2026-09-25' }));
  const result = await f.service.read('2026-09', undefined, actor(['proc-quality:verify']));
  assert.equal(result.risks.length, 2); const old = result.risks.find(row => row.id === 'quality:proc')!; assert.equal(old.period, 'carryover'); assert.equal(old.owner, null); assert.equal(old.dueDate, null);
  const current = result.risks.find(row => row.id === 'quality:warehouse')!; assert.equal(current.owner, '质量协同人'); assert.equal(current.dueDate, '2026-09-25'); assert.match(current.note, /6 台/); assert.deepEqual(current.target, { type: 'quality', qualityId: 'warehouse' });
});

test('F02: same quality ID from production and supply appears once with combined actual batches', async () => {
  const f = fixture(), q = quality('same'); f.qualityRows.push(q);
  f.plans.push({ id: 'plan', productId: 'P1', productName: '真实产品', productLine: 'Q7', month: '2026-09', targetQty: 0, summary: { completedQty: 0, remainingQty: 0 }, batches: [], tasks: [{ id: 'job', batchId: 'B', status: 'dispatched', date: '2999-01-01', quantity: 0, reports: [], inspections: [{ date: '2026-08-20', quantity: 6, goodQty: 0, quality: { ...q, collaboration: null } }], fieldIssues: [{ quality: { ...q, collaboration: null } }] }] });
  const result = await f.service.read('2026-09', undefined, actor(['page:production-execution','production:view-all']));
  assert.equal(result.risks.length, 1); assert.equal(result.risks[0].id, 'quality:same'); assert.equal(result.risks[0].planId, 'plan'); assert.ok(result.risks[0].batchCodes.includes('LOT-A')); assert.equal(result.risks[0].period, 'carryover');
});

test('F02: key material context requires its own page permission and confirmed real material mapping, not unfilled meeting clues', async () => {
  const f = fixture(); f.tasks.push(task('risk')); f.states.set(`procurement:key-materials:v1:current:${KEY_MATERIAL_CLUES[0].id}`, JSON.stringify({ inclusion: 'included', materialIds: ['M1'] }));
  const hidden = await f.service.read('2026-09', undefined, actor(['page:proc-cockpit'])); assert.equal(hidden.risks[0].keyMaterialId, undefined);
  const visible = await f.service.read('2026-09', undefined, actor(['page:proc-cockpit','page:proc-key-materials'])); assert.equal(visible.risks[0].keyMaterialId, 'M1'); assert.equal(visible.risks.length, 1);
});

test('F02: historical month excludes later source records and does not label later deadlines overdue', async () => {
  const f = fixture(); f.tasks.push(task('carry', { expectedArrivalDate: date('2026-07-01') }), task('month-end', { expectedArrivalDate: date('2026-08-31') }), task('after', { expectedArrivalDate: date('2026-09-01') }), task('created-later', { createdAt: date('2026-09-01'), expectedArrivalDate: date('2026-07-01') }));
  const result = await f.service.read('2026-08', undefined, actor(['page:proc-cockpit'])); assert.deepEqual(result.risks.map(row => row.id), ['procurement:carry','procurement:month-end']); assert.equal(result.risks[0].period, 'carryover'); assert.equal(result.risks[1].period, 'current'); assert.match(result.notice, /不是历史状态快照/);
});

test('F02: corrupted promise evidence fails explicitly and cannot become ERP fallback or a false empty result', async () => {
  const f = fixture(); f.orders.push(order('broken')); f.states.set(deliveryKey('supplier', 'broken'), '{broken');
  await assert.rejects(f.service.read('2026-09', undefined, actor(['page:purchase-orders'])), /交期记录格式异常/);
});
