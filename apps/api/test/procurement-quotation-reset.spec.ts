import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

type Json = Record<string, unknown>;

/**
 * 「重新维护报价」的边界。
 *
 * 报价确认后此前没有任何撤销入口，维护错了只能作废整条任务重建。补上入口的同时必须钉住两条线：
 * 已下单之后不许改（单价已随采购单出去，改这里会与 T+ 对不上），没有报价时给出说得通的提示。
 */
function makeService(task: Json, quotationCount: number) {
  const calls: Json[] = [];
  const service = Object.create(ProcurementService.prototype) as any;
  const tx = {
    procTask: {
      updateMany: async (args: Json) => { calls.push({ op: 'updateMany', ...args }); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ ...task, status: 'pending_inquiry', quotations: [] }),
    },
    procQuotation: { deleteMany: async (args: Json) => { calls.push({ op: 'deleteQuotes', ...args }); return { count: quotationCount }; } },
    procTaskLog: { create: async (args: Json) => { calls.push({ op: 'log', ...args }); } },
  };
  service.prisma = {
    procQuotation: { count: async () => quotationCount },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  service.requireTask = async () => task;
  service.serializeTask = (row: Json) => row;
  return { service: service as ProcurementService, calls };
}

const actor = { id: 'u1', name: '采购员', permissions: ['proc-task:select-quote'] };

test('已定价可以重新维护：清空报价并退回待询价', async () => {
  const { service, calls } = makeService({ id: 'p1', status: 'priced' }, 2);
  const result = (await service.resetTaskQuotations('p1', '单价录错', actor)) as Json;

  assert.equal(result.status, 'pending_inquiry');
  const update = calls.find((c) => c.op === 'updateMany') as Json;
  // 条件更新带上原状态：并发下别人刚把任务推到在途时不能再清
  assert.deepEqual(update.where, { id: 'p1', status: 'priced' });
  assert.deepEqual(update.data, {
    status: 'pending_inquiry',
    selectedQuotationId: null,
    quotationSubtotal: null,
    quotationDiscount: null,
    quotationTotal: null,
  });
  assert.ok(calls.some((c) => c.op === 'deleteQuotes'));

  const log = calls.find((c) => c.op === 'log') as { data: { text: string } };
  assert.match(log.data.text, /单价录错/);
  // 参考价不回滚这件事必须写进留痕，否则有人会以为物料主数据也退回去了
  assert.match(log.data.text, /最新参考价不回滚/);
});

test('询价中 / 待到样 / 测试中 同样允许重维护', async () => {
  for (const status of ['inquiring', 'pending_sample', 'testing']) {
    const { service } = makeService({ id: 'p1', status }, 1);
    const result = (await service.resetTaskQuotations('p1', undefined, actor)) as Json;
    assert.equal(result.status, 'pending_inquiry', `${status} 应允许重维护`);
  }
});

test('已下单及之后禁止重维护', async () => {
  for (const status of ['in_transit', 'partial_arrival', 'completed']) {
    const { service } = makeService({ id: 'p1', status }, 1);
    await assert.rejects(
      service.resetTaskQuotations('p1', undefined, actor),
      /不能重新维护报价/,
      `${status} 应被拒绝`,
    );
  }
});

test('没有报价时报「无需重新维护」，而不是答非所问地让人去撤采购单', async () => {
  const { service } = makeService({ id: 'p1', status: 'pending_inquiry' }, 0);
  await assert.rejects(service.resetTaskQuotations('p1', undefined, actor), /还没有已确认的报价/);
});

test('并发下状态已被别人改动时拒绝，不会误清报价', async () => {
  const { service } = makeService({ id: 'p1', status: 'priced' }, 1);
  (service as any).prisma.$transaction = async (fn: (t: unknown) => Promise<unknown>) =>
    fn({
      procTask: { updateMany: async () => ({ count: 0 }) },
      procQuotation: { deleteMany: async () => { throw new Error('不该走到删除'); } },
      procTaskLog: { create: async () => undefined },
    });
  await assert.rejects(service.resetTaskQuotations('p1', undefined, actor), /请刷新后重试/);
});
