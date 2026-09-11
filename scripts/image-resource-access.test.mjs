import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/imageStudioShared.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("imageStudioShared.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ authFetch = async () => Response.json(urls()), fetch = async () => new Response("image bytes", { headers: { "Content-Type": "image/png" } }) } = {}) {
  let userId = "user-1";
  let logout;
  const events = [];
  const auth = { authFetch, getStoredUser: () => userId ? { id: userId } : null, addAuthClearedListener: (callback) => { logout = callback; } };
  const sharedSource = readFileSync(new URL("../src/app/lib/resourceAccess.ts", import.meta.url), "utf8");
  const sharedCode = ts.transpileModule(sharedSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const shared = {};
  new Function("exports", "require", "console", sharedCode)(shared, (name) => {
    assert.equal(name, "./authSession");
    return auth;
  }, { warn: (_name, data) => events.push(data) });
  const names = ["apiReadImageUrls", "useGeneratedImageResource", "fetchGeneratedImageDownload"];
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const code = ts.transpileModule(declarations.map((node) => node.getText(ast).replace(/^export\s+/, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scope = {
    authFetch, fetch, ...shared,
    useCallback: (callback) => callback,
    useRenewableResource: (options) => options,
  };
  const api = new Function(...Object.keys(scope), `${code}\nreturn {${names.join(",")}};`)(...Object.values(scope));
  return { ...api, events, switchUser(id) { userId = id; }, logout() { userId = null; logout(); } };
}

function urls(suffix = "new") {
  return { imageId: "image-1", imageUrl: `https://img.example.com/original.png?auth_key=${suffix}`, thumbnailUrl: `https://img.example.com/original.png?auth_key=${suffix}&x-oss-process=thumbnail`, imageExpiresIn: 1200, thumbnailExpiresIn: 1200 };
}

function renewableFixture(initialOptions) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let options = initialOptions;
  const same = (left, right) => left?.length === right?.length && left.every((value, i) => Object.is(value, right[i]));
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      const slot = slots[index] ??= { value };
      return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !same(previous.deps, deps)) {
        const slot = slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slot.cleanup = callback(); });
      }
    },
  };
  const text = readFileSync(new URL("../src/app/lib/useRenewableResource.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => name === "react" ? react : { reportResourceFailure() {} });
  const view = () => {
    cursor = 0;
    effects = [];
    const value = exports.useRenewableResource(options);
    if (effects.length) { effects.forEach((effect) => effect()); return view(); }
    return value;
  };
  return { view, change(next) { options = next; return view(); }, unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}

test("真实资源 hook 对同一失败图片只自动恢复一次，同地址续签也会重新加载", async () => {
  const renewal = deferred();
  let reads = 0;
  const hook = renewableFixture({ src: "same-signed-url", resourceKey: "image-thumb:1", refresh: () => { reads++; return renewal.promise; } });
  hook.view().onError();
  assert.equal(hook.view().src, "", "续签期间卸载失败图片，稳定URL恢复后才能重新加载");
  await new Promise(setImmediate);
  renewal.resolve("same-signed-url");
  await new Promise(setImmediate);
  assert.equal(hook.view().src, "same-signed-url");
  hook.view().onError();
  await new Promise(setImmediate);
  assert.equal(hook.view().failed, true);
  assert.equal(reads, 1, "第二次图片加载失败必须停止，不能无限续签");
  hook.unmount();
});

test("首次打开原图前续签不消耗失败恢复名额，加载成功后可恢复未来过期", async () => {
  let reads = 0;
  const hook = renewableFixture({ resourceKey: "image-original:1", refreshOnMount: true, refresh: async () => `fresh-${++reads}` });
  assert.equal(hook.view().src, "");
  await new Promise(setImmediate);
  hook.view().onError();
  await new Promise(setImmediate);
  assert.equal(reads, 2);
  assert.equal(hook.view().src, "fresh-2");
  hook.view().onLoad();
  hook.view().onError();
  await new Promise(setImmediate);
  assert.equal(reads, 3);
  hook.unmount();
});

test("切换图片或卸载后旧续签响应不能覆盖新图片", async () => {
  const old = deferred();
  const fresh = deferred();
  const hook = renewableFixture({ resourceKey: "image-original:A", refreshOnMount: true, refresh: () => old.promise });
  hook.view();
  await new Promise(setImmediate);
  hook.change({ resourceKey: "image-original:B", refreshOnMount: true, refresh: () => fresh.promise });
  await new Promise(setImmediate);
  fresh.resolve("B-url");
  await new Promise(setImmediate);
  old.resolve("A-url");
  await new Promise(setImmediate);
  assert.equal(hook.view().src, "B-url");
  const afterUnmount = deferred();
  hook.change({ resourceKey: "image-original:C", refreshOnMount: true, refresh: () => afterUnmount.promise });
  await new Promise(setImmediate);
  hook.unmount();
  afterUnmount.resolve("C-url");
  await new Promise(setImmediate);
  assert.notEqual(hook.view().src, "C-url");
});

test("图片列表使用缩略图，预览首次显示前按图片 ID 重新获取原图", async () => {
  const calls = [];
  const api = fixture({ authFetch: async (url) => { calls.push(url); return Response.json(urls()); } });
  const item = { id: "image-1", imageUrl: "old-original", thumbnailUrl: "old-thumb", imageData: "old-base64" };
  const thumb = api.useGeneratedImageResource(item, "thumbnail");
  assert.equal(thumb.src, "old-thumb");
  assert.equal(thumb.refreshOnMount, false);
  const original = api.useGeneratedImageResource(item, "original");
  assert.equal(original.src, undefined, "不能先显示已过期的列表原图地址");
  assert.equal(original.refreshOnMount, true);
  const [thumbnailUrl, originalUrl] = await Promise.all([thumb.refresh(), original.refresh()]);
  assert.equal(thumbnailUrl, urls().thumbnailUrl);
  assert.equal(originalUrl, urls().imageUrl);
  assert.deepEqual(calls, ["/api/image-generation/images/image-1/read-urls"]);
});

test("并发按图片 ID 续签只发一次请求，完成后再次预览会重新授权读取", async () => {
  let calls = 0;
  const api = fixture({ authFetch: async (_url, init) => {
    calls++;
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(urls(String(calls)));
  } });
  const [first, second] = await Promise.all([api.apiReadImageUrls("image-1"), api.apiReadImageUrls("image-1")]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await api.apiReadImageUrls("image-1");
  assert.equal(calls, 2);
});

test("切换账号后旧链接响应不可交付，新账号独立读取同一图片 ID", async () => {
  const old = deferred();
  let calls = 0;
  const api = fixture({ authFetch: () => ++calls === 1 ? old.promise : Promise.resolve(Response.json(urls("user-2"))) });
  const stale = api.apiReadImageUrls("image-1");
  await new Promise(setImmediate);
  api.switchUser("user-2");
  const fresh = api.apiReadImageUrls("image-1");
  old.resolve(Response.json(urls("user-1")));
  await assert.rejects(stale, /登录状态已变更/);
  assert.equal((await fresh).imageUrl, urls("user-2").imageUrl);
  assert.equal(calls, 2);
});

test("下载先续签原图，失效后最多续签重试一次且不使用缩略图", async () => {
  let reads = 0;
  const fetched = [];
  const api = fixture({
    authFetch: async () => Response.json(urls(String(++reads))),
    fetch: async (url) => {
      fetched.push(url);
      return fetched.length === 1 ? new Response("expired", { status: 403 }) : new Response("original bytes", { headers: { "Content-Type": "image/png" } });
    },
  });
  assert.equal(await (await api.fetchGeneratedImageDownload("image-1")).text(), "original bytes");
  assert.equal(reads, 2);
  assert.deepEqual(fetched, [urls("1").imageUrl, urls("2").imageUrl]);
  assert.deepEqual(api.events, [{ stage: "download", status: 403 }]);
});

test("持续失败仅请求两次，不把错误页面当图片下载，日志不含签名地址", async () => {
  for (const response of [() => new Response("expired auth_key=secret", { status: 403 }), () => new Response("<Error>secret</Error>", { headers: { "Content-Type": "application/xml" } })]) {
    let fetches = 0;
    const api = fixture({ fetch: async () => { fetches++; return response(); } });
    await assert.rejects(api.fetchGeneratedImageDownload("image-1"), /图片下载失败/);
    assert.equal(fetches, 2);
    assert.ok(api.events.every((event) => Object.keys(event).every((key) => ["stage", "status"].includes(key))));
    assert.doesNotMatch(JSON.stringify(api.events), /auth_key|secret|https/);
  }
});

test("无权续签时不下载旧地址，下载期间换账号不交付旧账号图片字节", async () => {
  let fetched = 0;
  const denied = fixture({ authFetch: async () => new Response("denied", { status: 403 }), fetch: async () => { fetched++; return new Response("image"); } });
  await assert.rejects(denied.fetchGeneratedImageDownload("image-1"), /无法读取图片/);
  assert.equal(fetched, 0);
  const bytes = deferred();
  const api = fixture({ fetch: () => bytes.promise });
  const oldDownload = api.fetchGeneratedImageDownload("image-1");
  await new Promise(setImmediate);
  api.switchUser("user-2");
  bytes.resolve(new Response("old-user-image", { headers: { "Content-Type": "image/png" } }));
  await assert.rejects(oldDownload, /登录状态已变更/);
});


test("切换图片后退场旧图片的load/error事件不能改变新图片或重置重试预算", async () => {
  let reads = 0;
  const hook = renewableFixture({ src: "A", resourceKey: "A", refresh: async () => "fresh-A" });
  const old = hook.view();
  hook.change({ src: "B", resourceKey: "B", refreshOnMount: true, refresh: async () => { reads++; return "fresh-B"; } });
  await new Promise(setImmediate);
  assert.equal(hook.view().src, "fresh-B");
  old.onError();
  old.onLoad();
  await assert.rejects(old.refresh(), /附件已切换/);
  await new Promise(setImmediate);
  assert.equal(hook.view().src, "fresh-B");
  assert.equal(hook.view().refreshing, false);
  assert.equal(reads, 1);
  hook.view().onError();
  await new Promise(setImmediate);
  old.onLoad();
  hook.view().onError();
  await new Promise(setImmediate);
  assert.equal(reads, 2, "旧load不能为B补充额外恢复次数");
  assert.equal(hook.view().failed, true);
  hook.unmount();
});
