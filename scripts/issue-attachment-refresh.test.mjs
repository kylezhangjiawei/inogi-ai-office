import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleFrom(path, require, extra = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", ...Object.keys(extra), code)(exports, require, ...Object.values(extra));
  return exports;
}

function fixture() {
  let userId = "viewer";
  let clearAuth;
  const fileReads = [];
  const access = moduleFrom("../src/app/lib/resourceAccess.ts", (name) => {
    assert.equal(name, "./authSession");
    return {
      getStoredUser: () => userId ? { id: userId } : null,
      addAuthClearedListener: (listener) => { clearAuth = listener; },
      authFetch: async (url) => { fileReads.push(url); return Response.json({ signedUrl: "https://cdn.example/draft?auth_key=fresh" }); },
    };
  }, { console: { warn() {} } });
  const helper = moduleFrom("../src/app/lib/issue/attachmentAccess.ts", (name) => {
    assert.equal(name, "../resourceAccess");
    return access;
  });
  return { ...helper, fileReads, logout() { userId = null; clearAuth(); } };
}

function attachment(id, fileUrl = `https://cdn.example/${id}?auth_key=fresh`) {
  return { id, fileName: `${id}.png`, fileType: "image/png", fileUrl, uploadedBy: "uploader", uploadedAt: "2026-09-10T00:00:00Z" };
}

test("共享问题及对话附件按问题 ID 一次授权重读，按附件 ID 返回对应新地址", async () => {
  const api = fixture();
  const issueReads = [];
  const service = { get: async (issueId) => {
    issueReads.push(issueId);
    return { attachments: [attachment("main-file")], messages: [{ attachments: [attachment("chat-file")] }] };
  } };
  const [main, chat] = await Promise.all([
    api.refreshIssueAttachment(service, "issue-1", "main-file"),
    api.refreshIssueAttachment(service, "issue-1", "chat-file"),
  ]);
  assert.equal(main.fileUrl, attachment("main-file").fileUrl);
  assert.equal(chat.fileUrl, attachment("chat-file").fileUrl);
  assert.deepEqual(issueReads, ["issue-1"]);
  assert.deepEqual(api.fileReads, [], "共享附件不应退回仅上传者可访问的 FilesService");
  await api.refreshIssueAttachment(service, "issue-1", "main-file");
  assert.equal(issueReads.length, 2, "上次读取结束后再次预览必须重新校验业务权限");
});

test("附件移除、无地址或业务访问被拒绝时不回退旧链接或任意对象签名", async () => {
  const api = fixture();
  const service = { get: async () => ({ attachments: [attachment("empty", "")], messages: [] }) };
  await assert.rejects(api.refreshIssueAttachment(service, "issue-1", "removed"), /附件已不可用/);
  await assert.rejects(api.refreshIssueAttachment(service, "issue-1", "empty"), /附件已不可用/);
  await assert.rejects(api.refreshIssueAttachment({ get: async () => { throw new Error("forbidden"); } }, "issue-2", "file"), /forbidden/);
  assert.deepEqual(api.fileReads, []);
});

test("未提交草稿通过本人 fileId 获取新地址，不把临时 URL 写回原草稿", async () => {
  const api = fixture();
  const draft = attachment("file/id", "data:image/png;base64,local");
  const renewed = await api.refreshDraftIssueAttachment(draft);
  assert.deepEqual(api.fileReads, ["/api/files/file%2Fid/signed-url"]);
  assert.equal(renewed.fileUrl, "https://cdn.example/draft?auth_key=fresh");
  assert.equal(draft.fileUrl, "data:image/png;base64,local");
  await assert.rejects(api.refreshDraftIssueAttachment({ ...draft, id: "" }), /尚未上传/);
});

test("退出登录后尚未返回的问题附件响应不可继续交付", async () => {
  const api = fixture();
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const request = api.refreshIssueAttachment({ get: () => waiting }, "issue-1", "file");
  await new Promise(setImmediate);
  api.logout();
  finish({ attachments: [attachment("file")], messages: [] });
  await assert.rejects(request, /登录状态已变更/);
});
