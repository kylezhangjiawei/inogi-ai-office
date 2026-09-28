import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { InventoryStockService } from '../src/modules/inventory-stock/inventory-stock.service';
const row = { tpInventoryCode: 'V1', warehouse: '量产仓', unit: '件', stockQty: new Prisma.Decimal(10), availableQty: new Prisma.Decimal(10), syncedAt: new Date('2026-09-01') };
function fixture(rows = [row]) {
  const calls: string[] = [];
  const db = { procInventoryBalance: { findMany: async () => { calls.push('tx:balance'); return rows; } }, runtimeState: { findMany: async () => { calls.push('tx:runtime'); return []; } } };
  const prisma = { $transaction: async (run: any, options: any) => { assert.equal(options.isolationLevel, 'RepeatableRead'); calls.push('transaction'); return run(db); } };
  return { service: new InventoryStockService(prisma as any), db, calls };
}
test('one transaction for balances and events; missing codes remain missing', async () => {
  const f = fixture(); const result = await f.service.read({ codes: ['V1', 'V1', 'missing'], scope: { kind: 'production' } });
  assert.deepEqual(f.calls, ['transaction', 'tx:balance', 'tx:runtime']); assert.deepEqual(result.missingCodes, ['missing']); assert.equal(result.rows[0].available, 10); assert.ok(result.sourceToken);
});
test('explicit transaction reused; selected scope and empty codes', async () => {
  const f = fixture(); const result = await f.service.read({ codes: ['V1'], scope: { kind: 'selected', warehouses: ['研发仓'] } }, f.db as any);
  assert.equal(result.rows.length, 0); assert.deepEqual(result.missingCodes, ['V1']); assert.ok(!f.calls.includes('transaction'));
  await assert.rejects(f.service.read({ codes: ['V1'], scope: { kind: 'selected', warehouses: [] } }));
  const before = f.calls.length; assert.deepEqual((await f.service.read({ codes: [], scope: { kind: 'all' } })).rows, []); assert.equal(f.calls.length, before);
});
test('conflicting warehouse units invalidate all rows of the code', async () => {
  const f = fixture([row, { ...row, warehouse: '另一仓', unit: '箱' }]);
  const result = await f.service.read({ codes: ['V1'], scope: { kind: 'all' } });
  assert.ok(result.rows.every(item => item.available === null && item.state === 'unknown'));
});
