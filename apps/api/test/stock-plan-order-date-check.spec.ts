import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import type { StockPlanOrderDateRow } from '../src/modules/procurement/stock-plan-order-date-check';

type Row = Record<string, any>;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const timestamp = day('2026-09-10');
const actor = { id: 'buyer-1', name: '采购甲', permissions: ['page:proc-cockpit', 'page:purchase-order-detail'] };
const plan = (extra: Row = {}): Row => ({ id: 'plan-1', code: 'SP-1', targetDate: day('2026-09-15'), updatedAt: timestamp, unit: '件', material: { tpInventoryCode: 'A/01' }, batches: [], tasks: [], ...extra });
const mirror = (extra: Row = {}): Row => ({
  id: 'line-1', tpOrderNo: 'PO%2F001', tpOrderId: 'erp-1', tpLineNo: '1', inventoryCode: 'A/01', inventoryName: '物料甲',
  spec: '规格甲', unit: '件', supplierName: '供应商甲', orderedQty: new Prisma.Decimal(100), receivedQty: new Prisma.Decimal(20),
  etaDate: day('2026-09-14'), syncedAt: timestamp, status: 'ERP_RAW_1', approvalStatus: '已审核', availability: null, ...extra,
});
const batch = (extra: Row = {}): Row => ({ id: 'batch-1', purchaseOrderMirrorId: 'line-1', purchaseOrderNo: 'PO%2F001', supplierName: '供应商甲', ...extra });
const ref = (extra: Row = {}): Row => ({ id: 'ref-1', tpOrderNo: 'PO%2F001', tpLineNo: '1', tpOrderId: 'erp-1', metadata: {}, ...extra });
const task = (extra: Row = {}): Row => ({ id: 'task-1', code: 'PR-1', materialName: '物料甲', unit: '件', material: { tpInventoryCode: 'A/01' }, purchaseOrderRefs: [ref()], ...extra });
function confirmed(line: Row, availableDate: string | null = '2026-09-15'): Row {
  return { ...line, availability: {
    id: 'availability-1', mirrorId: line.id, availableDate: availableDate && day(availableDate), note: '人工确认',
    confirmedById: 'user-secret-id', confirmedByName: '采购乙', confirmedAt: timestamp, sourceFingerprint: purchaseOrderSourceFingerprint(line as never), version: 2,
  } };
}
function fixture(record: Row | null = plan(), mirrors: Row[] = []) {
  const reads: Array<{ operation: string; args: Row }> = [];
  let options: unknown;
  let fail: Error | null = null;
  const prisma = {
    procStockPlan: { findUnique: async (args: Row) => {
      reads.push({ operation: 'plan', args });
      if (fail) throw fail;
      return record?.id === args.where.id ? record : null;
    } },
    procPurchaseOrderMirror: { findMany: async (args: Row) => {
      reads.push({ operation: 'mirrors', args });
      return mirrors.filter((line) => args.where.OR.some((condition: Row) => condition.id
        ? condition.id.in.includes(line.id)
        : condition.tpOrderNo === line.tpOrderNo && condition.tpLineNo === line.tpLineNo));
    } },
    $transaction: async (run: (tx: unknown) => Promise<unknown>, txOptions: unknown) => { options = txOptions; return run(prisma); },
  };
  return { service: new ProcurementService(prisma as never, {} as never, {} as never, {} as never), reads, options: () => options, fail: (error: Error) => { fail = error; } };
}
function lineRow(rows: StockPlanOrderDateRow[]) {
  const row = rows.find((item) => item.kind === 'line');
  assert.ok(row?.kind === 'line');
  return row;
}

test('endpoint requires cockpit plus one existing order-read permission before any plan lookup', async () => {
  const handler = ProcurementController.prototype.getStockPlanOrderDateCheck;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'stock-plans/:id/order-date-check');
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), ['page:proc-cockpit']);
  for (const permissions of [[], ['page:proc-cockpit'], ['page:purchase-order-detail'], ['page:purchase-orders'], ['page:proc-my-workspace', 'page:purchase-order-detail'], ['proc-task:create', 'page:purchase-orders']]) {
    const f = fixture();
    await assert.rejects(f.service.getStockPlanOrderDateCheck('plan-1', {}, { ...actor, permissions }), /查看权限/);
    assert.equal(f.reads.length, 0);
  }
  for (const permissions of [['*'], ['page:proc-cockpit', 'page:purchase-orders'], actor.permissions]) {
    const f = fixture();
    const controller = new ProcurementController(f.service, {} as never, {} as never);
    await controller.getStockPlanOrderDateCheck('plan-1', {}, { user: { ...actor, permissions } });
    assert.equal(f.reads[0].operation, 'plan');
  }
});

test('reads a server-owned plan and explicit links in one repeatable snapshot without returning quantities', async () => {
  const f = fixture(plan({ batches: [batch()] }), [confirmed(mirror())]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.deepEqual(f.options(), { isolationLevel: 'RepeatableRead' });
  assert.deepEqual(f.reads[0].args.where, { id: 'plan-1' });
  assert.equal(f.reads[0].args.select.targetQty, undefined);
  assert.equal(f.reads[0].args.select.tasks.select.quantity, undefined);
  assert.deepEqual(result.plan, { id: 'plan-1', code: 'SP-1', targetDate: '2026-09-15', updatedAt: timestamp.toISOString() });
  assert.equal(result.readOnly, true);
  const row = lineRow(result.rows.items);
  assert.equal(row.dateCheck, 'on_or_before_target');
  assert.equal(row.orderNo, 'PO%2F001');
  assert.equal(row.etaDate, '2026-09-14');
  assert.equal(row.syncedAt, timestamp.toISOString());
  assert.doesNotMatch(JSON.stringify(result), /orderedQty|receivedQty|targetQty|remainingQty|sourceFingerprint|confirmedById/);
});

test('deduplicates a mirror shared by a batch and task refs while preserving every distinct source', async () => {
  const f = fixture(plan({ batches: [batch()], tasks: [
    task({ id: 'task-2', code: 'PR-2' }), task({ purchaseOrderRefs: [ref(), ref({ id: 'ref-duplicate' })] }),
  ] }), [mirror()]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 1);
  assert.deepEqual(lineRow(result.rows.items).sources.map(({ kind, id }) => [kind, id]), [['batch', 'batch-1'], ['task', 'task-1'], ['task', 'task-2']]);
  assert.deepEqual(f.reads[1].args.where, { OR: [{ id: { in: ['line-1'] } }, { tpOrderNo: 'PO%2F001', tpLineNo: '1' }] });
});

test('missing batch association and task refs are independent unresolved rows; order text never guesses a line', async () => {
  const f = fixture(plan({ batches: [batch({ purchaseOrderMirrorId: null })], tasks: [task({ purchaseOrderRefs: [] })] }), [mirror()]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 2);
  assert.ok(result.rows.items.every((row) => row.kind === 'unresolved'));
  assert.equal(f.reads.length, 1, 'no exact line identity means no mirror query at all');
  assert.match(JSON.stringify(result.rows.items), /单号文本不能代替|尚未关联 ERP/);
});

test('task refs require all three identity fields; missing ID or line number cannot adopt a current same-number mirror', async () => {
  const f = fixture(plan({ tasks: [task({ purchaseOrderRefs: [
    ref({ id: 'no-order', tpOrderNo: '' }), ref({ id: 'no-line', tpLineNo: null }), ref({ id: 'no-id', tpOrderId: null }),
  ] })] }), [mirror()]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 3);
  assert.ok(result.rows.items.every((row) => row.kind === 'unresolved'));
  assert.equal(f.reads.length, 1);
  assert.match(JSON.stringify(result.rows.items), /缺少采购单号/);
  assert.match(JSON.stringify(result.rows.items), /缺少订单行号/);
  assert.match(JSON.stringify(result.rows.items), /缺少ERP 订单身份/);
});

test('free samples stay unresolved even if an old record contains a full ERP identity', async () => {
  const f = fixture(plan({ tasks: [task({ purchaseOrderRefs: [ref({ metadata: { freeSample: true } })] })] }), [mirror()]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 1);
  assert.match(JSON.stringify(result.rows.items), /免费样品/);
  assert.equal(f.reads.length, 1);
});

test('missing and recreated ERP mirrors remain unresolved and do not reveal replacement material details', async () => {
  for (const mirrors of [[], [mirror({ tpOrderId: 'erp-recreated', inventoryName: '不应展示的新物料' })], [mirror({ tpOrderId: null })]]) {
    const f = fixture(plan({ tasks: [task()] }), mirrors);
    const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
    assert.equal(result.rows.items[0].kind, 'unresolved');
    assert.doesNotMatch(JSON.stringify(result), /不应展示的新物料/);
    assert.match(JSON.stringify(result), /尚未同步或已失效|身份已改变或缺失/);
  }
  const missingBatch = fixture(plan({ batches: [batch()] }), []);
  assert.match(JSON.stringify(await missingBatch.service.getStockPlanOrderDateCheck('plan-1', {}, actor)), /不存在或已失效/);
});

test('exact task identity does not match another line or similar order number', async () => {
  const f = fixture(plan({ tasks: [task()] }), [mirror({ tpLineNo: '2' }), mirror({ tpOrderNo: 'PO/001' }), mirror({ tpOrderNo: 'PO%2F001-extra' })]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 1);
  assert.equal(result.rows.items[0].kind, 'unresolved');
});

test('ERP percent, slash and whitespace identities remain literal and cannot alias trimmed or decoded identities', async () => {
  const exact = { tpOrderNo: ' PO%2F/001 ', tpLineNo: ' 01 ', tpOrderId: ' erp%20/1 ' };
  const trimmed = Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, value.trim()]));
  const sources = plan({ tasks: [task({ purchaseOrderRefs: [ref(exact)] })] });
  const f = fixture(sources, [mirror({ ...exact, id: 'literal-line' }), mirror({ ...trimmed, id: 'trimmed-other-line' })]);
  const correct = lineRow((await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor)).rows.items);
  assert.equal(correct.lineId, 'literal-line');
  assert.equal(correct.orderNo, exact.tpOrderNo);
  assert.equal(correct.lineNo, exact.tpLineNo);
  assert.deepEqual(f.reads[1].args.where, { OR: [{ tpOrderNo: exact.tpOrderNo, tpLineNo: exact.tpLineNo }] });
  for (const impostor of [
    mirror(trimmed),
    mirror({ ...exact, tpOrderNo: decodeURIComponent(exact.tpOrderNo) }),
    mirror({ ...exact, tpLineNo: exact.tpLineNo.trim() }),
    mirror({ ...exact, tpOrderId: exact.tpOrderId.trim() }),
  ]) {
    const isolated = fixture(sources, [impostor]);
    const result = await isolated.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
    assert.equal(result.rows.items[0].kind, 'unresolved', 'a transformed identity must never adopt another ERP row');
  }
});

test('source code or unit mismatch is unresolved separately for batches and tasks', async () => {
  for (const changed of [{ inventoryCode: 'OTHER' }, { unit: '箱' }]) {
    const f = fixture(plan({ batches: [batch()], tasks: [task()] }), [mirror(changed)]);
    const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
    assert.equal(result.rows.total, 2);
    assert.ok(result.rows.items.every((row) => row.kind === 'unresolved'));
    assert.match(JSON.stringify(result.rows.items), /不一致/);
  }
});

test('an invalid source cannot contaminate another valid source for the same mirror', async () => {
  const f = fixture(plan({ batches: [batch()], tasks: [task({ unit: '箱' })] }), [mirror()]);
  const result = await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor);
  assert.equal(result.rows.total, 2);
  assert.deepEqual(lineRow(result.rows.items).sources.map((source) => source.kind), ['batch']);
  assert.equal(result.rows.items[1].kind, 'unresolved');
});

test('date comparison uses plan target only and respects confirmation states before a missing target', async () => {
  const cases = [
    { source: mirror(), target: '2026-09-15', expected: 'unconfirmed' },
    { source: confirmed(mirror(), null), target: '2026-09-15', expected: 'cleared' },
    { source: confirmed(mirror(), '2026-09-14'), target: '2026-09-15', expected: 'on_or_before_target' },
    { source: confirmed(mirror(), '2026-09-15'), target: '2026-09-15', expected: 'on_or_before_target' },
    { source: confirmed(mirror(), '2026-09-16'), target: '2026-09-15', expected: 'after_target' },
    { source: confirmed(mirror()), target: null, expected: 'target_missing' },
    { source: mirror(), target: null, expected: 'unconfirmed' },
    { source: confirmed(mirror(), null), target: null, expected: 'cleared' },
  ];
  for (const entry of cases) {
    const f = fixture(plan({ targetDate: entry.target && day(entry.target), tasks: [task({ needDate: day('2026-09-30') })] }), [entry.source]);
    assert.equal(lineRow((await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor)).rows.items).dateCheck, entry.expected);
  }
  const stale = confirmed(mirror()); stale.receivedQty = new Prisma.Decimal(21);
  for (const targetDate of [null, day('2026-09-15')]) {
    const f = fixture(plan({ targetDate, batches: [batch()] }), [stale]);
    assert.equal(lineRow((await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor)).rows.items).dateCheck, 'needs_reconfirmation');
  }
});

test('ERP status is returned verbatim and never substituted with a delivery or supply judgment', async () => {
  for (const status of ['cancelled', 'closed', 'completed', '未知 ERP 状态', null]) {
    const f = fixture(plan({ batches: [batch()] }), [confirmed(mirror({ status, approvalStatus: null }))]);
    const row = lineRow((await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor)).rows.items);
    assert.equal(row.orderStatus, status);
    assert.equal(row.approvalStatus, null);
    assert.equal(row.dateCheck, 'on_or_before_target', 'the returned comparison describes dates only');
  }
});

test('merged normal and unresolved rows share stable key order, total and page boundaries', async () => {
  const batches = [batch({ id: 'z', purchaseOrderMirrorId: null }), batch({ id: 'b', purchaseOrderMirrorId: 'line-z' }), batch({ id: 'a', purchaseOrderMirrorId: 'line-a' })];
  const f = fixture(plan({ batches, tasks: [task({ id: 'a-task', purchaseOrderRefs: [] })] }), [mirror({ id: 'line-z' }), mirror({ id: 'line-a' })]);
  const first = await f.service.getStockPlanOrderDateCheck('plan-1', { page: 1, pageSize: 2 }, actor);
  const last = await f.service.getStockPlanOrderDateCheck('plan-1', { page: 999, pageSize: 2 }, actor);
  assert.deepEqual(first.rows.items.map((row) => row.key), ['line:line-a', 'line:line-z']);
  assert.deepEqual(last.rows.items.map((row) => row.key), ['unresolved:batch:z', 'unresolved:task:a-task']);
  assert.equal(last.rows.page, 2); assert.equal(last.rows.total, 4); assert.equal(last.rows.totalPages, 2);
  batches.reverse();
  assert.deepEqual((await f.service.getStockPlanOrderDateCheck('plan-1', { page: 1, pageSize: 2 }, actor)).rows.items.map((row) => row.key), first.rows.items.map((row) => row.key));
});

test('pagination defaults and cap include unresolved rows, and invalid input never causes unbounded reads', async () => {
  const f = fixture(plan({ batches: Array.from({ length: 51 }, (_, index) => batch({ id: `batch-${index}`, purchaseOrderMirrorId: null })) }));
  assert.equal((await f.service.getStockPlanOrderDateCheck('plan-1', {}, actor)).rows.items.length, 10);
  const capped = await f.service.getStockPlanOrderDateCheck('plan-1', { page: 2, pageSize: 500 }, actor);
  assert.equal(capped.rows.pageSize, 50); assert.equal(capped.rows.items.length, 1); assert.equal(capped.rows.total, 51);
  for (const key of ['page', 'pageSize']) for (const value of [null, [], {}, '', 0, -1, 1.5, '1e3', ' 1 ', Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = fixture();
    await assert.rejects(invalid.service.getStockPlanOrderDateCheck('plan-1', { [key]: value }, actor), /正整数/);
    assert.equal(invalid.reads.length, 0);
  }
});

test('an empty plan is an explicit empty result; missing plans and database errors remain errors', async () => {
  const empty = fixture();
  const result = await empty.service.getStockPlanOrderDateCheck('plan-1', { page: 99 }, actor);
  assert.deepEqual(result.rows, { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
  assert.equal(empty.reads.length, 1);
  await assert.rejects(fixture(null).service.getStockPlanOrderDateCheck('missing', {}, actor), /备货计划不存在/);
  for (const id of ['', '  ', 'x'.repeat(129), 'bad\n']) {
    const invalid = fixture(); await assert.rejects(invalid.service.getStockPlanOrderDateCheck(id, {}, actor), /标识无效/); assert.equal(invalid.reads.length, 0);
  }
  const failed = fixture(); failed.fail(new Error('database unavailable'));
  await assert.rejects(failed.service.getStockPlanOrderDateCheck('plan-1', {}, actor), /database unavailable/);
});
