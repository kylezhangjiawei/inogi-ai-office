import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
import { TplusSyncController } from '../src/modules/procurement/tplus-sync.controller';

type Row = Record<string, any>;
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const sourceTime = day('2026-09-10');
const makeLine = (extra: Row = {}): Row => ({
  id: 'mirror-1', tpOrderNo: 'PO-1', tpOrderId: 'erp-1', tpLineNo: '1',
  inventoryCode: 'A/B', inventoryName: '物料 A', spec: '规格 A', unit: '件',
  orderedQty: new Prisma.Decimal('10.125'), receivedQty: new Prisma.Decimal('2.25'),
  orderDate: day('2026-09-10'), etaDate: day('2026-09-14'), supplierName: '供应商甲',
  approvalStatus: '已审核', status: 'erp-raw-status', syncedAt: sourceTime,
  availability: null, ...extra,
});
function fixture(rows: Row[] = []) {
  const calls: Array<{ operation: string; args: Row }> = [];
  let options: unknown;
  let failure: Error | undefined;
  const prisma = {
    procPurchaseOrderMirror: {
      count: async (args: Row) => {
        calls.push({ operation: 'count', args });
        if (failure) throw failure;
        return rows.filter((row) => row.inventoryCode === args.where.inventoryCode).length;
      },
      findMany: async (args: Row) => {
        calls.push({ operation: 'findMany', args });
        return rows.filter((row) => row.inventoryCode === args.where.inventoryCode).sort((a, b) => {
          const dates = (b.orderDate?.getTime() ?? -Infinity) - (a.orderDate?.getTime() ?? -Infinity);
          if (dates && !Number.isNaN(dates)) return dates;
          for (const key of ['tpOrderNo', 'tpLineNo', 'id']) {
            const result = a[key].localeCompare(b[key]);
            if (result) return result;
          }
          return 0;
        }).slice(args.skip, args.skip + args.take);
      },
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>, transactionOptions: unknown) => {
      options = transactionOptions;
      return run(prisma);
    },
  };
  return { service: new TplusOperationsService(prisma as never), calls, options: () => options, fail: (error: Error) => { failure = error; } };
}

test('requires a valid exact code and rejects arrays, controls and oversized codes before querying', async () => {
  const f = fixture();
  for (const inventoryCode of [undefined, null, [], ['A'], {}, 123, '', '  ', 'A\n', 'A\tB', 'A\u0000B', 'A\u007fB', 'x'.repeat(129)]) {
    await assert.rejects(f.service.listPurchaseOrderLines({ inventoryCode }), /存货编码/);
  }
  assert.equal(f.calls.length, 0);
});

test('slash-containing codes use exact DB equality; prefixes, case variants and encoded literals are not aliases', async () => {
  const f = fixture([
    makeLine(), makeLine({ id: 'prefix', inventoryCode: 'A/B-extra' }),
    makeLine({ id: 'lower', inventoryCode: 'a/b' }), makeLine({ id: 'encoded', inventoryCode: 'A%2FB' }),
  ]);
  const result = await f.service.listPurchaseOrderLines({ inventoryCode: ' A/B ' });
  assert.equal(result.inventoryCode, 'A/B');
  assert.deepEqual(result.lines.items.map((row) => row.id), ['mirror-1']);
  for (const call of f.calls) assert.deepEqual(call.args.where, { inventoryCode: 'A/B' });
  const encoded = await f.service.listPurchaseOrderLines({ inventoryCode: 'A%2FB' });
  assert.deepEqual(encoded.lines.items.map((row) => row.id), ['encoded']);
});

test('exact matching permits Chinese and literal punctuation without interpreting SQL wildcards', async () => {
  for (const inventoryCode of ['部件/白色', 'A_%', 'A+B', "A'B"]) {
    const f = fixture([makeLine({ inventoryCode }), makeLine({ id: 'other', inventoryCode: 'other' })]);
    const result = await f.service.listPurchaseOrderLines({ inventoryCode });
    assert.equal(result.lines.total, 1);
    assert.deepEqual(f.calls[1].args.where, { inventoryCode });
  }
});

test('uses a stable database sort with null dates last and a bounded page in one read snapshot', async () => {
  const rows = [
    makeLine({ id: 'z-null', orderDate: null }),
    makeLine({ id: 'same-z', tpOrderNo: 'PO-A', tpLineNo: '2' }),
    makeLine({ id: 'same-a', tpOrderNo: 'PO-A', tpLineNo: '2' }),
    makeLine({ id: 'line-1', tpOrderNo: 'PO-A', tpLineNo: '1' }),
    makeLine({ id: 'older', orderDate: day('2026-09-09') }),
  ];
  const f = fixture(rows);
  const result = await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B', page: '2', pageSize: '2' });
  assert.deepEqual(result.lines.items.map((row) => row.id), ['same-z', 'older']);
  assert.deepEqual({ page: result.lines.page, pageSize: result.lines.pageSize, total: result.lines.total, totalPages: result.lines.totalPages }, { page: 2, pageSize: 2, total: 5, totalPages: 3 });
  assert.deepEqual(f.options(), { isolationLevel: 'RepeatableRead' });
  assert.deepEqual(f.calls[1].args.orderBy, [{ orderDate: { sort: 'desc', nulls: 'last' } }, { tpOrderNo: 'asc' }, { tpLineNo: 'asc' }, { id: 'asc' }]);
  assert.equal(f.calls[1].args.skip, 2);
  assert.equal(f.calls[1].args.take, 2);
  assert.equal(f.calls[1].args.select.tpOrderId, true, 'ERP identity is needed to detect recreated orders');
  assert.equal(f.calls[1].args.select.availability, true);
  assert.equal(f.calls[1].args.select.unitPrice, undefined, 'material-date lookup does not request prices');
});

test('defaults to ten rows, caps page size at fifty, and clamps an out-of-range page', async () => {
  const f = fixture(Array.from({ length: 53 }, (_, index) => makeLine({ id: String(index).padStart(3, '0') })));
  const defaults = await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B' });
  assert.equal(defaults.lines.pageSize, 10);
  assert.equal(defaults.lines.items.length, 10);
  const capped = await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B', page: 999, pageSize: 500 });
  assert.equal(capped.lines.pageSize, 50);
  assert.equal(capped.lines.page, 2);
  assert.equal(capped.lines.items.length, 3);
});

test('invalid pagination is rejected rather than accidentally reading all matching rows', async () => {
  for (const key of ['page', 'pageSize']) {
    const f = fixture();
    for (const value of ['', '0', 0, '-1', 1.5, '1.5', '1e2', ' 1 ', '01', null, [], ['1'], Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(f.service.listPurchaseOrderLines({ inventoryCode: 'A/B', [key]: value }), /正整数/);
    }
    assert.equal(f.calls.length, 0);
  }
});

test('an empty exact-code result is an explicit empty page, not a lookup of similar material names', async () => {
  const f = fixture([makeLine({ inventoryCode: 'other', inventoryName: 'A/B' })]);
  const result = await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B', page: 20 });
  assert.deepEqual(result, { inventoryCode: 'A/B', source: 'tplus', readOnly: true, lines: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 } });
});

test('preserves completed and cancelled history, raw states, decimals and absent dates without computing remaining supply', async () => {
  const f = fixture([
    makeLine({ id: 'cancelled', status: 'ERP_CANCEL_99', approvalStatus: '作废', etaDate: null, orderDate: null, syncedAt: null }),
    makeLine({ id: 'complete', receivedQty: new Prisma.Decimal('10.125'), status: 'ERP_DONE_7' }),
  ]);
  const result = await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B' });
  assert.equal(result.lines.total, 2);
  const cancelled = result.lines.items.find((row) => row.id === 'cancelled')!;
  assert.equal(cancelled.status, 'ERP_CANCEL_99');
  assert.equal(cancelled.approvalStatus, '作废');
  assert.equal(cancelled.orderedQty, 10.125);
  assert.equal(cancelled.receivedQty, 2.25);
  assert.equal(cancelled.etaDate, null);
  assert.equal(cancelled.orderDate, null);
  assert.equal(cancelled.syncedAt, null);
  assert.equal(cancelled.availability, null);
  assert.equal('remainingQty' in cancelled, false);
  assert.equal(result.lines.items[0].status, 'ERP_DONE_7');
});

test('reuses availability identity checks and does not expose internal fingerprint or confirmer ID', async () => {
  const line = makeLine();
  line.availability = {
    id: 'confirmation-1', mirrorId: line.id, availableDate: day('2026-09-15'), note: '预计检验一天',
    confirmedById: 'private-user-id', confirmedByName: '采购甲', confirmedAt: sourceTime,
    sourceFingerprint: purchaseOrderSourceFingerprint(line as never), version: 3,
  };
  const f = fixture([line]);
  const current = (await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B' })).lines.items[0];
  assert.deepEqual(current.availability, { availableDate: '2026-09-15', note: '预计检验一天', confirmedByName: '采购甲', confirmedAt: sourceTime.toISOString(), version: 3, needsReconfirmation: false });
  line.tpOrderId = 'recreated-erp-order';
  const changed = (await f.service.listPurchaseOrderLines({ inventoryCode: 'A/B' })).lines.items[0];
  assert.equal(changed.availability?.needsReconfirmation, true);
  assert.equal('sourceFingerprint' in changed.availability!, false);
  assert.equal('confirmedById' in changed.availability!, false);
});

test('database failures remain failures so the UI can offer retry rather than claiming no orders', async () => {
  const f = fixture();
  f.fail(new Error('database unavailable'));
  await assert.rejects(f.service.listPurchaseOrderLines({ inventoryCode: 'A/B' }), /database unavailable/);
  assert.equal(f.calls.length, 1);
});

test('read endpoint accepts either existing order-read permission and grants no access from readiness or write permission alone', () => {
  const handler = TplusSyncController.prototype.purchaseOrderLinesView;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'views/purchase-order-lines');
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), ['page:purchase-orders', 'page:purchase-order-detail']);
  const guard = new RolesGuard(new Reflector());
  const canRead = (permissions: string[]) => guard.canActivate({
    getHandler: () => handler, getClass: () => TplusSyncController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as never);
  for (const permissions of [['page:purchase-orders'], ['page:purchase-order-detail'], ['*']]) assert.equal(canRead(permissions), true);
  for (const permissions of [[], ['page:proc-inventory-readiness'], ['proc-purchase-order:confirm-availability']]) assert.equal(canRead(permissions), false);
});

test('purchase-order controller preserves already-decoded ERP identities containing literal percent escapes', async () => {
  for (const orderNo of ['PO%2F001', 'PO%20001', 'PO%broken', 'PO/001', 'PO 001']) {
    const lookedUp: string[] = [];
    const prisma = {
      procPurchaseOrderMirror: { findMany: async ({ where }: Row) => {
        lookedUp.push(where.tpOrderNo);
        return where.tpOrderNo === orderNo ? [makeLine({ tpOrderNo: orderNo, updatedAt: sourceTime })] : [];
      } },
      procSupplier: { findFirst: async () => null },
      procPurchaseOrderRef: { findMany: async ({ where }: Row) => { lookedUp.push(where.tpOrderNo); return []; } },
    };
    const service = new TplusOperationsService(prisma as never);
    const controller = new TplusSyncController({} as never, {} as never, service);
    // Express/Nest's path adapter has already performed this one transport decode.
    const receivedParam = decodeURIComponent(encodeURIComponent(orderNo));
    const result = await controller.purchaseOrderView(receivedParam);
    assert.equal(result.order.id, orderNo);
    assert.equal(result.order.poNo, orderNo);
    assert.deepEqual(lookedUp, [orderNo, orderNo]);
  }
});
