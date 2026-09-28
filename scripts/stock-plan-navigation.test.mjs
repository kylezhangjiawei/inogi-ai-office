import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMemoryRouter } from 'react-router';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('exports', 'require', ...Object.keys(globals), code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name];
    if (name === 'lucide-react' || name === 'recharts' || name.startsWith('../../components/') || name.startsWith('./')) return primitives;
    assert.fail(`Unexpected dependency ${name}`);
  }, ...Object.values(globals));
  return exports;
}
const primitives = new Proxy({}, { get: (_object, name) => name });
const paths = (base = '/proc-cockpit') => ({ routePath: (permission, fallback) => permission === 'page:proc-cockpit' ? base : fallback, subRoutePath: (_permission, fallback, suffix) => `${fallback}/${suffix}` });
const helpers = (base) => load('src/app/lib/stockPlanNavigation.ts', { './routePaths': paths(base) });
const navigation = helpers();
const defaultView = { planType: 'all', month: '', keyword: '', status: 'all', supplier: '', creator: '', page: 1, pageSize: 10, expanded: [] };
const currentView = { ...defaultView, planType: 'material', month: '2026-09', keyword: '阀', status: 'in_progress', expanded: ['plan-1', 'plan-2'], focusId: 'plan-2' };
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(' ') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)] : [];
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plan = (id, patch = {}) => ({ id, code: `SP-${id}`, planType: 'material', materialName: `阀 ${id}`, spec: 'M8', unit: '个', targetQty: 10, purchasedQty: 5, receivedQty: 1, qualifiedQty: 1, remainingQty: 5, progress: 50, status: 'in_progress', targetDate: '2026-09-20', readinessStatus: 'partial_received', batches: [], tasks: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z', ...patch });

// Real StockPlanPanel/ModuleDetail and production navigation helpers run against real history.
// Child data panels are boundaries; these tests do not replicate their request logic.
function fixture(t, { component = 'StockPlanPanel', initial = navigation.buildStockPlanReturnPath(currentView), props = {}, rows = [plan('plan-1'), plan('plan-2')], allowed = ['page:proc-cockpit', 'page:purchase-order-detail'], response, treeResponse, products = [], base = '/proc-cockpit' } = {}) {
  const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: [initial] });
  const slots = [], effects = []; let cursor = 0, dirty = false, tree, currentProps = props, permissions = allowed, currentProducts = products;
  const changed = (before, next) => !before || !next || before.length !== next.length || next.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++, before = slots[index]; if (changed(before?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); }); } },
    useId: () => 'test-id',
    useDeferredValue: (value) => value,
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const calls = { reads: [], navigate: [], focus: [], scroll: [] };
  const body = { isConnected: true }, documentElement = { isConnected: true }, document = { body, documentElement, activeElement: body };
  const jsx = (type, props, key) => ({ type, props, key });
  const routes = paths(base), stockHelpers = helpers(base);
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, sonner: { toast: { success() {}, error() {} } },
    'react-router': {
      useLocation: () => router.state.location,
      useNavigate: () => (to, options) => { calls.navigate.push([to, options]); return router.navigate(to, options); },
      useSearchParams: () => [new URLSearchParams(router.state.location.search), (input, options) => {
        const current = new URLSearchParams(router.state.location.search), next = typeof input === 'function' ? input(current) : input;
        return router.navigate({ pathname: router.state.location.pathname, search: `?${next.toString()}` }, options);
      }], Link: 'Link',
    },
    '../../hooks/usePermission': { usePermission: (permission) => permissions.includes(permission) },
    '../../lib/i18n': { useI18n: () => ({ t: translate }) },
    '../../lib/routePaths': routes, '../../lib/stockPlanNavigation': stockHelpers,
    '../../lib/purchaseOrderLineNavigation': load('src/app/lib/purchaseOrderLineNavigation.ts', { './routePaths': routes }),
    '../../lib/procurementApi': {
      listProcStockPlans: async (signal, scope) => { calls.reads.push(scope); return response ? response(scope, signal) : rows; },
      listProcTaskTree: async (productId) => { calls.reads.push({ productId }); return treeResponse ? treeResponse(productId) : { roots: [] }; },
    },
    '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../data': { useProcurementProducts: () => currentProducts, DEFAULT_PROCUREMENT_PRODUCT_ID: 'default-product' },
    './taskActions': { useProcTaskAction: () => ({ modal: null }), removalModeOf: () => 'remove' },
  };
  const Component = load(`src/app/procurement/components/${component}.tsx`, dependencies, { document })[component];
  const view = {
    router, calls,
    render() {
      for (let count = 0; count < 20; count++) {
        cursor = 0; dirty = false;
        tree = Component({ materials: [], canCreate: false, tasks: [], selected: null, onSelect() {}, coreMode: false, coreMaterialsByProduct: {}, coreMaterialLimit: 30, ...currentProps });
        const articles = nodes(tree).filter((node) => node.type === 'article').map((node) => ({
          isConnected: true, dataset: { stockPlanId: node.props['data-stock-plan-id'] },
          focus() { calls.focus.push(this.dataset.stockPlanId); document.activeElement = this; }, scrollIntoView() { calls.scroll.push(this.dataset.stockPlanId); },
        }));
        for (const node of nodes(tree)) if (node.type === 'div' && node.props.ref && typeof node.props.ref === 'object') node.props.ref.current = { scrollTop: 0, querySelectorAll: () => articles };
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      assert.fail('Plan view did not settle');
    },
    async ready() { this.render(); await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
    query() { return new URLSearchParams(router.state.location.search); },
    find(predicate) { return nodes(this.render()).find(predicate); },
    dateCheck(id) { return this.find((node) => node.type === 'StockPlanOrderDateCheck' && node.props.planId === id); },
    ids() { return nodes(this.render()).filter((node) => node.type === 'article').map((node) => node.props['data-stock-plan-id']); },
    type(value) { this.find((node) => node.type === 'ToggleGroup').props.onValueChange(value); return this.render(); },
    month(value) { this.find((node) => node.type === 'StockPlanMonthInput').props.onChange(value); return this.render(); },
    keyword(value) { this.find((node) => node.type === 'Input' && node.props['aria-label'] === '搜索备货计划').props.onChange({ target: { value } }); return this.render(); },
    status(label) { this.find((node) => node.type === 'Button' && node.props['aria-pressed'] !== undefined && text(node).includes(label)).props.onClick(); return this.render(); },
    select(label, value) { const select = this.find((node) => node.type === 'StockPlanSelect' && node.props.label === label); assert.ok(select, label); select.props.onValueChange(value); return this.render(); },
    page(label) { const button = this.find((node) => node.type === 'Button' && node.props['aria-label'] === label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} must be enabled`); button.props.onClick(); return this.render(); },
    toggle(id) { const article = this.find((node) => node.type === 'article' && node.props['data-stock-plan-id'] === id); nodes(article).find((node) => node.type === 'Button' && node.props['aria-expanded'] !== undefined).props.onClick(); return this.render(); },
    setProps(next) { currentProps = next; return this.render(); },
    setPermissions(next) { permissions = next; return this.render(); },
    setProducts(next) { currentProducts = next; return this.render(); },
  };
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); router.dispose(); });
  view.render(); return view;
}

test('两个规范来源保持类型、月份、搜索、状态、供应商、创建人、分页及展开 ID', () => {
  const savedView = { ...currentView, supplier: 'id:supplier/甲', creator: 'name:创建人 乙', page: 3, pageSize: 20 };
  for (const scope of [{}, { productId: 'product/甲', treeNodeId: 'module-2' }]) {
    const helper = helpers('/supply/cockpit'), path = helper.buildStockPlanReturnPath(savedView, scope);
    assert.equal(helper.stockPlanReturnPath({ stockPlanReturnTo: path }), path);
    const params = new URL(path, 'http://local').searchParams;
    assert.deepEqual(helper.parseStockPlanViewState(params), { ...savedView, expanded: ['plan-2', 'plan-1'] });
    assert.equal(params.get('newPlan'), null); assert.equal(params.get('planType'), null);
    if (scope.treeNodeId) { assert.equal(params.get('moduleTab'), 'plans'); assert.equal(params.get('product'), scope.productId); assert.equal(params.get('tab'), null); }
    else assert.equal(params.get('tab'), 'stock-plans');
  }
  assert.equal(navigation.buildStockPlanReturnPath(defaultView, { productId: 'p-1' }), null);
});

test('返回验证拒绝开放跳转、其他栏目、重复参数、表单触发、越界展开和不一致聚焦', () => {
  for (const target of [
    '//evil.test', 'https://evil.test', '/old-cockpit?tab=stock-plans', '/proc-cockpit?tab=samples', '/proc-cockpit?tab=stock-plans&newPlan=1',
    '/proc-cockpit?tab=stock-plans&planType=machine', '/proc-cockpit?view=systems&product=P&module=M&moduleTab=operations',
    '/proc-cockpit?tab=stock-plans&view=systems&product=P&module=M&moduleTab=plans', '/proc-cockpit?tab=stock-plans&stockStatus=nope',
    '/proc-cockpit?tab=stock-plans&stockMonth=2026-13', '/proc-cockpit?tab=stock-plans&stockOpen=A&stockOpen=A',
    '/proc-cockpit?tab=stock-plans&stockFocus=A', '/proc-cockpit?tab=stock-plans&stockQ=%00', '/proc-cockpit?tab=stock-plans#x',
    '/proc-cockpit?tab=stock-plans&tab=stock-plans', '/proc-cockpit?view=systems&module=M&moduleTab=plans',
  ]) assert.equal(navigation.stockPlanReturnPath({ stockPlanReturnTo: target }), null, target);
  const tooMany = new URLSearchParams({ tab: 'stock-plans' }); for (let i = 0; i <= navigation.MAX_STOCK_PLAN_EXPANDED; i++) tooMany.append('stockOpen', `p-${i}`);
  assert.equal(navigation.stockPlanReturnPath({ stockPlanReturnTo: `/proc-cockpit?${tooMany}` }), null);
  assert.equal(navigation.parseStockPlanViewState(tooMany).expanded.length, navigation.MAX_STOCK_PLAN_EXPANDED);
  assert.deepEqual(navigation.parseStockPlanViewState('?stockType=bad&stockMonth=2026-00&stockStatus=bad&stockOpen=%00'), defaultView);
});

test('新增筛选和分页拒绝重复或非法返回参数，普通解析回退到安全默认值', () => {
  const invalid = {
    stockSupplier: ['', ' id:A', 'name:A ', `name:${'x'.repeat(252)}`, 'name:A\\B', 'name:A\u0000B'],
    stockCreator: ['', ' id:A', 'name:A ', `name:${'x'.repeat(252)}`, 'name:A\\B', 'name:A\u007fB'],
    stockPage: ['', '0', '-1', '1.5', '01', '1e2', '100001', '9999999999999999999'],
    stockPageSize: ['', '0', '15', '100', '010', '+20'],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values) {
      const params = new URLSearchParams({ tab: 'stock-plans', [key]: value });
      assert.equal(navigation.stockPlanReturnPath({ stockPlanReturnTo: `/proc-cockpit?${params}` }), null, `${key}=${JSON.stringify(value)}`);
      assert.deepEqual(navigation.parseStockPlanViewState(params), defaultView);
    }
  }
  for (const [key, value] of [['stockSupplier', 'id:A'], ['stockCreator', 'name:甲'], ['stockPage', '2'], ['stockPageSize', '20']]) {
    const params = new URLSearchParams({ tab: 'stock-plans', [key]: value }); params.append(key, value);
    assert.equal(navigation.stockPlanReturnPath({ stockPlanReturnTo: `/proc-cockpit?${params}` }), null);
    assert.deepEqual(navigation.parseStockPlanViewState(params), defaultView);
  }
  const boundary = { ...defaultView, supplier: `name:${'甲'.repeat(251)}`, creator: 'id:creator-A', page: 100000, pageSize: 50 };
  const path = navigation.buildStockPlanReturnPath(boundary);
  assert.ok(path);
  assert.deepEqual(navigation.parseStockPlanViewState(new URL(path, 'http://local').searchParams), boundary);
});

test('写入视图替换旧过滤分页，默认值和非法值不进入返回地址且保留宿主参数', () => {
  const params = new URLSearchParams('tab=stock-plans&stockSupplier=id:old&stockCreator=id:old&stockPage=7&stockPageSize=50&planType=machine');
  navigation.writeStockPlanViewParams(params, { ...defaultView, supplier: 'x'.repeat(257), creator: 'name:A\\B', page: 100001, pageSize: 15 });
  assert.deepEqual(navigation.parseStockPlanViewState(params), defaultView);
  for (const key of ['stockSupplier', 'stockCreator', 'stockPage', 'stockPageSize']) assert.equal(params.has(key), false);
  assert.equal(params.get('tab'), 'stock-plans'); assert.equal(params.get('planType'), 'machine');
});

test('读取后的真实计划列表从 URL 恢复筛选与两个展开项，只定位指定计划且不打开编辑', async (t) => {
  const view = fixture(t, { rows: [plan('plan-1'), plan('plan-2'), plan('other-month', { targetDate: '2026-10-01' }), plan('other-type', { planType: 'machine' }), plan('other-status', { status: 'completed' }), plan('other-name', { materialName: '电机' })] });
  assert.equal(view.dateCheck('plan-2'), undefined); await view.ready();
  assert.deepEqual(view.ids(), ['plan-1', 'plan-2']);
  assert.ok(view.dateCheck('plan-1')); assert.ok(view.dateCheck('plan-2'));
  assert.deepEqual(view.calls.scroll, ['plan-2']); assert.deepEqual(view.calls.focus, ['plan-2']);
  assert.equal(view.find((node) => typeof node.type === 'function' && node.type.name === 'StockPlanFormDialog'), undefined);
});

test('类型、月份、搜索和状态的真实操作写入独立 URL 键；刷新可恢复而不误用新建 planType', async (t) => {
  const initial = '/proc-cockpit?tab=stock-plans&planType=machine&materialName=from-form';
  const rows = [plan('one'), plan('two', { planType: 'machine', materialName: '整机', status: 'completed', targetDate: '2026-10-20' })];
  const view = fixture(t, { initial, rows }); await view.ready();
  assert.deepEqual(view.ids(), ['one', 'two']);
  view.type('machine'); view.month('2026-10'); view.keyword('整机'); view.status('下单达标'); view.toggle('two');
  assert.deepEqual(view.ids(), ['two']);
  assert.equal(view.query().get('planType'), 'machine');
  assert.equal(view.query().get('stockType'), 'machine'); assert.equal(view.query().get('stockMonth'), '2026-10');
  assert.equal(view.query().get('stockQ'), '整机'); assert.equal(view.query().get('stockStatus'), 'completed');
  const reloaded = fixture(t, { initial: view.router.state.location.pathname + view.router.state.location.search, rows }); await reloaded.ready();
  assert.deepEqual(reloaded.ids(), ['two']); assert.ok(reloaded.dateCheck('two'));
});

test('备货计划默认每页十条，页码翻页完整且改变每页数量回到首页', async (t) => {
  const rows = Array.from({ length: 23 }, (_, index) => plan(`page-${index}`));
  const view = fixture(t, { initial: navigation.buildStockPlanReturnPath(defaultView), rows }); await view.ready();
  assert.deepEqual(view.ids(), rows.slice(0, 10).map((row) => row.id));
  assert.equal(view.find((node) => node.type === 'Button' && node.props['aria-label'] === '上一页').props.disabled, true);
  const size = view.find((node) => node.type === 'StockPlanSelect' && node.props.label === '每页条数');
  assert.equal(size.props.value, '10');
  const seen = [...view.ids()];
  view.page('下一页'); seen.push(...view.ids());
  assert.equal(view.query().get('stockPage'), '2');
  view.page('下一页'); seen.push(...view.ids());
  assert.deepEqual(seen, rows.map((row) => row.id));
  assert.equal(view.find((node) => node.type === 'Button' && node.props['aria-label'] === '下一页').props.disabled, true);
  view.page('上一页'); assert.deepEqual(view.ids(), rows.slice(10, 20).map((row) => row.id));
  view.page('第 1 页'); assert.deepEqual(view.ids(), rows.slice(0, 10).map((row) => row.id));
  view.page('第 3 页');
  view.select('每页条数', '20');
  assert.deepEqual(view.ids(), rows.slice(0, 20).map((row) => row.id));
  assert.equal(navigation.parseStockPlanViewState(view.query()).page, 1);
  assert.equal(view.query().get('stockPageSize'), '20');
  view.page('下一页'); assert.deepEqual(view.ids(), rows.slice(20).map((row) => row.id));
  view.select('每页条数', '50'); assert.deepEqual(view.ids(), rows.map((row) => row.id));
  assert.equal(view.query().get('stockPageSize'), '50');
});

test('供应商、创建人和状态过滤按稳定 ID 组合，搜索或过滤变化重置页码且可刷新恢复', async (t) => {
  const batch = { id: 'B', supplierId: 'supplier-A', supplierName: '同名供应商', purchaseQty: 5, receivedQty: 1, qualifiedQty: 1 };
  const matching = Array.from({ length: 25 }, (_, index) => plan(`match-${index}`, { createdBy: 'creator-A', createdByName: '同名创建人', batches: [{ ...batch, id: `batch-${index}` }] }));
  const rows = [...matching,
    plan('other-supplier', { createdBy: 'creator-A', createdByName: '同名创建人', batches: [{ ...batch, supplierId: 'supplier-B' }] }),
    plan('other-creator', { createdBy: 'creator-B', createdByName: '同名创建人', batches: [batch] }),
    plan('other-status', { createdBy: 'creator-A', createdByName: '同名创建人', batches: [batch], status: 'completed' }),
  ];
  const view = fixture(t, { initial: navigation.buildStockPlanReturnPath(defaultView), rows }); await view.ready();
  view.page('第 3 页'); view.select('供应商', 'id:supplier-A');
  assert.equal(navigation.parseStockPlanViewState(view.query()).page, 1);
  view.page('第 2 页'); view.select('创建人', 'id:creator-A');
  assert.equal(navigation.parseStockPlanViewState(view.query()).page, 1);
  view.page('第 2 页'); view.select('计划状态', 'in_progress');
  assert.equal(navigation.parseStockPlanViewState(view.query()).page, 1);
  assert.deepEqual(view.ids(), matching.slice(0, 10).map((row) => row.id));
  view.select('每页条数', '20'); view.page('下一页');
  assert.deepEqual(view.ids(), matching.slice(20).map((row) => row.id));
  const initial = view.router.state.location.pathname + view.router.state.location.search;
  const restored = fixture(t, { initial, rows }); await restored.ready();
  assert.deepEqual(restored.ids(), view.ids());
  assert.equal(restored.query().get('stockSupplier'), 'id:supplier-A');
  assert.equal(restored.query().get('stockCreator'), 'id:creator-A');
  assert.equal(restored.query().get('stockStatus'), 'in_progress');
  restored.keyword('match-2');
  assert.equal(navigation.parseStockPlanViewState(restored.query()).page, 1);
  assert.deepEqual(restored.ids(), matching.filter((row) => row.id.startsWith('match-2')).map((row) => row.id));
});

test('从计划第二页打开订单保留过滤和每页数量，旧页回调失效且返回重定位原计划', async (t) => {
  const makePlan = (id) => plan(id, { createdBy: 'creator-A', createdByName: '创建人甲', batches: [{ id: `batch-${id}`, supplierId: 'supplier-A', supplierName: '供应商甲', purchaseQty: 5, receivedQty: 1, qualifiedQty: 1, createdByName: '创建人甲', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' }] });
  const rows = Array.from({ length: 45 }, (_, index) => makePlan(`return-${index}`));
  const savedView = { ...defaultView, supplier: 'id:supplier-A', creator: 'id:creator-A', page: 2, pageSize: 20, expanded: ['return-25'], focusId: 'return-25' };
  const scope = { productId: 'P', treeNodeId: 'M' };
  const initial = navigation.buildStockPlanReturnPath(savedView, scope);
  const view = fixture(t, { initial, props: scope, rows }); await view.ready();
  assert.deepEqual(view.ids(), rows.slice(20, 40).map((row) => row.id));
  const stale = view.dateCheck('return-25').props.onOpenOrderLine;
  view.page('上一页'); stale('PO-25', 'line-25');
  assert.equal(view.calls.navigate.length, 0, '上一页留下的订单回调不可打开当前页外计划');
  view.page('下一页');
  view.dateCheck('return-25').props.onOpenOrderLine('PO-25', 'line-25');
  const saved = view.calls.navigate.at(-1)[1].state.stockPlanReturnTo;
  const params = new URL(saved, 'http://local').searchParams;
  assert.deepEqual(navigation.parseStockPlanViewState(params), savedView);
  assert.equal(params.get('product'), 'P'); assert.equal(params.get('module'), 'M');
  await view.router.navigate(-1);
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, saved);
  const inserted = Array.from({ length: 20 }, (_, index) => makePlan(`inserted-${index}`));
  const returned = fixture(t, { initial: saved, props: scope, rows: [...inserted, ...rows] }); await returned.ready();
  assert.equal(navigation.parseStockPlanViewState(returned.query()).page, 3);
  assert.ok(returned.ids().includes('return-25'));
  assert.ok(returned.dateCheck('return-25'));
  assert.deepEqual(returned.calls.focus, ['return-25']);
  assert.equal(returned.query().get('stockSupplier'), 'id:supplier-A');
  assert.equal(returned.query().get('stockCreator'), 'id:creator-A');
  assert.equal(returned.query().get('stockPageSize'), '20');
});

test('真实计划点击订单行先保存来源再进入精确订单，Back 与重新挂载恢复相同计划上下文', async (t) => {
  const view = fixture(t); await view.ready();
  view.dateCheck('plan-2').props.onOpenOrderLine('PO/%2F?甲', 'mirror/2');
  const [save, open] = view.calls.navigate;
  assert.equal(save[1].replace, true);
  assert.equal(open[0], '/purchase-orders/PO%2F%252F%3F%E7%94%B2?lineId=mirror%2F2');
  assert.deepEqual(open[1].state, { stockPlanReturnTo: save[0], stockPlanHistoryBack: true });
  assert.equal(navigation.stockPlanReturnPath(open[1].state), save[0]);
  await view.router.navigate(-1);
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, save[0]);
  const returned = fixture(t, { initial: save[0] }); await returned.ready();
  assert.deepEqual(returned.ids(), ['plan-1', 'plan-2']); assert.ok(returned.dateCheck('plan-2'));
  assert.deepEqual(returned.calls.focus, ['plan-2']);
});

test('切模块未加载、旧请求迟到、已收起或失去权限的保留回调都不能导航', async (t) => {
  const latest = deferred();
  const view = fixture(t, { props: { productId: 'P', treeNodeId: 'M1' }, response: (scope) => scope.treeNodeId === 'M1' ? Promise.resolve([plan('plan-1'), plan('plan-2')]) : latest.promise });
  await view.ready(); const stale = view.dateCheck('plan-2').props.onOpenOrderLine;
  view.setProps({ productId: 'P', treeNodeId: 'M2' }); stale('PO-1', 'line-1');
  assert.equal(view.calls.navigate.length, 0); assert.deepEqual(view.ids(), []);
  latest.resolve([plan('plan-1'), plan('plan-2')]); await view.ready(); stale('PO-1', 'line-1'); assert.equal(view.calls.navigate.length, 0);
  const current = view.dateCheck('plan-2').props.onOpenOrderLine;
  view.toggle('plan-2'); current('PO-1', 'line-1'); assert.equal(view.calls.navigate.length, 0);
  view.toggle('plan-2'); view.setPermissions(['page:proc-cockpit']); current('PO-1', 'line-1'); assert.equal(view.calls.navigate.length, 0);
});

test('切换计划作用域后迟到的旧响应不会重新显示旧模块计划', async (t) => {
  const old = deferred(), latest = deferred();
  const view = fixture(t, { initial: '/proc-cockpit?view=systems&product=P&module=M1&moduleTab=plans', props: { productId: 'P', treeNodeId: 'M1' }, response: (scope) => scope.treeNodeId === 'M1' ? old.promise : latest.promise });
  view.setProps({ productId: 'P', treeNodeId: 'M2' });
  latest.resolve([plan('new-plan')]); await view.ready();
  old.resolve([plan('old-plan')]); await view.ready();
  assert.deepEqual(view.ids(), ['new-plan']);
  assert.deepEqual(view.calls.reads, [{ productId: 'P', treeNodeId: 'M1' }, { productId: 'P', treeNodeId: 'M2' }]);
});

test('返回计划删除或最新状态已落出筛选时说明原因，不自动展开第一条或修改筛选', async (t) => {
  const missing = fixture(t, { rows: [plan('plan-1')] }); await missing.ready();
  assert.match(text(missing.render()), /原备货计划不存在/); assert.equal(missing.query().get('stockFocus'), 'plan-2'); assert.deepEqual(missing.calls.focus, []);
  const hidden = fixture(t, { rows: [plan('plan-1'), plan('plan-2', { status: 'completed' })] }); await hidden.ready();
  assert.match(text(hidden.render()), /原备货计划已不在当前筛选范围/); assert.equal(hidden.query().get('stockStatus'), 'in_progress'); assert.equal(hidden.dateCheck('plan-2'), undefined);
});

test('计划保存和同父更新时间的批次变更重建本计划日期核对区，其他计划保持已读结果', async (t) => {
  const rows = [plan('plan-1'), plan('plan-2')], view = fixture(t, { rows }); await view.ready();
  const firstKey = view.dateCheck('plan-2').key, siblingKey = view.dateCheck('plan-1').key;
  const readiness = () => view.find((node) => typeof node.type === 'function' && node.type.name === 'PlanReadiness' && node.props.plan.id === 'plan-2');
  readiness().props.onSaved({ ...rows[1], targetDate: '2026-09-25' }); view.render();
  const editKey = view.dateCheck('plan-2').key;
  assert.notEqual(editKey, firstKey, 'same plan ID + unchanged parent timestamp still remounts the reader');
  assert.equal(view.dateCheck('plan-1').key, siblingKey);
  readiness().props.onSaved({ ...rows[1], batches: [{ id: 'batch-1', supplierName: '供应商', purchaseQty: 5, receivedQty: 0, qualifiedQty: 0, createdAt: rows[1].createdAt }] }); view.render();
  const batchKey = view.dateCheck('plan-2').key;
  assert.notEqual(batchKey, editKey);
  readiness().props.onSaved({ ...rows[1], batches: [] }); view.render();
  assert.notEqual(view.dateCheck('plan-2').key, batchKey);
  assert.equal(view.dateCheck('plan-1').key, siblingKey);
});

test('模块旧备货链接回到库存，保留产品模块且任务仅能只读查看', async (t) => {
  const scope = { productId: 'P', treeNodeId: 'M' }, initial = navigation.buildStockPlanReturnPath(currentView, scope);
  const task = { id: 'T', productId: 'P', code: 'PR-001', materialName: '阀', spec: '', quantity: 3, unit: '件', createdAt: '2026-09-21', status: 'priced' };
  const secondTask = { ...task, id: 'T2', code: 'PR-002' };
  const props = { node: { id: 'M', productId: 'P', taskIds: ['T', 'T2'], name: '模块' }, productName: '产品', tasks: [task, secondTask], onBack() {} };
  const moduleInitial = navigation.buildStockPlanReturnPath({ ...currentView, supplier: 'id:S', creator: 'name:甲', page: 3, pageSize: 50 }, scope);
  const module = fixture(t, { component: 'ProcurementModuleDetail', initial: moduleInitial, props }); await module.ready();
  const panel = module.find((node) => node.type === 'StockPlanPanel');
  assert.equal(panel, undefined);
  assert.equal(module.query().get('moduleTab'), null);
  assert.ok(!nodes(module.render()).some(node => ['编辑', '删除', '新增任务', '备货计划'].includes(node.props?.label ?? text(node))));
  module.find(node => node.type?.name === 'TaskActionButton' && node.props.label === '查看').props.onClick();
  const reader = module.find(node => node.type === 'ProcurementTaskSummaryDrawer');
  assert.equal(reader.props.task.id, 'T'); assert.equal(reader.props.readOnly, true);
  const row = id => module.find(node => node.type === 'tr' && node.props['data-task-id'] === id);
  row('T2').props.onClick({ target: { closest: () => null } });
  assert.equal(module.find(node => node.type === 'ProcurementTaskSummaryDrawer').props.task.id, 'T2', '抽屉打开时点击普通单元格直接切换');
  assert.equal(row('T2').props['aria-selected'], true);
  assert.equal(row('T').props['aria-selected'], false);
  row('T').props.onClick({ target: { closest: () => ({}) } });
  assert.equal(module.find(node => node.type === 'ProcurementTaskSummaryDrawer').props.task.id, 'T2', '行处理不重复触发内部按钮');
  reader.props.onClose(); assert.equal(module.find(node => node.type === 'ProcurementTaskSummaryDrawer'), undefined);
  const view = fixture(t, { initial, props: scope }); await view.ready();
  view.dateCheck('plan-2').props.onOpenOrderLine('PO-1', 'line-2');
  assert.equal(new URL(view.calls.navigate[0][0], 'http://local').searchParams.get('moduleTab'), 'plans');
  module.find((node) => node.type === "Button" && text(node) === '生产与质量').props.onClick(); module.render();
  assert.equal(module.query().get('moduleTab'), 'operations'); assert.equal(module.query().get('stockOpen'), null); assert.equal(module.query().get('stockFocus'), null);
  for (const key of ['stockSupplier', 'stockCreator', 'stockPage', 'stockPageSize']) assert.equal(module.query().get(key), null, key);
  assert.equal(module.query().get('product'), 'P'); assert.equal(module.query().get('module'), 'M');
});

test('清理计划上下文只处理约定键，保留既有任务/产品及新建表单默认字段', () => {
  const params = new URLSearchParams('view=systems&product=P&module=M&moduleTab=plans&stockType=material&stockMonth=2026-09&stockOpen=P1&stockFocus=P1&stockQ=x&stockStatus=completed&stockSupplier=id:A&stockCreator=name:甲&stockPage=3&stockPageSize=50&planType=machine&newPlan=1');
  navigation.clearStockPlanViewParams(params);
  assert.deepEqual([...params.keys()], ['view', 'product', 'module', 'planType', 'newPlan']);
});

test('真实系统树对已移除来源产品保持稳定提示，不在首产品和 URL 产品之间循环请求', async (t) => {
  const props = { requestedProductId: 'removed', detailNodeId: 'module-old', onShowTasks() {} };
  const view = fixture(t, { component: 'ProcurementSystemTree', props, products: [{ id: 'first-product', name: '其他产品' }] });
  for (let i = 0; i < 4; i++) await view.ready();
  assert.match(text(view.render()), /原产品不在当前可用列表中，可能已删除或移出/);
  assert.equal(view.calls.reads.length, 0);
  assert.equal(view.find((node) => node.type === 'ProcurementModuleDetail'), undefined);
  view.setProducts([{ id: 'first-product', name: '其他产品' }, { id: 'removed', name: '异步读取的原产品' }]); await view.ready();
  assert.deepEqual(view.calls.reads, [{ productId: 'removed' }]);
  assert.match(text(view.render()), /模块不存在或已被删除/);
});

test('系统树保留有效产品模块，删除来源产品时旧请求返回也不能打开其他产品详情', async (t) => {
  const gate = deferred(), node = { id: 'module-1', productId: 'P', parentId: null, name: '原模块', taskIds: [], children: [], taskCount: 0 };
  const view = fixture(t, { component: 'ProcurementSystemTree', props: { requestedProductId: 'P', detailNodeId: 'module-1' }, products: [{ id: 'P', name: '原产品' }], treeResponse: () => gate.promise });
  view.setProducts([{ id: 'other', name: '其他产品' }]);
  gate.resolve({ roots: [node] }); await view.ready();
  assert.equal(view.find((item) => item.type === 'ProcurementModuleDetail'), undefined);
  assert.match(text(view.render()), /原产品不在当前可用列表中/);
  const valid = fixture(t, { component: 'ProcurementSystemTree', props: { requestedProductId: 'P', detailNodeId: 'module-1' }, products: [{ id: 'P', name: '原产品' }], treeResponse: async () => ({ roots: [node] }) }); await valid.ready();
  assert.equal(valid.find((item) => item.type === 'ProcurementModuleDetail').props.node.id, 'module-1');
  assert.deepEqual(valid.calls.reads, [{ productId: 'P' }]);
});
