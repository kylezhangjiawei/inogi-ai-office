import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import {
  AlertTriangle,
  FileSpreadsheet,
  History,
  ImageDown,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  Rows3,
  Save,
  Upload,
} from "lucide-react";
import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { Button } from "./components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { HorizonPageHeader } from "./components/horizon/HorizonPage";
import { cn } from "./components/ui/utils";
import {
  fetchRdSheetWorkbook,
  fetchRdSheetVersions,
  restoreRdSheetVersion,
  saveRdSheetWorkbook,
  type RdApiError,
  type RdSheetVersionMeta,
} from "./lib/rdApi";
import { externalizeSnapshotImages } from "./lib/rdSheetAssets";
import { clearRdSheetDraft, loadRdSheetDraft, saveRdSheetDraft } from "./lib/rdSheetDraft";
import { xlsxToUniverSnapshot } from "./lib/xlsxToUniver";
import { t, useI18n } from "./lib/i18n";
import type { RDSheetUniverHandle } from "./RDSheetUniver";

// Univer 编辑器体积大：惰性加载（含 CSS）。本页自身已是懒加载路由 chunk，
// 在模块顶层就发起编辑器 chunk 预取 → 与工作簿数据请求并行下载，省掉一次串行等待。
const univerEditorModule = import("./RDSheetUniver");
const LazyUniverEditor = React.lazy(() => univerEditorModule);

const WORKBOOK_ID = "rd-sheet-workbook";
type Snapshot = Record<string, unknown>;

type SheetConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "brand" | "danger";
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 研发数据表（B2：高保真 Univer 工作簿，已去除行级密级）。
 *
 * - 导入 xlsx 用 ExcelJS 解析 → 构建 Univer 快照（浮动图/内嵌图/合并/行高列宽原样还原）。
 * - 整簿快照存后端 rd.sheets；page:rd-sheet 只读查看，rd-sheet:edit 方可编辑保存。
 * - 保存时先「图片出仓」（base64 → OSS 资产 URL，见 rdSheetAssets），快照瘦身后再 PUT，
 *   根治大快照上传超时；上传失败的图保留 base64，不影响功能。
 * - 数据安全三重兜底：本地 IndexedDB 草稿（自动 30s + 保存失败即写）、保存失败自动重试、
 *   服务端历史版本（每次保存自动留档，最近 10 版可恢复）。
 * - 多人编辑用乐观锁（base_updated_at）：他人已保存时返回 409，由用户决定覆盖或放弃。
 */
export function RDSheetPage() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const userPerms = user?.permissions ?? [];
  const canEdit = hasPermission(userPerms, PERMISSIONS.RD_SHEET_EDIT);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 历史版本
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<RdSheetVersionMeta[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<SheetConfirmation | null>(null);

  const handleRef = useRef<RDSheetUniverHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const versionsRequestIdRef = useRef(0);
  const dirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const blockerPromptedRef = useRef(false);
  /** 乐观锁基线：当前编辑内容基于的服务器版本时间戳 */
  const baseUpdatedAtRef = useRef<string | null>(null);
  /** 会话级图片出仓缓存（dataURL → 资产 URL），避免每次保存重复上传同一图片 */
  const assetCacheRef = useRef(new Map<string, string | null>());
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirmation = useCallback((next: SheetConfirmation) => {
    confirmationResolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      confirmationResolverRef.current = resolve;
      setConfirmation(next);
    });
  }, []);

  const settleConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => () => {
    confirmationResolverRef.current?.(false);
    confirmationResolverRef.current = null;
  }, []);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  /** 把编辑器当前内容写入本地草稿（IndexedDB）。dirty 才写；返回是否写成功。 */
  const writeDraft = useCallback(async () => {
    if (!dirtyRef.current) return false;
    const snap = handleRef.current?.getSnapshot();
    if (!snap) return false;
    return saveRdSheetDraft({
      // IWorkbookData 运行时即纯 JSON 对象，只是类型上缺索引签名 → 经 unknown 转
      snapshot: snap as unknown as Snapshot,
      saved_at: new Date().toISOString(),
      base_updated_at: baseUpdatedAtRef.current,
    });
  }, []);

  const load = useCallback(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoading(true);
    setError(null);
    fetchRdSheetWorkbook(controller.signal)
      .then(async (res) => {
        if (loadRequestIdRef.current !== requestId) return;
        baseUpdatedAtRef.current = res.updated_at;
        // 本地草稿恢复：上次保存失败 / 页面意外关闭时的兜底
        let restoredFromDraft = false;
        if (canEdit) {
          const draft = await loadRdSheetDraft();
          if (loadRequestIdRef.current !== requestId) return;
          if (draft) {
            const draftTime = new Date(draft.saved_at).toLocaleString();
            const stale = !!draft.base_updated_at && draft.base_updated_at !== res.updated_at;
            const restoreDraft = await requestConfirmation({
              title: stale ? t("恢复存在版本差异的本地草稿？") : t("恢复本地未保存草稿？"),
              description: stale
                ? t("检测到 {time} 的本地未保存草稿，但服务器在此之后已有新的保存版本。恢复草稿会显示你的版本，保存时仍会要求你决定是否覆盖服务器。", { time: draftTime })
                : t("检测到 {time} 的本地未保存草稿，可能由保存失败或页面意外关闭产生。", { time: draftTime }),
              confirmLabel: t("恢复草稿"),
              cancelLabel: t("使用服务器版本"),
              tone: stale ? "danger" : "brand",
            });
            if (loadRequestIdRef.current !== requestId || controller.signal.aborted) return;
            if (restoreDraft) {
              // 乐观锁基线用「草稿基于的版本」而非最新服务器版本：草稿过期时保存会正常触发
              // 409 冲突提示，由用户显式决定是否覆盖他人的新版本，而不是无提示覆盖。
              baseUpdatedAtRef.current = draft.base_updated_at ?? res.updated_at;
              setSnapshot(draft.snapshot as Snapshot);
              setReloadKey((k) => k + 1);
              setDirty(true);
              setNotice(t("已恢复本地草稿，请检查内容后点「保存」。"));
              restoredFromDraft = true;
            } else {
              void clearRdSheetDraft();
            }
          }
        }
        if (!restoredFromDraft) {
          setSnapshot(res.snapshot);
          setReloadKey((k) => k + 1);
          setDirty(false);
        }
      })
      .catch((e) => {
        if (controller.signal.aborted || loadRequestIdRef.current !== requestId) return;
        setError(e instanceof Error ? e.message : t("加载数据表失败"));
      })
      .finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadAbortRef.current = null;
        setLoading(false);
      });
  }, [canEdit, requestConfirmation]);

  useEffect(() => {
    load();
    return () => {
      loadRequestIdRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
    };
  }, [load]);

  // 草稿自动落盘：每 30s + 页面切后台/最小化时立即写，最大限度缩小意外丢失窗口。
  useEffect(() => {
    if (!canEdit) return;
    const timer = window.setInterval(() => void writeDraft(), 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void writeDraft();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canEdit, writeDraft]);

  // 关闭/刷新浏览器标签前的原生拦截（应用内导航由下方 useBlocker 拦截）。
  useEffect(() => {
    if (!(canEdit && dirty)) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canEdit, dirty]);

  // 离开前拦截未保存改动（仅编辑者且有改动时）。
  const blocker = useBlocker(canEdit && dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") {
      blockerPromptedRef.current = false;
      return;
    }
    if (blockerPromptedRef.current) return;
    blockerPromptedRef.current = true;
    void requestConfirmation({
      title: t("离开研发数据表？"),
      description: t("研发数据表有未保存的修改。继续离开将放弃本页尚未保存的内容。"),
      confirmLabel: t("放弃改动并离开"),
      cancelLabel: t("留在本页"),
      tone: "danger",
    }).then((shouldLeave) => {
      blockerPromptedRef.current = false;
      if (shouldLeave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, requestConfirmation]);

  const handleImportFile = useCallback(async (file: File) => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const buf = await file.arrayBuffer();
      const snap = await xlsxToUniverSnapshot(buf, WORKBOOK_ID);
      const sheetCount = Array.isArray((snap as { sheetOrder?: unknown[] }).sheetOrder)
        ? (snap as { sheetOrder: unknown[] }).sheetOrder.length
        : 0;
      const shouldImport = await requestConfirmation({
        title: t("导入并替换整个工作簿？"),
        description:
          t("将用「{file}」（{count} 个工作表）整簿替换当前研发数据表。", { file: file.name, count: sheetCount }) + " " +
          t("导入后需点「保存」才会写入服务器，也可用「撤销改动」还原。"),
        confirmLabel: t("导入并替换"),
        cancelLabel: t("取消导入"),
        tone: "danger",
      });
      if (!shouldImport) {
        return;
      }
      setSnapshot(snap as Snapshot);
      setReloadKey((k) => k + 1);
      setDirty(true);
      setNotice(t("已从「{file}」导入 {count} 个工作表（含图片/合并/样式），点「保存」生效。", { file: file.name, count: sheetCount }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("导入失败，请确认文件是有效的 .xlsx"));
    } finally {
      setImporting(false);
    }
  }, [requestConfirmation]);

  const handleImportChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void handleImportFile(file);
    },
    [handleImportFile],
  );

  const handleSave = useCallback(async () => {
    if (!canEdit || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await handleRef.current?.commitPendingEdit();
      const currentSnapshot = handleRef.current?.getSnapshot();
      if (!currentSnapshot) throw new Error(t("无法获取编辑器数据，请重试"));
      const saveRevision = editRevisionRef.current;
      // 固定本次提交快照；保存期间即使编辑器仍收到输入，也不能把后续改动混进本次请求。
      const snap = structuredClone(currentSnapshot) as unknown as Snapshot;

      // ① 图片出仓：base64 → OSS 资产 URL，快照瘦身后再上传（根治大包超时）。
      //    任何一张失败都保留 base64 继续保存，功能不受影响。
      const assetStats = await externalizeSnapshotImages(
        snap as unknown as Snapshot,
        assetCacheRef.current,
        (done, total) => setNotice(t("正在转存图片资源 {done}/{total}…", { done, total })),
      );

      // ② 保存：乐观锁 + 网络类错误自动重试（最多 3 次），409 冲突交用户裁决。
      let force = false;
      let result: { updated_at: string; updated_by: string | null } | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          setNotice(attempt > 0 ? t("保存中（第 {n} 次重试）…", { n: attempt }) : null);
          result = await saveRdSheetWorkbook(snap, {
            baseUpdatedAt: baseUpdatedAtRef.current,
            force,
          });
          break;
        } catch (e) {
          const status = (e as RdApiError).status;
          if (status === 409) {
            const overwrite = await requestConfirmation({
              title: t("检测到保存冲突"),
              description:
                (e instanceof Error && e.message ? e.message : t("保存冲突：他人已保存了新版本。")) + " " +
                t("覆盖后，对方版本会进入历史版本并可恢复；如不覆盖，你的改动仍保留在页面与本地草稿中。"),
              confirmLabel: t("覆盖服务器版本"),
              cancelLabel: t("保留我的改动"),
              tone: "danger",
            });
            if (!overwrite) {
              throw new Error(t("已取消保存。你的改动仍在页面与本地草稿中，可先「历史版本」查看对方版本再决定。"));
            }
            force = true;
            continue;
          }
          // 无状态码 = 网络中断/超时/网关错误 → 自动重试；有状态码的业务错误直接抛出
          if (status === undefined && attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }

      baseUpdatedAtRef.current = result!.updated_at;
      const hasNewerEdits = editRevisionRef.current !== saveRevision;
      const savedNotice = assetStats.uploaded > 0
        ? t("已保存。{count} 张图片已转存至对象存储，后续打开/保存将显著提速。", { count: assetStats.uploaded })
          : t("已保存。");
      if (hasNewerEdits) {
        dirtyRef.current = true;
        setDirty(true);
        void writeDraft();
        setNotice(savedNotice + " " + t("保存期间仍有新改动，请再次保存。"));
      } else {
        dirtyRef.current = false;
        setDirty(false);
        void clearRdSheetDraft();
        setNotice(savedNotice);
      }
    } catch (e) {
      // 失败兜底：立即把当前内容写入本地草稿，明确告知用户数据没丢
      const persisted = await writeDraft();
      const base = e instanceof Error ? e.message : t("保存失败");
      setError(
        persisted
          ? base + " " + t("你的改动已保留在本地草稿：留在本页可直接重试保存；关闭页面后重新进入也可恢复。")
          : base + " " + t("请勿关闭页面，稍后点「保存」重试。"),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [canEdit, requestConfirmation, writeDraft]);

  const handleUndo = useCallback(async () => {
    if (dirty) {
      const shouldUndo = await requestConfirmation({
        title: t("撤销全部未保存改动？"),
        description: t("将放弃自上次保存以来的所有改动，并从服务器重新加载当前工作簿。"),
        confirmLabel: t("撤销并重新加载"),
        cancelLabel: t("保留改动"),
        tone: "danger",
      });
      if (!shouldUndo) return;
    }
    setNotice(null);
    if (dirty) await clearRdSheetDraft();
    load();
  }, [dirty, load, requestConfirmation]);

  // 把粘贴/导入产生的「浮动图片」转成「单元格图片」（嵌入格子、随保存往返）。
  const handleConvertImages = useCallback(async () => {
    if (!canEdit) return;
    setError(null);
    setNotice(null);
    setConverting(true);
    try {
      const res = await handleRef.current?.convertFloatingImagesToCells();
      if (!res || res.total === 0) {
        setNotice(t("当前工作表没有浮动图片可转换。"));
        return;
      }
      setNotice(
        res.converted === res.total
          ? t("已将 {count} 张浮动图片转为单元格图片，点「保存」生效。", { count: res.converted })
          : t("已转换 {converted}/{total} 张（其余转换失败已跳过），点「保存」生效。", { converted: res.converted, total: res.total }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("转换失败"));
    } finally {
      setConverting(false);
    }
  }, [canEdit]);

  // 自适应行高：选中多行只调选中行；单格/未选中调整整表数据范围。行标记为自动高度后随内容持续自适应。
  const handleAutoFitRows = useCallback(() => {
    if (!canEdit) return;
    setError(null);
    setNotice(null);
    const res = handleRef.current?.autoFitRows();
    if (!res || res.rows === 0) {
      setError(t("自适应行高执行失败，请重试"));
      return;
    }
    setNotice(
      res.scope === "selection"
        ? t("已对选中的 {count} 行开启自适应行高（随内容自动调整），点「保存」生效。", { count: res.rows })
        : t("已对整表 {count} 行开启自适应行高（随内容自动调整），点「保存」生效。", { count: res.rows }),
    );
  }, [canEdit]);

  const loadVersions = useCallback(async () => {
    const requestId = versionsRequestIdRef.current + 1;
    versionsRequestIdRef.current = requestId;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const list = await fetchRdSheetVersions();
      if (versionsRequestIdRef.current !== requestId) return;
      setVersions(list);
    } catch (e) {
      if (versionsRequestIdRef.current !== requestId) return;
      setVersionsError(e instanceof Error ? e.message : t("历史版本读取失败"));
    } finally {
      if (versionsRequestIdRef.current === requestId) setVersionsLoading(false);
    }
  }, []);

  // 历史版本：打开对话框时拉取列表；关闭或重新打开会让旧请求失效。
  useEffect(() => {
    if (!showVersions) return undefined;
    void loadVersions();
    return () => {
      versionsRequestIdRef.current += 1;
    };
  }, [loadVersions, showVersions]);

  const handleRestoreVersion = useCallback(
    async (version: RdSheetVersionMeta) => {
      const when = new Date(version.updated_at).toLocaleString();
      const shouldRestore = await requestConfirmation({
        title: t("恢复历史版本？"),
        description:
          (dirtyRef.current ? t("当前有未保存的改动，恢复后将被历史版本替换。") + " " : "") +
          t("将恢复到 {time} 的版本；当前服务器版本会自动留档，可再次恢复。", { time: when }),
        confirmLabel: t("确认恢复"),
        cancelLabel: t("取消"),
        tone: "danger",
      });
      if (!shouldRestore) return;
      setRestoringId(version.id);
      try {
        await restoreRdSheetVersion(version.id);
        setShowVersions(false);
        dirtyRef.current = false;
        setDirty(false);
        await clearRdSheetDraft();
        setNotice(t("已恢复到 {time} 的版本。", { time: when }));
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("恢复失败"));
      } finally {
        setRestoringId(null);
      }
    },
    [load, requestConfirmation],
  );

  return (
    <main
      className="horizon-theme hz-page rd-horizon-module rd-horizon-sheet relative flex min-h-full min-w-0 flex-col bg-transparent text-slate-900"
      aria-busy={loading || saving || importing || converting}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportChange}
      />

      <HorizonPageHeader
        Icon={FileSpreadsheet}
        titleLevel={2}
        eyebrow={t("研发协同 / 共享数据资产")}
        title={t("研发数据表")}
        description={t("高保真导入 / 编辑 xlsx 工作簿，完整保留图片、合并单元格与样式。")}
        meta={(
          <>
            <span>{canEdit ? t("可编辑") : t("只读")}</span>
            <span aria-hidden="true">·</span>
            <span>{dirty ? t("有未保存改动") : t("已与服务器同步")}</span>
          </>
        )}
        className="rd-horizon-sheet-command"
        actions={(
          <div className="rd-horizon-sheet-actions flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleUndo()}
              disabled={loading || saving || importing}
              className="rd-horizon-sheet-action h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              title={t("从服务器重新加载（放弃未保存改动）")}
            >
              <RotateCcw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              {canEdit ? t("撤销改动") : t("刷新")}
            </Button>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowVersions(true)}
                disabled={loading || saving || importing}
                className="rd-horizon-sheet-action h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                title={t("查看/恢复服务器自动留档的历史版本（最近 10 版）")}
              >
                <History className="size-4" aria-hidden="true" />
                {t("历史版本")}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAutoFitRows}
                disabled={loading || saving || importing}
                className="rd-horizon-sheet-action h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                title={t("按内容自动调整行高：框选多行只调整选中行；未框选则调整整表。调整后新增内容会持续自适应")}
              >
                <Rows3 className="size-4" aria-hidden="true" />
                {t("自适应行高")}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleConvertImages()}
                disabled={converting || importing || saving || loading}
                className="rd-horizon-sheet-action h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                title={t("把粘贴/导入进来的浮动图片转成嵌入单元格的图片（转换后点保存）")}
              >
                {converting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ImageDown className="size-4" aria-hidden="true" />}
                {converting ? t("转换中…") : t("转为单元格图片")}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing || saving || loading}
                className="rd-horizon-sheet-action rd-horizon-sheet-import h-9 gap-2 rounded-lg border-[#002fa7]/20 bg-white px-3 text-sm font-semibold text-[#002fa7] hover:bg-[#eef3ff]"
              >
                {importing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
                {importing ? t("解析中…") : t("导入 xlsx")}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || importing || loading || !dirty}
                className="rd-horizon-sheet-primary hz-primary-action h-9 gap-2 rounded-lg bg-[#002fa7] px-4 text-sm font-semibold text-white hover:bg-[#002581] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {saving ? t("保存中…") : t("保存")}
              </Button>
            )}
          </div>
        )}
      />

      {/* 提示 / 错误 */}
      <div className="rd-horizon-sheet-feedback mx-4 mt-3 space-y-2 sm:mx-6">
        <div className="rd-horizon-sheet-guidance flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-pretty text-xs text-slate-600">
          {canEdit ? (
            <>
              <Info className="mt-0.5 size-4 shrink-0 text-[#002fa7]" aria-hidden="true" />
              <span>
                {t("已接入 Univer Sheets 编辑器，支持多工作表、合并单元格、图片与样式。")}{" "}
                <strong className="text-slate-700">{t("「导入 xlsx」会整簿替换")}</strong>{" "}{t("当前数据；编辑或导入后点「保存」生效。")}{" "}
                {t("改动会每 30 秒自动备份到本机，保存失败或页面意外关闭均可恢复。")}
              </span>
            </>
          ) : (
            <>
              <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span>{t("你拥有")} {" "}<strong className="text-slate-700">{t("只读")}</strong>{" "}{t("查看权限。如需编辑 / 导入 / 保存，请联系管理员分配「编辑研发数据表」权限。")}</span>
            </>
          )}
        </div>
        {notice && (
          <div className="rd-horizon-sheet-notice rounded-xl border border-[#002fa7]/15 bg-[#eef3ff] px-3 py-2 text-xs font-medium text-[#002fa7]" role="status" aria-live="polite">{notice}</div>
        )}
        {error && snapshot && (
          <div className="rd-horizon-sheet-error rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600" role="alert">{error}</div>
        )}
      </div>

      {/* 编辑器 */}
      <div className="rd-horizon-sheet-editor mx-4 mb-6 mt-3 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:mx-6">
        {loading || !snapshot ? (
          <div className="rd-horizon-sheet-state flex h-[70vh] min-h-[480px] items-center justify-center px-6 text-sm text-slate-500" role={error ? "alert" : "status"} aria-live="polite">
            {error ? (
              <div className="max-w-lg text-center">
                <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-600" aria-hidden="true"><AlertTriangle className="size-5" /></span>
                <h2 className="mt-4 text-balance font-semibold text-slate-900">{t("研发数据表加载失败")}</h2>
                <p className="mt-2 break-words text-pretty text-sm text-slate-600">{error}</p>
                <Button type="button" variant="outline" className="mt-4" onClick={() => void load()} disabled={loading}>
                  <RotateCcw className="size-4" aria-hidden="true" />{t("重新加载")}
                </Button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-2 text-pretty">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("正在加载工作簿与编辑器…")}
              </span>
            )}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="rd-horizon-sheet-state flex h-[70vh] min-h-[480px] items-center justify-center text-sm text-slate-400" role="status">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("编辑器加载中…")}
                </span>
              </div>
            }
          >
            <LazyUniverEditor
              key={reloadKey}
              ref={handleRef}
              snapshot={snapshot as never}
              lang={lang}
              readOnly={!canEdit || saving}
              recentColorOwnerKey={user?.id}
              onDirty={() => {
                editRevisionRef.current += 1;
                dirtyRef.current = true;
                setDirty(true);
              }}
            />
          </Suspense>
        )}
      </div>

      {/* 历史版本对话框 */}
      <Dialog open={showVersions} onOpenChange={setShowVersions}>
        <DialogContent className="horizon-portal rd-horizon-sheet-dialog max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("历史版本")}</DialogTitle>
            <DialogDescription>
              {t("每次保存服务器都会自动留档最近 10 版。恢复时当前版本也会先留档，可随时恢复回来。")}
            </DialogDescription>
          </DialogHeader>
          {versionsLoading ? (
            <div className="flex items-center justify-center py-8 text-pretty text-sm text-slate-500" role="status" aria-live="polite">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> {t("正在加载历史版本…")}
            </div>
          ) : versionsError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-center" role="alert">
              <p className="text-balance text-sm font-semibold text-red-700">{t("历史版本读取失败")}</p>
              <p className="mt-1 break-words text-pretty text-xs text-red-600">{versionsError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadVersions()} disabled={versionsLoading}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> {t("重新读取")}
              </Button>
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="py-8 text-center text-pretty text-sm text-slate-500" role="status">{t("暂无历史版本。完成首次保存后，系统会在这里保留最近 10 个版本。")}</div>
          ) : (
            <div className="rd-horizon-sheet-version-list max-h-80 space-y-2 overflow-y-auto pr-1">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="rd-horizon-sheet-version flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <time className="text-sm font-medium tabular-nums text-slate-800" dateTime={v.updated_at}>{new Date(v.updated_at).toLocaleString()}</time>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {(v.updated_by_name || v.updated_by || t("未知用户"))} · {formatBytes(v.size_bytes)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={restoringId !== null}
                    onClick={() => void handleRestoreVersion(v)}
                    className="rd-horizon-sheet-restore h-8 shrink-0 rounded-lg border-[#002fa7]/20 px-3 text-xs font-semibold text-[#002fa7] hover:bg-[#eef3ff]"
                  >
                    {restoringId === v.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : t("恢复")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) settleConfirmation(false);
        }}
      >
        <AlertDialogContent className="horizon-portal rd-horizon-sheet-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">
              {confirmation?.title ?? t("请确认操作")}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-pretty text-slate-600">
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirmation(false)}>
              {confirmation?.cancelLabel ?? t("取消")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "text-white",
                confirmation?.tone === "danger"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-[#002fa7] hover:bg-[#002581]",
              )}
              onClick={() => settleConfirmation(true)}
            >
              {confirmation?.confirmLabel ?? t("确认")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
