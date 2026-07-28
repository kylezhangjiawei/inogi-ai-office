// 供应商报价库 xlsx 导出 / 模板 / 导入解析。纯前端（动态 import xlsx），与 exportTasks 同模式。
// 扁平结构：一行 = 商品 × 厂家 × 一档起订量；同商品同厂家多行自动合并为一条阶梯报价。
import type { ImportSupplierQuoteItem, QuoteBookRow } from "../lib/procurementApi";

const HEADERS = ["型号/名称", "规格", "单位", "分类", "厂家", "厂家型号", "起订量", "单价", "币种", "含税", "交期天数", "报价日期", "有效期至", "备注"] as const;

async function loadXlsx() {
  const mod = await import("xlsx");
  return ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
}

const COLS = [{ wch: 28 }, { wch: 14 }, { wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 6 }, { wch: 5 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 20 }];

/** 导出当前视图（仅已有报价的商品），返回导出的行数。 */
export async function exportQuoteBookXlsx(rows: QuoteBookRow[]): Promise<number> {
  const flat: Record<string, string | number>[] = [];
  for (const row of rows) {
    for (const quote of row.quotes) {
      const tiers = quote.tiers.length > 0 ? quote.tiers : [{ minQty: 0, unitPrice: 0 }];
      for (const tier of tiers) {
        flat.push({
          "型号/名称": row.name,
          规格: row.spec,
          单位: row.unit,
          分类: row.category,
          厂家: quote.supplierName,
          厂家型号: quote.supplierModel,
          起订量: tier.minQty || "",
          单价: tier.unitPrice,
          币种: quote.currency,
          含税: quote.taxIncluded ? "是" : "否",
          交期天数: quote.leadTimeDays || "",
          报价日期: quote.quoteDate ?? "",
          有效期至: quote.validUntil ?? "",
          备注: quote.note ?? "",
        });
      }
    }
  }
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{ 提示: "当前筛选条件下没有厂家报价" }], flat.length ? { header: [...HEADERS] } : undefined);
  ws["!cols"] = COLS;
  XLSX.utils.book_append_sheet(wb, ws, "供应商报价");
  XLSX.writeFile(wb, `供应商报价库_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return flat.length;
}

/** 导入模板：表头 + 两行示例（同商品同厂家多行 = 阶梯档位）。 */
export async function downloadQuoteBookTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const example = [
    { "型号/名称": "预埋钢套（不锈钢）", 规格: "304", 单位: "件", 分类: "五金件", 厂家: "示例厂家A", 厂家型号: "", 起订量: 1000, 单价: 0.65, 币种: "CNY", 含税: "是", 交期天数: 7, 报价日期: "2026-07-01", 有效期至: "2026-12-31", 备注: "" },
    { "型号/名称": "预埋钢套（不锈钢）", 规格: "304", 单位: "件", 分类: "五金件", 厂家: "示例厂家A", 厂家型号: "", 起订量: 3000, 单价: 0.6, 币种: "CNY", 含税: "是", 交期天数: 7, 报价日期: "2026-07-01", 有效期至: "2026-12-31", 备注: "" },
    { "型号/名称": "预埋钢套（不锈钢）", 规格: "304", 单位: "件", 分类: "五金件", 厂家: "示例厂家B", 厂家型号: "", 起订量: "", 单价: 3.5, 币种: "CNY", 含税: "是", 交期天数: 10, 报价日期: "2026-07-01", 有效期至: "", 备注: "不含抛光费用" },
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(example, { header: [...HEADERS] });
  ws["!cols"] = COLS;
  XLSX.utils.book_append_sheet(wb, ws, "供应商报价");
  XLSX.writeFile(wb, "供应商报价导入模板.xlsx");
}

export interface ParsedImport {
  items: ImportSupplierQuoteItem[];
  /** 行级错误（行号为 xlsx 里的数据行号，从 2 开始） */
  errors: string[];
}

function fmtDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, "0"), d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value ?? "").trim();
  return s || undefined;
}

/** 解析导入文件：按（型号, 厂家）分组合并阶梯档，字段以组内首个非空为准。 */
export async function parseQuoteBookFile(file: File): Promise<ParsedImport> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { items: [], errors: ["文件里没有工作表"] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const errors: string[] = [];
  const groups = new Map<string, ImportSupplierQuoteItem>();
  raw.forEach((line, index) => {
    const rowNo = index + 2;
    const materialName = String(line["型号/名称"] ?? "").trim();
    const supplierName = String(line["厂家"] ?? "").trim();
    if (!materialName && !supplierName) return; // 整行空白跳过
    if (!materialName || !supplierName) { errors.push(`第 ${rowNo} 行：型号/名称与厂家为必填`); return; }
    const priceRaw = String(line["单价"] ?? "").trim();
    const unitPrice = Number(priceRaw);
    if (!priceRaw || !Number.isFinite(unitPrice) || unitPrice <= 0) { errors.push(`第 ${rowNo} 行：单价「${priceRaw}」必须是大于 0 的数字`); return; }
    const qtyRaw = String(line["起订量"] ?? "").trim().replace(/[kK]$/, "000");
    const minQty = qtyRaw && qtyRaw !== "不限" ? Number(qtyRaw) : 0;
    if (!Number.isFinite(minQty) || minQty < 0) { errors.push(`第 ${rowNo} 行：起订量「${String(line["起订量"])}」无法识别`); return; }
    const leadRaw = String(line["交期天数"] ?? "").trim();
    const leadTimeDays = leadRaw ? Math.round(Number(leadRaw)) : 0;
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) { errors.push(`第 ${rowNo} 行：交期天数「${leadRaw}」无法识别`); return; }
    const key = `${materialName}\u0000${supplierName}`;
    const str = (col: string) => String(line[col] ?? "").trim() || undefined;
    const existing = groups.get(key);
    if (existing) {
      existing.tiers.push({ minQty, unitPrice });
      existing.spec ??= str("规格"); existing.unit ??= str("单位"); existing.category ??= str("分类");
      existing.supplierModel ??= str("厂家型号"); existing.note ??= str("备注");
      existing.quoteDate ??= fmtDate(line["报价日期"]); existing.validUntil ??= fmtDate(line["有效期至"]);
    } else {
      groups.set(key, {
        materialName,
        supplierName,
        spec: str("规格"),
        unit: str("单位"),
        category: str("分类"),
        supplierModel: str("厂家型号"),
        currency: str("币种") ?? "CNY",
        taxIncluded: String(line["含税"] ?? "").trim() !== "否",
        leadTimeDays,
        tiers: [{ minQty, unitPrice }],
        quoteDate: fmtDate(line["报价日期"]),
        validUntil: fmtDate(line["有效期至"]),
        note: str("备注"),
      });
    }
  });
  return { items: Array.from(groups.values()), errors };
}
