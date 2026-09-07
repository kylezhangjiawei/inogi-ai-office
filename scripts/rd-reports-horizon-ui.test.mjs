import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const reports = source("src/app/RDReportsPanel.tsx");
const daily = source("src/app/RDDailyReportPanel.tsx");
const monthly = source("src/app/RDMonthlyReportPanel.tsx");
const detailDrawer = source("src/app/components/ReportDetailDrawer.tsx");
const visualSources = {
  "汇报总览": reports,
  "研发日报": daily,
  "研发月报": monthly,
  "报告详情抽屉": detailDrawer,
};

test("研发汇报使用 Horizon 根作用域、Radix Tabs 与统一主题主操作", () => {
  assert.match(reports, /components\/ui\/tabs/);
  assert.match(reports, /<Tabs value=\{tab\} onValueChange=/);
  assert.match(reports, /<TabsList aria-label=\{t\("研发汇报周期"\)\}/);
  assert.match(reports, /<TabsTrigger[\s\S]*value=\{key\}/);
  assert.match(reports, /className="horizon-theme rd-horizon-reports/);
  assert.match(reports, /data-\[state=active\]:bg-primary/);

  assert.match(daily, /className="rd-horizon-daily-report/);
  assert.match(daily, /"hz-surface flex-1 border border-slate-200 bg-white"/);
  assert.match(daily, /hz-primary-action[^"]*bg-primary/);
  assert.match(monthly, /className="rd-horizon-monthly-report/);
  assert.match(monthly, /"hz-surface rd-horizon-monthly-surface flex-1 border border-slate-200 bg-white"/);
  assert.match(monthly, /hz-primary-action[^"]*bg-primary/);
  assert.match(monthly, /hover:bg-primary-hover/);
  assert.doesNotMatch(reports, /#002fa7|#002581/i);
  assert.doesNotMatch(monthly, /#002fa7|#002581/i);
  assert.match(monthly, /tone="blue"/);
  assert.match(detailDrawer, /className="horizon-portal/);
  assert.doesNotMatch(detailDrawer, /#002fa7|#002581/i);
});

test("研发汇报源码不再包含旧紫色、渐变、装饰字距或自定义悬停位移", () => {
  const forbiddenPatterns = [
    ["旧紫色", /\b(?:violet|indigo|purple|fuchsia|pink)-/i],
    ["渐变", /gradient/i],
    ["装饰字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["全属性过渡", /transition-all/],
  ];

  for (const [name, page] of Object.entries(visualSources)) {
    for (const [label, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${label}`);
    }
  }
});

test("日报继续保留今日、历史、留痕附件和批量汇总业务契约", () => {
  assert.match(daily, /fetchRdDailyReports\(\{ date: todayStr, limit: 500 \}\)/);
  assert.match(daily, /return fetchRdTaskProgressNoteMap\(\)/);
  assert.match(daily, /await regenerateAllRdDailyReports\(\)/);
  assert.match(daily, /<CollapseTransition open=\{showHistory\}>/);
  assert.match(daily, /<ReportDetailDrawer/);
  assert.match(daily, /<ProgressAttachmentGrid attachments=\{attachments\}/);
  assert.match(daily, /const REPORT_PAGE_SIZE = 5/);
  assert.match(daily, /reportDateFilter \|\| undefined/);
  assert.match(daily, /user_id: reportUserFilter \|\| undefined/);
  const dailyParams = daily.match(/export function RDDailyReportPanel\(\{([^}]+)\}/)?.[1] ?? "";
  for (const prop of ["canRegenerate", "tabSlot", "onDailyReportsLoaded"]) {
    assert.match(dailyParams, new RegExp(`\\b${prop}\\b`));
  }
  assert.match(dailyParams, /\bspacious\s*=\s*false\b/);
  assert.match(daily, /onDailyReportsLoaded\?: \(reports: RdDailyReport\[\]\) => void/);
  assert.match(daily, /fetchRdDailyReports\(\{ date: todayStr, limit: 500 \}\)[\s\S]*?\.then\(async \(list\) => \{[\s\S]*?onDailyReportsLoaded\?\.\(list\)/);
});

test("月报继续保留月份筛选、历史分页、绩效入口和批量汇总业务契约", () => {
  assert.match(monthly, /fetchRdMonthlyReports\(\{ month: monthStr, limit: 500 \}\)/);
  assert.match(monthly, /await regenerateAllRdMonthlyReports\(monthStr\)/);
  assert.match(monthly, /<CollapseTransition open=\{showHistory\}>/);
  assert.match(monthly, /<ReportDetailDrawer/);
  assert.match(monthly, /<RDPerformanceReportDialog/);
  assert.match(monthly, /setPerfTarget\(\{/);
  assert.match(monthly, /const REPORT_PAGE_SIZE = 5/);
  assert.match(monthly, /month: reportMonthFilter \|\| undefined/);
  assert.match(monthly, /user_id: reportUserFilter \|\| undefined/);
  assert.match(monthly, /export function RDMonthlyReportPanel\(\{ canRegenerate, tabSlot, spacious = false \}/);
});

test("汇报排版与图标按钮满足 baseline 可读性和可访问性约束", () => {
  for (const page of [daily, monthly]) {
    assert.match(page, /text-balance/);
    assert.match(page, /text-pretty/);
    assert.match(page, /tabular-nums/);
    assert.match(page, /aria-label=\{t\("上一页"\)\}/);
    assert.match(page, /aria-label=\{t\("下一页"\)\}/);
    assert.match(page, /aria-expanded=\{showHistory\}/);
    assert.match(page, /aria-pressed=\{active\}/);
  }
  assert.match(monthly, /aria-label=\{t\("选择月报月份"\)\}/);
  assert.match(monthly, /aria-label=\{t\("筛选月报月份"\)\}/);
  assert.match(detailDrawer, /aria-label="关闭报告详情"/);
});

test("汇报总览保持日报与月报原有 Props 透传", () => {
  const dailyMount = reports.match(/<RDDailyReportPanel\b[^>]*\/>/)?.[0] ?? "";
  const monthlyMount = reports.match(/<RDMonthlyReportPanel\b[^>]*\/>/)?.[0] ?? "";
  for (const panel of [dailyMount, monthlyMount]) {
    assert.match(panel, /\bcanRegenerate=\{canRegenerate\}/);
    assert.match(panel, /\btabSlot=\{tabBar\}/);
    assert.match(panel, /\bspacious=\{spacious\}/);
  }
  assert.match(reports, /onDailyReportsLoaded\?: \(reports: RdDailyReport\[\]\) => void/);
  assert.match(dailyMount, /\bonDailyReportsLoaded=\{onDailyReportsLoaded\}/);
  assert.doesNotMatch(monthlyMount, /onDailyReportsLoaded/);
});
