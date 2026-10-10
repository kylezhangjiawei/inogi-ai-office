import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ComponentInventoryService } from '../src/modules/procurement/component-inventory.service';

const material = { id: 'm1', name: '组件甲', unit: '件', tpInventoryCode: 'A01' };
const actor = { id: 'u1', name: '采购员', permissions: ['proc-task:create'] };
function fixture(saved?: object) {
  let value = saved ? JSON.stringify(saved) : null;
  const audits: any[] = [];
  const db: any = {
    procMaterial: { findMany: async () => [material], findUnique: async () => material },
    runtimeState: {
      findMany: async () => value ? [{ key: 'procurement:component-inventory:m1', value }] : [],
      findUnique: async () => value ? { value } : null,
      upsert: async ({ create, update }: any) => { value = value ? update.value : create.value; },
    },
    auditLog: { create: async (entry: any) => audits.push(entry) },
    $queryRaw: async () => [],
    $transaction: async (fn: any) => fn(db),
  };
  const stock: any = { read: async () => ({ rows: [{ code: 'A01', unit: '件', warehouse: '量产仓', bookQty: 80, available: 60, syncedAt: '2026-10-08T00:00:00Z', issues: [] }], missingCodes: [], scope: { kind: 'production' }, readAt: '2026-10-08T00:00:00Z' }) };
  return { service: new ComponentInventoryService(db, stock), db, audits };
}
test('组件 ERP 库存仅统计本物料量产仓，实际量与可用量分列', async () => {
  const { service } = fixture();
  const [row] = await service.read(['m1']);
  assert.equal(row.quantity, 80); assert.equal(row.available, 60); assert.equal(row.source, 'erp');
});
test('人工库存替换同范围 ERP，不相加，零库存保留', async () => {
  const { service } = fixture({ source: 'manual', quantity: 0, unavailable: 0, unit: '件', countedAt: '2026-10-08T00:00:00Z', version: 1, updatedBy: '采购员' });
  const [row] = await service.read(['m1']);
  assert.equal(row.quantity, 0); assert.equal(row.available, 0); assert.equal(row.source, 'manual');
});
test('保存人工库存检查权限、单位、数量及并发版本并留痕', async () => {
  const { service, audits } = fixture();
  const input = { source: 'manual' as const, quantity: 12, unavailable: 2, unit: '件', countedAt: '2026-10-08T00:00:00Z', expectedVersion: 0, note: '盘点' };
  await assert.rejects(() => service.save('m1', input, { ...actor, permissions: [] }), /权限/);
  await assert.rejects(() => service.save('m1', { ...input, quantity: -1 }, actor), /数量/);
  await assert.rejects(() => service.save('m1', { ...input, unit: '套' }, actor), /单位/);
  const row = await service.save('m1', input, actor);
  assert.equal(row.available, 10); assert.equal(row.version, 1); assert.equal(audits.length, 1);
  await assert.rejects(() => service.save('m1', input, actor), /已更新/);
});
test('损坏的人工记录不静默回落 ERP', async () => {
  const { service } = fixture({ source: 'manual', quantity: -1, unit: '件', version: 1 });
  const [row] = await service.read(['m1']);
  assert.equal(row.quantity, null); assert.equal(row.available, null); assert.ok(row.issues.length);
});
