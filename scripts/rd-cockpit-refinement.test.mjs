import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const page = readFileSync(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `缺少区段起点：${startMarker}`);
  assert.ok(end > start, `缺少区段终点：${endMarker}`);
  return page.slice(start, end);
}

const systemPanorama = section("function SystemHealthCard(", "// ─── DETAIL VIEW components");
const personCockpit = section("function PersonTaskCockpit(", "// ─── Local helper functions");
const executiveOverview = section("function ExecutiveOverview(", "// ─── 移动目标产品树");
const reassignDialog = section("function TaskReassignModal(", "// ─── ClearDataDialog");
const moveTaskDialog = section("export function MoveTaskDialog(", "// ─── MoveTasksDialog");
const moveTasksDialog = section("function MoveTasksDialog(", "// ─── TaskCompletedCelebration");
const taskManagementPage = page.slice(page.indexOf("export function RDTaskManagementPage("));
const coreCockpit = `${systemPanorama}\n${personCockpit}\n${executiveOverview}`;

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
  assert.match(page, /import React, \{[^}]*useDeferredValue/);
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
  for (const contract of [
    /const usCollab = location\.pathname\.startsWith\("\/us-collab"\)/,
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
  const helpers = section("function normalizeIdentity(", "function taskVisibleTitle(");
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
    assert.match(page, new RegExp(`htmlFor="${id}"`));
    assert.match(page, new RegExp(`id="${id}"`));
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
  assert.match(page, /function taskVisibleTitle\(/);
  assert.match(page, /t\("未命名任务（\{id\}）", \{ id: taskId \}\)/);
  assert.match(personCockpit, /const visibleTaskTitle = taskVisibleTitle\(task\)/);
  assert.match(personCockpit, /aria-label=\{t\("打开任务：\{title\}", \{ title: visibleTaskTitle \}\)\}/);
  assert.match(personCockpit, /<AutoTranslatedText text=\{visibleTaskTitle\} \/>/);
  assert.match(reassignDialog, /title: taskVisibleTitle\(t\)/);
  assert.match(moveTaskDialog, /const visibleTaskTitle = taskVisibleTitle\(task\)/);
  assert.match(moveTasksDialog, /\{taskVisibleTitle\(taskItem\)\}/);
  assert.match(taskManagementPage, /deleteTaskTarget \? taskVisibleTitle\(deleteTaskTarget\) : t\("未命名任务"\)/);
});
