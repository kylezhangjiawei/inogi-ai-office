import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/arrivals/arrivalCalendarModel.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const model = {};
new Function("exports", "require", code)(model, (name) => { throw new Error(`Unexpected model dependency: ${name}`); });
const { buildArrivalCalendar, selectArrivalRows, isArrivalMonth, isArrivalDay, isArrivalSelection } = model;
const row = (key, etaDate, extra = {}) => ({
  key, taskId: `task-${key}`, taskCode: `PROC-${key}`, materialName: "阀体", spec: "M20", unit: "件",
  orderId: `ref-${key}`, tpOrderId: `erp-${key}`, orderNo: `PO-${key}`, lineNo: "1",
  sourceRefIds: [`ref-${key}`], sourceTaskIds: [`task-${key}`], sourceTaskCodes: [`PROC-${key}`],
  supplier: "联胜制造", freeSample: false, etaDate, orderedQty: 20, receivedQty: 3, remainingQty: 17, quantityIssue: false,
  ...extra,
});

test("月份和选日只接受 0001–9999 范围内的完整合法日历值", () => {
  for (const month of ["0001-01", "0099-12", "2026-09", "9999-12"]) assert.equal(isArrivalMonth(month), true, month);
  for (const month of ["0000-01", "10000-01", "2026-00", "2026-13", "2026-9", " 2026-09", "2026-09-01", null]) assert.equal(isArrivalMonth(month), false, String(month));
  for (const date of ["0001-01-01", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"]) assert.equal(isArrivalDay(date), true, date);
  for (const date of ["1900-02-29", "2100-02-29", "2025-02-29", "2026-04-31", "2026-09-00", "2026-09-31", "2026-9-01", "0000-01-01", "2026-09-01T12:00:00Z", " 2026-09-01", "", undefined]) assert.equal(isArrivalDay(date), false, String(date));
  for (const value of ["all", "undated", "outside", "2024-02-29"]) assert.equal(isArrivalSelection(value), true);
  for (const value of ["month", "2026-02-29", "", undefined]) assert.equal(isArrivalSelection(value), false);
});

test("42 格从周一开始，闰日与月份边界不会溢出或少算", () => {
  const calendar = buildArrivalCalendar([row("leap", "2024-02-29"), row("march", "2024-03-01")], "2024-02");
  assert.equal(calendar.days.length, 42);
  assert.equal(calendar.days[0].date, "2024-01-29");
  assert.equal(calendar.days.at(-1).date, "2024-03-10");
  assert.equal(calendar.days.filter((day) => day.inMonth).length, 29);
  assert.equal(calendar.days.find((day) => day.date === "2024-02-29").rowCount, 1);
  assert.equal(calendar.days.find((day) => day.date === "2024-03-01").inMonth, false);
  assert.equal(calendar.inMonthCount, 1);
  assert.equal(calendar.outsideCount, 1);
  assert.equal(buildArrivalCalendar([], "2025-02").days.filter((day) => day.inMonth).length, 28);
  for (const [index, day] of calendar.days.entries()) assert.equal(day.isWeekend, index % 7 >= 5);
});

test("跨年以及 0001/0099/9999 年不发生 JavaScript 1900 偏移", () => {
  const first = buildArrivalCalendar([row("first", "0001-01-01")], "0001-01");
  assert.equal(first.previousMonth, null);
  assert.equal(first.nextMonth, "0001-02");
  assert.equal(first.days[0].date, "0001-01-01");
  assert.equal(first.days[0].rowCount, 1);
  const early = buildArrivalCalendar([], "0099-12");
  assert.equal(early.nextMonth, "0100-01");
  assert.equal(early.previousMonth, "0099-11");
  assert.equal(early.days.filter((day) => day.inMonth).length, 31);
  const last = buildArrivalCalendar([row("last", "9999-12-31")], "9999-12");
  assert.equal(last.nextMonth, null);
  assert.equal(last.previousMonth, "9999-11");
  assert.equal(last.days.filter((day) => day.inMonth).length, 31);
  assert.ok(last.days.some((day) => day.date === null && day.day === null && !day.inMonth));
  assert.equal(last.days.find((day) => day.date === "9999-12-31").rowCount, 1);
  assert.equal(buildArrivalCalendar([], "2026-01").previousMonth, "2025-12");
  assert.equal(buildArrivalCalendar([], "2026-12").nextMonth, "2027-01");
});

test("按全部输入计行，不被 10 行分页截断，不把不同单位或取消记录合并成数量", () => {
  const rows = Array.from({ length: 24 }, (_, index) => row(String(index), "2026-09-18", {
    unit: index % 2 ? "公斤" : "件", status: index === 0 ? "已取消" : index === 1 ? "已完成" : "执行中",
    remainingQty: index < 2 ? 0 : 100,
  }));
  // Calendar counts associations. Reading business quantities here would be an accidental semantic change.
  for (const value of rows) {
    for (const field of ["orderedQty", "receivedQty", "remainingQty"]) Object.defineProperty(value, field, { get() { throw new Error(`Must not sum ${field}`); } });
    Object.freeze(value);
  }
  Object.freeze(rows);
  const calendar = buildArrivalCalendar(rows, "2026-09");
  assert.equal(calendar.totalCount, 24);
  assert.equal(calendar.inMonthCount, 24);
  assert.equal(calendar.days.find((day) => day.date === "2026-09-18").rowCount, 24);
  const selected = selectArrivalRows(rows, "2026-09", "2026-09-18");
  assert.equal(selected.length, 24);
  assert.equal(selected[0], rows[0]);
  assert.equal(selected[1], rows[1]);
  assert.equal(selected.at(-1), rows.at(-1));
});

test("缺失与非法日期归待确认，合法月外日期独立计数，输入顺序与标识原样保留", () => {
  const repeated = row("duplicate-source", "2026-09-20");
  const rows = Object.freeze([
    row("later", "2026-09-30"), row("old", "2026-08-01"), row("missing", ""),
    row("invalid", "2026-02-30"), repeated, row("future", "2027-01-01"), repeated,
  ]);
  const calendar = buildArrivalCalendar(rows, "2026-09");
  assert.deepEqual([calendar.totalCount, calendar.inMonthCount, calendar.undatedCount, calendar.outsideCount], [7, 3, 2, 2]);
  assert.equal(calendar.days.find((day) => day.date === "2026-09-20").rowCount, 2, "再次去重会误改上游关联口径");
  const all = selectArrivalRows(rows, "2026-09", "all");
  assert.notEqual(all, rows);
  all.forEach((value, index) => assert.equal(value, rows[index]));
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "undated").map((value) => value.key), ["missing", "invalid"]);
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "outside").map((value) => value.key), ["old", "future"]);
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "2026-09-20"), [repeated, repeated]);
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "2026-09-01"), []);
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "2027-01-01"), [rows[5]]);
  assert.deepEqual(selectArrivalRows(rows, "2026-09", "2026-02-30"), []);
});

test("空数据和非法月份不会被推算成其他月份", () => {
  const empty = buildArrivalCalendar([], "2026-09");
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.days.filter((day) => day.inMonth).length, 30);
  assert.ok(empty.days.every((day) => day.rowCount === 0));
  for (const month of ["", "2026-13", "0000-01", "2026-02-30"]) {
    assert.throws(() => buildArrivalCalendar([], month), RangeError);
    assert.throws(() => selectArrivalRows([], month, "all"), RangeError);
  }
});
