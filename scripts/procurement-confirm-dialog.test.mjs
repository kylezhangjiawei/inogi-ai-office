import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/common.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("common.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useConfirmDialog");
assert.ok(hook, "missing useConfirmDialog");
const javascript = ts.transpileModule(
  `${hook.getText(ast).replace(/^export\s+/, "")}\nreturn useConfirmDialog;`,
  { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } },
).outputText;

// Run the real hook and JSX event handlers. Only React's render scheduling and
// Radix placement are replaced so rapid events can occur before a rerender.
function fixture(extra = {}) {
  const slots = [];
  let cursor = 0;
  const bindings = {
    React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback) => callback,
    translate: (value) => value,
    cn: (...values) => values.filter(Boolean).join(" "),
    ...extra,
  };
  for (const name of ["AlertDialog", "AlertDialogAction", "AlertDialogCancel", "AlertDialogContent", "AlertDialogDescription", "AlertDialogFooter", "AlertDialogHeader", "AlertDialogTitle"]) {
    bindings[name] = name;
  }
  const useDialog = new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
  return { render() { cursor = 0; return useDialog(); } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const action = (view) => find(view.confirmDialog, (node) => node.type === "AlertDialogAction");
const title = (view) => find(view.confirmDialog, (node) => node.type === "AlertDialogTitle").props.children;
function click(view) {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  action(view).props.onClick(event);
  return event;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("确认等待实际请求完成，同一渲染中的重复点击只提交一次", async () => {
  const state = fixture();
  const request = deferred();
  let calls = 0;
  state.render().confirm({ title: "删除报价", onConfirm: () => { calls++; return request.promise; } });
  const view = state.render();
  const first = click(view);
  click(view);
  assert.equal(calls, 1);
  assert.equal(first.defaultPrevented, true, "Radix action must not close before success");
  assert.ok(state.render().confirmDialog);
  assert.equal(action(state.render()).props.disabled, true);
  request.resolve();
  await settle();
  assert.equal(state.render().confirmDialog, null);
});

test("提交期间取消和关闭事件无效，也不能替换正在处理的请求", async () => {
  const state = fixture();
  const request = deferred();
  state.render().confirm({ title: "原请求", onConfirm: () => request.promise });
  click(state.render());
  const pending = state.render();
  assert.equal(find(pending.confirmDialog, (node) => node.type === "AlertDialogCancel").props.disabled, true);
  pending.confirmDialog.props.onOpenChange(false);
  pending.confirm({ title: "新请求", onConfirm() {} });
  assert.equal(title(state.render()), "原请求");
  request.resolve();
  await settle();
  assert.equal(state.render().confirmDialog, null);
});

test("失败保留确认内容并展示错误，原位重试成功后才关闭", async () => {
  const state = fixture();
  let calls = 0;
  state.render().confirm({ title: "合并分类", onConfirm: async () => { if (++calls === 1) throw new Error("服务暂不可用"); } });
  click(state.render());
  await settle();
  let view = state.render();
  assert.equal(title(view), "合并分类");
  assert.equal(find(view.confirmDialog, (node) => node.props.role === "alert").props.children, "服务暂不可用");
  assert.equal(action(view).props.disabled, false);
  click(view);
  view = state.render();
  assert.equal(find(view.confirmDialog, (node) => node.props.role === "alert"), undefined);
  await settle();
  assert.equal(calls, 2);
  assert.equal(state.render().confirmDialog, null);
});

test("调用方返回false时保留确认供重试，成功的同步动作仍可正常关闭", async () => {
  const state = fixture();
  let result = false;
  state.render().confirm({ title: "转派成员", onConfirm: () => result });
  click(state.render());
  await settle();
  assert.ok(state.render().confirmDialog);
  assert.equal(action(state.render()).props.disabled, false);
  result = true;
  click(state.render());
  await settle();
  assert.equal(state.render().confirmDialog, null);
  state.render().confirm({ title: "本地操作", onConfirm() {} });
  click(state.render());
  await settle();
  assert.equal(state.render().confirmDialog, null);
});

test("未提交的确认允许取消，下一次打开清除上一条错误", async () => {
  const state = fixture();
  state.render().confirm({ title: "失败操作", onConfirm() { throw new Error("旧错误"); } });
  click(state.render());
  await settle();
  const failed = state.render();
  assert.ok(find(failed.confirmDialog, (node) => node.props.role === "alert"));
  failed.confirmDialog.props.onOpenChange(false);
  assert.equal(state.render().confirmDialog, null);
  state.render().confirm({ title: "下一次操作", onConfirm() {} });
  assert.equal(find(state.render().confirmDialog, (node) => node.props.role === "alert"), undefined);
});

test("分类合并的实际调用链返回后台Promise，失败留窗，重试等待列表刷新完成", async () => {
  const modalSource = readFileSync(new URL("../src/app/procurement/components/modals.tsx", import.meta.url), "utf8");
  const modalAst = ts.createSourceFile("modals.tsx", modalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = modalAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CategoryManageModal");
  const handlers = component.body.statements.filter((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((declaration) => ["doRename", "rename"].includes(declaration.name.getText(modalAst))));
  assert.equal(handlers.length, 2);
  const state = fixture();
  const first = deferred();
  const refresh = deferred();
  let calls = 0;
  const bindings = {
    setBusy() {}, setEditing() {}, setNewName() {},
    renameProcCategory: () => ++calls === 1 ? first.promise : Promise.resolve({ updated: 2 }),
    refreshProcurement: () => refresh.promise,
    toast: { success() {}, error() {} }, t: (value) => value,
    newName: "目标分类", byCat: new Map([["目标分类", 1]]), confirmAction: state.render().confirm,
  };
  const code = ts.transpileModule(`${handlers.map((node) => node.getText(modalAst)).join("\n")}\nreturn rename;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const rename = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  await rename("原分类");
  click(state.render());
  await settle();
  assert.ok(state.render().confirmDialog, "分类合并不能丢弃后台Promise而提前关闭");
  first.reject(new Error("分类合并失败"));
  await settle();
  assert.ok(state.render().confirmDialog, "分类合并失败后可在原确认框重试");
  assert.equal(find(state.render().confirmDialog, (node) => node.props.role === "alert").props.children, "分类合并失败");
  click(state.render());
  await settle();
  assert.equal(calls, 2);
  assert.equal(action(state.render()).props.disabled, true, "更新后的列表尚未刷新时继续等待");
  refresh.resolve();
  await settle();
  assert.equal(state.render().confirmDialog, null);
});

test("取消确认后焦点回到触发按钮，按钮已被移除时保留Radix的焦点回退", () => {
  class Element {
    isConnected = true;
    focusCount = 0;
    focus() { this.focusCount++; }
  }
  const trigger = new Element();
  const state = fixture({ document: { activeElement: trigger }, HTMLElement: Element });
  state.render().confirm({ title: "移出报价库", onConfirm() {} });
  const view = state.render();
  const content = find(view.confirmDialog, (node) => node.type === "AlertDialogContent");
  content.props.onOpenAutoFocus();
  view.confirmDialog.props.onOpenChange(false);
  const close = { prevented: false, preventDefault() { this.prevented = true; } };
  content.props.onCloseAutoFocus(close);
  assert.equal(close.prevented, true);
  assert.equal(trigger.focusCount, 1);
  trigger.isConnected = false;
  const removed = { prevented: false, preventDefault() { this.prevented = true; } };
  content.props.onCloseAutoFocus(removed);
  assert.equal(removed.prevented, false);
  assert.equal(trigger.focusCount, 1);
});
