import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function primaryTableHeader(page, label) {
  const header = page.match(
    /<TableHeader className="sticky[\s\S]*?<\/TableHeader>/,
  )?.[0];
  assert.ok(header, `${label}应保留置顶的主数据表头`);
  return header;
}

function assertColumnOrder(header, columns, label) {
  let previousIndex = -1;
  for (const column of columns) {
    const index = header.indexOf(column);
    assert.ok(index >= 0, `${label}应包含“${column}”列`);
    assert.ok(index > previousIndex, `${label}应优先按 ${columns.join(" → ")} 排列`);
    previousIndex = index;
  }
}

const entry = source("src/app/order-processing/index.ts");
const horizon = source("src/app/order-processing/horizon.css");
const workbench = source("src/app/order-processing/pages/Workbench.tsx");
const purchaseOrders = source("src/app/order-processing/pages/PurchaseOrders.tsx");
const inventory = source("src/app/order-processing/pages/Inventory.tsx");
const purchaseOrderDetail = source(
  "src/app/order-processing/pages/PurchaseOrderDetail.tsx",
);

test("订单与库存四个页面统一挂载 Horizon 作用域", () => {
  for (const [name, page] of [
    ["订货处理工作台", workbench],
    ["采购订单", purchaseOrders],
    ["库存管理", inventory],
    ["采购订单详情", purchaseOrderDetail],
  ]) {
    assert.match(
      page,
      /<div className="order-horizon(?:\s|\")/,
      `${name}应挂载 order-horizon 页面作用域`,
    );
  }
});

test("订单模块入口集中加载共享 Horizon 样式并导出四个页面", () => {
  assert.match(entry, /import ["']\.\/horizon\.css["'];/);
  assert.match(entry, /export \{ Workbench as OrderWorkbenchPage \}/);
  assert.match(entry, /export \{ PurchaseOrders as PurchaseOrdersPage \}/);
  assert.match(entry, /export \{ Inventory as InventoryManagementPage \}/);
  assert.match(entry, /export \{ PurchaseOrderDetail as PurchaseOrderDetailPage \}/);
  assert.match(horizon, /\.order-horizon,\s*\n\.order-horizon-overlay\s*\{/);
  assert.match(horizon, /--order-primary:\s*#002fa7;/i);
});

test("订货处理工作台移除超宽、渐变和全属性过渡遗留", () => {
  assert.doesNotMatch(workbench, /min-w-\[1536px\]/);
  assert.doesNotMatch(
    workbench,
    /bg-gradient|linear-gradient|radial-gradient/,
  );
  assert.doesNotMatch(workbench, /transition-all/);
  assert.match(workbench, /order-horizon-workbench-layout/);
});

test("订单模块活跃页面与发票弹层清除旧品牌样式残留", () => {
  for (const [name, page] of [
    ["订货处理工作台", workbench],
    ["采购订单", purchaseOrders],
    ["库存管理", inventory],
  ]) {
    assert.doesNotMatch(
      page,
      /(?:indigo|violet|purple|fuchsia|pink)-|\bdark:|\btracking-|hover:-translate/,
      `${name}不应残留旧紫色品牌、暗色、字距或悬浮位移样式`,
    );
  }

  assert.match(workbench, /bg-\[#eef3ff\]/i);
  assert.match(workbench, /text-\[#002fa7\]/i);
  assert.match(workbench, /border-\[#c8d6ff\]/i);
  assert.match(workbench, /text-pretty/);
  assert.match(workbench, /tabular-nums/);
});

test("采购订单与库存筛选提供关键可访问名称", () => {
  assert.match(purchaseOrders, /aria-label=\{t\('搜索采购订单'\)\}/);
  assert.match(purchaseOrders, /aria-label=\{t\('下单开始日期'\)\}/);
  assert.match(purchaseOrders, /aria-label=\{t\('下单结束日期'\)\}/);
  assert.match(inventory, /aria-label=\{t\('搜索库存'\)\}/);
});

test("采购订单与库存主表将识别和决策列放在前面", () => {
  const purchaseHeader = primaryTableHeader(purchaseOrders, "采购订单主表");
  assertColumnOrder(
    purchaseHeader,
    ["采购单号", "供应商", "状态", "采购员", "下单日期", "预计到货"],
    "采购订单主表",
  );
  assert.match(purchaseHeader, /order-horizon-sticky-action[\s\S]*?操作/);

  const inventoryHeader = primaryTableHeader(inventory, "库存主表");
  assertColumnOrder(
    inventoryHeader,
    ["存货编码", "存货名称 / 规格", "现存量", "可用量", "状态"],
    "库存主表",
  );
  assert.match(inventoryHeader, /order-horizon-sticky-action[\s\S]*?操作/);
});

test("工作台采用标准弹层语义并提供可访问标题与关闭名称", () => {
  assert.match(workbench, /function WorkbenchDialogSurface\(/);
  assert.match(workbench, /<Dialog[\s\S]*?<DialogContent/);
  assert.match(workbench, /<DialogTitle className="sr-only">\{title\}<\/DialogTitle>/);
  assert.match(workbench, /<DialogDescription className="sr-only">\{description\}<\/DialogDescription>/);
  assert.doesNotMatch(workbench, /role="presentation"/);

  for (const closeLabel of [
    "关闭 AI 模板窗口",
    "关闭发票生成窗口",
    "关闭订货单识别结果窗口",
    "关闭发票预览窗口",
  ]) {
    assert.match(
      workbench,
      new RegExp(`aria-label=\\{t\\('${closeLabel}'\\)\\}`),
      `${closeLabel}应可由辅助技术识别`,
    );
  }

  assert.match(inventory, /<DialogContent className="order-horizon-overlay/);
  assert.match(inventory, /<DialogTitle className="text-balance">/);
  assert.match(inventory, /<DialogDescription className="text-pretty">/);
});

test("工作台标准弹层负责焦点管理并保护进行中的异步操作", () => {
  assert.doesNotMatch(workbench, /modalRef/);
  assert.match(workbench, /onCloseAutoFocus=/);
  assert.match(workbench, /target\.focus\(\)/);
  assert.match(workbench, /if \(!nextOpen && !busy\) onClose\(\)/);
  assert.match(workbench, /if \(busy\) event\.preventDefault\(\)/);
  assert.match(workbench, /busy=\{aiPhase === 'generating'\}/);
  assert.match(workbench, /busy=\{invoiceSubmitting\}/);
  assert.match(workbench, /busy=\{invoiceExporting\}/);
  assert.match(
    workbench,
    /activeModal === 'invoiceDraft' && invoiceSubmitting/,
    "发票提交期间应阻止 Escape 和遮罩误关",
  );
});

test("发票模板、AI 生成、保存、预览与导出业务契约保持完整", () => {
  assert.match(workbench, /selectableTemplates\.map\(\(template\) =>/);
  assert.match(workbench, /orderProcessingApi\.generateAiTemplate\(files\)/);
  assert.match(workbench, /const saveAiTemplate = \(\) =>/);
  assert.match(workbench, /orderProcessingApi\.generateInvoice\(orderId,/);
  assert.match(workbench, /orderProcessingApi\.exportInvoice\(orderId\)/);
  assert.match(workbench, /invoicePreviewTemplate\.startsWith\('ai-'\)/);
  assert.match(workbench, /onClick=\{\(\) => void handleConfirmGenerateInvoice\(\)\}/);
});
