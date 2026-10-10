import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
import { purchaseOrderAvailabilityView } from '../src/modules/procurement/purchase-order-availability';

/**
 * Opt in only against localhost: PROC_AVAILABILITY_POSTGRES_TEST=1, with DATABASE_URL loaded.
 * From apps/api on Node 24:
 * PROC_AVAILABILITY_POSTGRES_TEST=1 node --env-file=.env --test -r ts-node/register -r tsconfig-paths/register test/purchase-order-availability.postgres.spec.ts
 * Copies table structures (zero business rows) into a random qa_po_availability_* schema,
 * applies the actual new migration there, exercises the real service, then drops only that schema.
 * No procurement order, user, stock, or annotation is inserted into the business schema.
 */
test('PostgreSQL: incremental migration, row locking, version conflicts, and atomic audit rollback', {
  skip: process.env.PROC_AVAILABILITY_POSTGRES_TEST !== '1', timeout: 30_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be configured for the local integration test');
  const originalUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(originalUrl.hostname), 'Only an explicit local PostgreSQL host is permitted');
  const originalSchema = originalUrl.searchParams.get('schema') ?? 'public';
  assert.match(originalSchema, /^[A-Za-z_][A-Za-z0-9_]*$/, 'Schema must be a plain SQL identifier');
  const schema = `qa_po_availability_${randomUUID().replace(/-/g, '')}`;
  const admin = new PrismaClient({ datasourceUrl: originalUrl.toString(), log: [] });
  const testUrl = new URL(originalUrl);
  testUrl.searchParams.set('schema', schema);
  testUrl.searchParams.set('connection_limit', '4');
  const db = new PrismaClient({ datasourceUrl: testUrl.toString(), log: [] });
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    // LIKE copies definitions only, and deliberately does not copy foreign keys into business tables.
    for (const table of ['ProcPurchaseOrderMirror', 'AuditLog', 'RuntimeState']) {
      await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE "${originalSchema}"."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    const migration = await readFile(resolve(__dirname, '../prisma/migrations/20260910090000_add_purchase_order_availability/migration.sql'), 'utf8');
    const isolatedMigration = migration
      .replaceAll('"ProcPurchaseOrderAvailability"', `"${schema}"."ProcPurchaseOrderAvailability"`)
      .replaceAll('"ProcPurchaseOrderMirror"', `"${schema}"."ProcPurchaseOrderMirror"`);
    for (const statement of isolatedMigration.split(';').map((part) => part.trim()).filter(Boolean)) await admin.$executeRawUnsafe(statement);
    const currentSchema = await db.$queryRaw<Array<{ current_schema: string }>>`SELECT current_schema()`;
    assert.equal(currentSchema[0].current_schema, schema, 'Unqualified service row locks must stay inside the test schema');
    const sourceTime = new Date('2026-09-10T01:00:00.000Z');
    const line = await db.procPurchaseOrderMirror.create({ data: {
      id: 'qa-line-1', tpOrderNo: 'QA-PO-1', tpLineNo: '1', inventoryCode: 'QA-MATERIAL-1',
      inventoryName: '隔离测试物料', unit: '件', orderedQty: 100, receivedQty: 20,
      etaDate: new Date('2026-09-14T00:00:00.000Z'), updatedAt: sourceTime,
    } });
    const service = new TplusOperationsService(db as never);
    const actor = { id: 'qa-actor', name: '隔离测试', permissions: ['*'] };
    const input = { availableDate: '2026-09-15', note: '隔离测试', expectedVersion: 0, expectedSourceUpdatedAt: line.updatedAt.toISOString() };
    const results = await Promise.allSettled([
      service.savePurchaseOrderAvailability(line.tpOrderNo, line.id, input, actor),
      service.savePurchaseOrderAvailability(line.tpOrderNo, line.id, input, actor),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal(rejected.reason.getStatus(), 409);
    assert.equal(await db.procPurchaseOrderAvailability.count(), 1);
    assert.equal(await db.auditLog.count(), 1);
    const confirmed = await db.procPurchaseOrderAvailability.findUniqueOrThrow({ where: { mirrorId: line.id } });
    assert.equal(confirmed.version, 1);

    await admin.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" ADD CONSTRAINT "qa_reject_availability_audit" CHECK (action <> 'purchase-order.availability-confirmed') NOT VALID`);
    await assert.rejects(service.savePurchaseOrderAvailability(line.tpOrderNo, line.id, { ...input, expectedVersion: 1, availableDate: '2026-09-16' }, actor));
    assert.deepEqual(await db.procPurchaseOrderAvailability.findUniqueOrThrow({ where: { mirrorId: line.id } }), confirmed);
    const secondLine = await db.procPurchaseOrderMirror.create({ data: { tpOrderNo: 'QA-PO-2', tpLineNo: '1', updatedAt: sourceTime } });
    await assert.rejects(service.savePurchaseOrderAvailability(secondLine.tpOrderNo, secondLine.id, input, actor));
    assert.equal(await db.procPurchaseOrderAvailability.count(), 1);
    assert.equal(await db.auditLog.count(), 1);
    await admin.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" DROP CONSTRAINT "qa_reject_availability_audit"`);

    const sameSource = await db.procPurchaseOrderMirror.update({ where: { id: line.id }, data: { syncedAt: new Date() } });
    assert.equal(purchaseOrderAvailabilityView(confirmed, sameSource)?.needsReconfirmation, false);
    const changedSource = await db.procPurchaseOrderMirror.update({ where: { id: line.id }, data: { receivedQty: 21 } });
    assert.equal(purchaseOrderAvailabilityView(confirmed, changedSource)?.needsReconfirmation, true);
    await assert.rejects(service.savePurchaseOrderAvailability(line.tpOrderNo, line.id, { ...input, expectedVersion: 1 }, actor), /重新载入/);
    const cleared = await service.savePurchaseOrderAvailability(line.tpOrderNo, line.id, {
      ...input, availableDate: null, note: '来源变化，重新确认前清空', expectedVersion: 1, expectedSourceUpdatedAt: changedSource.updatedAt.toISOString(),
    }, actor);
    assert.equal(cleared.availability.version, 2);
    assert.equal(cleared.availability.availableDate, null);
    assert.equal(await db.auditLog.count(), 2);
    const unmodifiedSource = await db.procPurchaseOrderMirror.findUniqueOrThrow({ where: { id: line.id } });
    assert.equal(unmodifiedSource.receivedQty.toNumber(), 21);
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
