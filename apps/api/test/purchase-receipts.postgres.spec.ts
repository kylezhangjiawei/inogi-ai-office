import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PurchaseReceiptsService } from '../src/modules/procurement/purchase-receipts.service';
import { lockOrderDependency } from '../src/modules/procurement/purchase-delivery-store';
import { auditReceiptsTestDatabaseUrl } from './helpers/audit-receipts-database';

/**
 * Run npm run test:audit-receipts:postgres from apps/api.
 * Only the runner's disposable socket database is accepted; DATABASE_URL is not read here.
 * Copies table definitions, never business rows,
 * applies the actual new migration in a random qa_po_receipts_* schema, and removes that schema.
 */
const databaseUrl = process.env.AUDIT_RECEIPTS_TEST_DATABASE_URL;
test('PostgreSQL: receipt migration, decimal totals, identity, idempotency, concurrent QC and atomic audit', {
  skip: !databaseUrl, timeout: 30_000,
}, async () => {
  const originalUrl = auditReceiptsTestDatabaseUrl(databaseUrl!);
  const originalSchema = originalUrl.searchParams.get('schema') ?? 'public';
  assert.match(originalSchema, /^[A-Za-z_][A-Za-z0-9_]*$/);
  const schema = `qa_po_receipts_${randomUUID().replace(/-/g, '')}`;
  const admin = new PrismaClient({ datasourceUrl: originalUrl.toString(), log: [] });
  const testUrl = new URL(originalUrl); testUrl.searchParams.set('schema', schema); testUrl.searchParams.set('connection_limit', '5');
  const db = new PrismaClient({ datasourceUrl: testUrl.toString(), log: [] });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    for (const table of ['ProcPurchaseOrderMirror', 'AuditLog', 'RuntimeState', 'ProcMaterial', 'ProcTaskTreeNode', 'ProcQualityRecord']) {
      await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE "${originalSchema}"."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    let migration = await readFile(resolve(__dirname, '../prisma/migrations/20260910120000_purchase_receipts/migration.sql'), 'utf8');
    for (const table of ['ProcPurchaseReceiptInspection', 'ProcPurchaseReceipt', 'ProcPurchaseOrderMirror']) {
      migration = migration.replaceAll(`"${table}"`, `"${schema}"."${table}"`);
    }
    for (const statement of migration.split(';').map((value) => value.trim()).filter(Boolean)) await admin.$executeRawUnsafe(statement);
    assert.equal((await db.$queryRaw<Array<{ current_schema: string }>>`SELECT current_schema()`)[0].current_schema, schema);
    // The lock query must deserialize successfully without weakening serialization.
    const lockOrder = 'QA-PO-LOCK', lockKey = 'erp-po-write:' + lockOrder;
    const tryLock = () => db.$transaction(async (tx) =>
      (await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired`)[0].acquired);
    await db.$transaction(async (tx) => {
      await lockOrderDependency(tx, lockOrder);
      assert.equal(await tryLock(), false, 'another transaction must not acquire the same order lock');
    });
    assert.equal(await tryLock(), true, 'commit must release the transaction lock');
    await assert.rejects(db.$transaction(async (tx) => {
      await lockOrderDependency(tx, lockOrder);
      throw new Error('qa-order-lock-rollback');
    }), /qa-order-lock-rollback/);
    assert.equal(await tryLock(), true, 'rollback must release the transaction lock');
    await db.procTaskTreeNode.create({ data: { id: 'qa-receipt-node', productId: 'qa-product', name: '来料检验模块' } });
    const service = new PurchaseReceiptsService(db as never);
    const actor = { id: 'qa-warehouse', name: '隔离验收仓管', permissions: ['*'] };
    const line = await db.procPurchaseOrderMirror.create({ data: {
      id: 'qa-line-main', tpOrderId: 'qa-erp-main', tpOrderNo: 'QA-PO-MAIN', tpLineNo: '1',
      inventoryCode: 'QA-MAT-1', inventoryName: '隔离验收物料', spec: 'V1', unit: '件', supplierName: '隔离供应商', orderedQty: 20, receivedQty: 18,
    } });
    const input = { requestId: 'qa-receipt-main-0001', expectedSourceUpdatedAt: line.updatedAt.toISOString(), deliveryNo: 'QA-DELIVERY-001', receivedDate: '2026-09-01', receivedQty: 10, note: '隔离测试' };
    for (const prefix of ['erp-po-pending:', 'erp-po-deleted:']) {
      const key = prefix + line.tpOrderNo;
      await db.runtimeState.create({ data: { key, value: line.tpOrderId! } });
      await assert.rejects(service.receive(line.id, input, actor), /正在核对操作结果或已删除/);
      assert.equal(await db.procPurchaseReceipt.count(), 0, 'blocked ERP orders must not create receipts');
      assert.equal(await db.auditLog.count(), 0, 'blocked receipts must not emit success audits');
      await db.runtimeState.delete({ where: { key } });
    }
    const duplicate = await Promise.all([service.receive(line.id, input, actor), service.receive(line.id, input, actor)]);
    assert.equal(duplicate[0].receipts.length, 1); assert.equal(duplicate[1].receipts.length, 1);
    assert.equal(await db.procPurchaseReceipt.count(), 1); assert.equal(await db.auditLog.count(), 1);
    const receipt = await db.procPurchaseReceipt.findFirstOrThrow();
    assert.equal(receipt.sourceOrderId, line.tpOrderId); assert.equal(receipt.sourceOrderedQty.toString(), '20');
    assert.equal(receipt.sourceUnit, '件');
    await assert.rejects(service.receive(line.id, { ...input, requestId: 'qa-receipt-main-0002' }, actor), /此送货单/);
    await assert.rejects(service.receive(line.id, { ...input, receivedQty: 9 }, actor), /提交标识/);
    await assert.rejects(service.receive(line.id, input, { ...actor, id: 'different-actor' }), /提交标识/);

    const qc = { treeNodeId: 'qa-receipt-node', requestId: 'qa-inspection-main-0001', expectedVersion: 0, expectedSourceUpdatedAt: line.updatedAt.toISOString(), inspectionDate: '2026-09-02', qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, basis: '规范 A 全检', note: '2 件待尺寸复核' };
    const competing = await Promise.allSettled([
      service.inspect(line.id, receipt.id, qc, actor),
      service.inspect(line.id, receipt.id, { ...qc, requestId: 'qa-inspection-main-0002' }, actor),
    ]);
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    const failed = competing.find((result) => result.status === 'rejected'); assert.ok(failed?.status === 'rejected'); assert.equal(failed.reason.getStatus(), 409);
    const latest = await db.procPurchaseReceiptInspection.findFirstOrThrow();
    const repeatedQc = { ...qc, requestId: latest.requestId };
    assert.equal((await service.inspect(line.id, receipt.id, repeatedQc, actor)).receipts[0].version, 1);
    assert.equal(await db.procPurchaseReceiptInspection.count(), 1);
    const first = await service.list(line.id, actor);
    assert.deepEqual(first.summary, { receivedQty: 10, qualifiedQty: 6, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1 });
    const revision = await service.inspect(line.id, receipt.id, { ...qc, requestId: 'qa-inspection-main-0003', expectedVersion: 1, qualifiedQty: 9, defectiveQty: 1, pendingJudgmentQty: 0, note: '复核及剩余检验完成' }, actor);
    assert.equal(revision.receipts[0].inspections.length, 2); assert.equal(revision.receipts[0].inspections[1].qualifiedQty, 6);
    assert.equal(revision.summary.qualifiedQty, 9); assert.equal(revision.summary.pendingQty, 0);

    const auditCount = await db.auditLog.count();
    await admin.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" ADD CONSTRAINT "qa_reject_receipt_audit" CHECK (action NOT IN ('purchase-order.receipt-created', 'purchase-order.inspection-recorded')) NOT VALID`);
    await assert.rejects(service.receive(line.id, { ...input, requestId: 'qa-receipt-rollback-0001', deliveryNo: 'QA-DELIVERY-ROLLBACK', receivedQty: 1 }, actor));
    await assert.rejects(service.inspect(line.id, receipt.id, { ...qc, requestId: 'qa-inspection-rollback-0001', expectedVersion: 2 }, actor));
    assert.equal(await db.procPurchaseReceipt.count(), 1); assert.equal(await db.procPurchaseReceiptInspection.count(), 2);
    assert.equal((await db.procPurchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).version, 2);
    assert.equal(await db.auditLog.count(), auditCount);
    await admin.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" DROP CONSTRAINT "qa_reject_receipt_audit"`);

    const raced = await Promise.allSettled([
      service.receive(line.id, { ...input, requestId: 'qa-receipt-race-0001', deliveryNo: 'QA-DELIVERY-RACE-1', receivedQty: 6 }, actor),
      service.receive(line.id, { ...input, requestId: 'qa-receipt-race-0002', deliveryNo: 'QA-DELIVERY-RACE-2', receivedQty: 6 }, actor),
    ]);
    assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await service.list(line.id, actor)).summary.receivedQty, 16);

    const fractional = await db.procPurchaseOrderMirror.create({ data: { tpOrderId: 'qa-erp-decimal', tpOrderNo: 'QA-PO-DECIMAL', tpLineNo: '1', inventoryCode: 'QA-MAT-2', inventoryName: '小数物料', unit: '米', orderedQty: '0.3', receivedQty: '0.3' } });
    const decimalInput = { ...input, expectedSourceUpdatedAt: fractional.updatedAt.toISOString() };
    await service.receive(fractional.id, { ...decimalInput, requestId: 'qa-receipt-decimal-0001', receivedQty: 0.1 }, actor);
    const decimals = await service.receive(fractional.id, { ...decimalInput, requestId: 'qa-receipt-decimal-0002', deliveryNo: 'QA-DELIVERY-002', receivedQty: 0.2 }, actor);
    assert.equal(decimals.summary.receivedQty, 0.3);
    await assert.rejects(service.receive(fractional.id, { ...decimalInput, requestId: 'qa-receipt-decimal-0003', deliveryNo: 'QA-DELIVERY-003', receivedQty: 0.001 }, actor), /不能超过净订购数量/);

    const changed = await db.procPurchaseOrderMirror.update({ where: { id: line.id }, data: { unit: '箱' } });
    const history = await service.list(line.id, actor); assert.ok(history.sourceIssue); assert.equal(history.canInspect, false);
    assert.equal(history.receipts.find((item) => item.id === receipt.id)?.sourceChanged, true);
    await assert.rejects(service.inspect(line.id, receipt.id, { ...qc, requestId: 'qa-inspection-source-0001', expectedVersion: 2, expectedSourceUpdatedAt: changed.updatedAt.toISOString() }, actor), /不一致/);
    const unchanged = await db.procPurchaseOrderMirror.findUniqueOrThrow({ where: { id: line.id } });
    assert.equal(unchanged.receivedQty.toString(), '18'); assert.equal(unchanged.orderedQty.toString(), '20');
    assert.equal((await db.procPurchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).sourceUnit, '件');
    await assert.rejects(db.procPurchaseReceiptInspection.update({ where: { id: latest.id }, data: { qualifiedQty: -1 } }));
    await assert.rejects(db.procPurchaseOrderMirror.delete({ where: { id: line.id } }));
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
