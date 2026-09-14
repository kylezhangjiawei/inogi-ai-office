import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const componentCode = compile('src/app/procurement/components/MaterialPurchaseOrderLines.tsx');
const apiCode = compile('src/app/lib/orderProcessingApi.ts');
const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
const components = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? [tree.type === 'AutoTranslatedText' ? tree.props.text : '', text(tree.props?.children)].join(' ') : '';
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function row(id = 'line-1', overrides = {}) {
  return { id, orderNo: `PO-${id}`, lineNo: '1', inventoryCode: 'A08-072', inventoryName: '分子筛原料', spec: 'JLOX-101SMC', unit: 'kg',
    orderedQty: 100, receivedQty: 20, etaDate: '2026-09-13', orderDate: '2026-09-09', supplierName: '订单供应商',
    approvalStatus: '已审核', status: '已关闭', syncedAt: '2026-09-10T08:00:00Z', availability: null, ...overrides };
}
function confirmation(overrides = {}) {
  return { availableDate: '2026-09-15', note: '检验需要两天', confirmedByName: '采购经办', confirmedAt: '2026-09-10T09:00:00Z', version: 2, needsReconfirmation: false, ...overrides };
}
function response(code = 'A08-072', items = [row()], overrides = {}) {
  return { inventoryCode: code, source: 'tplus', readOnly: true,
    lines: { items, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...overrides } };
}

function fixture({ code = 'A08-072', permissions = ['page:purchase-order-detail'], reply = async (params) => response(params.inventoryCode, [row('line-1', { inventoryCode: params.inventoryCode })]) } = {}) {
  const requests = [], opened = [], slots = [];
  let slot = 0, pendingEffects = [], tree;
  const same = (first, second) => Boolean(first && second && first.length === second.length && first.every((value, index) => Object.is(value, second[index])));
  const react = {
    useState(initial) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = slot++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = slot++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = slot++; const previous = slots[index];
      if (!same(previous?.deps, deps)) pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../hooks/usePermission': { usePermission: (name) => permissions.includes(name), useAnyPermission: (...names) => names.some((name) => permissions.includes(name)) },
    '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '../../lib/orderProcessingApi': { orderProcessingApi: { getMaterialPurchaseOrderLines: async (params, signal) => { requests.push({ params, signal }); return reply(params, signal); } } },
  };
  const exports = {};
  new Function('exports', 'require', componentCode)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/'), `Unexpected dependency ${name}`);
    return components;
  });
  const api = {
    requests, opened,
    render() { slot = 0; pendingEffects = []; tree = exports.MaterialPurchaseOrderLines({ inventoryCode: code, onOpenOrderLine: (...args) => opened.push(args) });
      const effects = pendingEffects; pendingEffects = []; effects.forEach((effect) => effect()); return tree; },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return api.render(); },
    tree: () => tree, text: () => text(tree),
    button(label) { return elements(tree).find((node) => node.type === 'Button' && (node.props['aria-label'] === label || text(node).trim() === label)); },
    actions: () => elements(tree).filter((node) => node.type === 'Button' && node.props['aria-label']?.startsWith('查看采购订单')),
    click(label) { const button = api.button(label); assert.ok(button, `${label} should exist`); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); return api.render(); },
    setCode(next) { code = next; return api.render(); },
    setPermissions(next) { permissions = next; return api.render(); },
    setReply(next) { reply = next; },
    unmount() { for (const entry of slots) entry?.cleanup?.(); },
  };
  api.render();
  return api;
}

test('无读取权限或缺编码均不发请求，代码存在时不依赖 BOM 用量', async () => {
  const denied = fixture({ permissions: [] }); await denied.settle();
  assert.equal(denied.requests.length, 0); assert.match(denied.text(), /暂无采购订单查看权限/);
  const missing = fixture({ code: '  ' }); await missing.settle();
  assert.equal(missing.requests.length, 0); assert.match(missing.text(), /物料编码待补充/);
  const coded = fixture({ code: ' A08-072 ' }); await coded.settle();
  assert.deepEqual(coded.requests[0].params, { inventoryCode: 'A08-072', page: 1, pageSize: 10 });
  assert.equal(coded.actions().length, 1);
});

test('列表权限可读取并看确认信息，但只有详情权限提供订单行入口', async () => {
  for (const permissions of [['page:purchase-orders'], ['page:purchase-order-detail']]) {
    const panel = fixture({ permissions, reply: async () => response('A08-072', [row('confirmed', { availability: confirmation() })]) });
    await panel.settle();
    assert.equal(panel.requests.length, 1);
    assert.match(panel.text(), /采购经办/); assert.match(panel.text(), /检验需要两天/);
    assert.equal(panel.actions().length, permissions.includes('page:purchase-order-detail') ? 1 : 0);
    if (panel.actions().length) { panel.actions()[0].props.onClick(); assert.deepEqual(panel.opened, [['PO-confirmed', 'confirmed']]); }
  }
});

test('保留历史 ERP 状态，分别展示四种人工日期状态及原始数量', async () => {
  const rows = [row('new', { orderedQty: 0, receivedQty: 0 }), row('confirmed', { availability: confirmation() }),
    row('revoked', { availability: confirmation({ availableDate: null, note: '供应商改期，已撤销' }) }),
    row('changed', { availability: confirmation({ needsReconfirmation: true }) })];
  const panel = fixture({ reply: async () => response('A08-072', rows) }); await panel.settle();
  for (const label of ['未确认', '已确认', '已撤销', '需重确认', '已关闭', 'ERP 已到货', '采购量', '2026-09-13', '2026-09-15', '同编码订单记录，不代表本计划已获配数量；不参与当前齐套计算。']) assert.ok(panel.text().includes(label), label);
  assert.equal(panel.actions().length, 4);
  assert.match(panel.text(), /0\s+kg/);
  assert.doesNotMatch(panel.text(), /未验收量|建议新增量|剩余量/);
});

test('初次及刷新中显示读取状态，刷新时旧订单入口立即消失', async () => {
  const initial = deferred();
  const panel = fixture({ reply: () => initial.promise });
  assert.match(panel.text(), /正在读取同编码订单/);
  assert.equal(panel.button('刷新当前物料的采购订单').props.disabled, true);
  assert.equal(panel.actions().length, 0);
  initial.resolve(response()); await panel.settle();
  const refreshed = deferred(); panel.setReply(() => refreshed.promise);
  panel.click('刷新当前物料的采购订单');
  assert.equal(panel.actions().length, 0); assert.match(panel.text(), /正在读取/);
  refreshed.resolve(response('A08-072', [row('latest')])); await panel.settle();
  assert.match(panel.text(), /PO-latest/);
});

test('切换物料立即隐藏旧行且重置到第 1 页，旧响应不能覆盖新编码结果', async () => {
  const initial = deferred();
  const panel = fixture({ reply: () => initial.promise });
  const oldAction = panel.requests[0];
  panel.setReply(async (params) => response(params.inventoryCode, [row('new-code', { inventoryCode: params.inventoryCode })]));
  panel.setCode('A07/033'); await panel.settle();
  assert.equal(oldAction.signal.aborted, true);
  assert.deepEqual(panel.requests[1].params, { inventoryCode: 'A07/033', page: 1, pageSize: 10 });
  initial.resolve(response('A08-072', [row('old-code')])); await panel.settle();
  assert.match(panel.text(), /PO-new-code/); assert.doesNotMatch(panel.text(), /PO-old-code/);
});

test('分页按响应页码与总数展示，翻页或切编码期间不保留旧入口', async () => {
  const panel = fixture({ reply: async (_params) => response('A08-072', [row('page-one')], { total: 11, totalPages: 2 }) });
  await panel.settle();
  assert.match(panel.text(), /第 1 \/ 2 页，共 11 行/);
  assert.equal(panel.button('上一页采购订单行').props.disabled, true);
  const pending = deferred(); panel.setReply(() => pending.promise);
  panel.click('下一页采购订单行');
  assert.equal(panel.actions().length, 0); assert.equal(panel.requests.at(-1).params.page, 2);
  pending.resolve(response('A08-072', [row('page-two')], { page: 2, total: 11, totalPages: 2 })); await panel.settle();
  assert.match(panel.text(), /第 2 \/ 2 页，共 11 行/);
  assert.equal(panel.button('下一页采购订单行').props.disabled, true);
  panel.setReply(async (params) => response(params.inventoryCode, []));
  panel.setCode('A01-NEW'); await panel.settle();
  assert.equal(panel.requests.at(-1).params.page, 1);
});

test('页码被后端钳制时按实际响应展示，不制造空白多余页面', async () => {
  const panel = fixture({ reply: async () => response('A08-072', [row()], { total: 11, totalPages: 2 }) }); await panel.settle();
  panel.setReply(async () => response('A08-072', [row('remaining')], { page: 1, total: 1, totalPages: 1 }));
  panel.click('下一页采购订单行'); await panel.settle();
  assert.match(panel.text(), /第 1 \/ 1 页，共 1 行/);
  assert.equal(panel.button('上一页采购订单行').props.disabled, true);
  assert.equal(panel.button('下一页采购订单行').props.disabled, true);
});

test('并发刷新时旧失败与旧 finally 不清空最新成功结果', async () => {
  const panel = fixture(); await panel.settle();
  const refresh = panel.button('刷新当前物料的采购订单').props.onClick;
  const old = deferred(), latest = deferred();
  panel.setReply(() => old.promise); refresh(); panel.render();
  panel.setReply(() => latest.promise); refresh(); panel.render();
  latest.resolve(response('A08-072', [row('newest')])); await panel.settle();
  old.reject(new Error('旧请求失败')); await panel.settle();
  assert.match(panel.text(), /PO-newest/); assert.doesNotMatch(panel.text(), /旧请求失败/);
  assert.equal(panel.button('刷新当前物料的采购订单').props.disabled, false);
});

test('响应顶层或行级编码不一致都显示错误，不展示可操作的错误订单', async () => {
  for (const badResponse of [response('OTHER', [row()]), response('A08-072', [row('wrong', { inventoryCode: 'OTHER' })])]) {
    const panel = fixture({ reply: async () => badResponse }); await panel.settle();
    assert.match(panel.text(), /返回的物料编码与当前物料不一致/);
    assert.equal(panel.actions().length, 0);
    assert.ok(panel.button('重新读取采购订单'));
  }
});

test('刷新失败后仅显示局部错误与重试，不保留上一次可操作记录', async () => {
  const panel = fixture(); await panel.settle();
  panel.setReply(async () => { throw new Error('订单服务暂不可用'); });
  panel.click('刷新当前物料的采购订单'); await panel.settle();
  assert.match(panel.text(), /订单服务暂不可用/); assert.equal(panel.actions().length, 0);
  panel.setReply(async () => response('A08-072', [row('recovered')]));
  panel.click('重新读取采购订单'); await panel.settle();
  assert.match(panel.text(), /PO-recovered/); assert.doesNotMatch(panel.text(), /暂不可用/);
});

test('空结果仅说明无已同步记录，不误报没有采购安排', async () => {
  const panel = fixture({ reply: async () => response('A08-072', []) }); await panel.settle();
  assert.match(panel.text(), /暂无同编码订单记录/);
  assert.match(panel.text(), /不代表该物料没有采购安排/);
  assert.equal(panel.actions().length, 0); assert.ok(panel.button('刷新当前物料的采购订单'));
});

test('读取中撤销权限或卸载会取消请求，迟到结果不再展示', async () => {
  const pending = deferred(); const panel = fixture({ reply: () => pending.promise });
  panel.setPermissions([]);
  assert.equal(panel.requests[0].signal.aborted, true);
  pending.resolve(response()); await panel.settle();
  assert.match(panel.text(), /暂无采购订单查看权限/); assert.equal(panel.actions().length, 0);
  const unmount = deferred(); const second = fixture({ reply: () => unmount.promise }); second.unmount();
  assert.equal(second.requests[0].signal.aborted, true);
  unmount.resolve(response()); await second.settle();
  assert.equal(second.actions().length, 0);
});

test('真实 API 仅用编码与分页查询行级记录，斜杠按 URLSearchParams 编码并传递取消信号', async () => {
  const requests = [];
  const exports = {};
  new Function('exports', 'require', apiCode)(exports, (name) => {
    assert.equal(name, './authSession');
    return { authFetch: async (path, init) => { requests.push({ path, init }); return { ok: true, json: async () => response('A07/033') }; }, readErrorMessage: async () => '失败' };
  });
  const controller = new AbortController();
  await exports.orderProcessingApi.getMaterialPurchaseOrderLines({ inventoryCode: 'A07/033', page: 2, pageSize: 10 }, controller.signal);
  assert.equal(requests[0].path, '/api/procurement/tplus/views/purchase-order-lines?inventoryCode=A07%2F033&page=2&pageSize=10');
  assert.equal(requests[0].init.signal, controller.signal);
  assert.equal(requests[0].init.body, undefined);
});
