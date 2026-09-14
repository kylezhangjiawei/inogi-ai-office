import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/app/procurement/quoteBookDirectoryModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = {};
new Function("exports", code)(model);
const { buildQuoteBookDirectory, filterSupplierDirectory, filterSupplierMaterials, supplierSourceLabel, materialReviewLabel, directoryQuoteExpired } = model;
const quote = (id, overrides = {}) => ({
  id, materialId: "m1", supplierId: "s1", supplierName: "东升", supplier: { id: "s1", name: "东升精密", source: "tplus", enabled: true },
  supplierModel: "DS-200", currency: "CNY", taxIncluded: true, leadTimeDays: 7, tiers: [{ minQty: 10, unitPrice: 2 }], updatedAt: "2026-09-10", ...overrides,
});
const material = (id, quotes, overrides = {}) => ({ id, name: "电磁阀", spec: "M20", unit: "件", category: "阀类", productLine: "X8", latestPrice: null, quotes, ...overrides });

test("同一供应商 ID 聚合多种物料，保留独立报价记录与厂家名称快照", () => {
  const rows = [material("m1", [quote("q1"), quote("q2", { supplierName: "旧名称" })]), material("m2", [quote("q3")])];
  const [group] = buildQuoteBookDirectory(rows);
  assert.equal(group.name, "东升精密");
  assert.equal(group.relation, "linked");
  assert.equal(group.materialCount, 2);
  assert.equal(group.entries.length, 3);
  assert.deepEqual(group.quoteNames, ["东升", "旧名称"]);
  assert.equal(group.entries[0].material, rows[0]);
  assert.equal(group.entries[0].quote, rows[0].quotes[0]);
});

test("同名供应商的不同 ID 始终分开，原始 ID 不裁剪后误合并", () => {
  const rows = [material("m1", [quote("q1"), quote("q2", { supplierId: "s2", supplier: { id: "s2", name: "东升精密", source: "local", enabled: true } }), quote("q3", { supplierId: " s1 ", supplier: undefined })])];
  const groups = buildQuoteBookDirectory(rows);
  assert.equal(groups.length, 3);
  assert.deepEqual(new Set(groups.map((group) => group.supplierId)), new Set(["s1", "s2", " s1 "]));
});

test("缺失或空白供应商 ID 的同名报价逐条保留，不从嵌套档案或名称推测关联", () => {
  const rows = [material("m1", [quote("q1", { supplierId: undefined }), quote("q2", { supplierId: "" }), quote("q3", { supplierId: "  " })])];
  const groups = buildQuoteBookDirectory(rows);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.key)).size, 3);
  assert.ok(groups.every((group) => group.relation === "unlinked" && !group.supplierId && !group.supplier));
});

test("档案缺失、停用与 ID 不一致分别展示，不静默降级为正常关联", () => {
  const make = (overrides) => buildQuoteBookDirectory([material("m1", [quote("q1", overrides)])])[0];
  assert.equal(make({ supplier: undefined }).relation, "unresolved");
  assert.equal(make({ supplier: { id: "s1", name: "东升", source: "tplus", enabled: false } }).relation, "disabled");
  const conflict = make({ supplier: { id: "other", name: "东升", source: "tplus", enabled: true } });
  assert.equal(conflict.relation, "conflict");
  assert.equal(conflict.supplier, undefined);
});

test("同一 ID 的矛盾档案不能取第一条冒充可信信息", () => {
  for (const changed of [{ name: "异名档案" }, { source: "local" }, { enabled: false }]) {
    const groups = buildQuoteBookDirectory([material("m1", [quote("q1"), quote("q2", { supplier: { ...quote("q1").supplier, ...changed } })])]);
    assert.equal(groups[0].relation, "conflict");
    assert.equal(groups[0].supplier, undefined);
  }
});

test("一条已关联、一条缺档案时保留待核对状态", () => {
  const [group] = buildQuoteBookDirectory([material("m1", [quote("q1"), quote("q2", { supplier: undefined })])]);
  assert.equal(group.relation, "unresolved");
  assert.equal(group.supplier, undefined);
  assert.equal(group.entries.length, 2);
});

test("供应商搜索覆盖真实 ID、当前名称和旧报价名称，不混入物料字段", () => {
  const groups = buildQuoteBookDirectory([material("m1", [quote("q1")])]);
  for (const query of ["S1", "东升精密", " 东升 "]) assert.equal(filterSupplierDirectory(groups, query).length, 1, query);
  assert.equal(filterSupplierDirectory(groups, "电磁阀").length, 0);
  assert.equal(filterSupplierDirectory(groups, ""), groups);
});

test("物料搜索覆盖两个实际编码、规格、分类、产品及厂家型号，分类取交集", () => {
  const rows = [material("m1", [quote("q1")], { tpInventoryCode: "T-110", erpCode: "ERP-222" }), material("m2", [quote("q2")], { category: "电池", name: "电池包", spec: "24V", productLine: "X9" })];
  const [{ entries }] = buildQuoteBookDirectory(rows);
  for (const query of [" t-110 ", "erp-222", "M20", "阀类", "x8"]) assert.deepEqual(filterSupplierMaterials(entries, query).map((entry) => entry.material.id), ["m1"], query);
  assert.equal(filterSupplierMaterials(entries, "ds-200").length, 2);
  assert.equal(filterSupplierMaterials(entries, "T-110", "电池").length, 0);
  assert.equal(filterSupplierMaterials(entries, "", "电池")[0].material.id, "m2");
  assert.equal(entries.length, 2, "筛选不会改写选中供应商的完整报价集合");
});

test("来源与审核标识只翻译实际已知值，未知不推断为正式审核", () => {
  assert.equal(supplierSourceLabel("tplus"), "T+ 同步");
  assert.equal(supplierSourceLabel("local"), "本地维护");
  assert.equal(supplierSourceLabel("unexpected"), "来源未确认");
  assert.equal(materialReviewLabel("approved"), "已审核");
  assert.equal(materialReviewLabel("pending"), "待审核");
  assert.equal(materialReviewLabel("rejected"), "已驳回");
  assert.equal(materialReviewLabel(undefined), "审核状态未提供");
});

test("有效期边界沿用报价库口径，当天未过期，无日期不虚构截止日期", () => {
  assert.equal(directoryQuoteExpired(quote("q1", { validUntil: "2026-09-09" }), "2026-09-10"), true);
  assert.equal(directoryQuoteExpired(quote("q1", { validUntil: "2026-09-10" }), "2026-09-10"), false);
  assert.equal(directoryQuoteExpired(quote("q1"), "2026-09-10"), false);
});
