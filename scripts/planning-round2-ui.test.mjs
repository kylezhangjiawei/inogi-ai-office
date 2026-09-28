import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const primitives = new Proxy({}, { get: (_, key) => key });
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object' ? '' : React.Children.toArray(tree.props?.children).map(text).join(' ');
function nodes(tree, predicate, out = []) { if (!tree || typeof tree !== 'object') return out; if (predicate(tree)) out.push(tree); React.Children.forEach(tree.props?.children, child => nodes(child, predicate, out)); return out; }
function load(path, dependency, extra = '') {
  const exports = {}, code = ts.transpileModule(readFileSync(new URL('../src/app/' + path, import.meta.url), 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, dependency); return exports;
}
const viewState = load('production/execution/productionViewState.ts', key => { throw new Error(key); });
const orderPaths = load('lib/purchaseOrderLineNavigation.ts', key => { assert.equal(key, './routePaths'); return { subRoutePath: (_, fallback, suffix) => `${fallback}/${suffix}` }; });
const riskApi = load('lib/managementRiskApi.ts', key => key === './purchaseOrderLineNavigation' ? orderPaths : key === './routePaths' ? { routePath: (_, fallback) => fallback } : assert.fail(key));
const settle = () => new Promise(resolve => setImmediate(resolve));
const authorized = { id: 'manager-A', permissions: ['page:production-execution', 'production:view-all'] };
function fixture(kind, name) {
  let user = authorized, params = new URLSearchParams('home=management&unrelated=keep'), cursor = 0, dirty = false;
  const slots = [], effects = [], requests = [], options = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const path = kind === 'risk' ? 'dashboard/ManagementRiskPanel.tsx' : 'production/execution/ProductionScenarioPanel.tsx';
  const exports = load(path, key => {
    if (key === 'react') return hooks;
    if (key === 'react/jsx-runtime') return jsxRuntime;
    if (key === 'react-router') return { Link: 'Link', useSearchParams: () => [params, value => { params = typeof value === 'function' ? value(params) : new URLSearchParams(value); dirty = true; }] };
    if (key.endsWith('/auth')) return { useAuth: () => ({ user }) };
    if (key.endsWith('/authSession')) return { authFetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, ...init, resolve, reject })), readErrorMessage: async (response, fallback) => response.message || fallback };
    if (key.endsWith('/productionExecutionApi')) return { getExecutionOptions: signal => new Promise((resolve, reject) => options.push({ signal, resolve, reject })) };
    if (key.endsWith('/routePaths')) return { routePath: (_, fallback) => fallback };
    if (key.endsWith('/productionViewState')) return viewState;
    if (key.endsWith('/managementRiskApi')) return riskApi;
    if (key.endsWith('/QualityAnalysisDialog')) return { QualityAnalysisDialog: 'QualityAnalysisDialog' };
    if (key.includes('/components/') || key.endsWith('/ProductionView')) return primitives;
    throw new Error('unexpected dependency ' + key);
  }, kind === 'scenario' ? '\nexport { ScenarioContent };' : '');
  const view = {
    props: { month: '2026-09' }, requests, options,
    render() { for (let i = 0; i < 20; i++) { dirty = false; cursor = 0; view.tree = exports[name || (kind === 'risk' ? 'ManagementRiskPanel' : 'ScenarioContent')](view.props); while (effects.length) effects.shift()(); if (!dirty) return view; } assert.fail('unsettled render'); },
    find: predicate => nodes(view.tree, predicate)[0], nodes: predicate => nodes(view.tree, predicate),
    user(next) { user = next; return view.render(); },
    params(value) { params = new URLSearchParams(value); return view.render(); }, query: () => params,
    month(value) { view.props.month = value; return view.render(); },
    change(label, value) { const input = view.find(node => node.props['aria-label'] === label); assert.ok(input, label); input.props.onChange({ target: { value } }); return view.render(); },
    input(type, value) { const input = view.find(node => node.type === 'Input' && node.props.type === type && !node.props['aria-label']); assert.ok(input, type); input.props.onChange({ target: { value } }); return view.render(); },
    click(label) { const button = view.find(node => node.type === 'Button' && text(node).trim() === label); assert.ok(button, label); button.props.onClick(); return view.render(); },
    page(page) { const pagination = view.find(node => node.type === 'ProductionPagination'); assert.ok(pagination); pagination.props.onPageChange(page); return view.render(); },
    submit() { view.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); return view.render(); },
    async resolve(index, data, ok = true) { requests[index].resolve({ ok, json: async () => data, message: ok ? undefined : data }); await settle(); return view.render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  }; return view;
}
const risks = {
  scopes: { production: true, procurement: false, orders: false, quality: true, keyMaterials: false },
  products: [{ id: 'product-real', name: '真实产品' }], completed: 21, remaining: 79, firstFinal: { quantity: 0, goodQty: 0, firstPassRate: null }, notice: '正式业务原记录', calculatedAt: '2026-09-20T03:00:00Z',
  risks: Array.from({ length: 17 }, (_, i) => ({ id: 'risk-' + i, kind: ['quality', 'ecn', 'material', 'schedule'][i % 4], title: '原记录' + i, owner: null, dueDate: null, planId: 'plan-real', taskId: 'task-' + i, recordId: 'record-' + i, batchCodes: ['B' + i], product: '真实产品', note: '来源事实' })),
  batches: Array.from({ length: 10 }, (_, i) => ({ id: String(i), planId: 'plan-real', batchId: i ? 'batch-' + i : null, product: '真实产品', code: 'B' + i, date: null, target: 20, remaining: 10, current: null, onTime: null, note: '供应依据待核对' })),
};
const scenario = { month: '2026-09', date: '2026-09-28', productLine: 'Q7', targetQty: 100, currentSets: null, scenarioSets: null, calculatedAt: '2026-09-20T03:00:00Z', notice: '草稿测算，不产生正式计划或采购。', lines: Array.from({ length: 25 }, (_, i) => ({ code: 'M' + i, name: '物料' + i, unit: '件', remainingDemand: 100, current: 10, proposedQty: 0, scenarioGap: null, problems: ['未同步'], proposal: null })) };

test('管理风险需要原业务读取范围，撤权立即清空已展示数据', async () => {
  const view = fixture('risk').user({ id: 'staff', permissions: ['page:production-execution'] });
  assert.equal(view.tree, null); assert.equal(view.requests.length, 0);
  view.user(authorized); await view.resolve(0, risks); assert.match(text(view.tree), /原记录0/);
  view.user({ id: 'staff', permissions: [] }); assert.equal(view.tree, null); assert.equal(view.requests[0].signal.aborted, true); assert.equal(view.requests.length, 1); view.dispose();
});
test('风险月份、URL 产品和刷新均重读正确范围，忽略旧响应并保留其他参数', async () => {
  const view = fixture('risk').render(); await view.resolve(0, risks);
  view.change('风险产品', 'product-real'); assert.equal(view.query().get('home'), 'management'); assert.equal(view.query().get('unrelated'), 'keep'); assert.equal(view.nodes(node => node.type === 'Link').length, 0);
  assert.equal(new URL(view.requests[1].url, 'http://local').searchParams.get('productId'), 'product-real');
  view.month('2026-10'); assert.equal(view.requests[1].signal.aborted, true); assert.equal(new URL(view.requests[2].url, 'http://local').searchParams.get('month'), '2026-10');
  await view.resolve(1, risks); assert.equal(view.nodes(node => node.type === 'Link').length, 0);
  await view.resolve(2, { ...risks, risks: [{ ...risks.risks[1], title: '十月原记录' }] }); assert.match(text(view.tree), /十月原记录/);
  view.click('刷新'); assert.equal(view.nodes(node => node.type === 'Link').length, 0); assert.equal(view.requests.length, 4);
  await view.resolve(3, '来源不可用', false); assert.match(text(view.tree), /来源不可用/); assert.equal(view.find(node => node.type === 'ProductionEmpty'), undefined);
  view.params('home=management&riskProduct=browser-back'); assert.equal(new URL(view.requests[4].url, 'http://local').searchParams.get('productId'), 'browser-back'); view.dispose();
});
test('风险表分页、类型与批次切换不丢原记录 ID，未知齐套数不伪装为零', async () => {
  const view = fixture('risk').render(); await view.resolve(0, risks);
  const urls = view.nodes(node => node.type === 'Link').map(node => new URL(node.props.to, 'http://local'));
  assert.equal(urls.length, 8); assert.equal(urls[0].searchParams.get('quality'), 'record-0'); assert.equal(urls[0].searchParams.get('task'), 'task-0');
  assert.equal(urls[1].searchParams.get('recordType'), 'ecn'); assert.equal(urls[1].searchParams.get('record'), 'record-1');
  assert.equal(urls[2].searchParams.get('readinessBatch'), 'record-2'); assert.equal(urls[3].searchParams.get('task'), 'task-3');
  urls.forEach(url => { assert.equal(url.searchParams.get('month'), '2026-09'); assert.equal(url.searchParams.get('plan'), 'plan-real'); });
  view.page(3); assert.equal(view.nodes(node => node.type === 'Link').length, 1);
  view.change('风险类型', 'quality'); assert.equal(view.nodes(node => node.type === 'Link').length, 5); assert.equal(view.find(node => node.type === 'ProductionPagination').props.page, 1);
  view.click('批次齐套'); assert.equal(view.nodes(node => node.type === 'Link').length, 8); assert.match(text(view.tree), /待核对/); assert.match(text(view.tree), /暂无终检/);
  const unbatched = new URL(view.nodes(node => node.type === 'Link')[0].props.to, 'http://local'); assert.equal(unbatched.searchParams.has('readinessBatch'), false);
  view.page(2); assert.equal(view.nodes(node => node.type === 'Link').length, 2); view.dispose();
});
test('风险账号切换立即隐藏旧数据且迟到响应不会覆盖新账号', async () => {
  const view = fixture('risk').render(); view.user({ ...authorized, id: 'manager-B' }); assert.equal(view.requests[0].signal.aborted, true);
  await view.resolve(1, { ...risks, risks: [{ ...risks.risks[0], title: 'B 的原记录' }] }); await view.resolve(0, risks);
  assert.match(text(view.tree), /B 的原记录/); assert.doesNotMatch(text(view.tree), /原记录1/); view.dispose();
});

test('F02 供应链按原权限读取且不显示未授权生产指标，真实采购/订单链接保留原 ID', async () => {
  const view = fixture('risk').user({ id: 'buyer', permissions: ['page:proc-cockpit','page:purchase-orders'] });
  assert.equal(view.requests.length, 1);
  const supply = [{ ...risks.risks[0], id: 'task-risk', kind: 'procurement', planId: undefined, target: { type: 'procurement', taskId: 'task/&1' } }, { ...risks.risks[0], id: 'order-risk', kind: 'purchase-order', planId: undefined, target: { type: 'purchase-order', orderNo: 'PO/9', lineId: 'mirror/&9' } }];
  await view.resolve(0, { ...risks, scopes: { production: false, procurement: true, orders: true, quality: true, keyMaterials: false }, completed: null, remaining: null, firstFinal: null, batches: [], risks: supply });
  assert.doesNotMatch(text(view.tree), /本月计划合格完成|本月首次终检|暂无终检/);
  assert.equal(view.find(node => node.type === 'Button' && text(node) === '批次齐套'), undefined);
  const links = view.nodes(node => node.type === 'Link').map(node => new URL(node.props.to, 'http://local'));
  assert.equal(links[0].pathname, '/proc-cockpit'); assert.equal(links[0].searchParams.get('task'), 'task/&1'); assert.equal(links[0].searchParams.get('detail'), '1');
  assert.equal(links[1].pathname, '/purchase-orders/PO%2F9'); assert.equal(links[1].searchParams.get('lineId'), 'mirror/&9');
  assert.ok(links.every(link => !link.searchParams.has('plan'))); view.dispose();
});

test('F02 原质量弹窗仅匹配当前授权风险，关闭保留筛选；切月与撤权立即失效', async () => {
  const view = fixture('risk').user({ id: 'quality-reader', permissions: ['proc-quality:verify'] });
  const data = { ...risks, scopes: { production: false, procurement: false, orders: false, quality: true, keyMaterials: false }, completed: null, remaining: null, firstFinal: null, batches: [], risks: [{ ...risks.risks[0], planId: undefined, target: { type: 'quality', qualityId: 'original-6' } }] };
  await view.resolve(0, data); view.click('处理原记录'); assert.equal(view.query().get('riskQuality'), 'original-6'); assert.equal(view.find(node => node.type === 'QualityAnalysisDialog').props.id, 'original-6');
  view.find(node => node.type === 'QualityAnalysisDialog').props.onClose(); view.render(); assert.equal(view.query().has('riskQuality'), false); assert.equal(view.query().get('unrelated'), 'keep');
  view.params('home=management&riskQuality=foreign'); assert.equal(view.find(node => node.type === 'QualityAnalysisDialog'), undefined); assert.match(text(view.tree), /不在当前授权风险范围/);
  view.params('home=management&riskQuality=original-6'); view.month('2026-10'); assert.equal(view.find(node => node.type === 'QualityAnalysisDialog'), undefined);
  await view.resolve(1, data); view.user({ id: 'quality-reader', permissions: [] }); assert.equal(view.tree, null); view.dispose();
});

test('F02 跨月风险单列筛选，同一原单只渲染一次且关键物料链接需原权限', async () => {
  const view = fixture('risk').render();
  const data = { ...risks, risks: [{ ...risks.risks[0], period: 'carryover', keyMaterialId: 'material-real' }, { ...risks.risks[1], period: 'current' }] };
  await view.resolve(0, data); assert.equal(view.nodes(node => node.type === 'Link').length, 2);
  view.change('风险月份范围', 'carryover'); assert.equal(view.nodes(node => node.type === 'Link').length, 1); assert.equal(view.find(node => node.type === 'ProductionPagination').props.total, 1);
  view.click('刷新'); await view.resolve(1, { ...data, scopes: { ...data.scopes, keyMaterials: true } });
  const keyLink = view.nodes(node => node.type === 'Link').find(node => text(node) === '查看关键物料'); assert.ok(keyLink);
  const url = new URL(keyLink.props.to, 'http://local'); assert.equal(url.searchParams.get('material'), 'material-real'); assert.equal(url.searchParams.get('month'), '2026-09'); view.dispose();
});
test('情景采用真实输入生成仅含显式方案的请求，并支持分页与结果过期提示', async () => {
  const view = fixture('scenario').render(); view.options[0].resolve({ models: ['Q7', 'Q8'] }); await settle(); view.render();
  view.change('情景 BOM 型号', 'Q7').input('number', '100').submit();
  assert.deepEqual(JSON.parse(view.requests[0].body), { month: '2026-09', productLine: 'Q7', targetQty: 100, date: '2026-09-28', proposals: [] });
  await view.resolve(0, scenario); assert.equal(view.nodes(node => node.type === 'TableRow').length, 13);
  assert.deepEqual(view.find(node => node.type === 'ProductionMetrics').props.items.map(row => row.value), ['100 台', '待核对', '待核对']);
  view.page(3); assert.equal(view.nodes(node => node.type === 'TableRow').length, 2);
  view.change('搜索情景物料', '物料24'); assert.equal(view.find(node => node.type === 'ProductionPagination').props.total, 1);
  view.change('物料24 未下单方案数量', '50').change('物料24 方案可用日', '2026-09-29'); assert.match(text(view.tree), /条件已更改/); view.submit();
  assert.deepEqual(JSON.parse(view.requests[1].body).proposals, [{ code: 'M24', quantity: 50, availableDate: '2026-09-29' }]);
  await view.resolve(1, { ...scenario, lines: scenario.lines.map(row => row.code === 'M24' ? { ...row, proposal: { quantity: 50, availableDate: '2026-09-29', onTime: false } } : row) });
  assert.doesNotMatch(text(view.tree), /条件已更改/); assert.match(text(view.tree), /晚于需求日，未计入覆盖/); assert.match(text(view.tree), /不产生正式计划或采购/);
  view.input('number', '120'); assert.match(text(view.tree), /条件已更改/); view.dispose();
});
test('切换 BOM 或月份终止未完成试算，旧成功与错误均不能污染当前草稿', async () => {
  const view = fixture('scenario').render(); view.change('情景 BOM 型号', 'Q7').input('number', '100').submit();
  view.change('情景 BOM 型号', 'Q8'); assert.equal(view.requests[0].signal.aborted, true); await view.resolve(0, scenario); assert.equal(view.find(node => node.type === 'ProductionMetrics'), undefined);
  view.submit(); view.month('2026-10'); assert.equal(view.requests[1].signal.aborted, true); await view.resolve(1, '旧月失败', false); assert.doesNotMatch(text(view.tree), /旧月失败/);
  view.submit(); assert.deepEqual(JSON.parse(view.requests[2].body), { month: '2026-10', productLine: 'Q8', targetQty: 100, date: '2026-10-28', proposals: [] });
  await view.resolve(2, { ...scenario, month: '2026-10', date: '2026-10-28', productLine: 'Q8' }); assert.ok(view.find(node => node.type === 'ProductionMetrics')); view.dispose();
});
test('新试算取消旧试算，失败后能重新读取来源，账号身份改变会重建草稿', async () => {
  const view = fixture('scenario').render(); view.change('情景 BOM 型号', 'Q7').input('number', '100').submit(); view.submit(); assert.equal(view.requests[0].signal.aborted, true);
  await view.resolve(1, '供给读取失败', false); await view.resolve(0, scenario); assert.match(text(view.tree), /供给读取失败/); assert.equal(view.find(node => node.type === 'ProductionMetrics'), undefined);
  view.submit(); await view.resolve(2, scenario); assert.doesNotMatch(text(view.tree), /供给读取失败/);
  const wrapper = fixture('scenario', 'ProductionScenarioPanel').render(), oldKey = wrapper.tree.key; wrapper.user({ ...authorized, id: 'manager-B' }); assert.notEqual(wrapper.tree.key, oldKey);
  const nextKey = wrapper.tree.key; wrapper.user({ ...authorized, id: 'manager-B', permissions: ['page:production-execution'] }); assert.notEqual(wrapper.tree.key, nextKey);
  view.submit(); view.dispose(); assert.equal(view.options[0].signal.aborted, true); assert.equal(view.requests[3].signal.aborted, true); wrapper.dispose();
});
