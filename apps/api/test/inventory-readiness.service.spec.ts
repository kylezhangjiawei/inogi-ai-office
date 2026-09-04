import * as assert from 'node:assert/strict';
import { test } from 'node:test';

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
