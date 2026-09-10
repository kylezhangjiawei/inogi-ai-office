import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
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
