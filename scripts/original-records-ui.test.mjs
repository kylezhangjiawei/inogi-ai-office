import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
const primitives = new Proxy({}, { get: (_, key) => key });
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object' ? '' : React.Children.toArray(tree.props?.children).map(text).join(' ');
const nodes = (tree, predicate, out = []) => { if (!tree || typeof tree !== 'object') return out; if (predicate(tree)) out.push(tree); React.Children.forEach(tree.props?.children, child => nodes(child, predicate, out)); return out; };
function fixture(path, name) {
  let user = { id: 'A', permissions: ['page:production-execution'] }, cursor = 0, dirty = false;
  const slots = [], effects = [], requests = [], hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } },
    useMemo: callback => callback(),
  };
  const exports = {}, code = ts.transpileModule(readFileSync(new URL('../src/app/' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, key => {
    if (key === 'react') return hooks; if (key === 'react/jsx-runtime') return jsxRuntime; if (key === 'react-router') return { Link: 'Link' }; if (key.includes('/components/') || key === 'lucide-react') return primitives;
    if (key.endsWith('/auth')) return { useAuth: () => ({ user }) }; if (key.endsWith('/i18n')) return { useI18n: () => ({ t: value => value }) }; if (key.endsWith('/usePermission')) return { usePermission: permission => user.permissions.includes(permission) };
    if (key.endsWith('/relatedRecordsApi')) return { getMyOriginalRecords: signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), getRdOriginalRecords: (id, signal) => new Promise((resolve, reject) => requests.push({ id, signal, resolve, reject })) };
    throw new Error('unexpected ' + key);
  });
  const view = { requests, props: {}, render() { for (let i = 0; i < 15; i++) { dirty = false; cursor = 0; view.tree = exports[name](view.props); while (effects.length) effects.shift()(); if (!dirty) return view; } assert.fail('unsettled'); }, find: predicate => nodes(view.tree, predicate)[0], nodes: predicate => nodes(view.tree, predicate), user(next) { user = next; return view.render(); }, click(label) { const button = view.find(node => node.type === 'Button' && text(node).trim() === label); assert.ok(button, label); button.props.onClick(); return view.render(); }, change(label, value) { view.find(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); return view.render(); }, dispose() { slots.forEach(slot => slot?.cleanup?.()); } }; return view;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const result = { readAt: '2026-09-20', errors: [], items: Array.from({ length: 25 }, (_, i) => ({ id: String(i), kind: i % 2 ? 'quality' : 'production', title: '原任务' + i, code: 'P' + i, state: '待办理', owner: 'A', dueDate: null, detail: '待补资料', href: '/production-execution?plan=real&task=' + i })) };
test('个人原单待办真实分页和筛选，保留原链接与未确定期限', async () => {
  const view = fixture('dashboard/PersonalOriginalRecords.tsx', 'PersonalOriginalRecords').render(); view.requests[0].resolve(result); await settle(); view.render();
  assert.equal(view.nodes(node => node.type === 'Link').length, 12); assert.match(text(view.tree), /待确认/);
  view.click('下一页'); assert.equal(view.nodes(node => node.type === 'Link')[0].props.to, '/production-execution?plan=real&task=12');
  view.change('待办业务类型', 'quality'); assert.equal(view.nodes(node => node.type === 'Link').length, 12); assert.equal(view.nodes(node => node.type === 'Link')[0].props.to, '/production-execution?plan=real&task=1');
  view.change('搜索跨岗位待办', '原任务23'); assert.equal(view.nodes(node => node.type === 'Link').length, 1); view.dispose();
});
test('账号变化立即清空旧待办，旧响应无法覆盖新范围，部分来源失败不伪装完成', async () => {
  const view = fixture('dashboard/PersonalOriginalRecords.tsx', 'PersonalOriginalRecords').render(); const old = view.requests[0];
  view.user({ id: 'B', permissions: [] }); assert.equal(old.signal.aborted, true); old.resolve(result); await settle(); view.render(); assert.equal(view.nodes(node => node.type === 'Link').length, 0);
  view.requests[1].resolve({ ...result, items: [], errors: ['质量读取失败'] }); await settle(); view.render(); assert.match(text(view.tree), /质量读取失败/); assert.doesNotMatch(text(view.tree), /当前没有匹配的本人待办/); view.dispose();
});
test('研发原单按研发ID重查、切任务取消旧请求且仅渲染API授权的链接', async () => {
  const view = fixture('rd/RdOriginalRecordLinks.tsx', 'RdOriginalRecordLinks'); view.props = { rdTaskId: 'RD1' }; view.render(); view.props = { rdTaskId: 'RD2' }; view.render(); assert.equal(view.requests[0].signal.aborted, true);
  view.requests[0].resolve({ items: result.items }); view.requests[1].resolve({ items: [{ ...result.items[0], href: '/proc-cockpit?task=real&detail=1' }] }); await settle(); view.render();
  assert.equal(view.nodes(node => node.type === 'Link').length, 1); assert.equal(view.nodes(node => node.type === 'Link')[0].props.to, '/proc-cockpit?task=real&detail=1'); view.dispose();
});
test('库存事件表按原记录分页，未知批号不使用生产来源号代替，原记录链接受权限控制', () => {
  const view = fixture('order-processing/components/InventoryLedger.tsx', 'InventoryLedger'); view.props = { detail: { item: { id: 'M1', unit: '件', warehouses: [] }, movements: Array.from({ length: 15 }, (_, i) => ({ id: String(i), recordId: 'real-' + i, stockBatchNo: null, type: 'in', state: '已确认', action: 'receipt', qty: 2, unit: '件', operator: '仓管', note: '实收', time: '2026-09-20' })) } }; view.render(); assert.match(text(view.tree), /批号待补/); assert.equal(view.nodes(node => node.type === 'Link').length, 0);
  view.user({ id: 'A', permissions: ['page:warehouse-flow'] }); assert.equal(view.nodes(node => node.type === 'Link').length, 10); view.click('下一页'); assert.equal(view.nodes(node => node.type === 'Link')[0].props.to, '/warehouse-flow?warehouseView=records&record=real-10'); view.dispose();
});
