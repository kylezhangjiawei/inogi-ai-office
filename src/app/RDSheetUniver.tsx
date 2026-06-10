import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  createUniver,
  LocaleType,
  merge,
  defaultTheme,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
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
 */

const SHEET_ID = "rd-sheet-1";
const WORKBOOK_ID = "rd-sheet-workbook";
// 多预留一些空白行列，方便编辑者直接录入，不必频繁手动加行/列。
const EXTRA_BLANK_ROWS = 50;
const EXTRA_BLANK_COLS = 6;
const MIN_ROWS = 60;
const MIN_COLS = 12;

export type RDSheetUniverHandle = {
  /** 从 Univer 当前快照读回规整二维表数据（供父组件保存）。 */
  getData: () => { headers: string[]; rows: string[][] };
};

type Props = {
  initialHeaders: string[];
  initialRows: string[][];
  sheetName: string;
  /** 用户首次改动单元格时回调（用于父组件标记 dirty）。 */
  onDirty?: () => void;
};

/** 单元格字面值 → 字符串（数字/布尔统一转字符串；空值转 ""）。 */
function cellStr(cell: ICellData | undefined | null): string {
  if (!cell) return "";
  const v = cell.v;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** headers + rows → Univer 工作簿快照（第 0 行表头，其后为数据行）。 */
function buildWorkbookData(
  headers: string[],
  rows: string[][],
  name: string,
): Partial<IWorkbookData> {
  const cellData: Record<number, Record<number, ICellData>> = {};
  const setCell = (r: number, c: number, value: string) => {
    if (value === "" || value === null || value === undefined) return;
    if (!cellData[r]) cellData[r] = {};
    cellData[r][c] = { v: value };
  };

  headers.forEach((h, c) => setCell(0, c, h));
  rows.forEach((row, r) => {
    row.forEach((val, c) => setCell(r + 1, c, val));
  });

  const columnCount = Math.max(headers.length + EXTRA_BLANK_COLS, MIN_COLS);
  const rowCount = Math.max(rows.length + 1 + EXTRA_BLANK_ROWS, MIN_ROWS);

  return {
    id: WORKBOOK_ID,
    name: name || "研发数据表",
    sheetOrder: [SHEET_ID],
    sheets: {
      [SHEET_ID]: {
        id: SHEET_ID,
        name: name || "数据表",
        rowCount,
        columnCount,
        cellData,
      },
    },
  };
}

/**
 * Univer 工作簿快照 → headers + rows。
 * - 表头取第 0 行从 0 列起连续的、有值的列，决定列数。
 * - 数据行取第 1 行起、在表头列范围内含任意非空值的行（丢弃整行为空的尾部编辑行）。
 */
function extractData(snapshot: IWorkbookData): {
  headers: string[];
  rows: string[][];
} {
  const sheets = snapshot.sheets ?? {};
  const sheetId =
    snapshot.sheetOrder?.[0] ?? Object.keys(sheets)[0] ?? SHEET_ID;
  const ws = sheets[sheetId];
  const cellData = (ws?.cellData ?? {}) as Record<
    string,
    Record<string, ICellData>
  >;

  const headerRow = cellData["0"] ?? {};
  let headerCols = 0;
  Object.keys(headerRow).forEach((cStr) => {
    const c = Number(cStr);
    if (Number.isFinite(c) && cellStr(headerRow[cStr]) !== "") {
      headerCols = Math.max(headerCols, c + 1);
    }
  });

  if (headerCols === 0) return { headers: [], rows: [] };

  const headers: string[] = [];
  for (let c = 0; c < headerCols; c++) headers.push(cellStr(headerRow[String(c)]));

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
      const s = cellStr(rowObj[String(c)]);
      if (s !== "") hasValue = true;
      row.push(s);
    }
    if (hasValue) rows.push(row);
  }

  return { headers, rows };
}

export const RDSheetUniver = forwardRef<RDSheetUniverHandle, Props>(
  function RDSheetUniver({ initialHeaders, initialRows, sheetName, onDirty }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const univerRef = useRef<Univer | null>(null);
    const apiRef = useRef<FUniver | null>(null);
    // 装载初始数据时 Univer 可能触发值变更事件，避免被误判为「用户改动」。
    const loadedRef = useRef(false);
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;
    // 持有最初数据做兜底：万一读取快照失败，至少不丢已有内容。
    const initialRef = useRef({ headers: initialHeaders, rows: initialRows });

    useImperativeHandle(
      ref,
      () => ({
        getData: () => {
          const api = apiRef.current;
          if (!api) return initialRef.current;
          try {
            const wb = api.getActiveWorkbook();
            if (!wb) return initialRef.current;
            return extractData(wb.save());
          } catch {
            return initialRef.current;
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
        locales: { [LocaleType.ZH_CN]: merge({}, sheetsCoreZhCN) },
        theme: defaultTheme,
        presets: [UniverSheetsCorePreset({ container })],
      });
      univerRef.current = univer;
      apiRef.current = univerAPI;

      univerAPI.createWorkbook(
        buildWorkbookData(initialHeaders, initialRows, sheetName) as IWorkbookData,
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

      return () => {
        window.clearTimeout(t);
        try {
          disposable?.dispose?.();
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
      </div>
    );
  },
);

export default RDSheetUniver;
