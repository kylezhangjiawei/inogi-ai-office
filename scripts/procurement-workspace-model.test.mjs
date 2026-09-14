import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", "window", code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  }, undefined);
  return exports;
}

// 使用现有日期/逾期助手的真实实现，不以测试桩重新定义阶段口径。
const data = compile("../src/app/procurement/data.ts", {
  react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} },
  "../lib/procurementApi": {}, "../lib/rdApi": {},
});
const { workspaceSuppliers, workspacePeriod, filterWorkspaceTasks, sortWorkspaceTasks, workspaceArrivals, UNDETERMINED_SUPPLIER } = compile(
  "../src/app/procurement/procurementWorkspaceModel.ts", { "./data": data },
);
const order = (id, overrides = {}) => ({
  id, tpOrderNo: `PO-${id}`, tpLineNo: "1", supplierName: "联胜制造", orderedQty: 20,
  tpOrderId: `erp:${overrides.tpOrderNo ?? `PO-${id}`}`,
  receivedQty: 3, unitPrice: 2, etaDate: "2026-09-18", ...overrides,
});
const task = (id, overrides = {}) => ({
  id, code: `PROC-${id}`, materialId: `material-${id}`, materialName: "进气阀组件", spec: "M20",
  unit: "件", productId: "product-A", needDate: "2026-09-20", deadline: undefined,
  status: "pending_confirm", priority: "medium", quantity: 20, arrivedQty: 0,
  buyer: "采购张工", rdContact: "研发李工", purchaseOrders: [], ...overrides,
});
const filters = (overrides = {}) => ({
  month: "2026-09", period: "all", productId: "all", supplier: "all", status: "all", query: "", ...overrides,
});
const ids = (rows) => rows.map((row) => row.id);

test("需求月份使用合法日历日期，缺失与非法日期不借用其他日期", () => {
  for (const [needDate, expected] of [
    ["2026-09-01", "month"], ["2026-09-30T23:00:00+08:00", "month"],
    ["2026-08-31", "carryover"], ["2025-12-31", "carryover"], ["2026-10-01", "future"],
    [undefined, "undated"], ["", "undated"], ["2026-02-30", "undated"],
    ["2026-13-01", "undated"], ["2026-09-10oops", "undated"], ["2026-09-10Tinvalid", "undated"],
  ]) {
    assert.equal(workspacePeriod(task("a", { needDate, deadline: "2026-09-01", expectedArrivalDate: "2026-09-01", createdAt: "2026-09-01" }), "2026-09"), expected, String(needDate));
  }
  assert.equal(workspacePeriod(task("leap", { needDate: "2024-02-29" }), "2024-02"), "month");
  assert.equal(workspacePeriod(task("non-leap", { needDate: "2025-02-29" }), "2025-02"), "undated");
});

test("跨月入口只收纳未完成任务，全部和月份入口可按状态核对历史", () => {
  const rows = [
    task("older", { needDate: "2026-08-31" }), task("done", { needDate: "2026-08-31", status: "completed" }),
    task("cancelled", { needDate: "2026-08-31", status: "cancelled" }), task("current"),
    task("unknown", { needDate: undefined }), task("future", { needDate: "2026-10-01" }),
  ];
  assert.equal(workspacePeriod(rows[1], "2026-09"), "carryover", "基础日期分类不掺入业务状态");
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters({ period: "carryover" }))), ["older"]);
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters({ period: "month" }))), ["current"]);
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters({ period: "undated" }))), ["unknown"]);
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters({ status: "completed" }))), ["done"]);
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters())), ids(rows));
});

test("供应商只读取已关联订单，trim 去重，多供应商匹配不会重复任务", () => {
  const multi = task("multi", { purchaseOrders: [order("a", { supplierName: " 联胜制造 " }), order("b"), order("c", { supplierName: "Beta Co" }), order("d", { supplierName: "  " })] });
  const undecided = task("undecided", { selectedQuotationId: "quote-selected", quotations: [{ supplierName: "联胜制造" }] });
  assert.deepEqual(workspaceSuppliers(multi), ["联胜制造", "Beta Co"]);
  assert.deepEqual(ids(filterWorkspaceTasks([multi, undecided], filters({ supplier: "联胜制造" }))), ["multi"]);
  assert.deepEqual(ids(filterWorkspaceTasks([multi, undecided], filters({ supplier: "Beta Co" }))), ["multi"]);
  assert.deepEqual(ids(filterWorkspaceTasks([multi, undecided], filters({ supplier: UNDETERMINED_SUPPLIER }))), ["undecided"]);
});

test("月份、产品、供应商、状态与搜索取交集，搜索覆盖相关人员与真实采购单", () => {
  const wanted = task("match", {
    buyer: "Buyer Alice", requester: "赵工", requesterDept: "机械部", rdTaskTitle: "新阀体开发", sampleTest: { testerName: "测试陈工" },
    purchaseOrders: [order("ALPHA-120", { supplierName: "Supplier Beta" })],
  });
  const rows = [wanted, task("other-product", { ...wanted, id: "other-product", productId: "product-B" }), task("other-state", { ...wanted, id: "other-state", status: "testing" })];
  for (const query of [" proc-match ", "进气阀", "m20", " buyer ALICE ", "研发李工", "赵工", "机械部", "新阀体", "测试陈工", "po-alpha-120", "supplier beta"]) {
    assert.deepEqual(ids(filterWorkspaceTasks(rows, filters({ period: "month", productId: "product-A", supplier: "Supplier Beta", status: "pending_confirm", query }))), ["match"], query);
  }
  assert.deepEqual(filterWorkspaceTasks(rows, filters({ query: "没有此内容" })), []);
});

test("排序复用阶段主日期：下单前看 Deadline，下单后看到货日，不用需求日期冒充", () => {
  const rows = [
    task("transit", { status: "in_transit", needDate: "1999-01-01", expectedArrivalDate: "2999-09-01" }),
    task("deadline", { needDate: "2999-12-01", deadline: "2999-08-01" }),
    task("need", { needDate: "2999-07-01" }),
    task("invalid", { needDate: "2999-02-30" }), task("missing", { status: "in_transit", expectedArrivalDate: undefined }),
  ];
  assert.deepEqual(ids(sortWorkspaceTasks(rows, "date")), ["need", "deadline", "transit", "invalid", "missing"]);
});

test("逾期优先随后按高优先级、日期、稳定 ID 排序，终态不虚增逾期", () => {
  const rows = [
    task("late-low", { priority: "low", needDate: "2000-01-01" }),
    task("late-high", { priority: "high", needDate: "2000-02-01" }),
    task("future-high", { priority: "high", needDate: "2999-02-01" }),
    task("done", { status: "completed", priority: "medium", expectedArrivalDate: "1999-01-01" }),
    task("tie-B", { needDate: "2999-03-01" }), task("tie-A", { needDate: "2999-03-01" }),
    task("cancelled", { status: "cancelled", needDate: "1999-01-01", priority: "low" }),
  ];
  assert.deepEqual(ids(sortWorkspaceTasks(rows, "urgent")), ["late-high", "late-low", "future-high", "done", "tie-A", "tie-B", "cancelled"]);
  assert.deepEqual(ids(sortWorkspaceTasks(rows, "priority")), ["late-high", "future-high", "done", "tie-A", "tie-B", "cancelled", "late-low"]);
});

test("同名任务保持独立，筛选和排序不修改原数组与对象", () => {
  const rows = [task("B"), task("A")];
  const before = structuredClone(rows);
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  assert.deepEqual(ids(filterWorkspaceTasks(rows, filters())), ["B", "A"]);
  assert.deepEqual(ids(sortWorkspaceTasks(rows, "date")), ["A", "B"]);
  assert.deepEqual(rows, before);
  assert.equal(sortWorkspaceTasks(rows, "date")[0], rows[1]);
});

test("到货行仅来自关联采购单，逐行保留数量、供应商、行号和原订单状态", () => {
  const rows = workspaceArrivals([
    task("no-order", { quantity: 200, arrivedQty: 20, expectedArrivalDate: "2026-09-12" }),
    task("split", { purchaseOrders: [order("A", { tpLineNo: " 2 ", orderedQty: 10, receivedQty: 2, approvalStatus: "审核中", status: "执行中" }), order("B", { supplierName: "第二供应商", orderedQty: 6, receivedQty: 6 })] }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].taskId, "split");
  assert.equal(rows[0].lineNo, " 2 ");
  assert.equal(rows[0].remainingQty, 8);
  assert.equal(rows[0].approvalStatus, "审核中");
  assert.equal(rows[0].status, "执行中");
  assert.equal(rows[1].supplier, "第二供应商");
  assert.equal(rows[1].remainingQty, 0, "已收齐订单仍可核对，不由到货面板判断验收状态");
});

test("订单日期只取各行 ETA，非法与未填日期待确认，免费样品没有采购单号也保留", () => {
  const rows = workspaceArrivals([task("one", { expectedArrivalDate: "2026-01-01", purchaseOrders: [
    order("unknown", { etaDate: undefined }), order("later", { etaDate: "2026-10-01" }),
    order("sample", { tpOrderNo: "", tpLineNo: undefined, freeSample: true, etaDate: "2026-09-01" }),
    order("invalid", { etaDate: "2026-02-30" }),
  ] })]);
  assert.deepEqual(rows.map((row) => row.orderId), ["sample", "later", "invalid", "unknown"]);
  assert.equal(rows[0].freeSample, true);
  assert.equal(rows[0].orderNo, "");
  assert.equal(rows[0].remainingQty, 17);
  assert.equal(rows[2].etaDate, "");
  assert.equal(rows[3].etaDate, "");
});

test("已完成和取消任务的原订单仍可查看，不推定审批或订单状态等于有效供应", () => {
  const rows = workspaceArrivals([
    task("done", { status: "completed", purchaseOrders: [order("done", { receivedQty: 20 })] }),
    task("cancelled", { status: "cancelled", purchaseOrders: [order("cancelled", { status: "已关闭", approvalStatus: "未审核" })] }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.taskId === "done").remainingQty, 0);
  assert.equal(rows.find((row) => row.taskId === "cancelled").status, "已关闭");
});

test("完整 ERP 身份及原始单号行号相同的跨任务关联只计一行，输入顺序不改变保留入口", () => {
  const common = { materialId: "shared-material", purchaseOrders: [order("one", { tpOrderNo: "PO-100", tpLineNo: "5" })] };
  const rows = [task("B", common), task("A", { ...common, purchaseOrders: [order("two", { tpOrderNo: "PO-100", tpLineNo: "5" })] })];
  const arrivals = workspaceArrivals(rows);
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].taskId, "A");
  assert.equal(arrivals[0].remainingQty, 17);
  assert.equal(arrivals[0].quantityIssue, false);
  assert.deepEqual(workspaceArrivals([...rows].reverse()), arrivals);
});

test("同一订单行数量冲突时不相加、不任取一个未收数，重复 ETA 不一致则待确认", () => {
  const rows = workspaceArrivals([
    task("A", { materialId: "same", purchaseOrders: [order("a", { tpOrderNo: "PO-SAME", receivedQty: 3 })] }),
    task("B", { materialId: "same", purchaseOrders: [order("b", { tpOrderNo: "PO-SAME", receivedQty: 4, etaDate: "2026-09-19" })] }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantityIssue, true);
  assert.equal(rows[0].orderedQty, 20);
  assert.equal(rows[0].receivedQty, null);
  assert.equal(rows[0].remainingQty, null);
  assert.equal(rows[0].etaDate, "");
});

test("有行号时同一订单不同物料行保持独立，无行号时同名不同物料也不合并", () => {
  const rows = workspaceArrivals([
    task("A", { materialId: "id-A", purchaseOrders: [order("a", { tpOrderNo: "PO-SAME", tpLineNo: "1" }), order("a-old", { tpOrderNo: "PO-OLD", tpLineNo: undefined })] }),
    task("B", { materialId: "id-B", purchaseOrders: [order("b", { tpOrderNo: "PO-SAME", tpLineNo: "2" }), order("b-old", { tpOrderNo: "PO-OLD", tpLineNo: undefined })] }),
  ]);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.key)).size, 4);
  assert.ok(rows.every((row) => row.remainingQty === 17 && !row.quantityIssue));
});

test("无行号的同物料关联无法证明独立订单行，保留记录并标记不计算未收数量", () => {
  const rows = workspaceArrivals([
    task("A", { materialId: "same", purchaseOrders: [order("a", { tpOrderNo: "PO-OLD", tpLineNo: undefined })] }),
    task("B", { materialId: "same", purchaseOrders: [order("b", { tpOrderNo: "PO-OLD", tpLineNo: undefined })] }),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.quantityIssue && row.remainingQty === null));
  assert.ok(rows.every((row) => row.orderedQty === 20 && row.receivedQty === 3), "保留原始数量供人工核对");
});

test("带行号订单和旧无行号订单可能是重复关联，两者保留但不重复累计", () => {
  const rows = workspaceArrivals([
    task("A", { materialId: "same", purchaseOrders: [order("new", { tpOrderNo: "PO-OLD", tpLineNo: "1" })] }),
    task("B", { materialId: "same", purchaseOrders: [order("old", { tpOrderNo: "PO-OLD", tpLineNo: undefined })] }),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.quantityIssue && row.remainingQty === null));
  const legacy = workspaceArrivals([
    task("A", { materialId: undefined, purchaseOrders: [order("first", { tpOrderNo: "PO-UNKNOWN", tpLineNo: undefined })] }),
    task("B", { materialId: undefined, purchaseOrders: [order("second", { tpOrderNo: "PO-UNKNOWN", tpLineNo: undefined })] }),
  ]);
  assert.equal(legacy.length, 2, "物料身份未知时不按同名合并");
  assert.ok(legacy.every((row) => row.quantityIssue && row.remainingQty === null));
});

test("非法数量、负数与超收一律待核对，不钳制成正常未收数", () => {
  const examples = [[NaN, 0], [Infinity, 0], [-1, 0], [20, NaN], [20, Infinity], [20, -1], [20, 21], [undefined, 0], [20, null]];
  for (const [orderedQty, receivedQty] of examples) {
    const [row] = workspaceArrivals([task("a", { purchaseOrders: [order("a", { orderedQty, receivedQty })] })]);
    assert.equal(row.quantityIssue, true, `${orderedQty}/${receivedQty}`);
    assert.equal(row.remainingQty, null);
  }
  const [zero] = workspaceArrivals([task("a", { purchaseOrders: [order("a", { orderedQty: 0, receivedQty: 0 })] })]);
  assert.equal(zero.quantityIssue, false);
  assert.equal(zero.remainingQty, 0);
});

test("到货归一与冲突标记不修改原任务、订单或数量", () => {
  const rows = [task("A", { materialId: "shared", purchaseOrders: [order("a", { tpOrderNo: "PO-100" })] }), task("B", { materialId: "shared", purchaseOrders: [order("b", { tpOrderNo: "PO-100", receivedQty: 5 })] })];
  const before = structuredClone(rows);
  for (const row of rows) {
    row.purchaseOrders.forEach(Object.freeze);
    Object.freeze(row.purchaseOrders);
    Object.freeze(row);
  }
  Object.freeze(rows);
  assert.equal(workspaceArrivals(rows)[0].remainingQty, null);
  assert.deepEqual(rows, before);
});
