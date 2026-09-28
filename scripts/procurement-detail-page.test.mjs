import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" };
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
function load(path, dependencies) {
  const exports = {};
  new Function("exports", "require", transpile(source(path)))(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return exports;
}

function pageFixture() {
  const calls = { refresh: 0, close: 0, navigate: [] };
  const { ProcurementTaskDetailPage } = load("src/app/procurement/components/ProcurementTaskDetailPage.tsx", {
    "react/jsx-runtime": runtime,
    "lucide-react": { ArrowLeft: "ArrowLeft", ClipboardList: "ClipboardList", RefreshCw: "RefreshCw" },
    "../../components/ui/button": { Button: "Button" },
    "../../components/horizon/HorizonPage": { HorizonEmptyState: "HorizonEmptyState" },
    "../../lib/i18n": { useI18n: () => ({ t }) },
    "../data": { refreshProcurement: async () => { calls.refresh++; } },
    "./TaskDetailDrawer": { TaskDetailDrawer: "TaskDetailDrawer" },
  });
  const props = { loading: false, error: null, onClose: () => { calls.close++; }, onNavigateRelated: (path) => calls.navigate.push(path) };
  return { calls, props, render: (patch) => ProcurementTaskDetailPage({ ...props, ...patch }) };
}

test("完整详情加载中不挂载可操作快照，包括已有任务和已有错误的刷新", () => {
  const view = pageFixture();
  for (const task of [undefined, { id: "cached-task" }]) {
    for (const error of [null, "上次刷新失败"]) {
      const tree = view.render({ task, loading: true, error });
      assert.equal(nodes(tree).find((node) => node.type === "TaskDetailDrawer"), undefined);
      assert.equal(text(nodes(tree).find((node) => node.props?.role === "status")), "正在加载采购任务…");
      assert.equal(nodes(tree).find((node) => node.type === "HorizonEmptyState"), undefined);
      const back = nodes(tree).find((node) => node.type === "Button");
      assert.equal(text(back), "返回任务列表");
      back.props.onClick();
    }
  }
  assert.equal(view.calls.close, 4);
});

test("缺失或不可访问任务显示明确空态，失败不展示缓存详情，并可重新加载", () => {
  const view = pageFixture();
  for (const task of [null, undefined]) {
    const tree = view.render({ task });
    const empty = nodes(tree).find((node) => node.type === "HorizonEmptyState");
    assert.equal(empty.props.title, "此采购任务暂不可用");
    assert.match(empty.props.description, /删除、转派或不在当前账号的访问范围/);
    assert.equal(nodes(tree).find((node) => node.type === "TaskDetailDrawer"), undefined);
    assert.equal(text(empty.props.action), "重新加载");
    empty.props.action.props.onClick();
  }
  const failed = view.render({ task: { id: "cached-task" }, error: "连接失败，请重试" });
  const empty = nodes(failed).find((node) => node.type === "HorizonEmptyState");
  assert.equal(empty.props.title, "采购任务加载失败");
  assert.equal(empty.props.description, "连接失败，请重试");
  assert.equal(nodes(failed).find((node) => node.type === "TaskDetailDrawer"), undefined);
  empty.props.action.props.onClick();
  assert.equal(view.calls.refresh, 3);
});

test("已加载的完整详情复用业务组件并以任务标识重置状态，保留关闭和关联导航", () => {
  const view = pageFixture();
  const task = { id: "owned-task" };
  const tree = view.render({ task });
  assert.equal(tree.type, "TaskDetailDrawer");
  assert.equal(tree.key, task.id);
  assert.equal(tree.props.presentation, "page");
  assert.equal(tree.props.task, task);
  assert.equal(tree.props.onClose, view.props.onClose);
  assert.equal(tree.props.onNavigateRelated, view.props.onNavigateRelated);
});

test("独立详情使用页面容器，快捷详情仍使用系统侧滑层及原关闭焦点回调", () => {
  const { ProcurementDetailFrame } = load("src/app/procurement/components/ProcurementDetailFrame.tsx", {
    "react/jsx-runtime": runtime, "lucide-react": { ArrowLeft: "ArrowLeft" },
    "../../components/ui/button": { Button: "Button" },
    "../../components/ui/sheet": { Sheet: "Sheet", SheetContent: "SheetContent" },
    "../../lib/i18n": { useI18n: () => ({ t }) }, "../procurementDetail.css": {},
  });
  let closed = 0;
  const onCloseAutoFocus = () => {};
  const props = { onClose: () => { closed++; }, onCloseAutoFocus, children: jsx("p", { children: "业务内容" }) };
  const page = ProcurementDetailFrame({ ...props, page: true });
  assert.equal(page.type, "main");
  assert.equal(nodes(page).find((node) => node.type === "Sheet"), undefined);
  assert.match(text(page), /采购任务详情.*业务内容/);
  nodes(page).find((node) => node.type === "Button").props.onClick();
  const drawer = ProcurementDetailFrame({ ...props, page: false });
  assert.equal(drawer.type, "Sheet");
  assert.equal(drawer.props.open, true);
  assert.equal(nodes(drawer).find((node) => node.type === "SheetContent").props.onCloseAutoFocus, onCloseAutoFocus);
  drawer.props.onOpenChange(true); assert.equal(closed, 1);
  drawer.props.onOpenChange(false); assert.equal(closed, 2);
});

function declarations(path, names) {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements.filter((node) => names.includes(node.name?.text)
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(file)))))
    .map((node) => node.getText(file)).join("\n");
}

// Execute the real drawer's state/effects and tab callbacks. Primitive boundaries are left
// intact; Radix keyboard event dispatch and rendered layout are covered by browser QA.
function detailHarness(presentation = "page", { allowed = false, permissions = [], busy = false, readOnly = false, onNavigateRelated, taskPatch = {}, quotations = [] } = {}) {
  const path = "src/app/procurement/components/TaskDetailDrawer.tsx";
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = file.statements.filter(ts.isImportDeclaration).flatMap((node) => {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return [];
    return [...(clause.name ? [clause.name.text] : []), ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : [])];
  });
  const body = file.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(file)).join("\n");
  const helpers = {};
  for (const code of [
    declarations("src/app/procurement/components/common.tsx", ["PROC_STATUS_META", "INQUIRY_FLOW", "DIRECT_FLOW", "procurementStepsOf", "FREE_SAMPLE_ONLY_STATUSES", "QUOTE_RESETTABLE_STATUSES", "ROLLBACK_MAIN_FLOW", "ROLLBACK_DIRECT_FLOW", "rollbackTargetsOf", "rollbackCleanupHintOf"]),
    source("src/app/lib/procSampleFacts.ts"),
    declarations("src/app/procurement/sampleWorkspaceModel.ts", ["isSampleTask"]),
    declarations("src/app/procurement/components/ProcSampleTestDialog.tsx", ["SAMPLE_TEST_RESULT_LABELS"]),
  ]) new Function("exports", transpile(code))(helpers);
  const task = { id: "task-1", code: "PR-001", status: "partial_arrival", method: "inquiry", materialName: "真实任务名称", unit: "件", quantity: 10, arrivedQty: 5, attachmentList: [], purchaseOrders: [], criticalMaterials: [], logs: [{ id: "log-1", actor: "采购甲", at: "2026-09-20 10:00", text: "登记到货 5 件" }], businessLine: "rd", source: "self", paymentStatus: "paid" };
  Object.assign(task, taskPatch);
  const calls = [];
  let cursor = 0; let dirty = false;
  const slots = []; const effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((value, i) => !Object.is(a[i], value));
  const stubs = Object.assign(Object.fromEntries(imports.map((name) => [name, name])), helpers, {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { const value = typeof next === "function" ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++; const before = slots[index];
      if (changed(before?.deps, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = callback(); }); }
    },
    useI18n: () => ({ t }), useNavigate: () => path => calls.push(`navigate:${path}`), useProcurementData: () => ({ materials: [] }),
    useProcCan: () => permission => allowed || permissions.includes(permission), useBuyerDirectory: () => ({ deptOf: () => "采购部" }), useProcTaskAction: () => ({ busy, runNext: value => calls.push(value.id) }),
    taskRequester: () => ({ name: "申请人", dept: "研发部" }), nextPermissionOf: () => "proc-task:transition",
    cn: (...values) => values.filter(Boolean).join(" "), fmtMoney: (value) => String(value ?? ""), listQuotations: async () => quotations,
  });
  const exports = {};
  new Function("exports", "stubs", "require", `const { ${imports.join(",")} } = stubs;\n${transpile(body)}`)(exports, stubs, (name) => { assert.equal(name, "react/jsx-runtime"); return runtime; });
  const render = () => {
    for (let i = 0; i < 15; i++) {
      cursor = 0; dirty = false;
      const tree = exports.TaskDetailDrawer({ task, presentation, readOnly, onNavigateRelated, onClose() { calls.push('close'); } });
      while (effects.length) effects.shift()();
      if (!dirty) return tree;
    }
    assert.fail("detail state did not settle");
  };
  return { render, calls, find: (predicate) => nodes(render()).find(predicate) };
}

test("详情四个栏目分别展示对应区域；通过 Tabs 键盘激活路径进入操作记录会展开日志", () => {
  const view = detailHarness();
  const tabs = () => view.find((node) => node.type === "Tabs");
  assert.deepEqual(nodes(tabs()).filter((node) => node.type === "TabsTrigger").map((node) => node.props.value), ["overview", "quotes", "orders", "history"]);
  const regions = { overview: "需求与资料", quotes: "供应商报价", orders: "采购与到货", history: "操作记录" };
  for (const [value, label] of Object.entries(regions)) {
    tabs().props.onValueChange(value); // Radix roving keyboard selection does not invoke trigger.onClick.
    const tree = view.render();
    const visible = nodes(tree).filter((node) => node.props?.role === "region" && !node.props.hidden);
    assert.deepEqual(visible.map((node) => node.props["aria-label"]), [label]);
    if (value === "history") {
      const logs = nodes(visible[0]).find((node) => node.type === "Collapsible");
      assert.equal(logs.props.open, true);
      assert.match(text(logs), /采购甲2026-09-20 10:00/);
      assert.equal(nodes(logs).find((node) => node.type === "AutoTranslatedText").props.text, "登记到货 5 件");
    }
  }
});

test("快捷详情维持原单页抽屉内容，不意外套用完整详情的栏目隐藏", () => {
  const view = detailHarness("drawer");
  assert.equal(view.find((node) => node.type === "Tabs"), undefined);
  const sections = nodes(view.render()).filter((node) => node.props?.className === "proc-detail-section");
  assert.equal(sections.length, 4);
  assert.ok(sections.every((node) => !node.props.hidden));
  assert.equal(view.find((node) => node.type === "ProcurementDetailFrame").props.page, false);
});

test("嵌入详情保留原完整内容与权限按钮，编辑、归类和下一步直接可用", async () => {
  const options = { allowed: true, taskPatch: {
    purchaseOrders: [{ id: 'po-1', tpOrderNo: 'PO-001', supplierName: '供应商甲', orderedQty: 10, receivedQty: 5 }],
    attachmentList: [{ id: 'drawing-1', fileName: '阀体图纸.pdf' }],
  }, quotations: [{ id: 'quote-1', supplierName: '供应商甲', unitPrice: 28, currency: 'CNY', leadTimeDays: 5, isSelected: true }] };
  const original = detailHarness('drawer', options);
  const reader = detailHarness('embedded', options);
  original.render(); reader.render(); await new Promise(setImmediate);
  const originalTree = original.render(); const tree = reader.render();
  assert.equal(tree.props.embedded, true);
  const labels = view => nodes(view).filter(node => node.type === 'Button').map(text).sort();
  assert.deepEqual(labels(tree), labels(originalTree), '不应减少原详情任何权限按钮');
  const footer = nodes(tree).find(node => node.type === 'footer' && node.props['aria-label'] === '任务操作');
  assert.ok(footer, '任务操作集中在底部');
  for (const label of ['编辑', '回退', '移动归类', '历史价格']) assert.ok(labels(footer).includes(label), label);
  assert.ok(nodes(footer).some(node => node.type === 'Button' && node.props.className?.includes('material-button-primary')));
  assert.equal(nodes(tree).filter(node => node.type === 'Button' && text(node) === '编辑').length, 1);
  assert.equal(nodes(nodes(tree).find(node => node.type === 'SheetHeader')).filter(node => node.type === 'Button').length, 0);
  assert.ok(!nodes(originalTree).some(node => node.type === 'footer'), '其他详情展示方式保持原位');
  for (const [value, label] of Object.entries({ overview: '需求与资料', quotes: '供应商报价', orders: '采购与到货', history: '流程与记录' })) {
    reader.find(node => node.type === 'Tabs').props.onValueChange(value);
    const panels = nodes(reader.render()).filter(node => node.props?.role === 'tabpanel');
    assert.equal(panels.length, 4, '切换栏目保留已挂载内容与表单状态');
    assert.deepEqual(panels.filter(node => !node.props.hidden).map(node => node.props['aria-label']), [label]);
    const trigger = reader.find(node => node.type === 'TabsTrigger' && node.props.value === value);
    const panel = panels.find(node => !node.props.hidden);
    assert.equal(trigger.props['aria-controls'], panel.props.id);
    assert.equal(panel.props['aria-labelledby'], trigger.props.id);
    assert.ok(reader.find(node => node.type === 'footer'), '任何栏目都能使用底部操作');
    if (value === 'history') assert.equal(reader.find(node => node.type === 'Collapsible').props.open, true);
  }
  for (const label of ['基本信息', '下单与付款', '到货记录', '供应商报价（1）', 'PO-001', '阀体图纸.pdf', '操作日志（1）']) assert.ok(text(tree).includes(label), label);
  assert.ok(nodes(tree).find(node => node.type === 'ProcurementDecisionPanel'));
  const button = label => reader.find(node => node.type === 'Button' && text(node) === label);
  button('编辑').props.onClick(); assert.ok(reader.find(node => node.type === 'EditTaskModal'));
  button('移动归类').props.onClick(); assert.ok(reader.find(node => node.type === 'MoveTaskDialog'));
  const next = reader.find(node => node.type === 'Button' && node.props.className?.includes('material-button-primary'));
  next.props.onClick(); assert.deepEqual(reader.calls, ['task-1']);
  const denied = detailHarness('embedded');
  assert.ok(!nodes(denied.render()).some(node => node.type === 'Button' && ['编辑', '移动归类', '回退'].includes(text(node))));
});

test('只读抽屉在完整权限下仍隐藏业务操作，保留资料和四个栏目', async () => {
  for (const status of ['pending_confirm', 'inquiring', 'testing', 'priced', 'in_transit']) {
    const view = detailHarness('embedded', { allowed: true, readOnly: true, taskPatch: {
      status, purchaseOrders: [{ id: 'po', tpOrderNo: 'PO-1', orderedQty: 10, receivedQty: 0 }],
      attachmentList: [{ id: 'attachment', fileName: '图纸.pdf' }],
    }});
    view.render(); await new Promise(setImmediate);
    const tree = view.render();
    assert.equal(nodes(tree).find(node => node.type === 'footer'), undefined);
    const buttons = nodes(tree).filter(node => node.type === 'Button').map(text);
    assert.ok(!buttons.some(label => /编辑|回退|归类|登记|确认报价|重新询价|解除|审核|驳回/.test(label)), `${status}: ${buttons}`);
    assert.equal(nodes(tree).filter(node => node.type === 'TabsTrigger').length, 4);
    assert.ok(text(tree).includes('基本信息'));
    assert.ok(text(tree).includes('图纸.pdf'));
    assert.ok(text(tree).includes('PO-1'));
  }
});

test('关联研发任务按真实编号跳转，支持仅工作台权限及缺失标题', () => {
  for (const permission of ['page:rd-task-management', 'page:rd-my-workspace']) {
    const view = detailHarness('embedded', { permissions: [permission], taskPatch: { rdTaskId: ' RD/编号 1 ', rdTaskTitle: '' } });
    const link = view.find(node => node.props?.label === '关联研发任务').props.value;
    assert.equal(link.type, 'Button');
    assert.equal(link.props.disabled, false);
    link.props.onClick();
    assert.deepEqual(view.calls, ['close', `navigate:/rd-task/${encodeURIComponent('RD/编号 1')}`]);
  }
  const related = [];
  const view = detailHarness('embedded', { allowed: true, taskPatch: { source: 'rd', rdTaskId: 'RD-002', rdTaskTitle: '研发任务标题' }, onNavigateRelated: path => related.push(path) });
  view.find(node => node.props?.label === '关联研发任务').props.value.props.onClick();
  assert.deepEqual(view.calls, ['close']); assert.deepEqual(related, ['/rd-task/RD-002']);
});

test('抽屉流程区区分当前阶段、免样品与前后阶段，直购及终止状态不展示错误流程', () => {
  for (const taskPatch of [
    { status: 'priced', method: 'inquiry', needSample: false },
    { status: 'testing', method: 'inquiry', needSample: true },
    { status: 'pending_purchase', method: 'direct' },
    { status: 'completed', method: 'direct' },
    { status: 'cancelled', method: 'inquiry' },
    { status: 'pending_rd_review', method: 'inquiry' },
  ]) {
    const view = detailHarness('embedded', { taskPatch });
    view.find(node => node.type === 'Tabs').props.onValueChange('history');
    const flow = view.find(node => node.props?.['aria-label'] === '任务流程');
    const stages = nodes(flow).filter(node => node.props?.['data-stage']);
    const current = stages.filter(node => node.props['aria-current'] === 'step');
    if (['cancelled', 'pending_rd_review'].includes(taskPatch.status)) {
      assert.equal(stages.length, 0);
      assert.match(text(flow), taskPatch.status === 'cancelled' ? /流程已结束/ : /等待研发继续转采购/);
    } else {
      assert.equal(current.length, 1);
      assert.equal(current[0].props['data-stage'], taskPatch.status);
      if (taskPatch.method === 'direct') assert.ok(!stages.some(node => node.props['data-stage'] === 'testing'));
      if (taskPatch.needSample === false) assert.equal(stages.filter(node => node.props['data-skipped']).length, 2);
    }
    assert.equal(view.find(node => node.type === 'details')?.props.open, undefined, '完整阶段默认折叠');
  }
});

test('没有研发权限或关联编号时只显示信息，提交中不能跳走', () => {
  for (const options of [
    { taskPatch: { rdTaskId: 'RD-001', rdTaskTitle: '研发任务' } },
    { allowed: true, taskPatch: { rdTaskId: ' ', rdTaskTitle: '历史研发任务' } },
  ]) {
    const view = detailHarness('embedded', options);
    assert.equal(view.find(node => node.props?.label === '关联研发任务').props.value.type, 'span');
    assert.deepEqual(view.calls, []);
  }
  const view = detailHarness('embedded', { allowed: true, busy: true, taskPatch: { rdTaskId: 'RD-001' } });
  const link = view.find(node => node.props?.label === '关联研发任务').props.value;
  assert.equal(link.props.disabled, true); link.props.onClick(); assert.deepEqual(view.calls, []);
});
