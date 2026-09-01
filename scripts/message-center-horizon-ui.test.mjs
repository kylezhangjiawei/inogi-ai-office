import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/MessageCenterPage.tsx", import.meta.url), "utf8");

function componentCount(componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

test("消息中心使用 Horizon 工作台与恰好四项真实指标", () => {
  assert.match(page, /className="horizon-theme hz-page/);
  assert.equal(componentCount("HorizonPageHeader"), 1);
  assert.equal(componentCount("HorizonMetricGrid"), 1);
  assert.equal(componentCount("HorizonMetric"), 4);
  assert.match(page, /const unreadCount = useMemo/);
  assert.match(page, /const pendingReviewCount = useMemo/);
  assert.match(page, /const handledCount = useMemo/);
  assert.match(page, /label=\{t\("总消息"\)\} value=\{loading && messages\.length === 0 \? "—" : messages\.length\}/);
});

test("消息加载、服务端筛选、搜索和游标分页链路保持完整", () => {
  assert.match(page, /fetchRdMessages\(\{[\s\S]*?recipient_id: user\.id,[\s\S]*?source: sourceFilter,[\s\S]*?category: categoryFilter/);
  assert.match(page, /before_created_at: oldest\.created_at/);
  assert.match(page, /before_id: oldest\.id/);
  assert.match(page, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(page, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(page, /const filteredMessages = useMemo/);
  assert.match(page, /searchText\.includes\(q\)/);
  assert.match(page, /const safePage = Math\.min\(page, totalPages\)/);
  assert.match(page, /filteredMessages\.slice\(\(safePage - 1\) \* MESSAGE_PAGE_SIZE, safePage \* MESSAGE_PAGE_SIZE\)/);
  assert.match(page, /<FilterChipRow[\s\S]*?label=\{t\("分类"\)\}/);
  assert.match(page, /<FilterChipRow[\s\S]*?label=\{t\("来源"\)\}/);
  assert.match(page, /aria-pressed=\{selected\.includes\(option\.value\)\}/);
});

test("已读处理、研发审核和采购转派审核链路保持完整", () => {
  assert.match(page, /patchRdMessage\(msg\.id, \{ read: true \}\)/);
  assert.match(page, /patchRdMessage\(msg\.id, \{ read: true, handled: true \}\)/);
  assert.match(page, /updateRdTask\(body\.task_id, \{[\s\S]*?_review_action: "approve"/);
  assert.match(page, /updateRdTask\(body\.task_id, \{[\s\S]*?_review_action: "reject"/);
  assert.match(page, /approveRdProcurementTransfer\(body\.task_id\)/);
  assert.match(page, /rejectRdProcurementTransfer\(body\.task_id, reason\)/);
  assert.equal((page.match(/announceProcurementRefresh\(\)/g) ?? []).length, 2);
  assert.match(page, /usePermission|user\.permissions\.includes\("rd-procurement:review"\)/);
  assert.match(page, /window\.dispatchEvent\(new CustomEvent\("rd:review-submitted"\)\)/);
});

test("绩效自评、讨论提及、视频和相关任务跳转链路保持完整", () => {
  assert.match(page, /fetchRdPerformanceReports\(\{ user_id: user\.id, month: body\.month, limit: 1 \}\)/);
  assert.match(page, /<RDPerformanceScoreDialog/);
  assert.match(page, /mode="self"/);
  assert.match(page, /parseRdDiscussionMention\(raw\)/);
  assert.match(page, /rdDiscussionMentionHref\(body, \{ notificationId: msg\.id, createdAt: msg\.created_at \}\)/);
  assert.match(page, /videoMeta\.kind === "video_done"/);
  assert.match(page, /navigate\(`\$\{videoJump\.route\}\?video=/);
  assert.match(page, /navigate\(`\/rd-task\/\$\{encodeURIComponent\(rb\.rd_task_id!\)\}`\)/);
});

test("审核弹层使用项目原语、就地错误和焦点恢复", () => {
  assert.equal(componentCount("Dialog"), 1);
  assert.equal(componentCount("DialogContent"), 1);
  assert.equal(componentCount("AlertDialog"), 1);
  assert.equal(componentCount("AlertDialogContent"), 1);
  assert.match(page, /<DialogContent className="horizon-portal/);
  assert.match(page, /<AlertDialogContent className="horizon-portal/);
  assert.equal((page.match(/onCloseAutoFocus=\{onCloseAutoFocus\}/g) ?? []).length, 2);
  assert.match(page, /aria-invalid=\{Boolean\(reasonError\)\}/);
  assert.match(page, /actionError \? <p[^>]*role="alert"/);
  assert.match(page, /if \(trigger\?\.isConnected\) trigger\.focus\(\)/);
  assert.match(page, /selfAssessTriggerRef\.current/);
  assert.doesNotMatch(page, /fixed\s+inset|createPortal|role="dialog"|aria-modal="true"/);
});

test("消息工作台提供结构化加载、失败、空状态和语义标签", () => {
  assert.match(page, /role="status" aria-label=\{t\("正在加载消息"\)\}/);
  assert.match(page, /loadError && messages\.length === 0/);
  assert.match(page, /<HorizonEmptyState/);
  assert.match(page, /<Label htmlFor="message-center-search"/);
  assert.match(page, /<Label htmlFor="message-status-filter"/);
  assert.match(page, /<fieldset className="flex min-w-0 flex-wrap items-center gap-1\.5">/);
  assert.match(page, /<nav[^>]*aria-label=\{t\("消息分页"\)\}/);
  assert.match(page, /aria-label=\{t\("上一页"\)\}/);
  assert.match(page, /aria-label=\{t\("下一页"\)\}/);
  assert.match(page, /正在读取绩效报表，完成后将打开自评窗口/);
});

test("消息中心不包含旧视觉和手写全屏交互", () => {
  const forbidden = [
    ["旧 Material 类", /material-(?:card|chip|input)/],
    ["渐变", /gradient/i],
    ["紫色类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["全量过渡", /transition-all/],
    ["悬停位移", /hover:-translate/],
    ["大面积模糊", /backdrop-blur/],
    ["固定视口高度", /\bh-screen\b/],
    ["原生确认框", /window\.confirm\s*\(/],
    ["自制层级", /z-\[/],
  ];
  for (const [name, pattern] of forbidden) {
    assert.doesNotMatch(page, pattern, `消息中心不应包含${name}`);
  }
});
