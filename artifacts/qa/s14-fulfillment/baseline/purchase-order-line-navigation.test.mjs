import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryRouter } from 'react-router';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', ...Object.keys(globals), code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, ...Object.values(globals));
  return exports;
}
const paths = (purchase = '/purchase-orders', readiness = '/proc-inventory-readiness', workspace = '/proc-my-workspace') => ({
  routePath: (permission, fallback) => permission === 'page:purchase-orders' ? purchase : permission === 'page:proc-inventory-readiness' ? readiness : permission === 'page:proc-my-workspace' ? workspace : fallback,
  subRoutePath: (_permission, _fallback, suffix) => `${purchase === '/' ? '' : purchase}/${suffix}`,
});
const lineHelpers = (routes = paths()) => load('src/app/lib/purchaseOrderLineNavigation.ts', { './routePaths': routes });
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
const primitives = new Proxy({}, { get: (_object, name) => name });
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : tree == null || typeof tree === 'boolean' ? ''
  : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const line = (id, lineNo = '01') => ({ id, lineNo, sku: 'SAME-SKU', name: '同编码物料', spec: 'M8', qty: 10, receivedQty: 2, unit: '个', unitPrice: 2, etaDate: '2026-09-14', sourceUpdatedAt: '2026-09-10T08:00:00.000Z' });
const order = (id = 'PO-001', items = [line('mirror-1'), line('mirror/2?x=1', '02')]) => ({ id, poNo: id, items, supplier: '供应商', buyer: '采购员', owner: '采购部', status: '部分到货', orderDate: '2026-09-01', etaDate: '2026-09-14', amount: 40, currency: 'CNY', itemCount: items.length, taskLinks: [] });
const returnPath = '/proc-inventory-readiness?productLine=Q5&targetSets=200&q=%E9%98%80&status=gap&page=3&pageSize=50&itemId=bom-42';

// Execute the real page, real route helpers, and real table DOM with React Router history.
// Only hooks, network responses, and visual dependencies are bounded fixtures.
function fixture(t, { target = '?lineId=mirror%2F2%3Fx%3D1', state = null, allowed = ['page:purchase-order-detail', 'page:proc-inventory-readiness', 'proc-purchase-order:confirm-availability'], response = async (id) => ({ order: order(id) }), orderNo = 'PO-001', initialEntries, routes = paths() } = {}) {
  const start = { pathname: `${routes.routePath('page:purchase-orders')}/${encodeURIComponent(orderNo)}`, search: target, state };
  const router = createMemoryRouter([{ path: `${routes.routePath('page:purchase-orders')}/:id`, element: null }, { path: '*', element: null }], { initialEntries: initialEntries ?? [start] });
  const slots = [], effects = [], callbacks = [];
  let cursor = 0, dirty = false, tree, currentResponse = response, currentPermissions = allowed;
  const changed = (before, next) => !before || !next || before.length !== next.length || next.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { const value = hooks.useMemo(() => fn, deps); callbacks.push(value); return value; },
    useEffect(fn, deps) { const index = cursor++, before = slots[index]; if (changed(before?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const body = { isConnected: true }, documentElement = { isConnected: true };
  const document = { body, documentElement, activeElement: body };
  const calls = { reads: [], focus: [], scroll: [], navigate: [] };
  const dom = new Map();
  const makeDom = (key, props) => {
    let element = dom.get(key);
    if (!element) {
      element = { isConnected: true, dataset: {}, focus(options) { document.activeElement = this; calls.focus.push({ key, options }); }, scrollIntoView(options) { calls.scroll.push({ key, options }); } };
      dom.set(key, element);
    }
    element.dataset = { purchaseOrderLineId: props['data-purchase-order-line-id'] };
    return element;
  };
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const table = load('src/app/components/ui/table.tsx', { react: hooks, 'react/jsx-runtime': runtime, './utils': { cn: (...values) => values.filter(Boolean).join(' ') } });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': runtime, 'lucide-react': primitives, sonner: { toast: { success() {} } },
    'react-router': { useLocation: () => router.state.location, useParams: () => router.state.matches.at(-1).params, useNavigate: () => (to, options) => { calls.navigate.push([to, options]); return router.navigate(to, options); } },
    '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
    '../../hooks/usePermission': { usePermission: (permission) => currentPermissions.includes(permission) },
    '../../lib/routePaths': routes,
    '../../lib/purchaseOrderLineNavigation': lineHelpers(routes),
    '../../lib/inventoryReadinessNavigation': load('src/app/lib/inventoryReadinessNavigation.ts', { './routePaths': routes }),
    '../../lib/stockPlanNavigation': load('src/app/lib/stockPlanNavigation.ts', { './routePaths': routes }),
    '../../lib/workspaceArrivalNavigation': load('src/app/lib/workspaceArrivalNavigation.ts', { './routePaths': routes }),
    '../../lib/orderProcessingApi': { orderProcessingApi: { getPurchaseOrder: async (id) => { calls.reads.push(id); return currentResponse(id); } } },
    './PurchaseOrders': { formatCurrency: (value) => String(value), statusBadgeClass: () => '' },
    '../../components/ui/table': table,
    '../../components/ui/button': primitives, '../../components/ui/badge': primitives, '../../components/TranslatableText': primitives,
    '../components/HorizonPage': primitives,
    '../components/PurchaseReceiptDrawer': { PurchaseReceiptDrawer: 'PurchaseReceiptDrawer' },
    '../components/PurchaseOrderHistoryDrawer': { PurchaseOrderHistoryDrawer: 'PurchaseOrderHistoryDrawer' },
    '../components/PurchaseOrderAvailabilityDialog': { PurchaseOrderAvailabilityDialog: 'PurchaseOrderAvailabilityDialog', availabilityConfirmedAt: (value) => value },
  };
  const { PurchaseOrderDetail } = load('src/app/order-processing/pages/PurchaseOrderDetail.tsx', dependencies, { document });
  const view = {
    router, calls, document,
    render() {
      for (let count = 0; count < 20; count++) {
        cursor = 0; dirty = false; callbacks.length = 0;
        tree = PurchaseOrderDetail();
        const rendered = nodes(tree), connected = new Set();
        const rows = rendered.filter((node) => node.type === 'tr' && node.props['data-purchase-order-line-id']).map((node) => {
          const key = `row:${router.state.location.pathname}:${node.props['data-purchase-order-line-id']}`;
          connected.add(key); return makeDom(key, node.props);
        });
        for (const node of rendered) {
          const ref = node.props.ref;
          if (node.type === 'div' && ref && typeof ref === 'object') ref.current = { querySelectorAll(selector) { assert.equal(selector, 'tr[data-purchase-order-line-id]'); return rows; } };
          if (node.type === 'Button' && typeof ref === 'function') {
            const key = `button:${router.state.location.pathname}:${node.props['aria-label']}`;
            connected.add(key); ref(makeDom(key, node.props));
          }
        }
        for (const [key, element] of dom) if (!connected.has(key)) { element.isConnected = false; dom.delete(key); }
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      assert.fail('Detail did not settle');
    },
    async flush() { this.render(); await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
    async reload() { const result = callbacks[0](); this.render(); await result; return this.flush(); },
    find(predicate) { return nodes(this.render()).find(predicate); },
    button(label) { return this.find((node) => node.type === 'Button' && (node.props['aria-label'] === label || text(node).trim() === label)); },
    dialog() { return this.find((node) => node.type === 'PurchaseOrderAvailabilityDialog'); },
    highlighted() { return nodes(this.render()).filter((node) => node.type === 'tr' && node.props['aria-current'] === 'true'); },
    setResponse(fn) { currentResponse = fn; },
    setPermissions(next) { currentPermissions = next; return this.render(); },
    open(lineLabel = '02') {
      const button = this.find((node) => node.type === 'Button' && node.props['aria-label']?.startsWith(`确认订单行 ${lineLabel} `));
      const key = `button:${router.state.location.pathname}:${button.props['aria-label']}`;
      const element = dom.get(key); document.activeElement = element;
      button.props.onClick({ currentTarget: element }); this.render(); return this.dialog();
    },
  };
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); router.dispose(); });
  view.render();
  return view;
}

test('配置路径与订单号、镜像行 ID 分别编码，并拒绝无法安全构成目标的值', () => {
  const helper = lineHelpers(paths('/supply/orders'));
  assert.equal(helper.buildPurchaseOrderLinePath('PO/%2F?甲', 'mirror/2?x=1'), '/supply/orders/PO%2F%252F%3F%E7%94%B2?lineId=mirror%2F2%3Fx%3D1');
  assert.equal(helper.purchaseOrderIdFromPathname('/supply/orders/PO%2F%252F%3F%E7%94%B2/'), 'PO/%2F?甲');
  assert.equal(helper.purchaseOrderIdFromPathname('/purchase-orders/PO-01'), null);
  assert.equal(helper.purchaseOrderIdFromPathname('/supply/orders/PO-01/other'), null);
  for (const value of ['', ' ', ' id', '\u0000', 'x'.repeat(257), '\ud800']) assert.equal(helper.buildPurchaseOrderLinePath('PO-01', value), null);
  assert.equal(helper.buildPurchaseOrderLinePath('..', 'mirror-1'), null);
});

test('目标只接受唯一明确镜像 ID；重复参数、空白、同 SKU 和行号不能替代', () => {
  const helper = lineHelpers();
  const lines = [line('mirror-1'), line('mirror-2')];
  assert.deepEqual(helper.purchaseOrderLineTarget('?lineId=mirror%2F2%3Fx%3D1'), { requested: true, lineId: 'mirror/2?x=1' });
  assert.deepEqual(helper.purchaseOrderLineTarget(''), { requested: false, lineId: null });
  for (const query of ['?lineId=', '?lineId=%20mirror-1', '?lineId=mirror-1&lineId=mirror-2', '?lineId=%00']) {
    assert.deepEqual(helper.purchaseOrderLineTarget(query), { requested: true, lineId: null });
  }
  assert.equal(helper.findPurchaseOrderLine(lines, 'mirror-2'), lines[1]);
  for (const id of ['SAME-SKU', '01', null]) assert.equal(helper.findPurchaseOrderLine(lines, id), null);
  assert.equal(helper.findPurchaseOrderLine([lines[0], { ...lines[0] }], 'mirror-1'), null);
});

test('真实详情加载后只高亮同 SKU 的精确第二行，滚入且可聚焦，不自动打开写入弹窗', async (t) => {
  const gate = deferred();
  const view = fixture(t, { response: () => gate.promise });
  assert.equal(view.calls.focus.length, 0);
  gate.resolve({ order: order() }); await view.flush();
  assert.deepEqual(view.highlighted().map((row) => row.props['data-purchase-order-line-id']), ['mirror/2?x=1']);
  assert.equal(view.highlighted()[0].props.tabIndex, -1);
  assert.match(text(view.highlighted()[0]), /当前核对行/);
  assert.equal(view.calls.scroll.length, 1); assert.equal(view.calls.focus.length, 1);
  assert.match(view.calls.focus[0].key, /mirror\/2\?x=1$/);
  assert.equal(view.dialog(), undefined);
});

test('只读订单权限可从右侧进入精确行收货台账，关闭恢复入口，切换订单不沿用旧行', async (t) => {
  const view = fixture(t, { allowed: ['page:purchase-order-detail'] }); await view.flush();
  const entry = view.button('查看订单行 02 的收货与检验：同编码物料');
  assert.ok(entry);
  assert.equal(view.button('确认订单行 02 的预计检验后可用日期：同编码物料'), undefined);
  assert.equal(view.find((node) => node.type === 'PurchaseReceiptDrawer'), undefined);
  let focused = 0;
  const element = { isConnected: true, focus: () => focused++ };
  entry.props.onClick({ currentTarget: element });
  const drawer = view.find((node) => node.type === 'PurchaseReceiptDrawer');
  assert.equal(drawer.props.lineId, 'mirror/2?x=1');
  assert.equal(drawer.props.orderNo, 'PO-001');
  drawer.props.onClose();
  assert.equal(view.find((node) => node.type === 'PurchaseReceiptDrawer'), undefined);
  drawer.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(focused, 1);
  entry.props.onClick({ currentTarget: element });
  await view.router.navigate('/purchase-orders/PO-002');
  await view.flush();
  assert.equal(view.find((node) => node.type === 'PurchaseReceiptDrawer'), undefined);
});

test('缺少订单查看权限或精确行 ID 时不提供可用收货台账入口', async (t) => {
  const denied = fixture(t, { allowed: ['proc-purchase-order:receive', 'proc-purchase-order:inspect'] }); await denied.flush();
  assert.equal(denied.button('查看订单行 02 的收货与检验：同编码物料'), undefined);
  const missing = fixture(t, { response: async () => ({ order: order('PO-001', [line('', '01')]) }) }); await missing.flush();
  assert.equal(missing.button('查看订单行 01 的收货与检验：同编码物料').props.disabled, true);
});

test('缺失、已删除、重复参数不会按 SKU 猜另一行；普通订单链接不显示定位提示', async (t) => {
  for (const target of ['?lineId=SAME-SKU', '?lineId=deleted', '?lineId=', '?lineId=mirror-1&lineId=mirror-1']) {
    const view = fixture(t, { target }); await view.flush();
    assert.match(text(view.render()), /目标订单行不存在或已变更/);
    assert.equal(view.highlighted().length, 0); assert.equal(view.calls.scroll.length, 0); assert.equal(view.dialog(), undefined);
  }
  const ordinary = fixture(t, { target: '' }); await ordinary.flush();
  assert.doesNotMatch(text(ordinary.render()), /目标订单行不存在或已变更|当前核对行/);
  assert.equal(ordinary.calls.focus.length, 0);
});

test('保存刷新仅恢复触发按钮焦点，不重新滚动或抢到已高亮行', async (t) => {
  const view = fixture(t); await view.flush();
  const dialog = view.open();
  const gate = deferred(); view.setResponse(() => gate.promise);
  dialog.props.onSaved(); view.render();
  dialog.props.onCloseAutoFocus({ preventDefault() {} }); view.render();
  gate.resolve({ order: order() }); await view.flush();
  assert.equal(view.calls.scroll.length, 1);
  assert.equal(view.calls.focus.length, 2);
  assert.match(view.calls.focus[1].key, /^button:.*确认订单行 02 /);
  assert.equal(view.dialog(), undefined);
  assert.equal(view.highlighted().length, 1);
});

test('等待加载时用户已转到其他控件，保持其焦点；后续普通刷新不重复定位', async (t) => {
  const gate = deferred(); const view = fixture(t, { response: () => gate.promise });
  const otherControl = { isConnected: true }; view.document.activeElement = otherControl;
  gate.resolve({ order: order() }); await view.flush();
  assert.equal(view.document.activeElement, otherControl); assert.equal(view.calls.focus.length, 0);
  view.setResponse(async () => ({ order: order() })); await view.reload();
  assert.equal(view.calls.scroll.length, 1); assert.equal(view.document.activeElement, otherControl);
});

test('切换订单后旧请求不覆盖新订单，新的行目标独立聚焦', async (t) => {
  const old = deferred(), latest = deferred();
  const view = fixture(t, { response: (id) => id === 'PO-001' ? old.promise : latest.promise });
  await view.router.navigate('/purchase-orders/PO-002?lineId=new-line'); view.render();
  latest.resolve({ order: order('PO-002', [line('new-line')]) }); await view.flush();
  old.resolve({ order: order('PO-001') }); await view.flush();
  assert.deepEqual(view.calls.reads, ['PO-001', 'PO-002']);
  assert.deepEqual(view.highlighted().map((row) => row.props['data-purchase-order-line-id']), ['new-line']);
  assert.equal(view.calls.focus.length, 1); assert.match(view.calls.focus[0].key, /PO-002:new-line$/);
  assert.equal(view.find((node) => node.type === 'OrderPageHeader').props.title, 'PO-002');
});

test('同单变更 lineId 和浏览器返回同步改变高亮与行焦点，不重新请求订单或打开表单', async (t) => {
  const view = fixture(t); await view.flush();
  await view.router.navigate('/purchase-orders/PO-001?lineId=mirror-1'); await view.flush();
  assert.deepEqual(view.highlighted().map((row) => row.props['data-purchase-order-line-id']), ['mirror-1']);
  assert.equal(view.calls.focus.length, 2); assert.match(view.calls.focus[1].key, /:mirror-1$/);
  await view.router.navigate(-1); await view.flush();
  assert.deepEqual(view.highlighted().map((row) => row.props['data-purchase-order-line-id']), ['mirror/2?x=1']);
  assert.equal(view.calls.focus.length, 3); assert.match(view.calls.focus[2].key, /:mirror\/2\?x=1$/);
  assert.equal(view.calls.reads.length, 1); assert.equal(view.dialog(), undefined);
});

test('真实路由保留订单号中的斜杠和百分号字面量，不二次解码导致串单', async (t) => {
  for (const orderNo of ['PO/甲', 'PO%20A', 'PO%2F01']) {
    const view = fixture(t, { orderNo }); await view.flush();
    assert.deepEqual(view.calls.reads, [orderNo]);
    assert.equal(view.find((node) => node.type === 'OrderPageHeader').props.title, orderNo);
  }
});

test('安全来源且有权限才返回齐套中心；布尔 historyBack 精确返回已有历史和原视图', async (t) => {
  const state = { inventoryReadinessReturnTo: returnPath, inventoryReadinessHistoryBack: true };
  const view = fixture(t, { initialEntries: [returnPath, { pathname: '/purchase-orders/PO-001', search: '?lineId=mirror-1', state }] }); await view.flush();
  assert.ok(view.button('返回采购订单列表'));
  await view.button('返回齐套中心').props.onClick();
  assert.deepEqual(view.calls.navigate.at(-1), [-1, undefined]);
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, returnPath);
  assert.equal(view.router.state.historyAction, 'POP');
  await view.router.navigate(1);
  assert.equal(view.router.state.location.search, '?lineId=mirror-1');
});

test('缺少布尔历史标记时按验证地址替换当前条目，保留准确筛选与物料抽屉参数', async (t) => {
  for (const marker of [undefined, false, 'true', 1]) {
    const view = fixture(t, { state: { inventoryReadinessReturnTo: returnPath, inventoryReadinessHistoryBack: marker } }); await view.flush();
    await view.button('返回齐套中心').props.onClick();
    assert.deepEqual(view.calls.navigate.at(-1), [returnPath, { replace: true }]);
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, returnPath);
    assert.equal(view.router.state.historyAction, 'REPLACE');
  }
});

test('外部、旧配置、非齐套页面、非法参数或无齐套权限均没有返回入口', async (t) => {
  for (const source of ['https://example.com', '//example.com', '/proc-materials', '/proc-inventory-readiness?bad=1', '/proc-inventory-readiness?page=-1', '/proc-inventory-readiness#x']) {
    const view = fixture(t, { state: { inventoryReadinessReturnTo: source, inventoryReadinessHistoryBack: true } }); await view.flush();
    assert.equal(view.button('返回齐套中心'), undefined); assert.ok(view.button('返回采购订单列表'));
  }
  const denied = fixture(t, { allowed: ['page:purchase-order-detail'], state: { inventoryReadinessReturnTo: returnPath } }); await denied.flush();
  assert.equal(denied.button('返回齐套中心'), undefined);
  const custom = fixture(t, { routes: paths('/supply/orders', '/supply/readiness'), state: { inventoryReadinessReturnTo: returnPath } }); await custom.flush();
  assert.equal(custom.button('返回齐套中心'), undefined);
});

test('订单读取失败仍保留受验证的齐套返回，不依赖目标行是否存在', async (t) => {
  const view = fixture(t, { state: { inventoryReadinessReturnTo: returnPath }, response: async () => { throw new Error('订单不存在'); } }); await view.flush();
  assert.ok(view.button('返回采购订单'));
  await view.button('返回齐套中心').props.onClick();
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, returnPath);
});

test('订单详情从全局或模块计划返回真实历史，准确保留计划筛选和展开项', async (t) => {
  for (const source of [
    '/proc-cockpit?tab=stock-plans&stockType=material&stockMonth=2026-09&stockQ=%E9%98%80&stockStatus=in_progress&stockOpen=plan-2&stockFocus=plan-2',
    '/proc-cockpit?view=systems&product=P&module=M&moduleTab=plans&stockOpen=plan-2&stockFocus=plan-2',
  ]) {
    const state = { stockPlanReturnTo: source, stockPlanHistoryBack: true };
    const view = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-cockpit'], initialEntries: [source, { pathname: '/purchase-orders/PO-001', search: '?lineId=mirror-1', state }] }); await view.flush();
    assert.ok(view.button('返回采购订单列表')); assert.equal(view.button('返回齐套中心'), undefined);
    await view.button('返回备货计划').props.onClick();
    assert.deepEqual(view.calls.navigate.at(-1), [-1, undefined]);
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, source);
    assert.equal(view.router.state.historyAction, 'POP');
  }
});

test('计划返回无布尔历史标记时替换安全地址，与既有齐套及普通返回互不覆盖', async (t) => {
  const source = '/proc-cockpit?tab=stock-plans&stockOpen=P&stockFocus=P';
  const view = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-cockpit', 'page:proc-inventory-readiness'], state: { stockPlanReturnTo: source, stockPlanHistoryBack: 'true', inventoryReadinessReturnTo: returnPath } }); await view.flush();
  assert.ok(view.button('返回采购订单列表')); assert.ok(view.button('返回齐套中心'));
  await view.button('返回备货计划').props.onClick();
  assert.deepEqual(view.calls.navigate.at(-1), [source, { replace: true }]);
  assert.equal(view.router.state.historyAction, 'REPLACE');
});

test('计划返回没有驾驶舱权限或包含其他栏目、写表单触发时不显示，订单失败仍保留合法返回', async (t) => {
  const source = '/proc-cockpit?tab=stock-plans';
  for (const [allowed, target] of [
    [['page:purchase-order-detail'], source],
    [['page:purchase-order-detail', 'page:proc-cockpit'], '/proc-cockpit?tab=stock-plans&newPlan=1'],
    [['page:purchase-order-detail', 'page:proc-cockpit'], '/proc-cockpit?tab=samples'],
  ]) {
    const view = fixture(t, { allowed, state: { stockPlanReturnTo: target, stockPlanHistoryBack: true } }); await view.flush();
    assert.equal(view.button('返回备货计划'), undefined); assert.ok(view.button('返回采购订单列表'));
  }
  const failed = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-cockpit'], state: { stockPlanReturnTo: source }, response: async () => { throw new Error('订单不存在'); } }); await failed.flush();
  await failed.button('返回备货计划').props.onClick();
  assert.equal(failed.router.state.location.pathname + failed.router.state.location.search, source);
});

const workspaceSource = '/proc-my-workspace?month=2026-09&period=carryover&product=product-A&supplier=%E7%94%B2&status=in_transit&q=PO%2F%252F&focus=overdue&sort=date&task=task-24&page=2&arrivals=open&arrivalPage=3&arrivalFocus=line%3Amirror%2F2';

test('工作台到货进入精确同SKU镜像行，订单返回恢复原任务筛选和到货位置的真实历史', async (t) => {
  const state = { workspaceArrivalReturnTo: workspaceSource, workspaceArrivalHistoryBack: true };
  const view = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-my-workspace'], initialEntries: [workspaceSource, { pathname: '/purchase-orders/PO-001', search: '?lineId=mirror%2F2%3Fx%3D1', state }] });
  await view.flush();
  assert.deepEqual(view.highlighted().map((row) => row.props['data-purchase-order-line-id']), ['mirror/2?x=1']);
  assert.equal(view.dialog(), undefined); assert.ok(view.button('返回采购订单列表'));
  assert.equal(view.button('返回齐套中心'), undefined); assert.equal(view.button('返回备货计划'), undefined);
  await view.button('返回采购工作台').props.onClick();
  assert.deepEqual(view.calls.navigate.at(-1), [-1, undefined]);
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, workspaceSource);
  assert.equal(view.router.state.historyAction, 'POP');
  await view.router.navigate(1);
  assert.equal(view.router.state.location.search, '?lineId=mirror%2F2%3Fx%3D1');
});

test('工作台没有布尔历史标记时替换受验证地址；自定义采购与工作台路径同时生效', async (t) => {
  for (const marker of [undefined, false, 'true', 1]) {
    const customSource = workspaceSource.replace('/proc-my-workspace', '/supply/workspace');
    const view = fixture(t, { routes: paths('/supply/orders', '/supply/readiness', '/supply/workspace'), allowed: ['page:purchase-order-detail', 'page:proc-my-workspace'], state: { workspaceArrivalReturnTo: customSource, workspaceArrivalHistoryBack: marker } });
    await view.flush(); await view.button('返回采购工作台').props.onClick();
    assert.deepEqual(view.calls.navigate.at(-1), [customSource, { replace: true }]);
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, customSource);
    assert.equal(view.router.state.historyAction, 'REPLACE');
  }
});

test('工作台权限失效或非法来源隐藏返回入口，其他来源和普通列表返回仍独立', async (t) => {
  const view = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-my-workspace', 'page:proc-inventory-readiness'], state: { workspaceArrivalReturnTo: workspaceSource, inventoryReadinessReturnTo: returnPath } });
  await view.flush(); assert.ok(view.button('返回采购工作台'));
  view.setPermissions(['page:purchase-order-detail', 'page:proc-inventory-readiness']);
  assert.equal(view.button('返回采购工作台'), undefined); assert.ok(view.button('返回齐套中心')); assert.ok(view.button('返回采购订单列表'));
  for (const source of ['https://evil.invalid', workspaceSource + '&newPlan=1', workspaceSource + '&task=other', workspaceSource.replace('arrivals=open', 'arrivals=closed')]) {
    const invalid = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-my-workspace'], state: { workspaceArrivalReturnTo: source, workspaceArrivalHistoryBack: true } });
    await invalid.flush(); assert.equal(invalid.button('返回采购工作台'), undefined); assert.ok(invalid.button('返回采购订单列表'));
  }
});

test('订单读取失败或已删除时仍能回到合法到货来源，不依赖行是否存在', async (t) => {
  for (const response of [async () => { throw new Error('订单读取失败'); }, async () => ({ order: null })]) {
    const view = fixture(t, { allowed: ['page:purchase-order-detail', 'page:proc-my-workspace'], state: { workspaceArrivalReturnTo: workspaceSource }, response });
    await view.flush(); assert.equal(view.highlighted().length, 0);
    await view.button('返回采购工作台').props.onClick();
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, workspaceSource);
  }
});

test('历史记录入口按原镜像行打开，返回该行保留来源状态与查询并恢复行焦点', async (t) => {
  const state = { inventoryReadinessReturnTo: returnPath, keepSource: 'workspace' };
  const view = fixture(t, { target: '?keep=month&lineId=mirror-1', state }); await view.flush();
  const entry = view.button('查看订单行 02 的日期确认记录：同编码物料');
  const trigger = { isConnected: true, focus() {} };
  entry.props.onClick({ currentTarget: trigger });
  const drawer = view.find((node) => node.type === 'PurchaseOrderHistoryDrawer');
  assert.equal(drawer.props.line.id, 'mirror/2?x=1');
  assert.equal(drawer.props.orderNo, 'PO-001');
  drawer.props.onLocateLine(); await view.flush();
  drawer.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(view.find((node) => node.type === 'PurchaseOrderHistoryDrawer'), undefined);
  const params = new URLSearchParams(view.router.state.location.search);
  assert.equal(params.get('lineId'), 'mirror/2?x=1'); assert.equal(params.get('keep'), 'month');
  assert.deepEqual(view.router.state.location.state, state);
  assert.match(view.calls.focus.at(-1).key, /mirror\/2\?x=1$/);
});

test('历史关闭恢复原按钮，权限或订单切换后旧历史抽屉立即消失', async (t) => {
  const view = fixture(t); await view.flush();
  const entry = view.button('查看订单行 02 的日期确认记录：同编码物料');
  let focused = 0; const trigger = { isConnected: true, focus: () => focused++ };
  entry.props.onClick({ currentTarget: trigger });
  const drawer = view.find((node) => node.type === 'PurchaseOrderHistoryDrawer');
  drawer.props.onClose(); view.render(); drawer.props.onCloseAutoFocus({ preventDefault() {} }); assert.equal(focused, 1);
  entry.props.onClick({ currentTarget: trigger }); view.render(); view.setPermissions([]);
  assert.equal(view.find((node) => node.type === 'PurchaseOrderHistoryDrawer'), undefined);
  view.setPermissions(['page:purchase-order-detail']);
  await view.router.navigate('/purchase-orders/PO-NEW'); await view.flush();
  assert.equal(view.find((node) => node.type === 'PurchaseOrderHistoryDrawer'), undefined);
});
