import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/order-processing/purchaseOrderFulfillment.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const model = {};
new Function("exports", "require", code)(model, (name) => { throw new Error(`Unexpected runtime dependency: ${name}`); });
const { buildPurchaseOrderFulfillment } = model;
const line = (id, qty, receivedQty, unit = "件", extra = {}) => ({ id, lineNo: id, qty, receivedQty, unit, ...extra });

test("逐行区分未收、部分、收齐和超收；整单只按可核对行数计算收齐", () => {
  const result = buildPurchaseOrderFulfillment([
    line("1", 20, 0), line("2", 20, 5), line("3", 20, 20), line("4", 20, 25),
  ]);
  assert.deepEqual(result.lines.map((item) => item.state), ["not_received", "partial", "received", "over_received"]);
  assert.deepEqual(result.lines.map((item) => item.progressPercent), [0, 25, 100, 100]);
  assert.deepEqual(result.lines.map((item) => item.remainingQty), [20, 15, 0, 0]);
  assert.deepEqual(result.lines.map((item) => item.overReceivedQty), [0, 0, 0, 5]);
  assert.equal(result.totalLines, 4);
  assert.equal(result.checkableLines, 4);
  assert.equal(result.receivedLines, 2);
  assert.equal(result.overReceivedLines, 1);
  assert.equal(result.anomalyLines, 1);
  assert.equal(result.complete, true, "完整指数量可核对，不代表全部收齐");
});

test("0 订购量含 0/0 与 0/正数均待核对，不显示百分百", () => {
  for (const receivedQty of [0, 5]) {
    const result = buildPurchaseOrderFulfillment([line("zero", 0, receivedQty)]);
    assert.equal(result.lines[0].state, "unverified");
    assert.deepEqual(result.lines[0].issues, ["zero_ordered_qty"]);
    assert.equal(result.lines[0].progressPercent, null);
    assert.equal(result.lines[0].remainingQty, null);
    assert.equal(result.lines[0].overReceivedQty, null);
    assert.equal(result.checkableLines, 0);
    assert.equal(result.receivedLines, 0);
    assert.equal(result.unverifiedLines, 1);
    assert.equal(result.complete, false);
    assert.equal(result.groups[0].orderedQty, null);
  }
});

test("负数、非有限数与缺失数量不当作零，同单位有效行不冒充完整总量", () => {
  for (const field of ["qty", "receivedQty"]) for (const invalid of [-1, Number.NaN, Infinity, -Infinity, undefined, null, "10"]) {
    const bad = { ...line("bad", 20, 5), [field]: invalid };
    const result = buildPurchaseOrderFulfillment([line("good", 10, 10), bad]);
    assert.equal(result.lines[1].state, "unverified", `${field}=${String(invalid)}`);
    assert.equal(result.lines[1][field === "qty" ? "orderedQty" : "receivedQty"], null);
    assert.equal(result.lines[1].progressPercent, null);
    assert.equal(result.checkableLines, 1);
    assert.equal(result.receivedLines, 1);
    assert.equal(result.anomalyLines, 1);
    const group = result.groups[0];
    assert.equal(group.count, 2);
    assert.equal(group.checkableCount, 1);
    assert.equal(group.complete, false);
    for (const name of ["orderedQty", "receivedQty", "remainingQty", "overReceivedQty"]) assert.equal(group[name], null, name);
  }
});

test("缺单位单独保留且待核对，不混入真实单位名或其他有效单位", () => {
  const result = buildPurchaseOrderFulfillment([
    line("one", 10, 4, ""), line("two", 10, 2, "  "), line("three", 10, 1, null),
    line("literal", 10, 10, "未填写"), line("good", 20, 10, "件"),
  ]);
  assert.deepEqual(result.groups.map((group) => group.unit), [null, "未填写", "件"]);
  assert.deepEqual(result.groups[0].lineIndices, [0, 1, 2]);
  assert.equal(result.groups[0].orderedQty, null);
  assert.equal(result.groups[0].complete, false);
  assert.equal(result.groups[1].complete, true);
  assert.equal(result.groups[2].remainingQty, 10);
  assert.equal(result.unverifiedLines, 3);
  assert.equal(result.checkableLines, 2);
  for (const item of result.lines.slice(0, 3)) assert.deepEqual(item.issues, ["missing_unit"]);
});

test("只按 trim 后的原单位字符串分组，不大小写合并、换算或跨组相加", () => {
  const result = buildPurchaseOrderFulfillment([
    line("one", 10, 5, " 件 "), line("two", 2, 1, "公斤"), line("three", 3, 3, "件"),
    line("four", 1000, 200, "g"), line("five", 1, 0, "kg"), line("six", 2, 0, "KG"),
  ]);
  assert.deepEqual(result.groups.map((group) => group.unit), ["件", "公斤", "g", "kg", "KG"]);
  assert.deepEqual(result.groups[0].lineIndices, [0, 2]);
  assert.equal(result.groups[0].orderedQty, 13);
  assert.equal(result.groups[0].receivedQty, 8);
  assert.equal(result.groups[0].remainingQty, 5);
  assert.equal(result.groups[1].remainingQty, 1);
  for (const key of ["orderedQty", "receivedQty", "remainingQty", "overReceivedQty", "progressPercent"]) {
    assert.equal(Object.hasOwn(result, key), false, `整单不能暴露跨单位数量 ${key}`);
  }
});

test("同单位的超收不抵扣其他订单行未收，批量合计不能伪装全单收齐", () => {
  const result = buildPurchaseOrderFulfillment([line("short", 10, 0), line("over", 10, 20)]);
  const group = result.groups[0];
  assert.equal(group.orderedQty, 20);
  assert.equal(group.receivedQty, 20);
  assert.equal(group.remainingQty, 10);
  assert.equal(group.overReceivedQty, 10);
  assert.equal(result.receivedLines, 1);
  assert.equal(result.checkableLines, 2);
  assert.equal(result.anomalyLines, 1);
});

test("保留输入索引和原行标识，同 SKU、重复 ID/行号不做新去重或重排", () => {
  const rows = [line(" id/二 ", 10, 4, " 件 ", { lineNo: " 02 ", sku: "SAME" }), line(" id/二 ", 20, 20, "件", { lineNo: " 02 ", sku: "SAME" })];
  const before = structuredClone(rows);
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  const result = buildPurchaseOrderFulfillment(rows);
  assert.deepEqual(result.lines.map(({ index, id, lineNo }) => ({ index, id, lineNo })), [
    { index: 0, id: " id/二 ", lineNo: " 02 " }, { index: 1, id: " id/二 ", lineNo: " 02 " },
  ]);
  assert.equal(result.totalLines, 2);
  assert.equal(result.groups[0].orderedQty, 30);
  assert.deepEqual(rows, before);
  assert.deepEqual(buildPurchaseOrderFulfillment(rows), result);
});

test("只读取数量、单位与行标识，ERP 完成状态、SKU和检验字段不能参与推断", () => {
  const source = line("minimal", 10, 4);
  for (const name of ["sku", "name", "status", "approvalStatus", "availability", "qualifiedQty", "stockInQty"]) {
    Object.defineProperty(source, name, { get() { throw new Error(`Unexpected business inference from ${name}`); } });
  }
  const result = buildPurchaseOrderFulfillment([source]);
  assert.equal(result.lines[0].state, "partial");
  assert.equal(result.lines[0].remainingQty, 6);
  assert.equal(result.lines[0].progressPercent, 40);
});

test("有限原始数量求和溢出时总量不可用，极小订购量的超收进度也不输出 Infinity", () => {
  const overflow = buildPurchaseOrderFulfillment([line("huge-a", Number.MAX_VALUE, 0), line("huge-b", Number.MAX_VALUE, 0)]);
  assert.equal(overflow.checkableLines, 2);
  assert.equal(overflow.groups[0].complete, false);
  assert.equal(overflow.groups[0].orderedQty, null);
  assert.equal(overflow.groups[0].remainingQty, null);
  assert.equal(overflow.complete, false);
  const tiny = buildPurchaseOrderFulfillment([line("tiny", Number.MIN_VALUE, Number.MAX_VALUE)]);
  assert.equal(tiny.lines[0].state, "over_received");
  assert.equal(tiny.lines[0].progressPercent, 100);
  assert.equal(tiny.lines[0].remainingQty, 0);
  assert.equal(tiny.lines[0].overReceivedQty, Number.MAX_VALUE);
});

test("空订单不给虚构收齐率；小数数量保留原值不换算单位", () => {
  const empty = buildPurchaseOrderFulfillment([]);
  assert.deepEqual(empty.lines, []);
  assert.deepEqual(empty.groups, []);
  assert.equal(empty.checkableLines, 0);
  assert.equal(empty.receivedLines, 0);
  assert.equal(empty.complete, false);
  const decimal = buildPurchaseOrderFulfillment([line("decimal", 1.5, 0.5, "kg")]);
  assert.equal(decimal.groups[0].orderedQty, 1.5);
  assert.equal(decimal.groups[0].receivedQty, 0.5);
  assert.equal(decimal.groups[0].remainingQty, 1);
  assert.ok(Math.abs(decimal.lines[0].progressPercent - 100 / 3) < 1e-10);
});
