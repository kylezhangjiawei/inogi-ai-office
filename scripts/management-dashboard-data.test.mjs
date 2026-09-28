import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const hasPermission = (permissions, code) => permissions.includes('*') || permissions.includes(code);
function load(path, deps = {}) {
  const source = readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, key => {
    assert.ok(key in deps, `dependency ${key}`);
    return deps[key];
  });
  return exports;
}

const riskAccess = load('lib/managementRiskApi.ts', {
  './routePaths': { routePath: (_, fallback) => fallback },
  './purchaseOrderLineNavigation': { buildPurchaseOrderLinePath: () => '' },
});

const model = load('dashboard/managementDashboardModel.ts', {
  '../lib/permissions': { hasPermission },
  '../lib/managementRiskApi': riskAccess,
});

test('研发与全局采购读权限进入数据总览，个人采购页不会读取全局汇总', () => {
  const rd = model.managementDashboardAccess(['page:rd-my-workspace']);
  assert.equal(rd.canReadRd, true);
  assert.equal(rd.canReadProcurement, false);
  assert.equal(rd.canManage, true);
  assert.equal(rd.defaultToManagement, true);
  assert.equal(model.dashboardHomeView(new URLSearchParams(), ['page:rd-my-workspace']), 'management');
  assert.equal(model.dashboardHomeView(new URLSearchParams('home=office'), ['page:rd-my-workspace']), 'office');

  const cockpit = model.managementDashboardAccess(['page:proc-cockpit']);
  assert.equal(cockpit.canReadProcurement, true);
  assert.equal(cockpit.defaultToManagement, true);
  assert.equal(model.managementDashboardAccess(['page:proc-my-workspace']).canReadProcurement, false);
});

const emptyRiskCounts = {
  quality: 0,
  ecn: 0,
  material: 0,
  schedule: 0,
  procurement: 0,
  'purchase-order': 0,
};

test('趋势累计已下达整机派工与每条明确终检，复验分段不去重且未来实际保持未知', () => {
  const insights = load('dashboard/managementDashboardInsights.ts');
  const overview = {
    month: '2026-09', scope: 'all', targetQty: 20, shipmentTargetQty: 10, actualShippedQty: 2,
    firstFinal: { quantity: 12, goodQty: 10, firstPassRate: 83.3333333333 }, shipments: [],
    tasks: [
      { id: 'whole', output: 'whole', status: 'dispatched', quantity: 10, date: '2026-09-02', reports: [], inspections: [
        { id: 'first', reportId: 'report-1', kind: 'final', date: '2026-09-02', quantity: 8, goodQty: 7, at: '2026-09-02T10:00:00Z' },
        { id: 'retest', reportId: 'report-1', kind: 'final', date: '2026-09-03', quantity: 1, goodQty: 1, at: '2026-09-03T10:00:00Z' },
        { id: 'process', reportId: 'report-2', kind: 'process', date: '2026-09-02', quantity: 9, goodQty: 9, at: '2026-09-02T09:00:00Z' },
      ] },
      { id: 'component', output: 'component', status: 'dispatched', quantity: 999, date: '2026-09-02', reports: [], inspections: [{ id: 'component-final', reportId: 'report-3', kind: 'final', date: '2026-09-02', quantity: 999, goodQty: 999 }] },
      { id: 'prior', output: 'whole', status: 'dispatched', quantity: 50, date: '2026-08-31', reports: [], inspections: [{ id: 'carry-final', reportId: 'report-4', kind: 'final', date: '2026-09-04', quantity: 3, goodQty: 2 }] },
      { id: 'legacy', output: 'whole', status: 'dispatched', quantity: 4, date: '2026-09-05', reports: [], inspections: [{ id: 'legacy-final', reportId: 'report-5', date: '2026-09-05', quantity: 4, goodQty: 4 }] },
      { id: 'future', output: 'whole', status: 'dispatched', quantity: 6, date: '2026-09-21', reports: [], inspections: [] },
      { id: 'draft', output: 'whole', status: 'draft', quantity: 123, date: '2026-09-06', reports: [], inspections: [] },
      { id: 'cancelled', output: 'whole', status: 'cancelled', quantity: 100, date: '2026-09-02', reports: [], inspections: [] },
    ],
  };
  const plans = [
    { month: '2026-09', scope: 'all', tasks: overview.tasks.filter(task => task.id !== 'prior'), targetQty: 20, summary: { completedQty: 10, remainingQty: 10 } },
    { month: '2026-08', scope: 'all', tasks: overview.tasks.filter(task => task.id === 'prior'), targetQty: 50, summary: { completedQty: 50, remainingQty: 0 } },
  ];
  const result = insights.deriveDashboardInsights({ month: '2026-09', overview, plans, risks: null, rd: null, procurement: null, errors: {}, loadedAt: '' }, '2026-09', '2026-09-20');
  const day = date => result.trend.find(point => point.date === date);
  assert.equal(result.actualAvailable, true);
  assert.deepEqual(day('2026-09-02'), { date: '2026-09-02', label: '09-02', plannedQty: 10, actualGoodQty: 7 });
  assert.deepEqual(day('2026-09-03'), { date: '2026-09-03', label: '09-03', plannedQty: 10, actualGoodQty: 8 }, '同一报工的分段终检均属于真实首次终检');
  assert.equal(day('2026-09-04').actualGoodQty, 10, '跨月任务在本月发生的明确终检属于本月累计实绩');
  assert.equal(day('2026-09-05').plannedQty, 14);
  assert.equal(day('2026-09-05').actualGoodQty, 10, '未明确分类的历史检验不冒充终检');
  assert.equal(day('2026-09-06').plannedQty, 14, '草稿作业不进入已派工计划');
  assert.equal(day('2026-09-21').plannedQty, 20);
  assert.equal(day('2026-09-21').actualGoodQty, null);

  const incomplete = insights.deriveDashboardInsights({ month: '2026-09', overview, plans: plans.slice(0, 1), risks: null, rd: null, procurement: null, errors: {}, loadedAt: '' }, '2026-09', '2026-09-20');
  assert.equal(incomplete.actualAvailable, false, '缺少已完成跨月计划时不得展示不完整实际线');
  assert.ok(incomplete.trend.every(point => point.actualGoodQty === null));
});

test('风险摘要保留六类计数、最多五项，未知来源不会伪装成零', () => {
  const { deriveDashboardInsights } = load('dashboard/managementDashboardInsights.ts');
  const risks = ['quality', 'quality', 'ecn', 'material', 'schedule', 'procurement', 'purchase-order'].map((kind, index) => ({ id: String(index), kind }));
  const result = deriveDashboardInsights({ month: '2026-09', overview: null, plans: null, risks: { completed: 4, remaining: 6, firstFinal: null, risks }, rd: null, procurement: null, errors: {}, loadedAt: '' }, '2026-09', '2026-09-20');
  assert.deepEqual(result.riskCounts, { ...emptyRiskCounts, quality: 2, ecn: 1, material: 1, schedule: 1, procurement: 1, 'purchase-order': 1 });
  assert.equal(result.risks.length, 5);
  assert.deepEqual(result.currentMonth, { target: null, completed: 4, remaining: 6 });
  assert.deepEqual(result.causeTop, [], '现有总览未提供已确认原因聚合，不从自由文本伪造原因');

  const unknown = deriveDashboardInsights({ month: '2026-09', overview: null, plans: null, risks: null, rd: null, procurement: null, errors: {}, loadedAt: '' }, '2026-09', '2026-09-20');
  assert.deepEqual(unknown.trend, []);
  assert.equal(unknown.riskCounts, null);
  assert.equal(unknown.risks, null);
  assert.deepEqual(unknown.currentMonth, { target: null, completed: null, remaining: null });
  assert.equal(unknown.actualAvailable, false);
  assert.deepEqual(deriveDashboardInsights(null, '2026-09', '2026-09-20'), unknown);
});

test('数据读取按授权并发聚合，研发范围和采购状态口径明确，单源失败局部保留', async () => {
  const calls = [];
  const payloads = {
    '/api/procurement/production-execution/overview?month=2026-09': { month: '2026-09', scope: 'all', targetQty: 12, shipmentTargetQty: 8, actualShippedQty: 1, firstFinal: null, tasks: [], shipments: [] },
    '/api/procurement/management-risk?month=2026-09': { risks: [], completed: 3, remaining: 9, firstFinal: null },
    '/api/research-development/director-dashboard': { categoryProgress: [{ total: 7, in_progress: 3, completed: 2, blocked: 1 }] },
    '/api/procurement/summary': { total: 20, byStatus: { pending_confirm: 2, pending_inquiry: 1, inquiring: 3, pending_purchase: 2, in_transit: 4, partial_arrival: 1, pending_sample: 2, testing: 1 } },
  };
  const api = load('lib/managementDashboardApi.ts', {
    './authSession': {
      authFetch: async (url, init) => {
        calls.push([url, init]);
        if (url === '/api/procurement/management-risk?month=2026-09') return { ok: false };
        return { ok: true, json: async () => payloads[url] };
      },
      readErrorMessage: async () => '风险服务失败',
    },
    './productionExecutionApi': { listExecutionPlans: async () => [] },
    '../dashboard/managementDashboardModel': model,
  });
  const signal = new AbortController().signal;
  const result = await api.fetchManagementDashboard('2026-09', ['*'], signal);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([, init]) => init.signal === signal));
  assert.deepEqual(result.rd, { total: 7, inProgress: 3, completed: 2, blocked: 1, scope: 'all' });
  assert.deepEqual(result.procurement, { total: 20, pending: 2, inquiry: 4, inTransit: 4, partialArrival: 1, samplePending: 2, sampleTesting: 1, scope: 'all' });
  assert.equal(result.risks, null);
  assert.equal(result.errors.risks, '风险服务失败');

  calls.length = 0;
  const participating = await api.fetchManagementDashboard('2026-09', ['page:rd-my-workspace'], signal);
  assert.deepEqual(participating.rd, { total: 7, inProgress: 3, completed: 2, blocked: 1, scope: 'participating' });
  assert.equal(participating.procurement, null);
  assert.equal(participating.risks, null);
  assert.deepEqual(calls.map(([url]) => url), ['/api/research-development/director-dashboard']);

  const malformedApi = load('lib/managementDashboardApi.ts', {
    './authSession': { authFetch: async () => ({ ok: true, json: async () => ({}) }), readErrorMessage: async () => '' },
    './productionExecutionApi': { listExecutionPlans: async () => [] },
    '../dashboard/managementDashboardModel': model,
  });
  const unknownRd = await malformedApi.fetchManagementDashboard('2026-09', ['page:rd-my-workspace']);
  assert.equal(unknownRd.rd, null);
  assert.match(unknownRd.errors.rd, /不完整/);
  const unknownProcurement = await malformedApi.fetchManagementDashboard('2026-09', ['page:proc-cockpit']);
  assert.equal(unknownProcurement.procurement, null);
  assert.match(unknownProcurement.errors.procurement, /不完整/);
});
