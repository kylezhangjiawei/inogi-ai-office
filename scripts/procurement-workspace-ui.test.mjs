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
const workspaceRoutes = load("src/app/lib/rdWorkspace.ts", { "react-router": { matchPath }, "./routePaths": defaultRoutes });
const statuses = Object.fromEntries(["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival", "completed", "cancelled"].map((status) => [status, { label: status }]));
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
function visibleNodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(visibleNodes);
  if (!tree || typeof tree !== "object" || tree.props?.hidden) return [];
  return [tree, ...visibleNodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

// Render the real page and real ownership/filter/date helpers. Stateful hooks retain their slots;
// visual children are boundaries. URL updates and Back run through React Router's real history.
function fixture(t, { tasks = [], search = "?month=2026-09&period=all", currentUser = user, loading = false, error = null, allowed = true, surface = "workspace", locationState = null, routes = defaultRoutes, buyerUsers = [] } = {}) {
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
    "../components/matechat/MateChatStreakCardConnected": { MateChatStreakCardConnected: "MateChatStreakCardConnected" },
    "../lib/routePaths": routes,
    "../lib/purchaseOrderLineNavigation": load("src/app/lib/purchaseOrderLineNavigation.ts", { "./routePaths": routes }),
    "../lib/workspaceArrivalNavigation": load("src/app/lib/workspaceArrivalNavigation.ts", { "./routePaths": routes }),
    "../components/ui/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./data": { ...dates, useProcurementData: () => state, useProcurementProducts: () => [{ id: "product-A", name: "产品甲" }, { id: "product-B", name: "产品乙" }], refreshProcurement: async () => { calls.refresh++; } },
    "./procurementLogic": logic, "./procurementWorkspaceModel": model,
    "./components/common": { ...primitives, PROC_STATUS_META: statuses, StatCell: "StatCell", PersonAvatar: "PersonAvatar", useProcCan: () => can, useBuyerDirectory: (options) => { assert.deepEqual(options, { departmentOnly: true }); return { users: buyerUsers }; } },
    "./components/ProcWorkspaceArrivals": { ProcWorkspaceArrivals: "ProcWorkspaceArrivals" },
    "./components/ProcWorkspaceTaskList": { ProcWorkspaceTaskList: "ProcWorkspaceTaskList" },
    "./components/ProcWorkspaceTaskPanel": { ProcWorkspaceTaskPanel: "ProcWorkspaceTaskPanel" },
    "./components/ProcWorkspaceAggregation": { ProcWorkspaceAggregation: "ProcWorkspaceAggregation" },
    "./delivery/ProcurementDeliverySchedule": { ProcurementDeliverySchedule: "ProcurementDeliverySchedule" },
    "./components/TaskDetailDrawer": { TaskDetailDrawer: "TaskDetailDrawer" },
    "./components/ProcurementTaskDetailPage": { ProcurementTaskDetailPage: "ProcurementTaskDetailPage" },
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
  for (const name of ["ProcurementTaskCard", "ProcurementTaskTable", "ProcurementTaskSummaryDrawer", "ProcurementSystemTree", "MoveTaskDialog", "StockPlanPanel", "ProcurementSampleWorkspace", "ProcSampleNavigationGuard"]) dependencies[`./components/${name}`] = { [name]: name };
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
    visible(predicate) { return visibleNodes(this.render()).find(predicate); },
    byType(type) { return this.find((node) => node.type === type); },
    visibleByType(type) { return this.visible((node) => node.type === type); },
    tabs(label) { return this.find((node) => node.type === "Tabs" && nodes(node).some((child) => child.type === "TabsList" && child.props["aria-label"] === label)); },
    rows() { return this.byType("ProcWorkspaceTaskList")?.props.tasks ?? []; },
    ids() { return this.rows().map((row) => row.id); },
    panel() { return this.find(node => node.type === "TaskDetailDrawer" && node.props.presentation === "workspace"); },
    sample() { return this.byType("ProcurementSampleWorkspace"); },
    guard() { this.render(); return guardTree; },
    query() { return new URLSearchParams(router.state.location.search); },
    count(label) { return this.find((node) => node.type === "StatCell" && node.props.label === label)?.props.value; },
    setState(patch) { state = { ...state, ...patch }; return this.render(); },
    setUser(next) { account = next; return this.render(); },
    setPermissions(next) { permissions = next; return this.render(); },
    filter(label, value) {
      const select = this.visible((node) => typeof node.type === "function" && node.type.name === "WorkspaceSelect" && node.props.label === label);
      assert.ok(select, label); select.props.onChange(value); return this.render();
    },
    input(label, value) {
      const input = this.visible((node) => node.type === "Input" && node.props["aria-label"] === label);
      assert.ok(input, label); input.props.onChange({ target: { value } }); return this.render();
    },
    tab(label, value) {
      const tabs = this.tabs(label);
      assert.ok(tabs, label);
      const trigger = nodes(tabs).find((node) => node.type === "TabsTrigger" && node.props.value === value);
      assert.ok(trigger, value); assert.ok(!trigger.props.disabled, `${value} must be enabled`);
      tabs.props.onValueChange(value); return this.render();
    },
    period(value) { return this.tab("按需求月份查看任务", value); },
    workspace(value) { return this.tab("个人工作台栏目", value); },
    click(label) {
      const button = this.visible((node) => node.type === "Button" && (node.props["aria-label"] === label || text(node).trim() === label));
      assert.ok(button, label); assert.ok(!button.props.disabled, `${label} must be enabled`); button.props.onClick(); return this.render();
    },
    async back() {
      await router.navigate(-1);
      return this.remount();
    },
    remount() {
      for (const slot of slots) slot?.cleanup?.();
      slots = []; effects.length = 0;
      return this.render();
    },
  };
  t.after(() => { unsubscribe(); router.deleteBlocker("sample"); router.dispose(); for (const slot of slots) slot?.cleanup?.(); });
  view.render();
  return view;
}

test("驾驶舱负责人按账号隔离同名任务，历史唯一姓名兼容，摘要与列表同步", (t) => {
  const buyerUsers = [{ id: "buyer-1", name: "张工" }, { id: "buyer-2", name: "张工" }, { id: "buyer-3", name: "李工" }, { id: "buyer-4", name: "王工" }];
  const rows = [
    task("mine-pending", { businessLine: "rd", needDate: "2999-01-01" }),
    task("mine-overdue", { businessLine: "rd", status: "inquiring", needDate: "1999-01-01" }),
    task("same-name-other", { businessLine: "rd", buyerUserId: "buyer-2", status: "in_transit", needDate: "2999-01-01" }),
    task("ambiguous-history", { businessLine: "rd", buyerUserId: undefined, needDate: "2999-01-01" }),
    task("unique-history", { businessLine: "rd", buyerUserId: undefined, buyer: "李工", needDate: "2999-01-01" }),
    task("requester-only", { businessLine: "rd", buyerUserId: "elsewhere", buyer: "李工", rdContact: "张工", requesterName: "张工", needDate: "2999-01-01" }),
  ];
  const view = fixture(t, { tasks: rows, buyerUsers, surface: "samples", search: "?tab=tasks" });
  view.find(node => node.props?.['aria-label'] === '任务显示模式').props.onValueChange('masonry');
  const ownerGroup = () => view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "按采购负责人筛选");
  const selectOwner = (id) => { ownerGroup().props.onValueChange(id); view.render(); };
  const ids = () => nodes(view.render()).filter((node) => node.type === "ProcurementTaskCard").map((node) => node.props.task.id).sort();
  const counts = () => ["在制任务", "待确认", "询价中", "采购在途", "逾期异常"].map((label) => view.count(label));
  assert.deepEqual(counts(), [6, 4, 1, 1, 1]);
  const people = nodes(ownerGroup()).filter((node) => node.type === "ToggleGroupItem");
  assert.equal(people.find((node) => node.props.value === "buyer-1").props["aria-label"], "张工，2 个任务");
  assert.equal(people.find((node) => node.props.value === "buyer-2").props["aria-label"], "张工，1 个任务");
  selectOwner("buyer-1");
  assert.deepEqual(ids(), ["mine-overdue", "mine-pending"]);
  assert.deepEqual(counts(), [2, 1, 1, 0, 1]);
  selectOwner("buyer-2");
  assert.deepEqual(ids(), ["same-name-other"]);
  assert.deepEqual(counts(), [1, 0, 0, 1, 0]);
  selectOwner("buyer-3");
  assert.deepEqual(ids(), ["unique-history"]);
  assert.deepEqual(counts(), [1, 1, 0, 0, 0]);
  selectOwner("buyer-4");
  assert.deepEqual(ids(), []);
  assert.deepEqual(counts(), [0, 0, 0, 0, 0]);
  selectOwner("all");
  assert.deepEqual(ids(), rows.map((row) => row.id).sort(), "不明确归属的历史任务仍在全部范围可见");
});

test("个人完整详情按本人账号范围取任务，筛选之外和已完成任务仍可读，转派或切换账号立即失效", (t) => {
  const mine = task("mine", { status: "completed", productId: "product-B" });
  const other = task("other", { buyerUserId: "buyer-2" });
  const view = fixture(t, { tasks: [mine, other], search: "?detail=1&task=mine&product=product-A&status=pending_confirm&q=不匹配" });
  assert.equal(view.byType("ProcurementTaskDetailPage").props.task, mine);
  assert.equal(view.byType("ProcWorkspaceTaskList"), undefined);
  view.setState({ loading: true });
  assert.equal(view.byType("ProcurementTaskDetailPage").props.loading, true, "已有快照时仍传递刷新等待状态");
  view.setState({ loading: false, tasks: [{ ...mine, buyerUserId: "buyer-2" }, other] });
  assert.equal(view.byType("ProcurementTaskDetailPage").props.task, undefined);
  assert.equal(view.query().get("task"), "mine", "不可用深链不猜选其他任务");
  view.setState({ tasks: [mine, other] });
  view.setUser({ id: "buyer-2", name: "张工" });
  assert.equal(view.byType("ProcurementTaskDetailPage").props.task, undefined, "同名账号不能读取原负责人的任务");
  for (const id of ["other", "deleted"]) {
    const denied = fixture(t, { tasks: [mine, other], search: `?detail=1&task=${id}` });
    assert.equal(denied.byType("ProcurementTaskDetailPage").props.task, undefined);
    assert.equal(denied.query().get("task"), id);
  }
});

test("驾驶舱只读摘要关闭后保留负责人、搜索与统计筛选", (t) => {
  const rows = [task("mine", { businessLine: "rd", materialName: "目标阀体" }), task("other", { businessLine: "rd", buyerUserId: "buyer-2", materialName: "目标阀体" })];
  const view = fixture(t, { tasks: rows, buyerUsers: [{ id: "buyer-1", name: "张工" }, { id: "buyer-2", name: "李工" }], surface: "samples", search: "?tab=tasks&line=rd&product=product-A&material=目标阀体" });
  view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "按采购负责人筛选").props.onValueChange("buyer-1");
  view.input("搜索采购任务", "目标");
  view.find((node) => node.type === "StatCell" && node.props.label === "待确认").props.onClick();
  const original = Object.fromEntries(view.query());
  view.byType("ProcurementTaskTable").props.onOpen(rows[0]);
  assert.equal(view.byType("ProcurementTaskSummaryDrawer").props.task.id, "mine");
  assert.equal(view.byType("ProcurementTaskSummaryDrawer").props.onExpand, undefined);
  assert.equal(view.byType("ProcurementTaskDetailPage"), undefined);
  assert.equal(view.byType("TaskDetailDrawer"), undefined);
  view.byType("ProcurementTaskSummaryDrawer").props.onClose();
  assert.deepEqual(Object.fromEntries(view.query()), original);
  assert.equal(view.byType("TaskDetailDrawer"), undefined);
  assert.equal(view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "按采购负责人筛选").props.value, "buyer-1");
  assert.equal(view.find((node) => node.type === "Input" && node.props["aria-label"] === "搜索采购任务").props.value, "目标");
  assert.equal(view.find((node) => node.type === "StatCell" && node.props.label === "待确认").props.active, true);
  assert.deepEqual(view.byType("ProcurementTaskTable").props.tasks.map(task => task.id), ["mine"]);
});

test("本人账号优先于同名历史记录，列表、摘要、供应商选项与选中详情共同隔离", (t) => {
  const rows = [task("mine"), task("legacy", { buyerUserId: undefined }), task("same-name-other", { buyerUserId: "buyer-2", purchaseOrders: [po("他人供应商")] }), task("finished", { status: "completed" })];
  const view = fixture(t, { tasks: rows });
  assert.deepEqual(view.ids().slice().sort(), ["finished", "legacy", "mine"]);
  assert.equal(view.count("当前范围"), 3);
  const supplierFilter = view.find((node) => typeof node.type === "function" && node.type.name === "WorkspaceSelect" && node.props.label === "供应商");
  assert.ok(!supplierFilter.props.options.some((option) => option.value === "他人供应商"));
  assert.ok(["finished", "legacy", "mine"].includes(view.query().get("task")));
  assert.equal(view.byType("MateChatStreakCardConnected").key, "buyer-1");
  view.setUser({ id: "buyer-2", name: "张工" });
  assert.equal(view.byType("MateChatStreakCardConnected").key, "buyer-2", "切换账号应重新取得该账号的连续使用记录");
  assert.deepEqual(view.ids(), ["legacy", "same-name-other"], "无账号历史任务按现有姓名规则兼容");
  view.setUser({ id: "buyer-3", name: "李工" });
  assert.deepEqual(view.ids(), []);
  assert.equal(view.panel(), undefined);
  assert.match(text(view.render()), /此任务暂不可用/);
});

const arrivalTask = (id, overrides = {}) => task(id, { purchaseOrders: [{ ...po('甲供应商', `PO/${id}%2F`), id: `ref-${id}`, tpOrderId: `erp-${id}`, tpLineNo: '02', etaDate: '2026-09-18' }], ...overrides });
const arrivalRow = (view, id) => model.workspaceArrivals(view.byType('ProcWorkspaceArrivals').props.tasks).find((row) => row.taskId === id);

test("首次采购来源失败时摘要未知而非零", (t) => {
  const view = fixture(t, { tasks: [], loading: false, error: "offline" });
  for (const label of ["当前范围", "待处理", "已逾期", "等待他人"]) assert.equal(view.count(label), "—");
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
  view.byType("ProcWorkspaceTaskList").props.onSelect("B");
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

function protectedLayout({ pathname, search = "", hash = "", state = null, mobile = true, hydrated = true, currentUser = user }) {
  const source = read("src/app/App.tsx");
  const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProtectedLayout");
  assert.ok(fn);
  const bindings = {
    useAuth: () => ({ user: currentUser, hydrated }), useLocation: () => ({ pathname, search, hash, state }),
    useIsMobileViewport: () => mobile, routePath: (_permission, fallback) => fallback,
    rdWorkspaceForPath: workspaceRoutes.rdWorkspaceForPath,
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
    for (const pathname of ['/production-dashboard', '/rd-director-dashboard']) assert.equal(protectedLayout({ pathname, mobile }).type, 'Root', '自适应驾驶舱保留原页面');
    for (const search of ["", "?tab=tasks", "?tab=samples&sample=A", "?tab=stock-plans", "?tab=procurement"]) {
      assert.equal(protectedLayout({ pathname: "/proc-cockpit", search, mobile }).type, "Root", `采购页面 ${search} 不应被重定向到研发池`);
    }
  }
  for (const [pathname, search, target] of [
    ["/rd-task/RD-1", "?part=notes", "/m/task/RD-1?part=notes#latest"],
    ["/us-collab-task/US-1", "", "/us-collab-m/task/US-1#latest"],
    ["/production-task/PROD-1", "", "/production-m/task/PROD-1#latest"],
    ["/us-collab-workspace", "", "/us-collab-m#latest"],
    ["/production-workspace", "", "/m#latest"],
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
  const button = view.find((node) => node.type === "Button" && text(node).trim() === "供应链任务驾驶舱");
  assert.ok(button);
  button.props.onClick();
  const { pathname, search, state } = view.router.state.location;
  assert.equal(pathname, "/proc-cockpit");
  assert.equal(search, "");
  assert.equal(protectedLayout({ pathname, search, state, mobile: true }).type, "Root");
  assert.match(read("src/app/App.tsx"), /asChildPath\(routePath\("page:proc-cockpit", "\/proc-cockpit"\)\), element: makeLazyProtected\(<ProcurementCockpitPage \/>, "page:proc-cockpit"\)/,
    "窄屏豁免保留原采购驾驶舱child页面权限");
  const denied = fixture(t, { allowed: false });
  assert.equal(denied.find((node) => node.type === "Button" && text(node).trim() === "供应链任务驾驶舱"), undefined);
  const loggedOut = protectedLayout({ pathname: "/proc-cockpit", currentUser: null });
  assert.equal(loggedOut.props.to, "/login");
});

test("采购任务默认表格，切换视图保留筛选，详情打开时可连续切换任务", (t) => {
  const targetRows = Array.from({ length: 12 }, (_, index) => task(`target-${index}`, { materialName: `目标物料 ${index}`, businessLine: "rd" }));
  const rows = [...targetRows,
    task("different-line", { materialName: "目标物料 生产", businessLine: "production" }),
    task("different-status", { materialName: "目标物料 在途", businessLine: "rd", status: "in_transit" }),
    task("different-keyword", { materialName: "其他物料", businessLine: "rd" }),
  ];
  const view = fixture(t, { surface: "samples", search: "?line=rd", tasks: rows });
  const display = () => view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式");
  const cards = () => nodes(view.render()).filter((node) => node.type === "ProcurementTaskCard");
  assert.equal(display().props.value, "table");
  assert.equal(view.byType("ProcurementTaskTable").props.tasks.length, 10);
  display().props.onValueChange("masonry");
  assert.equal(cards().length, 9, "默认视图使用原来的首批任务数");
  for (const label of ["瀑布流视图", "表格视图"]) assert.ok(view.find((node) => node.type === "ToggleGroupItem" && node.props["aria-label"] === label));

  view.input("搜索采购任务", "目标物料");
  view.find((node) => node.type === "StatCell" && node.props.label === "待确认").props.onClick();
  const visible = cards().map((node) => node.props.task);
  assert.deepEqual(visible, targetRows.slice(0, 9));
  cards()[0].props.onNext(visible[0]);
  const originalSearch = view.router.state.location.search;
  display().props.onValueChange("table");
  const table = view.byType("ProcurementTaskTable");
  assert.equal(display().props.value, "table");
  assert.equal(cards().length, 0);
  assert.deepEqual(table.props.tasks, targetRows.slice(0, 10), "表格复用筛选结果，默认每页十条，不沿用瀑布流的九条增量");
  assert.equal(view.find((node) => node.type === "Input" && node.props["aria-label"] === "搜索采购任务").props.value, "目标物料");
  assert.equal(view.router.state.location.search, originalSearch);
  assert.equal(view.find((node) => node.type === "StatCell" && node.props.label === "待确认").props.active, true);
  table.props.onNext(visible[0]);
  table.props.onReassign(visible[0]);
  table.props.onRemove(visible[0]);
  assert.deepEqual(view.calls.next, [[visible[0].id, "card"], [visible[0].id, "card"]]);
  assert.deepEqual(view.calls.reassign, [visible[0].id]);
  assert.deepEqual(view.calls.remove, [visible[0].id]);
  table.props.onOpen(visible[0]);
  assert.equal(view.byType("ProcurementTaskSummaryDrawer").props.task, visible[0]);
  assert.equal(view.byType("ProcurementTaskTable").props.selectedTaskId, visible[0].id);
  view.byType("ProcurementTaskTable").props.onOpen(visible[1]);
  assert.equal(view.byType("ProcurementTaskSummaryDrawer").props.task, visible[1]);
  assert.equal(view.byType("ProcurementTaskTable").props.selectedTaskId, visible[1].id);
  assert.equal(view.router.state.location.search, originalSearch);
  view.byType("ProcurementTaskSummaryDrawer").props.onClose();
  display().props.onValueChange("masonry");
  assert.equal(view.byType("ProcurementTaskTable"), undefined);
  assert.deepEqual(cards().map((node) => node.props.task), visible);
  assert.equal(view.router.state.location.search, originalSearch);
});

test("采购任务表格支持页码和前后翻页，首尾边界不会遗漏或重复任务", (t) => {
  const rows = Array.from({ length: 23 }, (_, index) => task(`page-${index}`));
  const view = fixture(t, { surface: "samples", search: "", tasks: rows });
  view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式").props.onValueChange("table");
  const currentRows = () => view.byType("ProcurementTaskTable").props.tasks;
  const button = (label) => view.find((node) => node.props?.["aria-label"] === label && typeof node.props?.onClick === "function");
  assert.deepEqual(currentRows(), rows.slice(0, 10));
  assert.equal(button("上一页").props.disabled, true);
  assert.equal(button("下一页").props.disabled, false);
  assert.doesNotMatch(text(view.render()), /下拉加载更多|已加载全部/);
  const seen = [...currentRows()];
  view.click("下一页");
  assert.deepEqual(currentRows(), rows.slice(10, 20));
  seen.push(...currentRows());
  view.click("下一页");
  assert.deepEqual(currentRows(), rows.slice(20));
  seen.push(...currentRows());
  assert.deepEqual(seen, rows);
  assert.equal(button("下一页").props.disabled, true);
  view.click("上一页");
  assert.deepEqual(currentRows(), rows.slice(10, 20));
  view.click("第 1 页");
  assert.deepEqual(currentRows(), rows.slice(0, 10));
  view.click("第 3 页");
  assert.deepEqual(currentRows(), rows.slice(20));
});

test("采购任务表格支持每页 10、20、50 条，改变数量回到第一页", (t) => {
  const rows = Array.from({ length: 65 }, (_, index) => task(`size-${index}`));
  const view = fixture(t, { surface: "samples", search: "", tasks: rows });
  view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式").props.onValueChange("table");
  const pageSize = () => view.find((node) => node.type === "Select" && nodes(node).some((child) => child.props?.["aria-label"] === "每页条数"));
  const currentRows = () => view.byType("ProcurementTaskTable").props.tasks;
  assert.equal(pageSize().props.value, "10");
  assert.deepEqual(nodes(pageSize()).filter((node) => node.type === "SelectItem").map((node) => node.props.value), ["10", "20", "50"]);
  view.click("第 3 页");
  assert.deepEqual(currentRows(), rows.slice(20, 30));
  pageSize().props.onValueChange("20");
  assert.deepEqual(currentRows(), rows.slice(0, 20));
  view.click("下一页");
  assert.deepEqual(currentRows(), rows.slice(20, 40));
  pageSize().props.onValueChange("50");
  assert.deepEqual(currentRows(), rows.slice(0, 50));
  view.click("下一页");
  assert.deepEqual(currentRows(), rows.slice(50));
});

test("采购表格搜索和状态筛选回到首页，后台数据缩减只收敛到最后有效页", (t) => {
  const retained = Array.from({ length: 30 }, (_, index) => task(`keep-${index}`, { materialName: `保留物料 ${index}` }));
  const rows = [...retained, ...Array.from({ length: 10 }, (_, index) => task(`other-${index}`, { status: "in_transit" }))];
  const view = fixture(t, { surface: "samples", search: "", tasks: rows });
  view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式").props.onValueChange("table");
  const currentRows = () => view.byType("ProcurementTaskTable").props.tasks;
  view.click("第 3 页");
  assert.deepEqual(currentRows(), retained.slice(20));
  view.input("搜索采购任务", "保留物料");
  assert.deepEqual(currentRows(), retained.slice(0, 10));
  view.click("下一页");
  view.find((node) => node.type === "StatCell" && node.props.label === "待确认").props.onClick();
  assert.deepEqual(currentRows(), retained.slice(0, 10));
  view.click("第 3 页");
  view.setState({ tasks: retained.slice(0, 12) });
  assert.deepEqual(currentRows(), retained.slice(10, 12));
  const next = view.find((node) => node.props?.["aria-label"] === "下一页" && typeof node.props?.onClick === "function");
  assert.equal(next.props.disabled, true);
  view.setState({ tasks: [] });
  assert.equal(view.byType("ProcurementTaskTable"), undefined);
  assert.match(text(view.render()), /没有符合条件的任务/);
});

test("采购表格弹层打开期间禁用页码和每页数量，处理器也不能切走当前任务", (t) => {
  const rows = Array.from({ length: 23 }, (_, index) => task(`locked-${index}`));
  const view = fixture(t, { surface: "samples", search: "", tasks: rows });
  const display = () => view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式");
  const pageSize = () => view.find((node) => node.type === "Select" && nodes(node).some((child) => child.props?.["aria-label"] === "每页条数"));
  display().props.onValueChange("table");
  view.click("第 2 页");
  view.byType("ProcurementTaskTable").props.onOverlayOpenChange(rows[10].id, true);
  const before = view.byType("ProcurementTaskTable").props.tasks;
  for (const label of ["上一页", "下一页", "第 1 页"]) {
    const button = view.find((node) => node.props?.["aria-label"] === label && typeof node.props?.onClick === "function");
    assert.equal(button.props.disabled, true, label);
    button.props.onClick();
    assert.deepEqual(view.byType("ProcurementTaskTable").props.tasks, before);
  }
  assert.equal(pageSize().props.disabled, true);
  pageSize().props.onValueChange("20");
  assert.equal(pageSize().props.value, "10");
  assert.deepEqual(view.byType("ProcurementTaskTable").props.tasks, before);
  display().props.onValueChange("masonry");
  assert.equal(display().props.value, "table");
  view.byType("ProcurementTaskTable").props.onOverlayOpenChange(rows[10].id, false);
  view.click("下一页");
  assert.deepEqual(view.byType("ProcurementTaskTable").props.tasks, rows.slice(20));
});

test("任务显示模式不接受空选择，卡片或表格弹层打开期间保持当前模式", (t) => {
  const view = fixture(t, { surface: "samples", search: "", tasks: [task("A")] });
  const display = () => view.find((node) => node.type === "ToggleGroup" && node.props["aria-label"] === "任务显示模式");
  display().props.onValueChange("masonry");
  const expectDisplay = (value) => {
    assert.equal(display().props.value, value);
    assert.equal(view.find((node) => node.props?.["aria-label"] === "采购任务列表").props["data-display"], value);
  };
  for (const value of ["", "unknown"]) {
    display().props.onValueChange(value);
    expectDisplay("masonry");
  }
  view.byType("ProcurementTaskCard").props.onOverlayOpenChange("A", true);
  display().props.onValueChange("table");
  expectDisplay("masonry");
  view.byType("ProcurementTaskCard").props.onOverlayOpenChange("A", false);
  display().props.onValueChange("table");
  expectDisplay("table");
  display().props.onValueChange("");
  expectDisplay("table");
  view.byType("ProcurementTaskTable").props.onOverlayOpenChange("A", true);
  display().props.onValueChange("masonry");
  expectDisplay("table");
  view.byType("ProcurementTaskTable").props.onOverlayOpenChange("A", false);
  display().props.onValueChange("masonry");
  expectDisplay("masonry");
});

test("样品页不显示返回采购工作台按钮，不受来源或工作台路由配置影响", (t) => {
  const precise = "/proc-my-workspace?month=2026-09&period=carryover&product=product-A&supplier=Alpha&q=PO-10&page=2&task=A";
  const customRoutes = { ...defaultRoutes, routePath: (permission, fallback) => permission === "page:proc-my-workspace" ? "/my-purchasing" : fallback };
  for (const [locationState, routes] of [
    [{ procurementWorkspaceReturn: precise }, defaultRoutes],
    [null, defaultRoutes],
    [{ procurementWorkspaceReturn: "//outside.invalid" }, defaultRoutes],
    [null, customRoutes],
    [{ procurementWorkspaceReturn: "/my-purchasing?month=2026-09&task=A" }, customRoutes],
  ]) {
    const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", tasks: [task("A")], locationState, routes });
    assert.equal(view.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"), undefined);
    assert.equal(`${view.router.state.location.pathname}${view.router.state.location.search}`, "/proc-cockpit?tab=samples&sample=A");
    assert.deepEqual(view.router.state.location.state, locationState);
  }
});

test("样品列表已确认的切换保留原工作台来源和筛选，只消费一次离页放行", async (t) => {
  const locationState = { procurementWorkspaceReturn: "/proc-my-workspace?month=2026-09&task=A", unrelatedState: "preserved" };
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A&line=rd", tasks: [task("A"), task("B")], locationState });
  view.sample().props.onInteractionStateChange({ dirty: true, busy: false });
  view.sample().props.onSelect("B");
  assert.equal(view.query().get("sample"), "B");
  assert.equal(view.query().get("line"), "rd");
  assert.deepEqual(view.router.state.location.state, locationState);
  assert.equal(view.guard().props.open, false, "列表确认过的切换不应再弹第二次确认");
  await view.router.navigate(locationState.procurementWorkspaceReturn);
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true, "先前换样品的放行不能顺带放行返回工作台");
});

test("样品页不显示返回按钮，提交中仍由真实导航保护阻止离开", async (t) => {
  const denied = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", allowed: false });
  assert.equal(denied.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"), undefined);
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A" });
  view.sample().props.onInteractionStateChange({ dirty: false, busy: true });
  assert.equal(view.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"), undefined);
  await view.router.navigate("/proc-my-workspace");
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true);
  assert.equal(nodes(view.guard()).find((node) => node.type === "AlertDialogAction"), undefined);
  view.sample().props.onInteractionStateChange({ dirty: false, busy: false });
  assert.equal(view.guard().props.open, false);
  assert.equal(view.router.state.location.pathname, "/proc-cockpit", "提交完成后不重放被阻止的离页操作");
});

test("脏草稿导航离开仍需放弃确认，取消保留样品，确认才前往完整工作台地址", async (t) => {
  const destination = "/proc-my-workspace?month=2026-09&product=product-A&task=A";
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A", locationState: { procurementWorkspaceReturn: destination } });
  view.sample().props.onInteractionStateChange({ dirty: true, busy: false });
  view.render();
  await view.router.navigate(destination);
  assert.equal(view.router.state.location.pathname, "/proc-cockpit");
  assert.equal(view.guard().props.open, true);
  view.guard().props.onOpenChange(false);
  assert.equal(view.guard().props.open, false);
  assert.equal(view.query().get("sample"), "A");
  await view.router.navigate(destination);
  const confirm = nodes(view.guard()).find((node) => node.type === "AlertDialogAction");
  assert.ok(confirm);
  confirm.props.onClick({ preventDefault() {} });
  await new Promise(setImmediate);
  assert.equal(`${view.router.state.location.pathname}${view.router.state.location.search}`, destination);
});

test("驾驶舱默认展示采购任务且各页面不再显示顶部栏目标签", (t) => {
  const defaultView = fixture(t, { surface: "samples", search: "", tasks: [task("mine")] });
  assert.equal(defaultView.tabs("供应链驾驶舱栏目"), undefined);
  assert.ok(defaultView.byType("ProcurementTaskTable"));
  assert.equal(defaultView.sample(), undefined);
  const view = fixture(t, { surface: "samples", search: "?tab=samples&sample=A" });
  assert.equal(view.tabs("供应链驾驶舱栏目"), undefined);
  assert.equal(view.find((node) => node.type === "Button" && text(node).trim() === "返回采购工作台"), undefined);
});

test("真实驾驶舱切换产品或模块时清理旧计划筛选与展开，不串到新模块", (t) => {
  const search = '?view=systems&product=P&module=M&moduleTab=plans&stockType=material&stockMonth=2026-09&stockOpen=plan-1&stockFocus=plan-1&stockQ=valve&stockStatus=in_progress';
  const cases = [
    (view) => view.byType('ProcurementSystemTree').props.onProductChange('P2'),
    (view) => view.byType('ProcurementSystemTree').props.onOpenModule({ id: 'M2' }, 'P'),
    (view) => view.byType('ProcurementSystemTree').props.onCloseModule(),
  ];
  for (const change of cases) {
    const view = fixture(t, { surface: 'samples', search });
    change(view); view.render();
    for (const key of ['moduleTab', 'stockType', 'stockMonth', 'stockOpen', 'stockFocus', 'stockQ', 'stockStatus']) assert.equal(view.query().get(key), null, key);
  }
});

test('深链打开详情后选择另一行，后台刷新仍保持新选择', (t) => {
  const first = task('A'), second = task('B');
  const view = fixture(t, { surface: 'samples', search: '?task=A', tasks: [first, second] });
  assert.equal(view.byType('ProcurementTaskSummaryDrawer').props.task.id, 'A');
  view.byType('ProcurementTaskTable').props.onOpen(second);
  assert.equal(view.byType('ProcurementTaskSummaryDrawer').props.task.id, 'B');
  assert.equal(view.query().get('task'), 'B');
  view.setState({ tasks: [{ ...first, updatedAt: 'v2' }, { ...second, updatedAt: 'v2' }] });
  assert.equal(view.byType('ProcurementTaskSummaryDrawer').props.task.id, 'B');
  view.byType('ProcurementTaskSummaryDrawer').props.onClose();
  assert.equal(view.query().get('task'), null);
});


test("工作台按业务筛选，关闭详情后选其他行直接打开对应任务，MateChat 保留", (t) => {
  const view = fixture(t, { tasks: [task("rd", { businessLine: "rd" }), task("production", { businessLine: "production" })] });
  view.panel().props.onClose();
  assert.equal(view.visible(node => node.type === "TaskDetailDrawer" && node.props.presentation === "workspace"), undefined);
  view.byType("ProcWorkspaceTaskList").props.onSelect("production");
  assert.equal(view.visible(node => node.type === "TaskDetailDrawer" && node.props.presentation === "workspace").props.task.id, "production");
  assert.ok(view.visibleByType("MateChatStreakCardConnected"));
  view.filter("所属业务", "rd");
  assert.deepEqual(view.ids(), ["rd"]);
});


test("精简工作台只保留一个任务列表，MateChat 位于顶部人员提示右侧且保留完整入口", (t) => {
  const view = fixture(t, { tasks: [task("A")] });
  const tree = view.render();
  for (const type of ["ProcWorkspaceArrivals", "ProcWorkspaceAggregation"]) assert.equal(view.byType(type), undefined);
  assert.equal(view.tabs("个人工作台栏目"), undefined);
  assert.equal(view.tabs("按需求月份查看任务"), undefined);
  assert.equal(view.find(node => node.type === "Input" && node.props.type === "month"), undefined);
  const top = nodes(tree).find(node => node.props?.className === "proc-s01-top-row");
  assert.ok(top);
  assert.ok(nodes(top).some(node => node.props?.["aria-label"] === "当前人员与任务概况"));
  const chat = nodes(top).find(node => node.type === "MateChatStreakCardConnected");
  assert.equal(chat.props.variant, "full");
  assert.equal(chat.props.onGoChat, undefined);
  assert.equal(nodes(tree).filter(node => node.type === "MateChatStreakCardConnected").length, 1);
  assert.ok(view.panel());
});

test("旧月份、汇总和到货链接不再产生隐藏过滤，未填日期及历史完成任务仍可查看", (t) => {
  const rows = [task("old", { needDate: "2026-01-01" }), task("future", { needDate: "2027-01-01" }), task("undated", { needDate: undefined }), task("done", { status: "completed" }), task("other", { buyerUserId: "buyer-2" })];
  for (const search of ["?period=month&month=2026-09&source=stock&arrivals=open&arrivalFocus=x&arrivalPage=3", "?period=carryover&source=arrival&arrivalView=calendar&arrivalMonth=2020-01&arrivalDay=undated&focus=week"]) {
    const view = fixture(t, { tasks: rows, search });
    assert.deepEqual(view.ids().slice().sort(), ["done", "future", "old", "undated"]);
    for (const key of ["period", "month", "source", "arrivals", "arrivalPage", "arrivalFocus", "arrivalView", "arrivalMonth", "arrivalDay", "focus"]) assert.equal(view.query().has(key), false, key);
    assert.equal(view.byType("ProcWorkspaceArrivals"), undefined);
    assert.equal(view.byType("ProcWorkspaceAggregation"), undefined);
  }
});

test("业务、产品、供应商、状态与搜索保持联动，完成任务通过状态过滤查看", (t) => {
  const rows = [task("rd", { businessLine: "rd", purchaseOrders: [po("甲")] }), task("done", { businessLine: "rd", status: "completed", purchaseOrders: [po("甲")] }), task("production", { businessLine: "production", productId: "product-B", purchaseOrders: [po("乙")] })];
  const view = fixture(t, { tasks: rows });
  view.filter("所属业务", "rd"); assert.deepEqual(view.ids().slice().sort(), ["done", "rd"]);
  view.filter("状态", "completed"); assert.deepEqual(view.ids(), ["done"]);
  view.filter("产品", "product-B"); assert.deepEqual(view.ids(), []);
  view.filter("产品", "product-A"); assert.deepEqual(view.ids(), ["done"]);
  view.filter("供应商", "乙"); assert.deepEqual(view.ids(), []);
  view.filter("供应商", "甲"); assert.deepEqual(view.ids(), ["done"]);
  view.input("搜索我的采购任务", "没有匹配"); assert.deepEqual(view.ids(), []);
  view.click("清除筛选"); assert.equal(view.ids().length, 3);
  assert.equal(view.count("当前范围"), 3);
});

test("任务分页不截断筛选，跨页切换详情后保留已选任务", (t) => {
  const rows = Array.from({ length: 43 }, (_, i) => task('T' + String(i).padStart(2, '0')));
  const view = fixture(t, { tasks: rows });
  assert.equal(view.ids().length, 20);
  view.click("下一页"); assert.equal(view.ids()[0], "T20");
  view.byType("ProcWorkspaceTaskList").props.onSelect("T22");
  assert.equal(view.panel().props.task.id, "T22");
  view.click("下一页"); assert.equal(view.ids().length, 3);
  assert.equal(view.panel().props.task.id, "T22");
  view.click("上一页"); assert.equal(view.ids().length, 20);
  view.input("搜索我的采购任务", "T42"); assert.deepEqual(view.ids(), ["T42"]);
  assert.equal(view.query().has("page"), false);
});

test("右侧直接使用原详情，账号或权限变化重新隔离，加载错误时禁止操作", (t) => {
  const view = fixture(t, { tasks: [task("A"), task("B")] });
  const original = view.panel();
  assert.equal(original.props.presentation, "workspace");
  assert.equal(original.props.readOnly, false);
  view.byType("ProcWorkspaceTaskList").props.onSelect("B");
  assert.equal(view.panel().props.task.id, "B");
  assert.notEqual(view.panel().key, original.key);
  view.setState({ error: "offline" });
  assert.equal(view.panel().props.readOnly, true);
  view.setState({ error: null });
  view.setUser({ ...user, permissions: ["page:proc-my-workspace"] });
  assert.notEqual(view.panel().key, original.key);
  assert.equal(view.panel().props.task.id, "B");
  view.setUser({ id: "other", name: "他人" });
  assert.equal(view.panel(), undefined);
  assert.deepEqual(view.ids(), []);
});
