import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const model = {};
new Function("exports", compile("../src/app/procurement/quoteBookDirectoryModel.ts"))(model);
const source = compile("../src/app/procurement/components/QuoteBookSupplierView.tsx");
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree);
const primitives = new Proxy({}, { get: (_, key) => key });
const quote = (id, supplierId = "s1", patch = {}) => ({ id, materialId: "m1", supplierId, supplierName: supplierId, supplier: { id: supplierId, name: `厂家 ${supplierId}`, source: "local", enabled: true }, supplierModel: "V-100", currency: "CNY", taxIncluded: true, leadTimeDays: 5, tiers: [{ minQty: 10, unitPrice: 3 }], updatedAt: "2026-09-10", ...patch });
const material = (id, supplierId = "s1", patch = {}) => ({ id, name: `物料 ${id}`, spec: "M20", unit: "件", category: "阀类", productLine: "X8", tpInventoryCode: `T-${id}`, erpCode: `ERP-${id}`, reviewStatus: "approved", latestPrice: null, quotes: [quote(`q-${id}`, supplierId)], ...patch });

function fixture(rows = [material("m1")], canWrite = true) {
  const stores = new Map(); let active, dirty, tree;
  const props = { rows, today: "2026-09-10", canWrite, onCompare: (row) => compared.push(row), onEdit: (row, quote) => edited.push([row, quote]), onShowMaterials: () => { shown++; } };
  const compared = [], edited = []; let shown = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) { const { slots } = active, index = active.cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useMemo(fn, deps) { const { slots } = active, index = active.cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
  };
  function component(fn, props, key) {
    const before = active, id = `${before?.id ?? ""}/${fn.name}:${key ?? props.label ?? ""}`;
    const slots = stores.get(id) ?? []; stores.set(id, slots); active = { id, slots, cursor: 0 };
    const result = fn(props); active = before; return result;
  }
  const jsx = (type, props, key) => typeof type === "function" ? component(type, props, key) : { type, props, key };
  const deps = {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "../../lib/i18n": { useI18n: () => ({ t: (s, p = {}) => s.replace(/\{(\w+)\}/g, (m, key) => p[key] ?? m) }) },
    "../../components/ui/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../quoteBookDirectoryModel": model, "./QuoteBookSupplierView.css": {},
  };
  const exports = {};
  new Function("exports", "require", source)(exports, (name) => { if (name in deps) return deps[name]; assert.ok(name === "lucide-react" || name.startsWith("../../components/"), name); return primitives; });
  const api = {
    props, compared, edited, shown: () => shown,
    render() { for (let index = 0; index < 20; index++) { dirty = false; tree = component(exports.QuoteBookSupplierView, props, "root"); if (!dirty) return tree; } assert.fail("render did not settle"); },
    all: () => nodes(api.render()), text: () => text(api.render()),
    button(label) { return api.all().find((node) => ["button", "Button"].includes(node.type) && (node.props["aria-label"] === label || text(node).trim() === label)); },
    click(label) { const button = api.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} disabled`); button.props.onClick(); return api.render(); },
    input(label, value) { const input = api.all().find((node) => node.type === "Input" && node.props["aria-label"] === label); assert.ok(input, label); input.props.onChange({ target: { value } }); return api.render(); },
    choices: () => api.all().filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined),
    selected: () => api.choices().find((node) => node.props["aria-pressed"]),
    cards: () => api.all().filter((node) => node.type === "li" && node.props.className?.startsWith("proc-supplier-material ")),
    refresh(rows) { props.rows = rows; return api.render(); },
  };
  api.render(); return api;
}

test("供应商与报价均分页限制 DOM，下一页会选中可见供应商", () => {
  const rows = Array.from({ length: 15 }, (_, index) => material(`m${index}`, `s${String(index + 1).padStart(2, "0")}`));
  const page = fixture(rows);
  assert.equal(page.choices().length, 12);
  page.click("供应商列表下一页");
  assert.equal(page.choices().length, 3);
  assert.match(text(page.selected()), /s13/);
  assert.match(page.text(), /物料 m12/);
  page.click("供应商列表上一页"); assert.match(text(page.selected()), /s01/);
});

test("当前供应商的物料搜索无结果时保留选择，清除筛选恢复", () => {
  const page = fixture([material("m1", "s1"), material("m2", "s2")]);
  page.choices()[1].props.onClick(); page.render();
  page.input("搜索当前供应商的物料", "不存在");
  assert.match(text(page.selected()), /s2/);
  assert.equal(page.cards().length, 0);
  page.click("清除物料筛选");
  assert.equal(page.cards().length, 1);
  assert.match(text(page.selected()), /s2/);
});

test("物料分页、编码搜索与刷新缩页不会显示空页或沿用旧页码", () => {
  const rows = Array.from({ length: 24 }, (_, index) => material(`m${String(index).padStart(2, "0")}`));
  const page = fixture(rows);
  assert.equal(page.cards().length, 10);
  page.click("物料报价清单下一页"); assert.equal(page.cards().length, 10);
  page.click("物料报价清单下一页"); assert.equal(page.cards().length, 4);
  page.input("搜索当前供应商的物料", "T-m01"); assert.equal(page.cards().length, 1);
  assert.match(text(page.cards()[0]), /m01/);
  page.click("清除物料筛选");
  page.click("物料报价清单下一页");
  page.refresh(rows.slice(0, 2)); assert.equal(page.cards().length, 2);
  assert.equal(page.button("物料报价清单下一页"), undefined);
});

test("刷新删除当前供应商后选中可见替代项，同时清空旧物料筛选", () => {
  const rows = Array.from({ length: 15 }, (_, index) => material(`m${index}`, `s${String(index + 1).padStart(2, "0")}`));
  const page = fixture(rows); page.click("供应商列表下一页");
  page.input("搜索当前供应商的物料", "T-m12");
  page.refresh(rows.slice(0, 5));
  assert.equal(page.choices().length, 5);
  assert.match(text(page.selected()), /s01/);
  assert.equal(page.cards().length, 1);
  assert.equal(page.all().find((node) => node.type === "Input" && node.props["aria-label"] === "搜索当前供应商的物料").props.value, "");
});

test("未关联报价前面插入新报价后，稳定身份保留选中项和物料筛选", () => {
  const q1 = quote("q1", undefined, { supplierId: undefined, supplier: undefined, supplierName: "同名" });
  const q2 = quote("q2", undefined, { supplierId: undefined, supplier: undefined, supplierName: "同名" });
  const row = material("m1", "s1", { quotes: [q1, q2] });
  const page = fixture([row]); page.choices()[1].props.onClick(); page.render();
  page.input("搜索当前供应商的物料", "T-m1");
  page.refresh([{ ...row, quotes: [{ ...q1, id: "q0" }, q1, q2] }]);
  page.click("编辑报价"); assert.equal(page.edited[0][1].id, "q2");
  assert.equal(page.all().find((node) => node.type === "Input" && node.props["aria-label"] === "搜索当前供应商的物料").props.value, "T-m1");
});

test("比较及编辑传回原始物料和报价，读权限用户没有编辑入口", () => {
  const row = material("m1"); const page = fixture([row]);
  page.click("查看全部厂家报价"); page.click("编辑报价");
  assert.equal(page.compared[0], row); assert.equal(page.edited[0][1], row.quotes[0]);
  const readonly = fixture([row], false); assert.equal(readonly.button("编辑报价"), undefined);
  readonly.click("查看全部厂家报价"); assert.equal(readonly.compared[0], row);
});

test("真实状态和缺失值明确显示，报价快照异名可核对且空库有物料入口", () => {
  const page = fixture([material("m1", "s1", { reviewStatus: undefined, quotes: [quote("q1", "s1", { leadTimeDays: 0, validUntil: undefined, supplierName: "旧厂家名", supplier: { id: "s1", name: "新厂家名", source: "local", enabled: false } })] })]);
  assert.match(page.text(), /档案停用/); assert.match(page.text(), /本地维护/); assert.match(page.text(), /审核状态未提供/);
  assert.match(page.text(), /未设置截止日期/); assert.match(page.text(), /报价记录厂家名 ： 旧厂家名/);
  assert.doesNotMatch(page.text(), /合格供应商|正常供货/);
  const empty = fixture([]); empty.click("按物料查看"); assert.equal(empty.shown(), 1);
});
