import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/app/AiUsageDashboardPage.tsx", import.meta.url),
  "utf8",
);
const helperSource = readFileSync(
  new URL("../src/app/lib/usageRankingPagination.ts", import.meta.url),
  "utf8",
);
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getUsageRankingPage, USAGE_RANKING_PAGE_SIZE } = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`
);

test("AI 模型与人员排行各自按五条分页，且始终展示总数和页码", () => {
  assert.equal(USAGE_RANKING_PAGE_SIZE, 5);
  assert.match(source, /const \[modelPage, setModelPage\] = useState\(1\)/);
  assert.match(source, /const \[userPage, setUserPage\] = useState\(1\)/);
  assert.match(source, /modelRows\.slice\(modelPageState\.startIndex, modelPageState\.endIndex\)/);
  assert.match(source, /userRows\.slice\(userPageState\.startIndex, userPageState\.endIndex\)/);
  assert.match(source, /itemLabel="个模型"/);
  assert.match(source, /itemLabel="位成员"/);
  assert.match(source, /aria-label=\{`\$\{itemLabel\}排行分页`\}/);
});

test("分页计算覆盖空列表、整页、末页和越界页码", () => {
  assert.deepEqual(getUsageRankingPage(0, 9), {
    safePage: 1,
    totalPages: 1,
    startIndex: 0,
    endIndex: 0,
    firstItem: 0,
    lastItem: 0,
    visiblePages: [1],
    hasPrevious: false,
    hasNext: false,
  });
  assert.deepEqual(getUsageRankingPage(5, 1), {
    safePage: 1,
    totalPages: 1,
    startIndex: 0,
    endIndex: 5,
    firstItem: 1,
    lastItem: 5,
    visiblePages: [1],
    hasPrevious: false,
    hasNext: false,
  });
  assert.deepEqual(getUsageRankingPage(6, 2), {
    safePage: 2,
    totalPages: 2,
    startIndex: 5,
    endIndex: 6,
    firstItem: 6,
    lastItem: 6,
    visiblePages: [1, 2],
    hasPrevious: true,
    hasNext: false,
  });
  assert.deepEqual(getUsageRankingPage(15, 99), {
    safePage: 3,
    totalPages: 3,
    startIndex: 10,
    endIndex: 15,
    firstItem: 11,
    lastItem: 15,
    visiblePages: [1, 2, 3],
    hasPrevious: true,
    hasNext: false,
  });
});

test("切换统计周期时两个排行都回到第一页", () => {
  const handler = source.match(/function handleRangeChange\(nextRange: UsageRange\) \{[\s\S]*?\n  \}/);
  assert.ok(handler, "未找到统计周期切换处理器");
  assert.match(handler[0], /setRange\(nextRange\)/);
  assert.match(handler[0], /setData\(null\)/);
  assert.match(handler[0], /setLoadError\(null\)/);
  assert.match(handler[0], /setLoading\(true\)/);
  assert.match(handler[0], /setModelPage\(1\)/);
  assert.match(handler[0], /setUserPage\(1\)/);
  assert.match(source, /onClick=\{\(\) => handleRangeChange\(r\.value\)\}/);
  assert.match(source, /loadError && !data/);
  assert.match(source, />\s*重试\s*</);
});

test("人员排行序号跨页连续，并保留原生按钮作为键盘详情入口", () => {
  assert.match(
    source,
    /\{userPageState\.startIndex \+ i \+ 1\}/,
  );
  assert.match(source, /aria-label=\{`查看 \$\{u\.name\} 的 AI 使用详情`\}/);
  assert.doesNotMatch(source, /<tr[\s\S]{0,160}?role="button"/);
});

test("上一页与下一页按钮使用边界状态并触发相邻页", () => {
  assert.match(source, /disabled=\{!hasPrevious\}[\s\S]*?onClick=\{\(\) => onPageChange\(safePage - 1\)\}/);
  assert.match(source, /disabled=\{!hasNext\}[\s\S]*?onClick=\{\(\) => onPageChange\(safePage \+ 1\)\}/);
  assert.equal((source.match(/className="flex size-11 items-center justify-center rounded-lg border/g) ?? []).length, 2);
  assert.match(source, /"h-11 min-w-11 rounded-lg/);
});

test("排行卡片预留多行高度，分页固定在卡片底部", () => {
  assert.equal((source.match(/material-card flex min-h-96 flex-col overflow-hidden p-0/g) ?? []).length, 2);
  assert.match(source, /className="mt-auto flex flex-wrap items-center justify-between/);
});
