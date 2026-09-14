import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "require", ...Object.keys(globals), code)(exports, (name) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, ...Object.values(globals));
  return exports;
}
const model = load("src/app/procurement/samples/sampleCommercialModel.ts");
const task = (overrides = {}) => ({ id: "task-A", materialId: "material-A", materialName: "阀体", unit: "件", quantity: 10, status: "testing", updatedAt: "2026-09-10T00:00:00Z", selectedQuotationId: "q-1", ...overrides });
const quote = (id = "q-1", overrides = {}) => ({ id, taskId: "task-A", materialId: "material-A", materialName: "阀体", supplierName: "供应商 A", unitPrice: 12.3456, currency: "CNY", leadTimeDays: 10, minOrderQty: 100, quoteDate: "2026-09-01", validUntil: "2026-10-01", isSelected: true, note: "税费：含税；由采购复核付款条款", ...overrides });

test("正式摘要仅选isSelected，不据legacy首条字段漏掉合法多条报价", () => {
  const result = model.sampleCommercialFacts(task(), [quote(), quote("q-2", { currency: "USD", supplierName: "供应商 B" }), quote("q-3", { isSelected: false })]);
  assert.equal(result.kind, "ready"); assert.deepEqual(result.quotes.map((row) => row.id), ["q-1", "q-2"]);
  assert.equal(model.commercialPrice(result.quotes[0]), "CNY 12.3456"); assert.equal(model.commercialPrice(result.quotes[1]), "USD 12.3456");
  assert.equal("total" in result, false); assert.equal("etaDate" in result.quotes[0], false);
});
test("任务ID必须精确，物料缺ID可读但不借同名推断同一物料", () => {
  assert.equal(model.sampleCommercialFacts(task({ id: "" }), [quote()]).kind, "unverified");
  assert.equal(model.sampleCommercialFacts(task({ materialId: undefined }), [quote()]).quotes[0].materialCheck, "unverified");
  assert.equal(model.sampleCommercialFacts(task(), [quote("q", { materialId: "same-name-different-id", materialName: "阀体" })]).quotes[0].materialCheck, "conflict");
  assert.equal(model.sampleCommercialFacts(task(), [quote("q", { materialId: undefined })]).quotes[0].materialCheck, "unverified");
  assert.throws(() => model.sampleCommercialFacts(task(), [quote("q", { taskId: "other-task" })]), /当前任务不一致/);
});
test("临时物料任务允许合法多物料报价，逐条保留物料身份与条件", () => {
  const result = model.sampleCommercialFacts(task({ materialId: undefined }), [quote("valve"), quote("spring", { materialId: "material-B", materialName: "弹簧", unitPrice: 3 })]);
  assert.equal(result.kind, "ready"); assert.deepEqual(result.quotes.map((row) => [row.materialId, row.materialName, row.materialCheck]), [["material-A", "阀体", "unverified"], ["material-B", "弹簧", "unverified"]]);
  assert.equal(model.sampleCommercialFacts(task(), [quote("spaces", { materialId: " material-A " })]).quotes[0].materialCheck, "conflict", "身份标识不trim后误匹配");
});
test("候选报价不作为采购条件，重复身份和缺选中标志不假装空结果", () => {
  assert.equal(model.sampleCommercialFacts(task(), [quote("candidate", { isSelected: false })]).kind, "empty");
  assert.throws(() => model.sampleCommercialFacts(task(), [quote(), quote()]), /记录不完整/);
  assert.throws(() => model.sampleCommercialFacts(task(), [quote("bad", { isSelected: undefined })]), /记录不完整/);
  assert.throws(() => model.sampleCommercialFacts(task(), { items: [] }), /格式不完整/);
});
test("达到服务端200条上限不声明全量已选或零已选", () => {
  const rows = Array.from({ length: 200 }, (_, id) => quote(`q-${id}`, { isSelected: false }));
  assert.equal(model.sampleCommercialFacts(task(), rows).kind, "limit");
  assert.equal(model.sampleCommercialFacts(task(), rows.slice(0, 199)).kind, "empty");
});
test("缺失及非法价格/币种/交期/MOQ/日历日期保持待核对而不是0", () => {
  const invalid = model.sampleCommercialFacts(task(), [quote("bad", { supplierName: "", unitPrice: -5, currency: "人民币", leadTimeDays: NaN, minOrderQty: -1, quoteDate: "2026-02-30", validUntil: "invalid" })]).quotes[0];
  assert.deepEqual([invalid.supplierName, invalid.unitPrice, invalid.currency, invalid.leadTimeDays, invalid.minOrderQty, invalid.quoteDate, invalid.validUntil], Array(7).fill(null));
  assert.equal(model.commercialPrice(invalid), null);
  const zero = model.sampleCommercialFacts(task(), [quote("zero", { unitPrice: 0, leadTimeDays: 0, minOrderQty: 0 })]).quotes[0];
  assert.equal(model.commercialPrice(zero), "CNY 0"); assert.equal(zero.leadTimeDays, 0); assert.equal(zero.minOrderQty, 0);
});
test("备注保留说明，不派生付款税费或把行总金额当单价", () => {
  const input = quote("q", { lineTotal: 1234.56, quantity: 100, note: "供应商型号：A1；税费：含税；到货后另议付款" });
  const result = model.sampleCommercialFacts(task(), [input]).quotes[0];
  assert.equal(result.unitPrice, 12.3456); assert.equal(result.note, input.note);
  assert.equal("taxIncluded" in result, false); assert.equal("paymentTerms" in result, false); assert.equal("lineTotal" in result, false);
});

const jsx = (type, props, key) => ({ type, props, key });
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || typeof tree === "boolean" ? "" : String(tree);
function fixture(t, overrides = {}) {
  let user = { id: "buyer-A", name: "采购甲", permissions: ["page:proc-cockpit"] }, allowed = true;
  let props = { task: task(), disabled: false, unavailable: false, ...overrides };
  let cursor = 0, dirty = false; const slots = [], effects = [], requests = [], calls = [];
  const timers = new Map(); let timerId = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((value, i) => !Object.is(value, a[i]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const old = slots[i], next = { deps }; slots[i] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const translate = (value, args = {}) => value.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? key);
  const component = load("src/app/procurement/samples/SampleCommercialSummary.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "lucide-react": { ArrowUpRight: "ArrowUpRight", RefreshCw: "RefreshCw" },
    "../../auth": { useAuth: () => ({ user }) }, "../../components/ui/button": { Button: "Button" }, "../../hooks/usePermission": { useAnyPermission: () => allowed },
    "../../lib/i18n": { useI18n: () => ({ t: translate }), i18nLocale: () => "zh-CN" },
    "../../lib/procurementApi": { listQuotations(params) { let resolve, reject; const result = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ params, resolve, reject }); return result; } },
    "./sampleCommercialModel": model, "./sampleCommercial.css": {},
  }, { setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id) }).SampleCommercialSummary;
  const view = {
    requests, calls,
    render() { let tree; for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; tree = component({ ...props, onOpenTask: () => calls.push(props.task.id) }); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw new Error("render did not settle"); },
    update(next) { props = { ...props, ...next }; return this.render(); },
    permission(value) { allowed = value; return this.render(); },
    account(id) { user = { ...user, id }; return this.render(); },
    click(label) { const button = nodes(this.render()).find((node) => node.type === "Button" && text(node).includes(label)); assert.ok(button, label); assert.equal(button.props.disabled, false); button.props.onClick(); return this.render(); },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
    timeout() { for (const callback of [...timers.values()]) callback(); },
  };
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return view;
}
test("只有采购报价查看权限才请求，研发测试资格不自动获得价格", async (t) => {
  const view = fixture(t); let tree = view.permission(false); assert.equal(view.requests.length, 0); assert.match(text(tree), /暂无采购报价查看权限/);
  view.permission(true); assert.deepEqual(view.requests[0].params, { taskId: "task-A" }); view.requests[0].resolve([quote()]); tree = await view.settle(); assert.match(text(tree), /CNY 12.3456/);
  tree = view.permission(false); assert.doesNotMatch(text(tree), /12.3456|供应商 A/);
});
test("任务快速切换后旧响应不回填，A到B再到A仍重新读取", async (t) => {
  const view = fixture(t); view.render(); view.update({ task: task({ id: "task-B" }) }); view.update({ task: task() });
  assert.equal(view.requests.length, 3); view.requests[0].resolve([quote("old", { supplierName: "旧 A" })]); view.requests[1].resolve([quote("B", { taskId: "task-B", supplierName: "旧 B" })]); let tree = await view.settle(); assert.doesNotMatch(text(tree), /旧 A|旧 B/);
  view.requests[2].resolve([quote("new", { supplierName: "新 A" })]); tree = await view.settle(); assert.match(text(tree), /新 A/);
});
test("账号变化隐藏前账号摘要且旧按钮回调不能打开任务", async (t) => {
  const view = fixture(t); view.render(); view.requests[0].resolve([quote()]); let tree = await view.settle();
  const oldOpen = nodes(tree).find((node) => node.type === "Button" && text(node).includes("核对原采购任务"));
  tree = view.account("buyer-B"); assert.doesNotMatch(text(tree), /供应商 A/); oldOpen.props.onClick(); assert.deepEqual(view.calls, []);
});
test("dirty禁用操作但保留已读摘要，解除后重读；unavailable立即隐藏", async (t) => {
  const view = fixture(t); view.render(); view.requests[0].resolve([quote()]); await view.settle(); let tree = view.update({ disabled: true });
  assert.match(text(tree), /供应商 A/); assert.equal(view.requests.length, 1); assert.ok(nodes(tree).filter((node) => node.type === "Button").every((node) => node.props.disabled));
  tree = view.update({ disabled: false }); assert.equal(view.requests.length, 2); assert.doesNotMatch(text(tree), /供应商 A/);
  view.requests[1].resolve([quote()]); await view.settle(); tree = view.update({ unavailable: true }); assert.doesNotMatch(text(tree), /供应商 A/); assert.match(text(tree), /来源正在更新或暂不可用/);
});
test("加载失败不能变成无报价，重试清空旧错误且晚响应无效", async (t) => {
  const view = fixture(t); view.render(); view.requests[0].reject(new Error("offline")); let tree = await view.settle(); assert.match(text(tree), /尚不能判断是否已有报价/); assert.doesNotMatch(text(tree), /没有已确认报价/);
  view.click("重试采购条件"); view.requests[1].resolve([quote()]); tree = await view.settle(); assert.match(text(tree), /供应商 A/); assert.doesNotMatch(text(tree), /offline/);
});
test("无物料ID仍按原任务读取并标未核对同物料，原任务入口保持精确", async (t) => {
  const view = fixture(t, { task: task({ materialId: undefined }) }); view.render(); assert.equal(view.requests.length, 1); assert.deepEqual(view.requests[0].params, { taskId: "task-A" });
  view.requests[0].resolve([quote()]); const tree = await view.settle(); assert.match(text(tree), /CNY 12.3456/); assert.match(text(tree), /尚未核对为同一物料/); assert.match(text(tree), /material-A/);
  view.click("核对原采购任务"); assert.deepEqual(view.calls, ["task-A"]);
});
test("重读超时可重试，先前晚到的价格不会冒充重试结果", async (t) => {
  const view = fixture(t); view.render(); view.timeout(); let tree = await view.settle(); assert.match(text(tree), /读取超时/);
  view.click("重试采购条件"); view.requests[0].resolve([quote("late", { supplierName: "过期结果" })]); tree = await view.settle(); assert.doesNotMatch(text(tree), /过期结果/);
  view.requests[1].resolve([quote("fresh", { supplierName: "最新结果" })]); tree = await view.settle(); assert.match(text(tree), /最新结果/);
});
test("多选分行展示，原备注可读且不算总价或承诺到货", async (t) => {
  const view = fixture(t); view.render(); view.requests[0].resolve([quote(), quote("second", { supplierName: "供应商 B", currency: "USD", unitPrice: 2 })]); const tree = await view.settle();
  assert.equal(nodes(tree).filter((node) => node.type === "li").length, 2); assert.match(text(tree), /2 条已选采购明细/); assert.match(text(tree), /CNY 12.3456/); assert.match(text(tree), /USD 2/); assert.match(text(tree), /不推算承诺到货/); assert.match(text(tree), /税费：含税/);
});
