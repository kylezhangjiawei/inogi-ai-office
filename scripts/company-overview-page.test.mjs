import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const base = fileURLToPath(new URL('../src/app/company-overview/', import.meta.url));
const forbid = () => assert.fail('G00 页面不能读取正式接口或发送消息');
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-14T01:00:00.000Z'])); } }
const primitives = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props, key) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {}, key });
function flatten(tree) { if (Array.isArray(tree)) return tree.flatMap(flatten); if (!tree || typeof tree !== 'object') return []; return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(flatten)]; }
function content(tree) { if (Array.isArray(tree)) return tree.map(content).join(' '); if (typeof tree === 'string' || typeof tree === 'number') return String(tree); if (!tree || typeof tree !== 'object') return ''; return [tree.props?.children, tree.props?.title, tree.props?.description, tree.props?.actions].map(content).join(' '); }
const normalized = (tree) => content(tree).replace(/\s+/g, ' ').trim();
function fixture(search = '') {
  const cache = new Map(), slots = []; let cursor = 0, tree, location = search;
  const dependencies = { react: { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; } }, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': primitives,
    'react-router': { Link: 'Link', useSearchParams: () => [new URLSearchParams(location), (value) => { location = value.toString(); }] },
    '../components/ui/dialog': primitives, '../order-processing/components/HorizonPage': primitives,
    '../lib/routePaths': { routePath: (code, fallback) => ({ 'page:rd-task-management': '/custom-rd-home', 'page:proc-cockpit': '/custom-supply-home' })[code] ?? fallback } };
  function load(name) {
    if (name in dependencies) return dependencies[name];
    const path = resolve(base, name); if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const storage = new Proxy({}, { get: forbid, set: forbid });
    new Function('exports', 'require', 'Date', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(exports, (child) => child in dependencies ? dependencies[child] : child.endsWith('.css') ? {} : load(resolve(dirname(path), `${child}.ts`)), FixedDate, forbid, storage, storage, storage);
    return exports;
  }
  const Page = load('CompanyOverviewPreviewPage.tsx').CompanyOverviewPreviewPage;
  const view = {
    render() { cursor = 0; tree = Page(); return tree; },
    nodes() { return flatten(tree); }, text() { return normalized(tree); },
    byLabel(label) { return view.nodes().find((node) => node.props['aria-label'] === label); },
    button(label) { return view.nodes().find((node) => node.type === 'button' && (normalized(node) === label || node.props['aria-label'] === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `按钮 ${label} 存在`); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); view.render(); },
    input(label, value) { const node = view.byLabel(label); assert.ok(node, `字段 ${label} 存在`); node.props.onChange({ target: { value } }); view.render(); },
    dialog() { return view.nodes().find((node) => node.type === 'Dialog'); },
    firstIssue() { const node = view.nodes().find((node) => node.type === 'button' && node.props.className === 'co-record'); assert.ok(node); node.props.onClick(); view.render(); },
    params() { return new URLSearchParams(location); },
  };
  view.render(); return view;
}

test('G00 初次渲染分别显示指标与来源说明，S15/S18 深链继承上下文', () => {
  const view = fixture(); assert.match(view.text(), /公司管理总览/); assert.match(view.text(), /216/); assert.match(view.text(), /QA 授权放行 100/); assert.match(view.text(), /实际出货 180/); assert.match(view.text(), /来源批次覆盖不同/);
  view.input('产品', 'IN-100'); view.input('全局月份', '2026-08');
  for (const path of ['monthly-readiness', 'key-materials']) {
    const link = view.nodes().find((node) => node.type === 'Link' && node.props.to.startsWith(`/__preview/${path}?`));
    const url = new URL(link.props.to, 'http://example.test'); assert.equal(url.searchParams.get('month'), '2026-08'); assert.equal(url.searchParams.get('product'), 'IN-100'); assert.equal(url.searchParams.get('scope'), 'all');
  }
});
test('研发和供应链正式入口沿用可配置路由，不硬编码登录业务页', () => {
  const view = fixture(); const hrefs = view.nodes().filter((node) => node.type === 'Link').map((node) => node.props.to);
  assert.ok(hrefs.some((href) => href.startsWith('/custom-rd-home?'))); assert.ok(hrefs.some((href) => href.startsWith('/custom-supply-home?')));
  assert.match(view.text(), /正式入口，需要正常登录与页面权限/);
});
test('搜索无结果时跨月提醒仍可打开原单；清除筛选恢复当月', () => {
  const view = fixture(); view.input('参与部门', 'supply'); view.input('搜索事项、经办人或单号', '绝无匹配');
  assert.match(view.text(), /当前筛选下没有待办/); view.click('展开跨月事项'); assert.match(view.text(), /TASK-0831-030/);
  assert.ok(view.nodes().some((node) => node.type === 'Link' && node.props.to.includes('month=2026-08&batch=batch-carry&task=task-carry')));
  view.click('清除筛选'); assert.match(view.text(), /TASK-0911-001/);
});
test('读取失败保留上次值，来源缺失不按零值补齐，恢复后重新读取', () => {
  const view = fixture(); view.input('演示来源状态', 'sync-failed'); assert.match(view.text(), /上次成功读取/); assert.match(view.text(), /整机完工 216/);
  view.input('演示来源状态', 'production-missing'); assert.match(view.text(), /整机完工 —/); assert.match(view.text(), /实际出货 180/); assert.match(view.text(), /本次无法读取原任务/);
  view.click('恢复正常来源'); assert.match(view.text(), /整机完工 216/); assert.match(view.text(), /已重新读取本地演示来源/);
});
test('事项详情生成含原单链接的本地草稿，切岗位立即移除草稿并禁用生成', () => {
  const view = fixture(); view.firstIssue(); assert.equal(view.dialog().props.open, true); view.click('生成催办草稿');
  const draft = view.byLabel('催办草稿'); assert.ok(draft); assert.equal(draft.props.readOnly, true); assert.match(draft.props.value, /未发送/); assert.match(draft.props.value, /\/__preview\/production-/);
  view.input('演示岗位', 'viewer'); assert.equal(view.byLabel('催办草稿'), undefined); assert.equal(view.button('生成催办草稿').props.disabled, true);
});
test('切产品、月份和范围后关闭旧详情，受限来源没有记录泄漏', () => {
  const view = fixture(); view.firstIssue(); view.click('生成催办草稿'); view.input('演示查看范围', 'owned');
  assert.equal(view.dialog().props.open, false); assert.equal(view.byLabel('催办草稿'), undefined); assert.match(view.text(), /没有王晴经办事项/); assert.doesNotMatch(view.text(), /TASK-0911-001/);
  view.click('查看检验依据'); assert.equal(view.dialog().props.open, true); assert.doesNotMatch(normalized(view.dialog()), /QC-0911/);
  assert.equal(view.nodes().some((node) => node.type === 'Link' && node.props.to.startsWith('/__preview/production-overview')), false);
});
test('未知产品和范围原样显示并保持隐藏数据，不静默扩大到全部', () => {
  const view = fixture('month=2026-08&product=NEW-PRODUCT&scope=custom-team');
  assert.equal(view.byLabel('产品').props.value, 'NEW-PRODUCT'); assert.equal(view.byLabel('演示查看范围').props.value, 'custom-team'); assert.match(view.text(), /尚未识别/); assert.match(view.text(), /整机完工 —/);
  const link = view.nodes().find((node) => node.type === 'Link' && node.props.to.startsWith('/__preview/key-materials'));
  assert.match(link.props.to, /product=NEW-PRODUCT&scope=custom-team/);
});
test('翻页与筛选可组合，月份变更回到第一页并保留全局参数', () => {
  const view = fixture(); view.click('下一页'); assert.match(view.text(), /2 \/ 3/);
  view.input('产品', 'Q7'); assert.match(view.text(), /1 \/ 1/); assert.equal(view.params().get('product'), 'Q7');
  view.click('上个月'); assert.equal(view.params().get('month'), '2026-08'); assert.equal(view.params().get('product'), 'Q7');
});
