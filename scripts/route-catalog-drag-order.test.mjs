import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/app/lib/routeCatalogOrder.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = {};
new Function('exports', code)(model);

const page = (id, groupLabel, sortOrder, extra = {}) => ({ id, type: 'page', groupLabel, sortOrder, createdAt: '2026-09-20', ...extra });
const items = [
  page('a3', '页面访问 · 甲', 30),
  page('c1', '页面访问 · 丙', 60),
  page('a1', '页面访问 · 甲', 10),
  page('b1', '页面访问 · 乙', 40),
  page('a2', '页面访问 · 甲', 20, { navHidden: true, enabled: false }),
  page('b2', '页面访问 · 乙', 50),
  page('other', '其他页面 · 甲', 70),
  page('action', '操作权限 · 甲', 1, { type: 'action' }),
];
const target = (branch, itemId) => ({ branchKey: `页面访问::${branch}`, ...(itemId === undefined ? {} : { itemId }) });

test('页面可跨多个位置插入目标前后，保留全部页面且不修改源目录', () => {
  const before = structuredClone(items);
  assert.deepEqual(model.dropRoutePages(items, target('甲', 'a1'), target('甲', 'a3'), 'after'), ['a2', 'a3', 'a1', 'b1', 'b2', 'c1', 'other']);
  assert.deepEqual(model.dropRoutePages(items, target('甲', 'a1'), target('甲', 'a3'), 'before'), ['a2', 'a1', 'a3', 'b1', 'b2', 'c1', 'other']);
  assert.deepEqual(model.dropRoutePages(items, target('甲', 'a3'), target('甲', 'a1'), 'before'), ['a3', 'a1', 'a2', 'b1', 'b2', 'c1', 'other']);
  assert.deepEqual(model.dropRoutePages(items, target('甲', 'a3'), target('甲', 'a1'), 'after'), ['a1', 'a3', 'a2', 'b1', 'b2', 'c1', 'other']);
  assert.deepEqual(items, before);
});

test('分组拖动整体移动所有页面，组内顺序及其他根目录不变', () => {
  assert.deepEqual(model.dropRoutePages(items, target('甲'), target('丙'), 'after'), ['b1', 'b2', 'c1', 'a1', 'a2', 'a3', 'other']);
  assert.deepEqual(model.dropRoutePages(items, target('丙'), target('甲'), 'before'), ['c1', 'a1', 'a2', 'a3', 'b1', 'b2', 'other']);
  assert.deepEqual(model.dropRoutePages(items, target('甲'), target('丙'), 'before'), ['b1', 'b2', 'a1', 'a2', 'a3', 'c1', 'other']);
});

test('自身、相邻无变化、无效和跨层级跨分组目标不产生保存顺序', () => {
  for (const [source, destination, placement] of [
    [target('甲', 'a1'), target('甲', 'a1'), 'after'],
    [target('甲', 'a1'), target('甲', 'a2'), 'before'],
    [target('甲', 'a2'), target('甲', 'a1'), 'after'],
    [target('甲'), target('甲'), 'before'],
    [target('甲'), target('乙'), 'before'],
    [target('乙'), target('甲'), 'after'],
    [target('甲', 'a1'), target('乙', 'b1'), 'before'],
    [target('甲'), { branchKey: '其他页面::甲' }, 'before'],
    [target('甲'), target('甲', 'a1'), 'before'],
    [target('甲', 'a1'), target('甲'), 'before'],
    [target('不存在'), target('甲'), 'before'],
    [target('甲'), target('不存在'), 'before'],
    [target('甲', '不存在'), target('甲', 'a1'), 'before'],
    [target('甲', 'a1'), target('甲', '不存在'), 'before'],
    [target('甲', 'b1'), target('甲', 'a1'), 'before'],
    [{ branchKey: '操作权限::甲', itemId: 'action' }, target('甲', 'a1'), 'before'],
  ]) assert.equal(model.dropRoutePages(items, source, destination, placement), null);
});
