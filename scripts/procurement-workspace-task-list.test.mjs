import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(source, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}
function declarations(path, names) {
  const source = read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter((node) => names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => names.includes(item.name.getText(ast))))
    .map((node) => node.getText(ast)).join("\n");
}
const common = compile(declarations("src/app/procurement/components/common.tsx", ["PROC_STATUS_META", "procurementNextAction"]));
const actions = compile(declarations("src/app/procurement/components/taskActions.tsx", ["DECISION_STATUSES", "nextPermissionOf"]));
const data = compile(declarations("src/app/procurement/data.ts", ["ONE_DAY", "ARRIVAL_STATUSES", "daysFromToday", "taskMainDate", "isProcurementTaskOverdue"]));
const suppliers = compile(declarations("src/app/procurement/procurementWorkspaceModel.ts", ["workspaceSuppliers"]));
const images = compile(declarations("src/app/components/MobileZoomableImage.tsx", ["IMAGE_FILE_EXTENSION", "isImagePreviewSource"]));
const jsx = (type, props, key) => ({ type, props, key });
const primitives = new Proxy({}, { get: (_target, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key);
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
const find = (tree, type, label) => nodes(tree).find((node) => node.type === type && (label === undefined || text(node) === label));
const task = (extra = {}) => ({ id: "task-1", code: "PROC-001", materialName: "精密阀体", materialId: "material-1", spec: "316L / 20 mm", unit: "件", method: "inquiry", source: "rd", status: "in_transit", priority: "medium", quantity: 20, arrivedQty: 5, needDate: "2999-09-20", expectedArrivalDate: "2999-09-21", attachmentList: [], purchaseOrders: [{ supplierName: "阀门供应商" }], ...extra });
function fixture({ tasks = [task()], materials = [], permissions = [], disabled = false } = {}) {
  const calls = { selected: [], next: [] };
  const source = compile(read("src/app/procurement/samples/sampleProductImageSource.ts"), {
    "../../components/MobileZoomableImage": images,
    "../../lib/procurementApi": { listMaterials: async () => materials.map((material) => ({ ...material, imageUrl: `renewed:${material.id}` })) },
    "../../lib/resourceAccess": { requestResourceRefresh: (_key, refresh) => refresh() },
    "../../lib/attachmentAccess": { procurementAttachmentPreview: (_id, file) => ({ id: file.id, name: file.fileName, mime: file.mimeType, url: file.fileUrl, thumbUrl: file.thumbUrl, refresh: async () => ({ id: file.id, name: file.fileName, mime: file.mimeType, url: `renewed:${file.id}`, thumbUrl: `renewed-thumb:${file.id}` }) }) },
  });
  const { ProcWorkspaceTaskList } = compile(read("src/app/procurement/components/ProcWorkspaceTaskList.tsx"), {
    react: { useMemo: (callback) => callback(), useState: (value) => [value, () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": primitives,
    "../../components/RenewableImage": primitives, "../../components/ui/button": primitives, "../../components/ui/table": primitives,
    "../../components/ui/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../../lib/i18n": { useI18n: () => ({ t: translate }) }, "../data": data,
    "../procurementWorkspaceModel": suppliers, "../samples/sampleProductImageSource": source,
    "./common": { ...common, PriorityBadge: "PriorityBadge", StatusPill: "StatusPill", useProcCan: () => (permission) => permissions.includes(permission) },
    "./taskActions": actions,
  });
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (typeof tree.type === "function") return expand(tree.type(tree.props));
    return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
  }
  return { calls, tree: expand(ProcWorkspaceTaskList({ tasks, materials, selectedId: "task-1", disabled, onSelect: (id) => calls.selected.push(id), onNext: (row) => calls.next.push(row) })) };
}

test("个人工作台使用紧凑系统表格与真实到货数量，选中入口只打开对应详情", () => {
  const { tree, calls } = fixture();
  assert.deepEqual(nodes(tree).filter((node) => node.type === "TableHead").map(text), ["任务编号", "事项", "所属业务", "当前节点", "截止", "状态", "下一步", "操作"]);
  assert.equal(find(tree, "Table").props.containerClassName, "overflow-visible");
  assert.match(find(tree, "TableHeader").props.className, /sticky top-0/);
  assert.match(text(tree), /已到货5 件未到货15 件/);
  assert.doesNotMatch(text(tree), /当前缺料|可用库存/);
  const row = nodes(tree).find((node) => node.type === "TableRow" && node.props["data-task-id"] === "task-1");
  assert.equal(row.props["data-state"], "selected");
  row.props.onClick({ target: { closest: () => null } });
  row.props.onClick({ target: { closest: () => ({}) } });
  nodes(tree).find((node) => node.type === "Button" && node.props["aria-pressed"]).props.onClick();
  find(tree, "Button", "查看").props.onClick();
  assert.deepEqual(calls.selected, ["task-1", "task-1", "task-1"]);
});

test("异常数量不冒充零余量，已完成任务不展示逾期", () => {
  const inconsistent = fixture({ tasks: [task({ quantity: 20, arrivedQty: 25 })] }).tree;
  assert.match(text(inconsistent), /已到货25 件未到货待核对/);
  const unknown = fixture({ tasks: [task({ quantity: Number.NaN, arrivedQty: -1 })] }).tree;
  assert.match(text(unknown), /需求数量待核对/);
  assert.doesNotMatch(text(unknown), /NaN|-1 件/);
  const zero = fixture({ tasks: [task({ quantity: 0, arrivedQty: 0, status: "completed", expectedArrivalDate: "2000-01-01" })] }).tree;
  assert.match(text(zero), /已到货0 件未到货0 件/);
  assert.doesNotMatch(text(zero), /已逾期/);
});

test("真实物料图片及附件缩略图均支持续签，没有图片时显示占位", async () => {
  const materials = [{ id: "material-1", name: "阀体", erpCode: "Q7", imageUrl: "material-photo" }];
  const linked = fixture({ materials }).tree;
  const product = find(linked, "RenewableImage");
  assert.equal(product.props.src, "material-photo");
  assert.equal(await product.props.refresh(), "renewed:material-1");
  assert.match(text(linked), /Q7 · PROC-001/);
  const attachment = task({ attachmentList: [{ id: "doc", fileName: "规格.pdf", fileUrl: "document" }, { id: "photo", fileName: "物料.jpg", fileUrl: "original", thumbUrl: "thumbnail", mimeType: "image/jpeg" }] });
  const fallback = find(fixture({ tasks: [attachment], materials: [{ ...materials[0], id: "unrelated" }] }).tree, "RenewableImage");
  assert.equal(fallback.props.src, "thumbnail");
  assert.equal(await fallback.props.refresh(), "renewed-thumb:photo");
  assert.equal(find(fixture().tree, "RenewableImage"), undefined);
  assert.match(text(fixture().tree), /暂无产品图/);
});

test("下一步继续沿用权限与决策语义，忙碌时按钮不可点击", () => {
  for (const [status, source, permission, label] of [
    ["pending_confirm", "rd", "proc-task:confirm", "审核通过"],
    ["pending_confirm", "self", "proc-task:confirm", "接收采购需求"],
    ["testing", "rd", "proc-task:inquiry", "查看并处理"],
    ["in_transit", "self", "proc-task:receive", "登记到货"],
  ]) {
    const row = task({ status, source });
    assert.equal(find(fixture({ tasks: [row] }).tree, "Button", label), undefined);
    const { tree, calls } = fixture({ tasks: [row], permissions: [permission] });
    find(tree, "Button", label).props.onClick();
    assert.deepEqual(calls.next, [row]);
    const locked = fixture({ tasks: [row], permissions: [permission], disabled: true }).tree;
    assert.ok(nodes(locked).filter((node) => node.type === "Button").every((node) => node.props.disabled));
  }
});
