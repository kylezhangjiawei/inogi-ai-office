import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const base = '../src/app/procurement/key-materials/';
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (text, args = {}) => text.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);
function load(name, deps = {}) {
  const source = readFileSync(new URL(base + name, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, key => {
    if (key.startsWith('../../components/ui/')) return primitives;
    assert.ok(key in deps, `Dependency ${key}`);
    return deps[key];
  });
  return exports;
}
const model = load('keyMaterialWorkspaceModel.ts');
function all(tree, predicate, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  if (typeof tree.type === 'function') return all(tree.type(tree.props), predicate, result);
  if (predicate(tree)) result.push(tree);
  React.Children.forEach(tree.props?.children, child => all(child, predicate, result));
  return result;
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (typeof tree.type === 'function') return text(tree.type(tree.props));
  return React.Children.toArray(tree.props?.children).map(text).join(' ');
}
function fixture(name, initial, api = {}, permissions = ['*'], exportName = name) {
  let params = new URLSearchParams(initial), cursor = 0, dirty = false;
  const slots = [], effects = [], calls = [];
  const hooks = {
    useId: () => 'scope-dialog',
    useRef(initial) { return hooks.useState({ current: initial })[0]; },
    useMemo: fn => fn(),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; dirty = true; }]; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const deps = {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'lucide-react': primitives,
    'react-router': { Link: 'Link', useSearchParams: () => [params, update => { params = typeof update === 'function' ? update(params) : update; dirty = true; }] },
    '../../lib/i18n': { useI18n: () => ({ t: translate }) },
    '../../auth': { useAuth: () => ({ user: { id: 'viewer', permissions } }) },
    '../../hooks/usePermission': { usePermission: permission => permissions.includes('*') || permissions.includes(permission) },
    '../../lib/routePaths': { routePath: (_, path) => path },
    '../../lib/purchaseOrderLineNavigation': { buildPurchaseOrderLinePath: (orderNo, lineId) => orderNo && lineId ? `/purchase-orders/${encodeURIComponent(orderNo)}?lineId=${encodeURIComponent(lineId)}` : null },
    '../../lib/keyMaterialsApi': { ...api, getKeyMaterialMonthly: async (...args) => { calls.push(args); return api.getKeyMaterialMonthly(...args); } },
    './keyMaterialWorkspaceModel': model,
    './KeyMaterialPagination': { KeyMaterialPagination: 'KeyMaterialPagination' },
    '../quality/QualityAnalysisDialog': { QualityAnalysisDialog: 'QualityAnalysisDialog' },
  };
  const component = load(name + '.tsx', deps)[exportName];
  const view = {
    calls,
    render(props = view.props) { view.props = props; for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; view.tree = component(props); while (effects.length) effects.shift()(); if (!dirty) return view; } assert.fail('state did not settle'); },
    find(predicate) { return all(view.tree, predicate)[0]; },
    nodes(predicate) { return all(view.tree, predicate); },
    params: () => new URLSearchParams(params),
    navigate(search) { params = new URLSearchParams(search); return view.render(); },
    change(label, value) { view.find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); return view.render(); },
    click(label) { view.find(node => node.type === 'Button' && text(node).trim() === label).props.onClick(); return view.render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return view;
}
const material = (id, plans = []) => ({ id, name: `物料 ${id}`, spec: '规格', unit: '件', category: '组件', productLine: 'Q5', tpInventoryCode: id, erpCode: '', available: 12, inTransit: 4, syncedAt: '2026-09-20T00:00:00Z', plans, quality: [], tasks: [] });
const plan = (id, productLine, gap = 0) => ({ planId: id, productLine, demand: 20, remainingDemand: 12, gap, date: '2026-08-31', problems: [], incoming: 8, purchase: [{ id: `line-${id}`, orderNo: `PO/${id}`, supplier: '同名供应商', date: '2026-08-30', included: true }] });
const clue = index => ({ id: `K${String(index).padStart(2, '0')}`, name: `线索 ${index}`, group: '组件', kind: 'key', check: '核对规格', mapping: { version: 1, materialIds: [`M${index}`], inclusion: 'included', actorId: 'reviewer', actorName: '核对人', note: '已核实', at: '2026-09-20T00:00:00Z' } });
const directory = { clues: Array.from({ length: 31 }, (_, index) => clue(index + 1)), materials: Array.from({ length: 31 }, (_, index) => material(`M${index + 1}`)), canReview: true };
const monthly = { month: '2026-08', date: '2026-08-31', planCount: 2, clues: [clue(1)], materials: [{ ...material('M1', [plan('A', 'Q5'), plan('B', 'Q7', 3)]), tasks: [{ id: 'task-real', code: 'PROC-1', buyer: '采购', status: 'inquiring' }], quality: [{ id: 'quality-real', issue: '待处理问题', status: 'open' }] }] };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('来源月份和型号保留；历史月份默认该月末，不静默使用今天', () => {
  assert.deepEqual(model.keyMaterialContext(new URLSearchParams('month=2024-02&product=product-real&productLine=Q5'), '2026-09-20'), { month: '2024-02', date: '2024-02-29', productId: 'product-real', productLine: 'Q5' });
  assert.equal(model.keyMaterialContext(new URLSearchParams('month=2026-02&date=2026-02-30'), '2026-09-20').date, '2026-02-28');
  assert.equal(model.keyMaterialContext(new URLSearchParams('month=2026-08&date=2026-09-02'), '2026-09-20').date, '2026-09-02');
});

test('31条目录分页无遗漏；筛选与查看详情再返回保留来源和页码', () => {
  const view = fixture('KeyMaterialDirectoryView', 'month=2026-08&productLine=Q5&page=2&q=线索').render({ data: directory, onReview() {} });
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 31);
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.page, 2);
  assert.equal(view.nodes(node => node.type === 'TableRow').length, 13);
  const path = view.nodes(node => node.type === 'Link').find(node => text(node) === '线索 13').props.to;
  view.navigate(path.slice(1));
  assert.ok(view.find(node => node.props['aria-label'] === '关键物料线索详情'));
  assert.equal(view.params().get('clue'), 'K13');
  view.click('返回资料核对');
  assert.equal(view.params().get('month'), '2026-08'); assert.equal(view.params().get('productLine'), 'Q5'); assert.equal(view.params().get('page'), '2');
  view.change('搜索关键物料', '不存在');
  assert.equal(view.params().has('page'), false); assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 0);
  view.click('清除筛选');
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 31);
  const ids = [1, 2, 3].flatMap(page => model.keyMaterialPage(directory.clues, String(page)).items.map(row => row.id));
  assert.equal(ids.length, 31); assert.equal(new Set(ids).size, 31);
});

test('确认不纳入的候选不伪装资料缺失；缺库存来源不能当零', () => {
  const excluded = { ...clue(29), mapping: { ...clue(29).mapping, inclusion: 'excluded', materialIds: [] } };
  assert.equal(model.clueNeedsReview(excluded, new Map()), false);
  assert.equal(model.clueNeedsReview(clue(1), new Map([['M1', { ...material('M1'), available: null }]])), true);
});

test('月度产品筛选只展示该产品的计划，不串入他产品缺口；未知不当有缺口或零', () => {
  const scoped = model.scopedMonthlyMaterials(monthly, 'Q5');
  assert.deepEqual(scoped[0].plans.map(row => row.planId), ['A']);
  assert.equal(model.filterMonthlyMaterials(scoped, '', 'gap').length, 0);
  const unknown = [{ ...material('M2', [plan('C', 'Q5', null)]) }];
  assert.equal(model.filterMonthlyMaterials(unknown, '', 'unverified').length, 1);
  assert.equal(model.filterMonthlyMaterials(unknown, '', 'gap').length, 0);
  assert.equal(directory.clues.length, 31, '月度过滤不改变全量目录');
});

test('产品ID独立于型号；同型号其他产品不混入，未能精确关联时不静默显示全部', async () => {
  const data = { ...monthly, materials: [material('M1', [
    { ...plan('A', 'Q5'), productId: 'product-a', productName: '便携式制氧机' },
    { ...plan('B', 'Q5', 9), productId: 'product-b', productName: '直流式制氧机' },
    plan('legacy', 'product-a', 15),
  ])] };
  assert.deepEqual(model.scopedMonthlyMaterials(data, '', 'product-a')[0].plans.map(row => row.planId), ['A']);
  assert.deepEqual(model.scopedMonthlyMaterials(data, 'Q7', 'product-a'), []);
  assert.deepEqual(model.scopedMonthlyMaterials(data, '', 'missing'), []);
  const view = fixture('KeyMaterialMonthlyPanel', 'view=monthly&month=2026-08&product=product-a&material=M1', { getKeyMaterialMonthly: async () => data }).render();
  await settle(); view.render();
  assert.equal(view.find(node => node.props['aria-label'] === '关键物料产品').props.value, 'product-a');
  assert.equal(view.find(node => node.props['aria-label'] === '关键物料产品型号').props.value, '');
  const links = view.nodes(node => node.type === 'Link').map(node => node.props.to);
  assert.ok(links.some(path => path.includes('line-A')));
  assert.equal(links.some(path => /line-B|line-legacy/.test(path)), false);
  view.click('返回月度跟踪'); assert.equal(view.params().get('product'), 'product-a');
  view.navigate('view=monthly&month=2026-08&product=missing');
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 0);
  assert.match(text(view.tree), /来源产品（关联待核对）/);
  view.click('清除筛选'); assert.equal(view.params().has('product'), false);
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 1);
  view.dispose();
});

test('月度读取沿用URL，原订单行、任务、物料供应商关系均用真实ID，质量原记录原地可刷新', async () => {
  const view = fixture('KeyMaterialMonthlyPanel', 'view=monthly&month=2026-08&productLine=Q5&material=M1&monthlyQ=M1&monthlyPage=2', { getKeyMaterialMonthly: async () => monthly }).render();
  await settle(); view.render();
  assert.deepEqual(view.calls[0].slice(0, 2), ['2026-08', '2026-08-31']);
  const links = view.nodes(node => node.type === 'Link').map(node => ({ path: node.props.to, target: node.props.target }));
  assert.ok(links.some(row => row.path === '/purchase-orders/PO%2FA?lineId=line-A' && row.target === '_blank'));
  assert.ok(links.some(row => row.path === '/proc-cockpit?task=task-real'));
  assert.equal(links.some(row => row.path.includes('line-B')), false);
  assert.equal(links.some(row => /quality-real|同名供应商/.test(row.path)), false);
  assert.ok(links.some(row => row.path === '/proc-quote-book?view=qualifications&materialId=M1' && row.target === '_blank'));
  view.click('查看原质量记录');
  assert.equal(view.params().get('quality'), 'quality-real'); assert.equal(view.find(node => node.type === 'QualityAnalysisDialog').props.id, 'quality-real');
  view.navigate(view.params().toString()); assert.equal(view.find(node => node.type === 'QualityAnalysisDialog').props.id, 'quality-real');
  view.find(node => node.type === 'QualityAnalysisDialog').props.onClose(); view.render();
  assert.equal(view.params().has('quality'), false); assert.equal(view.params().get('material'), 'M1');
  view.click('返回月度跟踪');
  assert.equal(view.params().has('material'), false); assert.equal(view.params().get('monthlyQ'), 'M1'); assert.equal(view.params().get('monthlyPage'), '2'); assert.equal(view.params().get('productLine'), 'Q5');
  view.dispose();
});

test('没有原单读取权限只显示依据，晚到旧月份响应不覆盖新月份', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const view = fixture('KeyMaterialMonthlyPanel', 'view=monthly&month=2026-08&material=M1', { getKeyMaterialMonthly: async month => month === '2026-08' ? old : { ...monthly, month, materials: [{ ...monthly.materials[0], name: '新月份物料' }] } }, []).render();
  view.navigate('view=monthly&month=2026-09&material=M1'); await settle(); view.render();
  resolveOld(monthly); await settle(); view.render();
  assert.match(text(view.tree), /新月份物料/);
  assert.equal(view.nodes(node => node.type === 'Link' && node.props.target === '_blank').length, 0);
  assert.equal(view.nodes(node => node.type === 'Button' && text(node) === '查看原质量记录').length, 0);
  view.navigate('view=monthly&month=2026-09&material=M1&quality=quality-real');
  assert.equal(view.find(node => node.type === 'QualityAnalysisDialog'), undefined, 'URL 不能绕过入口权限');
  assert.equal(view.calls[0][2].aborted, true);
  view.dispose();
});

test('质量深链必须属于当前物料，供应商资质入口遵循页面权限', async () => {
  const view = fixture('KeyMaterialMonthlyPanel', 'view=monthly&month=2026-08&material=M1&quality=foreign-record', { getKeyMaterialMonthly: async () => monthly }, ['proc-quality:verify']).render();
  await settle(); view.render();
  assert.equal(view.find(node => node.type === 'QualityAnalysisDialog'), undefined);
  assert.equal(view.nodes(node => node.type === 'Link' && node.props.to.startsWith('/proc-quote-book')).length, 0);
  view.navigate('view=monthly&month=2026-08&material=M1&quality=quality-real');
  const dialog = view.find(node => node.type === 'QualityAnalysisDialog'); assert.equal(dialog.props.id, 'quality-real');
  dialog.props.onSaved(); view.render(); await settle(); view.render(); assert.equal(view.calls.length, 2, '原记录处理后重新读取月度异常');
  view.dispose();
});

test('正式目录按物料而非线索计数；无需求仍保留，退出可查且筛选不丢来源', () => {
  const scope = { ...clue(1).mapping, inclusion: 'included', note: '长交期' };
  const data = { ...directory, materials: [{ ...material('M1'), scope }, { ...material('M2'), scope: { ...scope, inclusion: 'excluded', note: '停用设备' } }] };
  const view = fixture('KeyMaterialFormalDirectory', 'month=2026-08&product=product-a').render({ data, onSaved() {} });
  assert.equal(view.find(node => node.type === 'KeyMaterialPagination').props.total, 1);
  assert.match(text(view.tree), /物料 M1/); assert.doesNotMatch(text(view.tree), /线索 1|物料 M2/);
  assert.ok(view.find(node => node.type === 'Button' && text(node).trim() === '纳入物料'));
  view.change('正式目录范围', 'excluded');
  assert.match(text(view.tree), /停用设备/); assert.equal(view.params().get('product'), 'product-a');
  assert.equal(view.nodes(node => node.type === 'Link').length, 0, '退出项不提供月度跟踪死链');
  const reader = fixture('KeyMaterialFormalDirectory', '').render({ data: { ...data, canReview: false }, onSaved() {} });
  assert.equal(reader.find(node => node.type === 'Button' && text(node).trim() === '纳入物料'), undefined);
  assert.ok(reader.find(node => node.type === 'Button' && text(node) === '查看历史'));
});

test('月度无需求不同于依据未知，显示剩余需求，原计划跳转齐套日期；刷新可恢复风险', async () => {
  const noDemand = material('M2'), unknown = material('M3', [{ ...plan('C', 'Q5', null), problems: ['库存待核对'] }]);
  assert.deepEqual(model.filterMonthlyMaterials([noDemand, unknown], '', 'unverified', true).map(row => row.id), ['M3']);
  assert.equal(model.filterMonthlyMaterials([noDemand], '', 'unverified', false).length, 1);
  let data = { ...monthly, materials: [noDemand, material('M1', [plan('A', 'Q5')])] };
  const view = fixture('KeyMaterialMonthlyPanel', 'view=monthly&month=2026-08', { getKeyMaterialMonthly: async () => data }).render();
  await settle(); view.render(); assert.match(text(view.tree), /本期无剩余需求/);
  view.navigate('view=monthly&month=2026-08&material=M1');
  assert.match(text(view.tree), /剩余需求 12/); assert.match(text(view.tree), /计划总需求 20/);
  const link = view.nodes(node => node.type === 'Link').find(node => text(node).includes('查看原计划')).props.to;
  assert.match(link, /view=readiness/); assert.match(link, /readinessDate=2026-08-31/);
  data = { ...data, materials: [material('M1', [plan('A', 'Q5', 5)])] };
  view.click('刷新月度数据'); await settle(); view.render();
  assert.match(text(view.tree), /截至日期缺口 5/);
  assert.equal(view.params().get('material'), 'M1'); assert.equal(view.calls.length, 2);
  view.dispose();
});

test('范围编辑保留失败草稿、相同请求幂等重试、重新核对版本后可恢复纳入', async () => {
  let scope = { ...clue(1).mapping, version: 2, inclusion: 'excluded', materialIds: [] };
  const row = material('M1'), writes = [];
  let saved = 0, fail = true;
  const api = {
    getKeyMaterialDirectory: async () => ({ clues: [], canReview: true, materials: [{ ...row, scope }] }),
    getKeyMaterialHistory: async () => [scope],
    saveKeyMaterialMapping: async (...args) => { writes.push(args); if (fail) throw new Error('网络失败，草稿保留'); },
  };
  const view = fixture('KeyMaterialFormalDirectory', '', api, ['*'], 'KeyMaterialScopeDialog').render({ initial: row, canReview: true, onClose() {}, onSaved() { saved++; } });
  await settle(); view.render();
  view.find(node => node.type === 'NativeSelect').props.onChange({ target: { value: 'included' } });
  view.find(node => node.type === 'Textarea').props.onChange({ target: { value: '设备恢复，重新纳入' } }); view.render();
  view.click('确认纳入'); await settle(); view.render();
  assert.match(text(view.tree), /网络失败/);
  assert.equal(view.find(node => node.type === 'Textarea').props.value, '设备恢复，重新纳入');
  view.click('确认纳入'); await settle(); view.render();
  assert.equal(writes[0][1].requestId, writes[1][1].requestId);
  scope = { ...scope, version: 3 };
  view.click('重新核对最新版本（保留原因）'); await settle(); view.render();
  assert.equal(view.find(node => node.type === 'Textarea').props.value, '设备恢复，重新纳入');
  view.find(node => node.type === 'NativeSelect').props.onChange({ target: { value: 'included' } }); view.render();
  fail = false; view.click('确认纳入'); await settle(); view.render();
  assert.equal(saved, 1); assert.equal(writes[2][0], 'material:M1'); assert.equal(writes[2][1].version, 3);
  assert.notEqual(writes[2][1].requestId, writes[0][1].requestId);
  assert.deepEqual(writes[2][1].materialIds, ['M1']); view.dispose();
});
