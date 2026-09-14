import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { OperationalTasksService } from '../src/modules/procurement/operational-tasks.service';
const d = (n: number) => new Prisma.Decimal(n);
const manager = { id: 'manager', name: '负责人', permissions: ['page:purchase-order-detail', 'page:proc-cockpit', 'proc-operations:assign'] };
const worker = { id: 'worker-a', name: '同名', permissions: ['page:purchase-order-detail', 'proc-purchase-order:receive'] };
function fixture(count = 1) {
  const states = new Map<string, { key: string; value: string }>();
  const lines = Array.from({ length: count }, (_, i) => ({ id: `line-${String(i).padStart(3, '0')}`, tpOrderId: 'erp', tpOrderNo: 'PO', tpLineNo: String(i + 1), inventoryCode: 'SKU', inventoryName: '零件', spec: 'M8', unit: '件', supplierName: '供应商', orderedQty: d(10), receivedQty: d(3), etaDate: new Date('2026-08-01'), updatedAt: new Date('2026-09-01'), status: '', receipts: [] as any[] }));
  const receipts: any[] = [], audits: any[] = [];
  let failAudit = false;
  const select = (rows: any[], where: any, take = 100) => rows.filter(row => !where?.id?.gt || row.id > where.id.gt).slice(0, take);
  const prisma: any = {
    procPurchaseOrderMirror: { findMany: async ({ where, take }: any) => select(lines, where, take), findUnique: async ({ where }: any) => lines.find(line => line.id === where.id) ?? null },
    procPurchaseReceipt: { findMany: async ({ where, take }: any) => select(receipts, where, take), findUnique: async ({ where }: any) => receipts.find(row => row.id === where.id) ?? null },
    user: { findMany: async () => [{ id: 'worker-a', name: '同名', department: '仓库', role: { permissions: worker.permissions } }, { id: 'worker-b', name: '同名', department: '质量', role: { permissions: ['page:purchase-order-detail', 'proc-purchase-order:inspect'] } }] },
    runtimeState: {
      findMany: async ({ where }: any) => [...states.values()].filter(row => where.key.in ? where.key.in.includes(row.key) : row.key.startsWith(where.key.startsWith)),
      findUnique: async ({ where }: any) => states.get(where.key) ?? null,
      upsert: async ({ where, create, update }: any) => { const row = states.has(where.key) ? { ...states.get(where.key), ...update } : create; states.set(where.key, row); return row; },
    },
    auditLog: { create: async ({ data }: any) => { if (failAudit) throw new Error('audit-failure'); audits.push(data); } },
    $queryRaw: async () => [],
    $transaction: async (fn: any) => { const before = new Map(states); try { return await fn(prisma); } catch (error) { states.clear(); before.forEach((value, key) => states.set(key, value)); throw error; } },
  };
  return { service: new OperationalTasksService(prisma), states, lines, receipts, audits, failAudit: () => { failAudit = true; } };
}
const input = { userId: 'worker-a', note: '交接待收订单', dueDate: '2026-09-20', expectedVersion: 0, requestId: 'assignment-request-001' };
test('operational tasks require source read permission, worker scope cannot request another person', async () => {
  const f = fixture(); await assert.rejects(f.service.list({}, { ...manager, permissions: ['page:proc-cockpit'] }), /权限/);
  await f.service.assign('warehouse', 'line-000', input, manager);
  const mine = await f.service.list({ kind: 'warehouse', owner: 'someone-else' }, worker);
  assert.equal(mine.items.length, 1); assert.equal(mine.canViewAll, false); assert.equal(mine.canAssign, false);
  assert.deepEqual(mine.people, [{ id: 'worker-a', name: '同名' }]);
  await assert.rejects(f.service.assign('warehouse', 'line-000', input, worker), /权限/);
});
test('assignments distinguish identical names, validate role, preserve versioned history and idempotency', async () => {
  const f = fixture(); await assert.rejects(f.service.assign('warehouse', 'line-000', { ...input, userId: 'worker-b' }, manager), /权限/);
  const first = await f.service.assign('warehouse', 'line-000', input, manager);
  assert.equal(first.userId, 'worker-a'); assert.equal(first.history.length, 1);
  assert.equal((await f.service.assign('warehouse', 'line-000', input, manager)).version, 1); assert.equal(f.audits.length, 1);
  await assert.rejects(f.service.assign('warehouse', 'line-000', { ...input, requestId: 'assignment-request-002' }, manager), /刷新/);
  const next = await f.service.assign('warehouse', 'line-000', { ...input, userId: '', expectedVersion: 1, requestId: 'assignment-request-002', note: '等待接收人确认' }, manager);
  assert.equal(next.history.length, 2); assert.equal(next.userId, '');
});
test('invalid dates, absent sources and audit failure do not persist assignments', async () => {
  const f = fixture();
  await assert.rejects(f.service.assign('warehouse', 'line-000', { ...input, dueDate: '2026-02-30' }, manager), /日期/);
  await assert.rejects(f.service.assign('warehouse', 'missing', input, manager), /不存在/);
  f.failAudit(); await assert.rejects(f.service.assign('warehouse', 'line-000', input, manager), /audit-failure/); assert.equal(f.states.size, 0);
});
test('source paging and cross-month queries retain tasks beyond first 25', async () => {
  const f = fixture(61), seen = new Set<string>(); let cursor: string | undefined;
  do { const result = await f.service.list({ kind: 'warehouse', owner: 'all', before: '2026-09-01', cursor }, manager);
    result.items.forEach(row => { assert.equal(seen.has(String(row.id)), false); seen.add(String(row.id)); }); cursor = result.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(seen.size, 61);
});
test('receipt creator is never treated as task assignee; cancelled order still needs physical quality judgment', async () => {
  const f = fixture(), line = f.lines[0]; line.status = 'cancelled';
  const receipt: any = { id: 'receipt-1', lineId: line.id, line, receivedQty: d(3), receivedDate: new Date('2026-08-01'), version: 0, deliveryNo: 'D1', createdById: worker.id, sourceUnit: '件', sourceOrderId: 'erp', sourceOrderNo: 'PO', sourceLineNo: '1', sourceInventoryCode: 'SKU', sourceInventoryName: '零件', sourceSpec: 'M8', sourceSupplierName: '供应商', inspections: [] };
  line.receipts = [receipt]; f.receipts.push(receipt);
  const result = await f.service.list({ kind: 'quality', owner: 'unassigned' }, manager);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].assignment, null); assert.equal(result.items[0].completed, false); assert.equal(result.items[0].quantity, 3);
  line.receipts.push({ ...receipt, id: 'unrelated-bad-receipt', sourceUnit: '套' });
  assert.equal((await f.service.list({ kind: 'quality' }, manager)).items[0].quantity, 3);
  receipt.sourceUnit = '套';
  assert.equal((await f.service.list({ kind: 'quality' }, manager)).items[0].quantity, null);
});
