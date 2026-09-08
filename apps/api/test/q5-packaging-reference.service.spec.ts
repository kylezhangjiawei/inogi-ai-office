import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import 'reflect-metadata';
import { ProcurementService } from '../src/modules/procurement/procurement.service';

function packagingHarness() {
  const bom: any[] = [];
  const balances: any[] = [];
  const queries: any[] = [];
  const materials = [{ tpInventoryCode: 'E05-03', category: '辅料', unit: '条' }];
  const prisma: any = {
    procBomNode: { findMany: async () => bom },
    procMaterial: { findMany: async () => materials },
    procInventoryBalance: { findMany: async ({ where }: any) => {
      queries.push(where);
      return balances.filter((row) => where.tpInventoryCode.in.includes(row.tpInventoryCode)
        && (!where.warehouse || row.warehouse.includes(where.warehouse.contains)));
    } },
  };
  const forbidden = new Proxy({}, { get: () => { throw new Error('unexpected external dependency'); } });
  const service = new ProcurementService(prisma, forbidden as any, forbidden as any, forbidden as any);
  const addBom = (code: string, qtyPer: number | null, productLine = 'Q5') => bom.push({
    id: `bom-${bom.length}`, parentId: null, name: `BOM ${code}`, code, qtyPer, productLine,
    level: 0, remark: null, material: null, updatedAt: new Date('2026-09-08T00:00:00Z'),
  });
  const addBalance = (code: string, quantity: number, warehouse = '【活】量产仓') => balances.push({
    tpInventoryCode: code, warehouse, stockQty: quantity, availableQty: quantity,
    inTransitQty: 0, syncedAt: new Date('2026-09-08T00:00:00Z'), material: null,
  });
  return { service, addBom, addBalance, queries, materials };
}

test('Q5 缺少 BOM 时仍显示包材原表 37 行，来源顺序名称与重复记录保持一致', async () => {
  const h = packagingHarness();
  const result = await h.service.getInventoryReadiness({ productLine: 'Q5' });
  const packaging = (result as any).packaging;
  assert.ok(packaging, 'Q5 must include the separate packaging reference');
  assert.equal(packaging.sourceFile, '包材盘点清单 - 副本.xlsx');
  assert.equal(packaging.sourceSheet, 'Sheet1');
  assert.equal(packaging.items.length, 37);
  const sourceRows = packaging.items.map(({ sourceRow, code, name }: any) => ({ sourceRow, code, name }));
  // 摘要由用户原表 Sheet1 的 37 条货号、品名和 Excel 行号生成，固定完整来源顺序。
  assert.equal(createHash('sha256').update(JSON.stringify(sourceRows)).digest('hex'), '941f4db77c68e6ecdf7113991a6a5c2bda63811dded7e6e270b1f45623588947');
  assert.equal(result.items.length, 0);
  assert.equal(result.dataQuality.totalBomLines, 0);
  assert.ok(packaging.items.every((item: any) => item.qtyPer === null && item.stock === null && item.available === null && item.inTransit === null));
  assert.deepEqual(packaging.items.filter((item: any) => item.code === 'B04-055').map((item: any) => [item.sourceRow, item.issue]), [[31, 'code_conflict'], [32, 'code_conflict']]);
  assert.deepEqual(packaging.items.filter((item: any) => item.code === 'E05-03').map((item: any) => [item.sourceRow, item.duplicateOfRow]), [[19, null], [38, 19]]);
});

test('同编码仅引用完整装配用量，包材与重复源行不增加 BOM 用量或改变齐套', async () => {
  const h = packagingHarness();
  h.addBom('E05-03', 1);
  h.addBom('A10-141', 1);
  h.addBom('A10-141', 2);
  h.addBom('E05-03', 50, '通用');
  h.addBalance('E05-03', 100);
  h.addBalance('A10-141', 300);
  const result = await h.service.getInventoryReadiness({ targetSets: 100 });
  const items = (result as any).packaging.items;
  assert.equal(result.items.length, 2);
  assert.equal(result.dataQuality.totalBomLines, 3);
  assert.equal(result.dataQuality.provisional, false, 'unconfirmed packaging references do not invalidate the assembly BOM');
  assert.equal(result.summary.currentBuildableSets, 100);
  assert.equal(result.items.find((item) => item.code === 'E05-03')?.targetDemand, 100);
  assert.equal(result.items.find((item) => item.code === 'A10-141')?.targetDemand, 300);
  assert.equal(items.find((item: any) => item.code === 'A10-141').qtyPer, 3);
  assert.deepEqual(items.filter((item: any) => item.code === 'E05-03').map((item: any) => [item.qtyPer, item.unit]), [[1, '条'], [1, '条']]);
});

test('包材库存复用量产仓范围，真实零库存与未匹配空值分开保留', async () => {
  const h = packagingHarness();
  h.addBalance('A10-132', 0);
  h.addBalance('A10-132', 999, '【活】研发量产仓');
  h.addBalance('A10-133', 10);
  h.addBalance('A10-133', 5, '量产仓库');
  h.addBalance('USA01-008/5', 999, '样品仓');
  const result = await h.service.getInventoryReadiness({ productLine: 'Q5' });
  const items = (result as any).packaging.items;
  assert.equal(items.find((item: any) => item.code === 'A10-132').available, 0);
  assert.equal(items.find((item: any) => item.code === 'A10-133').available, 15);
  assert.equal(items.find((item: any) => item.code === 'USA01-008/5').available, null);
  assert.equal(items.find((item: any) => item.code === 'A10-133').qtyPer, null);
  assert.equal(items.find((item: any) => item.code === 'A10-133').issue, 'missing_qty');
  assert.equal(items.find((item: any) => item.code === 'A10-133').syncedAt, '2026-09-08T00:00:00.000Z');
});

test('同码任一 BOM 用量缺失时引用为空，冲突货号即使有 BOM 与库存也不猜归属', async () => {
  const h = packagingHarness();
  h.addBom('A08-069', 1);
  h.addBom('A08-069', null);
  h.addBom('A08-031', 1);
  h.addBom('B04-055', 4);
  h.addBalance('A08-069', 10);
  h.addBalance('B04-055', 100);
  const result = await h.service.getInventoryReadiness({ productLine: 'Q5' });
  const items = (result as any).packaging.items;
  assert.equal(items.find((item: any) => item.code === 'A08-069').qtyPer, null);
  assert.equal(items.find((item: any) => item.code === 'A08-069').stock, 10);
  assert.equal(items.find((item: any) => item.code === 'A08-031').issue, 'inventory_unmatched');
  for (const item of items.filter((row: any) => row.code === 'B04-055')) {
    assert.deepEqual([item.qtyPer, item.stock, item.available, item.inTransit, item.syncedAt, item.issue], [null, null, null, null, null, 'code_conflict']);
  }
});

test('包材参考清单与库存查询不会混入通用或其他型号', async () => {
  const h = packagingHarness();
  h.addBom('COMMON', 1, '通用');
  h.addBom('OTHER', 1, 'Q9');
  for (const productLine of ['通用', 'Q9']) {
    const result = await h.service.getInventoryReadiness({ productLine });
    assert.equal('packaging' in result, false);
    assert.deepEqual(h.queries.at(-1).tpInventoryCode.in, [productLine === '通用' ? 'COMMON' : 'OTHER']);
  }
});

test('包材并行展示库存诊断与缺用量，冲突行不推断库存映射', async () => {
  const h = packagingHarness();
  h.materials.push({ tpInventoryCode: 'A10-133', category: '包材', unit: '件' });
  h.addBalance('A10-133', 100, '样品仓');
  h.addBalance('A10-132', 0);
  h.addBalance('B04-055', 100, '样品仓');
  const result = await h.service.getInventoryReadiness({ productLine: 'Q5' });
  const items = result.packaging!.items as any[];
  assert.deepEqual(items.find((row) => row.code === 'USA01-008/5').inventoryDiagnostic,
    { reason: 'material_missing', otherWarehouses: [] });
  assert.deepEqual(items.find((row) => row.code === 'E05-03').inventoryDiagnostic,
    { reason: 'no_inventory_records', otherWarehouses: [] });
  const otherWarehouse = items.find((row) => row.code === 'A10-133');
  assert.equal(otherWarehouse.issue, 'missing_qty');
  assert.equal(otherWarehouse.available, null);
  assert.deepEqual(otherWarehouse.inventoryDiagnostic,
    { reason: 'other_warehouses_only', otherWarehouses: ['样品仓'] });
  const zero = items.find((row) => row.code === 'A10-132');
  assert.equal(zero.available, 0);
  assert.equal('inventoryDiagnostic' in zero, false);
  for (const conflict of items.filter((row) => row.code === 'B04-055')) {
    assert.equal(conflict.issue, 'code_conflict');
    assert.equal('inventoryDiagnostic' in conflict, false);
  }
  assert.equal(result.items.length, 0);
  assert.equal(result.summary.currentBuildableSets, 0);
});
