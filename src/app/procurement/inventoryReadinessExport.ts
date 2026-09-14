import type { InventoryReadinessItem, InventoryReadinessResponse } from "../lib/procurementApi";
import type { WorkBook } from "xlsx";

type CellValue = string | number;
export interface InventoryReadinessExportRow {
  物料编码: string;
  物料名称: string;
  分类: string;
  BOM位置: string;
  规格: string;
  单位: string;
  单机用量: CellValue;
  目标需求: CellValue;
  量产仓现存: CellValue;
  量产仓可用: CellValue;
  全部在途: CellValue;
  当前缺口: CellValue;
  在途到齐后缺口: CellValue;
  库存源写入时间: string;
  待核实原因: string;
}

const UNKNOWN = "—";
const COLUMNS: Array<keyof InventoryReadinessExportRow> = [
  "物料编码", "物料名称", "分类", "BOM位置", "规格", "单位", "单机用量", "目标需求",
  "量产仓现存", "量产仓可用", "全部在途", "当前缺口", "在途到齐后缺口", "库存源写入时间", "待核实原因",
];
const NUMBER_COLUMNS = new Set<keyof InventoryReadinessExportRow>([
  "单机用量", "目标需求", "量产仓现存", "量产仓可用", "全部在途", "当前缺口", "在途到齐后缺口",
]);

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}
function quantity(value: unknown): CellValue {
  return isQuantity(value) ? Number(value.toFixed(4)) : UNKNOWN;
}
function text(value?: string | null): string {
  return value?.trim() || UNKNOWN;
}
function diagnosticReason(item: InventoryReadinessItem): string {
  if (item.inventoryDiagnostic?.reason === "material_missing") return "T+ 物料主档未匹配";
  if (item.inventoryDiagnostic?.reason === "other_warehouses_only") return "仅其他仓库有库存记录，量产仓待匹配";
  return "量产仓库存记录待匹配";
}

/** 使用已加载型号的完整 items。页面的搜索、排序和分页均不参与导出范围。 */
export function buildInventoryReadinessExportRows(data: InventoryReadinessResponse): {
  shortageRows: InventoryReadinessExportRow[];
  unverifiedRows: InventoryReadinessExportRow[];
} {
  const shortageRows: InventoryReadinessExportRow[] = [];
  const unverifiedRows: InventoryReadinessExportRow[] = [];
  const targetValid = isQuantity(data.summary.targetSets) && Number.isInteger(data.summary.targetSets);
  for (const item of data.items) {
    const reasons: string[] = [];
    const codeValid = Boolean(item.code?.trim());
    const qtyValid = isQuantity(item.qtyPer) && item.qtyPer > 0;
    const bomInvalid = !codeValid || !qtyValid || item.status === "data_missing"
      || item.issue === "missing_code" || item.issue === "missing_qty";
    if (!codeValid || item.issue === "missing_code") reasons.push("物料编码待补充");
    if (!qtyValid || item.issue === "missing_qty") reasons.push("单机用量待核实");
    if (item.status === "data_missing" && !reasons.length) reasons.push("BOM 数据待完善");
    if (!targetValid) reasons.push("目标套数待核实");
    const unmatched = item.status === "unmatched" || item.issue === "inventory_unmatched" || Boolean(item.inventoryDiagnostic);
    if (unmatched) reasons.push(diagnosticReason(item));
    const synced = isTimestamp(item.syncedAt);
    if (!synced && !bomInvalid && !unmatched) reasons.push("库存源写入时间待核实");
    const inventoryUnknown = bomInvalid || unmatched || !synced;
    const targetUnknown = bomInvalid || !targetValid;
    for (const [label, value] of [["目标需求", item.targetDemand], ["量产仓现存", item.stock], ["量产仓可用", item.available], ["全部在途", item.inTransit], ["在途到齐后缺口", item.gapAfterTransit]] as const) {
      if (!isQuantity(value)) reasons.push(`${label}数值待核实`);
    }
    // 新增未知 issue 时同样保守归入待核实，避免接口扩展后将异常误当正常。
    if (item.issue && !["missing_code", "missing_qty", "inventory_unmatched"].includes(item.issue)) reasons.push("数据状态待核实");
    const unverified = reasons.length > 0;
    const currentGap = !unverified ? quantity(Math.max(0, item.targetDemand - item.available)) : UNKNOWN;
    const row: InventoryReadinessExportRow = {
      物料编码: text(item.code), 物料名称: text(item.name), 分类: text(item.category), BOM位置: text(item.bomPosition),
      规格: text(item.spec), 单位: text(item.unit), 单机用量: qtyValid ? quantity(item.qtyPer) : UNKNOWN,
      目标需求: targetUnknown ? UNKNOWN : quantity(item.targetDemand),
      量产仓现存: inventoryUnknown ? UNKNOWN : quantity(item.stock),
      量产仓可用: inventoryUnknown ? UNKNOWN : quantity(item.available),
      全部在途: inventoryUnknown ? UNKNOWN : quantity(item.inTransit),
      当前缺口: currentGap,
      在途到齐后缺口: unverified ? UNKNOWN : quantity(item.gapAfterTransit),
      库存源写入时间: synced ? item.syncedAt! : UNKNOWN,
      待核实原因: [...new Set(reasons)].join("；"),
    };
    if (unverified) unverifiedRows.push(row);
    else if (typeof currentGap === "number" && currentGap > 0) shortageRows.push(row);
  }
  return { shortageRows, unverifiedRows };
}

function safeFilenamePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/\s+/g, " ").replace(/[. ]+$/g, "").slice(0, 70) || "未指定型号";
}
function exportDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function xlsx() {
  const mod = await import("xlsx");
  return ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
}

/** 独立构建工作簿，供导出和读回校验复用；这里不触发浏览器下载。 */
export async function createInventoryReadinessWorkbook(data: InventoryReadinessResponse, exportedAt = new Date()): Promise<{
  workbook: WorkBook;
  filename: string;
  shortageCount: number;
  unverifiedCount: number;
}> {
  const XLSX = await xlsx();
  const { shortageRows, unverifiedRows } = buildInventoryReadinessExportRows(data);
  const workbook = XLSX.utils.book_new();
  const addRows = (name: string, rows: InventoryReadinessExportRow[]) => {
    // 使用显式字符串单元格保留 SKU 前导零与 = 开头的文本，绝不生成公式。
    const cells = [COLUMNS, ...rows.map((row) => COLUMNS.map((column) => row[column]))];
    const sheet = XLSX.utils.aoa_to_sheet(cells);
    sheet["!cols"] = [18, 28, 16, 28, 24, 8, 12, 14, 14, 14, 14, 14, 18, 26, 48].map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: `A1:O${Math.max(1, rows.length + 1)}` };
    for (let row = 1; row <= rows.length; row++) {
      COLUMNS.forEach((column, col) => {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address];
        if (!cell) return;
        if (NUMBER_COLUMNS.has(column) && typeof cell.v === "number") cell.z = "#,##0.####";
        else if (typeof cell.v === "string") { cell.t = "s"; delete cell.f; }
      });
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  addRows("当前缺料", shortageRows);
  addRows("待核实物料", unverifiedRows);
  const modelLabel = data.models.find((model) => model.id === data.productLine)?.label || data.productLine;
  const notes: Array<[string, CellValue]> = [
    ["核算型号", text(modelLabel)], ["型号编码", text(data.productLine)],
    ["目标套数", quantity(data.summary.targetSets)], ["导出时间", exportedAt.toISOString()],
    ["库存范围", text(data.warehouse.label)], ["匹配的量产仓", data.warehouse.matchedNames.join("、") || "未匹配到量产仓记录"],
    ["库存源写入时间", isTimestamp(data.syncedAt) ? data.syncedAt : UNKNOWN],
    ["导出范围", "从当前已加载型号的全部 BOM 核算物料中导出当前缺料与待核实物料。不按页面搜索、筛选或分页缩小范围，仅使用当前账号已加载的数据。"],
    ["BOM 原始行数", quantity(data.dataQuality.totalBomLines)], ["核算物料数", data.items.length],
    ["当前缺料物料数", shortageRows.length], ["待核实物料数", unverifiedRows.length],
    ["当前缺口", "目标需求减量产仓可用数量，最低为 0。即使全部在途可覆盖，当前仍缺的物料也列入当前缺料。"],
    ["在途口径", "在途到齐后缺口沿用接口核算值，计入全部在途。全部在途并非按期到货承诺，也不等于检验后可用数量。"],
    ["数据待核实", "编码、单机用量、库存匹配、源写入时间或数值异常的物料单列。接口对未匹配和无效 BOM 的占位 0 代表未知，导出显示 —；有效真实零值保留 0。"],
    ["精度", "数量保留数值类型，显示最多 4 位小数。缺口按 4 位小数取值，避免浮点尾差形成虚假缺料。"],
    ["使用边界", "本表是库存缺料核算，不是新增采购建议；未预占公共库存，未做按需求日期、检验可用日和跨计划分配。"],
    ["包材", "包材参考表不导出，其配套数量尚未确认，不计入本次 BOM 缺料清单。"],
  ];
  if (!shortageRows.length) notes.push(["当前缺料结果", "当前已核实物料没有当前缺口；如存在待核实物料，仍需核对后才能判断整体齐套。"]);
  const explanation = XLSX.utils.aoa_to_sheet([["项目", "内容"], ...notes]);
  explanation["!cols"] = [{ wch: 24 }, { wch: 115 }];
  XLSX.utils.book_append_sheet(workbook, explanation, "核算说明");
  const target = isQuantity(data.summary.targetSets) && Number.isInteger(data.summary.targetSets) ? String(data.summary.targetSets) : "待核实";
  return {
    workbook, filename: `缺料清单_${safeFilenamePart(modelLabel)}_目标${target}套_${exportDate(exportedAt)}.xlsx`,
    shortageCount: shortageRows.length, unverifiedCount: unverifiedRows.length,
  };
}

/** 按调用者已加载的完整型号数据生成文件，不另读业务接口。 */
export async function exportInventoryReadinessXlsx(data: InventoryReadinessResponse): Promise<{ shortageCount: number; unverifiedCount: number }> {
  const result = await createInventoryReadinessWorkbook(data);
  const XLSX = await xlsx();
  XLSX.writeFile(result.workbook, result.filename);
  return { shortageCount: result.shortageCount, unverifiedCount: result.unverifiedCount };
}
