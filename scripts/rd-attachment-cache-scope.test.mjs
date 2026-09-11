import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/lib/rdApi.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("rdApi.ts", source, ts.ScriptTarget.Latest, true);
const first = source.indexOf("const RD_ATTACHMENT_CACHE_TTL_MS");
const last = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "fetchRdTaskAttachments").end;
const code = ts.transpileModule(source.slice(first, last), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  let user = "A", workspace = null, clearAuth;
  const requests = [];
  const fallbackRequests = [];
  const exports = {};
  new Function("exports", "getStoredUser", "currentRdWorkspace", "addAuthClearedListener", "requestJson", "fetchRdTaskProgressNotes", "buildRdTaskAttachmentPayload", code)(
    exports, () => user ? { id: user } : null, () => workspace,
    (callback) => { clearAuth = callback; },
    (path) => { const request = { path, user, workspace, ...deferred() }; requests.push(request); return request.promise; },
    (taskId) => { fallbackRequests.push({ taskId, user, workspace }); return Promise.resolve([]); },
    () => ({ attachment_count: 0, attachments: [] }),
  );
  return {
    ...exports, requests, fallbackRequests,
    switchUser(value) { user = value; },
    switchWorkspace(value) { workspace = value; },
    logout() { user = null; clearAuth(); },
  };
}

function attachments(id) { return { attachment_count: 1, attachments: [{ id, preview_url: `test-only:${id}` }] }; }
function preview(id) { return { "shared-task": attachments(id) }; }
const changed = /已变更/;

test("旧账号批量缩略图响应不能交付或写入新账号缓存", async () => {
  const api = fixture();
  const old = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
  api.switchUser("B");
  api.requests[0].resolve(preview("A-private"));
  await assert.rejects(old, changed);
  const current = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
  assert.equal(api.requests.length, 2, "B 必须经过自己的授权请求");
  api.requests[1].resolve(preview("B-visible"));
  assert.equal((await current)["shared-task"].attachments[0].id, "B-visible");
  assert.equal((await api.fetchRdTaskAttachmentPreviews(["shared-task"]))["shared-task"].attachments[0].id, "B-visible");
  assert.equal(api.requests.length, 2, "同一会话可复用自己的短期缓存");
});

test("工作区切换丢弃旧摘要，独立可取消的请求也不能返回旧工作区签名", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    const api = fixture();
    const old = api.fetchRdTaskAttachmentPreviews(["shared-task"], signal ? { signal } : undefined);
    api.switchWorkspace("us-collab");
    api.requests[0].resolve(preview("rd-private"));
    await assert.rejects(old, changed);
    const current = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
    assert.equal(api.requests.length, 2);
    api.requests[1].resolve(preview("collab-visible"));
    assert.equal((await current)["shared-task"].attachments[0].id, "collab-visible");
  }
});

test("全附件读取包括 force 续签，在账号或工作区变更后均拒绝旧响应", async () => {
  for (const options of [undefined, { force: true }]) {
    for (const change of [(api) => api.switchUser("B"), (api) => api.switchWorkspace("us-collab")]) {
      const api = fixture();
      const old = api.fetchRdTaskAttachments("shared-task", options);
      change(api);
      api.requests[0].resolve(attachments("old-private"));
      await assert.rejects(old, changed);
      const current = api.fetchRdTaskAttachments("shared-task");
      assert.equal(api.requests.length, 2);
      api.requests[1].resolve(attachments("current-visible"));
      assert.equal((await current).attachments[0].id, "current-visible");
    }
  }
});

test("登出清空两类附件缓存，同账号重新登录也不能复用上次签名", async () => {
  const api = fixture();
  const batch = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
  const full = api.fetchRdTaskAttachments("shared-task");
  api.requests[0].resolve(preview("old-session"));
  api.requests[1].resolve(attachments("old-session"));
  await Promise.all([batch, full]);
  api.logout();
  api.switchUser("A");
  const nextBatch = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
  const nextFull = api.fetchRdTaskAttachments("shared-task");
  assert.equal(api.requests.length, 4);
  api.requests[2].resolve(preview("new-session"));
  api.requests[3].resolve(attachments("new-session"));
  await Promise.all([nextBatch, nextFull]);
});

test("登出重登后旧请求 finally 不清除新会话正在进行的附件请求", async () => {
  for (const method of ["fetchRdTaskAttachmentPreviews", "fetchRdTaskAttachments"]) {
    const api = fixture();
    const argument = method.endsWith("Previews") ? ["shared-task"] : "shared-task";
    const result = method.endsWith("Previews") ? preview : attachments;
    const old = api[method](argument);
    api.logout();
    api.switchUser("A");
    const fresh = api[method](argument);
    api.requests[0].resolve(result("old-session"));
    await assert.rejects(old, changed);
    const joined = api[method](argument);
    assert.equal(api.requests.length, 2, "后续请求继续加入新会话请求");
    api.requests[1].resolve(result("new-session"));
    assert.deepEqual(await fresh, await joined);
  }
});

test("force 请求覆盖旧 inflight 后，旧请求不覆盖较新的授权结果", async () => {
  const api = fixture();
  const older = api.fetchRdTaskAttachments("shared-task");
  const newer = api.fetchRdTaskAttachments("shared-task", { force: true });
  api.requests[1].resolve(attachments("newer"));
  await newer;
  api.requests[0].resolve(attachments("older"));
  await older;
  assert.equal((await api.fetchRdTaskAttachments("shared-task")).attachments[0].id, "newer");
  assert.equal(api.requests.length, 2);
});

test("附件失效后旧响应不交付；404 回退不能跨到新账号或工作区", async () => {
  const api = fixture();
  const beforeMutation = api.fetchRdTaskAttachmentPreviews(["shared-task"]);
  api.clearRdTaskAttachmentCache("shared-task");
  api.requests[0].resolve(preview("deleted"));
  await assert.rejects(beforeMutation, changed);
  const old = api.fetchRdTaskAttachments("shared-task", { force: true });
  api.switchUser("B");
  api.requests[1].reject(Object.assign(new Error("not found"), { status: 404 }));
  await assert.rejects(old, changed);
  assert.equal(api.fallbackRequests.length, 0);
});
