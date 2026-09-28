import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ProductionLifecycleService, lifecycleKey, productionBasis } from '../src/modules/procurement/production-lifecycle.service';
import { activeVersionRanges, versionRangeValues } from '../src/modules/procurement/production-lifecycle-records';
import { executionToday, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';

const today = executionToday(), author = { id: 'author', name: '编制', permissions: ['*'] }, checker = { id: 'checker', name: '验证', permissions: ['*'] }, worker = { id: 'worker', name: '现场', permissions: ['page:production-execution'] }, stranger = { ...worker, id: 'stranger' };
function fixture() {
  const state = new Map<string, { key: string; value: string }>(); let sequence = 0, conflict = false;
  const plan: ExecutionPlan = { id: 'plan', month: today.slice(0, 7), version: 1, productId: 'product', productName: '产品', productLine: 'Q7', targetQty: 10, shipmentTargetQty: 10, bomFingerprint: 'bom', bom: [], batches: [{ id: 'b1', code: 'B1', quantity: 10, dueDate: today }, { id: 'b2', code: 'B2', quantity: 10, dueDate: today }], tasks: [{ id: 't1', batchId: 'b1', name: '装配', treeNodeId: 'node', output: 'whole', unit: '台', quantity: 10, date: today, line: '一线', ownerId: worker.id, ownerName: worker.name, status: 'dispatched', materials: [], reports: [] }], events: [] };
  const put = (key: string, value: unknown) => state.set(key, { key, value: JSON.stringify(value) });
  const savePlan = () => put('procurement:execution:v1:plan:plan', plan); savePlan();
  const versions = ['sop', 'sip', 'drawing'].map(kind => ({ id: kind + '-version', documentId: kind, document: { taskId: 'rd1' }, attachmentId: kind + '-attachment', version: 'V2', fileName: kind + '.pdf', fileKey: kind + '.pdf', fileUrl: '', mimeType: 'application/pdf' }));
  const files = versions.map(row => ({ id: 'file-' + row.id, objectKey: row.fileKey, status: 'active', deletedAt: null as Date | null }));
  const sample = { id: 'sample', code: 'SP1', materialName: '样品', treeNode: { productId: 'product' }, metadata: { rdTransferSnapshots: [{ id: 'snapshot', rdTaskId: 'rd1', attachments: versions.map(row => ({ technicalDocumentVersionId: row.id, documentId: row.documentId })) }], sampleTest: { roundId: 'round', testerUserId: worker.id, testerName: worker.name, assignedAt: today, assignedByName: '采购', recordsVersion: 1, result: 'passed', finishedAt: today, confirmedAt: today } } };
  const users = [author, checker, worker, stranger].map(row => ({ ...row, status: 'ACTIVE', role: { permissions: row.permissions } }));
  const db = {
    runtimeState: {
      findUnique: async ({ where }: any) => state.get(where.key) ?? null,
      findMany: async ({ where }: any) => [...state.values()].filter(row => (where.OR ?? [where]).some((entry: any) => typeof entry.key === 'string' ? row.key === entry.key : row.key.startsWith(entry.key.startsWith))),
      create: async ({ data }: any) => { assert.ok(!state.has(data.key)); state.set(data.key, { ...data }); return data; },
      updateMany: async ({ where, data }: any) => { const row = state.get(where.key); if (conflict || !row || row.value !== where.value) return { count: 0 }; state.set(where.key, { ...row, ...data }); return { count: 1 }; },
    },
    procTask: { findMany: async () => [sample], findUnique: async ({ where }: any) => where.id === sample.id ? sample : null },
    procQualityRecord: { findMany: async () => [] },
    user: { findMany: async () => users.filter(row => row.status === 'ACTIVE'), findFirst: async ({ where }: any) => users.find(row => row.id === where.id && row.status === where.status) ?? null },
    rdTechnicalDocumentVersion: { findMany: async ({ where }: any) => versions.filter(row => where.id.in.includes(row.id)), findUnique: async ({ where }: any) => versions.find(row => row.id === where.id) ?? null },
    fileAsset: { findUnique: async ({ where }: any) => files.find(row => row.objectKey === where.objectKey) ?? null },
    auditLog: { create: async () => ({}) },
    $transaction: async (run: (db: any) => Promise<unknown>, options: any) => { assert.equal(options.isolationLevel, 'Serializable'); const saved = new Map(state); try { return await run(db); } catch (error) { state.clear(); saved.forEach((row, key) => state.set(key, row)); throw error; } },
  };
  const service = new ProductionLifecycleService(db as never, { buildInlinePreviewUrl: (key: string) => '/signed/' + key, getArchiveDownloadUrl: (key: string) => '/download/' + key } as never);
  const read = () => JSON.parse(state.get(lifecycleKey('plan'))?.value ?? '{"version":0,"transfers":[],"changes":[]}');
  const command = (action: string, data: Record<string, unknown>, actor = author, requestId = `lifecycle-records-${++sequence}`) => service.command('plan', { action, requestId, version: read().version, data: { reason: '有实物及文件依据', ...data } }, actor);
  const documents = versions.map((row, index) => ({ kind: ['sop', 'sip', 'drawing'][index], versionId: row.id, fileId: 'client-forged', version: 'client-forged' }));
  async function publish() { await command('transfer', { type: 'validation', code: 'TP1', sampleTaskId: sample.id, roundId: 'round', documents }); const id = read().transfers[0].id; await command('validate-transfer', { id, documentsChecked: true, productionValidated: true }, checker); await command('publish-transfer', { id }); return id; }
  return { state, put, plan, savePlan, versions, files, sample, users, db, service, read, command, documents, publish, conflict: () => { conflict = true; } };
}

test('正式文件必须来自同产品样品已交付版本，伪造元数据不会存入；独立验证及发布均核对原版本', async () => {
  const f = fixture(), input = { type: 'validation', code: 'TP1', sampleTaskId: 'sample', roundId: 'round' };
  await assert.rejects(f.command('transfer', input), /受控文件/);
  await assert.rejects(f.command('transfer', { ...input, documents: f.documents.map(row => ({ ...row, versionId: 'other' })) }), /不属于/);
  f.versions[0].document.taskId = 'other-rd'; await assert.rejects(f.command('transfer', { ...input, documents: f.documents }), /不属于/); f.versions[0].document.taskId = 'rd1';
  await f.command('transfer', { ...input, documents: f.documents }); const pkg = f.read().transfers[0];
  assert.equal(pkg.documents[0].version, 'V2'); assert.equal(pkg.documents[0].fileId, undefined);
  await assert.rejects(f.command('validate-transfer', { id: pkg.id, documentsChecked: true, productionValidated: true }), /非编制人/);
  await f.command('validate-transfer', { id: pkg.id, documentsChecked: true, productionValidated: true }, checker);
  f.files[0].deletedAt = new Date(); await assert.rejects(f.command('publish-transfer', { id: pkg.id }), /停用/); f.files[0].deletedAt = null;
  await f.command('publish-transfer', { id: pkg.id }); assert.equal(f.read().transfers[0].documents[0].fileId, f.files[0].id);
  const basis = await productionBasis(f.db as never, f.plan, 'b1', worker.id); assert.equal(basis.documents?.[0].versionId, f.versions[0].id);
  f.plan.tasks[0].basis = basis; f.savePlan();
  const file = await f.service.document('plan', f.versions[0].id, worker); assert.equal(file.url, '/signed/sop.pdf');
  await assert.rejects(f.service.document('plan', f.versions[0].id, stranger), /本人/);
  await assert.rejects(f.service.document('plan', 'unrelated', worker), /不属于/);
});

test('旧自由文字历史保持可读，但不能新发布；探索记录仍不能成为量产依据', async () => {
  const f = fixture();
  f.put(lifecycleKey('plan'), { version: 1, transfers: [{ id: 'old', code: 'OLD', type: 'validation', status: 'validated', sop: 'old SOP', sip: 'old SIP', drawing: 'old BOM' }], changes: [], releases: [], shipments: [], events: [] });
  assert.equal((await f.service.read('plan', author)).transfers[0].sop, 'old SOP');
  await assert.rejects(f.command('publish-transfer', { id: 'old' }), /受控文件/);
  await f.command('transfer', { type: 'exploration', code: 'EXP', sampleTaskId: 'sample', roundId: 'round', sop: '不适用，探索', sip: '不适用，探索', drawing: '试制图' });
  await assert.rejects(f.command('validate-transfer', { id: f.read().transfers[1].id, documentsChecked: true, productionValidated: true }, checker), /探索/);
});

test('ECN执行反馈按原编号处理，校验经办/权限/期限，未解决阻止新派工；已读不等于解决', async () => {
  const f = fixture(), packageId = await f.publish();
  await f.command('ecn', { code: 'ECN1', packageId, batchIds: ['b1'], effectiveDate: today, handling: '隔离旧料' }); const id = f.read().changes[0].id;
  await f.command('publish-ecn', { id }); await f.command('acknowledge', { id }, worker);
  await assert.rejects(f.command('ecn-feedback', { id, ownerId: author.id, dueDate: today }, stranger), /负责人/);
  await assert.rejects(f.command('ecn-feedback', { id, ownerId: stranger.id, dueDate: today }, worker), /经办人/);
  await assert.rejects(f.command('ecn-feedback', { id, ownerId: author.id, dueDate: '2000-01-01' }, worker), /期限/);
  await f.command('ecn-feedback', { id, ownerId: author.id, dueDate: today, reason: '现场无法执行：治具不匹配' }, worker);
  const feedback = f.read().changes[0].feedback[0];
  await assert.rejects(productionBasis(f.db as never, f.plan, 'b1', worker.id), /执行反馈/);
  await assert.rejects(f.command('handle-ecn-feedback', { id, feedbackId: feedback.id, ownerId: author.id, dueDate: today, status: 'resolved' }, stranger), /经办/);
  await f.command('handle-ecn-feedback', { id, feedbackId: feedback.id, ownerId: author.id, dueDate: today, status: 'resolved', reason: '治具更换并现场确认' });
  assert.equal(f.read().changes[0].feedback[0].history.length, 2); assert.equal(f.read().changes[0].feedback[0].problem, feedback.problem);
  assert.deepEqual((await productionBasis(f.db as never, f.plan, 'b1', worker.id)).changeIds, [id]);
});

test('批次版本分段限量、SN不重复，未知保留待补；更正保留历史，冲突不覆盖', async () => {
  const f = fixture();
  const first = { batchId: 'b1', quantity: 6, range: '首段实物', softwareVersion: 'S1', hardwareVersion: '', serialNumbers: ['SN1', 'SN2'] };
  await f.command('version-range', first); const prior = f.read().versionRanges[0];
  await assert.rejects(f.command('version-range', { ...first, quantity: 5, serialNumbers: [] }), /不能超过/);
  await assert.rejects(f.command('version-range', { ...first, quantity: 1, serialNumbers: ['SN1'] }), /已有 SN/);
  await assert.rejects(f.command('version-range', { ...first, quantity: 1, serialNumbers: ['SN3', 'SN4'] }), /超过/);
  await assert.rejects(f.command('version-range', { ...first, quantity: 1, serialNumbers: [] }, worker), /权限/);
  await f.command('version-range', { ...first, supersedesId: prior.id, hardwareVersion: 'H1', serialNumbers: ['SN1', 'SN2', 'SN3'] });
  assert.equal(f.read().versionRanges.length, 2); assert.equal(f.read().versionRanges[0].hardwareVersion, ''); assert.equal(activeVersionRanges(f.read().versionRanges)[0].hardwareVersion, 'H1');
  await assert.rejects(f.command('version-range', { ...first, supersedesId: prior.id }), /更正/);
  await f.command('version-range', { ...first, quantity: 4, range: '末段', serialNumbers: [], softwareVersion: '' });
  assert.equal(activeVersionRanges(f.read().versionRanges).reduce((sum, row) => sum + row.quantity, 0), 10);
  f.conflict(); await assert.rejects(f.command('version-range', { ...first, batchId: 'b2', serialNumbers: [] }), /已更新/); assert.equal(f.read().versionRanges.length, 3);
  assert.throws(() => versionRangeValues({ ...first, quantity: 1.5 }, f.plan.batches[0], []), /整数/);
});

test('过程检不作为整机完成或放行依据，仍须终检', async () => {
  const f = fixture(), task = f.plan.tasks[0];
  task.reports = [{ id: 'report', date: today, quantity: 10, goodQty: 10, note: '', actorId: worker.id, actorName: worker.name, at: today }];
  task.inspections = [{ id: 'process', reportId: 'report', kind: 'process', date: today, quantity: 10, goodQty: 10, evidence: '过程抽查', actorId: checker.id, actorName: checker.name, at: today, qualityId: null }]; f.savePlan();
  const view = await f.service.read('plan', checker); assert.equal(view.batches[0].completedQty, 0); assert.equal(view.batches[0].uninspected, true);
  await assert.rejects(f.command('release', { batchId: 'b1', quantity: 10, evidenceChecked: true }), /未完成/);
});

test('新增范围重复请求仅落一次，修改相同请求号被拒绝；非本人批次范围与未关联文件不可读取', async () => {
  const f = fixture(), command = { action: 'version-range', version: 0, requestId: 'version-idempotent-01', data: { batchId: 'b2', quantity: 2, range: '第二批首段', softwareVersion: 'S2', hardwareVersion: '', serialNumbers: [], reason: '档案依据' } };
  await f.service.command('plan', command, author); await f.service.command('plan', command, author);
  assert.equal(f.read().versionRanges.length, 1);
  await assert.rejects(f.service.command('plan', { ...command, data: { ...command.data, quantity: 3 } }, author), /提交标识/);
  const view = await f.service.read('plan', worker);
  assert.equal(view.versionRanges.length, 0); assert.deepEqual(view.batches.map(row => row.id), ['b1']);
  assert.equal(view.sampleTasks.length, 0);
  await assert.rejects(f.service.document('plan', f.versions[0].id, worker), /不属于/);
});
