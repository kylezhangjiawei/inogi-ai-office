import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { SavePurchaseOrderAvailabilityDto } from '../src/modules/procurement/dto/purchase-order-availability.dto';
import { purchaseOrderAvailabilityView, purchaseOrderSourceFingerprint, validatePurchaseOrderAvailability } from '../src/modules/procurement/purchase-order-availability';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
import { TplusSyncController } from '../src/modules/procurement/tplus-sync.controller';
import { TplusSyncService } from '../src/modules/procurement/tplus-sync.service';

const sourceTime = new Date('2026-09-10T01:00:00.000Z');
const actor = { id: 'user-1', name: '采购甲', permissions: ['page:purchase-order-detail', 'proc-purchase-order:confirm-availability'] };
const input: SavePurchaseOrderAvailabilityDto = { availableDate: '2026-09-15', note: '供应商已确认，预计检验一天', expectedVersion: 0, expectedSourceUpdatedAt: sourceTime.toISOString() };
const makeLine = () => ({
  id: 'mirror-1', tpOrderNo: 'PO-1', tpOrderId: 'erp-1', tpLineNo: '2', inventoryCode: 'A01', inventoryName: '壳体',
  spec: '白色', unit: '件', orderedQty: 100, receivedQty: 20, unitPrice: 12, supplierName: '供应商甲',
  etaDate: new Date('2026-09-14T00:00:00.000Z'), orderDate: new Date('2026-09-01T00:00:00.000Z'),
  status: 'audited', approvalStatus: '已审核', updatedAt: sourceTime, syncedAt: sourceTime,
});
type Row = Record<string, any>;
function fixture() {
  const line = makeLine();
  let annotation: Row | null = null;
  const audits: Row[] = [];
  const locks: unknown[][] = [];
  let failAudit = false;
  let tail = Promise.resolve();
  const joined = () => ({ ...line, availability: annotation && structuredClone(annotation) });
  const prisma = {
    procPurchaseOrderMirror: {
      findFirst: async ({ where }: Row) => where.id === line.id && where.tpOrderNo === line.tpOrderNo ? joined() : null,
      findMany: async () => [joined()],
    },
    procPurchaseOrderAvailability: {
      create: async ({ data }: Row) => { assert.equal(annotation, null); annotation = { id: 'availability-1', ...data }; return structuredClone(annotation); },
      updateMany: async ({ where, data }: Row) => {
        if (!annotation || where.mirrorId !== annotation.mirrorId || where.version !== annotation.version) return { count: 0 };
        Object.assign(annotation, data); return { count: 1 };
      },
      findUniqueOrThrow: async () => structuredClone(annotation),
    },
    procSupplier: { findFirst: async () => null },
    procPurchaseOrderRef: { findMany: async () => [] },
    auditLog: { create: async ({ data }: Row) => { if (failAudit) throw new Error('audit unavailable'); audits.push(data); return data; } },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { locks.push(values); return []; },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(annotation);
      const auditLength = audits.length;
      try { return await run(prisma); } catch (error) { annotation = before; audits.length = auditLength; throw error; } finally { release(); }
    },
  };
  return { service: new TplusOperationsService(prisma as never), line, audits, locks, prisma,
    annotation: () => annotation, failAudit: () => { failAudit = true; } };
}

test('HTTP DTO requires all version/date fields and rejects oversized notes', async () => {
  assert.equal((await validate(Object.assign(new SavePurchaseOrderAvailabilityDto(), input))).length, 0);
  for (const changed of [{ availableDate: undefined }, { expectedVersion: '0' }, { expectedSourceUpdatedAt: 'yesterday' }, { note: 'x'.repeat(1001) }]) {
    assert.ok((await validate(Object.assign(new SavePurchaseOrderAvailabilityDto(), input, changed))).length > 0);
  }
});

test('strict date validation rejects invalid calendar days and keeps valid leap days', () => {
  assert.equal(validatePurchaseOrderAvailability({ ...input, availableDate: '2028-02-29' }).availableDate!.toISOString(), '2028-02-29T00:00:00.000Z');
  for (const availableDate of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-10', '0000-01-01', '', '2026-09-15T00:00:00Z', undefined, 0]) {
    assert.throws(() => validatePurchaseOrderAvailability({ ...input, availableDate } as never));
  }
  for (const changed of [{ note: null }, { note: 'x'.repeat(1001) }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: '0' }, { expectedSourceUpdatedAt: '2026-02-30T00:00:00.000Z' }]) {
    assert.throws(() => validatePurchaseOrderAvailability({ ...input, ...changed } as never));
  }
});

test('save requires both page and dedicated action permission; wildcard is accepted', async () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, TplusSyncController.prototype.savePurchaseOrderAvailability), ['proc-purchase-order:confirm-availability']);
  for (const permissions of [[], ['page:purchase-order-detail'], ['proc-purchase-order:confirm-availability'], ['proc-task:order']]) {
    const f = fixture();
    await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, { ...actor, permissions }), /没有确认/);
    assert.equal(f.locks.length, 0);
  }
  const f = fixture();
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, { ...actor, permissions: ['*'] });
  assert.equal(f.annotation()?.version, 1);
});

test('first confirmation exposes stable line identity, preserves ERP values, and writes actor audit atomically', async () => {
  const f = fixture();
  const source = structuredClone(f.line);
  const saved = await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
  assert.equal(saved.lineId, 'mirror-1');
  assert.equal(saved.sourceUpdatedAt, sourceTime.toISOString());
  assert.equal(saved.availability.availableDate, '2026-09-15');
  assert.equal(saved.availability.version, 1);
  assert.equal(saved.availability.needsReconfirmation, false);
  assert.deepEqual(f.line, source);
  assert.deepEqual(f.locks[0], ['erp-po-write:PO-1']);
  assert.deepEqual(f.locks[2], ['mirror-1', 'PO-1']);
  assert.equal(f.audits.length, 1);
  assert.equal(f.audits[0].userId, actor.id);
  assert.equal(f.audits[0].actorName, actor.name);
  assert.deepEqual(f.audits[0].meta.changes[0], { field: 'availableDate', before: null, after: '2026-09-15' });
  const result = await f.service.getPurchaseOrder('PO-1');
  assert.equal(result.order.items[0].id, 'mirror-1');
  assert.equal(result.order.items[0].lineNo, '2');
  assert.equal(result.order.items[0].etaDate, '2026-09-14');
  assert.deepEqual(result.order.items[0].availability, saved.availability);
});

test('line from another order and unknown line give the same not-found result without writes', async () => {
  for (const [orderNo, lineId] of [['PO-other', 'mirror-1'], ['PO-1', 'missing']]) {
    const f = fixture();
    await assert.rejects(f.service.savePurchaseOrderAvailability(orderNo, lineId, input, actor), /采购订单行不存在/);
    assert.equal(f.annotation(), null);
    assert.equal(f.audits.length, 0);
  }
});

test('available day cannot precede known ERP ETA, but is accepted on the same calendar day', async () => {
  const f = fixture();
  await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, availableDate: '2026-09-13' }, actor), /不能早于/);
  f.line.etaDate = new Date('2026-09-14T18:30:00.000Z');
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, availableDate: '2026-09-14' }, actor);
  assert.equal(f.annotation()?.version, 1);
});

test('source or local version conflict requires reload and cannot overwrite an existing confirmation', async () => {
  const f = fixture();
  await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, expectedSourceUpdatedAt: '2026-09-10T00:00:00.000Z' }, actor), /重新载入/);
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
  await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor), /重新载入/);
  assert.equal(f.annotation()?.version, 1);
  assert.equal(f.audits.length, 1);
});

test('two submissions based on the same version produce one confirmation and one conflict', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor),
    f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(f.audits.length, 1);
});

test('clear requires a reason and keeps version, actor, and previous date in audit', async () => {
  const f = fixture();
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
  await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, availableDate: null, note: '  ', expectedVersion: 1 }, actor), /清空.*原因/);
  const cleared = await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, availableDate: null, note: '供应商重新排产', expectedVersion: 1 }, actor);
  assert.equal(cleared.availability.availableDate, null);
  assert.equal(cleared.availability.version, 2);
  assert.equal(cleared.availability.needsReconfirmation, false);
  assert.deepEqual(f.audits[1].meta.changes[0], { field: 'availableDate', before: '2026-09-15', after: null });
});

test('source changes make a stored date pending reconfirmation while timestamp-only sync does not', async () => {
  const f = fixture();
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
  const saved = f.annotation()!;
  const fingerprint = purchaseOrderSourceFingerprint(f.line);
  f.line.updatedAt = new Date('2026-09-10T02:00:00.000Z');
  f.line.syncedAt = f.line.updatedAt;
  assert.equal(purchaseOrderSourceFingerprint(f.line), fingerprint);
  assert.equal(purchaseOrderAvailabilityView(saved as never, f.line)?.needsReconfirmation, false);
  for (const changed of [
    { tpOrderId: 'erp-recreated' }, { inventoryCode: 'A02' }, { unit: '箱' }, { orderedQty: 101 }, { receivedQty: 21 },
    { etaDate: new Date('2026-09-15T00:00:00.000Z') }, { status: 'cancelled' }, { approvalStatus: '未审核' }, { supplierName: '供应商乙' },
  ]) {
    assert.equal(purchaseOrderAvailabilityView(saved as never, { ...f.line, ...changed })?.needsReconfirmation, true);
  }
  f.line.receivedQty = 21;
  const fresh = await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, expectedVersion: 1, expectedSourceUpdatedAt: f.line.updatedAt.toISOString() }, actor);
  assert.equal(fresh.availability.needsReconfirmation, false);
  assert.equal(fresh.availability.version, 2);
});

test('audit failure rolls back both first creation and existing-date changes', async () => {
  for (const existing of [false, true]) {
    const f = fixture();
    if (existing) await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
    const before = structuredClone(f.annotation());
    f.failAudit();
    await assert.rejects(f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', { ...input, expectedVersion: existing ? 1 : 0, availableDate: '2026-09-16' }, actor), /audit unavailable/);
    assert.deepEqual(f.annotation(), before);
    assert.equal(f.audits.length, existing ? 1 : 0);
  }
});

test('real ERP mirror sync updates only ERP fields and preserves the separate confirmation', async () => {
  const f = fixture();
  await f.service.savePurchaseOrderAvailability('PO-1', 'mirror-1', input, actor);
  const before = structuredClone(f.annotation());
  const updates: Row[] = [];
  const states = new Map<string, Row>();
  const prisma = {
    procMaterial: { findUnique: async () => ({ id: 'material-1' }) },
    procPurchaseOrderMirror: {
      findUnique: async () => ({ ...f.line }),
      upsert: async ({ update }: Row) => { updates.push(update); Object.assign(f.line, update); return { ...f.line }; },
    },
    runtimeState: {
      findUnique: async ({ where }: Row) => states.get(where.key) ?? null,
      create: async ({ data }: Row) => { states.set(data.key, data); return data; },
      upsert: async ({ where, create, update }: Row) => { const row = { ...(states.get(where.key) ?? create), ...update }; states.set(where.key, row); return row; },
    },
    auditLog: { create: async ({ data }: Row) => data },
    $queryRaw: async () => [],
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  const sync = new TplusSyncService(prisma as never, {} as never, {} as never, {} as never);
  (sync as any).fetchOrderCodes = async () => ['PO-1'];
  (sync as any).syncPurchaseOrders = async () => ({});
  let erpOrderId = 'erp-1';
  (sync as any).fetchFromTplus = async () => ({
    ID: erpOrderId, Code: 'PO-1', Partner: '供应商甲', VoucherDate: '2026-09-01', VoucherState: { Name: '已审核', Code: 'audited' },
    PurchaseOrderDetails: [{ RowNo: 2, Inventory: { Code: 'A01', Name: '壳体', Specification: '白色' }, Unit: '件', Quantity: 100, CountQuantity: 20, AcceptDate: '2026-09-14' }],
  });
  await sync.syncPurchaseOrderMirror();
  assert.equal(updates.length, 1);
  assert.equal('availability' in updates[0], false);
  assert.equal('availableDate' in updates[0], false);
  assert.deepEqual(f.annotation(), before);
  assert.equal(purchaseOrderAvailabilityView(f.annotation() as never, f.line)?.needsReconfirmation, false);
  erpOrderId = 'erp-recreated';
  await sync.syncPurchaseOrderMirror();
  assert.deepEqual(f.annotation(), before, 'same-number ERP replacement preserves the history');
  assert.equal(purchaseOrderAvailabilityView(f.annotation() as never, f.line)?.needsReconfirmation, true,
    'a recreated ERP order with the same number, line and visible quantities cannot reuse the old confirmation');
});
