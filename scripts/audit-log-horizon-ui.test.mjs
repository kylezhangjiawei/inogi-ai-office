import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const page = readFileSync(new URL("../src/app/AuditLogPage.tsx", import.meta.url), "utf8");

test("审计页 TSX 可独立解析", () => {
  const result = ts.transpileModule(page, {
    fileName: "AuditLogPage.tsx",
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("审计页使用共享 Horizon 页头与恰好四项真实指标", () => {
  assert.match(page, /horizon-theme hz-page/);
  assert.match(page, /<HorizonPageHeader(?:\s|>)/);
  assert.match(page, /<HorizonMetricGrid(?:\s|>)/);
  assert.equal((page.match(/<HorizonMetric(?=[\s>])/g) ?? []).length, 4);

  for (const source of ["data.total", "stats?.uniqueResources", "stats?.uniqueActors", "stats?.aiCount", "stats?.riskCount"]) {
    assert.match(page, new RegExp(source.replace(/[?.]/g, "\\$&")), `指标缺少真实数据源 ${source}`);
  }
  assert.match(page, /其中 \{n\} 条 AI\/自动记录/);
});

test("审计查询、预设、筛选、分页和详情契约保持完整", () => {
  for (const contract of [
    /fetchAuditLogPage\(\{ \.\.\.query, statsSignature: statsSignature\.current \}\)/,
    /fetchAuditFacets\(moduleFilter === "all" \? undefined : moduleFilter\)/,
    /actionsForCategory\(category\)/,
    /dateFrom: toDateStart\(since\)/,
    /dateTo: toDateEnd\(until\)/,
    /keyword: debouncedKeyword \|\| undefined/,
    /const applyPreset = \(preset: "task" \| "proposal" \| "ai" \| "risk" \| "today"\)/,
    /setPage\(\(current\) => Math\.max\(1, current - 1\)\)/,
    /setPage\(\(current\) => Math\.min\(totalPages, current \+ 1\)\)/,
    /resourceId: selectedResourceId/,
    /<AuditTimeline logs=\{relatedLogs\.map\(toTimelineLog\)\}/,
  ]) {
    assert.match(page, contract);
  }
});

test("审计表格语义、状态反馈与窄容器滚动边界完整", () => {
  assert.match(page, /min-h-0 min-w-0 flex-1 gap-4 overflow-y-auto/);
  assert.match(page, /xl:overflow-hidden/);
  assert.match(page, /rd-horizon-audit-table-scroll[^\n]+overflow-auto/);
  assert.match(page, /<table[^>]+min-w-\[920px\][^>]+aria-busy=\{loading\}/);
  assert.equal((page.match(/scope="col"/g) ?? []).length, 6);
  assert.match(page, /<caption className="sr-only">/);
  assert.match(page, /role="alert"/);
  assert.match(page, /正在加载留痕/);
  assert.match(page, /没有匹配的留痕记录/);
  assert.match(page, /onClick=\{resetFilters\}/);
  assert.match(page, /aria-selected=\{selected\}/);
  assert.ok((page.match(/aria-label=\{t\("(?:模块|动作类型|对象|来源|操作人|开始|结束|每页显示数量)"\)\}/g) ?? []).length >= 8);
});

test("审计页清除旧品牌和高噪声交互样式", () => {
  const forbidden = [
    [/material-/, "旧 Material 类"],
    [/gradient/i, "渐变"],
    [/\b(?:purple|violet|fuchsia|pink|indigo)-/i, "紫粉旧品牌"],
    [/\buppercase\b|\btracking-/, "装饰性字距"],
    [/hover:-translate|transition-all/, "悬停位移或 transition-all"],
    [/fixed\s+inset|window\.confirm|(?<![\w.])confirm\(/, "手写弹层或原生确认"],
    [/min-w-\[960px\]/, "整页固定最小宽度"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(page, pattern, `不应包含${label}`);
});
