import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';

import { TplusPoMatchService } from '../src/modules/procurement/tplus-po-match.service';

test('T+ 行未绑定物料时可按规范化名称和数量生成确定性建议', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    procPurchaseOrderMirror: {
      findMany: async () => [{
        id: 'mirror-1',
        materialId: null,
        inventoryName: '电池-上 壳',
        tpOrderNo: 'PO-001',
        orderedQty: new Prisma.Decimal(100),
        orderDate: null,
        matchStatus: 'unmatched',
      }],
      update: async (args: Record<string, unknown>) => {
        updates.push(args);
        return args;
      },
    },
    procTask: {
      findMany: async () => [{
        id: 'task-1',
        code: 'PR-001',
        materialId: null,
        materialName: '电池上壳',
        quantity: new Prisma.Decimal(100),
        arrivedQty: new Prisma.Decimal(0),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        needDate: null,
        deadline: null,
      }],
    },
    procPurchaseOrderRef: {
      findMany: async () => [],
    },
  };
  const service = new TplusPoMatchService(
    prisma as never,
    {} as never,
    {
      complete: async () => {
        throw new Error('名称规则命中时不应调用 AI');
      },
    } as never,
  );

  const result = await service.runMatch();

  assert.deepEqual(result, { suggested: 1, aiSuggested: 0, unmatched: 0 });
  assert.equal(updates.length, 1);
  const data = updates[0]?.data as {
    matchTaskId: string;
    matchStatus: string;
    matchConfidence: Prisma.Decimal;
    matchReason: string;
  };
  assert.equal(data.matchTaskId, 'task-1');
  assert.equal(data.matchStatus, 'suggested');
  assert.equal(Number(data.matchConfidence), 0.85);
  assert.match(data.matchReason, /名称规范化一致\+数量吻合/);
});

test('仅短名称局部重合时不自动建议，保留给 AI 兜底', async () => {
  let aiCalled = false;
  const prisma = {
    procPurchaseOrderMirror: {
      findMany: async () => [{
        id: 'mirror-1',
        materialId: null,
        inventoryName: '上壳',
        tpOrderNo: 'PO-001',
        orderedQty: new Prisma.Decimal(100),
        orderDate: null,
        matchStatus: 'unmatched',
      }],
      update: async () => {
        throw new Error('低置信名称不应直接更新');
      },
    },
    procTask: {
      findMany: async () => [{
        id: 'task-1',
        code: 'PR-001',
        materialId: null,
        materialName: '电池上壳',
        quantity: new Prisma.Decimal(100),
        arrivedQty: new Prisma.Decimal(0),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        needDate: null,
        deadline: null,
      }],
    },
    procPurchaseOrderRef: {
      findMany: async () => [],
    },
  };
  const service = new TplusPoMatchService(
    prisma as never,
    {} as never,
    {
      complete: async () => {
        aiCalled = true;
        return { content: '{"pairs":[]}', model: 'test-model' };
      },
    } as never,
  );

  const result = await service.runMatch();

  assert.equal(aiCalled, true);
  assert.deepEqual(result, { suggested: 0, aiSuggested: 0, unmatched: 1 });
});
