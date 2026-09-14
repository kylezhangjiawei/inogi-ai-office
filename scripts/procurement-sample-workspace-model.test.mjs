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
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}

const sampleFacts = compile("../src/app/lib/procSampleFacts.ts");
const { isSampleTask, sampleTaskStage, filterSampleTasks } = compile("../src/app/procurement/sampleWorkspaceModel.ts", {
  "../lib/procSampleFacts": sampleFacts,
});
const sampleTest = (overrides = {}) => ({
  roundId: "round-1", testerUserId: "tester-1", testerName: "研发测试人李工",
  assignedAt: "2026-09-08T02:00:00Z", assignedByName: "采购张工", result: null,
  note: null, confirmedAt: null, confirmedByName: null, ...overrides,
});
const passed = () => sampleTest({ result: "passed", note: "尺寸符合要求", confirmedAt: "2026-09-08T03:00:00Z", confirmedByName: "研发测试人李工" });
const task = (id, overrides = {}) => ({
  id, code: `PROC-${id}`, materialName: "阀体组件", spec: "316L / 20 mm", buyer: "采购张工", rdContact: "研发王工",
  status: "pending_confirm", needSample: false, sampleTest: null, purchaseOrders: [], logs: [], ...overrides,
});
const ids = (tasks) => tasks.map((item) => item.id);
const resetLog = (createdAt = "2026-09-08T04:00:00Z") => ({
  at: createdAt, createdAt, fromStatus: "priced", toStatus: "pending_sample", text: "重新送样",
});

test("样品识别覆盖要求样品、已有测试轮次和免费样品采购单，普通采购不因已到货而混入", () => {
  const cases = [
    [task("requested", { needSample: true }), true],
    [task("current-test", { status: "testing", sampleTest: sampleTest() }), true],
    [task("old-test", { status: "priced", sampleTest: passed() }), true],
    [task("free-sample", { purchaseOrders: [{ freeSample: true, supplierName: "免费样品供应商" }] }), true],
    [task("paid-order", { status: "completed", arrivedQty: 100, purchaseOrders: [{ freeSample: false, orderedQty: 100, receivedQty: 100, supplierName: "普通供应商" }] }), false],
    [task("ordinary"), false],
  ];
  for (const [row, expected] of cases) assert.equal(isSampleTask(row), expected, row.id);
  assert.deepEqual(ids(filterSampleTasks(cases.map(([row]) => row), "all", "")), ["requested", "current-test", "old-test", "free-sample"]);
});

test("搜索覆盖采购人、研发联系人、实际测试人和各采购单供应商，并处理首尾空格与大小写", () => {
  const row = task("A-170", {
    needSample: true, buyer: "Buyer Alice", rdContact: "研发王工", sampleTest: sampleTest(),
    purchaseOrders: [{ supplierName: "第一供应商" }, { supplierName: "Supplier BETA" }],
  });
  const decoy = task("ordinary", { buyer: row.buyer, rdContact: row.rdContact, purchaseOrders: row.purchaseOrders });
  for (const query of [" buyer ALICE ", "研发王工", "研发测试人李工", "第一供应商", "supplier beta", "proc-a-170", "阀体", "316l"]) {
    assert.deepEqual(ids(filterSampleTasks([row, decoy], "all", query)), [row.id], query);
  }
  assert.deepEqual(filterSampleTasks([row], "all", "不存在的人"), []);
  assert.deepEqual(ids(filterSampleTasks([row], "all", "  ")), [row.id]);
});

test("分组和搜索取交集，测试中与送样跟进不会仅凭历史结论归入已确认", () => {
  const rows = [
    task("preparing", { needSample: true }),
    task("waiting", { needSample: true, status: "pending_sample" }),
    task("testing", { status: "testing", sampleTest: sampleTest() }),
    task("resample", { status: "pending_sample", sampleTest: sampleTest({ result: "failed_resample" }) }),
    task("requote", { status: "inquiring", sampleTest: sampleTest({ result: "failed_requote" }) }),
    task("confirmed", { status: "priced", sampleTest: passed() }),
  ];
  for (const [filter, expected] of [["preparing", ["preparing"]], ["waiting", ["waiting"]], ["testing", ["testing"]], ["followup", ["resample", "requote"]], ["confirmed", ["confirmed"]]]) {
    assert.deepEqual(ids(filterSampleTasks(rows, filter, "采购张工")), expected, filter);
  }
  assert.deepEqual(filterSampleTasks(rows, "waiting", "PROC-confirmed"), []);
});

test("旧 passed 经重新送样后不可算 confirmed，包括后来再次进入已定价的情况", () => {
  const waitingAgain = task("waiting-again", { status: "pending_sample", sampleTest: passed(), logs: [resetLog()] });
  const returnedToPriced = task("returned-to-priced", { status: "priced", sampleTest: passed(), logs: [resetLog(), {
    at: "2026-09-08T05:00:00Z", createdAt: "2026-09-08T05:00:00Z", fromStatus: "pending_sample", toStatus: "priced", text: "继续采购",
  }] });
  const uncertainRestart = task("undated-restart", { status: "priced", sampleTest: passed(), logs: [resetLog("2026-09-08")] });
  assert.equal(sampleTaskStage(waitingAgain), "waiting");
  assert.equal(sampleTaskStage(returnedToPriced), "preparing");
  assert.equal(sampleTaskStage(uncertainRestart), "preparing");
  assert.deepEqual(filterSampleTasks([waitingAgain, returnedToPriced, uncertainRestart], "confirmed", ""), []);
  const currentRound = task("current-round", { status: "priced", sampleTest: passed(), logs: [resetLog("2026-09-08T01:00:00Z")] });
  assert.equal(sampleTaskStage(currentRound), "confirmed", "旧轮重开早于当前分派时，不应抹掉新一轮有效结论");
});

test("cancelled 可保留在全部样品记录中，但不进入等待、测试、跟进或已确认分组", () => {
  const rows = [
    task("cancel-request", { needSample: true, status: "cancelled" }),
    task("cancel-passed", { status: "cancelled", sampleTest: passed() }),
    task("cancel-failed", { status: "cancelled", sampleTest: sampleTest({ result: "failed_resample" }) }),
    task("cancel-free", { status: "cancelled", purchaseOrders: [{ freeSample: true, supplierName: "样品商" }] }),
  ];
  for (const row of rows) assert.equal(sampleTaskStage(row), "cancelled", row.id);
  for (const filter of ["preparing", "waiting", "testing", "followup", "confirmed"]) assert.deepEqual(filterSampleTasks(rows, filter, ""), [], filter);
  assert.deepEqual(ids(filterSampleTasks(rows, "all", "")), ids(rows));
});

test("已确认必须有可验证的本轮结论，过滤不修改原数据或改变输入顺序", () => {
  const rows = [
    task("good-B", { status: "priced", sampleTest: passed() }),
    task("no-confirmation", { status: "priced", sampleTest: sampleTest({ result: "passed" }) }),
    task("no-logs", { status: "priced", sampleTest: passed(), logs: undefined }),
    task("good-A", { status: "completed", sampleTest: passed() }),
  ];
  const before = structuredClone(rows);
  Object.freeze(rows);
  rows.forEach(Object.freeze);
  const filtered = filterSampleTasks(rows, "confirmed", "");
  assert.deepEqual(ids(filtered), ["good-B", "good-A"]);
  assert.equal(filtered[0], rows[0]);
  assert.equal(filtered[1], rows[3]);
  assert.deepEqual(rows, before);
});
