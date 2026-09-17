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
