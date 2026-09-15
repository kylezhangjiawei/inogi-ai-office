import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(setImmediate);
const pageSource = readFileSync(new URL("../src/app/ResumeScreeningPage.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/app/lib/recruitmentApi.ts", import.meta.url), "utf8");
const result = { action: "filter", version_id: "v2", answer: "筛选完成", total_count: 360, recommend_count: 2, hold_count: 1, reject_count: 357 };
const payload = { instruction: "必须有美国市场和医疗行业经验", job_rule_id: "job-a" };
const task = (patch = {}) => ({ task_id: "task-1", status: "processing", phase: "scoring", processed_count: 160,
  total_count: 360, instruction: payload.instruction, job_rule_id: "job-a", base_version: null,
  created_at: "2026-09-11T01:00:00Z", updated_at: "2026-09-11T01:03:00Z", retryable: false, ...patch });

function apiFixture(fetch) {
  const code = ts.transpileModule(apiSource.replaceAll("import.meta.env.VITE_RECRUITMENT_API_BASE", '\"\"'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let userId = "user-a";
  let authCleared;
  const timers = [], exports = {};
  const auth = { authFetch: fetch, readErrorMessage: async (_response, fallback) => fallback,
    getStoredUser: () => userId ? ({ id: userId }) : null,
    addAuthClearedListener: (fn) => { authCleared = fn; } };
  new Function("exports", "require", "setTimeout", "clearTimeout", code)(exports, (name) => {
    assert.equal(name, "./authSession"); return auth;
  }, (fn, delay) => {
    const timer = { fn, delay, cancelled: false }; timers.push(timer);
    if (delay < 20000) queueMicrotask(() => { if (!timer.cancelled) fn(); });
    return timer;
  }, (timer) => { timer.cancelled = true; });
  return { api: exports.recruitmentApi, HttpError: exports.CandidateFilterTaskHttpError, timers,
    switchUser(id) { userId = id; }, logout() { userId = null; authCleared(); } };
}

// Execute the actual handler/effect bodies with state setters, without importing the entire page UI.
function pageFixture(api = {}) {
  const ast = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = {};
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ["handleIterateCandidateFilter", "handleRetryCandidateFilterTask"].includes(node.name?.text)) nodes[node.name.text] = node.getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
      const body = node.arguments[0]?.getText(ast) ?? "";
      if (body.includes("getCurrentCandidateFilterTask")) nodes.queryEffect = `const queryEffect = ${body};`;
      if (body.includes("const response = filterTask.result!")) nodes.resultEffect = `const resultEffect = ${body};`;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const errors = [], posts = [];
  const scope = {
    filterInstruction: payload.instruction, filterConversation: [], filterRunning: false, filterQuerying: false,
    filterQueryError: "", filterQueryEpoch: 0, filterTask: null, filterUserId: "user-a", filterResultPending: false,
    canScreenCandidates: true, filterPermissionRef: { current: true }, showFilterDialog: false,
    jobRuleFilter: "job-a", selectedFilterVersion: "", filterSessions: [],
    filterContextRef: { current: { userId: "user-a", jobRuleId: "job-a", version: "" } },
    filterTaskUserRef: { current: "user-a" }, filterRequestRef: { current: null }, filterSubmitRef: { current: null },
    appliedFilterTaskRef: { current: "" },
    getStoredUser: () => ({ id: scope.filterUserId }),
    CandidateFilterTaskHttpError: class extends Error {},
    recruitmentApi: { createCandidateFilterTask: async (body) => { posts.push(body); return task(); },
      listCandidateFilterSessions: async () => [], getCurrentCandidateFilterTask: async () => null,
      getCandidateFilterTask: async () => task(), watchCandidateFilterTask: async () => {}, ...api },
    toast: { error: (value) => errors.push(value), success() {}, message() {} },
    getErrorMessage: (error) => error.message, setCandidatePage() {},
  };
  for (const state of ["FilterInstruction", "FilterConversation", "FilterRunning", "FilterQuerying", "FilterQueryError", "FilterQueryEpoch", "FilterTask", "SelectedFilterVersion", "FilterSessions", "ShowFilterDialog"]) {
    const key = state[0].toLowerCase() + state.slice(1);
    scope[`set${state}`] = (value) => { scope[key] = typeof value === "function" ? value(scope[key]) : value; };
  }
  const bound = Object.fromEntries(Object.entries(nodes).map(([name, body]) => {
    const code = ts.transpileModule(`${body}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return [name, new Function("scope", `with(scope) { ${code} }`)(scope)];
  }));
  return { scope, errors, posts, ...bound };
}

test("提交立即返回任务，不隐式轮询；并发重复提交合并一次 POST", async () => {
  const accepted = deferred(); let posts = 0;
  const h = apiFixture(async (_url, init) => { assert.equal(init.method, "POST"); posts++; return accepted.promise; });
  const a = h.api.createCandidateFilterTask(payload), b = h.api.createCandidateFilterTask(payload);
  assert.equal(a, b); accepted.resolve(Response.json(task()));
  assert.deepEqual(await a, task()); assert.equal(posts, 1);
});

test("360人长任务只用 GET 轮询，无整体15分钟截止且每轮等待3秒", async () => {
  let polls = 0; const progress = [];
  const h = apiFixture(async (_url, init) => {
    assert.notEqual(init.method, "POST"); polls++;
    return Response.json(task(polls <= 310 ? { processed_count: polls } : { status: "completed", phase: "complete", processed_count: 360, result }));
  });
  assert.equal((await h.api.watchCandidateFilterTask("task-1", { onProgress: (next) => progress.push(next.processed_count) })).status, "completed");
  assert.equal(polls, 311); assert.equal(progress.at(-1), 360);
  assert.equal(h.timers.filter((timer) => timer.delay === 3000).length, 310);
  assert.doesNotMatch(apiSource, /Date\.now\(\) \+ 15 \* 60_000/);
});

test("查询中断有界退避后停止；继续查询同一 ID 绝不重 POST", async () => {
  let calls = 0;
  const h = apiFixture(async (url, init) => {
    assert.equal(url, "/api/recruitment/candidate-filter-tasks/task-1"); assert.notEqual(init.method, "POST");
    if (++calls <= 4) throw new Error("offline");
    return Response.json(task({ status: "completed", phase: "complete", result }));
  });
  await assert.rejects(h.api.watchCandidateFilterTask("task-1", { onProgress() {} }), /继续查询/);
  assert.equal(calls, 4);
  assert.deepEqual(h.timers.filter((timer) => timer.delay !== 20000).map((timer) => timer.delay), [3000, 6000, 12000]);
  assert.equal((await h.api.watchCandidateFilterTask("task-1", { onProgress() {} })).status, "completed");
});

test("单次20秒超时会中止读取；外部AbortSignal立即退出且不取消后台", async () => {
  const signals = [];
  const h = apiFixture(async (_url, init) => new Promise((_resolve, reject) => {
    signals.push(init.signal); init.signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError")));
  }));
  const read = h.api.getCandidateFilterTask("task-1");
  h.timers.find((timer) => timer.delay === 20000).fn();
  await assert.rejects(read, { name: "AbortError" }); assert.equal(signals[0].aborted, true);
  const controller = new AbortController();
  const watch = h.api.watchCandidateFilterTask("task-1", { signal: controller.signal, onProgress() { assert.fail("aborted response"); } });
  controller.abort(); await assert.rejects(watch, { name: "AbortError" });
  assert.equal(signals[1].aborted, true);

  // authFetch waits for shared token refresh without forwarding the caller's signal.
  // Both that wait and response-body parsing must still obey the caller's deadline.
  for (const phase of ["refresh", "body"]) {
    for (const cancel of ["timeout", "external"]) {
      const stalled = deferred();
      const waiting = apiFixture(async () => phase === "refresh" ? stalled.promise : { ok: true, text: () => stalled.promise });
      const stop = new AbortController();
      const read = waiting.api.getCurrentCandidateFilterTask(stop.signal);
      await flush();
      if (cancel === "timeout") waiting.timers.find((timer) => timer.delay === 20000 && !timer.cancelled).fn();
      else stop.abort();
      const settled = read.then(() => "resolved", (error) => error.name);
      await flush();
      assert.equal(await Promise.race([settled, Promise.resolve("still-pending")]), "AbortError", `${phase}/${cancel} must stop even if the underlying promise ignores abort`);
      // A late completion must remain rejected and cannot restore a stale task.
      stalled.resolve(phase === "refresh" ? Response.json(task()) : JSON.stringify(task()));
      await flush();
      assert.equal(await settled, "AbortError");
    }
  }
});

test("账号变更或退出后晚到结果不交给旧页面", async () => {
  for (const logout of [false, true]) {
    const pending = deferred(); const h = apiFixture(() => pending.promise);
    const read = h.api.getCurrentCandidateFilterTask();
    if (logout) h.logout(); else h.switchUser("user-b");
    pending.resolve(Response.json(task()));
    await assert.rejects(read, { name: "AbortError" });
  }
});

test("current恢复和retry使用独立协议，重试不提交候选人或评分规则", async () => {
  const calls = [];
  const h = apiFixture(async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith("current") ? null : task()); });
  assert.equal(await h.api.getCurrentCandidateFilterTask(), null);
  assert.equal((await h.api.retryCandidateFilterTask("task/a")).processed_count, 160);
  assert.equal(calls[1].url, "/api/recruitment/candidate-filter-tasks/task%2Fa/retry");
  assert.equal(calls[1].init.method, "POST"); assert.equal(calls[1].init.body, undefined);
});

test("首次进入没有历史任务，兼容旧接口200/204空响应，页面可正常开始新筛选", async () => {
  for (const status of [200, 204]) {
    const calls = [];
    const h = apiFixture(async (url, init) => {
      calls.push({ url, method: init.method ?? "GET" });
      return url.endsWith("/current") ? new Response(null, { status }) : Response.json(task());
    });
    const page = pageFixture(h.api);
    const stop = page.queryEffect(); await flush();
    assert.equal(page.scope.filterQuerying, false);
    assert.equal(page.scope.filterQueryError, "", `${status}无任务不是JSON解析错误`);
    assert.equal(page.scope.filterTask, null);
    await page.handleIterateCandidateFilter();
    assert.equal(page.scope.filterTask.task_id, "task-1");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "POST"]);
    stop();
  }
});

test("只有current允许无任务空响应，提交/重试/指定任务空响应及损坏JSON仍报错", async () => {
  const empty = apiFixture(async () => new Response(null, { status: 200 }));
  await assert.rejects(empty.api.createCandidateFilterTask(payload), SyntaxError);
  await assert.rejects(empty.api.retryCandidateFilterTask("task-1"), SyntaxError);
  await assert.rejects(empty.api.getCandidateFilterTask("task-1"), SyntaxError);
  const broken = apiFixture(async () => new Response('{"task_id":', { status: 200 }));
  await assert.rejects(broken.api.getCurrentCandidateFilterTask(), SyntaxError);
  const failed = apiFixture(async () => new Response(null, { status: 503 }));
  await assert.rejects(failed.api.getCurrentCandidateFilterTask(), (error) => error.status === 503);
});

test("查询401/403/404不会网络重试或创建替代任务", async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0; const h = apiFixture(async () => { calls++; return new Response("denied", { status }); });
    await assert.rejects(h.api.watchCandidateFilterTask("task-1", { onProgress() {} }), (error) => error.status === status);
    assert.equal(calls, 1);
  }
});

test("提交失败保留输入，结果不确定时要求GET确认；新提交不再限制80人", async () => {
  const failed = pageFixture({ createCandidateFilterTask: async () => { throw new Error("504"); } });
  await failed.handleIterateCandidateFilter();
  assert.equal(failed.scope.filterInstruction, payload.instruction);
  assert.match(failed.scope.filterQueryError, /继续查询/);
  await failed.handleIterateCandidateFilter();
  const success = pageFixture(); await success.handleIterateCandidateFilter();
  assert.equal(success.scope.filterInstruction, payload.instruction, "仅接受任务不能清空输入");
  assert.equal(success.posts.length, 1); assert.equal(success.posts[0].limit, undefined);
  assert.equal(success.posts[0].candidate_ids, undefined, "当前页ID不应替代全部候选人范围");
  const manyRounds = pageFixture();
  manyRounds.scope.filterConversation = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `第${index}条历史` }));
  await manyRounds.handleIterateCandidateFilter();
  assert.equal(manyRounds.posts[0].history.length, 10, "多轮对话不得超过后端历史条数上限");
  assert.equal(manyRounds.posts[0].history[0].content, "第2条历史");
});

test("刷新恢复实际任务进度，查询effect卸载后不更新状态", async () => {
  const watched = deferred(); let posts = 0, watchSignal;
  const h = pageFixture({ createCandidateFilterTask: async () => { posts++; },
    getCurrentCandidateFilterTask: async () => task(),
    watchCandidateFilterTask: async (_id, options) => { watchSignal = options.signal; return watched.promise; } });
  const stop = h.queryEffect(); await flush();
  assert.equal(h.scope.filterTask.processed_count, 160); assert.equal(h.scope.filterRunning, true); assert.equal(posts, 0);
  stop(); assert.equal(watchSignal.aborted, true); watched.reject(new Error("late")); await flush();
  assert.equal(h.scope.filterQueryError, "");
});

test("失败后的继续执行保留任务ID；完成/澄清才清空原输入", async () => {
  let retried;
  const h = pageFixture({ retryCandidateFilterTask: async (id) => { retried = id; return task(); } });
  h.scope.filterTask = task({ status: "failed", phase: "failed", retryable: true });
  await h.handleRetryCandidateFilterTask(); assert.equal(retried, "task-1"); assert.equal(h.scope.filterInstruction, payload.instruction);
  for (const response of [result, { action: "clarify", answer: "需要哪类市场经验？" }]) {
    const p = pageFixture(); p.scope.filterTask = task({ status: "completed", phase: "complete", result: response });
    const stop = p.resultEffect(); await flush();
    assert.equal(p.scope.filterInstruction, ""); assert.equal(p.scope.filterConversation.at(-1).content, response.answer);
    assert.equal(p.scope.selectedFilterVersion, response.version_id ?? ""); stop();
  }
});

test("切换岗位/版本/账号或卸载后，完成任务不覆盖当前对话", async () => {
  for (const change of ["job", "version", "user", "unmount"]) {
    const pending = deferred(); const h = pageFixture({ listCandidateFilterSessions: () => pending.promise });
    h.scope.filterTask = task({ status: "completed", phase: "complete", result });
    const stop = h.resultEffect();
    if (change === "unmount") stop();
    else h.scope.filterContextRef.current = { ...h.scope.filterContextRef.current,
      ...(change === "job" ? { jobRuleId: "job-b" } : change === "version" ? { version: "other" } : { userId: "user-b" }) };
    pending.resolve([]); await flush();
    assert.equal(h.scope.selectedFilterVersion, ""); assert.equal(h.scope.filterConversation.length, 0);
    assert.equal(h.scope.filterInstruction, payload.instruction); stop();
  }
});

test("进度卡有阶段、实际人数及独立查询/续跑操作，无敏感payload本地持久化", () => {
  assert.match(pageSource, /已评分 \{task\.processed_count\} \/ \{task\.total_count\} 人/);
  assert.match(pageSource, /phaseLabels\[task\.phase\]/);
  assert.match(pageSource, /继续查询/); assert.match(pageSource, /继续执行/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage/);
});

test("账号切换恢复current而不查询上一账号ID；晚到提交不覆盖新岗位", async () => {
  let currents = 0;
  const h = pageFixture({ getCurrentCandidateFilterTask: async () => { currents++; return null; },
    watchCandidateFilterTask: async () => assert.fail("cannot query another account's task") });
  h.scope.filterTask = task();
  h.scope.filterTaskUserRef.current = "old-user";
  const stop = h.queryEffect(); await flush();
  assert.equal(currents, 1); assert.equal(h.scope.filterTask, null); stop();

  const pending = deferred(); const p = pageFixture({ createCandidateFilterTask: () => pending.promise });
  const submitting = p.handleIterateCandidateFilter();
  p.scope.filterContextRef.current = { ...p.scope.filterContextRef.current, jobRuleId: "job-b" };
  pending.resolve(task()); await submitting;
  assert.equal(p.scope.filterTask, null); assert.equal(p.scope.filterConversation.length, 0);
});

test("仅查看权限不自动GET任务、不提交或重试二次筛选", async () => {
  const forbiddenCall = async () => assert.fail("view-only user must not call task APIs");
  const h = pageFixture({ getCurrentCandidateFilterTask: forbiddenCall, watchCandidateFilterTask: forbiddenCall,
    createCandidateFilterTask: forbiddenCall, retryCandidateFilterTask: forbiddenCall });
  h.scope.canScreenCandidates = false;
  h.scope.filterPermissionRef.current = false;
  assert.equal(h.queryEffect(), undefined);
  await flush();
  h.scope.filterTask = task({ status: "failed", phase: "failed", retryable: true });
  await h.handleIterateCandidateFilter();
  await h.handleRetryCandidateFilterTask();
  assert.equal(h.scope.filterQueryError, "");
  assert.equal(h.scope.filterInstruction, payload.instruction);
  assert.deepEqual(h.errors, []);
  assert.match(pageSource, /usePermission\(PERMISSIONS\.RESUME_SCREEN\)/);
  assert.match(pageSource, /\{canScreenCandidates \? <button/);
});

test("筛选权限撤销会停止查询和提交等待、清理任务提示并丢弃晚到结果", async () => {
  const pending = deferred();
  const h = pageFixture({ getCurrentCandidateFilterTask: () => pending.promise });
  const stop = h.queryEffect();
  const querySignal = h.scope.filterRequestRef.current.signal;
  h.scope.canScreenCandidates = false;
  h.scope.filterPermissionRef.current = false;
  h.scope.filterQueryError = "previous error";
  h.scope.filterTask = task();
  h.scope.showFilterDialog = true;
  stop(); h.queryEffect();
  assert.equal(querySignal.aborted, true);
  pending.resolve(task()); await flush();
  assert.equal(h.scope.filterTask, null);
  assert.equal(h.scope.filterQueryError, "");
  assert.equal(h.scope.filterQuerying, false);
  assert.equal(h.scope.filterRunning, false);
  assert.equal(h.scope.showFilterDialog, false);

  const accepted = deferred();
  const p = pageFixture({ createCandidateFilterTask: () => accepted.promise });
  const submitting = p.handleIterateCandidateFilter();
  const submissionSignal = p.scope.filterSubmitRef.current.signal;
  p.scope.canScreenCandidates = false;
  p.scope.filterPermissionRef.current = false;
  p.queryEffect();
  accepted.resolve(task()); await submitting;
  assert.equal(submissionSignal.aborted, true);
  assert.equal(p.scope.filterTask, null);
  assert.equal(p.scope.filterConversation.length, 0);
  assert.equal(p.scope.filterInstruction, payload.instruction);
});
