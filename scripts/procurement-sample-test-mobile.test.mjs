import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { matchPath } from "react-router";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { hasAnyPermission, hasPermission } from "../src/app/lib/permissions.ts";
import { subRoutePath } from "../src/app/lib/routePaths.ts";

const appSource = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const routeFunctions = ["ProtectedLayout", "PermissionRoute", "makeProtected", "makeLazyProtected", "PageLoadingFallback"]
  .map((name) => appAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(appAst)).join("\n");
const routeCode = ts.transpileModule(routeFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const workspaceCode = ts.transpileModule(readFileSync(new URL("../src/app/lib/rdWorkspace.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const workspaceNavigation = {};
const navigationCode = ts.transpileModule(readFileSync(new URL("../src/app/lib/procurementWorkspaceNavigation.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function("exports", "require", navigationCode)(workspaceNavigation, (name) => {
  assert.equal(name, "./routePaths");
  return { routePath: (_permission, fallback) => fallback };
});

function route({ mobile = true, user = { id: "tester", permissions: ["page:rd-my-workspace"] }, hydrated = true,
  pathname = "/rd-my-workspace", search = "?sampleTest=proc%2Fself&tab=mine", hash = "#detail", configuredPath } = {}) {
  const location = { pathname, search, hash };
  const routePath = (permission, fallback) => permission === "page:rd-my-workspace" ? configuredPath || fallback : fallback;
  const workspace = {};
  new Function("exports", "require", workspaceCode)(workspace, (name) => {
    if (name === "react-router") return { matchPath };
    assert.equal(name, "./routePaths");
    return { routePath };
  });
  const bindings = { React, ...workspaceNavigation, Suspense: React.Suspense, Navigate: "Navigate", Root: "Root", MobileProcSampleTestPage: "MobileSamplePage",
    URLSearchParams, hasAnyPermission, hasPermission, useAuth: () => ({ user, hydrated }), useLocation: () => location,
    useIsMobileViewport: () => mobile, matchPath, subRoutePath, rdWorkspaceForPath: workspace.rdWorkspaceForPath, routePath };
  const render = new Function(...Object.keys(bindings), `${routeCode}\nreturn ProtectedLayout;`)(...Object.values(bindings));
  return { tree: render(), location };
}

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (typeof tree.type === "function") return elements(tree.type(tree.props));
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children : [children]).flatMap(elements)];
}
function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}

test("手机指定测试人只有研发工作台权限即可打开独立测试入口，保留任务ID与完整地址", () => {
  const result = route();
  const page = elements(result.tree).find((item) => item.type === "MobileSamplePage");
  assert.equal(page?.props.taskId, "proc/self");
  assert.equal(page.key, "tester:proc/self");
  assert.ok(!elements(result.tree).some((item) => item.type === "Navigate" || item.type === "Root"));
  assert.deepEqual(result.location, { pathname: "/rd-my-workspace", search: "?sampleTest=proc%2Fself&tab=mine", hash: "#detail" });
});

test("移动测试入口仍校验工作台权限，采购权限和驾驶舱权限不能替代", () => {
  for (const permissions of [[], ["page:proc-my-workspace"], ["page:rd-task-management"]]) {
    const rendered = elements(route({ user: { id: "other", permissions } }).tree);
    assert.ok(!rendered.some((item) => item.type === "MobileSamplePage"));
    assert.ok(rendered.some((item) => text(item).includes("您没有访问此页面的权限")));
  }
  assert.ok(elements(route({ user: { id: "admin", permissions: ["*"] } }).tree).some((item) => item.type === "MobileSamplePage"));
});

test("鉴权恢复与登录跳转先于移动测试入口，登录返回地址保留sampleTest", () => {
  assert.ok(!elements(route({ hydrated: false }).tree).some((item) => item.type === "MobileSamplePage"));
  const loggedOut = route({ user: null }).tree;
  assert.equal(loggedOut.type, "Navigate");
  assert.equal(loggedOut.props.to, "/login");
  assert.equal(loggedOut.props.state.from, "/rd-my-workspace?sampleTest=proc%2Fself&tab=mine#detail");
});

test("空样品参数、普通手机页面和桌面页面维持原路由行为", () => {
  for (const search of ["", "?sampleTest=", "?sampleTest=%20%20"]) {
    assert.equal(route({ search, hash: "" }).tree.props.to, `/m${search}`);
  }
  assert.equal(route({ pathname: "/rd-task/rd-123", search: "?tab=notes", hash: "" }).tree.props.to, "/m/task/rd-123?tab=notes");
  assert.equal(route({ pathname: "/us-collab-workspace", search: "?sampleTest=proc-1", hash: "" }).tree.props.to, "/us-collab-m?sampleTest=proc-1");
  assert.equal(route({ mobile: false }).tree.type, "Root");
});

test("样品入口跟随配置工作台路径，任务或账号变化时重挂轻量页", () => {
  assert.ok(elements(route({ pathname: "/my-rd", configuredPath: "/my-rd" }).tree).some((item) => item.type === "MobileSamplePage"));
  assert.equal(route({ pathname: "/applicant-forms", configuredPath: "/my-rd" }).tree.type, "Root", "研发工作台的路径配置不应覆盖其他页面");
  const key = (options) => elements(route(options).tree).find((item) => item.type === "MobileSamplePage").key;
  assert.notEqual(key({}), key({ search: "?sampleTest=proc-new" }));
  assert.notEqual(key({}), key({ user: { id: "tester-2", permissions: ["page:rd-my-workspace"] } }));
});

const pageCode = ts.transpileModule(readFileSync(new URL("../src/app/MobileProcSampleTestPage.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;

function pageFixture() {
  const states = []; const cleanups = []; const classes = new Set();
  let cursor = 0;
  const dependencies = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (value) => { states[index] = value; }]; },
      useEffect(effect) { const index = cursor++; if (!(index in states)) { states[index] = true; cleanups.push(effect()); } },
    },
    "react/jsx-runtime": jsxRuntime,
    "./components/ui/button": { Button: "Button" },
    "./lib/i18n": { initI18n: async () => {}, useI18n: () => ({ t: (value) => value }) },
    "./procurement/components/ProcSampleTestDialog": { ProcSampleTestDialog: "SampleDialog" },
  };
  const exports = {};
  const document = { documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } } };
  new Function("exports", "require", "document", pageCode)(exports, (id) => { assert.ok(id in dependencies, id); return dependencies[id]; }, document);
  return {
    classes,
    render() { cursor = 0; return exports.MobileProcSampleTestPage({ taskId: "proc/self" }); },
    destroy() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test("轻量样品页首次打开、关闭并重新查看同一任务，不离开页面", () => {
  const page = pageFixture();
  let tree = page.render();
  const dialog = elements(tree).find((item) => item.type === "SampleDialog");
  assert.equal(dialog.props.taskId, "proc/self");
  assert.ok(page.classes.has("mobile-route"), "使用现有手机样式解除全局1024最小宽度");
  dialog.props.onClose();
  tree = page.render();
  assert.ok(!elements(tree).some((item) => item.type === "SampleDialog"));
  assert.ok(text(tree).includes("查看测试详情"));
  assert.ok(!text(tree).includes("测试结论已确认"));
  elements(tree).find((item) => item.type === "Button").props.onClick();
  assert.equal(elements(page.render()).find((item) => item.type === "SampleDialog").props.taskId, "proc/self");
  page.destroy();
  assert.ok(!page.classes.has("mobile-route"), "离开后恢复桌面样式");
});

test("仅确认成功回调更新完成提示，确认后仍显示真实结果弹窗且可再次查看", () => {
  const page = pageFixture();
  const dialog = elements(page.render()).find((item) => item.type === "SampleDialog");
  dialog.props.onConfirmed();
  let tree = page.render();
  assert.ok(text(tree).includes("测试结论已确认，已通知采购负责人。"));
  assert.ok(elements(tree).some((item) => item.type === "SampleDialog"));
  dialog.props.onClose();
  tree = page.render();
  assert.ok(text(tree).includes("测试结论已确认"));
  elements(tree).find((item) => item.type === "Button").props.onClick();
  assert.equal(elements(page.render()).find((item) => item.type === "SampleDialog").props.taskId, "proc/self");
  page.destroy();
});
