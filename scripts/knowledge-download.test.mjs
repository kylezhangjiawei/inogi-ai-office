import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/RDKnowledgeBasePage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("RDKnowledgeBasePage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "downloadKbEntry");
assert.ok(declaration, "knowledge download handler must exist");
const javascript = ts.transpileModule(`${declaration.getText(ast)}\nreturn downloadKbEntry;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

// Run the real click handler. Only the detail API, browser DOM and toast boundary are mocked.
function setup(fetchDetail) {
  const requests = [];
  const downloads = [];
  const opened = [];
  const errors = [];
  const attached = new Set();
  const bindings = {
    fetchKbEntry: async (...args) => {
      requests.push(args);
      return fetchDetail(...args);
    },
    document: {
      createElement: (tag) => {
        assert.equal(tag, "a");
        return { click() { downloads.push({ href: this.href, filename: this.download }); } };
      },
      body: {
        appendChild: (element) => attached.add(element),
        removeChild: (element) => attached.delete(element),
      },
    },
    window: { open: (...args) => opened.push(args) },
    toast: { error: (message) => errors.push(message) },
    t: (message) => message,
  };
  const download = new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
  return { download, requests, downloads, opened, errors, attached };
}

const entry = {
  id: "knowledge-file",
  title: "串口工具",
  file_name: "sscom5.13.1.exe",
  has_data_file: true,
  oss_url: "https://files.example.invalid/sscom.exe?Expires=1&Signature=expired",
};

test("过期列表链接每次点击都重新获取详情并使用新的下载地址", async () => {
  let revision = 0;
  const state = setup(async () => ({ oss_url: `https://files.example.invalid/sscom.exe?Signature=fresh-${++revision}` }));
  await state.download(entry);
  await state.download(entry);
  assert.deepEqual(state.requests, [[entry.id, undefined], [entry.id, undefined]]);
  assert.deepEqual(state.downloads, [1, 2].map((value) => ({
    href: `https://files.example.invalid/sscom.exe?Signature=fresh-${value}`,
    filename: entry.file_name,
  })));
  assert.deepEqual(state.errors, []);
  assert.equal(state.attached.size, 0);
});

test("部门与协同知识库下载保留 kbId，历史 oss_url 条目也会刷新", async () => {
  for (const kbId of ["department-1", "us-collab"]) {
    const state = setup(async () => ({ oss_url: "https://files.example.invalid/fresh" }));
    await state.download({ ...entry, has_data_file: false }, kbId);
    assert.deepEqual(state.requests, [[entry.id, kbId]]);
    assert.deepEqual(state.downloads, [{ href: "https://files.example.invalid/fresh", filename: entry.file_name }]);
  }
});

test("详情请求失败时显示错误，绝不使用旧签名下载", async () => {
  const state = setup(async () => { throw new Error("Forbidden"); });
  await state.download(entry);
  assert.deepEqual(state.requests, [[entry.id, undefined]]);
  assert.deepEqual(state.downloads, []);
  assert.deepEqual(state.errors, ["获取文件内容失败"]);
});

test("详情不再提供文件时显示不可用，绝不回退列表旧地址", async () => {
  const state = setup(async () => ({ oss_url: null, data_url: null }));
  await state.download(entry);
  assert.deepEqual(state.downloads, []);
  assert.deepEqual(state.errors, ["文件内容不可用"]);
});

test("base64 文件仍从详情下载并以标题作为缺省文件名", async () => {
  const dataUrl = "data:text/plain;base64,aGVsbG8=";
  const state = setup(async () => ({ data_url: dataUrl }));
  await state.download({ ...entry, oss_url: null, file_name: null });
  assert.deepEqual(state.downloads, [{ href: dataUrl, filename: entry.title }]);
  assert.equal(state.attached.size, 0);
});

test("外部链接直接打开，不请求文件详情", async () => {
  const state = setup(async () => { throw new Error("unexpected request"); });
  await state.download({ ...entry, external_url: "https://docs.example.invalid/manual" });
  assert.deepEqual(state.opened, [["https://docs.example.invalid/manual", "_blank"]]);
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.downloads, []);
  assert.deepEqual(state.errors, []);
});

test("无文件条目保留原错误提示", async () => {
  const state = setup(async () => { throw new Error("unexpected request"); });
  await state.download({ id: entry.id, title: entry.title });
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.downloads, []);
  assert.deepEqual(state.errors, ["该条目没有可下载的文件"]);
});
