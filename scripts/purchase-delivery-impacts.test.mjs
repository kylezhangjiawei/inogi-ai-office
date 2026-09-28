import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => (Array.isArray(tree) ? tree.map(text).join(' ') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree)).replace(/\s+/g, ' ');
const source = readFileSync(new URL('../src/app/procurement/delivery/PurchaseOrderDeliveryImpacts.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const actor = { id: 'planner-A', permissions: ['page:purchase-order-detail', 'page:production-execution', 'production:view-all'] };
const row = { scopeId: 'real-plan:batch:real-batch', planId: 'real-plan', month: '2026-09', productName: '原产品', productLine: 'Q7', batchId: 'real-batch', batchCode: 'B-0920', needDate: '2026-09-25', unit: '件', assignedQty: 15, availableDate: '2026-09-28', effectiveQty: 15, onTimeQty: 0, delayDays: 3, status: 'late', note: '当前正式依据' };
const response = (extra = {}) => ({ lineId: 'line-A', orderNo: 'PO-A', page: 1, pageSize: 10, total: 1, totalPages: 1, items: [row], unresolvedCount: 0, readAt: '2026-09-20T10:00:00.000Z', notice: '仅原登记关系', ...extra });
function fixture() {
  let user = actor, cursor = 0, dirty = false;
  const slots = [], effects = [], requests = [], out = {};
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }]; },
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, n) => !Object.is(value, prior.deps[n]))) { slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  new Function('exports', 'require', code)(out, key => {
    if (key === 'react') return hooks;
    if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (key === 'react-router') return { Link: 'Link' };
    if (key.endsWith('/auth')) return { useAuth: () => ({ user }) };
    if (key.endsWith('/purchaseDeliveryApi')) return { getPurchaseDeliveryImpacts: (lineId, orderNo, page, signal) => new Promise((resolve, reject) => requests.push({ lineId, orderNo, page, signal, resolve, reject })) };
    if (key.endsWith('/routePaths')) return { routePath: (_, fallback) => fallback };
    if (key.includes('/components/ui/')) return new Proxy({}, { get: (_, name) => name });
    throw new Error(key);
  });
  const f = {
    props: { lineId: 'line-A', orderNo: 'PO-A', refreshKey: 'source1' }, requests,
    render() { for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; f.tree = out.PurchaseOrderDeliveryImpacts(f.props); while (effects.length) effects.shift()(); if (!dirty) return f; } assert.fail('unsettled render'); },
    toggle(open) { f.tree.props.onToggle({ currentTarget: { open } }); return f.render(); },
    button(label) { return nodes(f.tree).find(node => node.type === 'Button' && text(node).trim() === label); },
    click(label) { const button = f.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label); button.props.onClick(); return f.render(); },
    links() { return nodes(f.tree).filter(node => node.type === 'Link'); },
    user(value) { user = value; return f.render(); },
    async resolve(index, value) { requests[index].resolve(value); await new Promise(resolve => setImmediate(resolve)); return f.render(); },
    async reject(index, error) { requests[index].reject(error); await new Promise(resolve => setImmediate(resolve)); return f.render(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  }; return f;
}
test('影响范围仅双重读取权限可见，折叠不请求，撤销权限隐藏数据且取消读取', async () => {
  const f = fixture().render(); assert.equal(f.requests.length, 0); f.toggle(true); assert.equal(f.requests.length, 1); await f.resolve(0, response()); assert.match(text(f.tree), /原产品/);
  f.user({ id: 'buyer', permissions: ['page:purchase-order-detail'] }); assert.equal(f.tree, null); assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.requests.length, 1);
  f.user({ id: 'rd', permissions: ['page:production-execution', 'production:view-all'] }); assert.equal(f.tree, null); f.dispose();
});
test('按真实日期与数量区分延期和未知，正式齐套链接精确带产品月份计划批次', async () => {
  const f = fixture().render().toggle(true); await f.resolve(0, response()); assert.match(text(f.tree), /0 件 · 晚于需求 3 天/);
  const link = f.links()[0], url = new URL(link.props.to, 'http://local'); assert.equal(link.props.target, '_blank'); assert.equal(url.pathname, '/production-execution');
  assert.equal(url.searchParams.get('month'), '2026-09'); assert.equal(url.searchParams.get('plan'), 'real-plan'); assert.equal(url.searchParams.get('readinessBatch'), 'real-batch'); assert.equal(url.searchParams.get('view'), 'readiness');
  f.click('重新核对影响'); await f.resolve(1, response({ items: [{ ...row, batchId: null, batchCode: null, needDate: null, effectiveQty: null, onTimeQty: null, delayDays: null, status: 'pending' }] }));
  assert.match(text(f.tree), /有效 待核对/); assert.doesNotMatch(text(f.tree), /0 件/); assert.equal(new URL(f.links()[0].props.to, 'http://local').searchParams.has('readinessBatch'), false); f.dispose();
});
test('分页只读下一页，重新读取失败提供重试且不伪造空数据', async () => {
  const f = fixture().render().toggle(true); await f.resolve(0, response({ total: 11, totalPages: 2 })); f.click('下一页'); assert.equal(f.requests[1].page, 2); assert.equal(f.links().length, 0);
  await f.resolve(1, response({ page: 2, total: 11, totalPages: 2, unresolvedCount: 2 })); assert.equal(f.button('下一页').props.disabled, true); assert.match(text(f.tree), /另有 2 项/);
  f.click('重新核对影响'); await f.reject(2, new Error('原依据暂不可用')); assert.match(text(f.tree), /原依据暂不可用/); assert.doesNotMatch(text(f.tree), /暂无已明确分配/);
  f.click('重新核对影响'); await f.resolve(3, response({ total: 0, items: [] })); assert.match(text(f.tree), /暂无已明确分配/); f.dispose();
});
test('订单、来源版本和账号变化即时清空旧记录，晚响应无法填入新范围，关闭取消读取', async () => {
  const f = fixture().render().toggle(true); f.props = { ...f.props, lineId: 'line-B', orderNo: 'PO-B' }; f.render(); assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.requests[1].lineId, 'line-B');
  await f.resolve(0, response()); assert.equal(f.links().length, 0); await f.resolve(1, response({ lineId: 'line-B', orderNo: 'PO-B' }));
  f.props.refreshKey = 'source2'; f.render(); assert.equal(f.links().length, 0); assert.equal(f.requests.length, 3);
  f.user({ ...actor, id: 'planner-B' }); assert.equal(f.requests[2].signal.aborted, true); assert.equal(f.requests.length, 4); await f.resolve(2, response()); assert.equal(f.links().length, 0);
  f.toggle(false); assert.equal(f.requests[3].signal.aborted, true); await f.resolve(3, response()); assert.equal(f.links().length, 0); f.dispose();
});

test('只读 API 精确编码原行与原单，拒绝跨单、损坏日期/分页与负数量响应', async () => {
  let value = response(); const requests = [], api = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../src/app/lib/purchaseDeliveryApi.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', compiled)(api, key => { assert.equal(key, './authSession'); return { authFetch: async (url, options) => { requests.push({ url, options }); return Response.json(value); }, readErrorMessage: async () => '错误' }; });
  await api.getPurchaseDeliveryImpacts('line-A', 'PO-A', 2); const url = new URL(requests[0].url, 'http://local'); assert.equal(url.pathname, '/api/procurement/delivery/lines/line-A/impacts'); assert.equal(url.searchParams.get('orderNo'), 'PO-A'); assert.equal(url.searchParams.get('page'), '2'); assert.equal(requests[0].options.method, undefined);
  for (const edit of [d => { d.orderNo = 'PO-other'; }, d => { d.lineId = 'other'; }, d => { d.items[0].effectiveQty = -1; }, d => { d.items[0].availableDate = '2026-02-30'; }, d => { d.items[0].month = '2026-13'; }, d => { d.total = 2; }]) { value = structuredClone(response()); edit(value); await assert.rejects(api.getPurchaseDeliveryImpacts('line-A', 'PO-A'), /关联无效/); }
});
