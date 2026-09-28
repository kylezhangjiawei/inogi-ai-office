/** Local, persistent V1.1 walkthrough data. No ERP/OSS calls and no existing data reset. */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProcurementService } from '../src/modules/procurement/procurement.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { ProcurementOperationsService } from '../src/modules/procurement/procurement-operations.service';
import { ProductionExecutionService } from '../src/modules/procurement/production-execution.service';
import { ProductionLifecycleService } from '../src/modules/procurement/production-lifecycle.service';
import { WarehouseFlowService } from '../src/modules/procurement/warehouse-flow.service';
import { WarehouseRecordsService } from '../src/modules/procurement/warehouse-records.service';
import { PurchaseReceiptsService } from '../src/modules/procurement/purchase-receipts.service';
import { PurchaseFulfillmentService } from '../src/modules/procurement/purchase-fulfillment.service';
import { ProductionReadinessService } from '../src/modules/procurement/production-readiness.service';
import { QualityVerificationService } from '../src/modules/procurement/quality-verification.service';
import { TplusOperationsService } from '../src/modules/procurement/tplus-operations.service';
import { KeyMaterialsService } from '../src/modules/procurement/key-materials.service';
import { KEY_MATERIAL_CLUES } from '../src/modules/procurement/key-material-clues';
import { executionToday, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
import type { ProcActor } from '../src/modules/procurement/procurement.types';

const today = executionToday(), month = today.slice(0, 7);
const previousMonth = new Date(`${month}-01T00:00:00Z`);
previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
const priorMonth = previousMonth.toISOString().slice(0, 7);
const prefix = `DEMO-V11-${month.replace('-', '')}`;
const markerKey = `demo:production:v11:${month}`;
const reason = '【演示】本地功能验收数据，无真实收发货或 ERP 过账含义';
const productId = 'prod-portable-o2', productLine = `【演示】V1.1-${month}`;
const warehouse = '【演示】量产仓';

function services(db: PrismaService) {
  // Only database-backed methods are used. Do not bootstrap AppModule/scheduled integrations.
  const unavailable = new Proxy({}, { get: () => { throw new Error('演示数据脚本禁止调用外部服务'); } }) as never;
  const rd = new ResearchDevelopmentService(db, unavailable, unavailable, unavailable, unavailable);
  const procurement = new ProcurementService(db, unavailable, unavailable, rd);
  const readiness = new ProductionReadinessService(db);
  return { procurement, execution: new ProductionExecutionService(db, procurement), readiness,
    lifecycle: new ProductionLifecycleService(db), flow: new WarehouseFlowService(db), records: new WarehouseRecordsService(db),
    receipts: new PurchaseReceiptsService(db), fulfillment: new PurchaseFulfillmentService(db),
    quality: new QualityVerificationService(db), operations: new ProcurementOperationsService(db),
    tplus: new TplusOperationsService(db), keys: new KeyMaterialsService(db, readiness) };
}

async function seed(tx: Prisma.TransactionClient) {
  // Service transactions share this outer transaction: any failed scenario rolls back the whole dataset.
  const db = new Proxy(tx, { get(target, key) {
    if (key === '$transaction') return (callback: (client: Prisma.TransactionClient) => unknown) => callback(tx);
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) as unknown as PrismaService;
  const s = services(db);
  const adminUser = await tx.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { role: true } });
  assert.equal(adminUser.status, 'ACTIVE');
  assert.ok(Array.isArray(adminUser.role?.permissions) && adminUser.role.permissions.includes('*'), 'admin 须有查看全部演示业务的权限');
  const admin: ProcActor = { id: adminUser.id, name: adminUser.name, permissions: ['*'] };
  const permissions = ['page:production-execution', 'page:warehouse-flow', 'page:purchase-order-detail',
    'production:inspect', 'production:transfer', 'production:release', 'proc-quality:manage', 'proc-quality:verify',
    'proc-purchase-order:inspect', 'proc-purchase-order:approve-fulfillment', 'warehouse:adjust'];
  const role = await tx.role.create({ data: { name: `${prefix}-质量演示`, description: reason, permissions } });
  // No password/login is enabled. This distinct actor represents the simulated independent reviewer.
  const reviewer = await tx.user.create({ data: { name: '【演示】独立质检员', englishName: prefix,
    email: `${prefix.toLowerCase()}-qc@example.invalid`, roleId: role.id } });
  const qc: ProcActor = { id: reviewer.id, name: reviewer.name, permissions };
  const root = await tx.procTaskTreeNode.create({ data: { productId, name: `【演示】V1.1 流程验收 ${month}`, sortOrder: -100 } });
  const node = await tx.procTaskTreeNode.create({ data: { productId, name: '【演示】整机装配与质量验证', parentId: root.id, sortOrder: 1 } });
  const materials: Array<{ id: string; code: string; name: string; nodeId: string }> = [];
  const bomRoot = await tx.procBomNode.create({ data: { name: productLine, productLine } });
  for (const [index, clue] of KEY_MATERIAL_CLUES.entries()) {
    const code = `${prefix}-${clue.id}`, name = `【演示】${clue.name}`;
    const material = await tx.procMaterial.create({ data: { name, tpInventoryCode: code, erpCode: code, unit: '件',
      category: clue.group, productLine, spec: 'DEMO-V1 / 仅本地验收', reviewStatus: 'approved', safeStock: 30,
      remark: reason, metadata: { demo: true, seed: prefix }, createdBy: admin.id } });
    const materialNode = await tx.procTaskTreeNode.create({ data: { productId, name, code,
      materialId: material.id, parentId: root.id, sortOrder: index + 2 } });
    materials.push({ id: material.id, code, name, nodeId: materialNode.id });
    await tx.procBomNode.create({ data: { parentId: bomRoot.id, name, code, level: 1, productLine, materialId: material.id, qtyPer: 1, sortOrder: index } });
    await tx.procInventoryBalance.create({ data: { materialId: material.id, tpInventoryCode: code, warehouse,
      unit: '件', stockQty: 600, availableQty: 600, syncedAt: new Date() } });
    const previous = (await s.keys.list(admin)).clues.find(row => row.id === clue.id)!;
    // A real confirmed mapping is never replaced, even in the local database.
    if (previous.mapping.version === 0) await s.keys.save(clue.id, { requestId: randomUUID(), version: 0,
      materialIds: clue.kind === 'candidate' ? [] : [material.id], inclusion: clue.kind === 'candidate' ? 'pending' : 'included', note: reason }, admin);
  }
  console.log('已准备 31 项演示物料及独立 BOM，正在生成样品和生产场景');

  const samples: string[] = [];
  for (const [index, result] of ['passed', 'failed_resample', null].entries()) {
    const task = await tx.procTask.create({ data: { productId, code: `${prefix}-SAMPLE-${index + 1}`, treeNodeId: node.id,
      materialId: materials[0].id, materialName: `【演示】样品-${result ?? '待测试'}`, unit: '件', quantity: 3,
      buyer: admin.name, buyerUserId: admin.id, status: 'pending_sample', needSample: true, metadata: { demo: true, seed: prefix } } });
    await s.procurement.assignSampleTest(task.id, { testerUserId: admin.id, fromStatus: 'pending_sample',
      baseUpdatedAt: task.updatedAt.toISOString(), arrivedAt: new Date(Date.now() - 3 * 3600000).toISOString() }, admin);
    let row = await tx.procTask.findUniqueOrThrow({ where: { id: task.id } });
    const sample = (row.metadata as { sampleTest: { roundId: string } }).sampleTest;
    await s.procurement.updateSampleRecords(task.id, { roundId: sample.roundId, baseUpdatedAt: row.updatedAt.toISOString(),
      startedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      ...(result ? { finishedAt: new Date(Date.now() - 3600000).toISOString() } : {}),
      commercial: { priceUnit: '元/件', taxBasis: 'inclusive', taxRate: 13, paymentTerms: '【演示】月结 30 天',
        freightTerms: '【演示】供方承担', leadTimeStart: 'order', leadTimeStartDate: null, note: reason } }, admin);
    if (result) await s.procurement.confirmSampleTest(task.id, { roundId: sample.roundId,
      result: result as 'passed' | 'failed_resample', note: `【演示】${result === 'passed' ? '尺寸、气密及连续运行均通过' : '气密性不合格，等待重新送样'}` }, admin);
    samples.push(task.id);
  }
  const passedSample = await tx.procTask.findUniqueOrThrow({ where: { id: samples[0] } });
  const roundId = (passedSample.metadata as { sampleTest: { roundId: string } }).sampleTest.roundId;
  const plans: string[] = [], taskIds: string[] = [];
  const scenarios = ['草稿待派工', '已派工待发料', '已发料待签收', '部分签收待补料', '已报工待初检',
    '不良待协同回复', '返工部分复验通过', '闭环并部分发货', 'ECN已阅读待生产', '退料待收货'];
  const current = async (id: string) => JSON.parse((await tx.runtimeState.findUniqueOrThrow({ where: { key: `procurement:execution:v1:plan:${id}` } })).value) as ExecutionPlan;
  const cmd = async (id: string, action: string, data: Record<string, unknown>, actor = admin) => s.execution.command(id,
    { requestId: randomUUID(), version: (await current(id)).version, action, data: { reason, ...data } }, actor);
  const life = async (id: string, action: string, data: Record<string, unknown>, actor = admin) => s.lifecycle.command(id,
    { requestId: randomUUID(), version: (await s.lifecycle.read(id, admin)).version, action, data: { reason, ...data } }, actor);
  const ready = async (id: string, action: string, data: Record<string, unknown>) => {
    const view = await s.readiness.read(id, today, admin);
    return s.readiness.command(id, { requestId: randomUUID(), version: view.planVersion, action, data: { reason, date: today, sourceToken: view.sourceToken, ...data } }, admin);
  };
  const createPlan = async (planMonth: string, targetQty: number) => {
    const { id } = await s.execution.create({ requestId: randomUUID(), month: planMonth, productId, productLine, targetQty, shipmentTargetQty: 20, reason }, admin);
    plans.push(id);
    await life(id, 'transfer', { type: 'validation', code: `${prefix}-${planMonth}-V1`, sampleTaskId: samples[0], roundId,
      sop: '【演示】SOP-V1 装配步骤', sip: '【演示】SIP-V1 尺寸与气密检验', drawing: '【演示】BOM-V1，非真实量产文件' }, qc);
    const transferId = (await s.lifecycle.read(id, admin)).transfers[0].id;
    await life(id, 'validate-transfer', { id: transferId, documentsChecked: true, productionValidated: true });
    await life(id, 'publish-transfer', { id: transferId });
    return { id, transferId };
  };
  const main = await createPlan(month, 1000);
  for (const [index, title] of scenarios.entries()) {
    await cmd(main.id, 'batch', { code: `${prefix}-B${index + 1}`, quantity: 20, dueDate: today });
    const batchId = (await current(main.id)).batches[index].id;
    await cmd(main.id, 'task', { name: `【演示】${title}`, batchId, treeNodeId: node.id, ownerId: admin.id,
      output: 'whole', unit: '台', line: '【演示】一号装配线', quantity: 20, date: today,
      materials: materials.map(material => ({ code: material.code, qtyPer: 1 })) });
    const taskId = (await current(main.id)).tasks[index].id; taskIds.push(taskId);
    if (index === 0) continue;
    if (index === 8) {
      await life(main.id, 'ecn', { packageId: main.transferId, code: `${prefix}-ECN01`, batchIds: [batchId],
        effectiveDate: today, handling: '【演示】新版扭矩参数；旧料隔离，已完成批次保留原版本' });
      const changeId = (await s.lifecycle.read(main.id, admin)).changes[0].id;
      await life(main.id, 'publish-ecn', { id: changeId });
      await life(main.id, 'acknowledge', { id: changeId });
    }
    await cmd(main.id, 'dispatch', { taskId });
    if (index === 1 || index === 8) continue;
    const issued = index === 3 ? 10 : 20;
    await s.flow.command(taskId, { requestId: randomUUID(), version: 1, action: 'issue', reason,
      lines: materials.map(material => ({ code: material.code, quantity: issued, warehouse })) }, admin);
    if (index === 2) continue;
    await s.flow.command(taskId, { requestId: randomUUID(), version: 2, action: 'sign', reason,
      lines: materials.map(material => ({ code: material.code, quantity: issued })) }, admin);
    if (index === 3 || index === 9) continue;
    await cmd(main.id, 'report', { taskId, date: today, quantity: 20, goodQty: index >= 5 && index <= 7 ? 16 : 20 });
    if (index === 4) continue;
    const reportId = (await current(main.id)).tasks[index].reports[0].id;
    await cmd(main.id, 'inspect', { taskId, reportId, date: today, quantity: 20, goodQty: 16, issue: '【演示】4 台气密不合格，需返工复验' }, qc);
    const qualityId = (await current(main.id)).tasks[index].inspections![0].qualityId!;
    const qualityVersion = async () => (await tx.procQualityRecord.findUniqueOrThrow({ where: { id: qualityId } })).updatedAt.toISOString();
    await cmd(main.id, 'assign-quality', { qualityId, baseUpdatedAt: await qualityVersion(), ownerId: admin.id }, qc);
    if (index === 5) continue;
    await cmd(main.id, 'reply-quality', { qualityId, baseUpdatedAt: await qualityVersion(), reason: '【演示】已更换密封圈并完成返工，移交复验' });
    await cmd(main.id, 'disposition', { qualityId, baseUpdatedAt: await qualityVersion(), disposition: 'rework' });
    await s.quality.verify(qualityId, { requestId: randomUUID(), baseUpdatedAt: await qualityVersion(), verificationDate: today,
      inspectedQty: 4, passedQty: index === 6 ? 2 : 4, scope: 'all', evidence: reason }, qc);
    if (index === 7) {
      await life(main.id, 'release', { batchId, quantity: 20, evidenceChecked: true }, qc);
      for (const [part, quantity] of [12, 2].entries()) await life(main.id, 'ship', { batchId, quantity, date: today,
        order: `${prefix}-SO01`, recipient: '【演示】验收客户', voucher: `${prefix}-OUT${part + 1}` });
      const shipment = (await s.lifecycle.read(main.id, admin)).shipments.at(-1)!;
      await life(main.id, 'reverse-shipment', { id: shipment.id, evidenceChecked: true });
    }
  }
  const carry = await createPlan(priorMonth, 20), previousDay = `${priorMonth}-15`;
  await cmd(carry.id, 'batch', { code: `${prefix}-CARRY`, quantity: 20, dueDate: previousDay });
  const carryBatch = (await current(carry.id)).batches[0].id;
  await cmd(carry.id, 'task', { name: '【演示】上月跨月未完工', batchId: carryBatch, treeNodeId: node.id, ownerId: admin.id,
    output: 'whole', unit: '台', line: '【演示】一号装配线', quantity: 20, date: previousDay, materials: materials.map(m => ({ code: m.code, qtyPer: 1 })) });
  const carryTask = (await current(carry.id)).tasks[0].id;
  await cmd(carry.id, 'dispatch', { taskId: carryTask }); taskIds.push(carryTask);
  await ready(carry.id, 'reserve', { code: materials[0].code, quantity: 20 });
  await ready(main.id, 'reserve', { code: materials[1].code, quantity: 40 });
  // Leave one request pending and another received so the warehouse tabs both have data.
  for (const [index, quantity] of [2, 3].entries()) {
    const returned = await s.records.command({ requestId: randomUUID(), action: 'return', data: { reason,
      taskId: taskIds[9], code: materials[index].code, quantity, bucket: 'qualified', origin: 'unused', warehouse } }, admin);
    if (index === 1) await s.records.command({ requestId: randomUUID(), action: 'receive-return', id: returned.id, version: 1, data: { reason, receivedQty: quantity } }, admin);
  }
  for (const [index, qty] of [598, 603].entries()) {
    const count = await s.records.command({ requestId: randomUUID(), action: 'count', data: { reason, code: materials[index + 2].code,
      warehouse, countedQty: qty, batch: `${prefix}-COUNT${index + 1}` } }, admin);
    if (index === 0) await s.records.command({ requestId: randomUUID(), action: 'approve-count', id: count.id, version: 1, data: { reason } }, qc);
  }
  console.log('已生成生产、质量、退料和盘点记录，正在生成订单收检与履约');
  const orderIds: string[] = [], receiptIds: string[] = [];
  for (let index = 0; index < 6; index++) {
    const material = materials[index];
    const order = await tx.procPurchaseOrderMirror.create({ data: { tpOrderId: `${prefix}-PO${index + 1}`, tpOrderNo: `${prefix}-PO${index + 1}`,
      tpLineNo: '1', supplierName: `【演示】供应商${index % 2 + 1}`, inventoryCode: material.code, inventoryName: material.name,
      unit: '件', orderedQty: 100, receivedQty: 0, orderDate: new Date(`${month}-01T00:00:00Z`),
      etaDate: new Date(`${today}T00:00:00Z`), materialId: material.id, syncedAt: new Date(), metadata: { demo: true, seed: prefix } } });
    orderIds.push(order.id);
    const stockPlan = await tx.procStockPlan.create({ data: { code: `${prefix}-STOCK${index + 1}`, productId, treeNodeId: material.nodeId,
      materialId: material.id, materialName: material.name, productLine, unit: '件', targetQty: 150,
      targetDate: new Date(`${today}T00:00:00Z`), note: reason, createdBy: admin.id, createdByName: admin.name } });
    await tx.procStockPlanBatch.create({ data: { planId: stockPlan.id, supplierName: order.supplierName, purchaseQty: 100,
      purchaseOrderNo: order.tpOrderNo, purchaseOrderMirrorId: order.id, note: reason, createdBy: admin.id, createdByName: admin.name } });
    await tx.procTask.create({ data: { code: `${prefix}-BUY${index + 1}`, productId, treeNodeId: material.nodeId, stockPlanId: stockPlan.id,
      materialId: material.id, materialName: material.name, unit: '件', quantity: 100, businessLine: 'production', status: 'in_transit',
      buyer: admin.name, buyerUserId: admin.id, metadata: { demo: true, seed: prefix } } });
    if (index !== 5) await s.tplus.savePurchaseOrderAvailability(order.tpOrderNo, order.id, { availableDate: today, note: reason,
      expectedVersion: 0, expectedSourceUpdatedAt: order.updatedAt.toISOString() }, admin);
    if (index === 0 || index === 5) continue;
    const received = await s.receipts.receive(order.id, { requestId: randomUUID(), expectedSourceUpdatedAt: order.updatedAt.toISOString(),
      deliveryNo: `${prefix}-DELIVERY${index}`, receivedDate: today, receivedQty: 60, note: reason }, admin);
    const receiptId = received.receipts[0].id; receiptIds.push(receiptId);
    if (index === 1) continue;
    await s.receipts.inspect(order.id, receiptId, { requestId: randomUUID(), expectedSourceUpdatedAt: order.updatedAt.toISOString(),
      expectedVersion: 0, inspectionDate: today, qualifiedQty: index === 2 ? 60 : 50,
      defectiveQty: index === 2 ? 0 : 5, pendingJudgmentQty: index === 2 ? 0 : 5, treeNodeId: material.nodeId,
      basis: '【演示】SIP-V1', note: reason }, admin);
    if (index === 3) await s.records.command({ requestId: randomUUID(), action: 'receipt', data: { reason, receiptId, receiptVersion: 1, warehouse } }, admin);
    if (index === 4) {
      const record = await tx.procQualityRecord.findFirstOrThrow({ where: { batchNo: `RECEIPT:${receiptId}` } });
      await s.operations.saveQualityRecord(record.id, { ...record, inspectionDate: today, inspectedQty: Number(record.inspectedQty),
        defectiveQty: Number(record.defectiveQty), source: 'procurement', disposition: 'rework', status: 'processing',
        resolution: reason, baseUpdatedAt: record.updatedAt.toISOString() }, admin);
      // Regression walkthrough: classifying pending units as good must preserve the original defect scope.
      await s.receipts.inspect(order.id, receiptId, { requestId: randomUUID(), expectedSourceUpdatedAt: order.updatedAt.toISOString(),
        expectedVersion: 1, inspectionDate: today, qualifiedQty: 55, defectiveQty: 5, pendingJudgmentQty: 0, treeNodeId: material.nodeId,
        basis: '【演示】SIP-V1 补判', note: reason }, admin);
      const latest = await tx.procQualityRecord.findUniqueOrThrow({ where: { id: record.id } });
      await s.quality.verify(record.id, { requestId: randomUUID(), baseUpdatedAt: latest.updatedAt.toISOString(), verificationDate: today,
        inspectedQty: 5, passedQty: 5, scope: 'all', evidence: reason }, qc);
    }
    if (index === 2 || index === 3) {
      const state = await s.fulfillment.list(order.id, admin);
      const proposed = await s.fulfillment.propose(order.id, { requestId: randomUUID(), expectedVersion: state.version,
        expectedSourceUpdatedAt: order.updatedAt.toISOString(), reason, kind: index === 2 ? 'cancel' : 'return', quantity: 5,
        ...(index === 3 ? { receiptId, bucket: 'defective' as const } : {}), reflectedEntryIds: [] }, admin);
      if (index === 2) await s.fulfillment.decide(order.id, proposed.entries.at(-1)!.id, 'approved', { requestId: randomUUID(),
        expectedVersion: proposed.version, expectedSourceUpdatedAt: order.updatedAt.toISOString(), reason }, qc);
    }
  }
  // Confirm all existing line-side quantities today, then retain a reproducible readiness snapshot.
  for (const line of (await s.readiness.read(main.id, today, admin)).lines) {
    for (const balance of line.lineSide) await ready(main.id, 'line', { code: line.code, taskId: balance.taskId, quantity: balance.quantity });
  }
  await ready(main.id, 'snapshot', {});
  // A draft package remains actionable for admin, authored by the distinct demo reviewer.
  await life(main.id, 'transfer', { type: 'validation', code: `${prefix}-V2待验证`, sampleTaskId: samples[0], roundId,
    sop: '【演示】SOP-V2', sip: '【演示】SIP-V2', drawing: '【演示】BOM-V2待核对' }, qc);
  const manifest = { prefix, month, priorMonth, productId, productLine, warehouse, plans, taskIds, orderIds, receiptIds, samples,
    materialIds: materials.map(m => m.id), reviewerId: reviewer.id, scenarios, createdAt: new Date().toISOString() };
  await tx.runtimeState.create({ data: { key: markerKey, value: JSON.stringify(manifest) } });
  await tx.auditLog.create({ data: { module: 'procurement', source: 'local-demo-seed', action: 'demo.seed', resource: 'demo-dataset',
    resourceId: prefix, userId: admin.id, actorName: admin.name, summary: reason, meta: manifest } });
  return manifest;
}

async function verify(client: PrismaClient) {
  const stored = await client.runtimeState.findUniqueOrThrow({ where: { key: markerKey } });
  const manifest = JSON.parse(stored.value) as Awaited<ReturnType<typeof seed>>;
  const user = await client.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const actor = { id: user.id, name: user.name, permissions: ['*'] };
  const s = services(client as unknown as PrismaService);
  const plans = await s.execution.list(month, actor);
  const visible = plans.filter(plan => manifest.plans.includes(plan.id));
  assert.ok(visible.some(plan => plan.month === month), '当前月演示计划必须可见');
  const main = visible.find(plan => plan.month === month)!;
  const lifecycle = await s.lifecycle.read(main.id, actor);
  const readiness = await s.readiness.read(main.id, today, actor);
  assert.equal(readiness.lines.length, 31);
  assert.ok(readiness.history.length > 0);
  for (const id of manifest.orderIds) await s.fulfillment.list(id, actor);
  for (const id of manifest.samples) await s.procurement.getSampleTest(id, actor);
  const keys = await s.keys.monthly(month, today, actor);
  assert.equal(keys.clues.length, 31);
  const warehouseView = await s.records.list(actor);
  const issueView = await s.flow.list({ status: 'all' }, actor);
  const quality = await client.procQualityRecord.groupBy({ by: ['status'], where: { OR: [
    { batchNo: { startsWith: prefix } }, { batchNo: { in: manifest.receiptIds.map(id => `RECEIPT:${id}`) } }] }, _count: true });
  console.log(JSON.stringify({ verified: true, account: 'admin', month, priorMonth, productLine,
    productionPlans: visible.length, productionTasks: visible.flatMap(plan => plan.tasks).length, materials: manifest.materialIds.length,
    samples: manifest.samples.length, purchaseOrders: manifest.orderIds.length, receipts: manifest.receiptIds.length,
    quality, transfers: lifecycle.transfers.length, engineeringChanges: lifecycle.changes.length, shipments: lifecycle.shipments,
    warehouseIssues: issueView.items.filter(row => manifest.taskIds.includes(row.taskId)).length,
    warehouseRecords: warehouseView.records.filter(row => row.warehouse === warehouse).length,
    readiness: { currentSets: readiness.currentSets, projectedSets: readiness.projectedSets, remainingQty: readiness.remainingQty },
    routes: ['/production-execution', '/production-dashboard', '/proc-key-materials', '/warehouse-flow', '/proc-cockpit', '/rd-my-workspace', '/purchase-orders'] }, null, 2));
}

async function main() {
  const envText = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  const envValue = (key: string) => envText.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
  const databaseUrl = process.env.DATABASE_URL || envValue('DATABASE_URL');
  if (!databaseUrl) throw new Error('缺少本地数据库配置');
  const url = new URL(databaseUrl);
  if (process.env.NODE_ENV === 'production' || envValue('NODE_ENV') === 'production'
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/inogi_ai_office'
    || !['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('仅允许本机 inogi_ai_office 开发数据库，禁止向生产或远程环境写入演示数据');
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--verify'].includes(arg))) throw new Error('用法：seed:production-demo [--apply | --verify]');
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const database = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database[0].name, 'inogi_ai_office');
    console.log(JSON.stringify({ database: `${url.hostname}:${url.port || '5432'}${url.pathname}`, prefix,
      mode: args.includes('--apply') ? 'apply' : args.includes('--verify') ? 'verify' : 'preview',
      policy: '仅新增带演示标识的数据；整批事务；不覆盖既有数据、账号密码和已确认物料映射；同月重复运行不重置' }));
    if (args.includes('--apply')) await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${markerKey}))::text`;
      const existing = await tx.runtimeState.findUnique({ where: { key: markerKey } });
      if (existing) { console.log('本月演示数据已存在，保留所有后续办理痕迹。'); return; }
      await seed(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 180000 });
    if (args.includes('--apply') || args.includes('--verify')) await verify(db);
    else console.log('预览完成；添加 --apply 写入，添加 --verify 检查已经落库的数据。');
  } finally { await db.$disconnect(); }
}
main().catch(error => {
  // Never print Prisma query payloads or connection strings (which can contain credentials).
  console.error('演示数据操作失败：', error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[数据库连接]') : '未知错误');
  process.exitCode = 1;
});
