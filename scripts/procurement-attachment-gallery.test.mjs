import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/ProcurementTaskCard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("card.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = ast.statements.filter(ts.isImportDeclaration).flatMap((node) =>
  node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    ? node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly).map((item) => item.name.text) : []);
const code = ts.transpileModule(ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

function fixture(attachmentCount = 8) {
  const attachments = Array.from({ length: attachmentCount }, (_, i) => ({ id: `file-${i + 1}`, fileName: i === 4 ? "说明.pdf" : `图纸-${i + 1}.png`,
    mimeType: i === 4 ? "application/pdf" : "image/png", fileSize: 1000, fileUrl: `/original/${i + 1}`, thumbUrl: `/thumb/${i + 1}` }));
  const task = { id: "task-1", code: "PR-001", status: "priced", method: "inquiry", quantity: 1, arrivedQty: 0, priority: "low", logs: [],
    buyer: "采购员", materialName: "组件", unit: "件", source: "rd", businessLine: "rd", paymentStatus: "unpaid", attachmentList: attachments, attachments: attachmentCount };
  const slots = [];
  let cursor = 0;
  let effects = [];
  const overlayChanges = [];
  const onOverlayOpenChange = (taskId, open) => overlayChanges.push({ taskId, open });
  let taskOpens = 0;
  let stopped = 0;
  const stubs = Object.fromEntries(imports.map((name) => [name, name]));
  Object.assign(stubs, {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    useI18n: () => ({ t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? key) }),
    useProcCan: () => () => false,
    PROC_STATUS_META: { priced: { label: "已定价" } },
    taskRequester: () => ({ name: "研发员" }), taskMainDate: () => ({}), isProcurementTaskOverdue: () => false,
    removalModeOf: () => "delete", cn: (...args) => args.filter(Boolean).join(" "),
    isImagePreviewSource: (mime) => mime.startsWith("image/"),
  });
  const exports = {};
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) };
  new Function("React", "exports", "stubs", `const { ${imports.join(", ")} } = stubs;\n${code}`)(React, exports, stubs);
  const renderCard = () => {
    cursor = 0;
    effects = [];
    const card = exports.ProcurementTaskCard({ task, materials: [], onOpen() { taskOpens++; }, onOverlayOpenChange });
    effects.forEach((commit) => commit());
    return card;
  };
  const render = () => renderCard().props.children({ openEditor() {} });
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const find = (predicate) => nodes(render()).find(predicate);
  return {
    attachments, task, find, overlayChanges, nodes: () => nodes(render()),
    setEditorOpen(open) { renderCard().props.onOpenChange(open); render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    click(node) { assert.ok(node); node.props.onClick({ stopPropagation() { stopped++; } }); },
    preview: () => find((node) => node.type === "AttachmentPreviewDialog"),
    get taskOpens() { return taskOpens; }, get stopped() { return stopped; },
  };
}

test("卡片仅加载前三个缩略图，任意预览传完整附件，隐藏图片和文档均保留", () => {
  const ui = fixture();
  assert.deepEqual(ui.nodes().filter((node) => node.type === "img").map((node) => node.props.src), ["/thumb/1", "/thumb/2", "/thumb/3"]);
  const second = ui.find((node) => node.props?.["aria-label"] === "预览附件：图纸-2.png");
  ui.click(second);
  const preview = ui.preview();
  assert.equal(preview.props.attachment.id, "file-2");
  assert.equal(preview.props.attachment.url, "/original/2");
  assert.equal(preview.props.attachments.length, 8);
  assert.equal(preview.props.attachments[4].mime, "application/pdf");
  assert.equal(preview.props.attachments.at(-1).name, "图纸-8.png");
  assert.equal(ui.taskOpens, 0);
  assert.equal(ui.stopped, 1);
  preview.props.onClose();
  assert.equal(ui.preview(), undefined);
});

test("附件数量和查看全部入口均打开完整图库，且不会打开任务详情", () => {
  const ui = fixture();
  ui.click(ui.find((node) => node.props?.["aria-label"] === "查看全部 8 个附件"));
  assert.equal(ui.preview().props.attachment.id, "file-1");
  ui.preview().props.onClose();
  ui.click(ui.find((node) => node.type === "button" && node.props.children?.includes?.("查看全部（另 5 个）")));
  assert.equal(ui.preview().props.attachments.length, 8);
  assert.equal(ui.taskOpens, 0);
  assert.equal(ui.nodes().filter((node) => node.props?.["aria-label"] === "查看任务").length, 1, "避免头部和底部重复任务查看按钮");
});

test("无附件任务没有空图库入口，单附件仍可预览与关闭", () => {
  const empty = fixture(0);
  assert.equal(empty.nodes().some((node) => node.props?.["aria-label"]?.startsWith("查看全部")), false);
  assert.equal(empty.preview(), undefined);
  const single = fixture(1);
  single.click(single.find((node) => node.props?.["aria-label"] === "预览附件：图纸-1.png"));
  assert.equal(single.preview().props.attachments.length, 1);
  single.preview().props.onClose();
  assert.equal(single.preview(), undefined);
});

test("关闭附件不清除仍打开的库存编辑状态，卡片卸载会释放瀑布流暂停通知", () => {
  const ui = fixture(1);
  ui.click(ui.find((node) => node.props?.["aria-label"] === "预览附件：图纸-1.png"));
  const preview = ui.preview();
  assert.deepEqual(ui.overlayChanges.at(-1), { taskId: ui.task.id, open: true });
  ui.setEditorOpen(true);
  preview.props.onClose();
  assert.equal(ui.preview(), undefined);
  assert.equal(ui.overlayChanges.at(-1).open, true, "两个独立 useState 不能相互覆盖");
  ui.setEditorOpen(false);
  assert.equal(ui.overlayChanges.at(-1).open, false);
  ui.click(ui.find((node) => node.props?.["aria-label"] === "预览附件：图纸-1.png"));
  ui.preview();
  ui.unmount();
  assert.deepEqual(ui.overlayChanges.at(-1), { taskId: ui.task.id, open: false });
});
