import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';

import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { CreateInventoryBomLineDto, UpdateInventoryBomLineDto } from '../src/modules/procurement/dto/procurement.dto';

import {
  calculateInventoryReadiness,
  isProductionWarehouse,
} from '../src/modules/procurement/inventory-readiness';

test('production warehouse scope excludes the similarly named R&D warehouse', () => {
  assert.equal(isProductionWarehouse('【活】量产仓'), true);
  assert.equal(isProductionWarehouse('量产仓库'), true);
  assert.equal(isProductionWarehouse('【活】研发量产仓'), false);
  assert.equal(isProductionWarehouse('样品仓'), false);
});

test('inventory readiness uses available quantity and keeps confirmed inbound separate', () => {
  const result = calculateInventoryReadiness(
    [
      { id: 'a', category: '结构件', code: 'A', name: '物料 A', spec: '', unit: '件', qtyPer: 2 },
      { id: 'b', category: '电气件', code: 'B', name: '物料 B', spec: '', unit: '件', qtyPer: 1 },
    ],
    [
      { code: 'A', stock: 100, available: 10, inTransit: 2, safeStock: 0, syncedAt: null },
      { code: 'B', stock: 8, available: 8, inTransit: 100, safeStock: 0, syncedAt: null },
    ],
    10,
  );

  assert.equal(result.summary.currentBuildableSets, 5);
  assert.equal(result.summary.withTransitBuildableSets, 6);
  assert.equal(result.summary.inTransitGainSets, 1);
  assert.equal(result.summary.targetGapAfterTransit, 4);
  assert.equal(result.items.find((item) => item.code === 'A')?.gapAfterTransit, 8);
});

test('inventory readiness combines duplicate BOM usages before calculating sets', () => {
  const result = calculateInventoryReadiness(
    [
      { id: 'a-1', category: '组件一', code: 'A', name: '物料 A', spec: '', unit: '件', qtyPer: 1 },
      { id: 'a-2', category: '组件二', code: 'A', name: '物料 A', spec: '', unit: '件', qtyPer: 2 },
    ],
    [{ code: 'A', stock: 8, available: 8, inTransit: 1, safeStock: 0, syncedAt: null }],
    3,
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qtyPer, 3);
  assert.equal(result.summary.currentBuildableSets, 2);
  assert.equal(result.summary.withTransitBuildableSets, 3);
  assert.equal(result.dataQuality.usableBomLines, 2);
  assert.equal(result.dataQuality.inventoryMatchedLines, 2);
});

test('inventory readiness surfaces incomplete BOM and unmatched ERP rows as provisional', () => {
  const result = calculateInventoryReadiness(
    [
      { id: 'missing-code', category: '包材', code: null, name: '说明书', spec: '', unit: '件', qtyPer: 1 },
      { id: 'missing-qty', category: '原料', code: 'A', name: '原料 A', spec: '', unit: 'kg', qtyPer: 0 },
      { id: 'unmatched', category: '原料', code: 'B', name: '原料 B', spec: '', unit: '件', qtyPer: 1 },
    ],
    [],
    20,
  );

  assert.equal(result.dataQuality.totalBomLines, 3);
  assert.equal(result.dataQuality.invalidBomLines, 2);
  assert.equal(result.dataQuality.inventoryMatchedLines, 0);
  assert.equal(result.dataQuality.provisional, true);
  assert.equal(result.summary.currentBuildableSets, 0);
  assert.deepEqual(result.items.map((item) => item.status).sort(), ['data_missing', 'data_missing', 'unmatched'].sort());
});

function commonBomHarness() {
  let tick = Date.parse('2026-09-04T00:00:00Z');
  const nodes: any[] = [];
  const materials = [
    { id: 'material-a', tpInventoryCode: 'A', name: 'ERP 名称 A', spec: 'ERP 规格 A', unit: '件', category: '电子元件' },
    { id: 'material-b', tpInventoryCode: 'B', name: 'ERP 名称 B', spec: 'ERP 规格 B', unit: 'kg', category: '结构件' },
  ];
  const add = (values: Record<string, unknown>) => {
    const row = {
      id: `node-${nodes.length + 1}`, name: '物料 A', code: 'A', qtyPer: new Prisma.Decimal(1),
      parentId: null, productLine: '通用', level: 0, materialId: 'material-a', remark: null,
      updatedAt: new Date(++tick), ...values,
    };
    nodes.push(row);
    return row;
  };
  const enriched = (row: any) => row && ({ ...row, material: materials.find((item) => item.id === row.materialId) ?? null, _count: { children: nodes.filter((item) => item.parentId === row.id).length } });
  const matches = (row: any, where: any) => row.id === where.id
    && (!where.updatedAt || row.updatedAt.getTime() === where.updatedAt.getTime())
    && (!where.children || nodes.every((item) => item.parentId !== row.id));
  const locks: string[] = [];
  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join('?')); return []; },
    $transaction: async (work: (client: any) => Promise<unknown>, options: any) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return work(db);
    },
    procBomNode: {
      findMany: async () => nodes.map(enriched),
      findUnique: async ({ where }: any) => enriched(nodes.find((row) => row.id === where.id)),
      findUniqueOrThrow: async ({ where }: any) => {
        const row = nodes.find((item) => item.id === where.id);
        if (!row) throw new Error('missing fixture');
        return enriched(row);
      },
      create: async ({ data }: any) => add(data),
      updateMany: async ({ where, data }: any) => {
        const row = nodes.find((item) => matches(item, where));
        if (!row) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date(++tick) });
        return { count: 1 };
      },
      deleteMany: async ({ where }: any) => {
        const index = nodes.findIndex((item) => matches(item, where));
        if (index < 0) return { count: 0 };
        nodes.splice(index, 1);
        return { count: 1 };
      },
    },
    procMaterial: {
      findUnique: async ({ where }: any) => materials.find((item) => item.tpInventoryCode === where.tpInventoryCode) ?? null,
      findMany: async ({ where }: any) => materials.filter((item) => where.tpInventoryCode.in.includes(item.tpInventoryCode)),
    },
    procInventoryBalance: { findMany: async () => [{ tpInventoryCode: 'A', warehouse: '量产仓', stockQty: 30, availableQty: 30, inTransitQty: 0, syncedAt: null, material: { safeStock: 0 } }] },
  };
  const forbidden = new Proxy({}, { get: () => { throw new Error('unexpected external dependency'); } });
  const service = new ProcurementService(db, forbidden as any, forbidden as any, forbidden as any);
  return { service, nodes, materials, add, locks, db };
}

test('通用物料新增、修改和删除仅作用 BOM 行并按编码重新关联物料', async () => {
  const h = commonBomHarness();
  const group = h.add({ name: 'PCB', code: null, qtyPer: null, materialId: null });
  const created = await h.service.createInventoryBomLine({ parentId: group.id, name: '自定名称', code: ' A ', qtyPer: 1.25, remark: '自定规格' });
  let row = h.nodes.find((item) => item.id === created.id);
  assert.equal(row.name, '自定名称');
  assert.equal(row.materialId, 'material-a');
  assert.equal(row.level, 1);
  const updated = await h.service.updateInventoryBomLine(row.id, {
    baseUpdatedAt: created.updatedAt, name: '更正名称', code: 'B', qtyPer: 2, parentId: null, remark: '',
  });
  row = h.nodes.find((item) => item.id === created.id);
  assert.equal(row.materialId, 'material-b');
  assert.equal(row.remark, null);
  assert.equal(row.parentId, null);
  assert.equal(row.level, 0);
  assert.equal(h.materials[1].name, 'ERP 名称 B');
  await h.service.deleteInventoryBomLine(row.id, { baseUpdatedAt: updated.updatedAt });
  assert.deepEqual(h.nodes.map((item) => item.id), [group.id]);
  assert.equal(h.locks.length, 3);
});

test('同编码聚合保留每条原始用量，修改和删除其中一条立即重新计算齐套', async () => {
  const h = commonBomHarness();
  const first = h.add({ id: 'first', name: 'BOM 名称', qtyPer: new Prisma.Decimal(1), remark: 'BOM 规格' });
  const second = h.add({ id: 'second', qtyPer: new Prisma.Decimal(2) });
  let result = await h.service.getInventoryReadiness({ productLine: '通用', targetSets: 10 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qtyPer, 3);
  assert.equal(result.items[0].name, 'BOM 名称');
  assert.equal(result.items[0].spec, 'BOM 规格');
  assert.deepEqual(result.items[0].sourceLines?.map((line) => [line.id, line.qtyPer]), [['first', 1], ['second', 2]]);
  await h.service.updateInventoryBomLine(second.id, { baseUpdatedAt: second.updatedAt.toISOString(), name: second.name, code: 'A', qtyPer: 5, parentId: null });
  result = await h.service.getInventoryReadiness({ productLine: '通用', targetSets: 10 });
  assert.equal(result.items[0].qtyPer, 6);
  assert.equal(result.summary.currentBuildableSets, 5);
  await h.service.deleteInventoryBomLine(first.id, { baseUpdatedAt: first.updatedAt.toISOString() });
  result = await h.service.getInventoryReadiness({ productLine: '通用', targetSets: 10 });
  assert.equal(result.items[0].qtyPer, 5);
  assert.equal(result.summary.currentBuildableSets, 6);
});

test('空分类保留可选且不冒充物料，通用全部为空后仍可新增', async () => {
  const h = commonBomHarness();
  const group = h.add({ name: '空分类', code: null, qtyPer: null, materialId: null });
  const leaf = h.add({ parentId: group.id });
  await h.service.deleteInventoryBomLine(leaf.id, { baseUpdatedAt: leaf.updatedAt.toISOString() });
  let result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items.length, 0);
  assert.equal(result.dataQuality.totalBomLines, 0);
  assert.deepEqual(result.bomPositions, [{ id: group.id, name: '空分类' }]);
  h.nodes.splice(0);
  result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.productLine, '通用');
  assert.equal(result.models.find((model) => model.id === '通用')?.bomLines, 0);
});

test('拒绝修改删除其他型号、结构分类及过期版本，不产生级联删除', async () => {
  const h = commonBomHarness();
  const group = h.add({ code: null, qtyPer: null, materialId: null });
  const leaf = h.add({ parentId: group.id });
  const other = h.add({ productLine: 'Q5' });
  const draft = { name: '物料 A', code: 'A', qtyPer: 1, parentId: null };
  for (const row of [group, other]) {
    await assert.rejects(() => h.service.updateInventoryBomLine(row.id, { ...draft, baseUpdatedAt: row.updatedAt.toISOString() }), /仅支持|结构分类/);
    await assert.rejects(() => h.service.deleteInventoryBomLine(row.id, { baseUpdatedAt: row.updatedAt.toISOString() }), /仅支持|结构分类/);
  }
  for (const baseUpdatedAt of ['invalid', '2025-01-01T00:00:00.000Z', '']) {
    await assert.rejects(() => h.service.updateInventoryBomLine(leaf.id, { ...draft, baseUpdatedAt }), /刷新/);
    await assert.rejects(() => h.service.deleteInventoryBomLine(leaf.id, { baseUpdatedAt }), /刷新/);
  }
  assert.equal(h.nodes.length, 3);
});

test('拒绝跨型号、物料、自身和不存在的父节点以及非法用量', async () => {
  const h = commonBomHarness();
  const leaf = h.add({});
  const otherGroup = h.add({ code: null, qtyPer: null, materialId: null, productLine: 'Q5' });
  const draft = { name: '名称', code: 'A', qtyPer: 1 };
  for (const parentId of [leaf.id, otherGroup.id, 'missing']) {
    await assert.rejects(() => h.service.createInventoryBomLine({ ...draft, parentId }), /分类/);
  }
  await assert.rejects(() => h.service.updateInventoryBomLine(leaf.id, { ...draft, parentId: leaf.id, baseUpdatedAt: leaf.updatedAt.toISOString() }), /自身/);
  for (const qtyPer of [0, -1, NaN, Infinity, 0.00001, 10000000000]) {
    await assert.rejects(() => h.service.createInventoryBomLine({ ...draft, qtyPer }), /单机用量/);
  }
  await assert.rejects(() => h.service.createInventoryBomLine({ ...draft, name: '  ' }), /名称/);
  await assert.rejects(() => h.service.createInventoryBomLine({ ...draft, code: '  ' }), /编码/);
});

test('改为未匹配编码清除旧关联且不影响库存镜像', async () => {
  const h = commonBomHarness();
  const leaf = h.add({});
  await h.service.updateInventoryBomLine(leaf.id, { name: leaf.name, code: 'UNMATCHED', qtyPer: 2, baseUpdatedAt: leaf.updatedAt.toISOString() });
  assert.equal(leaf.materialId, null);
  const result = await h.service.getInventoryReadiness({ productLine: '通用', targetSets: 10 });
  assert.equal(result.items[0].status, 'unmatched');
  assert.equal(result.items[0].gapAfterTransit, 20);
  assert.equal(result.items[0].sourceLines?.[0].unit, '件');
});

test('无效用量的同编码来源不会混入正常聚合编辑数据', async () => {
  const h = commonBomHarness();
  h.add({ id: 'valid', qtyPer: new Prisma.Decimal(3) });
  h.add({ id: 'invalid', qtyPer: null });
  const result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.find((item) => item.status === 'data_missing')?.sourceLines?.map((line) => line.id), ['invalid']);
  assert.deepEqual(result.items.find((item) => item.status !== 'data_missing')?.sourceLines?.map((line) => line.id), ['valid']);
});

test('维护接口使用既有 BOM 写权限且入参验证版本与小数精度', () => {
  for (const method of ['createInventoryBomLine', 'updateInventoryBomLine', 'deleteInventoryBomLine'] as const) {
    assert.deepEqual(Reflect.getMetadata('permissions', ProcurementController.prototype[method]), ['material:import']);
  }
  const draft = { name: '物料 A', code: 'A', qtyPer: 0.125, parentId: null };
  assert.equal(validateSync(plainToInstance(CreateInventoryBomLineDto, draft)).length, 0);
  assert.ok(validateSync(plainToInstance(CreateInventoryBomLineDto, { ...draft, qtyPer: 0.00001 })).length > 0);
  assert.ok(validateSync(plainToInstance(UpdateInventoryBomLineDto, draft)).some((error) => error.property === 'baseUpdatedAt'));
});

test('分类来自当前编码对应的物料库，BOM 关联缺失或过时不影响分类和单位', async () => {
  const h = commonBomHarness();
  const position = h.add({ name: 'PCB-主板', code: null, qtyPer: null, materialId: null });
  const missingRelation = h.add({ id: 'missing-relation', parentId: position.id, materialId: null, name: '自定名称' });
  const staleRelation = h.add({ id: 'stale-relation', code: 'B', parentId: position.id, materialId: 'material-a' });
  const result = await h.service.getInventoryReadiness({ productLine: '通用' });
  const a = result.items.find((item) => item.id === missingRelation.id)!;
  const b = result.items.find((item) => item.id === staleRelation.id)!;
  assert.equal(a.category, '电子元件');
  assert.equal(a.name, '自定名称');
  assert.equal(a.bomPosition, 'PCB-主板');
  assert.equal(a.sourceLines?.[0].category, '电子元件');
  assert.equal(a.sourceLines?.[0].bomPosition, 'PCB-主板');
  assert.equal(b.category, '结构件');
  assert.equal(b.unit, 'kg');
  assert.equal(missingRelation.materialId, null, 'read-only query must not repair stored BOM relations');
  assert.equal(staleRelation.materialId, 'material-a', 'read-only query must not modify stale relations');
});

test('同编码跨多个 BOM 所属位置聚合后仍显示物料库分类，并保留全部所属位置', async () => {
  const h = commonBomHarness();
  const main = h.add({ name: 'PCB-主板', code: null, qtyPer: null, materialId: null });
  const top = h.add({ name: 'PCB-TOP板', code: null, qtyPer: null, materialId: null });
  h.add({ parentId: main.id, qtyPer: new Prisma.Decimal(1) });
  h.add({ parentId: top.id, qtyPer: new Prisma.Decimal(2) });
  const result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qtyPer, 3);
  assert.equal(result.items[0].category, '电子元件');
  assert.equal(result.items[0].bomPosition, 'PCB-主板、PCB-TOP板');
  assert.deepEqual(result.items[0].sourceLines?.map((line) => [line.category, line.bomPosition]), [
    ['电子元件', 'PCB-主板'], ['电子元件', 'PCB-TOP板'],
  ]);
  assert.deepEqual(result.bomPositions, [{ id: main.id, name: main.name }, { id: top.id, name: top.name }]);
});

test('物料库分类修改后刷新立即可见，空分类与未匹配编码均显示未分类', async () => {
  const h = commonBomHarness();
  h.add({});
  h.add({ code: 'MISSING', materialId: 'material-a' });
  h.materials[0].category = '更新后的分类';
  let result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items.find((item) => item.code === 'A')?.category, '更新后的分类');
  assert.equal(result.items.find((item) => item.code === 'MISSING')?.category, '未分类');
  h.materials[0].category = '   ';
  result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items.find((item) => item.code === 'A')?.category, '未分类');
  assert.deepEqual(await h.service.getInventoryReadinessMaterial('A'), { matched: true, category: '未分类', unit: '件' });
});

test('编辑物料编码后分类随物料库切换，BOM 所属位置保持独立', async () => {
  const h = commonBomHarness();
  const position = h.add({ name: 'PCB-主板', code: null, qtyPer: null, materialId: null });
  const leaf = h.add({ parentId: position.id });
  const draft = { name: leaf.name, code: 'B', qtyPer: 2, parentId: position.id, baseUpdatedAt: leaf.updatedAt.toISOString() };
  await h.service.updateInventoryBomLine(leaf.id, draft);
  let result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items[0].category, '结构件');
  assert.equal(result.items[0].bomPosition, position.name);
  assert.equal(result.items[0].unit, 'kg');
  await h.service.updateInventoryBomLine(leaf.id, { ...draft, code: 'MISSING', baseUpdatedAt: leaf.updatedAt.toISOString() });
  result = await h.service.getInventoryReadiness({ productLine: '通用' });
  assert.equal(result.items[0].category, '未分类');
  assert.equal(result.items[0].bomPosition, position.name);
});

test('表单分类查询精确匹配编码并沿用齐套读取权限', async () => {
  const h = commonBomHarness();
  assert.deepEqual(await h.service.getInventoryReadinessMaterial(' A '), { matched: true, category: '电子元件', unit: '件' });
  assert.deepEqual(await h.service.getInventoryReadinessMaterial('B'), { matched: true, category: '结构件', unit: 'kg' });
  for (const code of ['', 'A-partial', 'MISSING', ['A']]) {
    assert.deepEqual(await h.service.getInventoryReadinessMaterial(code), { matched: false, category: '未分类', unit: '件' });
  }
  await assert.rejects(() => h.service.getInventoryReadinessMaterial('x'.repeat(101)), /100/);
  assert.deepEqual(Reflect.getMetadata('permissions', ProcurementController.prototype.getInventoryReadinessMaterial), ['page:proc-inventory-readiness', 'page:proc-cockpit']);
});
