import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import ts from "typescript";

// Execute the actual component bodies, keeping DOM primitives and image rendering real.
// Only portal placement, directory loading and browser layout effects are replaced for SSR.
function loadBindings(path, names, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = ast.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))),
  );
  assert.equal(selected.length, names.length, `missing component binding in ${path}`);
  const javascript = ts.transpileModule(
    selected.map((node) => node.getText(ast).replace(/^export\s+/, "")).join("\n")
      + `\nreturn { ${names.join(", ")} };`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}

const cn = (...values) => values.filter(Boolean).join(" ");
const hooks = {
  React, cn,
  useState: React.useState,
  useMemo: React.useMemo,
  useCallback: React.useCallback,
  useRef: React.useRef,
  useEffect: React.useEffect,
  useLayoutEffect: React.useEffect,
};
const { Input } = loadBindings("../src/app/components/ui/input.tsx", ["Input"], hooks);
const { Button } = loadBindings("../src/app/components/ui/button.tsx", ["buttonVariants", "Button"], { ...hooks, Slot, cva });
const { MobileZoomableImage } = loadBindings("../src/app/components/MobileZoomableImage.tsx", ["MobileZoomableImage"], {
  ...hooks, useMobileZoomEnabled: () => false, TASK_IMAGE_MIN_SCALE: 1,
});
const Container = ({ children }) => React.createElement(React.Fragment, null, children);
const commonDependencies = {
  ...hooks, Input, Button, MobileZoomableImage,
  Popover: Container, PopoverAnchor: Container, PopoverTrigger: Container,
  PopoverContent: () => null,
  Command: Container, CommandList: Container, CommandItem: Container,
  Dialog: Container, DialogContent: Container,
  DialogTitle: ({ children, ...props }) => React.createElement("h2", props, children),
  Calendar: () => null, CalendarDays: () => null,
  translate: (value) => value, i18nLocale: () => "zh-CN",
  useBuyerDirectory: () => ({ suggestions: ["采购甲"], deptOf: () => "采购部" }),
};
const { ComboInput, BuyerComboInput, DateInput, ImageLightbox, PlaceholderImage } = loadBindings(
  "../src/app/procurement/components/common.tsx",
  ["ComboInput", "fmtDay", "DateInput", "BuyerComboInput", "ImageLightbox", "PlaceholderImage"],
  commonDependencies,
);
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("采购联想输入和负责人包装组件把标签传到真实输入框", () => {
  for (const component of [ComboInput, BuyerComboInput]) {
    const html = render(component, { value: "采购甲", onChange() {}, options: [], ariaLabel: "任务接收人", disabled: true });
    assert.match(html, /<input\b[^>]*aria-label="任务接收人"/);
    assert.match(html, /<input\b[^>]*disabled=""/);
    assert.match(html, /<input\b[^>]*value="采购甲"/);
    assert.doesNotMatch(html, /ariaLabel=/);
  }
});

test("旧联想输入不传标签时保留输入值和占位提示", () => {
  const html = render(ComboInput, { value: "", onChange() {}, options: [], placeholder: "输入供应商" });
  assert.match(html, /<input\b[^>]*placeholder="输入供应商"/);
  assert.doesNotMatch(html, /aria-label=/);
});

test("物料联想输入将字段 ID 与必填约束传到真实输入框", () => {
  const html = render(ComboInput, { id: "stock-plan-material", value: "", onChange() {}, options: [], required: true });
  assert.match(html, /<input\b[^>]*id="stock-plan-material"/);
  assert.match(html, /<input\b[^>]*required=""/);
});

test("采购联想输入只在要求时把自动聚焦传到真实输入框", () => {
  const props = { value: "", onChange() {}, options: [] };
  assert.match(render(ComboInput, { ...props, autoFocus: true }), /<input\b[^>]*autofocus=""/);
  assert.doesNotMatch(render(ComboInput, { ...props, autoFocus: false }), /\bautofocus=/);
  assert.doesNotMatch(render(ComboInput, props), /\bautofocus=/);
});

test("采购联想输入的回车和退出键各调用对应回调，并与 Tab 一起收起候选", () => {
  const openUpdates = [];
  const callbacks = [];
  let inputProps;
  const { ComboInput: InteractiveComboInput } = loadBindings(
    "../src/app/procurement/components/common.tsx",
    ["ComboInput"],
    {
      ...commonDependencies,
      // Start with an open candidate list and observe the real handler's state updates.
      useState: () => [true, (next) => openUpdates.push(next)],
      Input: (props) => {
        inputProps = props;
        return React.createElement(Input, props);
      },
    },
  );
  const props = { value: "", onChange() {}, options: ["采购甲"] };
  render(InteractiveComboInput, {
    ...props,
    onEnter: () => callbacks.push("enter"),
    onEscape: () => callbacks.push("escape"),
  });

  inputProps.onKeyDown({ key: "Enter" });
  assert.deepEqual(callbacks, ["enter"]);
  inputProps.onKeyDown({ key: "Escape" });
  assert.deepEqual(callbacks, ["enter", "escape"]);
  inputProps.onKeyDown({ key: "Tab" });
  assert.deepEqual(openUpdates, [false, false, false]);
  for (const key of ["ArrowDown", "a"]) inputProps.onKeyDown({ key });
  assert.deepEqual(callbacks, ["enter", "escape"]);
  assert.deepEqual(openUpdates, [false, false, false]);

  // Existing callers may omit both optional callbacks; keyboard dismissal still works.
  render(InteractiveComboInput, props);
  inputProps.onKeyDown({ key: "Enter" });
  inputProps.onKeyDown({ key: "Escape" });
  assert.deepEqual(callbacks, ["enter", "escape"]);
  assert.deepEqual(openUpdates, [false, false, false, false, false]);
});

test("日期字段标签落到可操作按钮，已有日期仍可见", () => {
  const html = render(DateInput, { id: "quote-date", value: "2026-09-04", onChange() {}, ariaLabel: "报价日期" });
  assert.match(html, /<button\b[^>]*id="quote-date"/);
  assert.match(html, /<button\b[^>]*aria-label="报价日期"/);
  assert.match(html, />2026-09-04<\/span>/);
  assert.doesNotMatch(html, /ariaLabel=/);
});

test("旧日期字段不传标签时保留原日期或默认提示作为按钮内容", () => {
  assert.match(render(DateInput, { value: "2026-09-04", onChange() {} }), />2026-09-04<\/span>/);
  assert.match(render(DateInput, { value: "", onChange() {} }), />选择日期<\/span>/);
  assert.match(render(DateInput, { value: "", onChange() {}, placeholder: "长期有效" }), />长期有效<\/span>/);
});

test("图片预览的自定义和默认替代文本传到真实图片元素", () => {
  const base = { url: "https://example.test/material.png", onClose() {} };
  assert.match(render(ImageLightbox, { ...base, alt: "电机商品图片预览" }), /<img\b[^>]*alt="电机商品图片预览"/);
  // A preview without a material-specific description must still identify its purpose.
  assert.match(render(ImageLightbox, base), /<img\b[^>]*alt="商品图片预览"/);
  assert.match(render(ImageLightbox, { ...base, alt: "" }), /<img\b[^>]*alt=""/);
  assert.match(render(ImageLightbox, { ...base, alt: "电机商品图片预览" }), /<h2\b[^>]*>电机商品图片预览<\/h2>/);
  assert.match(render(ImageLightbox, { ...base, alt: "" }), /<h2\b[^>]*>商品图片预览<\/h2>/);
});

test("缺图占位用业务标签提供可访问名称并隐藏装饰图标", () => {
  const html = render(PlaceholderImage, { label: "尚未上传物料图片" });
  assert.match(html, /<div\b[^>]*role="img"[^>]*aria-label="尚未上传物料图片"/);
  assert.match(html, /<span\b[^>]*aria-hidden="true"/);
});
