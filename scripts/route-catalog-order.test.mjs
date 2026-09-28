import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

const code = ts.transpileModule(readFileSync(new URL('../src/app/lib/routeCatalogOrder.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = {};
new Function('exports', code)(model);
const page = (id, groupLabel, sortOrder, extra = {}) => ({ id, type: 'page', groupLabel, sortOrder, createdAt: '2026-09-20', ...extra });
const items = [
  page('b2', '页面访问 · 乙', 40),
  page('a2', '页面访问 · 甲', 20, { navHidden: true, enabled: false }),
  page('b1', '页面访问 · 乙', 30),
  page('a1', '页面访问 · 甲', 10),
  page('action', '操作权限 · 甲', 1, { type: 'action' }),
];

test('目录分组和页面按配置顺序排列，同序号不因更新时间或读取顺序漂移', () => {
  const tree = model.buildRouteTree([...items, page('a3', '页面访问 · 甲', 20)]);
  const pages = tree.find(root => root.label === '页面访问');
  assert.deepEqual(pages.branches.map(branch => branch.label), ['甲', '乙']);
  assert.deepEqual(pages.branches[0].items.map(item => item.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(model.buildRouteTree([...items].reverse()), model.buildRouteTree(items));
  const mixed = [...items, page('mixed-action', '页面访问 · 乙', 1, { type: 'action' })];
  assert.deepEqual(model.buildRouteTree(mixed).find(root => root.label === '页面访问').branches.map(branch => branch.label), ['甲', '乙']);
});

test('页内移动和分组移动保留全部页面，包括隐藏停用项，且不修改原始目录', () => {
  const snapshot = structuredClone(items);
  assert.deepEqual(model.moveRoutePages(items, '页面访问::甲', 1, 'a1'), ['a2', 'a1', 'b1', 'b2']);
  assert.deepEqual(model.moveRoutePages(items, '页面访问::乙', -1), ['b1', 'b2', 'a1', 'a2']);
  assert.deepEqual(items, snapshot);
});

test('边界和不存在的目标不产生保存请求或跨组移动', () => {
  assert.equal(model.moveRoutePages(items, '页面访问::甲', -1, 'a1'), null);
  assert.equal(model.moveRoutePages(items, '页面访问::甲', 1, 'a2'), null);
  assert.equal(model.moveRoutePages(items, '页面访问::甲', -1), null);
  assert.equal(model.moveRoutePages(items, '页面访问::乙', 1), null);
  assert.equal(model.moveRoutePages(items, '页面访问::甲', 1, 'b1'), null);
  assert.equal(model.moveRoutePages(items, '不存在', 1), null);
});

function fixture() {
  const slots = [];
  const effects = [];
  let cursor = 0;
  const primitive = new Proxy({}, { get: (_, key) => key });
  const records = items.map(item => ({ code: `page:${item.id}`, label: item.id, routePath: `/${item.id}`,
    description: '', enabled: true, navHidden: false, updatedAt: '2026-09-20', ...item }));
  const pending = [];
  const messages = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect(fn) { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(fn); } },
  };
  const api = {
    listItems: async () => records,
    reorderItems: ids => new Promise((resolve, reject) => pending.push({ ids, resolve, reject })),
  };
  const exports = {};
  const pageSource = readFileSync(new URL('../src/app/RouteManagementPage.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(pageSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('exports', 'require', js)(exports, name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'sonner') return { toast: { success: text => messages.push(text), error: text => messages.push(text) } };
    if (name.endsWith('/utils')) return { cn: (...args) => args.filter(Boolean).join(' ') };
    if (name.endsWith('/routeCatalogOrder')) return model;
    if (name.endsWith('/permissionCatalogApi')) return { permissionCatalogApi: api };
    if (name.endsWith('/routePaths')) return { cacheRoutePaths() {} };
    if (name.includes('/components/') || name === 'lucide-react') return primitive;
    assert.fail(`unexpected dependency ${name}`);
  });
  function render() {
    cursor = 0;
    const tree = exports.RouteManagementPage();
    while (effects.length) effects.shift()();
    return tree;
  }
  function nodes(tree, predicate, out = []) {
    if (!tree || typeof tree !== 'object') return out;
    if (typeof tree.type === 'function') return nodes(tree.type(tree.props), predicate, out);
    if (predicate(tree)) out.push(tree);
    React.Children.forEach(tree.props?.children, child => nodes(child, predicate, out));
    for (const prop of ['actions', 'action', 'trailing', 'meta']) if (tree.props?.[prop]) nodes(tree.props[prop], predicate, out);
    return out;
  }
  return { render, nodes, pending, messages, records };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
async function expandedFixture() {
  const view = fixture();
  view.render();
  await settle();
  const expand = view.nodes(view.render(), node => node.type === 'Button' && React.Children.toArray(node.props.children).includes('展开全部'))[0];
  expand.props.onClick();
  return view;
}

test('点击位置按钮只提交一次，成功后更新位置并锁住边界；筛选不允许移动部分目录', async () => {
  const view = await expandedFixture();
  const button = name => view.nodes(view.render(), node => node.props?.['aria-label'] === name)[0];
  assert.equal(button('上移页面“a1”').props.disabled, true);
  const down = button('下移页面“a1”');
  down.props.onClick();
  down.props.onClick();
  assert.equal(view.pending.length, 1);
  assert.deepEqual(view.pending[0].ids, ['a2', 'a1', 'b1', 'b2']);
  assert.equal(button('下移分组“甲”').props.disabled, true);
  view.pending[0].resolve(view.records.map(item => ({ ...item, sortOrder: (view.pending[0].ids.indexOf(item.id) + 1) * 10 })));
  await settle();
  assert.equal(button('下移页面“a1”').props.disabled, true);
  assert.equal(button('上移页面“a1”').props.disabled, false);
  const search = view.nodes(view.render(), node => node.props?.id === 'route-catalog-search')[0];
  search.props.onChange({ target: { value: 'a1' } });
  assert.equal(button('上移页面“a1”').props.disabled, true);
  button('上移页面“a1”').props.onClick();
  assert.equal(view.pending.length, 1);
});

test('保存失败保留原顺序，显示可读错误并允许重新操作', async () => {
  const view = await expandedFixture();
  const before = JSON.stringify(view.records);
  view.nodes(view.render(), node => node.props?.['aria-label'] === '下移分组“甲”')[0].props.onClick();
  view.pending[0].reject(new Error('目录已变更，请刷新后重试'));
  await settle();
  assert.equal(JSON.stringify(view.records), before);
  assert.ok(view.nodes(view.render(), node => node.props?.role === 'alert' && node.props.children === '目录已变更，请刷新后重试').length);
  assert.equal(view.nodes(view.render(), node => node.props?.['aria-label'] === '上移页面“a1”')[0].props.disabled, true);
  assert.equal(view.nodes(view.render(), node => node.props?.['aria-label'] === '下移页面“a1”')[0].props.disabled, false);
});

function dragEvent(clientY = 75) {
  return {
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
    dataTransfer: { effectAllowed: '', dropEffect: '', setData() {} },
    preventDefault() { this.prevented = true; },
    stopPropagation() {},
  };
}

test('拖动手柄落在行下方后只保存一次，组外页面及外部拖入不触发排序', async () => {
  const view = await expandedFixture();
  const node = predicate => view.nodes(view.render(), predicate)[0];
  const handle = name => node(entry => entry.props?.['aria-label'] === name);
  const row = id => node(entry => entry.props?.['data-route-order-item'] === id);
  assert.ok(handle('拖动页面“a1”'), '需要可见的页面拖动手柄');
  assert.equal(handle('拖动页面“a1”').props.draggable, true);
  row('a2').props.onDrop(dragEvent());
  assert.equal(view.pending.length, 0, '拒绝外部文本和文件拖入');
  handle('拖动页面“a1”').props.onDragStart(dragEvent());
  row('b1').props.onDragOver(dragEvent());
  row('b1').props.onDrop(dragEvent());
  assert.equal(view.pending.length, 0, '不能把页面误移入别的分组');
  handle('拖动页面“a1”').props.onDragStart(dragEvent());
  row('a2').props.onDragOver(dragEvent());
  assert.equal(row('a2').props['data-drop-placement'], 'after');
  row('a2').props.onDrop(dragEvent());
  row('a2').props.onDrop(dragEvent());
  assert.equal(view.pending.length, 1);
  assert.deepEqual(view.pending[0].ids, ['a2', 'a1', 'b1', 'b2']);
  assert.equal(handle('拖动页面“a1”').props.draggable, false);
  view.pending[0].resolve(view.records.map(item => ({ ...item, sortOrder: (view.pending[0].ids.indexOf(item.id) + 1) * 10 })));
  await settle();
  assert.equal(handle('上移页面“a1”').props.disabled, false);
});

test('分组拖动临时收起页面，取消时恢复；保存失败保留原顺序，筛选时禁用拖动', async () => {
  const view = await expandedFixture();
  const node = predicate => view.nodes(view.render(), predicate)[0];
  const groupHandle = () => node(entry => entry.props?.['aria-label'] === '拖动分组“甲”');
  const groupTarget = () => node(entry => entry.props?.['data-route-order-group'] === '页面访问::乙');
  assert.ok(groupHandle(), '需要分组拖动手柄');
  groupHandle().props.onDragStart(dragEvent());
  assert.equal(node(entry => entry.props?.['data-route-order-item'] === 'a1'), undefined);
  groupHandle().props.onDragEnd();
  assert.ok(node(entry => entry.props?.['data-route-order-item'] === 'a1'));
  assert.equal(view.pending.length, 0);
  groupHandle().props.onDragStart(dragEvent());
  groupTarget().props.onDragOver(dragEvent());
  assert.equal(groupTarget().props['data-drop-placement'], 'after');
  groupTarget().props.onDrop(dragEvent());
  assert.deepEqual(view.pending[0].ids, ['b1', 'b2', 'a1', 'a2']);
  view.pending[0].reject(new Error('暂时无法保存，请重试'));
  await settle();
  assert.ok(node(entry => entry.props?.role === 'alert' && entry.props.children === '暂时无法保存，请重试'));
  assert.equal(node(entry => entry.props?.['aria-label'] === '上移分组“甲”').props.disabled, true);
  node(entry => entry.props?.id === 'route-catalog-search').props.onChange({ target: { value: 'a1' } });
  const filteredHandle = node(entry => entry.props?.['aria-label'] === '拖动页面“a1”');
  assert.equal(filteredHandle.props.draggable, false);
  const start = dragEvent();
  filteredHandle.props.onDragStart(start);
  assert.equal(start.prevented, true);
});
