import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import {
  FileSpreadsheet,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
import { fetchRdSheetWorkbook, saveRdSheetWorkbook } from "./lib/rdApi";
import { xlsxToUniverSnapshot } from "./lib/xlsxToUniver";
import type { RDSheetUniverHandle } from "./RDSheetUniver";

// Univer 编辑器体积大：惰性加载（含 CSS），普通成员只读也走它以保真展示。
const LazyUniverEditor = React.lazy(() => import("./RDSheetUniver"));

const WORKBOOK_ID = "rd-sheet-workbook";
type Snapshot = Record<string, unknown>;

/**
 * 研发数据表（B2：高保真 Univer 工作簿，已去除行级密级）。
 *
 * - 导入 xlsx 用 ExcelJS 解析 → 构建 Univer 快照（浮动图/内嵌图/合并/行高列宽原样还原，图片 base64 内嵌）。
 * - 整簿快照存后端 rd.sheets；page:rd-sheet 只读查看，rd-sheet:edit 方可编辑保存。
 * - 不再有「密级」列与行级裁剪：有页面权限即看全量。
 */
export function RDSheetPage() {
  const { user } = useAuth();
  const userPerms = user?.permissions ?? [];
  const canEdit = hasPermission(userPerms, PERMISSIONS.RD_SHEET_EDIT);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleRef = useRef<RDSheetUniverHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchRdSheetWorkbook()
      .then((res) => {
        setSnapshot(res.snapshot);
        setReloadKey((k) => k + 1);
        setDirty(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载数据表失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 离开前拦截未保存改动（仅编辑者且有改动时）。
  const blocker = useBlocker(canEdit && dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("研发数据表有未保存的修改，确定离开吗？")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

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
      if (!window.confirm(
        `将用「${file.name}」（${sheetCount} 个工作表）整簿替换当前研发数据表。\n` +
          `导入后需点「保存」才会写入服务器，或用「撤销改动」还原。是否继续？`,
      )) {
        return;
      }
      setSnapshot(snap as Snapshot);
      setReloadKey((k) => k + 1);
      setDirty(true);
      setNotice(`已从「${file.name}」导入 ${sheetCount} 个工作表（含图片/合并/样式），点「保存」生效。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请确认文件是有效的 .xlsx");
    } finally {
      setImporting(false);
    }
  }, []);

  const handleImportChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void handleImportFile(file);
    },
    [handleImportFile],
  );

  const handleSave = useCallback(async () => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await handleRef.current?.commitPendingEdit();
      const snap = handleRef.current?.getSnapshot();
      if (!snap) throw new Error("无法获取编辑器数据，请重试");
      await saveRdSheetWorkbook(snap);
      setDirty(false);
      setNotice("已保存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [canEdit]);

  const handleUndo = useCallback(() => {
    if (dirty && !window.confirm("放弃自上次保存以来的所有改动，从服务器重新加载？")) return;
    setNotice(null);
    load();
  }, [dirty, load]);

  return (
    <div className="relative min-h-full bg-slate-50/30 flex flex-col text-slate-900">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportChange}
      />

      {/* Header */}
      <div className="relative mx-4 mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.06)] sm:mx-6">
        <div className="relative z-10 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3 text-xl font-semibold text-slate-950">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-[0_10px_22px_rgba(79,70,229,0.22)]">
                <FileSpreadsheet className="w-4 h-4" />
              </span>
              <span className="truncate">研发数据表</span>
            </h1>
            <p className="mt-1.5 text-sm font-medium text-slate-500">
              高保真导入 / 编辑 xlsx 工作簿（图片、合并单元格、样式原样保留）
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleUndo}
              disabled={loading || saving || importing}
              className="h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              title="从服务器重新加载（放弃未保存改动）"
            >
              <RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
              {canEdit ? "撤销改动" : "刷新"}
            </Button>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing || saving || loading}
                className="h-9 gap-2 rounded-lg border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importing ? "解析中…" : "导入 xlsx"}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || importing || loading || !dirty}
                className="h-9 gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(79,70,229,0.20)] hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "保存中…" : "保存"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 提示 / 错误 */}
      <div className="mx-4 mt-3 sm:mx-6 space-y-2">
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          {canEdit ? (
            <>
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
              <span>
                已接入 Univer Sheets 编辑器，支持多工作表、合并单元格、图片与样式。
                <strong className="text-slate-700">「导入 xlsx」会整簿替换</strong>当前数据；编辑或导入后点「保存」生效。
              </span>
            </>
          ) : (
            <>
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>你拥有<strong className="text-slate-700">只读</strong>查看权限。如需编辑 / 导入 / 保存，请联系管理员分配「编辑研发数据表」权限。</span>
            </>
          )}
        </div>
        {notice && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs font-medium text-indigo-700">{notice}</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</div>
        )}
      </div>

      {/* 编辑器 */}
      <div className="mx-4 mb-6 mt-3 flex-1 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.06)] sm:mx-6">
        {loading || !snapshot ? (
          <div className="flex h-[70vh] min-h-[480px] items-center justify-center text-sm text-slate-400">
            {error ? error : (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
              </span>
            )}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-[70vh] min-h-[480px] items-center justify-center text-sm text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> 编辑器加载中…
                </span>
              </div>
            }
          >
            <LazyUniverEditor
              key={reloadKey}
              ref={handleRef}
              snapshot={snapshot as never}
              readOnly={!canEdit}
              onDirty={() => setDirty(true)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
