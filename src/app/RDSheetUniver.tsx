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
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import sheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import type { IWorkbookData, Univer, FUniver } from "@univerjs/presets";

/**
 * 研发数据表 · Univer Sheets 编辑器（B2：直接装载/保存 IWorkbookData 快照，无行级密级）。
 *
 * - 体积大（渲染/公式/UI 引擎），故惰性加载（父组件用 React.lazy）。
 * - 直接装载整簿快照（含浮动图 / 内嵌图 / 合并 / 行高列宽 / 样式），保存时 wb.save() 原样取回，
 *   高保真往返，不再做扁平化或密级裁剪。
 * - 装载新快照（导入 / 撤销改动）由父组件通过变更 key 触发整组件重建。
 */
export type RDSheetUniverHandle = {
  /** 取当前工作簿快照（保存用）。 */
  getSnapshot: () => IWorkbookData | null;
  /** 提交飞行中编辑（保存前调用，避免正在输入的内容被丢弃）。 */
  commitPendingEdit: () => Promise<void>;
  /**
   * 把当前工作表的「浮动图片」（粘贴/导入产生的悬浮图，Drawing）转换为「单元格图片」（嵌入格子、随快照往返）。
   * 逐张：读取图源 → 插入到其锚点单元格（读不到锚点则退回当前选中格）→ 删除原浮动图。返回转换数量。
   */
  convertFloatingImagesToCells: () => Promise<{ converted: number; total: number }>;
};

type Props = {
  /** 初始装载的整簿快照。 */
  snapshot: IWorkbookData;
  /** 只读（无编辑权限）：当前不强制 Univer 只读，保存按钮由父组件按权限隐藏 + 后端兜底拒绝。 */
  readOnly?: boolean;
  /** 编辑器内值变更回调（标脏）。 */
  onDirty?: () => void;
};

export const RDSheetUniver = forwardRef<RDSheetUniverHandle, Props>(function RDSheetUniver(
  { snapshot, onDirty },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<Univer | null>(null);
  const apiRef = useRef<FUniver | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const loadedRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: () => {
        try {
          return apiRef.current?.getActiveWorkbook()?.save() ?? null;
        } catch {
          return null;
        }
      },
      commitPendingEdit: async () => {
        try {
          const wb = apiRef.current?.getActiveWorkbook() as
            | { endEditingAsync?: (save?: boolean) => Promise<boolean> }
            | null
            | undefined;
          await wb?.endEditingAsync?.(true);
        } catch {
          /* 提交失败不阻塞保存 */
        }
      },
      convertFloatingImagesToCells: async () => {
        // facade 类型未完整导出，按运行期形状用 any 访问（Univer 0.25 已确认这些方法存在）。
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const api = apiRef.current as any;
        const ws = api?.getActiveWorkbook?.()?.getActiveSheet?.();
        if (!ws || typeof ws.getImages !== "function") return { converted: 0, total: 0 };
        const images: any[] = ws.getImages() ?? [];
        if (images.length === 0) return { converted: 0, total: 0 };

        // 锚点读不到时的兜底：当前选中区左上角单元格。
        let fbRow = 0;
        let fbCol = 0;
        try {
          const rng = ws.getSelection?.()?.getActiveRange?.();
          if (rng) {
            fbRow = rng.getRow();
            fbCol = rng.getColumn();
          }
        } catch {
          /* ignore */
        }

        let converted = 0;
        for (const img of images) {
          try {
            const source: string | undefined = img.toBuilder?.()?.getSource?.();
            if (!source) continue;
            const from = img._image?.sheetTransform?.from;
            const row = typeof from?.row === "number" ? from.row : fbRow;
            const col = typeof from?.column === "number" ? from.column : fbCol;
            await ws.getRange(row, col).insertCellImageAsync(source);
            img.remove?.();
            converted += 1;
          } catch {
            /* 单张失败跳过，不阻断其余 */
          }
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (converted > 0) onDirtyRef.current?.();
        return { converted, total: images.length };
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
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__univerAPI = univerAPI;
    }

    univerAPI.createWorkbook(snapshotRef.current);

    // 初始装载结束后再监听值变更，避免装载本身触发 dirty。
    const t = window.setTimeout(() => {
      loadedRef.current = true;
    }, 0);

    let disposable: { dispose?: () => void } | null = null;
    try {
      disposable = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, () => {
        if (loadedRef.current) onDirtyRef.current?.();
      });
    } catch {
      disposable = null;
    }

    return () => {
      try {
        disposable?.dispose?.();
      } catch {
        /* ignore */
      }
      window.clearTimeout(t);
      // 延迟到下一个微任务再 dispose：Univer 会同步卸载自己的 React root，
      // 若在父组件 render/commit 期间同步执行会触发 React「synchronously unmount a root」告警。
      const toDispose = univer;
      window.setTimeout(() => {
        try {
          toDispose.dispose();
        } catch {
          /* ignore */
        }
      }, 0);
      univerRef.current = null;
      apiRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ height: "70vh", minHeight: 480 }} />;
});

export default RDSheetUniver;
