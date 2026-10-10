import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { BomRevisionsService } from '../src/modules/procurement/bom-revisions.service';
import { buildBomSnapshot } from '../src/modules/procurement/bom-revisions.model';
import { QualityVerificationService } from '../src/modules/procurement/quality-verification.service';
import { WarehouseFlowService } from '../src/modules/procurement/warehouse-flow.service';
import { applyExecutionCommand, executionSummary, executionTaskProgress, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
import { ProductionExecutionService, EXECUTION_PREFIX, WAREHOUSE_PREFIX } from '../src/modules/procurement/production-execution.service';
const actor = { id: 'planner', name: '计划员', permissions: ['page:production-execution', 'production:plan', 'proc-production:report'] };

const inspector = { id: 'quality-worker', name: '检验员', permissions: ['page:production-execution', 'production:inspect'] };
async function reportedWhole() {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 50, goodQty: 50 });
  return { ...f, reportId: (await f.current()).tasks[0].reports[0].id };
}
test('F05 过程检独立计量，不占终检分母或整机完成量，复验不重写首次终检', async () => {
  const f = await reportedWhole();
  const data = { taskId: f.taskId, reportId: f.reportId, date: '2026-09-02', quantity: 50, goodQty: 50 };
  await f.command('inspect', { ...data, kind: 'process', process: '气密检查' }, inspector);
  let plan = await f.current();
  assert.equal(plan.summary.completedQty, 0); assert.deepEqual(plan.summary.firstFinal, { quantity: 0, goodQty: 0, firstPassRate: null });
  await assert.rejects(f.command('inspect', { ...data, kind: 'process', process: '气密检查', quantity: 1, goodQty: 1 }, inspector), /累计不能超过/);
  await f.command('inspect', { ...data, kind: 'process', process: '电气检查' }, inspector);
  await f.command('inspect', { ...data, kind: 'final', process: '整机终检', goodQty: 47, issue: '三台返工' }, inspector);
  plan = await f.current(); assert.equal(plan.summary.completedQty, 47);
  assert.deepEqual(plan.summary.firstFinal, { quantity: 50, goodQty: 47, firstPassRate: 94 });
  assert.equal((await f.service.overview('2026-09', actor)).firstFinal.firstPassRate, 94);
  await assert.rejects(f.command('inspect', { ...data, quantity: 1, goodQty: 1 }, inspector), /累计不能超过/);
});
test('F05 历史未分类记录保留原完成量但不冒充终检，也不能重复登记同一批报工', async () => {
  const f = await reportedWhole(), key = `${EXECUTION_PREFIX}plan:${f.id}`;
  const stored = JSON.parse(f.state.get(key)!.value);
  stored.tasks[0].inspections = [{ id: 'old-inspection', reportId: f.reportId, date: '2026-09-02', quantity: 50, goodQty: 48, actorId: 'old', actorName: '历史检验员' }];
  f.state.set(key, { key, value: JSON.stringify(stored) });
  const plan = await f.current();
  assert.equal(plan.tasks[0].inspections[0].kind, 'legacy'); assert.equal(plan.summary.completedQty, 48);
  assert.equal(plan.summary.legacyCompletedQty, 48); assert.equal(plan.summary.firstFinal.quantity, 0);
  await assert.rejects(f.command('inspect', { taskId: f.taskId, reportId: f.reportId, date: '2026-09-02', quantity: 1, goodQty: 1 }, inspector), /累计不能超过/);
});
test('F05 新检验类型与工序必填，SIP 固定服务端派工版本，客户端不能覆盖', async () => {
  const f = await reportedWhole(), key = `${EXECUTION_PREFIX}plan:${f.id}`;
  const stored = JSON.parse(f.state.get(key)!.value);
  const document = { kind: 'sip', documentId: 'doc-1', versionId: 'version-1', attachmentId: 'attachment-1', name: '气密检验规范', version: 'V1' };
  stored.tasks[0].basis.documents = [document]; f.state.set(key, { key, value: JSON.stringify(stored) });
  const data = { taskId: f.taskId, reportId: f.reportId, date: '2026-09-02', quantity: 50, goodQty: 50 };
  for (const kind of [undefined, 'legacy', 'unknown']) await assert.rejects(f.command('inspect', { ...data, kind }, inspector), /检验类型/);
  await assert.rejects(f.command('inspect', { ...data, process: '' }, inspector), /工序/);
  await f.command('inspect', { ...data, sip: '客户端伪造V9', document: { versionId: 'fake' } }, inspector);
  const inspection = (await f.current()).tasks[0].inspections[0];
  assert.equal(inspection.sip?.text, 'SIP1'); assert.equal(inspection.sip?.source, 'dispatch');
  assert.deepEqual(inspection.sip?.document, document); assert.equal(inspection.sip?.document?.fileId, undefined);
});
test('F05 旧派工无 SIP 时必须填写真实文字依据，并明确人工来源', async () => {
  const f = await reportedWhole(), key = `${EXECUTION_PREFIX}plan:${f.id}`;
  const stored = JSON.parse(f.state.get(key)!.value); delete stored.tasks[0].basis;
  f.state.set(key, { key, value: JSON.stringify(stored) });
  const data = { taskId: f.taskId, reportId: f.reportId, date: '2026-09-02', quantity: 50, goodQty: 50 };
  await assert.rejects(f.command('inspect', data, inspector), /SIP/);
  await f.command('inspect', { ...data, sip: '现场归档检验依据2026-09' }, inspector);
  assert.deepEqual((await f.current()).tasks[0].inspections[0].sip, { text: '现场归档检验依据2026-09', source: 'manual' });
});
async function partiallyStarted() {
  const f = await prepared('whole'); await f.command('dispatch', { taskId: f.taskId });
  await f.warehouse.command(f.taskId, { requestId: 'f06-part-issue-001', version: 1, action: 'issue', reason: '先发料', lines: [{ code: 'V01', quantity: 320, warehouse: '量产仓' }] }, { id: 'warehouse', name: '仓管', permissions: ['page:warehouse-flow', 'warehouse:issue'] });
  await f.warehouse.command(f.taskId, { requestId: 'f06-part-sign-001', version: 2, action: 'sign', reason: '清点签收', lines: [{ code: 'V01', quantity: 320 }] }, { id: 'worker', name: '现场人', permissions: ['page:production-execution'] });
  await f.command('report', { taskId: f.taskId, date: '2026-09-01', quantity: 160, goodQty: 154 });
  return f;
}
test('F06 已开工作业调整保留原号、报工和已发已签收，联动需求与审计且重试幂等', async () => {
  const f = await partiallyStarted(), before = await f.current();
  const input = { action: 'adjust', version: before.version, requestId: 'f06-adjust-started-001', data: { taskId: f.taskId, date: '2026-09-03', line: '装配二线', ownerId: 'worker-2', quantity: 180, reason: '后续安排调整' } };
  await f.service.command(f.id, input, actor); await f.service.command(f.id, input, actor);
  const plan = await f.current(), task = plan.tasks[0], issue = JSON.parse(f.state.get(`${WAREHOUSE_PREFIX}issue:${f.taskId}`)!.value);
  assert.equal(task.id, f.taskId); assert.equal(task.name, before.tasks[0].name); assert.deepEqual(task.reports, before.tasks[0].reports);
  assert.deepEqual(task.basis, before.tasks[0].basis); assert.equal(task.quantity, 180); assert.equal(task.materials[0].requiredQty, 360);
  assert.equal(task.ownerId, 'worker-2'); assert.equal(task.date, '2026-09-03'); assert.equal(task.line, '装配二线');
  assert.equal(issue.lines[0].quantity, 360); assert.equal(issue.lines[0].issuedQty, 320); assert.equal(issue.lines[0].signedQty, 320);
  assert.equal(issue.recipientId, 'worker-2'); assert.equal(issue.neededDate, '2026-09-03'); assert.equal(issue.version, 4);
  const events = plan.events.filter(row => row.action === 'adjust'); assert.equal(events.length, 1);
  assert.equal(events[0].adjustment?.before.quantity, 200); assert.equal(events[0].adjustment?.after.quantity, 180);
  assert.equal(events[0].adjustment?.reportedQty, 160); assert.equal(events[0].adjustment?.warehouse?.lines[0].issuedQty, 320);
  await assert.rejects(f.service.command(f.id, { ...input, requestId: 'f06-adjust-stale-002' }, actor), /已更新/);
});
test('F06 调整拒绝低于已报、低于已发所需、越批次目标、无权限和非法负责人日期', async () => {
  const f = await partiallyStarted(), before = (await f.current()).version;
  const data = { taskId: f.taskId, date: '2026-09-03', line: '二线', ownerId: 'worker', quantity: 180 };
  await assert.rejects(f.command('adjust', { ...data, quantity: 159 }), /已报工/);
  await assert.rejects(f.command('adjust', { ...data, quantity: 201 }), /批次/);
  await assert.rejects(f.command('adjust', { ...data, ownerId: 'disabled' }), /负责人/);
  await assert.rejects(f.command('adjust', { ...data, date: '2026-10-01' }), /日期/);
  await assert.rejects(f.command('adjust', data, { id: 'worker', name: '现场人', permissions: ['page:production-execution', 'proc-production:report'] }), /权限/);
  const issueKey = `${WAREHOUSE_PREFIX}issue:${f.taskId}`, issue = JSON.parse(f.state.get(issueKey)!.value);
  issue.lines[0].issuedQty = 380; f.state.set(issueKey, { key: issueKey, value: JSON.stringify(issue) });
  await assert.rejects(f.command('adjust', data), /已发|已签收/);
  assert.equal((await f.current()).version, before); assert.equal((await f.current()).tasks[0].quantity, 200);
});
test('F06 领料 CAS 冲突使作业、领料和请求记录一起回滚', async () => {
  const f = await partiallyStarted(), before = new Map(f.state);
  const update = f.db.runtimeState.updateMany;
  f.db.runtimeState.updateMany = async args => args.where.key.startsWith(WAREHOUSE_PREFIX) ? { count: 0 } : update(args);
  await assert.rejects(f.command('adjust', { taskId: f.taskId, date: '2026-09-03', line: '二线', ownerId: 'worker-2', quantity: 180 }), /领料/);
  assert.deepEqual(f.state, before);
});

const bom = [{ id: 'valve', code: 'V01', name: '阀组件', unit: '件', qtyPer: 2 }];

test('F09 ECN反馈经办只看到相关批次，上下文可打开但不扩大全量读取',async()=>{
  const f=await prepared(),plan=await f.current(),key=`procurement:lifecycle:v1:plan:${f.id}`;
  const state=JSON.parse(f.state.get(key)!.value);
  state.changes.push({id:'ecn-x',batchIds:[plan.batches[0].id],feedback:[{ownerId:'feedback-owner',reporterId:'reporter',status:'open'}]});
  f.state.set(key,{key,value:JSON.stringify(state)});
  const actor={id:'feedback-owner',name:'反馈经办',permissions:['page:production-execution']};
  const rows=await f.service.list('2026-09',actor);assert.equal(rows.length,1);assert.equal(rows[0].scope,'assigned');assert.equal(rows[0].tasks[0].batchId,plan.batches[0].id);
  assert.equal((await f.service.list('2026-09',{...actor,id:'unrelated'})).length,0);
  await assert.rejects(f.service.command(f.id,{action:'report',version:plan.version,requestId:'ecn-reader-write-rejected',data:{taskId:f.taskId,date:'2026-09-01',quantity:1,goodQty:1,reason:'不能扩大写权限'}},actor),/权限/);
});


async function fieldPrepared(){
  const f=await prepared('whole');await f.command('dispatch',{taskId:f.taskId});
  await f.command('report',{taskId:f.taskId,date:'2026-09-01',quantity:160,goodQty:154});
  const issueKey=`${WAREHOUSE_PREFIX}issue:${f.taskId}`,issue=JSON.parse(f.state.get(issueKey)!.value);
  issue.lines[0].signedBatches=[{batchNo:'LOT-A',quantity:400}];f.state.set(issueKey,{key:issueKey,value:JSON.stringify(issue)});
  const data={taskId:f.taskId,reportId:(await f.current()).tasks[0].reports[0].id,defectiveQty:6,issue:'现场发现划痕及偏位',phenomena:[{name:'划痕',count:6},{name:'偏位',count:2}],fileIds:['evidence-1'],materialBatches:[{code:'V01',batchNo:'LOT-A'}]};
  return {...f,data};
}
test('F07 现场6件8次到质检沿用同质量ID，初检不再新建6件且真实批次和附件保留',async()=>{
  const f=await fieldPrepared();await f.command('field-issue',f.data);
  let plan=await f.current();const field=plan.tasks[0].fieldIssues[0];
  assert.equal(field.defectiveQty,6);assert.equal(f.qualities.size,1);assert.equal(field.quality!.defectiveQty,6);
  const analysis=JSON.parse(f.state.get(`procurement:quality-analysis:v1:${field.qualityId}`)!.value);
  assert.equal(analysis.phenomena.reduce((sum:any,row:any)=>sum+row.count,0),8);assert.equal(analysis.files[0].fileId,'evidence-1');
  assert.deepEqual(field.materialBatches,[{code:'V01',batchNo:'LOT-A'}]);
  await assert.rejects(f.command('inspect',{taskId:f.taskId,reportId:f.data.reportId,date:'2026-09-02',quantity:160,goodQty:154,issue:'QC确认'},inspector),/原异常/);
  await f.command('inspect',{taskId:f.taskId,reportId:f.data.reportId,date:'2026-09-02',quantity:160,goodQty:154,issue:'QC确认',qualityId:field.qualityId},inspector);
  plan=await f.current();assert.equal(f.qualities.size,1);assert.equal(plan.tasks[0].inspections[0].qualityId,field.qualityId);
  assert.equal(plan.tasks[0].fieldIssues[0].inspectionId,plan.tasks[0].inspections[0].id);assert.equal(plan.summary.completedQty,154);
  assert.equal(f.qualities.get(field.qualityId).defectiveQty.toNumber(),6);
});
test('F07 同报工不能重建现场异常，超件数、跨作业批号/附件与他人提报均拒绝',async()=>{
  const f=await fieldPrepared();
  for(const patch of [{defectiveQty:7},{materialBatches:[{code:'V01',batchNo:'FOREIGN'}]},{materialBatches:[{code:'OTHER',batchNo:null}]},{fileIds:['fake-file']}])await assert.rejects(f.command('field-issue',{...f.data,...patch}));
  await assert.rejects(f.command('field-issue',f.data,{id:'other',name:'别人',permissions:['page:production-execution','proc-production:report']}),/负责人/);
  assert.equal(f.qualities.size,0);
  await f.command('field-issue',{...f.data,materialBatches:[{code:'V01',batchNo:null}]});
  assert.equal((await f.current()).tasks[0].fieldIssues[0].materialBatches[0].batchNo,null);
  await assert.rejects(f.command('field-issue',f.data),/已有现场异常/);assert.equal(f.qualities.size,1);
});
test('现场原因与跨部门建议沿原异常留存，不能冒充已认定或正式协同，负责人办理后才转交',async()=>{
  const f=await fieldPrepared();
  const request={department:'研发部',ownerId:'worker-2',ownerName:'伪造姓名'};
  await assert.rejects(f.command('field-issue',{...f.data,initialCause:'invalid'}),/初步原因/);
  await assert.rejects(f.command('field-issue',{...f.data,requestedCollaboration:{...request,department:'质量部'}}),/部门已变化/);
  await assert.rejects(f.command('field-issue',{...f.data,requestedCollaboration:{...request,ownerId:'missing'}}),/建议接收人/);
  assert.equal(f.qualities.size,0);
  await f.command('field-issue',{...f.data,initialCause:'software',requestedCollaboration:request});
  const field=(await f.current()).tasks[0].fieldIssues[0];
  assert.equal(field.initialCause,'software');assert.deepEqual(field.requestedCollaboration,{department:'研发部',ownerId:'worker-2',ownerName:'另一现场人'});
  assert.equal(field.quality!.status,'open');assert.equal(field.quality!.analysis!.state,'pending');assert.equal(field.quality!.analysis!.category,'unknown');
  assert.equal(f.state.has(`${EXECUTION_PREFIX}collaboration:${field.qualityId}`),false);
  const input={qualityId:field.qualityId,baseUpdatedAt:field.quality!.updatedAt,ownerId:'worker-2',department:'研发部',priority:'high',dueDate:'2099-09-30',requiredInfo:'软件复核',verificationPlan:'原批次验证',reason:'负责人初判后转交'};
  await assert.rejects(f.command('assign-quality',input,{id:'worker',name:'现场',permissions:['page:production-execution','proc-production:report']}),/权限/);
  const manager={...actor,permissions:[...actor.permissions,'proc-quality:manage']};
  await assert.rejects(f.command('assign-quality',{...input,department:'其他部门'},manager),/部门已变化/);
  await assert.rejects(f.command('assign-quality',{...input,priority:'invalid'},manager),/优先级/);
  await f.command('assign-quality',input,manager);
  const assigned=(await f.current()).tasks[0].fieldIssues[0].quality!.collaboration;
  assert.equal(assigned.department,'研发部');assert.equal(assigned.priority,'high');assert.equal(assigned.ownerId,'worker-2');assert.equal(assigned.phase,'waiting_reply');assert.equal(f.qualities.size,1);
});
test('F07 原现场异常必须经QC衔接才复验，质检数量不一致及跨报工ID不能绑错异常',async()=>{
  const f=await fieldPrepared();await f.command('field-issue',f.data);
  let field=(await f.current()).tasks[0].fieldIssues[0];
  const manager={...actor,permissions:[...actor.permissions,'proc-quality:manage']};
  await f.command('disposition',{qualityId:field.qualityId,baseUpdatedAt:field.quality!.updatedAt,disposition:'rework',reason:'现场返工'},manager);
  field=(await f.current()).tasks[0].fieldIssues[0];
  await assert.rejects(f.verification.verify(field.qualityId,{requestId:'field-premature-verification',baseUpdatedAt:field.quality!.updatedAt,verificationDate:'2026-09-02',inspectedQty:6,passedQty:6,evidence:'现场声称已处理'},{id:'verifier',name:'复验员',permissions:['proc-quality:verify']}),/质检关联/);
  await assert.rejects(f.command('inspect',{taskId:f.taskId,reportId:f.data.reportId,date:'2026-09-02',quantity:160,goodQty:155,issue:'5件',qualityId:field.qualityId},inspector),/不一致/);
  await assert.rejects(f.command('inspect',{taskId:f.taskId,reportId:f.data.reportId,date:'2026-09-02',quantity:160,goodQty:154,issue:'6件',qualityId:'foreign'},inspector),/不属于/);
  assert.equal(f.qualities.size,1);assert.equal((await f.current()).tasks[0].inspections.length,0);
});
test('F07 现场提交幂等与计划CAS冲突回滚质量记录，不遗留孤儿异常',async()=>{
  const f=await fieldPrepared(),plan=await f.current();
  const input={action:'field-issue',version:plan.version,requestId:'field-idempotent-request-001',data:{...f.data,reason:'现场证据'}};
  const update=f.db.runtimeState.updateMany;f.db.runtimeState.updateMany=async args=>args.where.key===`${EXECUTION_PREFIX}plan:${f.id}`?{count:0}:update(args);
  await assert.rejects(f.service.command(f.id,input,actor),/计划/);assert.equal(f.qualities.size,0);
  assert.equal([...f.state.keys()].some(key=>key.startsWith('procurement:quality-analysis:')),false);
  f.db.runtimeState.updateMany=update;await f.service.command(f.id,input,actor);await f.service.command(f.id,input,actor);
  assert.equal(f.qualities.size,1);assert.equal((await f.current()).tasks[0].fieldIssues.length,1);
});


test('F06 新负责人须先确认适用 ECN，校验通过也不覆盖已执行依据快照', async () => {
  const f = await partiallyStarted(), before = await f.current(), key = `procurement:lifecycle:v1:plan:${f.id}`;
  const lifecycle = JSON.parse(f.state.get(key)!.value);
  lifecycle.changes.push({id:'ecn-1',packageId:'transfer-v1',status:'published',batchIds:[before.batches[0].id],effectiveDate:'2026-09-02',acknowledgments:[{actorId:'worker'}]});
  f.state.set(key,{key,value:JSON.stringify(lifecycle)});
  const data={taskId:f.taskId,date:'2026-09-03',line:'二线',ownerId:'worker-2',quantity:180};
  await assert.rejects(f.command('adjust',data),/尚未确认.*ECN/);
  assert.equal((await f.current()).version,before.version);
  lifecycle.changes[0].acknowledgments.push({actorId:'worker-2'});f.state.set(key,{key,value:JSON.stringify(lifecycle)});
  await f.command('adjust',data);
  assert.deepEqual((await f.current()).tasks[0].basis,before.tasks[0].basis);
});

function fixture() {
  const snapshot = buildBomSnapshot({ deviceId: 'device', productRootId: 'root', structure: [{ id: 'device', parentId: null, name: 'Q7' }, { id: 'leaf', parentId: 'device', name: '阀' }], leaves: [{ nodeId: 'leaf', parentId: 'device', deviceId: 'device', materialId: 'valve', code: 'V01', name: '阀组件', unit: '件', qtyPer: 2 }] });
  const revision = { id: 'revision', deviceId: 'device', productRootId: 'root', retiredAt: null as Date | null, snapshot, fingerprint: snapshot.fingerprint };
  const state = new Map<string, { key: string; value: string }>(), audits: unknown[] = [];
  const qualities = new Map<string, any>();
  const db = {
    $queryRaw: async () => [],
    procBomNode: { findUnique: async ({ where }: any) => where.id === 'device' ? { id: 'device', parentId: null, productRootId: 'root', productLine: 'Q7' } : null },
    procBomRevision: { findUnique: async ({ where }: any) => ['revision', 'revision-2'].includes(where.id) ? { ...revision, id: where.id } : null },
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter((row) => where.OR ? where.OR.some((entry: any) => row.key.startsWith(entry.key.startsWith)) : where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith)).reverse(),
      create: async ({ data }: any) => { assert.equal(state.has(data.key), false); state.set(data.key, { ...data }); return data; },
      update: async ({ where, data }: any) => { const row = { ...state.get(where.key)!, ...data }; state.set(where.key, row); return row; },
      upsert: async ({ where, create, update }: any) => { const row = state.has(where.key) ? { ...state.get(where.key)!, ...update } : create; state.set(where.key, row); return row; },
      updateMany: async ({ where, data }: any) => { const row = state.get(where.key); if (!row || row.value !== where.value) return { count: 0 }; state.set(where.key, { ...row, ...data }); return { count: 1 }; },
    },
    procTaskTreeNode: { findMany: async ({ where }: any) => where.productId === 'product' ? [{ id: 'root', name: '制氧机', parentId: null, productId: 'product' }] : [{ id: 'other-root', name: '其他设备', parentId: null, productId: where.productId }], findFirst: async () => ({ id: 'root', name: '制氧机' }), findUnique: async ({ where }: any) => where.id === 'subsystem' ? { id: 'subsystem', parentId: 'root', productId: 'product' } : where.id === 'root' ? { id: 'root', parentId: null, productId: 'product' } : null },
    user: { findFirst: async ({ where }: any) => ['worker', 'worker-2'].includes(where.id) ? { id: where.id, name: where.id === 'worker' ? '现场人' : '另一现场人', department: where.id === 'worker' ? '生产部' : '研发部', role: { permissions: ['page:production-execution', 'proc-production:report', 'proc-quality:collaborate'] } } : null },
    fileAsset: { findMany: async ({ where }: any) => where.id.in.includes('evidence-1') ? [{ id: 'evidence-1', uploadedBy: 'planner', businessType: 'assets', status: 'active', fileName: '现场照片.png', mimeType: 'image/png', fileSize: 100 }] : [] },
    procInventoryBalance: { findUnique: async () => ({ availableQty: new Prisma.Decimal(10000), unit: '件', syncedAt: new Date('2026-09-01') }) },
    procQualityRecord: {
      create: async ({ data }: any) => { const row = { id: `quality-${qualities.size + 1}`, ...data, resolution: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), treeNode: { name: '阀系统' } }; qualities.set(row.id, row); return row; },
      findMany: async ({ where }: any) => [...qualities.values()].filter((row) => where.id.in.includes(row.id)),
      findUnique: async ({ where }: any) => qualities.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => qualities.get(where.id),
      updateMany: async ({ where, data }: any) => { const row = qualities.get(where.id); if (!row || row.updatedAt.toISOString() !== where.updatedAt.toISOString()) return { count: 0 }; qualities.set(row.id, { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) }); return { count: 1 }; },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); const saved = new Map(state), savedQuality = new Map(qualities); const count = audits.length; try { return await run(db); } catch (error) { state.clear(); saved.forEach((row, key) => state.set(key, row)); qualities.clear(); savedQuality.forEach((row,key) => qualities.set(key,row)); audits.length = count; throw error; } },
  };
  const procurement = { getInventoryReadiness: async () => ({ productLine: 'Q7', items: bom, dataQuality: { invalidBomLines: 0 } }) };
  return { service: new ProductionExecutionService(db as never, procurement as never, new BomRevisionsService(db as never)), verification: new QualityVerificationService(db as never), warehouse: new WarehouseFlowService(db as never), state, audits, qualities, db, revision };
}

test('同产品存在多个目录根时使用设备显式绑定的根，不要求删除其他业务分类', async () => {
  const f = fixture();
  f.db.procTaskTreeNode.findMany = async () => [{ id: 'root', name: '制氧机', parentId: null, productId: 'product' }, { id: 'other-root', name: '另一业务分类', parentId: null, productId: 'product' }];
  const result = await f.service.create({ month: '2026-10', productId: 'product', deviceId: 'device', bomRevisionId: 'revision', targetQty: 10, shipmentTargetQty: 0, reason: '已明确归属', requestId: 'multi-root-plan-0001' }, actor);
  const saved = JSON.parse(f.state.get(`${EXECUTION_PREFIX}plan:${result.id}`)!.value);
  assert.equal(saved.bomSnapshot.productRootId, 'root');
});
const input = { requestId: 'create-production-0001', month: '2026-09', productId: 'product', productLine: 'Q7', deviceId: 'device', bomRevisionId: 'revision', targetQty: 200, shipmentTargetQty: 180, reason: '已确认月度目标' };

test('生产计划拒绝错配、未发布和停用版本，不能用换版本重复建月计划', async () => {
  const f = fixture();
  for (const patch of [{ productId: 'other' }, { deviceId: 'other' }, { bomRevisionId: 'fake' }, { bomRevisionId: '' }]) {
    await assert.rejects(f.service.create({ ...input, ...patch }, actor), /不属于|发布|版本|尚未确认产品归属/);
    assert.equal(f.state.size, 0);
  }
  f.revision.retiredAt = new Date(); await assert.rejects(f.service.create(input, actor), /停用/); f.revision.retiredAt = null;
  await f.service.create({ ...input, productLine: '伪造型号', bom: [] }, actor);
  const plan = (await f.service.list('2026-09', actor))[0]; assert.equal(plan.productLine, 'Q7'); assert.deepEqual(plan.bom, bom); assert.equal(plan.bomRevisionId, 'revision');
  await assert.rejects(f.service.create({ ...input, bomRevisionId: 'revision-2', requestId: 'create-other-version-001' }, actor), /已有计划/);
});
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
    return f.service.command(id, { action, data: { reason: '业务确认依据', ...(action === 'inspect' ? { kind: 'final', process: '整机终检' } : {}), ...data }, version: plan.version, requestId: requestId ?? `execution-request-${plan.version}-${action}` }, who);
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

test('历史计划核对不覆盖原快照，未核对不新增派工，重复确认只留一条记录', async () => {
  const f = await prepared(), key = `${EXECUTION_PREFIX}plan:${f.id}`;
  const stored = JSON.parse(f.state.get(key)!.value); delete stored.bomRevisionId; delete stored.deviceId; delete stored.bomSnapshot;
  f.state.set(key, { key, value: JSON.stringify(stored) });
  await assert.rejects(f.command('dispatch', { taskId: f.taskId }), /历史执行依据待核对/);
  const before = await f.current(), reviewActor = { ...actor, permissions: [...actor.permissions, 'bom:publish', 'page:proc-materials'] };
  const command = { requestId: 'review-legacy-basis-0001', version: before.version, action: 'review-basis', data: { deviceId: 'device', sourceFingerprint: before.bomSourceFingerprint, reason: '核对原始档案' } };
  await assert.rejects(f.service.command(f.id, command, actor), /权限/);
  await f.service.command(f.id, command, reviewActor); await f.service.command(f.id, command, reviewActor);
  const after = await f.current(); assert.deepEqual(after.bom, before.bom); assert.equal(after.id, before.id); assert.equal(after.bomRevisionId, undefined);
  assert.equal(after.events.filter(row => row.action === 'review-basis').length, 1);
  await f.command('dispatch', { taskId: f.taskId });
});

test('历史核对的设备归属失效后列表不再显示已核对，已停用发布版本明确返回状态', async () => {
  const f = await prepared(), key = `${EXECUTION_PREFIX}plan:${f.id}`;
  const stored = JSON.parse(f.state.get(key)!.value);
  delete stored.bomRevisionId; delete stored.bomSnapshot; f.state.set(key, { key, value: JSON.stringify(stored) });
  const before = await f.current();
  await f.service.command(f.id, { requestId: 'review-list-basis-0001', version: before.version, action: 'review-basis', data: { deviceId: 'device', sourceFingerprint: before.bomSourceFingerprint, reason: '核对原档案' } }, { ...actor, permissions: [...actor.permissions, 'bom:publish', 'page:proc-materials'] });
  assert.equal((await f.current()).basisVerified, true);
  f.db.procBomNode.findUnique = async () => ({ id: 'device', parentId: null, productRootId: 'other', productLine: 'Q7' });
  assert.equal((await f.current()).basisVerified, false);
  const published = await prepared();
  const original = published.db.procBomRevision.findUnique;
  published.db.procBomRevision.findUnique = async args => {
    const revision = await original(args);
    assert.ok(revision, '已发布计划必须关联真实 BOM 版本');
    return { ...revision, retiredAt: new Date('2026-09-22'), version: 1 };
  };
  assert.equal((await published.current()).bomRetiredAt, '2026-09-22T00:00:00.000Z');
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
  await assert.rejects(f.command('inspect', { taskId: f.taskId, reportId, quantity: 1, goodQty: 1, date: '2026-09-02' }, inspector), /累计不能超过/);
  await assert.rejects(f.command('inspect', { taskId: f.taskId, reportId, quantity: 1, goodQty: 1, date: '2026-09-02' }), /权限/);
  const manager = { id: 'manager', name: '处置人', permissions: ['page:production-execution', 'proc-quality:manage'] };
  await f.command('disposition', { qualityId: inspection.qualityId, baseUpdatedAt: inspection.quality!.updatedAt, disposition: 'rework', reason: '已按工艺完成返工' }, manager);
  inspection = (await f.current()).tasks[0].inspections[0];
  const verifier = { id: 'verifier', name: '验证人', permissions: ['proc-quality:verify'] };
  await f.verification.verify(inspection.qualityId!, { requestId: 'verify-execution-partial', baseUpdatedAt: inspection.quality!.updatedAt, verificationDate: '2026-09-03', inspectedQty: 3, passedQty: 2, evidence: '逐件复测，2台通过，1台仍异常' }, verifier);
  plan = await f.current(); inspection = plan.tasks[0].inspections[0];
  assert.equal(plan.summary.completedQty, 49); assert.equal(inspection.quality?.status, 'processing');
  assert.deepEqual(plan.summary.firstFinal, { quantity: 50, goodQty: 47, firstPassRate: 94 });
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
  await assert.rejects(f.command('assign-quality', { qualityId: quality.id, baseUpdatedAt: quality.updatedAt, ownerId: 'worker', reason: '缺少期限与交付安排' }, manager), /期限/);
  await f.command('assign-quality', { qualityId: quality.id, baseUpdatedAt: quality.updatedAt, ownerId: 'worker', reason: '请研发核对尺寸公差', dueDate: '2099-09-30', requiredInfo: '尺寸复核记录', verificationPlan: '现场复测三件' }, manager);
  quality = (await f.current()).tasks[0].inspections[0].quality!;
  assert.equal(quality.collaboration.ownerId, 'worker'); assert.equal(f.qualities.size, 1); assert.equal(quality.defectiveQty, 1);
  assert.equal(quality.collaboration.dueDate, '2099-09-30'); assert.equal(quality.collaboration.requiredInfo, '尺寸复核记录'); assert.equal(quality.collaboration.verificationPlan, '现场复测三件');
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
