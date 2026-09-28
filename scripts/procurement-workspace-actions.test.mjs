import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const commonSource = read("src/app/procurement/components/common.tsx");
const commonAst = ts.createSourceFile("common.tsx", commonSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const commonNames = ["PROC_STATUS_META", "procurementNextAction", "ROLLBACK_MAIN_FLOW", "ROLLBACK_DIRECT_FLOW", "rollbackTargetsOf"];
const common = {};
new Function("exports", transpile(commonAst.statements.filter((node) => commonNames.includes(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => commonNames.includes(item.name.getText(commonAst))))
  .map((node) => node.getText(commonAst)).join("\n")))(common);
const logic = {};
new Function("exports", transpile(read("src/app/procurement/procurementLogic.ts")))(logic);
const dates = {};
new Function("exports", "require", "window", transpile(read("src/app/procurement/data.ts")))(dates, (name) => {
  const dependencies = { react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} }, "../lib/procurementApi": {}, "../lib/rdApi": {} };
  assert.ok(name in dependencies);
  return dependencies[name];
}, undefined);
const workspaceModel = {};
new Function("exports", "require", transpile(read("src/app/procurement/procurementWorkspaceModel.ts")))(workspaceModel, (name) => {
  assert.equal(name, "./data");
  return dates;
});
const arrivalNavigation = {};
new Function("exports", "require", transpile(read("src/app/lib/workspaceArrivalNavigation.ts")))(arrivalNavigation, (name) => {
  assert.equal(name, "./routePaths");
  return { routePath: (_permission, fallback) => fallback };
});

const own = { id: "mine", buyerUserId: "buyer-1", buyer: "张工", code: "PR-001", status: "testing", method: "inquiry", source: "self", businessLine: "rd",
  materialName: "组件", unit: "件", quantity: 1, arrivedQty: 0, priority: "low", attachmentList: [], purchaseOrders: [], logs: [], paymentStatus: "unpaid" };

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function fixture(component, { allowed = true, task = own, tasks = [own], props = {} } = {}) {
  const path = component === "ProcMyWorkspacePage" ? "src/app/procurement/ProcMyWorkspacePage.tsx" : "src/app/procurement/components/ProcurementTaskCard.tsx";
  const text = read(path);
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = ast.statements.filter(ts.isImportDeclaration).flatMap((node) => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    ? node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : []);
  const stubs = Object.fromEntries(imports.map((name) => [name, name]));
  const slots = [];
  let cursor = 0;
  let actionHandlers;
  let params = new URLSearchParams("period=all&task=mine");
  Object.assign(stubs, common, logic, workspaceModel, arrivalNavigation, {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: (factory) => factory(), useEffect() {},
    useAuth: () => ({ user: { id: "buyer-1", name: "张工" } }),
    useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key) }),
    useNavigate: () => () => {},
    useLocation: () => ({ pathname: '/proc-my-workspace', search: '', key: 'workspace-action-test' }),
    useSearchParams: () => [params, (next) => { params = typeof next === "function" ? next(params) : next; }],
    routePath: (_permission, fallback) => fallback,
    useProcurementData: () => ({ tasks, materials: [], loading: false }),
    useProcurementProducts: () => [],
    useProcTaskAction: handlers => { actionHandlers = handlers; return {}; }, useProcCan: () => (permission) => allowed && permission === "proc-task:rollback",
    isProcurementTaskOverdue: () => false, daysFromToday: () => null, taskMainDate: () => ({}), taskRequester: () => ({ name: "研发员" }),
    nextPermissionOf: () => "proc-task:transition", removalModeOf: () => "delete", cn: (...values) => values.filter(Boolean).join(" "),
  });
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  const body = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n");
  new Function("exports", "stubs", "require", `const {${imports.join(",")}} = stubs;\n${transpile(body)}`)(exports, stubs, (name) => {
    assert.equal(name, "react/jsx-runtime");
    return { jsx, jsxs: jsx, Fragment: "Fragment" };
  });
  return {
    openAction: (...args) => actionHandlers.onOpenDetail(...args),
    render() {
      cursor = 0;
      const tree = exports[component]({ task, materials: [], onOpen() {}, ...props });
      return tree.type === "TaskCriticalMaterialsEditor" ? tree.props.children({ openEditor() {} }) : tree;
    },
    find(predicate) { return nodes(this.render()).find(predicate); },
    all() { return nodes(this.render()); },
  };
}

test("个人工作台右侧只绑定本人任务，回退和日志仍路由到同一详情抽屉", () => {
  const view = fixture("ProcMyWorkspacePage", { tasks: [own, { ...own, id: "other", buyerUserId: "buyer-2" }, { ...own, id: "finished", status: "completed" }] });
  const list = view.find((node) => node.type === "ProcWorkspaceTaskList");
  assert.deepEqual(list.props.tasks.map((task) => task.id).sort(), ["finished", "mine"]);
  const panel = view.find((node) => node.type === "TaskDetailDrawer" && node.props.presentation === 'workspace');
  assert.equal(panel.props.task.id, "mine");
  view.openAction(own, "rollback");
  let drawer = view.find((node) => node.type === "TaskDetailDrawer" && node.props.initialAction);
  assert.equal(drawer.props.task.id, "mine");
  assert.equal(drawer.props.initialAction, "rollback");
  assert.equal(drawer.key, "mine", "不同任务使用独立抽屉状态");
  drawer.props.onClose();
  assert.equal(view.find((node) => node.type === "TaskDetailDrawer" && node.props.initialAction), undefined);
  view.openAction(own, "logs");
  drawer = view.find((node) => node.type === "TaskDetailDrawer" && node.props.initialAction);
  assert.equal(drawer.props.initialAction, "logs");
  drawer.props.onClose();
  view.openAction(own);
  const detailPage = view.find((node) => node.type === "ProcurementTaskDetailPage");
  assert.equal(detailPage.props.task, own);
  assert.equal(view.find((node) => node.type === "TaskDetailDrawer"), undefined);
  detailPage.props.onClose();
  assert.equal(view.find((node) => node.type === "ProcurementTaskDetailPage"), undefined);
  assert.equal(view.find((node) => node.type === "TaskDetailDrawer" && node.props.presentation === 'workspace').props.task, own);
});

test("卡片回退采用真实权限与流程规则；已完成、取消和无权限任务不提供回退", () => {
  for (const scenario of [
    { status: "testing", allowed: true, visible: true },
    { status: "testing", allowed: false, visible: false },
    { status: "pending_confirm", allowed: true, visible: false },
    { status: "completed", allowed: true, visible: false },
    { status: "cancelled", allowed: true, visible: false },
  ]) {
    const view = fixture("ProcurementTaskCard", { task: { ...own, status: scenario.status }, allowed: scenario.allowed, props: { onRollback() {}, onViewLogs() {} } });
    assert.equal(Boolean(view.find((node) => node.props?.["aria-label"] === "回退任务")), scenario.visible);
    assert.ok(view.find((node) => node.props?.["aria-label"] === "查看操作记录"));
  }
});

test("直接回退和日志按钮只调用各自动作，不同时触发打开卡片或前进", () => {
  const calls = [];
  const view = fixture("ProcurementTaskCard", { props: {
    onOpen: () => calls.push("open"), onNext: () => calls.push("next"),
    onRollback: (task) => calls.push(`rollback:${task.id}`), onViewLogs: (task) => calls.push(`logs:${task.id}`),
  } });
  let stopped = 0;
  for (const label of ["回退任务", "查看操作记录"]) {
    view.find((node) => node.props?.["aria-label"] === label).props.onClick({ stopPropagation() { stopped++; } });
  }
  assert.deepEqual(calls, ["rollback:mine", "logs:mine"]);
  assert.equal(stopped, 2);
  const oldCaller = fixture("ProcurementTaskCard");
  assert.equal(oldCaller.find((node) => node.props?.["aria-label"] === "回退任务"), undefined);
  assert.equal(oldCaller.find((node) => node.props?.["aria-label"] === "查看操作记录"), undefined);
});
