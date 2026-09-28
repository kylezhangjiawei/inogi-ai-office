import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { WarehouseRecordsService, WAREHOUSE_RECORD_PREFIX, pendingCountReduction } from '../src/modules/procurement/warehouse-records.service';
import { ProductionReadinessService } from '../src/modules/procurement/production-readiness.service';
import { ProductionLifecycleService, lifecycleKey, productionBasis } from '../src/modules/procurement/production-lifecycle.service';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import { executionToday, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
const planner = { id: 'planner', name: '计划员', permissions: ['*'] }, checker = { id: 'checker', name: '独立审核', permissions: ['*'] }, worker = { id: 'worker', name: '现场人员', permissions: ['page:production-execution'] };
const controlledVersions = ['sop', 'sip', 'drawing'].map(kind => ({ id: kind + '-v1', documentId: kind, document: { taskId: 'rd1' }, attachmentId: kind + '-attachment', version: 'V1', fileName: kind + '.pdf', fileKey: kind + '.pdf', fileUrl: '', mimeType: 'application/pdf' }));
const controlledReferences = controlledVersions.map((row, index) => ({ kind: ['sop', 'sip', 'drawing'][index], versionId: row.id }));
const decimal = (value: number) => new Prisma.Decimal(value), today = executionToday();
function fixture() {
  const plan: ExecutionPlan = { id: 'plan', month: today.slice(0, 7), version: 1, productId: 'product', productName: '制氧机', productLine: 'Q7', targetQty: 240, shipmentTargetQty: 200, bomFingerprint: 'bom-v1',
    bom: [{ id: 'V', code: 'V', name: '阀', unit: '件', qtyPer: 1 }, { id: 'C', code: 'C', name: '压缩机', unit: '件', qtyPer: 1 }, { id: 'S', code: 'S', name: '分子筛', unit: '件', qtyPer: 2 }],
    batches: [{ id: 'batch', code: 'B01', quantity: 240, dueDate: today }], tasks: [], events: [] };
  const state = new Map<string, { key: string; value: string }>(), audits: unknown[] = [], orders: any[] = [], samples: any[] = [], qualities: any[] = [];
  const balances = [['V', 180], ['C', 230], ['S', 460]].map(([code, qty]) => ({ id: String(code), tpInventoryCode: String(code), warehouse: '量产仓', unit: '件', stockQty: decimal(Number(qty)), availableQty: decimal(Number(qty)), inTransitQty: decimal(9999), syncedAt: new Date(), material: { name: code } }));
  const put = (key: string, value: unknown) => state.set(key, { key, value: JSON.stringify(value) });
  const savePlan = () => put('procurement:execution:v1:plan:plan', plan); savePlan();
  const keyMatches = (key: string, value: any): boolean => typeof value === 'string' ? key === value : value.in ? value.in.includes(key) : key.startsWith(value.startsWith);
  const db = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter(row => where.OR ? where.OR.some((entry: any) => keyMatches(row.key, entry.key)) : keyMatches(row.key, where.key)).reverse(),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false, `duplicate ${data.key}`); state.set(data.key, { ...data }); return data; },
      upsert: async ({ where, create, update }: any) => { const data = state.has(where.key) ? { ...state.get(where.key)!, ...update } : create; state.set(where.key, data); return data; },
      updateMany: async ({ where, data }: any) => { const current = state.get(where.key); if (!current || current.value !== where.value) return { count: 0 }; state.set(where.key, { ...current, ...data }); return { count: 1 }; },
    },
    procInventoryBalance: { findMany: async () => balances, findUnique: async ({ where }: any) => balances.find(row => row.tpInventoryCode === where.tpInventoryCode_warehouse.tpInventoryCode && row.warehouse === where.tpInventoryCode_warehouse.warehouse) ?? null },
    procPurchaseOrderMirror: { findMany: async () => orders },
    user: { findMany: async () => [planner, checker, worker].map(row => ({ ...row, role: { permissions: row.permissions } })) },
    fileAsset: { findUnique: async ({ where }: any) => ({ id: where.objectKey, status: 'active' }) },
    rdTechnicalDocumentVersion: { findMany: async ({ where }: any) => controlledVersions.filter(row => where.id.in.includes(row.id)) },
    procTask: { findMany: async () => samples, findUnique: async ({ where }: any) => samples.find(row => row.id === where.id) ?? null },
    procQualityRecord: { findMany: async ({ where }: any) => qualities.filter(row => where.id.in.includes(row.id)) },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => { assert.ok(['Serializable', 'RepeatableRead'].includes(options.isolationLevel)); const saved = new Map(state), count = audits.length; try { return await run(db); } catch (error) { state.clear(); saved.forEach((value, key) => state.set(key, value)); audits.length = count; throw error; } },
  };
  return { db, state, plan, put, savePlan, balances, orders, samples, qualities, audits, warehouse: new WarehouseRecordsService(db as never), readiness: new ProductionReadinessService(db as never), lifecycle: new ProductionLifecycleService(db as never) };
}
test('A03：全 BOM 使用当日确认未耗用线边，240/270/270；缺失、负数与过期确认不冒充齐套', async () => {
  const f = fixture();
  for (const [code, qty] of [['V', 60], ['C', 40], ['S', 80]] as const) {
    const taskId = `task-${code}`, material = f.plan.bom.find(row => row.code === code)!;
    f.plan.tasks.push({ id: taskId, batchId: 'batch', name: code, treeNodeId: 'node', output: 'component', unit: '件', quantity: 100, date: today, line: '一线', ownerId: 'worker', ownerName: '工人', status: 'dispatched', reports: [], materials: [{ ...material, qtyPer: 1, requiredQty: qty }] });
    f.put(`procurement:warehouse-flow:v1:issue:${taskId}`, { taskId, planId: 'plan', title: code, status: 'signed', lines: [{ code, signedQty: qty }], history: [] });
  }
  f.savePlan(); assert.equal((await f.readiness.read('plan', today, planner)).currentSets, null);
  for (const [code, quantity] of [['V', 60], ['C', 40], ['S', 80]] as const) await f.readiness.command('plan', { action: 'line', version: 1, requestId: `line-confirm-request-${code}`, data: { code, taskId: `task-${code}`, quantity, reason: '实际盘核未耗用', sourceToken: (await f.readiness.read('plan', today, planner)).sourceToken } }, planner);
  const view = await f.readiness.read('plan', today, planner);
  assert.equal(view.currentSets, 240); assert.equal(view.projectedSets, 240, '没有日期依据的ERP在途9999不计入');
  assert.deepEqual(view.lines.map(row => {
    assert.ok(row.current !== null, '已确认的 BOM 行必须有当前可用数量');
    return row.current / row.qtyPer;
  }), [240, 270, 270]);
  f.balances[0].availableQty = decimal(-1); assert.equal((await f.readiness.read('plan', today, planner)).currentSets, null);
});
test('A04/A05：按确认日期的净未到量预计齐套，不重复计本地实收；来源变化使日期失效', async () => {
  const f = fixture(); f.balances.forEach((row, index) => { row.availableQty = decimal(index === 2 ? 480 : 240); row.stockQty = row.availableQty; });
  const future = new Date(`${today}T00:00:00Z`); future.setUTCDate(future.getUTCDate() + 5); const date = future.toISOString().slice(0, 10);
  for (const code of ['V', 'C', 'S']) {
    const order: any = { id: code, tpOrderId: code, tpOrderNo: `PO-${code}`, tpLineNo: '1', inventoryCode: code, inventoryName: code, spec: '', unit: '件', supplierName: '供应商', status: null, approvalStatus: null, orderedQty: decimal(code === 'S' ? 120 : 60), receivedQty: decimal(0), etaDate: future, receipts: [] };
    order.availability = { availableDate: future, confirmedAt: new Date(), confirmedByName: '采购', version: 1, sourceFingerprint: purchaseOrderSourceFingerprint(order) }; f.orders.push(order);
  }
  assert.equal((await f.readiness.read('plan', today, planner)).projectedSets, 240);
  assert.equal((await f.readiness.read('plan', date, planner)).projectedSets, 300);
  f.orders[0].orderedQty = decimal(61); const view = await f.readiness.read('plan', date, planner); assert.equal(view.projectedSets, 240); assert.equal(view.lines[0].purchase[0].included, false);
});
test('库存占用按正式物料去重，释放有审计；齐套快照不可被后续库存覆盖', async () => {
  const f = fixture(); const cmd = { action: 'reserve', version: 1, requestId: 'reserve-v11-request-01', data: { code: 'V', quantity: 30, reason: '计划占用', sourceToken: (await f.readiness.read('plan', today, planner)).sourceToken } };
  await f.readiness.command('plan', cmd, planner); await f.readiness.command('plan', cmd, planner); assert.equal(f.audits.length, 1);
  await assert.rejects(f.readiness.command('plan', { ...cmd, requestId: 'stale-reserve-request1', data: { ...cmd.data, quantity: 31 } }, planner), /依据已变化/);
  f.put('procurement:readiness:v1:allocation:other:V', { planId: 'other', code: 'V', quantity: 20 });
  assert.equal((await f.readiness.read('plan', today, planner)).lines[0].warehouse, 160);
  await f.readiness.command('plan', { action: 'snapshot', version: 1, requestId: 'snapshot-v11-request1', data: { date: today, reason: '会议快照', sourceToken: (await f.readiness.read('plan', today, planner)).sourceToken } }, planner);
  const saved = [...f.state.values()].find(row => row.key.startsWith('procurement:readiness:v1:snapshot:'))!.value;
  f.balances[0].availableQty = decimal(0); await f.readiness.read('plan', today, planner);
  assert.equal([...f.state.values()].find(row => row.key.startsWith('procurement:readiness:v1:snapshot:'))!.value, saved);
  await assert.rejects(f.readiness.read('plan', today, worker), /权限/);
});
test('A09：账面200实盘198占用20，独立复核后净可用178；ERP核对同步后不重复扣减', async () => {
  const f = fixture(); f.balances[0].stockQty = decimal(200); f.balances[0].availableQty = decimal(180);
  const created = await f.warehouse.command({ action: 'start-count', requestId: 'count-v11-request001', data: { code: 'V', warehouse: '量产仓', batch: '全仓合格品', reason: '发起盘点' } }, planner);
  await f.warehouse.command({ action: 'submit-count', id: created.id, version: 1, requestId: 'count-v11-submit001', data: { countedQty: 198, reason: '实盘表' } }, planner);
  const confirm = { action: 'approve-count', id: created.id, version: 2, requestId: 'count-v11-approve001', data: { reason: '独立复核盘点表' } };
  await assert.rejects(f.warehouse.command(confirm, planner), /不同人员/);
  await f.warehouse.command(confirm, checker); await f.warehouse.command(confirm, checker);
  assert.equal((await f.readiness.read('plan', today, planner)).lines[0].warehouse, 178);
  const record = JSON.parse(f.state.get(`${WAREHOUSE_RECORD_PREFIX}record:${created.id}`)!.value);
  assert.equal(pendingCountReduction([record], 'V', '量产仓', new Date()).toNumber(), 2);
  record.reconciliation = { at: new Date(Date.now() - 1000).toISOString() };
  assert.equal(pendingCountReduction([record], 'V', '量产仓', new Date()).toNumber(), 0);
});
test('A08：不良退料6件实收只入一次隔离桶，未耗用与报工不良不能混扣', async () => {
  const f = fixture(); const material = f.plan.bom[0];
  f.plan.tasks.push({ id: 'task', batchId: 'batch', name: '作业', treeNodeId: 'node', output: 'component', unit: '件', quantity: 40, date: today, line: '一线', ownerId: 'worker', ownerName: '工人', status: 'dispatched', reports: [{ id: 'r', date: today, quantity: 40, goodQty: 34, note: '', actorId: 'worker', actorName: '工人', at: new Date().toISOString() }], materials: [{ ...material, requiredQty: 40 }] }); f.savePlan();
  f.put('procurement:warehouse-flow:v1:issue:task', { id: 'task', taskId: 'task', batchId: 'batch', planId: 'plan', recipientId: 'worker', lines: [{ ...material, signedQty: 40 }], history: [] });
  const input = { action: 'return', requestId: 'return-v11-request01', data: { taskId: 'task', code: 'V', quantity: 6, bucket: 'defective', origin: 'defect', warehouse: '不良仓', reason: '不良实物退回' } };
  const result = await f.warehouse.command(input, worker);
  const receive = { action: 'receive-return', id: result.id, version: 1, requestId: 'return-v11-receive01', data: { receivedQty: 6, reason: '清点6件不良隔离' } };
  await f.warehouse.command(receive, checker); await f.warehouse.command(receive, checker);
  const record = JSON.parse(f.state.get(`${WAREHOUSE_RECORD_PREFIX}record:${result.id}`)!.value); assert.equal(record.defectiveQty, 6); assert.equal(record.qualifiedQty, 0); assert.equal(record.version, 2);
  const other = await f.warehouse.command({ ...input, requestId: 'return-v11-request02' }, worker);
  await assert.rejects(f.warehouse.command({ ...receive, id: other.id, requestId: 'return-v11-receive02' }, checker), /可退范围/);
});
async function published() {
  const f = fixture(); f.samples.push({ id: 'sample', materialName: '阀样品', code: 'SP-1', treeNode: { productId: 'product' }, metadata: { rdTransferSnapshots: [{ id: 'snapshot1', rdTaskId: 'rd1', attachments: controlledVersions.map(row => ({ technicalDocumentVersionId: row.id, documentId: row.documentId })) }], sampleTest: { roundId: 'round1', testerUserId: 'worker', testerName: '测试员', assignedAt: new Date().toISOString(), assignedByName: '采购', result: 'passed', confirmedAt: new Date().toISOString(), confirmedByName: '测试员', recordsVersion: 1, finishedAt: new Date().toISOString() } } });
  let sequence = 0;
  const command = async (action: string, data: Record<string, unknown>, actor = planner) => { const state = JSON.parse(f.state.get(lifecycleKey('plan'))?.value ?? '{"version":0}'); return f.lifecycle.command('plan', { action, version: state.version, requestId: `lifecycle-v11-request-${++sequence}`, data: { reason: '正式资料与验证依据', ...data } }, actor); };
  await command('transfer', { type: 'validation', code: 'TP-V1', documents: controlledReferences, sampleTaskId: 'sample', roundId: 'round1', sop: 'SOP-V1 文件', sip: 'SIP-V1 文件', drawing: 'BOM-V1 文件' });
  const pkg = JSON.parse(f.state.get(lifecycleKey('plan'))!.value).transfers[0];
  await assert.rejects(command('publish-transfer', { id: pkg.id }), /尚未/);
  await assert.rejects(command('validate-transfer', { id: pkg.id, documentsChecked: true, productionValidated: true }), /非编制人/);
  await command('validate-transfer', { id: pkg.id, documentsChecked: true, productionValidated: true }, checker); await command('publish-transfer', { id: pkg.id });
  return { ...f, command, pkg };
}
test('A15/A16：转产独立验证后发布，ECN明确批次且本人确认；派工版本快照不随新版本覆盖', async () => {
  const f = await published(); const original = await productionBasis(f.db as never, f.plan, 'batch', 'worker');
  f.plan.tasks.push({ id: 'prior-task', batchId: 'batch', ownerId: 'worker', basis: original } as any);
  const newer = JSON.parse(f.state.get(lifecycleKey('plan'))!.value); newer.transfers.push({ ...newer.transfers[0], id: 'new-package', code: 'TP-V2' }); f.put(lifecycleKey('plan'), newer);
  assert.equal((await productionBasis(f.db as never, f.plan, 'batch', 'worker')).packageId, original.packageId, '新资料发布不能未经ECN替换既有批次版本');
  await f.command('ecn', { code: 'ECN01', packageId: f.pkg.id, batchIds: ['batch'], effectiveDate: today, handling: '旧料隔离，已完工批次不追溯改版' });
  const change = JSON.parse(f.state.get(lifecycleKey('plan'))!.value).changes[0]; await f.command('publish-ecn', { id: change.id });
  await assert.rejects(productionBasis(f.db as never, f.plan, 'batch', 'worker'), /尚未确认/);
  f.plan.tasks.push({ id: 'task', batchId: 'batch', ownerId: 'worker' } as any); f.savePlan();
  await f.command('acknowledge', { id: change.id }, worker);
  const next = await productionBasis(f.db as never, f.plan, 'batch', 'worker'); assert.equal(original.changeIds.length, 0); assert.deepEqual(next.changeIds, [change.id]);
});
test('A18：完成216不等于已发；180+20=200，重复发货、超发、未来日期拒绝，冲销保留历史', async () => {
  const f = await published(); f.plan.tasks.push({ id: 'whole', batchId: 'batch', name: '整机', treeNodeId: 'node', output: 'whole', unit: '台', quantity: 240, date: today, line: '一线', ownerId: 'worker', ownerName: '工人', status: 'dispatched', materials: [], reports: [{ id: 'r', date: today, quantity: 216, goodQty: 216, note: '', actorId: 'worker', actorName: '工人', at: today }], inspections: [{ id: 'i', reportId: 'r', date: today, quantity: 216, goodQty: 216, evidence: '初检通过', actorId: 'checker', actorName: '质检', at: today, qualityId: null }] }); f.savePlan();
  await assert.rejects(f.command('ship', { batchId: 'batch', quantity: 1, date: today, voucher: 'S0', order: 'SO', recipient: '客户' }), /放行/);
  await f.command('release', { batchId: 'batch', quantity: 216, evidenceChecked: true }, checker);
  await f.command('ship', { batchId: 'batch', quantity: 180, date: today, voucher: 'S1', order: 'SO', recipient: '客户' });
  await f.command('ship', { batchId: 'batch', quantity: 20, date: today, voucher: 'S2', order: 'SO', recipient: '客户' });
  await assert.rejects(f.command('ship', { batchId: 'batch', quantity: 17, date: today, voucher: 'S3', order: 'SO', recipient: '客户' }), /超过/);
  await assert.rejects(f.command('ship', { batchId: 'batch', quantity: 1, date: today, voucher: 'S2', order: 'SO', recipient: '客户' }), /重复/);
  const view = await f.lifecycle.read('plan', planner); assert.equal(view.batches[0].completedQty, 216); assert.equal(view.batches[0].shippedQty, 200);
  await f.command('reverse-shipment', { id: view.shipments[1].id, evidenceChecked: true }); const after = await f.lifecycle.read('plan', planner); assert.equal(after.batches[0].shippedQty, 180); assert.equal(after.shipments.length, 2);
  f.plan.tasks[0].reports.push({ ...f.plan.tasks[0].reports[0], id: 'r2', quantity: 1, goodQty: 1 }); f.savePlan();
  await assert.rejects(f.command('ship', { batchId: 'batch', quantity: 1, date: today, voucher: 'S4', order: 'SO', recipient: '客户' }), /未完成初检/);
});
