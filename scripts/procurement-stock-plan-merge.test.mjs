import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/StockPlanPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { StockPlanFormDialog, StockPlanBatchDialog, PlanReadiness };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const plan = { id: "plan-q5", planType: "machine", productId: "product-q5", treeNodeId: "assembly", productLine: "Q5", productionTaskId: "production-1", materialName: "Q5整机", targetQty: 100, unit: "套", remainingQty: 100, batches: [], tasks: [], updatedAt: "2026-09-08T12:00:00Z" };
const readiness = { summary: { currentBuildableSets: 1, withTransitBuildableSets: 2, targetGapAfterTransit: 98 }, dataQuality: { provisional: false, totalBomLines: 136 } };

function fixture(component, props, api = {}) {
  const states = [], effects = [], calls = [], saved = [], navigations = [];
  let cursor = 0, tree, closed = 0;
  const jsx = (type, values) => typeof type === "function" ? type(values) : { type, props: values };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useMemo: (callback) => callback(), useCallback: (callback) => callback(),
    useEffect: (callback) => effects.push(callback),
  };
  const request = (name) => async (...args) => {
    calls.push({ name, args });
    return api[name] ? api[name](...args) : plan;
  };
  const deps = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-router": { useNavigate: () => (value) => navigations.push(value), useSearchParams: () => [new URLSearchParams(), () => {}] },
    "../../lib/i18n": { useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match) }) },
    "../../components/ui/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "../data": { useProcurementProducts: () => [{ id: "product-q5", name: "Q5" }], refreshProcurement: async () => {} },
    "../../lib/procurementApi": new Proxy({}, { get: (_target, name) => request(name) }),
    sonner: { toast: { success() {}, error() {} } },
  };
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    if (name in deps) return deps[name];
    assert.ok(name === "lucide-react" || name === "recharts" || name.startsWith("../../components/ui/") || name === "./SubsystemOperationsPanel", `Unexpected dependency ${name}`);
    return new Proxy({}, { get: (_target, key) => key });
  });
  return {
    calls, saved, navigations,
    get closed() { return closed; },
    render() { cursor = 0; tree = exports[component]({ onClose: () => { closed++; }, onSaved: (value) => saved.push(value), ...props }); return tree; },
    async runEffects() { effects.splice(0).forEach((effect) => effect()); await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
    field(label) {
      const field = nodes(tree).find((node) => node.type === "label" && text(node.props.children?.[0]).replace("*", "").trim() === label);
      assert.ok(field, `${label} exists`);
      return nodes(field).find((node) => ["Input", "Textarea", "select"].includes(node.type));
    },
    form() { return nodes(tree).find((node) => node.type === "form"); },
    close() { nodes(tree).find((node) => node.type === "Dialog").props.onOpenChange(false); },
  };
}

test("整机计划核算仍对不完整、无BOM、无产品和已关联任务禁用生成，完整资料才允许", async () => {
  for (const scenario of [
    { provisional: true }, { totalBomLines: 0 }, { productId: "" }, { tasks: [{ id: "task-1", code: "P1", materialName: "组件", quantity: 3 }] }, { canCreate: false }, {},
  ]) {
    const currentPlan = { ...plan, ...(scenario.productId !== undefined ? { productId: scenario.productId } : {}), ...(scenario.tasks ? { tasks: scenario.tasks } : {}) };
    const view = fixture("PlanReadiness", { plan: currentPlan, canCreate: scenario.canCreate ?? true }, {
      getProcStockPlanReadiness: async () => ({ ...readiness, dataQuality: { ...readiness.dataQuality, ...(scenario.provisional ? { provisional: true } : {}), ...(scenario.totalBomLines === 0 ? { totalBomLines: 0 } : {}) } }),
      generateProcStockPlanTasks: async () => ({ plan: currentPlan, createdCount: 2 }),
    });
    let tree = view.render();
    const button = () => nodes(tree).find((node) => node.type === "Button" && /生成采购任务|已关联采购任务/.test(text(node)));
    if (scenario.canCreate !== false) assert.ok(button().props.disabled, "加载期间不能生成");
    tree = await view.runEffects();
    if (scenario.canCreate === false) assert.equal(button(), undefined);
    else if (Object.keys(scenario).length) assert.ok(button().props.disabled);
    else {
      assert.equal(button().props.disabled, false);
      button().props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(view.calls.filter((call) => call.name === "generateProcStockPlanTasks"), [{ name: "generateProcStockPlanTasks", args: [plan.id] }]);
      assert.equal(view.saved.length, 1);
    }
    const detail = nodes(tree).find((node) => node.type === "Button" && text(node).trim() === "查看物料明细");
    detail.props.onClick();
    const destination = new URL(view.navigations[0], "http://fixture.local");
    assert.equal(destination.searchParams.get("productLine"), "Q5");
    assert.equal(destination.searchParams.get("targetSets"), "100");
  }
});

test("整机表单保留来源型号和目标，同步防重入且失败后行内错误保留输入", async () => {
  let rejectSave;
  const view = fixture("StockPlanFormDialog", { materials: [], defaults: { ...plan, materialName: " Q5整机 ", note: "补资料后核算" } }, {
    createProcStockPlan: () => new Promise((_resolve, reject) => { rejectSave = reject; }),
  });
  view.render();
  assert.equal(view.field("所属产品").props.disabled, true);
  assert.equal(view.field("所属子系统").props.disabled, true);
  const submit = view.form().props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  view.close();
  assert.equal(view.closed, 0);
  assert.equal(view.calls.length, 1);
  const input = view.calls[0].args[0];
  assert.deepEqual([input.planType, input.productId, input.treeNodeId, input.productLine, input.productionTaskId, input.targetQty, input.materialName], ["machine", "product-q5", "assembly", "Q5", "production-1", 100, "Q5整机"]);
  rejectSave(new Error("当前版本已变化，请刷新"));
  await first;
  const tree = view.render();
  assert.ok(nodes(tree).some((node) => node.props?.role === "alert" && text(node).includes("当前版本已变化，请刷新")));
  assert.equal(view.field("物料名称").props.value, " Q5整机 ");
  assert.equal(view.field("目标备货量").props.value, "100");
  assert.equal(view.closed, 0);
});

test("已关联ERP批次只提交检验和实际到货信息，保留同步防重入", async () => {
  let finish;
  const batch = { id: "batch-1", purchaseOrderMirrorId: "mirror-1", supplierName: "供应商", purchaseQty: 10, receivedQty: 8, qualifiedQty: 7, actualArrivalDate: "2026-09-08", note: "复检合格" };
  const view = fixture("StockPlanBatchDialog", { plan, batch }, { updateProcStockPlanBatch: () => new Promise((resolve) => { finish = resolve; }) });
  const tree = view.render();
  assert.equal(view.field("关联 ERP 采购订单行").props.disabled, true);
  assert.ok(!text(tree).includes("本批采购量"));
  assert.equal(view.field("检验合格量").props.value, "7");
  const submit = view.form().props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  view.close();
  assert.equal(view.calls.length, 1);
  assert.equal(view.closed, 0);
  assert.deepEqual(view.calls[0], { name: "updateProcStockPlanBatch", args: [plan.id, batch.id, { purchaseOrderMirrorId: "mirror-1", qualifiedQty: 7, actualArrivalDate: "2026-09-08", note: "复检合格" }] });
  finish(plan); await first;
  assert.equal(view.saved.length, 1);
  assert.equal(view.closed, 1);
});

test("手工批次仍分别提交采购、到货和合格量以及实际到货日期", async () => {
  const batch = { id: "batch-2", supplierId: "supplier-2", supplierName: "手工供应商", purchaseQty: 12, receivedQty: 9, qualifiedQty: 8, purchaseOrderNo: "PO-22", orderDate: "2026-09-06", expectedArrivalDate: "2026-09-09", actualArrivalDate: "2026-09-08", note: "分批到货" };
  const view = fixture("StockPlanBatchDialog", { plan, batch });
  view.render();
  await view.form().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(view.calls[0], { name: "updateProcStockPlanBatch", args: [plan.id, batch.id, { supplierId: "supplier-2", supplierName: "手工供应商", purchaseQty: 12, receivedQty: 9, qualifiedQty: 8, purchaseOrderNo: "PO-22", orderDate: "2026-09-06", expectedArrivalDate: "2026-09-09", actualArrivalDate: "2026-09-08", note: "分批到货" }] });
});
