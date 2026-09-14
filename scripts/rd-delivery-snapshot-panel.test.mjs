import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/components/RdDeliverySnapshotPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const translate = (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => key in data ? String(data[key]) : match);
const file = (version, overrides = {}) => ({ fileName: `图纸-${version}.pdf`, fileUrl: `/saved/${version}.pdf?sig=frozen`, fileKey: `saved/${version}.pdf`, fileSize: 1200, mimeType: "application/pdf", kind: "rd_drawing", technicalDocumentVersionId: `version-${version}`, documentId: "doc-1", version, category: "drawing", title: "阀体图纸", attachmentId: "same-source-file", sourceNoteId: "note-1", versionCreatedAt: "2026-09-09T01:00:00Z", ...overrides });
const snapshot = (id, version, overrides = {}) => ({ id, submittedAt: "2026-09-09T02:00:00Z", submittedBy: `person-${id}`, submittedByName: `提交人-${id}`, rdTaskId: "RD-1", rdTaskTitle: `交付任务-${id}`, requirement: { productId: "product-1", materialName: `需求-${id}`, spec: `规格-${id}`, unit: "件", quantity: id === "old" ? 12 : 24, purchaseLink: null, needDate: "2026-09-15", deadline: "2026-09-12", note: `备注-${id}` }, attachments: [file(version)], ...overrides });

function fixture(initialTask = { id: "task-1", rdTransferSnapshots: [snapshot("old", "A"), snapshot("new", "B")] }, compact = false) {
  let task = initialTask;
  const slots = [];
  let cursor = 0;
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  const require = (name) => {
    if (name === "react") return { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name.endsWith("/i18n")) return { useI18n: () => ({ t: translate, lang: "zh" }) };
    if (name.endsWith("/ui/utils")) return { cn: (...classes) => classes.filter(Boolean).join(" ") };
    if (name === "lucide-react" || name.includes("/components/")) return new Proxy({}, { get: (_, property) => property });
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "exports", code)(require, exports);
  function expand(node) {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  const render = () => { cursor = 0; return expand(exports.RdDeliverySnapshotPanel({ task, compact })); };
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
  const find = (predicate) => nodes(render()).find(predicate);
  return {
    ...exports, render, text: () => text(render()), all: () => nodes(render()),
    find, update(next) { task = next; return render(); },
    preview: () => find((node) => node.type === "AttachmentPreviewDialog"),
    clickFile(name) { const button = find((node) => node.type === "Button" && node.props["aria-label"] === `预览交付文件：${name}`); assert.ok(button, name); button.props.onClick(); },
  };
}

test("本次和历史交付使用各自冻结的需求、提交人与版本，保留提交顺序且不修改输入", () => {
  const original = { id: "task-1", rdTransferSnapshots: [snapshot("old", "A"), snapshot("new", "B")] };
  const before = structuredClone(original);
  original.rdTransferSnapshots.forEach((item) => { Object.freeze(item.attachments); Object.freeze(item.requirement); Object.freeze(item); });
  Object.freeze(original.rdTransferSnapshots);
  const ui = fixture(original);
  const articles = ui.all().filter((node) => node.type === "article");
  assert.equal(articles[0].props["aria-label"], "本次交付");
  assert.equal(articles[1].props["aria-label"], "第 1 次交付");
  assert.match(ui.text(), /提交人-new.*需求-new.*规格-new.*24 件.*版本 B.*提交人-old.*需求-old.*规格-old.*12 件.*版本 A/s);
  assert.deepEqual(original, before);
  const collapse = ui.find((node) => node.type === "Collapsible");
  assert.equal(collapse.props.defaultOpen, undefined, "历史默认收起");
  assert.equal(collapse.key, "task-1", "切换任务不继承上一任务的展开状态");
});

test("预览及下载历史资料都使用当次文件，即使来源附件 ID 相同也不打开新版本", () => {
  const ui = fixture();
  ui.clickFile("图纸-A.pdf");
  const preview = ui.preview();
  assert.equal(preview.props.attachment.url, "/saved/A.pdf?sig=frozen");
  assert.equal(preview.props.attachment.downloadUrl, "/saved/A.pdf?sig=frozen");
  assert.equal(preview.props.attachment.id, "old:0");
  assert.equal(preview.props.attachments, undefined, "不把另一交付的新版本混入同一预览图库");
  const download = ui.find((node) => node.type === "a" && node.props["aria-label"] === "下载交付文件：图纸-A.pdf");
  assert.equal(download.props.href, "/saved/A.pdf?sig=frozen");
  assert.equal(download.props.download, "图纸-A.pdf");
  assert.equal(download.props.rel, "noopener noreferrer");
  preview.props.onClose();
  assert.equal(ui.preview(), undefined);
});

test("旧采购无快照、交付无文件、未登记版本与空文件分别显示，不补造记录", () => {
  const empty = fixture({ id: "legacy" });
  assert.match(empty.text(), /历史采购未保存交付版本快照/);
  assert.equal(empty.all().some((node) => node.type === "article"), false);
  const noFiles = fixture({ id: "task-1", rdTransferSnapshots: [snapshot("new", "B", { attachments: [] })] });
  assert.match(noFiles.text(), /本次交付未附带文件/);
  const unversioned = fixture({ id: "task-1", rdTransferSnapshots: [snapshot("new", "B", { submittedAt: "bad date", submittedByName: "", attachments: [file(null, { fileName: "原始说明.txt", fileSize: 0 })] })] });
  assert.match(unversioned.text(), /未记录提交人.*未记录日期.*未登记版本.*0 B · 空文件/s);
  assert.doesNotMatch(unversioned.text(), /版本 A|版本 B|Invalid Date/);
});

test("空地址与主动脚本不生成预览或下载入口，真实签名链接和历史嵌入文件可用", () => {
  const ui = fixture({ id: "task-1", rdTransferSnapshots: [snapshot("new", "B", { attachments: [file("B", { fileUrl: "javascript:alert(1)" })] })] });
  for (const unsafe of ["", "javascript:alert(1)", "data:text/html,<script></script>", "data:image/svg+xml,<svg/>", "//example.org/file", "/\\example.org/file", "https://example.org/\nfile", "file:///tmp/a.pdf"]) {
    assert.equal(ui.rdDeliveryFileUrl(unsafe), null, unsafe);
  }
  for (const safe of ["/api/oss/preview?key=old&sig=unchanged", "https://files.example.org/old.pdf?signature=abc", "data:image/png;base64,aGVsbG8=", "data:application/pdf;base64,aGVsbG8="]) {
    assert.equal(ui.rdDeliveryFileUrl(safe), safe);
  }
  assert.match(ui.text(), /未保存可用文件地址/);
  assert.equal(ui.all().some((node) => node.props?.["aria-label"]?.startsWith("预览交付文件：")), false);
  assert.equal(ui.all().some((node) => node.type === "a"), false);
});

test("任务切换和记录移除不会继续显示上个任务的文件，compact 保留完整交付与操作", () => {
  const ui = fixture(undefined, true);
  ui.clickFile("图纸-A.pdf");
  assert.ok(ui.preview());
  assert.match(ui.render().props.className, /p-3/);
  assert.equal(ui.all().filter((node) => node.type === "article").length, 2);
  ui.update({ id: "task-2", rdTransferSnapshots: [snapshot("other", "C")] });
  assert.equal(ui.preview(), undefined);
  ui.clickFile("图纸-C.pdf");
  assert.equal(ui.preview().props.attachment.url, "/saved/C.pdf?sig=frozen");
  ui.update({ id: "task-2", rdTransferSnapshots: [] });
  assert.equal(ui.preview(), undefined);
});
