import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

test('未绑定物料的采购任务仍可读取并搜索全库有效报价', async () => {
  const quoteQueries: Array<Record<string, unknown>> = [];
  const prisma = {
    procTask: {
      findUnique: async () => ({
        id: 'task-1',
        materialId: null,
        materialName: '电池盒样件问题',
        spec: '',
        quantity: 1,
      }),
    },
    procMaterial: {
      findFirst: async () => null,
    },
    procSupplierQuote: {
      findMany: async (args: Record<string, unknown>) => {
        quoteQueries.push(args);
        return [
          {
            id: 'quote-upper',
            materialId: 'material-upper',
            material: { name: '电池上壳', spec: '' },
            supplierId: 'supplier-1',
            supplierName: '明博（原模具）',
            supplierModel: '',
            currency: 'CNY',
            taxIncluded: true,
            leadTimeDays: 7,
            tiers: [{ minQty: 0, unitPrice: 4.5 }],
            quoteDate: null,
            validUntil: null,
            note: null,
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
          {
            id: 'quote-lower',
            materialId: 'material-lower',
            material: { name: '电池下壳', spec: '' },
            supplierId: 'supplier-1',
            supplierName: '明博（原模具）',
            supplierModel: '',
            currency: 'CNY',
            taxIncluded: true,
            leadTimeDays: 7,
            tiers: [{ minQty: 0, unitPrice: 6.5 }],
            quoteDate: null,
            validUntil: null,
            note: null,
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
        ];
      },
    },
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const result = await service.listTaskQuoteBookOptions('task-1');

  assert.equal(result.materialId, null);
  assert.equal(result.scope, 'all');
  assert.equal(result.quotes.length, 2);
  assert.deepEqual(
    result.quotes.map((quote) => quote.materialName).sort(),
    ['电池上壳', '电池下壳'].sort(),
  );
  const where = quoteQueries[0]?.where as Record<string, unknown>;
  assert.equal('materialId' in where, false);
  const validity = where.OR as Array<{ validUntil: null | { gte: Date } }>;
  assert.equal(validity[0]?.validUntil, null);
  assert.ok(validity[1]?.validUntil && 'gte' in validity[1].validUntil);
});

test('可按逐条数量计算多条报价，扣减折扣后一次确认并保存总价', async () => {
  const task = {
    id: 'task-1',
    materialId: null,
    materialName: '电池盒样件问题',
    spec: '',
    quantity: 1,
    status: 'pending_inquiry',
    needSample: false,
  };
  const createdSnapshots: Array<Record<string, unknown>> = [];
  const materialUpdates: Array<Record<string, unknown>> = [];
  const taskUpdates: Array<Record<string, unknown>> = [];
  let quotationSequence = 0;
  const prisma = {
    procTask: {
      findUnique: async () => task,
      update: async (args: Record<string, unknown>) => {
        taskUpdates.push(args);
        return task;
      },
    },
    procMaterial: {
      findFirst: async () => null,
      updateMany: async (args: Record<string, unknown>) => {
        materialUpdates.push(args);
        return { count: 1 };
      },
    },
    procSupplierQuote: {
      findMany: async () => [
        {
          id: 'quote-upper',
          materialId: 'material-upper',
          material: { name: '电池上壳', spec: '' },
          supplierId: 'supplier-1',
          supplierName: '供应商甲',
          supplierModel: 'A-01',
          currency: 'CNY',
          taxIncluded: true,
          leadTimeDays: 7,
          tiers: [{ minQty: 0, unitPrice: 4.5 }],
          quoteDate: new Date('2026-07-20T00:00:00.000Z'),
          validUntil: null,
          note: null,
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        },
        {
          id: 'quote-lower',
          materialId: 'material-lower',
          material: { name: '电池下壳', spec: '' },
          supplierId: 'supplier-2',
          supplierName: '供应商乙',
          supplierModel: 'B-01',
          currency: 'CNY',
          taxIncluded: true,
          leadTimeDays: 9,
          tiers: [{ minQty: 0, unitPrice: 6.5 }],
          quoteDate: new Date('2026-07-21T00:00:00.000Z'),
          validUntil: null,
          note: null,
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        },
      ],
    },
    procQuotation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const snapshot = { id: `snapshot-${++quotationSequence}`, ...data };
        createdSnapshots.push(snapshot);
        return snapshot;
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  const service = new ProcurementService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  service.getTask = async () => ({ id: task.id, status: 'priced' }) as never;

  const result = await service.confirmQuotationsFromQuoteBook(
    task.id,
    {
      selections: [
        { quoteId: 'quote-upper', quantity: 100 },
        { quoteId: 'quote-lower', quantity: 50 },
      ],
      discountAmount: 25,
    },
    { id: 'buyer-1', name: '采购员', permissions: ['proc-task:inquiry'] },
  );

  assert.equal(createdSnapshots.length, 2);
  assert.ok(createdSnapshots.every((snapshot) => snapshot.isSelected === true));
  assert.deepEqual(
    createdSnapshots.map((snapshot) => snapshot.materialId),
    ['material-upper', 'material-lower'],
  );
  assert.deepEqual(
    createdSnapshots.map((snapshot) => Number(snapshot.quantity)),
    [100, 50],
  );
  assert.deepEqual(
    createdSnapshots.map((snapshot) => Number(snapshot.lineTotal)),
    [450, 325],
  );
  assert.equal(materialUpdates.length, 2);
  const taskData = taskUpdates[0]?.data as Record<string, unknown>;
  assert.equal(taskData.status, 'priced');
  assert.equal(taskData.selectedQuotationId, 'snapshot-1');
  assert.equal(Number(taskData.quotationSubtotal), 775);
  assert.equal(Number(taskData.quotationDiscount), 25);
  assert.equal(Number(taskData.quotationTotal), 750);
  assert.equal(taskData.quotationCurrency, 'CNY');
  assert.deepEqual(result, { id: task.id, status: 'priced' });
});
