import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import type { ProcTaskListQuery } from '../src/modules/procurement/procurement.types';

const actor = { id: 'rd-owner', name: '研发负责人', permissions: ['page:rd-my-workspace'] };

function fixture(taskCount = 3) {
  const checked: string[] = [];
  const queries: Record<string, any>[] = [];
  const rdTasks = Array.from({ length: taskCount }, (_, index) => ({
    task_id: `rd-${index + 1}`,
    primary_owner_user_id: index === 1 ? 'another-owner' : actor.id,
    collaborators: index === 1 ? [{ user_id: actor.id }] : [],
  }));
  const rows = rdTasks.map((task, index) => ({
    id: `proc-${index + 1}`, code: `PR-${index + 1}`, rdTaskId: task.task_id,
    status: 'in_transit', quantity: 10, arrivedQty: index, expectedArrivalDate: '2026-09-22',
    paymentDate: '2026-09-21', paymentStatus: 'paid', paymentNote: '保密付款信息',
    selectedQuotationId: 'quote-1', quotationSubtotal: 900, quotationDiscount: 10,
    quotationTotal: 890, quotationCurrency: 'CNY', purchaseOrders: [{ unitPrice: 89 }],
    attachmentList: [{ kind: 'quote', fileName: '报价.pdf' }, { kind: 'drawing', fileName: '图纸.pdf' }],
    rdTransferSnapshots: [{ id: 'snapshot-1', attachments: [{ kind: 'quote', fileName: '报价.pdf' }, { kind: 'drawing', fileName: '交付图纸.pdf' }] }],
    logs: [
      { text: '保密报价 890 元', fromStatus: 'priced', toStatus: 'in_transit' },
      { text: '保密付款 890 元', fromStatus: 'in_transit', toStatus: 'in_transit' },
    ],
  }));
  const rdService = Object.create(ResearchDevelopmentService.prototype);
  rdService.findTaskAcrossStores = async (id: string) => {
    checked.push(id);
    return rdTasks.find((task) => task.task_id === id)
      ?? { task_id: id, primary_owner_user_id: 'unrelated-user', collaborators: [] };
  };
  const matchingRows = (where: Record<string, any>) => rows.filter((row) =>
    typeof where.rdTaskId === 'string' ? row.rdTaskId === where.rdTaskId : where.rdTaskId.in.includes(row.rdTaskId));
  const prisma = {
    procTask: {
      count: async ({ where }: { where: Record<string, any> }) => { queries.push({ operation: 'count', where }); return matchingRows(where).length; },
      findMany: async (query: Record<string, any>) => {
        queries.push({ operation: 'findMany', ...query });
        return matchingRows(query.where).slice(query.skip, query.skip + query.take);
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  const service = new ProcurementService(prisma as never, {} as never, {} as never, rdService);
  (service as any).getRequesterDepartmentMap = async () => new Map();
  (service as any).serializeTask = (row: unknown) => row;
  return { service, checked, queries, rows };
}

test('研发负责人和协作人批量读取关联进度，仅查询指定范围且每个任务都验证参与权限', async () => {
  const f = fixture();
  const result = await f.service.listTasks({ rdLink: 'true', rdTaskIds: ' rd-1,rd-2,rd-1, ', pageSize: '200' }, actor);
  assert.deepEqual(f.checked, ['rd-1', 'rd-2']);
  assert.deepEqual(result.items.map((task) => task.rdTaskId), ['rd-1', 'rd-2']);
  assert.equal(result.total, 2);
  assert.deepEqual(f.queries[1].where, { rdTaskId: { in: ['rd-1', 'rd-2'] } });
  assert.equal(f.queries[1].take, 200);
  assert.equal(result.items[1].arrivedQty, 1);
  assert.equal(result.items[1].expectedArrivalDate, '2026-09-22');
});

test('混入无关研发任务拒绝整个批次，不能查询采购数据或返回部分结果', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.listTasks({ rdLink: 'true', rdTaskIds: 'rd-1,unrelated,rd-2' }, actor), NotFoundException);
  assert.deepEqual(f.checked, ['rd-1', 'unrelated']);
  assert.deepEqual(f.queries, []);
});

test('批量查询沿用每行商业信息脱敏，保留到货事实与状态流转', async () => {
  const f = fixture();
  const result = await f.service.listTasks({ rdLink: 'true', rdTaskIds: 'rd-1,rd-2' }, actor);
  for (const row of result.items) {
    for (const field of ['paymentDate', 'paymentStatus', 'paymentNote', 'selectedQuotationId', 'quotationSubtotal', 'quotationDiscount', 'quotationTotal', 'quotationCurrency']) {
      assert.equal((row as Record<string, unknown>)[field], undefined, field);
    }
    assert.deepEqual(row.purchaseOrders, []);
    assert.deepEqual(row.attachmentList.map((file) => file.fileName), ['图纸.pdf']);
    assert.deepEqual(row.rdTransferSnapshots[0].attachments.map((file) => file.fileName), ['交付图纸.pdf']);
    assert.equal(row.logs.length, 1);
    assert.equal(row.logs[0].fromStatus, 'priced');
    assert.equal(row.logs[0].toStatus, 'in_transit');
    assert.equal(JSON.stringify(row).includes('保密'), false);
  }
});

test('批量限制按规范去重后的 ID 计算，兼容单个 ID 并集，50 条可完整返回', async () => {
  const f = fixture(50);
  const ids = Array.from({ length: 50 }, (_, index) => `rd-${index + 1}`);
  const result = await f.service.listTasks({ rdLink: 'true', rdTaskId: ' rd-1 ', rdTaskIds: [...ids, ' rd-1 '].join(','), pageSize: '200' }, actor);
  assert.deepEqual(f.checked, ids);
  assert.equal(result.total, 50);
  assert.equal(result.items.length, 50);
});

test('空批次、超限、重复参数和非只读批量查询不会降级到全量列表', async () => {
  const invalidQueries: ProcTaskListQuery[] = [
    { rdLink: 'true', rdTaskIds: ' , ' },
    { rdLink: 'true', rdTaskIds: Array.from({ length: 51 }, (_, index) => `rd-${index}`).join(',') },
    { rdLink: 'true', rdTaskIds: ['rd-1', 'rd-2'] as unknown as string },
    { rdLink: 'true', rdTaskId: ['rd-1'] as unknown as string },
    { rdTaskIds: 'rd-1' },
  ];
  for (const query of invalidQueries) {
    const f = fixture();
    await assert.rejects(() => f.service.listTasks(query, actor), BadRequestException);
    assert.deepEqual(f.checked, []);
    assert.deepEqual(f.queries, []);
  }
});

test('单任务关联请求保持原查询语义，研发页面权限仍不能读取普通采购列表', async () => {
  const f = fixture();
  const result = await f.service.listTasks({ rdLink: 'true', rdTaskId: 'rd-1', pageSize: '1' }, actor);
  assert.equal(result.items[0].id, 'proc-1');
  assert.deepEqual(f.queries[1].where, { rdTaskId: 'rd-1' });
  await assert.rejects(() => f.service.listTasks({}, actor), /没有查看采购任务列表/);
});
