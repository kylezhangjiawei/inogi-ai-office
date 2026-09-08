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
    useId() { const index = cursor++; return states[index] ??= `field-${index}`; },
    isValidElement: (element) => Boolean(element && typeof element === "object" && "type" in element),
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    Children: { toArray: (children) => [children].flat(Infinity).filter(Boolean) },
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
    "../data": { useProcurementProducts: () => [{ id: "product-q5", name: "Q5" }, { id: "product-q7", name: "Q7" }], refreshProcurement: async () => {} },
    "../../lib/procurementApi": new Proxy({}, { get: (_target, name) => request(name) }),
    sonner: { toast: { success() {}, error() {} } },
  };
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    if (name in deps) return deps[name];
    assert.ok(name === "lucide-react" || name === "recharts" || name.startsWith("../../components/ui/") || ["./SubsystemOperationsPanel", "./StockPlanControls", "./common"].includes(name), `Unexpected dependency ${name}`);
    return new Proxy({}, { get: (_target, key) => key });
  });
  return {
    calls, saved, navigations,
    get closed() { return closed; },
    get tree() { return tree; },
    render() { cursor = 0; tree = exports[component]({ onClose: () => { closed++; }, onSaved: (value) => saved.push(value), ...props }); return tree; },
    async runEffects() { effects.splice(0).forEach((effect) => effect()); await new Promise((resolve) => setImmediate(resolve)); return this.render(); },
    field(label) {
      const fieldLabel = nodes(tree).find((node) => node.type === "Label" && text(node).replace("*", "").trim() === label);
      if (fieldLabel) {
        const control = nodes(tree).find((node) => node.props?.id === fieldLabel.props.htmlFor);
        assert.ok(control, `${label} has a control associated with its label`);
        return control;
      }
      const field = nodes(tree).find((node) => node.type === "label" && text(node.props.children?.[0]).replace("*", "").trim() === label);
      assert.ok(field, `${label} exists`);
      return nodes(field).find((node) => ["Input", "Textarea", "select"].includes(node.type));
    },
    change(label, value) {
      const control = this.field(label);
      assert.equal(Boolean(control.props.disabled), false, `${label} is editable`);
      if (control.props.onValueChange) control.props.onValueChange(value);
      else control.props.onChange(["Input", "Textarea", "select"].includes(control.type) ? { target: { value } } : value);
      return this.render();
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
  assert.equal(view.field("关联 ERP 采购订单行").props.options.find((option) => option.value === "mirror-1")?.value, "mirror-1", "历史 ERP 行未出现在选项结果时仍保留当前关联");
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

test("物料自由输入只绑定唯一名称，同名需明确选择编码且清空关联保留手填信息", async () => {
  const materials = [
    { id: "cap-1", name: "电容", spec: "10nF", unit: "个", tpInventoryCode: "A01" },
    { id: "cap-2", name: "电容", spec: "100nF", unit: "只", tpInventoryCode: "A02" },
    { id: "filter-1", name: "滤芯", spec: "标准", unit: "枚", tpInventoryCode: "A03" },
  ];
  const view = fixture("StockPlanFormDialog", { materials, defaults: { planType: "material", targetQty: 10 } });
  view.render();
  const suggestions = view.field("物料名称").props.options.map((option) => typeof option === "string" ? option : option.value);
  assert.deepEqual(suggestions, ["电容", "滤芯"], "自由输入候选按名称去重，关联编码仍分别选择");
  view.change("物料名称", "滤芯");
  assert.deepEqual([view.field("关联物料编码").props.value, view.field("规格型号").props.value, view.field("单位").props.value], ["filter-1", "标准", "枚"]);
  view.change("物料名称", "电容");
  assert.equal(view.field("关联物料编码").props.value, "", "同名多档案不得自动选中任意一条");
  view.change("关联物料编码", "cap-2");
  assert.deepEqual([view.field("物料名称").props.value, view.field("规格型号").props.value, view.field("单位").props.value], ["电容", "100nF", "只"]);
  view.change("关联物料编码", "");
  await view.form().props.onSubmit({ preventDefault() {} });
  const input = view.calls.find((call) => call.name === "createProcStockPlan").args[0];
  assert.deepEqual([input.materialId, input.materialName, input.spec, input.unit], ["", "电容", "100nF", "只"]);
});

test("切换产品清除旧子系统，切换计划类型清除 BOM 型号，日期可清空", async () => {
  const view = fixture("StockPlanFormDialog", { materials: [], plan: { ...plan, targetDate: "2026-09-30" } });
  view.render();
  view.change("所属产品", "product-q7");
  assert.equal(view.field("所属子系统").props.value, "");
  view.change("所属子系统", "assembly-q7");
  view.change("所属产品", "");
  assert.equal(view.field("所属子系统").props.value, "");
  assert.equal(view.field("所属子系统").props.disabled, true);
  view.change("计划类型", "packaging");
  view.change("计划类型", "machine");
  assert.equal(view.field("整机 BOM 型号").props.value, "", "重新切回整机时不能沿用上一个型号");
  assert.equal(view.field("单位").props.value, "套");
  assert.equal(view.field("单位").props.disabled, true);
  view.change("整机 BOM 型号", "Q7");
  view.change("计划类型", "packaging");
  view.change("计划完成日期", "");
  await view.form().props.onSubmit({ preventDefault() {} });
  const input = view.calls.find((call) => call.name === "updateProcStockPlan").args[1];
  assert.deepEqual([input.productId, input.treeNodeId, input.productLine, input.targetDate, input.planType], ["", "", "", "", "packaging"]);
});

test("整机缺 BOM 型号时行内提示且不发送请求，补选后可以提交", async () => {
  const view = fixture("StockPlanFormDialog", { materials: [], defaults: { planType: "machine", materialName: "Q5 整机", targetQty: 3, unit: "套" } });
  view.render();
  await view.form().props.onSubmit({ preventDefault() {} });
  assert.equal(view.calls.length, 0, "不能绕过已替换原生 select 的必填校验");
  view.render();
  assert.ok(nodes(view.tree).some((node) => node.props?.role === "alert" && /BOM.*型号/.test(text(node))));
  assert.equal(view.closed, 0);
  assert.equal(view.field("目标备货量").props.value, "3");
  view.change("整机 BOM 型号", "Q5");
  await view.form().props.onSubmit({ preventDefault() {} });
  assert.equal(view.calls[0].args[0].productLine, "Q5");
  assert.equal(view.closed, 1);
});

test("批次关联可切回手工模式，清空供应商档案和日期不丢手填数量与名称", async () => {
  const batch = { id: "batch-manual", supplierId: "supplier-old", supplierName: "手工供应商", purchaseQty: 12, receivedQty: 9, qualifiedQty: 8, orderDate: "2026-09-06", expectedArrivalDate: "2026-09-09", actualArrivalDate: "2026-09-08" };
  const view = fixture("StockPlanBatchDialog", { plan, batch });
  view.render();
  view.change("关联 ERP 采购订单行", "mirror-new");
  assert.ok(!nodes(view.tree).some((node) => node.type === "Label" && text(node).includes("本批采购量")));
  view.change("关联 ERP 采购订单行", "");
  view.change("关联供应商档案", "");
  for (const label of ["下单日期", "预计到货日期", "实际到货日期"]) view.change(label, "");
  await view.form().props.onSubmit({ preventDefault() {} });
  const input = view.calls[0].args[2];
  assert.equal("purchaseOrderMirrorId" in input, false);
  assert.deepEqual([input.supplierId, input.supplierName, input.purchaseQty, input.receivedQty, input.qualifiedQty], ["", "手工供应商", 12, 9, 8]);
  assert.deepEqual([input.orderDate, input.expectedArrivalDate, input.actualArrivalDate], ["", "", ""]);
});

// Execute the real local wrappers and DateInput handlers. UI portals/layout are inert;
// state changes, empty-value mapping and calendar callbacks are the product's code.
function controlFixture(component, initial) {
  const states = [], changes = [];
  let cursor = 0, tree;
  let props = { ...initial, onValueChange: change, onChange: change };
  function change(value) { changes.push(value); props = { ...props, value }; }
  const jsx = (type, values) => typeof type === "function" ? type(values) : { type, props: values };
  const react = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useMemo: (callback) => callback(),
  };
  const translate = (value, parameters = {}) => value.replace(/\{(\w+)\}/g, (match, key) => parameters[key] ?? match);
  const cn = (...parts) => parts.filter(Boolean).join(" ");
  const bindings = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../../components/ui/utils": { cn },
    "../../lib/i18n": { useI18n: () => ({ t: translate }) },
  };
  const requireMock = (name) => {
    if (name in bindings) return bindings[name];
    assert.ok(name === "lucide-react" || name.startsWith("../../components/ui/"), `Unexpected controls dependency ${name}`);
    return new Proxy({}, { get: (_target, key) => key });
  };
  const compile = (input) => ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const commonSource = readFileSync(new URL("../src/app/procurement/components/common.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("common.tsx", commonSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dateBindings = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && ["DateInput", "fmtDay"].includes(node.name?.text));
  assert.equal(dateBindings.length, 2);
  const globals = { ...react, cn, translate, i18nLocale: () => "zh-CN", ...Object.fromEntries(["Button", "Calendar", "CalendarDays", "Popover", "PopoverTrigger", "PopoverContent"].map((name) => [name, name])) };
  const commonExports = {};
  new Function("exports", "require", ...Object.keys(globals), compile(dateBindings.map((node) => node.getText(ast)).join("\n")))(commonExports, requireMock, ...Object.values(globals));
  bindings["./common"] = commonExports;
  const exports = {};
  const controlsSource = readFileSync(new URL("../src/app/procurement/components/StockPlanControls.tsx", import.meta.url), "utf8");
  new Function("exports", "require", compile(controlsSource))(exports, requireMock);
  return {
    changes,
    get tree() { return tree; },
    render(next = {}) { props = { ...props, ...next }; cursor = 0; tree = exports[component](props); return tree; },
    one(type, predicate = () => true) {
      const found = nodes(tree).find((node) => node.type === type && predicate(node));
      assert.ok(found, `${type} exists`);
      return found;
    },
  };
}

test("项目 Select 的空选项只在 UI 层编码，必选字段仍保留空值和必填语义", () => {
  const view = controlFixture("StockPlanSelect", { id: "product", label: "所属产品", value: "", emptyLabel: "请选择产品", options: [{ value: "product-q5", label: "Q5" }] });
  view.render();
  const emptyOption = view.one("SelectItem", (node) => text(node) === "请选择产品");
  assert.notEqual(emptyOption.props.value, "", "Radix 选项不能使用空字符串");
  assert.equal(view.one("SelectTrigger").props.id, "product");
  assert.equal(view.one("SelectTrigger").props["aria-label"], "所属产品");
  view.one("Select").props.onValueChange("product-q5");
  view.render();
  assert.equal(view.one("Select").props.value, "product-q5");
  view.one("Select").props.onValueChange(emptyOption.props.value);
  assert.deepEqual(view.changes, ["product-q5", ""]);
  view.render({ required: true, disabled: true, value: "" });
  assert.deepEqual([view.one("Select").props.value, view.one("Select").props.required, view.one("Select").props.disabled], ["", true, true]);
  assert.ok(nodes(view.tree).filter((node) => node.type === "SelectItem").every((node) => node.props.value !== emptyOption.props.value));
});

test("可搜索选择器按编码和规格区分同名档案，重新打开清空搜索且支持取消关联", () => {
  const view = controlFixture("StockPlanSelect", { label: "关联物料", value: "", emptyLabel: "未关联", searchable: true, options: [
    { value: "cap-1", label: "A01 · 电容 · 10nF" }, { value: "cap-2", label: "A02 · 电容 · 100nF" },
  ] });
  view.render();
  view.one("Popover").props.onOpenChange(true);
  view.render();
  view.one("CommandInput").props.onValueChange(" a02 ");
  view.render();
  assert.deepEqual(nodes(view.tree).filter((node) => node.type === "CommandItem").map((node) => node.props.value), ["cap-2"]);
  view.one("CommandItem").props.onSelect();
  view.render();
  assert.equal(view.one("Popover").props.open, false);
  assert.ok(text(view.one("Button")).includes("A02 · 电容 · 100nF"));
  view.one("Popover").props.onOpenChange(true);
  view.render();
  assert.equal(view.one("CommandInput").props.value, "");
  view.one("CommandItem", (node) => text(node) === "未关联").props.onSelect();
  assert.deepEqual(view.changes, ["cap-2", ""]);
  view.render({ disabled: true });
  assert.equal(view.one("Button").props.disabled, true);
  assert.equal(view.one("Popover").props.open, false);
});

test("日期包装使用实际日历回写本地 YYYY-MM-DD，清除后为空串并透传字段锁定", () => {
  const view = controlFixture("StockPlanDateInput", { id: "arrival-date", label: "实际到货日期", value: "2026-09-08" });
  view.render();
  assert.equal(view.one("Button").props.id, "arrival-date");
  assert.equal(view.one("Button").props["aria-label"], "实际到货日期");
  view.one("Popover").props.onOpenChange(true);
  view.render();
  view.one("Calendar").props.onSelect(new Date(2026, 8, 30));
  view.render();
  assert.equal(view.one("Popover").props.open, false);
  assert.equal(view.changes[0], "2026-09-30");
  view.one("Button", (node) => text(node) === "清除").props.onClick();
  assert.deepEqual(view.changes, ["2026-09-30", ""]);
  view.render({ disabled: true });
  assert.equal(view.one("Button").props.disabled, true);
  assert.equal(view.one("Popover").props.open, false);
});

test("月份选择保留全部月份空值，跨年选择只回写 YYYY-MM，重新打开跟随当前月份", () => {
  const view = controlFixture("StockPlanMonthInput", { id: "target-month", label: "目标月份", value: "" });
  view.render();
  assert.ok(text(view.one("Button", (node) => node.props.id === "target-month")).includes("全部月份"));
  assert.deepEqual(view.changes, [], "初始渲染不能自动筛成当前月份");
  view.render({ value: "2026-12" });
  view.one("Popover").props.onOpenChange(true);
  view.render();
  view.one("Button", (node) => node.props["aria-label"] === "下一年").props.onClick();
  view.render();
  view.one("Button", (node) => node.props["aria-label"] === "2027-01").props.onClick();
  view.render();
  assert.deepEqual(view.changes, ["2027-01"]);
  assert.equal(view.one("Popover").props.open, false);
  view.render({ value: "2025-06" });
  view.one("Popover").props.onOpenChange(true);
  view.render();
  assert.equal(view.one("Button", (node) => node.props["aria-label"] === "2025-06").props["aria-pressed"], true);
  view.one("Button", (node) => text(node) === "全部月份").props.onClick();
  assert.deepEqual(view.changes, ["2027-01", ""]);
  view.render({ value: "0001-01" });
  view.one("Popover").props.onOpenChange(true);
  view.render();
  assert.equal(view.one("Button", (node) => node.props["aria-label"] === "上一年").props.disabled, true);
});
