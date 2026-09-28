import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/modals.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("modals.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual component body and its event handlers; replace only portal
// rendering, hook scheduling and external requests with deterministic controls.
function fixture(name, external = {}, componentAst = ast) {
  const component = componentAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(component, `missing ${name}`);
  const slots = [];
  const cleanups = new Map();
  const translate = (value) => value;
  let cursor = 0;
  let writes = 0;
  const scope = {
    React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { writes++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(compute, deps) {
      const index = cursor++;
      if (!(index in slots) || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: compute(), deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!(index in slots) || !deps || deps.some((value, i) => !Object.is(value, slots[index].deps?.[i]))) {
        slots[index]?.cleanup?.();
        const cleanup = effect();
        slots[index] = { deps, cleanup };
        cleanups.set(index, cleanup);
      }
    },
    useI18n: () => ({ t: translate }),
    toast: { success() {}, error() {} },
    cn: (...values) => values.filter(Boolean).join(" "),
    downloadImportTemplate() {},
    ...external,
  };
  for (const name of ["Shell", "Button", "Input", "Upload", "Loader2", "CheckCircle2", "AlertTriangle", "FileDown", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter"]) scope[name] = name;
  const code = ts.transpileModule(`${component.getText(componentAst).replace(/^export\s+/, "")}\nreturn ${name};`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const Component = new Function(...Object.keys(scope), code)(...Object.values(scope));
  return {
    render(props = {}) { cursor = 0; return Component(props); },
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
    get writes() { return writes; },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("成员页仅维护名录，系统用户按 ID 添加，移出及备注绑定选中账号", async () => {
  const pageSource = readFileSync(new URL("../src/app/procurement/ProcPeopleManagementPage.tsx", import.meta.url), "utf8");
  const pageAst = ts.createSourceFile("people.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const primitiveNames = pageAst.statements.filter(ts.isImportDeclaration).flatMap(node => node.importClause?.namedBindings?.elements ?? []).filter(node => !node.isTypeOnly && /^[A-Z]/.test(node.name.text)).map(node => node.name.text);
  let members = [{ id: "buyer-a", name: "采购甲", note: "电子料" }, { id: "buyer-b", name: "采购乙" }];
  const users = [...members, { id: "rd-a", name: "张工", department: "研发部" }, { id: "rd-b", name: "张工", department: "研发部" }, { id: "disabled", name: "停用用户", disabled: true }];
  const calls = []; let callback;
  const logic = {};
  new Function("exports", ts.transpileModule(readFileSync(new URL("../src/app/procurement/procurementLogic.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(logic);
  let taskData = { loading: false, error: null, tasks: [
    { buyerUserId: "buyer-a", buyer: "旧姓名", status: "completed" },
    { buyer: "采购甲", status: "ordered" },
    { buyerUserId: "outside", buyer: "采购甲", status: "ordered" },
    { status: "pending" },
  ] };
  let taskRetries = 0;
  const state = fixture("ProcPeopleManagementContent", {
    ...Object.fromEntries(primitiveNames.map(name => [name, name])),
    ...logic, useProcurementData: () => taskData, refreshProcurement: async () => { taskRetries++; },
    useCallback: fn => callback ??= fn, useNavigate: () => () => {}, usePermission: () => true,
    useConfirmDialog: () => ({ confirm: request => calls.push(request), confirmDialog: null }),
    getBuyerRoster: async () => ({ members }),
    listBuyerCandidates: async (signal, scope) => { assert.ok(signal instanceof AbortSignal); assert.equal(scope, "all"); return users; },
    updateBuyerRosterMember: async (...args) => { calls.push(args); return { members }; },
    addBuyerRosterMember: async id => { calls.push(id); members = [...members, users.find(user => user.id === id)]; return { members }; },
    removeBuyerRosterMember: async id => { calls.push(id); members = members.filter(member => member.id !== id); return { members }; },
  }, pageAst);
  const render = () => state.render();
  const button = label => find(render(), node => node.type === "Button" && text(node) === label);
  const select = id => find(render(), node => node.type === "Checkbox" && node.props["aria-label"].endsWith(id)).props.onCheckedChange(true);
  render(); await settle();
  assert.ok(find(render(), node => node.type === "Table"));
  const count = id => text(find(find(render(), node => node.type === "TableRow" && find(node, child => child.type === "Checkbox" && child.props["aria-label"].endsWith(id))), node => node.type === "TableCell" && node.props["aria-label"] === "任务数量"));
  assert.equal(count("buyer-a"), "2", "包含已完成与历史姓名任务，稳定 ID 优先于姓名");
  assert.equal(count("buyer-b"), "0", "没有任务显示零");
  taskData = { ...taskData, tasks: [...taskData.tasks, { buyerUserId: "buyer-b", status: "pending" }] };
  assert.equal(count("buyer-b"), "1", "任务更新同步重算");
  taskData = { ...taskData, loading: true };
  assert.equal(count("buyer-a"), "—", "加载中不能误报零");
  taskData = { ...taskData, loading: false, error: "加载失败" };
  assert.equal(count("buyer-a"), "—", "失败不能显示陈旧数量");
  assert.equal(button("添加成员").props.disabled, false, "任务统计失败不影响成员管理");
  button("重新加载任务数量").props.onClick(); await settle(); assert.equal(taskRetries, 1);
  taskData = { ...taskData, error: null };
  assert.equal(button("成员名录"), undefined);
  assert.equal(button("编辑岗位备注").props.disabled, true);
  for (const label of ["查看全部任务", "任务交接", "智能分派未分配任务"]) assert.equal(button(label), undefined);
  select("buyer-a");
  assert.equal(button("编辑岗位备注").props.disabled, false);
  assert.equal(button("移出成员").props.disabled, false);
  button("编辑岗位备注").props.onClick();
  find(render(), node => node.type === "Input" && node.props["aria-label"] === "岗位备注").props.onChange({ target: { value: "包材" } });
  button("保存岗位备注").props.onClick(); await settle();
  assert.deepEqual(calls.shift(), ["buyer-a", "包材"]);
  button("添加成员").props.onClick(); render(); await settle();
  assert.equal(find(render(), node => node.type === "SelectItem" && node.props.value === "buyer-a"), undefined);
  assert.equal(find(render(), node => node.type === "SelectItem" && node.props.value === "disabled").props.disabled, true);
  assert.match(text(find(render(), node => node.type === "SelectItem" && node.props.value === "rd-b")), /研发部.*rd-b/);
  for (const invalid of ["buyer-a", "disabled", "missing"]) {
    find(render(), node => node.type === "Select").props.onValueChange(invalid);
    button("确认添加").props.onClick(); await settle(); assert.equal(calls.length, 0);
  }
  find(render(), node => node.type === "Select").props.onValueChange("rd-b");
  button("确认添加").props.onClick(); await settle(); assert.equal(calls.shift(), "rd-b");
  select("rd-b"); button("移出成员").props.onClick();
  await calls.shift().onConfirm(); assert.equal(calls.shift(), "rd-b");
  assert.equal(find(render(), node => node.type === "Checkbox" && node.props["aria-label"].endsWith("rd-b")), undefined);
  select("buyer-a");
  find(render(), node => node.type === "Input" && node.props["aria-label"] === "搜索成员").props.onChange({ target: { value: "采购乙" } });
  assert.equal(count("buyer-b"), "1", "搜索成员不改变任务数量");
  assert.equal(button("编辑岗位备注").props.disabled, true);
  assert.equal(button("移出成员").props.disabled, true);
  state.unmount();
});

test("单条及批量转派使用部门 Select，按 ID 区分同名成员并拒绝无效接收人", async () => {
  const actionSource = readFileSync(new URL("../src/app/procurement/components/taskActions.tsx", import.meta.url), "utf8");
  const actionAst = ts.createSourceFile("taskActions.tsx", actionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const logic = {};
  new Function("exports", ts.transpileModule(readFileSync(new URL("../src/app/procurement/procurementLogic.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(logic);
  const members = [{ id: "member-a", name: "张工" }, { id: "member-b", name: "张工" }, { id: "no-permission", name: "李工", canReceiveTasks: false }];
  const task = { id: "task-1", code: "PR-001", materialName: "阀体", status: "priced", quantity: 10, arrivedQty: 0, buyer: "历史负责人", buyerUserId: "outside" };
  for (const batch of [false, true]) {
    let directory = members;
    const calls = [];
    const componentAst = batch ? ast : actionAst;
    const primitives = Object.fromEntries(componentAst.statements.filter(ts.isImportDeclaration).flatMap(node => node.importClause?.namedBindings?.elements ?? []).filter(node => !node.isTypeOnly && /^[A-Z]/.test(node.name.text)).map(node => [node.name.text, node.name.text]));
    const state = fixture(batch ? "BatchReassignModal" : "ActionModal", {
      ...primitives, ...logic, TERMINAL_STATUSES: ["completed", "cancelled"], FREE_SAMPLE_ONLY_STATUSES: [], TITLES: { reassign: "转派采购负责人" },
      useDeferredValue: value => value, useNavigate: () => () => {},
      useBuyerDirectory: options => { assert.deepEqual(options, { departmentOnly: true }); return { users: directory }; },
      refreshProcurement: async () => {},
      reassignProcTask: async (...args) => { calls.push(args); },
      batchReassignProcTasks: async (...args) => { calls.push(args); return { updated: 1 }; },
    }, componentAst);
    const props = batch ? { tasks: [task], onClose() {} } : { pending: { kind: "reassign", task }, busy: false, onClose() {}, onSubmit: async fn => { await fn(); return { ok: true }; } };
    const render = () => state.render(props);
    const choose = id => find(render(), node => node.type === "Select").props.onValueChange(id);
    const send = () => {
      const tree = render();
      find(batch ? tree.props.footer : tree, node => node.type === "Button" && node.props.className?.includes("material-button-primary")).props.onClick();
    };
    if (batch) find(render(), node => node.type === "Checkbox").props.onCheckedChange(true);
    assert.equal(find(render(), node => node.type === "Select").props.value, "", "历史负责人不能作为合法新选择");
    assert.equal(find(render(), node => node.type === "SelectItem" && node.props.value === "no-permission").props.disabled, true);
    assert.match(text(find(render(), node => node.type === "SelectItem" && node.props.value === "member-b")), /member-b/);
    for (const invalid of ["", "outside", "no-permission"]) { choose(invalid); send(); await settle(); assert.equal(calls.length, 0); }
    choose("member-b"); send(); await settle();
    assert.deepEqual(calls, [[batch ? ["task-1"] : "task-1", "张工", "member-b"]]);
    directory = [];
    assert.equal(find(render(), node => node.type === "Select").props.value, "");
    assert.match(text(render()), /暂无可选部门成员/);
    send(); await settle(); assert.equal(calls.length, 1, "部门成员移除后不能继续提交旧选择");
    state.unmount();
  }
});
const fileInput = (tree) => find(tree, (node) => node.type === "Input" && node.props.type === "file");
const submit = (tree) => find(tree.props.footer, (node) => node.type === "Button" && node.props.className.includes("material-button-primary"));
const pick = (tree, name) => fileInput(tree).props.onChange({ target: { files: [{ name }] } });

const supplierSource = readFileSync(new URL("../src/app/procurement/components/TplusSupplierSelect.tsx", import.meta.url), "utf8");
const supplierAst = ts.createSourceFile("TplusSupplierSelect.tsx", supplierSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const supplierUi = Object.fromEntries(["Command", "CommandInput", "CommandItem", "CommandList", "Popover", "PopoverContent", "PopoverTrigger", "Check", "ChevronsUpDown", "Loader2"].map((name) => [name, name]));
const supplierFixture = (listQuoteSuppliers) => fixture("TplusSupplierSelect", { ...supplierUi, listQuoteSuppliers }, supplierAst);
const text = (tree) => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree) : React.Children.toArray(tree.props?.children).map(text).join("");
const supplierRows = [
  { id: "local", name: "本地厂家", source: "local" },
  { id: "alpha", name: "甲方精密制造", shortName: "JMF", source: "tplus" },
  { id: "beta", name: "乙方材料公司", shortName: "ECL", source: "tplus" },
  { id: "blank", name: "", source: "tplus" },
];

test("T+供应商搜索名称和简称，只点选标准名称，旧值无效且有效A切换B重新通知", async () => {
  const pending = deferred();
  const state = supplierFixture(() => pending.promise);
  const changed = [], validity = [];
  let props = { id: "supplier", value: "原手填供应商", onChange: (name) => changed.push(name), onValidityChange: (valid) => validity.push({ name: props.value, valid }) };
  let tree = state.render(props);
  assert.equal(find(tree, (node) => node.props?.role === "combobox").props.disabled, true);
  assert.deepEqual(validity, [{ name: "原手填供应商", valid: false }]);
  pending.resolve(supplierRows); await settle(); tree = state.render(props);
  assert.match(text(tree), /原手填供应商/);
  assert.match(text(tree), /原供应商不在畅捷通目录中，请从目录重新选择/);
  assert.doesNotMatch(text(tree), /本地厂家/);
  find(tree, (node) => node.type === "CommandInput").props.onValueChange("ecl");
  tree = state.render(props);
  assert.match(text(tree), /乙方材料公司/); assert.doesNotMatch(text(tree), /甲方精密制造/);
  assert.deepEqual(changed, [], "搜索文字不能成为供应商名称");
  find(tree, (node) => node.type === "CommandInput").props.onValueChange("没有这家");
  tree = state.render(props); assert.match(text(tree), /没有匹配的供应商/); assert.equal(find(tree, (node) => node.type === "CommandItem"), undefined);
  find(tree, (node) => node.type === "CommandInput").props.onValueChange("甲方");
  tree = state.render(props); find(tree, (node) => node.type === "CommandItem").props.onSelect();
  assert.deepEqual(changed, ["甲方精密制造"]);
  props = { ...props, value: changed[0] }; state.render(props);
  props = { ...props, value: "乙方材料公司" }; state.render(props);
  assert.deepEqual(validity.slice(-2), [{ name: "甲方精密制造", valid: true }, { name: "乙方材料公司", valid: true }]);
  props = { ...props, value: "本地厂家" }; state.render(props);
  assert.deepEqual(validity.at(-1), { name: "本地厂家", valid: false });
  state.unmount();
});

test("供应商加载失败给中文重试提示且旧值无效，重试成功才恢复有效", async () => {
  const failed = deferred(), retry = deferred();
  let calls = 0;
  const validity = [];
  const state = supplierFixture(() => ++calls === 1 ? failed.promise : retry.promise);
  const props = { id: "supplier", value: "甲方精密制造", onChange() {}, onValidityChange: (valid) => validity.push(valid) };
  state.render(props); failed.reject(new TypeError("Failed to fetch")); await settle();
  let tree = state.render(props);
  assert.match(text(tree), /供应商目录加载失败，请检查网络后重试/);
  assert.doesNotMatch(text(tree), /Failed to fetch/);
  assert.deepEqual(validity, [false]);
  find(tree, (node) => node.type === "Button" && text(node) === "重新加载供应商").props.onClick();
  state.render(props); tree = state.render(props);
  assert.equal(calls, 2); assert.match(text(tree), /正在读取畅捷通供应商目录/);
  retry.resolve(supplierRows); await settle(); tree = state.render(props);
  assert.deepEqual(validity, [false, true]); assert.doesNotMatch(text(tree), /加载失败/);
  state.unmount();
});

test("只有本地供应商或空名称时显示未同步空态，不能把空值当有效选择", async () => {
  const state = supplierFixture(async () => supplierRows.filter((row) => row.source === "local" || !row.name));
  const validity = [];
  const props = { id: "supplier", value: "", onChange() {}, onValidityChange: (valid) => validity.push(valid) };
  state.render(props); await settle(); const tree = state.render(props);
  assert.match(text(tree), /暂无已同步的畅捷通供应商/);
  assert.equal(find(tree, (node) => node.props?.role === "combobox").props.disabled, true);
  assert.deepEqual(validity, [false]); state.unmount();
});

test("供应商目录卸载取消请求，迟到响应不能写状态；禁用时不能点选", async () => {
  const pending = deferred(); let signal;
  const state = supplierFixture((currentSignal) => { signal = currentSignal; return pending.promise; });
  state.render({ id: "supplier", value: "", onChange() {} }); state.unmount();
  assert.equal(signal.aborted, true); const writes = state.writes;
  pending.resolve(supplierRows); await settle(); assert.equal(state.writes, writes);
  const disabledState = supplierFixture(async () => supplierRows); let changes = 0;
  const props = { id: "supplier", value: "", disabled: true, onChange() { changes++; } };
  disabledState.render(props); await settle(); const tree = disabledState.render(props);
  find(tree, (node) => node.type === "CommandItem").props.onSelect(); assert.equal(changes, 0); disabledState.unmount();
});

test("通用采购弹窗在忙碌期间阻止关闭、Escape和外部点击，空闲时允许关闭", () => {
  const state = fixture("Shell");
  let closes = 0;
  const tree = state.render({ title: "批量导入物料", busy: true, onClose: () => closes++ });
  tree.props.onOpenChange(false);
  assert.equal(closes, 0);
  const content = find(tree, (node) => node.type === "DialogContent");
  assert.equal(content.props["aria-busy"], true);
  for (const handler of [content.props.onEscapeKeyDown, content.props.onPointerDownOutside]) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    handler(event);
    assert.equal(event.prevented, true);
  }
  assert.ok(find(tree, (node) => node.type === "DialogDescription"));
  state.render({ title: "批量导入物料", onClose: () => closes++ }).props.onOpenChange(false);
  assert.equal(closes, 1);
});

test("物料文件解析同步防重，导入失败保留预览并可重试，成功等待刷新后关闭", async () => {
  const parsed = deferred();
  const firstImport = deferred();
  const refresh = deferred();
  let parses = 0;
  let imports = 0;
  let closes = 0;
  const items = [{ name: "物料甲" }];
  const state = fixture("ImportMaterialsModal", {
    parseImportFile: () => { parses++; return parsed.promise; },
    importProcMaterials: (input) => { assert.deepEqual(input, items); return ++imports === 1 ? firstImport.promise : Promise.resolve({ created: 1, updated: 0 }); },
    refreshProcurement: () => refresh.promise,
  });
  const render = () => state.render({ onClose: () => closes++ });
  const first = render();
  pick(first, "物料.xlsx");
  pick(first, "重复.xlsx");
  assert.equal(parses, 1);
  assert.equal(render().props.busy, true);
  assert.equal(fileInput(render()).props.disabled, true);
  parsed.resolve({ items, skipped: 0 });
  await settle();
  assert.equal(render().props.busy, false);
  const ready = render();
  submit(ready).props.onClick();
  submit(ready).props.onClick();
  assert.equal(imports, 1);
  firstImport.reject(new Error("导入服务暂不可用"));
  await settle();
  assert.equal(closes, 0);
  assert.equal(render().props.busy, false);
  assert.equal(text(find(render(), (node) => node.props.role === "alert")), "导入服务暂不可用");
  assert.equal(submit(render()).props.disabled, false, "失败保留已解析行供重试");
  submit(render()).props.onClick();
  await settle();
  assert.equal(imports, 2);
  assert.equal(closes, 0);
  assert.equal(render().props.busy, true);
  refresh.resolve();
  await settle();
  assert.equal(closes, 1);
});

test("选择新文件立即清除旧预览，解析失败后不能误导入上个文件", async () => {
  let parses = 0;
  const second = deferred();
  const state = fixture("ImportMaterialsModal", {
    parseImportFile: () => ++parses === 1 ? Promise.resolve({ items: [{ name: "旧物料" }], skipped: 0 }) : second.promise,
  });
  pick(state.render(), "旧.xlsx");
  await settle();
  assert.equal(submit(state.render()).props.disabled, false);
  pick(state.render(), "错误.xlsx");
  assert.equal(submit(state.render()).props.disabled, true);
  second.reject(new Error("文件格式错误"));
  await settle();
  assert.equal(submit(state.render()).props.disabled, true);
  assert.equal(text(find(state.render(), (node) => node.props.role === "alert")), "文件格式错误");
});

test("弹窗卸载后解析的成功或失败响应均不再写入状态", async () => {
  for (const fails of [false, true]) {
    const pending = deferred();
    const state = fixture("ImportMaterialsModal", { parseImportFile: () => pending.promise });
    pick(state.render(), "文件.xlsx");
    state.unmount();
    const writes = state.writes;
    if (fails) pending.reject(new Error("旧失败"));
    else pending.resolve({ items: [{ name: "旧物料" }], skipped: 0 });
    await settle();
    assert.equal(state.writes, writes);
  }
});
