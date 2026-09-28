import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const workspaceSource = await readFile(
  new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url),
  "utf8",
);
const peopleSource = await readFile(
  new URL("../src/app/RDPeopleManagementPage.tsx", import.meta.url),
  "utf8",
);

function workspaceLoadingFixture() {
  const ast = ts.createSourceFile("RDMyWorkspacePage.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "RDMyWorkspacePage");
  assert.ok(page?.body, "Missing workspace component");
  const names = ["workspaceLoadSeqRef", "workspaceKey", "loadWorkspace"];
  const declarations = page.body.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => names.includes(declaration.name.getText(ast)));
  assert.equal(declarations.length, names.length);
  const callbackStatement = page.body.statements.findIndex((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === "loadWorkspace"));
  const mountEffect = page.body.statements[callbackStatement + 1];
  assert.ok(ts.isExpressionStatement(mountEffect) && ts.isCallExpression(mountEffect.expression)
    && mountEffect.expression.expression.getText(ast) === "useEffect", "Missing workspace mount/cleanup effect");

  const empty = { myTasks: [], collabTasks: [], aiSuggestions: [], notifications: [] };
  const state = { workspace: empty, loading: true, error: null };
  const requests = [], loads = [], updates = [];
  let cleanup;
  const set = (key) => (value) => { state[key] = value; updates.push({ key, value }); };
  const bindings = {
    React: {
      useRef: (value) => ({ current: value }),
      useCallback: (callback) => (...args) => { const load = callback(...args); loads.push(load); return load; },
    },
    useEffect: (callback) => { cleanup = callback(); },
    isUsCollabWorkspace: () => false,
    fetchRdWorkspace: () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }),
    EMPTY_WORKSPACE: empty,
    setWorkspace: set("workspace"), setLoading: set("loading"), setLoadError: set("error"),
  };
  // Execute the real callback and mount cleanup. Only React state and the network are replaced.
  const code = ts.transpileModule(`${declarations.map((declaration) => `const ${declaration.getText(ast)};`).join("\n")}
    ${mountEffect.getText(ast)}
    return loadWorkspace;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadWorkspace = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return { state, requests, loads, updates, loadWorkspace, unmount: () => cleanup() };
}

const workspacePayload = (taskId) => ({ myTasks: [{ task_id: taskId }], collabTasks: [], notifications: [{ id: taskId }] });

test("工作台加载状态：普通首屏成功后展示任务并结束加载", async () => {
  const f = workspaceLoadingFixture();
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.loading, true);
  f.requests[0].resolve(workspacePayload("first"));
  await f.loads[0];
  assert.equal(f.state.workspace.myTasks[0].task_id, "first");
  assert.equal(f.state.loading, false);
  assert.equal(f.state.error, null);
  f.unmount();
});

for (const order of [[1, 0], [0, 1]]) {
  test(`工作台加载状态：首屏被静默刷新接管，${order[0] === 1 ? "新" : "旧"}请求先返回仍结束加载`, async () => {
    const f = workspaceLoadingFixture();
    f.loadWorkspace({ silent: true });
    for (const index of order) {
      f.requests[index].resolve(workspacePayload(index === 1 ? "latest" : "stale"));
      await f.loads[index];
      if (index === 0 && order[0] === 0) {
        assert.equal(f.state.loading, true, "旧请求不能提前关闭仍在等待的新请求加载态");
        assert.deepEqual(f.state.workspace.myTasks, []);
      }
    }
    assert.equal(f.state.workspace.myTasks[0].task_id, "latest");
    assert.equal(f.state.loading, false, "最新静默请求也必须结束首屏骨架屏");
    assert.equal(f.state.error, null);
    f.unmount();
  });
}

test("工作台加载状态：最新静默请求失败结束首屏加载，旧成功不能覆盖错误", async () => {
  const f = workspaceLoadingFixture();
  const latest = f.loadWorkspace({ silent: true });
  f.requests[1].reject(new Error("最新请求失败"));
  await latest;
  f.requests[0].resolve(workspacePayload("stale"));
  await f.loads[0];
  assert.deepEqual(f.state.workspace.myTasks, []);
  assert.equal(f.state.error, "最新请求失败");
  assert.equal(f.state.loading, false, "失败后必须允许用户重新加载");
  f.unmount();
});

test("工作台加载状态：已有数据静默刷新不出现骨架屏，失败保留上次结果", async () => {
  const f = workspaceLoadingFixture();
  f.requests[0].resolve(workspacePayload("first"));
  await f.loads[0];
  const start = f.updates.length;
  const success = f.loadWorkspace({ silent: true });
  assert.equal(f.state.loading, false);
  assert.equal(f.state.workspace.myTasks[0].task_id, "first");
  f.requests[1].resolve(workspacePayload("updated"));
  await success;
  assert.equal(f.state.loading, false);
  const previous = f.state.workspace;
  const failure = f.loadWorkspace({ silent: true });
  f.requests[2].reject(new Error("后台刷新失败"));
  await failure;
  assert.equal(f.state.workspace, previous);
  assert.equal(f.state.error, "后台刷新失败");
  assert.equal(f.state.loading, false);
  assert.ok(f.updates.slice(start).every(({ key, value }) => key !== "loading" || value === false));
  f.unmount();
});

test("工作台加载状态：过期失败不能覆盖新请求的结果或错误状态", async () => {
  const f = workspaceLoadingFixture();
  const latest = f.loadWorkspace();
  f.requests[1].resolve(workspacePayload("latest"));
  await latest;
  const updateCount = f.updates.length;
  f.requests[0].reject(new Error("旧请求失败"));
  await f.loads[0];
  assert.equal(f.state.workspace.myTasks[0].task_id, "latest");
  assert.equal(f.state.error, null);
  assert.equal(f.state.loading, false);
  assert.equal(f.updates.length, updateCount);
  f.unmount();
});

for (const outcome of ["success", "failure"]) {
  test(`工作台加载状态：卸载后${outcome === "success" ? "成功" : "失败"}响应均不再更新状态`, async () => {
    const f = workspaceLoadingFixture();
    f.unmount();
    const updateCount = f.updates.length;
    if (outcome === "success") f.requests[0].resolve(workspacePayload("unmounted"));
    else f.requests[0].reject(new Error("卸载后的请求失败"));
    await f.loads[0];
    assert.equal(f.updates.length, updateCount);
  });
}

test("研发工作台保留三工作区数据隔离并优化派生查询", () => {
  assert.match(workspaceSource, /fetchRdWorkspace\(\{ includeCollaboration: !isUsCollabWorkspace\(\) \}\)/);
  assert.match(workspaceSource, /const currentWorkspace = isUsCollabWorkspace\(\) \? "us-collab" : "rd";/);
  assert.match(workspaceSource, /const primaryTaskIds = useMemo\(\(\) => new Set/);
  assert.match(workspaceSource, /const deferredTaskKeyword = useDeferredValue\(taskKeyword\)/);
  assert.match(workspaceSource, /const taskById = useMemo\(\(\) => new Map/);
  assert.match(workspaceSource, /\[\.\.\.\(taskRoleTab === "primary" \? filteredMyTasks : filteredCollabTasks\)\]\.sort/);
  assert.doesNotMatch(
    workspaceSource,
    /\(taskRoleTab === "primary" \? filteredMyTasks : filteredCollabTasks\)\.sort/,
    "筛选结果不得被原地排序",
  );
});

test("研发工作台首屏使用文字、图标与可读数字呈现决策摘要", () => {
  assert.match(workspaceSource, /<h1 className="rd-horizon-workspace-title/);
  assert.equal((workspaceSource.match(/<h1\b/g) ?? []).length, 1, "工作台应提供唯一页面主标题");
  for (const label of ["主责", "协助", "完成率", "逾期", "今日到期", "待处理"]) {
    assert.match(workspaceSource, new RegExp(`t\\(\"${label}\"\\)`));
  }
  for (const icon of ["User", "Users", "CheckCircle2", "AlertTriangle", "CalendarClock", "Bell"]) {
    assert.match(workspaceSource, new RegExp(`<${icon} className=\"size-3\"`));
  }
  assert.match(workspaceSource, /rd-horizon-workspace-metric[^\n]+tabular-nums/);
  assert.match(workspaceSource, /role="progressbar"[\s\S]{0,260}aria-valuenow=\{progressValue\}/);
  assert.match(workspaceSource, /text-balance text-\[15px\]/);
  assert.match(workspaceSource, /line-clamp-2 min-h-10 text-pretty/);
});

test("研发工作台搜索筛选、失败和空态都提供明确下一步", () => {
  assert.match(workspaceSource, /aria-label=\{t\("清除任务搜索"\)\}/);
  assert.match(workspaceSource, /t\("清空筛选"\)/);
  assert.match(workspaceSource, /role="alert"/);
  assert.match(workspaceSource, /onClick=\{\(\) => void loadWorkspace\(\)\}/);
  assert.match(workspaceSource, /t\("重新加载"\)/);
  assert.match(workspaceSource, /taskFiltersActive \? t\("清空筛选"\) : t\("刷新工作台"\)/);
  assert.match(workspaceSource, /role="status" aria-label=\{t\("正在加载任务"\)\}/);
  assert.match(workspaceSource, /focus-visible:ring-2 focus-visible:ring-primary/);
});

test("研发审核通知在任务已处理后独立收敛消息状态", () => {
  assert.match(workspaceSource, /const REVIEW_NOTIFICATION_PATCH_RETRY_DELAYS = \[0, 250, 750\] as const/);
  assert.match(workspaceSource, /function isReviewAlreadySettledError\(error: unknown\)/);
  assert.match(workspaceSource, /不是待审核状态\|不处于待审核状态\|没有待处理的审核\|请勿重复审核\|已被其他审核人处理/);
  assert.match(workspaceSource, /async function patchReviewNotificationHandled\(notificationId: string\): Promise<boolean>/);
  assert.match(workspaceSource, /retryReviewNotificationHandledLater\(notification\.id\)/);

  const settleStart = workspaceSource.indexOf("const settleReviewNotification");
  const settleEnd = workspaceSource.indexOf("const approveNotificationReview", settleStart);
  const settleSource = workspaceSource.slice(settleStart, settleEnd);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  assert.ok(
    settleSource.indexOf("setDismissedNotifs") < settleSource.indexOf("await patchReviewNotificationHandled"),
    "任务审核完成后应先撤掉本地操作入口，再等待通知回写",
  );
  assert.match(settleSource, /handled: true, read: true/);
  assert.match(settleSource, /current\?\.kind === "notification"/);

  assert.equal((workspaceSource.match(/if \(!isReviewAlreadySettledError\(error\)\) throw error;/g) ?? []).length, 2);
  assert.match(workspaceSource, /const messageSynced = await settleReviewNotification\(notification\)/);
  assert.match(workspaceSource, /if \(notif\) await rejectNotificationReview\(notif, reason\)/);
  assert.match(workspaceSource, /通知已从当前工作台收起，消息状态将在后台重试同步/);
});

test("审核确认提交期间锁住关闭路径，避免重复或相反动作并发", () => {
  const modalStart = workspaceSource.indexOf("function ConfirmActionModal");
  const modalEnd = workspaceSource.indexOf("function FlowSteps", modalStart);
  const modalSource = workspaceSource.slice(modalStart, modalEnd);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  assert.match(modalSource, /const requestClose = \(\) => \{[\s\S]{0,80}if \(!confirming\) onCancel\(\)/);
  assert.match(modalSource, /useWorkspaceModalLayer\(surfaceRef, cancelButtonRef, requestClose\)/);
  assert.match(modalSource, /aria-busy=\{confirming\}/);
  assert.ok((modalSource.match(/disabled=\{confirming\}/g) ?? []).length >= 3);
  assert.match(modalSource, /onClick=\{requestClose\}/);
});

test("人员页复用真实任务负载并避免重复线性查找", () => {
  for (const field of ["task_count", "tasks", "blocked_count", "completed_this_month", "avg_completion"]) {
    assert.match(peopleSource, new RegExp(`${field}: person\\.${field}`));
  }
  assert.match(peopleSource, /const deferredKeyword = useDeferredValue\(keyword\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(peopleSource, /const userById = useMemo\(\(\) => new Map/);
  assert.match(peopleSource, /\(person\.task_count \?\? 0\) > person\.max_tasks/);
  assert.match(peopleSource, /t\("任务负载"\)/);
  assert.match(peopleSource, /role="progressbar"[\s\S]{0,260}aria-valuenow=\{loadPercentage\}/);
  assert.match(peopleSource, /t\("超负载"\)/);
  assert.match(peopleSource, /t\("暂无归属任务"\)/);
});

test("人员页具备响应式表格、语义表头与可恢复状态", () => {
  assert.match(peopleSource, /<h2 className="text-balance text-xl/);
  assert.doesNotMatch(peopleSource, /<h1/, "页面壳已提供唯一主标题，人员页内容区不应重复 h1");
  assert.match(peopleSource, /rd-people-table-scroll overflow-x-auto/);
  assert.match(peopleSource, /rd-people-table w-full min-w-\[1080px\]/);
  assert.equal((peopleSource.match(/<th scope="col"/g) ?? []).length, 9);
  assert.match(peopleSource, /colSpan=\{9\}/);
  assert.match(peopleSource, /role="alert"/);
  assert.match(peopleSource, /setReloadVersion\(\(version\) => version \+ 1\)/);
  assert.match(peopleSource, /t\("重新加载"\)/);
  assert.match(peopleSource, /t\("重置筛选"\)/);
  assert.match(peopleSource, /t\("刷新成员"\)/);
  assert.match(peopleSource, /text-balance text-xl/);
  assert.match(peopleSource, /text-pretty text-sm text-slate-500/);
});

test("人员新增、编辑、删除保留业务 API 并防止重复提交", () => {
  assert.match(peopleSource, /if \(savingPerson\) return;/);
  assert.match(peopleSource, /if \(deletingPerson\) return;/);
  assert.match(peopleSource, /if \(savingNewDept\) return;/);
  assert.match(peopleSource, /saving=\{savingPerson\}/);
  assert.match(peopleSource, /busy=\{deletingPerson\}/);
  assert.match(peopleSource, /aria-busy=\{saving\}/);
  assert.match(peopleSource, /aria-busy=\{busy\}/);
  assert.match(peopleSource, /updateRdPerson\(\{ \.\.\.personToMutation\(p\), id: editing\.id \}\)/);
  assert.match(peopleSource, /createRdPerson\(personToMutation\(p\)\)/);
  assert.match(peopleSource, /deleteRdPerson\(deleteTarget\.id\)/);
  assert.match(peopleSource, /role="alertdialog"/);
  assert.match(peopleSource, /createPortal\(dialog, document\.body\)/);
});

test("人员表单在身份与分组主数据不可验证时阻止保存并支持重试", () => {
  assert.match(peopleSource, /identityOptionsError/);
  assert.match(peopleSource, /departmentError/);
  assert.match(peopleSource, /const dependenciesReady = !identityOptionsError && !departmentError/);
  assert.match(peopleSource, /disabled=\{saving \|\| !dependenciesReady\}/);
  assert.match(peopleSource, /身份或分组主数据尚未读取成功/);
  assert.match(peopleSource, /aria-label=\{t\("知识库访问分值"\)\}/);
  assert.match(peopleSource, /aria-valuetext=/);
});

test("两页遵守 Horizon 基线视觉约束", () => {
  for (const [name, source] of [["工作台", workspaceSource], ["人员页", peopleSource]]) {
    assert.doesNotMatch(source, /\#[0-9a-f]{6}\][0-9]/i, `${name} 不应包含机械替色生成的非法任意值类名`);
    assert.doesNotMatch(source, /(?:indigo|violet|purple|pink|cyan|blue|red|orange)-\d+/i, `${name} 不应残留多强调色 token`);
    assert.doesNotMatch(source, /linear-gradient|backdrop-blur|transition-all|tracking-(?:tight|wide|wider|widest)/, `${name} 不应残留禁用视觉模式`);
    assert.doesNotMatch(source, /hover:-translate|group-hover:(?:-?translate|rotate)/, `${name} 不应使用 hover 位移动画`);
  }
});
