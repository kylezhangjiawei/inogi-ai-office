import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/RDAiSettingsPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handleSaveSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSave") {
    assert.equal(handleSaveSource, undefined, "save handler must be unambiguous");
    handleSaveSource = node.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handleSaveSource, "page save handler exists");
const javascript = ts.transpileModule(`${handleSaveSource}\nreturn handleSave;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ savedSettings = { updated_at: "server-version-1" }, fail = false, saveImpl } = {}) {
  const settings = { updated_at: "draft-timestamp", scenes: [{ id: "task", enabled: false }] };
  const draftState = { current: settings };
  const response = { ...settings, updated_at: "server-version-2" };
  const calls = { saves: [], drafts: [], baselines: [], busy: [], success: [], errors: [], conflicts: [] };
  const dependencies = {
    settings,
    savedSettings,
    loading: false,
    saveConflict: false,
    savingRef: { current: false },
    loadRequestRef: { current: 0 },
    baseUpdatedAtRef: { current: savedSettings?.updated_at ?? "" },
    saveRdAiSettings: async (...args) => {
      calls.saves.push(args);
      if (saveImpl) return saveImpl(...args);
      if (fail) throw new Error("服务器版本已更新，请重新读取后再保存。");
      return response;
    },
    setSettings: (value) => {
      draftState.current = typeof value === "function" ? value(draftState.current) : value;
      calls.drafts.push(draftState.current);
    },
    setSavedSettings: (value) => { dependencies.savedSettings = value; calls.baselines.push(value); },
    setSaving: (value) => calls.busy.push(value),
    setSaveError: (value) => { if (value) calls.errors.push(value); },
    setSaveConflict: (value) => { dependencies.saveConflict = value; calls.conflicts.push(value); },
    t: (value) => value,
    toast: {
      success: (value) => calls.success.push(value),
      error: (value) => calls.errors.push(value),
    },
  };
  const save = new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
  return { save, calls, settings, response, dependencies, draftState };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loadHandler(dependencies) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadSettings") initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer);
  const code = ts.transpileModule(`return ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

test("AI 策略保存携带读取时的服务器版本，并以成功响应更新下次保存基线", async () => {
  const { save, calls, settings, response } = harness();
  await save();
  assert.deepEqual(calls.saves, [[settings, "server-version-1"]]);
  assert.deepEqual(calls.drafts, [response]);
  assert.deepEqual(calls.baselines, [response]);
  assert.deepEqual(calls.busy, [true, false]);
  assert.equal(calls.success.length, 1);
  assert.deepEqual(calls.errors, []);
});

test("首次保存无 updated_at 的默认策略时发送空版本基线", async () => {
  const { save, calls, settings } = harness({ savedSettings: {} });
  await save();
  assert.deepEqual(calls.saves, [[settings, ""]]);
});

test("未读取服务器策略时不提交保存", async () => {
  const { save, calls } = harness({ savedSettings: null });
  await save();
  assert.deepEqual(calls.saves, []);
  assert.deepEqual(calls.busy, []);
});

test("版本冲突保留未保存的修改和原基线，并结束忙碌状态", async () => {
  const { save, calls } = harness({ fail: true });
  await save();
  assert.deepEqual(calls.drafts, []);
  assert.deepEqual(calls.baselines, []);
  assert.deepEqual(calls.success, []);
  assert.deepEqual(calls.errors, ["服务器版本已更新，请重新读取后再保存。"]);
  assert.deepEqual(calls.busy, [true, false]);
});

test("重复保存只发一次请求，期间继续编辑的草稿不会被成功响应覆盖", async () => {
  const request = deferred();
  const { save, calls, draftState, response, dependencies } = harness({ saveImpl: () => request.promise });
  const pending = save();
  await save();
  assert.equal(calls.saves.length, 1);
  const newerDraft = { ...draftState.current, scenes: [{ id: "task", enabled: true }] };
  draftState.current = newerDraft;
  request.resolve(response);
  await pending;
  assert.equal(draftState.current, newerDraft);
  assert.deepEqual(calls.baselines, [response]);
  assert.equal(dependencies.baseUpdatedAtRef.current, "server-version-2");
  assert.equal(dependencies.savingRef.current, false);
});

test("并行重读只接受最新响应，并保留读取期间继续编辑的草稿", async () => {
  const { dependencies, draftState, calls } = harness();
  const older = deferred();
  const newer = deferred();
  let reads = 0;
  let loadError = "";
  const load = loadHandler({
    ...dependencies, useCallback: (callback) => callback,
    fetchRdAiSettings: () => ++reads === 1 ? older.promise : newer.promise,
    setLoading() {}, setLoadError: (value) => { loadError = value; },
  });
  const first = load(true);
  const second = load(true);
  const newerDraft = { ...draftState.current, scenes: [{ id: "other" }] };
  draftState.current = newerDraft;
  newer.resolve({ updated_at: "new-version", scenes: [] });
  await second;
  older.reject(new Error("stale-read-failure"));
  await first;
  assert.equal(draftState.current, newerDraft);
  assert.equal(dependencies.baseUpdatedAtRef.current, "new-version");
  assert.equal(calls.baselines.length, 1);
  assert.equal(loadError, "");
});

test("409后重新读取保留草稿，再次保存使用新服务器版本", async () => {
  const { save, settings, draftState, dependencies, calls } = harness({ saveImpl: async () => {
    throw Object.assign(new Error("conflict"), { status: 409 });
  } });
  await save();
  assert.deepEqual(calls.conflicts, [true]);
  assert.equal(draftState.current, settings);
  const serverSettings = { updated_at: "new-version", scenes: [{ id: "remote" }] };
  const load = loadHandler({
    ...dependencies, useCallback: (callback) => callback,
    fetchRdAiSettings: async () => serverSettings,
    setLoading() {}, setLoadError() {},
  });
  await load(true);
  assert.equal(draftState.current, settings);
  assert.equal(dependencies.savedSettings, serverSettings);
  assert.equal(dependencies.saveConflict, false);
  dependencies.saveRdAiSettings = async (...args) => { calls.saves.push(args); return { ...settings, updated_at: "saved-new-version" }; };
  const saveAgain = new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
  await saveAgain();
  assert.deepEqual(calls.saves.at(-1), [settings, "new-version"]);
});

test("读取失败保留草稿和版本，保存期间不再发起读取", async () => {
  const { dependencies, draftState, settings } = harness();
  let reads = 0;
  let loadError = "";
  const load = loadHandler({
    ...dependencies, useCallback: (callback) => callback,
    fetchRdAiSettings: async () => { reads++; throw new Error("network-error"); },
    setLoading() {}, setLoadError: (value) => { loadError = value; },
  });
  await load(true);
  assert.equal(draftState.current, settings);
  assert.equal(dependencies.baseUpdatedAtRef.current, "server-version-1");
  assert.equal(loadError, "network-error");
  dependencies.savingRef.current = true;
  await load(true);
  assert.equal(reads, 1);
});

test("409后恢复旧配置仍保留冲突说明及重新读取入口", () => {
  let restoreSource;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "restoreSavedSettings") restoreSource = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(restoreSource);
  const code = ts.transpileModule(`${restoreSource}\nreturn restoreSavedSettings;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const savedSettings = { updated_at: "old-version" };
  let draft;
  let saveError = "服务器版本已更新";
  const dependencies = {
    savedSettings, saving: false, loading: false, saveConflict: true,
    setSettings: (value) => { draft = value; },
    setSaveError: (value) => { saveError = value; },
  };
  new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))();
  assert.equal(draft, savedSettings);
  assert.equal(saveError, "服务器版本已更新");
  assert.equal(dependencies.saveConflict, true);
  assert.match(source, /\{saveError && \([\s\S]*?\{saveConflict && <(?:Button|UiButton)[^>]*onClick=\{\(\) => void reloadSettingsKeepingDraft\(\)\}/);
});
