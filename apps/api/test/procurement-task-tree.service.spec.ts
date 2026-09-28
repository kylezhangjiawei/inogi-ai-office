import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConflictException } from '@nestjs/common';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

type TreeRow = {
  id: string;
  productId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  spec: string | null;
  materialId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function row(input: Partial<TreeRow> & Pick<TreeRow, 'id' | 'name'>): TreeRow {
  return {
    productId: 'prod-portable-o2',
    parentId: null,
    code: null,
    spec: null,
    materialId: null,
    sortOrder: 0,
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    ...input,
  };
}

function createService(prisma: Record<string, unknown>) {
  prisma.procBomNode ??= { findFirst: async () => null };
  prisma.procBomRevision ??= { findFirst: async () => null };
  prisma.$executeRawUnsafe ??= async () => 0;
  prisma.$transaction ??= async (callback: (client: Record<string, unknown>) => unknown) => callback(prisma);
  return new ProcurementService(prisma as never, {} as never, {} as never, {} as never);
}

test('名称节点有关联采购任务时，节点及其分类均不可修改或删除', async () => {
  const writes: string[] = [];
  const rows = [
    row({ id: 'root-1', name: '分子筛组件' }),
    row({ id: 'child-1', parentId: 'root-1', name: '上支撑板模具', materialId: 'material-1' }),
  ];
  const prisma = {
    procTaskTreeNode: {
      count: async () => rows.length,
      findMany: async () => rows,
      findFirst: async () => null,
      update: async () => { writes.push('update'); },
      delete: async () => { writes.push('delete'); },
    },
    procTask: {
      findMany: async () => [{ id: 'task-1', productId: 'prod-portable-o2', materialId: 'material-1', materialName: '上支撑板模具' }],
    },
  };
  const service = createService(prisma);

  for (const id of ['root-1', 'child-1']) {
    await assert.rejects(
      () => service.updateProcTaskTreeNode(id, { name: '不可修改' }),
      (error) => error instanceof ConflictException && error.message.includes('不能修改'),
    );
    await assert.rejects(
      () => service.deleteProcTaskTreeNode(id),
      (error) => error instanceof ConflictException && error.message.includes('不能删除'),
    );
  }
  assert.deepEqual(writes, []);
});

test('没有采购任务的名称节点可以修改和删除', async () => {
  const rows = [
    row({ id: 'root-1', name: '配件' }),
    row({ id: 'child-1', parentId: 'root-1', name: '旧名称' }),
  ];
  const writes: string[] = [];
  const prisma = {
    procTaskTreeNode: {
      count: async () => rows.length,
      findMany: async () => rows,
      findFirst: async () => null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TreeRow> }) => {
        const target = rows.find((item) => item.id === where.id)!;
        Object.assign(target, data);
        writes.push(`update:${where.id}`);
        return target;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((item) => item.id === where.id);
        if (index >= 0) rows.splice(index, 1);
        writes.push(`delete:${where.id}`);
      },
    },
    procTask: { findMany: async () => [] },
  };
  const service = createService(prisma);

  const updated = await service.updateProcTaskTreeNode('child-1', { name: '新名称' });
  const deleted = await service.deleteProcTaskTreeNode('child-1');

  assert.equal(updated.name, '新名称');
  assert.deepEqual(deleted, { deleted: 1 });
  assert.deepEqual(writes, ['update:child-1', 'delete:child-1']);
});

test('无物料关联的旧任务仅在名称唯一时兜底归类', async () => {
  const rows = [
    row({ id: 'root-1', name: '分子筛组件' }),
    row({ id: 'child-1', parentId: 'root-1', name: '重复名称' }),
    row({ id: 'child-2', parentId: 'root-1', name: '重复名称' }),
    row({ id: 'child-3', parentId: 'root-1', name: '唯一名称' }),
  ];
  const prisma = {
    procTaskTreeNode: {
      count: async () => rows.length,
      findMany: async () => rows,
    },
    procTask: {
      findMany: async () => [
        { id: 'task-ambiguous', productId: 'prod-portable-o2', materialId: null, materialName: '重复名称' },
        { id: 'task-unique', productId: 'prod-portable-o2', materialId: null, materialName: '唯一名称' },
      ],
    },
  };

  const tree = await createService(prisma).getProcTaskTree();
  const [root] = tree.roots;
  assert.deepEqual(root.children.find((node) => node.id === 'child-1')?.taskIds, []);
  assert.deepEqual(root.children.find((node) => node.id === 'child-2')?.taskIds, []);
  assert.deepEqual(root.children.find((node) => node.id === 'child-3')?.taskIds, ['task-unique']);
  assert.deepEqual(root.taskIds, ['task-unique']);
});

test('同一物料在不同产品系统中只关联各自产品的采购任务', async () => {
  const rows = [
    row({ id: 'portable-root', productId: 'prod-portable-o2', name: '板件' }),
    row({ id: 'portable-leaf', productId: 'prod-portable-o2', parentId: 'portable-root', name: '主控板', materialId: 'material-1' }),
    row({ id: 'respirator-root', productId: 'prod-positive-pressure-respirator', name: '板件' }),
    row({ id: 'respirator-leaf', productId: 'prod-positive-pressure-respirator', parentId: 'respirator-root', name: '主控板', materialId: 'material-1' }),
  ];
  const tasks = [
    { id: 'portable-task', productId: 'prod-portable-o2', materialId: 'material-1', materialName: '主控板' },
    { id: 'respirator-task', productId: 'prod-positive-pressure-respirator', materialId: 'material-1', materialName: '主控板' },
  ];
  const prisma = {
    procTaskTreeNode: {
      count: async () => rows.length,
      findMany: async ({ where }: { where?: { productId?: string } } = {}) =>
        where?.productId ? rows.filter((item) => item.productId === where.productId) : rows,
    },
    procTask: {
      findMany: async ({ where }: { where?: { productId?: string } } = {}) =>
        where?.productId ? tasks.filter((item) => item.productId === where.productId) : tasks,
    },
  };

  const service = createService(prisma);
  const portable = await service.getProcTaskTree('prod-portable-o2');
  const respirator = await service.getProcTaskTree('prod-positive-pressure-respirator');

  assert.deepEqual(portable.roots[0].taskIds, ['portable-task']);
  assert.deepEqual(respirator.roots[0].taskIds, ['respirator-task']);
});

test('受保护的修改和删除会同时锁定目录写入与采购任务写入', async () => {
  const rows = [row({ id: 'root-1', name: '空分类' })];
  const locks: string[] = [];
  const prisma = {
    $executeRawUnsafe: async (sql: string) => { locks.push(sql); },
    procTaskTreeNode: {
      count: async () => rows.length,
      findMany: async () => rows,
      findFirst: async () => null,
      update: async () => undefined,
      delete: async () => undefined,
    },
    procTask: { findMany: async () => [] },
  };
  const service = createService(prisma);

  await service.updateProcTaskTreeNode('root-1', { name: '新分类' });
  await service.deleteProcTaskTreeNode('root-1');

  assert.deepEqual(locks, [
    'LOCK TABLE "ProcTaskTreeNode" IN SHARE ROW EXCLUSIVE MODE',
    'LOCK TABLE "ProcTask" IN SHARE MODE',
    'LOCK TABLE "ProcTaskTreeNode" IN SHARE ROW EXCLUSIVE MODE',
    'LOCK TABLE "ProcTask" IN SHARE MODE',
  ]);
});

test('设备已绑定的产品根不能删除，返回可理解的冲突而非数据库错误', async () => {
  let deletes = 0;
  const service = createService({
    $executeRawUnsafe: async () => undefined,
    procTaskTreeNode: { count: async () => 1, findMany: async () => [row({ id: 'root-bound', name: '已绑定产品' })], delete: async () => { deletes++; } },
    procTask: { findMany: async () => [] }, procBomNode: { findFirst: async () => ({ id: 'device' }) },
  });
  await assert.rejects(service.deleteProcTaskTreeNode('root-bound'), /BOM.*归属/);
  assert.equal(deletes, 0);
});

test('主档后补链优先使用 T+ 编码，ERP 编码有歧义时安全跳过', async () => {
  const updates: Array<{ id: string; materialId: string }> = [];
  const prisma = {
    procTaskTreeNode: {
      findMany: async () => [
        { id: 'node-tp', code: 'A01-001' },
        { id: 'node-unique', code: 'A01-002' },
        { id: 'node-ambiguous', code: 'A01-003' },
        { id: 'node-missing', code: 'A01-004' },
      ],
      updateMany: async ({ where, data }: { where: { id: string }; data: { materialId: string } }) => {
        updates.push({ id: where.id, materialId: data.materialId });
        return { count: 1 };
      },
    },
    procMaterial: {
      findMany: async () => [
        { id: 'material-tp', erpCode: 'LOCAL-001', tpInventoryCode: 'A01-001' },
        { id: 'material-erp-shadow', erpCode: 'A01-001', tpInventoryCode: null },
        { id: 'material-unique', erpCode: 'A01-002', tpInventoryCode: null },
        { id: 'material-ambiguous-a', erpCode: 'A01-003', tpInventoryCode: null },
        { id: 'material-ambiguous-b', erpCode: 'A01-003', tpInventoryCode: null },
      ],
    },
  };

  const result = await createService(prisma).reconcileProcTaskTreeMaterialLinks();

  assert.deepEqual(result, {
    scannedNodes: 4,
    linkedNodes: 2,
    unmatchedNodes: 1,
    ambiguousNodes: 1,
  });
  assert.deepEqual(updates, [
    { id: 'node-tp', materialId: 'material-tp' },
    { id: 'node-unique', materialId: 'material-unique' },
  ]);
});
