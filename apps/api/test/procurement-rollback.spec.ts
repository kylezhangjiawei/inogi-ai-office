import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { DEFAULT_PERMISSION_CATALOG } from '../src/modules/permission-catalog/permission-catalog.defaults';
import { RollbackProcTaskDto } from '../src/modules/procurement/dto/procurement.dto';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { rollbackCleanupFor, rollbackTargetsOf, type ProcStatus } from '../src/modules/procurement/procurement.types';

type Json = Record<string, any>;
const actor = { id: 'u1', name: '采购员', permissions: ['proc-task:rollback'] };
const rollback = { status: 'pending_inquiry', from_status: 'partial_arrival', reason: '  供应商报错价，整单重做  ' };

function makeService(task: Json = { id: 'p1', status: 'partial_arrival', method: 'inquiry' }, claimCount = 1) {
  const calls: Json[] = [];
  let taskRow = { ...task };
  const refs = [
    { id: 'ordinary', metadata: {} }, { id: 'false', metadata: { freeSample: false } },
    { id: 'sample', metadata: { freeSample: true } }, { id: 'json-null', metadata: null },
    { id: 'string', metadata: { freeSample: 'true' } }, { id: 'missing', metadata: { source: 'T+' } },
  ];
  const service = Object.create(ProcurementService.prototype) as ProcurementService;
  const tx = {
    procTask: {
      updateMany: async (args: Json) => {
        calls.push({ op: 'update', ...args });
        if (claimCount === 1) taskRow = { ...taskRow, ...args.data };
        return { count: claimCount };
      },
      findUniqueOrThrow: async () => ({ ...taskRow }),
    },
    procQuotation: { deleteMany: async (args: Json) => { calls.push({ op: 'deleteQuotes', ...args }); return { count: 2 }; } },
    procPurchaseOrderRef: {
      findMany: async (args: Json) => { calls.push({ op: 'readPos', ...args }); return refs; },
      deleteMany: async (args: Json) => { calls.push({ op: 'deletePos', ...args }); return { count: 5 }; },
    },
    procTaskLog: { create: async (args: Json) => { calls.push({ op: 'log', ...args }); } },
    rdMessage: { updateMany: async (args: Json) => { calls.push({ op: 'retireReview', ...args }); return { count: 1 }; } },
  };
  Object.assign(service, {
    prisma: {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      user: { findMany: async () => [
        { id: 'reviewer', name: '研发审核人', role: { permissions: ['rd-procurement:review'] } },
        { id: 'buyer', name: '采购员', role: { permissions: ['proc-task:rollback'] } },
      ] },
    },
    rdService: { createMessage: async (message: Json) => { calls.push({ op: 'notify', ...message }); } },
    requireTask: async () => taskRow,
    serializeTask: (row: Json) => row,
  });
  return { service, calls };
}

test('部分到货任务可退回待询价，并留下清理与原因记录', async () => {
  const { service, calls } = makeService();
  await service.rollbackTask('p1', rollback, actor);
  const update = calls.find((call) => call.op === 'update')!;
  assert.deepEqual(update.where, { id: 'p1', status: 'partial_arrival' });
  assert.equal(update.data.status, 'pending_inquiry');
  assert.equal(update.data.businessDone, false);
  assert.equal(Number(update.data.arrivedQty), 0);
  for (const key of ['selectedQuotationId', 'quotationSubtotal', 'quotationDiscount', 'quotationTotal']) {
    assert.equal(update.data[key], null);
  }
  assert.deepEqual(calls.find((call) => call.op === 'deleteQuotes')!.where, { taskId: 'p1' });
  const removed = calls.find((call) => call.op === 'deletePos')!.where;
  assert.equal(removed.taskId, 'p1');
  assert.deepEqual(removed.id.in, ['ordinary', 'false', 'json-null', 'string', 'missing']);
  const log = calls.find((call) => call.op === 'log')!.data;
  assert.equal(log.fromStatus, 'partial_arrival');
  assert.equal(log.toStatus, 'pending_inquiry');
  assert.equal(log.actorUserId, actor.id);
  assert.match(log.text, /已清理 2 条报价、5 条采购单关联/);
  assert.match(log.text, /原因：供应商报错价，整单重做$/);
});

test('所有进行中的询价与直购节点均可退回同一流程的任意更早节点，研发流转包含待研发审核', () => {
  const inquiry: ProcStatus[] = ['pending_confirm', 'pending_inquiry', 'inquiring', 'pending_sample', 'testing', 'priced', 'in_transit', 'partial_arrival'];
  const direct: ProcStatus[] = ['pending_confirm', 'pending_purchase', 'in_transit', 'partial_arrival'];
  for (const [method, flow] of [['inquiry', inquiry], ['direct', direct]] as const) {
    for (const context of [undefined, { source: 'self', rdTaskId: 'RD-001' }, { source: 'rd', rdTaskId: 'RD-001' }, { source: 'rd', rdTaskId: '' }]) {
      const prefix = context?.source === 'rd' && context.rdTaskId ? ['pending_rd_review'] : [];
      flow.forEach((status, index) => assert.deepEqual(rollbackTargetsOf(status, method, context), [...prefix, ...flow.slice(0, index)]));
      for (const blocked of ['pending_rd_review', 'completed', 'cancelled'] as ProcStatus[]) {
        assert.deepEqual(rollbackTargetsOf(blocked, method, context), []);
      }
    }
  }
  assert.deepEqual(rollbackTargetsOf('pending_purchase', 'inquiry'), []);
});

test('清理范围按回退目标决定：报价在询价前清理，采购单和到货量在下单前清理', () => {
  for (const status of ['pending_confirm', 'pending_inquiry'] as ProcStatus[]) {
    assert.deepEqual(rollbackCleanupFor(status), { quotations: true, purchaseOrders: true, arrivals: true });
  }
  for (const status of ['inquiring', 'pending_sample', 'testing', 'priced', 'pending_purchase'] as ProcStatus[]) {
    assert.deepEqual(rollbackCleanupFor(status), { quotations: false, purchaseOrders: true, arrivals: true });
  }
  for (const status of ['in_transit', 'partial_arrival'] as ProcStatus[]) {
    assert.deepEqual(rollbackCleanupFor(status), { quotations: false, purchaseOrders: false, arrivals: false });
  }
});

test('退回已下单保留报价、采购单与到货数据', async () => {
  const { service, calls } = makeService();
  await service.rollbackTask('p1', { ...rollback, status: 'in_transit' }, actor);
  assert.deepEqual(calls.map((call) => call.op), ['update', 'log']);
  assert.deepEqual(calls[0].data, { status: 'in_transit', businessDone: false });
});

test('前进、原地回退、跨流程、待研发审核和已取消任务均拒绝且不写数据', async () => {
  for (const [current, target, method] of [
    ['inquiring', 'priced', 'inquiry'], ['inquiring', 'inquiring', 'inquiry'],
    ['in_transit', 'pending_inquiry', 'direct'], ['pending_rd_review', 'pending_confirm', 'inquiry'],
    ['cancelled', 'pending_inquiry', 'inquiry'],
  ]) {
    const { service, calls } = makeService({ id: 'p1', status: current, method });
    await assert.rejects(service.rollbackTask('p1', { ...rollback, status: target, from_status: current }, actor),
      (error: any) => error.getStatus() === 400);
    assert.equal(calls.length, 0);
  }
});

test('已完成任务即使管理员直接调用也不能回退，不写数据、日志或通知', async () => {
  for (const method of ['inquiry', 'direct']) {
    for (const source of ['self', 'rd']) {
      for (const permissions of [['proc-task:rollback'], ['*']]) {
        const { service, calls } = makeService({ id: 'p1', status: 'completed', method, source, rdTaskId: 'RD-001' });
        await assert.rejects(service.rollbackTask('p1', { ...rollback, from_status: 'completed', status: 'pending_confirm' }, { ...actor, permissions }),
          (error: any) => error.getStatus() === 400 && /已完成的任务不能回退/.test(error.message));
        assert.equal(calls.length, 0);
      }
    }
  }
});

test('页面过期和并发状态变化返回冲突，清理不能先于状态条件更新', async () => {
  const stale = makeService();
  await assert.rejects(stale.service.rollbackTask('p1', { ...rollback, from_status: 'in_transit' }, actor),
    (error: any) => error.getStatus() === 409);
  assert.equal(stale.calls.length, 0);
  const raced = makeService(undefined, 0);
  await assert.rejects(raced.service.rollbackTask('p1', rollback, actor), (error: any) => error.getStatus() === 409);
  assert.deepEqual(raced.calls.map((call) => call.op), ['update']);
});

test('回退原因在 DTO 和服务端都按 trim 后 2–200 字符验证，来源状态必填', async () => {
  for (const reason of [undefined, null, 12, '', '   ', ' 一 ', '字'.repeat(201)]) {
    assert.ok(validateSync(plainToInstance(RollbackProcTaskDto, { ...rollback, reason })).length > 0);
    const { service, calls } = makeService();
    await assert.rejects(service.rollbackTask('p1', { ...rollback, reason } as any, actor),
      (error: any) => error.getStatus() === 400);
    assert.equal(calls.length, 0);
  }
  for (const reason of ['  重做  ', `  ${'字'.repeat(200)}  `]) {
    const dto = plainToInstance(RollbackProcTaskDto, { ...rollback, reason });
    assert.deepEqual(validateSync(dto), []);
    assert.equal(dto.reason, reason.trim());
  }
  const { from_status, ...missingSource } = rollback;
  assert.ok(validateSync(plainToInstance(RollbackProcTaskDto, missingSource)).length > 0);
});

test('回退权限已登记并由独立权限保护，普通推进权限不能调用', () => {
  const permission = DEFAULT_PERMISSION_CATALOG.find((item) => item.code === 'proc-task:rollback');
  assert.equal(permission?.type, 'action');
  assert.equal(permission?.groupLabel, '操作权限 · 供应链管理');
  assert.equal(DEFAULT_PERMISSION_CATALOG.filter((item) => item.code === 'proc-task:rollback').length, 1);
  const guard = new RolesGuard(new Reflector());
  const allowed = (permissions: string[]) => guard.canActivate({
    getHandler: () => ProcurementController.prototype.rollback,
    getClass: () => ProcurementController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as any);
  assert.equal(allowed(['proc-task:rollback']), true);
  assert.equal(allowed(['*']), true);
  assert.equal(allowed(['proc-task:inquiry', 'proc-task:select-quote']), false);
  assert.equal(allowed([]), false);
});

test('截图中的研发流转待处理任务可退回待研发审核，清采购负责人并发出带原因的新待审通知', async () => {
  const { service, calls } = makeService({ id: 'p1', status: 'pending_confirm', method: 'inquiry', source: 'rd', rdTaskId: 'RD-001',
    materialName: '示例物料', rdTaskTitle: '示例研发任务', buyer: '旧采购员', buyerUserId: 'old-buyer' });
  const result = await service.rollbackTask('p1', { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor);
  assert.equal(result.status, 'pending_rd_review');
  const update = calls.find((call) => call.op === 'update')!;
  assert.deepEqual(update.where, { id: 'p1', status: 'pending_confirm', source: 'rd', rdTaskId: 'RD-001' });
  assert.equal(update.data.buyer, '');
  assert.equal(update.data.buyerUserId, null);
  assert.equal(Number(update.data.arrivedQty), 0);
  assert.equal(update.data.selectedQuotationId, null);
  assert.ok(calls.some((call) => call.op === 'deleteQuotes'));
  assert.ok(calls.some((call) => call.op === 'deletePos'));
  const retired = calls.find((call) => call.op === 'retireReview')!;
  assert.deepEqual(retired.where, { type: 'review_request', taskId: 'p1', handled: false });
  assert.deepEqual(retired.data, { handled: true, read: true });
  const messages = calls.filter((call) => call.op === 'notify');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].recipient_id, 'reviewer');
  const body = JSON.parse(messages[0].body);
  assert.equal(body.review_type, 'procurement_transfer');
  assert.equal(body.task_id, 'p1');
  assert.equal(body.rd_task_id, 'RD-001');
  assert.match(body.note, /回退原因：供应商报错价，整单重做/);
  assert.ok(calls.findIndex((call) => call.op === 'notify') > calls.findIndex((call) => call.op === 'log'));
  await assert.rejects(service.rollbackTask('p1', { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor));
  assert.equal(calls.filter((call) => call.op === 'notify').length, 1, '重复回退不得重复发送待审通知');
});

test('只有具有研发关联的流转任务增加待研发审核回退目标，自建与缺失关联不可退入该节点', async () => {
  for (const method of ['inquiry', 'direct']) {
    assert.deepEqual(rollbackTargetsOf('pending_confirm', method, { source: 'rd', rdTaskId: 'RD-001' }), ['pending_rd_review']);
    assert.deepEqual(rollbackTargetsOf('pending_confirm', method), []);
    assert.deepEqual(rollbackTargetsOf('pending_rd_review', method, { source: 'rd', rdTaskId: 'RD-001' }), []);
  }
  assert.deepEqual(rollbackCleanupFor('pending_rd_review'), { quotations: true, purchaseOrders: true, arrivals: true });
  for (const context of [{ source: 'self', rdTaskId: 'RD-001' }, { source: 'rd' }, { source: 'rd', rdTaskId: '  ' }]) {
    assert.equal(rollbackTargetsOf('partial_arrival', 'inquiry', context).includes('pending_rd_review'), false);
    const { service, calls } = makeService({ id: 'p1', status: 'pending_confirm', method: 'inquiry', ...context });
    await assert.rejects(service.rollbackTask('p1', { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor),
      (error: any) => error.getStatus() === 400);
    assert.equal(calls.length, 0);
  }
});

/** The optional integration tests only accept our disposable socket database, never DATABASE_URL. */
const databaseUrl = process.env.PROC_ROLLBACK_TEST_DATABASE_URL;
test('隔离 PostgreSQL：回退清理、免费样品保留、事务原子性与并发冲突', { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const parsed = new URL(databaseUrl!);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.pathname, '/procurement_test');
  assert.equal(parsed.password, '');
  assert.match(parsed.searchParams.get('host') ?? '', /^\/private\/tmp\/procurement-rollback-db-[A-Za-z0-9]+$/);
  const schema = `rollback_test_${randomBytes(8).toString('hex')}`;
  parsed.searchParams.set('schema', schema);
  const first = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  const second = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  const directory = await mkdtemp('/private/tmp/procurement-rollback-schema-');
  try {
    // Keep the current Prisma model definitions used by rollback and its serialized response.
    const current = await readFile(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const keep = new Set(['ProcTask', 'ProcQuotation', 'ProcPurchaseOrderRef', 'ProcTaskLog', 'ProcTaskAttachment', 'ProcTaskCriticalMaterial', 'RdMessage']);
    const modelNames = new Set([...current.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]));
    const models = [...current.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)]
      .filter((match) => keep.has(match[1]))
      .map((match) => match[0].split('\n').filter((line) => {
        const fieldType = line.trim().split(/\s+/)[1]?.replace(/[?\[\]]/g, '');
        return !fieldType || !modelNames.has(fieldType) || keep.has(fieldType);
      }).join('\n'));
    assert.equal(models.length, keep.size);
    const schemaPath = join(directory, 'schema.prisma');
    await writeFile(schemaPath, `datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n${models.join('\n')}`);
    const { stdout } = await promisify(execFile)(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'],
      { env: { ...process.env, DATABASE_URL: parsed.toString() }, maxBuffer: 1024 * 1024 });
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const statement of stdout.replace(/^\s*--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) {
      await first.$executeRawUnsafe(statement);
    }
    const service = (client: PrismaClient) => new ProcurementService(client as never, {} as never, {} as never, {} as never);
    const seed = async () => {
      const task = await first.procTask.create({ data: { code: randomBytes(8).toString('hex'), materialName: '隔离测试物料', status: 'partial_arrival', businessDone: true,
        arrivedQty: 10, quotationSubtotal: 120, quotationDiscount: 20, quotationTotal: 100 } });
      const quote = await first.procQuotation.create({ data: { taskId: task.id, materialName: task.materialName, supplierName: '测试供应商', unitPrice: 10, quoteDate: new Date(), isSelected: true } });
      await first.procTask.update({ where: { id: task.id }, data: { selectedQuotationId: quote.id } });
      await first.procPurchaseOrderRef.createMany({ data: [
        { tpOrderNo: 'ordinary', metadata: {} }, { tpOrderNo: 'false', metadata: { freeSample: false } },
        { tpOrderNo: 'sample', metadata: { freeSample: true } }, { tpOrderNo: 'json-null', metadata: Prisma.JsonNull },
        { tpOrderNo: 'string', metadata: { freeSample: 'true' } }, { tpOrderNo: 'missing', metadata: { source: 'T+' } },
      ].map((row) => ({ ...row, taskId: task.id, receivedQty: 2, orderedQty: 2 })) });
      return task;
    };

    await t.test('已完成任务管理员直接回退被拒绝，状态、报价、采购单、日志和审核通知全部保持原样', async () => {
      const task = await seed();
      await first.procTask.update({ where: { id: task.id }, data: { status: 'completed', source: 'rd', rdTaskId: `RD-${task.id}` } });
      const messageId = `completed-review-${task.id}`;
      await first.rdMessage.create({ data: { id: messageId, body: '{}', type: 'review_request', taskId: task.id, source: 'procurement' } });
      const readState = () => second.procTask.findUniqueOrThrow({ where: { id: task.id }, include: { quotations: true, purchaseOrderRefs: true, logs: true } });
      const before = await readState();
      const messagesBefore = await second.rdMessage.findMany({ where: { taskId: task.id } });
      const instance = service(first);
      Object.assign(instance, { notifyRdAdminsOfTransferReview: async () => assert.fail('已完成任务不得创建新待审通知') });
      for (const target of ['pending_inquiry', 'pending_rd_review']) {
        await assert.rejects(instance.rollbackTask(task.id, { ...rollback, from_status: 'completed', status: target }, { ...actor, permissions: ['*'] }),
          (error: any) => error.getStatus() === 400 && /已完成的任务不能回退/.test(error.message));
      }
      assert.deepEqual(await readState(), before);
      assert.deepEqual(await second.rdMessage.findMany({ where: { taskId: task.id } }), messagesBefore);
    });

    await t.test('普通采购单即使 metadata 缺键或为 JSON null 也清理，仅免费样品保留', async () => {
      const task = await seed();
      const oldSelection = await first.procPurchaseOrderRef.findMany({
        where: { taskId: task.id, NOT: { metadata: { path: ['freeSample'], equals: true } } },
        select: { tpOrderNo: true },
      });
      assert.equal(oldSelection.some((row) => row.tpOrderNo === 'ordinary'), false,
        '真实 PostgreSQL 复现：旧 NOT JSON path 条件漏掉普通空 metadata 记录');
      const result = await service(first).rollbackTask(task.id, rollback, actor);
      assert.equal(result.status, 'pending_inquiry');
      assert.equal(result.businessDone, false);
      assert.equal(result.arrivedQty, 0);
      assert.deepEqual(result.purchaseOrders.map((row) => row.tpOrderNo), ['sample']);
      const persisted = await second.procTask.findUniqueOrThrow({ where: { id: task.id } });
      for (const key of ['selectedQuotationId', 'quotationSubtotal', 'quotationDiscount', 'quotationTotal'] as const) assert.equal(persisted[key], null);
      assert.equal(await second.procQuotation.count({ where: { taskId: task.id } }), 0);
      const logs = await second.procTaskLog.findMany({ where: { taskId: task.id } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].fromStatus, 'partial_arrival');
      assert.equal(logs[0].toStatus, 'pending_inquiry');
      assert.match(logs[0].text, /已清理 1 条报价、5 条采购单关联/);
      assert.match(logs[0].text, /原因：供应商报错价，整单重做$/);
    });

    await t.test('退回已下单保留报价与全部采购单、到货量；旧状态请求不能再执行', async () => {
      const task = await seed();
      const result = await service(first).rollbackTask(task.id, { ...rollback, status: 'in_transit' }, actor);
      assert.equal(result.status, 'in_transit');
      assert.equal(result.arrivedQty, 10);
      assert.equal(result.purchaseOrders.length, 6);
      assert.equal(result.quotationTotal, 100);
      assert.equal(await first.procQuotation.count({ where: { taskId: task.id } }), 1);
      await assert.rejects(service(second).rollbackTask(task.id, rollback, actor), (error: any) => error.getStatus() === 409);
      assert.equal(await second.procTaskLog.count({ where: { taskId: task.id } }), 1);
    });

    await t.test('日志写入失败时，状态、报价与采购单删除全部回滚', async () => {
      const task = await seed();
      await first.$executeRawUnsafe('ALTER TABLE "ProcTaskLog" ADD CONSTRAINT "test_reject_log" CHECK ("text" NOT LIKE \'%force-log-failure%\')');
      try {
        await assert.rejects(service(first).rollbackTask(task.id, { ...rollback, reason: 'force-log-failure' }, actor));
        const persisted = await second.procTask.findUniqueOrThrow({ where: { id: task.id } });
        assert.equal(persisted.status, 'partial_arrival');
        assert.equal(persisted.businessDone, true);
        assert.equal(Number(persisted.arrivedQty), 10);
        assert.equal(Number(persisted.quotationTotal), 100);
        assert.equal(await second.procQuotation.count({ where: { taskId: task.id } }), 1);
        assert.equal(await second.procPurchaseOrderRef.count({ where: { taskId: task.id } }), 6);
        assert.equal(await second.procTaskLog.count({ where: { taskId: task.id } }), 0);
      } finally {
        await first.$executeRawUnsafe('ALTER TABLE "ProcTaskLog" DROP CONSTRAINT "test_reject_log"');
      }
    });

    await t.test('研发流转待处理退回审核，旧通知结束、新通知带原因；重新审核后恢复待处理且只分配一次', async () => {
      const task = await seed();
      const rdTaskId = `RD-${task.id}`;
      await first.procTask.update({ where: { id: task.id }, data: {
        status: 'pending_confirm', source: 'rd', rdTaskId, buyer: '旧采购员', buyerUserId: 'old-buyer',
      } });
      const oldMessageId = `old-${task.id}`;
      const newMessageId = `new-${task.id}`;
      await first.rdMessage.create({ data: { id: oldMessageId, body: '{}', type: 'review_request', taskId: task.id, source: 'procurement' } });
      const instance = service(first);
      const sent: string[] = [];
      Object.assign(instance, {
        notifyRdAdminsOfTransferReview: async (snapshot: Json, reason: string) => {
          const persisted = await second.procTask.findUniqueOrThrow({ where: { id: task.id } });
          assert.equal(persisted.status, 'pending_rd_review', '新通知只能在事务提交后发送');
          assert.equal((await second.rdMessage.findUniqueOrThrow({ where: { id: oldMessageId } })).handled, true);
          sent.push(reason);
          await second.rdMessage.create({ data: { id: newMessageId, body: JSON.stringify({ reason }), type: 'review_request', taskId: snapshot.id, source: 'procurement' } });
        },
        pickAutomaticBuyer: async () => ({ id: 'new-buyer', name: '新采购员' }),
        notifyRdTransferReviewResult: async () => { sent.push('review-result'); },
        notifyBuyerOfRdTransferAssignment: async () => { sent.push('assignment'); },
      });
      const result = await instance.rollbackTask(task.id, { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor);
      assert.equal(result.status, 'pending_rd_review');
      assert.equal(result.buyer, '');
      assert.equal(result.buyerUserId, undefined);
      assert.equal(result.arrivedQty, 0);
      assert.equal(result.businessDone, false);
      assert.equal(result.rdTaskId, rdTaskId);
      assert.deepEqual(result.purchaseOrders.map((row) => row.tpOrderNo), ['sample']);
      assert.equal(await first.procQuotation.count({ where: { taskId: task.id } }), 0);
      assert.deepEqual(sent, [rollback.reason.trim()]);
      const newNotice = await second.rdMessage.findUniqueOrThrow({ where: { id: newMessageId } });
      assert.equal(newNotice.handled, false);
      assert.equal(JSON.parse(newNotice.body).reason, rollback.reason.trim());
      // Retried/stale rollback cannot retire the current review or create another notice.
      await assert.rejects(instance.rollbackTask(task.id, { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor));
      assert.equal((await second.rdMessage.findUniqueOrThrow({ where: { id: newMessageId } })).handled, false);
      const reviewer = { id: 'reviewer', name: '研发审核人', permissions: ['rd-procurement:review'] };
      const approved = await instance.approveRdTransfer(task.id, reviewer);
      assert.equal(approved.status, 'pending_confirm');
      assert.equal(approved.buyerUserId, 'new-buyer');
      assert.equal(approved.buyer, '新采购员');
      assert.equal((await second.rdMessage.findUniqueOrThrow({ where: { id: newMessageId } })).handled, true);
      await assert.rejects(instance.approveRdTransfer(task.id, reviewer), (error: any) => error.getStatus() === 400);
      assert.deepEqual(sent, [rollback.reason.trim(), 'review-result', 'assignment']);
      assert.equal(await second.procTaskLog.count({ where: { taskId: task.id } }), 2, '一条回退日志和一条重新审核通过日志');
    });

    await t.test('确认请求的旧快照不能越过另一连接已经提交的研发回退', async () => {
      const task = await seed();
      await first.procTask.update({ where: { id: task.id }, data: {
        status: 'pending_confirm', source: 'rd', rdTaskId: `RD-${task.id}`, buyer: '采购员', buyerUserId: 'buyer',
      } });
      let read!: () => void;
      let resume!: () => void;
      const snapshotRead = new Promise<void>((resolve) => { read = resolve; });
      const continueConfirm = new Promise<void>((resolve) => { resume = resolve; });
      const confirming = service(first);
      Object.assign(confirming, { requireTask: async (id: string) => {
        const snapshot = await first.procTask.findUniqueOrThrow({ where: { id } });
        read();
        await continueConfirm;
        return snapshot;
      }, notifyProcReviewResult: async () => assert.fail('过期确认不能发送确认结果通知') });
      const request = confirming.confirmTask(task.id, actor);
      const rejected = assert.rejects(request, (error: any) => error.getStatus() === 409);
      try {
        await snapshotRead;
        const rollingBack = service(second);
        Object.assign(rollingBack, { notifyRdAdminsOfTransferReview: async () => undefined });
        await rollingBack.rollbackTask(task.id, { ...rollback, from_status: 'pending_confirm', status: 'pending_rd_review' }, actor);
      } finally { resume(); }
      await rejected;
      const persisted = await second.procTask.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(persisted.status, 'pending_rd_review');
      assert.equal(persisted.buyerUserId, null);
      assert.equal(await second.procTaskLog.count({ where: { taskId: task.id } }), 1);
    });

    // Instrument transaction boundaries only; all locks and data operations below are real PostgreSQL.
    const deferred = <T = void>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((ready) => { resolve = ready; });
      return { promise, resolve };
    };
    const withTransactionHook = (client: PrismaClient, hook: (tx: Prisma.TransactionClient) => Promise<Prisma.TransactionClient>) =>
      new Proxy(client, { get(target, property, receiver) {
        if (property === '$transaction') return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => fn(await hook(tx)), { timeout: 10000 });
        return Reflect.get(target, property, receiver);
      } });
    const waitUntilBlocked = async (pid: number) => {
      const deadline = Date.now() + 3000;
      do {
        const rows = await first.$queryRaw<Array<{ count: number }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) AS count`;
        if (rows[0]?.count > 0) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      } while (Date.now() < deadline);
      assert.fail('第二个事务应在任务行锁处等待，不能提前读取或写入');
    };

    for (const firstOperation of ['rollback', 'arrival'] as const) {
      await t.test(`${firstOperation === 'rollback' ? '回退先拿锁' : '到货同步先拿锁'}：另一操作真实等待同一任务锁且不会死锁或覆盖新状态`, async () => {
        const task = await seed();
        await first.procTask.update({ where: { id: task.id }, data: { quantity: 12, businessDone: false } });
        const locked = deferred();
        const release = deferred();
        const waiterPid = deferred<number>();
        const holder = service(withTransactionHook(first, async (tx) => new Proxy(tx, { get(target, property, receiver) {
          if (firstOperation === 'rollback' && property === 'procTask') {
            return new Proxy(target.procTask, { get(delegate, method, delegateReceiver) {
              if (method === 'updateMany') return async (args: Prisma.ProcTaskUpdateManyArgs) => {
                const result = await delegate.updateMany(args);
                locked.resolve();
                await release.promise;
                return result;
              };
              return Reflect.get(delegate, method, delegateReceiver);
            } });
          }
          if (firstOperation === 'arrival' && property === '$queryRaw') return async (...args: any[]) => {
            const result = await (target.$queryRaw as any)(...args);
            locked.resolve();
            await release.promise;
            return result;
          };
          return Reflect.get(target, property, receiver);
        } })));
        const waiter = service(withTransactionHook(second, async (tx) => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          waiterPid.resolve(rows[0].pid);
          return tx;
        }));
        const holding = firstOperation === 'rollback'
          ? holder.rollbackTask(task.id, rollback, actor)
          : holder.recomputeArrival(task.id);
        const holderResult = holding.then((value) => ({ value }), (error) => ({ error }));
        let waitingResult: Promise<{ value?: unknown; error?: any }> | undefined;
        try {
          await locked.promise;
          const waiting = firstOperation === 'rollback'
            ? waiter.recomputeArrival(task.id)
            : waiter.rollbackTask(task.id, rollback, actor);
          waitingResult = waiting.then((value) => ({ value }), (error) => ({ error }));
          await waitUntilBlocked(await waiterPid.promise);
        } finally { release.resolve(); }
        const held = await holderResult;
        if ('error' in held) throw held.error;
        const waited = await waitingResult!;
        const persisted = await first.procTask.findUniqueOrThrow({ where: { id: task.id }, include: { purchaseOrderRefs: true } });
        if (firstOperation === 'rollback') {
          if (waited.error) throw waited.error;
          assert.equal(persisted.status, 'pending_inquiry');
          assert.equal(Number(persisted.arrivedQty), 0);
          assert.equal(persisted.businessDone, false);
          assert.deepEqual(persisted.purchaseOrderRefs.map((row) => row.tpOrderNo), ['sample']);
        } else {
          assert.equal(waited.error?.getStatus(), 409, '同步已经完成任务，等待中的旧回退必须拒绝');
          assert.equal(persisted.status, 'completed');
          assert.equal(Number(persisted.arrivedQty), 12);
          assert.equal(persisted.businessDone, true);
          assert.equal(persisted.purchaseOrderRefs.length, 6);
        }
      });
    }

    await t.test('两条独立连接同时回退，只有一个提交且另一方收到 409', async () => {
      const task = await seed();
      let entered = 0;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => { release = resolve; });
      const makeConcurrent = (client: PrismaClient) => {
        const instance = service(client);
        Object.assign(instance, { requireTask: async (id: string) => {
          const snapshot = await client.procTask.findUniqueOrThrow({ where: { id } });
          if (++entered === 2) release();
          await ready;
          return snapshot;
        } });
        return instance;
      };
      const targets = ['pending_inquiry', 'priced'];
      const results = await Promise.allSettled([
        makeConcurrent(first).rollbackTask(task.id, { ...rollback, status: targets[0] }, actor),
        makeConcurrent(second).rollbackTask(task.id, { ...rollback, status: targets[1] }, actor),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.getStatus(), 409);
      const winner = results.findIndex((result) => result.status === 'fulfilled');
      const persisted = await first.procTask.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(persisted.status, targets[winner]);
      assert.equal(await first.procTaskLog.count({ where: { taskId: task.id } }), 1);
      assert.equal(await first.procQuotation.count({ where: { taskId: task.id } }), winner === 0 ? 0 : 1);
      assert.equal(await first.procPurchaseOrderRef.count({ where: { taskId: task.id } }), 1);
    });
  } finally {
    await second.$disconnect();
    await first.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await first.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
