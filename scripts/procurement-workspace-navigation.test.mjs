import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/app/lib/procurementWorkspaceNavigation.ts", import.meta.url), "utf8");
const helperCode = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function returnHelper(configuredPath = "/proc-my-workspace") {
  const exports = {};
  new Function("exports", "require", helperCode)(exports, (dependency) => {
    assert.equal(dependency, "./routePaths");
    return { routePath: (code, fallback) => {
      assert.equal(code, "page:proc-my-workspace");
      assert.equal(fallback, "/proc-my-workspace");
      return configuredPath;
    } };
  });
  return exports.procurementWorkspaceReturnPath;
}
const procurementWorkspaceReturnPath = returnHelper();

test("采购返回地址保留月份、筛选、页码和所选任务，不借用其他 state 字段", () => {
  const path = "/proc-my-workspace?month=2026-09&period=carryover&supplier=%E4%BE%9B%E5%BA%94%E5%95%86&page=2&task=PR-42";
  assert.equal(procurementWorkspaceReturnPath({ procurementWorkspaceReturn: path, task: { task_id: "RD-42" } }), path);
  assert.equal(procurementWorkspaceReturnPath({ procurementWorkspaceReturn: "/proc-my-workspace" }), "/proc-my-workspace");
  assert.equal(procurementWorkspaceReturnPath({ procurementWorkspaceReturn: `${path}#proc-workspace-current-task` }), `${path}#proc-workspace-current-task`);
  for (const state of [null, undefined, false, 42, path, [], {}, { from: path }, { procurementWorkspaceReturn: 42 }, { procurementWorkspaceReturn: { pathname: path } }]) {
    assert.equal(procurementWorkspaceReturnPath(state), null);
  }
});

test("拒绝外链、协议相对、其他路由、路径伪装和控制字符", () => {
  for (const path of [
    "https://example.com/proc-my-workspace", "http://localhost:5173/proc-my-workspace", "//example.com/proc-my-workspace",
    "javascript:alert(1)", "data:text/html,test", "proc-my-workspace", "/rd-my-workspace", "/proc-cockpit?tab=samples",
    "/proc-my-workspace/", "/proc-my-workspace-other", "/x/../proc-my-workspace", "/proc-my-workspace/../admin",
    "/%70roc-my-workspace", "/proc-my-workspace%3fnext=x", "/proc-my-workspace%2f..%2fadmin",
    " /proc-my-workspace", "/proc-my-workspace ", "/\\example.com/proc-my-workspace", "/proc-my-workspace?x=\\evil",
    "/proc-my-workspace?x=\n", "/proc-my-workspace\t", "/proc-my-workspace?x=\u0000", "/proc-my-workspace?x=\u007f",
  ]) assert.equal(procurementWorkspaceReturnPath({ procurementWorkspaceReturn: path }), null, JSON.stringify(path));
  // External-looking text inside a query stays a query on the allowed route.
  const query = "/proc-my-workspace?q=https%3A%2F%2Fexample.com%2Fpart";
  assert.equal(procurementWorkspaceReturnPath({ procurementWorkspaceReturn: query }), query);
});

test("返回仅接受当前配置的个人工作台路径，旧默认和相邻路径均拒绝", () => {
  const configured = returnHelper("/supply/buyer");
  assert.equal(configured({ procurementWorkspaceReturn: "/supply/buyer?task=PR-2" }), "/supply/buyer?task=PR-2");
  for (const path of ["/proc-my-workspace", "/supply/buyer-old", "/supply/buyer/", "/supply/./buyer"]) {
    assert.equal(configured({ procurementWorkspaceReturn: path }), null);
  }
});

const detailSource = readFileSync(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("RDTaskDetailPage.tsx", detailSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodesWhere(root, predicate) {
  const matches = [];
  const visit = (node) => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return matches;
}
const declaration = (name) => {
  const matches = nodesWhere(ast, (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.equal(matches.length, 1, `Expected one ${name}`);
  return matches[0].initializer;
};
function evaluate(node, bindings) {
  const code = ts.transpileModule(`return (${node.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

test("研发详情只在研发工作区采用已校验来源，生产和协同沿用原返回地址", () => {
  const valid = { procurementWorkspaceReturn: "/proc-my-workspace?month=2026-09&task=PR-2" };
  for (const [researchWorkspace, state, cockpitReturnPath, expected] of [
    [true, valid, "/rd-task-management", valid.procurementWorkspaceReturn],
    [true, {}, "/rd-my-workspace?activity_user_id=123", "/rd-my-workspace?activity_user_id=123"],
    [true, { procurementWorkspaceReturn: "//evil.test" }, "/rd-task-management", "/rd-task-management"],
    [false, valid, "/production-dashboard", "/production-dashboard"],
    [false, valid, "/us-collab-task-management", "/us-collab-task-management"],
  ]) {
    const procurementReturnPath = evaluate(declaration("procurementReturnPath"), { researchWorkspace, location: { state }, procurementWorkspaceReturnPath });
    assert.equal(evaluate(declaration("detailReturnPath"), { procurementReturnPath, workspaceReturnPath: null, cockpitReturnPath }), expected);
  }
});

test("研发序列切换继续保留原采购任务和筛选，且不会丢失任务预加载数据", () => {
  const original = "/proc-my-workspace?month=2026-08&period=carryover&task=PR-8&page=3";
  const taskReturnState = evaluate(declaration("taskReturnState").arguments[0], { procurementReturnPath: original, workspaceReturnPath: null })();
  const calls = [];
  const target = { task_id: "RD-2", title: "下一项研发任务" };
  const gotoSeq = evaluate(declaration("gotoSeq").arguments[0], {
    taskNavigationLocked: false, seqIndex: 0, taskSeq: [{ task_id: "RD-1" }, target],
    document: { querySelector: () => null },
    taskDetailPath: (id) => `/rd-task/${id}`, taskReturnState,
    navigate: (...args) => calls.push(args),
  });
  gotoSeq(1);
  assert.deepEqual(calls, [["/rd-task/RD-2", { state: { procurementWorkspaceReturn: original, task: target } }]]);
  assert.equal(procurementWorkspaceReturnPath(calls[0][1].state), original);

  const jumps = nodesWhere(ast, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "navigate"
    && node.arguments[0]?.getText(ast).startsWith("taskDetailPath("));
  assert.ok(jumps.length >= 7, "Parent/subtask/related-task and sequence navigation must all be covered");
  for (const jump of jumps) assert.match(jump.arguments[1]?.getText(ast) || "", /taskReturnState/, jump.getText(ast));
});

test("正常详情及失败空态的返回按钮采用同一目的地，并显示采购来源", () => {
  const returns = nodesWhere(ast, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "navigate"
    && node.arguments[0]?.getText(ast) === "detailReturnPath");
  assert.equal(returns.length, 3);
  assert.equal(nodesWhere(ast, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "navigate"
    && node.arguments[0]?.getText(ast) === "cockpitReturnPath").length, 0);
  const labels = nodesWhere(ast, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "t"
    && node.arguments[0]?.getText(ast).includes('procurementReturnPath ? "返回采购工作台"'));
  assert.equal(labels.length, 3);
  for (const label of labels) assert.equal(evaluate(label, { procurementReturnPath: "/proc-my-workspace", t: (value) => value }), "返回采购工作台");
});
