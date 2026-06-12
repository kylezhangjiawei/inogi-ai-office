import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  createUniver,
  LocaleType,
  merge,
  defaultTheme,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import sheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import type { IWorkbookData, ICellData, Univer, FUniver } from "@univerjs/presets";

/**
 * 研发数据表 · Univer Sheets 编辑器（编辑者专用、惰性加载）。
 *
 * 为什么单独成模块：
 * - Univer 体积大（含渲染引擎/公式引擎/UI），只有编辑者需要；普通成员走轻量只读 HTML 表格，
 *   不应被迫下载这坨依赖。本模块通过 React.lazy 仅在编辑者分支首次渲染时才加载（含 CSS）。
 *
 * 与行级密级管控的配合（关键约束）：
 * - 后端的脱敏依赖「规整的二维表」结构：第 0 行=表头，其后每行=一条记录，且存在一列「密级」。
 * - 因此本编辑器把数据按此结构装载进 Univer，并在保存时按同样结构读回（headers+rows）。
 * - 公式/合并单元格等富能力会破坏该结构，读回时只取每个单元格的字面值（cell.v），
 *   不解析公式结果，也不保留合并信息——这是行级安全 > 富表格能力的有意取舍。
 *
 * 多工作表（workbook）支持：
 * - 一次装载全部数据表，底部用 Univer 原生 sheet tab 切换；每张表独立套用上述二维结构。
 * - 读回时按 sheetOrder 返回全部表（含用户在编辑器里新建/删除/改名/拖动排序的结果），
 *   由父组件整簿保存。
 */

const WORKBOOK_ID = "rd-sheet-workbook";
// 多预留一些空白行列，方便编辑者直接录入，不必频繁手动加行/列。
const EXTRA_BLANK_ROWS = 50;
const EXTRA_BLANK_COLS = 6;
const MIN_ROWS = 60;
const MIN_COLS = 12;
// 与后端约定一致的单元格图片标记（存储形态）。objectKey 很长，直接显示会撑爆单元格，
// 因此编辑器内把它换显示为短标记 [图片#n]（见组件内 toDisplay/toStorage）：
// 装载与写入时「长 → 短」，读回保存时「短 → 长」，存储值始终是完整标记。
const IMAGE_MARK_RE_G = /\[图片:([^\[\]\s]+)\]/g;
const SHORT_MARK_RE = /\[图片#(\d+)\]/;
const SHORT_MARK_RE_G = /\[图片#(\d+)\]/g;
// 整格只有一个图片标记（无其他文字）→ 渲染成嵌入式单元格缩略图而非文本标记。
const SINGLE_IMAGE_MARK_RE = /^\[图片:([^\[\]\s]+)\]$/;
// 含缩略图行的显示行高（仅显示层，不落库）与 Univer 默认列宽（缩略图按此 contain-fit）。
const CELL_IMAGE_ROW_HEIGHT = 72;
const DEFAULT_COL_WIDTH = 88;

/** 图片引用的解析结果：预览 URL + 自然宽高（缺一不可，否则退回文本标记显示）。 */
type ResolvedImage = { url: string; w: number; h: number };

/** 缩略图 contain-fit 进单元格（不放大小图；Univer 绘制时各留 2px 边距）。 */
function fitSize(w: number, h: number, cellW: number, cellH: number) {
  const maxW = Math.max(cellW - 2, 8);
  const maxH = Math.max(cellH - 2, 8);
  const scale = Math.min(maxW / w, maxH / h, 1);
  return {
    width: Math.max(Math.round(w * scale), 1),
    height: Math.max(Math.round(h * scale), 1),
  };
}

/**
 * 构造「单元格图片」的 ICellData（cell.p 富文本文档快照，结构复刻自 Univer 0.25
 * insertCellImage 的产物）：dataStream 中 \b 是图片占位符，drawings 存图片本体描述。
 * - source 直接用预览 URL（正式 key 的同源代理 URL / 本地暂存的 blob URL），不转 base64；
 * - description 存图片引用（objectKey 或 local-id），保存读回时凭它还原 [图片:ref] 标记。
 */
function buildCellImageCell(img: ResolvedImage, ref: string): ICellData {
  const drawingId = `rd-img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { width, height } = fitSize(img.w, img.h, DEFAULT_COL_WIDTH, CELL_IMAGE_ROW_HEIGHT);
  const p = {
    id: "d",
    documentStyle: {
      pageSize: { width: null, height: null },
      documentFlavor: 0,
      marginTop: 0,
      marginBottom: 2,
      marginRight: 2,
      marginLeft: 2,
      paragraphLineGapDefault: 0,
      renderConfig: {
        horizontalAlign: 0,
        verticalAlign: 0,
        centerAngle: 0,
        vertexAngle: 0,
        wrapStrategy: 0,
        zeroWidthParagraphBreak: 1,
      },
    },
    body: {
      dataStream: "\b\r\n",
      textRuns: [],
      paragraphs: [{ startIndex: 1, paragraphStyle: { horizontalAlign: 0 } }],
      sectionBreaks: [{ startIndex: 2 }],
      customBlocks: [{ startIndex: 0, blockId: drawingId }],
      customRanges: [],
      customDecorations: [],
    },
    drawings: {
      [drawingId]: {
        unitId: "d",
        subUnitId: "d",
        drawingId,
        drawingType: 0,
        imageSourceType: "URL",
        source: img.url,
        transform: { left: 0, top: 0, width, height },
        docTransform: {
          size: { width, height },
          positionH: { relativeFrom: 0, posOffset: 0 },
          positionV: { relativeFrom: 1, posOffset: 0 },
          angle: 0,
        },
        behindDoc: 0,
        title: "",
        description: ref,
        layoutType: 0,
        wrapText: 0,
        distB: 0,
        distL: 0,
        distR: 0,
        distT: 0,
      },
    },
    drawingsOrder: [drawingId],
  };
  return { p, t: 1 } as unknown as ICellData;
}

/** dataURL → Blob（读回 Univer 原生插入的 base64 单元格图片时用）。 */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "image/png";
  try {
    if (m[2]) {
      const bin = atob(m[3]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return new Blob([decodeURIComponent(m[3])], { type: mime });
  } catch {
    return null;
  }
}

export type UniverSheetData = {
  id: string;
  name: string;
  headers: string[];
  rows: string[][];
};

export type RDSheetUniverHandle = {
  /** 从 Univer 当前快照按 sheetOrder 读回全部工作表的规整二维表数据（供父组件整簿保存）。 */
  getData: () => UniverSheetData[];
  /** 向当前活动单元格写入文本（「插入图片」把 [图片:key] 标记写进选中格）。返回是否成功。 */
  insertTextAtActiveCell: (text: string) => boolean;
};

type Props = {
  initialSheets: UniverSheetData[];
  /** 用户首次改动单元格时回调（用于父组件标记 dirty）。 */
  onDirty?: () => void;
  /** 图片引用（objectKey 或本地暂存 id）→ 预览 URL。hover 到含图片标记的单元格时显示缩略浮层。 */
  imageUrls?: Record<string, string>;
  /**
   * 图片引用 → 自然宽高。整格仅含单个图片标记且 URL/宽高齐备时，装载/写入为嵌入式
   * 单元格缩略图（按宽高 contain-fit 进格子）；查不到宽高则保持文本短标记（旧数据退化路径）。
   */
  getImageDims?: (ref: string) => { w: number; h: number } | null;
  /**
   * 读回时遇到 Univer 原生工具插入的单元格图片（base64、无引用标识）时，把图片本体
   * 交给父组件本地暂存，返回临时引用 id（保存时随其他本地图片统一上传）。
   */
  onRegisterImage?: (blob: Blob, name: string) => string;
  /**
   * 剪贴板内容是图片时回调（Univer 的剪贴板事件只透出 text/html，拿不到图片二进制，
   * 因此在容器 capture 阶段拦原生 paste）。父组件暂存图片后调用 write 把标记写入
   * 粘贴那一刻的活动单元格。
   */
  onPasteImage?: (file: File, write: (text: string) => void) => void;
};

/** 单元格字面值 → 字符串（数字/布尔统一转字符串；空值转 ""）。 */
function cellStr(cell: ICellData | undefined | null): string {
  if (!cell) return "";
  const v = cell.v;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** 单元格图片 drawing 的运行时形态（只取读回所需字段）。 */
type CellDrawing = { description?: unknown; source?: unknown };

/**
 * 读回单元格：含图片的富文本格（cell.p.drawings）把 dataStream 中的图片占位符 \b
 * 还原为 [图片:ref] 标记（ref 取 drawing.description；没有则交给 drawingToMark 兜底），
 * 普通文本格走 cell.v。
 */
function cellToStorage(
  cell: ICellData | undefined | null,
  toStorage: (s: string) => string,
  drawingToMark: (d: CellDrawing) => string,
): string {
  const p = (cell as { p?: unknown } | undefined | null)?.p as
    | {
        body?: { dataStream?: unknown; customBlocks?: Array<{ startIndex: number; blockId: string }> };
        drawings?: Record<string, CellDrawing>;
      }
    | undefined;
  const drawings = p?.drawings;
  if (p && drawings && Object.keys(drawings).length && typeof p.body?.dataStream === "string") {
    try {
      // dataStream 中第 i 个 \b（\x08）按 startIndex 顺序对应 customBlocks[i] → drawing。
      const blocks = [...(p.body.customBlocks ?? [])].sort((a, b) => a.startIndex - b.startIndex);
      let i = 0;
      const text = p.body.dataStream
        .replace(/\x08/g, () => {
          const blockId = blocks[i++]?.blockId;
          const d = blockId ? drawings[blockId] : undefined;
          return d ? drawingToMark(d) : "[图片]";
        })
        .replace(/[\r\n]+$/, "") // 文档末尾的段落/节终止符
        .replace(/\r/g, "\n"); // 文内段落分隔 → 换行
      return toStorage(text);
    } catch {
      return "[图片]";
    }
  }
  return toStorage(cellStr(cell));
}

/** 多张数据表 → Univer 工作簿快照（每表：第 0 行表头，其后为数据行）。
 *  toDisplay：装载前把单元格里的完整图片标记换成短显示标记。
 *  resolveImage：整格仅含单个图片标记且能解析出 URL+宽高时，装载为嵌入式缩略图。 */
function buildWorkbookData(
  sheets: UniverSheetData[],
  toDisplay: (s: string) => string,
  resolveImage: (ref: string) => ResolvedImage | null,
): Partial<IWorkbookData> {
  const sheetOrder: string[] = [];
  const sheetMap: NonNullable<IWorkbookData["sheets"]> = {};
  const usedNames = new Set<string>();

  sheets.forEach((s, i) => {
    const id = s.id || `rd-sheet-${i + 1}`;
    // Univer 要求工作表名唯一且非空：空名兜底、重名追加序号。
    const base = (s.name || "").trim().slice(0, 60) || `数据表${i + 1}`;
    let name = base;
    let n = 2;
    while (usedNames.has(name)) name = `${base}(${n++})`;
    usedNames.add(name);

    const cellData: Record<number, Record<number, ICellData>> = {};
    // 含缩略图的行在显示层加高（仅本次装载的视觉效果，不进入存储数据）。
    const imageRows = new Set<number>();
    const setCell = (r: number, c: number, value: string) => {
      if (value === "" || value === null || value === undefined) return;
      if (!cellData[r]) cellData[r] = {};
      const single = SINGLE_IMAGE_MARK_RE.exec(value.trim());
      if (single) {
        const img = resolveImage(single[1]);
        if (img) {
          cellData[r][c] = buildCellImageCell(img, single[1]);
          imageRows.add(r);
          return;
        }
      }
      cellData[r][c] = { v: toDisplay(value) };
    };
    s.headers.forEach((h, c) => setCell(0, c, h));
    s.rows.forEach((row, r) => {
      row.forEach((val, c) => setCell(r + 1, c, val));
    });

    const rowData: Record<number, { h: number }> = {};
    for (const r of imageRows) rowData[r] = { h: CELL_IMAGE_ROW_HEIGHT };

    sheetOrder.push(id);
    sheetMap[id] = {
      id,
      name,
      rowCount: Math.max(s.rows.length + 1 + EXTRA_BLANK_ROWS, MIN_ROWS),
      columnCount: Math.max(s.headers.length + EXTRA_BLANK_COLS, MIN_COLS),
      cellData,
      ...(imageRows.size ? { rowData } : {}),
    };
  });

  return {
    id: WORKBOOK_ID,
    name: "研发数据表",
    sheetOrder,
    sheets: sheetMap,
  };
}

/**
 * 单个工作表快照 → headers + rows。
 * - 表头取第 0 行从 0 列起连续的、有值的列，决定列数。
 * - 数据行取第 1 行起、在表头列范围内含任意非空值的行（丢弃整行为空的尾部编辑行）。
 */
function extractSheet(
  ws: { cellData?: unknown } | undefined,
  toStorage: (s: string) => string,
  drawingToMark: (d: CellDrawing) => string,
): {
  headers: string[];
  rows: string[][];
} {
  const cellData = (ws?.cellData ?? {}) as Record<string, Record<string, ICellData>>;
  const readCell = (cell: ICellData | undefined) => cellToStorage(cell, toStorage, drawingToMark);

  const headerRow = cellData["0"] ?? {};
  let headerCols = 0;
  Object.keys(headerRow).forEach((cStr) => {
    const c = Number(cStr);
    if (Number.isFinite(c) && readCell(headerRow[cStr]) !== "") {
      headerCols = Math.max(headerCols, c + 1);
    }
  });

  if (headerCols === 0) return { headers: [], rows: [] };

  const headers: string[] = [];
  for (let c = 0; c < headerCols; c++) headers.push(readCell(headerRow[String(c)]));

  const rowIndices = Object.keys(cellData)
    .map(Number)
    .filter((r) => Number.isFinite(r) && r >= 1);
  const maxRow = rowIndices.length ? Math.max(...rowIndices) : 0;

  const rows: string[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowObj = cellData[String(r)] ?? {};
    const row: string[] = [];
    let hasValue = false;
    for (let c = 0; c < headerCols; c++) {
      const s = readCell(rowObj[String(c)]);
      if (s !== "") hasValue = true;
      row.push(s);
    }
    if (hasValue) rows.push(row);
  }

  return { headers, rows };
}

/** Univer 工作簿快照 → 全部工作表（按 sheetOrder；空表也保留，避免保存时丢表）。 */
function extractData(
  snapshot: IWorkbookData,
  toStorage: (s: string) => string,
  drawingToMark: (d: CellDrawing) => string,
): UniverSheetData[] {
  const sheets = snapshot.sheets ?? {};
  const order = (snapshot.sheetOrder ?? Object.keys(sheets)).filter((id) => sheets[id]);
  const ids = order.length ? order : Object.keys(sheets);
  return ids.map((sheetId, i) => {
    const ws = sheets[sheetId];
    const { headers, rows } = extractSheet(ws, toStorage, drawingToMark);
    return {
      id: String(sheetId),
      name: String(ws?.name ?? "").trim() || `数据表${i + 1}`,
      headers,
      rows,
    };
  });
}

export const RDSheetUniver = forwardRef<RDSheetUniverHandle, Props>(
  function RDSheetUniver(
    { initialSheets, onDirty, imageUrls, getImageDims, onRegisterImage, onPasteImage },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const univerRef = useRef<Univer | null>(null);
    const apiRef = useRef<FUniver | null>(null);
    // 装载初始数据时 Univer 可能触发值变更事件，避免被误判为「用户改动」。
    const loadedRef = useRef(false);
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;
    const onPasteImageRef = useRef(onPasteImage);
    onPasteImageRef.current = onPasteImage;
    const imageUrlsRef = useRef(imageUrls);
    imageUrlsRef.current = imageUrls;
    const getImageDimsRef = useRef(getImageDims);
    getImageDimsRef.current = getImageDims;
    const onRegisterImageRef = useRef(onRegisterImage);
    onRegisterImageRef.current = onRegisterImage;
    // 持有最初数据做兜底：万一读取快照失败，至少不丢已有内容。
    const initialRef = useRef(initialSheets);
    // 图片标记「长 ↔ 短」双向映射（实例级，随重挂载重建；同一图片多处引用共享同一编号）。
    const shortByFullRef = useRef(new Map<string, number>());
    const fullByShortRef = useRef(new Map<number, string>());
    const nextShortRef = useRef(1);
    const toDisplay = (s: string) =>
      s.replace(IMAGE_MARK_RE_G, (_all, full: string) => {
        let n = shortByFullRef.current.get(full);
        if (!n) {
          n = nextShortRef.current++;
          shortByFullRef.current.set(full, n);
          fullByShortRef.current.set(n, full);
        }
        return `[图片#${n}]`;
      });
    // 查不到编号的短标记（用户手敲/改坏）原样保留，落库后无 URL、按纯文本处理。
    const toStorage = (s: string) =>
      s.replace(SHORT_MARK_RE_G, (all, d: string) => {
        const full = fullByShortRef.current.get(Number(d));
        return full ? `[图片:${full}]` : all;
      });
    const toDisplayRef = useRef(toDisplay);
    toDisplayRef.current = toDisplay;
    const toStorageRef = useRef(toStorage);
    toStorageRef.current = toStorage;
    // hover 图片预览浮层（跟随鼠标）；hoverCellRef 避免停在同一单元格时反复读值。
    const [hoverPreview, setHoverPreview] = useState<{
      url: string;
      x: number;
      y: number;
    } | null>(null);
    const mousePosRef = useRef({ x: 0, y: 0 });
    const hoverCellRef = useRef<{ row: number; col: number } | null>(null);

    // 图片引用 → URL+自然宽高（缺任一项返回 null → 调用方退回文本标记路径）。
    const resolveImageRef = (refKey: string): ResolvedImage | null => {
      const url = imageUrlsRef.current?.[refKey];
      if (!url) return null;
      const dims = getImageDimsRef.current?.(refKey);
      if (!dims || !(dims.w > 0) || !(dims.h > 0)) return null;
      return { url, w: dims.w, h: dims.h };
    };

    // 读回时把单元格图片 drawing 还原为存储标记：优先用 description 里的引用；
    // Univer 原生工具插入的图（base64、无引用）转 blob 交父组件本地暂存。
    const drawingToMark = (d: CellDrawing): string => {
      const desc = typeof d?.description === "string" ? d.description.trim() : "";
      if (desc) return `[图片:${desc}]`;
      const src = typeof d?.source === "string" ? d.source : "";
      if (src.startsWith("data:")) {
        const register = onRegisterImageRef.current;
        const blob = register ? dataUrlToBlob(src) : null;
        if (register && blob) return `[图片:${register(blob, "univer-image.png")}]`;
      }
      return "[图片]";
    };
    const drawingToMarkRef = useRef(drawingToMark);
    drawingToMarkRef.current = drawingToMark;

    // 统一写入：整格是单个图片标记且 URL/宽高齐备 → 嵌入式缩略图（顺带把行加高）；
    // 否则按文本写入（图片标记换短显示形态）。
    const writeImageOrText = (
      sheet: {
        getRange: (r: number, c: number, nr: number, nc: number) => { setValue: (v: unknown) => unknown } | null;
        setRowHeights?: (startRow: number, numRows: number, height: number) => unknown;
      },
      r: number,
      c: number,
      text: string,
    ): boolean => {
      const single = SINGLE_IMAGE_MARK_RE.exec(text.trim());
      if (single) {
        const img = resolveImageRef(single[1]);
        if (img) {
          try {
            // SetRangeValues 是合并语义：v/f/si 传 null 显式清掉原有文本/公式残留。
            sheet.getRange(r, c, 1, 1)?.setValue({
              ...(buildCellImageCell(img, single[1]) as object),
              v: null,
              f: null,
              si: null,
            });
            try {
              sheet.setRowHeights?.(r, 1, CELL_IMAGE_ROW_HEIGHT);
            } catch {
              /* 行高调整失败不影响写入本身 */
            }
            return true;
          } catch {
            /* 落到文本路径兜底 */
          }
        }
      }
      try {
        sheet.getRange(r, c, 1, 1)?.setValue(toDisplayRef.current(text));
        return true;
      } catch {
        return false;
      }
    };
    const writeImageOrTextRef = useRef(writeImageOrText);
    writeImageOrTextRef.current = writeImageOrText;

    useImperativeHandle(
      ref,
      () => ({
        getData: () => {
          const api = apiRef.current;
          if (!api) return initialRef.current;
          try {
            const wb = api.getActiveWorkbook();
            if (!wb) return initialRef.current;
            const all = extractData(wb.save(), toStorageRef.current, drawingToMarkRef.current);
            return all.length ? all : initialRef.current;
          } catch {
            return initialRef.current;
          }
        },
        insertTextAtActiveCell: (text: string) => {
          try {
            const wb = apiRef.current?.getActiveWorkbook();
            const range = wb?.getActiveRange();
            const sheet = wb?.getActiveSheet();
            if (!range || !sheet) return false;
            // 多选区时取左上角单元格；单个图片标记写为嵌入缩略图，其余按文本（短标记）写入
            return writeImageOrTextRef.current(
              sheet,
              range.getRow(),
              range.getColumn(),
              text,
            );
          } catch {
            return false;
          }
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      loadedRef.current = false;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: merge({}, sheetsCoreZhCN, sheetsDrawingZhCN) },
        theme: defaultTheme,
        presets: [UniverSheetsCorePreset({ container }), UniverSheetsDrawingPreset()],
      });
      univerRef.current = univer;
      apiRef.current = univerAPI;

      univerAPI.createWorkbook(
        buildWorkbookData(
          initialRef.current,
          toDisplayRef.current,
          (refKey) => resolveImageRef(refKey),
        ) as IWorkbookData,
      );

      // 初始装载结束后再开始监听「值变更」，避免装载本身触发 dirty。
      const t = window.setTimeout(() => {
        loadedRef.current = true;
      }, 0);

      let disposable: { dispose?: () => void } | null = null;
      try {
        disposable = univerAPI.addEvent(
          univerAPI.Event.SheetValueChanged,
          () => {
            if (loadedRef.current) onDirtyRef.current?.();
          },
        );
      } catch {
        // 事件 API 不可用时降级：不追踪 dirty（父组件在 Univer 模式下不依赖 dirty 才能保存）。
        disposable = null;
      }

      // hover 到含图片的单元格 → 查 imageUrls 显示缩略浮层（文本短标记格 + 嵌入缩略图格，
      // 后者从 cell.p.drawings 的 description 取引用看大图）。事件不可用时静默降级。
      let hoverDisposable: { dispose?: () => void } | null = null;
      try {
        hoverDisposable = univerAPI.addEvent(univerAPI.Event.CellHover, (params: unknown) => {
          const p = params as {
            row?: number;
            column?: number;
            worksheet?: {
              getRange?: (
                r: number,
                c: number,
                nr: number,
                nc: number,
              ) => { getValue?: () => unknown; getCellData?: () => ICellData | null } | null;
            };
          };
          if (typeof p?.row !== "number" || typeof p?.column !== "number") return;
          const prev = hoverCellRef.current;
          if (prev && prev.row === p.row && prev.col === p.column) return;
          hoverCellRef.current = { row: p.row, col: p.column };
          let url: string | undefined;
          try {
            const range = p.worksheet?.getRange?.(p.row, p.column, 1, 1);
            const v = range?.getValue?.();
            const s = v === null || v === undefined ? "" : String(v);
            const n = SHORT_MARK_RE.exec(s)?.[1];
            const full = n ? fullByShortRef.current.get(Number(n)) : undefined;
            url = full ? imageUrlsRef.current?.[full] : undefined;
            if (!url) {
              const cp = (range?.getCellData?.() as { p?: unknown } | null)?.p as
                | { drawings?: Record<string, CellDrawing>; drawingsOrder?: string[] }
                | undefined;
              const drawings = cp?.drawings;
              if (drawings) {
                const firstId = cp?.drawingsOrder?.[0] ?? Object.keys(drawings)[0];
                const desc = firstId ? drawings[firstId]?.description : undefined;
                url = typeof desc === "string" && desc ? imageUrlsRef.current?.[desc] : undefined;
              }
            }
          } catch {
            url = undefined;
          }
          setHoverPreview(
            url ? { url, x: mousePosRef.current.x, y: mousePosRef.current.y } : null,
          );
        });
      } catch {
        hoverDisposable = null;
      }

      // 剪贴板里是图片时先于 Univer 拦下（capture），交给父组件上传；文本/混合内容放行。
      const handlePaste = (e: ClipboardEvent) => {
        if (!onPasteImageRef.current) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        let file: File | null = null;
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            file = item.getAsFile();
            if (file) break;
          }
        }
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        // 上传是异步的，期间选区可能移动——先捕获「粘贴这一刻」的目标单元格。
        let write: (text: string) => void = () => {};
        try {
          const wb = univerAPI.getActiveWorkbook();
          const range = wb?.getActiveRange();
          const sheet = wb?.getActiveSheet();
          if (range && sheet) {
            const r = range.getRow();
            const c = range.getColumn();
            write = (text) => {
              try {
                writeImageOrTextRef.current(sheet, r, c, text);
              } catch {
                /* noop */
              }
            };
          }
        } catch {
          /* noop */
        }
        onPasteImageRef.current(file, write);
      };
      const handleMouseMove = (e: MouseEvent) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
        setHoverPreview((cur) => (cur ? { ...cur, x: e.clientX, y: e.clientY } : cur));
      };
      const handleMouseLeave = () => {
        hoverCellRef.current = null;
        setHoverPreview(null);
      };
      container.addEventListener("paste", handlePaste, true);
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", handleMouseLeave);

      return () => {
        window.clearTimeout(t);
        container.removeEventListener("paste", handlePaste, true);
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseleave", handleMouseLeave);
        try {
          disposable?.dispose?.();
        } catch {
          /* noop */
        }
        try {
          hoverDisposable?.dispose?.();
        } catch {
          /* noop */
        }
        // Univer 的 dispose() 会同步卸载它内部的 React root。若在父组件因 key 变化
        // 重挂载（撤销改动 / 导入）所触发的 render-commit 阶段里同步执行，会引发 React
        // 的 "synchronously unmount a root while rendering" 警告。延到微任务再 dispose
        // 即可避开（此时父组件提交已结束）；各 Univer 实例相互独立、容器各异，
        // 极短暂的并存不会冲突。
        const pending = univer;
        univerRef.current = null;
        apiRef.current = null;
        queueMicrotask(() => {
          try {
            pending.dispose();
          } catch {
            /* noop */
          }
        });
      };
      // 仅挂载一次：初始数据通过 key 重挂载来刷新（见父组件 reloadKey）。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: "70vh", minHeight: 480 }}
        />
        {hoverPreview ? (
          <div
            className="pointer-events-none fixed z-[9999] rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            style={{
              left: Math.min(hoverPreview.x + 14, window.innerWidth - 252),
              top: Math.min(hoverPreview.y + 14, window.innerHeight - 212),
            }}
          >
            <img
              src={hoverPreview.url}
              alt="单元格图片预览"
              className="max-h-48 max-w-60 rounded object-contain"
            />
          </div>
        ) : null}
      </div>
    );
  },
);

export default RDSheetUniver;
