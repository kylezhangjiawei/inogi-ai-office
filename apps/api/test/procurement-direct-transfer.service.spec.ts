import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

const actor = { id: 'rd-1', name: '研发甲', permissions: ['proc-task:transfer'] };
const buyer = { id: 'buyer-1', name: '采购甲' };
const attachment = { fileName: '图纸.pdf', fileUrl: 'https://example.test/drawing.pdf' };
const input = {
  rdTaskId: 'RD-001', materialName: '电机', quantity: 2,
  attachments: [attachment],
};

function fixture(status?: string) {
  let row: Record<string, any> | null = status ? {
    id: 'proc-1', code: 'PR-001', source: 'rd', status, rdTaskId: 'RD-001',
    rdTaskTitle: '原研发任务', materialName: '电机', quantity: 1, unit: '件',
    method: 'inquiry', requester: '研发甲', requesterUserId: 'rd-1',
    attachments: [attachment], buyer: '', buyerUserId: null,
  } : null;
  const writes: Record<string, any>[] = [];
  const messages: Record<string, any>[] = [];
  const handled: Record<string, any>[] = [];
  const logs: Record<string, any>[] = [];
  const queries: Record<string, any>[] = [];
  const linkedRows = (where: Record<string, any>) => {
    if (!row || (where.rdTaskId && row.rdTaskId !== where.rdTaskId)) return [];
    const participants = where.AND?.[0]?.OR as Record<string, string>[] | undefined;
    if (participants && !participants.some((condition) => Object.entries(condition).every(([key, value]) => row![key] === value))) return [];
    return [{ ...row }];
  };
  const prisma = {
    procTask: {
      count: async ({ where }: { where: Record<string, any> }) => linkedRows(where).length,
      findMany: async ({ where }: { where: Record<string, any> }) => {
        queries.push(where);
        return linkedRows(where);
      },
      findUnique: async () => row && { ...row },
      findUniqueOrThrow: async () => {
        if (!row) throw new Error('missing task');
        return { ...row };
      },
      create: async ({ data }: { data: Record<string, any> }) => {
        writes.push(data);
        row = { id: 'proc-1', ...data, attachments: data.attachments.create };
        return row;
      },
      update: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        if (!row || (where.status && row.status !== where.status)) {
          throw new Prisma.PrismaClientKnownRequestError('Record no longer matches', { code: 'P2025', clientVersion: 'test' });
        }
        writes.push(data);
        row = { ...row, ...data };
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        if (!row || row.status !== where.status) return { count: 0 };
        writes.push(data);
        row = { ...row, ...data };
        return { count: 1 };
      },
    },
    procTaskLog: { create: async (args: Record<string, any>) => { logs.push(args); return args; } },
    rdMessage: { updateMany: async (args: Record<string, any>) => { handled.push(args); return { count: 1 }; } },
    $transaction: async (operation: ((tx: unknown) => unknown) | Promise<unknown>[]) => typeof operation === 'function' ? operation(prisma) : Promise.all(operation),
  };
  const rdService = {
    requireTaskReadAccess: async (_taskId: string, requester: { userId?: string }) => {
      if (!['rd-1', 'admin-1', 'collaborator-1'].includes(requester.userId ?? '')) throw new Error('无任务参与权限');
      return { task_id: 'RD-001', title: '服务器研发任务' };
    },
    requireProcurementTransferAccess: async (_taskId: string, requester: { userId?: string }) => {
      if (!['rd-1', 'admin-1', 'collaborator-1'].includes(requester.userId ?? '')) throw new Error('无任务参与权限');
      return { taskId: 'RD-001', title: '服务器研发任务', participantUserIds: ['rd-1'], participantNames: ['研发甲'] };
    },
    createMessage: async (message: Record<string, any>) => { messages.push(message); return message; },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, rdService as never);
  (service as any).pickAutomaticBuyer = async () => buyer;
  (service as any).resolveRequesterDepartment = async () => '研发部';
  (service as any).getRequesterDepartmentMap = async () => new Map();
  (service as any).nextTaskCode = async () => 'PR-001';
  (service as any).attachmentData = (value: unknown) => value;
  (service as any).serializeTask = (value: unknown) => value;
  return { service, writes, messages, handled, logs, queries, read: () => row, simulateProcurementUpdate: (data: Record<string, any>) => { row = { ...row, ...data }; } };
}

for (const requester of [actor, { id: 'admin-1', name: '研发管理员', permissions: ['*'] }]) {
  test(`${requester.name}首次转采购直接待处理，自动分配并只通知采购人`, async () => {
    const { service, writes, messages } = fixture();
    const result = await service.transferFromRd({ ...input, buyer: '客户端指定人员', buyerUserId: 'injected' }, requester);
    assert.equal(result.status, 'pending_confirm');
    assert.equal(result.buyerUserId, buyer.id);
    assert.equal(result.rdTaskTitle, '服务器研发任务');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].logs.create.toStatus, 'pending_confirm');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].recipient_id, buyer.id);
    assert.equal(JSON.parse(messages[0].body).type, 'procurement_assignment');
    assert.equal(messages.some((message) => JSON.parse(message.body).type === 'review_request'), false);
  });
}

test('取消后重提原单直接回到采购待处理，保留附件且重新自动分配', async () => {
  const { service, writes, messages } = fixture('cancelled');
  const result = await service.transferFromRd(input, actor);
  assert.equal(result.id, 'proc-1');
  assert.equal(result.status, 'pending_confirm');
  assert.equal(result.buyerUserId, buyer.id);
  assert.equal(Number(result.quantity), 2);
  assert.equal(writes[0].attachments, undefined, '重复附件不应再次添加');
  assert.equal(writes[0].logs.create.fromStatus, 'cancelled');
  assert.equal(writes[0].logs.create.toStatus, 'pending_confirm');
  assert.equal(messages.length, 1);
  assert.equal(JSON.parse(messages[0].body).type, 'procurement_assignment');
});

test('已流转任务重复提交不重复分配或通知', async () => {
  const { service, writes, messages } = fixture('pending_confirm');
  const result = await service.transferFromRd(input, actor);
  assert.equal('alreadyTransferred' in result && result.alreadyTransferred, true);
  assert.equal(writes.length, 0);
  assert.equal(messages.length, 0);
});

test('并发重提取消单只有一次成功，另一次不能重复分配或发送通知', async () => {
  const { service, writes, messages } = fixture('cancelled');
  const results = await Promise.allSettled([
    service.transferFromRd(input, actor), service.transferFromRd({ ...input, quantity: 9 }, actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(failed);
  assert.match(String(failed.reason), /已重新提交或已进入采购处理/);
  assert.equal(writes.length, 1);
  assert.equal(messages.length, 1);
});

test('取消单读取后已被采购推进，重提不能覆盖采购状态与负责人', async () => {
  const { service, writes, messages, read, simulateProcurementUpdate } = fixture('cancelled');
  (service as any).pickAutomaticBuyer = async () => {
    simulateProcurementUpdate({ status: 'pending_purchase', buyerUserId: 'active-buyer', quantity: 7 });
    return buyer;
  };
  await assert.rejects(() => service.transferFromRd(input, actor), /已重新提交或已进入采购处理/);
  assert.equal(read()?.status, 'pending_purchase');
  assert.equal(read()?.buyerUserId, 'active-buyer');
  assert.equal(read()?.quantity, 7);
  assert.equal(writes.length, 0);
  assert.equal(messages.length, 0);
});

test('任务协作人可以读取指定任务的存量采购关联，继续沿用原单', async () => {
  const { service, queries } = fixture('pending_rd_review');
  const result = await service.listTasks({ rdLink: 'true', rdTaskId: 'RD-001' }, { ...actor, id: 'collaborator-1' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'proc-1');
  assert.deepEqual(queries[0], { rdTaskId: 'RD-001' });
});

test('无关账号不能通过指定研发任务 ID 读取采购关联', async () => {
  const { service, queries } = fixture('pending_rd_review');
  await assert.rejects(() => service.listTasks({ rdLink: 'true', rdTaskId: 'RD-001' }, { ...actor, id: 'outsider' }), /无任务参与权限/);
  assert.equal(queries.length, 0);
});

test('未指定研发任务 ID 的关联列表仍只返回原申请人或对接人的采购单', async () => {
  const { service, queries } = fixture('pending_rd_review');
  const result = await service.listTasks({ rdLink: 'true' }, { ...actor, id: 'collaborator-1' });
  assert.equal(result.total, 0);
  assert.deepEqual(queries[0], { AND: [{ OR: [{ requesterUserId: 'collaborator-1' }, { rdContactUserId: 'collaborator-1' }] }] });
});

for (const status of [undefined, 'cancelled', 'pending_rd_review']) {
  test(`无可分配采购人时${status ?? '首次提交'}不落入无人处理的新状态`, async () => {
    const { service, writes, messages, read } = fixture(status);
    (service as any).pickAutomaticBuyer = async () => null;
    await assert.rejects(() => service.transferFromRd(input, actor), /采购部门暂无/);
    assert.equal(writes.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(read()?.status, status);
  });
}

test('存量待审任务参与人可直接继续转采购并关闭旧待审通知', async () => {
  const { service, writes, messages, handled } = fixture('pending_rd_review');
  const result = await service.continueRdTransfer('proc-1', actor);
  assert.equal(result.status, 'pending_confirm');
  assert.equal(result.buyerUserId, buyer.id);
  assert.equal(writes.length, 1);
  assert.deepEqual(handled, [{
    where: { type: 'review_request', taskId: 'proc-1', handled: false },
    data: { handled: true, read: true },
  }, {
    where: { type: 'procurement_transfer_returned', taskId: 'proc-1', handled: false },
    data: { handled: true, read: true },
  }]);
  assert.equal(messages.length, 1);
  assert.equal(JSON.parse(messages[0].body).type, 'procurement_assignment');
});

test('存量继续转采购仍拒绝无任务参与权限的账号', async () => {
  const { service, writes, messages } = fixture('pending_rd_review');
  await assert.rejects(() => service.continueRdTransfer('proc-1', { ...actor, id: 'outsider' }), /无任务参与权限/);
  assert.equal(writes.length, 0);
  assert.equal(messages.length, 0);
});

test('并发继续存量转采购只分配一次且只发一条采购通知', async () => {
  const { service, writes, messages } = fixture('pending_rd_review');
  const results = await Promise.allSettled([
    service.continueRdTransfer('proc-1', actor), service.continueRdTransfer('proc-1', actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(writes.length, 1);
  assert.equal(messages.length, 1);
});

test('继续流转要求转采购权限，采购确认仍使用原采购权限', () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.continueRdTransfer), ['proc-task:transfer']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.confirm), ['proc-task:confirm']);
});

test('转采购冻结本人选择的需求与附件，重试不会改成研发的新文件或新数量', async () => {
  const { service, writes } = fixture();
  await service.transferFromRd({ ...input, spec: '规格 A', attachments: [{ ...attachment, fileName: '已选A.pdf' }] }, actor);
  const snapshot = writes[0].metadata.rdTransferSnapshots[0];
  assert.equal(snapshot.rdTaskTitle, '服务器研发任务');
  assert.equal(snapshot.submittedBy, actor.id);
  assert.deepEqual(snapshot.attachments.map((file: any) => file.fileName), ['已选A.pdf']);
  assert.equal(snapshot.attachments[0].technicalDocumentVersionId, null, '旧附件没有登记版本时不猜版本');
  await service.transferFromRd({ ...input, spec: '规格 B', quantity: 99, attachments: [{ ...attachment, fileName: '新版B.pdf' }] }, actor);
  assert.equal(writes.length, 1);
  assert.equal(snapshot.requirement.spec, '规格 A');
  assert.equal(snapshot.requirement.quantity, 2);
});

test('取消后重提追加交付快照，不删除旧快照或其他样品元数据', async () => {
  const { service, writes, simulateProcurementUpdate } = fixture('cancelled');
  const old = { id: 'previous', attachments: [{ fileName: '旧图纸.pdf' }] };
  const sampleTest = { roundId: 'round-1', result: 'failed_resample', note: '需修改尺寸' };
  simulateProcurementUpdate({ metadata: { rdTransferSnapshots: [old], sampleTest, retained: true } });
  await service.transferFromRd({ ...input, quantity: 8 }, actor);
  assert.deepEqual(writes[0].metadata.rdTransferSnapshots[0], old);
  assert.equal(writes[0].metadata.rdTransferSnapshots[1].requirement.quantity, 8);
  assert.deepEqual(writes[0].metadata.sampleTest, sampleTest);
  assert.equal(writes[0].metadata.retained, true);
});

test('技术版本附件由服务端解析，客户端文件名路径和版本展示不能覆盖可信快照', async () => {
  const { service, writes } = fixture();
  const calls: unknown[][] = [];
  (service as any).ossService.isKeyUnderBusinessType = (key: string) => key.startsWith('rd/');
  (service as any).technicalDocuments = { resolveTransferVersions: async (...args: unknown[]) => {
    calls.push(args);
    return [{ id: 'ver-1', documentId: 'doc-1', version: 'A.1', category: 'drawing', title: '受控电机图',
      fileName: '正式图纸.pdf', fileKey: 'rd/original.pdf', fileUrl: '/official.pdf', fileSize: 20, mimeType: 'application/pdf',
      attachmentId: 'a-1', sourceNoteId: 'n-1', createdAt: new Date('2026-09-09T00:00:00Z') }];
  } };
  await service.transferFromRd({ ...input, attachments: [{ ...attachment, fileName: '伪造名称', fileKey: 'secret/other.pdf', technicalDocumentVersionId: 'ver-1' }] }, actor);
  assert.equal(calls[0][0], 'RD-001');
  assert.deepEqual(calls[0][1], ['ver-1']);
  assert.equal((calls[0][2] as any).userId, actor.id);
  const snapshot = writes[0].metadata.rdTransferSnapshots[0].attachments[0];
  assert.equal(snapshot.fileName, '正式图纸.pdf');
  assert.equal(snapshot.fileKey, 'rd/original.pdf');
  assert.equal(snapshot.version, 'A.1');
  assert.equal(snapshot.technicalDocumentVersionId, 'ver-1');
  assert.equal(writes[0].attachments.create[0].fileKey, 'rd/original.pdf');
});

test('越任务或不存在的技术版本不落采购记录，版本服务未就绪也不能降级成无版本附件', async () => {
  const { service, writes } = fixture();
  const versionInput = { ...input, attachments: [{ ...attachment, technicalDocumentVersionId: 'other-task-version' }] };
  await assert.rejects(() => service.transferFromRd(versionInput, actor), /版本服务暂不可用/);
  (service as any).technicalDocuments = { resolveTransferVersions: async () => [] };
  await assert.rejects(() => service.transferFromRd(versionInput, actor), /不存在或不属于/);
  assert.equal(writes.length, 0);
});

test('研发关联摘要保留样品事实但不返回报价、订单价格或商业日志原文', async () => {
  const { service, simulateProcurementUpdate } = fixture('testing');
  const sample = { testerUserId: 'rd-1', testerName: '研发甲', result: null, note: null };
  simulateProcurementUpdate({ sampleTest: sample, quotationTotal: 999, paymentNote: '商业信息', purchaseOrders: [{ unitPrice: 99 }],
    attachmentList: [{ kind: 'quote', fileName: '保密报价.pdf' }, { kind: 'drawing', fileName: '图纸.pdf' }],
    rdTransferSnapshots: [{ id: 'delivery-1', attachments: [{ kind: 'quote', fileName: '快照报价.pdf' }, { kind: 'drawing', fileName: '交付图纸.pdf' }] }],
    logs: [{ text: '供应商报价999元', fromStatus: 'inquiring', toStatus: 'pending_sample' }, { text: '折扣99元' }] });
  const result = await service.listTasks({ rdLink: 'true', rdTaskId: 'RD-001' }, actor);
  const row = result.items[0];
  assert.deepEqual(row.sampleTest, sample);
  assert.equal(row.quotationTotal, undefined);
  assert.equal(row.paymentNote, undefined);
  assert.deepEqual(row.purchaseOrders, []);
  assert.deepEqual(row.attachmentList.map((file) => file.fileName), ['图纸.pdf']);
  assert.deepEqual(row.rdTransferSnapshots[0].attachments.map((file) => file.fileName), ['交付图纸.pdf']);
  assert.equal(JSON.stringify(row.logs).includes('999'), false);
});

test('有研发工作台读取权限不等于可读采购全量列表或执行采购写操作', async () => {
  const { service } = fixture('testing');
  const viewer = { ...actor, permissions: ['page:rd-my-workspace'] };
  assert.equal((await service.listTasks({ rdLink: 'true', rdTaskId: 'RD-001' }, viewer)).total, 1);
  await assert.rejects(() => service.listTasks({}, viewer), /没有查看采购任务列表/);
  assert.ok(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.listTasks).includes('page:rd-my-workspace'));
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.transfer), ['proc-task:transfer']);
});

test('已确认的嵌入式技术文件从可信版本保留原内容，不把客户端短效预览地址当原文件', async () => {
  const { service, writes } = fixture();
  const embedded = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n' + 'x'.repeat(2200)).toString('base64')}`;
  (service as any).technicalDocuments = { resolveTransferVersions: async () => [{
    id: 'embedded-v1', documentId: 'embedded-doc', version: '1.0', category: 'specification', title: '嵌入式规格',
    fileName: '规格.pdf', fileKey: null, fileUrl: embedded, fileSize: 2209, mimeType: 'application/pdf',
    attachmentId: 'embedded-attachment', sourceNoteId: 'note-1', createdAt: new Date('2026-09-09T00:00:00Z'),
  }] };
  await service.transferFromRd({ ...input, attachments: [{ ...attachment,
    fileUrl: '/api/research-development/technical-document-files/embedded-v1?exp=1&sig=expired',
    technicalDocumentVersionId: 'embedded-v1',
  }] }, actor);
  assert.equal(writes[0].attachments.create[0].fileUrl, embedded);
  assert.equal(writes[0].metadata.rdTransferSnapshots[0].attachments[0].fileUrl, embedded);
  assert.equal(writes[0].metadata.rdTransferSnapshots[0].attachments[0].technicalDocumentVersionId, 'embedded-v1');
});
