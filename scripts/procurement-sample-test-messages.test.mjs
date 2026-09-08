import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import ts from "typescript";
import * as sample from "../src/app/lib/procurementSampleTestMessage.ts";

const messageSource = readFileSync(new URL("../src/app/MessageCenterPage.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("../src/app/components/ProcSampleTestMessageCard.tsx", import.meta.url), "utf8");
const astOf = (source) => ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const messageAst = astOf(messageSource);
const workspaceAst = astOf(workspaceSource);
const cardAst = astOf(cardSource);
const translate = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? key);
const common = { React, ...sample, t: translate, useI18n: () => ({ t: translate, lang: "zh" }), useMemo: (factory) => factory(), useCallback: (callback) => callback,
  useEffect() {}, useState: (initial) => [initial, () => {}], cn: (...values) => values.filter(Boolean).join(" "), i18nLocale: () => "zh-CN" };

function evaluate(source, bindings) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function getFunction(ast, name, bindings = {}) {
  const node = ast.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
  assert.ok(node, name);
  return evaluate(`${node.getText(ast).replace(/^export\s+/, "")}\nreturn ${name};`, { ...common, ...bindings });
}

function findNode(ast, predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(result, "Expected source node");
  return result;
}

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(elements)];
}

function renderedText(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(renderedText).join(" ");
  return tree && typeof tree === "object" ? renderedText(tree.props?.children) : "";
}

function body(overrides = {}) {
  return { type: "procurement_sample_test_request", task_id: "proc/自采", procurement_task_id: "proc/自采", procurement_code: "CG-1001",
    material_name: "电源适配器", specification: "100W", quantity: 2, unit: "个", tester_name: "王研发", buyer_name: "李采购", round_id: "round-1",
    next_action: "", route: "/proc-my-workspace?task=proc%2F%E8%87%AA%E9%87%87", ...overrides };
}

const parseBody = getFunction(messageAst, "parseBody", { parseRdDiscussionMention: () => null });

test("两类消息解析成可读字段，未知类型保留原消息逻辑", () => {
  const request = parseBody(JSON.stringify(body()));
  assert.equal(request.type, "procurement_sample_test_request");
  assert.equal(request.rd_task_id, "");
  assert.equal(request.procurement_task_id, "proc/自采");
  for (const result of ["passed", "failed_resample", "failed_requote"]) {
    const parsed = parseBody(JSON.stringify(body({ type: "procurement_sample_test_result", result, conclusion: "温升测试完成" })));
    const summary = sample.sampleTestMessageSummary(parsed);
    assert.ok(summary.includes(sample.sampleTestResultLabel(result)));
    assert.ok(!summary.includes("procurement_sample_test_result"));
    assert.ok(!summary.includes("{\""));
  }
  assert.deepEqual(parseBody("普通消息"), { type: "unknown", raw: "普通消息" });
  assert.equal(sample.parseProcurementSampleTestMessage("null"), null);
});

test("研发待办按采购ID直接进入测试弹窗，结果仅接受匹配采购ID的本地采购路由", () => {
  const request = parseBody(JSON.stringify(body({ route: "//evil.example/test" })));
  assert.equal(sample.sampleTestMessageRoute(request), "/rd-my-workspace?sampleTest=proc%2F%E8%87%AA%E9%87%87");
  for (const route of ["/proc-my-workspace?task=proc%2F%E8%87%AA%E9%87%87", "/proc-cockpit?task=proc%2F%E8%87%AA%E9%87%87"]) {
    assert.equal(sample.sampleTestMessageRoute({ ...request, type: "procurement_sample_test_result", route }), route);
  }
  for (const route of ["//evil.example/proc-cockpit?task=x", "https://evil.example", "/\\evil.example", "/rd-my-workspace?task=proc%2F%E8%87%AA%E9%87%87", "/proc-cockpit?task=wrong", "/proc-cockpit", "javascript:alert(1)"]) {
    assert.equal(sample.sampleTestMessageRoute({ ...request, type: "procurement_sample_test_result", route }), null, route);
  }
});

test("共用测试卡展示负责人、物料、结论、下一步，点击待办入口不会标记测试完成", () => {
  const opened = [];
  const Card = getFunction(cardAst, "ProcSampleTestMessageCard", { Button: "Button", ArrowRight: "ArrowRight", ClipboardCheck: "ClipboardCheck" });
  const request = parseBody(JSON.stringify(body()));
  let tree = Card({ body: request, onOpen: (route) => opened.push(route) });
  const text = renderedText(tree);
  for (const label of ["CG-1001", "电源适配器", "100W", "王研发", "李采购", "下一步", "填写并确认测试结论", "已读或关闭通知不会完成测试"]) assert.ok(text.includes(label), label);
  assert.ok(!text.includes("标记已处理"));
  const button = elements(tree).find((node) => node.type === "Button");
  button.props.onClick({ stopPropagation() {} });
  assert.deepEqual(opened, [sample.sampleTestMessageRoute(request)]);
  tree = Card({ body: parseBody(JSON.stringify(body({ type: "procurement_sample_test_result", result: "failed_requote", conclusion: "输出电压不稳定" }))), onOpen() {} });
  assert.ok(renderedText(tree).includes("测试不通过，重新询价"));
  assert.ok(renderedText(tree).includes("输出电压不稳定"));
});

test("消息中心新增待办/结果筛选与中文语义搜索，不混入审核消息", () => {
  const initializer = findNode(messageAst, (node) => ts.isVariableDeclaration(node) && node.name.getText(messageAst) === "filteredMessages").initializer;
  const messages = [
    { id: "request", body: JSON.stringify(body()) },
    { id: "result", body: JSON.stringify(body({ type: "procurement_sample_test_result", result: "failed_resample", conclusion: "需要增加绝缘" })) },
    { id: "review", body: JSON.stringify({ type: "review_request", task_title: "研发审核" }) },
  ];
  const filter = (filter, keyword = "") => evaluate(`return ${initializer.getText(messageAst)};`, { ...common, parseBody, isPendingReviewMessage: () => false, messages, filter, keyword });
  assert.deepEqual(filter("sample_test_request").map((message) => message.id), ["request"]);
  assert.deepEqual(filter("sample_test_result").map((message) => message.id), ["result"]);
  assert.deepEqual(filter("all", "重新送样").map((message) => message.id), ["result"]);
  assert.deepEqual(filter("all", "王研发").map((message) => message.id), ["request", "result"]);
});

test("消息中心实际卡片分支不回落JSON文本，打开测试仅标已读并导航", () => {
  const navigated = [];
  const read = [];
  const handled = [];
  const Card = getFunction(messageAst, "MessageCard", { parseBody, useNavigate: () => (route) => navigated.push(route),
    SourceChip: "SourceChip", ProcSampleTestMessageCard: "SampleCard", Button: "Button" });
  const msg = { id: "msg-sample", source: "procurement", created_at: new Date().toISOString(), body: JSON.stringify(body()) };
  const tree = Card({ msg, onOpen: (message) => read.push(message.id), onHandle: (message) => handled.push(message.id) });
  const sampleCard = elements(tree).find((node) => node.type === "SampleCard");
  assert.ok(sampleCard);
  assert.ok(!renderedText(tree).includes(msg.body));
  assert.equal(elements(tree).filter((node) => node.type === "Button").length, 0, "待办没有通用处理按钮");
  sampleCard.props.onOpen(sample.sampleTestMessageRoute(sampleCard.props.body));
  assert.deepEqual(read, ["msg-sample"]);
  assert.deepEqual(navigated, ["/rd-my-workspace?sampleTest=proc%2F%E8%87%AA%E9%87%87"]);
  assert.deepEqual(handled, []);
});

test("工作台通知抽屉复用测试卡并允许无关联研发任务直接打开测试，隐藏普通处理按钮", () => {
  const navigated = [];
  let closed = 0;
  const Drawer = getFunction(workspaceAst, "NotificationDrawer", { useNavigate: () => (route) => navigated.push(route), parseRdDiscussionMention: () => null,
    relativeTimeLabel: () => "刚刚", DrawerShell: "DrawerShell", Bell: "Bell", ProcSampleTestMessageCard: "SampleCard", ActionButton: "ActionButton" });
  const raw = JSON.stringify(body());
  const tree = Drawer({ notification: { type: "message", title: "请测试", message: raw, raw_body: raw }, onClose: () => { closed++; }, onDismiss() {} });
  const card = elements(tree).find((node) => node.type === "SampleCard");
  assert.ok(card);
  assert.ok(!renderedText(tree).includes(raw));
  assert.ok(!renderedText(tree).includes("标记已处理"));
  card.props.onOpen(sample.sampleTestMessageRoute(card.props.body));
  assert.equal(closed, 1);
  assert.deepEqual(navigated, ["/rd-my-workspace?sampleTest=proc%2F%E8%87%AA%E9%87%87"]);
});

test("sampleTest 深链只在关闭时清除，保留其它参数，确认刷新而不关闭弹窗", () => {
  const initial = new URLSearchParams("sampleTest=proc%2Fself&task=rd-existing&tab=mine");
  let params = new URLSearchParams(initial);
  const sampleId = findNode(workspaceAst, (node) => ts.isVariableDeclaration(node) && node.name.getText(workspaceAst) === "sampleTestTaskId").initializer;
  const close = findNode(workspaceAst, (node) => ts.isVariableDeclaration(node) && node.name.getText(workspaceAst) === "closeSampleTest").initializer;
  const dialog = findNode(workspaceAst, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(workspaceAst) === "ProcSampleTestDialog");
  const sampleTestTaskId = evaluate(`return ${sampleId.getText(workspaceAst)};`, { searchParams: params });
  const closeSampleTest = evaluate(`return ${close.getText(workspaceAst)};`, { ...common, setSearchParams: (update) => { params = update(params); } });
  const refreshes = [];
  const tree = evaluate(`return ${dialog.getText(workspaceAst)};`, { ...common, ProcSampleTestDialog: "Dialog", sampleTestTaskId, closeSampleTest, loadWorkspace: (options) => refreshes.push(options) });
  assert.equal(tree.props.taskId, "proc/self");
  assert.equal(params.toString(), initial.toString(), "渲染时不消费URL参数");
  tree.props.onConfirmed();
  assert.deepEqual(refreshes, [{ silent: true }]);
  assert.equal(params.get("sampleTest"), "proc/self");
  tree.props.onClose();
  assert.equal(params.has("sampleTest"), false);
  assert.equal(params.get("task"), "rd-existing");
  assert.equal(params.get("tab"), "mine");
});
