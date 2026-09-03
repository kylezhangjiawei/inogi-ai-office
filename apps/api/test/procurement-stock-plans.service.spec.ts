import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

const now = new Date('2026-09-02T02:00:00.000Z');

function plan(input: {
  id: string;
  targetQty: number;
  batches: Array<{ id: string; purchaseQty: number; supplierName?: string }>;
}) {
  return {
    id: input.id,
    code: `SP-20260902-${input.id}`,
    materialId: null,
    materialName: '分子筛组件',
    spec: 'R2',
    unit: '件',
    targetQty: input.targetQty,
    targetDate: new Date('2026-09-30T00:00:00.000Z'),
    note: null,
    createdBy: 'buyer-1',
    createdByName: '采购员甲',
    createdAt: now,
    updatedAt: now,
    batches: input.batches.map((batch) => ({
      id: batch.id,
      planId: input.id,
      supplierId: null,
      supplierName: batch.supplierName ?? '供应商甲',
      purchaseQty: batch.purchaseQty,
      purchaseOrderNo: null,
      orderDate: null,
      expectedArrivalDate: null,
      note: null,
      createdBy: 'buyer-1',
      createdByName: '采购员甲',
      createdAt: now,
      updatedAt: now,
    })),
  };
}

function service(prisma: Record<string, unknown>) {
  return new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
}

test('备货计划按采购批次数量合计自动计算状态和剩余量', async () => {
  const rows = [
    plan({ id: '001', targetQty: 100, batches: [] }),
    plan({ id: '002', targetQty: 100, batches: [{ id: 'b-1', purchaseQty: 35 }] }),
    plan({ id: '003', targetQty: 100, batches: [{ id: 'b-2', purchaseQty: 60 }, { id: 'b-3', purchaseQty: 45 }] }),
  ];
  const result = await service({
    procStockPlan: { findMany: async () => rows },
  }).listStockPlans();

  assert.deepEqual(result.items.map((item) => item.status), ['not_started', 'in_progress', 'completed']);
  assert.deepEqual(result.items.map((item) => item.purchasedQty), [0, 35, 105]);
  assert.deepEqual(result.items.map((item) => item.remainingQty), [100, 65, 0]);
  assert.deepEqual(result.items.map((item) => item.progress), [0, 35, 100]);
});

test('添加不同供应商批次后达到目标即返回已完成', async () => {
  let createdBatch: Record<string, unknown> | undefined;
  const completed = plan({
    id: '004',
    targetQty: 80,
    batches: [
      { id: 'b-4', purchaseQty: 50, supplierName: '供应商甲' },
      { id: 'b-5', purchaseQty: 30, supplierName: '供应商乙' },
    ],
  });
  const result = await service({
    procStockPlan: {
      findUnique: async () => ({ id: '004' }),
      update: async ({ data }: { data: { batches: { create: Record<string, unknown> } } }) => {
        createdBatch = data.batches.create;
        return completed;
      },
    },
  }).createStockPlanBatch(
    '004',
    { supplierName: '供应商乙', purchaseQty: 30 },
    { id: 'buyer-2', name: '采购员乙', permissions: ['proc-task:create'] },
  );

  assert.equal(createdBatch?.supplierName, '供应商乙');
  assert.equal(Number(createdBatch?.purchaseQty), 30);
  assert.equal(createdBatch?.createdBy, 'buyer-2');
  assert.equal(result.status, 'completed');
  assert.equal(result.purchasedQty, 80);
});
