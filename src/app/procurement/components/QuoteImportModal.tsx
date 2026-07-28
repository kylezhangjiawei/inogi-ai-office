// 报价库批量导入弹窗：选文件 → 客户端解析预览（新增/更新/新建商品/错误）→ 确认应用。
import { useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import {
  importSupplierQuotes,
  type ImportSupplierQuoteItem,
  type QuoteBookRow,
} from "../../lib/procurementApi";
import { downloadQuoteBookTemplate, parseQuoteBookFile } from "../quoteBookXlsx";

export function QuoteImportModal({
  rows, onClose, onImported,
}: {
  /** 当前报价库全量（用于预览判定新增/更新/新建商品） */
  rows: QuoteBookRow[];
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<ImportSupplierQuoteItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = await parseQuoteBookFile(file);
      setItems(parsed.items);
      setParseErrors(parsed.errors);
      if (parsed.items.length === 0 && parsed.errors.length === 0) setParseErrors([t("文件里没有可导入的数据行")]);
    } catch (err) {
      setItems([]);
      setParseErrors([err instanceof Error ? err.message : t("文件解析失败")]);
    }
  };

  // 预览口径：物料名不存在 → 新建商品；(商品, 厂家) 已有报价 → 更新，否则新增
  const preview = useMemo(() => {
    const materialNames = new Set(rows.map((r) => r.name));
    const quoteKeys = new Set(rows.flatMap((r) => r.quotes.map((q) => `${r.name}\u0000${q.supplierName}`)));
    let created = 0, updated = 0;
    const newMaterials = new Set<string>();
    for (const item of items) {
      if (!materialNames.has(item.materialName)) newMaterials.add(item.materialName);
      if (quoteKeys.has(`${item.materialName}\u0000${item.supplierName}`)) updated += 1;
      else created += 1;
    }
    return { created, updated, newMaterials: Array.from(newMaterials) };
  }, [items, rows]);

  const apply = async () => {
    setBusy(true);
    try {
      const result = await importSupplierQuotes(items);
      if (result.errors.length > 0) {
        toast.warning(t("导入完成：新增 {c} 条、更新 {u} 条，{e} 条失败", { c: result.created, u: result.updated, e: result.errors.length }));
      } else {
        toast.success(t("导入完成：新增 {c} 条、更新 {u} 条", { c: result.created, u: result.updated }));
      }
      onImported();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("导入失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle className="text-base font-bold text-slate-900">{t("批量导入厂家报价")}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-slate-400">{t("一行一档起订量，同商品同厂家多行自动合并；已有报价将被整条覆盖。")}</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4">
          <div className="flex items-center gap-2">
            <Input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <FileSpreadsheet className="h-4 w-4" />{t("选择 xlsx 文件")}
            </button>
            {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
            <button type="button" onClick={() => void downloadQuoteBookTemplate()} className="ml-auto text-xs text-indigo-600 hover:underline">{t("下载模板")}</button>
          </div>

          {(items.length > 0 || parseErrors.length > 0) && (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-emerald-600">{t("新增报价 {count} 条", { count: preview.created })}</span>
                <span className="text-indigo-600">{t("覆盖更新 {count} 条", { count: preview.updated })}</span>
                <span className={cn(preview.newMaterials.length > 0 ? "text-amber-600" : "text-slate-400")}>{t("新建商品 {count} 个", { count: preview.newMaterials.length })}</span>
                <span className={cn(parseErrors.length > 0 ? "text-red-500" : "text-slate-400")}>{t("错误 {count} 行", { count: parseErrors.length })}</span>
              </div>
              {preview.newMaterials.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">{t("以下商品在物料库中不存在，导入时将自动创建并进入审核队列：")}{preview.newMaterials.slice(0, 8).join("、")}{preview.newMaterials.length > 8 ? "…" : ""}</p>
              )}
              {parseErrors.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-red-500">
                  {parseErrors.slice(0, 20).map((msg, i) => <li key={i}>{msg}</li>)}
                  {parseErrors.length > 20 && <li>{t("…共 {count} 行错误", { count: parseErrors.length })}</li>}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-slate-400">{t("错误行会被跳过，其余行正常导入。")}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t("取消")}</button>
          <button type="button" disabled={busy || items.length === 0} onClick={() => void apply()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("确认导入 {count} 条", { count: items.length })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
