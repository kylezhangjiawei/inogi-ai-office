import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ProcurementOperationsController } from '../src/modules/procurement/procurement-operations.controller';
import { ProcurementOperationsService, operationDay, locateProductionTaskSource } from '../src/modules/procurement/procurement-operations.service';
import type { SaveProductionReportDto, SaveQualityRecordDto } from '../src/modules/procurement/dto/procurement-operations.dto';

const actor = { id: 'operator', name: '生产甲', permissions: ['proc-production:report', 'proc-quality:manage'] };
const baseTime = new Date('2026-09-01T00:00:00.000Z');
const d = (value: number) => new Prisma.Decimal(value);
const reportInput: SaveProductionReportDto = { productId: 'product-1', treeNodeId: 'node-1', stockPlanId: 'plan-1', reportDate: '2026-09-04', shift: '白班', lineName: '总装线', unit: '套', plannedQty: 100, actualQty: 90, goodQty: 85, workHours: 16, capacityQty: 100 };
const qualityInput: SaveQualityRecordDto = { productId: 'product-1', treeNodeId: 'node-1', stockPlanId: 'plan-1', source: 'production', batchNo: 'B-1', inspectionDate: '2026-09-04', unit: '套', inspectedQty: 90, defectiveQty: 3, issue: '外观划痕', disposition: 'pending', status: 'open' };

type Row = Record<string, any>;
function fixture() {
  const reports: Row[] = [];
  const quality: Row[] = [];
  const nodes: Row[] = [{ id: 'node-1', productId: 'product-1', parentId: 'category-1', materialId: 'material-1', name: '主机' }, { id: 'node-2', productId: 'product-2', parentId: 'category-2', materialId: 'material-2', name: '另一产品' }];
  const plans: Row[] = [{ id: 'plan-1', productId: 'product-1', treeNodeId: 'node-1', materialId: 'material-1', code: 'SP-1', unit: '套' }, { id: 'plan-2', productId: 'product-2', treeNodeId: 'node-2', materialId: 'material-2', code: 'SP-2', unit: '件' }];
  const tasks: Row[] = [{ id: 'task-1', productId: 'product-1', treeNodeId: 'node-1', materialId: 'material-1', code: 'PR-1', unit: '套' }, { id: 'task-2', productId: 'product-2', treeNodeId: 'node-2', materialId: 'material-2', code: 'PR-2', unit: '件' }];
  const materials: Row[] = [{ id: 'material-1', name: '主机', unit: '套' }, { id: 'material-2', name: '外部物料', unit: '件' }];
  const suppliers: Row[] = [{ id: 'supplier-1', name: '供应商甲' }];
  let sequence = 0;
  let transactionOptions: unknown;
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((item: Row) => matches(row, item));
    if (key === 'AND') return value.every((item: Row) => matches(row, item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('gte' in value || 'lt' in value) return (!value.gte || row[key] >= value.gte) && (!value.lt || row[key] < value.lt);
    }
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    return row[key] === value;
  });
  const joined = (row: Row, include?: unknown) => include ? { ...row, treeNode: nodes.find((node) => node.id === row.treeNodeId), stockPlan: plans.find((plan) => plan.id === row.stockPlanId) ?? null, material: materials.find((material) => material.id === row.materialId) ?? null, supplier: suppliers.find((supplier) => supplier.id === row.supplierId) ?? null, task: tasks.find((task) => task.id === row.taskId) ?? null } : row;
  const delegate = (rows: Row[], prefix: string) => ({
    findUnique: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); return row ? joined(row, include) : null; },
    findFirst: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); return row ? joined(row, include) : null; },
    findUniqueOrThrow: async ({ where, include }: Row) => { const row = rows.find((item) => matches(item, where)); if (!row) throw new Error('missing'); return joined(row, include); },
    findMany: async ({ where, include }: Row = {}) => rows.filter((row) => matches(row, where)).map((row) => joined(row, include)),
    create: async ({ data, include }: Row) => { const row = { id: `${prefix}-${++sequence}`, createdAt: baseTime, updatedAt: baseTime, ...data }; rows.push(row); return joined(row, include); },
    updateMany: async ({ where, data }: Row) => { const row = rows.find((item) => matches(item, where)); if (!row) return { count: 0 }; Object.assign(row, data, { updatedAt: new Date(baseTime.getTime() + ++sequence) }); return { count: 1 }; },
  });
  const prisma = {
    procTaskTreeNode: delegate(nodes, 'node'), procStockPlan: delegate(plans, 'plan'), procTask: delegate(tasks, 'task'), procMaterial: delegate(materials, 'material'), procSupplier: delegate(suppliers, 'supplier'), procProductionReport: delegate(reports, 'report'), procQualityRecord: delegate(quality, 'quality'),
    $transaction: async (run: (db: unknown) => Promise<unknown>, options: unknown) => { transactionOptions = options; return run(prisma); },
  };
  return { service: new ProcurementOperationsService(prisma as never), reports, quality, nodes, plans, tasks, prisma, transactionOptions: () => transactionOptions };
}

test('真实日期校验接受闰日并拒绝滚动日期和无效月份', () => {
  assert.equal(operationDay('2024-02-29', '日期').toISOString(), '2024-02-29T00:00:00.000Z');
  for (const value of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-9-1']) assert.throws(() => operationDay(value, '日期'));
});

test('报工保存实际数、派生不良数和显式产能；使用Serializable事务', async () => {
  const f = fixture();
  const result = await f.service.saveProductionReport(null, reportInput, actor);
  assert.equal(result.actualQty, 90); assert.equal(result.defectiveQty, 5); assert.equal(result.capacityQty, 100);
  assert.equal(result.stockPlanCode, 'SP-1'); assert.equal(f.reports[0].createdBy, 'operator');
  assert.deepEqual(f.transactionOptions(), { isolationLevel: 'Serializable' });
});

test('未填写产能保持null，不用零或任务数填充', async () => {
  const f = fixture();
  const result = await f.service.saveProductionReport(null, { ...reportInput, capacityQty: null }, actor);
  assert.equal(result.capacityQty, null);
  const list = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(list.productionSummary[0].capacityQty, null);
  assert.equal(list.productionSummary[0].capacityUtilization, null);
});

test('拒绝非法数量、精度、良品多于产量及空必填字段，且不落库', async () => {
  for (const change of [{ goodQty: 91 }, { actualQty: -1 }, { plannedQty: NaN }, { workHours: 1.001 }, { actualQty: 0.0001 }, { capacityQty: 1e15 }, { lineName: '  ' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveProductionReport(null, { ...reportInput, ...change }, actor));
    assert.equal(f.reports.length, 0);
  }
});

test('跨产品节点、跨模块计划、单位冲突均拒绝', async () => {
  for (const change of [{ treeNodeId: 'node-2' }, { stockPlanId: 'plan-2' }, { unit: '件' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveProductionReport(null, { ...reportInput, ...change }, actor));
    assert.equal(f.reports.length, 0);
  }
});

test('生产和质量写入各自独立授权', async () => {
  const f = fixture();
  await assert.rejects(f.service.saveProductionReport(null, reportInput, { ...actor, permissions: ['proc-quality:manage'] }), /没有执行/);
  await assert.rejects(f.service.saveQualityRecord(null, qualityInput, { ...actor, permissions: ['proc-production:report'] }), /没有执行/);
  assert.equal(f.quality.length + f.reports.length, 0);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementOperationsController.prototype.list), ['page:proc-cockpit', 'page:rd-director-dashboard']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ProcurementOperationsController.prototype.updateQuality), ['proc-quality:manage']);
});

test('按月份、产品、模块过滤；多单位分开汇总；部分产能不算整体利用率', async () => {
  const f = fixture();
  await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveProductionReport(null, { ...reportInput, capacityQty: null }, actor);
  await f.service.saveProductionReport(null, { ...reportInput, stockPlanId: null, unit: '件', plannedQty: 5, actualQty: 4, goodQty: 3, capacityQty: 5 }, actor);
  await f.service.saveProductionReport(null, { ...reportInput, reportDate: '2026-08-31' }, actor);
  const result = await f.service.list({ productId: 'product-1', treeNodeId: 'node-1', month: '2026-09' });
  assert.equal(result.productionReports.length, 3);
  assert.equal(result.productionSummary.length, 2);
  const sets = result.productionSummary.find((row) => row.unit === '套')!;
  assert.equal(sets.actualQty, 180); assert.equal(sets.capacityRecorded, 1); assert.equal(sets.capacityQty, null); assert.equal(sets.capacityUtilization, null);
  const pieces = result.productionSummary.find((row) => row.unit === '件')!;
  assert.equal(pieces.actualQty, 4); assert.equal(pieces.capacityUtilization, 80);
});

test('报工更新记录操作者，旧版本不能覆盖新版本', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  const updated = await f.service.saveProductionReport(report.id, { ...reportInput, note: '补充说明', baseUpdatedAt: report.updatedAt }, actor);
  assert.equal(updated.updatedByName, '生产甲');
  await assert.rejects(f.service.saveProductionReport(report.id, { ...reportInput, note: '旧版覆盖', baseUpdatedAt: report.updatedAt }, actor), /已被更新/);
  assert.equal(f.reports[0].note, '补充说明');
});

test('不良登记和关闭持久化，关闭须处置及结果，重新打开清除关闭时间', async () => {
  const f = fixture();
  const created = await f.service.saveQualityRecord(null, qualityInput, actor);
  assert.equal(created.status, 'open'); assert.equal(created.resolvedAt, null);
  await assert.rejects(f.service.saveQualityRecord(created.id, { ...qualityInput, status: 'closed', baseUpdatedAt: created.updatedAt }, actor), /关闭前/);
  const closed = await f.service.saveQualityRecord(created.id, { ...qualityInput, disposition: 'rework', status: 'closed', resolution: '返工后复验合格', baseUpdatedAt: created.updatedAt }, actor);
  assert.equal(closed.status, 'closed'); assert.ok(closed.resolvedAt); assert.equal(closed.updatedByName, actor.name);
  const reopened = await f.service.saveQualityRecord(created.id, { ...qualityInput, status: 'processing', disposition: 'rework', resolution: '追加复查', baseUpdatedAt: closed.updatedAt }, actor);
  assert.equal(reopened.resolvedAt, null);
});

test('采购不良关联任务、计划和物料必须同属，检验与不良数有效', async () => {
  for (const change of [{ taskId: 'task-2' }, { materialId: 'material-2' }, { supplierId: 'missing' }, { defectiveQty: 91 }, { defectiveQty: 0 }, { inspectedQty: -1 }, { unit: '个' }]) {
    const f = fixture();
    await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', ...change }, actor));
    assert.equal(f.quality.length, 0);
  }
  const f = fixture();
  const record = await f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', taskId: 'task-1', materialId: 'material-1', supplierId: 'supplier-1' }, actor);
  assert.equal(record.taskCode, 'PR-1'); assert.equal(record.materialName, '主机'); assert.equal(record.supplierName, '供应商甲');
});

test('关联报工防止累计不良重复超量，修改本条时不会把自己重复计入', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  const one = await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id }, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, batchNo: 'B-2', productionReportId: report.id }, actor), /累计登记不良/);
  const changed = await f.service.saveQualityRecord(one.id, { ...qualityInput, productionReportId: report.id, defectiveQty: 4, baseUpdatedAt: one.updatedAt }, actor);
  assert.equal(changed.defectiveQty, 4);
  await assert.rejects(f.service.saveProductionReport(report.id, { ...reportInput, goodQty: 87, baseUpdatedAt: report.updatedAt }, actor), /不能小于已关联/);
  assert.equal(f.reports[0].goodQty.toNumber(), 85);
});

test('采购不良不能关联生产报工，生产不良不能混入其他计划', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, source: 'procurement' }, actor), /只有生产不良/);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, stockPlanId: null }, actor), /关联报工/);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, inspectedQty: 100 }, actor), /不能超过关联报工/);
});

test('采购与生产不良分开汇总且不与报工不良重复相加', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id }, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, source: 'procurement', inspectedQty: 100, defectiveQty: 2 }, actor);
  const result = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(result.productionSummary[0].defectiveQty, 5);
  assert.equal(result.qualitySummary.length, 2);
  assert.equal(result.qualitySummary.find((row) => row.source === 'procurement')?.defectiveQty, 2);
  assert.equal(result.qualitySummary.find((row) => row.source === 'production')?.defectiveQty, 3);
});

test('数据库串行化冲突转成可刷新重试的业务冲突', async () => {
  const f = fixture();
  f.prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' }); };
  await assert.rejects(f.service.saveProductionReport(null, reportInput, actor), /其他人更新/);
});

test('生产任务归属来自真实树，包括其他产品和嵌套任务；不猜标题相同的任务', () => {
  const tree = (tasks: unknown[]) => [{ children: [{ tasks }] }];
  const rows = [
    { key: 'rdws.production.taskCategories', value: tree([{ task_id: 'main-task', title: '相同名称' }]) },
    { key: 'rdws.production.productTaskCategories', value: { 'product-2': tree([{ task_id: 'parent', title: '父任务', subtasks: [{ task_id: 'target-task', title: '相同名称' }] }]) } },
  ];
  assert.deepEqual(locateProductionTaskSource(rows, 'target-task'), { taskId: 'target-task', productId: 'product-2', title: '相同名称' });
  assert.equal(locateProductionTaskSource(rows, 'main-task').productId, 'prod-portable-o2');
  assert.throws(() => locateProductionTaskSource(rows, 'missing'), /不存在/);
  assert.throws(() => locateProductionTaskSource([{ key: 'rdws.production.taskCategories', value: tree([{ task_id: 'old', archived: true }]) }], 'old'), /已归档/);
});

test('存在多产品重复任务编号时拒绝选择任意一个产品', () => {
  const tree = [{ children: [{ tasks: [{ task_id: 'duplicate', title: '重复' }] }] }];
  assert.throws(() => locateProductionTaskSource([{ key: 'rdws.production.taskCategories', value: tree }, { key: 'rdws.production.productTaskCategories', value: { 'other-product': tree } }], 'duplicate'), /不唯一/);
});

test('同批次重复不良记录被拒绝，避免检验数量被重复计入统计', async () => {
  const f = fixture();
  await f.service.saveQualityRecord(null, qualityInput, actor);
  await assert.rejects(f.service.saveQualityRecord(null, qualityInput, actor), /已有同类不良记录/);
  assert.equal(f.quality.length, 1);
});

test('同报工分批检验的分母不能超过实际产量', async () => {
  const f = fixture();
  const report = await f.service.saveProductionReport(null, reportInput, actor);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, inspectedQty: 60, defectiveQty: 2 }, actor);
  await assert.rejects(f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, batchNo: 'B-2', inspectedQty: 60, defectiveQty: 2 }, actor), /检验数量合计/);
  await f.service.saveQualityRecord(null, { ...qualityInput, productionReportId: report.id, batchNo: 'B-2', inspectedQty: 30, defectiveQty: 2 }, actor);
  const result = await f.service.list({ productId: 'product-1', month: '2026-09' });
  assert.equal(result.qualitySummary[0].inspectedQty, 90);
  assert.equal(result.qualitySummary[0].defectiveQty, 4);
});
