import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

type Row = Record<string, any>;
const actor = { id: 'buyer-1', name: '采购甲', permissions: ['proc-task:delete', 'proc-task:confirm'] };
const oldLog = {
  id: 'log-original', kind: 'action', text: '采购已确认接收',
  actor: '原采购人', actorUserId: 'buyer-before', fromStatus: 'pending_confirm', toStatus: 'pending_inquiry',
  createdAt: new Date('2026-09-08T01:02:03.456Z'),
};

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value) as T;
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

/** 写入仅允许使用事务客户端，失败时恢复快照，以验证数据与日志的事务边界。 */
function fixture(overrides: Row = {}) {
  let state: { task: Row | null; logs: Row[]; audits: Row[]; attachments: Row[]; quotations: Row[] } = {
    task: {
      id: 'proc-1', code: 'PR-001', materialName: '压力传感器', spec: '0–100kPa', quantity: 10, unit: '个',
      source: 'self', status: 'inquiring', materialId: null, needSample: false,
      rdTaskId: null, buyer: '采购甲', buyerUserId: actor.id,
      metadata: { credential: 'must-not-be-archived' }, ...overrides,
    },
    logs: [clone(oldLog)], audits: [], attachments: [],
    quotations: [{ id: 'q1', taskId: 'proc-1', materialId: null, supplierName: '供应商甲',
      unitPrice: new Prisma.Decimal(12.5), quantity: new Prisma.Decimal(10), currency: 'CNY',
      quoteDate: new Date('2026-09-01'), isSelected: false }],
  };
  const hooks = { failLog: false, failAudit: false, failDelete: false, beforeTransaction: undefined as (() => void) | undefined };
  const calls: string[] = [];
  let inTransaction = false;
  const write = (name: string) => { assert.equal(inTransaction, true, `${name} 必须与对应日志处于事务内`); calls.push(name); };
  const appendLog = (data: Row) => {
    write('task-log');
    if (hooks.failLog) throw new Error('log failed');
    state.logs.push({ ...clone(data), id: 'new-log', createdAt: new Date() });
  };
  const view = () => state.task ? { ...clone(state.task), logs: clone(state.logs) } : null;
  const tx: any = {
    $queryRaw: async () => { assert.equal(inTransaction, true); calls.push('lock'); return []; },
    procTask: {
      findUnique: async (args: Row) => { if (args.include?.logs) calls.push('read-history'); return view(); },
      update: async ({ data }: Row) => {
        write('task-update');
        const { logs, ...fields } = data;
        Object.assign(state.task!, clone(fields));
        if (logs?.create) appendLog(logs.create);
        return view();
      },
      delete: async () => {
        write('task-delete');
        if (hooks.failDelete) throw new Error('delete failed');
        state.task = null;
        state.logs = [];
        return {};
      },
      deleteMany: async ({ where }: Row) => {
        if (!state.task || state.task.status !== where.status || state.task.source !== where.source) return { count: 0 };
        await tx.procTask.delete();
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: Row) => {
      write('audit');
      if (hooks.failAudit) throw new Error('audit failed');
      state.audits.push(clone(data));
      return data;
    } },
    procTaskLog: { create: async ({ data }: Row) => { appendLog(data); return data; } },
    procTaskAttachment: { createMany: async ({ data }: Row) => {
      write('attachments'); state.attachments.push(...clone(data)); return { count: data.length };
    } },
    procQuotation: {
      findUnique: async ({ where }: Row) => clone(state.quotations.find((row) => row.id === where.id)),
      findMany: async ({ where }: Row) => clone(state.quotations.filter((row) => !where.channel || row.channel === where.channel)),
      createMany: async ({ data }: Row) => { write('quote-create'); state.quotations.push(...clone(data)); return { count: data.length }; },
      updateMany: async ({ data }: Row) => { write('quote-update'); state.quotations.forEach((row) => Object.assign(row, clone(data))); },
      update: async ({ where, data }: Row) => { write('quote-update'); return Object.assign(state.quotations.find((row) => row.id === where.id)!, clone(data)); },
    },
    rdMessage: { updateMany: async () => ({ count: 0 }) },
  };
  const prisma = { ...tx, $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
    hooks.beforeTransaction?.();
    const before = clone(state);
    inTransaction = true;
    try { return await work(tx); }
    catch (error) { state = before; throw error; }
    finally { inTransaction = false; }
  } };
  const service = new ProcurementService(prisma as never, { isKeyUnderBusinessType: () => false } as never, {} as never, {} as never);
  service.getTask = async () => view() as never;
  service.listQuotations = async () => clone(state.quotations) as never;
  service.listTaskQuoteBookOptions = async () => ({ materialId: null, quantity: 10, scope: 'all', quotes: [{
    id: 'book-1', materialId: 'material-1', materialName: '压力传感器', supplierName: '供应商乙',
    matchedTier: { minQty: 1, unitPrice: 8 }, currency: 'CNY', leadTimeDays: 7,
    quoteDate: '2026-09-01', taxIncluded: true, belowMinOrder: false,
  }] }) as never;
  (service as any).notifyProcReviewResult = async () => { calls.push('notify'); };
  (service as any).applyTransition = async () => { throw new Error('later transition failed'); };
  return { service, hooks, calls, get state() { return state; } };
}

test('删除端点传入当前登录操作者', async () => {
  const calls: unknown[][] = [];
  const controller = Object.create(ProcurementController.prototype) as ProcurementController;
  Object.assign(controller, { service: { deleteTask: async (...args: unknown[]) => { calls.push(args); } }, actor: () => actor });
  await controller.remove('proc-1', {} as never);
  assert.deepEqual(calls, [['proc-1', actor]]);
});

for (const mode of ['delete', 'reject'] as const) {
  const execute = (h: ReturnType<typeof fixture>) => mode === 'delete'
    ? h.service.deleteTask('proc-1', actor)
    : h.service.rejectRdTask('proc-1', '  图纸缺少尺寸  ', actor);
  const overrides = mode === 'reject' ? { source: 'rd', status: 'pending_confirm', rdTaskId: 'RD-001' } : {};

  test(`${mode}：删除后独立审计保留真实任务、操作者、原因和原始时间线`, async () => {
    const h = fixture(overrides);
    await execute(h);
    assert.equal(h.state.task, null);
    assert.deepEqual(h.state.logs, []);
    assert.equal(h.state.audits.length, 1);
    const audit = h.state.audits[0];
    assert.deepEqual([audit.module, audit.resource, audit.resourceId, audit.userId, audit.actorName],
      ['procurement', 'proc-task', 'proc-1', actor.id, actor.name]);
    assert.match(audit.resourceName, /PR-001.*压力传感器/);
    assert.equal(audit.meta.metadata.task.id, 'proc-1');
    assert.equal(audit.meta.metadata.task.code, 'PR-001');
    assert.equal(audit.meta.metadata.reason, mode === 'reject' ? '图纸缺少尺寸' : '用户确认手动删除');
    assert.deepEqual(audit.meta.metadata.logs[0], { ...oldLog, createdAt: oldLog.createdAt.toISOString() });
    assert.doesNotMatch(JSON.stringify(audit), /must-not-be-archived|credential|fileUrl/);
    assert.ok(h.calls.indexOf('lock') < h.calls.indexOf('read-history'));
    assert.ok(h.calls.indexOf('read-history') < h.calls.indexOf('audit'));
    assert.ok(h.calls.indexOf('audit') < h.calls.indexOf('task-delete'));
  });

  for (const failure of ['failAudit', 'failDelete'] as const) {
    test(`${mode}：${failure} 时任务、原日志、独立审计一起回滚`, async () => {
      const h = fixture(overrides);
      h.hooks[failure] = true;
      await assert.rejects(execute(h), /failed/);
      assert.equal(h.state.task?.id, 'proc-1');
      assert.deepEqual(h.state.logs, [oldLog]);
      assert.deepEqual(h.state.audits, []);
      assert.ok(!h.calls.includes('notify'));
    });
  }

  test(`${mode}：事务前状态已变不删除、不写成功审计`, async () => {
    const h = fixture(overrides);
    h.hooks.beforeTransaction = () => { h.state.task!.status = 'priced'; };
    await assert.rejects(execute(h), /已被其他操作更新/);
    assert.equal(h.state.task?.status, 'priced');
    assert.equal(h.state.audits.length, 0);
  });
}

test('删除快照使用锁后新日志，非事务外旧任务记录', async () => {
  const h = fixture();
  h.hooks.beforeTransaction = () => { h.state.logs.push({ ...oldLog, id: 'last-operation', text: '删除前刚刚转派' }); };
  await h.service.deleteTask('proc-1', actor);
  assert.deepEqual(h.state.audits[0].meta.metadata.logs.map((row: Row) => row.id), ['log-original', 'last-operation']);
});

const attachments = [{ fileName: '图纸.png', fileUrl: 'https://example.test/image.png' }, { fileName: '说明.pdf', fileUrl: 'https://example.test/spec.pdf' }];

test('追加附件与一条包含附件名称的动作日志同时保存，空输入不产生虚假记录', async () => {
  const h = fixture();
  await h.service.addAttachments('proc-1', attachments, actor);
  assert.equal(h.state.attachments.length, 2);
  assert.equal(h.state.logs.length, 2);
  assert.match(h.state.logs[1].text, /追加 2 个附件：图纸.png、说明.pdf/);
  assert.equal(h.state.logs[1].actorUserId, actor.id);
  await h.service.addAttachments('proc-1', [], actor);
  assert.equal(h.state.logs.length, 2);
});

test('附件日志写入失败时追加附件也回滚', async () => {
  const h = fixture();
  h.hooks.failLog = true;
  await assert.rejects(h.service.addAttachments('proc-1', attachments, actor), /log failed/);
  assert.equal(h.state.attachments.length, 0);
  assert.deepEqual(h.state.logs, [oldLog]);
});

for (const mode of ['select', 'import'] as const) {
  const execute = (h: ReturnType<typeof fixture>) => mode === 'select'
    ? h.service.selectQuotation('proc-1', 'q1', actor)
    : h.service.addQuotationsFromQuoteBook('proc-1', { quoteIds: ['book-1'] }, actor);
  const overrides = { status: mode === 'select' ? 'inquiring' : 'pending_inquiry' };

  test(`${mode} 报价：实际写入成功后若阶段推进失败，保留准确动作日志`, async () => {
    const h = fixture(overrides);
    await assert.rejects(execute(h), /later transition failed/);
    assert.equal(h.state.logs.length, 2);
    const log = h.state.logs[1];
    assert.equal(log.actorUserId, actor.id);
    assert.equal(log.actor, actor.name);
    assert.match(log.text, mode === 'select' ? /选定报价：供应商甲/ : /带入 1 条报价：供应商乙/);
    assert.doesNotMatch(log.text, /进入询价中|状态更新|进入「/);
    assert.equal(log.toStatus, undefined);
    assert.equal(h.state.task?.status, overrides.status);
    if (mode === 'select') assert.equal(h.state.quotations[0].isSelected, true);
    else assert.equal(h.state.quotations.length, 2);
  });

  test(`${mode} 报价：日志失败时实际报价变更也回滚`, async () => {
    const h = fixture(overrides);
    h.hooks.failLog = true;
    await assert.rejects(execute(h), /log failed/);
    assert.deepEqual(h.state.logs, [oldLog]);
    assert.equal(h.state.quotations.length, 1);
    assert.equal(h.state.quotations[0].isSelected, false);
    assert.equal(h.state.task?.selectedQuotationId, undefined);
  });
}

test('询价中补充报价只增加实际写入记录，不额外推进阶段', async () => {
  const h = fixture();
  await h.service.addQuotationsFromQuoteBook('proc-1', { quoteIds: ['book-1'] }, actor);
  assert.equal(h.state.logs.length, 2);
  assert.equal(h.state.task?.status, 'inquiring');
});
