import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (file, require) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("require", "exports", code)(require, exports);
  return exports;
};
const file = (version, overrides = {}) => ({ fileName: "同名图纸.pdf", fileUrl: `/saved/${version}.pdf`, fileSize: 1200, mimeType: "application/pdf", version, title: "技术图纸", ...overrides });
const snapshot = (id, files) => ({ id, attachments: files });
const originalFile = { id: "original-1", fileName: "任务原附件.pdf", fileUrl: "/task/original.pdf", fileSize: 600, mimeType: "application/pdf", kind: "drawing" };
const task = (id = "task-1", snapshots = [snapshot("new", [file("A"), file("B")])]) => ({ id, attachmentList: [originalFile], rdTransferSnapshots: snapshots });

function fixture(initialTask = task()) {
  let currentTask = initialTask;
  let slots = [];
  let cursor = 0;
  let previousKey;
  const jsx = (type, props, key) => ({ type, props, key });
  const require = (name) => {
    if (name === "react") return { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; } };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.endsWith("/i18n")) return { useI18n: () => ({ t: (value, data = {}) => value.replace(/\{(\w+)\}/g, (match, key) => key in data ? String(data[key]) : match) }) };
    if (name.endsWith("/ui/utils")) return { cn: (...values) => values.filter(Boolean).join(" ") };
    if (name.endsWith("/RdDeliverySnapshotPanel")) return compile("../src/app/procurement/components/RdDeliverySnapshotPanel.tsx", require);
    if (name.endsWith("/TechnicalDocumentPreview")) return { TechnicalDocumentPreview: "TechnicalDocumentPreview", technicalPreviewKind: (file) => file.mime === "application/pdf" ? "pdf" : file.mime === "image/png" ? "image" : "unsupported" };
    if (name === "lucide-react" || name.includes("/components/")) return new Proxy({}, { get: (_, property) => property });
    throw new Error(`Unexpected dependency: ${name}`);
  };
  const exports = compile("../src/app/procurement/components/SampleTechnicalFiles.tsx", require);
  const render = () => {
    const root = exports.SampleTechnicalFiles({ task: currentTask });
    if (root.key !== previousKey) { slots = []; previousKey = root.key; }
    cursor = 0;
    return root.type(root.props);
  };
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
  const find = (predicate) => nodes(render()).find(predicate);
  return {
    ...exports, render, all: () => nodes(render()), find, text: () => text(render()),
    update(next) { currentTask = next; return render(); },
    select(index) { const options = nodes(render()).filter((node) => node.type === "SelectItem"); find((node) => node.type === "Select").props.onValueChange(options[index].props.value); },
    inline: () => find((node) => node.type === "TechnicalDocumentPreview"),
    expanded: () => find((node) => node.type === "AttachmentPreviewDialog"),
    expand() { const button = find((node) => node.type === "Button" && node.props["aria-label"]?.startsWith("放大预览：")); assert.ok(button); button.props.onClick(); },
  };
}

test("仅使用 append 最后一次交付；当前空附件不会从原任务或历史交付补文件", () => {
  const ui = fixture(task("task-1", [snapshot("old", [file("OLD")]), snapshot("latest", [file("NEW")])]));
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/NEW.pdf");
  ui.update(task("task-1", [snapshot("old", [file("OLD")]), snapshot("latest", [])]));
  assert.match(ui.text(), /本次交付未附带文件/);
  assert.equal(ui.inline(), undefined);
  assert.equal(ui.all().some((node) => node.type === "Select" || node.type === "a"), false);
});

test("无交付快照时保留任务原附件，并明确不推测版本", () => {
  const ui = fixture(task("legacy", undefined));
  ui.update({ id: "legacy", attachmentList: [originalFile] });
  assert.equal(ui.inline().props.attachment.oss_url, "/task/original.pdf");
  assert.match(ui.text(), /未保存交付快照.*任务原附件.*未登记版本/s);
  ui.update({ id: "legacy", attachmentList: [], rdTransferSnapshots: [] });
  assert.match(ui.text(), /此任务暂无可查看的原附件/);
});

test("不同版本同文件名保留独立选项，内嵌、放大和下载始终对应所选冻结版本", () => {
  const original = task();
  const copy = structuredClone(original);
  const ui = fixture(original);
  const options = ui.all().filter((node) => node.type === "SelectItem");
  assert.equal(options.length, 2);
  assert.notEqual(options[0].props.value, options[1].props.value);
  ui.select(1);
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/B.pdf");
  ui.expand();
  assert.equal(ui.expanded().props.attachment.url, "/saved/B.pdf");
  assert.equal(ui.expanded().props.attachment.downloadUrl, "/saved/B.pdf");
  const download = ui.find((node) => node.type === "a");
  assert.equal(download.props.href, "/saved/B.pdf");
  assert.equal(download.props.download, "同名图纸.pdf");
  assert.equal(download.props.rel, "noopener noreferrer");
  ui.expanded().props.onClose();
  assert.equal(ui.expanded(), undefined);
  assert.deepEqual(original, copy);
});

test("默认优先真实可用图片或 PDF，其余格式仍可选择且保留原始文件", () => {
  const ui = fixture(task("task-1", [snapshot("latest", [file("empty", { fileUrl: "" }), file("sheet", { mimeType: "application/vnd.ms-excel", fileName: "BOM.xls" }), file("image", { mimeType: "image/png", fileName: "尺寸.png", fileUrl: "/saved/real.png" })])]));
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/real.png");
  ui.select(1);
  assert.equal(ui.inline().props.attachment.name, "BOM.xls");
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/sheet.pdf");
  ui.expand();
  assert.equal(ui.expanded().props.attachment.name, "BOM.xls");
});

test("换任务后选择与放大预览全部重置；同任务收到新交付也不继续展示旧文件", () => {
  const a = task("A");
  const b = task("B", [snapshot("other", [file("C")])]);
  const ui = fixture(a);
  ui.select(1);
  ui.expand();
  ui.update(b);
  assert.equal(ui.expanded(), undefined);
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/C.pdf");
  ui.update(a);
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/A.pdf");
  assert.equal(ui.expanded(), undefined);
  ui.expand();
  ui.update(task("A", [snapshot("next", [file("D")])]));
  assert.equal(ui.inline().props.attachment.oss_url, "/saved/D.pdf");
  assert.equal(ui.expanded(), undefined);
});

test("文件字段缺失和危险地址如实显示，不生成无效预览或下载", () => {
  const ui = fixture(task("task-1", [snapshot("latest", [file(null, { title: "", fileName: "", fileSize: 0, fileUrl: "javascript:alert(1)" })])]));
  assert.match(ui.text(), /未记录文件名.*未登记版本.*空文件.*未保存可用文件地址/s);
  assert.equal(ui.inline(), undefined);
  assert.equal(ui.expanded(), undefined);
  assert.equal(ui.all().some((node) => node.type === "a"), false);
});
