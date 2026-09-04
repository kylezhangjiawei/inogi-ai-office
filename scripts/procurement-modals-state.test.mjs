import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/modals.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("modals.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual component body and its event handlers; replace only portal
// rendering, hook scheduling and external requests with deterministic controls.
function fixture(name, external = {}) {
  const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(component, `missing ${name}`);
  const slots = [];
  const cleanups = [];
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
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
    },
    useI18n: () => ({ t: (value) => value }),
    toast: { success() {}, error() {} },
    cn: (...values) => values.filter(Boolean).join(" "),
    downloadImportTemplate() {},
    ...external,
  };
  for (const name of ["Shell", "Input", "Upload", "Loader2", "FileDown", "Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter"]) scope[name] = name;
  const code = ts.transpileModule(`${component.getText(ast).replace(/^export\s+/, "")}\nreturn ${name};`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const Component = new Function(...Object.keys(scope), code)(...Object.values(scope));
  return {
    render(props = {}) { cursor = 0; return Component(props); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
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
const submit = (tree) => find(tree.props.footer, (node) => node.type === "button" && node.props.className.includes("material-button-primary"));
const pick = (tree, name) => fileInput(tree).props.onChange({ target: { files: [{ name }] } });

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
  assert.equal(find(render(), (node) => node.props.role === "alert").props.children, "导入服务暂不可用");
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
  assert.equal(find(state.render(), (node) => node.props.role === "alert").props.children, "文件格式错误");
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
