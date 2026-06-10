import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "./auth";
import { hasPermission, PERMISSIONS } from "./lib/permissions";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
import { fetchRdSheet, RD_MASTER_SHEET_ID, saveRdSheet, type RdSheet } from "./lib/rdApi";
import type { RDSheetUniverHandle } from "./RDSheetUniver";

// Univer 编辑器体积大且仅编辑者需要：惰性加载，普通成员永不触达此 chunk（含 CSS）。
const LazyUniverEditor = React.lazy(() => import("./RDSheetUniver"));

/**
 * 研发数据表（类 WPS 表格 · 行级密级管控）。
 *
 * 安全模型（后端强制，前端无法绕过）：
 * - 读取时后端按 viewer 的 kb_level 分值做「行级裁剪」——只下发密级 <= 自己的行，
 *   且把「密级」列整列删掉。所以非编辑者拿到的 headers/rows 本身就是脱敏后的子集，
 *   前端只负责忠实展示，不做任何隐藏逻辑（隐藏逻辑放前端会被 devtools/network 看穿）。
 * - 编辑权限（rd-sheet:edit / 超管）= 完全访问：后端不裁剪、可保存全量。
 *
 * 编辑器：
 * - 编辑者使用 Univer Sheets（惰性加载，见 RDSheetUniver.tsx），保存时按「第 0 行表头 + 其后数据行」
 *   的规整二维结构读回单元格字面值，以兼容行级密级管控。
 * - Univer 加载/渲染失败时由 UniverErrorBoundary 回退到内置基础 HTML 表格（EditableTable），编辑不中断。
 * - 普通成员走轻量只读表格（ReadOnlyTable），不加载 Univer。
 */

type Draft = {
  name: string;
  headers: string[];
  rows: string[][];
  secrecy_column: string;
};

function toDraft(sheet: RdSheet): Draft {
  return {
    name: sheet.name,
    headers: [...sheet.headers],
    rows: sheet.rows.map((r) => [...r]),
    secrecy_column: sheet.secrecy_column,
  };
}

type EditorMode = "univer" | "fallback";

/**
 * Univer 加载/渲染失败时的兜底：捕获错误并回退到基础 HTML 表格，保证编辑能力不中断。
 * （无法在本环境验证 Univer 真机渲染，故 fallback 是必备保险。）
 */
class UniverErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError?: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[RDSheet] Univer 加载/渲染失败，已回退到基础表格：", error);
    this.props.onError?.();
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function RDSheetPage() {
  const { user } = useAuth();
  const userPerms = user?.permissions ?? [];
  const canEdit = hasPermission(userPerms, PERMISSIONS.RD_SHEET_EDIT);

  const [sheet, setSheet] = useState<RdSheet | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Univer 编辑器：默认走 Univer；加载/渲染失败时由 ErrorBoundary 切到 "fallback"（HTML 表格）。
  const [editorMode, setEditorMode] = useState<EditorMode>("univer");
  // 重挂载 Univer 用：撤销改动 / 导入时 +1，从当前 draft 重新装载。
  const [reloadKey, setReloadKey] = useState(0);
  const univerHandleRef = useRef<RDSheetUniverHandle | null>(null);
  // 导入用：隐藏的文件选择器 + 导入结果提示。
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRdSheet(RD_MASTER_SHEET_ID);
      setSheet(data);
      setDraft(toDraft(data));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载数据表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── 编辑操作（仅编辑者）─────────────────────────────────────────────────
  const mutate = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }, []);

  const setCell = (r: number, c: number, value: string) =>
    mutate((d) => {
      const rows = d.rows.map((row) => [...row]);
      if (rows[r]) rows[r][c] = value;
      return { ...d, rows };
    });

  const setHeader = (c: number, value: string) =>
    mutate((d) => {
      const headers = [...d.headers];
      const prev = headers[c];
      headers[c] = value;
      // 若重命名的恰是密级控制列，同步 secrecy_column 指向，避免行级管控失效。
      const secrecy_column = d.secrecy_column === prev ? value : d.secrecy_column;
      return { ...d, headers, secrecy_column };
    });

  const addRow = () =>
    mutate((d) => ({ ...d, rows: [...d.rows, Array(d.headers.length).fill("")] }));

  const deleteRow = (r: number) =>
    mutate((d) => ({ ...d, rows: d.rows.filter((_, i) => i !== r) }));

  const addColumn = () =>
    mutate((d) => ({
      ...d,
      headers: [...d.headers, `列${d.headers.length + 1}`],
      rows: d.rows.map((row) => [...row, ""]),
    }));

  const deleteColumn = (c: number) =>
    mutate((d) => {
      const removed = d.headers[c];
      return {
        ...d,
        headers: d.headers.filter((_, i) => i !== c),
        rows: d.rows.map((row) => row.filter((_, i) => i !== c)),
        // 删掉的若是密级列，则清空指向（保存后该表暂无行级管控，全部行对有页面权限者可见）。
        secrecy_column: d.secrecy_column === removed ? "" : d.secrecy_column,
      };
    });

  const handleSave = async () => {
    if (!draft) return;
    // Univer 模式：从 Univer 当前快照读回规整二维表；否则用 HTML 表格的 draft。
    // secrecy_column / name 仍以 draft 为准（Univer 不编辑表名，密级列由后端按名定位）。
    let headers = draft.headers;
    let rows = draft.rows;
    if (editorMode === "univer" && univerHandleRef.current) {
      const data = univerHandleRef.current.getData();
      headers = data.headers;
      rows = data.rows;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRdSheet(RD_MASTER_SHEET_ID, {
        name: draft.name.trim() || "研发数据表",
        headers,
        rows,
        secrecy_column: draft.secrecy_column,
      });
      setSheet(saved);
      setDraft(toDraft(saved));
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("zh-CN"));
      setImportNotice(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!sheet) return;
    setDraft(toDraft(sheet));
    setDirty(false);
    setImportNotice(null);
    // Univer 模式无内部撤销接口：重挂载组件，从已保存数据重新装载。
    if (editorMode === "univer") setReloadKey((k) => k + 1);
  };

  // ── 导出 / 导入 ───────────────────────────────────────────────────────────
  // xlsx（SheetJS）较重，按需动态加载：普通成员不点导出/导入就不会下载这坨依赖，
  // 与 Univer 惰性加载同一思路（保持成员视图轻量）。
  const handleExport = useCallback(async () => {
    if (!draft) return;
    // 导出「当前所见」：编辑者 Univer 模式读 Univer 实时数据；其余用 draft。
    // 成员的 draft 已是后端按密级裁剪后的子集（无密级列、无越权行），导出不泄露越权数据。
    let headers = draft.headers;
    let rows = draft.rows;
    if (canEdit && editorMode === "univer" && univerHandleRef.current) {
      const d = univerHandleRef.current.getData();
      headers = d.headers;
      rows = d.rows;
    }
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "研发数据表");
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const safeName =
        (draft.name || "研发数据表").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) ||
        "研发数据表";
      XLSX.writeFile(wb, `${safeName}_${stamp}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  }, [draft, canEdit, editorMode]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const wsName = wb.SheetNames[0];
        if (!wsName) {
          setError("导入失败：文件不含任何工作表");
          return;
        }
        const ws = wb.Sheets[wsName];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          raw: false,
          defval: "",
        });
        if (raw.length === 0) {
          setError("导入失败：文件为空");
          return;
        }
        // 第 0 行为表头；去掉尾部空列，避免导出文件的冗余空白列污染表结构。
        let headers = (raw[0] as unknown[]).map((h) => String(h ?? "").trim());
        let lastCol = -1;
        headers.forEach((h, i) => {
          if (h !== "") lastCol = i;
        });
        if (lastCol < 0) {
          setError("导入失败：第一行需为列名（表头）");
          return;
        }
        headers = headers.slice(0, lastCol + 1);
        const rows = raw
          .slice(1)
          .map((r) => {
            const arr = Array.isArray(r) ? r : [];
            return headers.map((_, c) => String(arr[c] ?? ""));
          })
          .filter((r) => r.some((c) => c.trim() !== ""));

        const ok = window.confirm(
          `将用「${file.name}」的内容替换当前表格（${headers.length} 列 · ${rows.length} 行）。\n` +
            `导入后需点击「保存」才会写入服务器，或用「撤销改动」还原。是否继续？`,
        );
        if (!ok) return;

        const secrecyName = draft?.secrecy_column || "密级";
        setDraft((prev) => {
          if (!prev) return prev;
          // 密级控制列指向：导入表里仍有原列名则沿用；否则若含「密级」列则指向它；
          // 都没有则保留原指向（由下方提示告警，后端按最严处理）。
          const secrecy_column = headers.includes(prev.secrecy_column)
            ? prev.secrecy_column
            : headers.includes("密级")
              ? "密级"
              : prev.secrecy_column;
          return { ...prev, headers, rows, secrecy_column };
        });
        setDirty(true);
        if (editorMode === "univer") setReloadKey((k) => k + 1);

        const hasSecrecy =
          headers.includes(secrecyName) || headers.includes("密级");
        setImportNotice(
          `已从「${file.name}」导入 ${rows.length} 行 · ${headers.length} 列，点击「保存」生效。` +
            (hasSecrecy
              ? ""
              : " ⚠ 未检测到「密级」列：保存后普通成员将看不到任何数据行（按最严处理）。"),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "导入失败：无法解析文件");
      }
    },
    [draft, editorMode],
  );

  // Univer 模式下 dirty 追踪依赖事件、未必精确，故不据此禁用按钮；HTML 兜底模式仍按 dirty 门控。
  const editActionDisabled =
    saving || loading || (editorMode === "fallback" && !dirty);

  // ── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 隐藏的导入文件选择器（仅编辑者通过「导入」按钮触发）。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 允许重复导入同一文件
          if (f) void handleImportFile(f);
        }}
      />

      {/* 标题区 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">研发数据表</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              类 WPS 表格，按「密级」行级管控敏感数据 · 不同权限的人看到的行数不同
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && savedAt && !dirty ? (
            <span className="text-xs text-slate-400">已于 {savedAt} 保存</span>
          ) : null}
          {/* 导出对所有可见此页者开放：成员导出的是后端已脱敏的视图，不泄露越权数据。 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            disabled={loading || !draft || draft.headers.length === 0}
          >
            <Download className="h-4 w-4" />
            导出
          </Button>
          {canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportClick}
                disabled={saving || loading}
              >
                <Upload className="h-4 w-4" />
                导入
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={editActionDisabled}
              >
                <RotateCcw className="h-4 w-4" />
                撤销改动
              </Button>
              <Button size="sm" onClick={handleSave} disabled={editActionDisabled}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "保存中…" : "保存"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* 角色 / 安全提示 */}
      {canEdit ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            你拥有编辑权限，看到的是<strong>全量数据（含密级列）</strong>。「密级」列填 0–100
            的分值：分值越高越机密。普通成员只能看到密级不高于其个人权限分值的行，且看不到密级列本身。留空的密级按最高（100）处理。
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            这是<strong>按密级裁剪的只读视图</strong>：仅显示密级不高于你权限分值的行，密级列已隐藏。如需查看更多数据或编辑，请联系研发管理员调整权限。
          </p>
        </div>
      )}

      {/* 编辑器说明 */}
      {canEdit ? (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-xs text-indigo-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {editorMode === "univer" ? (
              <>
                已接入 Univer Sheets 编辑器（第 0 行为表头，其后每行一条记录）。
                <strong>保存时仅按此二维结构读回单元格字面值</strong>
                ——公式结果按当前显示值保存、合并单元格不予保留，这是为「行级密级」安全所做的取舍。请保留名为「密级」的列以启用行级管控。
              </>
            ) : (
              <>
                Univer 编辑器加载失败，已自动回退到<strong>基础表格</strong>，编辑/保存功能不受影响。
                可刷新页面重试加载 Univer。
              </>
            )}
          </p>
        </div>
      ) : null}

      {/* 错误 */}
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : null}

      {/* 导入结果提示 */}
      {importNotice ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm text-indigo-700">
          <span>{importNotice}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="shrink-0 rounded p-0.5 text-indigo-400 hover:text-indigo-600"
            title="关闭"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* 表体 */}
      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载数据表…
        </div>
      ) : draft ? (
        canEdit ? (
          <UniverErrorBoundary
            onError={() => setEditorMode("fallback")}
            fallback={
              <EditableTable
                draft={draft}
                onSetCell={setCell}
                onSetHeader={setHeader}
                onAddRow={addRow}
                onDeleteRow={deleteRow}
                onAddColumn={addColumn}
                onDeleteColumn={deleteColumn}
              />
            }
          >
            <Suspense
              fallback={
                <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载 Univer 编辑器…
                </div>
              }
            >
              <LazyUniverEditor
                key={reloadKey}
                ref={univerHandleRef}
                initialHeaders={draft.headers}
                initialRows={draft.rows}
                sheetName={draft.name}
                onDirty={() => setDirty(true)}
              />
            </Suspense>
          </UniverErrorBoundary>
        ) : (
          <ReadOnlyTable headers={draft.headers} rows={draft.rows} />
        )
      ) : null}
    </div>
  );
}

// ── 只读表格（成员视图，数据已由后端脱敏）────────────────────────────────────
function ReadOnlyTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (headers.length === 0) {
    return <EmptyHint text="该数据表暂无可见列。" />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-12 border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-400">
              #
            </th>
            {headers.map((h, c) => (
              <th
                key={c}
                className="border-b border-l border-slate-200 px-3 py-2 text-left font-medium text-slate-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length + 1} className="px-3 py-8 text-center text-slate-400">
                没有你有权查看的数据行。
              </td>
            </tr>
          ) : (
            rows.map((row, r) => (
              <tr key={r} className="hover:bg-slate-50/60">
                <td className="border-b border-slate-100 px-2 py-1.5 text-center text-xs text-slate-400">
                  {r + 1}
                </td>
                {headers.map((_, c) => (
                  <td
                    key={c}
                    className="border-b border-l border-slate-100 px-3 py-1.5 text-slate-700"
                  >
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 可编辑表格（编辑者视图，全量数据）──────────────────────────────────────────
function EditableTable({
  draft,
  onSetCell,
  onSetHeader,
  onAddRow,
  onDeleteRow,
  onAddColumn,
  onDeleteColumn,
}: {
  draft: Draft;
  onSetCell: (r: number, c: number, value: string) => void;
  onSetHeader: (c: number, value: string) => void;
  onAddRow: () => void;
  onDeleteRow: (r: number) => void;
  onAddColumn: () => void;
  onDeleteColumn: (c: number) => void;
}) {
  // 后端在保存时会把空的 secrecy_column 兜底为「密级」，这里同样兜底，保证
  // 即便刚新增一列命名为「密级」（draft.secrecy_column 暂为空）也能正确高亮。
  const secrecyName = draft.secrecy_column || "密级";
  const secrecyIdx = draft.headers.findIndex((h) => h === secrecyName);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="w-12 border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-400">
                #
              </th>
              {draft.headers.map((h, c) => {
                const isSecrecy = c === secrecyIdx;
                return (
                  <th
                    key={c}
                    className={cn(
                      "min-w-[8rem] border-b border-l border-slate-200 px-1.5 py-1.5",
                      isSecrecy && "bg-amber-50",
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <input
                        value={h}
                        onChange={(e) => onSetHeader(c, e.target.value)}
                        className={cn(
                          "w-full rounded bg-transparent px-1.5 py-1 text-left font-medium text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-primary/40",
                          isSecrecy && "text-amber-800",
                        )}
                        placeholder={`列${c + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => onDeleteColumn(c)}
                        title="删除此列"
                        className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isSecrecy ? (
                      <p className="px-1.5 pb-0.5 text-[10px] font-normal text-amber-600">
                        密级控制列（0–100）
                      </p>
                    ) : null}
                  </th>
                );
              })}
              <th className="w-12 border-b border-l border-slate-200 px-2 py-2 text-center">
                <button
                  type="button"
                  onClick={onAddColumn}
                  title="新增一列"
                  className="rounded p-1 text-slate-400 hover:bg-primary/10 hover:text-primary"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={draft.headers.length + 2}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  暂无数据行，点击下方「新增一行」开始录入。
                </td>
              </tr>
            ) : (
              draft.rows.map((row, r) => (
                <tr key={r} className="hover:bg-slate-50/60">
                  <td className="border-b border-slate-100 px-2 py-1 text-center text-xs text-slate-400">
                    {r + 1}
                  </td>
                  {draft.headers.map((_, c) => {
                    const isSecrecy = c === secrecyIdx;
                    return (
                      <td
                        key={c}
                        className={cn(
                          "border-b border-l border-slate-100 p-0",
                          isSecrecy && "bg-amber-50/40",
                        )}
                      >
                        <input
                          value={row[c] ?? ""}
                          onChange={(e) => onSetCell(r, c, e.target.value)}
                          inputMode={isSecrecy ? "numeric" : undefined}
                          className={cn(
                            "w-full bg-transparent px-3 py-1.5 text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-inset focus:ring-primary/40",
                            isSecrecy && "text-amber-800",
                          )}
                          placeholder={isSecrecy ? "0–100" : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-slate-100 px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(r)}
                      title="删除此行"
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onAddRow}>
          <Plus className="h-4 w-4" />
          新增一行
        </Button>
        <Button variant="outline" size="sm" onClick={onAddColumn}>
          <Plus className="h-4 w-4" />
          新增一列
        </Button>
        {secrecyIdx < 0 ? (
          <span className="text-xs text-amber-600">
            ⚠ 当前表没有「{draft.secrecy_column || "密级"}」列：按「最严」处理，保存后普通成员将看不到任何数据行（只有编辑者/超管可见）。新增一列并命名为「密级」以启用行级管控。
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex min-h-[20vh] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
      {text}
    </div>
  );
}
