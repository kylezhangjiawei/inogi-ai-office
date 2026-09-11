import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function parse(path) {
  return ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function select(ast, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return matches;
}

const rdApi = parse("src/app/lib/rdApi.ts");
const getterNames = ["getAttachmentUrl", "getAttachmentDownloadUrl", "getAttachmentThumbUrl"];
const getterCode = rdApi.statements.filter((node) => ts.isFunctionDeclaration(node) && getterNames.includes(node.name?.text))
  .map((node) => node.getText(rdApi).replace(/^export\s+/, "")).join("\n");
const getters = new Function("ensurePreconnect", `${ts.transpileModule(getterCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nreturn {${getterNames.join(",")}};`)(() => {});

function attachment(fields = {}) {
  return { id: "attachment-1", task_id: "task-1", name: "photo.png", mime: "image/png", preview_url: "expired-original", thumb_url: "expired-thumb", download_url: "expired-download", ...fields };
}

function evaluate(expression, ast, item, latest) {
  const calls = [];
  const scope = {
    img: item, attachment: item, att: item, current: item, ...getters,
    refreshRdAttachment: async (value) => { calls.push(value); return latest; },
  };
  const code = ts.transpileModule(`const value = ${expression.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { value: new Function(...Object.keys(scope), `${code}\nreturn value;`)(...Object.values(scope)), calls };
}

function resourceProps(path, tag) {
  const ast = parse(path);
  const elements = select(ast, (node) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag);
  return elements.map((element) => ({ ast, properties: new Map(element.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(ast), attribute.initializer?.expression])) }));
}

test("驾驶舱与个人工作区缩略图失败后按原任务附件续签，并继续使用缩略图", async () => {
  const consumers = [
    ...resourceProps("src/app/RDTaskManagementPage.tsx", "RenewableImage"),
    ...resourceProps("src/app/RDMyWorkspacePage.tsx", "RenewableImage"),
  ];
  assert.equal(consumers.length, 3);
  const item = attachment();
  const latest = attachment({ preview_url: "fresh-original", thumb_url: "fresh-thumb" });
  for (const { ast, properties } of consumers) {
    assert.equal(evaluate(properties.get("src"), ast, item, latest).value, "expired-thumb");
    const renewal = evaluate(properties.get("refresh"), ast, item, latest);
    assert.equal(await renewal.value(), "fresh-thumb");
    assert.deepEqual(renewal.calls, [item]);
    const legacy = evaluate(properties.get("refresh"), ast, attachment({ task_id: undefined }), latest);
    assert.equal(legacy.value, undefined, "无任务标识的历史附件不能猜测所属任务签名");
    assert.deepEqual(legacy.calls, []);
  }
});

test("驾驶舱大图预览打开时先续签，恢复时使用原图而非缩略图", async () => {
  const ast = parse("src/app/RDTaskManagementPage.tsx");
  const gallery = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ImageGallery");
  const hook = select(gallery, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useRenewableResource")[0];
  assert.ok(hook, "相册必须接入实际资源恢复 hook");
  const item = attachment();
  const options = evaluate(hook.arguments[0], ast, item, attachment({ preview_url: "fresh-original", thumb_url: "fresh-thumb" }));
  assert.equal(options.value.refreshOnMount, true);
  assert.equal(await options.value.refresh(), "fresh-original");
  assert.deepEqual(options.calls, [item]);
  const historical = evaluate(hook.arguments[0], ast, attachment({ task_id: undefined }), attachment());
  assert.equal(historical.value.refresh, undefined);
  assert.equal(historical.value.src, "expired-original");
});

test("研发与协同详情下载操作重新授权并选择下载原图地址，历史附件保留原入口", async () => {
  for (const path of ["src/app/RDTaskDetailPage.tsx", "src/app/UsCollabTaskDetailPage.tsx"]) {
    const consumers = resourceProps(path, "ResourceDownloadLink");
    assert.equal(consumers.length, 1);
    const { ast, properties } = consumers[0];
    const item = attachment();
    const latest = attachment({ preview_url: "fresh-preview", thumb_url: "fresh-thumb", download_url: "fresh-download" });
    const refresh = evaluate(properties.get("refresh"), ast, item, latest);
    assert.equal(await refresh.value(), "fresh-download");
    assert.deepEqual(refresh.calls, [item]);
    const historical = attachment({ task_id: undefined, download_url: undefined, preview_url: undefined, oss_url: undefined, data_url: "data:image/png;base64,legacy" });
    assert.equal(evaluate(properties.get("refresh"), ast, historical, latest).value, undefined);
    assert.equal(evaluate(properties.get("href"), ast, historical, latest).value, historical.data_url);
  }
});
