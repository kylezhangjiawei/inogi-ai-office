/**
 * xlsx → Univer 工作簿快照（IWorkbookData）高保真转换器（研发数据表 B2 方案）。
 *
 * 用 ExcelJS（MIT，纯浏览器）解析单元格值/合并/行高列宽/标准浮动图，并用本模块的 xlsxImages
 * 提取 WPS 内嵌图（DISPIMG，ExcelJS 不认 cellimages.xml）；统一构建成 Univer 快照：
 * - 图片 → Univer sheet drawing（写进 SHEET_DRAWING_PLUGIN 资源，按单元格锚点 from/to 定位），
 *   原位原大小还原，且随 wb.save() 往返；图片以 base64 内嵌，快照自包含、无需 OSS。
 * - 不做行级密级裁剪（B2 去掉密级）。
 *
 * 维度防爆：绝不用 ws.rowCount/columnCount（Excel 整列格式会让它们高达百万级，循环会卡死），
 * 一律以实际有数据/图片的范围为准并封顶。
 */
import ExcelJS from "exceljs";

import { extractXlsxImages } from "./xlsxImages";

const SHEET_DRAWING_PLUGIN = "SHEET_DRAWING_PLUGIN";
const EMU_PER_PX = 9525;
const DEFAULT_COL_PX = 88;
const DEFAULT_ROW_PX = 24;
const DISPIMG_RE = /DISPIMG\s*\(\s*"([^"]+)"/i;
const DISPIMG_MAX_PX = 360;
const CAP_ROWS = 20000;
const CAP_COLS = 256;

type Json = Record<string, unknown>;
type Anchor = { column: number; columnOffset: number; row: number; rowOffset: number };

function colWidthToPx(w: number | undefined): number {
  if (!w || !Number.isFinite(w)) return DEFAULT_COL_PX;
  return Math.round(w * 7 + 5);
}
function rowHeightToPx(h: number | undefined): number {
  if (!h || !Number.isFinite(h)) return DEFAULT_ROW_PX;
  return Math.round((h * 4) / 3);
}

function cellValue(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
  if ("result" in o) {
    const r = o.result;
    return typeof r === "string" || typeof r === "number" || typeof r === "boolean" ? r : null;
  }
  if ("text" in o) return String(o.text ?? "");
  if ("hyperlink" in o) return String(o.hyperlink ?? "");
  return null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH) as unknown as number[]);
  return `data:${blob.type || "image/png"};base64,${btoa(bin)}`;
}

async function imageDims(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      const d = { w: bmp.width, h: bmp.height };
      bmp.close?.();
      return d;
    }
  } catch { /* ignore */ }
  return { w: 200, h: 150 };
}

function bytesToDataUrl(bytes: Uint8Array, extension?: string): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${btoa(bin)}`;
}

function buildMediaMap(wb: ExcelJS.Workbook): Map<number, string> {
  const map = new Map<number, string>();
  const media = (wb as unknown as { model?: { media?: Array<{ type?: string; extension?: string; buffer?: ArrayBuffer | Uint8Array }> } }).model?.media ?? [];
  media.forEach((m, i) => {
    if (m?.type !== "image" || !m.buffer) return;
    const bytes = m.buffer instanceof Uint8Array ? m.buffer : new Uint8Array(m.buffer);
    map.set(i, bytesToDataUrl(bytes, m.extension));
  });
  return map;
}

let drawingSeq = 0;
function nextDrawingId(): string {
  drawingSeq += 1;
  return `rd-draw-${Date.now().toString(36)}-${drawingSeq}`;
}

function buildEdges(px: number[]): number[] {
  const edges = [0];
  for (let i = 0; i < px.length; i++) edges.push(edges[i] + px[i]);
  return edges;
}

function buildImageEntry(unitId: string, subUnitId: string, source: string, from: Anchor, to: Anchor, colEdges: number[], rowEdges: number[]) {
  const drawingId = nextDrawingId();
  const xOf = (c: number, off: number) => (colEdges[Math.min(Math.max(c, 0), colEdges.length - 1)] ?? 0) + off;
  const yOf = (r: number, off: number) => (rowEdges[Math.min(Math.max(r, 0), rowEdges.length - 1)] ?? 0) + off;
  const left = xOf(from.column, from.columnOffset);
  const top = yOf(from.row, from.rowOffset);
  const width = Math.max(8, xOf(to.column, to.columnOffset) - left);
  const height = Math.max(8, yOf(to.row, to.rowOffset) - top);
  return {
    drawingId,
    image: {
      unitId, subUnitId, drawingId,
      drawingType: 0,
      imageSourceType: "BASE64",
      source,
      transform: { left, top, width, height, angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false },
      sheetTransform: { from, to },
      anchorType: "1",
    },
  };
}

type ImgAnchor = { nativeCol?: number; nativeColOff?: number; nativeRow?: number; nativeRowOff?: number; col?: number; row?: number };
function anchorToCell(a: ImgAnchor): Anchor {
  return {
    column: a.nativeCol ?? Math.floor(a.col ?? 0),
    columnOffset: Math.round((a.nativeColOff ?? 0) / EMU_PER_PX),
    row: a.nativeRow ?? Math.floor(a.row ?? 0),
    rowOffset: Math.round((a.nativeRowOff ?? 0) / EMU_PER_PX),
  };
}

function decodeAddr(addr: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(addr.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export async function xlsxToUniverSnapshot(buf: ArrayBuffer, unitId: string): Promise<Json> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const media = buildMediaMap(wb);
  const extra = await extractXlsxImages(buf);

  const dispimg = new Map<string, { url: string; w: number; h: number }>();
  for (const [id, img] of extra.dispimg.entries()) {
    const [url, dims] = await Promise.all([blobToDataUrl(img.blob), imageDims(img.blob)]);
    dispimg.set(id, { url, w: dims.w, h: dims.h });
  }

  const sheets: Record<string, unknown> = {};
  const sheetOrder: string[] = [];
  const drawingResource: Record<string, { data: Record<string, unknown>; order: string[] }> = {};

  for (let wsIndex = 0; wsIndex < wb.worksheets.length; wsIndex++) {
    const ws = wb.worksheets[wsIndex];
    const sheetId = `sheet-${wsIndex + 1}`;
    sheetOrder.push(sheetId);

    // ── 第一遍：只遍历有数据的单元格（eachRow includeEmpty:false，绝不按 rowCount 死循环）──
    const cellData: Record<number, Record<number, unknown>> = {};
    const rowHeights: Record<number, number> = {};
    const dispimgAt: Array<{ r: number; c: number; id: string }> = [];
    let dataMaxRow = 0;
    let dataMaxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const r = rn - 1;
      const h = (row as unknown as { height?: number }).height;
      if (h) rowHeights[r] = rowHeightToPx(h);
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const c = cn - 1;
        if (r > dataMaxRow) dataMaxRow = r;
        if (c > dataMaxCol) dataMaxCol = c;
        const formula = (cell as unknown as { formula?: string }).formula;
        const dm = typeof formula === "string" ? DISPIMG_RE.exec(formula) : null;
        if (dm && dispimg.has(dm[1])) { dispimgAt.push({ r, c, id: dm[1] }); return; }
        const v = cellValue(cell.value);
        if (v === null || v === "") return;
        (cellData[r] = cellData[r] || {})[c] = { v };
      });
    });

    // 标准浮动图锚点（含设备大图），用于扩展维度
    const wsImages = (ws as unknown as { getImages?: () => Array<{ imageId: string; range: { tl: ImgAnchor; br: ImgAnchor } }> }).getImages?.() ?? [];
    let extentRow = dataMaxRow;
    let extentCol = dataMaxCol;
    for (const im of wsImages) {
      extentRow = Math.max(extentRow, im.range.br.nativeRow ?? 0);
      extentCol = Math.max(extentCol, im.range.br.nativeCol ?? 0);
    }
    const maxCol = Math.min(extentCol + 1, CAP_COLS);
    const maxRow = Math.min(extentRow + 1, CAP_ROWS);

    // 列宽（只取已定义列）、行高（已采集），其余用默认；edges 仅覆盖到 maxRow/maxCol + 余量
    const colCount = maxCol + 8;
    const rowCount = maxRow + 60;
    const colPx: number[] = new Array(colCount).fill(DEFAULT_COL_PX);
    const cols = (ws as unknown as { columns?: Array<{ width?: number }> }).columns ?? [];
    for (let i = 0; i < Math.min(cols.length, colCount); i++) {
      if (cols[i]?.width) colPx[i] = colWidthToPx(cols[i].width);
    }
    const rowPx: number[] = new Array(rowCount).fill(DEFAULT_ROW_PX);
    for (const [r, h] of Object.entries(rowHeights)) { const ri = Number(r); if (ri < rowCount) rowPx[ri] = h; }
    const colEdges = buildEdges(colPx);
    const rowEdges = buildEdges(rowPx);

    // ── 图片条目 ──
    const imageEntries: Array<{ drawingId: string; image: unknown }> = [];
    for (const { r, c, id } of dispimgAt) {
      const img = dispimg.get(id)!;
      const scale = Math.min(DISPIMG_MAX_PX / img.w, DISPIMG_MAX_PX / img.h, 1);
      const w = Math.max(16, Math.round(img.w * scale));
      const h = Math.max(16, Math.round(img.h * scale));
      imageEntries.push(buildImageEntry(unitId, sheetId, img.url,
        { column: c, columnOffset: 2, row: r, rowOffset: 2 },
        { column: c, columnOffset: 2 + w, row: r, rowOffset: 2 + h },
        colEdges, rowEdges));
    }
    for (const im of wsImages) {
      const src = media.get(Number(im.imageId));
      if (!src) continue;
      imageEntries.push(buildImageEntry(unitId, sheetId, src, anchorToCell(im.range.tl), anchorToCell(im.range.br), colEdges, rowEdges));
    }
    if (imageEntries.length) {
      const data: Record<string, unknown> = {};
      const order: string[] = [];
      for (const e of imageEntries) { data[e.drawingId] = e.image; order.push(e.drawingId); }
      drawingResource[sheetId] = { data, order };
    }

    // 合并单元格
    const mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }> = [];
    const merges = (ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [];
    for (const m of merges) {
      const parts = String(m).split(":");
      if (parts.length !== 2) continue;
      const a = decodeAddr(parts[0]);
      const b = decodeAddr(parts[1]);
      if (a && b) mergeData.push({ startRow: a.r, startColumn: a.c, endRow: b.r, endColumn: b.c });
    }

    const outRows = Math.min(maxRow + 10, CAP_ROWS);
    const outCols = Math.min(maxCol + 4, CAP_COLS);
    const rowData: Record<number, { h: number }> = {};
    for (let r = 0; r < outRows; r++) rowData[r] = { h: rowPx[r] ?? DEFAULT_ROW_PX };
    const columnData: Record<number, { w: number }> = {};
    for (let c = 0; c < outCols; c++) columnData[c] = { w: colPx[c] ?? DEFAULT_COL_PX };

    sheets[sheetId] = {
      id: sheetId,
      name: ws.name || `Sheet${wsIndex + 1}`,
      rowCount: Math.max(outRows, 60),
      columnCount: Math.max(outCols, 20),
      cellData,
      mergeData,
      rowData,
      columnData,
      defaultColumnWidth: DEFAULT_COL_PX,
      defaultRowHeight: DEFAULT_ROW_PX,
    };
  }

  const resources: Array<{ name: string; data: string }> = [];
  if (Object.keys(drawingResource).length) {
    resources.push({ name: SHEET_DRAWING_PLUGIN, data: JSON.stringify(drawingResource) });
  }

  return { id: unitId, name: "研发数据表", sheetOrder, sheets, resources, styles: {} };
}
