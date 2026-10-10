import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/app/MobileRDCockpit.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile("MobileRDCockpit.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function declaration(name) {
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.length, 1, name);
  return found[0].initializer;
}

function evaluate(node, scope) {
  const javascript = ts.transpileModule(`return (${node.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), javascript)(...Object.values(scope));
}

test("移动研发驾驶舱统一使用 Horizon 蓝灰视觉并清除旧样式", () => {
  assert.match(source, /className="horizon-theme hz-page/);
  assert.match(source, /primary/);

  const forbidden = [
    [/\bbg-gradient-|linear-gradient|radial-gradient/i, "渐变"],
    [/\b(?:bg|text|border|ring|from|via|to)-(?:indigo|violet|purple|fuchsia|pink)-/i, "旧蓝紫色"],
    [/\btracking-|\buppercase\b/, "装饰性字距"],
    [/transition-all|hover:-translate/, "宽泛过渡或悬停位移"],
    [/\bh-screen\b/, "固定视口高度"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(source, pattern, `不应包含${label}`);
  }
});

test("三工作区深链、根任务列表和递归详情索引保持隔离", () => {
  assert.match(source, /pathname\.startsWith\("\/us-collab-m"\)\) return "\/us-collab-m"/);
  assert.match(source, /pathname\.startsWith\("\/production-m"\)\) return "\/production-m"/);
  assert.match(source, /const workspaceBase = mobileWorkspaceBase\(location\.pathname\)/);
  assert.match(source, /for \(const child of task\.subtasks \?\? \[\]\) visit\(child\)/);
  assert.match(source, /const activeTask = routeTaskId \? taskIndex\.byId\.get\(routeTaskId\) \?\? null : null/);
  assert.match(source, /key=\{activeTask\.task_id\}/);
});

test("任务导航保留研发工作台来源，相关任务仅在研发沿用讨论查询", () => {
  const state = {
    rdWorkspaceReturn: "/rd-my-workspace?role=collaborator&keyword=RD",
    procurementWorkspaceReturn: "/proc-my-workspace?task=PR-1",
    unrelated: "must not propagate",
  };
  for (const workspaceBase of ["/m", "/us-collab-m", "/production-m"]) {
    const location = { state, search: "?tab=conversation" };
    const procurementReturnPath = evaluate(declaration("procurementReturnPath"), {
      workspaceBase, location, procurementWorkspaceReturnPath: (value) => value.procurementWorkspaceReturn,
    });
    const workspaceReturnPath = evaluate(declaration("workspaceReturnPath"), {
      workspaceBase, location, rdWorkspaceReturnPath: (value) => value.rdWorkspaceReturn,
    });
    const taskReturnState = evaluate(declaration("taskReturnState"), {
      procurementReturnPath, workspaceReturnPath, useMemo: (factory) => factory(),
    });
    const expectedState = workspaceBase === "/m" ? {
      procurementWorkspaceReturn: state.procurementWorkspaceReturn, rdWorkspaceReturn: state.rdWorkspaceReturn,
    } : undefined;
    assert.deepEqual(taskReturnState, expectedState);
    const calls = [];
    const markedRead = [];
    let reloads = 0;
    const scope = {
      workspaceBase, location, taskReturnState, useCallback: (callback) => callback,
      navigate: (...args) => calls.push(args), reload: () => { reloads += 1; }, refreshNoteUnread: () => {},
      markRdTaskNotesRead: (id) => { markedRead.push(id); return Promise.resolve(); },
    };
    evaluate(declaration("openTask"), scope)({ task_id: "RD/1" });
    evaluate(declaration("openTaskById"), scope)("RD/2");
    assert.deepEqual(calls, [
      [`${workspaceBase}/task/RD%2F1`, { state: expectedState }],
      [`${workspaceBase}/task/RD%2F2${workspaceBase === "/m" ? "?tab=conversation" : ""}`, { state: expectedState }],
    ]);
    assert.equal(reloads, 2);
    assert.deepEqual(markedRead, ["RD/1"]);
  }
});

test("筛选、身份口径、分页与最后成功快照刷新链路保持完整", () => {
  assert.match(source, /const TASK_PAGE = 6/);
  assert.match(source, /memberIdentityKey\(primaryName, task\.primary_owner_user_id\)/);
  assert.match(source, /memberIdentityKey\(collaboratorName, collaborator\.user_id\)/);
  assert.match(source, /const UNASSIGNED_KEY = "__unassigned__"/);
  assert.match(source, /setVisible\(TASK_PAGE\)/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /v < filteredTasks\.length \? v \+ TASK_PAGE : v/);
  assert.match(source, /const interval = window\.setInterval\(refresh, MOBILE_DATA_REFRESH_INTERVAL_MS\)/);
  assert.match(source, /window\.addEventListener\("rd:task-updated", refresh\)/);
  assert.match(source, /error && allTasks\.length > 0/);
});

test("未读回执、合并进展、请求取消及采购关联能力保持完整", () => {
  for (const contract of [
    /fetchRdNoteUnreadSummary\(\)/,
    /markRdTaskNotesRead\(task\.task_id\)/,
    /window\.addEventListener\("rd:discussion-updated", refresh\)/,
    /noteRequestRef\.current\?\.abort\(\)/,
    /fetchRdTaskProgressNoteGroup\(task\.task_id, controller\.signal\)/,
    /setGroupNotes\(data\.notes\)/,
    /setNotes\(data\.notes\.filter/,
    /attachment\.object_key \?\? attachment\.id/,
    /groupTaskIds\.has\(log\.resource\.id\)/,
    /<ProcurementActivitySection task=\{procurementTask\} \/>/,
  ]) {
    assert.match(source, contract);
  }
});

test("移动覆盖层、手势灯箱和安全区语义保持完整", () => {
  assert.match(source, /createPortal\(/);
  assert.match(source, /pushMobileOverlayState\(CARD_IMAGE_OVERLAY\)/);
  assert.match(source, /useMobileOverlayBack\(Boolean\(lightbox\), CARD_IMAGE_OVERLAY/);
  assert.match(source, /closeMobileOverlay\(CARD_IMAGE_OVERLAY/);
  assert.match(source, /useBodyScrollLock\(true\)/);
  assert.match(source, /role="dialog"\s+aria-modal="true"/);
  assert.match(source, /safe-area-inset-top/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /<MobileZoomableImage/);
});

test("卡片和灯箱键盘交互不会串联打开详情", () => {
  assert.match(source, /e\.target !== e\.currentTarget/);
  assert.match(source, /aria-label="预览附件图片"/);
  assert.match(source, /aria-label=\{t\("查看第 \{n\} 张图片"/);
  assert.match(source, /aria-current=\{i === safeIdx \? "true" : undefined\}/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuenow=\{progress\}/);
});

test("任务详情保留五个事实视图，仅研发启用资料版本", () => {
  assert.match(
    source,
    /\{ key: "progress", label: t\("进度留痕"\), icon: History \},\s*\{ key: "overview", label: t\("任务概览"\), icon: Info \},\s*\{ key: "conversation", label: t\("任务讨论"\), icon: MessageCircleMore \},\s*\{ key: "attachments", label: technicalDocumentsEnabled \? t\("资料与附件"\) : t\("附件库"\), icon: Paperclip \},\s*\{ key: "activity", label: t\("操作记录"\), icon: Activity \}/,
  );
  // 默认研发池才扩充资料版本；协同、生产继续使用原附件库入口。
  for (const workspace of [null, "us-collab", "production"]) {
    assert.equal(evaluate(declaration("technicalDocumentsEnabled"), { currentRdWorkspace: () => workspace }), workspace === null);
  }
  assert.match(source, /technicalDocumentsEnabled && !loading && !loadError && [^\n]*<TechnicalDocumentsPanel key=\{task\.task_id\} taskId=\{task\.task_id\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /onClick=\{reload\}/);
  assert.match(source, /<MissingTaskDialog taskId=\{routeTaskId\} onClose=\{closeActiveTask\} returnLabel=\{detailReturnLabel\} \/>/);
  assert.match(source, /onClick=\{onClose\}/);
});
