import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PurchaseReceiptsService, receiptDay, receiptQuantity } from '../src/modules/procurement/purchase-receipts.service';
import { PurchaseReceiptsController } from '../src/modules/procurement/purchase-receipts.controller';
import { CreatePurchaseInspectionDto, CreatePurchaseReceiptDto } from '../src/modules/procurement/dto/purchase-receipts.dto';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';

const sourceTime = new Date('2026-09-10T01:00:00.000Z');
const actor = { id: 'warehouse-1', name: '仓管甲', permissions: ['page:purchase-order-detail', 'proc-purchase-order:receive', 'proc-purchase-order:inspect'] };
const receiptInput = { requestId: 'qa-receipt-request-0001', expectedSourceUpdatedAt: sourceTime.toISOString(), deliveryNo: 'DELIVERY-001', receivedDate: '2026-09-01', receivedQty: 10, note: '外箱完整' };
const inspectionInput = { treeNodeId: 'node-1', requestId: 'qa-inspection-request-0001', expectedSourceUpdatedAt: sourceTime.toISOString(), expectedVersion: 0, inspectionDate: '2026-09-02', qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, basis: '来料规范 A / 全检', note: '一件表面划伤，两件尺寸待复核' };
type Row = Record<string, any>;
const decimal = (value: number | string) => new Prisma.Decimal(value);

function fixture() {
  const line = { id: 'line-1', tpOrderId: 'erp-1', tpOrderNo: 'PO-1', tpLineNo: '2', inventoryCode: 'SKU-1', inventoryName: '壳体', spec: 'V1', unit: '件', supplierName: '供应商甲', orderedQty: decimal(20), receivedQty: decimal(18), updatedAt: sourceTime, status: '1', approvalStatus: '已审核', metadata: { secret: true }, unitPrice: decimal(100) };
  let receipts: Row[] = [], inspections: Row[] = [], audits: Row[] = [];
  let states = new Map<string, Row>(), qualities: Row[] = [];
  let tail = Promise.resolve(), failAudit = false;
  const locks: unknown[][] = [];
  const joined = (row: Row) => ({ ...row, inspections: inspections.filter((inspection) => inspection.receiptId === row.id).sort((a, b) => b.version - a.version).map((inspection) => ({ ...inspection })) });
  const prisma = {
    runtimeState: {
      findUnique: async ({ where }: Row) => states.get(where.key) ?? null,
      create: async ({ data }: Row) => { states.set(data.key, data); return data; },
      updateMany: async ({ where, data }: Row) => {
        const row = states.get(where.key);
        if (!row || row.value !== where.value) return { count: 0 };
        states.set(where.key, { ...row, ...data }); return { count: 1 };
      },
    },
    procTaskTreeNode: { findUnique: async ({ where }: Row) => where.id === 'node-1' ? { id: 'node-1', productId: 'product-1' } : null },
    procMaterial: { findFirst: async () => ({ id: 'material-1' }) },
    procQualityRecord: { findUnique: async ({ where }: Row) => qualities.find(row => row.id === where.id) ?? null, create: async ({ data }: Row) => { const row = { id: 'quality-' + (qualities.length + 1), ...data }; qualities.push(row); return row; }, update: async ({ where, data }: Row) => Object.assign(qualities.find(row => row.id === where.id)!, data) },
    procPurchaseOrderMirror: { findUnique: async ({ where }: Row) => where.id === line.id ? { ...line } : null },
    procPurchaseReceipt: {
      findMany: async ({ where }: Row) => receipts.filter((row) => row.lineId === where.lineId).map(joined),
      findUnique: async ({ where }: Row) => receipts.find((row) => row.requestId === where.requestId) ?? null,
      create: async ({ data }: Row) => {
        const saved = { id: `receipt-${receipts.length + 1}`, version: 0, createdAt: new Date(), ...data }; receipts.push(saved); return saved;
      },
      updateMany: async ({ where, data }: Row) => {
        const row = receipts.find((candidate) => candidate.id === where.id && candidate.lineId === where.lineId && candidate.version === where.version);
        if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 };
      },
    },
    procPurchaseReceiptInspection: {
      findUnique: async ({ where }: Row) => inspections.find((row) => row.requestId === where.requestId) ?? null,
      create: async ({ data }: Row) => { const saved = { id: `inspection-${inspections.length + 1}`, createdAt: new Date(), ...data }; inspections.push(saved); return saved; },
    },
    auditLog: { create: async ({ data }: Row) => { if (failAudit) throw new Error('audit unavailable'); audits.push(data); return data; } },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(values); return strings.join('').includes('"RuntimeState"') ? values.filter(key=>states.get(String(key))?.value).map(key=>({key})) : []; },
    $transaction: async (run: (db: unknown) => Promise<unknown>) => {
      const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
      const oldStates = new Map(states), oldQualities = qualities.map(row => ({ ...row }));
      const oldReceipts = receipts.map((row) => ({ ...row })), oldInspections = inspections.map((row) => ({ ...row })), oldAudits = [...audits];
      try { return await run(prisma); } catch (error) { states = oldStates; qualities = oldQualities; receipts = oldReceipts; inspections = oldInspections; audits = oldAudits; throw error; } finally { release(); }
    },
  };
  return { line, service: new PurchaseReceiptsService(prisma as never), locks, qualities: () => qualities, states: () => states, receipts: () => receipts, inspections: () => inspections, audits: () => audits, failAudit: () => { failAudit = true; } };
}

test('ERP删除或修改待核对时不允许新增收货，解除阻断后才可登记',async()=>{
  const f=fixture();f.states().set('erp-po-pending:PO-1',{value:'pending-request'});
  await assert.rejects(f.service.receive('line-1',receiptInput,actor),/正在核对/);assert.equal(f.receipts().length,0);
  f.states().delete('erp-po-pending:PO-1');await f.service.receive('line-1',receiptInput,actor);assert.equal(f.receipts().length,1);
});

test('receipt DTO requires request identity, date, positive three-decimal quantity and bounded text', async () => {
  assert.equal((await validate(Object.assign(new CreatePurchaseReceiptDto(), receiptInput))).length, 0);
  for (const changed of [{ requestId: '' }, { expectedSourceUpdatedAt: '' }, { deliveryNo: '' }, { receivedQty: 0 }, { receivedQty: 1.0001 }, { receivedQty: '1' }, { note: 'x'.repeat(2001) }]) {
    assert.ok((await validate(Object.assign(new CreatePurchaseReceiptDto(), receiptInput, changed))).length > 0);
  }
});

test('inspection DTO requires separate pending-judgment quantity and complete evidence', async () => {
  assert.equal((await validate(Object.assign(new CreatePurchaseInspectionDto(), inspectionInput))).length, 0);
  for (const changed of [{ pendingJudgmentQty: undefined }, { expectedVersion: -1 }, { qualifiedQty: -1 }, { defectiveQty: 0.0001 }, { basis: '' }, { note: '' }]) {
    assert.ok((await validate(Object.assign(new CreatePurchaseInspectionDto(), inspectionInput, changed))).length > 0);
  }
});

test('quantity arithmetic rejects NaN, infinity, coercion and precision loss', () => {
  assert.equal(receiptQuantity(0.001, '数量', true).plus(receiptQuantity(0.002, '数量')).toString(), '0.003');
  for (const input of [NaN, Infinity, -Infinity, '1', null, -1, 0.0001, 100000000000]) assert.throws(() => receiptQuantity(input, '数量'));
  assert.throws(() => receiptQuantity(0, '数量', true));
});

test('calendar dates reject impossible days and future dates in China timezone', () => {
  assert.equal(receiptDay('2028-02-29', '日期', new Date('2028-02-29T00:00:00Z')).toISOString(), '2028-02-29T00:00:00.000Z');
  for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-9-01', '', '2026-09-11']) assert.throws(() => receiptDay(date, '日期', new Date('2026-09-10T10:00:00Z')));
  assert.equal(receiptDay('2026-09-11', '日期', new Date('2026-09-10T16:00:00Z')).toISOString(), '2026-09-11T00:00:00.000Z');
});

test('permissions require dedicated page and action together, never legacy task receive', async () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PurchaseReceiptsController.prototype.list), ['page:purchase-order-detail']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PurchaseReceiptsController.prototype.receive), ['proc-purchase-order:receive']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PurchaseReceiptsController.prototype.inspect), ['proc-purchase-order:inspect']);
  for (const permissions of [[], ['proc-purchase-order:receive'], ['page:purchase-order-detail'], ['page:purchase-order-detail', 'proc-task:receive']]) {
    const f = fixture(); await assert.rejects(f.service.receive('line-1', receiptInput, { ...actor, permissions }), /权限/); assert.equal(f.locks.length, 0);
  }
  for (const permissions of [[], ['proc-purchase-order:inspect'], ['page:purchase-order-detail', 'proc-quality:manage']]) {
    await assert.rejects(fixture().service.inspect('line-1', 'receipt-1', inspectionInput, { ...actor, permissions }), /权限/);
  }
  await assert.rejects(fixture().service.list('line-1', { ...actor, permissions: ['page:purchase-orders'] }), /权限/);
  const f = fixture(); assert.equal((await f.service.receive('line-1', receiptInput, { ...actor, permissions: ['*'] })).receipts.length, 1);
});

test('read exposes no prices, metadata, request fingerprint or actor identifiers', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  const result = await f.service.list('line-1', { ...actor, permissions: ['page:purchase-order-detail'] });
  assert.equal(result.canReceive, false); assert.equal(result.canInspect, false);
  assert.equal(result.line.erpReceivedQty, 18);
  for (const key of ['unitPrice', 'metadata', 'requestFingerprint', 'requestId', 'createdById']) assert.ok(!JSON.stringify(result).includes(`"${key}"`));
  await assert.rejects(f.service.list('other-line', actor), /不存在/);
});

test('receipt snapshots exact ERP identity and keeps ERP count untouched; local limit does not subtract ERP', async () => {
  const f = fixture();
  const result = await f.service.receive('line-1', receiptInput, actor);
  assert.equal(result.summary.receivedQty, 10); assert.equal(result.summary.pendingQty, 10);
  assert.equal(result.line.erpReceivedQty, 18); assert.equal(f.line.receivedQty.toNumber(), 18);
  assert.equal(f.receipts()[0].sourceOrderId, 'erp-1'); assert.equal(f.receipts()[0].sourceInventoryCode, 'SKU-1');
  assert.equal(f.receipts()[0].sourceUnit, '件'); assert.equal(f.receipts()[0].sourceUpdatedAt.toISOString(), sourceTime.toISOString());
  assert.equal(f.receipts()[0].sourceOrderedQty.toNumber(), 20);
  assert.equal(result.summaryUnit, '件'); assert.equal(result.receipts[0].source.orderedQty, 20);
  assert.deepEqual(f.locks[0], ['erp-po-write:PO-1']);
  assert.deepEqual(f.locks[2], ['line-1']); assert.equal(f.audits().length, 1);
  assert.equal(f.audits()[0].userId, actor.id);
});

test('same request and actor is idempotent even after source timestamp changes, different payload or actor conflicts', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  f.line.updatedAt = new Date('2026-09-10T02:00:00Z');
  assert.equal((await f.service.receive('line-1', receiptInput, actor)).receipts.length, 1);
  await assert.rejects(f.service.receive('line-1', { ...receiptInput, receivedQty: 9 }, actor), /提交标识/);
  await assert.rejects(f.service.receive('line-1', receiptInput, { ...actor, id: 'other-actor' }), /提交标识/);
  assert.equal(f.audits().length, 1);
});

test('same line and trimmed delivery number cannot create duplicate receipt with another request', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  await assert.rejects(f.service.receive('line-1', { ...receiptInput, deliveryNo: ' DELIVERY-001 ', requestId: 'qa-receipt-request-0002' }, actor), /此送货单/);
  assert.equal(f.receipts().length, 1);
});

test('source optimistic version and cumulative local receipt limit reject without writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.receive('line-1', { ...receiptInput, expectedSourceUpdatedAt: '2026-09-09T00:00:00.000Z' }, actor), /重新载入/);
  await f.service.receive('line-1', receiptInput, actor);
  await assert.rejects(f.service.receive('line-1', { ...receiptInput, requestId: 'qa-receipt-request-0002', deliveryNo: 'DELIVERY-002', receivedQty: 10.001 }, actor), /不能超过净订购/);
  assert.equal(f.receipts().length, 1); assert.equal(f.audits().length, 1);
});

test('simultaneous receipts on one line serialize and cannot oversubscribe the order', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.receive('line-1', { ...receiptInput, receivedQty: 11 }, actor),
    f.service.receive('line-1', { ...receiptInput, requestId: 'qa-receipt-request-0002', deliveryNo: 'DELIVERY-002', receivedQty: 11 }, actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.receipts().length, 1);
});

test('incomplete identity and invalid order quantity block new receipt and actions', async () => {
  for (const field of ['tpOrderId', 'tpOrderNo', 'tpLineNo', 'inventoryCode', 'unit'] as const) {
    const f = fixture(); f.line[field] = '  ';
    const result = await f.service.list('line-1', actor); assert.equal(result.canReceive, false); assert.equal(result.canInspect, false);
    await assert.rejects(f.service.receive('line-1', receiptInput, actor), /不完整/);
  }
  const f = fixture(); f.line.orderedQty = decimal(0); await assert.rejects(f.service.receive('line-1', receiptInput, actor), /订单数量无效/);
});

test('material, unit, supplier, spec or ERP identity changes preserve history and block later writes', async () => {
  for (const field of ['tpOrderId', 'tpOrderNo', 'tpLineNo', 'inventoryCode', 'unit', 'inventoryName', 'spec', 'supplierName'] as const) {
    const f = fixture(); await f.service.receive('line-1', receiptInput, actor); f.line[field] += '-changed';
    const result = await f.service.list('line-1', actor); assert.equal(result.receipts[0].sourceChanged, true); assert.ok(result.sourceIssue);
    assert.equal(result.receipts[0].source.unit, '件'); assert.equal(result.summaryUnit, '件');
    await assert.rejects(f.service.receive('line-1', { ...receiptInput, requestId: 'qa-receipt-request-0002', deliveryNo: 'DELIVERY-002' }, actor), /不一致/);
    await assert.rejects(f.service.inspect('line-1', 'receipt-1', inspectionInput, actor), /不一致/);
    assert.equal(f.inspections().length, 0);
  }
});

test('order quantity reduced below previous receipt total blocks mutations without losing ledger', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor); f.line.orderedQty = decimal(9);
  const result = await f.service.list('line-1', actor); assert.equal(result.summary.receivedQty, 10); assert.match(result.sourceIssue!, /小于已登记/);
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', inspectionInput, actor), /小于已登记/);
});

test('inspection partitions good, bad, pending judgment and uninspected quantities', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  const result = await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
  assert.deepEqual(result.summary, { receivedQty: 10, qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1 });
  assert.equal(result.receipts[0].version, 1); assert.equal(result.receipts[0].inspections.length, 1);
  assert.equal(f.line.receivedQty.toNumber(), 18); assert.equal(f.receipts()[0].receivedQty.toNumber(), 10); assert.equal(f.audits().length, 2);
});

test('inspection revision is cumulative, keeps immutable history and supports pending judgment resolution', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor); await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
  const result = await f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, requestId: 'qa-inspection-request-0002', expectedVersion: 1, qualifiedQty: 9, defectiveQty: 1, pendingJudgmentQty: 0, note: '复核两件合格，剩余一件检验合格' }, actor);
  assert.equal(result.summary.qualifiedQty, 9); assert.equal(result.summary.pendingQty, 0); assert.equal(result.summary.pendingJudgmentQty, 0);
  assert.equal(result.receipts[0].inspections.length, 2); assert.equal(result.receipts[0].inspections[1].qualifiedQty, 6);
  assert.equal(result.receipts[0].version, 2);
});

test('inspection quantities are bounded by batch, not order; dates and required evidence are strict', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  for (const changed of [{ qualifiedQty: 11, defectiveQty: 0, pendingJudgmentQty: 0 }, { qualifiedQty: 7, defectiveQty: 2, pendingJudgmentQty: 2 }, { inspectionDate: '2026-08-31' }, { basis: ' ' }, { note: ' ' }]) {
    await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, ...changed }, actor));
  }
  assert.equal(f.inspections().length, 0); assert.equal(f.receipts()[0].version, 0);
});

test('inspection identity, current version and source timestamp are required; unknown receipt is private', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  await assert.rejects(f.service.inspect('line-1', 'other-receipt', inspectionInput, actor), /不存在/);
  await assert.rejects(f.service.inspect('other-line', 'receipt-1', inspectionInput, actor), /不存在/);
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, expectedVersion: 1 }, actor), /重新载入/);
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, expectedSourceUpdatedAt: '2026-09-09T00:00:00.000Z' }, actor), /重新载入/);
  assert.equal(f.inspections().length, 0);
});

test('duplicate inspection delivery is idempotent and concurrent competing revisions conflict', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  const same = await Promise.all([f.service.inspect('line-1', 'receipt-1', inspectionInput, actor), f.service.inspect('line-1', 'receipt-1', inspectionInput, actor)]);
  assert.equal(same[0].receipts[0].version, 1); assert.equal(same[1].receipts[0].version, 1); assert.equal(f.inspections().length, 1);
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, qualifiedQty: 5 }, actor), /提交标识/);
  const results = await Promise.allSettled([
    f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, expectedVersion: 1, requestId: 'qa-inspection-request-0002' }, actor),
    f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, expectedVersion: 1, requestId: 'qa-inspection-request-0003' }, actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1); assert.equal(f.inspections().length, 2);
});

test('receipt audit failure atomically rolls back the record', async () => {
  const f = fixture(); f.failAudit(); await assert.rejects(f.service.receive('line-1', receiptInput, actor), /audit/);
  assert.equal(f.receipts().length, 0); assert.equal(f.audits().length, 0);
});

test('inspection audit failure atomically rolls back both revision and parent version', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor); f.failAudit();
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', inspectionInput, actor), /audit/);
  assert.equal(f.inspections().length, 0); assert.equal(f.receipts()[0].version, 0); assert.equal(f.audits().length, 1);
});

test('不良自动关联同一收货，重复提交不重复建异常，归属必选', async () => {
 const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
 await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...inspectionInput, treeNodeId: undefined }, actor), /所属产品/);
 assert.equal(f.inspections().length, 0);
 await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
 await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
 assert.equal(f.qualities().length, 1); assert.equal(f.qualities()[0].defectiveQty.toNumber(), 1);
 assert.equal(JSON.parse(f.states().get('procurement:receipt-quality:v1:receipt-1')!.value).qualityId, f.qualities()[0].id);
});

for (const status of ['processing', 'closed']) {
  test(`HA-01：异常${status}后补判合格保留原异常初检范围与检验历史`, async () => {
    const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
    await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
    Object.assign(f.qualities()[0], { status, disposition: 'rework', resolution: '原不良单独返工' });
    const originalQuality = { ...f.qualities()[0] };
    const classify = { ...inspectionInput, requestId: `ha01-classify-${status}`, expectedVersion: 1, qualifiedQty: 8, pendingJudgmentQty: 0 };
    const result = await f.service.inspect('line-1', 'receipt-1', classify, actor);
    assert.deepEqual(result.summary, { receivedQty: 10, qualifiedQty: 8, defectiveQty: 1, pendingJudgmentQty: 0, pendingQty: 1 });
    assert.equal(result.receipts[0].version, 2);
    assert.equal(result.receipts[0].inspections[1].qualifiedQty, 6);
    assert.deepEqual(f.qualities(), [originalQuality]);
    await f.service.inspect('line-1', 'receipt-1', classify, actor);
    assert.equal(f.inspections().length, 2); assert.equal(f.audits().length, 3);
    for (const [index, changed] of [{ qualifiedQty: 7 }, { qualifiedQty: 6 }, { defectiveQty: 0 }, { defectiveQty: 2 }].entries()) {
      await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...classify, ...changed, expectedVersion: 2, requestId: `ha01-reject-${status}-${index}` }, actor), /不可覆盖原初检范围/);
      assert.equal(f.receipts()[0].version, 2); assert.equal(f.inspections().length, 2);
      assert.deepEqual(f.qualities(), [originalQuality]);
    }
    const completed = await f.service.inspect('line-1', 'receipt-1', { ...classify, expectedVersion: 2, requestId: `ha01-finish-${status}`, qualifiedQty: 9 }, actor);
    assert.equal(completed.summary.pendingQty, 0); assert.deepEqual(f.qualities(), [originalQuality]);
  });
}

test('HA-01：已入库补判同步库存桶、保留核对历史；审计失败整体回滚', async () => {
  const f = fixture(); await f.service.receive('line-1', receiptInput, actor);
  await f.service.inspect('line-1', 'receipt-1', inspectionInput, actor);
  f.qualities()[0].status = 'processing';
  const linkKey = 'procurement:warehouse-record:v1:receipt:receipt-1';
  const recordKey = 'procurement:warehouse-record:v1:record:warehouse-1';
  const reconciliation = { voucher: 'ERP-001', quantity: 10 };
  f.states().set(linkKey, { key: linkKey, value: 'warehouse-1' });
  f.states().set(recordKey, { key: recordKey, value: JSON.stringify({ version: 1, qualifiedQty: 6, defectiveQty: 1, pendingQty: 3, reconciliation, events: [] }) });
  const classify = { ...inspectionInput, requestId: 'ha01-warehouse-classify', expectedVersion: 1, qualifiedQty: 8, pendingJudgmentQty: 0 };
  await f.service.inspect('line-1', 'receipt-1', classify, actor);
  const saved = f.states().get(recordKey)!.value;
  const record = JSON.parse(saved);
  assert.equal(record.version, 2); assert.equal(record.qualifiedQty, 8); assert.equal(record.defectiveQty, 1); assert.equal(record.pendingQty, 1);
  assert.equal(record.reconciliation, undefined); assert.deepEqual(record.events[0].before.reconciliation, reconciliation);
  assert.equal(record.events[0].inspectionId, f.inspections()[1].id);
  assert.equal(f.qualities()[0].inspectedQty.toNumber(), 7);
  await f.service.inspect('line-1', 'receipt-1', classify, actor);
  assert.equal(f.states().get(recordKey)!.value, saved);
  f.failAudit();
  await assert.rejects(f.service.inspect('line-1', 'receipt-1', { ...classify, requestId: 'ha01-warehouse-rollback', expectedVersion: 2, qualifiedQty: 9 }, actor), /audit/);
  assert.equal(f.states().get(recordKey)!.value, saved);
  assert.equal(f.receipts()[0].version, 2); assert.equal(f.inspections().length, 2);
});
