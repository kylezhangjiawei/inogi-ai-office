import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/OpsCenterPage.tsx", import.meta.url), "utf8");

test("运维中心五个分区共用 Horizon 页面根、页头和恰好四项动态指标", () => {
  assert.match(page, /className="horizon-theme hz-page/);
  assert.match(page, /<HorizonPageHeader(?:\s|>)/);
  assert.match(page, /<HorizonMetricGrid(?:\s|>)/);
  assert.equal((page.match(/<HorizonMetric(?=[\s>])/g) ?? []).length, 4);

  for (const section of ["overview", "api-errors", "database", "services-tasks", "alerts-audit"]) {
    assert.match(page, new RegExp(`[\"']?${section}[\"']?\\s*:`), `缺少 ${section} 分区元数据`);
  }
  assert.match(page, /function buildSectionMetrics\(section: OpsSection, data: OpsCenterSectionData \| null\)/);
  assert.match(page, /if \(section === "api-errors"\) return <ApiErrorsPage data=\{data\} \/>/);
  assert.match(page, /if \(section === "database"\) return <DatabaseMonitoringPage data=\{data\} \/>/);
  assert.match(page, /if \(section === "services-tasks"\) return <ServicesTasksPage data=\{data\} \/>/);
  assert.match(page, /if \(section === "alerts-audit"\) return <AlertsAuditSettingsPage data=\{data\} \/>/);
});

test("运维指标来自各分区真实响应字段并保留降级数据", () => {
  for (const key of [
    "health_cards",
    "api_logs",
    "error_groups",
    "pagination",
    "database_metrics",
    "task_summary",
    "alert_rules",
    "log_policies",
    "audit_logs",
    "audit_summary",
  ]) {
    assert.match(page, new RegExp(key), `缺少 ${key} 指标数据源`);
  }
  assert.match(page, /metricFromRow\(rows\[index\], fallback\)/);
  assert.match(page, /const rows = getArray<any>\(data, "task_summary", \[\]\)/);
  assert.equal((page.match(/value: "—", helper: unavailableNote/g) ?? []).length, 4);
  assert.doesNotMatch(page, /value: "(?:126|9|18|1\.8s)"/, "服务任务指标在接口缺失时不得伪装成真实统计");
  assert.match(page, /实时数据加载失败，当前展示示例降级视图（非实时）/);
});

test("运维中心保留真实 API、刷新、导出、筛选、分页和详情链路", () => {
  for (const contract of [
    /opsCenterApi\.getSection\(section\)/,
    /opsCenterApi\.getSection\("services-tasks"\)/,
    /opsCenterApi\s*\.getEndpointStats\(\{ sort \}\)/,
    /opsCenterApi\s*\.getApiErrors\(\{/,
    /opsCenterApi\.analyzeApiError\(\{ request_id: requestId, force \}\)/,
    /setReloadKey\(\(key\) => key \+ 1\)/,
    /anchor\.download = `ops-\$\{section\}-\$\{stamp\}\.json`/,
    /function usePagedRows<T>/,
    /setSelectedLogId\(row\.id\)/,
    /setSelectedIssueId\(item\.id\)/,
  ]) {
    assert.match(page, contract);
  }
});

test("1024 宽页面不设整页最小宽度，宽表只在自身容器横向滚动", () => {
  assert.doesNotMatch(page, /min-w-\[960px\]/);
  assert.match(page, /max-w-\[1800px\] min-w-0[\s\S]{0,120}overflow-x-hidden/);
  assert.ok((page.match(/<Table className="min-w-\[/g) ?? []).length >= 7, "宽表应声明局部最小宽度");
  assert.equal((page.match(/<TableCaption className="sr-only">/g) ?? []).length, 7);
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
});

test("运维中心清除旧视觉并提供可访问的加载、错误、空状态和筛选控件", () => {
  const forbidden = [
    [/material-/, "旧 Material 类"],
    [/gradient/i, "渐变"],
    [/\b(?:purple|violet|fuchsia|pink|indigo)-/i, "紫粉装饰"],
    [/\buppercase\b|\btracking-/, "装饰性字距"],
    [/hover:-translate|transition-all/, "悬停位移或 transition-all"],
    [/fixed\s+inset|window\.confirm|(?<![\w.])confirm\(/, "手写弹层或原生确认"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(page, pattern, `不应包含${label}`);

  assert.match(page, /role="alert"/);
  assert.match(page, /role="status" aria-label="正在加载运维数据"/);
  assert.ok((page.match(/<HorizonEmptyState/g) ?? []).length >= 7);
  assert.ok((page.match(/ariaLabel="筛选/g) ?? []).length >= 6);
  assert.match(page, /aria-selected=\{selected\?\.id === row\.id\}/);
  assert.match(page, /event\.key === "Enter" \|\| event\.key === " "/);
});
