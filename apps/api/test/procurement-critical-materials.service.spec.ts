import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

const actor = { id: 'user-1', name: '测试用户', permissions: [] };

function createService(prisma: Record<string, unknown>) {
  return new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
}

test('重点物料拒绝未关联 T+ 或从未完成库存同步的物料', async () => {
  const cases = [
    {
      label: '未关联 T+',
      material: { id: 'material-1', tpInventoryCode: null, balances: [{ id: 'balance-1' }] },
    },
    {
      label: '未完成库存同步',
      material: { id: 'material-1', tpInventoryCode: 'T-001', balances: [] },
    },
  ];

  for (const sample of cases) {
    let updateCalled = false;
    const service = createService({
      procTask: {
        findUnique: async () => ({ id: 'task-1' }),
        update: async () => {
          updateCalled = true;
          throw new Error('不应写入');
        },
      },
      procMaterial: {
        findMany: async () => [sample.material],
      },
    });

    await assert.rejects(
      () => service.setTaskCriticalMaterials(
        'task-1',
        { items: [{ materialId: 'material-1' }] },
        actor,
      ),
      (error) => (
        error instanceof BadRequestException
        && error.message.includes('必须已关联 T+ 并完成库存同步')
      ),
      sample.label,
    );
    assert.equal(updateCalled, false, sample.label);
  }
});

test('已同步的物料不按库存数量过滤，零库存也能进入保存流程', async () => {
  const reachedUpdate = new Error('reached-update');
  let materialQuery: Record<string, unknown> | undefined;
  const service = createService({
    procTask: {
      findUnique: async () => ({ id: 'task-1' }),
      update: async () => {
        throw reachedUpdate;
      },
    },
    procMaterial: {
      findMany: async (query: Record<string, unknown>) => {
        materialQuery = query;
        return [{ id: 'material-1', tpInventoryCode: 'T-001', balances: [{ id: 'balance-1' }] }];
      },
    },
  });

  await assert.rejects(
    () => service.setTaskCriticalMaterials(
      'task-1',
      { items: [{ materialId: 'material-1', leadTimeDays: 30 }] },
      actor,
    ),
    (error) => error === reachedUpdate,
  );

  assert.ok(materialQuery);
  assert.doesNotMatch(JSON.stringify(materialQuery), /stockQty|availableQty|inTransitQty/);
});

test('产品核心配件只保存当前子系统中的已同步叶子物料', async () => {
  let savedValue = '';
  let nodeQuery: Record<string, unknown> | undefined;
  const service = createService({
    procTaskTreeNode: {
      findMany: async (query: Record<string, unknown>) => {
        nodeQuery = query;
        return [{ materialId: 'material-1' }];
      },
    },
    procMaterial: {
      findMany: async () => [{
        id: 'material-1',
        tpInventoryCode: 'T-001',
        balances: [{ id: 'balance-1' }],
      }],
    },
    runtimeState: {
      upsert: async ({ create }: { create: { value: string } }) => {
        savedValue = create.value;
      },
    },
  });

  const result = await service.setCoreMaterialConfig(
    'prod-portable-o2',
    { materialIds: ['material-1'] },
    actor,
  );

  assert.deepEqual(result.materialIds, ['material-1']);
  assert.equal(result.maxItems, 30);
  assert.deepEqual(JSON.parse(savedValue).materialIds, ['material-1']);
  assert.ok(nodeQuery);
  const nodeWhere = nodeQuery.where as Record<string, unknown>;
  assert.deepEqual(nodeWhere.children, { none: {} });
});

test('不属于当前产品子系统的物料不能配置为核心配件', async () => {
  let writeCalled = false;
  const service = createService({
    procTaskTreeNode: { findMany: async () => [] },
    procMaterial: {
      findMany: async () => [{
        id: 'material-1',
        tpInventoryCode: 'T-001',
        balances: [{ id: 'balance-1' }],
      }],
    },
    runtimeState: {
      upsert: async () => {
        writeCalled = true;
      },
    },
  });

  await assert.rejects(
    () => service.setCoreMaterialConfig(
      'prod-portable-o2',
      { materialIds: ['material-1'] },
      actor,
    ),
    (error) => (
      error instanceof BadRequestException
      && error.message.includes('必须来自当前产品的子系统叶子物料')
    ),
  );
  assert.equal(writeCalled, false);
});

test('产品核心配件去除首尾空格后仍不允许重复', async () => {
  let queryCalled = false;
  const service = createService({
    procTaskTreeNode: {
      findMany: async () => {
        queryCalled = true;
        return [];
      },
    },
  });

  await assert.rejects(
    () => service.setCoreMaterialConfig(
      'prod-portable-o2',
      { materialIds: ['material-1', ' material-1 '] },
      actor,
    ),
    (error) => (
      error instanceof BadRequestException
      && error.message.includes('不能重复配置')
    ),
  );
  assert.equal(queryCalled, false);
});
