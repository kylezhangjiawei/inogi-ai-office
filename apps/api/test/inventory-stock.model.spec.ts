import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateStockRow } from '../src/modules/inventory-stock/inventory-stock.model';

const balance = { tpInventoryCode: 'V1', warehouse: '量产仓', unit: '件', stockQty: new Prisma.Decimal(100), availableQty: new Prisma.Decimal(80), syncedAt: new Date('2026-09-01') };
const record = { id: 'f', kind: 'freeze', status: 'confirmed', code: 'V1', warehouse: '量产仓', unit: '件', quantity: 5 };
const issue = { id: 'i', status: 'signed', lines: [{ code: 'V1', unit: '件' }], history: [
  { id: 'e', action: 'issue', at: '2026-09-02', lines: [{ code: 'V1', warehouse: '量产仓', quantity: 10 }] },
  { id: 's', action: 'sign', at: '2026-09-02' },
] };
test('ERP 80 - 冻结 5 - 发料 10 = 65；签收和待覆盖收货不重复计量', () => {
  const row = calculateStockRow({ balance, records: [record, { ...record, id: 'r', kind: 'receipt', quantity: 20, qualifiedQty: 20 }], issues: [issue] });
  assert.equal(row.available, 65); assert.equal(row.qualifiedPending, 20); assert.equal(row.state, 'known');
});
test('真实零已知；缺同步、错单位、无效数量、扣后负数均未知', () => {
  assert.equal(calculateStockRow({ balance: { ...balance, stockQty: new Prisma.Decimal(0), availableQty: new Prisma.Decimal(0) }, records: [], issues: [] }).available, 0);
  for (const invalid of [{ syncedAt: null }, { unit: '' }, { availableQty: new Prisma.Decimal(-1) }, { stockQty: new Prisma.Decimal(1) }, { availableQty: new Prisma.Decimal(NaN) }]) {
    const row = calculateStockRow({ balance: { ...balance, ...invalid }, records: [], issues: [] });
    assert.equal(row.available, null); assert.equal(row.state, 'unknown'); assert.ok(row.issues.length);
  }
  assert.equal(calculateStockRow({ balance, records: [{ ...record, quantity: 81 }], issues: [] }).available, null);
  assert.equal(calculateStockRow({ balance, records: [{ ...record, unit: '套' }], issues: [] }).available, null);
});
test('小数精确扣减；ERP 必须晚于核对时间才覆盖发料', () => {
  assert.equal(calculateStockRow({ balance: { ...balance, availableQty: new Prisma.Decimal('0.3') }, records: [{ ...record, quantity: 0.1 }], issues: [] }).available, 0.2);
  const reconciled = { ...issue, history: [...issue.history, { id: 'r', action: 'reconcile', at: '2026-09-03', reconciliation: { eventId: 'e', result: 'matched' } }] };
  assert.equal(calculateStockRow({ balance, records: [], issues: [reconciled] }).available, 70);
  assert.equal(calculateStockRow({ balance: { ...balance, syncedAt: new Date('2026-09-04') }, records: [], issues: [reconciled] }).available, 80);
});
test('重复发料只扣一次，冲突副本不能静默取第一条', () => {
  assert.equal(calculateStockRow({ balance, records: [], issues: [issue, issue] }).available, 70);
  const conflict = { ...issue, history: [{ ...issue.history[0], lines: [{ code: 'V1', warehouse: '量产仓', quantity: 11 }] }] };
  const result = calculateStockRow({ balance, records: [], issues: [issue, conflict] });
  assert.equal(result.available, null); assert.match(result.issues.join(), /冲突/);
});
