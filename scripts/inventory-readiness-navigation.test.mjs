import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryRouter } from "react-router";
import ts from "typescript";

const transpile = (source, jsx = false) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText;
const helperCode = transpile(readFileSync(new URL("../src/app/lib/inventoryReadinessNavigation.ts", import.meta.url), "utf8"));
function helpers(configuredPath = "/proc-inventory-readiness") {
  const exports = {};
  new Function("exports", "require", helperCode)(exports, (dependency) => {
    assert.equal(dependency, "./routePaths");
    return { routePath: (code, fallback) => {
      assert.equal(code, "page:proc-inventory-readiness");
      assert.equal(fallback, "/proc-inventory-readiness");
      return configuredPath;
    } };
  });
  return exports;
}
const { parseInventoryReadinessViewState: parse, buildInventoryReadinessPath: build, inventoryReadinessReturnPath: returnPath } = helpers();
const asState = (path) => ({ inventoryReadinessReturnTo: path });

test("直接进入齐套中心使用原默认值，非法筛选不会变成有效上下文", () => {
  const defaults = { productLine: "Q5", targetSets: 100, q: "", category: "all", status: "all", page: 1, pageSize: 20 };
  assert.deepEqual(parse(""), defaults);
  assert.deepEqual(parse("productLine=%00&targetSets=NaN&q=%0A&category=%5C&status=not-real&page=NaN&pageSize=21&itemId=%00"), defaults);
  const oversized = new URLSearchParams({ productLine: "x".repeat(65), q: "x".repeat(201), category: "x".repeat(129), itemId: "x".repeat(129) });
  assert.deepEqual(parse(oversized), defaults);
});

test("中文型号、目标、筛选、分页和所选 BOM 行往返后保持一致", () => {
  const original = { productLine: "通用", targetSets: 350, q: "齿轮 A08/4", category: "五金 / 传动", status: "gap", page: 3, pageSize: 50, itemId: "bom:Q5-A08-001" };
  const path = build(original);
  assert.equal(returnPath(asState(path)), path);
  assert.deepEqual(parse(path.slice(path.indexOf("?"))), original);
  assert.equal(new URL(path, "https://app.example").pathname, "/proc-inventory-readiness");
  const defaultPath = build(parse(""));
  assert.equal(defaultPath, "/proc-inventory-readiness?productLine=Q5&targetSets=100");
  assert.equal(returnPath(asState(defaultPath)), defaultPath);
});

test("恢复旧目标链接仍截断并钳制数值，页大小只接受现有三个选项", () => {
  for (const [raw, expected] of [["0", 0], ["-1", 0], ["12.9", 12], ["1000001", 1_000_000], ["Infinity", 100], ["", 100]]) {
    assert.equal(parse(`targetSets=${raw}`).targetSets, expected);
  }
  assert.equal(parse("page=-5").page, 1);
  assert.equal(parse("page=9999999999").page, 1_000_000);
  for (const pageSize of [20, 50, 100]) assert.equal(parse(`pageSize=${pageSize}`).pageSize, pageSize);
  for (const pageSize of [0, -1, 10, 25, 200, "NaN"]) assert.equal(parse(`pageSize=${pageSize}`).pageSize, 20);
});

test("物料库仅接收显式来源字段，拒绝外链、其他路径及路由伪装", () => {
  for (const state of [null, undefined, false, [], "text", {}, { from: "/proc-inventory-readiness" }, { inventoryReadinessReturnTo: 3 }]) assert.equal(returnPath(state), null);
  for (const path of [
    "https://evil.test/proc-inventory-readiness", "http://localhost:5173/proc-inventory-readiness", "//evil.test/proc-inventory-readiness",
    "javascript:alert(1)", "/proc-materials", "/proc-inventory-readiness-other", "/proc-inventory-readiness/", "/proc-inventory-readiness/../admin",
    "/x/../proc-inventory-readiness", "/%70roc-inventory-readiness", "/proc-inventory-readiness%3fq=x", "/proc-inventory-readiness#outside",
    "/\\evil.test/proc-inventory-readiness", " /proc-inventory-readiness", "/proc-inventory-readiness ",
  ]) assert.equal(returnPath(asState(path)), null, path);
  assert.equal(returnPath(asState("/proc-inventory-readiness")), "/proc-inventory-readiness");
});

test("返回查询拒绝含糊、越界及损坏内容，普通外观像 URL 的搜索词仍只是搜索", () => {
  for (const query of [
    "next=https://evil.test", "q=a&q=b", "targetSets=-1", "targetSets=1.5", "targetSets=1000001", "targetSets=NaN", "targetSets=",
    "targetSets=0x20", "targetSets=1e2", "page=0", "page=-1", "page=1.1", "page=1000001", "pageSize=25", "status=bad",
    "q=%00", "q=%0A", "q=%7F", "q=%5Cevil", "q=%ZZ", "q=%E0%A4%A", "q=\n", "q=\\bad", "q= leading", "q=trailing+",
    `q=${"x".repeat(201)}`, `productLine=${"x".repeat(65)}`, `category=${"x".repeat(129)}`, `itemId=${"x".repeat(129)}`,
  ]) assert.equal(returnPath(asState(`/proc-inventory-readiness?${query}`)), null, query);
  const searchUrl = "/proc-inventory-readiness?q=https%3A%2F%2Fexample.com%2Fpart&targetSets=0&status=data_missing&pageSize=100";
  assert.equal(returnPath(asState(searchUrl)), searchUrl);
});

test("自定义齐套路由生效时，构建和返回校验一致，不接受旧路由", () => {
  const configured = helpers("/supply/readiness");
  const path = configured.buildInventoryReadinessPath(parse("page=2&itemId=A08-001"));
  assert.ok(path.startsWith("/supply/readiness?"));
  assert.equal(configured.inventoryReadinessReturnPath(asState(path)), path);
  assert.equal(configured.inventoryReadinessReturnPath(asState("/proc-inventory-readiness")), null);
});

// Evaluate the actual page and its event handlers with inert data/component dependencies.
// This verifies permission visibility, navigation options and existing material-code effects.
const materialCode = transpile(readFileSync(new URL("../src/app/procurement/MaterialWorkbenchPage.tsx", import.meta.url), "utf8"), true);
function renderWorkbench({ state, permission = true, materials = [], search = "", navigate } = {}) {
  const calls = [];
  const effects = [];
  const updates = [];
  let stateIndex = 0;
  const emptyFilters = { keyword: "" };
  const componentExports = new Proxy({}, { get: (_, key) => key });
  const exports = {};
  new Function("exports", "require", materialCode)(exports, (dependency) => {
    if (dependency === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
    if (dependency === "react") return {
      useEffect: (fn) => effects.push(fn), useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
      useState: (initial) => { const index = stateIndex++; return [initial, (value) => updates.push({ index, value: typeof value === "function" ? value(initial) : value })]; },
    };
    if (dependency === "react-router") return { useLocation: () => ({ state }), useNavigate: () => (...args) => { calls.push(args); return navigate?.(...args); }, useSearchParams: () => [new URLSearchParams(search)] };
    if (dependency === "../lib/i18n") return { useI18n: () => ({ t: (value) => value }) };
    if (dependency === "../lib/inventoryReadinessNavigation") return { inventoryReadinessReturnPath: returnPath };
    if (dependency === "./data") return { useProcurementData: () => ({ materials, tasks: [], loading: true, error: "" }) };
    if (dependency === "./components/common") return { ...componentExports, StatCell: "StatCell", useProcCan: () => (code) => permission && code === "page:proc-inventory-readiness" };
    if (dependency === "./components/MaterialTable") return { MaterialTable: "MaterialTable", EMPTY_MATERIAL_FILTERS: emptyFilters };
    if (dependency === "./procurementLogic") return { countProcurementMaterialShortages: () => 0 };
    return componentExports;
  });
  return { tree: exports.MaterialWorkbenchPage(), calls, effects, updates };
}
function allElements(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(allElements);
  return [root, ...allElements(root.props?.children)];
}
const returnButton = (tree) => allElements(tree).find((node) => node.type === "Button" && node.props.children.includes?.("返回齐套中心"));

test("物料库返回按钮遵守页面权限，实际点击采用已校验上下文且替换当前历史项", () => {
  const path = build(parse("productLine=Q7&targetSets=300&q=A08&page=2&itemId=row-8"));
  const rendered = renderWorkbench({ state: asState(path) });
  const button = returnButton(rendered.tree);
  assert.ok(button, "Valid inventory source exposes a return button");
  button.props.onClick();
  assert.deepEqual(rendered.calls, [[path, { replace: true }]]);
  for (const options of [{ state: asState(path), permission: false }, { state: asState("//evil.test") }, { state: {} }, {}]) {
    assert.equal(returnButton(renderWorkbench(options).tree), undefined);
  }
  for (const marker of [false, undefined, "true", 1]) {
    const unmarked = renderWorkbench({ state: { ...asState(path), inventoryReadinessHistoryBack: marker } });
    returnButton(unmarked.tree).props.onClick();
    assert.deepEqual(unmarked.calls, [[path, { replace: true }]], `Non-boolean handoff marker ${marker} cannot use history back`);
  }
  assert.equal(returnButton(renderWorkbench({ state: { ...asState("//evil.test"), inventoryReadinessHistoryBack: true } }).tree), undefined);
});

test("齐套中心直接下钻物料库后返回使用原历史项，随后后退可回到上一页面", async () => {
  const path = build(parse("productLine=Q5&targetSets=300&page=2&itemId=row-8"));
  const router = createMemoryRouter([{ path: "*", element: null }], { initialEntries: ["/home", "/proc-inventory-readiness"] });
  try {
    await router.navigate(path, { replace: true });
    const originalKey = router.state.location.key;
    await router.navigate("/proc-materials?materialCode=A08-001", { state: { ...asState(path), inventoryReadinessHistoryBack: true } });
    const rendered = renderWorkbench({ state: router.state.location.state, navigate: (...args) => router.navigate(...args) });
    await returnButton(rendered.tree).props.onClick();
    assert.deepEqual(rendered.calls, [[-1]]);
    assert.equal(router.state.location.key, originalKey, "Return reuses the original inventory entry");
    assert.equal(router.state.location.pathname + router.state.location.search, path);
    await router.navigate(-1);
    assert.equal(router.state.location.pathname, "/home", "One more back leaves inventory, without a duplicate inventory entry");
  } finally {
    router.dispose();
  }
});

test("新增返回入口不影响物料编码筛选及自动打开对应物料详情", () => {
  const matched = { id: "material-8", tpInventoryCode: "A08-001", erpCode: "ERP-8" };
  for (const code of [matched.tpInventoryCode, matched.erpCode]) {
    const rendered = renderWorkbench({ state: asState(build(parse("itemId=bom-8"))), materials: [matched], search: `materialCode=${code}` });
    rendered.effects.forEach((effect) => effect());
    assert.ok(rendered.updates.some((update) => update.value?.keyword === code), "Material code continues to populate the filter");
    assert.ok(rendered.updates.some((update) => update.value === matched), "The exact matching material continues to open");
  }
});
