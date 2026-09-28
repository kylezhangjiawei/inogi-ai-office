import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { sampleTestWithoutCommercial } from '../src/modules/procurement/sample-test';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { AssignSampleTestDto, ConfirmSampleTestDto } from '../src/modules/procurement/dto/procurement.dto';
import { UpdateSampleRecordsDto } from '../src/modules/procurement/dto/procurement.dto';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

const explorationValidation = { kind: 'exploration' as const, checks: (['drawing', 'sip', 'sop', 'fixture', 'trial'] as const).map(key => ({ key, applicability: 'not_applicable' as const, reason: '本轮内部参数探索，不涉及转产资料或试装' })) };

const buyerActor = { id: 'buyer', name: '采购甲', permissions: ['proc-task:inquiry', 'page:proc-my-workspace'] };
const testerActor = { id: 'tester', name: '研发甲', permissions: ['page:rd-my-workspace'] };
const admin = { id: 'admin', name: '管理员', permissions: ['*'] };

function matchesMessage(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((condition: any) => matchesMessage(row, condition));
    if (key === 'AND') return value.every((condition: any) => matchesMessage(row, condition));
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function harness() {
  let task: any = { id: 'sample-task', code: 'PR-SAMPLE', materialName: '压力传感器', spec: '0–100kPa', quantity: 2, unit: '个',
    status: 'pending_sample', buyerUserId: 'buyer', buyer: '采购甲', rdContact: '原研发对接人', rdContactUserId: 'old-contact',
    rdTaskId: 'rd-original', rdTaskTitle: '研发来源任务', metadata: { unrelated: 'preserved' },
    createdAt: new Date('2026-09-08T00:00:00Z'), updatedAt: new Date('2026-09-08T00:00:00Z') };
  const users: any[] = [
    { id: 'buyer', name: '采购甲', department: '采购部', status: 'ACTIVE', role: { permissions: buyerActor.permissions } },
    { id: 'tester', name: '研发甲', department: '研发部', status: 'ACTIVE', role: { permissions: testerActor.permissions } },
    { id: 'tester-2', name: '研发乙', department: '研发部', status: 'ACTIVE', role: { permissions: ['page:rd-my-workspace'] } },
    { id: 'admin', name: '管理员', department: null, status: 'ACTIVE', role: { permissions: ['*'] } },
    { id: 'inactive', name: '停用研发', department: '研发部', status: 'DISABLED', role: { permissions: ['page:rd-my-workspace'] } },
    { id: 'no-page', name: '无工作台人员', department: '研发部', status: 'ACTIVE', role: { permissions: ['proc-task:inquiry'] } },
  ];
  let logs: any[] = [];
  let messages: any[] = [];
  const locks: unknown[][] = [];
  let deleted = false;
  const hooks = { failMessage: false, failCas: false, failHandle: false, afterLock: undefined as (() => Promise<void>) | undefined };
  const view = () => ({ ...task, attachments: task.attachments ?? [], purchaseOrderRefs: task.purchaseOrderRefs ?? [], criticalMaterials: [], logs });
  const tx: any = {
    $queryRaw: async (...args: unknown[]) => { locks.push(args); await hooks.afterLock?.(); return [{ id: task.id }]; },
    user: { findMany: async () => users },
    procTask: {
      findUnique: async () => view(), findUniqueOrThrow: async () => view(),
      update: async ({ data }: any) => {
        const { logs: nestedLogs, ...fields } = data;
        task = { ...task, ...fields, ...(fields.arrivedQty !== undefined ? { arrivedQty: Number(fields.arrivedQty) } : {}) };
        if (nestedLogs?.create) logs.push({ ...nestedLogs.create, createdAt: new Date() });
        return view();
      },
      delete: async () => { deleted = true; return task; },
      updateMany: async ({ where, data }: any) => {
        if (hooks.failCas || (where.status && task.status !== where.status)
          || (where.updatedAt && task.updatedAt.getTime() !== where.updatedAt.getTime())
          || (where.metadata && task.metadata.sampleTest?.roundId !== where.metadata.equals)) return { count: 0 };
        task = { ...task, ...data, ...(data.arrivedQty !== undefined ? { arrivedQty: Number(data.arrivedQty) } : {}), updatedAt: new Date(task.updatedAt.getTime() + 1) };
        return { count: 1 };
      },
    },
    fileAsset: { findMany: async ({ where }: any) => where.id.in.includes('owned-evidence') ? [{ id: 'owned-evidence', fileName: 'test.png', objectKey: 'rd/test.png', fileSize: 20, mimeType: 'image/png', uploadedBy: testerActor.id }] : [] },
    procTaskAttachment: { createMany: async ({ data }: any) => { task.attachments = [...(task.attachments ?? []), ...data.map((file: any, index: number) => ({ ...file, id: `evidence-${index}` }))]; return { count: data.length }; } },
    procQuotation: { count: async () => 1, deleteMany: async () => ({ count: 1 }) },
    procPurchaseOrderRef: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    procTaskLog: { create: async ({ data }: any) => { logs.push({ ...data, createdAt: new Date() }); return data; } },
    auditLog: { create: async ({ data }: any) => data },
    rdMessage: {
      create: async ({ data }: any) => { if (hooks.failMessage) throw new Error('message write failed'); messages.push(data); return data; },
      updateMany: async ({ where, data }: any) => {
        if (hooks.failHandle) throw new Error('handle message failed');
        const rows = messages.filter((row) => row.type === where.type && row.taskId === where.taskId && !row.handled);
        rows.forEach((row) => Object.assign(row, data)); return { count: rows.length };
      },
      findMany: async ({ where }: any) => messages.filter((row) => matchesMessage(row, where)),
    },
  };
  let tail = Promise.resolve();
  const prisma: any = { ...tx,
    // 数据库中事务外 UPDATE 也会等待任务行锁，但不会重新读取之前算出的 status。
    procTask: { ...tx.procTask, update: async (args: unknown) => { await tail; return tx.procTask.update(args); } },
    $transaction: async (work: (client: any) => Promise<unknown>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone({ task, logs, messages, deleted });
    try { return await work(tx); }
    catch (error) { ({ task, logs, messages, deleted } = before); throw error; }
    finally { release(); }
  } };
  const rd = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  (rd as any).prisma = { rdMessage: { ...tx.rdMessage, create: async () => { throw new Error('notification must use the transaction client'); } } };
  const oss = {
    isKeyUnderBusinessType: (key: string) => key.startsWith('rd/'),
    buildInlinePreviewUrl: (key: string) => `/fresh-preview/${encodeURIComponent(key)}`,
  };
  const service = new ProcurementService(prisma, oss as never, {} as never, rd);
  // Existing conclusion/rollback cases use a fully registered sample; new lifecycle cases below use rawAssign.
  const rawAssign = (testerUserId = 'tester') => service.assignSampleTest(task.id, {
    testerUserId, fromStatus: task.status, baseUpdatedAt: task.updatedAt.toISOString(), arrivedAt: '2026-09-08T00:00:00Z',
  }, buyerActor);
  const registerTesting = () => service.updateSampleRecords(task.id, { roundId: task.metadata.sampleTest.roundId, baseUpdatedAt: task.updatedAt.toISOString(),
    startedAt: '2026-09-08T01:00:00Z', finishedAt: '2026-09-08T02:00:00Z' }, { ...testerActor, id: task.metadata.sampleTest.testerUserId });
  const assign = async (testerUserId = 'tester') => { const assigned = await rawAssign(testerUserId); const registered = await registerTesting(); return { ...assigned, sampleTest: registered.sampleTest, updatedAt: registered.task.updatedAt }; };
  return { service, rd, tx, users, hooks, locks, assign, rawAssign, registerTesting, get task() { return task; }, get logs() { return logs; }, get messages() { return messages; }, get deleted() { return deleted; } };
}

const commercialConditions = { priceUnit: '元/套', taxBasis: 'inclusive' as const, taxRate: 13, paymentTerms: '30%定金，验收后付尾款',
  freightTerms: '供应商承担运费', leadTimeStart: 'deposit' as const, leadTimeStartDate: null, note: '本轮任务约定，不对应其他同名物料' };
const recordsInput = (h: ReturnType<typeof harness>, patch: Record<string, unknown>) => ({ roundId: h.task.metadata.sampleTest.roundId, baseUpdatedAt: h.task.updatedAt.toISOString(), ...patch });

test('新分派不把分派时间当实际到样，新轮次必须实际时间齐全才可确认', async () => {
  const h = harness();
  await h.service.assignSampleTest(h.task.id, { testerUserId: 'tester', fromStatus: 'pending_sample', baseUpdatedAt: h.task.updatedAt.toISOString() }, buyerActor);
  assert.equal(h.task.metadata.sampleTest.recordsVersion, 1);
  assert.equal(h.task.metadata.sampleTest.arrivedAt, null);
  const confirmation = { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed' as const, note: '测试通过' };
  await assert.rejects(h.service.confirmSampleTest(h.task.id, confirmation, testerActor), /到样、开测和结束/);
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { startedAt: '2026-09-08T01:00:00Z' }), testerActor), /先由采购登记/);
  await h.service.updateSampleRecords(h.task.id, recordsInput(h, { arrivedAt: '2026-09-08T00:00:00Z' }), buyerActor);
  await h.registerTesting();
  await h.service.confirmSampleTest(h.task.id, confirmation, testerActor);
  assert.equal(h.task.status, 'priced');
  assert.equal(h.messages.length, 2, '登记不额外发送通知');
});

test('实际时间拒绝非法公历、无时区、未来、逆序以及清空；失败不改变登记', async () => {
  const h = harness(); await h.rawAssign();
  for (const patch of [{ arrivedAt: '2026-02-30T00:00:00Z' }, { arrivedAt: '2026-09-08T00:00:00' }, { arrivedAt: '2099-01-01T00:00:00Z' }, { arrivedAt: null }]) {
    const before = structuredClone(h.task.metadata);
    await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, patch), buyerActor), /实际时间/);
    assert.deepEqual(h.task.metadata, before);
  }
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { finishedAt: '2026-09-08T01:00:00Z' }), testerActor), /先登记实际开测/);
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { startedAt: '2026-09-07T23:00:00Z' }), testerActor), /不能早于到样/);
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { startedAt: '2026-09-08T02:00:00Z', finishedAt: '2026-09-08T01:00:00Z' }), testerActor), /不能早于开测/);
  await h.registerTesting();
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { arrivedAt: '2026-09-08T03:00:00Z' }), buyerActor), /不能早于到样/);
});

test('到样和条件需要本任务采购范围及询价权限，开测结束仅本人；身份准确匹配', async () => {
  const h = harness(); await h.rawAssign();
  const own = await h.service.getSampleTest(h.task.id, buyerActor);
  assert.equal(own.canRecordArrival, true); assert.equal(own.canRecordTesting, false);
  const rd = await h.service.getSampleTest(h.task.id, testerActor);
  assert.equal(rd.canRecordArrival, false); assert.equal(rd.canRecordTesting, true); assert.equal(rd.canReadCommercial, false);
  for (const actor of [testerActor, { ...buyerActor, id: 'other', name: buyerActor.name }, { ...buyerActor, permissions: ['page:proc-my-workspace'] }]) {
    await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { commercial: commercialConditions }), actor), /仅有询价权限/);
  }
  for (const actor of [buyerActor, admin, { ...testerActor, id: 'tester-2', name: testerActor.name }]) {
    await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { startedAt: '2026-09-08T01:00:00Z' }), actor), /仅当前指定/);
  }
  await assert.rejects(h.service.assignSampleTest(h.task.id, { testerUserId: 'tester-2', fromStatus: 'testing', baseUpdatedAt: h.task.updatedAt.toISOString(), arrivedAt: '2026-09-08T00:00:00Z' }, { ...buyerActor, id: 'other' }), /没有本任务/);
});

test('无法解释的旧轮次保留原文并提示历史不完整，不在新分派中删除或补造', async () => {
  const h = harness(); h.task.metadata.sampleTest = { roundId: 'legacy-broken', testerName: '旧人员', result: 'unknown-legacy-result' };
  h.task.metadata.sampleTestHistory = [{ legacyOriginal: '历史原值' }];
  await h.rawAssign();
  assert.equal(h.task.metadata.sampleTestHistory[0].legacyOriginal, '历史原值');
  assert.equal(h.task.metadata.sampleTestHistory[1].roundId, 'legacy-broken');
  const result = await h.service.getSampleTest(h.task.id, buyerActor);
  assert.equal(result.historyIncomplete, true); assert.equal(result.history.length, 0);
});

test('结构化采购条件逐字段保存，当前/历史/修订对研发脱敏；同名不借用其他报价', async () => {
  const h = harness(); await h.rawAssign();
  await h.service.updateSampleRecords(h.task.id, recordsInput(h, { commercial: commercialConditions }), buyerActor);
  const first = h.task.metadata.sampleTest.roundId;
  assert.deepEqual((await h.service.getSampleTest(h.task.id, buyerActor)).sampleTest?.commercial, commercialConditions);
  await h.service.updateSampleRecords(h.task.id, recordsInput(h, { commercial: { ...commercialConditions, paymentTerms: '验收后付全款' } }), buyerActor);
  assert.equal(h.task.metadata.sampleTest.revisions[1].commercial.paymentTerms, commercialConditions.paymentTerms);
  await h.rawAssign('tester-2');
  const purchase = await h.service.getSampleTest(h.task.id, buyerActor);
  assert.equal(purchase.history.length, 1);
  assert.equal(purchase.history[0].roundId, first);
  assert.equal(purchase.history[0].archiveReason, 'reassigned');
  assert.equal(purchase.history[0].commercial?.paymentTerms, '验收后付全款');
  assert.equal(purchase.sampleTest?.commercial, null, '新轮次不把旧条件当作已确认约定');
  assert.equal(purchase.sampleTest?.startedAt, null, '新测试人不能继承旧开测记录');
  const nextRd = await h.service.getSampleTest(h.task.id, { ...testerActor, id: 'tester-2' });
  assert.doesNotMatch(JSON.stringify(nextRd), /commercial|定金|全款|元\/套/);
  await assert.rejects(h.service.getSampleTest(h.task.id, testerActor), /不存在/);
});

test('旧版本和旧轮次登记拒绝，并发修改仅一个成功且不产生混合时间', async () => {
  const h = harness(); await h.rawAssign();
  const old = recordsInput(h, { startedAt: '2026-09-08T01:00:00Z' });
  const outcomes = await Promise.allSettled([h.service.updateSampleRecords(h.task.id, old, testerActor), h.service.updateSampleRecords(h.task.id, { ...old, startedAt: '2026-09-08T02:00:00Z' }, testerActor)]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  await assert.rejects(h.service.updateSampleRecords(h.task.id, old, testerActor), /已更新/);
  await h.rawAssign('tester-2');
  await assert.rejects(h.service.updateSampleRecords(h.task.id, { ...old, baseUpdatedAt: h.task.updatedAt.toISOString() }, { ...testerActor, id: 'tester-2' }), /已结束或已改派/);
});

test('回退保留未完成轮次、实际时间和历史，不覆盖无关 metadata，已结束轮次不可改', async () => {
  const h = harness(); await h.assign();
  const id = h.task.metadata.sampleTest.roundId;
  await h.service.resetTaskQuotations(h.task.id, '重做采购', buyerActor);
  assert.equal(h.task.metadata.unrelated, 'preserved');
  assert.equal(h.task.metadata.sampleTest, null);
  assert.equal(h.task.metadata.sampleTestHistory[0].roundId, id);
  assert.equal(h.task.metadata.sampleTestHistory[0].finishedAt, '2026-09-08T02:00:00.000Z');
  assert.equal(h.task.metadata.sampleTestHistory[0].archiveReason, 'workflow_ended');
  await assert.rejects(h.service.updateSampleRecords(h.task.id, { roundId: id, baseUpdatedAt: h.task.updatedAt.toISOString(), arrivedAt: '2026-09-08T00:00:00Z' }, buyerActor), /已结束或已改派/);
});

test('历史无实际记录保持缺失，旧协议已分派轮次仍能提交原结论', async () => {
  const h = harness(); await h.rawAssign();
  const sample = h.task.metadata.sampleTest;
  for (const key of ['recordsVersion', 'arrivedAt', 'startedAt', 'finishedAt', 'commercial', 'revisions']) delete sample[key];
  const before = await h.service.getSampleTest(h.task.id, testerActor);
  assert.equal(before.sampleTest?.arrivedAt, undefined);
  await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: sample.roundId, result: 'failed_resample', note: '旧系统已完成测试，重新送样' }, testerActor);
  await h.rawAssign();
  const history = (await h.service.getSampleTest(h.task.id, buyerActor)).history;
  assert.equal(history[0].arrivedAt, undefined);
  assert.equal(history[0].result, 'failed_resample');
});

test('采购条件有限数值及约定起算日严格校验，DTO嵌套约束生效', async () => {
  const h = harness(); await h.rawAssign();
  for (const patch of [{ taxRate: Infinity }, { taxRate: -1 }, { taxRate: 101 }, { leadTimeStart: 'agreed_date', leadTimeStartDate: '2026-02-30' }, { leadTimeStartDate: '2026-09-08' }]) {
    await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { commercial: { ...commercialConditions, ...patch } }), buyerActor), /采购条件|起算/);
  }
  const invalid = plainToInstance(UpdateSampleRecordsDto, recordsInput(h, { commercial: { ...commercialConditions, taxRate: 101 } }));
  assert.ok(validateSync(invalid).length > 0);
});

test('登记CAS失败回滚时间、采购条件、历史及日志，未新增通知', async () => {
  const h = harness(); await h.rawAssign(); const before = structuredClone(h.task.metadata); const count = h.logs.length;
  h.hooks.failCas = true;
  await assert.rejects(h.service.updateSampleRecords(h.task.id, recordsInput(h, { commercial: commercialConditions }), buyerActor), /已更新/);
  assert.deepEqual(h.task.metadata, before); assert.equal(h.logs.length, count); assert.equal(h.messages.length, 1);
});

test('指定研发测试人员原子确认到样，metadata/研发对接人保留且仅该人员收到待办', async () => {
  const h = harness();
  const result = await h.assign();
  assert.equal(result.status, 'testing');
  assert.equal(result.sampleTest?.testerUserId, 'tester');
  assert.equal(h.task.metadata.unrelated, 'preserved');
  assert.equal(h.task.rdContactUserId, 'old-contact');
  assert.equal(h.logs.length, 2);
  assert.equal(h.messages.length, 1);
  assert.deepEqual([h.messages[0].recipientId, h.messages[0].category, h.messages[0].type], ['tester', 'todo', 'procurement_sample_test_request']);
  assert.equal(JSON.parse(h.messages[0].body).route, '/rd-my-workspace?sampleTest=sample-task');
});

test('存量测试中任务可补指定和改派，旧待办已读已处理且旧轮次不能确认', async () => {
  const h = harness();
  h.task.status = 'testing';
  const first = await h.assign();
  const second = await h.assign('tester-2');
  assert.notEqual(first.sampleTest?.roundId, second.sampleTest?.roundId);
  assert.equal(h.messages[0].handled, true);
  assert.equal(h.messages[0].read, true);
  assert.equal(h.messages[1].recipientId, 'tester-2');
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: first.sampleTest!.roundId, result: 'passed', note: '旧结果' }, testerActor), /仅当前指定/);
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: first.sampleTest!.roundId, result: 'passed', note: '旧结果' }, { ...testerActor, id: 'tester-2' }), /已结束或已改派/);
});

test('候选只含启用且能进入研发工作台的人员，空值/停用/错误权限不能指派', async () => {
  const h = harness();
  assert.deepEqual((await h.service.listSampleTesters()).map((user) => user.id), ['tester', 'tester-2', 'admin']);
  for (const id of ['', 'missing', 'inactive', 'no-page']) await assert.rejects(h.assign(id), /请选择启用/);
  assert.equal(h.messages.length, 0);
});

test('普通指定研发可读取和确认，无采购权限的其他研发不可读，管理员不可代确认', async () => {
  const h = harness();
  await h.assign();
  const response = await h.service.getSampleTest(h.task.id, testerActor);
  assert.equal(response.canConfirm, true);
  assert.equal(response.task.materialName, '压力传感器');
  assert.equal('quotations' in response.task, false);
  await assert.rejects(h.service.getSampleTest(h.task.id, { ...testerActor, id: 'tester-2' }), /不存在/);
  assert.equal((await h.service.getSampleTest(h.task.id, admin)).canConfirm, false);
  assert.equal((await h.service.getSampleTest(h.task.id, buyerActor)).canConfirm, false);
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: response.sampleTest!.roundId, result: 'passed', note: '管理员代办' }, admin), /仅当前指定/);
});

function installDeliveredDocuments(h: ReturnType<typeof harness>) {
  const drawing = { fileName: '阀体图纸-V1.pdf', fileUrl: '/expired-preview/V1', fileKey: 'rd/drawing-v1.pdf', fileSize: 400,
    mimeType: 'application/pdf', kind: 'drawing', technicalDocumentVersionId: 'version-v1', documentId: 'drawing',
    version: 'V1', category: 'drawing', title: '阀体图纸', attachmentId: 'drawing-v1', sourceNoteId: 'source-note-v1', versionCreatedAt: '2026-09-01T00:00:00Z' };
  const quote = { ...drawing, fileName: '供应商报价.pdf', fileKey: 'rd/private-quote.pdf', fileUrl: '/expired-preview/quote',
    kind: 'quote', technicalDocumentVersionId: null, documentId: null, version: null, attachmentId: 'private-quote' };
  h.task.metadata.rdTransferSnapshots = [{ id: 'delivery-v1', submittedAt: '2026-09-02T00:00:00Z', submittedBy: 'tester', submittedByName: '研发甲',
    rdTaskId: 'rd-original', rdTaskTitle: '研发来源任务', requirement: { productId: 'product', materialName: '压力传感器', spec: '0–100kPa', unit: '个', quantity: 2,
      purchaseLink: null, needDate: null, deadline: null, note: '按交付 V1 测试' }, attachments: [drawing, quote] }];
  h.task.attachments = [{ id: 'drawing', ...drawing }, { id: 'quote', ...quote }];
  return { drawing, quote };
}

test('样品详情携带已交付 V1 的新预览地址，研发更新 V2 后不回写快照，并输出真实状态字段', async () => {
  const h = harness();
  await h.assign();
  const { drawing } = installDeliveredDocuments(h);
  const savedSnapshot = structuredClone(h.task.metadata.rdTransferSnapshots);
  // The source workspace has moved to V2; this read must use the previously delivered task metadata.
  const sourceV2 = { ...drawing, technicalDocumentVersionId: 'version-v2', version: 'V2', fileKey: 'rd/drawing-v2.pdf', fileName: '阀体图纸-V2.pdf' };
  (h.service as any).technicalDocuments = { resolveTransferVersions: async () => [sourceV2], list: async () => [sourceV2] };
  h.task.expectedArrivalDate = new Date('2026-09-12T00:00:00Z');
  const response = await h.service.getSampleTest(h.task.id, testerActor);
  const delivered = response.task.rdTransferSnapshots[0].attachments[0];
  assert.equal(delivered.version, 'V1');
  assert.equal(delivered.technicalDocumentVersionId, 'version-v1');
  assert.equal(delivered.fileUrl, '/fresh-preview/rd%2Fdrawing-v1.pdf');
  assert.doesNotMatch(JSON.stringify(response.task.rdTransferSnapshots), /version-v2|drawing-v2/);
  assert.deepEqual(h.task.metadata.rdTransferSnapshots, savedSnapshot, 'serialization must not rewrite the stored snapshot');
  assert.equal(response.task.needSample, true);
  assert.equal(response.task.sampleStatusNeedsReview, false);
  assert.equal(response.task.updatedAt, h.task.updatedAt.toISOString());
  assert.equal(response.task.expectedArrivalDate, '2026-09-12');
});

test('普通研发读取和确认样品都隐藏报价附件及快照报价，采购可见者仍能查看完整交付资料', async () => {
  const h = harness();
  await h.assign();
  installDeliveredDocuments(h);
  const assertRdView = (response: Awaited<ReturnType<ProcurementService['getSampleTest']>>) => {
    assert.deepEqual(response.task.attachmentList.map((file) => file.kind), ['drawing']);
    assert.deepEqual(response.task.rdTransferSnapshots[0].attachments.map((file) => file.kind), ['drawing']);
    assert.doesNotMatch(JSON.stringify(response), /供应商报价|private-quote/);
    assert.equal('quotationTotal' in response.task, false);
    assert.ok(response.task.logs.every((log) => log.text === '状态变更' && log.fromStatus && log.toStatus));
  };
  assertRdView(await h.service.getSampleTest(h.task.id, testerActor));
  for (const actor of [buyerActor, admin]) {
    const response = await h.service.getSampleTest(h.task.id, actor);
    assert.deepEqual(response.task.attachmentList.map((file) => file.kind), ['drawing', 'quote']);
    assert.deepEqual(response.task.rdTransferSnapshots[0].attachments.map((file) => file.kind), ['drawing', 'quote']);
    assert.equal(response.canConfirm, false);
  }
  assertRdView(await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '按交付 V1 完成测试' }, testerActor));
  assert.equal(h.task.attachments.length, 2, 'redaction does not delete commercial attachments');
});

test('旧 passed 经重做报价后再次定价仍保留结论及脱敏回退状态记录，不能丢失失效判断依据', async () => {
  const h = harness();
  await h.assign();
  const confirmed = await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '旧样品实测通过' }, testerActor);
  assert.ok(confirmed.task.logs.some((log) => log.fromStatus === 'testing' && log.toStatus === 'priced'));
  const priorResult = structuredClone(confirmed.sampleTest);
  await h.service.resetTaskQuotations(h.task.id, '报价 999 元需重做', buyerActor);
  // Reproduce a later persisted priced state: its old test conclusion is intentionally retained.
  h.task.status = 'priced';
  h.logs.push({ id: 'later-pricing', fromStatus: 'inquiring', toStatus: 'priced', text: '供应商后续报价 888 元', actor: '采购甲', createdAt: new Date('2026-09-10T03:00:00Z') });
  h.logs.push({ id: 'private-note', text: '结算折扣 777 元', actor: '采购甲', createdAt: new Date('2026-09-10T04:00:00Z') });
  for (const actor of [testerActor, buyerActor]) {
    const response = await h.service.getSampleTest(h.task.id, actor);
    assert.equal(response.task.status, 'priced');
    assert.deepEqual(sampleTestWithoutCommercial(response.sampleTest), priorResult);
    assert.equal(response.canConfirm, false);
    assert.ok(response.task.logs.some((log) => log.fromStatus === 'priced' && log.toStatus === 'pending_inquiry'));
    const later = response.task.logs.find((log) => log.id === 'later-pricing');
    assert.equal(later?.createdAt, '2026-09-10T03:00:00.000Z');
    assert.equal(later?.at, '2026-09-10');
    assert.equal(later?.text, '状态变更');
    assert.equal(response.task.logs.some((log) => log.id === 'private-note'), false);
    assert.doesNotMatch(JSON.stringify(response.task.logs.map(({ text, actor }) => ({ text, actor }))), /999|888|777|报价|结算|实测/);
    assert.ok(response.task.logs.every((log) => Object.keys(log).every((key) => ['id', 'createdAt', 'at', 'fromStatus', 'toStatus', 'actor', 'text'].includes(key))));
  }
});

test('采购页面权限必须同时具有本单读取范围；未获授权者和已改派测试人不能获取交付快照', async () => {
  const h = harness();
  await h.assign();
  installDeliveredDocuments(h);
  const unrelatedBuyer = { id: 'other-buyer', name: '其他采购', permissions: ['page:proc-my-workspace'] };
  for (const actor of [{ ...testerActor, id: 'tester-2' }, unrelatedBuyer]) {
    await assert.rejects(h.service.getSampleTest(h.task.id, actor), /样品测试任务不存在/);
  }
  // An assigned researcher who can open a procurement workspace still cannot read this buyer's quotes.
  const mixedRole = { ...testerActor, permissions: [...testerActor.permissions, 'page:proc-my-workspace'] };
  assert.deepEqual((await h.service.getSampleTest(h.task.id, mixedRole)).task.attachmentList.map((file) => file.kind), ['drawing']);
  await h.assign('tester-2');
  await assert.rejects(h.service.getSampleTest(h.task.id, testerActor), /样品测试任务不存在/);
});

for (const [result, status] of [['passed', 'priced'], ['failed_resample', 'pending_sample'], ['failed_requote', 'inquiring']] as const) {
  test(`研发本人确认 ${result} 后进入 ${status} 并仅通知实际采购负责人`, async () => {
    const h = harness();
    await h.assign();
    const response = await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result, note: '  实测结论  ' }, testerActor);
    assert.equal(response.task.status, status);
    assert.equal(response.canConfirm, false);
    assert.equal(response.sampleTest?.result, result);
    assert.equal(response.sampleTest?.note, '实测结论');
    assert.equal(response.sampleTest?.confirmedByName, '研发甲');
    assert.ok(response.sampleTest?.confirmedAt);
    assert.deepEqual(h.messages.map((message) => [message.recipientId, message.category, message.handled]), [['tester', 'todo', true], ['buyer', 'result', false]]);
    const body = JSON.parse(h.messages[1].body);
    assert.equal(body.route, '/proc-my-workspace?task=sample-task');
    assert.equal(body.result, result);
    assert.equal(body.conclusion, '实测结论');
    assert.equal(h.logs.length, 3);
  });
}

test('重复、并发指定与旧版本只创建一个测试轮次，重复确认只发一个结果', async () => {
  const h = harness();
  const dto = { testerUserId: 'tester', fromStatus: 'pending_sample' as const, baseUpdatedAt: h.task.updatedAt.toISOString(), arrivedAt: '2026-09-08T00:00:00Z' };
  const assignments = await Promise.allSettled([h.service.assignSampleTest(h.task.id, dto, buyerActor), h.service.assignSampleTest(h.task.id, dto, buyerActor)]);
  assert.equal(assignments.filter((item) => item.status === 'fulfilled').length, 1);
  await assert.rejects(h.assign(), /无需重复指定/);
  await assert.rejects(h.service.assignSampleTest(h.task.id, dto, buyerActor), /任务已更新/);
  await h.registerTesting();
  const confirmation = { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed' as const, note: '实测通过' };
  const confirmations = await Promise.allSettled([h.service.confirmSampleTest(h.task.id, confirmation, testerActor), h.service.confirmSampleTest(h.task.id, confirmation, testerActor)]);
  assert.equal(confirmations.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(h.messages.length, 2);
});

test('消息落库失败时指定和确认的状态、metadata、日志与消息标记一起回滚', async () => {
  const h = harness();
  h.hooks.failMessage = true;
  await assert.rejects(h.assign(), /message write failed/);
  assert.equal(h.task.status, 'pending_sample');
  assert.equal(h.task.metadata.sampleTest, undefined);
  assert.equal(h.logs.length, 0);
  h.hooks.failMessage = false;
  await h.assign();
  h.hooks.failMessage = true;
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '实测通过' }, testerActor), /message write failed/);
  assert.equal(h.task.status, 'testing');
  assert.equal(h.task.metadata.sampleTest.result, null);
  assert.equal(h.logs.length, 2);
  assert.equal(h.messages[0].handled, false);
});

test('采购负责人按稳定账号优先，历史姓名必须唯一且启用并有可打开的采购入口', async () => {
  for (const variant of ['missing', 'disabled', 'duplicate', 'no-page', 'stable-missing'] as const) {
    const h = harness();
    await h.assign();
    if (variant === 'missing') { h.task.buyerUserId = null; h.task.buyer = ''; }
    if (variant === 'disabled') h.users[0].status = 'DISABLED';
    if (variant === 'duplicate') { h.task.buyerUserId = null; h.users.push({ ...h.users[0], id: 'same-name' }); }
    if (variant === 'no-page') h.users[0].role.permissions = [];
    if (variant === 'stable-missing') h.task.buyerUserId = 'deleted-account';
    await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '通过' }, testerActor), /请先明确指派有效负责人/, variant);
    assert.equal(h.task.status, 'testing');
  }
  for (const stable of [true, false]) {
    const h = harness();
    if (stable) h.users.push({ ...h.users[0], id: 'same-name' });
    else h.task.buyerUserId = null;
    h.users[0].role.permissions = ['page:proc-cockpit'];
    await h.assign();
    await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '通过' }, testerActor);
    assert.equal(h.messages[1].recipientId, 'buyer');
    assert.equal(JSON.parse(h.messages[1].body).route, '/proc-cockpit?task=sample-task');
  }
});

test('通用流转不能进入测试或代确认结论，只有无轮次的历史未到样纠正保留', async () => {
  const h = harness();
  await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'pending_sample', status: 'testing' }, buyerActor), /须指定测试人员/);
  h.task.status = 'testing';
  for (const status of ['priced', 'inquiring']) await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'testing', status }, buyerActor), /须指定测试人员/);
  await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'testing', status: 'pending_sample' }, buyerActor), /没有登记免费样品/);
  h.task.status = 'pending_sample';
  await h.assign();
  await assert.rejects(h.service.transitionTask(h.task.id, { from_status: 'testing', status: 'pending_sample' }, buyerActor), /须指定测试人员/);
});

test('接口权限仅为指定入口授予采购写权限，测试查看和确认由服务逐任务授权，备注必填', () => {
  assert.deepEqual(Reflect.getMetadata('permissions', ProcurementController.prototype.assignSampleTest), ['proc-task:inquiry']);
  assert.deepEqual(Reflect.getMetadata('permissions', ProcurementController.prototype.sampleTesters), ['proc-task:inquiry']);
  assert.equal(Reflect.getMetadata('permissions', ProcurementController.prototype.getSampleTest), undefined);
  assert.equal(Reflect.getMetadata('permissions', ProcurementController.prototype.confirmSampleTest), undefined);
  for (const note of ['', '   ', 'x'.repeat(501)]) assert.ok(validateSync(plainToInstance(ConfirmSampleTestDto, { roundId: 'round', result: 'passed', note })).length > 0);
  assert.equal(validateSync(plainToInstance(AssignSampleTestDto, { testerUserId: 'tester', fromStatus: 'testing', baseUpdatedAt: '2026-09-08T00:00:00Z' })).length, 0);
});

test('样品通知摘要可读并保留正确入口，普通 createMessage 默认客户端仍兼容', async () => {
  const h = harness();
  await h.assign();
  let notifications = await (h.rd as any).collectInboxMessagesAsNotifications('tester', '研发甲');
  assert.match(notifications[0].message, /请填写并确认测试结论/);
  assert.doesNotMatch(notifications[0].message, /"type"|round_id/);
  assert.equal(notifications[0].route, '/rd-my-workspace?sampleTest=sample-task');
  await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'failed_requote', note: '精度不符合要求' }, testerActor);
  notifications = await (h.rd as any).collectInboxMessagesAsNotifications('buyer', '采购甲');
  assert.match(notifications[0].message, /精度不符合要求/);
  assert.match(notifications[0].message, /需重新询价/);
  (h.rd as any).prisma = h.tx;
  const message = await h.rd.createMessage({ sender: { name: '系统' }, recipient_id: 'buyer', body: '旧调用仍可用', source: 'procurement' });
  assert.equal(message.body, '旧调用仍可用');
});

test('样品通知只按账号匹配，同名研发或采购人不会收到别人的测试消息', async () => {
  const h = harness();
  await h.assign();
  assert.equal(h.messages[0].recipientName, '研发甲');
  assert.equal(h.messages[0].recipientNameKey, null);
  assert.deepEqual(await (h.rd as any).collectInboxMessagesAsNotifications('other-tester', '研发甲'), []);
  await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '符合要求' }, testerActor);
  assert.equal(h.messages[1].recipientNameKey, null);
  assert.deepEqual(await (h.rd as any).collectInboxMessagesAsNotifications('other-buyer', '采购甲'), []);
  await assert.rejects(h.rd.createMessage({ sender: { name: '系统' }, recipient_name: '采购甲',
    body: JSON.stringify({ type: 'procurement_sample_test_result' }), source: 'procurement' }, h.tx), /必须指定收件人账号/);
});

for (const action of ['rollback', 'cancel', 'reset', 'delete'] as const) {
  const operate = (h: ReturnType<typeof harness>) => action === 'rollback'
    ? h.service.rollbackTask(h.task.id, { from_status: 'testing', status: 'pending_sample', reason: '本轮样品作废' }, buyerActor)
    : action === 'cancel' ? h.service.cancelTask(h.task.id, { reason: '需求取消' }, buyerActor)
      : action === 'reset' ? h.service.resetTaskQuotations(h.task.id, '报价错误', buyerActor) : h.service.deleteTask(h.task.id, buyerActor);

  test(`${action} 结束旧样品待办且保留通知留痕，旧轮次不能恢复确认`, async () => {
    const h = harness();
    await h.assign();
    const roundId = h.task.metadata.sampleTest.roundId;
    const originalBody = h.messages[0].body;
    await operate(h);
    assert.equal(h.messages[0].handled, true);
    assert.equal(h.messages[0].read, true);
    assert.equal(h.messages[0].body, originalBody);
    if (action === 'delete') assert.equal(h.deleted, true);
    else {
      assert.equal(h.task.metadata.unrelated, 'preserved');
      assert.equal(h.task.metadata.sampleTest, null);
      assert.equal(h.logs.length, 3);
      h.task.status = 'testing';
      await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId, result: 'passed', note: '旧测试结果' }, testerActor), /仅当前指定|已结束/);
    }
  });

  test(`${action} 的旧待办关闭失败时状态与删除操作一并回滚`, async () => {
    const h = harness();
    await h.assign();
    h.hooks.failHandle = true;
    await assert.rejects(operate(h), /handle message failed/);
    assert.equal(h.task.status, 'testing');
    assert.equal(h.task.metadata.sampleTest.testerUserId, 'tester');
    assert.equal(h.deleted, false);
    assert.equal(h.logs.length, 2);
    assert.equal(h.messages[0].handled, false);
  });
}

test('回退、取消和报价重做保留已确认的测试结论及完整操作日志', async () => {
  for (const action of ['rollback', 'cancel', 'reset']) {
    const h = harness();
    await h.assign();
    await h.service.confirmSampleTest(h.task.id, { validation: explorationValidation, roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '精度与稳定性实测通过' }, testerActor);
    const confirmed = structuredClone(h.task.metadata.sampleTest);
    if (action === 'rollback') await h.service.rollbackTask(h.task.id, { from_status: 'priced', status: 'pending_sample', reason: '重新准备样品' }, buyerActor);
    else if (action === 'cancel') await h.service.cancelTask(h.task.id, { reason: '业务取消' }, buyerActor);
    else await h.service.resetTaskQuotations(h.task.id, '报价需要纠正', buyerActor);
    assert.deepEqual(h.task.metadata.sampleTest, confirmed);
    assert.ok(h.logs.some((log) => log.text.includes('精度与稳定性实测通过')));
    assert.equal(h.messages[1].handled, false, '已确认结果通知不属于待办清理范围');
  }
});

test('退回研发审核同时结束当前样品轮次，重新进入测试不能确认旧轮次', async () => {
  const h = harness();
  h.task.source = 'rd';
  await h.assign();
  const roundId = h.task.metadata.sampleTest.roundId;
  const originalBody = h.messages[0].body;
  const reviewNotices: any[] = [];
  Object.assign(h.service, { notifyRdTransferReturned: async (snapshot: any, _actor: any, reason: string) => {
    assert.equal(h.task.status, 'pending_rd_review');
    assert.equal(h.messages[0].handled, true);
    reviewNotices.push({ id: snapshot.id, reason });
  } });
  await h.service.rollbackTask(h.task.id, {
    from_status: 'testing', status: 'pending_rd_review', reason: '  重新确认研发需求  ',
  }, buyerActor);
  assert.equal(h.task.buyerUserId, null);
  assert.equal(h.task.buyer, '');
  assert.equal(h.task.metadata.unrelated, 'preserved');
  assert.equal(h.task.metadata.sampleTest, null);
  assert.equal(h.messages[0].read, true);
  assert.equal(h.messages[0].body, originalBody);
  assert.deepEqual(reviewNotices, [{ id: h.task.id, reason: '重新确认研发需求' }]);
  assert.equal(h.logs.length, 3);
  h.task.status = 'testing';
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { validation: explorationValidation,
    roundId, result: 'passed', note: '旧轮次结果',
  }, testerActor), /仅当前指定|已结束/);
});

for (const action of ['assign', 'confirm'] as const) {
  test(`采购单同步与样品${action === 'assign' ? '分派' : '确认'}并发时不能写回旧状态`, async () => {
    const h = harness();
    h.task.purchaseOrderRefs = [{ id: 'sample-po', tpOrderNo: 'PO-SAMPLE', receivedQty: 2, metadata: {}, etaDate: null }];
    if (action === 'confirm') await h.assign();
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.hooks.afterLock = async () => { h.hooks.afterLock = undefined; entered(); await gate; };
    const sampleOperation = action === 'assign' ? h.assign() : h.service.confirmSampleTest(h.task.id, { validation: explorationValidation,
      roundId: h.task.metadata.sampleTest.roundId, result: 'passed', note: '已完成精度测试',
    }, testerActor);
    await locked;
    const sync = h.service.recomputeArrival(h.task.id);
    // 让同步查询进入数据库；它必须等待已持有的任务锁后再读取当前状态。
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await Promise.all([sampleOperation, sync]);
    assert.equal(h.task.status, action === 'assign' ? 'testing' : 'priced');
    assert.equal(h.task.metadata.sampleTest.result, action === 'assign' ? null : 'passed');
    assert.equal(Number(h.task.arrivedQty), 2, '同步到货量仍须回填，不能简单丢弃并发同步');
    assert.equal(h.locks.length, action === 'assign' ? 3 : 4);
    assert.ok(h.locks.every(([sql, id]) => /FOR (?:NO KEY )?UPDATE/.test((sql as string[]).join('')) && id === h.task.id));
    assert.equal(h.messages.length, action === 'assign' ? 1 : 2);
    assert.equal((await h.service.getSampleTest(h.task.id, testerActor)).canConfirm, action === 'assign');
  });
}


test('样品通过强制分类与转产受控依据，旧结果仍显示未分类', async () => {
  const h = harness(); await h.assign();
  const dto = { roundId: h.task.metadata.sampleTest.roundId, result: 'passed' as const, note: '实测通过' };
  await assert.rejects(h.service.confirmSampleTest(h.task.id, dto, testerActor), /请选择研发探索或转产验证/);
  assert.equal(h.task.status, 'testing');
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { ...dto, validation: { ...explorationValidation, kind: 'transfer' } }, testerActor), /转产验证必须确认/);
  await h.service.confirmSampleTest(h.task.id, { ...dto, validation: explorationValidation }, testerActor);
  assert.equal(h.task.metadata.sampleTest.validation.kind, 'exploration');
  assert.equal(h.task.metadata.sampleTest.validation.checkedById, testerActor.id);
  assert.equal(h.task.metadata.sampleTest.validation.checks.length, 5);
});

test('转产确认拒绝普通附件替代版本、缺试验结果及伪造引用；成功冻结服务端版本', async () => {
  const h = harness(); await h.assign();
  h.task.attachments = [{ id: 'photo', fileName: '试装照片.png', fileUrl: '/photo', fileKey: 'rd/photo', kind: 'other' }];
  h.task.metadata.rdTransferSnapshots = [{ id: 'delivery-1', attachments: ['drawing', 'sip', 'sop', 'fixture'].map((category, index) => ({ fileName: `${category}.pdf`, fileUrl: '/document', fileKey: `rd/doc-${index}`, technicalDocumentVersionId: `version-${index}`, version: 'V1.2', category, kind: 'drawing' })) }];
  const validation: any = { kind: 'transfer', checks: ['drawing', 'sip', 'sop', 'fixture', 'trial'].map((key, index) => ({ key, applicability: 'required', referenceId: index === 4 ? 'attachment:photo' : `delivery:delivery-1:${index}`, ...(index === 4 ? { outcome: 'passed', reason: '试装 3 件，装配及功能满足要求' } : {}) })) };
  const dto = { roundId: h.task.metadata.sampleTest.roundId, result: 'passed' as const, note: '本轮转产样品验证通过', validation };
  const wrong = structuredClone(validation); wrong.checks[1].referenceId = 'attachment:photo';
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { ...dto, validation: wrong }, testerActor), /固定版本/);
  const fabricated = structuredClone(validation); fabricated.checks[2].referenceId = 'other-task-file';
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { ...dto, validation: fabricated }, testerActor), /不属于本次交付/);
  const missing = structuredClone(validation); missing.checks[4].outcome = 'failed';
  await assert.rejects(h.service.confirmSampleTest(h.task.id, { ...dto, validation: missing }, testerActor), /确认通过/);
  await h.service.confirmSampleTest(h.task.id, dto, testerActor);
  assert.equal(h.task.metadata.sampleTest.validation.checks[1].reference.version, 'V1.2');
  h.task.metadata.rdTransferSnapshots[0].attachments[1].version = 'V9';
  assert.equal(h.task.metadata.sampleTest.validation.checks[1].reference.version, 'V1.2', '确认记录不跟随当前文件变化');
});

test('验证选项过滤报价资料；本人证据上传校验轮次、时间和存储路径', async () => {
  const h = harness(); await h.assign();
  h.task.attachments = [{ id: 'quote', fileName: '内部报价.pdf', fileUrl: '/quote', kind: 'quote' }];
  assert.equal((await h.service.getSampleTest(h.task.id, testerActor)).validationReferences.length, 0);
  const evidence = () => ({ roundId: h.task.metadata.sampleTest.roundId, baseUpdatedAt: h.task.updatedAt.toISOString(), items: [{ fileId: 'owned-evidence' }] });
  await assert.rejects(h.service.addSampleEvidence(h.task.id, evidence(), buyerActor), /仅当前测试人员/);
  await assert.rejects(h.service.addSampleEvidence(h.task.id, { ...evidence(), roundId: 'old' }, testerActor), /已结束或已改派/);
  await assert.rejects(h.service.addSampleEvidence(h.task.id, { ...evidence(), baseUpdatedAt: '2020-01-01T00:00:00Z' }, testerActor), /已更新/);
  await assert.rejects(h.service.addSampleEvidence(h.task.id, { ...evidence(), items: [{ fileId: 'unowned-file' }] }, testerActor), /已上传/);
  const result = await h.service.addSampleEvidence(h.task.id, evidence(), testerActor);
  assert.equal(result.validationReferences.length, 1);
  assert.equal(result.validationReferences[0].technicalDocumentVersionId, null, '证据不能自行升级为受控版本');
  assert.equal(h.task.attachments[1].kind, 'other');
});
