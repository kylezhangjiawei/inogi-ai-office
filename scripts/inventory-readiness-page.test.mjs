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
function pageFixture(query = "", permissions = []) {
  const slots = [];
  const requests = [];
  const writes = [];
  const navigations = [];
  let slot = 0;
  let tree;
  let load;
  let reply = ({ productLine }) => response(productLine);
  let writeReply = async () => ({});
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
      useLayoutEffect() {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-router": { useNavigate: () => (destination) => navigations.push(destination), useSearchParams: () => [new URLSearchParams(query)] },
    "../lib/i18n": { useI18n: () => ({ t }), i18nLocale: () => "zh-CN" },
    "../hooks/usePermission": { usePermission: (permission) => permissions.includes(permission) },
    "../components/ui/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "../lib/routePaths": { routePath: (_permission, fallback) => fallback },
    "../lib/procurementApi": {
      getInventoryReadiness: async (params) => { requests.push(params); return reply(params); },
      saveInventoryBomLine: async (input, id) => { const request = { action: id ? "update" : "create", id, input }; writes.push(request); return writeReply(request); },
      deleteInventoryBomLine: async (id, baseUpdatedAt) => { const request = { action: "delete", id, baseUpdatedAt }; writes.push(request); return writeReply(request); },
    },
    sonner: { toast: { success() {} } },
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
    writes,
    navigations,
    setResponse(value) { reply = typeof value === "function" ? value : () => value; },
    setWriteReply(value) { writeReply = value; },
    render() { slot = 0; tree = exports.InventoryReadinessPage(); return tree; },
    async load() { await load(); return this.render(); },
    clickButton(label) {
      const button = elements(tree).find((node) => node.type === "Button" && (node.props["aria-label"] === label || visibleText(node).trim() === label));
      assert.ok(button, `Button ${label} must be rendered`);
      assert.equal(Boolean(button.props.disabled), false, `Button ${label} must be enabled`);
      button.props.onClick();
      return this.render();
    },
    setEditorField(label, value) {
      const field = elements(tree).find((node) => ["Input", "Textarea", "select"].includes(node.type) && node.props["aria-label"] === label);
      assert.ok(field, `Editor field ${label} must be rendered`);
      assert.ok(!field.props.readOnly && !field.props.disabled, `Editor field ${label} must be editable`);
      field.props.onChange({ target: { value } });
      return this.render();
    },
    async submitEditor() {
      const form = elements(tree).find((node) => node.type === "form");
      assert.ok(form, "BOM editor form must be rendered");
      await form.props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
      return this.render();
    },
    openItem(code) {
      const row = materialRows(tree).find((node) => tableCells(node)[1].includes(code));
      assert.ok(row, `Material row ${code} must be rendered`);
      row.props.onClick({ currentTarget: null });
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

const stockPlanPermissions = ["page:proc-cockpit", "proc-task:create"];

function planButton(tree, type = "整机") {
  return elements(tree).find((node) => node.type === "Button" && visibleText(node).trim() === `建立${type}备货计划`);
}

function planDestination(page) {
  assert.equal(page.navigations.length, 1, "只能打开一次备货计划表单");
  const destination = new URL(page.navigations[0], "http://fixture.local");
  assert.equal(destination.pathname, "/proc-cockpit");
  assert.equal(destination.searchParams.get("tab"), "stock-plans");
  assert.equal(destination.searchParams.get("newPlan"), "1");
  return destination.searchParams;
}

test("BOM及库存待核实仍能先建整机总计划，带入总目标与待核实条数而非估算缺口", async () => {
  const page = pageFixture("", stockPlanPermissions);
  const materials = Array.from({ length: 6 }, (_, index) => item(`A01-UNMATCHED-${index}`, "unmatched", index === 0 ? 2 : 1));
  materials.push({ ...item("A01-MISSING-QTY", "data_missing"), qtyPer: null, issue: "missing_qty", syncedAt: null });
  const data = response("Q5", materials);
  data.dataQuality = { ...data.dataQuality, totalBomLines: 136, usableBomLines: 131, invalidBomLines: 5, inventoryMatchedLines: 125 };
  data.summary = { ...data.summary, currentBuildableSets: 20, withTransitBuildableSets: 40, targetGapAfterTransit: 60 };
  page.setResponse(data);
  page.render();
  const button = planButton(await page.load());
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  const params = planDestination(page);
  assert.equal(params.get("planType"), "machine");
  assert.equal(params.get("productLine"), "Q5");
  assert.equal(params.get("targetQty"), "100");
  assert.equal(params.has("materialCode"), false);
  const note = params.get("note");
  assert.match(note, /5\s*条\s*BOM/);
  assert.match(note, /6\s*(种物料|项库存)/);
  assert.match(note, /待核实|待完善/);
  assert.match(note, /先.*计划/);
  assert.match(note, /生成采购任务/);
  assert.ok(!note.includes("仍缺 60"), "估算差额不能写成已确认采购缺口");
});

test("库存已覆盖目标且行写入时间缺失时仍可登记整机总需求计划", async () => {
  const page = pageFixture("", stockPlanPermissions);
  const material = { ...item("A01-COVERED", "ready"), stock: 200, available: 200, currentSets: 200, withTransitSets: 200, gapAfterTransit: 0, syncedAt: null };
  const data = response("Q5", [material]);
  data.summary = { ...data.summary, currentBuildableSets: 200, withTransitBuildableSets: 200, targetGapAfterTransit: 0 };
  data.dataQuality = { ...data.dataQuality, provisional: false, inventoryMatchedLines: 1 };
  page.setResponse(data);
  page.render();
  const tree = await page.load();
  const button = planButton(tree);
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  assert.ok(!visibleText(tree).includes("无需新增缺口备货计划"));
  button.props.onClick();
  assert.equal(planDestination(page).get("targetQty"), "100");
});

test("目标为0、BOM缺失或尚未读到当前结果时不能打开整机计划", async () => {
  const zero = pageFixture("targetSets=0", stockPlanPermissions);
  const data = response("Q5", [item("A01-ZERO-TARGET", "shortage")]);
  data.summary.targetSets = 0;
  data.summary.targetGapAfterTransit = 0;
  zero.setResponse(data);
  zero.render();
  const button = planButton(await zero.load());
  assert.ok(button);
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(zero.navigations.length, 0, "事件处理器也必须拒绝零目标");

  const missing = pageFixture("", stockPlanPermissions);
  assert.equal(planButton(missing.render()), undefined);
  assert.equal(planButton(await missing.load()), undefined);
  assert.equal(missing.navigations.length, 0);

  const mismatchedTarget = pageFixture("targetSets=25", stockPlanPermissions);
  mismatchedTarget.setResponse(response("Q5", [item("A01-STALE-TARGET", "shortage")]));
  mismatchedTarget.render();
  const staleButton = planButton(await mismatchedTarget.load());
  assert.equal(staleButton.props.disabled, true);
  staleButton.props.onClick();
  assert.equal(mismatchedTarget.navigations.length, 0, "不能用100套响应创建25套请求的计划");
});

test("重新读取期间和读取失败后，保留的旧数据不能打开整机计划", async () => {
  const page = pageFixture("", stockPlanPermissions);
  page.setResponse(response("Q5", [item("A01-OLD-RESULT", "shortage")]));
  page.render();
  assert.equal(planButton(await page.load()).props.disabled, false);
  let failRequest;
  page.setResponse(() => new Promise((_resolve, reject) => { failRequest = reject; }));
  const request = page.load();
  const pending = planButton(page.render());
  assert.equal(pending.props.disabled, true);
  pending.props.onClick();
  assert.equal(page.navigations.length, 0);
  failRequest(new Error("库存接口暂不可用"));
  const tree = await request;
  const failed = planButton(tree);
  assert.equal(failed.props.disabled, true);
  failed.props.onClick();
  assert.equal(page.navigations.length, 0);
  assert.ok(visibleText(tree).includes("库存接口暂不可用"));
});

test("整机与物料建计划仍同时要求驾驶舱读取及采购创建权限", async () => {
  for (const permissions of [[], ["page:proc-cockpit"], ["proc-task:create"]]) {
    const page = pageFixture("", permissions);
    const material = item("A01-RESTRICTED", "shortage");
    page.setResponse(response("Q5", [material]));
    page.render();
    assert.equal(planButton(await page.load()), undefined);
    assert.equal(planButton(page.openItem(material.code), "物料"), undefined);
    assert.equal(page.navigations.length, 0);
  }
});

test("整机入口放行不放宽单物料库存核实要求，已核实物料继续按总需求建计划", async () => {
  const cases = [
    { ...item("A01-UNKNOWN", "unmatched") },
    { ...item("A01-NO-QTY", "data_missing"), qtyPer: null, issue: "missing_qty" },
    { ...item("A01-NO-CODE", "data_missing"), code: null, issue: "missing_code" },
    { ...item("A01-NO-TIME", "shortage"), syncedAt: null },
    { ...item("A01-COVERED", "ready"), gapAfterTransit: 0 },
  ];
  for (const material of cases) {
    const page = pageFixture("", stockPlanPermissions);
    page.setResponse(response("Q5", [material]));
    page.render();
    assert.equal(planButton(await page.load()).props.disabled, false);
    const button = planButton(page.openItem(material.code ?? material.name), "物料");
    assert.ok(button);
    assert.equal(button.props.disabled, true, `${material.id}不能作为已核实缺口建单`);
    button.props.onClick();
    assert.equal(page.navigations.length, 0);
  }
  const page = pageFixture("", stockPlanPermissions);
  const verified = { ...item("A01-VERIFIED", "gap"), stock: 65, available: 60, inTransit: 15, gapAfterTransit: 25 };
  page.setResponse(response("Q5", [verified]));
  page.render();
  await page.load();
  const button = planButton(page.openItem(verified.code), "物料");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  const params = planDestination(page);
  assert.equal(params.get("planType"), "material");
  assert.equal(params.get("materialCode"), verified.code);
  assert.equal(params.get("targetQty"), "100");
  assert.ok(params.get("note").includes("当前缺口 25"));
});

test("较早库存记录跨BOM和包材按编码去重，列出名称与写入时间并排除无效日期", async () => {
  const timestamp = Date.now();
  const ago = (hours) => new Date(timestamp - hours * 60 * 60 * 1000).toISOString();
  const format = (value) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(Date.parse(value));
  const packaging = packagingData();
  Object.assign(packaging.items[0], { code: "OLD-SHARED", name: "共享编码包材来源", syncedAt: ago(72) });
  Object.assign(packaging.items[1], { code: "OLD-PACKAGING", name: "较早记录的包材", syncedAt: ago(48) });
  Object.assign(packaging.items[2], { code: "OLD-SHARED", name: "重复包材来源", syncedAt: ago(60) });
  Object.assign(packaging.items[3], { code: "INVALID-PACKAGING", syncedAt: "not-a-date" });
  const data = response("Q5", [
    { ...item("OLD-SHARED", "shortage"), name: "共享编码装配来源", syncedAt: ago(36) },
    { ...item("RECENT-BOM", "shortage"), syncedAt: ago(1) },
    { ...item("INVALID-BOM", "shortage"), syncedAt: "not-a-date" },
    item("UNMATCHED-BOM", "unmatched"),
  ]);
  Object.assign(data, { packaging, syncedAt: ago(1) });
  const page = pageFixture();
  page.setResponse(data);
  page.render();
  const tree = await page.load();
  const details = elements(tree).find((node) => node.type === "details" && visibleText(node).includes("较早库存记录"));
  assert.ok(details, "旧记录应能通过原生可展开明细查看");
  const summary = elements(details).find((node) => node.type === "summary");
  assert.equal(visibleText(summary).trim(), "查看 2 种物料的较早库存记录");
  const rows = elements(details).filter((node) => node.type === "li");
  assert.equal(rows.length, 2);
  assert.ok(visibleText(rows[0]).includes("OLD-SHARED"));
  assert.ok(visibleText(rows[0]).includes("共享编码包材来源"));
  assert.ok(visibleText(rows[0]).includes(format(ago(72))), "同码取最早写入记录供核查");
  assert.ok(visibleText(rows[1]).includes("OLD-PACKAGING"));
  assert.ok(visibleText(rows[1]).includes("较早记录的包材"));
  assert.ok(visibleText(rows[1]).includes(format(ago(48))));
  assert.ok(rows.every((row) => visibleText(row).includes("记录写入")));
  for (const excluded of ["RECENT-BOM", "INVALID-BOM", "INVALID-PACKAGING", "UNMATCHED-BOM", "重复包材来源"]) {
    assert.ok(!visibleText(details).includes(excluded), `${excluded}不应被列为独立旧库存记录`);
  }
  assert.ok(visibleText(tree).includes("这是库存行的写入时间，不是整个 T+ 同步任务的执行时间。"));
  assert.ok(visibleText(tree).includes("不等于每日同步任务失败"));
});

test("零条有效库存记录不再断言同步失败，近期有效记录不触发较早记录警告", async () => {
  for (const hasRecentRecord of [false, true]) {
    const page = pageFixture("", stockPlanPermissions);
    const material = { ...item("A01-INVENTORY-TIME", hasRecentRecord ? "shortage" : "unmatched"), syncedAt: hasRecentRecord ? new Date(Date.now() - 60 * 60 * 1000).toISOString() : null };
    const data = response("Q5", [material]);
    page.setResponse(data);
    page.render();
    const tree = await page.load();
    const text = visibleText(tree);
    assert.ok(!elements(tree).some((node) => node.type === "details" && visibleText(node).includes("较早库存记录")));
    assert.ok(!text.includes("部分记录超过 24 小时"));
    assert.ok(!text.includes("尚无有效库存同步记录，请先同步 ERP 数据"));
    assert.equal(text.includes("不能据此判断同步任务是否失败"), !hasRecentRecord);
    assert.equal(planButton(tree).props.disabled, false, "记录写入时间不足不拦截登记总计划");
  }
});

function bomSource(id, overrides = {}) {
  return { id, name: "模拟装配件", code: "TEST-ONLY-01", qtyPer: 1, remark: "模拟规格",
    parentId: "assembly-parent", category: "分子筛装配组", bomPosition: "分子筛装配组",
    updatedAt: "2026-09-08T02:00:00.000Z", unit: "件", ...overrides };
}

function bomMaterial(line, overrides = {}) {
  return { ...item(line.code || line.id, !line.code || line.qtyPer === null ? "data_missing" : "unmatched"),
    id: line.id, name: line.name, code: line.code, qtyPer: line.qtyPer, category: line.category,
    issue: !line.code ? "missing_code" : line.qtyPer === null ? "missing_qty" : "inventory_unmatched",
    sourceLines: [line], ...overrides };
}

const bomPermissions = ["material:import", ...stockPlanPermissions];
const editorField = (tree, label) => elements(tree).find((node) => ["Input", "Textarea", "select"].includes(node.type) && node.props["aria-label"] === label);

test("Q5缺编码和缺用量行提供编辑，禁止新增删除；其他型号和无权限不开放", async () => {
  const lines = [bomSource("missing-code", {code:null}), bomSource("missing-qty", {qtyPer:null})];
  for (const [model, permissions, expected] of [["Q5", bomPermissions, true], ["Q5", [], false], ["Q6", bomPermissions, false]]) {
    const page = pageFixture(`productLine=${model}`, permissions);
    page.setResponse(response(model, lines.map(line => bomMaterial(line))));
    page.render();
    const tree = await page.load();
    const buttons = elements(tree).filter(node => node.type === "Button");
    assert.equal(buttons.filter(node => node.props["aria-label"]?.startsWith("编辑物料 ")).length, expected ? 2 : 0);
    assert.ok(!buttons.some(node => node.props["aria-label"]?.startsWith("删除物料 ") || visibleText(node).trim() === "新增物料"));
    if (expected) assert.equal(planButton(tree).props.disabled, false, "Q5编辑入口不回退整机总计划放行");
  }
});

test("Q5缺码可编辑并按当前源行版本保存，不提交父级或型号，成功重算原型号缺口", async () => {
  const page = pageFixture("", bomPermissions);
  const line = bomSource("q5-no-code", { code:null, name:"编码待核实组件" });
  page.setResponse(response("Q5", [bomMaterial(line)]));
  page.render(); await page.load();
  let tree = page.clickButton(`编辑物料 ${line.name}`);
  assert.ok(visibleText(tree).includes("编辑 Q5 装配物料"));
  assert.equal(editorField(tree, "物料编码").props.value, "");
  for (const label of ["物料分类", "BOM 所属位置"]) {
    assert.equal(editorField(tree, label).props.readOnly, true);
    assert.equal(editorField(tree, label).props.value, "分子筛装配组");
  }
  assert.ok(visibleText(tree).includes("物料分类沿用 Q5 清单中当前装配组"));
  assert.ok(!visibleText(tree).includes("物料分类按编码从物料库带出"));
  page.setEditorField("物料编码", " TEST-ONLY-02 ");
  page.setEditorField("物料名称", " 已核实的模拟组件 ");
  page.setEditorField("备注", " 模拟尺寸说明 ");
  const updated = bomMaterial({...line, code:"TEST-ONLY-02", name:"已核实的模拟组件"}, {status:"gap",issue:null,gapAfterTransit:60});
  page.setResponse(response("Q5", [updated]));
  tree = await page.submitEditor();
  assert.deepEqual(page.writes, [{action:"update",id:line.id,input:{name:"已核实的模拟组件",code:"TEST-ONLY-02",qtyPer:1,remark:"模拟尺寸说明",baseUpdatedAt:line.updatedAt}}]);
  assert.deepEqual(page.requests, [{productLine:"Q5",targetSets:100},{productLine:"Q5",targetSets:100}]);
  assert.equal(elements(tree).filter(node => node.type === "Dialog" && node.props.open).length, 0);
  assert.equal(tableCells(materialRows(tree)[0])[8], "60");
  assert.equal(planButton(tree).props.disabled, false);
});

test("Q5缺用量必须补有效值，保存失败保留草稿，重试仍使用源行版本", async () => {
  const page = pageFixture("", bomPermissions);
  const line = bomSource("q5-no-qty", {qtyPer:null});
  page.setResponse(response("Q5", [bomMaterial(line)]));
  page.render(); await page.load();
  let tree = page.clickButton(`编辑物料 ${line.code}`);
  assert.equal(editorField(tree, "单机用量").props.value, "");
  for (const invalid of ["", "0", "-1", "1.00001"]) {
    page.setEditorField("单机用量", invalid);
    tree = await page.submitEditor();
    assert.ok(visibleText(tree).includes("请填写物料名称、编码和大于 0 的单机用量"));
    assert.equal(page.writes.length, 0);
  }
  page.setEditorField("单机用量", "2.5");
  page.setWriteReply(async () => { throw new Error("模拟版本冲突，请重试"); });
  tree = await page.submitEditor();
  assert.ok(visibleText(tree).includes("模拟版本冲突，请重试"));
  assert.equal(editorField(tree, "单机用量").props.value, "2.5");
  page.setWriteReply(async () => ({}));
  await page.submitEditor();
  assert.equal(page.writes.length, 2);
  assert.deepEqual(page.writes[1], page.writes[0]);
  assert.equal(page.writes[0].input.qtyPer, 2.5);
  assert.ok(!("parentId" in page.writes[0].input));
});

test("Q5同编码多个BOM来源必须选具体行，修改的不是聚合总用量", async () => {
  const page = pageFixture("", bomPermissions);
  const first = bomSource("first-source");
  const second = bomSource("second-source", {qtyPer:2,parentId:"case-parent",category:"外壳装配组",bomPosition:"外壳装配组",updatedAt:"2026-09-08T03:00:00.000Z"});
  page.setResponse(response("Q5", [bomMaterial(first,{qtyPer:3,sourceLines:[first,second]})]));
  page.render(); await page.load();
  let tree = page.clickButton(`编辑物料 ${first.code}`);
  assert.equal(elements(tree).find(node=>node.type==="Button"&&node.props.type==="submit").props.disabled,true);
  tree = page.setEditorField("物料来源", second.id);
  assert.equal(editorField(tree,"单机用量").props.value,"2");
  assert.equal(editorField(tree,"物料分类").props.value,"外壳装配组");
  assert.equal(editorField(tree,"BOM 所属位置").props.value,"外壳装配组");
  page.setEditorField("单机用量","4");
  await page.submitEditor();
  assert.equal(page.writes[0].id,second.id);
  assert.equal(page.writes[0].input.qtyPer,4);
  assert.equal(page.writes[0].input.baseUpdatedAt,second.updatedAt);
});

test("通用物料仍支持新增编辑删除和位置选择，保存携带父级", async () => {
  for (const action of ["create","update","delete"]) {
    const page = pageFixture("productLine=通用", bomPermissions);
    const line = bomSource("common-source");
    page.setResponse({...response("通用",[bomMaterial(line)]),bomPositions:[{id:"new-parent",name:"模拟位置"}]});
    page.render(); await page.load();
    let tree = page.clickButton(action === "create" ? "新增物料" : `${action === "delete" ? "删除" : "编辑"}物料 ${line.code}`);
    assert.ok(visibleText(tree).includes(action === "create" ? "新增通用物料" : action === "delete" ? "删除通用物料" : "编辑通用物料"));
    if(action !== "delete") {
      assert.equal(editorField(tree,"BOM 所属位置").type,"select");
      assert.ok(visibleText(tree).includes("物料分类按编码从物料库带出"));
      page.setEditorField("物料名称","模拟通用组件");
      page.setEditorField("物料编码","COMMON-TEST-ONLY");
      page.setEditorField("单机用量","3");
      page.setEditorField("BOM 所属位置","new-parent");
    }
    await page.submitEditor();
    assert.equal(page.writes[0].action,action);
    if(action !== "delete") assert.equal(page.writes[0].input.parentId,"new-parent");
    else assert.deepEqual(page.writes[0],{action:"delete",id:line.id,baseUpdatedAt:line.updatedAt});
    assert.equal(page.requests.at(-1).productLine,"通用");
  }
});

test("Q5明确完整齐套覆盖所有必需组件，待核实仅展示估算标签", async () => {
  for(const provisional of [true,false]) {
    const page=pageFixture();
    const data=response("Q5",[item("SIMULATED-ITEM","ready")]);
    data.dataQuality.provisional=provisional;
    page.setResponse(data); page.render();
    const text=visibleText(await page.load());
    assert.ok(text.includes("完整齐套须满足清单内全部必需零部件、包材和随箱配件"));
    assert.equal(text.includes("当前装配物料可齐套（估算）"),provisional);
    assert.equal(text.includes("到货后（估算）"),provisional);
    if(!provisional) assert.ok(text.includes("在途到齐后"));
  }
});

test("刷新采用当前目标草稿且等待对应结果，非法目标保留行内错误并不建旧目标计划", async () => {
  const page = pageFixture("", stockPlanPermissions);
  page.setResponse(response("Q5", [item("DRAFT-TARGET", "shortage")]));
  page.render();
  let tree = await page.load();
  const targetInput = () => elements(tree).find((node) => node.type === "Input" && node.props["aria-label"] === "目标套数");
  targetInput().props.onChange({ target: { value: "25" } });
  tree = page.render();
  assert.ok(planButton(tree).props.disabled, "尚未提交的新目标不能沿用100套的结果");
  let finish;
  page.setResponse(() => new Promise((resolve) => { finish = resolve; }));
  tree = page.clickButton("刷新");
  assert.deepEqual(page.requests.at(-1), { productLine: "Q5", targetSets: 25 });
  assert.ok(planButton(tree).props.disabled);
  const next = response("Q5", [item("DRAFT-TARGET", "shortage")]);
  next.summary.targetSets = 25;
  finish(next);
  await new Promise((resolve) => setImmediate(resolve));
  tree = page.render();
  assert.equal(planButton(tree).props.disabled, false);
  for (const invalid of ["2.5", "", "-1", "1000001"]) {
    targetInput().props.onChange({ target: { value: invalid } });
    tree = page.render();
    const count = page.requests.length;
    tree = page.clickButton("刷新");
    assert.equal(page.requests.length, count);
    assert.equal(targetInput().props["aria-invalid"], true);
    assert.ok(visibleText(tree).includes("请输入 0 到 1,000,000 之间的整数套数"));
    assert.ok(planButton(tree).props.disabled);
  }
  assert.deepEqual(page.navigations, []);
});

test("行键盘打开明细后关闭回到原行，子按钮按键不冒泡开明细，清除筛选恢复物料", async () => {
  const page = pageFixture();
  page.setResponse(response("Q5", [item("ROW-A", "shortage"), item("ROW-B", "ready")]));
  page.render();
  let tree = await page.load();
  const row = materialRows(tree)[0];
  let focused = 0;
  let prevented = 0;
  const opener = { isConnected: true, focus() { focused++; } };
  row.props.onKeyDown({ target: {}, currentTarget: opener, key: "Enter", preventDefault() { prevented++; } });
  tree = page.render();
  assert.equal(elements(tree).some((node) => node.type === "Sheet" && node.props.open), false);
  row.props.onKeyDown({ target: opener, currentTarget: opener, key: "Enter", preventDefault() { prevented++; } });
  tree = page.render();
  const sheet = elements(tree).find((node) => node.type === "Sheet" && node.props.open);
  assert.ok(sheet);
  const content = elements(sheet).find((node) => node.type === "SheetContent");
  sheet.props.onOpenChange(false);
  tree = page.render();
  content.props.onCloseAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(focused, 1);
  assert.equal(prevented, 2);
  const search = elements(tree).find((node) => node.type === "Input" && node.props["aria-label"] === "搜索物料齐套明细");
  search.props.onChange({ target: { value: "ROW-B" } });
  tree = page.render();
  assert.equal(materialRows(tree).length, 1);
  assert.ok(visibleText(materialRows(tree)[0]).includes("ROW-B"));
  const clear = elements(tree).find((node) => node.type === "button" && visibleText(node).trim() === "清除筛选");
  clear.props.onClick();
  tree = page.render();
  assert.equal(materialRows(tree).length, 2);
});

function q5UnitFixture() {
  const slots=[], effects=[], timers=new Map(), lookups=[];
  let slot=0, timerId=0, tree;
  const t=(text,params={})=>text.replace(/\{(\w+)\}/g,(match,key)=>params[key]??match);
  const jsx=(type,props)=>({type,props});
  const react={
    useState(initial){const index=slot++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==="function"?value(slots[index]):value;}];},
    useRef(initial){const index=slot++;return slots[index]??={current:initial};},
    useEffect(callback,deps){const index=slot++,previous=slots[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i])){previous?.cleanup?.();const record={deps,cleanup:null};slots[index]=record;effects.push(()=>{record.cleanup=callback();});}},
  };
  const dependencies={react,"react/jsx-runtime":{jsx,jsxs:jsx},"../lib/i18n":{useI18n:()=>({t})},
    "../lib/procurementApi":{getInventoryMaterialReference:(code,signal)=>new Promise((resolve,reject)=>lookups.push({code,signal,resolve,reject}))}};
  const exports={};
  new Function("exports","require","setTimeout","clearTimeout",`${code}\nexports.Editor=InventoryBomEditor;`)(exports,name=>dependencies[name]??new Proxy({},{get:(_target,key)=>key}),
    callback=>{const id=++timerId;timers.set(id,callback);return id;},id=>timers.delete(id));
  const props={productLine:"Q5",editor:{mode:"edit",lines:[bomSource("unit-source",{unit:"不应显示的旧单位"})]},positions:[],onClose(){},onSaved(){}};
  const render=()=>{slot=0;tree=exports.Editor(props);while(effects.length)effects.shift()();slot=0;tree=exports.Editor(props);return tree;};
  return {lookups,render,
    change(value){editorField(tree,"物料编码").props.onChange({target:{value}});return render();},
    flush(){for(const [id,callback] of [...timers]){timers.delete(id);callback();}return render();},
    async resolve(index,value){lookups[index].resolve(value);await Promise.resolve();await Promise.resolve();return render();},
  };
}

test("Q5用量旁展示当前编码单位，改码立即隐藏旧单位并忽略迟到查询，分类仍为装配组", async () => {
  const fixture=q5UnitFixture();
  let tree=fixture.render();
  assert.ok(visibleText(tree).includes("正在读取当前编码的计量单位"));
  assert.ok(!visibleText(tree).includes("不应显示的旧单位"));
  fixture.flush();
  tree=await fixture.resolve(0,{matched:true,category:"ERP主档分类",unit:"kg"});
  assert.ok(visibleText(tree).includes("当前编码单位：kg；请填写每台用量。"));
  assert.equal(editorField(tree,"物料分类").props.value,"分子筛装配组");
  tree=fixture.change("SECOND-TEST-CODE");
  assert.ok(!visibleText(tree).includes("当前编码单位：kg"));
  fixture.flush();
  fixture.change("THIRD-TEST-CODE");fixture.flush();
  assert.equal(fixture.lookups[1].signal.aborted,true);
  tree=await fixture.resolve(2,{matched:true,category:"新主档分类",unit:"g"});
  assert.ok(visibleText(tree).includes("当前编码单位：g"));
  tree=await fixture.resolve(1,{matched:true,category:"迟到分类",unit:"吨"});
  assert.ok(visibleText(tree).includes("当前编码单位：g"));
  assert.ok(!visibleText(tree).includes("当前编码单位：吨"));
  tree=fixture.change("");
  assert.ok(visibleText(tree).includes("输入物料编码后核对计量单位"));
  assert.ok(!visibleText(tree).includes("当前编码单位：g"));
});

test("Q5未匹配编码不将接口兜底的件当成已确认单位", async () => {
  const fixture=q5UnitFixture();fixture.render();fixture.flush();
  const tree=await fixture.resolve(0,{matched:false,category:"未分类",unit:"件"});
  assert.ok(visibleText(tree).includes("当前编码的计量单位待核对"));
  assert.ok(!visibleText(tree).includes("当前编码单位：件"));
  assert.equal(editorField(tree,"物料分类").props.value,"分子筛装配组");
});
