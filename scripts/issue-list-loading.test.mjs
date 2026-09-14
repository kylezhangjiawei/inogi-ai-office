import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/issue-ai/ListView.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ListView.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};

function visit(node) {
  if (ts.isVariableDeclaration(node) && ["loadAux", "reloadList"].includes(node.name.getText(ast))) {
    callbacks[node.name.getText(ast)] = node.initializer.getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "React.useEffect"
    && node.arguments[0]?.getText(ast).includes("service.list(query)")) {
    callbacks.listEffect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(setImmediate);
const page = { items: [{ id: "issue-1", title: "已恢复的问题" }], total: 1, page: 1, pageSize: 6 };
const stats = { total: 1, pending: 1, solved: 0, reuseRate: 0, avgLocateHours: 0 };

// Run the page's actual effect and retry handlers with controlled service responses.
// Native rejected Promises remain visible to node:test if the page fails to catch them.
function fixture(service = {}) {
  const scope = {
    query: { statusGroup: "pending", search: "测试", page: 1, pageSize: 6 },
    paged: null, loading: false, loadError: null, stats: null, statsError: null,
    React: { useCallback: (callback) => callback }, t: (key) => key,
    service: { list: async () => page, stats: async () => stats, ...service },
  };
  for (const state of ["Query", "Paged", "Loading", "LoadError", "Stats", "StatsError"]) {
    const key = state[0].toLowerCase() + state.slice(1);
    scope[`set${state}`] = (value) => { scope[key] = typeof value === "function" ? value(scope[key]) : value; };
  }
  function handler(name) {
    assert.ok(callbacks[name], `missing actual page handler: ${name}`);
    const code = ts.transpileModule(`return ${callbacks[name]};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function("scope", `with (scope) { ${code} }`)(scope);
  }
  return { scope, load: () => handler("listEffect")(), loadStats: () => handler("loadAux")(), retry: () => handler("reloadList")() };
}

test("问题列表接口失败后结束加载并显示错误，不留下未处理拒绝", async () => {
  const request = deferred();
  const view = fixture({ list: () => request.promise });
  const stop = view.load();
  assert.equal(view.scope.loading, true);
  request.reject(new Error("列表服务暂时不可用"));
  await flush();
  assert.equal(view.scope.loading, false);
  assert.equal(view.scope.loadError, "列表服务暂时不可用");
  assert.equal(view.scope.paged, null);
  stop();
});

test("统计失败由页面处理，重新加载成功后清除错误并恢复统计", async () => {
  let fails = true;
  const view = fixture({ stats: async () => {
    if (fails) throw new Error("统计服务暂时不可用");
    return stats;
  } });
  view.loadStats();
  await flush();
  assert.equal(view.scope.statsError, "统计服务暂时不可用");
  assert.equal(view.scope.stats, null);
  fails = false;
  view.loadStats();
  assert.equal(view.scope.statsError, null);
  await flush();
  assert.deepEqual(view.scope.stats, stats);
  assert.equal(view.scope.statsError, null);
});

test("列表重试保留筛选条件，成功后恢复数据并清除错误和加载态", async () => {
  let fails = true;
  const seen = [];
  const view = fixture({ list: async (query) => {
    seen.push(query);
    if (fails) throw new Error("首次请求失败");
    return page;
  } });
  const stop = view.load();
  await flush();
  assert.equal(view.scope.loadError, "首次请求失败");
  const previousQuery = view.scope.query;
  view.retry();
  assert.notEqual(view.scope.query, previousQuery, "重试必须触发依赖 query 的真实 effect");
  assert.deepEqual(view.scope.query, previousQuery, "重试应保留用户筛选");
  stop();
  fails = false;
  const stopRetry = view.load();
  assert.equal(view.scope.loadError, null);
  await flush();
  assert.equal(seen.length, 2);
  assert.equal(view.scope.loading, false);
  assert.equal(view.scope.loadError, null);
  assert.deepEqual(view.scope.paged, page);
  stopRetry();
});

test("切换筛选后旧请求失败不能结束新请求加载或覆盖新页面错误", async () => {
  const older = deferred(), newer = deferred();
  let reads = 0;
  const view = fixture({ list: () => ++reads === 1 ? older.promise : newer.promise });
  const stopOlder = view.load();
  stopOlder();
  view.scope.query = { ...view.scope.query, statusGroup: "solved" };
  const stopNewer = view.load();
  older.reject(new Error("旧筛选失败"));
  await flush();
  assert.equal(view.scope.loading, true);
  assert.equal(view.scope.loadError, null);
  newer.resolve(page);
  await flush();
  assert.equal(view.scope.loading, false);
  assert.deepEqual(view.scope.paged, page);
  stopNewer();
});

test("切换筛选后旧成功响应不能覆盖新请求的失败状态", async () => {
  const older = deferred(), newer = deferred();
  let reads = 0;
  const view = fixture({ list: () => ++reads === 1 ? older.promise : newer.promise });
  const stopOlder = view.load();
  stopOlder();
  const stopNewer = view.load();
  newer.reject(new Error("当前筛选失败"));
  await flush();
  older.resolve(page);
  await flush();
  assert.equal(view.scope.paged, null);
  assert.equal(view.scope.loadError, "当前筛选失败");
  assert.equal(view.scope.loading, false);
  stopNewer();
});

test("非 Error 拒绝也会显示可读错误并退出列表加载", async () => {
  const view = fixture({ list: async () => { throw null; }, stats: async () => { throw "offline"; } });
  const stop = view.load();
  view.loadStats();
  await flush();
  assert.equal(view.scope.loading, false);
  assert.equal(view.scope.loadError, "问题记录加载失败");
  assert.equal(view.scope.statsError, "统计数据加载失败");
  stop();
});
