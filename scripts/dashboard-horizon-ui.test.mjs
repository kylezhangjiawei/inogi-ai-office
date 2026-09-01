import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/Dashboard.tsx", import.meta.url), "utf8");

function componentCount(name) {
  return (page.match(new RegExp(`<${name}(?=[\\s>])`, "g")) ?? []).length;
}

test("首页统一使用 Horizon 页头和四项真实指标", () => {
  assert.match(page, /className="horizon-theme hz-page/);
  assert.match(page, /<HorizonPageHeader(?:\s|>)/);
  assert.match(page, /<HorizonMetricGrid(?:\s|>)/);
  assert.equal(componentCount("HorizonMetric"), 4);
  for (const value of ["loadedBusinessCount", "totalPending", "totalClosed", "currentTodos"]) {
    assert.match(page, new RegExp(`value=\\{[^}]*${value}`), `首页指标缺少真实数据 ${value}`);
  }
});

test("首页不保留旧品牌装饰、悬停位移或手写全屏弹层", () => {
  const forbidden = [
    ["渐变", /gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["全属性过渡", /transition-all/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["旧 Material 页面组件", /\bmaterial-(?:card|button|chip|input|panel)\b/i],
  ];
  for (const [label, pattern] of forbidden) assert.doesNotMatch(page, pattern, `首页不应包含${label}`);
});

test("首页保留聚合加载、权限入口、自动刷新和安全分页", () => {
  assert.match(page, /fetchDashboardData\(user\?\.permissions \?\? \[\]\)/);
  assert.match(page, /window\.setInterval\([\s\S]{0,180}?60_000/);
  assert.match(page, /document\.addEventListener\("visibilitychange", refreshIfStale\)/);
  assert.match(page, /quickActionCatalog\.filter\(\(action\) => hasPermission/);
  assert.match(page, /const totalPages = Math\.max\(1, Math\.ceil\(filteredTodos\.length \/ pageSize\)\)/);
  assert.match(page, /filteredTodos\.slice\(\(page - 1\) \* pageSize, page \* pageSize\)/);
});

test("首页待办表格和详情使用语义表格与标准 Dialog", () => {
  assert.match(page, /<caption className="sr-only">/);
  assert.match(page, /<th key=\{title\} scope="col"/);
  assert.equal(componentCount("Dialog"), 2);
  assert.equal(componentCount("DialogContent"), 2);
  assert.match(page, /<DialogContent className="horizon-portal/);
  assert.match(page, /aria-pressed=\{statusFilter === item\.key\}/);
  assert.match(page, /aria-pressed=\{selectedFeedId === item\.id\}/);
});
