import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/app/procurement/bomModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const output = { exports: {} };
new Function("exports", "module", code)(output.exports, output);
const { bomDevices, isBomMaterial } = output.exports;
const node = (id, overrides = {}) => ({ id, parentId: null, name: id, productLine: "Q8", code: null, qtyPer: null, material: null, remark: null, sortOrder: 0, level: 0, updatedAt: "2026-09-22T00:00:00Z", children: [], ...overrides });
const leaf = (id, parentId, overrides = {}) => node(id, { parentId, code: "M-1", qtyPer: 2, material: { id: "m1", name: "物料一", spec: "A", unit: "件" }, ...overrides });

test("设备按型号隔离，跨分类同一种物料保留独立用量行", () => {
  const roots = [node("Q8", { children: [node("group", { parentId: "Q8", children: [leaf("first", "group"), leaf("second", "group", { qtyPer: 3 })] })] }), node("Q9", { productLine: "Q9", sortOrder: 1 })];
  const devices = bomDevices(roots);
  assert.deepEqual(devices.map((item) => [item.productLine, item.materials.length]), [["Q8", 2], ["Q9", 0]]);
  assert.equal(devices[0].root.id, "Q8");
  assert.equal(devices[0].incomplete, 0);
  assert.equal(isBomMaterial(roots[1]), false);
});

test("旧数据中未关联或缺用量的物料保持可见并标为待完善", () => {
  const device = bomDevices([node("Q8", { children: [leaf("missing-material", "Q8", { material: null }), leaf("missing-qty", "Q8", { qtyPer: 0 }), node("empty-group", { parentId: "Q8" })] })])[0];
  assert.equal(device.materials.length, 2);
  assert.equal(device.incomplete, 2);
});

test("多个历史根节点归入一份设备 BOM，不能把某个组件误当整机根", () => {
  const devices = bomDevices([node("组件一", { children: [leaf("one", "组件一")] }), node("组件二", { children: [leaf("two", "组件二")] })]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].root, null);
  assert.equal(devices[0].roots.length, 2);
  assert.equal(devices[0].materials.length, 2);
});
