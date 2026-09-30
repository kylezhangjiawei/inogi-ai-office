import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
const source = fs.readFileSync(new URL("../src/app/lib/deviceInspectionRecords.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const item = { id: "QC-009", name: "压力", measuredValue: "—", status: "ReadComplete", qcConditionResult: "pass", expectedValue: "当次标准" };
const record = (items, projections = []) => ({ id: "now", uid: "112233445566778899AABBCC", uidVerified: true, collectionAt: "2026-09-10T08:10:00Z", snapshot: { items }, resultProjection: { items: projections } });
test("never derives a historical PASS without the frozen projection", () => {
  assert.equal(m.itemResult(item, record([item])), "—");
  assert.equal(m.itemResult({ ...item, evidenceInvalidated: true, status: "Unsupported" }, record([item])), "—");
  assert.equal(m.itemResult(item, record([item], [{ id: item.id, result: null }])), "—");
  assert.equal(m.itemResult(item, record([item], [{ id: item.id, result: "NG" }])), "NG");
  assert.equal(m.itemResult(item, record([item], [{ id: item.id, result: "PASS" }])), "PASS");
  assert.equal(m.itemResult(item, record([item], [{ id: item.id, result: "PASS" }, { id: item.id, result: "NG" }])), "—");
});
test("measured zero stays zero and invalid measured dash is never filled from raw fields", () => {
  assert.equal(m.measuredText({ ...item, measuredValue: "0", unit: "kPa" }), "0 kPa");
  assert.equal(m.measuredText({ ...item, unit: "kPa", readEvidence: { fields: [{ numericValue: 255 }] } }), "—");
  assert.equal(m.readState({ ...item, readEvidence: { fields: [{ id: "status", numericValue: 1 }] } }), "测量未完成");
  assert.equal(m.readState({ ...item, status: "ReadComplete" }), "已读取");
  assert.equal(m.readState({ ...item, status: "Interrupted" }), "通信中断");
});
test("same-device history only accepts verified full UID and genuinely earlier collection", () => {
  const current = record([]); const before = { ...current, id: "previous", collectionAt: "2026-09-10T07:01:00Z" };
  const other = { ...before, id: "other", uid: "002233445566778899AABBCC" };
  const newer = { ...before, id: "newer", collectionAt: "2026-09-10T09:00:00Z" };
  assert.equal(m.sameDevicePrevious(current, [current, other, newer, before]).id, "previous");
  assert.equal(m.sameDevicePrevious({ ...current, uidVerified: false }, [before]), undefined);
  assert.equal(m.sameDevicePrevious(current, [{ ...before, uidVerified: false }, other]), undefined);
});
test("comparison detects validity, frozen standard and collection-set changes without mutating snapshots", () => {
  const before = record([{ ...item, qcRuleEvidence: { validity: { status: 0 }, config: { values: { maximum: 300 } } } }]);
  const current = record([{ ...item, qcRuleEvidence: { validity: { status: 1 }, config: { values: { maximum: 315 } } } }, { id: "QC-023", name: "当前大气压", measuredValue: "101" }]);
  const original = JSON.stringify({ before, current });
  const rows = m.compareItems(current, before);
  assert.equal(rows[0].readingChanged, true); assert.equal(rows[0].standardChanged, true); assert.equal(rows[0].changed, true); assert.equal(rows[1].missing, true);
  assert.equal(JSON.stringify({ before, current }), original);
  const rawBefore = record([{ ...item, readEvidence: { fields: [{ id: "status", numericValue: 0 }] } }]);
  const rawNow = record([{ ...item, readEvidence: { fields: [{ id: "status", numericValue: 1 }] } }]);
  assert.equal(m.compareItems(rawNow, rawBefore)[0].readingChanged, true);
});
test("date filters use inclusive local calendar dates with ISO timezone and reject reversed dates", () => {
  const range = m.dateRange("custom", "2026-09-09", "2026-09-10");
  assert.equal(new Date(range.from).getHours(), 0); assert.equal(new Date(range.to).getHours(), 23); assert.equal(new Date(range.to).getMilliseconds(), 999);
  assert.match(range.from, /Z$/); assert.ok(m.dateRange("custom", "2026-09-10", "2026-09-09").error);
  assert.ok(m.dateRange("custom", "", "2026-09-10").error); assert.deepEqual(m.dateRange("all", "", ""), {});
});
test("search and filter values are safely encoded, with explicit false retained", () => {
  const q = new URLSearchParams(m.recordQueryString({ page: 2, pageSize: 10, search: "UID & SN/#1", abnormalOnly: false, itemId: "QC-009", readStatus: "WaitingMeasurement" }));
  assert.equal(q.get("search"), "UID & SN/#1"); assert.equal(q.get("abnormalOnly"), "false"); assert.equal(q.get("page"), "2");
});
test("production route does not import synthetic adapters or replace authentication", () => {
  const page = fs.readFileSync(new URL("../src/app/DeviceInspectionRecordsPage.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/app/lib/deviceInspectionRecordsApi.ts", import.meta.url), "utf8");
  assert.doesNotMatch(page, /preview-api|DEMO-QC|synthetic-/); assert.match(api, /authFetch/); assert.doesNotMatch(api, /localStorage|Bearer/);
});

// Render the real, pure evidence components without mounting the authenticated page or calling an API.
const pageSource = fs.readFileSync(new URL("../src/app/DeviceInspectionRecordsPage.tsx", import.meta.url), "utf8");
const pageModule = { exports: {} };
const require = createRequire(import.meta.url);
const uiServer = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
let uiModules;
try {
  uiModules = Object.fromEntries(await Promise.all(["tooltip", "button", "input", "date-picker", "checkbox", "select", "tabs"].map(async name => ["./components/ui/" + name, await uiServer.ssrLoadModule(`/src/app/components/ui/${name}.tsx`)])));
} finally { await uiServer.close(); }
const pageCode = ts.transpileModule(pageSource + "\nexport { RecordStaff, ManualConfirmations };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
new Function("require", "module", "exports", pageCode)(id => id.endsWith(".css") ? {} : id === "./lib/deviceInspectionRecords" ? m : id === "./lib/deviceInspectionRecordsApi" ? {} : uiModules[id] ?? require(id), pageModule, pageModule.exports);
const render = (component, evidence) => renderToStaticMarkup(React.createElement(pageModule.exports[component], { record: evidence }));
test("record filters and pagination render shared controls with labelled tabs and inputs", () => {
  const html = renderToStaticMarkup(React.createElement(pageModule.exports.DeviceInspectionRecordsPage));
  assert.equal((html.match(/role="combobox"/g) || []).length, 4);
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /data-slot="input"/);
  for (const id of ["dir-search", "dir-preset", "dir-item", "dir-read-status"]) {
    assert.ok(html.includes(`for="${id}"`));
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.doesNotMatch(pageSource, /<(?:select|option|input|button)\b/);
});
test("list displays the uploaded station and operator, including absent historical metadata", () => {
  const html = render("RecordStaff", { station: "产线 A / 02", operator: "张三（夜班）" });
  assert.match(html, /工位：产线 A \/ 02/); assert.match(html, /操作员：张三（夜班）/);
  const missing = render("RecordStaff", { station: "", operator: null });
  assert.match(missing, /工位：未记录/); assert.match(missing, /操作员：未记录/);
});
test("manual evidence renders all frozen fields and preserves mixed results without inventing confirmations", () => {
  const checks = [
    { id: "MAN-001", name: "实体按键回弹", result: "Pass", reason: "回弹正常", operator: "原确认人", confirmedAt: "2026-09-11T08:00:01Z" },
    { id: "MAN-002", name: "各档位共振", result: "Fail", reason: "三档异常抖动", operator: "另一确认人", confirmedAt: "2026-09-11T08:00:02Z" },
    { id: "MAN-003", name: "屏幕显示", result: "NotChecked", reason: "", operator: "", confirmedAt: null },
    { id: "MAN-004", name: "风扇旋转", result: "Pass", reason: "", operator: "原确认人", confirmedAt: "2026-09-11T08:00:03Z" },
    { id: "MAN-005", name: "吸气灵敏度", result: "NotChecked", reason: "", operator: "", confirmedAt: null },
  ];
  const evidence = { ...record([]), operator: "后续操作员不应代填", snapshot: { manualChecks: checks } };
  const before = JSON.stringify(evidence), html = render("ManualConfirmations", evidence);
  for (const check of checks) assert.ok(html.includes(check.name));
  assert.equal((html.match(/>合格<\/span>/g) || []).length, 2);
  assert.equal((html.match(/>不合格<\/span>/g) || []).length, 1);
  assert.equal((html.match(/>未确认<\/span>/g) || []).length, 2);
  assert.match(html, /三档异常抖动/); assert.match(html, /原确认人/); assert.match(html, /另一确认人/);
  for (const check of checks.filter(value => value.confirmedAt)) assert.ok(html.includes('dateTime="' + check.confirmedAt + '"'));
  assert.doesNotMatch(html, /后续操作员不应代填/); assert.equal((html.match(/<time>未记录<\/time>/g) || []).length, 2);
  assert.equal(JSON.stringify(evidence), before);
});
test("five unchecked items remain visibly unchecked with no invented confirmation person or time", () => {
  const html = render("ManualConfirmations", { ...record([]), operator: "不可代填", snapshot: { manualChecks: Array.from({ length: 5 }, (_,index) => ({ id: "MAN-"+index, name: "项目"+index, result: "NotChecked", operator: "", reason: "", confirmedAt: null })) } });
  assert.equal((html.match(/>未确认<\/span>/g) || []).length, 5);
  assert.equal((html.match(/<time>未记录<\/time>/g) || []).length, 5);
  assert.doesNotMatch(html, /dir-result--pass|dir-result--ng|不可代填|dateTime=/);
});
test("missing historical manual evidence is explicit and supplied text is safely escaped", () => {
  for (const manualChecks of [undefined, null, [], "legacy-unknown"]) assert.match(render("ManualConfirmations", { ...record([]), snapshot: { manualChecks } }), /该记录未包含人工确认信息/);
  const html = render("ManualConfirmations", { ...record([]), snapshot: { manualChecks: [{ name: "<script>alert(1)</script>", result: "unknown", reason: "<img src=x onerror=alert(1)>", operator: "<b>某人</b>", confirmedAt: "not-a-time" }] } });
  assert.doesNotMatch(html, /<script>|<img|<b>|dir-result--pass|dateTime=/); assert.match(html, /&lt;script&gt;/); assert.match(html, /未记录/);
});
