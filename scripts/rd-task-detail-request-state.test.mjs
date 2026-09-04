import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function handler(name, scope) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, `missing ${name}`);
  const javascript = ts.transpileModule(`return ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), javascript)(...Object.values(scope));
}

function taskChangeEffect(scope) {
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[1]?.getText(ast) === "[loadProgressGroup, taskId]") callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, "missing task-change effect");
  const setters = {};
  function collect(node) {
    if (ts.isCallExpression(node) && /^set[A-Z]/.test(node.expression.getText(ast))) {
      setters[node.expression.getText(ast)] = () => {};
    }
    ts.forEachChild(node, collect);
  }
  collect(callback);
  const bindings = { ...setters, ...scope };
  const javascript = ts.transpileModule(`return ${callback.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const values = { task: null, notes: ["existing"], groupNotes: ["existing"], notesError: "", loadError: "", refreshes: 0 };
  const scope = {
    taskId: "A", task: { task_id: "A", final_priority: "low" },
    activeTaskIdRef: { current: "A" }, loadSeqRef: { current: 0 }, progressLoadSeqRef: { current: 0 },
    useCallback: (callback) => callback,
    t: (key) => key,
    setLoading() {}, setNotesLoading() {}, setAllTasks() {}, setSubtaskParents() {}, setTopLevelTasks() {},
    setTask: (task) => { values.task = typeof task === "function" ? task(values.task) : task; },
    setLoadError: (error) => { values.loadError = error; },
    setNotes: (notes) => { values.notes = notes; },
    setGroupNotes: (notes) => { values.groupNotes = notes; },
    setProgressGroupTasks() {},
    setNotesError: (error) => { values.notesError = error; },
    flattenTasks: (tasks) => tasks,
    buildSubtaskParentIndex: () => new Map(),
    collectTopLevelTasks: () => [],
    markRdTaskNotesRead: async () => {},
    savingPriority: false, setSavingPriority() {},
    toast: { success() {}, error() {} },
    loadTask: () => { values.refreshes++; },
    loadProgressGroup: () => { values.refreshes++; },
    allTaskById: new Map(), setShowAttachSubtasks() {},
  };
  return { scope, values };
}

test("切换任务后，旧详情响应既不替换当前任务，也不覆盖错误状态", async () => {
  for (const fails of [false, true]) {
    const { scope, values } = fixture();
    const request = deferred();
    scope.fetchMergedTaskCategories = () => request.promise;
    const load = handler("loadTask", scope);
    const pending = load();
    scope.activeTaskIdRef.current = "B";
    values.task = { task_id: "B" };
    values.loadError = "current-error";
    if (fails) request.reject(new Error("old-error"));
    else request.resolve([{ children: [{ tasks: [{ task_id: "A" }] }] }]);
    await pending;
    assert.deepEqual(values.task, { task_id: "B" });
    assert.equal(values.loadError, "current-error");
  }
});

test("旧操作不能为新页面发起覆盖请求，同任务重试只采用最后响应", async () => {
  const { scope, values } = fixture();
  const older = deferred();
  const newer = deferred();
  let count = 0;
  scope.fetchMergedTaskCategories = () => ++count === 1 ? older.promise : newer.promise;
  const load = handler("loadTask", scope);
  const first = load();
  const second = load();
  newer.resolve([{ children: [{ tasks: [{ task_id: "A", title: "new" }] }] }]);
  await second;
  older.resolve([{ children: [{ tasks: [{ task_id: "A", title: "old" }] }] }]);
  await first;
  assert.equal(values.task.title, "new");
  scope.activeTaskIdRef.current = "B";
  await load({ expectedTaskId: "A" });
  assert.equal(count, 2);
});

test("进展失败保留已加载内容，重试成功清除就地错误", async () => {
  const { scope, values } = fixture();
  let fail = true;
  scope.fetchRdTaskProgressNoteGroup = async () => {
    if (fail) throw new Error("network-error");
    return { notes: [{ id: "note-2", task_id: "A" }], tasks: [] };
  };
  const load = handler("loadProgressGroup", scope);
  await load();
  assert.equal(values.notesError, "network-error");
  assert.deepEqual(values.groupNotes, ["existing"]);
  fail = false;
  await load();
  assert.equal(values.notesError, "");
  assert.equal(values.notes[0].id, "note-2");
});

test("切换任务后旧进展响应不覆盖新任务附件和进展", async () => {
  const { scope, values } = fixture();
  const request = deferred();
  scope.fetchRdTaskProgressNoteGroup = () => request.promise;
  const pending = handler("loadProgressGroup", scope)();
  scope.activeTaskIdRef.current = "B";
  values.groupNotes = ["B-note"];
  request.resolve({ notes: [{ task_id: "A" }], tasks: [] });
  await pending;
  assert.deepEqual(values.groupNotes, ["B-note"]);
});

test("优先级保存晚返回时不改新任务字段，子任务操作晚返回时不刷新旧任务", async () => {
  for (const name of ["savePriority", "handleAttachSubtasks"]) {
    const { scope, values } = fixture();
    const request = deferred();
    scope.updateRdTask = () => request.promise;
    scope.attachRdTasksToParent = () => request.promise;
    values.task = { task_id: "A", final_priority: "low" };
    const pending = handler(name, scope)(name === "savePriority" ? "high" : ["child"]);
    scope.activeTaskIdRef.current = "B";
    values.task = { task_id: "B", final_priority: "medium" };
    request.resolve({});
    await pending;
    assert.deepEqual(values.task, { task_id: "B", final_priority: "medium" });
    assert.equal(values.refreshes, 0);
  }
});

test("生成问题期间切换任务会恢复新任务操作，旧结果不会跳转页面", async () => {
  const { scope } = fixture();
  const request = deferred();
  let generating = false;
  let navigations = 0;
  scope.generatingIssue = false;
  scope.notes = [];
  scope.setGeneratingIssue = (value) => { generating = value; };
  scope.issueService = { create: () => request.promise };
  scope.navigate = () => { navigations++; };
  const pending = handler("handleGenerateIssue", scope)();
  assert.equal(generating, true);
  scope.activeTaskIdRef.current = "B";
  taskChangeEffect(scope)();
  assert.equal(generating, false);
  request.resolve({ id: "issue-from-A" });
  await pending;
  assert.equal(generating, false);
  assert.equal(navigations, 0);
});
