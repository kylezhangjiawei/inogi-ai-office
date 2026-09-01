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
const pageAst = ts.createSourceFile(
  "AiUsageDashboardPage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const { getUsageRankingPage, USAGE_RANKING_PAGE_SIZE } = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`
);

function findNode(root, predicate) {
  let match;
  const visit = (node) => {
    if (match) return;
    if (predicate(node)) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return match;
}

function findNodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function jsxTagName(opening) {
  return opening.tagName.getText(pageAst);
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(pageAst) === name,
  );
}

function findJsxOpening(root, tagName, predicate = () => true) {
  return findNode(
    root,
    (node) =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTagName(node) === tagName &&
      predicate(node),
  );
}

function namedFunction(name) {
  const declaration = findNode(
    pageAst,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `未找到函数：${name}`);
  return declaration;
}

function classTokens(opening) {
  const attribute = jsxAttribute(opening, "className");
  if (!attribute?.initializer || !ts.isStringLiteral(attribute.initializer)) return new Set();
  return new Set(attribute.initializer.text.split(/\s+/).filter(Boolean));
}

function hasClasses(opening, requiredClasses) {
  const tokens = classTokens(opening);
  return requiredClasses.every((className) => tokens.has(className));
}

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
  const handlerStart = source.indexOf("function handleRangeChange(nextRange: UsageRange)");
  const handlerEnd = source.indexOf("async function handleBackfill", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "未找到统计周期切换处理器");
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /setRange\(nextRange\)/);
  assert.match(handler, /setData\(null\)/);
  assert.match(handler, /setLoadError\(null\)/);
  assert.match(handler, /setLoading\(true\)/);
  assert.match(handler, /setModelPage\(1\)/);
  assert.match(handler, /setUserPage\(1\)/);
  assert.match(source, /onClick=\{\(\) => handleRangeChange\(item\.value\)\}/);
  assert.match(source, /loadError && !data/);
  assert.match(source, /onClick=\{\(\) => setReloadKey\(\(key\) => key \+ 1\)\}/);
  assert.match(source, />\s*重新加载\s*</);
});

test("人员排行序号跨页连续，并让整行成为键盘详情入口", () => {
  assert.match(
    source,
    /\{userPageState\.startIndex \+ index \+ 1\}/,
  );
  const userDetailRow = findJsxOpening(
    pageAst,
    "tr",
    (opening) => jsxAttribute(opening, "aria-label")?.getText(pageAst).includes("userRow.name"),
  );
  assert.ok(userDetailRow, "人员排行整行必须提供可访问的详情入口");
  assert.match(jsxAttribute(userDetailRow, "aria-label").getText(pageAst), /按 Enter 或空格打开/);
  assert.match(jsxAttribute(userDetailRow, "tabIndex")?.getText(pageAst) ?? "", /tabIndex=\{0\}/);
  assert.ok(jsxAttribute(userDetailRow, "onClick")?.getText(pageAst).includes("openDetails(userDetails"), "点击整行必须打开成员详情");
  const keyboardHandler = jsxAttribute(userDetailRow, "onKeyDown")?.getText(pageAst) ?? "";
  assert.match(keyboardHandler, /event\.key === "Enter"/);
  assert.match(keyboardHandler, /event\.key === " "/);
  assert.equal(jsxAttribute(userDetailRow, "role"), undefined, "原生表格行不得伪装为 button role");
});

test("上一页与下一页按钮使用边界状态并触发相邻页", () => {
  const pagination = namedFunction("RankingPagination");
  const previousButton = findJsxOpening(
    pagination,
    "button",
    (opening) => jsxAttribute(opening, "aria-label")?.getText(pageAst).includes("上一页"),
  );
  assert.ok(previousButton, "缺少上一页按钮");
  assert.match(jsxAttribute(previousButton, "disabled")?.getText(pageAst) ?? "", /!hasPrevious/);
  assert.match(jsxAttribute(previousButton, "onClick")?.getText(pageAst) ?? "", /onPageChange\(safePage - 1\)/);

  const nextButton = findJsxOpening(
    pagination,
    "button",
    (opening) => jsxAttribute(opening, "aria-label")?.getText(pageAst).includes("下一页"),
  );
  assert.ok(nextButton, "缺少下一页按钮");
  assert.match(jsxAttribute(nextButton, "disabled")?.getText(pageAst) ?? "", /!hasNext/);
  assert.match(jsxAttribute(nextButton, "onClick")?.getText(pageAst) ?? "", /onPageChange\(safePage \+ 1\)/);

  const currentPageButton = findJsxOpening(
    pagination,
    "button",
    (opening) => Boolean(jsxAttribute(opening, "aria-current")),
  );
  assert.ok(currentPageButton, "页码按钮必须标记当前页");
  assert.match(jsxAttribute(currentPageButton, "aria-current").getText(pageAst), /safePage === pageNumber \? "page" : undefined/);
});

test("排行卡片预留多行高度，分页固定在卡片底部", () => {
  const cardClasses = ["hz-surface", "flex", "min-h-96", "flex-col", "overflow-hidden"];
  const rankingCards = findNodes(
    pageAst,
    (node) =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      hasClasses(node, cardClasses),
  );
  assert.equal(rankingCards.length, 2, "模型与人员排行卡片都应预留多行高度");

  const footerClasses = ["mt-auto", "flex", "flex-wrap", "items-center", "justify-between"];
  const paginationFooter = findJsxOpening(
    pageAst,
    "div",
    (opening) => hasClasses(opening, footerClasses),
  );
  assert.ok(paginationFooter, "分页栏必须通过 mt-auto 固定在排行卡片底部");
});
