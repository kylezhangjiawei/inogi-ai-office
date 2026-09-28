import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

const permissions = ['proc-task:transfer', 'page:rd-my-workspace'];
const actor = { id: 'buyer', name: '采购甲', permissions: ['proc-task:rollback'] };
const user = (id: string, name: string, grants = permissions, status = 'ACTIVE') => ({ id, name, status, role: { permissions: [...grants] } });

function fixture() {
  const users = [user('requester', '研发甲'), user('same-name', '研发甲'), user('contact', '研发乙'),
    user('owner', '当前主责'), user('admin', '超级管理员', ['*']), user('buyer', '采购甲', ['page:proc-my-workspace']),
    user('reviewer', '旧审核人', ['rd-procurement:review', 'page:rd-my-workspace']), user('disabled', '停用人员', permissions, 'DISABLED')];
  const rdTask: any = { task_id: 'RD/001', title: '原研发任务', primary_owner_user_id: 'owner', primary_owner: '当前主责',
    collaborators: [{ user_id: 'requester', name: '研发甲' }, { user_id: 'contact', name: '研发乙' }] };
  let task: any = { id: 'proc-1', code: 'PR-001', source: 'rd', status: 'testing', rdTaskId: 'RD/001', rdTaskTitle: '原研发任务',
    requesterUserId: 'requester', requester: '研发甲', rdContactUserId: 'contact', rdContact: '研发乙',
    materialName: '传感器', spec: '受控规格 R1', needDate: new Date('2026-10-01'), quantity: 2, unit: '个', method: 'inquiry', buyer: '采购甲', buyerUserId: 'buyer', metadata: {} };
  const messages: any[] = [], logs: any[] = [];
  const match = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) =>
    key === 'OR' ? value.some((clause: any) => match(row, clause)) : key === 'AND' ? value.every((clause: any) => match(row, clause)) : row[key] === value);
  const prisma: any = {
    $queryRaw: async () => [{ id: task.id }],
    user: { findMany: async () => users.filter((item) => item.status === 'ACTIVE') },
    procTask: {
      findUnique: async () => task, findUniqueOrThrow: async () => task,
      updateMany: async ({ where, data }: any) => {
        if (!match(task, where)) return { count: 0 };
        task = { ...task, ...data }; return { count: 1 };
      },
    },
    procQuotation: { deleteMany: async () => ({ count: 0 }) },
    procPurchaseOrderRef: { findMany: async () => [] },
    procTaskLog: { create: async ({ data }: any) => { logs.push(data); } },
    rdMessage: {
      create: async ({ data }: any) => { messages.push(data); return data; },
      updateMany: async ({ where, data }: any) => { const rows = messages.filter((row) => match(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; },
      findMany: async ({ where }: any) => messages.filter((row) => match(row, where)),
    },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work(prisma),
  };
  const rd = Object.assign(Object.create(ResearchDevelopmentService.prototype), { prisma, findTaskAcrossStores: async () => rdTask });
  const service = Object.assign(Object.create(ProcurementService.prototype), { prisma, rdService: rd,
    requireTask: async () => task, serializeTask: (row: any) => row, requireAutomaticRdBuyer: async () => ({ id: 'buyer', name: '采购甲' }),
    notifyBuyerOfRdTransferAssignment: async () => undefined,
  }) as ProcurementService;
  const rollback = () => service.rollbackTask(task.id, { from_status: task.status, status: 'pending_rd_review', reason: '核对需求后继续转采购' }, actor);
  return { service, rd, users, rdTask, messages, logs, rollback, get task() { return task; } };
}

test('退回研发通知原提出人、对接人、当前主责与可处理负责人，不发送审批待办或误投同名账号', async () => {
  const h = fixture();
  await h.rollback();
  assert.equal(h.task.status, 'pending_rd_review');
  assert.deepEqual(h.messages.map((row) => row.recipientId).sort(), ['admin', 'contact', 'owner', 'requester']);
  for (const message of h.messages) {
    const body = JSON.parse(message.body);
    assert.equal(message.type, 'procurement_transfer_returned');
    assert.equal(message.category, 'todo');
    assert.equal(message.recipientNameKey, null);
    assert.equal(body.task_id, h.task.id);
    assert.equal(body.rd_task_id, 'RD/001');
    assert.equal(body.action_label, '继续转采购');
    assert.equal(body.reason, '核对需求后继续转采购');
    assert.equal(body.route, message.recipientId === 'admin' ? '/rd-task/RD%2F001' : '/rd-my-workspace?task=RD%2F001');
    assert.match(body.next_action, /无需管理员审批/);
    assert.doesNotMatch(message.subject, /审核|审批/);
  }
  const notifications = await h.rd.collectInboxMessagesAsNotifications('requester', '研发甲');
  assert.match(notifications[0].message, /继续转采购/);
  assert.doesNotMatch(notifications[0].message, /"type"|procurement_task_id/);
  assert.equal(notifications[0].route, '/rd-my-workspace?task=RD%2F001');
  assert.deepEqual(await h.rd.collectInboxMessagesAsNotifications('same-name', '研发甲'), []);
});

test('普通原研发人员直接继续原采购单，结束退回待办并自动分配采购，无审核权限要求', async () => {
  const h = fixture();
  await h.rollback();
  assert.ok(h.messages.length > 0);
  const result = await h.service.continueRdTransfer(h.task.id, { id: 'requester', name: '研发甲', permissions });
  assert.equal(result.status, 'pending_confirm');
  assert.equal(result.buyerUserId, 'buyer');
  assert.ok(h.messages.every((row) => row.handled && row.read));
  assert.deepEqual(h.logs.map((log) => log.toStatus), ['pending_rd_review', 'pending_confirm']);
});

test('研发先继续完成时，迟到的回退通知不再创建未处理待办', async () => {
  const h = fixture();
  const original = h.rd.requireProcurementTransferAccess.bind(h.rd);
  let continued = false;
  h.rd.requireProcurementTransferAccess = async (...args: any[]) => {
    const result = await original(...args);
    if (!continued) {
      continued = true;
      await h.service.continueRdTransfer(h.task.id, { id: 'requester', name: '研发甲', permissions });
    }
    return result;
  };
  await h.rollback();
  assert.equal(h.task.status, 'pending_confirm');
  assert.equal(h.messages.length, 0);
});

test('停用、无转采购权限、无可打开页面及已离开原任务的人员均不收处理待办，负责人兜底', async () => {
  const h = fixture();
  h.users.find((item) => item.id === 'requester')!.status = 'DISABLED';
  h.users.find((item) => item.id === 'contact')!.role.permissions = ['page:rd-my-workspace'];
  h.users.find((item) => item.id === 'owner')!.role.permissions = ['proc-task:transfer'];
  await h.rollback();
  assert.deepEqual(h.messages.map((row) => row.recipientId), ['admin']);
});

test('历史无账号姓名只允许唯一匹配，账号已存在时不改投同名人员', async () => {
  const h = fixture();
  h.task.requesterUserId = null;
  h.task.rdContactUserId = null;
  h.rdTask.collaborators = [];
  // 管理范围允许处理也不代表同名的非关联人员应收到这条需求。
  for (const id of ['requester', 'same-name', 'contact']) h.users.find((item) => item.id === id)!.role.permissions.push('rd-task:reassign');
  await h.rollback();
  assert.deepEqual(h.messages.map((row) => row.recipientId).sort(), ['admin', 'contact', 'owner']);
});
