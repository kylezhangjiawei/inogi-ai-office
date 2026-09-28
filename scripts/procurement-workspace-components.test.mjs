import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function compile(source, dependencies = {}) {
  const exports = {};
  new Function("exports", "require", "window", transpile(source))(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  }, undefined);
  return exports;
}
function declarations(path, names) {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter((node) => names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(ast))))
    .map((node) => node.getText(ast)).join("\n");
}
const common = compile(declarations("src/app/procurement/components/common.tsx", ["PROC_STATUS_META", "procurementNextAction", "ROLLBACK_MAIN_FLOW", "ROLLBACK_DIRECT_FLOW", "rollbackTargetsOf"]));
const actions = compile(declarations("src/app/procurement/components/taskActions.tsx", ["DECISION_STATUSES", "TERMINAL_STATUSES", "NOT_STARTED_STATUSES", "removalModeOf", "nextPermissionOf"]));
const image = compile(declarations("src/app/components/MobileZoomableImage.tsx", ["IMAGE_FILE_EXTENSION", "isImagePreviewSource"]));
const productImage = compile(read("src/app/procurement/samples/sampleProductImageSource.ts"), {
  "../../components/MobileZoomableImage": image,
  "../../lib/procurementApi": {}, "../../lib/resourceAccess": {},
  "../../lib/attachmentAccess": { procurementAttachmentPreview: (_taskId, file) => ({ id: file.id, name: file.fileName, mime: file.mimeType, url: file.fileUrl, thumbUrl: file.thumbUrl }) },
});
const data = compile(read("src/app/procurement/data.ts"), {
  react: {}, "../auth": {}, "../lib/authSession": { addAuthClearedListener() {} }, "../lib/procurementApi": {}, "../lib/rdApi": {},
});
const model = compile(read("src/app/procurement/procurementWorkspaceModel.ts"), { "./data": data });
const sampleFacts = compile(read("src/app/lib/procSampleFacts.ts"));
const sampleModel = compile(read("src/app/procurement/sampleWorkspaceModel.ts"), { "../lib/procSampleFacts": sampleFacts });
const jsx = (type, props, key) => ({ type, props, key });

// Execute local helper components as well; UI primitives stay inspectable objects.
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
function render(component, props, permissions = []) {
  const path = `src/app/procurement/components/${component}.tsx`;
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = ast.statements.filter(ts.isImportDeclaration).flatMap((node) => !node.importClause?.isTypeOnly && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    ? node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : []);
  const stubs = Object.fromEntries(imports.map((name) => [name, name]));
  Object.assign(stubs, common, actions, image, productImage, data, model, sampleFacts, sampleModel, {
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (current) => ({ current }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect() {},
    useAuth: () => ({ user: { id: "buyer", name: "采购张工" } }),
    usePermission: (code) => permissions.includes(code),
    useAnyPermission: (...codes) => codes.some((code) => permissions.includes(code)),
    useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key) }),
    useProcCan: () => (code) => Boolean(code && permissions.includes(code)),
    routePath: (_permission, fallback) => fallback,
    cn: (...values) => values.filter(Boolean).join(" "),
    AutoTranslatedText: ({ text }) => jsx("span", { children: text }),
  });
  const body = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n");
  const exports = {};
  new Function("exports", "stubs", "require", `const {${imports.join(",")}} = stubs;\n${transpile(body)}`)(exports, stubs, (name) => {
    assert.equal(name, "react/jsx-runtime");
    return { jsx, jsxs: jsx, Fragment: "Fragment" };
  });
  return expand(exports[component](component === "ProcWorkspaceArrivals" ? { open: true, page: 1, onOpenChange() {}, onPageChange() {}, onOpenOrderLine() {}, ...props } : props));
}
const order = (id, overrides = {}) => ({ id, tpOrderNo: `PO-${id}`, tpLineNo: "1", supplierName: "供应商甲", orderedQty: 20, receivedQty: 3, unitPrice: 2, etaDate: "2999-09-18", ...overrides });
const task = (id = "one", overrides = {}) => ({
  id, code: `PR-${id}`, materialName: "阀体", materialId: `material-${id}`, spec: "M20", unit: "件", productId: "product-A",
  method: "inquiry", source: "rd", businessLine: "rd", status: "testing", priority: "medium", quantity: 20, arrivedQty: 0,
  buyer: "采购员", requester: "研发员", requesterDept: "研发部", needSample: true, needDate: "2999-09-20",
  rdTaskId: "RD one/42", attachmentList: [], purchaseOrders: [], rdTransferSnapshots: [], logs: [], ...overrides,
});
const permissions = ["proc-task:inquiry", "proc-task:select-quote", "proc-task:reassign", "proc-task:delete", "proc-task:rollback", "page:rd-my-workspace", "page:proc-cockpit"];
const panelProps = (value = task(), overrides = {}) => ({ task: value, onOpenDetail() {}, onNext() {}, onReassign() {}, onRemove() {}, onNavigateRelated() {}, ...overrides });
const listProps = (tasks, overrides = {}) => ({ tasks, materials: [], selectedId: null, onSelect() {}, onNext() {}, ...overrides });
const control = (tree, label) => nodes(tree).find((node) => ["Button", "DropdownMenuItem", "button"].includes(node.type) && textOf(node) === label);
const fact = (tree, label) => nodes(tree).find((node) => node.type === "div" && nodes(node).some((child) => child.type === "dt" && textOf(child) === label));

test("右侧动作逐项使用真实权限；没有权限时仍能查看资料但不暴露处理或关联入口", () => {
  const restricted = render("ProcWorkspaceTaskPanel", panelProps());
  for (const label of ["安排研发测试", "回退", "转派", "取消任务", "查看关联研发任务", "打开样品协同"]) assert.equal(control(restricted, label), undefined, label);
  assert.ok(control(restricted, "完整详情"));
  for (const [permission, label] of [
    ["proc-task:inquiry", "安排研发测试"], ["proc-task:rollback", "回退"], ["proc-task:reassign", "转派"],
    ["proc-task:delete", "取消任务"], ["page:rd-my-workspace", "查看关联研发任务"], ["page:proc-cockpit", "打开样品协同"],
  ]) {
    const allowed = render("ProcWorkspaceTaskPanel", panelProps(), [permission]);
    assert.ok(control(allowed, label), permission);
    assert.equal(control(render("ProcWorkspaceTaskPanel", panelProps(), permissions.filter((item) => item !== permission)), label), undefined, `缺少 ${permission}`);
  }
  assert.ok(control(render("ProcWorkspaceTaskPanel", panelProps(), ["page:rd-task-management"]), "查看关联研发任务"));
});

test("已结束或待研发审核不提供非法推进和回退，删除与取消沿用原任务规则", () => {
  for (const [status, removal] of [["pending_rd_review", null], ["completed", "删除"], ["cancelled", "删除"], ["pending_inquiry", "删除"], ["testing", "取消任务"]]) {
    const tree = render("ProcWorkspaceTaskPanel", panelProps(task("status", { status })), permissions);
    assert.equal(Boolean(control(tree, "取消任务")), removal === "取消任务");
    assert.equal(Boolean(control(tree, "删除")), removal === "删除");
    if (["completed", "cancelled", "pending_rd_review"].includes(status)) {
      assert.equal(control(tree, "回退"), undefined);
      assert.equal(nodes(tree).filter((node) => node.type === "Button" && node.props.onClick).length, 5, "只保留详情、记录、转派、研发与样品跳转");
    }
  }
});

test("操作阻塞时禁用右侧动作、关联跳转、列表和到货选择", () => {
  const value = task("busy", { purchaseOrders: [order("busy")] });
  const panel = render("ProcWorkspaceTaskPanel", panelProps(value, { blocked: true }), permissions);
  for (const node of nodes(panel).filter((node) => node.props?.onClick || node.props?.onSelect)) assert.equal(node.props.disabled, true, textOf(node));
  assert.ok(nodes(panel).filter((node) => node.type === "Collapsible").every((node) => node.props.disabled));
  const list = render("ProcWorkspaceTaskList", listProps([value], { disabled: true }), permissions);
  assert.ok(nodes(list).filter((node) => node.props?.onClick).every((node) => node.props.disabled));
  const arrivals = render("ProcWorkspaceArrivals", { tasks: [value], onSelect() {}, disabled: true });
  assert.equal(arrivals.props.disabled, true);
  assert.ok(nodes(arrivals).filter((node) => node.props?.onClick).every((node) => node.props.disabled));
});

test("决策动作只转交原处理器，详情、记录、回退与关联跳转分别携带选中任务", () => {
  const calls = [];
  const value = task("decision", { status: "inquiring" });
  const before = structuredClone(value);
  const panel = render("ProcWorkspaceTaskPanel", panelProps(value, {
    onOpenDetail: (current, action) => calls.push(["detail", current.id, action]), onNext: (current) => calls.push(["next", current.id]),
    onReassign: (current) => calls.push(["reassign", current.id]), onRemove: (current) => calls.push(["remove", current.id]),
    onNavigateRelated: (path) => calls.push(["navigate", path]),
  }), permissions);
  for (const label of ["完成询价", "完整详情", "操作记录", "回退", "转派", "取消任务", "查看关联研发任务", "打开样品协同"]) {
    const node = control(panel, label); assert.ok(node, label); (node.props.onClick ?? node.props.onSelect)();
  }
  assert.deepEqual(calls, [
    ["next", "decision"], ["detail", "decision", undefined], ["detail", "decision", "logs"], ["detail", "decision", "rollback"],
    ["reassign", "decision"], ["remove", "decision"], ["navigate", "/rd-task/RD%20one%2F42"], ["navigate", "/proc-cockpit?tab=samples&sample=decision"],
  ]);
  assert.deepEqual(value, before, "只读组件不推进状态或修改测试结论");
});

test("任务行查看与决策处理各调用一次正确入口，缺少处理权限时只保留查看", () => {
  const calls = [];
  const tasks = [task("a", { status: "inquiring" }), task("b", { status: "testing" })];
  const props = listProps(tasks, { selectedId: "b", onSelect: (id) => calls.push(["select", id]), onNext: (current) => calls.push(["next", current.id]) });
  const tree = render("ProcWorkspaceTaskList", props, permissions);
  const rows = nodes(tree).filter((node) => node.type === "TableRow" && node.key);
  assert.equal(rows[0].props["data-state"], undefined);
  assert.equal(rows[1].props["data-state"], "selected");
  control(rows[0], "查看并处理").props.onClick();
  control(rows[1], "查看").props.onClick();
  nodes(rows[1]).find((node) => node.props?.["aria-pressed"] === true).props.onClick();
  assert.deepEqual(calls, [["next", "a"], ["select", "b"], ["select", "b"]]);
  const restricted = render("ProcWorkspaceTaskList", props);
  assert.equal(control(restricted, "查看并处理"), undefined);
  assert.equal(nodes(restricted).filter((node) => node.props?.["aria-label"]?.startsWith("查看任务：")).length, 2);
});

test("任务图片只使用真实物料/附件来源，缺缩略图回退原图；异常需求数量在两处均待核对", () => {
  const pdf = { fileName: "drawing.pdf", mimeType: "application/pdf", fileUrl: "/actual/drawing.pdf" };
  const photo = { fileName: "photo.png", mimeType: "image/png", fileUrl: "/actual/original.png", thumbUrl: "/actual/thumb.png" };
  const tasks = [task("material", { attachmentList: [photo] }), task("thumb", { attachmentList: [pdf, photo] }), task("original", { attachmentList: [{ ...photo, thumbUrl: undefined }] }), task("no-image", { attachmentList: [pdf] })];
  const tree = render("ProcWorkspaceTaskList", listProps(tasks, { materials: [{ id: "material-material", imageUrl: "/actual/material.png" }] }));
  assert.deepEqual(nodes(tree).filter((node) => node.type === "RenewableImage").map((node) => node.props.src), ["/actual/material.png", "/actual/thumb.png", "/actual/original.png"]);
  for (const quantity of [NaN, Infinity, -1]) {
    const invalid = task("invalid", { quantity });
    const panel = render("ProcWorkspaceTaskPanel", panelProps(invalid));
    assert.match(textOf(fact(panel, "需求数量")), /待核对/);
    const list = render("ProcWorkspaceTaskList", listProps([invalid]));
    const cell = nodes(list).find((node) => node.props?.className === "proc-s01-material");
    assert.match(textOf(cell), /待核对/);
    assert.doesNotMatch(textOf(cell), /NaN|Infinity|-1/);
    const arrival = nodes(list).find((node) => node.props?.className === "proc-s01-material");
    assert.match(textOf(arrival), /未到货待核对/);
  }
});

test("到货组件保留免费样品与无 ETA 行，超收待核对，点击各订单行返回对应任务", () => {
  const tasks = [
    task("undated", { expectedArrivalDate: "2999-10-01", purchaseOrders: [order("undated", { etaDate: undefined })] }),
    task("free", { purchaseOrders: [order("free", { freeSample: true, tpOrderNo: "", tpLineNo: undefined })] }),
    task("over", { purchaseOrders: [order("over", { orderedQty: 10, receivedQty: 12 })] }),
  ];
  const calls = [];
  const tree = render("ProcWorkspaceArrivals", { tasks, onSelect: (id) => calls.push(id) });
  const groups = nodes(tree).filter((node) => node.type === "section");
  assert.deepEqual(groups.map((node) => node.props["aria-label"]), ["已填写预计到货日期", "日期待确认"]);
  assert.doesNotMatch(textOf(groups[1]), /2999-10-01/, "不拿任务到货日期代替订单行 ETA");
  assert.match(textOf(groups[1]), /待确认/);
  const buttons = nodes(tree).filter((node) => node.type === "Button" && node.props["aria-label"]?.startsWith("查看到货任务："));
  const arrivalRows = nodes(tree).filter((node) => node.type === "li");
  const free = buttons.find((node) => node.props["aria-label"].includes("PR-free"));
  const freeRow = arrivalRows.find((node) => textOf(node).includes("PR-free"));
  assert.match(textOf(freeRow), /无正式采购单号/); assert.match(textOf(freeRow), /免费样品/);
  const over = buttons.find((node) => node.props["aria-label"].includes("PR-over"));
  const overRow = arrivalRows.find((node) => textOf(node).includes("PR-over"));
  assert.match(textOf(overRow), /未收数量\s*待核对/); assert.doesNotMatch(textOf(overRow), /-2|0 件/);
  for (const id of ["undated", "free", "over"]) buttons.find((node) => node.props["aria-label"].includes(`PR-${id}`)).props.onClick();
  assert.deepEqual(calls, ["undated", "free", "over"]);
  const panel = render("ProcWorkspaceTaskPanel", panelProps(tasks[2]));
  assert.match(textOf(fact(panel, "未收数量")), /待核对/);
});
