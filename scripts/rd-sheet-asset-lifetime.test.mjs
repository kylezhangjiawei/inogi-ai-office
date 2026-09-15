import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/lib/rdSheetAssets.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function("exports", "require", code)(exports, (name) => { assert.equal(name, "./rdApi"); return {}; });
const { collectSheetImageSources, applyUniverImageSources, startSheetAssetRenewal } = exports;
const image = (source) => ({ source, imageSourceType: "URL", width: 123 });
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function clock() {
  let now = 1_000_000;
  let hidden = false;
  let visibility;
  const timers = new Set();
  return {
    env: {
      now: () => now, hidden: () => hidden,
      setTimer: (fn, delay) => { const item = { fn, delay }; timers.add(item); return item; },
      clearTimer: (item) => timers.delete(item),
      onVisible: (fn) => { visibility = fn; return () => { visibility = undefined; }; },
    },
    tick: async (elapsed = 60_000) => { now += elapsed; const callbacks = [...timers]; timers.clear(); callbacks.forEach((item) => item.fn()); await settle(); },
    hide: () => { hidden = true; visibility?.(); },
    show: () => { hidden = false; visibility?.(); },
    timers, hasListener: () => !!visibility,
  };
}

test("only image-holder sources are collected, including JSON drawing resources", () => {
  const snap = { sheets: { cell: { v: "ordinary text url", p: { drawing: image("old-cell") } } },
    resources: [{ data: JSON.stringify({ image: image("old-float") }) }, { data: "invalid imageSourceType json" }],
    embedded: image("data:image/png;base64,x"), uuid: image("blob:local"), another: image("old-cell") };
  assert.deepEqual(collectSheetImageSources(snap), ["old-cell", "old-float"]);
});

test("in-place renewal preserves current unsaved values, formulas, image position and undo history", () => {
  const cell = { v: "unsaved typing", f: "=1+2", s: "red", p: { body: { dataStream: "text\r\n" }, drawings: [image("old-cell")] } };
  const snapshot = { sheets: { sheet1: { rowData: { 0: { h: 70 } }, cellData: { 0: { 0: cell, 1: { v: "old-cell" } } } } } };
  const drawing = { ...image("old-float"), drawingId: "d1", unitId: "wb", subUnitId: "sheet1", sheetTransform: { from: { row: 7, column: 4 }, angle: 23 } };
  const changed = { ...image("user-replaced"), drawingId: "d2" };
  const calls = [];
  const api = {
    getActiveWorkbook: () => ({ getId: () => "wb", save: () => snapshot, isCellEditing: () => false }),
    syncExecuteCommand: (id, params, options) => { calls.push({ id, params, options }); return true; },
  };
  const drawingService = {
    getDrawingDataForUnit: () => ({ sheet1: { data: { d1: drawing, d2: changed } } }),
    getBatchUpdateOp: (updates) => ({ unitId: "wb", subUnitId: "sheet1", redo: updates, objects: ["d1"] }),
  };
  const before = JSON.stringify({ snapshot, drawing, changed });
  assert.equal(applyUniverImageSources(api, drawingService, new Map([["old-cell", "new-cell"], ["old-float", "new-float"], ["deleted", "new-deleted"]])), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.cellValue[0][0].p.drawings[0].source, "new-cell");
  assert.deepEqual(Object.keys(calls[0].params.cellValue[0][0]), ["p"]);
  assert.equal(calls[0].params.cellValue[0][1], undefined, "ordinary text is not rewritten");
  assert.equal(calls[1].params.op[0].source, "new-float");
  assert.deepEqual(calls[1].params.op[0].sheetTransform, drawing.sheetTransform);
  assert.equal(calls[1].params.op.length, 1, "replacement/deletion made while request was in flight wins");
  assert.ok(calls.every((call) => call.id.includes(".mutation.") && call.options.onlyLocal));
  assert.equal(JSON.stringify({ snapshot, drawing, changed }), before, "live model was not mutated outside Univer mutations");
});

test("active cell editing defers maintenance without committing or overwriting it", () => {
  const api = { getActiveWorkbook: () => ({ isCellEditing: () => true }), syncExecuteCommand: () => assert.fail("no mutation while editing") };
  assert.equal(applyUniverImageSources(api, {}, new Map([["old", "new"]])), false);
});

test("default browser environment schedules and clears renewal without an illegal timer receiver", () => {
  const timers = new Map();
  const listeners = new Set();
  const assertTimerReceiver = (receiver) => {
    // Browser timers accept a bare global call, but not an unrelated environment object.
    if (receiver != null && receiver !== globalThis) throw new TypeError("Illegal invocation");
  };
  const browserSetTimeout = function (callback, delay) {
    assertTimerReceiver(this);
    const id = timers.size + 1;
    timers.set(id, { callback, delay });
    return id;
  };
  const browserClearTimeout = function (id) {
    assertTimerReceiver(this);
    assert.ok(timers.has(id), "cleanup clears the scheduled timer");
    timers.delete(id);
  };
  const document = {
    hidden: false,
    addEventListener: (event, callback) => { assert.equal(event, "visibilitychange"); listeners.add(callback); },
    removeEventListener: (event, callback) => { assert.equal(event, "visibilitychange"); assert.ok(listeners.delete(callback)); },
  };
  const browserExports = {};
  new Function("exports", "require", "document", "setTimeout", "clearTimeout", code)(
    browserExports, (name) => { assert.equal(name, "./rdApi"); return {}; }, document, browserSetTimeout, browserClearTimeout,
  );
  const stop = browserExports.startSheetAssetRenewal({
    getEditor: () => null, renew: async () => [], onFailure: () => assert.fail("unexpected renewal failure"),
  });
  assert.equal(timers.size, 1);
  assert.equal(timers.get(1).delay, 0, "mount schedules the initial renewal immediately");
  assert.equal(typeof timers.get(1).callback, "function");
  assert.equal(listeners.size, 1);
  stop();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

test("timed renewal takes TTL from backend, deduplicates in-flight work, and resumes after hidden-page expiry", async () => {
  const time = clock();
  let current = "old";
  let calls = 0;
  const pending = deferred();
  const editor = { getImageSources: () => [current], applyImageSources: (map) => { current = map.get(current) ?? current; return true; } };
  const stop = startSheetAssetRenewal({ getEditor: () => editor, onFailure: () => assert.fail("unexpected failure"),
    renew: async (sources) => { calls++; return calls === 1 ? pending.promise : [{ source: sources[0], url: "fresh-after-wake", expires_in: 1800 }]; },
  }, time.env);
  await time.tick(0);
  for (let i = 0; i < 4; i++) { time.hide(); time.show(); }
  await time.tick(0);
  assert.equal(calls, 1);
  pending.resolve([{ source: "old", url: "fresh", expires_in: 1800 }]);
  await settle();
  assert.equal(current, "fresh");
  await time.tick(27 * 60_000);
  assert.equal(calls, 1, "URLs with enough remaining validity are reused");
  time.hide();
  await time.tick(31 * 60_000);
  assert.equal(calls, 1);
  time.show();
  await time.tick(0);
  assert.equal(calls, 2);
  assert.equal(current, "fresh-after-wake");
  stop();
  assert.equal(time.timers.size, 0);
  assert.equal(time.hasListener(), false);
});

test("editing delays only the patch, and does not request the same renewed URL again", async () => {
  const time = clock();
  let editing = true;
  let current = "old";
  let requests = 0;
  const editor = { getImageSources: () => [current], applyImageSources: (map) => { if (editing) return false; current = map.get(current) ?? current; return true; } };
  const stop = startSheetAssetRenewal({ getEditor: () => editor, onFailure() {}, renew: async () => {
    requests++; return [{ source: "old", url: "new", expires_in: 1800 }];
  } }, time.env);
  await time.tick(0);
  assert.equal(current, "old");
  editing = false;
  await time.tick();
  assert.equal(current, "new");
  assert.equal(requests, 1);
  stop();
});

test("unmount aborts a stalled request and ignores late results", async () => {
  const time = clock();
  const pending = deferred();
  let signal;
  let applied = 0;
  const editor = { getImageSources: () => ["old"], applyImageSources: () => { applied++; return true; } };
  const stop = startSheetAssetRenewal({ getEditor: () => editor, onFailure: () => assert.fail("aborted maintenance is silent"),
    renew: (_sources, abort) => { signal = abort; return pending.promise; },
  }, time.env);
  await time.tick(0);
  stop();
  assert.equal(signal.aborted, true);
  pending.resolve([{ source: "old", url: "new", expires_in: 1800 }]);
  await settle();
  assert.equal(applied, 0);
  assert.equal(time.timers.size, 0);
});

test("renewal batches have fixed bounds and rejected sources use cooldown", async () => {
  const time = clock();
  const sources = Array.from({ length: 1200 }, (_, i) => `old-${i}`);
  const sizes = [];
  const editor = { getImageSources: () => sources, applyImageSources: () => true };
  const stop = startSheetAssetRenewal({ getEditor: () => editor, onFailure() {}, renew: async (batch) => { sizes.push(batch.length); return []; } }, time.env);
  await time.tick(0);
  assert.deepEqual(sizes, Array(10).fill(100));
  await time.tick();
  assert.equal(sizes.length, 12);
  await time.tick();
  assert.equal(sizes.length, 12);
  stop();
});

test("editor bridge suppresses only maintenance dirty events and page never reloads on renewal", () => {
  const editor = readFileSync(new URL("../src/app/RDSheetUniver.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/RDSheetPage.tsx", import.meta.url), "utf8");
  assert.match(editor, /loadedRef\.current && !renewingImagesRef\.current/);
  assert.match(editor, /renewingImagesRef\.current = true[\s\S]*finally[\s\S]*renewingImagesRef\.current = false/);
  const effect = page.slice(page.indexOf("return startSheetAssetRenewal("), page.indexOf("const requestConfirmation"));
  assert.doesNotMatch(effect, /setSnapshot|setReloadKey|setDirty|saveRdSheetWorkbook/);
});

test("failed save keeps live base64 images and writes that intact editor state to the local draft", async () => {
  const page = readFileSync(new URL("../src/app/RDSheetPage.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleSave") handler = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(handler);
  const live = { sheets: {}, picture: image(`data:image/png;base64,${"A".repeat(5000)}`) };
  let drafted;
  let error;
  const scope = {
    canEdit: true, savingRef: { current: false }, setSaving() {}, setError: (value) => { error = value; }, setNotice() {},
    handleRef: { current: { commitPendingEdit: async () => {}, getSnapshot: () => live } },
    editRevisionRef: { current: 2 }, baseUpdatedAtRef: { current: "original-version" },
    assetCacheRef: { current: new Map() }, dirtyRef: { current: true }, setDirty() {},
    externalizeSnapshotImages: async (snap) => { snap.picture.source = "https://img.example.test/a.png?auth_key=temporary"; return { uploaded: 1, failed: 0 }; },
    saveRdSheetWorkbook: async (snap) => {
      assert.match(snap.picture.source, /auth_key=/);
      throw Object.assign(new Error("save unavailable"), { status: 500 });
    },
    requestConfirmation: async () => false, clearRdSheetDraft: async () => {},
    writeDraft: async () => { drafted = structuredClone(live); return true; }, t: (value) => value,
  };
  const runnable = ts.transpileModule(`return (${handler});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await new Function(...Object.keys(scope), runnable)(...Object.values(scope))();
  assert.match(live.picture.source, /^data:image\/png;base64,/);
  assert.deepEqual(drafted, live);
  assert.match(error, /本地草稿/);
  assert.equal(scope.savingRef.current, false);
  assert.equal(scope.baseUpdatedAtRef.current, "original-version");
});
