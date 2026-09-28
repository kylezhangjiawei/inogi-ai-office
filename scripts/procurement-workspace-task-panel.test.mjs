import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function compile(source, dependencies = {}) {
  const exports = {};
  new Function("exports", "require", "window", transpile(source))(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, undefined);
  return exports;
}
function declarations(path, names) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter((node) => names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(ast))))
    .map((node) => node.getText(ast)).join("\n");
}
const common = compile(declarations("src/app/procurement/components/common.tsx", ["PROC_STATUS_META", "procurementNextAction", "ROLLBACK_MAIN_FLOW", "ROLLBACK_DIRECT_FLOW", "rollbackTargetsOf"]));
const actions = compile(declarations("src/app/procurement/components/taskActions.tsx", ["DECISION_STATUSES", "TERMINAL_STATUSES", "NOT_STARTED_STATUSES", "removalModeOf", "nextPermissionOf"]));
const data = compile(read("src/app/procurement/data.ts"), {
  react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} }, "../lib/procurementApi": {}, "../lib/rdApi": {},
});
const model = compile(read("src/app/procurement/procurementWorkspaceModel.ts"), { "./data": data });
const sampleFacts = compile(read("src/app/lib/procSampleFacts.ts"));
const sampleModel = compile(read("src/app/procurement/sampleWorkspaceModel.ts"), { "../lib/procSampleFacts": sampleFacts });
const jsx = (type, props, key) => ({ type, props, key });
function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== "object") return tree;
  if (typeof tree.type === "function") return expand(tree.type(tree.props));
  return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
}
const ast = ts.createSourceFile("panel.tsx", read("src/app/procurement/components/ProcWorkspaceTaskPanel.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = ast.statements.filter(ts.isImportDeclaration).flatMap((node) => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
  ? node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : []);
const body = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n");
function render(props, permissions = []) {
  const stubs = Object.fromEntries(imports.map((name) => [name, name]));
  Object.assign(stubs, common, actions, data, model, sampleFacts, sampleModel, {
    useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key) }),
    useProcCan: () => (code) => permissions.includes(code),
    routePath: (_permission, fallback) => fallback,
    cn: (...values) => values.filter(Boolean).join(" "),
    AutoTranslatedText: ({ text }) => jsx("span", { children: text }),
  });
  const exports = {};
  new Function("exports", "stubs", "require", `const {${imports.join(",")}} = stubs;\n${transpile(body)}`)(exports, stubs, (name) => {
    assert.equal(name, "react/jsx-runtime");
    return { jsx, jsxs: jsx, Fragment: "Fragment" };
  });
  return expand(exports.ProcWorkspaceTaskPanel({ onOpenDetail() {}, onNext() {}, onReassign() {}, onRemove() {}, onNavigateRelated() {}, ...props }));
}
const task = (overrides = {}) => ({
  id: "task-a", code: "PR-a", materialId: "material-a", materialName: "阀体", spec: "M20", unit: "件", quantity: 20, arrivedQty: 3,
  method: "inquiry", source: "self", businessLine: "production", status: "inquiring", paymentStatus: "partial", priority: "medium",
  buyer: "采购甲", requester: "研发乙", requesterDept: "研发部", needSample: false, attachmentList: [], purchaseOrders: [], logs: [], ...overrides,
});
const byClass = (tree, name) => nodes(tree).find((node) => node.props?.className?.split(" ").includes(name));
const button = (tree, label) => nodes(tree).find((node) => node.type === "Button" && textOf(node) === label);
const fact = (tree, label) => nodes(tree).find((node) => node.type === "div" && Array.isArray(node.props?.children)
  && node.props.children.some((child) => child?.type === "dt" && textOf(child) === label));

test("详情产品图仅关联精确物料 ID，切换任务不会沿用同名物料图", () => {
  const exact = { id: "material-a", name: "旧名称", imageUrl: "/actual/a.png" };
  const sameName = { id: "other", name: "阀体", imageUrl: "/actual/other.png" };
  const value = task();
  const tree = render({ task: value, materials: [sameName, exact] });
  const image = nodes(tree).find((node) => node.type === "SampleProductImage");
  assert.equal(image.props.material, exact);
  assert.equal(image.props.task, value);
  assert.equal(image.key, value.id);
  const unmatched = render({ task: task({ id: "task-b", materialId: "missing" }), materials: [sameName, exact] });
  assert.equal(nodes(unmatched).find((node) => node.type === "SampleProductImage").props.material, undefined);
  assert.match(textOf(byClass(tree, "proc-s01-panel-header")), /阀体M20PR-a/);
  assert.equal(nodes(byClass(tree, "proc-s01-panel-header")).filter((node) => node.props?.onClick).length, 0, "产品摘要不新增绕过阻塞的动作");
});

test("分组展示真实到货、付款与供应商数据；未知和异常数量不伪造为零", () => {
  const tree = render({ task: task({ arrivedQty: NaN, purchaseOrders: [{ id: "order-a", tpOrderNo: "PO-a", tpLineNo: "2", supplierName: "供应商丙", orderedQty: 10, receivedQty: 12, unitPrice: null }] }) });
  const scroll = byClass(tree, "proc-s01-panel-body");
  assert.deepEqual(nodes(scroll).filter((node) => node.type === "section").map((node) => node.props["aria-label"]), ["需求与协作", "采购与到货", "最新进展", "供应商与订单"]);
  assert.match(textOf(fact(scroll, "已到货数量")), /待核对/);
  assert.match(textOf(fact(scroll, "付款状态")), /部分付款/);
  assert.match(textOf(fact(scroll, "未收数量")), /待核对/);
  assert.match(textOf(scroll), /供应商丙.*PO-a/);
  assert.doesNotMatch(textOf(scroll), /NaN|库存|缺料|供应商联系人/);
  const absent = render({ task: task({ arrivedQty: Infinity, paymentStatus: undefined }) });
  assert.match(textOf(fact(absent, "付款状态")), /待确认/);
  assert.match(textOf(fact(absent, "已到货数量")), /待核对/);
});

test("详情和下一步保留在滚动区外，并沿用权限、阻塞及原回调", () => {
  const value = task();
  const calls = [];
  const tree = render({ task: value, onNext: (current) => calls.push(["next", current]), onOpenDetail: (current) => calls.push(["detail", current]) }, ["proc-task:select-quote"]);
  const footer = byClass(tree, "proc-s01-panel-footer");
  assert.ok(footer);
  assert.equal(byClass(byClass(tree, "proc-s01-panel-body"), "proc-s01-panel-footer"), undefined);
  button(footer, "完整详情").props.onClick();
  button(footer, "完成询价").props.onClick();
  assert.deepEqual(calls, [["detail", value], ["next", value]]);
  assert.equal(button(render({ task: value }), "完成询价"), undefined);
  const blocked = render({ task: value, blocked: true }, ["proc-task:select-quote", "proc-task:reassign", "proc-task:delete", "proc-task:rollback"]);
  assert.ok(nodes(blocked).filter((node) => node.props?.onClick || node.props?.onSelect).every((node) => node.props.disabled));
  const empty = render({ task: null });
  assert.ok(byClass(empty, "proc-workspace-task-panel"));
  assert.equal(nodes(empty).some((node) => node.type === "SampleProductImage"), false);
});

test("待确认任务按来源区分审核与接收动作，权限和回调保持一致", () => {
  for (const [source, label, other] of [["rd", "审核通过", "接收采购需求"], ["self", "接收采购需求", "审核通过"]]) {
    const value = task({ source, status: "pending_confirm" });
    const calls = [];
    const tree = render({ task: value, onNext: (current) => calls.push(current) }, ["proc-task:confirm"]);
    const action = button(byClass(tree, "proc-s01-panel-footer"), label);
    assert.ok(action, `${source} 使用 ${label}`);
    assert.equal(button(tree, other), undefined);
    action.props.onClick();
    assert.deepEqual(calls, [value]);
    assert.equal(button(render({ task: value }), label), undefined);
  }
});

test("无正式单号的样品仍展示真实供应商，仅有报价 ID 时不推测供应商", () => {
  const sample = render({ task: task({ purchaseOrders: [{ id: "free-a", tpOrderNo: "", supplierName: "寄样供应商丁", orderedQty: 2, receivedQty: 0, freeSample: true, unitPrice: null }] }) });
  const suppliers = nodes(sample).find((node) => node.type === "section" && node.props["aria-label"] === "供应商与订单");
  assert.match(textOf(suppliers), /寄样供应商丁/);
  assert.match(textOf(suppliers), /免费样品.*无正式采购单号/);
  assert.doesNotMatch(textOf(suppliers), /尚未关联采购订单/);
  const quoteOnly = render({ task: task({ selectedQuotationId: "quote-only-a" }) });
  const empty = nodes(quoteOnly).find((node) => node.type === "section" && node.props["aria-label"] === "供应商与订单");
  assert.match(textOf(empty), /尚未关联采购订单/);
  assert.doesNotMatch(textOf(empty), /quote-only-a|供应商未确定|联系人|联系电话/);
});
