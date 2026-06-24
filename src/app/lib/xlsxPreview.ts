/**
 * xlsx/xls → 只读 HTML 表格预览的轻量解析器（研发任务驾驶舱附件预览用）。
 *
 * 复用已有的 exceljs（运行时动态 import，拆独立 chunk），只取「单元格显示值 + 合并范围」，
 * 不还原样式/图片（那是研发数据表 xlsxToUniver 的高保真路径，过重）。维度防爆：绝不读
 * ws.rowCount/columnCount（Excel 整列格式会让它们百万级），一律以实际有数据的范围为准并封顶。
 */
import type ExcelJS from "exceljs"; // 仅类型；运行时在 parseXlsxForPreview 内动态 import

const CAP_ROWS = 600;
const CAP_COLS = 64;

export type XlsxPreviewCell = { text: string; rowSpan: number; colSpan: number };
export type XlsxPreviewSheet = {
  name: string;
  rowCount: number;
  colCount: number;
  /** rows[r][c]：null 表示被合并单元格覆盖（渲染时跳过）；否则是带 span 的单元格。 */
  rows: Array<Array<XlsxPreviewCell | null>>;
};

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
  if ("result" in o) {
    const r = o.result;
    return r == null ? "" : typeof r === "object" ? "" : String(r);
  }
  if ("text" in o) return String(o.text ?? "");
  if ("hyperlink" in o) return String(o.hyperlink ?? "");
  return "";
}

function decodeAddr(addr: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(addr.trim().toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export async function parseXlsxForPreview(buf: ArrayBuffer): Promise<XlsxPreviewSheet[]> {
  const mod = await import("exceljs");
  const ExcelJSLib = ((mod as { default?: typeof ExcelJS }).default ?? mod) as typeof ExcelJS;
  const wb = new ExcelJSLib.Workbook();
  await wb.xlsx.load(buf);

  const out: XlsxPreviewSheet[] = [];
  for (const ws of wb.worksheets) {
    // 第一遍：只遍历有数据的单元格，定数据范围（绝不按 rowCount 死循环）
    const valueAt = new Map<string, string>();
    let maxRow = 0;
    let maxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const r = rn - 1;
        const c = cn - 1;
        const text = cellText(cell.value);
        if (text === "") return;
        valueAt.set(`${r},${c}`, text);
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      });
    });

    // 合并范围：top-left 给 span，其余格标记 covered
    const merges = (ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [];
    const spanAt = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const m of merges) {
      const [a, b] = String(m).split(":");
      const pa = decodeAddr(a);
      const pb = decodeAddr(b);
      if (!pa || !pb) continue;
      const r0 = Math.min(pa.r, pb.r);
      const c0 = Math.min(pa.c, pb.c);
      const r1 = Math.max(pa.r, pb.r);
      const c1 = Math.max(pa.c, pb.c);
      spanAt.set(`${r0},${c0}`, { rs: r1 - r0 + 1, cs: c1 - c0 + 1 });
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (r === r0 && c === c0) continue;
          covered.add(`${r},${c}`);
          if (r > maxRow) maxRow = r; // 合并可能延伸到无数据区
          if (c > maxCol) maxCol = c;
        }
      }
    }

    const rowCount = Math.min(maxRow + 1, CAP_ROWS);
    const colCount = Math.min(maxCol + 1, CAP_COLS);
    const rows: Array<Array<XlsxPreviewCell | null>> = [];
    for (let r = 0; r < rowCount; r++) {
      const line: Array<XlsxPreviewCell | null> = [];
      for (let c = 0; c < colCount; c++) {
        const key = `${r},${c}`;
        if (covered.has(key)) { line.push(null); continue; }
        const span = spanAt.get(key);
        // 把超出 cap 的 span 截断到可见范围，避免 rowspan/colspan 溢出表格
        const rs = span ? Math.min(span.rs, rowCount - r) : 1;
        const cs = span ? Math.min(span.cs, colCount - c) : 1;
        line.push({ text: valueAt.get(key) ?? "", rowSpan: rs, colSpan: cs });
      }
      rows.push(line);
    }

    out.push({ name: ws.name || `Sheet${out.length + 1}`, rowCount, colCount, rows });
  }
  return out;
}
