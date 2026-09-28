import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BomRevisionsService } from '../src/modules/procurement/bom-revisions.service';
import { OrderStockService } from '../src/modules/order-processing/order-stock.service';
import { sourceOrderFingerprint } from '../src/modules/order-processing/order-material-mapping';

// Explicit disposable local database only. No DATABASE_URL fallback or automatic migration/cleanup.
const databaseUrl = process.env.INOGI_V11_TEST_DATABASE_URL;
test('第一阶段 PostgreSQL：发布幂等/唯一约束、删除保护、订单核对并发与 SetNull 失效', { skip: !databaseUrl, timeout: 60000 }, async () => {
  const url = new URL(databaseUrl!);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/inogi_v11_test'); assert.equal(url.username, 'inogi_audit');
  const db = new PrismaClient({ datasourceUrl: databaseUrl }), suffix = randomUUID();
  try {
    const role = await db.role.create({ data: { name: `Closure-${suffix}`, permissions: ['*'] } });
    const user = await db.user.create({ data: { name: '隔离核对员', englishName: 'Isolated reviewer', email: `${suffix}@example.invalid`, roleId: role.id } });
    const actor = { id: user.id, name: user.name, permissions: ['*'] };
    const root = await db.procTaskTreeNode.create({ data: { name: '隔离产品', productId: suffix } });
    const material = await db.procMaterial.create({ data: { name: '隔离阀体', unit: '件', tpInventoryCode: suffix, reviewStatus: 'approved' } });
    const device = await db.procBomNode.create({ data: { name: '隔离设备', productLine: suffix } });
    await db.procBomNode.create({ data: { parentId: device.id, productLine: suffix, name: material.name, materialId: material.id, code: suffix, qtyPer: 1 } });
    const bom = new BomRevisionsService(db as never);
    await bom.bind(device.id, { productRootId: root.id, requestId: randomUUID(), reason: '隔离归属', expectedFingerprint: (await bom.read(device.id, actor)).draftFingerprint }, actor);
    const publication = { requestId: randomUUID(), reason: '隔离发布', expectedFingerprint: (await bom.read(device.id, actor)).draftFingerprint };
    const outcomes = await Promise.allSettled([bom.publish(device.id, publication, actor), bom.publish(device.id, publication, actor)]);
    assert.ok(outcomes.some(result => result.status === 'fulfilled'));
    const published = await bom.publish(device.id, publication, actor);
    assert.equal(await db.procBomRevision.count({ where: { deviceId: device.id } }), 1);
    await assert.rejects(db.procBomRevision.create({ data: { ...published, id: randomUUID(), requestId: randomUUID() } }), (error: any) => error.code === 'P2002');
    // PostgreSQL RESTRICT uses SQLSTATE 23001, which Prisma can expose without P2003.
    const restrictsPublishedRevision = (...constraints: string[]) => (error: Error & { code?: string }) =>
      error.code === 'P2003' || (error.message.includes('code: "23001"') && constraints.some(constraint => error.message.includes(constraint)));
    await assert.rejects(db.procBomNode.delete({ where: { id: device.id } }), restrictsPublishedRevision('ProcBomRevision_deviceId_fkey'));
    await assert.rejects(db.procTaskTreeNode.delete({ where: { id: root.id } }), restrictsPublishedRevision('ProcBomNode_productRootId_fkey', 'ProcBomRevision_productRootId_fkey'));
    assert.ok(await db.procBomNode.findUnique({ where: { id: device.id } }));
    assert.ok(await db.procTaskTreeNode.findUnique({ where: { id: root.id } }));
    await db.procInventoryBalance.create({ data: { materialId: material.id, tpInventoryCode: suffix, warehouse: '隔离成品仓', unit: '件', stockQty: 2, availableQty: 2, syncedAt: new Date() } });
    const order = await db.orderProcessingOrder.create({ data: { id: `isolated-${suffix}`, customer: '隔离客户', type: 'warning', status: '待人工确认', shipDate: new Date() } });
    const line = await db.orderProcessingOrderProduct.create({ data: { orderId: order.id, sku: `CUSTOMER-${suffix}`, name: material.name, category: '', spec: '', unit: '件', orderQty: 3, stockQty: 999, orderPrice: 10, sysPrice: 10, subtotal: 30, status: '库存待核对', remark: '' } });
    const orders = new OrderStockService(db as never);
    const input = { materialId: material.id, expectedUpdatedAt: line.updatedAt.toISOString(), expectedSourceFingerprint: sourceOrderFingerprint(line), requestId: randomUUID(), reason: '隔离订单核对' };
    const mapping = await Promise.allSettled([orders.confirm(order.id, line.id, input, actor), orders.confirm(order.id, line.id, input, actor)]);
    assert.ok(mapping.some(result => result.status === 'fulfilled'));
    await orders.confirm(order.id, line.id, input, actor);
    assert.equal(await db.auditLog.count({ where: { resourceId: line.id, action: 'order-processing.material-map' } }), 1);
    const scope = { kind: 'selected' as const, warehouses: ['隔离成品仓'] };
    assert.equal((await orders.check([line], scope))[0].availableQty, 2);
    await db.procMaterial.delete({ where: { id: material.id } });
    const after = await db.orderProcessingOrderProduct.findUniqueOrThrow({ where: { id: line.id } });
    assert.equal(after.materialId, null); assert.ok(after.mappingEvidence);
    const stale = (await orders.check([after], scope))[0];
    assert.equal(stale.mappingState, 'stale'); assert.equal(stale.availableQty, null);
  } finally { await db.$disconnect(); }
});
