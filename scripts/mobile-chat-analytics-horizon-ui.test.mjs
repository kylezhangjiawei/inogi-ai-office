import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = source("src/app/MobileChatAnalyticsPage.tsx");
const app = source("src/app/App.tsx");
const shell = source("src/app/MobileShell.tsx");

test("移动端使用分析保持真实路由、Shell 入口和权限守卫", () => {
  assert.match(app, /pathname\.startsWith\(`\/m\$\{routePath\("page:chat-analytics", "\/chat-analytics"\)\}`\)/);
  assert.match(
    app,
    /page:chat-analytics[\s\S]{0,180}<MobileChatAnalyticsPage \/>[\s\S]{0,120}page:chat-analytics/,
  );
  assert.match(shell, /const chatAnalyticsPath = `\/m\$\{routePath\("page:chat-analytics", "\/chat-analytics"\)\}`/);
  assert.match(shell, /location\.pathname\.startsWith\(chatAnalyticsPath\)/);
  assert.match(shell, /hasPermission\(user\.permissions, "page:chat-analytics"\)/);
  assert.match(shell, /returnsToUsCollab \? `\$\{chatAnalyticsPath\}\?from=us-collab` : chatAnalyticsPath/);
});

test("页面使用 Horizon 蓝灰层级并清除旧视觉模式", () => {
  assert.match(page, /className="horizon-theme hz-page/);
  assert.match(page, /primary/);

  const forbidden = [
    [/gradient/i, "渐变"],
    [/\b(?:purple|violet|fuchsia|pink|indigo)-/i, "紫粉与旧靛色"],
    [/\buppercase\b|\btracking-/, "装饰性字距"],
    [/hover:-translate|transition-all/, "悬停位移或 transition-all"],
    [/\bh-screen\b/, "固定视口高度"],
    [/fixed\s+inset/, "手写全屏遮罩"],
    [/backdrop-blur|\bblur-(?:xl|2xl|3xl)\b/, "大面积模糊"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(page, pattern, `不应包含${label}`);
});

test("人员详情使用项目 Sheet，保留移动端返回栈并恢复触发器焦点", () => {
  for (const component of ["Sheet", "SheetContent", "SheetHeader", "SheetTitle", "SheetDescription", "SheetClose"]) {
    assert.match(page, new RegExp(`<${component}(?=[\\s>])`), `缺少 ${component}`);
  }
  assert.match(page, /<Sheet open=\{open\} onOpenChange=/);
  assert.match(page, /className="h-dvh w-full min-w-0[^"]*horizon-portal/);
  assert.match(page, /onCloseAutoFocus=\{onCloseAutoFocus\}/);
  assert.match(page, /detailTriggerRef\.current = trigger/);
  assert.match(page, /openPersonDetail\(row\.userId, event\.currentTarget\)/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /trigger\?\.isConnected/);
  assert.match(page, /trigger\.focus\(\)/);
  assert.match(page, /pushMobileOverlayState\(PERSON_DETAIL_OVERLAY\)/);
  assert.match(page, /useMobileOverlayBack\(Boolean\(selectedUserId\)/);
  assert.match(page, /closeMobileOverlay\(PERSON_DETAIL_OVERLAY/);
  assert.doesNotMatch(page, /useBodyScrollLock|document\.addEventListener\(['"]keydown/);
});

test("分析 API、时间范围、筛选、分页与详情错误重试链路完整保留", () => {
  for (const contract of [
    /chatAnalyticsApi\.getDashboard\(days\)/,
    /chatAnalyticsApi\.getUserDetail\(selectedUserId, days\)/,
    /dashboardRequestRef\.current \+= 1/,
    /setData\(null\)/,
    /setDays\(nextDays\)/,
    /peopleQuery/,
    /peopleDepartment/,
    /peopleStage/,
    /feedbackQuery/,
    /feedbackReaction/,
    /feedbackStatus/,
    /feedbackDepartment/,
    /function MobilePager/,
    /setDetailReloadKey\(\(key\) => key \+ 1\)/,
  ]) {
    assert.match(page, contract);
  }
  assert.match(page, /role="status" aria-label="正在加载人员使用详情"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /detailError/);
});

test("360px 宽度下只有阶段筛选局部滚动，主交互触控目标不小于 44px", () => {
  assert.match(page, /min-h-full min-w-0 overflow-x-hidden/);
  assert.match(page, /h-dvh w-full min-w-0 gap-0 overflow-hidden/);
  assert.match(page, /overflow-y-auto overflow-x-hidden/);
  assert.equal((page.match(/overflow-x-auto/g) ?? []).length, 1, "仅阶段芯片容器允许局部横向滚动");
  assert.doesNotMatch(page, /min-w-\[[^\]]+\]/);
  assert.ok((page.match(/(?:size|h|min-h)-11\b|\bh-12\b|\bmin-h-16\b/g) ?? []).length >= 15);
  assert.match(page, /aria-label="返回使用分析"[^>]*size-11/);
  assert.match(page, /aria-label="关闭人员详情"[^>]*size-11/);
  assert.match(page, /aria-pressed=\{days === option\.value\}/);
  assert.match(page, /aria-current=\{tab === value \? 'page' : undefined\}/);
  assert.ok((page.match(/<NativeSelect aria-label=/g) ?? []).length >= 6);
});
