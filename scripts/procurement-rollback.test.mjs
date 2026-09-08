import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

function namedDeclarations(path, names) {
  const text = source(path);
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements.filter((node) => names.includes(node.name?.text)
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(file)))))
    .map((node) => node.getText(file)).join("\n");
}

const helperSource = namedDeclarations("src/app/procurement/components/common.tsx", [
  "PROC_STATUS_META", "INQUIRY_FLOW", "DIRECT_FLOW", "FREE_SAMPLE_ONLY_STATUSES", "QUOTE_RESETTABLE_STATUSES",
  "ROLLBACK_MAIN_FLOW", "ROLLBACK_DIRECT_FLOW", "rollbackTargetsOf", "rollbackCleanupHintOf",
]);
const helpers = {};
new Function("exports", transpile(helperSource))(helpers);

test("进行中的询价和直购任务可退回任意更早阶段，已完成禁止回退", () => {
  const flows = {
    inquiry: ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "in_transit", "partial_arrival"],
    direct: ["pending_confirm", "pending_purchase", "in_transit", "partial_arrival"],
  };
  for (const [method, flow] of Object.entries(flows)) {
    flow.forEach((status, index) => {
      assert.deepEqual(helpers.rollbackTargetsOf(status, method), flow.slice(0, index));
      assert.deepEqual(helpers.rollbackTargetsOf(status, method, { source: "rd", rdTaskId: "RD-001" }), ["pending_rd_review", ...flow.slice(0, index)]);
    });
  }
  assert.deepEqual(helpers.rollbackTargetsOf("pending_sample", "inquiry"), ["pending_confirm", "pending_inquiry", "inquiring"]);
  for (const method of ["direct", "inquiry"]) {
    for (const status of ["pending_rd_review", "pending_confirm", "completed", "cancelled", "unknown"]) {
      assert.deepEqual(helpers.rollbackTargetsOf(status, method), []);
    }
  }
});

test("前端可选阶段和清理提示与服务端实际规则一致", () => {
  const backend = {};
  const declarations = namedDeclarations("apps/api/src/modules/procurement/procurement.types.ts", [
    "PROC_ROLLBACK_MAIN_FLOW", "PROC_ROLLBACK_DIRECT_FLOW", "PROC_ROLLBACK_BLOCKED_STATUSES", "rollbackTargetsOf", "rollbackCleanupFor",
  ]);
  new Function("exports", transpile(declarations))(backend);
  for (const status of Object.keys(helpers.PROC_STATUS_META)) {
    for (const method of ["inquiry", "direct", null]) {
      for (const context of [undefined, { source: "rd", rdTaskId: "RD-001" }, { source: "rd", rdTaskId: "  " }, { source: "rd" }, { source: "self", rdTaskId: "RD-001" }]) {
        assert.deepEqual(helpers.rollbackTargetsOf(status, method, context), backend.rollbackTargetsOf(status, method, context), `${method}/${status}/${JSON.stringify(context)} 可选节点应一致`);
      }
    }
    const hints = helpers.rollbackCleanupHintOf(status).join("；");
    const cleanup = backend.rollbackCleanupFor(status);
    assert.equal(hints.includes("报价"), cleanup.quotations, `${status} 报价清理提示应一致`);
    assert.equal(hints.includes("采购单关联"), cleanup.purchaseOrders, `${status} 采购单清理提示应一致`);
    assert.equal(hints.includes("到货"), cleanup.arrivals, `${status} 到货清理提示应一致`);
  }
});

test("回退客户端保留原状态、规范原因且转义任务路径", async () => {
  const calls = [];
  const api = {};
  const text = namedDeclarations("src/app/lib/procurementApi.ts", ["rollbackProcTask"]);
  new Function("exports", "request", transpile(text))(api, async (path, options) => { calls.push({ path, ...options }); return { id: "task/a", status: "priced" }; });
  const result = await api.rollbackProcTask("task/a", "priced", "  录入错误  ", "partial_arrival");
  assert.equal(result.status, "priced");
  assert.deepEqual(calls, [{ path: "/tasks/task%2Fa/rollback", method: "POST", body: JSON.stringify({ status: "priced", reason: "录入错误", from_status: "partial_arrival" }) }]);
});

// 运行真实详情组件的事件处理与 hooks 状态；可视布局、Radix 焦点/键盘交互另由浏览器验收。
function drawerHarness({ allowed = true, status = "partial_arrival", method = "inquiry", source: taskSource = "self", rdTaskId, rollback, reload } = {}) {
  const text = source("src/app/procurement/components/TaskDetailDrawer.tsx");
  const file = ts.createSourceFile("TaskDetailDrawer.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = file.statements.filter(ts.isImportDeclaration).flatMap((node) => {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return [];
    return [...(clause.name ? [clause.name.text] : []), ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : [])];
  });
  const body = file.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(file)).join("\n");
  let task = {
    id: "task-1", code: "PO-001", status, method, materialName: "测试物料", unit: "件", quantity: 10, arrivedQty: 10,
    attachmentList: [], purchaseOrders: [], criticalMaterials: [], logs: [], businessLine: "rd", source: taskSource, rdTaskId, paymentStatus: "paid",
  };
  const values = [];
  let cursor = 0;
  const calls = [];
  const updates = [];
  const events = [];
  const notifications = [];
  const effects = [];
  const focusEvents = [];
  const attachedRefs = new Set();
  const stubs = Object.fromEntries(imports.map((name) => [name, name]));
  Object.assign(stubs, helpers, {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    },
    useEffect(effect) { effects.push(effect); },
    useI18n: () => ({ t: (value, replacements = {}) => value.replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? key) }),
    useProcCan: () => (permission) => allowed && permission === "proc-task:rollback",
    useProcurementData: () => ({ materials: [] }),
    useBuyerDirectory: () => ({ deptOf: () => "采购部" }),
    useProcTaskAction: () => ({ busy: false }),
    nextPermissionOf: () => "proc-task:transition",
    taskRequester: () => ({ name: "申请人", dept: "研发部" }),
    cn: (...items) => items.filter(Boolean).join(" "),
    fmtMoney: (value) => String(value ?? ""),
    applyProcTaskUpdate: (updated) => { updates.push(updated); task = { ...task, ...updated }; },
    refreshProcurement: async () => { events.push("refresh"); },
    toast: { success(message) { notifications.push(message); }, error() {} },
    rollbackProcTask: async (...args) => { calls.push(args); return rollback ? rollback(...args) : { ...task, status: args[1] }; },
    getProcTask: async (id) => reload ? { ...task, ...await reload(id) } : task,
    listQuotations: async () => [],
  });
  const exports = {};
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  new Function("exports", "stubs", "React", `const { ${imports.join(",")} } = stubs;\n${transpile(body)}`)(exports, stubs, React);
  const render = () => { cursor = 0; effects.length = 0; return exports.TaskDetailDrawer({ task, onClose() { events.push("close"); } }); };
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const content = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(content).join("") : typeof node === "object" ? content(node.props?.children) : String(node);
  const find = (predicate) => nodes(render()).find(predicate);
  const button = (label) => find((node) => ["Button", "button", "AlertDialogAction"].includes(node.type) && content(node) === label);
  const click = (label) => { const item = button(label); assert.ok(item, `缺少按钮：${label}`); return item.props.onClick({ preventDefault() {} }); };
  const reason = (value) => find((node) => node.props?.id === "proc-task-rollback-reason").props.onChange({ target: { value } });
  const alert = () => content(find((node) => node.props?.role === "alert"));
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); };
  const detachRefs = () => {
    for (const ref of attachedRefs) { if (ref.current) ref.current.isConnected = false; ref.current = null; }
    attachedRefs.clear();
  };
  const commitEffects = ({ connected = true } = {}) => {
    const tree = render();
    detachRefs();
    const attach = (node, disabled = false) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((item) => attach(item, disabled)); return; }
      const isDisabled = disabled || Boolean(node.props?.disabled);
      const ref = node.props?.ref;
      if (ref && typeof ref === "object") {
        ref.current = { isConnected: connected, matches: () => isDisabled, focus: () => focusEvents.push(content(node)) };
        attachedRefs.add(ref);
      }
      attach(node.props?.children, isDisabled);
    };
    attach(tree);
    for (const effect of effects) effect();
  };
  return { render, button, click, reason, alert, find, calls, updates, events, notifications, text: () => content(render()), settle, commitEffects, detachRefs, focusEvents, changeTask: (patch) => { task = { ...task, ...patch }; } };
}

test("进行中任务按独立权限展示回退，原因边界通过后只提交一次", async () => {
  const noPermission = drawerHarness({ allowed: false });
  assert.equal(noPermission.button("回退"), undefined);
  assert.equal(drawerHarness({ status: "pending_confirm" }).button("回退"), undefined);
  let finish;
  const ui = drawerHarness({ rollback: () => new Promise((resolve) => { finish = resolve; }) });
  ui.click("回退");
  ui.click("待询价");
  for (const invalid of [" ", "字", "字".repeat(201)]) {
    ui.reason(invalid);
    assert.equal(ui.button("确认回退").props.disabled, true);
  }
  ui.reason(` ${"字".repeat(200)} `);
  assert.equal(ui.button("确认回退").props.disabled, false);
  ui.click("确认回退");
  ui.click("处理中…");
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(ui.calls[0], ["task-1", "pending_inquiry", "字".repeat(200), "partial_arrival"]);
  finish({ id: "task-1", status: "pending_inquiry" });
  await ui.settle();
  assert.equal(ui.updates.length, 1);
  assert.deepEqual(ui.events, ["refresh"], "普通采购阶段回退保留详情抽屉");
  assert.equal(ui.find((node) => node.type === "AlertDialog" && node.props.open === true), undefined);
});

test("回退失败在弹框显示，刷新读取后必须重新选择，不自动重放写请求", async () => {
  const ui = drawerHarness({ rollback: async () => { throw new Error("任务状态已改变"); }, reload: async () => ({ id: "task-1", code: "PO-001", status: "priced", method: "inquiry" }) });
  ui.click("回退");
  ui.click("待询价");
  ui.reason("节点选择有误");
  ui.click("确认回退");
  await ui.settle();
  assert.match(ui.alert(), /任务状态已改变/);
  assert.equal(ui.button("确认回退").props.disabled, true);
  ui.click("刷新任务后重新选择");
  await ui.settle();
  assert.equal(ui.calls.length, 1, "刷新不得重放回退");
  assert.equal(ui.alert(), "");
  assert.equal(ui.button("确认回退").props.disabled, true, "刷新后不能保留旧目标或原因");
  ui.click("待询价");
  ui.reason("重新核对后回退");
  ui.click("确认回退");
  await ui.settle();
  assert.equal(ui.calls[1][3], "priced", "重新确认后才采用刷新得到的状态");
});

test("编辑回退时任务状态或身份变化，不把旧选择提交给新状态或另一任务", async () => {
  for (const patch of [{ status: "priced" }, { status: "completed" }, { id: "task-2", code: "PO-002" }, { method: "direct" }]) {
    const ui = drawerHarness();
    ui.click("回退");
    ui.click("待询价");
    ui.reason("选择错误回退");
    ui.changeTask(patch);
    assert.equal(ui.button("确认回退").props.disabled, true);
    // 即使触发旧事件处理器，也必须在提交前重新核对当前任务。
    ui.click("确认回退");
    await ui.settle();
    assert.equal(ui.calls.length, 0);
    assert.match(ui.alert(), /任务已更新|当前任务已切换/);
    if (patch.id) assert.equal(ui.button("刷新任务后重新选择"), undefined);
  }
});

test("冲突后刷新移除重试按钮，提交新节点后焦点转到弹框内首个目标", async () => {
  const ui = drawerHarness({ rollback: async () => { throw new Error("状态冲突"); }, reload: async () => ({ id: "task-1", code: "PO-001", status: "priced", method: "inquiry" }) });
  ui.click("回退");
  ui.click("待询价");
  ui.reason("重新核对节点");
  ui.click("确认回退");
  await ui.settle();
  ui.commitEffects();
  assert.deepEqual(ui.focusEvents, [], "错误期间保留当前焦点");
  ui.click("刷新任务后重新选择");
  await ui.settle();
  assert.deepEqual(ui.focusEvents, [], "新DOM提交前不能聚焦旧元素");
  ui.commitEffects();
  assert.equal(ui.button("刷新任务后重新选择"), undefined);
  assert.deepEqual(ui.focusEvents, ["待处理"]);
  ui.commitEffects();
  assert.deepEqual(ui.focusEvents, ["待处理"], "只能转移一次，不干扰后续键盘选择");
});

test("刷新后无可选目标时聚焦标题，过期任务和已移除DOM不会接收焦点", async () => {
  for (const scenario of ["no-targets", "stale-status", "different-task", "detached"]) {
    const refreshedStatus = scenario === "no-targets" ? "pending_confirm" : "priced";
    const ui = drawerHarness({ rollback: async () => { throw new Error("状态冲突"); }, reload: async () => ({ id: "task-1", code: "PO-001", status: refreshedStatus, method: "inquiry" }) });
    ui.click("回退");
    ui.click("待询价");
    ui.reason("重新核对节点");
    ui.click("确认回退");
    await ui.settle();
    ui.click("刷新任务后重新选择");
    await ui.settle();
    if (scenario === "stale-status") ui.changeTask({ status: "testing" });
    if (scenario === "different-task") ui.changeTask({ id: "task-2" });
    ui.commitEffects({ connected: scenario !== "detached" });
    assert.deepEqual(ui.focusEvents, scenario === "no-targets" ? ["回退任务到更早的节点"] : [], scenario);
  }
});

test("小屏任务标题独占首行，操作栏换行且桌面保留原布局", () => {
  const ui = drawerHarness();
  const titleRow = ui.find((node) => node.type === "div" && node.props.children.some((child) => child?.type === "SheetTitle"));
  assert.match(titleRow.props.className, /\bw-full\b/);
  assert.match(titleRow.props.className, /\bsm:w-auto\b/);
  assert.match(titleRow.props.className, /\bsm:flex-1\b/);
  assert.doesNotMatch(titleRow.props.className, /(?:^|\s)flex-1(?:\s|$)/);
});

test("截图中的研发流转待处理任务可退回研发审核，并说明退出采购和重新分配", async () => {
  const ui = drawerHarness({ status: "pending_confirm", source: "rd", rdTaskId: "RD-001" });
  assert.ok(ui.button("回退"));
  ui.click("回退");
  ui.click("待研发审核");
  assert.match(ui.text(), /当前采购负责人分配/);
  assert.match(ui.text(), /任务将离开采购列表并退回研发重审；审核通过后会自动重新分配采购负责人/);
  ui.reason("研发需求需要重新审核");
  assert.equal(ui.button("确认回退").props.disabled, false);
  ui.click("确认回退");
  await ui.settle();
  assert.deepEqual(ui.calls, [["task-1", "pending_rd_review", "研发需求需要重新审核", "pending_confirm"]]);
  assert.deepEqual(ui.events, ["refresh", "close"], "进入研发待审后刷新列表并关闭已离开采购侧的任务");
  assert.match(ui.notifications[0], /已退回研发重审.*重新分配采购负责人/);
});

test("未关联和采购自建任务不开放研发回退，两条流程仅对真实研发关联加入前置节点", () => {
  for (const method of ["inquiry", "direct"]) {
    for (const context of [{ source: "rd", rdTaskId: "RD-001" }, { source: "rd", rdTaskId: " RD-001 " }]) {
      assert.deepEqual(helpers.rollbackTargetsOf("pending_confirm", method, context), ["pending_rd_review"]);
      assert.equal(helpers.rollbackTargetsOf("partial_arrival", method, context)[0], "pending_rd_review");
      assert.deepEqual(helpers.rollbackTargetsOf("pending_rd_review", method, context), []);
      assert.deepEqual(helpers.rollbackTargetsOf("cancelled", method, context), []);
    }
    for (const context of [{ source: "rd" }, { source: "rd", rdTaskId: " " }, { source: "self", rdTaskId: "RD-001" }, { source: "self" }]) {
      assert.deepEqual(helpers.rollbackTargetsOf("pending_confirm", method, context), []);
      assert.equal(helpers.rollbackTargetsOf("partial_arrival", method, context).includes("pending_rd_review"), false);
      assert.equal(drawerHarness({ status: "pending_confirm", method, ...context }).button("回退"), undefined);
    }
  }
});

test("已完成任务不显示回退，刷新发现任务已完成后不可继续旧回退", async () => {
  for (const method of ["inquiry", "direct"]) {
    for (const context of [{ source: "self" }, { source: "rd", rdTaskId: "RD-001" }]) {
      assert.deepEqual(helpers.rollbackTargetsOf("completed", method, context), []);
      assert.equal(drawerHarness({ status: "completed", method, ...context }).button("回退"), undefined);
    }
  }
  const ui = drawerHarness({ rollback: async () => { throw new Error("任务已完成"); }, reload: async () => ({ id: "task-1", code: "PO-001", status: "completed", method: "inquiry", source: "self" }) });
  ui.click("回退");
  ui.click("待询价");
  ui.reason("核对任务状态");
  ui.click("确认回退");
  await ui.settle();
  ui.click("刷新任务后重新选择");
  await ui.settle();
  assert.equal(ui.button("回退"), undefined);
  assert.equal(ui.button("待询价"), undefined);
  assert.equal(ui.button("确认回退").props.disabled, true);
  assert.equal(ui.calls.length, 1, "刷新已完成任务不能重放回退请求");
});

test("选中研发重审后来源或研发关联变化，旧确认不能跨关联提交", async () => {
  for (const patch of [{ source: "self" }, { rdTaskId: "RD-002" }, { rdTaskId: undefined }]) {
    const ui = drawerHarness({ status: "pending_confirm", source: "rd", rdTaskId: "RD-001" });
    ui.click("回退");
    ui.click("待研发审核");
    ui.reason("研发需求需要重新审核");
    ui.changeTask(patch);
    assert.equal(ui.button("确认回退").props.disabled, true);
    ui.click("确认回退");
    await ui.settle();
    assert.deepEqual(ui.calls, []);
    assert.match(ui.alert(), /任务已更新/);
  }
});
