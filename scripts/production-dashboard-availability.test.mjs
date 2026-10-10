import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/app/production/execution/ProductionDashboardPage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...Object.values(tree.props ?? {}).flatMap(nodes)];
}
function fixture(read) {
  let cursor = 0;
  const slots = [], effects = [];
  const primitive = new Proxy({}, { get: (_, name) => name });
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const deps = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
      useEffect(effect, dependencies) { const index = cursor++; if (!slots[index] || dependencies.some((dep, i) => dep !== slots[index][i])) { slots[index] = dependencies; effects.push(effect); } },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-router': { Link: 'Link', useSearchParams: () => [new URLSearchParams('month=2026-09'), () => {}] },
    '../../auth': { useAuth: () => ({ user: { id: 'reader', permissions: ['production:view-all'] } }) },
    '../../hooks/usePermission': { usePermission: () => true },
    '../../lib/routePaths': { routePath: (_, fallback) => fallback },
    '../../lib/authSession': { authFetch: read, readErrorMessage: async () => '生产总览读取失败' },
    './productionViewState': { productionPage: rows => ({ rows }), productionQuery: value => value, productionSearch: () => true },
  };
  const exports = {};
  new Function('exports', 'require', code)(exports, name => deps[name] ?? primitive);
  return () => { cursor = 0; const tree = exports.ProductionDashboardPage(); while (effects.length) effects.shift()(); return nodes(tree); };
}

test('生产汇总加载中和失败时，独立的交付风险仍挂载，且保留重新加载入口', async () => {
  const render = fixture(async () => { throw new Error('生产总览读取失败'); });
  assert.equal(render().filter(node => node.type === 'ManagementRiskPanel').length, 1);
  await new Promise(resolve => setImmediate(resolve));
  const result = render();
  assert.equal(result.filter(node => node.type === 'ManagementRiskPanel').length, 1);
  assert.ok(result.some(node => node.props?.role === 'alert'));
  assert.ok(result.some(node => node.type === 'Button' && node.props.children === '重新加载'));
  assert.equal(result.filter(node => node.type === 'ProductionMetrics').length, 0, '错误不能制造零值指标');
  assert.ok(result.some(node => node.type === 'Link' && node.props.to === '/production-dashboard?view=legacy'), '总览不可用不能阻断原协同任务');
});

test('生产汇总成功时保留指标、现场作业和发货记录，风险区域不重复', async () => {
  const render = fixture(async () => ({ ok: true, json: async () => ({ scope: 'all', targetQty: 100, shipmentTargetQty: 80, actualShippedQty: 30, tasks: [], shipments: [] }) }));
  render();
  await new Promise(resolve => setImmediate(resolve));
  const result = render();
  assert.equal(result.filter(node => node.type === 'ManagementRiskPanel').length, 1);
  assert.equal(result.filter(node => node.type === 'article' && node.props.className === 'cockpit-kpi').length, 4);
  assert.equal(result.filter(node => node.type === 'ProductionDashboardCharts').length, 1);
  assert.equal(result.filter(node => node.type === 'details').length, 1, '只有历史发货折叠，现场任务默认可见');
  assert.ok(result.some(node => node.type === 'section' && node.props['aria-label'] === '现场作业列表'));
  assert.equal(result.find(node => node.type === 'ManagementRiskPanel').props.presentation, 'production');
  assert.equal(result.find(node => node.type === 'ManagementRiskPanel').props.month, '2026-09');
});

test('仅获派范围不把隐藏的发货记录误显示为本月零发货', async () => {
  const render = fixture(async () => ({ ok: true, json: async () => ({ scope: 'assigned', targetQty: null, shipmentTargetQty: null, actualShippedQty: null, tasks: [], shipments: [] }) }));
  render(); await new Promise(resolve => setImmediate(resolve));
  const result = render();
  assert.equal(result.filter(node => node.type === 'details' && node.props.className === 'cockpit-card cockpit-shipment-history').length, 0);
  assert.equal(result.filter(node => node.type === 'ManagementRiskPanel').length, 1);
});