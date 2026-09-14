import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementController } from '../src/modules/procurement/procurement.controller';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { purchaseOrderSourceFingerprint } from '../src/modules/procurement/purchase-order-availability';
import type { WorkspaceArrivalDateItem } from '../src/modules/procurement/workspace-arrival-dates';

type Row = Record<string, any>;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const timestamp = day('2026-09-10');
const actor = { id: 'buyer-1', name: '采购甲', permissions: ['page:proc-my-workspace', 'page:purchase-order-detail'] };
const ref = (extra: Row = {}): Row => ({
  id: 'ref-1', taskId: 'task-1', tpOrderNo: 'PO%2F001', tpOrderId: 'erp-1', tpLineNo: '1', metadata: {},
  task: { buyerUserId: actor.id, buyer: actor.name, status: 'ordered', unit: '件', material: { tpInventoryCode: 'A/01' } }, ...extra,
});
const mirror = (extra: Row = {}): Row => ({
  id: 'line-1', tpOrderNo: 'PO%2F001', tpOrderId: 'erp-1', tpLineNo: '1', inventoryCode: 'A/01', inventoryName: '物料甲',
  spec: '规格甲', unit: '件', supplierName: '供应商甲', orderedQty: new Prisma.Decimal(100), receivedQty: new Prisma.Decimal(20),
  etaDate: day('2026-09-14'), syncedAt: timestamp, status: 'ERP_RAW_1', approvalStatus: '已审核', availability: null, ...extra,
});
function confirmed(line: Row, date: string | null = '2026-09-15'): Row {
  return { ...line, availability: {
    id: 'availability-1', mirrorId: line.id, availableDate: date && day(date), note: '人工确认',
    confirmedById: 'private-user-id', confirmedByName: '采购乙', confirmedAt: timestamp,
    sourceFingerprint: purchaseOrderSourceFingerprint(line as never), version: 2,
  } };
}
function fixture(refs: Row[] = [ref()], mirrors: Row[] = [mirror()]) {
  const reads: Array<{ operation: string; args: Row }> = [];
  let options: unknown;
  let fail: 'refs' | 'mirrors' | null = null;
  const prisma = {
    procPurchaseOrderRef: { findMany: async (args: Row) => {
      reads.push({ operation: 'refs', args });
      if (fail === 'refs') throw new Error('query failed on confidential-task-id');
      const scope = args.where.task.is;
      return refs.filter((entry) => args.where.id.in.includes(entry.id) && entry.task.status !== scope.status.not
        && scope.OR.some((owner: Row) => entry.task.buyerUserId === owner.buyerUserId && (!('buyer' in owner) || owner.buyer === entry.task.buyer)));
    } },
    procPurchaseOrderMirror: { findMany: async (args: Row) => {
      reads.push({ operation: 'mirrors', args });
      if (fail === 'mirrors') throw new Error('query failed on confidential-order-id');
      return mirrors.filter((entry) => args.where.OR.some((expected: Row) => ['tpOrderNo', 'tpOrderId', 'tpLineNo'].every((key) => expected[key] === entry[key])));
    } },
    $transaction: async (run: (tx: unknown) => Promise<unknown>, txOptions: unknown) => { options = txOptions; return run(prisma); },
  };
  return { service: new ProcurementService(prisma as never, {} as never, {} as never, {} as never), reads, options: () => options, fail: (operation: 'refs' | 'mirrors') => { fail = operation; } };
}
function line(item: WorkspaceArrivalDateItem) {
  assert.ok(item.kind === 'line');
  return item;
}

test('endpoint requires workspace plus a real order-read permission before any data lookup', async () => {
  const handler = ProcurementController.prototype.getWorkspaceArrivalDates;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'workspace-arrival-dates');
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), ['page:proc-my-workspace']);
  for (const permissions of [[], ['page:proc-my-workspace'], ['page:purchase-order-detail'], ['page:purchase-orders'], ['page:proc-cockpit', 'page:purchase-orders'], ['proc-task:create', 'page:purchase-order-detail'], ['page:proc-my-workspace', 'page:purchase-order-list']]) {
    const f = fixture();
    await assert.rejects(f.service.getWorkspaceArrivalDates('ref-1', { ...actor, permissions }), /查看权限/);
    assert.equal(f.reads.length, 0);
  }
  for (const permissions of [['*'], ['page:proc-my-workspace', 'page:purchase-orders'], actor.permissions]) {
    const f = fixture();
    const controller = new ProcurementController(f.service, {} as never, {} as never, {} as never);
    const result = await controller.getWorkspaceArrivalDates('ref-1', { user: { ...actor, permissions } });
    assert.equal(result.items[0].kind, 'line');
  }
  const f = fixture();
  await assert.rejects(f.service.getWorkspaceArrivalDates('ref-1', { ...actor, id: '', permissions: ['*'] }), /查看权限/);
  assert.equal(f.reads.length, 0);
});

test('ref query accepts a single ID or bounded array, deduplicates in request order, and rejects malformed input before reads', async () => {
  for (const invalid of [undefined, null, '', '  ', 1, {}, [], ['ref-1', 2], [['ref-1']], ['ref-1', null], 'a'.repeat(129), 'ref\n1', Array(51).fill('ref-1')]) {
    const f = fixture();
    await assert.rejects(f.service.getWorkspaceArrivalDates(invalid, actor), /1 至 50/);
    assert.equal(f.reads.length, 0);
  }
  const f = fixture([ref(), ref({ id: 'ref-2' })]);
  const result = await f.service.getWorkspaceArrivalDates(['ref-2', 'missing', 'ref-1', 'ref-2'], actor);
  assert.deepEqual(result.items.map((item) => item.refId), ['ref-2', 'missing', 'ref-1']);
  assert.deepEqual(f.reads[0].args.where.id, { in: ['ref-2', 'missing', 'ref-1'] });
});

test('all roles including wildcard are scoped to owned accounts and missing-account legacy name only', async () => {
  const task = ref().task;
  const refs = [
    ref({ id: 'account', task: { ...task, buyer: '已改名' } }),
    ref({ id: 'legacy-null', task: { ...task, buyerUserId: null } }),
    ref({ id: 'legacy-empty', task: { ...task, buyerUserId: '' } }),
    ref({ id: 'other-account-same-name', task: { ...task, buyerUserId: 'other-buyer' } }),
    ref({ id: 'other-name', task: { ...task, buyerUserId: null, buyer: '其他采购人' } }),
    ref({ id: 'review', task: { ...task, status: 'pending_rd_review' } }),
    ref({ id: 'legacy-review', task: { ...task, buyerUserId: null, status: 'pending_rd_review' } }),
  ];
  for (const permissions of [actor.permissions, ['*']]) {
    const f = fixture(refs);
    const result = await f.service.getWorkspaceArrivalDates([...refs.map((entry) => entry.id), 'missing'], { ...actor, name: ` ${actor.name} `, permissions });
    assert.deepEqual(result.items.map((item) => item.kind), ['line', 'line', 'line', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved']);
    const issues = result.items.slice(3).map((item) => ({ ...item, refId: 'redacted' }));
    assert.ok(issues.every((item) => JSON.stringify(item) === JSON.stringify(issues[0])));
    assert.doesNotMatch(JSON.stringify(result.items.slice(3)), /taskId|buyer|inventoryName|orderNo/);
    assert.deepEqual(f.reads[0].args.where.task.is, {
      status: { not: 'pending_rd_review' },
      OR: [{ buyerUserId: actor.id }, { buyerUserId: null, buyer: actor.name }, { buyerUserId: '', buyer: actor.name }],
    });
  }
});

test('blank actor names never claim unassigned tasks and absent refs trigger no mirror lookup', async () => {
  const f = fixture([ref({ task: { ...ref().task, buyerUserId: null, buyer: '' } })]);
  const result = await f.service.getWorkspaceArrivalDates('ref-1', { ...actor, name: ' ' });
  assert.equal(result.items[0].kind, 'unresolved');
  assert.deepEqual(f.reads[0].args.where.task.is.OR, [{ buyerUserId: actor.id }]);
  assert.equal(f.reads.length, 1);
});

test('one repeatable snapshot and two bounded queries resolve all refs without N+1 or returned quantities', async () => {
  const refs = Array.from({ length: 50 }, (_, index) => ref({ id: `ref-${index}`, taskId: `task-${index}` }));
  const f = fixture(refs, [confirmed(mirror())]);
  const result = await f.service.getWorkspaceArrivalDates(refs.map((entry) => entry.id), actor);
  assert.deepEqual(f.options(), { isolationLevel: 'RepeatableRead' });
  assert.deepEqual(f.reads.map((read) => read.operation), ['refs', 'mirrors']);
  assert.deepEqual(f.reads[1].args.where, { OR: [{ tpOrderNo: 'PO%2F001', tpLineNo: '1', tpOrderId: 'erp-1' }] });
  assert.equal(result.readOnly, true);
  assert.equal(result.items.length, 50);
  assert.equal(line(result.items[49]).taskId, 'task-49');
  assert.equal(line(result.items[0]).etaDate, '2026-09-14');
  assert.equal(line(result.items[0]).availability?.availableDate, '2026-09-15');
  assert.doesNotMatch(JSON.stringify(result), /orderedQty|receivedQty|targetQty|remainingQty|sourceFingerprint|confirmedById|needDate|dateCheck/);
});

test('free samples or incomplete ERP identity remain unresolved and never query for a guessed order line', async () => {
  const refs = [ref({ id: 'sample', metadata: { freeSample: true } }), ref({ id: 'no-id', tpOrderId: null }),
    ref({ id: 'no-order', tpOrderNo: ' ' }), ref({ id: 'no-line', tpLineNo: null })];
  const f = fixture(refs);
  const result = await f.service.getWorkspaceArrivalDates(refs.map((entry) => entry.id), actor);
  assert.ok(result.items.every((item) => item.kind === 'unresolved'));
  assert.equal(f.reads.length, 1);
  assert.match(JSON.stringify(result.items[0]), /免费样品/);
  assert.ok(result.items.slice(1).every((item) => item.kind === 'unresolved' && /完整 ERP 身份/.test(item.reason)));
});

test('missing, rebuilt, or another ERP line cannot adopt the old association or reveal replacement details', async () => {
  for (const changed of [[], [mirror({ tpOrderId: 'new-id', inventoryName: '保密新物料' })], [mirror({ tpOrderId: null })], [mirror({ tpLineNo: '2' })], [mirror({ tpOrderNo: 'OTHER' })]]) {
    const f = fixture([ref()], changed);
    const result = await f.service.getWorkspaceArrivalDates('ref-1', actor);
    assert.equal(result.items[0].kind, 'unresolved');
    assert.doesNotMatch(JSON.stringify(result), /保密新物料|lineId|taskId|orderNo/);
  }
});

test('literal ERP percent, slash, and edge spaces match only the original complete identity', async () => {
  const exact = { tpOrderNo: ' PO%2F/01 ', tpOrderId: ' erp%20/01 ', tpLineNo: ' 01 ' };
  const f = fixture([ref(exact)], [mirror({ ...exact, id: 'exact' }), mirror({ tpOrderNo: exact.tpOrderNo.trim(), id: 'trimmed' })]);
  const result = await f.service.getWorkspaceArrivalDates('ref-1', actor);
  assert.equal(line(result.items[0]).lineId, 'exact');
  assert.equal(line(result.items[0]).tpOrderId, exact.tpOrderId);
  assert.equal(line(result.items[0]).orderNo, exact.tpOrderNo);
  assert.equal(line(result.items[0]).lineNo, exact.tpLineNo);
  assert.deepEqual(f.reads[1].args.where, { OR: [exact] });
  for (const changed of [
    { ...exact, tpOrderNo: exact.tpOrderNo.trim() }, { ...exact, tpLineNo: exact.tpLineNo.trim() },
    { ...exact, tpOrderId: exact.tpOrderId.trim() }, { ...exact, tpOrderNo: decodeURIComponent(exact.tpOrderNo) },
  ]) {
    const isolated = fixture([ref(exact)], [mirror(changed)]);
    assert.equal((await isolated.service.getWorkspaceArrivalDates('ref-1', actor)).items[0].kind, 'unresolved');
  }
  const stable = fixture([ref({ id: ' ref-1 ' })]);
  const stableResult = await stable.service.getWorkspaceArrivalDates([' ref-1 ', 'ref-1'], actor);
  assert.deepEqual(stableResult.items.map((item) => item.kind), ['line', 'unresolved']);
});

test('a ref rebound after the task snapshot exposes its new ERP identity for the client to reject stale-source dates', async () => {
  const staleTaskRef = ref();
  const rebound = ref({ tpOrderId: 'erp-recreated' });
  const replacement = confirmed(mirror({ id: 'replacement-line', tpOrderId: rebound.tpOrderId }));
  const f = fixture([rebound], [replacement]);
  const result = line((await f.service.getWorkspaceArrivalDates(staleTaskRef.id, actor)).items[0]);
  assert.equal(result.refId, staleTaskRef.id);
  assert.equal(result.taskId, staleTaskRef.taskId);
  assert.equal(result.orderNo, staleTaskRef.tpOrderNo);
  assert.equal(result.lineNo, staleTaskRef.tpLineNo);
  assert.notEqual(result.tpOrderId, staleTaskRef.tpOrderId);
  assert.equal(result.tpOrderId, rebound.tpOrderId);
  assert.equal(result.lineId, 'replacement-line');
});

test('known material code and units must agree; a bad task ref does not contaminate another task', async () => {
  const refs = [ref(), ref({ id: 'wrong-code', task: { ...ref().task, material: { tpInventoryCode: 'OTHER' } } }),
    ref({ id: 'wrong-unit', task: { ...ref().task, unit: '箱' } })];
  const f = fixture(refs);
  const result = await f.service.getWorkspaceArrivalDates(refs.map((entry) => entry.id), actor);
  assert.deepEqual(result.items.map((item) => item.kind), ['line', 'unresolved', 'unresolved']);
  assert.match(JSON.stringify(result.items[1]), /物料编码/);
  assert.match(JSON.stringify(result.items[2]), /计量单位/);
  const absentUnit = fixture([ref()], [mirror({ unit: '' })]);
  assert.equal((await absentUnit.service.getWorkspaceArrivalDates('ref-1', actor)).items[0].kind, 'unresolved');
  const unknownMaterial = fixture([ref({ task: { ...ref().task, material: null, unit: '' } })]);
  assert.equal((await unknownMaterial.service.getWorkspaceArrivalDates('ref-1', actor)).items[0].kind, 'line');
});

test('availability respects no record, confirmed, cleared, and changed-source reconfirmation states', async () => {
  const cases = [mirror(), confirmed(mirror()), confirmed(mirror(), null), { ...confirmed(mirror()), receivedQty: new Prisma.Decimal(21) }];
  for (const [index, source] of cases.entries()) {
    const f = fixture([ref()], [source]);
    const item = line((await f.service.getWorkspaceArrivalDates('ref-1', actor)).items[0]);
    if (index === 0) assert.equal(item.availability, null);
    else {
      assert.equal(item.availability?.needsReconfirmation, index === 3);
      assert.equal(item.availability?.availableDate, index === 2 ? null : '2026-09-15');
      assert.equal(item.availability?.confirmedByName, '采购乙');
      assert.equal(item.availability?.confirmedAt, timestamp.toISOString());
    }
  }
});

test('raw ERP statuses and missing dates are not converted to receipt or availability judgments', async () => {
  for (const status of ['cancelled', 'closed', 'completed', '未知 ERP 状态', null]) {
    const f = fixture([ref()], [mirror({ status, approvalStatus: null, etaDate: null, syncedAt: null })]);
    const item = line((await f.service.getWorkspaceArrivalDates('ref-1', actor)).items[0]);
    assert.equal(item.orderStatus, status);
    assert.equal(item.approvalStatus, null);
    assert.equal(item.etaDate, null);
    assert.equal(item.syncedAt, null);
  }
});

test('query failures return only a generic retryable error with no partial task or order response', async () => {
  for (const operation of ['refs', 'mirrors'] as const) {
    const f = fixture(); f.fail(operation);
    await assert.rejects(f.service.getWorkspaceArrivalDates('ref-1', actor), (error: any) => {
      assert.equal(error.getStatus(), 503);
      assert.match(error.getResponse().message, /读取失败/);
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /confidential|taskId|orderNo/);
      return true;
    });
  }
});

test('task serialization preserves existing ERP internal identity without normalizing it', () => {
  const service = fixture().service as any;
  const task = { id: 'task-1', status: 'ordered', createdAt: timestamp, updatedAt: timestamp, metadata: {}, logs: [], attachments: [], criticalMaterials: [],
    purchaseOrderRefs: [ref({ tpOrderId: ' erp%20/1 ' }), ref({ id: 'legacy-ref', tpOrderId: null })] };
  const view = service.serializeTask(task);
  assert.equal(view.purchaseOrders[0].tpOrderId, ' erp%20/1 ');
  assert.equal(view.purchaseOrders[1].tpOrderId, undefined);
});
