import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/ChatAnalyticsPage.tsx", import.meta.url), "utf8");

function componentCount(componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

test("MateChat 分析页使用统一 Horizon 页头和恰好四项指标", () => {
  assert.match(page, /<main className="horizon-theme hz-page/);
  assert.equal(componentCount("HorizonPageHeader"), 1);
  assert.equal(componentCount("HorizonMetricGrid"), 1);
  assert.equal(componentCount("HorizonMetric"), 4);
});

test("四项指标全部来自真实统计字段", () => {
  for (const field of [
    "summary.activeUsers",
    "summary.eligibleUsers",
    "summary.coverageRate",
    "summary.repeatRate",
    "summary.repeatUsers",
    "summary.questions",
    "summary.openFeedback",
    "summary.feedbackCount",
  ]) {
    assert.match(page, new RegExp(field.replace(".", "\\.")), `缺少真实统计字段 ${field}`);
  }
  for (const label of ["活跃用户", "采纳 / 复用", "真实提问", "待处理反馈"]) {
    assert.match(page, new RegExp(`label=["']${label.replace("/", "\\/")}["']`));
  }
});

test("保留数据加载、时间范围、人员明细和反馈处理流程", () => {
  assert.match(page, /chatAnalyticsApi\.getDashboard\(days\)/);
  assert.match(page, /chatAnalyticsApi\.getUserDetail\(selectedUserId, days\)/);
  assert.match(page, /chatAnalyticsApi\.updateFeedback\(statusDraft\.row\.id/);
  assert.match(page, /RANGE_OPTIONS\.map\(\(option\) =>/);
  assert.match(page, /aria-pressed=\{days === option\.value\}/);
  assert.match(page, /<AreaChart[\s\S]*?<Line yAxisId="users"/);
  assert.match(page, /<Sheet open=\{Boolean\(selectedUserId\)\}/);
  assert.match(page, /<Dialog open=\{Boolean\(statusDraft\)\}/);
  assert.match(page, /const safePeoplePage = Math\.min\(peoplePage, peopleTotalPages\)/);
  assert.match(page, /const safeFeedbackPage = Math\.min\(feedbackPage, feedbackTotalPages\)/);
});

test("人员和反馈列表保留语义、标签及标准弹层作用域", () => {
  assert.match(page, /aria-label="搜索人员"/);
  assert.match(page, /aria-label="搜索反馈"/);
  assert.match(page, /role="button" aria-label=\{`查看 \$\{row\.name\} 的使用详情`\}/);
  assert.match(page, /aria-label=\{`更新 \$\{row\.user\} 的反馈状态`\}/);
  assert.match(page, /<SheetContent className="horizon-portal/);
  assert.match(page, /<DialogContent className="horizon-portal/);
  assert.match(page, /<SelectContent className="horizon-portal">/);
  assert.match(page, /aria-invalid=\{statusSubmitAttempted && statusNeedsResolution\}/);
  assert.match(page, /id="feedback-resolution-error"[\s\S]{0,120}?role="alert"/);
  assert.match(page, /resolutionInputRef\.current\?\.focus\(\)/);
});

test("页面层级包含结论、趋势、人员和反馈闭环", () => {
  for (const label of ["管理结论", "采用趋势", "人员使用明细", "反馈与问题跟进"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /<HorizonEmptyState[\s\S]{0,240}?暂无可观察的在用账号/);
  assert.match(page, /<HorizonEmptyState[\s\S]{0,260}?使用数据暂时无法加载/);
  assert.match(page, /aria-busy="true" aria-label="正在加载 AI 使用与反馈数据"/);
  assert.match(page, /xl:grid-cols-2 min-\[1600px\]:grid-cols-\[/, "三栏关注区需在侧栏布局下延后展开，避免横向溢出");
});

test("页面不含旧视觉与手写交互模式", () => {
  const forbidden = [
    ["渐变", /gradient/i],
    ["紫粉色类", /\b(?:purple|violet|fuchsia|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["大写装饰", /\buppercase\b/],
    ["悬停位移", /(?:hover|group-hover):-?translate/],
    ["全属性过渡", /\btransition-all\b/],
    ["手写全屏弹层", /fixed\s+inset-0/],
    ["原生确认", /window\.confirm\s*\(/],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
    ["旧 Material 组件", /\bmaterial-(?:card|button|chip|input)\b/i],
    ["固定视口高度", /\bh-screen\b/],
  ];
  for (const [name, pattern] of forbidden) {
    assert.doesNotMatch(page, pattern, `不应包含${name}`);
  }
});
