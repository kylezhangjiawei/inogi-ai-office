import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXECUTION_PREFIX, ProductionExecutionService } from '../src/modules/procurement/production-execution.service';
import type { ExecutionInspection, ExecutionPlan, ExecutionReport, ExecutionTask } from '../src/modules/procurement/production-execution.model';

const planner = { id: 'planner', name: '计划员', permissions: ['page:production-execution', 'production:plan'] };
const worker = { id: 'worker', name: '现场人', permissions: ['page:production-execution'] };
const report = (date: string, quantity: number): ExecutionReport => ({ id: `report-${date}`, date, quantity, goodQty: quantity, note: '', actorId: 'worker', actorName: '现场人', at: `${date}T00:00:00Z` });
const inspection = (date: string, quantity: number, goodQty: number, patch: Partial<ExecutionInspection> = {}): ExecutionInspection => ({ id: `inspection-${date}`, reportId: `report-${date}`, date, quantity, goodQty, kind: 'final', process: '气密终检', evidence: '原始检验', actorId: 'inspector', actorName: '检验员', at: `${date}T00:00:00Z`, qualityId: null, ...patch });
const task = (patch: Partial<ExecutionTask> = {}): ExecutionTask => ({ id: 'whole', batchId: 'batch', name: '整机作业', treeNodeId: 'node', output: 'whole', unit: '台', quantity: 10, date: '2026-10-09', line: '一线', ownerId: 'worker', ownerName: '现场人', materials: [], status: 'dispatched', reports: [], inspections: [], ...patch });
const plan = (month: string, tasks: ExecutionTask[]): ExecutionPlan => ({ id: `plan-${month}`, version: 1, month, productId: 'product', productName: '设备', productLine: 'Q7', targetQty: 100, shipmentTargetQty: 0, bom: [], bomFingerprint: '', batches: [{ id: 'batch', code: 'B01', quantity: 100, dueDate: `${month}-28` }], tasks, events: [] });

function serviceWith(plans: ExecutionPlan[]) {
  const rows = plans.map(value => ({ key: `${EXECUTION_PREFIX}plan:${value.id}`, value: JSON.stringify(value) }));
  const db = { runtimeState: { findMany: async ({ where }: any) => rows.filter(row => where.OR.some((filter: any) => row.key.startsWith(filter.key.startsWith))) } };
  return new ProductionExecutionService(db as any, {} as any, {} as any);
}

test('驾驶舱按事件日统计整月，已完成的往月任务仍计入本月终检', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-08T16:30:00Z'));
  const completed = task({ id: 'completed-september', date: '2026-09-30', reports: [report('2026-09-30', 10)], inspections: [inspection('2026-10-02', 10, 10)] });
  const current = task({ id: 'october', reports: [report('2026-10-01', 2), report('2026-10-31', 3), report('2026-11-01', 5)], inspections: [inspection('2026-10-03', 2, 2), inspection('2026-11-01', 3, 3)] });
  const view = await serviceWith([plan('2026-09', [completed]), plan('2026-10', [current])]).overview('2026-10', planner);
  assert.equal(view.tasks.some((row: ExecutionTask) => row.id === completed.id), false);
  assert.ok(view.dashboard, 'overview must expose the real dashboard projection');
  assert.equal(view.dashboard.daily.length, 31);
  assert.deepEqual(view.dashboard.daily.slice(0, 4), [
    { date: '2026-10-01', reportedQty: 2, finalQuantity: 0, finalGoodQty: 0 },
    { date: '2026-10-02', reportedQty: 0, finalQuantity: 10, finalGoodQty: 10 },
    { date: '2026-10-03', reportedQty: 0, finalQuantity: 2, finalGoodQty: 2 },
    { date: '2026-10-04', reportedQty: 0, finalQuantity: 0, finalGoodQty: 0 },
  ]);
  assert.deepEqual(view.dashboard.daily[30], { date: '2026-10-31', reportedQty: 3, finalQuantity: 0, finalGoodQty: 0 });
  assert.equal(view.dashboard.daily.reduce((sum: number, row: any) => sum + row.reportedQty, 0), 5);
  assert.equal(view.dashboard.daily.reduce((sum: number, row: any) => sum + row.finalQuantity, 0), 12);
  assert.deepEqual(view.dashboard.today, { date: '2026-10-09', firstFinal: { quantity: 0, goodQty: 0, firstPassRate: null }, defects: [] });
});

test('驾驶舱首次终检隔离组件、取消、非台单位、过程检、历史检验及复验良品', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-08T16:30:00Z'));
  const date = '2026-10-09';
  const whole = task({ reports: [report(date, 10), report('2026-10-08', 4)], inspections: [
    inspection(date, 10, 7, { verifiedGoodQty: 3 }),
    inspection(date, 100, 0, { kind: 'process' }),
    inspection(date, 200, 0, { kind: 'legacy' }),
    inspection(date, 300, 0, { kind: undefined }),
    inspection('2026-10-08', 4, 4),
  ], fieldIssues: [{ id: 'field', qualityId: 'quality', reportId: `report-${date}`, date, defectiveQty: 3, issue: '同一批不良', actorId: 'worker', actorName: '现场人', at: `${date}T00:00:00Z`, materialBatches: [] }] });
  const sameProcess = task({ id: 'second', reports: [report(date, 5)], inspections: [inspection(date, 5, 4)] });
  const fallbackProcess = task({ id: 'third', name: '最终外观', reports: [report(date, 3)], inspections: [inspection(date, 3, 2, { process: undefined })] });
  const component = task({ id: 'component', output: 'component', unit: '件', reports: [report(date, 50)], inspections: [inspection(date, 50, 0)] });
  const cancelled = task({ id: 'cancelled', status: 'cancelled', reports: [report(date, 100)], inspections: [inspection(date, 100, 0)] });
  const wrongUnit = task({ id: 'wrong-unit', unit: '件', reports: [report(date, 200)], inspections: [inspection(date, 200, 0)] });
  const view = await serviceWith([plan('2026-10', [whole, sameProcess, fallbackProcess, component, cancelled, wrongUnit])]).overview('2026-10', planner);
  assert.ok(view.dashboard, 'overview must expose the real dashboard projection');
  assert.deepEqual(view.dashboard.daily[8], { date, reportedQty: 18, finalQuantity: 18, finalGoodQty: 13 });
  assert.equal(view.dashboard.today.firstFinal.quantity, 18);
  assert.equal(view.dashboard.today.firstFinal.goodQty, 13);
  assert.ok(view.dashboard.today.firstFinal.firstPassRate !== null);
  assert.ok(Math.abs(view.dashboard.today.firstFinal.firstPassRate - 72.22222222222222) < 1e-10);
  assert.deepEqual(view.dashboard.today.defects, [
    { process: '气密终检', quantity: 4, unit: '台' },
    { process: '最终外观', quantity: 1, unit: '台' },
  ]);
});

test('驾驶舱今日统计按上海当日独立于所选月份，读取范围沿用负责人权限', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-08T16:30:00Z'));
  const date = '2026-10-09';
  const own = task({ id: 'mine', reports: [report(date, 1)], inspections: [inspection(date, 1, 1)] });
  const other = task({ id: 'other', ownerId: 'other-worker', reports: [report(date, 9)], inspections: [inspection(date, 9, 8)] });
  const service = serviceWith([plan('2026-10', [own, other])]);
  const assigned = await service.overview('2026-09', worker);
  const all = await service.overview('2026-09', planner);
  assert.ok(assigned.dashboard, 'overview must expose the real dashboard projection');
  assert.equal(assigned.scope, 'assigned');
  assert.equal(assigned.dashboard.daily.length, 30);
  assert.equal(assigned.dashboard.daily.some((row: any) => row.reportedQty || row.finalQuantity), false);
  assert.deepEqual(assigned.dashboard.today, { date, firstFinal: { quantity: 1, goodQty: 1, firstPassRate: 100 }, defects: [] });
  assert.deepEqual(all.dashboard.today.firstFinal, { quantity: 10, goodQty: 9, firstPassRate: 90 });
  await assert.rejects(service.overview('2026-10', { ...worker, permissions: [] }), /权限/);
});

test('驾驶舱空数据补齐闰年与普通二月，不把无终检显示为百分之零', async () => {
  const service = serviceWith([]);
  for (const [month, length, lastDay] of [['2024-02', 29, '2024-02-29'], ['2026-02', 28, '2026-02-28']] as const) {
    const view = await service.overview(month, planner);
    assert.ok(view.dashboard, 'overview must expose the real dashboard projection');
    assert.equal(view.dashboard.daily.length, length);
    assert.deepEqual(view.dashboard.daily[length - 1], { date: lastDay, reportedQty: 0, finalQuantity: 0, finalGoodQty: 0 });
    assert.deepEqual(view.dashboard.today.firstFinal, { quantity: 0, goodQty: 0, firstPassRate: null });
  }
});
