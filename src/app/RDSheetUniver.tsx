import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  createUniver,
  IImageIoService,
  ImageSourceType,
  LocaleType,
  merge,
  defaultTheme,
} from "@univerjs/presets";
import {
  COLOR_PICKER_COMPONENT,
  UniverSheetsCorePreset,
} from "@univerjs/preset-sheets-core";
import type { IColorPickerProps } from "@univerjs/preset-sheets-core";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import sheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import type { IWorkbookData, Univer, FUniver } from "@univerjs/presets";
import { RDSheetRecentColorPicker } from "./RDSheetRecentColorPicker";

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
   * 逐张：读取图源 → 插入到其锚点单元格（读不到锚点则退回当前选中格）→ 确认成功后删除原浮动图。返回转换数量。
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
  /** 最近使用颜色按登录人隔离，避免同一浏览器切换账号后串用偏好。 */
  recentColorOwnerKey?: string;
};

export const RDSheetUniver = forwardRef<RDSheetUniverHandle, Props>(function RDSheetUniver(
  { snapshot, onDirty, recentColorOwnerKey = "anonymous" },
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
        const workbook = api?.getActiveWorkbook?.();
        const ws = workbook?.getActiveSheet?.();
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

        // Univer 的 Cell Image 插入实现仍会读取“当前选中格”来计算图片尺寸；点击页面外层按钮后，
        // 必须在逐张转换前把目标锚点格激活，否则图片可能写到正确地址却用错选区上下文而失败。
        // 最后恢复用户原选区，避免批量转换后光标莫名跳到最后一张图片的位置。
        const restoreSelection = () => {
          try {
            ws.getRange(fbRow, fbCol).activate?.();
          } catch {
            /* ignore */
          }
        };

        let converted = 0;
        for (const img of images) {
          try {
            const builder = img.toBuilder?.();
            let source: string | undefined = builder?.getSource?.();
            if (!source) continue;
            const sourceType = builder?.getSourceType?.();
            // 用户在 Univer 内上传的图片可能以 UUID 存储，UUID 本身不是可加载的 URL。
            // 先通过 Univer 图片服务解析为真实地址，再写入单元格，否则插入失败后旧代码仍会
            // 删除浮动图，表现为点击“转为单元格图片”后图片从当前格消失。
            if (sourceType === ImageSourceType.UUID) {
              const imageIo = api?._injector?.get?.(IImageIoService);
              source = await imageIo?.getImage?.(source);
              if (!source) continue;
            }

            const from = img._image?.sheetTransform?.from ?? img._image?.axisAlignSheetTransform?.from;
            const row = typeof from?.row === "number" ? from.row : fbRow;
            const col = typeof from?.column === "number" ? from.column : fbCol;
            const targetRange = ws.getRange(row, col);
            // 删除浮动图失败时需要回滚刚插入的 Cell Image，保证不会留下两张叠图（上层那张仍可拖动）。
            const previousCellData = targetRange.getCellData?.();
            const cellBackup = previousCellData == null
              ? null
              : JSON.parse(JSON.stringify(previousCellData));

            targetRange.activate?.();
            const inserted = await targetRange.insertCellImageAsync(source);
            // 只有 Cell Image 真正落入原锚点格后才允许删除浮动图；失败时原图原位保留。
            if (inserted !== true) continue;

            const removed = img.remove?.() === true;
            if (!removed) {
              targetRange.setValue?.(cellBackup);
              continue;
            }
            converted += 1;
          } catch {
            // 单张失败保留原浮动图，不阻断其余；绝不能以“转换失败”为代价删除用户图片。
          }
        }
        restoreSelection();
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

    // 复用 Univer 原生色板，并用自定义包装组件增加“最近使用颜色”。组件管理器支持同名覆盖；
    // 先删除内置项可避免覆盖时输出无意义的 already exists 警告。
    const recentColorStorageKey = `inogi.rd-sheet.recent-colors.v1:${recentColorOwnerKey}`;
    const componentManager = univerAPI.getComponentManager();
    const RecentColorPickerForCurrentUser = (pickerProps: IColorPickerProps) => (
      <RDSheetRecentColorPicker {...pickerProps} storageKey={recentColorStorageKey} />
    );
    componentManager.delete(COLOR_PICKER_COMPONENT);
    componentManager.register(COLOR_PICKER_COMPONENT, RecentColorPickerForCurrentUser);

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
  }, [recentColorOwnerKey]);

  return <div ref={containerRef} style={{ height: "70vh", minHeight: 480 }} />;
});

export default RDSheetUniver;
