import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ProductionReadinessService } from '../src/modules/procurement/production-readiness.service';

test('库存列表、物料库、普通齐套共享 65；正式计划额外占用 20 后为 45', async () => {
  const material = { id: 'm', tpInventoryCode: 'V1', name: '阀', unit: '件', category: '阀', productLine: 'Q7', spec: '', safeStock: new Prisma.Decimal(0), latestPrice: null, latestQuoteDate: null, reviewStatus: 'approved' };
  const balance = { id: 'b', tpInventoryCode: 'V1', warehouse: '量产仓', unit: '件', stockQty: new Prisma.Decimal(100), availableQty: new Prisma.Decimal(80), inTransitQty: new Prisma.Decimal(0), syncedAt: new Date('2026-09-01'), material };
  const plan = { id: 'p', version: 1, month: '2026-09', productId: 'product', productName: 'Q7', productLine: 'Q7', targetQty: 100, shipmentTargetQty: 100, bomFingerprint: 'bom', bom: [{ id: 'm', code: 'V1', name: '阀', unit: '件', qtyPer: 1 }], batches: [], tasks: [], events: [] };
  const values = new Map([
    ['procurement:execution:v1:plan:p', plan],
    ['procurement:warehouse-record:v1:record:f', { id: 'f', kind: 'freeze', status: 'confirmed', code: 'V1', warehouse: '量产仓', unit: '件', quantity: 5, events: [] }],
    ['procurement:warehouse-flow:v1:issue:i', { id: 'i', planId: 'other', status: 'signed', lines: [{ code: 'V1', unit: '件' }], history: [{ id: 'e', action: 'issue', at: '2026-09-02', lines: [{ code: 'V1', warehouse: '量产仓', quantity: 10 }] }, { id: 's', action: 'sign', at: '2026-09-03' }] }],
    ['procurement:readiness:v1:allocation:other:V1', { planId: 'other', code: 'V1', quantity: 20 }],
  ] as [string, any][]);
  const db: any = {
    $transaction: async (run: any) => typeof run === 'function' ? run(db) : Promise.all(run),
    procInventoryBalance: { findMany: async () => [balance] },
    procMaterial: { count: async () => 1, findMany: async () => [{ ...material, balances: [balance] }] },
    procBomNode: { findMany: async () => [{ id: 'n', parentId: null, productLine: 'Q7', name: '阀', code: 'V1', qtyPer: new Prisma.Decimal(1), level: 0, updatedAt: new Date(), material }] },
    procPurchaseOrderMirror: { findMany: async () => [] },
    runtimeState: {
      findUnique: async ({ where }: any) => values.has(where.key) ? { key: where.key, value: JSON.stringify(values.get(where.key)) } : null,
      findMany: async ({ where }: any) => [...values].filter(([key]) => where.OR.some((clause: any) => key.startsWith(clause.key.startsWith))).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
    },
  };
  const procurement = new ProcurementService(db, {} as any, {} as any, {} as any);
  assert.equal((await new TplusOperationsService(db).listInventory({})).inventory.items[0].available, 65);
  assert.equal((await procurement.listMaterials({})).items[0].availableQty, 65);
  assert.equal((await procurement.getInventoryReadiness({ productLine: 'Q7', targetSets: 100 })).items[0].available, 65);
  const formal = await new ProductionReadinessService(db).read('p', '2026-09-22', { id: 'u', name: '计划员', permissions: ['*'] });
  assert.equal(formal.lines[0].warehouse, 45); assert.equal(formal.lines[0].warehousePending, 15); assert.equal(formal.currentSets, 45);
  balance.syncedAt = null as any;
  assert.equal((await procurement.listMaterials({})).items[0].availableQty, null);
  assert.equal((await procurement.getInventoryReadiness({ productLine: 'Q7' })).summary.currentBuildableSets, null);
  assert.equal((await new ProductionReadinessService(db).read('p', '2026-09-22', { id: 'u', name: '计划员', permissions: ['*'] })).lines[0].current, null);
});
