import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryRouter, matchPath } from "react-router";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" };
const primitives = new Proxy({}, { get: (_target, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  new Function("exports", "require", ...Object.keys(globals), transpile(read(path)))(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name} in ${path}`);
    return dependencies[name];
  }, ...Object.values(globals));
  return exports;
}
const dates = load("src/app/procurement/data.ts", {
  react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} },
  "../lib/procurementApi": {}, "../lib/rdApi": {},
}, { window: undefined });
const model = load("src/app/procurement/procurementWorkspaceModel.ts", { "./data": dates });
const logic = load("src/app/procurement/procurementLogic.ts");
const navigation = load("src/app/lib/procurementWorkspaceNavigation.ts", { "./routePaths": { routePath: (_permission, fallback) => fallback } });
const stockNavigation = load("src/app/lib/stockPlanNavigation.ts", { "./routePaths": { routePath: (_permission, fallback) => fallback } });
const defaultRoutes = { routePath: (_permission, fallback) => fallback, subRoutePath: (_permission, fallback, suffix) => `${fallback}/${suffix}` };
const statuses = Object.fromEntries(["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival"].map((status) => [status, { label: status }]));
const user = { id: "buyer-1", name: "张工" };
const task = (id, overrides = {}) => ({
  id, code: `PR-${id}`, materialId: `material-${id}`, materialName: `物料 ${id}`, spec: "20mm", productId: "product-A",
  buyer: "张工", buyerUserId: "buyer-1", status: "pending_confirm", needDate: "2026-09-20", priority: "medium",
  method: "inquiry", source: "rd", rdTaskId: "RD-001", needSample: true, sampleTest: null,
  quantity: 20, arrivedQty: 0, unit: "件", attachmentList: [], purchaseOrders: [], logs: [], ...overrides,
});
const po = (supplierName, tpOrderNo = "PO-100") => ({ id: tpOrderNo, supplierName, tpOrderNo, tpLineNo: "1", orderedQty: 20, receivedQty: 0 });

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

// Render the real page and real ownership/filter/date helpers. Stateful hooks retain their slots;
// visual children are boundaries. URL updates and Back run through React Router's real history.
function fixture(t, { tasks = [], search = "?month=2026-09&period=all", currentUser = user, loading = false, error = null, allowed = true, surface = "workspace", locationState = null, routes = defaultRoutes } = {}) {
  const router = createMemoryRouter([{ path: "*", element: null }], { initialEntries: [{ pathname: surface === "samples" ? "/proc-cockpit" : routes.routePath("page:proc-my-workspace", "/proc-my-workspace"), search, state: locationState }] });
  let slots = []; const effects = [];
  let cursor = 0; let dirty = false; let state = { tasks, materials: [], loading, error }; let account = currentUser; let permissions = allowed;
  const can = (permission) => Array.isArray(permissions) ? permissions.includes(permission) : permissions;
  let guardTree = null;
  const unloadListeners = new Set();
  const calls = { refresh: 0, next: [], reassign: [], remove: [], focus: [], scroll: [] };
  const committedElements = new WeakMap();
  const action = { busy: false, modal: null, runNext: (row, source) => calls.next.push([row.id, source]), reassign: (row) => calls.reassign.push(row.id), remove: (row) => calls.remove.push(row.id) };
  const unsubscribe = router.subscribe(() => { dirty = true; });
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((value, index) => !Object.is(a[index], value));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: callback() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++; const before = slots[index];
      if (changed(before?.deps, deps)) {
        const next = { deps }; slots[index] = next;
        effects.push(() => { before?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const setParams = (input, options) => {
    const current = new URLSearchParams(router.state.location.search);
    const next = typeof input === "function" ? input(current) : input;
    return router.navigate({ pathname: router.state.location.pathname, search: `?${next.toString()}` }, options);
  };
  const dependencies = {
    react: hooks, "react/jsx-runtime": runtime, "lucide-react": primitives,
    "react-router": { useNavigate: () => router.navigate, useLocation: () => router.state.location, useSearchParams: () => [new URLSearchParams(router.state.location.search), setParams] },
    "../auth": { useAuth: () => ({ user: account }) }, "../lib/i18n": { useI18n: () => ({ t: translate }) },
    "../lib/routePaths": routes,
    "../lib/purchaseOrderLineNavigation": load("src/app/lib/purchaseOrderLineNavigation.ts", { "./routePaths": routes }),
    "../lib/workspaceArrivalNavigation": load("src/app/lib/workspaceArrivalNavigation.ts", { "./routePaths": routes }),
    "../components/ui/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./data": { ...dates, useProcurementData: () => state, useProcurementProducts: () => [{ id: "product-A", name: "产品甲" }, { id: "product-B", name: "产品乙" }], refreshProcurement: async () => { calls.refresh++; } },
    "./procurementLogic": logic, "./procurementWorkspaceModel": model,
    "./components/common": { ...primitives, PROC_STATUS_META: statuses, StatCell: "StatCell", PersonAvatar: "PersonAvatar", useProcCan: () => can, useBuyerDirectory: () => ({ users: [] }) },
    "./components/ProcWorkspaceArrivals": { ProcWorkspaceArrivals: "ProcWorkspaceArrivals" },
    "./components/ProcWorkspaceTaskList": { ProcWorkspaceTaskList: "ProcWorkspaceTaskList" },
    "./components/ProcWorkspaceTaskPanel": { ProcWorkspaceTaskPanel: "ProcWorkspaceTaskPanel" },
    "./components/ProcWorkspaceAggregation": { ProcWorkspaceAggregation: "ProcWorkspaceAggregation" },
    "./components/TaskDetailDrawer": { TaskDetailDrawer: "TaskDetailDrawer" },
    "./components/taskActions": { useProcTaskAction: () => action }, "./procurementWorkspace.css": {},
    "../components/TranslatableText": { AutoTranslatedText: "AutoTranslatedText" },
    "sonner": { toast: { success() {}, error() {} } },
    "../hooks/usePermission": { usePermission: (permission) => can(permission) && permission === "page:proc-my-workspace" },
    "./exportTasks": { exportProcTasksXlsx() {} },
    "../lib/procurementApi": { getProcCoreMaterialConfig: async () => ({ maxItems: 30, products: {} }) },
    "../lib/procurementWorkspaceNavigation": navigation,
    "../lib/stockPlanNavigation": stockNavigation,
  };
  for (const name of ["button", "collapsible", "input", "pagination", "select", "tabs", "toggle-group", "dropdown-menu"]) dependencies[`../components/ui/${name}`] = primitives;
  for (const name of ["ProcurementTaskCard", "ProcurementSystemTree", "MoveTaskDialog", "StockPlanPanel", "ProcurementSampleWorkspace", "ProcSampleNavigationGuard"]) dependencies[`./components/${name}`] = { [name]: name };
  dependencies["./components/modals"] = primitives;
  const moduleName = surface === "samples" ? "ProcurementCockpitPage" : "ProcMyWorkspacePage";
  const Component = load(`src/app/procurement/${moduleName}.tsx`, dependencies, { ResizeObserver: undefined })[moduleName];
  const { ProcSampleNavigationGuard } = load("src/app/procurement/components/ProcSampleNavigationGuard.tsx", {
    react: hooks, "react/jsx-runtime": runtime, "react-router": { useBlocker: (predicate) => router.getBlocker("sample", predicate) },
    "../../components/ui/alert-dialog": primitives, "../../lib/i18n": { useI18n: () => ({ t: translate }) },
  }, { window: {
    addEventListener: (name, listener) => { assert.equal(name, "beforeunload"); unloadListeners.add(listener); },
    removeEventListener: (name, listener) => { assert.equal(name, "beforeunload"); unloadListeners.delete(listener); },
  } });
  const view = {
    router, calls, action,
    render() {
      for (let iteration = 0; iteration < 20; iteration++) {
        cursor = 0; dirty = false;
        const tree = Component();
        // Ref assignment happens at commit, before effects. Track the named detail target
        // so a handler that focuses stale content before rendering will fail the assertions.
        for (const node of nodes(tree)) {
          const ref = node.props?.ref;
          // The project's React 18 function wrappers do not forward refs. Only a native
          // element can receive this ref; accepting visual component boundaries hid a bug.
          if (!ref || typeof ref !== "object" || typeof node.type !== "string" || !/^[a-z]/.test(node.type)) continue;
          let element = committedElements.get(ref);
          if (!element) {
            element = {
              props: node.props,
              focus(options) { calls.focus.push({ label: this.props["aria-label"], options }); },
              scrollIntoView(options) { calls.scroll.push({ id: this.props.id, options }); },
            };
            committedElements.set(ref, element);
          }
          element.props = node.props;
          ref.current = element;
        }
        const guard = nodes(tree).find((node) => node.type === "ProcSampleNavigationGuard");
        if (guard) guardTree = ProcSampleNavigationGuard(guard.props);
        else if (guardTree) { router.deleteBlocker("sample"); guardTree = null; }
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      assert.fail("workspace did not settle");
    },
    find(predicate) { return nodes(this.render()).find(predicate); },
    byType(type) { return this.find((node) => node.type === type); },
    rows() { return this.byType("ProcWorkspaceTaskList")?.props.tasks ?? []; },
    ids() { return this.rows().map((row) => row.id); },
    panel() { return this.byType("ProcWorkspaceTaskPanel"); },
    sample() { return this.byType("ProcurementSampleWorkspace"); },
    guard() { this.render(); return guardTree; },
    query() { return new URLSearchParams(router.state.location.search); },
    count(label) { return this.find((node) => node.type === "StatCell" && node.props.label === label)?.props.value; },
    setState(patch) { state = { ...state, ...patch }; return this.render(); },
    setUser(next) { account = next; return this.render(); },
    setPermissions(next) { permissions = next; return this.render(); },
    filter(label, value) {
      const select = this.find((node) => typeof node.type === "function" && node.type.name === "WorkspaceSelect" && node.props.label === label);
      assert.ok(select, label); select.props.onChange(value); return this.render();
    },
    input(label, value) {
      const input = this.find((node) => node.type === "Input" && node.props["aria-label"] === label);
      assert.ok(input, label); input.props.onChange({ target: { value } }); return this.render();
    },
    period(value) { this.byType("Tabs").props.onValueChange(value); return this.render(); },
    click(label) {
      const button = this.find((node) => node.type === "Button" && (node.props["aria-label"] === label || text(node).trim() === label));
      assert.ok(button, label); assert.ok(!button.props.disabled, `${label} must be enabled`); button.props.onClick(); return this.render();
    },
    async back() {
      await router.navigate(-1);
      for (const slot of slots) slot?.cleanup?.();
      slots = []; effects.length = 0;
      return this.render();
    },
  };
  t.after(() => { unsubscribe(); router.deleteBlocker("sample"); router.dispose(); for (const slot of slots) slot?.cleanup?.(); });
  view.render();
  return view;
}

test("本人账号优先于同名历史记录，列表、摘要、供应商选项与选中详情共同隔离", (t) => {
  const rows = [task("mine"), task("legacy", { buyerUserId: undefined }), task("same-name-other", { buyerUserId: "buyer-2", purchaseOrders: [po("他人供应商")] }), task("finished", { status: "completed" })];
  const view = fixture(t, { tasks: rows });
  assert.deepEqual(view.ids(), ["legacy", "mine"]);
  assert.equal(view.count("当前范围"), 2);
  const supplierFilter = view.find((node) => typeof node.type === "function" && node.type.name === "WorkspaceSelect" && node.props.label === "供应商");
  assert.ok(!supplierFilter.props.options.some((option) => option.value === "他人供应商"));
  assert.equal(view.query().get("task"), "legacy");
  view.setUser({ id: "buyer-2", name: "张工" });
  assert.deepEqual(view.ids(), ["legacy", "same-name-other"], "无账号历史任务按现有姓名规则兼容");
  view.setUser({ id: "buyer-3", name: "李工" });
  assert.deepEqual(view.ids(), []);
  assert.equal(view.panel(), undefined);
  assert.match(text(view.render()), /此任务暂不可用/);
});

const arrivalTask = (id, overrides = {}) => task(id, { purchaseOrders: [{ ...po('甲供应商', `PO/${id}%2F`), id: `ref-${id}`, tpOrderId: `erp-${id}`, tpLineNo: '02', etaDate: '2026-09-18' }], ...overrides });
const arrivalRow = (view, id) => model.workspaceArrivals(view.byType('ProcWorkspaceArrivals').props.tasks).find((row) => row.taskId === id);

test('到货打开精确镜像订单后真实历史恢复月份、筛选、目标任务页和到货位置，并刷新一次数据', async (t) => {
  const tasks = Array.from({ length: 25 }, (_, index) => arrivalTask(`T${String(index + 1).padStart(2, '0')}`));
  const search = '?month=2026-09&period=month&product=product-A&supplier=%E7%94%B2%E4%BE%9B%E5%BA%94%E5%95%86&status=pending_confirm&q=PO&focus=pending&sort=date&task=T01&page=1&arrivals=open&arrivalPage=2';
  const view = fixture(t, { tasks, search });
  const row = arrivalRow(view, 'T24'); assert.ok(row);
  const original = new URLSearchParams(search);
  view.byType('ProcWorkspaceArrivals').props.onOpenOrderLine(row, { orderNo: row.orderNo, lineId: 'mirror/second?literal=%2F' });
  assert.equal(view.router.state.location.pathname, '/purchase-orders/PO%2FT24%252F');
  assert.equal(view.query().get('lineId'), 'mirror/second?literal=%2F');
  assert.equal(view.router.state.location.state.workspaceArrivalHistoryBack, true);
  const returned = view.router.state.location.state.workspaceArrivalReturnTo;
  assert.equal(view.calls.next.length, 0, '只读导航不会推进任务');
  await view.back();
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, returned);
  for (const key of ['month', 'period', 'product', 'supplier', 'status', 'q', 'focus', 'sort']) assert.equal(view.query().get(key), original.get(key), key);
  assert.equal(view.query().get('task'), 'T24'); assert.equal(view.query().get('page'), '2');
  assert.equal(view.panel().props.task.id, 'T24'); assert.ok(view.ids().includes('T24'));
  const arrivals = view.byType('ProcWorkspaceArrivals').props;
  assert.equal(arrivals.open, true); assert.equal(arrivals.page, 2); assert.equal(arrivals.focusKey, row.key);
  assert.equal(view.calls.refresh, 1);
  view.render(); view.render(); assert.equal(view.calls.refresh, 1, '同一返回位置普通重绘不重复刷新');
  arrivals.onFocusHandled(row.key); view.render();
  assert.equal(view.query().has('arrivalFocus'), false); assert.equal(view.calls.refresh, 1);
});

test('到货页面启动时有明确返回焦点先刷新，删除或转派任务保留不可用说明而不猜选其他任务', (t) => {
  const view = fixture(t, { tasks: [arrivalTask('other')], search: '?month=2026-09&period=all&task=missing&arrivals=open&arrivalPage=3&arrivalFocus=old-row' });
  assert.equal(view.calls.refresh, 1); view.render(); assert.equal(view.calls.refresh, 1);
  assert.equal(view.query().get('task'), 'missing'); assert.equal(view.byType('ProcWorkspaceArrivals').props.focusKey, 'old-row');
  assert.match(text(view.render()), /此任务暂不可用/);
});

test('到货范围筛选变更清理旧页码及焦点；任务页和到货页互相独立', (t) => {
  const tasks = Array.from({ length: 25 }, (_, index) => arrivalTask(`T${String(index + 1).padStart(2, '0')}`));
  const view = fixture(t, { tasks, search: '?month=2026-09&period=all&task=T01&page=2&arrivals=open&arrivalPage=3&arrivalFocus=old-row' });
  view.byType('ProcWorkspaceArrivals').props.onPageChange(4); view.render();
  assert.equal(view.query().get('page'), '2'); assert.equal(view.query().get('arrivalPage'), '4'); assert.equal(view.query().has('arrivalFocus'), false);
  view.byType('ProcWorkspaceArrivals').props.onOpenChange(false); view.render();
  assert.equal(view.query().has('arrivals'), false); assert.equal(view.query().get('arrivalPage'), '4');
  view.filter('产品', 'product-B');
  assert.equal(view.query().has('page'), false); assert.equal(view.query().has('arrivalPage'), false); assert.equal(view.query().has('arrivalFocus'), false);
  assert.equal(view.query().get('task'), 'T01', '筛选不替换当前任务详情');
});

test('旧到货事件不能越过新筛选、新账号、刷新错误、权限失效或已关闭的安排', (t) => {
  for (const change of [
    (view) => view.filter('产品', 'product-B'),
    (view) => view.setUser({ id: 'buyer-2', name: '别人' }),
    (view) => view.setState({ error: '刷新失败' }),
    (view) => view.setState({ loading: true }),
    (view) => view.setPermissions(['page:proc-my-workspace']),
    (view) => { view.byType('ProcWorkspaceArrivals').props.onOpenChange(false); view.render(); },
    (view) => { view.byType('ProcWorkspaceArrivals').props.onPageChange(2); view.render(); },
    (view) => view.setState({ tasks: [arrivalTask('A', { purchaseOrders: [] })] }),
  ]) {
    const view = fixture(t, { tasks: [arrivalTask('A')], search: '?month=2026-09&period=all&task=A&arrivals=open' });
    const old = view.byType('ProcWorkspaceArrivals').props; const row = arrivalRow(view, 'A');
    change(view); const before = view.router.state.location;
    old.onOpenOrderLine(row, { orderNo: row.orderNo, lineId: 'mirror-second' });
    assert.equal(view.router.state.location, before, '旧事件必须保持当前新视图');
  }
});

test('旧范围页码、展开和焦点回调不覆盖新工作台查询；同范围旧焦点不清新行', async (t) => {
  const view = fixture(t, { tasks: [arrivalTask('A'), arrivalTask('B', { productId: 'product-B' })], search: '?month=2026-09&period=all&product=product-A&task=A&arrivals=open&arrivalPage=2&arrivalFocus=same-key' });
  const old = view.byType('ProcWorkspaceArrivals').props;
  await view.router.navigate('/proc-my-workspace?month=2026-09&period=all&product=product-B&task=B&arrivals=open&arrivalPage=3&arrivalFocus=same-key'); view.render();
  const before = view.router.state.location;
  old.onPageChange(7); old.onOpenChange(false); old.onFocusHandled('same-key');
  assert.equal(view.router.state.location, before, '旧范围回调不得改新任务视图');
  const previous = view.byType('ProcWorkspaceArrivals').props;
  await view.router.navigate('/proc-my-workspace?month=2026-09&period=all&product=product-B&task=B&arrivals=open&arrivalPage=3&arrivalFocus=new-key'); view.render();
  previous.onFocusHandled('same-key');
  assert.equal(view.query().get('arrivalFocus'), 'new-key');
});

test('工作台与订单配置路径都用于到货导航和返回，并拒绝没有当前关联的伪行', (t) => {
  const routes = {
    routePath: (permission, fallback) => permission === 'page:proc-my-workspace' ? '/supply/mine' : fallback,
    subRoutePath: (_permission, _fallback, suffix) => `/supply/orders/${suffix}`,
  };
  const view = fixture(t, { tasks: [arrivalTask('A')], routes, search: '?month=2026-09&period=all&task=A&arrivals=open' });
  const arrivals = view.byType('ProcWorkspaceArrivals').props; const row = arrivalRow(view, 'A');
  arrivals.onOpenOrderLine({ ...row, orderId: 'not-current-ref' }, { orderNo: row.orderNo, lineId: 'wrong-mirror' });
  assert.equal(view.router.state.location.pathname, '/supply/mine');
  arrivals.onOpenOrderLine(row, { orderNo: row.orderNo, lineId: 'mirror-second' });
  assert.equal(view.router.state.location.pathname, '/supply/orders/PO%2FA%252F');
  assert.ok(view.router.state.location.state.workspaceArrivalReturnTo.startsWith('/supply/mine?'));
});

test("真实筛选处理月份、产品、供应商、状态与搜索，统计、任务和到货范围一致", (t) => {
  const rows = [
    task("target", { purchaseOrders: [po("甲供应商", "PO-KEY")], status: "testing" }),
    task("wrong-status", { purchaseOrders: [po("甲供应商")], status: "pending_confirm" }),
    task("wrong-product", { productId: "product-B", purchaseOrders: [po("甲供应商")], status: "testing" }),
    task("wrong-supplier", { purchaseOrders: [po("乙供应商")], status: "testing" }),
    task("older", { needDate: "2026-08-31", purchaseOrders: [po("甲供应商")], status: "testing" }),
    task("unknown", { needDate: undefined, purchaseOrders: [po("甲供应商")], status: "testing" }),
  ];
  const view = fixture(t, { tasks: rows, search: "?month=2026-09&period=month" });
  const check = (ids) => {
    assert.deepEqual([...view.ids()].sort(), [...ids].sort());
    assert.equal(view.count("当前范围"), ids.length);
    assert.deepEqual(view.byType("ProcWorkspaceArrivals").props.tasks.map((row) => row.id).sort(), [...ids].sort());
  };
  check(["target", "wrong-status", "wrong-product", "wrong-supplier"]);
  view.filter("产品", "product-A"); check(["target", "wrong-status", "wrong-supplier"]);
  view.filter("供应商", "甲供应商"); check(["target", "wrong-status"]);
  view.filter("状态", "testing"); check(["target"]);
  view.input("搜索我的采购任务", " po-key "); check(["target"]);
  view.input("搜索我的采购任务", "不存在"); check([]);
  view.input("搜索我的采购任务", "");
  view.input("需求月份", "2026-08"); check(["older"]);
  assert.equal(view.query().get("product"), "product-A");
  assert.equal(view.query().get("supplier"), "甲供应商");
});

test("跨月未完成、日期待确认入口保留可发现数量，切换入口得到真实任务", (t) => {
  const view = fixture(t, { search: "?month=2026-09&period=month", tasks: [task("current"), task("older", { needDate: "2026-08-31" }), task("invalid", { needDate: "2026-02-30" }), task("future", { needDate: "2026-10-01" }), task("done", { status: "completed", needDate: "2026-08-30" })] });
  const tabs = nodes(view.render()).filter((node) => node.type === "TabsTrigger");
  assert.deepEqual(tabs.map(text), ["所选月需求 1", "跨月未完成 1", "日期待确认 1", "全部进行中 4"]);
  view.period("carryover"); assert.deepEqual(view.ids(), ["older"]);
  view.period("undated"); assert.deepEqual(view.ids(), ["invalid"]);
  view.period("all"); assert.equal(view.ids().length, 4);
});

test("状态和无结果搜索不隐藏跨月或无日期入口，点击后清筛选并保留产品供应商", (t) => {
  const view = fixture(t, { search: "?month=2026-09&period=month&product=product-A&supplier=甲供应商&status=testing&q=missing&focus=week", tasks: [task("old", { needDate: "2026-08-31", purchaseOrders: [po("甲供应商")] }), task("undated", { needDate: undefined, purchaseOrders: [po("甲供应商")] })] });
  assert.deepEqual(view.ids(), []);
  const tabs = nodes(view.render()).filter((node) => node.type === "TabsTrigger");
  assert.match(text(tabs.find((node) => node.props.value === "carryover")), /1/);
  assert.match(text(tabs.find((node) => node.props.value === "undated")), /1/);
  view.period("carryover"); assert.deepEqual(view.ids(), ["old"]);
  for (const key of ["status", "q", "focus"]) assert.equal(view.query().get(key), null);
  assert.equal(view.query().get("supplier"), "甲供应商"); assert.equal(view.query().get("product"), "product-A");
});

test("聚合接收全部本人任务并可定位筛选外原任务，计划独有选项按账号和权限清理", (t) => {
  const view = fixture(t, { search: "?month=2026-09&period=month&q=missing", tasks: [task("mine"), task("done", { status: "completed" }), task("other", { buyerUserId: "other" })] });
  const aggregation = view.byType("ProcWorkspaceAggregation");
  assert.deepEqual(aggregation.props.tasks.map((row) => row.id), ["mine", "done"]);
  aggregation.props.onSelectTask("mine"); view.render(); assert.equal(view.query().get("task"), "mine");
  aggregation.props.onPlanOptions({ userKey: JSON.stringify(user), products: ["plan-product"], suppliers: ["计划独有供应商"] }); view.render();
  const suppliers = () => view.find((node) => node.type?.name === "WorkspaceSelect" && node.props.label === "供应商").props.options.map((option) => option.value);
  assert.ok(suppliers().includes("计划独有供应商"));
  view.setPermissions(false); assert.ok(!suppliers().includes("计划独有供应商"));
  view.setPermissions(true); view.setUser({ id: "another", name: "另一采购" }); assert.ok(!suppliers().includes("计划独有供应商"));
});

test("首次采购来源失败时摘要未知而非零", (t) => {
  const view = fixture(t, { tasks: [], loading: false, error: "offline" });
  for (const label of ["当前范围", "待处理", "已逾期", "未来7天到货"]) assert.equal(view.count(label), "—");
});

test("业务来源写入URL且保留页码筛选，跨页面返回还原所选来源", async (t) => {
  const view = fixture(t, { search: "?month=2026-09&period=all&task=mine&page=2&q=阀体&source=sample", tasks: [task("mine")] });
  assert.equal(view.byType("ProcWorkspaceAggregation").props.selectedBusiness, "sample");
  view.byType("ProcWorkspaceAggregation").props.onBusinessChange("stock"); view.render();
  assert.equal(view.query().get("source"), "stock"); assert.equal(view.query().get("page"), "2"); assert.equal(view.query().get("q"), "阀体");
  view.byType("ProcWorkspaceAggregation").props.onNavigate("/proc-cockpit?tab=stock-plans&stockFocus=one&stockOpen=one");
  assert.match(view.router.state.location.state.procurementWorkspaceReturn, /source=stock/);
  await view.back(); assert.equal(view.byType("ProcWorkspaceAggregation").props.selectedBusiness, "stock");
  view.byType("ProcWorkspaceAggregation").props.onBusinessChange("purchase"); view.render(); assert.equal(view.query().get("source"), null);
});

test("初次异步加载才固定选中 URL，筛选与后台更新保留该任务，消失不偷偷切换", (t) => {
  const a = task("A"); const b = task("B");
  const view = fixture(t, { loading: true });
  assert.equal(view.query().get("task"), null);
  view.setState({ tasks: [b, a], loading: false });
  assert.equal(view.query().get("task"), "A");
  view.input("搜索我的采购任务", "物料 B");
  assert.deepEqual(view.ids(), ["B"]);
  assert.equal(view.panel().props.task.id, "A");
  assert.match(text(view.render()), /当前查看的任务不在筛选结果中/);
  view.click("刷新"); assert.equal(view.calls.refresh, 1);
  view.setState({ tasks: [task("0-first"), b, { ...a, spec: "已更新规格" }] });
  assert.equal(view.panel().props.task.spec, "已更新规格");
  assert.equal(view.query().get("task"), "A");
  view.setState({ tasks: [b] });
  assert.equal(view.query().get("task"), "A");
  assert.equal(view.panel(), undefined);
  assert.match(text(view.render()), /此任务暂不可用/);
  view.click("查看列表首项");
  assert.equal(view.query().get("task"), "B");
});

test("URL 已指定不可访问任务时不选第一条；刷新出错时不执行下一步", (t) => {
  const view = fixture(t, { tasks: [task("A")], search: "?month=2026-09&period=all&task=outside" });
  assert.equal(view.query().get("task"), "outside");
  assert.equal(view.panel(), undefined);
  view.setState({ error: "读取失败" });
  const list = view.byType("ProcWorkspaceTaskList");
  assert.equal(list.props.disabled, true);
  list.props.onNext(task("A"));
  assert.deepEqual(view.calls.next, []);
});

test("查看研发或样品后后退，真实路由历史恢复全部筛选和选中任务", async (t) => {
  const view = fixture(t, { tasks: [task("A", { purchaseOrders: [po("甲供应商")] })], search: "?month=2026-09&period=all&product=product-A&supplier=%E7%94%B2%E4%BE%9B%E5%BA%94%E5%95%86&status=pending_confirm&q=%E7%89%A9%E6%96%99&sort=date&task=A" });
  const original = view.router.state.location.search;
  for (const related of ["/rd-task/RD-001", "/proc-cockpit?tab=samples&sample=A"]) {
    view.panel().props.onNavigateRelated(related);
    assert.equal(view.router.state.location.pathname, related.split("?")[0]);
    assert.equal(view.router.state.location.state?.procurementWorkspaceReturn, `/proc-my-workspace${original}`);
    await view.back();
    assert.equal(view.router.state.location.pathname, "/proc-my-workspace");
    assert.equal(view.router.state.location.search, original);
    assert.equal(view.panel().props.task.id, "A");
    assert.deepEqual(view.ids(), ["A"]);
  }
});

test("分页只改变任务列表；选中任务和到货范围不会随页码丢失", (t) => {
  const tasks = Array.from({ length: 23 }, (_, index) => task(`task-${String(index).padStart(2, "0")}`));
  const view = fixture(t, { tasks });
  assert.equal(view.ids().length, 20);
  assert.equal(view.query().get("task"), "task-00");
  view.click("下一页");
  assert.deepEqual(view.ids(), ["task-20", "task-21", "task-22"]);
  assert.equal(view.panel().props.task.id, "task-00");
  assert.equal(view.byType("ProcWorkspaceArrivals").props.tasks.length, 23);
  view.byType("ProcWorkspaceTaskList").props.onSelect("task-22");
  assert.equal(view.query().get("page"), "2");
  view.click("上一页");
  assert.equal(view.panel().props.task.id, "task-22");
  view.filter("排序", "date");
  assert.equal(view.panel().props.task.id, "task-22");
});

test("到货安排选择分页外任务时定位对应列表页，筛选外选择保留原页", (t) => {
  const tasks = Array.from({ length: 43 }, (_, index) => task(`task-${String(index).padStart(2, "0")}`));
  const view = fixture(t, { tasks });
  assert.equal(view.ids().length, 20);
  view.byType("ProcWorkspaceArrivals").props.onSelect("task-30");
  view.render();
  assert.equal(view.query().get("page"), "2");
  assert.equal(view.panel().props.task.id, "task-30");
  assert.ok(view.ids().includes("task-30"));
  view.byType("ProcWorkspaceArrivals").props.onSelect("task-42");
  view.render();
  assert.equal(view.query().get("page"), "3");
  assert.deepEqual(view.ids(), ["task-40", "task-41", "task-42"]);
  view.click("上一页");
  assert.equal(view.query().get("page"), "2");
  assert.equal(view.panel().props.task.id, "task-42", "手动翻页不改变已选详情");
  view.setState({ tasks: tasks.map((row) => row.id === "task-00" ? { ...row, status: "completed" } : row) });
  view.byType("ProcWorkspaceTaskList").props.onSelect("task-00");
  view.render();
  assert.equal(view.query().get("page"), "2", "不在当前筛选范围的详情保持原页码");
  assert.equal(view.panel().props.task.id, "task-00");
});

test("显式查看在新详情提交后聚焦命名入口，同一任务再次查看也可聚焦", (t) => {
  const view = fixture(t, { tasks: [task("A"), task("B")] });
  assert.deepEqual(view.calls.focus, []);
  view.byType("ProcWorkspaceTaskList").props.onSelect("B");
  assert.deepEqual(view.calls.focus, [], "选择事件不应在旧详情尚未替换时移动焦点");
  view.render();
  assert.deepEqual(view.calls.focus, [{ label: "任务详情：物料 B · PR-B", options: { preventScroll: true } }]);
  assert.deepEqual(view.calls.scroll, [{ id: "proc-workspace-task-detail", options: { block: "start", behavior: "auto" } }]);
  const entry = view.find((node) => node.props?.ref && node.props?.role === "region");
  assert.equal(entry.type, "div", "焦点ref必须由原生DOM承载，普通Collapsible包装不会转发ref");
  assert.equal(entry.props.tabIndex, -1, "入口可编程聚焦，不插入额外的自然 Tab 停靠点");
  assert.equal(nodes(view.render()).filter((node) => ["Collapsible", "CollapsibleContent"].includes(node.type) && node.props?.ref).length, 0);
  view.byType("ProcWorkspaceArrivals").props.onSelect("B");
  view.render();
  assert.equal(view.calls.focus.length, 2, "同一任务再次显式查看仍可回到详情入口");
});

test("自动首项、后台更新与行内下一步都不抢详情或弹窗焦点", (t) => {
  const view = fixture(t, { loading: true });
  view.setState({ tasks: [task("A"), task("B")], loading: false });
  assert.equal(view.query().get("task"), "A");
  assert.deepEqual(view.calls.focus, []);
  view.setState({ tasks: [task("A", { spec: "后台更新" }), task("B")] });
  assert.deepEqual(view.calls.focus, []);
  view.byType("ProcWorkspaceTaskList").props.onNext(task("B"));
  view.render();
  assert.equal(view.query().get("task"), "B");
  assert.deepEqual(view.calls.next, [["B", "card"]]);
  assert.deepEqual(view.calls.focus, [], "行内下一步应交给原弹窗管理焦点");
  assert.deepEqual(view.calls.scroll, [], "行内下一步不滚动背景详情");
  view.setState({ tasks: [task("A"), task("B", { spec: "再次刷新" })] });
  assert.deepEqual(view.calls.focus, []);
});

test("详情、回退和日志复用同一抽屉，任务行和右侧下一步复用既有动作处理器", (t) => {
  const a = task("A"); const b = task("B");
  const view = fixture(t, { tasks: [a, b] });
  for (const action of [undefined, "rollback", "logs"]) {
    view.panel().props.onOpenDetail(a, action);
    const drawer = view.byType("TaskDetailDrawer");
    assert.equal(drawer.props.task.id, "A");
    assert.equal(drawer.props.initialAction, action);
    assert.equal(drawer.key, "A");
    assert.equal(typeof drawer.props.onNavigateRelated, "function", "工作台详情应把带返回来源的导航传入原抽屉");
    drawer.props.onClose();
    assert.equal(view.byType("TaskDetailDrawer"), undefined);
  }
  view.byType("ProcWorkspaceTaskList").props.onNext(b);
  assert.equal(view.query().get("task"), "B");
  view.panel().props.onNext(b);
  view.panel().props.onReassign(b); view.panel().props.onRemove(b);
  assert.deepEqual(view.calls.next, [["B", "card"], ["B", "card"]]);
  assert.deepEqual(view.calls.reassign, ["B"]);
  assert.deepEqual(view.calls.remove, ["B"]);
  view.action.busy = true;
  view.byType("ProcWorkspaceTaskList").props.onNext(a);
  view.panel().props.onNext(b);
  assert.equal(view.calls.next.length, 2);
});

function protectedLayout({ pathname, search = "", hash = "", state = null, mobile = true, hydrated = true, currentUser = user }) {
  const source = read("src/app/App.tsx");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProtectedLayout");
  assert.ok(fn);
  const bindings = {
    useAuth: () => ({ user: currentUser, hydrated }), useLocation: () => ({ pathname, search, hash, state }),
    useIsMobileViewport: () => mobile, routePath: (_permission, fallback) => fallback,
    matchPath, subRoutePath: (_permission, fallback, suffix) => `${fallback}/${suffix}`,
    Navigate: "Navigate", Root: "Root", MobileProcSampleTestPage: "MobileProcSampleTestPage",
    ...navigation,
    makeLazyProtected: (element, permission) => ({ type: "Protected", props: { element, permission } }),
  };
  return new Function("exports", "require", ...Object.keys(bindings), `${transpile(fn.getText(ast))}\nreturn ProtectedLayout();`)({}, () => runtime, ...Object.values(bindings));
}

test("S01 和采购驾驶舱各栏目在窄屏保留原页面，登录保护和其他工作区规则继续生效", () => {
  for (const mobile of [true, false]) {
    assert.equal(protectedLayout({ pathname: "/proc-my-workspace", search: "?task=A&month=2026-09", mobile }).type, "Root");
    for (const search of ["", "?tab=tasks", "?tab=samples&sample=A", "?tab=stock-plans", "?tab=procurement"]) {
      assert.equal(protectedLayout({ pathname: "/proc-cockpit", search, mobile }).type, "Root", `采购页面 ${search} 不应被重定向到研发池`);
    }
  }
  for (const [pathname, search, target] of [
    ["/rd-task/RD-1", "?part=notes", "/m/task/RD-1?part=notes#latest"],
    ["/us-collab-task/US-1", "", "/us-collab-m/task/US-1#latest"],
    ["/production-task/PROD-1", "", "/production-m/task/PROD-1#latest"],
    ["/us-collab-workspace", "", "/us-collab-m#latest"],
    ["/production-workspace", "", "/production-m#latest"],
    ["/proc-people-management", "", "/m#latest"],
    ["/proc-cockpit-other", "", "/m#latest"],
    ["/chat-analytics", "", "/m/chat-analytics#latest"],
  ]) {
    const route = protectedLayout({ pathname, search, hash: "#latest" });
    assert.equal(route.type, "Navigate", pathname);
    assert.equal(route.props.to, target, pathname);
  }
  const tester = protectedLayout({ pathname: "/rd-my-workspace", search: "?sampleTest=A" });
  assert.equal(tester.type, "Protected");
  assert.equal(tester.props.permission, "page:rd-my-workspace");
  assert.equal(tester.props.element.props.taskId, "A");
  const loggedOut = protectedLayout({ pathname: "/proc-my-workspace", search: "?task=A", currentUser: null });
  assert.equal(loggedOut.props.to, "/login");
  assert.equal(loggedOut.props.state.from, "/proc-my-workspace?task=A");
  assert.equal(protectedLayout({ pathname: "/rd-task/RD-1", state: { procurementWorkspaceReturn: "/proc-my-workspace?month=2026-09&task=A" } }).type, "Root", "从工作台进入研发详情应保留可返回的原页面");
  assert.equal(protectedLayout({ pathname: "/rd-task/RD-1", state: { procurementWorkspaceReturn: "//outside.invalid" } }).props.to, "/m/task/RD-1", "不接受外部返回地址以改变既有移动路由");
});

test("手机从工作台顶部进入采购驾驶舱时保持采购路由及原页面权限", (t) => {
  const view = fixture(t, { tasks: [task("A")] });
  const button = view.find((node) => node.type === "Button" && text(node).trim() === "查看采购驾驶舱");
  assert.ok(button);
  button.props.onClick();
  const { pathname, search, state } = view.router.state.location;
  assert.equal(pathname, "/proc-cockpit");
  assert.equal(search, "");
  assert.equal(protectedLayout({ pathname, search, state, mobile: true }).type, "Root");
  assert.match(read("src/app/App.tsx"), /asChildPath\(routePath\("page:proc-cockpit", "\/proc-cockpit"\)\), element: makeLazyProtected\(<ProcurementCockpitPage \/>, "page:proc-cockpit"\)/,
    "窄屏豁免保留原采购驾驶舱child页面权限");
  const denied = fixture(t, { allowed: false });
  assert.equal(denied.find((node) => node.type === "Button" && text(node).trim() === "查看采购驾驶舱"), undefined);
  const loggedOut = protectedLayout({ pathname: "/proc-cockpit", currentUser: null });
  assert.equal(loggedOut.props.to, "/login");
});

test("样品页返回采购工作台恢复准确来源，无来源或非法来源使用本地工作台默认入口", (t) => {
  const precise = "/proc-my-workspace?month=2026-09&period=carryover&product=product-A&supplier=Alpha&q=PO-10&page=2&task=A";
  for (const [locationState, expected] of [
    [{ procurementWorkspaceReturn: precise }, precise],
    [null, "/proc-my-workspace"],
    [{ procurementWorkspaceReturn: "//outside.invalid" }, "/proc-my-workspace"],
  ]) {
    const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", tasks: [task("A")], locationState });
    view.click("返回采购工作台");
    assert.equal(`${view.router.state.location.pathname}${view.router.state.location.search}`, expected);
  }
});

test("样品列表已确认的切换保留原工作台来源和筛选，只消费一次离页放行", (t) => {
  const locationState = { procurementWorkspaceReturn: "/proc-my-workspace?month=2026-09&task=A", unrelatedState: "preserved" };
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A&line=rd", tasks: [task("A"), task("B")], locationState });
  view.sample().props.onInteractionStateChange({ dirty: true, busy: false });
  view.sample().props.onSelect("B");
  assert.equal(view.query().get("sample"), "B");
  assert.equal(view.query().get("line"), "rd");
  assert.deepEqual(view.router.state.location.state, locationState);
  assert.equal(view.guard().props.open, false, "列表确认过的切换不应再弹第二次确认");
  view.click("返回采购工作台");
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true, "先前换样品的放行不能顺带放行返回工作台");
});

test("样品页返回入口遵守工作台权限，提交中置灰并继续由真实导航保护阻止旁路离开", async (t) => {
  const denied = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", allowed: false });
  assert.equal(denied.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"), undefined);
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A" });
  view.sample().props.onInteractionStateChange({ dirty: false, busy: true });
  const button = view.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台");
  assert.equal(button.props.disabled, true);
  await view.router.navigate("/proc-my-workspace");
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true);
  assert.equal(nodes(view.guard()).find((node) => node.type === "AlertDialogAction"), undefined);
  view.sample().props.onInteractionStateChange({ dirty: false, busy: false });
  assert.equal(view.guard().props.open, false);
  assert.equal(view.router.state.location.pathname, "/proc-cockpit", "提交完成后不重放被阻止的离页操作");
});

test("脏草稿点击返回工作台仍需放弃确认，取消保留样品，确认才恢复完整工作台地址", async (t) => {
  const destination = "/proc-my-workspace?month=2026-09&product=product-A&task=A";
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", locationState: { procurementWorkspaceReturn: destination } });
  view.sample().props.onInteractionStateChange({ dirty: true, busy: false });
  view.click("返回采购工作台");
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true);
  view.guard().props.onOpenChange(false);
  assert.equal(view.guard().props.open, false);
  assert.equal(view.query().get("sample"), "A");
  view.click("返回采购工作台");
  const confirm = nodes(view.guard()).find((node) => node.type === "AlertDialogAction");
  assert.ok(confirm);
  confirm.props.onClick({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(`${view.router.state.location.pathname}${view.router.state.location.search}`, destination);
});

test("样品页将完整驾驶舱栏目放在窄屏隐藏容器，保留可用的返回入口", (t) => {
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A" });
  const wrapper = view.find((node) => node.type === "div" && node.props.className === "hidden md:block" && nodes(node).some((child) => child.type === "TabsList" && child.props["aria-label"] === "供应链驾驶舱栏目"));
  assert.ok(wrapper);
  assert.ok(view.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"));
  assert.equal(nodes(wrapper).filter((node) => node.type === "TabsTrigger").length, 3, "桌面保留原三个栏目");
});

test("真实驾驶舱切换产品、模块或栏目时清理旧计划筛选与展开，不串到新模块", (t) => {
  const search = '?view=systems&product=P&module=M&moduleTab=plans&stockType=material&stockMonth=2026-09&stockOpen=plan-1&stockFocus=plan-1&stockQ=valve&stockStatus=in_progress';
  const cases = [
    (view) => view.byType('ProcurementSystemTree').props.onProductChange('P2'),
    (view) => view.byType('ProcurementSystemTree').props.onOpenModule({ id: 'M2' }, 'P'),
    (view) => view.byType('ProcurementSystemTree').props.onCloseModule(),
    (view) => view.byType('Tabs').props.onValueChange('stock-plans'),
  ];
  for (const change of cases) {
    const view = fixture(t, { surface: 'samples', search });
    change(view); view.render();
    for (const key of ['moduleTab', 'stockType', 'stockMonth', 'stockOpen', 'stockFocus', 'stockQ', 'stockStatus']) assert.equal(view.query().get(key), null, key);
  }
});


test('独立到货日历选日重置到货页，订单往返保留日期视图，任务筛选清除选日', async (t) => {
  const view=fixture(t,{tasks:[arrivalTask('A')],search:'?month=2026-09&period=all&task=A&arrivals=open&arrivalPage=3&arrivalView=calendar&arrivalMonth=2026-09&arrivalDay=all&source=arrival'});
  view.byType('ProcWorkspaceArrivals').props.onViewChange({selection:'2026-09-18'}); view.render();
  assert.equal(view.query().get('arrivalPage'),'1'); assert.equal(view.query().get('arrivalDay'),'2026-09-18');
  const old=view.byType('ProcWorkspaceArrivals').props; const row=arrivalRow(view,'A');
  old.onOpenOrderLine(row,{orderNo:row.orderNo,lineId:'mirror-A'});
  await view.back();
  const current=view.byType('ProcWorkspaceArrivals').props;
  assert.equal(current.view,'calendar'); assert.equal(current.calendarMonth,'2026-09'); assert.equal(current.selection,'2026-09-18'); assert.equal(view.query().get('source'),'arrival');
  current.onViewChange({month:'2026-10',selection:'all'}); view.render();
  current.onViewChange({selection:'undated'}); view.render();
  assert.equal(view.query().get('arrivalMonth'),'2026-10'); assert.equal(view.query().get('arrivalDay'),'all','旧scope不能覆盖新月份');
  view.period('month');
  assert.equal(view.query().has('arrivalDay'),false); assert.equal(view.query().get('arrivalMonth'),'2026-10');
});


test('非法日历URL回退后的列表仍可打开订单，列表模式不保留不可见日期筛选', (t) => {
  for (const suffix of ['arrivalView=bad','arrivalView=calendar&arrivalDay=2026-02-30','arrivalView=list&arrivalMonth=2026-09&arrivalDay=2026-09-18']) {
    const view=fixture(t,{tasks:[arrivalTask('A')],search:'?month=2026-09&period=all&task=A&arrivals=open&'+suffix});
    const props=view.byType('ProcWorkspaceArrivals').props;
    assert.equal(props.view,'list'); assert.equal(props.selection,'all');
    const row=arrivalRow(view,'A'); props.onOpenOrderLine(row,{orderNo:row.orderNo,lineId:'mirror-A'});
    assert.equal(view.router.state.location.pathname,'/purchase-orders/PO%2FA%252F');
    const returned=new URLSearchParams(view.router.state.location.state.workspaceArrivalReturnTo.split('?')[1]);
    assert.equal(returned.get('arrivalView'),'list'); assert.equal(returned.get('arrivalDay'),'all');
  }
});
