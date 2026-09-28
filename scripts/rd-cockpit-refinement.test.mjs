import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const page = readFileSync(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const taskModel = readFileSync(new URL("../src/app/rd/taskModel.ts", import.meta.url), "utf8");
const cockpitModel = readFileSync(new URL("../src/app/rd/cockpitModel.ts", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `缺少区段起点：${startMarker}`);
  assert.ok(end > start, `缺少区段终点：${endMarker}`);
  return page.slice(start, end);
}

const systemPanorama = section("function SystemHealthCard(", "// ─── DETAIL VIEW components");
const personCockpit = readFileSync(new URL("../src/app/rd/PersonTaskCockpit.tsx", import.meta.url), "utf8");
const executiveOverview = section("function ExecutiveOverview(", "// ─── MoveTasksDialog");
const reassignDialog = section("function TaskReassignModal(", "// ─── ClearDataDialog");
const moveTaskDialog = readFileSync(new URL("../src/app/rd/MoveTaskDialog.tsx", import.meta.url), "utf8");
const moveTasksDialog = section("function MoveTasksDialog(", "// ─── TaskCompletedCelebration");
const taskManagementPage = page.slice(page.indexOf("export function RDTaskManagementPage("));
const coreCockpit = `${systemPanorama}\n${personCockpit}\n${executiveOverview}`;

// Execute the real handlers; only their API and React state effects are supplied here.
function cockpitBindings(componentName, names, dependencies) {
  const ast = ts.createSourceFile("cockpit.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  assert.ok(component, `missing component ${componentName}`);
  const declarations = new Map();
  for (const statement of component.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
        declarations.set(declaration.name.text, `const ${declaration.name.text} = ${declaration.initializer.getText(ast)};`);
      }
    }
  }
  for (const name of names) assert.ok(declarations.has(name), `missing binding ${name}`);
  const helpers = ast.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    node.name?.text === "resolveDeleteDialogTargetAfterSuccess").map((node) => node.getText(ast)).join("\n");
  const javascript = ts.transpileModule(
    helpers + "\n" + names.map((name) => declarations.get(name)).join("\n") + `\nreturn { ${names.join(", ")} };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function("exports", ...Object.keys(dependencies), javascript)({}, ...Object.values(dependencies));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function deletionFixture(workspace, response = Promise.resolve()) {
  const state = { target: { task_id: "task-old" }, pendingId: null, successes: [], errors: [], refreshes: 0, requests: [] };
  const requestRef = { current: null };
  const sequenceRef = { current: 0 };
  const bind = () => cockpitBindings("RDTaskManagementPage", ["usCollab", "productionWorkspace", "nativeRdCockpit", "handleDeleteTaskConfirm"], {
    isUsCollabWorkspace: () => workspace === "us-collab",
    isProductionWorkspace: () => workspace === "production",
    deleteTaskTarget: state.target,
    deleteTaskPendingRequestRef: requestRef,
    deleteTaskRequestSequenceRef: sequenceRef,
    setDeleteTaskPendingId: (value) => { state.pendingId = typeof value === "function" ? value(state.pendingId) : value; },
    setDeleteTaskTarget: (value) => { state.target = typeof value === "function" ? value(state.target) : value; },
    deleteRdTask: async (id) => { state.requests.push({ method: "delete", id }); await response; },
    updateRdTask: async (id, patch) => { state.requests.push({ method: "update", id, patch }); await response; },
    toast: { success: (text) => state.successes.push(text), error: (text) => state.errors.push(text) },
    t: (text) => text,
    loadCategories: () => { state.refreshes++; },
  });
  return { state, requestRef, bind };
}

test("研发驾驶舱删除只提交删除审核申请，保留任务并刷新最新状态", async () => {
  const { state, bind } = deletionFixture("rd");
  await bind().handleDeleteTaskConfirm();
  assert.deepEqual(state.requests, [{ method: "update", id: "task-old", patch: { status: "pending_review", pending_review_type: "abandon" } }]);
  assert.deepEqual(state.successes, ["删除申请已提交，等待审核"]);
  assert.equal(state.refreshes, 1);
  assert.equal(state.target, null);
  assert.equal(state.pendingId, null);
});

test("协同和生产驾驶舱仍使用原直接删除接口", async () => {
  for (const workspace of ["us-collab", "production"]) {
    const { state, bind } = deletionFixture(workspace);
    await bind().handleDeleteTaskConfirm();
    assert.deepEqual(state.requests, [{ method: "delete", id: "task-old" }]);
    assert.deepEqual(state.successes, ["任务已删除"]);
    assert.equal(state.refreshes, 1);
  }
});

test("研发清空入口关闭，协同和生产继续遵循清空权限", () => {
  for (const workspace of ["rd", "us-collab", "production"]) {
    for (const permitted of [true, false]) {
      const { canClearData } = cockpitBindings("RDTaskManagementPage", ["usCollab", "productionWorkspace", "nativeRdCockpit", "canClearData"], {
        isUsCollabWorkspace: () => workspace === "us-collab",
        isProductionWorkspace: () => workspace === "production",
        usePermission: () => permitted,
        PERMISSIONS: { RD_DATA_CLEAR: "rd:data-clear" },
      });
      assert.equal(canClearData, workspace !== "rd" && permitted, `${workspace}, permitted=${permitted}`);
    }
  }
});

test("即使绕过入口调用清空处理器，研发也不发请求；其他工作区保留确认保护", async () => {
  for (const workspace of ["rd", "us-collab", "production"]) {
    for (const overrides of [{}, { keywordMatched: false }, { cooldown: 1 }, { clearing: true }]) {
      const calls = { requests: 0, cleared: 0, successes: [] };
      const { handleClear } = cockpitBindings("ClearDataDialog", ["usCollab", "productionWorkspace", "handleClear"], {
        isUsCollabWorkspace: () => workspace === "us-collab",
        isProductionWorkspace: () => workspace === "production",
        keywordMatched: true, cooldown: 0, clearing: false,
        setClearing() {}, setConfirmText() {}, moduleName: workspace,
        clearRdAllTaskData: async () => { calls.requests++; },
        onCleared: () => { calls.cleared++; },
        toast: { success: (message) => calls.successes.push(message), error() {} },
        t: (text) => text,
        ...overrides,
      });
      await handleClear();
      const expected = workspace !== "rd" && Object.keys(overrides).length === 0 ? 1 : 0;
      assert.equal(calls.requests, expected, `${workspace}, ${JSON.stringify(overrides)}`);
      assert.equal(calls.cleared, expected);
      assert.equal(calls.successes.length, expected);
    }
  }
});

test("研发删除申请同一事件循环防重，请求结束才解除 pending", async () => {
  const pending = deferred();
  const { state, requestRef, bind } = deletionFixture("rd", pending.promise);
  const handler = bind().handleDeleteTaskConfirm;
  const first = handler();
  await handler();
  assert.equal(state.requests.length, 1);
  assert.equal(state.pendingId, "task-old");
  assert.equal(state.target.task_id, "task-old");
  assert.deepEqual(state.successes, []);
  pending.resolve();
  await first;
  assert.equal(state.pendingId, null);
  assert.equal(requestRef.current, null);
});

test("旧删除申请返回不关闭后来打开的任务弹窗", async () => {
  const pending = deferred();
  const { state, bind } = deletionFixture("rd", pending.promise);
  const first = bind().handleDeleteTaskConfirm();
  const newerTarget = { task_id: "task-new" };
  state.target = newerTarget;
  pending.resolve();
  await first;
  assert.equal(state.target, newerTarget);
  assert.equal(state.pendingId, null);
});

test("已失效删除申请的成功或失败均不能覆盖新请求状态", async () => {
  for (const fails of [false, true]) {
    const pending = deferred();
    const { state, requestRef, bind } = deletionFixture("rd", pending.promise);
    const first = bind().handleDeleteTaskConfirm();
    const newerTarget = { task_id: "task-new" };
    const newerRequest = { sequence: 2, taskId: "task-new" };
    state.target = newerTarget;
    state.pendingId = "task-new";
    requestRef.current = newerRequest;
    if (fails) pending.reject(new Error("old request failed"));
    else pending.resolve();
    await first;
    assert.equal(state.target, newerTarget);
    assert.equal(state.pendingId, "task-new");
    assert.equal(requestRef.current, newerRequest);
    assert.deepEqual(state.successes, []);
    assert.deepEqual(state.errors, []);
    assert.equal(state.refreshes, 0);
  }
});

test("删除申请失败保留确认目标并释放自己的锁", async () => {
  const pending = deferred();
  const { state, requestRef, bind } = deletionFixture("rd", pending.promise);
  const request = bind().handleDeleteTaskConfirm();
  pending.reject(new Error("service unavailable"));
  await request;
  assert.equal(state.target.task_id, "task-old");
  assert.equal(state.pendingId, null);
  assert.equal(requestRef.current, null);
  assert.deepEqual(state.errors, ["service unavailable"]);
  assert.deepEqual(state.successes, []);
  assert.equal(state.refreshes, 0);
});

test("核心驾驶舱保持 Horizon 统一品牌令牌和信息层级且无旧装饰", () => {
  assert.match(executiveOverview, /horizon-theme hz-page rd-horizon-cockpit/);
  assert.match(executiveOverview, /\bbg-primary\b/);
  assert.match(personCockpit, /const allAccentColor = "var\(--primary\)";/);
  assert.match(personCockpit, /focus-visible:ring-primary/);
  assert.doesNotMatch(personCockpit, /#002fa7|rgba\(0,47,167/i);
  assert.match(coreCockpit, /text-balance/);
  assert.match(coreCockpit, /text-pretty/);
  assert.match(coreCockpit, /tabular-nums/);

  const forbidden = [
    [/linear-gradient|backdrop-blur/i, "渐变或模糊"],
    [/\b(?:indigo|purple|violet|fuchsia|pink)-/i, "紫粉或旧靛色"],
    [/\btracking-/i, "装饰性字距"],
    [/\btransition-all\b|(?:hover|group-hover):-?translate/i, "全属性过渡或悬停位移"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(coreCockpit, pattern, `核心驾驶舱不应包含${label}`);
  }
});

test("首屏摘要、加载、失败、空态和重试使用真实派生数据", () => {
  assert.match(executiveOverview, /const decisionSummary = useMemo/);
  assert.match(executiveOverview, /riskCount: risks\.length/);
  assert.match(executiveOverview, /blockedCount: blocked/);
  assert.match(executiveOverview, /当前任务均未进入执行或已完成/);
  assert.match(executiveOverview, /aria-busy=\{loading\}/);
  assert.match(executiveOverview, /role=\{loadError \? "alert" : "status"\}/);
  assert.match(executiveOverview, /刷新失败：/);
  assert.match(executiveOverview, /onClick=\{onRefresh\}/);
  assert.match(systemPanorama, /productLoadErrorId/);
  assert.match(systemPanorama, /if \(!products\.some\(\(product\) => product\.id === activeProdId\)\)/);
  assert.match(systemPanorama, /子系统数据加载失败/);
  assert.match(systemPanorama, /当前产品暂无子系统/);
});

test("搜索延迟派生且人员任务通过 Map / Set 单遍分组", () => {
  assert.match(personCockpit, /import React, \{[^}]*useDeferredValue/);
  assert.match(personCockpit, /const deferredCockpitSearch = useDeferredValue\(cockpitSearch\)/);
  assert.match(personCockpit, /const filteredTasks = useMemo/);
  assert.match(personCockpit, /taskMatches\(task, deferredCockpitSearch/);
  assert.match(personCockpit, /const map = new Map<string, \{ primary: Task\[\]; collaborating: Task\[\] \}>\(\)/);
  assert.match(personCockpit, /for \(const task of filteredTasks\)/);
  assert.match(personCockpit, /const collaboratorKeys = new Set/);
  assert.match(personCockpit, /collaboratorKeys\.delete\(ownerKey\)/);
  assert.doesNotMatch(personCockpit, /for \(const p of personLoads\)[\s\S]{0,300}?for \(const task of allTasks\)/);
});

test("窄屏、键盘焦点和语义交互不退化", () => {
  assert.match(personCockpit, /sm:flex-row sm:items-center sm:pr-4/);
  assert.match(personCockpit, /sm:ml-2 sm:w-auto/);
  assert.match(personCockpit, /type="search"/);
  assert.match(personCockpit, /aria-describedby="rd-cockpit-search-results"/);
  assert.match(personCockpit, /requestAnimationFrame\(\(\) => searchInputRef\.current\?\.focus\(\)\)/);
  assert.match(personCockpit, /aria-busy=\{searchPending\}/);
  assert.match(personCockpit, /aria-label=\{t\("打开任务：\{title\}"/);
  assert.match(personCockpit, /aria-label=\{t\("更多操作"\)\}/);
  assert.match(personCockpit, /role="status"/);
  assert.match(executiveOverview, /horizon-portal fixed right-4 top-4/);
  for (const primitive of ["Tabs", "DropdownMenu", "Tooltip"]) {
    assert.match(coreCockpit, new RegExp(`<${primitive}(?=[\\s>])`), `缺少 Radix ${primitive}`);
  }
  assert.match(page, /<AlertDialog[\s\S]{0,100}?open=\{!!deleteTaskTarget\}/);
});

test("工作区、权限、API、镜像只读与沉浸模式契约保持完整", () => {
  // 工作区身份及人员跳转在 rd-workspace-routing.test.mjs 中按真实行为验证。
  for (const contract of [
    /const productionWorkspace = isProductionWorkspace\(\)/,
    /const nativeRdCockpit = !usCollab && !productionWorkspace/,
    /nativeRdCockpit \? handleCockpitSearchKeywordChange : undefined/,
    /fetchRdCockpitTaskCategories\(\)/,
    /fetchRdMemberTaskCategories\(\)/,
    /fetchProductTaskCategories\(productId\)/,
    /isProductionMirrorTask\(task\)/,
    /canSyncProduction=\{canSyncProduction\}/,
    /canDelete=\{canDeleteTasks\}/,
    /setImmersive\(headerCollapsed\)/,
    /useEffect\(\(\) => \(\) => setImmersive\(false\)/,
  ]) {
    assert.match(page, contract);
  }
  assert.match(page, /if \(nativeRdCockpit && query\)/);
  assert.match(page, /const kpiCategories = mode === "overview" \? \(mergedCategories \?\? categories\) : categories/);
  assert.match(page, /const catStats = useMemo\(\(\) => buildCatStats\(categories, risks\)/);
  assert.match(page, /const canDeleteAnyTask = useAnyPermission\(/);
  assert.match(personCockpit, /const isCurrentUserParticipant = Boolean\(user/);
  assert.match(personCockpit, /const showDeleteTaskAction = Boolean\(canDelete && \(canDeleteAny \|\| isCurrentUserParticipant\)\)/);
  assert.match(personCockpit, /showDeleteTaskAction && onDeleteTask/);
});

test("任务参与者删除权限与服务端使用相同的 id 优先、历史姓名归一化口径", () => {
  const helpers = [cockpitModel, page].flatMap((source) => {
    const ast = ts.createSourceFile("helpers.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return ast.statements.filter((node) => ts.isFunctionDeclaration(node) &&
      ["normalizeIdentity", "matchesCurrentTaskParticipant", "resolveDeleteDialogTargetAfterSuccess"].includes(node.name?.text))
      .map((node) => node.getText(ast));
  }).join("\n");
  const javascript = ts.transpileModule(helpers, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const helperModule = { exports: {} };
  Function("exports", "module", javascript)(helperModule.exports, helperModule);
  const { matchesCurrentTaskParticipant, resolveDeleteDialogTargetAfterSuccess } = helperModule.exports;

  assert.equal(matchesCurrentTaskParticipant(" user-1 ", "同名人员", "user-1", "其他姓名"), true);
  assert.equal(
    matchesCurrentTaskParticipant("other-user", "王 小明（研发部）", "user-1", "王小明"),
    false,
    "已绑定 user_id 时不得靠同名扩大删除权限",
  );
  assert.equal(matchesCurrentTaskParticipant(null, " 王 小明（研发部） ", "user-1", "王小明"), true);
  assert.equal(matchesCurrentTaskParticipant(null, "Alice (RD)", "user-1", " alice "), true);
  assert.equal(matchesCurrentTaskParticipant(null, "", "user-1", ""), false);

  const newerTarget = { task_id: "task-new" };
  assert.equal(resolveDeleteDialogTargetAfterSuccess({ task_id: "task-old" }, "task-old"), null);
  assert.equal(
    resolveDeleteDialogTargetAfterSuccess(newerTarget, "task-old"),
    newerTarget,
    "旧删除请求完成时必须保留后来打开的任务弹层",
  );
});

test("转派与移动弹层统一使用 Radix Dialog 并在提交中阻止关闭", () => {
  for (const [name, dialog] of [
    ["批量转派", reassignDialog],
    ["单任务移动", moveTaskDialog],
    ["批量移动", moveTasksDialog],
  ]) {
    assert.match(dialog, /<Dialog\b/,
      `${name}缺少项目 Dialog`);
    assert.match(dialog, /<DialogContent\b/);
    assert.match(dialog, /<DialogTitle\b/);
    assert.match(dialog, /<DialogDescription\b/);
    assert.match(dialog, /onOpenChange=\{\(open\) => \{[\s\S]*?!open && !saving/);
    assert.match(dialog, /onEscapeKeyDown=\{\(event\) => \{ if \(saving\) event\.preventDefault\(\); \}\}/);
    assert.match(dialog, /onPointerDownOutside=\{\(event\) => \{ if \(saving\) event\.preventDefault\(\); \}\}/);
    assert.match(dialog, /aria-label=\{t\("关闭/);
    assert.match(dialog, /disabled=\{saving\}/);
    assert.doesNotMatch(dialog, /className="rd-task-overlay fixed/);
  }
});

test("转派筛选和移动位置控件具备可访问名称与选中状态", () => {
  assert.match(page, /aria-label=\{t\("按负责人筛选"\)\}/);
  assert.match(page, /aria-pressed=\{priorityFilter === p\.key\}/);
  assert.match(page, /aria-pressed=\{targetPerson\?\.id === p\.id\}/);
  for (const id of [
    "move-task-product",
    "move-task-category",
    "move-task-subproject",
    "move-tasks-product",
    "move-tasks-category",
    "move-tasks-subproject",
  ]) {
    const dialog = id.startsWith("move-task-") ? moveTaskDialog : moveTasksDialog;
    assert.match(dialog, new RegExp(`htmlFor="${id}"`));
    assert.match(dialog, new RegExp(`id="${id}"`));
  }
});

test("删除确认等待请求完成、即时防重并隔离旧请求状态", () => {
  assert.match(taskManagementPage, /const \[deleteTaskPendingId, setDeleteTaskPendingId\] = useState<string \| null>\(null\)/);
  assert.match(taskManagementPage, /const deleteTaskPendingRequestRef = useRef<\{ sequence: number; taskId: string \} \| null>\(null\)/);
  assert.match(taskManagementPage, /if \(!target \|\| deleteTaskPendingRequestRef\.current\) return/);
  assert.match(taskManagementPage, /const requestedTaskId = target\.task_id/);
  assert.match(taskManagementPage, /deleteTaskPendingRequestRef\.current = request/);
  assert.match(taskManagementPage, /deleteTaskPendingRequestRef\.current !== request/);
  assert.match(taskManagementPage, /resolveDeleteDialogTargetAfterSuccess\(current, requestedTaskId\)/);
  assert.match(taskManagementPage, /setDeleteTaskPendingId\(\(current\) => current === requestedTaskId \? null : current\)/);
  assert.match(taskManagementPage, /event\.preventDefault\(\);[\s\S]{0,120}?void handleDeleteTaskConfirm\(\)/);
  assert.match(taskManagementPage, /<AlertDialogCancel disabled=\{deleteTaskPendingId !== null\}/);
  assert.match(taskManagementPage, /<AlertDialogAction[\s\S]{0,220}?disabled=\{deleteTaskPendingId !== null\}/);
  assert.doesNotMatch(taskManagementPage, /finally \{\s*setDeleteTaskTarget\(null\)/);
});

test("任务卡片及相关弹层使用统一的可见标题兜底", () => {
  assert.match(taskModel, /function taskVisibleTitle\(/);
  assert.match(taskModel, /t\("未命名任务（\{id\}）", \{ id: taskId \}\)/);
  assert.match(personCockpit, /const visibleTaskTitle = taskVisibleTitle\(task\)/);
  assert.match(personCockpit, /aria-label=\{t\("打开任务：\{title\}", \{ title: visibleTaskTitle \}\)\}/);
  assert.match(personCockpit, /<AutoTranslatedText text=\{visibleTaskTitle\} \/>/);
  assert.match(reassignDialog, /title: taskVisibleTitle\(t\)/);
  assert.match(moveTaskDialog, /const visibleTaskTitle = taskVisibleTitle\(task\)/);
  assert.match(moveTasksDialog, /\{taskVisibleTitle\(taskItem\)\}/);
  assert.match(taskManagementPage, /deleteTaskTarget \? taskVisibleTitle\(deleteTaskTarget\) : t\("未命名任务"\)/);
});
