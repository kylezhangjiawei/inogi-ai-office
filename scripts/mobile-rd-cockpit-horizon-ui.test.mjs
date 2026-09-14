import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/MobileRDCockpit.tsx", import.meta.url),
  "utf8",
);

test("移动研发驾驶舱统一使用 Horizon 蓝灰视觉并清除旧样式", () => {
  assert.match(source, /className="horizon-theme hz-page/);
  assert.match(source, /#002fa7/);

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
  assert.match(source, /navigate\(`\$\{workspaceBase\}\/task\/\$\{encodeURIComponent\(task\.task_id\)\}`\)/);
  assert.match(source, /navigate\(`\$\{workspaceBase\}\/task\/\$\{encodeURIComponent\(taskId\)\}`\)/);
  assert.match(source, /const activeTask = routeTaskId \? taskIndex\.byId\.get\(routeTaskId\) \?\? null : null/);
  assert.match(source, /key=\{activeTask\.task_id\}/);
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

test("任务详情默认展示进度并保留五个事实视图，仅研发启用资料版本", () => {
  assert.match(
    source,
    /useState<"overview" \| "progress" \| "conversation" \| "attachments" \| "activity">\("progress"\)/,
  );
  assert.match(
    source,
    /\{ key: "progress", label: t\("进度留痕"\), icon: History \},\s*\{ key: "overview", label: t\("任务概览"\), icon: Info \},\s*\{ key: "conversation", label: t\("任务讨论"\), icon: MessageCircleMore \},\s*\{ key: "attachments", label: technicalDocumentsEnabled \? t\("资料与附件"\) : t\("附件库"\), icon: Paperclip \},\s*\{ key: "activity", label: t\("操作记录"\), icon: Activity \}/,
  );
  // 默认研发池才扩充资料版本；协同、生产继续使用原附件库入口。
  assert.match(source, /const technicalDocumentsEnabled = currentRdWorkspace\(\) === null;/);
  assert.match(source, /technicalDocumentsEnabled && !loading && !loadError && [^\n]*<TechnicalDocumentsPanel key=\{task\.task_id\} taskId=\{task\.task_id\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /onClick=\{reload\}/);
  assert.match(source, /<MissingTaskDialog taskId=\{routeTaskId\} onClose=\{closeActiveTask\} \/>/);
  assert.match(source, /onClick=\{onClose\}/);
});
