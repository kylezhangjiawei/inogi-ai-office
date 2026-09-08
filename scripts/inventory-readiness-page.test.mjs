import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/procurement/InventoryReadinessPage.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const packagingCode = ts.transpileModule(readFileSync(new URL("../src/app/procurement/components/Q5PackagingInventory.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const explanationCode = ts.transpileModule(readFileSync(new URL("../src/app/procurement/components/InventoryMatchExplanation.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function response(productLine = "Q5", items = []) {
  return {
    productLine,
    models: [{ id: "Q5", label: "Q5", bomLines: items.length }, { id: "通用", label: "通用", bomLines: 148 }],
    items,
    summary: { targetSets: 100, currentBuildableSets: 0, withTransitBuildableSets: 0, targetGapAfterTransit: 100, warningMaterials: 0, inTransitMaterials: 0, bottleneckMaterials: 0 },
    dataQuality: { totalBomLines: items.length, usableBomLines: items.length, invalidBomLines: 0, inventoryMatchedLines: 0, bomCompleteness: 1, provisional: items.length > 0 },
    warehouse: { matchedNames: [] },
  };
}

function item(id, status, sourceCount = 1) {
  return {
    id, code: id, name: id, category: "板件", unit: "个", status,
    issue: status === "unmatched" ? "missing_inventory" : undefined,
    qtyPer: 1, targetDemand: 100, gapAfterTransit: 100, currentSets: 0, withTransitSets: 0,
    stock: 0, available: 0, inTransit: 0, safeStock: 0,
    syncedAt: status === "unmatched" ? null : "2026-09-08T02:00:00Z",
    sourceLines: Array.from({ length: sourceCount }, (_, index) => ({ id: `${id}-${index}`, category: "板件" })),
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? tree).flatMap(elements)];
}

function pageText(tree) {
  if (Array.isArray(tree)) return tree.map(pageText).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? Object.values(tree.props ?? tree).map(pageText).join(" ") : "";
}

// Execute the real page and its load callback, preserving state across renders.
// Effects are not scheduled here: tests control when each request resolves.
function pageFixture(query = "") {
  const slots = [];
  const requests = [];
  let slot = 0;
  let tree;
  let load;
  let reply = ({ productLine }) => response(productLine);
  const t = (text, params = {}) => text.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
  const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
  const viewComponents = new Proxy({}, { get: (_target, name) => name });
  const dependencies = {
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
      useCallback: (callback) => { load = callback; return callback; },
      useMemo: (factory) => factory(),
      useEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-router": { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(query)] },
    "../lib/i18n": { useI18n: () => ({ t }), i18nLocale: () => "zh-CN" },
    "../hooks/usePermission": { usePermission: () => false },
    "../components/ui/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "../lib/routePaths": { routePath: (_permission, fallback) => fallback },
    "../lib/procurementApi": { getInventoryReadiness: async (params) => { requests.push(params); return reply(params); } },
    sonner: { toast: {} },
  };
  const exports = {};
  const requireFixture = (request) => {
    const name = request.replace(/^\.\.\/\.\.\//, "../");
    if (name in dependencies) return dependencies[name];
    assert.ok(name === "lucide-react" || name.startsWith("../components/") || name === "./components/common", `Unexpected dependency: ${name}`);
    return viewComponents;
  };
  const packagingExports = {};
  const explanationExports = {};
  new Function("exports", "require", explanationCode)(explanationExports, requireFixture);
  dependencies["./components/InventoryMatchExplanation"] = explanationExports;
  dependencies["./InventoryMatchExplanation"] = explanationExports;
  new Function("exports", "require", packagingCode)(packagingExports, requireFixture);
  dependencies["./components/Q5PackagingInventory"] = packagingExports;
  new Function("exports", "require", code)(exports, requireFixture);
  return {
    requests,
    setResponse(value) { reply = typeof value === "function" ? value : () => value; },
    render() { slot = 0; tree = exports.InventoryReadinessPage(); return tree; },
    async load() { await load(); return this.render(); },
    openItem(code) {
      const row = materialRows(tree).find((node) => tableCells(node)[1].includes(code));
      assert.ok(row, `Material row ${code} must be rendered`);
      row.props.onClick();
      return this.render();
    },
    closeItem() {
      const sheet = elements(tree).find((node) => node.type === "Sheet" && node.props.open);
      assert.ok(sheet, "Material detail must be open");
      sheet.props.onOpenChange(false);
      return this.render();
    },
    selectModel(value) {
      const selector = elements(tree).find((node) => node.type === "Select" && node.props.value === requests.at(-1)?.productLine);
      assert.ok(selector, "Product model selector must be rendered");
      selector.props.onValueChange(value);
      return this.render();
    },
    searchPackaging(value) {
      const input = elements(tree).find((node) => node.type === "Input" && node.props["aria-label"] === "搜索包材与随箱配件");
      assert.ok(input, "Packaging search must be rendered");
      input.props.onChange({ target: { value } });
      return this.render();
    },
  };
}

function packagingData() {
  const items = Array.from({ length: 37 }, (_, index) => ({
    id: `pack-${index + 1}`, sourceRow: index + 2, code: `P-${index + 1}`, name: `包材 ${index + 1}`, unit: "件",
    qtyPer: null, stock: null, available: null, inTransit: null, syncedAt: null,
    issue: "missing_qty", duplicateOfRow: null,
  }));
  Object.assign(items[0], { qtyPer: 1, stock: 0, available: 0, inTransit: 0, issue: null });
  Object.assign(items[17], { code: "E05-03", name: "数据线透明扎带", qtyPer: 1 });
  Object.assign(items[29], { code: "B04-055", name: "护角90*90", issue: "code_conflict" });
  Object.assign(items[30], { code: "B04-055", name: "护角60*60", issue: "code_conflict" });
  Object.assign(items[34], { code: "A07-053", name: "底部进气过滤棉（新）", qtyPer: 4 });
  Object.assign(items[36], { code: "E05-03", name: "数据线透明扎带", qtyPer: 1, duplicateOfRow: 19 });
  return { sourceFile: "包材盘点清单 - 副本.xlsx", sourceSheet: "Sheet1", items };
}

function packagingRows(tree) {
  return elements(tree).filter((node) => node.type === "TableRow" && node.props["data-source-row"] !== undefined);
}

function materialRows(tree) {
  return elements(tree).filter((node) => node.type === "TableRow" && node.props.tabIndex === 0 && typeof node.props.onClick === "function");
}

function tableCells(row) {
  return elements(row).filter((node) => node.type === "TableCell").map((node) => visibleText(node.props.children).trim());
}

function visibleText(tree) {
  if (Array.isArray(tree)) return tree.map(visibleText).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? visibleText(tree.props?.text ?? tree.props?.children) : "";
}

function openDetail(tree) {
  const sheet = elements(tree).find((node) => node.type === "Sheet" && node.props.open);
  assert.ok(sheet, "Material detail must be open");
  return sheet;
}

function detailQuantity(tree, label) {
  const entry = elements(tree).find((node) => node.type === "div" && [node.props.children].flat().some((child) => child?.type === "dt" && pageText(child.props.children) === label));
  assert.ok(entry, `Detail quantity ${label} must be rendered`);
  return pageText(elements(entry).find((node) => node.type === "dd").props.children).trim();
}

test("从侧栏进入和空型号参数均请求 Q5 单台装配清单", async () => {
  for (const query of ["", "productLine=", "productLine=%20%20"]) {
    const page = pageFixture(query);
    page.render();
    const tree = await page.load();
    assert.equal(page.requests[0].productLine, "Q5");
    assert.ok(pageText(tree).includes("Q5 单台装配清单尚未就绪"));
    assert.ok(pageText(tree).includes("《物料清单》的「原材料」工作表"));
  }
});

test("URL 明确型号和用户切换型号均保留原选择", async () => {
  const page = pageFixture("productLine=%E9%80%9A%E7%94%A8&targetSets=25");
  page.render();
  let tree = await page.load();
  assert.deepEqual(page.requests[0], { productLine: "通用", targetSets: 25 });
  assert.ok(pageText(tree).includes("尚未找到 通用 BOM"));
  assert.ok(pageText(tree).includes("Q5 · 整机装配"));
  page.selectModel("Q5");
  tree = await page.load();
  assert.deepEqual(page.requests[1], { productLine: "Q5", targetSets: 25 });
  assert.ok(pageText(tree).includes("Q5 单台装配清单尚未就绪"));
});

test("未匹配提示按合并后的物料计数，多个 BOM 来源只计一种物料", async () => {
  const page = pageFixture();
  const data = response("Q5", [item("A01-011", "unmatched", 2), item("A01-012", "ready"), item("A03-023", "unmatched")]);
  data.dataQuality = { ...data.dataQuality, totalBomLines: 4, usableBomLines: 4, inventoryMatchedLines: 1 };
  page.setResponse(data);
  page.render();
  const text = pageText(await page.load());
  assert.ok(text.includes("2 种物料未找到该编码在量产仓的库存记录。"));
  assert.ok(!text.includes("3 种物料未找到该编码在量产仓的库存记录。"));
  assert.ok(text.includes("量产仓记录待匹配"));
  assert.ok(text.includes("电路板按整板计入"));
});

test("响应返回其他型号时拒绝采用，不把 Q5 请求切到通用", async () => {
  const page = pageFixture();
  page.setResponse(response("通用"));
  page.render();
  const text = pageText(await page.load());
  assert.ok(text.includes("返回的 BOM 型号与所选型号不一致"));
  assert.ok(!text.includes("尚未找到 通用 BOM"));
  await page.load();
  assert.deepEqual(page.requests.map((request) => request.productLine), ["Q5", "Q5"]);
});

test("Q5 装配清单缺失时仍完整展开包材37行，保留原行顺序与重复来源", async () => {
  const page = pageFixture();
  page.setResponse({ ...response(), packaging: packagingData() });
  page.render();
  const tree = await page.load();
  assert.equal(packagingRows(tree).length, 37);
  assert.deepEqual(packagingRows(tree).map((row) => row.props["data-source-row"]), Array.from({ length: 37 }, (_, index) => index + 2));
  assert.ok(pageText(tree).includes("显示 37 / 37 行"));
  assert.ok(pageText(tree).includes("Q5 单台装配清单尚未就绪"));
  assert.ok(pageText(tree).includes("包材盘点清单 - 副本.xlsx"));
  assert.ok(pageText(packagingRows(tree).at(-1)).includes("原表重复：与第 19 行相同，未重复计入用量。"));
});

test("包材支持按货号和名称搜索，同货号不同尺寸保持两行可见", async () => {
  const page = pageFixture();
  page.setResponse({ ...response(), packaging: packagingData() });
  page.render();
  await page.load();
  let tree = page.searchPackaging(" b04-055 ");
  assert.equal(packagingRows(tree).length, 2);
  assert.ok(pageText(tree).includes("护角90*90"));
  assert.ok(pageText(tree).includes("护角60*60"));
  assert.ok(pageText(tree).includes("货号待核对"));
  assert.ok(pageText(tree).includes("显示 2 / 37 行"));
  tree = page.searchPackaging("透明扎带");
  assert.equal(packagingRows(tree).length, 2);
  tree = page.searchPackaging("不存在的配件");
  assert.equal(packagingRows(tree).length, 0);
  assert.ok(pageText(tree).includes("没有匹配的包材或随箱配件"));
});

test("包材未知库存显示破折号、真实零显示0，用量和库存缺失同时说明且冲突不显示数值", async () => {
  const page = pageFixture();
  const packaging = packagingData();
  Object.assign(packaging.items[29], { qtyPer: 2, stock: 200, available: 100, inTransit: 20 });
  page.setResponse({ ...response(), packaging });
  page.render();
  const rows = packagingRows(await page.load());
  const cells = (row) => elements(row).filter((node) => node.type === "TableCell").map((node) => pageText(node.props.children).trim());
  assert.deepEqual(cells(rows[0]).slice(3, 6), ["0", "0", "0"]);
  assert.deepEqual(cells(rows[1]).slice(3, 6), ["—", "—", "—"]);
  assert.ok(pageText(rows[1]).includes("装配用量待补充"));
  assert.ok(pageText(rows[1]).includes("量产仓记录待匹配"));
  assert.deepEqual(cells(rows[29]).slice(2, 6), ["—", "—", "—", "—"]);
});

test("包材不改变装配明细与指标口径，其他型号不显示Q5包材", async () => {
  const page = pageFixture();
  const data = { ...response("Q5", [item("A01-011", "ready")]), packaging: packagingData() };
  data.dataQuality.provisional = false;
  page.setResponse(data);
  page.render();
  const text = pageText(await page.load());
  assert.ok(text.includes("当前装配物料可齐套"));
  assert.ok(text.includes("包材与随箱配件的配套数量待确认，见下方清单。"));
  assert.ok(text.includes("包材表未填写配套数量；装配用量按同编码引用，仅供参考。"));
  assert.equal(data.items.length, 1);
  assert.equal(data.dataQuality.totalBomLines, 1);
  const other = pageFixture("productLine=Q6");
  other.setResponse({ ...response("Q6"), packaging: packagingData() });
  other.render();
  assert.equal(packagingRows(await other.load()).length, 0);
});

const diagnosticCases = [
  {
    reason: "material_missing", label: "物料档案待匹配",
    description: "物料库未找到此编码的物料档案，量产仓也没有对应库存记录。",
    nextStep: "请核对 BOM 物料编码，并检查 T+ 物料档案同步。",
  },
  {
    reason: "no_inventory_records", label: "尚无库存记录",
    description: "物料档案已找到，系统尚未取得该编码的任何仓库库存记录。",
    nextStep: "请检查 T+ 库存同步及仓库记录；当前不能据此确认实际库存为 0。",
  },
  {
    reason: "other_warehouses_only", label: "仅其他仓有记录",
    description: "仅在以下仓库找到该编码的库存记录：研发仓、来料暂存仓。量产仓暂无对应记录。",
    nextStep: "齐套仅核算量产仓。请核对仓库归属及量产仓库存同步，其他仓的数量不计入当前齐套结果。",
  },
  {
    reason: undefined, label: "量产仓记录待匹配",
    description: "未找到该编码在量产仓的库存记录，暂不能确认具体原因。",
    nextStep: "请核对物料档案、库存同步及仓库归属；这不代表物料库没有该物料，也不能据此认定库存为 0。",
  },
];

for (const diagnostic of diagnosticCases) {
  test(`${diagnostic.reason ?? "旧响应无诊断"} 的原因在列表直接可见，点击详情展示下一步且未知库存不显示0`, async () => {
    const page = pageFixture();
    const material = item("A01-DIAGNOSTIC", "unmatched");
    if (diagnostic.reason) material.inventoryDiagnostic = { reason: diagnostic.reason, otherWarehouses: diagnostic.reason === "other_warehouses_only" ? ["研发仓", "来料暂存仓"] : [] };
    page.setResponse(response("Q5", [material]));
    page.render();
    const tree = await page.load();
    const row = materialRows(tree)[0];
    assert.equal(tableCells(row)[0], diagnostic.label);
    assert.ok(pageText(row).includes(diagnostic.description));
    assert.ok(!pageText(row).includes(diagnostic.nextStep), "主列表简洁展示原因，具体操作留在详情");
    assert.deepEqual(tableCells(row).slice(3, 9), Array(6).fill("—"), "库存、在途、可齐套与缺口均未知");
    const detail = openDetail(page.openItem(material.code));
    assert.ok(pageText(detail).includes(diagnostic.label));
    assert.ok(pageText(detail).includes(diagnostic.description));
    assert.ok(pageText(detail).includes(diagnostic.nextStep));
    for (const label of ["量产仓库现存量", "量产仓库可用量", "确认在途"]) {
      assert.match(detailQuantity(detail, label), /^—\s+个$/);
    }
    assert.ok(!elements(page.closeItem()).some((node) => node.type === "Sheet" && node.props.open));
  });
}

test("已经匹配量产仓的真实零库存仍显示0，并显示实际缺货状态", async () => {
  const page = pageFixture();
  const material = item("A01-ZERO", "shortage");
  const data = response("Q5", [material]);
  data.dataQuality.inventoryMatchedLines = 1;
  data.dataQuality.provisional = false;
  page.setResponse(data);
  page.render();
  const row = materialRows(await page.load())[0];
  assert.equal(tableCells(row)[0], "当前缺货");
  assert.deepEqual(tableCells(row).slice(3, 8), ["0", "0", "0", "0", "0"]);
  assert.equal(tableCells(row)[8], "100", "匹配成功时真实缺口仍显示");
  assert.ok(!pageText(row).includes("待匹配"));
  const detail = openDetail(page.openItem(material.code));
  for (const label of ["量产仓库现存量", "量产仓库可用量", "确认在途"]) {
    assert.match(detailQuantity(detail, label), /^0\s+个$/);
  }
  assert.ok(!pageText(detail).includes("暂不能确认具体原因"));
});

test("包材同时显示缺用量与三类库存原因，具体仓库名称和下一步不丢失", async () => {
  const page = pageFixture();
  const packaging = packagingData();
  diagnosticCases.forEach((diagnostic, index) => {
    const material = packaging.items[index + 1];
    if (diagnostic.reason) material.inventoryDiagnostic = { reason: diagnostic.reason, otherWarehouses: diagnostic.reason === "other_warehouses_only" ? ["研发仓", "来料暂存仓"] : [] };
  });
  // 原始货号存在冲突时，不能把候选仓库或用量误作已核实数据。
  packaging.items[29].inventoryDiagnostic = { reason: "other_warehouses_only", otherWarehouses: ["冲突货号候选仓"] };
  page.setResponse({ ...response(), packaging });
  page.render();
  const rows = packagingRows(await page.load());
  diagnosticCases.forEach((diagnostic, index) => {
    const row = rows[index + 1];
    assert.ok(pageText(row).includes("装配用量待补充"));
    assert.ok(pageText(row).includes(diagnostic.label));
    assert.ok(pageText(row).includes(diagnostic.description));
    assert.ok(pageText(row).includes(diagnostic.nextStep));
    assert.deepEqual(tableCells(row).slice(3, 6), ["—", "—", "—"]);
  });
  assert.ok(!pageText(rows[29]).includes("冲突货号候选仓"));
  assert.ok(pageText(rows[29]).includes("货号待核对"));
  assert.deepEqual(tableCells(rows[0]).slice(3, 6), ["0", "0", "0"]);
  assert.ok(!pageText(rows[0]).includes("暂无对应记录"));
});

test("缺单机用量且未取得库存的BOM行同时解释两类问题，未知数量不会显示为0", async () => {
  for (const qtyPer of [null, 0]) {
    const page = pageFixture();
    const material = {
      ...item("A01-MISSING-QTY", "data_missing"), qtyPer, issue: "missing_qty", syncedAt: null,
      targetDemand: 0, gapAfterTransit: 0,
      inventoryDiagnostic: { reason: "no_inventory_records", otherWarehouses: [] },
    };
    const data = response("Q5", [material]);
    data.dataQuality = { ...data.dataQuality, usableBomLines: 0, invalidBomLines: 1, bomCompleteness: 0 };
    page.setResponse(data);
    page.render();
    const row = materialRows(await page.load())[0];
    assert.equal(tableCells(row)[0], "BOM 待完善");
    assert.equal(tableCells(row)[2], "—");
    assert.ok(visibleText(row).includes("物料档案已找到，系统尚未取得该编码的任何仓库库存记录。"));
    assert.deepEqual(tableCells(row).slice(3, 9), Array(6).fill("—"));
    const detail = openDetail(page.openItem(material.code));
    assert.ok(visibleText(detail).includes("该 BOM 行单机用量为空或为 0，暂不参与齐套计算。"));
    assert.ok(visibleText(detail).includes("物料档案已找到，系统尚未取得该编码的任何仓库库存记录。"));
    assert.ok(visibleText(detail).includes("请检查 T+ 库存同步及仓库记录；当前不能据此确认实际库存为 0。"));
    for (const label of ["量产仓库现存量", "量产仓库可用量", "确认在途"]) {
      assert.match(detailQuantity(detail, label), /^—\s+个$/);
    }
    const contribution = elements(detail).find((node) => node.type === "section" && visibleText(node).includes("齐套贡献"));
    assert.ok(contribution);
    assert.match(visibleText(contribution), /当前可齐套\s+—\s+到货后可齐套\s+—\s+目标缺口\s+—/);
  }
});

test("数据未核实完整时顶部差额明确标估算，完整数据保留已确认缺口文案", async () => {
  for (const provisional of [true, false]) {
    const page = pageFixture();
    const data = response("Q5", [item("A01-RAIL", provisional ? "unmatched" : "shortage")]);
    data.dataQuality.provisional = provisional;
    data.dataQuality.inventoryMatchedLines = provisional ? 0 : 1;
    page.setResponse(data);
    page.render();
    const tree = await page.load();
    const rail = elements(tree).find((node) => node.type === "section" && elements(node).some((child) => child.props?.["aria-label"] === "齐套进度"));
    assert.ok(rail, "顶部齐套概览必须显示");
    const text = visibleText(rail);
    if (provisional) {
      assert.match(text, /目标差额（估算）\s+100\s+套/);
      assert.ok(text.includes("数据尚未核实完整，齐套与目标差额仅为估算，不能直接作为采购数量。"));
      assert.ok(!text.includes("仍缺"), "未核实数据不能呈现为已确认缺口");
    } else {
      assert.match(text, /仍缺\s+100\s+套/);
      assert.ok(!text.includes("目标差额（估算）"));
      assert.ok(!text.includes("数据尚未核实完整"));
    }
  }
});
