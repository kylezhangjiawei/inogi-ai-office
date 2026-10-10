import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { matchPath } from "react-router";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const helperSource = read("src/app/lib/rdWorkspaceNavigation.ts");
const detailSource = read("src/app/RDTaskDetailPage.tsx");
const mobileSource = read("src/app/MobileRDCockpit.tsx");
const appSource = read("src/app/App.tsx");
const parse = (source) => ts.createSourceFile("navigation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const detail = parse(detailSource);
const mobile = parse(mobileSource);
const app = parse(appSource);

function descendants(root, predicate) {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return found;
}
function declaration(ast, name) {
  const found = descendants(ast, (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.equal(found.length, 1, name);
  return found[0].initializer;
}
function evaluate(ast, node, scope) {
  const javascript = ts.transpileModule(`return (${node.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), javascript)(...Object.values(scope));
}
function returnHelper(configuredPath = "/rd-my-workspace") {
  const exports = {};
  const javascript = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", javascript)(exports, (dependency) => {
    assert.equal(dependency, "./routePaths");
    return { routePath: (code, fallback) => {
      assert.equal(code, "page:rd-my-workspace");
      assert.equal(fallback, "/rd-my-workspace");
      return configuredPath;
    } };
  });
  return exports.rdWorkspaceReturnPath;
}
const rdWorkspaceReturnPath = returnHelper();

test("研发返回仅接受已配置工作台并完整保留筛选", () => {
  const path = "/rd-my-workspace?role=collaborator&keyword=%E8%AF%95%E9%AA%8C&status=in_progress#tasks";
  assert.equal(rdWorkspaceReturnPath({ rdWorkspaceReturn: path, task: { task_id: "RD-1" } }), path);
  assert.equal(rdWorkspaceReturnPath({ rdWorkspaceReturn: "/rd-my-workspace" }), "/rd-my-workspace");
  for (const state of [null, undefined, [], false, path, 42, {}, { from: path }, { rdWorkspaceReturn: 42 }]) {
    assert.equal(rdWorkspaceReturnPath(state), null);
  }
  const configured = returnHelper("/engineering/my-work");
  assert.equal(configured({ rdWorkspaceReturn: "/engineering/my-work?role=primary" }), "/engineering/my-work?role=primary");
  assert.equal(configured({ rdWorkspaceReturn: path }), null);
});

test("研发返回拒绝外链、其他池、伪装路径及控制字符", () => {
  for (const path of [
    "https://evil.test/rd-my-workspace", "//evil.test/rd-my-workspace", "javascript:alert(1)",
    "rd-my-workspace", "/proc-my-workspace", "/us-collab-workspace", "/rd-task-management",
    "/rd-my-workspace/", "/rd-my-workspace-other", "/x/../rd-my-workspace", "/rd-my-workspace/../admin",
    "/%72d-my-workspace", "/rd-my-workspace%3fnext=x", "/rd-my-workspace%2f..%2fadmin",
    " /rd-my-workspace", "/rd-my-workspace ", "/\\evil.test", "/rd-my-workspace?x=\\evil",
    "/rd-my-workspace?x=\n", "/rd-my-workspace\t", "/rd-my-workspace?x=\u0000", "/rd-my-workspace?x=\u007f",
  ]) assert.equal(rdWorkspaceReturnPath({ rdWorkspaceReturn: path }), null, JSON.stringify(path));
  const query = "/rd-my-workspace?q=https%3A%2F%2Fexample.com";
  assert.equal(rdWorkspaceReturnPath({ rdWorkspaceReturn: query }), query);
});

test("桌面及手机返回优先采购、其次研发工作台、最后原入口", () => {
  const location = { state: { rdWorkspaceReturn: "/rd-my-workspace?role=collaborator" } };
  for (const [ast, researchScope, fallbackKey, fallback] of [
    [detail, { researchWorkspace: true }, "cockpitReturnPath", "/rd-task-management"],
    [mobile, { workspaceBase: "/m" }, "workspaceBase", "/m"],
  ]) {
    const workspaceReturnPath = evaluate(ast, declaration(ast, "workspaceReturnPath"), { ...researchScope, location, rdWorkspaceReturnPath });
    for (const procurementReturnPath of [null, "/proc-my-workspace?task=PR-1"]) {
      assert.equal(evaluate(ast, declaration(ast, "detailReturnPath"), { procurementReturnPath, workspaceReturnPath, [fallbackKey]: fallback }), procurementReturnPath ?? location.state.rdWorkspaceReturn);
    }
    assert.equal(evaluate(ast, declaration(ast, "detailReturnPath"), { procurementReturnPath: null, workspaceReturnPath: null, [fallbackKey]: fallback }), fallback);
  }
  assert.equal(evaluate(detail, declaration(detail, "workspaceReturnPath"), { researchWorkspace: false, location, rdWorkspaceReturnPath }), null);
  for (const workspaceBase of ["/us-collab-m", "/production-m"]) {
    assert.equal(evaluate(mobile, declaration(mobile, "workspaceReturnPath"), { workspaceBase, location, rdWorkspaceReturnPath }), null);
  }
});

test("相关任务及序列跳转透传两种来源，不携带未校验 state", () => {
  const procurementReturnPath = "/proc-my-workspace?task=PR-1";
  const workspaceReturnPath = "/rd-my-workspace?role=primary&keyword=RD";
  for (const ast of [detail, mobile]) {
    const state = evaluate(ast, declaration(ast, "taskReturnState").arguments[0], { procurementReturnPath, workspaceReturnPath })();
    assert.deepEqual(state, { procurementWorkspaceReturn: procurementReturnPath, rdWorkspaceReturn: workspaceReturnPath });
    assert.equal(evaluate(ast, declaration(ast, "taskReturnState").arguments[0], { procurementReturnPath: null, workspaceReturnPath: null })(), undefined);
  }
  const taskJumps = descendants(detail, (node) => ts.isCallExpression(node) && node.expression.getText(detail) === "navigate" && node.arguments[0]?.getText(detail).startsWith("taskDetailPath("));
  assert.ok(taskJumps.length >= 7);
  for (const jump of taskJumps) assert.match(jump.arguments[1].getText(detail), /taskReturnState/);

  const calls = [];
  const taskReturnState = { rdWorkspaceReturn: workspaceReturnPath };
  const jump = evaluate(mobile, declaration(mobile, "openTaskById").arguments[0], {
    reload: () => {}, workspaceBase: "/m", location: { search: "?tab=conversation" }, taskReturnState,
    navigate: (...args) => calls.push(args),
  });
  jump("RD/2");
  assert.deepEqual(calls, [["/m/task/RD%2F2?tab=conversation", { state: taskReturnState }]]);
});

test("讨论深链仅允许 conversation，同组件 query 与任务变化都重新定位", () => {
  for (const [ast, setter, scopeName, taskDependency, fallback] of [
    [detail, "setTab", "researchWorkspace", "taskId", "notes"],
    [mobile, "setDetailTab", "technicalDocumentsEnabled", "task.task_id", "progress"],
  ]) {
    const effects = descendants(ast, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[0].getText(ast).includes(`${setter}(`) && node.arguments[0].getText(ast).includes('get("tab")'));
    assert.equal(effects.length, 1);
    const dependencies = effects[0].arguments[1].elements.map((node) => node.getText(ast));
    assert.ok(dependencies.includes("location.search"));
    assert.ok(dependencies.includes(taskDependency));
    for (const research of [true, false]) {
      for (const [search, expected] of [["?tab=conversation", "conversation"], ["?tab=notes", fallback], ["?tab=attachments", fallback], ["?tab=CONVERSATION", fallback], ["", fallback]]) {
        let active;
        const apply = evaluate(ast, effects[0].arguments[0], { [scopeName]: research, location: { search }, [setter]: (value) => { active = value; } });
        apply();
        assert.equal(active, research ? expected : undefined, "其他工作区不因 query 变化重置原页签");
      }
    }
  }
});

test("手机双向响应式重定向保留同一来源 state 和讨论查询", () => {
  const state = { rdWorkspaceReturn: "/rd-my-workspace?role=collaborator", task: { task_id: "RD-1" } };
  const routePath = (_code, fallback) => fallback;
  const component = (name, scope) => {
    const node = app.statements.find((candidate) => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
    assert.ok(node);
    return evaluate(app, node, scope);
  };
  const common = { React, Navigate: "Navigate", routePath, matchPath, subRoutePath: (_code, fallback, suffix) => `${fallback}/${suffix}` };
  const location = { pathname: "/rd-task/RD-1", search: "?tab=conversation", hash: "", state };
  const redirect = component("ProtectedLayout", {
    ...common, useLocation: () => location, useIsMobileViewport: () => true,
    useAuth: () => ({ user: { id: "U1" }, hydrated: true }), procurementWorkspaceReturnPath: () => null,
    rdWorkspaceForPath: () => null,
  })();
  assert.equal(redirect.props.to, "/m/task/RD-1?tab=conversation");
  assert.equal(redirect.props.state, state);
  const desktopTargetFromMobileLocation = component("desktopTargetFromMobileLocation", { routePath });
  const wide = component("ResponsiveMobileLayout", {
    ...common, useLocation: () => ({ ...location, pathname: "/m/task/RD-1" }), useIsMobileViewport: () => false,
    desktopTargetFromMobileLocation,
  })();
  assert.equal(wide.props.to, "/rd-task/RD-1?tab=conversation");
  assert.equal(wide.props.state, state);
});
