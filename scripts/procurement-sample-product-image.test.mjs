import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, dependencies = {}, select) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const text = select ? ast.statements.filter(select).map((node) => node.getText(ast)).join("\n") : source;
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}

const imageDetection = compile("src/app/components/MobileZoomableImage.tsx", {}, (node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "isImagePreviewSource"
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText() === "IMAGE_FILE_EXTENSION"));

function fixture({ materials = [], latestTask } = {}) {
  const calls = { materials: 0, tasks: [] };
  const resources = compile("src/app/lib/resourceAccess.ts", {
    "./authSession": { getStoredUser: () => ({ id: "user-1" }), addAuthClearedListener() {} },
  });
  const api = {
    listMaterials: async () => { calls.materials += 1; return materials; },
    getProcTask: async (id) => { calls.tasks.push(id); return latestTask; },
  };
  const attachments = compile("src/app/lib/attachmentAccess.ts", {
    "./procurementApi": api, "./rdApi": {}, "./resourceAccess": resources,
  });
  const { sampleProductImage } = compile("src/app/procurement/samples/sampleProductImageSource.ts", {
    "../../components/MobileZoomableImage": imageDetection,
    "../../lib/attachmentAccess": attachments,
    "../../lib/procurementApi": api,
    "../../lib/resourceAccess": resources,
  });
  return { calls, sampleProductImage };
}

const photo = (extra = {}) => ({ id: "photo-1", fileName: "sample.jpg", fileUrl: "https://example.test/sample.jpg", thumbUrl: "https://example.test/thumb.webp", fileSize: 300, mimeType: "image/jpeg", kind: "image", ...extra });
const task = (extra = {}) => ({ id: "task-1", materialId: "material-1", materialName: "减振套", attachmentList: [photo()], ...extra });
const material = (extra = {}) => ({ id: "material-1", name: "减振套", imageUrl: "https://example.test/product?signature=old", ...extra });

test("关联物料商品图优先，初次选择不请求额外数据；同名其他物料不能串图", () => {
  const { sampleProductImage, calls } = fixture();
  assert.equal(sampleProductImage(task(), material()).url, material().imageUrl);
  assert.equal(sampleProductImage(task(), material()).mime, "image/*");
  assert.equal(sampleProductImage(task(), material({ id: "unrelated" })).id, "photo-1");
  assert.equal(sampleProductImage(task({ materialId: null }), material()).id, "photo-1");
  assert.equal(sampleProductImage(task({ materialId: undefined })).id, "photo-1");
  assert.deepEqual(calls, { materials: 0, tasks: [] });
});

test("附件回退忽略文档和空地址，识别旧图片扩展名并保留缩略图；无图返回空", () => {
  const { sampleProductImage } = fixture();
  const attachments = [
    photo({ id: "drawing", fileName: "drawing.pdf", fileUrl: "https://example.test/drawing.pdf", mimeType: "application/pdf" }),
    photo({ id: "empty", fileUrl: " " }),
    photo({ mimeType: "application/octet-stream", fileName: "PRODUCT.JPG" }),
  ];
  const selected = sampleProductImage(task({ attachmentList: attachments }), material({ imageUrl: " " }));
  assert.equal(selected.id, "photo-1");
  assert.equal(selected.thumbUrl, photo().thumbUrl);
  assert.equal(selected.mime, "image/*");
  for (const [fileName, fileUrl] of [["产品.avif", "https://example.test/file"], ["产品图", "https://example.test/photo.avif?signature=old"]]) {
    assert.equal(sampleProductImage(task({ attachmentList: [photo({ fileName, fileUrl, mimeType: "application/octet-stream" })] })).mime, "image/*");
  }
  assert.equal(sampleProductImage(task({ attachmentList: attachments.slice(0, 2) })), null);
});

test("不同物料同时续签只读取一次物料列表，并各自获得正确的新地址", async () => {
  const first = material({ imageUrl: "https://example.test/product?signature=new" });
  const second = material({ id: "material-2", imageUrl: "https://example.test/second?signature=new" });
  const { sampleProductImage, calls } = fixture({ materials: [first, second] });
  const a = sampleProductImage(task(), material());
  const b = sampleProductImage(task({ materialId: second.id }), material({ id: second.id }));
  const renewed = await Promise.all([a.refresh(), b.refresh()]);
  assert.deepEqual(renewed.map((image) => image.url), [first.imageUrl, second.imageUrl]);
  assert.equal(calls.materials, 1);
  await a.refresh();
  assert.equal(calls.materials, 2, "签名地址不能永久缓存在客户端");
});

test("商品图被删除后拒绝交付旧地址，附件续签只重新读取所属任务", async () => {
  const removed = fixture({ materials: [material({ imageUrl: undefined })] });
  await assert.rejects(removed.sampleProductImage(task(), material()).refresh(), /已删除或无权查看/);
  const newest = photo({ fileName: "产品.avif", mimeType: "application/octet-stream", fileUrl: "https://example.test/new-original.avif", thumbUrl: "https://example.test/new-thumb.webp" });
  const attachments = fixture({ latestTask: task({ attachmentList: [newest] }) });
  const renewed = await attachments.sampleProductImage(task()).refresh();
  assert.equal(renewed.url, newest.fileUrl);
  assert.equal(renewed.thumbUrl, newest.thumbUrl);
  assert.equal(renewed.mime, "image/*");
  assert.deepEqual(attachments.calls, { materials: 0, tasks: ["task-1"] });
});
