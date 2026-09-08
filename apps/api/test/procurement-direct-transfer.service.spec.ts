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
