import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/InventoryReadinessPage.tsx", import.meta.url), "utf8");
const builtinI18nSource = readFileSync(new URL("../src/app/lib/i18n.ts", import.meta.url), "utf8");
const seedI18nSource = readFileSync(new URL("../apps/api/scripts/seed-i18n-en.mjs", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const navigationCode = ts.transpileModule(readFileSync(new URL("../src/app/lib/inventoryReadinessNavigation.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function response(productLine = "Q5", itemCount = 1) {
  return {
    source: "tplus",
    readOnly: true,
    productLine,
    models: [{ id: "Q5", label: "Q5", bomLines: itemCount }, { id: "通用", label: "通用", bomLines: 148 }],
    warehouse: { keyword: "量产", label: "量产仓库", matchedNames: ["【活】量产仓"] },
    syncedAt: "2026-09-20T02:00:00Z",
    summary: {
      targetSets: 100,
      currentBuildableSets: 0,
      withTransitBuildableSets: 0,
      inTransitGainSets: 0,
      targetGapAfterTransit: 100,
      warningMaterials: 0,
      bottleneckMaterials: 0,
      inTransitMaterials: 0,
    },
    dataQuality: {
      totalBomLines: itemCount,
      usableBomLines: itemCount,
      invalidBomLines: 0,
      inventoryMatchedLines: itemCount,
      bomCompleteness: 1,
      inventoryMatchRate: 1,
      provisional: false,
    },
    items: itemCount ? [{ id: "A-1", code: "A-1", name: "测试物料", status: "ready" }] : [],
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? tree).flatMap(elements)];
}

function visibleText(tree) {
  if (Array.isArray(tree)) return tree.map(visibleText).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (tree?.type === "StatCell") return `${tree.props.label} ${visibleText(tree.props.value)}`;
  return tree && typeof tree === "object" ? visibleText(tree.props?.text ?? tree.props?.children) : "";
}

function pageFixture(query = "", permissions = []) {
  const slots = [];
  const requests = [];
  const navigations = [];
  const navigationOptions = [];
  let tasks = [];
  let procurementState = { loading: false, error: "" };
  let procurementHookCalls = 0;
  let slot = 0;
  let tree;
  let load;
  let reply = ({ productLine, targetSets }) => {
    const data = response(productLine);
    data.summary.targetSets = targetSets;
    data.summary.targetGapAfterTransit = targetSets;
    return data;
  };
  const t = (text, params = {}) => text.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
  const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
  const viewComponents = new Proxy({}, { get: (_target, name) => name });
  const dependencies = {
    "./InventoryMonthlyReadiness": { InventoryMonthlyReadiness: "InventoryMonthlyReadiness" },
    react: {
      useState(initial) {
        const index = slot++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) {
        const index = slot++;
        return slots[index] ??= { current: initial };
      },
      useCallback(callback) { load = callback; return callback; },
      useMemo: (factory) => factory(),
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-router": {
      useNavigate: () => (destination, options) => { navigations.push(destination); navigationOptions.push(options); },
      useSearchParams: () => [new URLSearchParams(query)],
    },
    "../lib/i18n": { useI18n: () => ({ t }), i18nLocale: () => "zh-CN" },
    "../hooks/usePermission": { usePermission: (permission) => permissions.includes(permission) },
    "../components/ui/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "./components/common": { StatCell: "StatCell" },
    "../lib/routePaths": { routePath: (_permission, fallback) => fallback },
    "./routePaths": { routePath: (_permission, fallback) => fallback },
    "../lib/inventoryCenterOverviewApi": {
      getInventoryShipmentOverview: async () => ({ month: "2026-09", scope: "all", shipmentTargetQty: null, actualShippedQty: null }),
      getInventoryQualityOverview: async () => ({ mapped: false, reasons: [] }),
    },
    "../lib/procurementApi": {
      getInventoryReadiness: async (params) => { requests.push(params); return reply(params); },
    },
    recharts: viewComponents,
    "./data": {
      useProcurementData: () => {
        procurementHookCalls += 1;
        return { tasks, materials: [], ...procurementState };
      },
      isProcurementTaskOverdue: (task) => Boolean(task.__overdue),
    },
  };
  const requireFixture = (request) => {
    const name = request.replace(/^\.\.\/\.\.\//, "../");
    if (name in dependencies) return dependencies[name];
    assert.ok(name === "lucide-react" || name.startsWith("../components/"), `Unexpected dependency: ${name}`);
    return viewComponents;
  };
  const navigationExports = {};
  new Function("exports", "require", navigationCode)(navigationExports, requireFixture);
  dependencies["../lib/inventoryReadinessNavigation"] = navigationExports;
  const exports = {};
  new Function("exports", "require", code)(exports, requireFixture);
  return {
    requests,
    navigations,
    navigationOptions,
    get procurementHookCalls() { return procurementHookCalls; },
    setTasks(value) { tasks = value; },
    setProcurementState(value) { procurementState = { ...procurementState, ...value }; },
    setResponse(value) { reply = typeof value === "function" ? value : () => value; },
    render() { slot = 0; tree = exports.InventoryReadinessPage(); return tree; },
    async load() { await load(); return this.render(); },
    selectModel(value) {
      const select = elements(tree).find((node) => node.type === "Select" && node.props.value === requests.at(-1)?.productLine);
      assert.ok(select, "产品型号选择器必须存在");
      select.props.onValueChange(value);
      return this.render();
    },
    changeInput(label, value, blur = false) {
      let input = elements(tree).find((node) => node.type === "Input" && node.props["aria-label"] === label);
      assert.ok(input, `${label} 输入框必须存在`);
      input.props.onChange({ target: { value } });
      this.render();
      if (blur) {
        input = elements(tree).find((node) => node.type === "Input" && node.props["aria-label"] === label);
        input.props.onBlur();
        return this.render();
      }
      return tree;
    },
    click(label) {
      const button = elements(tree).find((node) => node.type === "Button" && visibleText(node).replace(/\s+/g, " ").trim() === label);
      assert.ok(button, `${label} 按钮必须存在`);
      button.props.onClick();
      return this.render();
    },
  };
}

test("月度评估与库存能力共享月份、型号和刷新入口", async () => {
  const fixture = pageFixture("?productLine=Q7&month=2026-09"); fixture.render();
  let tree = await fixture.load();
  const monthly = () => elements(tree).find(node => node.type === "InventoryMonthlyReadiness");
  assert.equal(monthly().props.month, "2026-09");
  assert.equal(monthly().props.productLine, "Q7");
  tree = fixture.changeInput("统计月份", "2026-10");
  assert.equal(monthly().props.month, "2026-10");
  tree = fixture.click("刷新");
  assert.equal(monthly().props.refreshVersion, 1);
});

test('发布版本链接请求冻结依据并明确提示，切换型号回到工作稿', async () => {
  const f = pageFixture('?productLine=Q5&revisionId=rev-1');
  f.setResponse(params => ({ ...response(params.productLine), bomBasis: params.revisionId ? { kind: 'published', revisionId: 'rev-1', version: 2, retiredAt: '2026-09-22' } : { kind: 'draft' } }));
  f.render();
  let tree = await f.load();
  assert.equal(f.requests.at(-1).revisionId, 'rev-1');
  assert.match(visibleText(tree), /发布版本 V2/);
  assert.match(visibleText(tree), /已停用/);
  f.selectModel('通用'); tree = await f.load();
  assert.equal(f.requests.at(-1).revisionId, undefined);
  assert.match(visibleText(tree), /工作稿/);
});

test("默认和空型号参数都请求 Q5，空 BOM 显示可恢复的空态", async () => {
  for (const query of ["", "?productLine="]) {
    const fixture = pageFixture(query, ["page:proc-materials"]);
    fixture.setResponse(({ productLine, targetSets }) => {
      const data = response(productLine, 0);
      data.summary.targetSets = targetSets;
      return data;
    });
    fixture.render();
    const tree = await fixture.load();
    assert.deepEqual(fixture.requests[0], { productLine: "Q5", targetSets: 100 });
    assert.match(visibleText(tree), /尚未找到 Q5 的可核算 BOM/);
    assert.match(visibleText(tree), /打开物料库/);
  }
});

test("URL 指定型号与用户切换型号都保留显式选择", async () => {
  const fixture = pageFixture("?productLine=通用&targetSets=25");
  fixture.render();
  let tree = await fixture.load();
  assert.deepEqual(fixture.requests[0], { productLine: "通用", targetSets: 25 });
  assert.match(visibleText(tree), /目标\s+25\s+套/);
  fixture.selectModel("Q5");
  tree = await fixture.load();
  assert.deepEqual(fixture.requests.at(-1), { productLine: "Q5", targetSets: 25 });
  assert.match(visibleText(tree), /Q5/);
});

test("响应型号不一致时拒绝采用并显示可重试错误", async () => {
  const fixture = pageFixture("?productLine=Q5");
  fixture.setResponse(() => response("通用"));
  fixture.render();
  const tree = await fixture.load();
  assert.match(visibleText(tree), /返回的 BOM 型号与所选型号不一致/);
  assert.match(visibleText(tree), /重新加载/);
  assert.equal(elements(tree).some((node) => node.props?.["aria-label"] === "库存齐套核心指标"), false);
});

test("未知齐套保留指标、能力区域和独立任务风险，核对原因收起而不是隐藏功能", async () => {
  const fixture = pageFixture("?productLine=Q5", ["page:proc-materials"]);
  fixture.setTasks([{ id: "late-todo", status: "pending_confirm", __overdue: true }]);
  const data = response();
  data.summary.currentBuildableSets = null;
  data.summary.withTransitBuildableSets = null;
  data.items[0].issues = ["BOM 编码或用量待核对", "在所选仓库范围内缺少库存快照"];
  fixture.setResponse(data);
  fixture.render();
  const tree = await fixture.load();
  assert.equal(elements(tree).some(node => node.props?.["aria-label"] === "齐套依据待核对"), false);
  const result = elements(tree).find(node => node.props?.["data-primary-result"] === "readiness-rate");
  assert.ok(result, "未知不能隐藏齐套指标");
  assert.equal(visibleText(result), "待核对");
  const capability = elements(tree).find(node => node.props?.["data-cockpit-panel"] === "capability");
  assert.ok(capability, "能力区域仍可见");
  assert.doesNotMatch(visibleText(capability), /\+\s*0|100\s+套.*到齐后缺口\s+100/);
  const risks = elements(tree).find(node => node.props?.["data-cockpit-panel"] === "risks");
  assert.match(visibleText(risks), /逾期\s+1\s+项/);
  assert.match(visibleText(risks), /待办\s+1\s+项/);
  assert.match(visibleText(risks), /当前缺口\s+待核对/);
  const detail = elements(tree).find(node => node.type === "details" && visibleText(node).includes("数据可信度"));
  assert.ok(detail);
  assert.ok(!detail.props.open);
  assert.match(visibleText(elements(detail).find(node => node.type === "summary")), /当前可配.*待核对/);
  assert.match(visibleText(detail), /BOM 编码或用量待核对/);
  assert.match(visibleText(detail), /在所选仓库范围内缺少库存快照/);
});

test("部分齐套数据缺失只影响对应指标，已知结果与图表不消失", async () => {
  for (const [current, afterTransit] of [[18, null], [null, 42]]) {
    const fixture = pageFixture("?targetSets=100", ["page:proc-materials"]);
    const data = response();
    Object.assign(data.summary, { currentBuildableSets: current, withTransitBuildableSets: afterTransit, inTransitGainSets: null, targetGapAfterTransit: afterTransit === null ? null : 58 });
    fixture.setResponse(data);
    fixture.render();
    const tree = await fixture.load();
    const result = elements(tree).find(node => node.props?.["data-primary-result"] === "readiness-rate");
    assert.equal(visibleText(result), current === null ? "待核对" : "18%");
    const chart = elements(tree).find(node => node.type === "BarChart");
    assert.deepEqual(chart.props.data.map(row => row.value), [current, afterTransit]);
    const risk = elements(tree).find(node => node.props?.["data-cockpit-panel"] === "risks");
    assert.ok(risk);
    if (current === null) {
      assert.doesNotMatch(visibleText(risk), /暂无明确风险|暂无批次风险|批次风险未发现/);
      assert.equal(elements(risk).some(node => /bg-emerald/.test(node.props?.className ?? "")), false);
    }
  }
});

test("BOM 为空或读取失败仍保留独立任务风险与来料质量区域", async () => {
  for (const missing of ['empty', 'error']) {
    const fixture = pageFixture("?productLine=Q5", ["page:proc-materials"]);
    fixture.setTasks([{ id: "late-todo", status: "pending_confirm", __overdue: true }]);
    fixture.setResponse(() => { if (missing === 'error') throw new Error('齐套读取失败'); return response('Q5', 0); });
    fixture.render();
    const tree = await fixture.load();
    const risks = elements(tree).find(node => node.props?.["data-cockpit-panel"] === "risks");
    assert.match(visibleText(risks), /逾期\s+1\s+项/);
    assert.match(visibleText(risks), /待办\s+1\s+项/);
    assert.match(visibleText(risks), /异常物料\s+待核对/);
    assert.match(visibleText(tree), /来料不良原因/);
    assert.match(visibleText(tree), missing === 'error' ? /齐套读取失败/ : /尚未找到 Q5 的可核算 BOM/);
  }
});

test("库存齐套驾驶舱突出主结论并用图表回答能力、BOM 状态和分开的任务风险", async () => {
  const fixture = pageFixture("?productLine=Q5&targetSets=100", ["page:proc-materials"]);
  fixture.setTasks([
    { id: "late-todo-1", title: "任务名称", buyer: "经办人甲", status: "pending_confirm", __overdue: true },
  ]);
  fixture.setResponse(({ productLine, targetSets }) => {
    const data = response(productLine);
    Object.assign(data.summary, { targetSets, currentBuildableSets: 18, withTransitBuildableSets: 42, inTransitGainSets: 24, targetGapAfterTransit: 58, warningMaterials: 3 });
    Object.assign(data.dataQuality, { provisional: true, invalidBomLines: 1 });
    data.items = [
      { id: "ready-1", status: "ready" },
      { id: "ready-2", status: "ready" },
      { id: "low-1", status: "low" },
      { id: "gap-1", status: "gap" },
      { id: "shortage-1", status: "shortage" },
      { id: "unmatched-1", status: "unmatched" },
      { id: "missing-1", status: "data_missing" },
    ];
    return data;
  });
  fixture.render();
  const tree = await fixture.load();
  const cockpit = elements(tree).find((node) => node.props?.["aria-label"] === "库存齐套驾驶舱");
  assert.ok(cockpit, "驾驶舱必须有独立语义区域");
  const primaryResult = elements(cockpit).find((node) => node.props?.["data-primary-result"] === "readiness-rate");
  assert.match(primaryResult?.props.className ?? "", /text-4xl|text-5xl/);
  assert.match(primaryResult?.props.className ?? "", /text-rose/);
  assert.match(visibleText(primaryResult), /18%/);
  const capabilityChart = elements(cockpit).find((node) => node.props?.role === "img" && /^装配物料齐套能力对比/.test(node.props?.["aria-label"]));
  assert.equal(capabilityChart?.props["aria-label"], "装配物料齐套能力对比：目标 100 套，当前可配 18 套，在途增益 24 套，全部在途到齐后 42 套，到齐后缺口 58 套");
  assert.match(visibleText(cockpit), /数据待核对/);
  assert.match(visibleText(cockpit), /逾期\s+1\s+项/);
  assert.match(visibleText(cockpit), /待办\s+1\s+项/);
  assert.match(visibleText(cockpit), /任务按当前授权范围统计/);
  const riskOverview = elements(cockpit).find((node) => node.props?.["aria-label"] === "风险速览");
  assert.ok(riskOverview, "风险速览必须有独立语义区域");
  assert.match(visibleText(riskOverview), /4\s+类风险需处理/);
  const primaryRisk = elements(riskOverview).find((node) => node.props?.["data-primary-risk"] === "current-gap");
  assert.match(visibleText(primaryRisk), /首要风险\s+需处理\s+当前缺口\s+82\s+套/);
  const bomChart = elements(tree).find((node) => node.props?.role === "img" && /^BOM 状态分布/.test(node.props?.["aria-label"]));
  assert.equal(bomChart?.props["aria-label"], "BOM 状态分布：齐套 2 项，库存风险 3 项，数据待完善 2 项");
  assert.doesNotMatch(visibleText(tree), /任务名称|经办人甲/);
});

test("风险速览会按业务优先级突出第一项非零风险", async () => {
  const cases = [
    { current: 90, warning: 5, tasks: [{ id: "late-todo", status: "pending_confirm", __overdue: true }], expected: "current-gap", severity: "需处理" },
    { current: 100, warning: 5, tasks: [{ id: "late", status: "done", __overdue: true }], expected: "overdue", severity: "需处理" },
    { current: 100, warning: 5, tasks: [], expected: "warning-materials", severity: "需关注" },
    { current: 100, warning: 0, tasks: [{ id: "todo", status: "pending_confirm" }], expected: "todo", severity: "需关注" },
  ];
  for (const scenario of cases) {
    const fixture = pageFixture("?targetSets=100", ["page:proc-materials"]);
    fixture.setTasks(scenario.tasks);
    fixture.setResponse(({ productLine, targetSets }) => {
      const data = response(productLine);
      Object.assign(data.summary, { targetSets, currentBuildableSets: scenario.current, withTransitBuildableSets: scenario.current, targetGapAfterTransit: 0, warningMaterials: scenario.warning });
      return data;
    });
    fixture.render();
    const tree = await fixture.load();
    const riskOverview = elements(tree).find((node) => node.props?.["aria-label"] === "风险速览");
    const primaryRisks = elements(riskOverview).filter((node) => node.props?.["data-primary-risk"]);
    assert.equal(primaryRisks.length, 1);
    assert.equal(primaryRisks[0].props["data-primary-risk"], scenario.expected);
    assert.match(visibleText(primaryRisks[0]), new RegExp(scenario.severity));
  }
});

test("风险均为零时显示明确结论且不制造红色首要风险", async () => {
  const fixture = pageFixture("?targetSets=100", ["page:proc-materials"]);
  fixture.setResponse(({ productLine, targetSets }) => {
    const data = response(productLine);
    Object.assign(data.summary, { targetSets, currentBuildableSets: 100, withTransitBuildableSets: 100, targetGapAfterTransit: 0, warningMaterials: 0 });
    return data;
  });
  fixture.render();
  const tree = await fixture.load();
  const riskOverview = elements(tree).find((node) => node.props?.["aria-label"] === "风险速览");
  assert.match(visibleText(riskOverview), /暂无明确风险/);
  assert.equal(elements(riskOverview).some((node) => node.props?.["data-primary-risk"]), false);
});

test("任务风险未知时不把零批次风险渲染成全绿安全", async () => {
  const fixture = pageFixture("?targetSets=100", ["page:proc-materials"]);
  fixture.setProcurementState({ loading: true });
  fixture.setResponse(({ productLine, targetSets }) => {
    const data = response(productLine);
    Object.assign(data.summary, { targetSets, currentBuildableSets: 100, withTransitBuildableSets: 100, targetGapAfterTransit: 0, warningMaterials: 0 });
    return data;
  });
  fixture.render();
  const tree = await fixture.load();
  const riskOverview = elements(tree).find((node) => node.props?.["aria-label"] === "风险速览");
  assert.match(visibleText(riskOverview), /批次风险未发现，任务风险待核对/);
  assert.equal(elements(riskOverview).some((node) => /bg-emerald/.test(node.props?.className ?? "")), false);
  assert.equal(elements(riskOverview).some((node) => /bg-amber/.test(node.props?.className ?? "")), true);
});

test("任务风险加载失败时明确提示未计入而非持续显示待核对", async () => {
  const fixture = pageFixture("?targetSets=100", ["page:proc-materials"]);
  fixture.setProcurementState({ loading: false, error: "请求失败" });
  fixture.setResponse(({ productLine, targetSets }) => {
    const data = response(productLine);
    Object.assign(data.summary, { targetSets, currentBuildableSets: 100, withTransitBuildableSets: 100, targetGapAfterTransit: 0, warningMaterials: 0 });
    return data;
  });
  fixture.render();
  const tree = await fixture.load();
  const riskOverview = elements(tree).find((node) => node.props?.["aria-label"] === "风险速览");
  assert.match(visibleText(riskOverview), /任务风险加载失败，未计入/);
  assert.equal(elements(riskOverview).some((node) => /bg-emerald/.test(node.props?.className ?? "")), false);
  assert.equal(elements(riskOverview).some((node) => /bg-amber/.test(node.props?.className ?? "")), true);
});

test("齐套主结论明确只覆盖装配物料，并提示陈旧库存与未计入包材", async () => {
  const fixture = pageFixture("?productLine=Q5&targetSets=100");
  fixture.setResponse(({ productLine, targetSets }) => {
    const data = response(productLine, 2);
    const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    Object.assign(data.summary, { targetSets, currentBuildableSets: 100, withTransitBuildableSets: 100, targetGapAfterTransit: 0 });
    data.syncedAt = fresh;
    data.items = [
      { id: "fresh", code: "FRESH", name: "新记录", status: "ready", syncedAt: fresh },
      { id: "stale", code: "STALE", name: "旧记录", status: "ready", syncedAt: stale },
    ];
    data.packaging = { items: [{ id: "pkg", code: "PKG", name: "包材", syncedAt: fresh }] };
    return data;
  });
  fixture.render();
  const tree = await fixture.load();
  const text = visibleText(tree);
  assert.match(text, /装配物料齐套率/);
  assert.match(text, /包材与随箱配件未计入/);
  assert.match(text, /1\s+项库存记录超过\s+24\s+小时/);
});

test("仅有库存齐套或研发总监权限时不读取采购任务与无权质量路径", async () => {
  for (const permissions of [
    ["page:proc-inventory-readiness"],
    ["page:proc-inventory-readiness", "page:rd-director-dashboard"],
  ]) {
    const fixture = pageFixture("", permissions);
    fixture.render();
    const tree = await fixture.load();
    assert.equal(fixture.procurementHookCalls, 0);
    assert.match(visibleText(tree), /当前权限不含来料质量数据/);
    assert.match(visibleText(tree), /任务风险未计入/);
  }
});

test("驾驶舱新增关键文案同时提供内置与服务端英文词条", () => {
  const keys = [
    "装配物料齐套率",
    "包材与随箱配件未计入，完整齐套需另行确认。",
    "装配物料齐套能力",
    "风险速览",
    "{count} 类风险需处理",
    "首要风险",
    "需处理",
    "需关注",
    "暂无明确风险",
    "{count} 类批次风险，任务风险未计入",
    "任务风险加载失败，未计入",
    "本批缺口；任务按当前授权范围统计",
    "BOM 状态分布",
    "数据可信度",
    "{count} 项库存记录超过 24 小时",
    "月度出货概览",
    "来料不良原因",
    "正在加载型号",
    "暂无型号",
    "工艺问题",
    "包装问题",
    "检验标准",
    "版本不符",
    "来料问题",
    "其他",
  ];
  for (const key of keys) {
    const literal = JSON.stringify(key);
    assert.ok(builtinI18nSource.includes(literal), `内置英文词典缺少：${key}`);
    assert.ok(seedI18nSource.includes(literal), `服务端英文词典缺少：${key}`);
  }
});

test("齐套驾驶舱在未设目标和超目标时保持有限且非负的图表数据", async () => {
  for (const summary of [
    { targetSets: 0, currentBuildableSets: 12, withTransitBuildableSets: 18, inTransitGainSets: 6, targetGapAfterTransit: 0 },
    { targetSets: 100, currentBuildableSets: 120, withTransitBuildableSets: 180, inTransitGainSets: 60, targetGapAfterTransit: 0 },
  ]) {
    const fixture = pageFixture(`?targetSets=${summary.targetSets}`);
    fixture.setResponse(({ productLine }) => {
      const data = response(productLine);
      Object.assign(data.summary, summary);
      return data;
    });
    fixture.render();
    const tree = await fixture.load();
    const chart = elements(tree).find((node) => node.type === "BarChart");
    assert.ok(chart, "齐套能力必须使用真实图表");
    assert.ok(chart.props.data.every((datum) => Number.isFinite(datum.value) && datum.value >= 0));
    assert.doesNotMatch(visibleText(tree), /NaN|Infinity/);
    if (summary.targetSets === 0) assert.match(visibleText(tree), /未设置目标/);
    else assert.match(visibleText(tree), /120%/);
  }
});

test("窄屏布局压缩月度概览和工具栏，并保留可见键盘焦点", async () => {
  const fixture = pageFixture();
  fixture.render();
  const tree = await fixture.load();
  const page = elements(tree).find((node) => typeof node.props?.className === "string" && node.props.className.includes("proc-horizon"));
  const monthOverview = elements(tree).find((node) => node.props?.["aria-label"] === "月度出货概览");
  const controls = elements(tree).find((node) => node.props?.["aria-label"] === "齐套核算条件");
  const cockpit = elements(tree).find((node) => node.props?.["aria-label"] === "库存齐套驾驶舱");
  const riskOverview = elements(cockpit).find((node) => node.props?.["aria-label"] === "风险速览");
  const capability = elements(cockpit).find((node) => node.props?.["aria-label"] === "装配物料齐套能力");
  assert.ok(page, "页面根节点必须支持响应式内容排序");
  assert.ok(monthOverview, "月度出货概览必须有独立语义区域");
  assert.ok(controls, "齐套核算条件必须有独立语义区域");
  assert.ok(cockpit, "齐套驾驶舱必须有独立语义区域");
  assert.ok(riskOverview, "风险速览必须有独立语义区域");
  assert.ok(capability, "齐套能力必须有独立语义区域");
  assert.match(page.props.className, /\bflex\b/);
  assert.match(page.props.className, /\bflex-col\b/);
  assert.match(cockpit.props.className, /order-1/);
  assert.match(cockpit.props.className, /xl:order-3/);
  assert.match(riskOverview.props.className, /order-2/);
  assert.match(riskOverview.props.className, /xl:order-3/);
  assert.match(capability.props.className, /order-3/);
  assert.match(capability.props.className, /xl:order-2/);
  assert.match(monthOverview.props.className, /order-2/);
  assert.match(monthOverview.props.className, /xl:order-1/);
  assert.match(controls.props.className, /order-3/);
  assert.match(controls.props.className, /xl:order-2/);
  const shipmentStats = elements(monthOverview).find((node) => node.type === "dl");
  assert.match(shipmentStats.props.className, /grid-cols-3/);
  const controlLayout = elements(controls).find((node) => node.props?.["data-layout"] === "readiness-controls");
  assert.match(controlLayout.props.className, /grid-cols-2/);
  assert.match(controlLayout.props.className, /xl:grid-cols-/);
  assert.doesNotMatch(controlLayout.props.className, /lg:grid-cols-/);
  const monthInput = elements(monthOverview).find((node) => node.type === "Input" && node.props["aria-label"] === "统计月份");
  const monthLabel = elements(monthOverview).find((node) => node.type === "label" && elements(node).includes(monthInput));
  assert.match(monthInput.props.className, /h-11/);
  assert.match(monthInput.props.className, /focus-visible:ring-2/);
  assert.doesNotMatch(monthInput.props.className, /focus-visible:ring-0/);
  assert.match(monthLabel.props.className, /focus-within:ring-2/);
});

test("加载与来料质量空状态会被辅助技术播报", async () => {
  const fixture = pageFixture();
  let tree = fixture.render();
  const loadingStatus = elements(tree).find((node) => node.props?.role === "status" && /正在核算库存齐套情况/.test(visibleText(node)));
  assert.ok(loadingStatus, "主加载状态必须可播报");
  tree = await fixture.load();
  const qualityStatus = elements(tree).find((node) => node.props?.["aria-label"] === "来料质量状态");
  assert.equal(qualityStatus?.props.role, "status");
  assert.equal(qualityStatus?.props["aria-live"], "polite");
  assert.doesNotMatch(qualityStatus.props.className, /min-h-44/);
});

test("在途到齐后的口径明确不等同于按期齐套", async () => {
  const fixture = pageFixture();
  fixture.render();
  const tree = await fixture.load();
  const text = visibleText(tree);
  assert.match(text, /全部在途到齐后未按到货日期筛选，不代表按期齐套/);
  assert.doesNotMatch(text, /按期预计/);
  assert.equal(elements(tree).some((node) => node.props?.role === "progressbar"), false);
});

test("融合概览不再渲染已删除的物料、任务和补料区域", async () => {
  const fixture = pageFixture();
  fixture.render();
  const tree = await fixture.load();
  const text = visibleText(tree);
  for (const removed of [
    "关键物料齐套情况",
    "按期已下单未入库",
    "预期齐套进度",
    "线边原料折算覆盖",
    "未下单计划情景",
    "导出缺料清单",
    "生成材料建议",
    "物料齐套明细",
    "优先处理",
  ]) assert.doesNotMatch(text, new RegExp(removed));
  assert.equal(elements(tree).some((node) => node.props?.["aria-label"] === "物料齐套卡片"), false);
  assert.equal(elements(tree).some((node) => node.type === "MaterialPurchaseOrderLines"), false);
});

test("批次目标只接受范围内整数，提交后用新目标重算", async () => {
  const fixture = pageFixture();
  fixture.render();
  await fixture.load();
  fixture.changeInput("批次目标", "25", true);
  await fixture.load();
  assert.deepEqual(fixture.requests.at(-1), { productLine: "Q5", targetSets: 25 });
  const beforeInvalid = fixture.requests.length;
  const tree = fixture.changeInput("批次目标", "25.5", true);
  assert.match(visibleText(tree), /请输入 0 到 1,000,000 之间的整数套数/);
  assert.equal(fixture.requests.length, beforeInvalid);
});

test("打开物料库保留当前型号与已提交目标作为安全返回上下文", async () => {
  const fixture = pageFixture("?productLine=通用&targetSets=25", ["page:proc-materials"]);
  fixture.render();
  await fixture.load();
  fixture.click("打开物料库");
  assert.equal(fixture.navigations.length, 2);
  assert.equal(fixture.navigations[0], "/proc-inventory-readiness?productLine=%E9%80%9A%E7%94%A8&targetSets=25");
  assert.equal(fixture.navigations[1], "/proc-materials");
  assert.deepEqual(fixture.navigationOptions[1].state, {
    inventoryReadinessReturnTo: fixture.navigations[0],
    inventoryReadinessHistoryBack: true,
  });
});
