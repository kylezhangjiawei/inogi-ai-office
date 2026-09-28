// 供应商报价库 xlsx 导出 / 模板 / 导入解析。纯前端（动态 import xlsx），与 exportTasks 同模式。
// 扁平结构：一行 = 商品 × 厂家 × 一档起订量；同商品同厂家多行自动合并为一条阶梯报价。
import type { ImportSupplierQuoteItem, QuoteBookRow, QuoteTier } from "../lib/procurementApi";

/** 与导入服务一致：同起订量后值覆盖，现行档位按数量排序。 */
export function normalizeQuoteImportTiers(tiers: QuoteTier[]): QuoteTier[] {
  const byQty = new Map(tiers.map((tier) => [tier.minQty, tier.unitPrice]));
  return Array.from(byQty, ([minQty, unitPrice]) => ({ minQty, unitPrice })).sort((a, b) => a.minQty - b.minQty);
}

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
  /** 行级错误：该行数据被跳过 */
  errors: string[];
  /** 行级提示：数据已导入但存在需要留意的情况（如多轮报价冲突） */
  warnings: string[];
  /** 与 items 下标对齐的商品图片（仅 .xlsx 嵌入图可提取；无图为 undefined） */
  images: (Blob | undefined)[];
}

/** 把工作簿各 sheet 序列化为 CSV 文本（AI 识别用），超长截断。 */
export async function fileToSheetText(file: File, maxChars = 60_000): Promise<string> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    parts.push(`### 工作表：${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  const text = parts.join("\n\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(已截断)` : text;
}

/**
 * 提取 .xlsx 嵌入图片：返回 sheetName → 图片锚定首行(0-based) → Blob。
 * 覆盖两种存储形态：标准 Excel 浮动图（drawing 锚定，exceljs 提取）与
 * WPS 单元格嵌入图（=DISPIMG 公式 + xl/cellimages.xml，jszip 手工解包）。
 * 旧版 .xls 非 zip 容器无法提取；任何失败静默返回空（图片是增强信息，不阻塞导入）。
 */
async function extractXlsxImages(file: File): Promise<Map<string, Map<number, Blob>>> {
  const result = new Map<string, Map<number, Blob>>();
  if (!/\.xlsx$/i.test(file.name)) return result;
  const buf = await file.arrayBuffer();

  // 形态一：标准 drawing 浮动图（Excel 常规插入图片）
  try {
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.slice(0));
    const media = (wb.model as unknown as { media?: Array<{ buffer: ArrayBuffer; extension: string }> }).media ?? [];
    wb.eachSheet((ws) => {
      const rowMap = new Map<number, Blob>();
      for (const img of ws.getImages()) {
        const idx = Number(img.imageId);
        const m = media[idx];
        if (!m?.buffer) continue;
        const row = Math.floor(Number(img.range?.tl?.nativeRow ?? -1));
        if (row < 0) continue;
        rowMap.set(row, new Blob([m.buffer], { type: `image/${m.extension || "png"}` }));
      }
      if (rowMap.size > 0) result.set(ws.name, rowMap);
    });
  } catch {
    // exceljs 解析失败：忽略此形态
  }

  // 形态二：WPS 单元格嵌入图（单元格公式 =DISPIMG("ID_xxx",1)，图片存 xl/cellimages.xml）
  try {
    const zipMod = await import("jszip");
    const JSZip = (zipMod as unknown as { default?: typeof import("jszip") }).default ?? zipMod;
    const zip = await (JSZip as typeof import("jszip")).loadAsync(buf.slice(0));
    const cellImagesXml = await zip.file("xl/cellimages.xml")?.async("string");
    if (cellImagesXml) {
      const relsXml = (await zip.file("xl/_rels/cellimages.xml.rels")?.async("string")) ?? "";
      const relMap = new Map<string, string>();
      for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        const target = m[2].replace(/^\//, "");
        relMap.set(m[1], target.startsWith("media/") ? `xl/${target}` : target);
      }
      // DISPIMG 的 name(ID_xxx) → media 路径
      const idToMedia = new Map<string, string>();
      for (const block of cellImagesXml.split(/<\/(?:etc:)?cellImage>/)) {
        const name = block.match(/name="(ID_[^"]+)"/)?.[1];
        const rid = block.match(/r:embed="([^"]+)"/)?.[1];
        const media = rid ? relMap.get(rid) : undefined;
        if (name && media) idToMedia.set(name, media);
      }
      if (idToMedia.size > 0) {
        const XLSX = await loadXlsx();
        const wb2 = XLSX.read(buf.slice(0), { cellFormula: true });
        for (const sheetName of wb2.SheetNames) {
          const sheet = wb2.Sheets[sheetName];
          if (!sheet) continue;
          const rowMap = result.get(sheetName) ?? new Map<number, Blob>();
          for (const addr of Object.keys(sheet)) {
            if (addr.startsWith("!")) continue;
            const c = sheet[addr] as { f?: string; v?: unknown };
            const text = `${c.f ?? ""} ${typeof c.v === "string" ? c.v : ""}`;
            const id = text.match(/DISPIMG\("([^"]+)"/)?.[1];
            if (!id) continue;
            const mediaPath = idToMedia.get(id);
            if (!mediaPath) continue;
            const data = await zip.file(mediaPath)?.async("arraybuffer");
            if (!data) continue;
            const row = XLSX.utils.decode_cell(addr).r;
            const ext = (mediaPath.split(".").pop() || "png").toLowerCase();
            if (!rowMap.has(row)) rowMap.set(row, new Blob([data], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
          }
          if (rowMap.size > 0) result.set(sheetName, rowMap);
        }
      }
    }
  } catch {
    // WPS 形态解析失败：忽略
  }
  return result;
}

function fmtDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, "0"), d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value ?? "").trim();
  return s || undefined;
}

// ── 智能解析：兼容标准模板与实际业务报价表（多段重复表头 / 列名别名 / 总计行 / 嵌入图片列）──

/** 列名别名（按序精确匹配优先，其次包含匹配）。业务表常见：供应商、产品名称、产品单价、产品含税价格。 */
const FIELD_ALIASES: Record<string, string[]> = {
  materialName: ["型号/名称", "产品名称", "物料名称", "商品名称", "型号", "名称"],
  supplierName: ["厂家", "供应商"],
  unitPrice: ["单价", "产品单价", "产品含税价格", "含税单价", "产品报价", "报价"],
  minQty: ["起订量", "最小起订量", "moq"],
  spec: ["规格"],
  unit: ["单位"],
  category: ["分类"],
  supplierModel: ["厂家型号", "品牌"],
  // 模具/注塑类信息列先于「含税」等泛化别名匹配，防止「模具含税价格」被 taxIncluded 抢占
  extraCavity: ["模穴数", "穴数"],
  extraSteel: ["模具钢材", "注塑材料"],
  extraMaterial: ["产品材料"],
  extraMoldPrice: ["模具含税价格", "模具报价", "模具价格"],
  currency: ["币种"],
  taxIncluded: ["含税"],
  leadTimeDays: ["交期天数", "交期"],
  quoteDate: ["报价日期"],
  validUntil: ["有效期至", "有效期"],
  note: ["备注"],
};

interface ColMapping {
  map: Map<string, number>;
  /** 未被选为现行单价、但表头含「报价/单价」的额外价格列（如「6.2报价」）→ 历史轮次 */
  extraPriceCols: Array<{ idx: number; label: string }>;
}

/** 表头行识别 + 列映射：每个字段取第一个命中的列（精确优先，包含匹配兜底）。 */
function buildColMap(cells: string[]): ColMapping | null {
  const norm = cells.map((c) => c.replace(/\s+/g, "").toLowerCase());
  const map = new Map<string, number>();
  const taken = new Set<number>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let hit = -1;
    for (const alias of aliases) {
      const a = alias.replace(/\s+/g, "").toLowerCase();
      hit = norm.findIndex((c, i) => !taken.has(i) && c === a);
      // 包含匹配兜底（如「6.2报价」→ 单价）；产品单价类禁止命中模具价列
      if (hit === -1) {
        hit = norm.findIndex(
          (c, i) => !taken.has(i) && c.includes(a) && c.length <= a.length + 6 && !(field === "unitPrice" && c.includes("模具")),
        );
      }
      if (hit !== -1) break;
    }
    if (hit !== -1) { map.set(field, hit); taken.add(hit); }
  }
  // 必须同时能定位「商品名」与「供应商」两列才算表头行
  if (!map.has("materialName") || !map.has("supplierName")) return null;
  // 额外价格列（如「6.2报价」）：含「报价/单价」但未被占用、且不是模具价
  const extraPriceCols: Array<{ idx: number; label: string }> = [];
  norm.forEach((c, i) => {
    if (taken.has(i) || !c) return;
    if ((c.includes("报价") || c.includes("单价")) && !c.includes("模具")) {
      extraPriceCols.push({ idx: i, label: cells[i].trim() });
    }
  });
  return { map, extraPriceCols };
}

/** 单元格 → 数字（容忍「1.06元」「¥4.5」「20k」「1,200」等写法；「/」「—」视为无值）。 */
function toNumber(raw: string): number | null {
  const s = raw.replace(/[¥￥元,，\s]/g, "").replace(/[kK]$/, "000");
  if (!s || s === "/" || s === "—" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析导入文件：逐行扫描全部工作表——遇到表头行就重建列映射（支持一个 sheet 里多段表格、
 * 段与段列名不同），自动跳过空行、说明行、总计/合计行；按（商品, 供应商）分组合并阶梯档。
 */
export async function parseQuoteBookFile(file: File): Promise<ParsedImport> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const errors: string[] = [];
  const warnings: string[] = [];
  const groups = new Map<string, ImportSupplierQuoteItem>();
  const groupImages = new Map<string, Blob>();
  const sheetImages = await extractXlsxImages(file);
  const GROUP_SEP = "\u0000"; // 商品名可含空格，用 NUL 防拼接碰撞

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    let colMap: ColMapping | null = null;
    let sheetHasData = false;
    const sheetTag = wb.SheetNames.length > 1 ? `[${sheetName}] ` : "";

    rows.forEach((rawRow, index) => {
      const rowNo = index + 1;
      const row = Array.isArray(rawRow) ? rawRow : [];
      const cellRaw = (field: string): unknown => {
        const idx = colMap?.map.get(field);
        return idx == null ? "" : row[idx];
      };
      const cell = (field: string): string => String(cellRaw(field) ?? "").trim();
      const cells = row.map((c) => String(c ?? "").trim());
      if (cells.every((c) => !c)) return; // 空行
      sheetHasData = true;

      const headerMap = buildColMap(cells);
      if (headerMap) { colMap = headerMap; return; } // 表头行（含多段重复表头）
      if (!colMap) return; // 首个表头之前的说明性内容

      const materialName = cell("materialName");
      const supplierName = cell("supplierName");
      // 总计/合计行、只有序号或模具费汇总的行：静默跳过
      if (cells.some((c) => /^(总计|合计|小计)$/.test(c))) return;
      if (!materialName && !supplierName) return;
      if (!materialName || !supplierName) { errors.push(`${sheetTag}第 ${rowNo} 行：商品名称与供应商为必填`); return; }

      const unitPrice = toNumber(cell("unitPrice"));
      if (unitPrice == null || unitPrice <= 0) {
        const moldPrice = cell("extraMoldPrice");
        errors.push(
          moldPrice
            ? `${sheetTag}第 ${rowNo} 行（${supplierName} / ${materialName}）：只有模具价格 ${moldPrice}，模具费不作为产品单价，已跳过`
            : `${sheetTag}第 ${rowNo} 行（${supplierName} / ${materialName}）：缺少有效的产品单价`,
        );
        return;
      }

      const qtyRaw = cell("minQty");
      const minQty = qtyRaw && qtyRaw !== "不限" ? toNumber(qtyRaw) : 0;
      if (minQty == null || minQty < 0) { errors.push(`${sheetTag}第 ${rowNo} 行：起订量「${qtyRaw}」无法识别`); return; }

      const leadParsed = cell("leadTimeDays") ? toNumber(cell("leadTimeDays")) : 0;
      const leadTimeDays = leadParsed != null && leadParsed >= 0 ? Math.round(leadParsed) : 0;

      // 模具/注塑类附加列拼进备注，导入不丢信息
      const extras = [
        cell("extraCavity") && `穴数 ${cell("extraCavity")}`,
        cell("extraSteel") && `材料 ${cell("extraSteel")}`,
        cell("extraMaterial") && `产品材料 ${cell("extraMaterial")}`,
        cell("extraMoldPrice") && `模具含税价 ${cell("extraMoldPrice")}`,
      ].filter(Boolean) as string[];
      const note = [cell("note"), ...extras].filter(Boolean).join("；") || undefined;

      const identity = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const key = [materialName, cell("spec"), supplierName].map(identity).join(GROUP_SEP);
      const opt = (field: string) => cell(field) || undefined;
      // 图片按锚定行关联到该行商品（同商品多行取首个有图行）
      const rowImage = sheetImages.get(sheetName)?.get(index);
      if (rowImage && !groupImages.has(key)) groupImages.set(key, rowImage);
      // 额外价格列（如「6.2报价」）→ 历史轮次，随导入写进历史价格流水
      const rowHistory: { unitPrice: number; minQty?: number; label?: string }[] = [];
      for (const col of colMap.extraPriceCols) {
        const extraPrice = toNumber(String(row[col.idx] ?? "").trim());
        if (extraPrice != null && extraPrice > 0) rowHistory.push({ unitPrice: extraPrice, minQty: minQty || undefined, label: col.label });
      }
      const existing = groups.get(key);
      if (existing) {
        const dupIdx = existing.tiers.findIndex((t) => t.minQty === minQty);
        if (dupIdx !== -1) {
          if (existing.tiers[dupIdx].unitPrice !== unitPrice) {
            // 多轮报价：旧值转入历史留痕，最新值为现行价
            (existing.historyPrices ??= []).push({ ...existing.tiers[dupIdx], label: "早前轮次报价" });
            warnings.push(`${sheetTag}第 ${rowNo} 行：${supplierName} / ${materialName} 出现多轮不同报价，已保留最后一条，早前价转入历史价格`);
          }
          existing.tiers[dupIdx] = { minQty, unitPrice };
        } else existing.tiers.push({ minQty, unitPrice });
        if (rowHistory.length) (existing.historyPrices ??= []).push(...rowHistory);
        existing.spec ??= opt("spec"); existing.unit ??= opt("unit"); existing.category ??= opt("category");
        existing.supplierModel ??= opt("supplierModel"); existing.note ??= note;
        existing.quoteDate ??= fmtDate(cellRaw("quoteDate")); existing.validUntil ??= fmtDate(cellRaw("validUntil"));
      } else {
        groups.set(key, {
          materialName,
          supplierName,
          spec: opt("spec"),
          unit: opt("unit"),
          category: opt("category"),
          supplierModel: opt("supplierModel"),
          currency: opt("currency") ?? "CNY",
          taxIncluded: cell("taxIncluded") !== "否",
          leadTimeDays,
          tiers: [{ minQty, unitPrice }],
          quoteDate: fmtDate(cellRaw("quoteDate")),
          validUntil: fmtDate(cellRaw("validUntil")),
          note,
          historyPrices: rowHistory.length ? rowHistory : undefined,
        });
      }
    });
    // 有内容但整个 sheet 没识别出「供应商+产品名称」表头：明确告知而不是静默丢弃
    // （常见于「供应商在列头」的矩阵比价表——交给 AI 智能识别处理）
    if (sheetHasData && !colMap) {
      warnings.push(`[${sheetName}] 未识别到「供应商 + 产品名称」表头，该表未被解析；矩阵比价表请点「AI 智能识别」补充导入`);
    }
  }
  if (groups.size === 0 && errors.length === 0) {
    errors.push("没有识别到表头行：请确认表格里有「供应商/厂家」和「产品名称/型号」列");
  }
  const items = Array.from(groups.values(), (item) => ({ ...item, tiers: normalizeQuoteImportTiers(item.tiers) }));
  const keys = Array.from(groups.keys());
  return { items, errors, warnings, images: keys.map((k) => groupImages.get(k)) };
}
