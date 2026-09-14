import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "require", ...Object.keys(globals), code)(exports, (name) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, ...Object.values(globals));
  return exports;
}
const data = load("src/app/procurement/data.ts", { react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} }, "../lib/procurementApi": {}, "../lib/rdApi": {} }, { window: undefined });
const workspace = load("src/app/procurement/procurementWorkspaceModel.ts", { "./data": data });
const samples = load("src/app/procurement/sampleWorkspaceModel.ts", { "../lib/procSampleFacts": load("src/app/lib/procSampleFacts.ts") });
const model = load("src/app/procurement/procurementAggregationModel.ts", { "./procurementWorkspaceModel": workspace, "./sampleWorkspaceModel": samples });
const routes = { routePath: (_permission, fallback) => fallback };
const navigation = load("src/app/lib/stockPlanNavigation.ts", { "./routePaths": routes });
const task = (id, overrides = {}) => ({ id, code: `PR-${id}`, materialName: "阀体", spec: "M20", unit: "件", materialId: "material-A", productId: "A", buyer: "采购甲", status: "pending_confirm", quantity: 20, needDate: "2026-09-20", needSample: false, purchaseOrders: [], updatedAt: "2026-09-01T00:00:00Z", ...overrides });
const order = (id, overrides = {}) => ({ id, tpOrderId: "erp-1", tpOrderNo: "PO-1", tpLineNo: id, supplierName: "供应商甲", orderedQty: 20, receivedQty: 3, etaDate: "2026-09-15", ...overrides });
const plan = (id, overrides = {}) => ({ id, code: `SP-${id}`, materialName: "整机", unit: "台", productId: "A", targetQty: 100, status: "in_progress", readinessStatus: "partial_received", targetDate: "2026-09-15", createdBy: "buyer", batches: [], tasks: [], updatedAt: "2026-09-01T00:00:00Z", ...overrides });
const input = (overrides = {}) => ({ tasks: [], plans: [], userId: "buyer", month: "2026-09", productId: "all", supplier: "all", ...overrides });
const ids = (rows) => rows.map((row) => row.key);
const build = (overrides) => model.buildWorkspaceAggregation(input(overrides));

test("一个来源任务只计一次，样品与普通采购互斥；历史样品通过也不增加新任务", () => {
  const rows = build({ tasks: [task("one"), task("one"), task("sample", { sampleTest: { result: "passed" } }), task("done", { status: "completed" }), task("cancelled", { status: "cancelled" })] });
  assert.deepEqual(ids(rows), ["task:one", "task:sample"]);
  assert.equal(rows[0].business, "purchase"); assert.equal(rows[1].business, "sample");
});
test("源ID取最新快照后再判终态，不按同名物料或供应商合并不同任务", () => {
  const older = task("same"), newer = task("same", { status: "completed", updatedAt: "2026-09-02T00:00:00Z" });
  assert.deepEqual(ids(build({ tasks: [older, newer, task("A"), task("B")] })), ["task:A", "task:B"]);
  assert.equal(workspace.uniqueWorkspaceTasks([newer, older])[0], newer);
});
test("需求、目标、预计到货各自归月；非法日期单列，不借用创建日", () => {
  const rows = build({ tasks: [task("old", { needDate: "2026-08-31", purchaseOrders: [order("1", { etaDate: "2026-10-01" })] }), task("bad", { needDate: "2026-02-30" })], plans: [plan("unknown", { targetDate: undefined })] });
  assert.equal(rows.find((row) => row.id === "old").period, "carryover");
  assert.equal(rows.find((row) => row.id === "bad").period, "undated");
  assert.equal(rows.find((row) => row.business === "arrival").period, "future");
  assert.equal(rows.find((row) => row.business === "stock").period, "undated");
});
test("相关备货包括本人创建和关联已完成本人任务，不借创建人姓名冒充归属", () => {
  const rows = build({ tasks: [task("done", { status: "completed" })], plans: [plan("created"), plan("linked", { createdBy: "other", tasks: [{ id: "done" }] }), plan("other", { createdBy: "other", createdByName: "采购甲" })] });
  assert.deepEqual(ids(rows), ["plan:created", "plan:linked"]);
  assert.match(rows[0].relation, /非经办归属/); assert.equal(rows[1].relation, "关联本人采购任务");
});
test("下单达标仍未收齐/待检继续跟进，真正完成或取消订单不虚增待到货", () => {
  const rows = build({ plans: [plan("received", { status: "completed" }), plan("ready", { status: "completed", readinessStatus: "qualified" }), plan("conflict", { status: "completed", readinessStatus: "qualified", orderDataIssue: true })], tasks: [task("po", { purchaseOrders: [order("1", { status: "已作废" }), order("2", { approvalStatus: "cancelled" }), order("3", { receivedQty: 20 }), order("4")] })] });
  assert.deepEqual(rows.filter((row) => row.business === "stock").map((row) => row.id), ["conflict", "received"]);
  assert.equal(rows.filter((row) => row.business === "arrival").length, 1);
  assert.match(rows.find((row) => row.business === "stock" && row.id === "received").detail, /收货 \/ 检验待跟进/);
});
test("多供应商任务按实际订单行筛供应商，未确定仅保留无供应商行", () => {
  const tasks = [task("multi", { purchaseOrders: [order("1"), order("2", { supplierName: "供应商乙" }), order("3", { supplierName: "" })] })];
  assert.deepEqual(build({ tasks, supplier: "供应商甲" }).filter((row) => row.arrival).map((row) => row.arrival.lineNo), ["1"]);
  assert.deepEqual(build({ tasks, supplier: workspace.UNDETERMINED_SUPPLIER }).filter((row) => row.arrival).map((row) => row.arrival.lineNo), ["3"]);
});
test("重复ERP行去重但保留所有来源任务，冲突数量保持待核对且不累计库存", () => {
  const rows = build({ tasks: [task("A", { purchaseOrders: [order("1")] }), task("B", { purchaseOrders: [order("1", { id: "association-B", receivedQty: 4 })] })] }).filter((row) => row.arrival);
  assert.equal(rows.length, 1); assert.equal(rows[0].arrival.remainingQty, null);
  assert.deepEqual(rows[0].arrival.sourceTaskIds, ["A", "B"]); assert.match(rows[0].detail, /未收 待核对/);
});
test("来源分类独立保留跨月和日期待确认，不接受状态或搜索过滤参数", () => {
  const groups = model.partitionWorkspaceAggregation(build({ tasks: [task("old", { needDate: "2026-08-01" }), task("undated", { needDate: undefined }), task("month")], status: "testing", query: "not found" }), "purchase");
  assert.deepEqual(ids(groups.carryover), ["task:old"]); assert.deepEqual(ids(groups.undated), ["task:undated"]); assert.deepEqual(ids(groups.month), ["task:month"]);
});

const jsx = (type, props, key) => ({ type, props, key });
function nodes(tree) { if (Array.isArray(tree)) return tree.flatMap(nodes); return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(" "); return tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree); }
function fixture(t, overrides = {}) {
  let user = { id: "buyer", name: "采购甲", permissions: ["page:proc-cockpit"] }, allowed = true;
  let props = { tasks: [task("one")], month: "2026-09", productId: "all", supplier: "all", loading: false, error: null, disabled: false, ...overrides };
  let cursor = 0, dirty = false, slots = []; const effects = [], requests = [], listeners = new Set(), calls = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((value, index) => !Object.is(value, a[index]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useMemo(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const previous = slots[i]; const next = { deps }; slots[i] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const exports = load("src/app/procurement/components/ProcWorkspaceAggregation.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "lucide-react": { ArrowUpRight: "ArrowUpRight", RefreshCw: "RefreshCw" },
    "../../auth": { useAuth: () => ({ user }) }, "../../components/ui/button": { Button: "Button" }, "../../components/ui/tabs": { Tabs: "Tabs", TabsList: "TabsList", TabsTrigger: "TabsTrigger" },
    "../../lib/i18n": { useI18n: () => ({ t: (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key) }) },
    "../../lib/routePaths": routes, "../../lib/stockPlanNavigation": navigation,
    "../../lib/procurementApi": { listProcStockPlans(signal) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ signal, resolve, reject }); return promise; } },
    "../data": { PROCUREMENT_REFRESH_EVENT: "refresh" }, "../procurementAggregationModel": model, "./common": { useProcCan: () => () => allowed },
  }, { window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) } });
  const view = {
    requests, calls,
    render() { let tree; for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; tree = exports.ProcWorkspaceAggregation({ ...props, onSelectTask: (id) => calls.push(["task", id]), onNavigate: (path) => calls.push(["navigate", path]) }); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw new Error("Render did not settle"); },
    update(next) { props = { ...props, ...next }; return this.render(); },
    permission(value) { allowed = value; return this.render(); },
    account(id) { user = { ...user, id }; return this.render(); },
    tab(value) { nodes(this.render()).find((node) => node.type === "Tabs").props.onValueChange(value); return this.render(); },
    refresh() { for (const listener of listeners) listener(); return this.render(); },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
  };
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return view;
}
const group = (tree, title) => nodes(tree).find((node) => typeof node.type === "function" && node.props.title === title);

test("无备货权限不请求，恢复权限后读取；撤权即隐藏缓存且旧来源按钮失效", async (t) => {
  const view = fixture(t); let tree = view.permission(false); tree = view.tab("stock");
  assert.equal(view.requests.length, 0); assert.match(text(tree), /当前未读取/);
  view.permission(true); assert.equal(view.requests.length, 1); view.requests[0].resolve([plan("one")]); tree = await view.settle();
  const current = group(tree, "所选月待办"); assert.equal(current.props.rows.length, 1); current.props.onOpen(current.props.rows[0]); assert.match(view.calls[0][1], /stockFocus=one/);
  view.permission(false); current.props.onOpen(current.props.rows[0]); assert.equal(view.calls.length, 1); assert.equal(group(view.render(), "所选月待办"), undefined);
});
test("刷新失败保留成功快照并禁用来源，再成功恢复；首次失败不显示0", async (t) => {
  const view = fixture(t); view.tab("stock"); view.requests[0].resolve([plan("old")]); await view.settle();
  view.refresh(); view.requests[1].reject(new Error("网络中断")); let tree = await view.settle();
  assert.match(text(tree), /保留上次成功结果/); assert.equal(group(tree, "所选月待办").props.rows[0].id, "old"); assert.equal(group(tree, "所选月待办").props.disabled, true);
  view.refresh(); view.requests[2].resolve([]); tree = await view.settle(); assert.equal(group(tree, "所选月待办").props.rows.length, 0); assert.equal(group(tree, "所选月待办").props.disabled, false);
  const empty = fixture(t); empty.tab("stock"); empty.requests[0].reject(new Error("offline")); tree = await empty.settle();
  assert.match(text(tree), /不能判断为零/); assert.equal(group(tree, "所选月待办"), undefined);
});
test("账号改变撤销旧请求，晚返回数据不得回填新账号", async (t) => {
  const view = fixture(t); view.tab("stock"); view.account("new-buyer"); assert.equal(view.requests[0].signal.aborted, true);
  view.requests[0].resolve([plan("old-user")]); await view.settle(); assert.equal(group(view.render(), "所选月待办"), undefined);
  view.requests[1].resolve([plan("new-user", { createdBy: "new-buyer" })]); const tree = await view.settle(); assert.deepEqual(group(tree, "所选月待办").props.rows.map((row) => row.id), ["new-user"]);
});
test("计划源成功但任务源失败，来源计数保持未知并标注范围待补全", async (t) => {
  const view = fixture(t, { tasks: [], error: "tasks failed" }); view.tab("stock"); view.requests[0].resolve([plan("mine")]); const tree = await view.settle();
  assert.match(text(tree), /相关备货范围待补全/); assert.equal(group(tree, "所选月待办").props.incomplete, true);
  assert.match(text(nodes(tree).find((node) => node.type === "TabsTrigger" && node.props.value === "stock")), /—/);
});
test("筛选变更使旧来源处理器失效，普通任务入口只定位原任务不执行写操作", (t) => {
  const view = fixture(t); let tree = view.render(); const before = group(tree, "所选月待办");
  before.props.onOpen(before.props.rows[0]); assert.deepEqual(view.calls, [["task", "one"]]);
  view.update({ productId: "B" }); before.props.onOpen(before.props.rows[0]); assert.equal(view.calls.length, 1);
});

test("本月来源默认折叠保留数量，跨月默认只显示两行并提供更多", (t) => {
  const view = fixture(t, { tasks: [task("current"), ...[1, 2, 3].map((id) => task(`old-${id}`, { needDate: "2026-08-01" }))] });
  const tree = view.render(), month = group(tree, "所选月待办"), old = group(tree, "跨月未完成");
  const monthly = month.type(month.props); assert.equal(monthly.type, "details"); assert.equal(monthly.props.open, undefined); assert.match(text(nodes(monthly).find((node) => node.type === "summary")), /1/);
  const previous = old.type(old.props); assert.equal(nodes(previous).filter((node) => node.type === "li").length, 2); assert.match(text(previous), /显示更多/);
});
