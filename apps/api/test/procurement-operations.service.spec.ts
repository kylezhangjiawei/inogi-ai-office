import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementOperationsController } from '../src/modules/procurement/procurement-operations.controller';
import { ProcurementOperationsService, operationDay, locateProductionTaskSource } from '../src/modules/procurement/procurement-operations.service';
import { QualityVerificationService } from '../src/modules/procurement/quality-verification.service';
import type { SaveProductionReportDto, SaveQualityRecordDto } from '../src/modules/procurement/dto/procurement-operations.dto';

const actor = { id: 'operator', name: '生产甲', permissions: ['proc-production:report', 'proc-quality:manage'] };
const baseTime = new Date('2026-09-01T00:00:00.000Z');
const d = (value: number) => new Prisma.Decimal(value);
const reportInput: SaveProductionReportDto = { productId: 'product-1', treeNodeId: 'node-1', stockPlanId: 'plan-1', reportDate: '2026-09-04', shift: '白班', lineName: '总装线', unit: '套', plannedQty: 100, actualQty: 90, goodQty: 85, workHours: 16, capacityQty: 100 };
const qualityInput: SaveQualityRecordDto = { productId: 'product-1', treeNodeId: 'node-1', stockPlanId: 'plan-1', source: 'production', batchNo: 'B-1', inspectionDate: '2026-09-04', unit: '套', inspectedQty: 90, defectiveQty: 3, issue: '外观划痕', disposition: 'pending', status: 'open' };

const analysisData = { category: 'process', detail: '装配工艺偏差', evidence: '检验记录和现场复核一致', responsibility: { kind: 'internal', id: 'responsible', name: '客户端伪造姓名' }, phenomena: [{ name: '划痕', count: 6 }, { name: '偏位', count: 2 }], references: [{ source: 'warehouse', reference: '真实反馈单号', note: '同批原异常追踪' }], fileIds: ['real-file-1'], reason: '依据现场实测确认' };
test('F04 四来源沿原异常登记，6件8次分离，责任人从账号读取且授权确认幂等', async () => {
  const f=fixture();
  for(const source of ['procurement','production','warehouse','after_sales'] as const)await f.service.saveQualityRecord(null,{...qualityInput,source,defectiveQty:6},actor);
  const list=await f.service.list({productId:'product-1',month:'2026-09'});assert.equal(list.qualitySummary.length,4);
  const record=list.qualityRecords[0],input={requestId:'quality-analysis-confirm-001',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:analysisData};
  await f.service.saveQualityAnalysis(record.id,input,actor);await f.service.saveQualityAnalysis(record.id,input,actor);
  const result=await f.service.qualityAnalysis(record.id,actor);
  assert.equal(result.record.defectiveQty,6);assert.equal(result.analysis.phenomena.reduce((n,row)=>n+row.count,0),8);
  assert.equal(result.analysis.responsibility.name,'责任人甲');assert.equal(result.analysis.confirmedBy,actor.id);
  assert.equal(result.analysis.history.length,1);assert.equal(f.quality.length,4);assert.equal(result.analysis.references.length,1);
  assert.equal((await f.service.qualityAttachment(record.id,'real-file-1',actor)).name,'证据.png');
});
test('F04 未知可以保存待分析但不能冒充确认，协同经办没有确认权限', async () => {
  const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);
  const input={requestId:'quality-analysis-unknown-001',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:{...analysisData,category:'unknown'}};
  await assert.rejects(f.service.saveQualityAnalysis(record.id,input,actor),/未知|确认主因/);
  await assert.rejects(f.service.saveQualityAnalysis(record.id,{...input,data:analysisData},{...actor,permissions:['proc-quality:collaborate']}),/权限/);
  await f.service.saveQualityAnalysis(record.id,{...input,action:'save'},actor);
  const result=await f.service.qualityAnalysis(record.id,actor);assert.equal(result.analysis.state,'pending');assert.equal(result.analysis.category,'unknown');assert.equal(result.analysis.confirmedBy,undefined);
});
test('F04 伪造附件、他人上传、无效责任账号及重复现象不能保存', async () => {
  for(const patch of [{fileIds:['made-up-id']},{responsibility:{kind:'internal',id:'disabled'}},{phenomena:[{name:'划痕',count:6},{name:'划痕',count:2}]},{phenomena:[{name:'划痕',count:1.5}]}]){
    const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);
    await assert.rejects(f.service.saveQualityAnalysis(record.id,{requestId:'quality-analysis-invalid-001',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:{...analysisData,...patch}},actor));
    assert.equal(f.history.length,0);
  }
  const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);f.files[0].uploadedBy='someone-else';
  await assert.rejects(f.service.saveQualityAnalysis(record.id,{requestId:'quality-analysis-other-file',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:analysisData},actor),/附件/);
});
test('F04 原异常或分析CAS失败都回滚历史，旧版本不能覆盖，已关闭须先重新打开', async () => {
  const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);
  const input={requestId:'quality-analysis-conflict-01',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:analysisData};
  const original=f.prisma.procQualityRecord.updateMany;
  f.prisma.procQualityRecord.updateMany=async()=>({count:0});
  await assert.rejects(f.service.saveQualityAnalysis(record.id,input,actor),/已更新/);assert.equal(f.history.length,0);
  f.prisma.procQualityRecord.updateMany=original;await f.service.saveQualityAnalysis(record.id,input,actor);
  await assert.rejects(f.service.saveQualityAnalysis(record.id,{...input,requestId:'quality-analysis-conflict-02'},actor),/已被更新|已更新/);
  f.quality[0].status='closed';
  await assert.rejects(f.service.saveQualityAnalysis(record.id,{...input,requestId:'quality-analysis-closed-001'},actor),/已关闭/);
});
test('F04 仅本作业或协同经办可读现场证据，其他现场账号和别的异常附件均拒绝', async () => {
  const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);
  await f.service.saveQualityAnalysis(record.id,{requestId:'quality-analysis-read-scope',version:0,baseUpdatedAt:record.updatedAt,action:'confirm',data:analysisData},actor);
  f.history.push({key:`procurement:execution:v1:quality:${record.id}`,value:JSON.stringify({planId:'ep',taskId:'et'})},{key:'procurement:execution:v1:plan:ep',value:JSON.stringify({tasks:[{id:'et',ownerId:'worker'}]})});
  const worker={id:'worker',name:'现场人',permissions:['page:production-execution']};
  assert.equal((await f.service.qualityAnalysis(record.id,worker)).analysis.files.length,1);
  await assert.rejects(f.service.qualityAnalysis(record.id,{...worker,id:'other'}),/无权/);
  await assert.rejects(f.service.qualityAttachment(record.id,'another-file',worker),/不属于/);
});
test('F04 实领批号待补可沿原记录补全，仅接受同作业已签收批号', async () => {
  const f=fixture(),record=await f.service.saveQualityRecord(null,qualityInput,actor);
  f.history.push({key:`procurement:execution:v1:quality:${record.id}`,value:JSON.stringify({planId:'ep',taskId:'et',fieldIssueId:'field'})},{key:'procurement:warehouse-flow:v1:issue:et',value:JSON.stringify({lines:[{code:'M1',name:'阀',signedQty:10,signedBatches:[{batchNo:'LOT-A',quantity:10}]}]})});
  const input={requestId:'quality-analysis-batch-001',version:0,baseUpdatedAt:record.updatedAt,action:'save',data:{...analysisData,materialBatches:[{code:'M1',batchNo:'foreign'}]}};
  await assert.rejects(f.service.saveQualityAnalysis(record.id,input,actor),/已签收/);
  await f.service.saveQualityAnalysis(record.id,{...input,data:{...input.data,materialBatches:[{code:'M1',batchNo:'LOT-A'}]}},actor);
  assert.deepEqual((await f.service.qualityAnalysis(record.id,actor)).analysis.materialBatches,[{code:'M1',batchNo:'LOT-A'}]);
});


type Row = Record<string, any>;
function fixture() {
  const reports: Row[] = [];
  const quality: Row[] = [];
  const history: Row[] = [];
  const audit: Row[] = [];
  const nodes: Row[] = [{ id: 'node-1', productId: 'product-1', parentId: 'category-1', materialId: 'material-1', name: '主机' }, { id: 'node-2', productId: 'product-2', parentId: 'category-2', materialId: 'material-2', name: '另一产品' }];
  const plans: Row[] = [{ id: 'plan-1', productId: 'product-1', treeNodeId: 'node-1', materialId: 'material-1', code: 'SP-1', unit: '套' }, { id: 'plan-2', productId: 'product-2', treeNodeId: 'node-2', materialId: 'material-2', code: 'SP-2', unit: '件' }];
  const tasks: Row[] = [{ id: 'task-1', productId: 'product-1', treeNodeId: 'node-1', materialId: 'material-1', code: 'PR-1', unit: '套' }, { id: 'task-2', productId: 'product-2', treeNodeId: 'node-2', materialId: 'material-2', code: 'PR-2', unit: '件' }];
  const materials: Row[] = [{ id: 'material-1', name: '主机', unit: '套' }, { id: 'material-2', name: '外部物料', unit: '件' }];
  const suppliers: Row[] = [{ id: 'supplier-1', name: '供应商甲' }];
  const users: Row[] = [{ id: 'responsible', name: '责任人甲', status: 'ACTIVE' }, { id: 'operator', name: '质量甲', status: 'ACTIVE' }];
  const files: Row[] = [{ id: 'real-file-1', status: 'active', uploadedBy: 'operator', businessType: 'assets', objectKey: 'assets/test-evidence.png', fileName: '证据.png', mimeType: 'image/png', fileSize: 100 }];
  let sequence = 0;
  let transactionOptions: unknown;
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((item: Row) => matches(row, item));
    if (key === 'AND') return value.every((item: Row) => matches(row, item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('startsWith' in value) return row[key]?.startsWith(value.startsWith);
      if ('not' in value) return row[key] !== value.not;
      if ('gte' in value || 'lt' in value) return (!value.gte || row[key] >= value.gte) && (!value.lt || row[key] < value.lt);
    }
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    return row[key] === value;
  });
  const joined = (row: Row, include?: unknown) => include ? { ...row, treeNode: nodes.find((node) => node.id === row.treeNodeId), stockPlan: plans.find((plan) => plan.id === row.stockPlanId) ?? null, material: materials.find((material) => material.id === row.materialId) ?? null, supplier: suppliers.find((supplier) => supplier.id === row.supplierId) ?? null, task: tasks.find((task) => task.id === row.taskId) ?? null } : row;
  const delegate = (rows: Row[], prefix: string) => ({
    findUnique: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); return row ? joined(row, include) : null; },
    findFirst: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); return row ? joined(row, include) : null; },
    findUniqueOrThrow: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); if (!row) throw new Error('missing'); return joined(row, include); },
    findMany: async ({ where, include }: Row = {}) => rows.filter((row) => matches(row, where)).map((row) => joined(row, include)),
    create: async ({ data, include }: Row) => { const row = { id: `${prefix}-${++sequence}`, createdAt: baseTime, updatedAt: baseTime, ...data }; rows.push(row); return joined(row, include); },
    updateMany: async ({ where, data }: Row) => { const row = rows.find((item) => matches(item, where)); if (!row) return { count: 0 }; Object.assign(row, data, { updatedAt: new Date(baseTime.getTime() + ++sequence) }); return { count: 1 }; },
  });
  const prisma = {
    user: delegate(users, 'user'), fileAsset: delegate(files, 'file'),
    runtimeState: delegate(history, 'history'), auditLog: delegate(audit, 'audit'),
    procTaskTreeNode: delegate(nodes, 'node'), procStockPlan: delegate(plans, 'plan'), procTask: delegate(tasks, 'task'), procMaterial: delegate(materials, 'material'), procSupplier: delegate(suppliers, 'supplier'), procProductionReport: delegate(reports, 'report'), procQualityRecord: delegate(quality, 'quality'),
    $transaction: async (run: (db: unknown) => Promise<unknown>, options: unknown) => { transactionOptions = options; const collections = [reports, quality, history, audit]; const copies = collections.map(rows => rows.map(row => ({ ...row }))); try { return await run(prisma); } catch (error) { collections.forEach((rows,index) => rows.splice(0,rows.length,...copies[index])); throw error; } },
  };
  return { service: new ProcurementOperationsService(prisma as never, { getReadUrl: () => ({ url: 'https://example.invalid/authorized-test-evidence' }) } as never), verification: new QualityVerificationService(prisma as never), files, history, audit, reports, quality, nodes, plans, tasks, prisma, transactionOptions: () => transactionOptions };
}

test('真实日期校验接受闰日并拒绝滚动日期和无效月份', () => {
  assert.equal(operationDay('2024-02-29', '日期').toISOString(), '2024-02-29T00:00:00.000Z');
  for (const value of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-9-1']) assert.throws(() => operationDay(value, '日期'));
});

test('报工保存实际数、派生不良数和显式产能；使用Serializable事务', async () => {
  const f = fixture();
  const result = await f.service.saveProductionReport(null, reportInput, actor);
  assert.equal(result.actualQty, 90); assert.equal(result.defectiveQty, 5); assert.equal(result.capacityQty, 100);
  assert.equal(result.stockPlanCode, 'SP-1'); assert.equal(f.reports[0].createdBy, 'operator');
  assert.deepEqual(f.transactionOptions(), { isolationLevel: 'Serializable' });
});

test('未填写产能保持null，不用零或任务数填充', async () => {
  const f = fixture();
  const result = await f.service.saveProductionReport(null, { ...reportInput, capacityQty: null }, actor);
  assert.equal(result.capacityQty, null);
  const list = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(list.productionSummary[0].capacityQty, null);
  assert.equal(list.productionSummary[0].capacityUtilization, null);
});

test('拒绝非法数量、精度、良品多于产量及空必填字段，且不落库', async () => {
  for (const change of [{ goodQty: 91 }, { actualQty: -1 }, { plannedQty: NaN }, { workHours: 1.001 }, { actualQty: 0.0001 }, { capacityQty: 1e15 }, { lineName: '  ' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveProductionReport(null, { ...reportInput, ...change }, actor));
    assert.equal(f.reports.length, 0);
  }
});

test('跨产品节点、跨模块计划、单位冲突均拒绝', async () => {
  for (const change of [{ treeNodeId: 'node-2' }, { stockPlanId: 'plan-2' }, { unit: '件' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveProductionReport(null, { ...reportInput, ...change }, actor));
    assert.equal(f.reports.length, 0);
  }
});

test('生产和质量写入各自独立授权', async () => {
  const f = fixture();
  await assert.rejects(f.service.saveProductionReport(null, reportInput, { ...actor, permissions: ['proc-quality:manage'] }), /没有执行/);
  await assert.rejects(f.service.saveQualityRecord(null, qualityInput, { ...actor, permissions: ['proc-production:report'] }), /没有执行/);
  assert.equal(f.quality.length + f.reports.length, 0);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementOperationsController.prototype.list), ['page:proc-cockpit', 'page:rd-director-dashboard']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementOperationsController.prototype.updateQuality), ['proc-quality:manage']);
});

test('按月份、产品、模块过滤；多单位分开汇总；部分产能不算整体利用率', async () => {
  const f = fixture();
  await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveProductionReport(null, { ...reportInput, capacityQty: null }, actor);
  await f.service.saveProductionReport(null, { ...reportInput, stockPlanId: null, unit: '件', plannedQty: 5, actualQty: 4, goodQty: 3, capacityQty: 5 }, actor);
  await f.service.saveProductionReport(null, { ...reportInput, reportDate: '2026-08-31' }, actor);
  const result = await f.service.list({ productId: 'product-1', treeNodeId: 'node-1', month: '2026-09' });
  assert.equal(result.productionReports.length, 3);
  assert.equal(result.productionSummary.length, 2);
  const sets = result.productionSummary.find((row) => row.unit === '套')!;
  assert.equal(sets.actualQty, 180); assert.equal(sets.capacityRecorded, 1); assert.equal(sets.capacityQty, null); assert.equal(sets.capacityUtilization, null);
  const pieces = result.productionSummary.find((row) => row.unit === '件')!;
  assert.equal(pieces.actualQty, 4); assert.equal(pieces.capacityUtilization, 80);
});

test('报工更新记录操作者，旧版本不能覆盖新版本', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  const updated = await f.service.saveProductionReport(report.id, { ...reportInput, note: '补充说明', baseUpdatedAt: report.updatedAt }, actor);
  assert.equal(updated.updatedByName, '生产甲');
  await assert.rejects(f.service.saveProductionReport(report.id, { ...reportInput, note: '旧版覆盖', baseUpdatedAt: report.updatedAt }, actor), /已被更新/);
  assert.equal(f.reports[0].note, '补充说明');
});

test('普通编辑即使填写处理结果也不能直接关闭，已关闭记录不能改写', async () => {
  const f = fixture();
  const created = await f.service.saveQualityRecord(null, qualityInput, actor);
  assert.equal(created.status, 'open'); assert.equal(created.resolvedAt, null);
  await assert.rejects(f.service.saveQualityRecord(created.id, { ...qualityInput, status: 'closed', baseUpdatedAt: created.updatedAt }, actor), /关闭前/);
  await assert.rejects(f.service.saveQualityRecord(created.id, { ...qualityInput, disposition: 'rework', status: 'closed', resolution: '返工后复验合格', baseUpdatedAt: created.updatedAt }, actor), /独立复验/);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, status: 'closed', resolution: '直接新建关闭', disposition: 'scrap' }, actor), /独立复验/);
  assert.equal(f.quality[0].status, 'open');
  f.quality[0].status = 'closed';
  await assert.rejects(f.service.saveQualityRecord(created.id, { ...qualityInput, baseUpdatedAt: created.updatedAt }, actor), /不能直接修改/);
});

const verifier = { id: 'qc-user', name: '验证乙', permissions: ['proc-quality:verify'] };
async function readyForVerification() {
  const f = fixture();
  const record = await f.service.saveQualityRecord(null, { ...qualityInput, status: 'processing', disposition: 'rework', resolution: '返工完成，等待复验' }, actor);
  const input = { requestId: 'verification-request-01', baseUpdatedAt: record.updatedAt, verificationDate: '2026-09-05', inspectedQty: 3, passedQty: 3, evidence: '复验单 QC-01，三件外观符合要求' };
  return { ...f, record, input };
}

test('独立验证权限是服务端门槛；普通管理权限不能复验或重新打开', async () => {
  const f = await readyForVerification();
  await assert.rejects(f.verification.verify(f.record.id, f.input, actor), /质量验证权限/);
  await assert.rejects(f.verification.reopen(f.record.id, { requestId: 'reopen-request-001', baseUpdatedAt: f.record.updatedAt, reason: '补充核对' }, actor), /质量验证权限/);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementOperationsController.prototype.verifyQuality), ['proc-quality:verify']);
  assert.equal(f.history.length, 0); assert.equal(f.quality[0].status, 'processing');
});

test('复验通过关闭，保留原初检数量、验证人和来源版本，重复请求只生效一次', async () => {
  const f = await readyForVerification();
  const saved = await f.verification.verify(f.record.id, f.input, verifier);
  assert.equal(saved.closed, true); assert.equal(f.quality[0].status, 'closed'); assert.ok(f.quality[0].resolvedAt);
  assert.equal(f.quality[0].inspectedQty.toNumber(), 90); assert.equal(f.quality[0].defectiveQty.toNumber(), 3);
  await f.verification.verify(f.record.id, f.input, verifier);
  assert.equal(f.history.length, 1); assert.equal(f.audit.length, 1);
  const history = await f.verification.history(f.record.id, actor);
  assert.equal(history[0].actorId, 'qc-user'); assert.equal(history[0].sourceVersion, f.record.updatedAt);
  assert.equal(history[0].source.resolution, '返工完成，等待复验');
  await assert.rejects(f.verification.verify(f.record.id, { ...f.input, evidence: '改用其他依据' }, verifier), /提交标识/);
});

test('未完整通过只能继续处理；后续全量复验通过，保留失败轮次', async () => {
  const f = await readyForVerification();
  const partial = await f.verification.verify(f.record.id, { ...f.input, inspectedQty: 2, passedQty: 2 }, verifier);
  assert.equal(partial.closed, false); assert.equal(f.quality[0].resolvedAt, null);
  const failed = await f.verification.verify(f.record.id, { ...f.input, requestId: 'verification-request-02', baseUpdatedAt: partial.updatedAt, passedQty: 2 }, verifier);
  assert.equal(failed.closed, false);
  const closed = await f.verification.verify(f.record.id, { ...f.input, requestId: 'verification-request-03', baseUpdatedAt: failed.updatedAt }, verifier);
  assert.equal(closed.closed, true); assert.equal(f.history.length, 3);
});

test('复验拒绝缺证据、超量、非法日期、缺处置及版本冲突', async () => {
  for (const patch of [{ evidence: ' ' }, { inspectedQty: 4 }, { passedQty: 4 }, { inspectedQty: 0 }, { passedQty: -1 }, { inspectedQty: 2.0001 }, { verificationDate: '2026-02-30' }, { verificationDate: '2026-09-03' }, { verificationDate: '9999-01-01' }, { baseUpdatedAt: '2026-01-01T00:00:00.000Z' }]) {
    const f = await readyForVerification();
    await assert.rejects(f.verification.verify(f.record.id, { ...f.input, ...patch }, verifier));
    assert.equal(f.history.length, 0); assert.equal(f.quality[0].status, 'processing');
  }
  const f = await readyForVerification(); f.quality[0].resolution = null;
  await assert.rejects(f.verification.verify(f.record.id, f.input, verifier), /处理结果/);
});

test('重新打开须验证权限、原因和正确版本，旧复验不被覆盖且不自动再次关闭', async () => {
  const f = await readyForVerification();
  const closed = await f.verification.verify(f.record.id, f.input, verifier);
  const input = { requestId: 'reopen-quality-request', baseUpdatedAt: closed.updatedAt, reason: '发现遗漏外观项，追加检查' };
  await assert.rejects(f.verification.reopen(f.record.id, { ...input, reason: '' }, verifier), /原因/);
  await f.verification.reopen(f.record.id, input, verifier);
  await f.verification.reopen(f.record.id, input, verifier);
  assert.equal(f.quality[0].status, 'processing'); assert.equal(f.quality[0].resolvedAt, null); assert.equal(f.history.length, 2);
  const history = await f.verification.history(f.record.id, verifier);
  assert.equal(history.filter((entry) => entry.kind === 'verification').length, 1);
  assert.equal(history.filter((entry) => entry.kind === 'reopen').length, 1);
});

test('采购不良关联任务、计划和物料必须同属，检验与不良数有效', async () => {
  for (const change of [{ taskId: 'task-2' }, { materialId: 'material-2' }, { supplierId: 'missing' }, { defectiveQty: 91 }, { defectiveQty: 0 }, { inspectedQty: -1 }, { unit: '个' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', ...change }, actor));
    assert.equal(f.quality.length, 0);
  }
  const f = fixture();
  const record = await f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', taskId: 'task-1', materialId: 'material-1', supplierId: 'supplier-1' }, actor);
  assert.equal(record.taskCode, 'PR-1'); assert.equal(record.materialName, '主机'); assert.equal(record.supplierName, '供应商甲');
});

test('关联报工防止累计不良重复超量，修改本条时不会把自己重复计入', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  const one = await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id }, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, batchNo: 'B-2', productionReportId: report.id }, actor), /累计登记不良/);
  const changed = await f.service.saveQualityRecord(one.id, { ...qualityInput, productionReportId: report.id, defectiveQty: 4, baseUpdatedAt: one.updatedAt }, actor);
  assert.equal(changed.defectiveQty, 4);
  await assert.rejects(f.service.saveProductionReport(report.id, { ...reportInput, goodQty: 87, baseUpdatedAt: report.updatedAt }, actor), /不能小于已关联/);
  assert.equal(f.reports[0].goodQty.toNumber(), 85);
});

test('采购不良不能关联生产报工，生产不良不能混入其他计划', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, source: 'procurement' }, actor), /只有生产不良/);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, stockPlanId: null }, actor), /关联报工/);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, inspectedQty: 100 }, actor), /不能超过关联报工/);
});

test('采购与生产不良分开汇总且不与报工不良重复相加', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id }, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', inspectedQty: 100, defectiveQty: 2 }, actor);
  const result = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(result.productionSummary[0].defectiveQty, 5);
  assert.equal(result.qualitySummary.length, 2);
  assert.equal(result.qualitySummary.find((row) => row.source === 'procurement')?.defectiveQty, 2);
  assert.equal(result.qualitySummary.find((row) => row.source === 'production')?.defectiveQty, 3);
});

test('数据库串行化冲突转成可刷新重试的业务冲突', async () => {
  const f = fixture();
  f.prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' }); };
  await assert.rejects(f.service.saveProductionReport(null, reportInput, actor), /其他人更新/);
});

test('生产任务归属来自真实树，包括其他产品和嵌套任务；不猜标题相同的任务', () => {
  const tree = (tasks: unknown[]) => [{ children: [{ tasks }] }];
  const rows = [
    { key: 'rdws.production.taskCategories', value: tree([{ task_id: 'main-task', title: '相同名称' }]) },
    { key: 'rdws.production.productTaskCategories', value: { 'product-2': tree([{ task_id: 'parent', title: '父任务', subtasks: [{ task_id: 'target-task', title: '相同名称' }] }]) } },
  ];
  assert.deepEqual(locateProductionTaskSource(rows, 'target-task'), { taskId: 'target-task', productId: 'product-2', title: '相同名称' });
  assert.equal(locateProductionTaskSource(rows, 'main-task').productId, 'prod-portable-o2');
  assert.throws(() => locateProductionTaskSource(rows, 'missing'), /不存在/);
  assert.throws(() => locateProductionTaskSource([{ key: 'rdws.production.taskCategories', value: tree([{ task_id: 'old', archived: true }]) }], 'old'), /已归档/);
});

test('存在多产品重复任务编号时拒绝选择任意一个产品', () => {
  const tree = [{ children: [{ tasks: [{ task_id: 'duplicate', title: '重复' }] }] }];
  assert.throws(() => locateProductionTaskSource([{ key: 'rdws.production.taskCategories', value: tree }, { key: 'rdws.production.productTaskCategories', value: { 'other-product': tree } }], 'duplicate'), /不唯一/);
});

test('同批次重复不良记录被拒绝，避免检验数量被重复计入统计', async () => {
  const f = fixture();
  await f.service.saveQualityRecord(null, qualityInput, actor);
  await assert.rejects(f.service.saveQualityRecord(null, qualityInput, actor), /已有同类不良记录/);
  assert.equal(f.quality.length, 1);
});

test('同报工分批检验的分母不能超过实际产量', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, inspectedQty: 60, defectiveQty: 2 }, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, batchNo: 'B-2', inspectedQty: 60, defectiveQty: 2 }, actor), /检验数量合计/);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, batchNo: 'B-2', inspectedQty: 30, defectiveQty: 2 }, actor);
  const result = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(result.qualitySummary[0].inspectedQty, 90);
  assert.equal(result.qualitySummary[0].defectiveQty, 4);
});
