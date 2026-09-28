import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { ProductionReadinessService } from '../src/modules/procurement/production-readiness.service';
import { KeyMaterialsService } from '../src/modules/procurement/key-materials.service';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import { executionToday, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
import { deliveryKey, deliverySource, deliverySourceIdentity } from '../src/modules/procurement/purchase-delivery-store';

const today = executionToday(), day = new Date(`${today}T00:00:00.000Z`), d = (n: number) => new Prisma.Decimal(n);
const planner = { id: 'planner', name: '计划员', permissions: ['page:production-execution', 'production:plan'] };
function fixture(shared = true) {
  const bom = [{ id: 'M', code: 'M', name: '共享料', unit: '件', qtyPer: 1 }];
  const plans: ExecutionPlan[] = (shared ? ['A', 'B'] : ['A']).map(id => ({ id, month: today.slice(0, 7), version: 1, productId: id,
    productName: id, productLine: id, targetQty: 60, shipmentTargetQty: 60, bomFingerprint: 'v1', bom,
    batches: [{ id: `batch-${id}`, code: `batch-${id}`, quantity: 60, dueDate: today }], tasks: [], events: [] }));
  const state = new Map<string, { key: string; value: string }>(), audits: any[] = [];
  const put = (key: string, value: unknown) => state.set(key, { key, value: JSON.stringify(value) });
  const savePlans = () => plans.forEach(plan => put(`procurement:execution:v1:plan:${plan.id}`, plan)); savePlans();
  const order: any = { id: 'PO-line', tpOrderId: 'PO', tpOrderNo: 'PO-ONLY', tpLineNo: '1', inventoryCode: 'M', inventoryName: '共享料',
    spec: '', unit: '件', supplierName: '供应商', status: null, approvalStatus: null, orderedQty: d(60), receivedQty: d(0), etaDate: day, receipts: [] };
  const confirmDate = () => { order.availability = { availableDate: day, confirmedAt: day, confirmedByName: '采购', version: (order.availability?.version ?? 0) + 1, note: '核对', sourceFingerprint: purchaseOrderSourceFingerprint(order) }; }; confirmDate();
  const matches = (key: string, condition: any): boolean => typeof condition === 'string' ? key === condition : condition.in ? condition.in.includes(key) : key.startsWith(condition.startsWith);
  const db = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter(row => where.OR ? where.OR.some((item: any) => matches(row.key, item.key)) : matches(row.key, where.key)),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, { ...data }); return data; },
      updateMany: async ({ where, data }: any) => { const prior = state.get(where.key); if (!prior || prior.value !== where.value) return { count: 0 }; state.set(where.key, { ...prior, ...data }); return { count: 1 }; },
    },
    procInventoryBalance: { findMany: async () => [{ id: 'stock', tpInventoryCode: 'M', unit: '件', warehouse: '量产仓', stockQty: d(0), availableQty: d(0), syncedAt: day }] },
    procPurchaseOrderMirror: { findMany: async ({ where }: any) => { assert.deepEqual(where, { inventoryCode: { in: ['M'] } }); return [order]; } },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => {
      assert.ok(['Serializable', 'RepeatableRead'].includes(options.isolationLevel)); const before = new Map(state), count = audits.length;
      try { return await run(db); } catch (error) { state.clear(); before.forEach((value, key) => state.set(key, value)); audits.length = count; throw error; }
    },
  };
  const service = new ProductionReadinessService(db as never);
  let sequence = 0;
  const read = (planId = 'A') => service.read(planId, today, planner);
  const input = async (planId: string, quantity: number) => ({ action: 'purchase', version: 1, requestId: `allocation-request-${++sequence}`,
    data: { code: 'M', orderId: order.id, quantity, reason: '人工核对需求后分配', date: today, sourceToken: (await read(planId)).sourceToken } });
  const assign = async (planId: string, quantity: number) => service.command(planId, await input(planId, quantity), planner);
  const ledger = () => JSON.parse(state.get('procurement:readiness:v1:purchase:PO-line')!.value);
  return { plans, savePlans, state, db, service, read, order, confirmDate, input, assign, ledger, audits };
}

test('关键物料看板复用真实齐套计算：采购分配、释放和原单变化后刷新反馈，不重复供给', async () => {
  const f = fixture();
  const material = { id: 'M', name: '共享料', spec: '', unit: '件', category: '', productLine: '', tpInventoryCode: 'M', erpCode: '', balances: [] };
  const db = Object.assign(f.db, { procMaterial: { findMany: async () => [material] }, procQualityRecord: { findMany: async () => [] }, procTask: { findMany: async () => [] } });
  const key = 'procurement:key-materials:v1:current:material:M';
  f.state.set(key, { key, value: JSON.stringify({ version: 1, inclusion: 'included', materialIds: ['M'], actorId: 'planner', actorName: '计划员', note: '测试范围', at: today }) });
  const board = new KeyMaterialsService(db as never, f.service), actor = { ...planner, permissions: ['page:proc-key-materials'] };
  const refresh = async () => (await board.monthly(today.slice(0, 7), today, actor)).materials[0].plans;
  assert.deepEqual((await refresh()).map(row => [row.remainingDemand, row.incoming, row.gap]), [[60, 0, 60], [60, 0, 60]]);
  await f.assign('A', 40); await f.assign('B', 20);
  assert.deepEqual((await refresh()).map(row => [row.incoming, row.gap]), [[40, 20], [20, 40]]);
  await f.assign('A', 0);
  assert.deepEqual((await refresh()).map(row => [row.incoming, row.gap]), [[0, 60], [20, 40]]);
  f.order.orderedQty = d(50);
  assert.deepEqual((await refresh()).map(row => [row.incoming, row.gap]), [[0, 60], [0, 60]], '原单修改后过期分配不计覆盖，风险重新出现');
});

test('F06: batches share one supply ledger and monthly view rolls their allocations up exactly once', async () => {
  const f = fixture(false);
  f.plans[0].batches = ['one', 'two'].map(id => ({ id, code: id, quantity: 30, dueDate: today })); f.savePlans();
  const read = (batchId: string) => f.service.read('A', today, planner, undefined, batchId);
  const assign = async (batchId: string, quantity: number) => f.service.command('A', { ...(await f.input('A', quantity)), data: { ...(await f.input('A', quantity)).data, batchId, sourceToken: (await read(batchId)).sourceToken } }, planner);
  assert.equal((await read('one')).projectedSets, 0);
  await assign('one', 30); await assign('two', 30);
  assert.equal((await read('one')).projectedSets, 30); assert.equal((await read('two')).projectedSets, 30);
  assert.equal((await f.read()).projectedSets, 60); assert.equal((await f.read()).lines[0].purchase[0].batchAllocatedQty, 60);
  await assert.rejects(f.assign('A', 1), /超过/);
  await assign('one', 0); await f.assign('A', 30);
  assert.equal((await f.read()).projectedSets, 60); assert.equal((await read('one')).projectedSets, 0);
  await assert.rejects(read('foreign'), /批次不属于/);
  const input = await f.input('A', 10);
  await assert.rejects(f.service.command('A', { ...input, data: { ...input.data, batchId: 'one' } }, planner), /依据已变化/);
});

test('F06: batch stock requires explicit reservation and cannot duplicate monthly or sibling reservation', async () => {
  const f = fixture(false); f.plans[0].batches = ['one', 'two'].map(id => ({ id, code: id, quantity: 60, dueDate: today })); f.savePlans();
  f.db.procInventoryBalance.findMany = async () => [{ id: 'stock', tpInventoryCode: 'M', unit: '件', warehouse: '量产仓', stockQty: d(60), availableQty: d(60), syncedAt: day }];
  let sequence = 0;
  const read = (batchId?: string) => f.service.read('A', today, planner, undefined, batchId);
  const reserve = async (batchId: string | undefined, quantity: number) => f.service.command('A', { action: 'reserve', version: 1, requestId: `batch-stock-request-${++sequence}`, data: { code: 'M', batchId, quantity, date: today, reason: '现场核对库存', sourceToken: (await read(batchId)).sourceToken } }, planner);
  assert.equal((await read('one')).currentSets, 0);
  await reserve('one', 40); await assert.rejects(reserve('two', 21), /超过/); await reserve('two', 20);
  assert.equal((await read('one')).currentSets, 40); assert.equal((await read('two')).currentSets, 20); assert.equal((await read()).currentSets, 60);
  await assert.rejects(reserve(undefined, 1), /超过/);
  await reserve('one', 0); await reserve(undefined, 40); await assert.rejects(reserve('one', 1), /超过/);
});

test('F17: transient scenario does not consume or duplicate formal-plan purchase allocations or persist any plan', async () => {
  const f = fixture(); await f.assign('A', 60); const before = JSON.stringify([...f.state]);
  const draft = { ...f.plans[0], id: 'scenario:planner', version: 0, month: today.slice(0, 7), batches: [], targetQty: 1000 };
  const result = await f.service.simulate(draft, today, planner);
  assert.equal(result.projectedSets, 0); assert.equal(result.targetQty, 1000); assert.equal(JSON.stringify([...f.state]), before);
  assert.equal((await f.read('A')).projectedSets, 60);
  await assert.rejects(f.service.simulate(draft, today, { id: 'other', name: '', permissions: ['page:production-execution','proc-production:report'] }), /权限/);
});

test('F01: two plans cannot both cover the only 60 units; explicit 40/20 split, cap, release and retry remain exact', async () => {
  const f = fixture();
  for (const id of ['A', 'B']) { const view = await f.read(id); assert.equal(view.projectedSets, 0); assert.equal(view.lines[0].purchase[0].allocationStatus, 'unallocated'); }
  const first = await f.input('A', 40); await f.service.command('A', first, planner); await f.service.command('A', first, planner);
  assert.equal(f.ledger().version, 1); assert.equal(f.audits.length, 1);
  await assert.rejects(f.assign('B', 21), /超过/);
  await f.assign('B', 20);
  assert.equal((await f.read('A')).projectedSets, 40); assert.equal((await f.read('B')).projectedSets, 20);
  await f.assign('A', 0); await f.assign('B', 60);
  assert.equal((await f.read('A')).projectedSets, 0); assert.equal((await f.read('B')).projectedSets, 60);
  assert.equal(f.ledger().history.length, 4);
});

test('F01: single-plan compatibility ends when a second formal plan exists, without iteration order allocation', async () => {
  const f = fixture(false);
  assert.equal((await f.read()).projectedSets, 60);
  f.plans.push({ ...f.plans[0], id: 'B', productId: 'B' }); f.savePlans();
  assert.equal((await f.read('A')).projectedSets, 0); assert.equal((await f.read('B')).projectedSets, 0);
  await f.assign('A', 60);
  assert.equal((await f.read('A')).projectedSets, 60); assert.equal((await f.read('B')).projectedSets, 0);
  f.state.delete('procurement:execution:v1:plan:B'); await f.assign('A', 0);
  assert.equal((await f.read()).projectedSets, 0, 'explicit release must not restore implicit supply');
});

test('F01: local partial receipt invalidates all prior allocations and only the net 40 can be reconfirmed', async () => {
  const f = fixture(); await f.assign('A', 40); await f.assign('B', 20);
  f.order.receipts.push({ id: 'receipt', version: 1, receivedQty: d(20), sourceUnit: '件', sourceOrderId: 'PO', sourceOrderNo: 'PO-ONLY', sourceLineNo: '1',
    sourceInventoryCode: 'M', sourceInventoryName: '共享料', sourceSpec: '', sourceSupplierName: '供应商', inspections: [] });
  for (const id of ['A', 'B']) { const view = await f.read(id); assert.equal(view.projectedSets, 0); assert.equal(view.lines[0].purchase[0].quantity, 40); assert.equal(view.lines[0].purchase[0].allocationStatus, 'stale'); }
  await f.assign('A', 40); await assert.rejects(f.assign('B', 1), /超过/);
  assert.equal((await f.read('A')).projectedSets, 40); assert.equal((await f.read('B')).projectedSets, 0);
});

for (const source of ['ERP', 'local'] as const) test(`F01: ${source} receipt 0.2 from ordered 0.3 leaves exactly 0.1 allocatable`, async () => {
  const f = fixture(); f.order.orderedQty = d(0.3);
  if (source === 'ERP') f.order.receivedQty = d(0.2);
  else f.order.receipts.push({ id: 'receipt-decimal', version: 1, receivedQty: d(0.2), sourceUnit: '件', sourceOrderId: 'PO', sourceOrderNo: 'PO-ONLY', sourceLineNo: '1',
    sourceInventoryCode: 'M', sourceInventoryName: '共享料', sourceSpec: '', sourceSupplierName: '供应商', inspections: [] });
  f.confirmDate();
  const purchase = (await f.read()).lines[0].purchase[0];
  assert.equal(purchase.quantity, 0.1); assert.equal(purchase.maxAllocatable, 0.1);
  await f.assign('A', 0.1);
  assert.equal((await f.read()).lines[0].incoming, 0.1);
  await assert.rejects(f.assign('B', 0.001), /超过/);
});

test('F01: decimal other-plan allocations and completed demand retain exact 0.1 boundaries', async () => {
  const f = fixture(); f.order.orderedQty = d(0.3); f.confirmDate();
  await f.assign('A', 0.2);
  assert.equal((await f.read('B')).lines[0].purchase[0].maxAllocatable, 0.1);
  await assert.rejects(f.assign('B', 0.101), /超过/); await f.assign('B', 0.1);
  assert.equal((await f.read('B')).lines[0].incoming, 0.1);

  const demand = fixture(); demand.plans[0].targetQty = 0.3;
  demand.plans[0].tasks = [{ output: 'whole', status: 'dispatched', inspections: [{ goodQty: 0.2 }] } as any];
  demand.savePlans();
  const view = await demand.read(); assert.equal(view.remainingQty, 0.1); assert.equal(view.lines[0].remainingDemand, 0.1);
  await assert.rejects(demand.assign('A', 0.101), /超过/); await demand.assign('A', 0.1);
  assert.equal((await demand.read()).lines[0].incoming, 0.1);

  const sets = fixture(); sets.order.orderedQty = d(0.3); sets.plans[0].bom[0].qtyPer = 0.1;
  sets.savePlans(); sets.confirmDate(); await sets.assign('A', 0.3);
  assert.equal((await sets.read()).projectedSets, 3, '0.3 / 0.1 must not round down to two sets');
});

test('F01: ERP receipt, order amount/date and plan basis changes require reconfirmation; source-invalid release remains possible', async () => {
  const f = fixture(); await f.assign('A', 60);
  f.order.receivedQty = d(10);
  assert.equal((await f.read()).projectedSets, 0); await assert.rejects(f.assign('A', 50), /来源/);
  f.confirmDate(); assert.equal((await f.read()).projectedSets, 0); await f.assign('A', 50);
  assert.equal((await f.read()).projectedSets, 50);
  f.confirmDate(); assert.equal((await f.read()).projectedSets, 0); await f.assign('A', 50);
  f.plans[0].bomFingerprint = 'v2'; f.savePlans(); assert.equal((await f.read()).projectedSets, 0); await f.assign('A', 50);
  f.order.orderedQty = d(30); f.confirmDate(); await assert.rejects(f.assign('A', 21), /超过/); await f.assign('A', 20);
  f.order.unit = '箱'; f.confirmDate(); await assert.rejects(f.assign('A', 1), /来源/); await f.assign('A', 0);
  assert.equal((await f.read()).projectedSets, 0);
});

test('F01: stale competing plan writes cannot overbook; insufficient permissions and foreign rows are rejected', async () => {
  const f = fixture(), staleB = await f.input('B', 60);
  await f.assign('A', 40); await assert.rejects(f.service.command('B', staleB, planner), /依据已变化/);
  assert.equal(f.ledger().allocations.length, 1); await f.assign('B', 20);
  const input = await f.input('B', 0);
  await assert.rejects(f.service.command('B', input, { ...planner, permissions: ['page:production-execution', 'production:view-all'] }), /权限/);
  await assert.rejects(f.service.command('B', { ...input, data: { ...input.data, orderId: 'other-order' } }, planner), /不属于/);
  assert.equal(f.ledger().version, 2);
});

test('F01: saved snapshots retain the original allocation result; database serialization conflicts produce a retryable business error', async () => {
  const f = fixture(); await f.assign('A', 60); const view = await f.read();
  await f.service.command('A', { action: 'snapshot', version: 1, requestId: 'allocation-snapshot-01', data: { date: today, reason: '记录当时分配', sourceToken: view.sourceToken } }, planner);
  const saved = [...f.state.values()].find(row => row.key.startsWith('procurement:readiness:v1:snapshot:'))!;
  f.confirmDate(); assert.equal((await f.read()).projectedSets, 0);
  assert.equal((await f.service.read('A', today, planner, JSON.parse(saved.value).id)).projectedSets, 60);
  const input = await f.input('A', 30);
  f.db.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' }); };
  await assert.rejects(f.service.command('A', input, planner), /正在更新.*重试/);
  assert.equal(f.ledger().version, 1);
});

test('review: stock source problems block a positive reservation but never block releasing it', async () => {
  const f = fixture(false);
  f.db.procInventoryBalance.findMany = async () => [{ id: 'stock', tpInventoryCode: 'M', unit: '箱', warehouse: '量产仓', stockQty: d(60), availableQty: d(60), syncedAt: day }];
  const view = await f.read(); assert.equal(view.currentSets, null); assert.match(view.lines[0].problems.join(''), /单位/);
  const command = { action: 'reserve', version: 1, requestId: 'review-source-reserve-1', data: { code: 'M', quantity: 1, date: today, reason: '来源核对', sourceToken: view.sourceToken } };
  await assert.rejects(f.service.command('A', command, planner), /依据待核对/);
  await f.service.command('A', { ...command, data: { ...command.data, quantity: 0 } }, planner);
  assert.equal(JSON.parse(f.state.get('procurement:readiness:v1:allocation:A:M')!.value).quantity, 0);
});

test('review: repeated issue events are counted once; wrong issue units remain explicitly unknown', async () => {
  const f = fixture(false);
  f.db.procInventoryBalance.findMany = async () => [{ id: 'stock', tpInventoryCode: 'M', unit: '件', warehouse: '量产仓', stockQty: d(60), availableQty: d(60), syncedAt: day }];
  const event = { id: 'event', action: 'issue', at: day.toISOString(), lines: [{ code: 'M', warehouse: '量产仓', quantity: 5 }] };
  const issue = { id: 'issue', planId: 'other-plan', taskId: 'other-task', status: 'issued', lines: [{ code: 'M', unit: '件' }], history: [event, event] };
  const key = 'procurement:warehouse-flow:v1:issue:other-task';
  f.state.set(key, { key, value: JSON.stringify(issue) });
  assert.equal((await f.read()).lines[0].warehousePending, 5); assert.equal((await f.read()).lines[0].current, 55);
  issue.lines[0].unit = '箱'; f.state.set(key, { key, value: JSON.stringify(issue) });
  assert.equal((await f.read()).currentSets, null); assert.match((await f.read()).lines[0].problems.join(''), /发料记录.*单位/);
});

test('review: invalid legacy BOM use and duplicate codes cannot appear as confirmed readiness', async () => {
  const f = fixture(false); f.plans[0].bom[0].qtyPer = 0; f.savePlans();
  assert.equal((await f.read()).currentSets, null); assert.match((await f.read()).lines[0].problems.join(''), /BOM/);
  f.plans[0].bom[0].qtyPer = 1; f.plans[0].bom.push({ ...f.plans[0].bom[0], id: 'duplicate' }); f.savePlans();
  f.db.procPurchaseOrderMirror.findMany = async () => [f.order];
  const view = await f.read(); assert.equal(view.projectedSets, null); assert.ok(view.lines.every(row => row.problems.some(problem => problem.includes('重复'))));
});

test('review: latest promise after earlier inspection availability removes coverage; reconfirmation uses actual new date, withdrawal remains unknown', async () => {
  const f = fixture(false); const future = new Date(day.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal((await f.read()).projectedSets, 60);
  const key = deliveryKey('supplier', f.order.id), identity = deliverySourceIdentity(f.order);
  const put = (currentDate: string | null) => { const entry = { version: 1, kind: currentDate ? 'revision' : 'withdrawal', before: today, after: currentDate, communicatedOn: today, evidence: '供应商书面改期', reason: '原可用日不能先于实物到货', actorId: planner.id, actorName: planner.name, recordedAt: new Date().toISOString(), sourceIdentity: identity, source: deliverySource(f.order) }; f.state.set(key, { key, value: JSON.stringify({ version: 1, originalDate: today, currentDate, sourceIdentity: identity, lastEntry: entry }) }); };
  put(future); assert.equal((await f.read()).projectedSets, 0); assert.match((await f.read()).lines[0].purchase[0].note, /承诺晚于/);
  f.order.availability.availableDate = new Date(`${future}T00:00:00Z`);
  assert.equal((await f.read()).projectedSets, 0); assert.equal((await f.service.read('A', future, planner)).projectedSets, 60);
  put(null); assert.equal((await f.service.read('A', future, planner)).projectedSets, 0); assert.equal(f.order.etaDate.toISOString().slice(0, 10), today);
});

test('review: a saved batch snapshot cannot be read under monthly or another batch scope', async () => {
  const f = fixture(false), view = await f.service.read('A', today, planner, undefined, 'batch-A');
  await f.service.command('A', { action: 'snapshot', version: 1, requestId: 'batch-snapshot-review-01', data: { date: today, batchId: 'batch-A', reason: '保留批次依据', sourceToken: view.sourceToken } }, planner);
  const stored = [...f.state.values()].find(row => row.key.startsWith('procurement:readiness:v1:snapshot:'))!; const id = JSON.parse(stored.value).id;
  assert.equal((await f.service.read('A', today, planner, id, 'batch-A')).batchId, 'batch-A');
  await assert.rejects(f.service.read('A', today, planner, id), /不属于当前批次/);
  await assert.rejects(f.service.read('A', today, planner, id, 'another'), /不属于当前批次/);
});

test('review: verification cannot add more completed units than this inspection originally rejected', async () => {
  const f = fixture(false);
  f.plans[0].tasks = [{ id: 'task', batchId: 'batch-A', output: 'whole', status: 'dispatched', reports: [], inspections: [{ id: 'inspect', kind: 'final', quantity: 10, goodQty: 8, qualityId: 'quality' }] } as any]; f.savePlans();
  (f.db as any).procQualityRecord = { findMany: async () => [{ id: 'quality', disposition: 'rework', resolution: '已返工', defectiveQty: d(10) }] };
  const key = 'procurement:quality-verification:v1:quality:verification';
  f.state.set(key, { key, value: JSON.stringify({ kind: 'verification', recordId: 'quality', passedQty: 10, source: { disposition: 'rework', resolution: '已返工', defectiveQty: '10' } }) });
  const view = await f.read(); assert.equal(view.completedQty, 10); assert.equal(view.remainingQty, 50);
});
