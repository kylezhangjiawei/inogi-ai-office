import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { QualityVerificationService } from '../src/modules/procurement/quality-verification.service';
import { WarehouseFlowService } from '../src/modules/procurement/warehouse-flow.service';
import { applyExecutionCommand, executionSummary, executionTaskProgress, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
import { ProductionExecutionService, EXECUTION_PREFIX, WAREHOUSE_PREFIX } from '../src/modules/procurement/production-execution.service';
const actor = { id: 'planner', name: '计划员', permissions: ['page:production-execution', 'production:plan', 'proc-production:report'] };
const bom = [{ id: 'valve', code: 'V01', name: '阀组件', unit: '件', qtyPer: 2 }];
function fixture() {
  const state = new Map<string, { key: string; value: string }>(), audits: unknown[] = [];
  const qualities = new Map<string, any>();
  const db = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter((row) => where.OR ? where.OR.some((entry: any) => row.key.startsWith(entry.key.startsWith)) : where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith)).reverse(),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, { ...data }); return data; },
      update: async ({ where, data }: any) => { const row = { ...state.get(where.key)!, ...data }; state.set(where.key, row); return row; },
      upsert: async ({ where, create, update }: any) => { const row = state.has(where.key) ? { ...state.get(where.key)!, ...update } : create; state.set(where.key, row); return row; },
      updateMany: async ({ where, data }: any) => { const row = state.get(where.key); if (!row || row.value !== where.value) return { count: 0 }; state.set(where.key, { ...row, ...data }); return { count: 1 }; },
    },
    procTaskTreeNode: { findFirst: async () => ({ name: '制氧机' }), findUnique: async ({ where }: any) => where.id === 'subsystem' ? { id: 'subsystem', parentId: 'root', productId: 'product' } : null },
    user: { findFirst: async ({ where }: any) => where.id === 'worker' ? { id: 'worker', name: '现场人', role: { permissions: ['page:production-execution', 'proc-production:report', 'proc-quality:collaborate'] } } : null },
    procInventoryBalance: { findUnique: async () => ({ availableQty: new Prisma.Decimal(10000), unit: '件', syncedAt: new Date('2026-09-01') }) },
    procQualityRecord: {
      create: async ({ data }: any) => { const row = { id: `quality-${qualities.size + 1}`, ...data, resolution: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), treeNode: { name: '阀系统' } }; qualities.set(row.id, row); return row; },
      findMany: async ({ where }: any) => [...qualities.values()].filter((row) => where.id.in.includes(row.id)),
      findUnique: async ({ where }: any) => qualities.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => qualities.get(where.id),
      updateMany: async ({ where, data }: any) => { const row = qualities.get(where.id); if (!row || row.updatedAt.toISOString() !== where.updatedAt.toISOString()) return { count: 0 }; qualities.set(row.id, { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) }); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); const saved = new Map(state); const count = audits.length; try { return await run(db); } catch (error) { state.clear(); saved.forEach((row, key) => state.set(key, row)); audits.length = count; throw error; } },
  };
  const procurement = { getInventoryReadiness: async () => ({ productLine: 'Q7', items: bom, dataQuality: { invalidBomLines: 0 } }) };
  return { service: new ProductionExecutionService(db as never, procurement as never), verification: new QualityVerificationService(db as never), warehouse: new WarehouseFlowService(db as never), state, audits, qualities };
}
const input = { requestId: 'create-production-0001', month: '2026-09', productId: 'product', productLine: 'Q7', targetQty: 200, shipmentTargetQty: 180, reason: '已确认月度目标' };
async function prepared(output: 'whole' | 'component' = 'component') {
  const f = fixture(); const { id } = await f.service.create(input, actor);
  // Existing execution cases start from an independently validated published transfer baseline.
  const lifecycle = { version: 3, transfers: [{ id: 'transfer-v1', code: 'TP-V1', type: 'validation', status: 'published', sop: 'SOP1', sip: 'SIP1', drawing: 'BOM1', sampleTaskId: 'sample', roundId: 'round1' }], changes: [], releases: [], shipments: [], events: [] };
  const lifecycleKey = `procurement:lifecycle:v1:plan:${id}`;
  f.state.set(lifecycleKey, { key: lifecycleKey, value: JSON.stringify(lifecycle) });
  const command = async (action: string, data: Record<string, unknown>, who = actor, requestId?: string) => {
    const plan = (await f.service.list('2026-09', actor))[0];
    // Exercise the actual warehouse service before report tests, not synthetic signed quantities.
    if (action === 'report') {
      const task = plan.tasks.find((row) => row.id === data.taskId)!;
      const issue = JSON.parse(f.state.get(`${WAREHOUSE_PREFIX}issue:${task.id}`)!.value);
      if (issue.version === 1) {
        await f.warehouse.command(task.id, { requestId: `issue-${task.id}`, version: 1, action: 'issue', reason: '仓库发料', lines: task.materials.map((row) => ({ code: row.code, quantity: row.requiredQty, warehouse: '量产仓' })) }, { id: 'warehouse', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:issue'] });
        await f.warehouse.command(task.id, { requestId: `sign-${task.id}`, version: 2, action: 'sign', reason: '现场清点签收', lines: task.materials.map((row) => ({ code: row.code, quantity: row.requiredQty })) }, { id: 'worker', name: '现场人', permissions: ['page:production-execution'] });
      }
    }
    return f.service.command(id, { action, data: { reason: '业务确认依据', ...data }, version: plan.version, requestId: requestId ?? `execution-request-${plan.version}-${action}` }, who);
  };
  const current = async () => (await f.service.list('2026-09', actor))[0];
  await command('batch', { code: 'B-01', quantity: 200, dueDate: '2026-09-30' });
  const batchId = (await current()).batches[0].id;
  const taskData = { batchId, treeNodeId: 'subsystem', name: '阀组件装配', output, unit: '件', quantity: 200, ownerId: 'worker', date: '2026-09-01', line: '装配一线', materials: [{ code: 'V01', qtyPer: 2 }] };
  await command('task', taskData);
  return { ...f, id, command, current, taskData, taskId: (await current()).tasks[0].id };
}
test('生产目标单独确认，重复创建不产生第二个计划；发货目标独立保存', async () => {
  const f = fixture(); const first = await f.service.create(input, actor), retry = await f.service.create(input, actor);
  assert.equal(first.id, retry.id); assert.equal(f.audits.length, 1);
  const plan = (await f.service.list('2026-09', actor))[0];
  assert.equal(plan.targetQty, 200); assert.equal(plan.shipmentTargetQty, 180); assert.deepEqual(plan.bom, bom);
  await assert.rejects(f.service.create({ ...input, requestId: 'different-create-request' }, actor), /已有计划/);
  await assert.rejects(f.service.create({ ...input, targetQty: 300 }, actor), /提交标识/);
});
test('派工、现场作业和领料需求同一事务且重复请求只生成一份', async () => {
  const f = await prepared(), plan = await f.current();
  const command = { action: 'dispatch', version: plan.version, requestId: 'dispatch-idempotent-001', data: { taskId: f.taskId, reason: '确认派工' } };
  await f.service.command(f.id, command, actor); await f.service.command(f.id, command, actor);
  const requests = [...f.state.values()].filter((row) => row.key.startsWith(WAREHOUSE_PREFIX));
  assert.equal(requests.length, 1); const request = JSON.parse(requests[0].value);
  assert.equal(request.taskId, f.taskId); assert.equal(request.planId, f.id); assert.equal(request.lines[0].quantity, 400);
  assert.equal(request.status, 'requested'); assert.equal((await f.current()).tasks[0].status, 'dispatched');
  assert.equal((await f.current()).events.filter((row) => row.action === 'dispatch').length, 1);
});
test('200计划报160良品154保留80%/77%/剩46，组件不计整机', async () => {
  const f = await prepared(); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 160, goodQty: 154 }, { id: 'worker', name: '现场人', permissions: ['page:production-execution', 'proc-production:report'] });
  const plan = await f.current(), progress = executionTaskProgress(plan.tasks[0]);
  assert.equal(progress.reportedPercent, 80); assert.equal(progress.goodPercent, 77); assert.equal(progress.remaining, 46); assert.equal(progress.defective, 6);
  assert.equal(executionSummary(plan).reportedWholeGoodQty, 0); assert.equal(executionSummary(plan).reportedWholeQty, 0);
});
test('超量、跨产品、非法日期、无负责人和过期版本均不写入', async () => {
  const f = await prepared(); const before = (await f.current()).version;
  await assert.rejects(f.command('batch', { code: 'B2', quantity: 1, dueDate: '2026-09-20' }), /超过/);
  await assert.rejects(f.command('task', { ...f.taskData, treeNodeId: 'other' }), /不属于/);
  await assert.rejects(f.command('task', { ...f.taskData, ownerId: 'disabled' }), /负责人/);
  await assert.rejects(f.command('task', { ...f.taskData, date: '2026-09-31' }), /不存在/);
  await assert.rejects(f.service.command(f.id, { action: 'targets', version: 1, requestId: 'stale-plan-update-001', data: { targetQty: 300, shipmentTargetQty: 0, reason: '调整' } }, actor), /已更新/);
  assert.equal((await f.current()).version, before);
  await f.command('dispatch', { taskId: f.taskId });
  await assert.rejects(f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 201, goodQty: 200 }), /不能超过|已签收数量不足/);
  await assert.rejects(f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 160, goodQty: 161 }), /良品数/);
});
test('现场报工只允许本人或计划员，页面权限与动作权限均在服务端校验', async () => {
  const f = await prepared(); await f.command('dispatch', { taskId: f.taskId });
  await assert.rejects(f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 1, goodQty: 1 }, { id: 'other', name: '其他人', permissions: ['page:production-execution', 'proc-production:report'] }), /仅作业负责人/);
  await assert.rejects(f.service.list('2026-09', { ...actor, permissions: ['production:plan'] }), /权限/);
  await assert.rejects(f.service.create(input, { ...actor, permissions: ['page:production-execution'] }), /权限/);
});
test('领料进入办理后不能取消作业，失败事务不改变计划与领料', async () => {
  const f = await prepared(); await f.command('dispatch', { taskId: f.taskId });
  const key = `${WAREHOUSE_PREFIX}issue:${f.taskId}`, stored = f.state.get(key)!;
  f.state.set(key, { key, value: JSON.stringify({ ...JSON.parse(stored.value), status: 'issued' }) });
  await assert.rejects(f.command('cancel', { taskId: f.taskId }), /已进入发料/);
  assert.equal((await f.current()).tasks[0].status, 'dispatched');
  assert.equal(JSON.parse(f.state.get(key)!.value).status, 'issued');
  assert.ok([...f.state.keys()].some((key) => key.startsWith(`${EXECUTION_PREFIX}history:`)));
});
test('整机作业不能超过批次目标，调整目标不能低于已分批数', () => {
  const plan: ExecutionPlan = { id: 'p', version: 1, month: '2026-09', productId: 'product', productName: '产品', productLine: 'Q7', targetQty: 200, shipmentTargetQty: 0, bom, bomFingerprint: 'bom', batches: [{ id: 'b', code: 'B1', quantity: 200, dueDate: '2026-09-30' }], tasks: [], events: [] };
  assert.throws(() => applyExecutionCommand(plan, { requestId: 'request-00000000001', version: 1, action: 'targets', data: { reason: '调整', targetQty: 199, shipmentTargetQty: 0 } }, actor), /不能小于/);
  assert.throws(() => applyExecutionCommand(plan, { requestId: 'request-00000000002', version: 1, action: 'task', data: { reason: '派工', batchId: 'b', output: 'whole', quantity: 201 } }, actor, { id: 'worker', name: '工人' }), /超过批次/);
});
test('报工→初检→同号质量异常→处置→独立复验闭环，复验不改写首次94%', async () => {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 50, goodQty: 47 });
  assert.equal((await f.current()).summary.completedQty, 0);
  const reportId = (await f.current()).tasks[0].reports[0].id;
  const inspector = { id: 'inspector', name: '初检人', permissions: ['page:production-execution', 'production:inspect'] };
  await f.command('inspect', { taskId: f.taskId, reportId, quantity: 50, goodQty: 47, date: '2026-09-02', issue: '氧浓度不达标' }, inspector);
  let plan = await f.current(), inspection = plan.tasks[0].inspections[0];
  assert.equal(plan.summary.completedQty, 47); assert.equal(inspection.quality?.defectiveQty, 3); assert.equal(f.qualities.size, 1);
  await assert.rejects(f.command('inspect', { taskId: f.taskId, reportId, quantity: 1, goodQty: 1, date: '2026-09-02' }, inspector), /初检数量累计/);
  await assert.rejects(f.command('inspect', { taskId: f.taskId, reportId, quantity: 1, goodQty: 1, date: '2026-09-02' }), /权限/);
  const manager = { id: 'manager', name: '处置人', permissions: ['page:production-execution', 'proc-quality:manage'] };
  await f.command('disposition', { qualityId: inspection.qualityId, baseUpdatedAt: inspection.quality!.updatedAt, disposition: 'rework', reason: '已按工艺完成返工' }, manager);
  inspection = (await f.current()).tasks[0].inspections[0];
  const verifier = { id: 'verifier', name: '验证人', permissions: ['proc-quality:verify'] };
  await f.verification.verify(inspection.qualityId!, { requestId: 'verify-execution-partial', baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-03', inspectedQty: 3, passedQty: 2, evidence: '逐件复测，2台通过，1台仍异常' }, verifier);
  plan = await f.current(); inspection = plan.tasks[0].inspections[0];
  assert.equal(plan.summary.completedQty, 49); assert.equal(inspection.quality?.status, 'processing');
  assert.equal(inspection.goodQty / inspection.quantity * 100, 94); assert.equal(inspection.quality?.defectiveQty, 3);
  await f.verification.verify(inspection.qualityId!, { requestId: 'verify-execution-complete', baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-04', inspectedQty: 3, passedQty: 3, evidence: '原3台全部复测通过' }, verifier);
  plan = await f.current(); inspection = plan.tasks[0].inspections[0];
  assert.equal(plan.summary.completedQty, 50); assert.equal(inspection.goodQty, 47); assert.equal(inspection.quality?.status, 'closed'); assert.equal(f.qualities.size, 1);
  await f.verification.reopen(inspection.qualityId!, { requestId: 'reopen-execution-complete', baseUpdatedAt: inspection.quality!.updatedAt, reason: '复核发现验证仪器偏差，重新验证' }, verifier);
  assert.equal((await f.current()).summary.completedQty, 47);
});
test('分批复验累计不重复：47→49→50，剩余一件通过后关闭，跨月未完独立返回', async () => {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 50, goodQty: 47 });
  await f.command('inspect', { taskId: f.taskId, reportId: (await f.current()).tasks[0].reports[0].id, quantity: 50, goodQty: 47, date: '2026-09-02', issue: '需返工' }, { ...actor, permissions: [...actor.permissions, 'production:inspect'] });
  let inspection = (await f.current()).tasks[0].inspections[0];
  await f.command('disposition', { qualityId: inspection.qualityId, baseUpdatedAt: inspection.quality!.updatedAt, disposition: 'rework', reason: '按件返工' }, { ...actor, permissions: [...actor.permissions, 'proc-quality:manage'] });
  const verifier = { id: 'verifier', name: '验证人', permissions: ['proc-quality:verify'] };
  for (const [index, inspectedQty, passedQty, expected] of [[1, 3, 2, 49], [2, 1, 1, 50]]) {
    inspection = (await f.current()).tasks[0].inspections[0];
    const input = { scope: 'remaining' as const, requestId: `remaining-verification-00${index}`, baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-03', inspectedQty, passedQty, evidence: '仅本轮尚未通过实物' };
    await f.verification.verify(inspection.qualityId!, input, verifier);
    await f.verification.verify(inspection.qualityId!, input, verifier);
    assert.equal((await f.current()).summary.completedQty, expected);
  }
  inspection = (await f.current()).tasks[0].inspections[0];
  assert.equal(inspection.quality!.status, 'closed'); assert.equal(inspection.goodQty / inspection.quantity, 0.94);
  const carried = await f.service.list('2026-10', actor);
  assert.equal(carried.length, 1); assert.equal(carried[0].month, '2026-09'); assert.equal(carried[0].carryover, true);
  assert.equal((await f.service.list('2026-08', actor)).length, 0);
});

test('退货或报废的处置验证不能被算作合格整机产出', async () => {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 5, goodQty: 4 });
  const reportId = (await f.current()).tasks[0].reports[0].id;
  await f.command('inspect', { taskId: f.taskId, reportId, quantity: 5, goodQty: 4, date: '2026-09-02', issue: '损坏' }, { ...actor, permissions: [...actor.permissions, 'production:inspect'] });
  let inspection = (await f.current()).tasks[0].inspections[0];
  await f.command('disposition', { qualityId: inspection.qualityId, baseUpdatedAt: inspection.quality!.updatedAt, disposition: 'scrap', reason: '已完成报废隔离' }, { ...actor, permissions: [...actor.permissions, 'proc-quality:manage'] });
  inspection = (await f.current()).tasks[0].inspections[0];
  await f.verification.verify(inspection.qualityId!, { requestId: 'verify-execution-scrap01', baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-03', inspectedQty: 1, passedQty: 1, evidence: '核验报废处置符合规定' }, { ...actor, permissions: ['proc-quality:verify'] });
  assert.equal((await f.current()).summary.completedQty, 4);
});
test('生产转研发沿用原异常号；只有当前经办能回复，回复前不能验证关闭', async () => {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 5, goodQty: 4 });
  const reportId = (await f.current()).tasks[0].reports[0].id;
  await f.command('inspect', { taskId: f.taskId, reportId, quantity: 5, goodQty: 4, date: '2026-09-02', issue: '结构干涉' }, { ...actor, permissions: [...actor.permissions, 'production:inspect'] });
  const manager = { ...actor, permissions: [...actor.permissions, 'proc-quality:manage'] };
  let quality = (await f.current()).tasks[0].inspections[0].quality!;
  await f.command('disposition', { qualityId: quality.id, baseUpdatedAt: quality.updatedAt, disposition: 'rework', reason: '返工待研发核对' }, manager);
  quality = (await f.current()).tasks[0].inspections[0].quality!;
  await f.command('assign-quality', { qualityId: quality.id, baseUpdatedAt: quality.updatedAt, ownerId: 'worker', reason: '请研发核对尺寸公差' }, manager);
  quality = (await f.current()).tasks[0].inspections[0].quality!;
  assert.equal(quality.collaboration.ownerId, 'worker'); assert.equal(f.qualities.size, 1); assert.equal(quality.defectiveQty, 1);
  await assert.rejects(f.verification.history(quality.id, { id: 'other', name: '其他人', permissions: ['page:production-execution'] }), /不属于您的作业/);
  assert.deepEqual(await f.verification.history(quality.id, { id: 'worker', name: '当前处理人', permissions: ['page:production-execution'] }), []);
  await assert.rejects(f.verification.verify(quality.id, { requestId: 'premature-verify-quality', baseUpdatedAt: quality.updatedAt, verificationDate: '2026-09-03', inspectedQty: 1, passedQty: 1, evidence: '尚未回复' }, { ...actor, permissions: ['proc-quality:verify'] }), /尚未回复/);
  const reply = { qualityId: quality.id, baseUpdatedAt: quality.updatedAt, reason: '公差核对已完成，建议重新装配并复测' };
  await assert.rejects(f.command('reply-quality', reply, { ...actor, permissions: ['page:production-execution', 'proc-quality:collaborate'] }), /当前协同处理人/);
  await f.command('reply-quality', reply, { id: 'worker', name: '研发人', permissions: ['page:production-execution', 'proc-quality:collaborate'] });
  const updated = (await f.current()).tasks[0].inspections[0].quality!;
  assert.equal(updated.id, quality.id); assert.equal(updated.collaboration.phase, 'returned'); assert.equal(updated.collaboration.ownerId, actor.id);
  assert.equal(updated.status, 'processing'); assert.equal(updated.defectiveQty, 1); assert.equal(f.qualities.size, 1);
});
test('派工后未签收或签收不足不能报工，签收20件只能支撑10件组件', async () => {
  const f = await prepared(); await f.command('dispatch', { taskId: f.taskId });
  const version = (await f.current()).version;
  const input = { requestId: 'report-needs-material-01', version, action: 'report', data: { taskId: f.taskId, date: '2026-09-01', quantity: 10, goodQty: 10, reason: '现场报工' } };
  await assert.rejects(f.service.command(f.id, input, actor), /签收数量不足/);
  const warehouseActor = { id: 'wh', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:issue'] };
  await f.warehouse.command(f.taskId, { requestId: 'part-issue-request-001', version: 1, action: 'issue', reason: '先发20件', lines: [{ code: 'V01', quantity: 20, warehouse: '量产仓' }] }, warehouseActor);
  await assert.rejects(f.service.command(f.id, input, actor), /签收数量不足/);
  await f.warehouse.command(f.taskId, { requestId: 'part-sign-request-001', version: 2, action: 'sign', reason: '清点20件', lines: [{ code: 'V01', quantity: 20 }] }, { id: 'worker', name: '现场人', permissions: ['page:production-execution'] });
  await f.service.command(f.id, input, actor);
  await assert.rejects(f.service.command(f.id, { ...input, requestId: 'report-needs-material-02', version: version + 1, data: { ...input.data, quantity: 1, goodQty: 1 } }, actor), /签收数量不足/);
  assert.equal((await f.current()).tasks[0].reports.length, 1);
});
test('现场人员只能读取本人作业；全量读取必须有管理、检验或全量读取权限', async () => {
  const f = await prepared();
  assert.equal((await f.service.list('2026-09', { id: 'other', name: '其他人', permissions: ['page:production-execution', 'proc-production:report'] })).length, 0);
  const own = await f.service.list('2026-09', { id: 'worker', name: '现场人', permissions: ['page:production-execution', 'proc-production:report'] });
  assert.equal(own.length, 1); assert.equal(own[0].scope, 'assigned'); assert.equal(own[0].tasks[0].ownerId, 'worker');
  const all = await f.service.list('2026-09', { id: 'director', name: '主管', permissions: ['page:production-execution', 'production:view-all'] });
  assert.equal(all[0].scope, 'all'); assert.equal(all[0].tasks.length, 1);
});

for (const reportedGoodQty of [200, 197]) {
  test(`HA-02：报工良品${reportedGoodQty}的跨月待办跟随检验、复验与重开状态`, async () => {
    const f = await prepared('whole');
    await f.command('targets', { targetQty: 200, shipmentTargetQty: 0 });
    await f.command('dispatch', { taskId: f.taskId });
    await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 200, goodQty: reportedGoodQty });
    const worker = { id: 'worker', name: '现场人', permissions: ['page:production-execution'] };
    assert.equal((await f.service.overview('2026-10', worker)).tasks.length, 1, '未检验不能退出跨月待办');
    assert.equal((await f.service.overview('2026-10', { ...worker, id: 'other' })).tasks.length, 0);
    await f.command('inspect', { taskId: f.taskId, reportId: (await f.current()).tasks[0].reports[0].id, quantity: 200, goodQty: 197, date: '2026-09-02', issue: '三件需返工' }, { ...actor, permissions: [...actor.permissions, 'production:inspect'] });
    let inspection = (await f.current()).tasks[0].inspections[0];
    assert.equal((await f.service.overview('2026-10', actor)).tasks.length, 1, '初检异常未关继续显示');
    assert.equal((await f.service.list('2026-10', actor)).length, 1);
    await f.command('disposition', { qualityId: inspection.qualityId, baseUpdatedAt: inspection.quality!.updatedAt, disposition: 'rework', reason: '三件返工' }, { ...actor, permissions: [...actor.permissions, 'proc-quality:manage'] });
    const verifier = { id: 'verifier', name: '验证人', permissions: ['proc-quality:verify'] };
    for (const passedQty of [2, 3]) {
      inspection = (await f.current()).tasks[0].inspections[0];
      await f.verification.verify(inspection.qualityId!, { requestId: `ha02-verification-${passedQty}`, baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-03', inspectedQty: 3, passedQty, evidence: '原三件返工复验' }, verifier);
      const expected = passedQty === 3 ? 0 : 1;
      assert.equal((await f.service.overview('2026-10', actor)).tasks.length, expected);
      assert.equal((await f.service.overview('2026-10', worker)).tasks.length, expected);
      assert.equal((await f.service.list('2026-10', actor)).length, expected);
    }
    const currentOverview = await f.service.overview('2026-09', actor);
    assert.equal(currentOverview.tasks[0].goodQty, reportedGoodQty, '首次报工数量不被复验改写');
    assert.equal(currentOverview.actualShippedQty, 0);
    inspection = (await f.current()).tasks[0].inspections[0];
    await f.verification.reopen(inspection.qualityId!, { requestId: 'ha02-reopen-verification', baseUpdatedAt: inspection.quality!.updatedAt, reason: '验证仪器偏差，重新验证' }, verifier);
    assert.equal((await f.service.overview('2026-10', actor)).tasks.length, 1);
    assert.equal((await f.service.list('2026-10', actor)).length, 1);
  });
}
