import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const root = '../src/app/production/execution/';
function load(file, require = () => ({})) {
  const code = ts.transpileModule(readFileSync(new URL(`${root}${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('require', 'exports', code)(require, exports); return exports;
}
const states = load('productionViewState.ts'), inspections = load('productionInspectionModel.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' && tree.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' && tree.props ? text(tree.props.children) : tree == null ? '' : String(tree);
function component(file, query, canWrite = true) {
  let params = new URLSearchParams(query);
  const primitive = new Proxy({}, { get: (_, name) => name });
  const module = load(file, name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    if (name === 'react-router') return { Link: 'Link', useSearchParams: () => [params, updater => { params = typeof updater === 'function' ? updater(params) : updater; }] };
    if (name.includes('usePermission')) return { usePermission: () => canWrite };
    if (name.includes('productionViewState')) return states;
    if (name.includes('productionInspectionModel')) return inspections;
    if (name.includes('routePaths')) return { routePath: (_, fallback) => fallback };
    return primitive;
  });
  return { module, params: () => params };
}
const quality = { id: 'q-1', issue: '气密不合格', status: 'open', defectiveQty: 2, unit: '台', createdByName: '质检甲' };
const final = { id: 'i-1', date: '2026-10-09', kind: 'final', quantity: 20, goodQty: 18, verifiedGoodQty: 2, quality, actorName: '质检甲' };
const task = { id: 'whole', name: '整机总装', batchId: 'b1', output: 'whole', unit: '台', status: 'dispatched', quantity: 30, date: '2026-09-30', line: '一线', ownerId: 'owner', ownerName: '线长甲', materials: [], reports: [{ id: 'r1', quantity: 30, goodQty: 28, date: '2026-10-09' }], inspections: [final, { ...final, id: 'process', kind: 'process', quality: null }], fieldIssues: [{ id: 'field', reportId: 'r1', quality, materialBatches: [] }] };
const plan = { id: 'p1', productLine: 'Q7', month: '2026-09', carryover: true, batches: [{ id: 'b1', code: 'B-1' }], events: [], tasks: [task, { ...task, id: 'component', output: 'component', unit: '件', inspections: [{ ...final, id: 'component-i', quantity: 30, goodQty: 30, quality: null }], fieldIssues: [] }, { ...task, id: 'old', inspections: [{ ...final, id: 'legacy', quantity: 30, goodQty: 30, kind: undefined, quality: null }], fieldIssues: [] }, { ...task, id: 'cancelled', status: 'cancelled', inspections: [], fieldIssues: [] }] };

test('P03 首次终检只统计整机台数，过程检/组件/历史初检/复验均不改变首次率', () => {
  const f = component('ProductionInspectionOverview.tsx', 'month=2026-10&view=inspections&qualityDate=2026-10-09');
  const tree = f.module.ProductionInspectionOverview({ plans: [plan], onVerify() {} });
  const cards = nodes(tree).filter(row => row.type === 'article');
  assert.equal(cards.length, 4);
  assert.match(text(cards[0]), /20台/); assert.match(text(cards[1]), /18台/); assert.match(text(cards[2]), /2台/); assert.match(text(cards[3]), /90.0%/);
  const pending = nodes(tree).filter(row => row.type === 'Link' && text(row) === '进入检验');
  assert.equal(pending.length, 1, '取消/已终检/历史兼容初检不重复制造待检');
  const url = new URLSearchParams(pending[0].props.to.slice(1));
  assert.equal(url.get('plan'), 'p1'); assert.equal(url.get('task'), 'whole'); assert.equal(url.get('taskSection'), 'quality'); assert.equal(url.get('workbench'), 'inspections');
});

test('P03 异常按原编号去重，复验传原记录；检验深链保留原检验编号和筛选', () => {
  const f = component('ProductionInspectionOverview.tsx', 'month=2026-10&view=inspections&qualityDate=2026-10-09&qualityKind=final&qualityPage=9');
  const verifies = [];
  const tree = f.module.ProductionInspectionOverview({ plans: [plan], onVerify: value => verifies.push(value) });
  const buttons = nodes(tree).filter(row => row.type === 'Button' && text(row) === '复验与记录');
  assert.equal(buttons.length, 1, '现场与检验引用同一异常只显示一项');
  buttons[0].props.onClick(); assert.equal(verifies[0], quality);
  const link = nodes(tree).find(row => row.type === 'Link' && text(row) === '查看检验');
  const url = new URLSearchParams(link.props.to.slice(1));
  assert.equal(url.get('inspection'), 'i-1'); assert.equal(url.get('qualityDate'), '2026-10-09'); assert.equal(url.get('qualityKind'), 'final'); assert.equal(url.get('taskFrom'), 'inspections');
  nodes(tree).find(row => row.props?.['aria-label'] === '检验记录类型').props.onChange({ target: { value: 'process' } });
  assert.equal(f.params().get('qualityKind'), 'process'); assert.equal(f.params().has('qualityPage'), false);
});

test('P03 只读人员没有登记或复验写入文案，无终检记录显示无分母', () => {
  const f = component('ProductionInspectionOverview.tsx', 'qualityDate=2026-10-08', false);
  const tree = f.module.ProductionInspectionOverview({ plans: [plan], onVerify() {} });
  const cards = nodes(tree).filter(row => row.type === 'article');
  assert.match(text(cards[3]), /—/); assert.doesNotMatch(text(cards[3]), /100/);
  assert.equal(nodes(tree).filter(row => row.type === 'Link' && text(row) === '进入检验').length, 0);
  assert.equal(nodes(tree).filter(row => row.type === 'Button' && text(row) === '复验与记录').length, 0);
  assert.ok(nodes(tree).some(row => row.type === 'Button' && text(row) === '查看验证记录'));
});

test('P02 默认呈现报工/不良双栏，不用多层 Tabs；已关联异常不可重复登记', () => {
  const f = component('ProductionTaskDetail.tsx', 'plan=p1&task=whole');
  const props = { plan, task, userId: 'owner', permissions: { canReport: true }, onEdit() {}, onVerify() {} };
  const tree = f.module.ProductionTaskDetail(props);
  assert.ok(nodes(tree).some(row => row.props?.['aria-labelledby'] === 'field-report-title'));
  assert.ok(nodes(tree).some(row => row.props?.['aria-labelledby'] === 'field-issue-title'));
  assert.equal(nodes(tree).some(row => row.type === 'Tabs'), false);
  assert.equal(nodes(tree).some(row => row.type === 'Button' && text(row) === '登记现场不良'), false);
  const edits = [];
  const eligible = f.module.ProductionTaskDetail({ ...props, task: { ...task, fieldIssues: [], inspections: [] }, onEdit: value => edits.push(value) });
  nodes(eligible).find(row => row.type === 'Button' && text(row) === '登记现场不良').props.onClick();
  assert.equal(edits[0].action, 'field-issue'); assert.equal(edits[0].task.id, task.id);
});


test('P03 旧生产单筛选可见且能清除，不以隐藏参数制造无法恢复的空列表', () => {
  const f = component('ProductionInspectionOverview.tsx', 'batch=removed&qualityDate=all');
  const props = { plans: [plan], onVerify() {} };
  let tree = f.module.ProductionInspectionOverview(props);
  assert.match(text(tree), /生产单不在当前范围/);
  nodes(tree).find(row => row.type === 'Button' && text(row) === '查看全部生产单').props.onClick();
  assert.equal(f.params().get('batch'), 'all');
  tree = f.module.ProductionInspectionOverview(props);
  assert.ok(nodes(tree).some(row => row.type === 'Link' && text(row) === '进入检验'));
});

test('P03 原料入口复用采购收货，不混入整机指标且遵守入口权限', () => {
  const f = component('ProductionInspectionOverview.tsx', 'inspectionScope=incoming');
  const tree = f.module.ProductionInspectionOverview({ plans: [plan], onVerify() {} });
  assert.equal(nodes(tree).filter(row => row.type === 'article').length, 0);
  const links = nodes(tree).filter(row => row.type === 'Link');
  assert.ok(links.some(row => row.props.to === '/purchase-orders'));
  assert.ok(links.some(row => row.props.to === '/warehouse-flow?warehouseView=records'));
  assert.match(text(tree), /不代表已完成计划审批/);
  const readOnly = component('ProductionInspectionOverview.tsx', 'inspectionScope=incoming', false);
  const empty = readOnly.module.ProductionInspectionOverview({ plans: [plan], onVerify() {} });
  assert.equal(nodes(empty).filter(row => row.type === 'Link').length, 0);
});
