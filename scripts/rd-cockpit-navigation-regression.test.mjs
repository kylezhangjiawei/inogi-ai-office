import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("RDTaskManagementPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodesWhere(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function one(root, predicate, description) {
  const matches = nodesWhere(root, predicate);
  assert.equal(matches.length, 1, `Expected one ${description}, found ${matches.length}`);
  return matches[0];
}

const cockpit = one(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "PersonTaskCockpit", "PersonTaskCockpit");
const overview = one(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ExecutiveOverview", "ExecutiveOverview");

function declaration(root, name) {
  return one(root, (node) => ts.isVariableDeclaration(node) && (
    ts.isIdentifier(node.name) ? node.name.text === name
      : ts.isArrayBindingPattern(node.name) && node.name.elements.some((element) => ts.isBindingElement(element) && element.name.getText(ast) === name)
  ), `${name} declaration`);
}

function evaluate(expression, bindings = {}) {
  const code = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

// Extract the actual hook initializer/callback, rather than rewriting its logic in this test.
function hookArgument(root, name) {
  const initializer = declaration(root, name).initializer;
  assert.ok(initializer && ts.isCallExpression(initializer), `${name} must have a hook initializer`);
  assert.ok(initializer.arguments[0], `${name} must have an initial value or callback`);
  return initializer.arguments[0].getText(ast);
}

function attribute(element, name) {
  return element.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name);
}

function jsxExpression(element, name) {
  const initializer = attribute(element, name)?.initializer;
  assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression, `Missing ${name} expression`);
  return initializer.expression.getText(ast);
}

function openingWithLabel(root, label) {
  return one(root, (node) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && attribute(node, "aria-label")?.initializer?.getText(ast).includes(label), `element labelled ${label}`);
}

const searchInput = openingWithLabel(cockpit, "搜索任务全部内容");
const exitButton = openingWithLabel(overview, "退出任务大屏并展开顶部概览");
const autoCollapseCheckbox = one(overview, (node) => ts.isJsxOpeningElement(node)
  && node.tagName.getText(ast) === "DropdownMenuCheckboxItem"
  && attribute(node, "checked")?.initializer?.getText(ast).includes("headerPinned"), "auto-collapse checkbox");
const taskPageSize = evaluate(declaration(ast, "TASK_PAGE_SIZE").initializer.getText(ast));

function navigationFixture({ usCollabLayout = false } = {}) {
  let headerPinned = evaluate(hookArgument(overview, "headerPinned"));
  let headerCollapsed = evaluate(hookArgument(overview, "headerCollapsed"));
  let visibleCounts = evaluate(hookArgument(cockpit, "visibleCounts"));
  let now = 10_000;
  const lastScrollTopRef = { current: evaluate(hookArgument(cockpit, "lastScrollTopRef")) };
  const collapseLockUntilRef = { current: evaluate(hookArgument(cockpit, "collapseLockUntilRef")) };
  const acceptedChanges = [];
  const setHeaderCollapsed = (value) => {
    acceptedChanges.push(value);
    headerCollapsed = value;
  };
  const setHeaderPinned = (value) => { headerPinned = value; };
  const loadNextTaskPage = evaluate(hookArgument(cockpit, "loadNextTaskPage"), {
    taskPageSize,
    TASK_PAGE_SIZE: taskPageSize,
    setVisibleCounts: (update) => { visibleCounts = update(visibleCounts); },
  });

  return {
    acceptedChanges,
    get collapsed() { return headerCollapsed; },
    get pinned() { return headerPinned; },
    get visibleCounts() { return visibleCounts; },
    get lastTop() { return lastScrollTopRef.current; },
    advance(milliseconds) { now += milliseconds; },
    scroll(top, { scrollHeight = 2_000, clientHeight = 500, tabKey = "all", totalTasks = 100 } = {}) {
      // Each event sees the state from the latest render; persistent refs retain their previous values.
      const onHeaderCollapseChange = evaluate(hookArgument(overview, "handleHeaderCollapseChange"), {
        headerPinned, usCollabLayout, setHeaderCollapsed,
      });
      const onScroll = evaluate(hookArgument(cockpit, "handleTaskScroll"), {
        headerCollapsed, onHeaderCollapseChange, loadNextTaskPage,
        lastScrollTopRef, collapseLockUntilRef, Date: { now: () => now },
      });
      onScroll({ currentTarget: { scrollTop: top, scrollHeight, clientHeight } }, tabKey, totalTasks);
    },
    exit() {
      evaluate(jsxExpression(exitButton, "onClick"), { setHeaderCollapsed })();
    },
    setAutoCollapse(enabled) {
      evaluate(jsxExpression(autoCollapseCheckbox, "onCheckedChange"), { setHeaderPinned })(enabled);
    },
  };
}

test("研发初始允许自动收起，第一次下滑超过 80px 即进入大屏", () => {
  const page = navigationFixture();
  assert.equal(page.pinned, false, "默认钉住会让真实的滚动收起信号被父组件丢弃");
  assert.equal(page.collapsed, false);
  page.scroll(81);
  assert.equal(page.collapsed, true);
  assert.deepEqual(page.acceptedChanges, [true]);
});

test("80px 边界和不超过 6px 的抖动不收起，累积越过阈值后才收起", () => {
  const page = navigationFixture();
  page.scroll(8);
  page.scroll(80);
  assert.equal(page.collapsed, false);
  page.scroll(86);
  assert.equal(page.collapsed, false, "6px 抖动不应触发收起");
  page.scroll(87);
  assert.equal(page.collapsed, true, "小幅滚动应累计到上次基准，不能每次重置导致永不触发");
});

test("收起后的高度回弹在冷却内只更新滚动基准，不重复改变大屏状态", () => {
  const page = navigationFixture();
  page.scroll(100);
  page.advance(100);
  page.scroll(20);
  assert.equal(page.lastTop, 20);
  page.scroll(150);
  assert.equal(page.lastTop, 150);
  assert.equal(page.collapsed, true);
  assert.deepEqual(page.acceptedChanges, [true]);
});

test("大屏内向上滚回第一排不自动退出", () => {
  const page = navigationFixture();
  page.scroll(160);
  page.advance(421);
  page.scroll(40);
  page.scroll(0);
  assert.equal(page.collapsed, true);
  assert.equal(page.lastTop, 0);
  assert.deepEqual(page.acceptedChanges, [true]);
});

test("手动退出立即展开概览，冷却结束后再次下滑能重新进入大屏", () => {
  const page = navigationFixture();
  page.scroll(100);
  page.exit();
  assert.equal(page.collapsed, false);
  page.advance(100);
  page.scroll(140);
  assert.equal(page.collapsed, false, "手动退出后的布局变化不能在冷却内立即重新收起");
  page.advance(321);
  page.scroll(148);
  assert.equal(page.collapsed, true);
  assert.deepEqual(page.acceptedChanges, [true, false, true]);
});

test("关闭自动收起会忽略下滑信号，重新开启后恢复；协同始终不自动收起", () => {
  const page = navigationFixture();
  page.setAutoCollapse(false);
  assert.equal(page.pinned, true);
  page.scroll(100);
  assert.equal(page.collapsed, false);
  assert.deepEqual(page.acceptedChanges, []);
  page.setAutoCollapse(true);
  page.advance(421);
  page.scroll(110);
  assert.equal(page.collapsed, true);

  const collaboration = navigationFixture({ usCollabLayout: true });
  collaboration.scroll(100);
  collaboration.advance(421);
  collaboration.scroll(200);
  assert.equal(collaboration.collapsed, false);
  assert.deepEqual(collaboration.acceptedChanges, []);
});

test("近底分页在大屏冷却内继续执行，各人员分页独立且不超过任务总数", () => {
  const page = navigationFixture();
  const dimensions = { scrollHeight: 1_000, clientHeight: 600, totalTasks: taskPageSize * 2 + 1 };
  page.scroll(280, dimensions); // 距底部恰好 120px，尚未触发分页，但已收起。
  assert.deepEqual(page.visibleCounts, {});
  page.advance(100);
  page.scroll(281, dimensions);
  assert.equal(page.visibleCounts.all, taskPageSize * 2, "冷却不能阻止近底分页");
  page.scroll(282, dimensions);
  assert.equal(page.visibleCounts.all, dimensions.totalTasks);
  const completeCounts = page.visibleCounts;
  page.scroll(283, dimensions);
  assert.equal(page.visibleCounts, completeCounts, "到达总数后不再生成无意义的分页更新");
  page.scroll(281, { ...dimensions, tabKey: "person-42" });
  assert.equal(page.visibleCounts["person-42"], taskPageSize * 2);
  assert.equal(page.visibleCounts.all, dimensions.totalTasks);
  assert.deepEqual(page.acceptedChanges, [true]);
});

test("关闭自动收起和协同模式仍允许近底加载更多任务", () => {
  for (const options of [{}, { usCollabLayout: true }]) {
    const page = navigationFixture(options);
    page.setAutoCollapse(false);
    page.scroll(490, { scrollHeight: 1_000, clientHeight: 500 });
    assert.equal(page.visibleCounts.all, taskPageSize * 2);
    assert.equal(page.collapsed, false);
  }
});

test("普通和人员任务流的滚动都接入真实处理函数，父组件保留收起回调", () => {
  const streams = nodesWhere(cockpit, (node) => ts.isJsxOpeningElement(node)
    && attribute(node, "onScroll")?.initializer?.getText(ast).includes("handleTaskScroll"));
  assert.equal(streams.length, 2);
  const calls = [];
  const event = { currentTarget: {} };
  for (const stream of streams) {
    evaluate(jsxExpression(stream, "onScroll"), {
      handleTaskScroll: (...args) => calls.push(args),
      allActiveTasks: Array(17), p: { key: "person-42" }, primaryTasks: Array(9),
    })(event);
  }
  assert.deepEqual(calls, [[event, "all", 17], [event, "person-42", 9]]);
  const child = one(overview, (node) => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(ast) === "PersonTaskCockpit", "PersonTaskCockpit usage");
  assert.equal(jsxExpression(child, "onHeaderCollapseChange"), "handleHeaderCollapseChange");
  assert.equal(jsxExpression(child, "headerCollapsed"), "headerCollapsed");
});

function stateDependent(node) {
  return nodesWhere(node, (child) => ts.isIdentifier(child)
    && /^(?:.*keyword|cockpitSearch|searchOpen|headerCollapsed)$/i.test(child.text)).length > 0;
}

test("搜索输入常驻，不因空关键词、大屏切换、searchOpen 或失焦而卸载", () => {
  assert.equal(searchInput.tagName.getText(ast), "Input");
  assert.equal(jsxExpression(searchInput, "ref"), "searchInputRef");
  for (let node = searchInput; node && node !== cockpit; node = node.parent) {
    if (ts.isConditionalExpression(node)) {
      assert.equal(stateDependent(node.condition), false, `搜索输入不能位于条件 ${node.condition.getText(ast)} 之下`);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      assert.equal(stateDependent(node.left), false, `搜索输入不能由 ${node.left.getText(ast)} 控制挂载`);
    }
    const opening = ts.isJsxElement(node) ? node.openingElement
      : ts.isJsxSelfClosingElement(node) ? node : null;
    if (!opening) continue;
    assert.equal(attribute(opening, "onBlur"), undefined, "搜索框及其容器不能通过失焦关闭或卸载搜索");
    for (const name of ["key", "hidden", "aria-hidden"]) {
      const prop = attribute(opening, name);
      if (prop) assert.equal(stateDependent(prop), false, `${name} 不能让关键词或大屏状态重建/隐藏输入框`);
    }
  }
});

test("清除搜索后下一帧聚焦常驻 input，无须重建或重新打开搜索", () => {
  const values = [];
  const frames = [];
  let focused = 0;
  const input = { focus: () => { focused++; } };
  const searchInputRef = { current: input };
  const clear = evaluate(hookArgument(cockpit, "clearSearchAndRestoreFocus"), {
    setCockpitKeyword: (value) => values.push(value),
    searchInputRef,
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  clear();
  assert.deepEqual(values, [""]);
  assert.equal(focused, 0, "等待清空后的渲染再恢复焦点");
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(focused, 1);
  assert.equal(searchInputRef.current, input, "清空不替换输入框");
  clear();
  searchInputRef.current = null; // 用户在动画帧前离开页面时，不应抛出异常。
  assert.doesNotThrow(() => frames.shift()());
});
