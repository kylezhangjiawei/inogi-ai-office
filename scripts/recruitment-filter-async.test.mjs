import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pageFixture(iterateCandidateFilter) {
  const source = readFileSync(new URL("../src/app/ResumeScreeningPage.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleIterateCandidateFilter") handler = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler);
  const values = { instruction: "没有美国经验或医疗背景的候选人降低评分", conversation: [], running: false, version: "", errors: [] };
  const scope = {
    filterInstruction: values.instruction, filterConversation: [], filterRunning: false,
    jobRuleFilter: "job-a", selectedFilterVersion: "",
    filterContextRef: { current: { jobRuleId: "job-a", version: "" } },
    setFilterInstruction: (value) => { values.instruction = value; },
    setFilterConversation: (value) => { values.conversation = typeof value === "function" ? value(values.conversation) : value; },
    setFilterRunning: (value) => { values.running = value; },
    setSelectedFilterVersion: (value) => { values.version = value; },
    setCandidatePage() {}, loadCandidateFilterSessions: async () => {}, loadCandidates: async () => {},
    selectedCandidateIdRef: { current: "" }, loadCandidateDetail: async () => {},
    recruitmentApi: { iterateCandidateFilter },
    toast: { error: (value) => values.errors.push(value), message() {}, success() {} },
    getErrorMessage: (error) => error.message,
  };
  const code = ts.transpileModule(`${handler}\nreturn handleIterateCandidateFilter;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { values, scope, run: new Function(...Object.keys(scope), code)(...Object.values(scope)) };
}

function apiFixture(fetch) {
  const source = readFileSync(new URL("../src/app/lib/recruitmentApi.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env.VITE_RECRUITMENT_API_BASE", '""');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let userId = "user-a";
  const timers = [];
  const exports = {};
  const auth = {
    authFetch: fetch, readErrorMessage: async (_response, fallback) => fallback,
    getStoredUser: () => ({ id: userId }), addAuthClearedListener() {},
  };
  new Function("exports", "require", "setTimeout", "clearTimeout", code)(exports, (name) => {
    assert.equal(name, "./authSession");
    return auth;
  }, (fn, delay) => {
    const timer = { fn, delay, cancelled: false };
    timers.push(timer);
    if (delay < 10000) queueMicrotask(() => { if (!timer.cancelled) fn(); });
    return timer;
  }, (timer) => { timer.cancelled = true; });
  return { api: exports.recruitmentApi, timers, switchUser(id) { userId = id; } };
}

const payload = { instruction: "必须有美国市场和医疗行业经验", job_rule_id: "job-a", limit: 80 };
const result = { action: "filter", version_id: "v2", answer: "筛选完成", recommend_count: 2, hold_count: 1, reject_count: 3 };

test("原始 504 场景：失败后输入完整保留，可再次提交", async () => {
  const request = deferred();
  const page = pageFixture(() => request.promise);
  const pending = page.run();
  assert.equal(page.values.running, true);
  request.reject(new Error("请求失败：504"));
  await pending;
  assert.equal(page.values.instruction, page.scope.filterInstruction);
  assert.equal(page.values.running, false);
  assert.deepEqual(page.values.errors, ["请求失败：504"]);
});

test("AI 完成或追问后清空输入并展示回答", async () => {
  for (const response of [result, { action: "clarify", answer: "需要哪类美国市场经验？" }]) {
    const page = pageFixture(async () => response);
    await page.run();
    assert.equal(page.values.instruction, "");
    assert.equal(page.values.conversation.at(-1).content, response.answer);
    assert.equal(page.values.version, response.version_id ?? "");
    assert.equal(page.values.running, false);
  }
});

test("模型慢于网关超时也通过短轮询取得结果，不保持同步 POST", async () => {
  const calls = [];
  let polls = 0;
  const fixture = apiFixture(async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST") return Response.json({ task_id: "task-1", status: "pending" });
    polls++;
    return Response.json(polls < 90 ? { task_id: "task-1", status: "processing" } : { task_id: "task-1", status: "completed", result });
  });
  assert.deepEqual(await fixture.api.iterateCandidateFilter(payload), result);
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
  assert.equal(calls[0].url, "/api/recruitment/candidate-filter-sessions/iterate/async");
  assert.equal(polls, 90);
  assert.ok(calls.every((call) => call.init.signal instanceof AbortSignal));
});

test("轮询 504 后再次发送同一条件恢复原任务，不重复创建版本", async () => {
  let submits = 0;
  let polls = 0;
  const fixture = apiFixture(async (_url, init) => {
    if (init.method === "POST") { submits++; return Response.json({ task_id: "task-1", status: "pending" }); }
    polls++;
    return polls === 1 ? new Response("Gateway timeout", { status: 504 }) : Response.json({ task_id: "task-1", status: "completed", result });
  });
  await assert.rejects(fixture.api.iterateCandidateFilter(payload), /查询.*中断/);
  assert.deepEqual(await fixture.api.iterateCandidateFilter(payload), result);
  assert.equal(submits, 1);
});

test("单次轮询卡住会取消请求，重试仍读取原任务", async () => {
  let submits = 0;
  let polls = 0;
  let stalledSignal;
  const fixture = apiFixture(async (_url, init) => {
    if (init.method === "POST") { submits++; return Response.json({ task_id: "task-1", status: "pending" }); }
    if (++polls === 1) {
      stalledSignal = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError"))));
    }
    return Response.json({ task_id: "task-1", status: "completed", result });
  });
  const pending = fixture.api.iterateCandidateFilter(payload);
  await new Promise(setImmediate);
  const timer = fixture.timers.find((item) => !item.cancelled && item.delay === 20_000);
  assert.ok(timer, "卡住的读取必须有有限超时");
  timer.fn();
  await assert.rejects(pending, /查询.*中断/);
  assert.equal(stalledSignal.aborted, true);
  assert.deepEqual(await fixture.api.iterateCandidateFilter(payload), result);
  assert.equal(submits, 1);
});

test("并发提交相同条件共用同一任务与结果", async () => {
  const submitted = deferred();
  let submits = 0;
  const fixture = apiFixture(async (_url, init) => {
    if (init.method === "POST") { submits++; return submitted.promise; }
    return Response.json({ task_id: "task-1", status: "completed", result });
  });
  const first = fixture.api.iterateCandidateFilter(payload);
  const second = fixture.api.iterateCandidateFilter(payload);
  assert.equal(first, second);
  submitted.resolve(Response.json({ task_id: "task-1", status: "pending" }));
  assert.deepEqual(await first, result);
  assert.equal(submits, 1);
});

test("任务明确失败或已过期会释放任务记录，下一次可重新提交", async () => {
  for (const failure of [Response.json({ task_id: "task-1", status: "failed", error: "模型不可用" }), new Response("Not found", { status: 404 })]) {
    let submits = 0;
    let polls = 0;
    const fixture = apiFixture(async (_url, init) => {
      if (init.method === "POST") { submits++; return Response.json({ task_id: `task-${submits}`, status: "pending" }); }
      return ++polls === 1 ? failure : Response.json({ task_id: "task-2", status: "completed", result });
    });
    await assert.rejects(fixture.api.iterateCandidateFilter(payload));
    assert.deepEqual(await fixture.api.iterateCandidateFilter(payload), result);
    assert.equal(submits, 2);
  }
});

test("账号切换不会查询上一账号的任务", async () => {
  let submits = 0;
  const fixture = apiFixture(async (_url, init) => {
    if (init.method === "POST") { submits++; return Response.json({ task_id: `task-${submits}`, status: "pending" }); }
    throw new Error("offline");
  });
  await assert.rejects(fixture.api.iterateCandidateFilter(payload));
  fixture.switchUser("user-b");
  await assert.rejects(fixture.api.iterateCandidateFilter(payload));
  assert.equal(submits, 2);
});

test("切换岗位或版本后旧筛选响应不会覆盖当前对话与版本", async () => {
  const request = deferred();
  const page = pageFixture(() => request.promise);
  const pending = page.run();
  page.scope.filterContextRef.current = { jobRuleId: "job-b", version: "other" };
  page.values.conversation = [{ role: "assistant", content: "当前岗位对话" }];
  request.resolve(result);
  await pending;
  assert.equal(page.values.conversation[0].content, "当前岗位对话");
  assert.equal(page.values.version, "");
});
