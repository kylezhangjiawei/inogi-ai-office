import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const page = readFileSync(new URL("../src/app/AuditLogPage.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const ast = ts.createSourceFile("AuditLogPage.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNodes(predicate, root = ast) {
  const result = [];
  const visit = (node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function attribute(node, name) {
  return node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === name)?.initializer;
}

function element(tag, predicate = () => true) {
  const matches = findNodes((node) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && node.tagName.getText(ast) === tag && predicate(node));
  assert.equal(matches.length, 1, `Expected one ${tag}`);
  return matches[0];
}

function expression(node, name) {
  const value = attribute(node, name);
  assert.ok(value && ts.isJsxExpression(value) && value.expression, `Missing ${name}`);
  return value.expression.getText(ast);
}

function declaration(name) {
  const matches = findNodes((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.equal(matches.length, 1, `Expected declaration ${name}`);
  return matches[0];
}

function evaluate(source, bindings = {}) {
  const javascript = ts.transpileModule(`return (${source});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
}

const detailButton = element("Button", (node) => attribute(node, "className")?.getText(ast).includes("rd-horizon-audit-open-detail"));
const detailSheet = element("Sheet");
const detailContent = element("SheetContent");

function detailFixture() {
  const state = declaration("[selectedId, setSelectedId]").initializer;
  assert.ok(state && ts.isCallExpression(state));
  let selectedId = evaluate(state.arguments[0].getText(ast));
  const selectedTriggerRef = { current: null };
  const bindings = { selectedTriggerRef, setSelectedId: (value) => { selectedId = value; } };
  return {
    selected(items) {
      return evaluate(declaration("selectedLog").initializer.getText(ast), { pagedLogs: items, selectedId });
    },
    open(items) {
      return evaluate(expression(detailSheet, "open"), { selectedLog: this.selected(items) });
    },
    click(log, trigger) {
      evaluate(expression(detailButton, "onClick"), { ...bindings, log })({ currentTarget: trigger });
    },
    setOpen(open) { evaluate(expression(detailSheet, "onOpenChange"), bindings)(open); },
    restoreFocus(event) { evaluate(expression(detailContent, "onCloseAutoFocus"), bindings)(event); },
  };
}

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
    /selectedLog\.changes\.map/,
    /formatValue\(change\.before\)/,
    /formatValue\(change\.after\)/,
    /Object\.entries\(selectedLog\.metadata\)/,
    /<AutoTranslatedText text=\{selectedLog\.comment\}/,
  ]) {
    assert.match(page, contract);
  }
});

test("审计表格语义、状态反馈与窄容器滚动边界完整", () => {
  const scrollRegion = element("div", (node) => attribute(node, "className")?.text?.includes("rd-horizon-audit-table-scroll"));
  assert.equal(evaluate(expression(scrollRegion, "tabIndex")), 0, "内部滚动区域可通过键盘聚焦");
  assert.match(expression(scrollRegion, "aria-label"), /审计结果表格/);
  const scrollRules = css.match(/\.rd-horizon-audit \.rd-horizon-audit-table-scroll\s*\{([^}]+)\}/)?.[1];
  assert.ok(scrollRules);
  assert.match(scrollRules, /overflow:\s*auto/, "桌面表格可在区域内横向与纵向滚动");
  assert.match(scrollRules, /max-height:[^;]+100dvh/, "表格高度随视口限制，分页保留在表格之外");
  const headerRules = css.match(/\.rd-horizon-audit \.rd-horizon-audit-table thead\s*\{([^}]+)\}/)?.[1];
  assert.match(headerRules, /position:\s*sticky/);
  assert.match(headerRules, /top:\s*0/);
  assert.ok(!scrollRegion.parent.getText(ast).includes("rd-horizon-audit-list-footer"), "分页不能随表格行滚出内部视区");
  assert.match(page, /<table[^>]+aria-busy=\{loading\}/);
  assert.equal((page.match(/scope="col"/g) ?? []).length, 6);
  assert.deepEqual([...page.matchAll(/data-cell="([^"]+)"/g)].map((match) => match[1]),
    ["time", "actor", "action", "summary", "source", "changes"], "手机重排仍需保留全部六类信息");
  assert.match(page, /<caption className="sr-only">/);
  assert.match(page, /role="alert"/);
  assert.match(page, /正在加载留痕/);
  assert.match(page, /没有匹配的留痕记录/);
  assert.match(page, /onClick=\{resetFilters\}/);
  assert.match(page, /data-selected=\{selected \|\| undefined\}/);
  assert.equal(attribute(detailButton, "type")?.text, "button");
  assert.equal(attribute(detailButton, "aria-haspopup")?.text, "dialog");
  assert.equal(attribute(detailButton, "aria-controls")?.text, attribute(detailContent, "id")?.text);
  assert.ok(attribute(detailButton, "aria-label"), "详情按钮应有可访问名称，键盘使用原生按钮交互");
  assert.ok((page.match(/aria-label=\{t\("(?:模块|动作类型|对象|来源|操作人|开始|结束|每页显示数量)"\)\}/g) ?? []).length >= 8);
});

test("审计页面保留自然高度，仅表格内部滚动且手机记录不裁切", () => {
  assert.doesNotMatch(page, /rd-horizon-audit-grid/);
  assert.doesNotMatch(css, /\.rd-horizon-audit-grid\b/, "旧断点规则不得残留并与新布局竞争");
  const surfaces = findNodes((node) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && /(?:horizon-theme hz-page|\brd-horizon-audit-(?:shell|list|table-scroll)\b)/.test(attribute(node, "className")?.getText(ast) ?? ""));
  for (const surface of surfaces) {
    assert.doesNotMatch(attribute(surface, "className").getText(ast), /\b(?:h-full|h-screen|h-dvh|overflow-hidden|overflow-y-hidden)\b/);
  }
  assert.ok(surfaces.length >= 4);
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.split(",").some((part) => /\.rd-horizon-audit(?:-shell|-list|-table-scroll)?\s*$/.test(part.trim()))) continue;
    if (!selector.includes(".rd-horizon-audit-table-scroll")) {
      assert.doesNotMatch(body, /(?:^|;)\s*(?:height|max-height)\s*:\s*(?!auto\b|none\b|initial\b|unset\b)[^;]+/,
        `审计页面及外壳不应被固定高度限制：${selector.trim()}`);
    }
    assert.doesNotMatch(body, /(?:^|;)\s*overflow(?:-y)?\s*:\s*(?:hidden|clip)\b/,
      `审计主区域不应裁切纵向记录：${selector.trim()}`);
  }
  const scrollRules = [...css.matchAll(/\.rd-horizon-audit \.rd-horizon-audit-table-scroll\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(scrollRules.some(rule => /max-height:\s*none/.test(rule) && /overflow:\s*visible/.test(rule)), "手机重排后的记录保留全部内容可达");
});

test("常用筛选和更多筛选入口始终可达，高级筛选折叠不隐藏关键字或日期", () => {
  const collapsible = element("Collapsible");
  const content = element("CollapsibleContent").parent;
  assert.ok(ts.isJsxElement(content));
  const primary = element("div", (node) => attribute(node, "className")?.text === "rd-horizon-audit-primary-filters").parent;
  const primarySource = primary.getText(ast);
  for (const name of ["关键字", "模块", "开始", "结束"]) {
    assert.ok(primarySource.includes(`aria-label={t("${name}")}`), `${name}必须保持常显`);
    assert.ok(!content.getText(ast).includes(`aria-label={t("${name}")}`), `${name}不能藏入高级筛选`);
  }
  assert.match(primarySource, /<CollapsibleTrigger asChild>/);
  let advancedFiltersOpen = false;
  const setAdvancedFiltersOpen = (value) => { advancedFiltersOpen = value; };
  const toggle = evaluate(expression(collapsible, "onOpenChange"), { setAdvancedFiltersOpen });
  toggle(true);
  assert.equal(evaluate(expression(collapsible, "open"), { advancedFiltersOpen }), true);
  toggle(false);
  assert.equal(evaluate(expression(collapsible, "open"), { advancedFiltersOpen }), false);
});

test("首次载入不自动选中首条，点击摘要只打开对应记录，分页后不串到其他对象", () => {
  const first = { id: "log-first", resource: { id: "task-first" } };
  const target = { id: "log-target", resource: { id: "task-target" } };
  const nextPage = [{ id: "log-next", resource: { id: "task-next" } }];
  const detail = detailFixture();
  assert.equal(detail.selected([first, target]), null);
  assert.equal(detail.open([first, target]), false);
  detail.click(target, { focus() {} });
  assert.equal(detail.selected([first, target]), target);
  assert.equal(detail.open([first, target]), true);
  detail.setOpen(true);
  assert.equal(detail.selected([first, target]), target, "抽屉打开事件不能切换选中对象");
  assert.equal(detail.selected(nextPage), null, "当前页找不到记录时不能改选新页首条");
  assert.equal(detail.open(nextPage), false);
  detail.click(nextPage[0], { focus() {} });
  assert.equal(detail.selected(nextPage), nextPage[0]);
});

test("关闭详情清除选择并将焦点返回最近点击的摘要按钮", () => {
  const detail = detailFixture();
  const logs = [{ id: "log-a" }, { id: "log-b" }];
  let firstFocusCount = 0;
  let currentFocusCount = 0;
  detail.click(logs[0], { focus: () => { firstFocusCount++; } });
  detail.click(logs[1], { focus: () => { currentFocusCount++; } });
  detail.setOpen(false);
  assert.equal(detail.open(logs), false);
  assert.equal(detail.selected(logs), null);
  let prevented = false;
  detail.restoreFocus({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(firstFocusCount, 0);
  assert.equal(currentFocusCount, 1);
  assert.doesNotThrow(() => detailFixture().restoreFocus({ preventDefault() {} }), "没有触发按钮时也可安全关闭");
});

test("刷新重新读取当前筛选并更新统计，不清空查询条件或重置页码", () => {
  const refresh = element("Button", (node) => attribute(node, "onClick")?.getText(ast).includes("setReloadVersion"));
  const query = Object.freeze({ module: "procurement", keyword: "主板", page: 3, pageSize: 25 });
  const before = JSON.stringify(query);
  const statsSignature = { current: "old-signature" };
  let reloadVersion = 2;
  evaluate(expression(refresh, "onClick"), {
    query,
    statsSignature,
    setReloadVersion: (update) => { reloadVersion = update(reloadVersion); },
  })();
  assert.equal(reloadVersion, 3);
  assert.equal(statsSignature.current, undefined);
  assert.equal(JSON.stringify(query), before);
  const fetchEffect = findNodes((node) => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("fetchAuditLogPage({ ...query"));
  assert.equal(fetchEffect.length, 1);
  assert.deepEqual(fetchEffect[0].arguments[1].elements.map((node) => node.getText(ast)), ["query", "reloadVersion"]);
  assert.equal(expression(refresh, "disabled"), "loading");
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
