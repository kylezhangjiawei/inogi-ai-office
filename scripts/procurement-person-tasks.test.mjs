import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "require", ...Object.keys(globals), code)(exports, (name) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, ...Object.values(globals));
  return exports;
}
const data = load("src/app/procurement/data.ts", { react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} }, "../lib/procurementApi": {}, "../lib/rdApi": {} }, { window: undefined });
const workspace = load("src/app/procurement/procurementWorkspaceModel.ts", { "./data": data });
const facts = load("src/app/lib/procSampleFacts.ts");
const samples = load("src/app/procurement/sampleWorkspaceModel.ts", { "../lib/procSampleFacts": facts });
const model = load("src/app/procurement/people/personTaskModel.ts", { "../../lib/procSampleFacts": facts, "../sampleWorkspaceModel": samples, "../procurementWorkspaceModel": workspace });
const owner = load("src/app/procurement/procurementLogic.ts");
const task = (id, overrides = {}) => ({ id, code: `PROC-${id}`, materialName: "测试阀体", spec: "M20", unit: "件", buyer: "采购甲", buyerUserId: "buyer-A", quantity: 20, status: "pending_confirm", needDate: "2026-09-15", priority: "medium", needSample: false, purchaseOrders: [], updatedAt: "2026-09-01T00:00:00Z", logs: [], ...overrides });
const filters = (overrides = {}) => ({ month: "2026-09", period: "month", business: "all", state: "all", query: "", ...overrides });
const ids = (rows) => rows.map((row) => row.id);

test("同名账号按ID分组，缺ID歧义历史单独保留，非名录账号仍可查", () => {
  const names = owner.uniqueRosterUserIdsByName([{ id: "buyer-A", name: "同名" }, { id: "buyer-B", name: "同名" }]);
  const rows = [task("A", { buyer: "同名" }), task("B", { buyer: "同名", buyerUserId: "buyer-B" }), task("legacy", { buyer: "同名", buyerUserId: undefined }), task("history", { buyerUserId: "former", status: "completed" })];
  assert.deepEqual(rows.map((row) => owner.resolveProcurementOwner(row, names, "unassigned").key), ["buyer-A", "buyer-B", "name:同名", "former"]);
  assert.deepEqual(ids(model.personTaskView([rows[3]], filters()).tasks), ["history"]);
});
test("同源ID只保留最新快照，终态历史仍在全部任务中", () => {
  const before = task("same"), after = task("same", { status: "completed", updatedAt: "2026-09-02T00:00:00Z" });
  const result = model.personTaskView([before, after, task("other")], filters());
  assert.equal(result.total, 2); assert.equal(result.active, 1);
  assert.equal(result.tasks.find((row) => row.id === "same"), after);
  assert.deepEqual(ids(model.personTaskView([before, after], filters({ state: "active" })).tasks), []);
});
test("跨月与缺日期独立提醒不受搜索、分类或终态筛选隐藏", () => {
  const rows = [task("old", { needDate: "2026-08-01" }), task("none", { needDate: undefined }), task("done", { needDate: "2026-08-01", status: "completed" }), task("future", { needDate: "2026-10-01" })];
  const result = model.personTaskView(rows, filters({ query: "不存在", business: "sample", state: "closed" }));
  assert.deepEqual(result.tasks, []); assert.deepEqual(ids(result.carryover), ["old"]); assert.deepEqual(ids(result.undated), ["none"]);
});
test("月份只读取合法需求日期，不拿创建日或预计到货替代", () => {
  for (const needDate of [undefined, "2026-02-30", "2026-13-01", "2026-09-12Tinvalid"]) {
    const row = task("invalid", { needDate, expectedArrivalDate: "2026-09-15", createdAt: "2026-09-01" });
    assert.equal(model.personTaskNeedDate(row), "");
    assert.equal(model.personTaskView([row], filters()).undated.length, 1);
  }
  assert.equal(model.personTaskNeedDate(task("valid", { needDate: "2026-09-15T03:00:00Z" })), "2026-09-15");
});
test("普通采购与样品相关互斥，历史样品记录不是新任务", () => {
  const rows = [task("normal"), task("sample", { needSample: true }), task("history", { sampleTest: { result: "passed" } }), task("free", { purchaseOrders: [{ freeSample: true }] })];
  assert.deepEqual(ids(model.personTaskView(rows, filters({ business: "purchase" })).tasks), ["normal"]);
  assert.deepEqual(ids(model.personTaskView(rows, filters({ business: "sample" })).tasks).sort(), ["free", "history", "sample"]);
});
test("搜索支持原单号、供应商及测试人，提醒仍指向原ID", () => {
  const rows = [task("match", { sampleTest: { testerName: "Tester A" }, purchaseOrders: [{ tpOrderNo: "PO-123", supplierName: "Supplier B" }] }), task("else")];
  for (const query of ["po-123", "supplier b", "tester a", "proc-match"]) assert.deepEqual(ids(model.personTaskView(rows, filters({ query })).tasks), ["match"]);
});
test("跨月和无需求日入口仅显示未完，全部月份能查看终态历史", () => {
  const rows = [task("old", { needDate: "2026-08-01" }), task("done", { needDate: "2026-08-01", status: "completed" }), task("cancel", { needDate: undefined, status: "cancelled" })];
  assert.deepEqual(ids(model.personTaskView(rows, filters({ period: "carryover" })).tasks), ["old"]);
  assert.deepEqual(ids(model.personTaskView(rows, filters({ period: "undated" })).tasks), []);
  assert.equal(model.personTaskView(rows, filters({ period: "all", state: "closed" })).tasks.length, 2);
});
test("下一步依当前轮测试依据，缺失或重置分派不能显示等待旧测试人", () => {
  const assignment = { roundId: "round-1", testerUserId: "tester", testerName: "测试甲", assignedByName: "采购甲", assignedAt: "2026-09-01T01:00:00Z", result: null, confirmedAt: null };
  assert.equal(model.personTaskNext(task("testing", { status: "testing", sampleTest: assignment }), "安排研发测试"), "等待 测试甲 提交测试结论");
  assert.equal(model.personTaskNext(task("stale", { status: "testing", sampleTest: assignment, logs: [{ fromStatus: "priced", toStatus: "testing", createdAt: "2026-09-02T00:00:00Z" }] }), "安排研发测试"), "核对本轮样品与测试分派");
  assert.equal(model.personTaskNext(task("done", { status: "completed" }), "登记到货"), "已结束，查看历史记录");
  assert.equal(model.personTaskNext(task("ordinary"), "确认提交"), "确认提交");
});

const jsx = (type, props, key) => ({ type, props, key });
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree);
function drawerFixture(overrides = {}) {
  let props = { person: { key: "buyer-A", name: "采购甲", userId: "buyer-A", member: {}, tasks: [task("one"), task("old", { needDate: "2026-08-01" })] }, loading: false, error: null, ...overrides };
  let cursor = 0; const slots = [], calls = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useMemo(fn) { cursor++; return fn(); }, useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
  };
  const exported = load("src/app/procurement/people/PersonTasksDrawer.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": { ArrowLeft: "ArrowLeft", ArrowUpRight: "ArrowUpRight", Search: "Search" },
    "../../components/ui/button": { Button: "Button" }, "../../components/ui/input": { Input: "Input" },
    "../../components/ui/sheet": { Sheet: "Sheet", SheetContent: "SheetContent", SheetDescription: "SheetDescription", SheetHeader: "SheetHeader", SheetTitle: "SheetTitle" },
    "../../lib/i18n": { useI18n: () => ({ t: (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key) }) },
    "../../lib/procSampleFacts": facts, "../components/TaskDetailDrawer": { TaskDetailDrawer: "TaskDetailDrawer" },
    "../components/common": { PROC_STATUS_META: { pending_confirm: { label: "待处理", next: "确认提交" } } },
    "../sampleWorkspaceModel": samples, "./personTaskModel": model, "./personTasks.css": {},
  });
  const view = {
    calls,
    render() { cursor = 0; return exported.PersonTasksDrawer({ ...props, onClose: () => calls.push("close"), onRetry: () => calls.push("retry"), onRestoreFocus: () => calls.push("restore") }); },
    update(next) { props = { ...props, ...next }; return this.render(); },
    input(label, value) { nodes(this.render()).find((node) => node.props?.["aria-label"] === label).props.onChange({ target: { value } }); return this.render(); },
  };
  view.input("人员任务需求月份", "2026-09");
  return view;
}
test("完整详情使用原任务ID，单弹层切换并保存个人搜索范围", () => {
  const view = drawerFixture(); let tree = view.input("搜索该人员任务", "PROC-one");
  const open = nodes(tree).find((node) => node.props?.["aria-label"] === "查看任务完整详情：PROC-one"); open.props.onClick(); tree = view.render();
  assert.equal(tree.type, "TaskDetailDrawer"); assert.equal(tree.props.task.id, "one"); assert.equal(nodes(tree).filter((node) => node.type === "Sheet").length, 0);
  tree.props.onClose(); tree = view.render(); assert.equal(tree.type, "Sheet");
  assert.equal(nodes(tree).find((node) => node.props?.["aria-label"] === "搜索该人员任务").props.value, "PROC-one");
});
test("来源失败时数量未知、详情不可进入，重试保留原筛选", () => {
  const view = drawerFixture(); view.input("搜索该人员任务", "PROC-one"); const tree = view.update({ error: "任务来源断开" });
  assert.match(text(tree), /不能判断为零/); assert.equal(nodes(tree).filter((node) => node.props?.["aria-label"]?.startsWith("查看任务完整详情")).length, 0);
  const reminders = nodes(tree).filter((node) => node.props?.className === "proc-person-reminder"); assert.ok(reminders.every((node) => node.props.disabled)); assert.match(text(reminders), /—/);
  nodes(tree).find((node) => node.type === "Button" && text(node) === "重新读取人员与任务").props.onClick(); assert.deepEqual(view.calls, ["retry"]);
});
test("提醒入口清空搜索与业务分类，显示该人员原跨月未完任务", () => {
  const view = drawerFixture(); let tree = view.input("搜索该人员任务", "不存在");
  nodes(tree).find((node) => node.props?.className === "proc-person-reminder" && text(node).includes("跨月未完成")).props.onClick(); tree = view.render();
  assert.match(text(tree), /PROC-old/); assert.equal(nodes(tree).find((node) => node.props?.["aria-label"] === "搜索该人员任务").props.value, "");
});
test("原任务转派后不继续展示其详情，关闭列表仍恢复人员入口", () => {
  const view = drawerFixture(); nodes(view.render()).find((node) => node.props?.["aria-label"] === "查看任务完整详情：PROC-one").props.onClick(); assert.equal(view.render().type, "TaskDetailDrawer");
  const tree = view.update({ person: { key: "buyer-A", name: "采购甲", tasks: [] } }); assert.equal(tree.type, "Sheet"); assert.match(text(tree), /原任务已不在此人员名下/);
  nodes(tree).find((node) => node.type === "SheetContent").props.onCloseAutoFocus({ preventDefault() {} }); assert.deepEqual(view.calls, ["restore"]);
});
