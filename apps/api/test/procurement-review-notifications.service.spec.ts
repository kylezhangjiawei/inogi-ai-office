import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { DEFAULT_ROLES } from '../src/modules/roles/roles.defaults';

const actor = { id: 'buyer-1', name: '采购审核人', permissions: ['proc-task:confirm'] };

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proc-1',
    code: 'PR-001',
    source: 'rd',
    status: 'pending_confirm',
    method: 'inquiry',
    materialName: '测试物料',
    spec: '50 × 20 mm',
    quantity: 12,
    unit: '件',
    needDate: new Date('2026-08-20T00:00:00.000Z'),
    deadline: new Date('2026-08-25T00:00:00.000Z'),
    priority: 'high',
    rdTaskId: 'RD-001',
    rdTaskTitle: '研发任务 A',
    rdContact: '研发甲',
    rdContactUserId: 'rd-1',
    requester: '研发甲',
    requesterUserId: 'rd-1',
    requesterDept: '研发部',
    ...overrides,
  };
}

function makeService(task: Record<string, unknown>, users: Array<Record<string, unknown>>) {
  const messages: Array<Record<string, unknown>> = [];
  const deletedIds: string[] = [];
  const handledReviewMessages: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  const taskLogs: Array<Record<string, unknown>> = [];
  let taskRow: Record<string, unknown> | null = { ...task };
  const prisma = {
    procTask: {
      findUnique: async () => taskRow,
      findUniqueOrThrow: async () => {
        if (!taskRow) throw new Error('missing task');
        return taskRow;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        taskRow = { ...taskRow, ...data };
        return taskRow;
      },
      updateMany: async (args: Record<string, any>) => {
        taskUpdates.push(args);
        if (!taskRow || args.where?.status !== taskRow.status) return { count: 0 };
        taskRow = { ...taskRow, ...args.data };
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { id: string; status?: string } }) => {
        if (!taskRow || (where.status && where.status !== taskRow.status)) return { count: 0 };
        deletedIds.push(where.id);
        taskRow = null;
        return { count: 1 };
      },
    },
    procTaskLog: {
      create: async (args: Record<string, unknown>) => {
        taskLogs.push(args);
        return args;
      },
    },
    user: {
      findMany: async () => users,
    },
    rdMessage: {
      updateMany: async (args: Record<string, unknown>) => {
        handledReviewMessages.push(args);
        return { count: 1 };
      },
    },
    $transaction: async (arg: unknown) => {
      if (typeof arg === 'function') return arg(prisma);
      return Promise.all(arg as Array<Promise<unknown>>);
    },
  };
  const rdService = {
    createMessage: async (message: Record<string, unknown>) => {
      messages.push(message);
      return message;
    },
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    rdService as never,
  );
  return { service, messages, deletedIds, handledReviewMessages, taskUpdates, taskLogs, prisma };
}

test('转采购审核通过同时通知需求提出人、研发对接人与全部超级管理员，并按权限生成入口', async () => {
  const task = makeTask();
  const { service, messages } = makeService(task, [
    { id: 'rd-1', name: '研发甲', role: { permissions: ['page:rd-my-workspace'] } },
    { id: 'admin-1', name: '超级管理员甲', role: { permissions: ['*'] } },
    { id: 'admin-2', name: '超级管理员乙', role: { permissions: ['*'] } },
    { id: 'normal-1', name: '普通成员', role: { permissions: ['proc-task:confirm'] } },
  ]);
  (service as any).applyTransition = async () => ({ status: 'pending_inquiry' });

  await service.confirmTask('proc-1', actor);

  assert.deepEqual(
    messages.map((message) => message.recipient_id).sort(),
    ['admin-1', 'admin-2', 'rd-1'],
  );
  assert.ok(messages.every((message) => message.subject === '转采购审核通过 · 测试物料'));
  assert.ok(messages.every((message) => {
    const body = JSON.parse(String(message.body)) as Record<string, unknown>;
    return body.type === 'procurement_review_result'
      && body.procurement_code === 'PR-001'
      && body.specification === '50 × 20 mm'
      && body.quantity === 12
      && body.procurement_method_label === '询价采购'
      && body.reviewer_name === '采购审核人'
      && body.next_status_label === '待询价';
  }));
  const rdMessage = messages.find((message) => message.recipient_id === 'rd-1');
  assert.ok(rdMessage);
  const rdBody = JSON.parse(String(rdMessage.body)) as Record<string, unknown>;
  assert.deepEqual(
    {
      route: rdBody.route,
      action_label: rdBody.action_label,
      recipient_reason: rdBody.recipient_reason,
    },
    {
      route: '/rd-my-workspace?task=RD-001',
      action_label: '查看原研发任务',
      recipient_reason: '研发对接人、需求提出人',
    },
  );
  for (const adminId of ['admin-1', 'admin-2']) {
    const adminMessage = messages.find((message) => message.recipient_id === adminId);
    assert.ok(adminMessage);
    const body = JSON.parse(String(adminMessage.body)) as Record<string, unknown>;
    assert.equal(body.route, '/proc-cockpit?task=proc-1');
    assert.equal(body.action_label, '查看采购任务');
    assert.equal(body.recipient_reason, '超级管理员');
  }
  assert.ok(messages.every((message) => (message.meta as { outcome: string }).outcome === 'approved'));
});

test('转采购审核打回通知超级管理员，研发对接人本身是超管时不重复发送', async () => {
  const task = makeTask({
    rdContact: '超级管理员甲',
    rdContactUserId: 'admin-1',
    requester: '超级管理员甲',
    requesterUserId: 'admin-1',
  });
  const { service, messages, deletedIds } = makeService(task, [
    { id: 'admin-1', name: '超级管理员甲', role: { permissions: ['*'] } },
    { id: 'admin-2', name: '超级管理员乙', role: { permissions: ['*'] } },
  ]);
  const result = await service.rejectRdTask('proc-1', '图纸需要补充尺寸', actor);

  assert.deepEqual(result, { ok: true, deletedId: 'proc-1' });
  assert.deepEqual(deletedIds, ['proc-1']);
  assert.deepEqual(
    messages.map((message) => message.recipient_id).sort(),
    ['admin-1', 'admin-2'],
  );
  assert.ok(messages.every((message) => message.subject === '转采购已打回 · 测试物料'));
  assert.ok(messages.every((message) => {
    const body = JSON.parse(String(message.body)) as Record<string, unknown>;
    return body.type === 'procurement_review_result'
      && body.reason === '图纸需要补充尺寸'
      && body.task_deleted === true
      && body.next_action === '请返回原研发任务，根据打回原因修改资料后重新转采购。'
      && body.route === '/rd-task/RD-001';
  }));
  assert.ok(messages.every((message) => (message.meta as { outcome: string }).outcome === 'rejected'));
  assert.ok(messages.every((message) => (message.meta as { route: string }).route === '/rd-task/RD-001'));
});

test('转采购人与研发对接人不是同一账号时，两人均收到通知且不向同名账号误投', async () => {
  const task = makeTask({
    rdContact: '同名成员',
    rdContactUserId: 'contact-2',
    requester: '需求提出人',
    requesterUserId: 'requester-1',
  });
  const { service, messages } = makeService(task, [
    { id: 'contact-2', name: '同名成员', role: { permissions: ['page:rd-task-management'] } },
    { id: 'same-name-3', name: '同名成员', role: { permissions: ['page:rd-my-workspace'] } },
    { id: 'requester-1', name: '需求提出人', role: { permissions: ['page:rd-my-workspace'] } },
    { id: 'admin-1', name: '超级管理员', role: { permissions: ['*'] } },
  ]);
  (service as any).applyTransition = async () => ({ status: 'pending_inquiry' });

  await service.confirmTask('proc-1', actor);

  assert.deepEqual(
    messages.map((message) => message.recipient_id).sort(),
    ['admin-1', 'contact-2', 'requester-1'],
  );
  assert.equal(messages.some((message) => message.recipient_id === 'same-name-3'), false);
  assert.equal(
    JSON.parse(String(messages.find((message) => message.recipient_id === 'contact-2')!.body)).recipient_reason,
    '研发对接人',
  );
  assert.equal(
    JSON.parse(String(messages.find((message) => message.recipient_id === 'requester-1')!.body)).recipient_reason,
    '需求提出人',
  );
});

test('审核通过与打回使用同一个确认权限', () => {
  const confirmPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ProcurementController.prototype.confirm,
  ) as string[];
  const rejectPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ProcurementController.prototype.reject,
  ) as string[];
  assert.deepEqual(confirmPermissions, ['proc-task:confirm']);
  assert.deepEqual(rejectPermissions, confirmPermissions);
});

test('采购敏感读取接口在后端声明页面权限，不能只依赖前端隐藏', () => {
  const taskPermissions = Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.listTasks) as string[];
  const detailPermissions = Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.getTask) as string[];
  const quotationPermissions = Reflect.getMetadata(PERMISSIONS_KEY, ProcurementController.prototype.listQuotations) as string[];
  assert.ok(taskPermissions.includes('page:proc-cockpit'));
  assert.ok(taskPermissions.includes('proc-task:transfer'));
  assert.ok(detailPermissions.includes('rd-procurement:review'));
  assert.ok(quotationPermissions.includes('page:proc-materials'));
});

test('研发默认角色同时具备转采购权限，研发管理员额外具备前置审核权限', () => {
  const member = DEFAULT_ROLES.find((role) => role.name === '研发人员');
  const manager = DEFAULT_ROLES.find((role) => role.name === '研发管理员');
  assert.ok(member?.permissions.includes('proc-task:transfer'));
  assert.ok(manager?.permissions.includes('proc-task:transfer'));
  assert.ok(manager?.permissions.includes('rd-procurement:review'));
  assert.equal(member?.permissions.includes('rd-procurement:review'), false);
});

test('转采购采用已校验的研发对接人账号，且对接人必须属于原研发任务', async () => {
  const prisma = {
    user: {
      findUnique: async () => ({ department: '研发部' }),
      findFirst: async () => ({ id: 'unrelated-user', name: '其他人员' }),
    },
  };
  const rdService = {
    requireProcurementTransferAccess: async () => ({
      taskId: 'RD-001',
      title: '服务端研发任务',
      participantUserIds: ['rd-1'],
      participantNames: ['研发甲'],
    }),
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, rdService as never);
  await assert.rejects(
    () => service.transferFromRd({
      rdTaskId: 'RD-001',
      rdContact: '其他人员',
      rdContactUserId: 'unrelated-user',
      materialName: '测试物料',
      quantity: 1,
      attachments: [{ fileName: '图纸.pdf', fileUrl: 'https://example.test/drawing.pdf' }],
    }, {
      id: 'rd-1',
      name: '研发甲',
      permissions: ['proc-task:transfer'],
    }),
    /研发对接人必须是该研发任务的主责人或协作人/,
  );
});

test('转采购前置审核只通知研发审核权限账号与超级管理员，不通知普通研发或采购人员', async () => {
  const task = makeTask({ status: 'pending_rd_review', buyer: '', buyerUserId: null });
  const { service, messages } = makeService(task, [
    { id: 'rd-admin', name: '研发管理员', role: { permissions: ['rd-procurement:review'] } },
    { id: 'super-admin', name: '超级管理员', role: { permissions: ['*'] } },
    { id: 'rd-editor', name: '研发编辑', role: { permissions: ['rd-task:edit'] } },
    { id: 'buyer', name: '采购人员', role: { permissions: ['proc-task:confirm'] } },
  ]);

  await (service as any).notifyRdAdminsOfTransferReview(task);

  assert.deepEqual(
    messages.map((message) => message.recipient_id).sort(),
    ['rd-admin', 'super-admin'],
  );
  assert.ok(messages.every((message) => {
    const body = JSON.parse(String(message.body)) as Record<string, unknown>;
    return body.type === 'review_request'
      && body.review_type === 'procurement_transfer'
      && body.task_id === 'proc-1'
      && body.rd_task_id === 'RD-001'
      && body.procurement_code === 'PR-001';
  }));
});

test('研发管理员审核通过后才进入采购待处理，并仅从采购部门分配负责人', async () => {
  const task = makeTask({ status: 'pending_rd_review', buyer: '', buyerUserId: null });
  const { service, messages, handledReviewMessages, taskUpdates, taskLogs } = makeService(task, [
    { id: 'rd-1', name: '研发甲' },
  ]);
  let buyerScope: string | undefined = 'not-called';
  (service as any).pickAutomaticBuyer = async (scope?: string) => {
    buyerScope = scope;
    return { id: 'buyer-dept', name: '采购部甲' };
  };
  (service as any).serializeTask = (value: unknown) => value;

  const result = await service.approveRdTransfer('proc-1', {
    id: 'rd-admin',
    name: '研发管理员',
    permissions: ['rd-procurement:review'],
  });

  const updatedData = taskUpdates[0].data as Record<string, unknown>;
  assert.equal(buyerScope, undefined);
  assert.equal(updatedData.status, 'pending_confirm');
  assert.equal(updatedData.buyer, '采购部甲');
  assert.equal(updatedData.buyerUserId, 'buyer-dept');
  assert.equal((result as Record<string, unknown>).status, 'pending_confirm');
  assert.equal((taskLogs[0].data as Record<string, unknown>).toStatus, 'pending_confirm');
  assert.deepEqual(handledReviewMessages[0], {
    where: { type: 'review_request', taskId: 'proc-1', handled: false },
    data: { handled: true, read: true },
  });
  assert.equal(messages.length, 2);
  const resultMessage = messages.find((message) => message.recipient_id === 'rd-1');
  assert.ok(resultMessage);
  const resultBody = JSON.parse(String(resultMessage.body)) as Record<string, unknown>;
  assert.equal(resultBody.type, 'review_result');
  assert.equal(resultBody.review_type, 'procurement_transfer');
  assert.match(String(resultBody.note), /采购部甲/);
  const buyerMessage = messages.find((message) => message.recipient_id === 'buyer-dept');
  assert.ok(buyerMessage);
  const buyerBody = JSON.parse(String(buyerMessage.body)) as Record<string, unknown>;
  assert.equal(buyerBody.type, 'procurement_assignment');
  assert.equal(buyerBody.route, '/proc-my-workspace?task=proc-1');
  assert.match(String(buyerBody.next_action), /确认接收/);
});

test('研发管理员打回会删除待审采购记录并允许研发侧重新提交', async () => {
  const task = makeTask({ status: 'pending_rd_review', buyer: '', buyerUserId: null });
  const { service, deletedIds, messages, handledReviewMessages } = makeService(task, [
    { id: 'rd-1', name: '研发甲' },
    { id: 'super-admin', name: '超级管理员', role: { permissions: ['*'] } },
  ]);

  const result = await service.rejectRdTransfer('proc-1', '请补充完整图纸', {
    id: 'rd-admin',
    name: '研发管理员',
    permissions: ['rd-procurement:review'],
  });

  assert.deepEqual(result, { ok: true, deletedId: 'proc-1' });
  assert.deepEqual(deletedIds, ['proc-1']);
  assert.equal(handledReviewMessages.length, 2);
  assert.deepEqual(handledReviewMessages.map((item: any) => item.where.type), ['review_request', 'procurement_transfer_returned']);
  assert.deepEqual(messages.map((message) => message.recipient_id).sort(), ['rd-1', 'super-admin']);
  for (const message of messages) {
    const body = JSON.parse(String(message.body)) as Record<string, unknown>;
    assert.equal(body.result, 'rejected');
    assert.equal(body.reason, '请补充完整图纸');
    assert.equal(body.note, '请按打回原因修改后重新转采购。');
  }
});

test('普通采购状态接口不能绕过研发管理员前置审核', async () => {
  const task = makeTask({ status: 'pending_rd_review' });
  const { service } = makeService(task, []);

  await assert.rejects(
    service.transitionTask('proc-1', { status: 'pending_confirm', from_status: 'pending_rd_review' }, {
      id: 'buyer',
      name: '采购人员',
      permissions: ['proc-task:inquiry'],
    }),
    /尚待研发管理员审核/,
  );
});

test('普通采购列表的状态筛选不会被隐藏待研发审核条件覆盖', async () => {
  let capturedWhere: Record<string, unknown> | null = null;
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
    procTask: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return 0;
      },
      findMany: async () => [],
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);

  await service.listTasks({ status: 'pending_confirm,in_transit' }, {
    id: 'buyer',
    name: '采购人员',
    permissions: ['page:proc-cockpit'],
  });

  assert.deepEqual((capturedWhere as unknown as { status: unknown }).status, {
    in: ['pending_confirm', 'in_transit'],
  });
});

test('待研发审核状态不能通过普通采购列表的 status 参数越权读取', async () => {
  let capturedWhere: Record<string, unknown> | null = null;
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
    procTask: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return 0;
      },
      findMany: async () => [],
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);

  await service.listTasks({ status: 'pending_rd_review' }, {
    id: 'buyer',
    name: '采购人员',
    permissions: ['page:proc-cockpit'],
  });

  assert.deepEqual((capturedWhere as unknown as { status: unknown }).status, {
    in: ['__hidden_status__'],
  });
});

test('只有转采购权限的研发人员不能借普通列表读取采购驾驶舱数据', async () => {
  const service = new ProcurementService({} as never, {} as never, {} as never, {} as never);
  await assert.rejects(
    () => service.listTasks({}, {
      id: 'rd-member',
      name: '研发成员',
      permissions: ['proc-task:transfer'],
    }),
    /没有查看采购任务列表的权限/,
  );
});

test('仅有采购个人工作台权限时，服务端强制只查分配给本人的任务', async () => {
  let capturedWhere: Record<string, unknown> | null = null;
  const prisma = {
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
    procTask: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return 0;
      },
      findMany: async () => [],
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
  await service.listTasks({}, {
    id: 'buyer-own',
    name: '采购人员',
    permissions: ['page:proc-my-workspace'],
  });
  assert.deepEqual((capturedWhere as unknown as { AND: unknown[] }).AND, [{
    OR: [
      { buyerUserId: 'buyer-own' },
      { buyerUserId: null, buyer: '采购人员' },
    ],
  }]);
});

test('研发管理员并发审核同一申请时只有一个请求能改变状态', async () => {
  const task = makeTask({ status: 'pending_rd_review', buyer: '', buyerUserId: null });
  const { service } = makeService(task, [{ id: 'rd-1', name: '研发甲' }]);
  (service as any).pickAutomaticBuyer = async () => ({ id: 'buyer-dept', name: '采购部甲' });
  (service as any).serializeTask = (value: unknown) => value;

  const settled = await Promise.allSettled([
    service.approveRdTransfer('proc-1', { id: 'rd-admin-a', name: '研发管理员甲', permissions: ['rd-procurement:review'] }),
    service.approveRdTransfer('proc-1', { id: 'rd-admin-b', name: '研发管理员乙', permissions: ['rd-procurement:review'] }),
  ]);

  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((result) => result.status === 'rejected').length, 1);
  assert.match(String((settled.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason), /已被其他审核人处理/);
});

test('单个审核通知发送失败不会阻断其他研发管理员和超级管理员', async () => {
  const task = makeTask({ status: 'pending_rd_review' });
  const delivered: string[] = [];
  const prisma = {
    user: {
      findMany: async () => [
        { id: 'broken', name: '故障账号', role: { permissions: ['rd-procurement:review'] } },
        { id: 'rd-admin', name: '研发管理员', role: { permissions: ['rd-procurement:review'] } },
        { id: 'super-admin', name: '超级管理员', role: { permissions: ['*'] } },
      ],
    },
  };
  const rdService = {
    createMessage: async (message: Record<string, unknown>) => {
      if (message.recipient_id === 'broken') throw new Error('模拟投递失败');
      delivered.push(String(message.recipient_id));
    },
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, rdService as never);

  await (service as any).notifyRdAdminsOfTransferReview(task);

  assert.deepEqual(delivered.sort(), ['rd-admin', 'super-admin']);
});

test('研发前置审核通过和打回使用独立权限，超级管理员由通配权限兼容', () => {
  const approvePermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ProcurementController.prototype.approveRdTransfer,
  ) as string[];
  const rejectPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ProcurementController.prototype.rejectRdTransfer,
  ) as string[];
  assert.deepEqual(approvePermissions, ['rd-procurement:review']);
  assert.deepEqual(rejectPermissions, approvePermissions);
});
