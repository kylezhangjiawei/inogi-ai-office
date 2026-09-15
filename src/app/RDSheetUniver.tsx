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
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { ISheetDrawingService, UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import sheetsDrawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import sheetsDrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import type { IWorkbookData, Univer, FUniver } from "@univerjs/presets";
import { RDSheetRecentColorPicker } from "./RDSheetRecentColorPicker";
import { applyUniverImageSources, collectSheetImageSources } from "./lib/rdSheetAssets";

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
  getImageSources: () => string[];
  applyImageSources: (replacements: ReadonlyMap<string, string>) => boolean;
  /** 提交飞行中编辑（保存前调用，避免正在输入的内容被丢弃）。 */
  commitPendingEdit: () => Promise<void>;
  /**
   * 把当前工作表的「浮动图片」（粘贴/导入产生的悬浮图，Drawing）转换为「单元格图片」（嵌入格子、随快照往返）。
   * 逐张：读取图源 → 插入到其锚点单元格（读不到锚点则退回当前选中格）→ 确认成功后删除原浮动图。返回转换数量。
   */
  convertFloatingImagesToCells: () => Promise<{ converted: number; total: number }>;
  /**
   * 自适应行高：选中多行/多列时只调整选中行；单格或无选区时调整整表数据范围。
   * 行被标记为自动高度（ia=1）后随内容变化持续自适应，且随快照保存往返。
   */
  autoFitRows: () => { rows: number; scope: "selection" | "sheet" };
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
  /** Univer 内置菜单语言；切换语言时由父组件通过 key 重建编辑器。 */
  lang: "zh" | "en";
};

export const RDSheetUniver = forwardRef<RDSheetUniverHandle, Props>(function RDSheetUniver(
  { snapshot, onDirty, recentColorOwnerKey = "anonymous", lang },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<Univer | null>(null);
  const apiRef = useRef<FUniver | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  // Univer 暂无无损热切换语言入口；固定本次装载语言，避免切换全站语言时重建编辑器并丢失未保存修改。
  const initialLangRef = useRef(lang);
  const loadedRef = useRef(false);
  const renewingImagesRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      getImageSources: () => collectSheetImageSources(apiRef.current?.getActiveWorkbook()?.save()),
      applyImageSources: (replacements) => {
        if (!apiRef.current || !loadedRef.current) return false;
        renewingImagesRef.current = true;
        try {
          // The drawing preset exports its service identifier; use the editor's existing injector instance.
          const api = apiRef.current as FUniver & { _injector: { get: (id: unknown) => unknown } };
          return applyUniverImageSources(api, api._injector.get(ISheetDrawingService), replacements);
        } finally {
          renewingImagesRef.current = false;
        }
      },
      getSnapshot: () => {
        try {
          const wb = apiRef.current?.getActiveWorkbook();
          const snap = wb?.save() ?? null;
          if (!snap) return null;
          // 固化自动行高：save() 导出的 rowData.ah 可能与当前展示高度不同步（自动高度重算
          // 是异步分帧的），重载后 ia 行会以过期的 ah/h 渲染（实测塌回默认 24），直到再次编辑才恢复。
          // 这里以运行时行高（getRowHeight 聚合 ah 口径）为准写回 ah 与 h，重载初始渲染即正确。
          try {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const sheets = (snap as any).sheets ?? {};
            for (const [sheetId, sheetData] of Object.entries<any>(sheets)) {
              const rowData = sheetData?.rowData;
              if (!rowData || typeof rowData !== "object") continue;
              const fws = (wb as any).getSheetBySheetId?.(sheetId);
              if (!fws) continue;
              for (const [rStr, row] of Object.entries<any>(rowData)) {
                if (!row || row.ia !== 1) continue;
                const runtimeH = fws.getRowHeight?.(Number(rStr));
                if (typeof runtimeH === "number" && runtimeH > 0) {
                  row.ah = runtimeH;
                  row.h = runtimeH;
                }
              }
            }
            /* eslint-enable @typescript-eslint/no-explicit-any */
          } catch {
            /* 固化失败不阻塞保存：仅重载初始行高可能偏小 */
          }
          return snap;
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
      autoFitRows: () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const api = apiRef.current as any;
        const ws = api?.getActiveWorkbook?.()?.getActiveSheet?.();
        if (!ws) return { rows: 0, scope: "sheet" as const };

        // 列只覆盖到数据范围：整表两万行 × 全列写 wrap 样式会撑爆快照
        const lastCol = Math.max(0, ws.getLastColumn?.() ?? 0);
        const lastRow = Math.max(0, ws.getLastRow?.() ?? 0);

        // 选区行数>1 视为「明确框选」→ 只调选中行；单格/无选区 → 调整表数据范围
        const ranges: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }> = [];
        try {
          const list = ws.getSelection?.()?.getActiveRangeList?.() ?? [];
          for (const r of Array.isArray(list) ? list : []) {
            const range = r?._range ?? {
              startRow: r?.getRow?.(),
              endRow: (r?.getRow?.() ?? 0) + (r?.getHeight?.() ?? 1) - 1,
            };
            if (typeof range?.startRow === "number" && typeof range?.endRow === "number") {
              ranges.push({
                startRow: range.startRow,
                endRow: Math.min(range.endRow, 100_000),
                startColumn: 0,
                endColumn: lastCol,
              });
            }
          }
        } catch { /* 拿不到选区走整表 */ }

        const meaningful = ranges.some((r) => r.endRow > r.startRow);
        let scope: "selection" | "sheet" = "selection";
        let targets = ranges;
        if (!meaningful) {
          scope = "sheet";
          targets = [{ startRow: 0, endRow: lastRow, startColumn: 0, endColumn: lastCol }];
        }

        try {
          // 与 Univer 官方 autoFitRow 同序：先开自动换行（自动行高只对换行单元格按多行测量，
          // 否则长文本被视作单行溢出、行高恒为默认值），再标记行自动高度（ia=1，持续自适应）。
          for (const r of targets) {
            ws.getRange(r.startRow, 0, r.endRow - r.startRow + 1, lastCol + 1)?.setWrap?.(true);
          }
          ws.setRangesAutoHeight?.(targets);
        } catch {
          return { rows: 0, scope };
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const rows = targets.reduce((acc, r) => acc + (r.endRow - r.startRow + 1), 0);
        if (rows > 0) onDirtyRef.current?.();
        return { rows, scope };
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    loadedRef.current = false;

    const univerLocale = initialLangRef.current === "en" ? LocaleType.EN_US : LocaleType.ZH_CN;
    const localeMessages = initialLangRef.current === "en"
      ? merge({}, sheetsCoreEnUS, sheetsDrawingEnUS)
      : merge({}, sheetsCoreZhCN, sheetsDrawingZhCN);
    const { univer, univerAPI } = createUniver({
      locale: univerLocale,
      locales: { [univerLocale]: localeMessages },
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

    // 修复粘贴多行文本每行后多一个空行：Windows 剪贴板换行是 \r\n，Univer 粘贴解析按 \n 切行后
    // 每格尾部残留 \r，而 \r 恰是 Univer 文档模型的段落分隔符 → 渲染成一个空行。
    // BeforeClipboardPaste 事件只读不可改内容；直接 patch 剪贴板服务又受 identifier 双实例影响，
    // 故在命令层拦截：Ctrl+V 必经 SheetPasteShortKeyCommand，执行前原地把 \r\n / 孤立 \r 规范成 \n
    //（handler 与此处共享同一 params 对象引用）。html 路径（自 Excel/WPS 复制）无此问题，不动。
    const pasteNormalizeDisposable = univerAPI.onBeforeCommandExecute?.((commandInfo: { id?: string; params?: unknown }) => {
      if (commandInfo?.id !== "sheet.command.paste-by-short-key") return;
      const params = commandInfo.params as { textContent?: unknown } | undefined;
      if (params && typeof params.textContent === "string" && /\r/.test(params.textContent)) {
        params.textContent = params.textContent.replace(/\r\n?/g, "\n");
      }
    });

    univerAPI.createWorkbook(snapshotRef.current);

    // 初始装载结束后再监听值变更，避免装载本身触发 dirty。
    const t = window.setTimeout(() => {
      loadedRef.current = true;
    }, 0);

    let disposable: { dispose?: () => void } | null = null;
    try {
      disposable = univerAPI.addEvent(univerAPI.Event.SheetValueChanged, () => {
        if (loadedRef.current && !renewingImagesRef.current) onDirtyRef.current?.();
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
      try {
        (pasteNormalizeDisposable as { dispose?: () => void } | undefined)?.dispose?.();
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
