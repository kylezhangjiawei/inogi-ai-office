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
const actions = compile(declarations("src/app/procurement/components/taskActions.tsx", ["DECISION_STATUSES", "TERMINAL_STATUSES", "NOT_STARTED_STATUSES", "removalModeOf", "nextPermissionOf"]));
const data = compile(declarations("src/app/procurement/data.ts", ["ONE_DAY", "ARRIVAL_STATUSES", "daysFromToday", "taskMainDate", "isProcurementTaskOverdue"]));
const imageDetection = compile(declarations("src/app/components/MobileZoomableImage.tsx", ["IMAGE_FILE_EXTENSION", "isImagePreviewSource"]));
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
const task = (extra = {}) => ({ id: "task-1", code: "PROC-001", materialName: "精密阀体", spec: "316L / 20 mm", unit: "件", method: "inquiry", source: "rd", businessLine: "rd", status: "pending_confirm", priority: "high", quantity: 20, arrivedQty: 5, buyer: "采购李工", needDate: "2999-09-20", paymentStatus: "partial", attachmentList: [], criticalMaterials: [], ...extra });

function fixture({ tasks = [task()], permissions = [], callbacks = {} } = {}) {
  const state = new Map();
  const calls = { opened: [], next: [], reassigned: [], removed: [], overlay: [], editors: [] };
  let active; let cursor = 0; let effects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++; const slots = active;
      if (!(index in slots)) slots[index] = { value: initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useEffect(callback, deps) {
      const index = cursor++; const previous = active[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next = { deps }; active[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const { ProcurementTaskTable } = compile(read("src/app/procurement/components/ProcurementTaskTable.tsx"), {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" }, "lucide-react": primitives,
    "../../components/AttachmentPreviewDialog": primitives,
    "../../components/MobileZoomableImage": imageDetection,
    "../../components/RenewableImage": primitives,
    "../../components/TranslatableText": { AutoTranslatedText: ({ as = "span", text: content, ...props }) => jsx(as, { ...props, children: content }) },
    "../../components/ui/button": primitives, "../../components/ui/dropdown-menu": primitives, "../../components/ui/table": primitives,
    "../../components/ui/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../../lib/attachmentAccess": { procurementAttachmentPreview: (taskId, file) => ({ id: file.id, name: file.fileName, url: file.fileUrl, thumbUrl: file.thumbUrl, refresh: async () => ({ url: `renewed:${taskId}:${file.id}`, thumbUrl: file.thumbUrl ? `renewed-thumb:${taskId}:${file.id}` : undefined }) }) },
    "../../lib/i18n": { useI18n: () => ({ t: translate }) }, "../data": data,
    "./common": { ...common, BusinessLinePill: "BusinessLinePill", PersonAvatar: "PersonAvatar", PriorityBadge: "PriorityBadge", StatusPill: "StatusPill", useProcCan: () => (code) => Boolean(code && permissions.includes(code)) },
    "./TaskCriticalMaterials": { TaskCriticalMaterialsEditor: "TaskCriticalMaterialsEditor" }, "./taskActions": actions,
  });
  const props = { tasks, materials: [], onOpen: (value) => calls.opened.push(value), onNext: (value) => calls.next.push(value), onReassign: (value) => calls.reassigned.push(value), onRemove: (value) => calls.removed.push(value), onOverlayOpenChange: (id, open) => calls.overlay.push([id, open]), ...callbacks };
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (typeof tree.type === "function") {
      const key = `${tree.type.name}:${tree.props.task?.id ?? "root"}`;
      if (!state.has(key)) state.set(key, []);
      active = state.get(key); cursor = 0;
      return expand(tree.type(tree.props));
    }
    if (tree.type === "TaskCriticalMaterialsEditor") return { ...tree, props: { ...tree.props, children: expand(tree.props.children({ openEditor: () => { calls.editors.push(tree.props.task); tree.props.onOpenChange(true); } })) } };
    return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
  }
  return {
    calls,
    render() { effects = []; const tree = expand(ProcurementTaskTable(props)); effects.forEach((effect) => effect()); return tree; },
    unmount() { for (const slots of state.values()) for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("表格保留十列语义与原任务事实，标题和查看回调只打开对应任务", () => {
  const row = task(); const f = fixture({ tasks: [row] }); const tree = f.render();
  const headers = nodes(tree).filter((node) => node.type === "TableHead");
  assert.equal(headers.length, 10);
  assert.ok(headers.every((node) => node.props.scope === "col"));
  assert.equal(headers[1].props.className, "proc-horizon-task-col-attachments");
  assert.equal(text(headers[1]), "附件");
  assert.match(find(tree, "TableHeader").props.className, /sticky top-0 z-10 bg-card/);
  assert.equal(find(tree, "Table").props.containerClassName, "overflow-visible");
  const rowElement = nodes(tree).find((node) => node.type === "TableRow" && node.props["data-task-id"]);
  rowElement.props.onClick({ target: { closest: () => null } });
  rowElement.props.onClick({ target: { closest: () => ({ tagName: 'BUTTON' }) } });
  assert.match(text(tree), /精密阀体316L \/ 20 mm/);
  assert.match(text(tree), /5 \/ 20 件/);
  assert.match(text(tree), /部分付款/);
  assert.equal(find(tree, "div")?.type, "div");
  const title = nodes(tree).find((node) => node.props?.["aria-label"] === "查看任务：精密阀体");
  title.props.onClick(); find(tree, "Button", "查看").props.onClick();
  assert.deepEqual(f.calls.opened, [row, row, row]);
  assert.equal(nodes(tree).find((node) => node.props?.role === "progressbar").props["aria-valuenow"], 25);
});

test("下一步沿用真实状态语义与权限，研发审核和采购自建接收不混淆", () => {
  for (const [status, source, permission, label] of [
    ["pending_confirm", "rd", "proc-task:confirm", "审核通过"],
    ["pending_confirm", "self", "proc-task:confirm", "接收采购需求"],
    ["inquiring", "rd", "proc-task:select-quote", "完成询价"],
    ["testing", "rd", "proc-task:inquiry", "安排研发测试"],
    ["pending_purchase", "self", "proc-task:order", "打开链接下单"],
  ]) {
    const row = task({ status, source, method: status === "pending_purchase" ? "direct" : "inquiry" });
    assert.equal(find(fixture({ tasks: [row] }).render(), "Button", label), undefined);
    const f = fixture({ tasks: [row], permissions: [permission] });
    find(f.render(), "Button", label).props.onClick();
    assert.deepEqual(f.calls.next, [row]);
    assert.equal(find(fixture({ tasks: [row], permissions: [permission], callbacks: { onNext: undefined } }).render(), "Button", label), undefined);
  }
});

test("更多菜单逐项控制库存、转派和处置权限，审核态不开放删除", () => {
  const row = task({ status: "testing" });
  const restricted = fixture({ tasks: [row] }).render();
  for (const label of ["库存设置", "转派", "取消任务", "删除"]) assert.equal(find(restricted, "DropdownMenuItem", label), undefined);
  const f = fixture({ tasks: [row], permissions: ["proc-task:reassign"] });
  find(f.render(), "DropdownMenuItem", "转派").props.onSelect();
  assert.deepEqual(f.calls.reassigned, [row]);
  for (const [status, label] of [["testing", "取消任务"], ["pending_confirm", "删除"], ["completed", "删除"], ["cancelled", "删除"], ["pending_rd_review", null]]) {
    const current = task({ status }); const enabled = fixture({ tasks: [current], permissions: ["proc-task:delete"] }); const tree = enabled.render();
    if (label) { find(tree, "DropdownMenuItem", label).props.onSelect(); assert.deepEqual(enabled.calls.removed, [current]); }
    else for (const action of ["删除", "取消任务"]) assert.equal(find(tree, "DropdownMenuItem", action), undefined);
  }
});

test("附件预览和库存弹窗上报当前任务，关闭或卸载释放切换保护", async () => {
  const row = task({ attachmentList: [{ id: "file-1", fileName: "图纸.png", fileUrl: "original", thumbUrl: "thumb" }] });
  const f = fixture({ tasks: [row], permissions: ["proc-task:create"] });
  const attachmentButton = nodes(f.render()).find((node) => node.type === "Button" && node.props["aria-label"] === "预览附件：图纸.png");
  attachmentButton.props.onClick();
  const preview = find(f.render(), "AttachmentPreviewDialog");
  assert.equal(preview.props.attachment.url, "original");
  assert.equal(preview.props.attachments.length, 1);
  assert.equal((await preview.props.attachment.refresh()).url, "renewed:task-1:file-1");
  assert.deepEqual(f.calls.overlay.at(-1), [row.id, true]);
  preview.props.onClose(); f.render();
  assert.deepEqual(f.calls.overlay.at(-1), [row.id, false]);
  find(f.render(), "DropdownMenuItem", "库存设置").props.onSelect(); f.render();
  assert.deepEqual(f.calls.editors, [row]);
  assert.deepEqual(f.calls.overlay.at(-1), [row.id, true]);
  f.unmount(); assert.deepEqual(f.calls.overlay.at(-1), [row.id, false]);
});

test("附件列图片优先用缩略图并续签，文档显示文件图标，更多入口保留完整预览序列", async () => {
  const files = [
    { id: "photo", fileName: "产品.PNG", fileUrl: "original-photo", thumbUrl: "photo-thumb", mimeType: "application/octet-stream" },
    { id: "document", fileName: "规格书.pdf", fileUrl: "original-pdf", mimeType: "application/pdf" },
    { id: "photo-2", fileName: "测量图.jpg", fileUrl: "original-photo-2", mimeType: "image/jpeg" },
  ];
  const f = fixture({ tasks: [task({ attachmentList: files })] });
  const tree = f.render();
  const column = nodes(tree).find((node) => node.type === "TableCell" && node.props.className === "proc-horizon-task-col-attachments");
  const image = find(column, "RenewableImage");
  assert.equal(image.props.src, "photo-thumb");
  assert.equal(image.props.loading, "lazy");
  assert.equal(await image.props.refresh(), "renewed-thumb:task-1:photo");
  assert.equal(nodes(column).filter((node) => node.type === "RenewableImage").length, 1);
  const documentButton = nodes(column).find((node) => node.type === "Button" && node.props["aria-label"] === "预览附件：规格书.pdf");
  assert.ok(find(documentButton, "FileText"));
  documentButton.props.onClick();
  assert.equal(find(f.render(), "AttachmentPreviewDialog").props.attachment.id, "document");
  find(f.render(), "AttachmentPreviewDialog").props.onClose();
  const more = nodes(f.render()).find((node) => node.type === "Button" && node.props["aria-label"] === "查看精密阀体的 3 个附件");
  assert.equal(text(more), "+1");
  more.props.onClick();
  const preview = find(f.render(), "AttachmentPreviewDialog");
  assert.equal(preview.props.attachment.id, "photo-2");
  assert.deepEqual(preview.props.attachments.map((file) => file.id), files.map((file) => file.id));
  assert.deepEqual(f.calls.overlay.at(-1), ["task-1", true]);
  assert.deepEqual(f.calls.opened, [], "附件操作不应顺带打开任务详情");

  const noThumbnail = fixture({ tasks: [task({ attachmentList: [files[2]] })] }).render();
  const originalImage = find(noThumbnail, "RenewableImage");
  assert.equal(originalImage.props.src, "original-photo-2");
  assert.equal(await originalImage.props.refresh(), "renewed:task-1:photo-2");
});

test("期限和逾期使用业务规则，终态不逾期，零数量与空列表可正常显示", () => {
  const old = "2000-01-01";
  const active = fixture({ tasks: [task({ status: "in_transit", deadline: "2999-01-01", expectedArrivalDate: old, quantity: 0, buyer: " " })] }).render();
  assert.match(text(active), /预计到货2000-01-01已逾期/);
  assert.match(text(active), /未指派/);
  assert.equal(nodes(active).find((node) => node.props?.role === "progressbar").props["aria-valuenow"], 0);
  const completed = fixture({ tasks: [task({ status: "completed", expectedArrivalDate: old })] }).render();
  assert.doesNotMatch(text(completed), /已逾期/);
  const empty = fixture({ tasks: [] }).render();
  assert.equal(find(empty, "TableCell").props.colSpan, 10);
  assert.match(text(empty), /暂无采购任务/);
});

function summaryFixture() {
  let user = { id: 'buyer', permissions: ['proc-task:create'] };
  const { ProcurementTaskSummaryDrawer } = compile(read('src/app/procurement/components/ProcurementTaskSummaryDrawer.tsx'), {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../auth': { useAuth: () => ({ user }) },
    '../../components/ui/sheet': primitives,
    './TaskDetailDrawer': primitives,
  });
  return { render: props => ProcurementTaskSummaryDrawer({ materials: [], onClose() {}, ...props }), setUser(value) { user = value; } };
}

test('右侧详情直接复用完整业务内容，非遮罩模式允许列表连续切换', () => {
  const f = summaryFixture(); let closed = 0;
  const current = task();
  const tree = f.render({ task: current, onClose() { closed++; } });
  assert.equal(find(tree, 'Sheet').props.modal, false);
  let prevented = false;
  find(tree, 'SheetContent').props.onInteractOutside({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const detail = find(tree, 'TaskDetailDrawer');
  assert.equal(detail.props.task, current);
  assert.equal(detail.props.presentation, 'embedded');
  assert.equal(detail.props.onExpand, undefined);
  detail.props.onClose(); assert.equal(closed, 1);
  find(tree, 'Sheet').props.onOpenChange(true); assert.equal(closed, 1);
  find(tree, 'Sheet').props.onOpenChange(false); assert.equal(closed, 2);
});

test('切换任务重置原详情表单和请求，同任务后台更新保留编辑状态', () => {
  const f = summaryFixture();
  const render = (id, updatedAt) => find(f.render({ task: task({ id, updatedAt }) }), 'TaskDetailDrawer');
  const first = render('A', 'v1');
  const refresh = render('A', 'v2');
  const switched = render('B', 'v1');
  assert.equal(first.key, refresh.key);
  assert.notEqual(first.key, switched.key);
  assert.equal(switched.props.task.id, 'B');
  f.setUser({ id: 'other-buyer', permissions: [] });
  assert.notEqual(switched.key, render('B', 'v1').key);
});
