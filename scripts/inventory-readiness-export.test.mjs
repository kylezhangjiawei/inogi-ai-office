import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as xlsxModule from "xlsx";
import ts from "typescript";

const XLSX = xlsxModule.default ?? xlsxModule;
const code = ts.transpileModule(readFileSync(new URL("../src/app/procurement/inventoryReadinessExport.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function load({ download } = {}) {
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.equal(name, "xlsx", "导出不得读取业务接口或其他外部数据");
    return { ...XLSX, writeFile: download ?? (() => { assert.fail("构建和纯测试不应触发下载"); }) };
  });
  return exports;
}
const { buildInventoryReadinessExportRows, createInventoryReadinessWorkbook } = load();
const item = (id, overrides = {}) => ({
  id, code: id, name: `物料 ${id}`, category: "机械件", bomPosition: "进气组件", spec: "20 mm", unit: "件",
  qtyPer: 1, stock: 8, available: 5, inTransit: 2, safeStock: 0, currentSets: 5,
  withTransitSets: 7, targetDemand: 10, gapAfterTransit: 3, status: "gap", issue: null,
  syncedAt: "2026-09-12T01:00:00Z", ...overrides,
});
const response = (items = [], overrides = {}) => ({
  source: "tplus", readOnly: true, productLine: "Q5", models: [{ id: "Q5", label: "Q5 制氧机", bomLines: items.length }],
  warehouse: { keyword: "量产", label: "量产仓库", matchedNames: ["量产仓", "【活】量产仓库"] },
  syncedAt: "2026-09-12T01:00:00Z",
  summary: { targetSets: 10, currentBuildableSets: 0, withTransitBuildableSets: 0, inTransitGainSets: 0, targetGapAfterTransit: 10, warningMaterials: 1, bottleneckMaterials: 1, inTransitMaterials: 1 },
  dataQuality: { totalBomLines: items.length, usableBomLines: items.length, invalidBomLines: 0, inventoryMatchedLines: items.length, bomCompleteness: 1, inventoryMatchRate: 1, provisional: false },
  items, ...overrides,
});
const exportedAt = new Date("2026-09-12T02:30:00Z");

test("当前缺料包含全部在途已覆盖的行，以当前可用量判定，不借用在途缺口筛选", () => {
  const result = buildInventoryReadinessExportRows(response([
    item("still-short"),
    item("transit-covered", { inTransit: 20, gapAfterTransit: 0, status: "ready" }),
    item("available-covered", { available: 10, gapAfterTransit: 0, status: "ready" }),
  ]));
  assert.deepEqual(result.shortageRows.map((row) => row.物料编码), ["still-short", "transit-covered"]);
  assert.equal(result.shortageRows[1].当前缺口, 5);
  assert.equal(result.shortageRows[1].在途到齐后缺口, 0);
  assert.deepEqual(result.unverifiedRows, []);
});

test("小数差额消除浮点尾差，四位内的小额缺口保留为数值", () => {
  const result = buildInventoryReadinessExportRows(response([
    item("decimal", { qtyPer: 0.03, targetDemand: 0.3, available: 0.1, inTransit: 0.15, gapAfterTransit: 0.3 - 0.1 - 0.15 }),
    item("tail", { targetDemand: 0.1 + 0.2, available: 0.3, inTransit: 0, gapAfterTransit: 0.1 + 0.2 - 0.3 }),
    item("tiny", { targetDemand: 1.0001, available: 1, inTransit: 0, gapAfterTransit: 0.0001 }),
  ]));
  assert.deepEqual(result.shortageRows.map((row) => row.物料编码), ["decimal", "tiny"]);
  assert.equal(result.shortageRows[0].单机用量, 0.03);
  assert.equal(result.shortageRows[0].当前缺口, 0.2);
  assert.equal(result.shortageRows[0].在途到齐后缺口, 0.05);
  assert.equal(result.shortageRows[1].当前缺口, 0.0001);
});

test("未匹配和 BOM 异常的占位零显示未知，已验证的真实零保持数值零", () => {
  const result = buildInventoryReadinessExportRows(response([
    item("zero", { stock: 0, available: 0, inTransit: 0, gapAfterTransit: 10, status: "shortage" }),
    item("missing-code", { code: null, status: "data_missing", issue: "missing_code", stock: 0, available: 0, inTransit: 0, targetDemand: 0, gapAfterTransit: 0, syncedAt: null }),
    item("missing-qty", { qtyPer: null, status: "data_missing", issue: "missing_qty", stock: 0, available: 0, inTransit: 0, targetDemand: 0, gapAfterTransit: 0, syncedAt: null }),
    item("unmatched", { status: "unmatched", issue: "inventory_unmatched", stock: 0, available: 0, inTransit: 0, gapAfterTransit: 10, syncedAt: null }),
  ]));
  assert.equal(result.shortageRows.length, 1);
  for (const key of ["量产仓现存", "量产仓可用", "全部在途"]) assert.equal(result.shortageRows[0][key], 0);
  for (const row of result.unverifiedRows) {
    for (const key of ["量产仓现存", "量产仓可用", "全部在途", "当前缺口", "在途到齐后缺口"]) assert.equal(row[key], "—");
    assert.notEqual(row.待核实原因, "");
  }
  assert.equal(result.unverifiedRows[0].目标需求, "—");
  assert.equal(result.unverifiedRows[1].单机用量, "—");
  assert.equal(result.unverifiedRows[1].目标需求, "—");
  assert.equal(result.unverifiedRows[2].目标需求, 10, "有效 BOM 需求已知，库存未匹配不将目标需求改写为零");
});

test("缺失或非法数量、源写入时间及诊断异常单列待核实，不能输出可信缺口", () => {
  const rows = [
    item("bad-stock", { stock: NaN }), item("bad-available", { available: Infinity }),
    item("negative", { inTransit: -1 }), item("bad-demand", { targetDemand: null }),
    item("bad-gap", { gapAfterTransit: undefined }), item("zero-qty", { qtyPer: 0 }),
    item("no-time", { syncedAt: null }), item("bad-time", { syncedAt: "not-a-time" }),
    item("diagnostic", { inventoryDiagnostic: { reason: "other_warehouses_only", otherWarehouses: ["研发仓"] } }),
  ];
  const result = buildInventoryReadinessExportRows(response(rows));
  assert.equal(result.shortageRows.length, 0);
  assert.equal(result.unverifiedRows.length, rows.length);
  assert.ok(result.unverifiedRows.every((row) => row.当前缺口 === "—" && row.在途到齐后缺口 === "—"));
  assert.equal(result.unverifiedRows[0].量产仓现存, "—");
  assert.equal(result.unverifiedRows[0].量产仓可用, 5, "独立有效原始值仍可供核对");
  assert.match(result.unverifiedRows.at(-1).待核实原因, /仅其他仓库/);
  const badTarget = response([item("A")]); badTarget.summary.targetSets = -1;
  assert.match(buildInventoryReadinessExportRows(badTarget).unverifiedRows[0].待核实原因, /目标套数/);
});

test("处理完整已加载型号数据，不受前端搜索分页字段影响，也不混入包材或改写原始数组", () => {
  const rows = Array.from({ length: 63 }, (_, index) => item(`00${index}`));
  const data = response(rows, { query: "只显示一条", page: 3, pageSize: 20, filteredItems: [rows[0]], packaging: { sourceFile: "包材.xlsx", sourceSheet: "包材", items: [{ code: "PACK-001", qtyPer: null, stock: 0, available: 0 }] } });
  const before = structuredClone(data);
  rows.forEach(Object.freeze); Object.freeze(rows); Object.freeze(data);
  const result = buildInventoryReadinessExportRows(data);
  assert.equal(result.shortageRows.length, 63);
  assert.equal(result.shortageRows.at(-1).物料编码, "0062");
  assert.ok(!result.shortageRows.some((row) => row.物料编码 === "PACK-001"));
  assert.deepEqual(data, before);
});

test("无当前缺料时保留空清单列头，并说明待核实不等于整体齐套", async () => {
  const result = await createInventoryReadinessWorkbook(response([item("ready", { available: 20, gapAfterTransit: 0 }), item("unknown", { status: "unmatched", issue: "inventory_unmatched", syncedAt: null })]), exportedAt);
  assert.deepEqual(result.workbook.SheetNames, ["当前缺料", "待核实物料", "核算说明"]);
  assert.equal(result.shortageCount, 0); assert.equal(result.unverifiedCount, 1);
  assert.equal(result.workbook.Sheets.当前缺料.A1.v, "物料编码");
  assert.equal(result.workbook.Sheets.当前缺料["!ref"], "A1:O1");
  const notes = XLSX.utils.sheet_to_json(result.workbook.Sheets.核算说明);
  assert.match(notes.find((row) => row.项目 === "当前缺料结果").内容, /如存在待核实物料/);
  assert.equal((await createInventoryReadinessWorkbook(response(), exportedAt)).shortageCount, 0);
});

test("真实 XLSX 写出读回后 SKU 保留文本、数量保留数字、无可执行公式，列宽和筛选可读", async () => {
  const rows = [item("0000123"), item("=1+1", { name: "=HYPERLINK(\"https://example.invalid\")", spec: "+danger", qtyPer: 0.1, targetDemand: 1.2, available: 0.2, inTransit: 0.5, gapAfterTransit: 0.5 })];
  const result = await createInventoryReadinessWorkbook(response(rows), exportedAt);
  const buffer = XLSX.write(result.workbook, { type: "buffer", bookType: "xlsx" });
  assert.ok(buffer.length > 1000);
  const readBack = XLSX.read(buffer, { type: "buffer", cellNF: true, cellStyles: true });
  assert.deepEqual(readBack.SheetNames, ["当前缺料", "待核实物料", "核算说明"]);
  const sheet = readBack.Sheets.当前缺料;
  assert.equal(sheet.A2.v, "0000123"); assert.equal(sheet.A2.t, "s");
  assert.equal(sheet.A3.v, "=1+1"); assert.equal(sheet.A3.t, "s"); assert.equal(sheet.A3.f, undefined);
  assert.equal(sheet.B3.v, rows[1].name); assert.equal(sheet.B3.f, undefined);
  assert.equal(sheet.G3.v, 0.1); assert.equal(sheet.G3.t, "n");
  assert.equal(sheet.L3.v, 1); assert.equal(sheet.L3.t, "n");
  assert.equal(sheet.M3.v, 0.5); assert.equal(sheet.M3.z, "#,##0.####");
  assert.equal(sheet["!autofilter"].ref, "A1:O3");
  assert.ok(sheet["!cols"][1].wch >= 27);
  for (const bookSheet of Object.values(readBack.Sheets)) {
    for (const [address, cell] of Object.entries(bookSheet)) if (!address.startsWith("!")) assert.equal(cell.f, undefined, address);
  }
});

test("核算说明保留型号目标和来源时间，明确全部在途、非采购建议、包材与全量范围", async () => {
  const result = await createInventoryReadinessWorkbook(response([item("A")]), exportedAt);
  const notes = Object.fromEntries(XLSX.utils.sheet_to_json(result.workbook.Sheets.核算说明).map((row) => [row.项目, row.内容]));
  assert.equal(notes.核算型号, "Q5 制氧机"); assert.equal(notes.型号编码, "Q5"); assert.equal(notes.目标套数, 10);
  assert.equal(notes.导出时间, exportedAt.toISOString()); assert.equal(notes.库存源写入时间, "2026-09-12T01:00:00Z");
  assert.equal(notes.库存范围, "量产仓库"); assert.match(notes.匹配的量产仓, /【活】量产仓库/);
  assert.match(notes.导出范围, /全部 BOM/); assert.match(notes.导出范围, /不按页面搜索、筛选或分页/);
  assert.match(notes.在途口径, /全部在途并非按期/); assert.match(notes.使用边界, /不是新增采购建议/);
  assert.match(notes.数据待核实, /占位 0 代表未知/); assert.match(notes.包材, /配套数量尚未确认/);
  assert.match(result.filename, /^缺料清单_Q5 制氧机_目标10套_2026-09-12\.xlsx$/);
});

test("浏览器下载只接收内存生成工作簿并返回真实行数，文件名去除路径和控制字符", async () => {
  const downloads = [];
  const api = load({ download: (workbook, filename) => downloads.push({ workbook, filename }) });
  const data = response([item("A"), item("bad", { qtyPer: null, issue: "missing_qty" })], { models: [{ id: "Q5", label: "Q5/\\:*?\"<>|\n秘密型号", bomLines: 2 }] });
  assert.deepEqual(await api.exportInventoryReadinessXlsx(data), { shortageCount: 1, unverifiedCount: 1 });
  assert.equal(downloads.length, 1);
  assert.doesNotMatch(downloads[0].filename, /[<>:"/\\|?*\u0000-\u001f\u007f]/);
  assert.match(downloads[0].filename, /_目标10套_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.deepEqual(downloads[0].workbook.SheetNames, ["当前缺料", "待核实物料", "核算说明"]);
});
