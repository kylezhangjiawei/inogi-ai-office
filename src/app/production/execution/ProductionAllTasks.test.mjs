import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, require = () => ({})) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; new Function('exports', 'require', code)(exports, require); return exports;
}
const states = load('./productionViewState.ts');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : tree == null ? '' : String(tree);
const flush = () => new Promise(resolve => setImmediate(resolve));
const task = { id: 'task1', batchId: 'b1', name: '整机装配', line: '一线', ownerId: 'worker', ownerName: '现场甲', status: 'draft', date: '2026-10-09', quantity: 10, unit: '台', reports: [], inspections: [], fieldIssues: [] };
const plan = { id: 'p1', version: 1, productLine: 'Q7', month: '2026-10', batches: [{ id: 'b1', code: 'B01' }], tasks: [task] };
const change = { id: 'e1', code: 'ECN-01', status: 'published', batchIds: ['b1'], effectiveDate: '2026-10-10', acknowledgments: [] };
const transfer = { id: 't1', code: 'TP-01', type: 'validation', status: 'draft', authorId: 'author' };

function fixture({ userId = 'worker', permissions = ['page:production-execution'], data = { changes: [change], transfers: [transfer] }, read } = {}) {
  let cursor = 0, params = new URLSearchParams('view=all-tasks&plan=p1');
  const slots = [], effects = [], cleanups = [], calls = [], user = { id: userId, name: '现场甲', roleId: 'role1', permissions };
  const jsx = (type, props) => ({ type, props: props || {} });
  const component = load('./ProductionAllTasks.tsx', name => {
    if (name === 'react') return {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i][index])) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); }); } },
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-router') return { Link: 'Link', useSearchParams: () => [params, update => { params = typeof update === 'function' ? update(params) : update; }] };
    if (name === '../../auth') return { useAuth: () => ({ user }) };
    if (name.includes('productionLifecycleApi')) return { getLifecycle: (id, signal) => { calls.push({ id, signal }); return read ? read(id, signal) : Promise.resolve(data); } };
    if (name.includes('productionViewState')) return states;
    return new Proxy({}, { get: (_, key) => key });
  }).ProductionAllTasks;
  return { calls, user, render(plans = [plan]) { cursor = 0; const tree = component({ plans }); while (effects.length) effects.shift()(); return tree; }, filter(kind) { params.set('allKind', kind); }, params, destroy() { cleanups.forEach(cleanup => cleanup?.()); } };
}

test('P06 单计划读取一次，只列本人未确认 ECN 并跳转原变更，不汇总为生产数量', async () => {
  const f = fixture({ data: { changes: [change, { ...change, id: 'e2', acknowledgments: [{ actorId: 'worker' }] }, { ...change, id: 'e3', status: 'draft' }, { ...change, id: 'e4', batchIds: ['other'] }], transfers: [] } });
  f.render(); await flush(); f.filter('ecn');
  const tree = f.render(); f.render();
  assert.equal(f.calls.length, 1);
  assert.equal(nodes(tree).find(node => node.type === 'ProductionPagination').props.total, 1);
  assert.match(text(tree), /生效日期/); assert.doesNotMatch(text(nodes(tree).find(node => node.type === 'aside')), /计划数量|待检数量|不良数量/);
  const href = new URLSearchParams(nodes(tree).find(node => node.type === 'Link').props.to.slice(1));
  assert.equal(href.get('plan'), 'p1'); assert.equal(href.get('view'), 'ecn'); assert.equal(href.get('record'), 'e1'); assert.equal(href.get('recordType'), 'ecn'); assert.equal(href.has('task'), false);
  f.destroy(); assert.equal(f.calls[0].signal.aborted, true);
});

test('P06 转产待办按独立验证与发布权限过滤，编制人不能成为自身验证待办', async () => {
  const transfers = [transfer, { ...transfer, id: 'self', authorId: 'worker' }, { ...transfer, id: 'ready', code: 'TP-READY', status: 'validated' }, { ...transfer, id: 'published', status: 'published' }, { ...transfer, id: 'exploration', type: 'exploration' }];
  for (const [permission, expected, action, recordId] of [['production:release', 1, '查看并独立验证', 't1'], ['production:transfer', 1, '查看并发布资料', 'ready']]) {
    const f = fixture({ permissions: ['page:production-execution', permission], data: { changes: [], transfers } });
    f.filter('transfer'); f.render(); await flush(); const tree = f.render();
    assert.equal(nodes(tree).find(node => node.type === 'ProductionPagination').props.total, expected);
    const link = nodes(tree).find(node => node.type === 'Link'); assert.equal(text(link), action);
    const href = new URLSearchParams(link.props.to.slice(1)); assert.equal(href.get('record'), recordId); assert.equal(href.get('recordType'), 'transfer'); assert.equal(href.get('view'), 'transfer');
    f.destroy();
  }
});

test('P06 跨计划和无权读取不请求生命周期；读取失败保留原派工并允许单独重试', async () => {
  const multi = fixture(); assert.match(text(multi.render([plan, { ...plan, id: 'p2' }])), /选择单一计划/); assert.equal(multi.calls.length, 0);
  for (const permissions of [[], ['production:release']]) {
    const denied = fixture({ permissions }); denied.render(); assert.equal(denied.calls.length, 0);
  }
  const unrelated = fixture({ userId: 'unrelated' }); unrelated.render(); assert.equal(unrelated.calls.length, 0);
  const failed = fixture({ read: async () => { throw new Error('读取暂不可用'); } });
  failed.render(); await flush(); const tree = failed.render();
  assert.match(text(tree), /已有任务仍可查看/); assert.match(text(tree), /整机装配/);
  assert.equal(nodes(tree).find(node => node.type === 'ProductionPagination').props.total, 1);
  nodes(tree).find(node => node.type === 'Button' && text(node) === '重新读取补充待办').props.onClick(); failed.render(); await flush(); assert.equal(failed.calls.length, 2);
  failed.destroy();
});

test('P06 计划或权限切换立即隐藏旧结果并取消旧读取，迟到结果不能串入新范围', async () => {
  let resolve;
  const f = fixture({ read: () => new Promise(done => { resolve = done; }) });
  f.filter('ecn'); f.render();
  f.user.permissions = []; const tree = f.render(); assert.equal(f.calls[0].signal.aborted, true); assert.doesNotMatch(text(tree), /ECN-01/);
  resolve({ changes: [change], transfers: [] }); await flush(); assert.doesNotMatch(text(f.render()), /ECN-01/);
  f.destroy();
});
