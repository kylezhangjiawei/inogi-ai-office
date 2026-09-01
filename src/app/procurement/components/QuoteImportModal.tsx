// 报价库批量导入弹窗：选文件/拖拽 → 规则解析预览（错误/提示分级、商品图提取）→ AI 识别兜底 → 确认应用。
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import {
  aiParseSupplierQuotes,
  importSupplierQuotes,
  ocrParseSupplierQuotes,
  uploadProcurementAttachment,
  type ImportSupplierQuoteItem,
  type QuoteBookRow,
} from "../../lib/procurementApi";
import { downloadQuoteBookTemplate, fileToSheetText, parseQuoteBookFile } from "../quoteBookXlsx";
import { selectFailedQuoteImportEntries } from "../procurementLogic";

// 分组 key 分隔符：商品名可含空格，用 NUL 防拼接碰撞
const SEP = String.fromCharCode(0);

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
  const requestIdRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<ImportSupplierQuoteItem[]>([]);
  const [images, setImages] = useState<(Blob | undefined)[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiInfo, setAiInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [operationError, setOperationError] = useState("");

  /**
   * AI 兜底：把表格 CSV 文本交给后端 AI 抽取结构化报价。
   * 规则解析已有结果时取「补充合并」——已识别的条目保留（更精确、可带图），AI 只补上
   * 规则认不出的部分（如供应商在列头的矩阵表）；规则一无所获时整体采用 AI 结果。
   */
  const runAi = async (target: File, requestId: number, baseItems: ImportSupplierQuoteItem[]) => {
    if (requestId !== requestIdRef.current) return;
    setAiBusy(true);
    setAiInfo("");
    setOperationError("");
    setImportErrors([]);
    try {
      const text = await fileToSheetText(target);
      const result = await aiParseSupplierQuotes(text);
      if (requestId !== requestIdRef.current) return;
      if (result.items.length === 0) {
        const message = result.error ?? t("AI 未能识别出有效报价");
        setOperationError(message);
        toast.error(message);
        return;
      }
      if (baseItems.length === 0) {
        setItems(result.items);
        setImages([]);
        setParseErrors([]);
        setWarnings([]);
        setAiInfo(t("AI（{model}）识别出 {count} 条报价，请核对预览后再导入", { model: result.model ?? "AI", count: result.items.length }));
      } else {
        const existingKeys = new Set(baseItems.map((it) => `${it.materialName}${SEP}${it.supplierName}`));
        const extra = result.items.filter((it) => !existingKeys.has(`${it.materialName}${SEP}${it.supplierName}`));
        if (extra.length === 0) {
          setAiInfo(t("AI（{model}）没有识别出规则解析之外的新报价", { model: result.model ?? "AI" }));
        } else {
          setItems([...baseItems, ...extra]);
          setAiInfo(t("AI（{model}）补充识别出 {count} 条规则解析未覆盖的报价（如矩阵比价表），请核对", { model: result.model ?? "AI", count: extra.length }));
        }
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : t("AI 识别失败");
      setOperationError(message);
      toast.error(message);
    } finally {
      if (requestId === requestIdRef.current) setAiBusy(false);
    }
  };

  /** 图片表格：OCR 提文本 + AI 抽取（后端一步完成）。 */
  const runOcr = async (target: File, requestId: number) => {
    if (requestId !== requestIdRef.current) return;
    setAiBusy(true);
    setAiInfo("");
    setOperationError("");
    setImportErrors([]);
    setItems([]); setImages([]); setParseErrors([]); setWarnings([]);
    try {
      const result = await ocrParseSupplierQuotes(target);
      if (requestId !== requestIdRef.current) return;
      if (result.items.length > 0) {
        setItems(result.items);
        setAiInfo(t("已通过 OCR + AI（{model}）识别出 {count} 条报价，请核对预览后再导入", { model: result.model ?? "AI", count: result.items.length }));
      } else {
        const message = result.error ?? t("图片中未识别到有效报价");
        setParseErrors([message]);
        setOperationError(message);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : t("图片识别失败");
      setParseErrors([message]);
      setOperationError(message);
    } finally {
      if (requestId === requestIdRef.current) setAiBusy(false);
    }
  };

  const pick = async (picked: File | undefined) => {
    if (!picked || busy || parseBusy || aiBusy) return;
    const requestId = ++requestIdRef.current;
    setFile(picked);
    setItems([]);
    setImages([]);
    setParseErrors([]);
    setImportErrors([]);
    setWarnings([]);
    setAiInfo("");
    setOperationError("");
    // 图片文件走 OCR + AI；表格文件走规则解析（AI 兜底）
    if (/\.(png|jpe?g|webp|bmp)$/i.test(picked.name) || /^image\//.test(picked.type)) {
      toast.info(t("检测到图片表格，正在 OCR + AI 识别…"));
      void runOcr(picked, requestId);
      return;
    }
    setParseBusy(true);
    try {
      const parsed = await parseQuoteBookFile(picked);
      if (requestId !== requestIdRef.current) return;
      setItems(parsed.items);
      setImages(parsed.images);
      setParseErrors(parsed.errors);
      setWarnings(parsed.warnings);
      // 规则解析一无所获 → 自动走 AI 兜底
      if (parsed.items.length === 0) {
        toast.info(t("规则解析未识别到数据，正在尝试 AI 智能识别…"));
        void runAi(picked, requestId, parsed.items);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setItems([]);
      setImages([]);
      setWarnings([]);
      setParseErrors([err instanceof Error ? err.message : t("文件解析失败")]);
      setOperationError(err instanceof Error ? err.message : t("文件解析失败"));
    } finally {
      if (requestId === requestIdRef.current) setParseBusy(false);
    }
  };

  const rerunRecognition = () => {
    if (!file || busy || parseBusy || aiBusy) return;
    const requestId = ++requestIdRef.current;
    if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
      void runOcr(file, requestId);
    } else {
      void runAi(file, requestId, items);
    }
  };

  const imageCount = useMemo(() => images.filter(Boolean).length, [images]);
  const imagePreviewUrls = useMemo(
    () => images.map((blob) => (blob ? URL.createObjectURL(blob) : undefined)),
    [images],
  );
  useEffect(
    () => () => {
      for (const url of imagePreviewUrls) {
        if (url) URL.revokeObjectURL(url);
      }
    },
    [imagePreviewUrls],
  );
  const historyCount = useMemo(() => items.reduce((sum, it) => sum + (it.historyPrices?.length ?? 0), 0), [items]);
  const isXls = file != null && /\.xls$/i.test(file.name);
  const currentStep = busy ? 3 : items.length > 0 || parseErrors.length > 0 || importErrors.length > 0 || warnings.length > 0 ? 2 : 1;

  // 预览口径：物料名不存在 → 新建商品；(商品, 供应商) 已有报价 → 更新，否则新增
  const preview = useMemo(() => {
    const materialNames = new Set(rows.map((r) => r.name));
    const quoteKeys = new Set(rows.flatMap((r) => r.quotes.map((q) => `${r.name}${SEP}${q.supplierName}`)));
    let created = 0, updated = 0;
    const newMaterials = new Set<string>();
    for (const item of items) {
      if (!materialNames.has(item.materialName)) newMaterials.add(item.materialName);
      if (quoteKeys.has(`${item.materialName}${SEP}${item.supplierName}`)) updated += 1;
      else created += 1;
    }
    return { created, updated, newMaterials: Array.from(newMaterials) };
  }, [items, rows]);

  const apply = async () => {
    if (items.length === 0) {
      const message = t("请先完成文件识别并确认至少一条有效报价");
      setOperationError(message);
      toast.error(message);
      return;
    }
    setOperationError("");
    setImportErrors([]);
    setBusy(true);
    try {
      // 先把提取到的商品图传 OSS，把 objectKey 挂到对应条目；单图失败不阻塞导入
      let imageFails = 0;
      const withImages = await Promise.all(items.map(async (item, index) => {
        const blob = images[index];
        if (!blob) return item;
        try {
          const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
          const uploaded = await uploadProcurementAttachment(new File([blob], `quote-image-${index + 1}.${ext}`, { type: blob.type }));
          return { ...item, imageKey: uploaded.objectKey };
        } catch {
          imageFails += 1;
          return item;
        }
      }));
      if (imageFails > 0) toast.warning(t("{count} 张商品图片上传失败，对应报价将不带图导入", { count: imageFails }));
      const result = await importSupplierQuotes(withImages);
      if (result.errors.length > 0) {
        const retry = selectFailedQuoteImportEntries(items, images, result.errors);
        const retryItems = retry.items;
        const retryImages = retry.attachments;
        const message = t("已导入成功项；保留 {count} 条失败报价，请根据下方原因修正后重试", { count: retryItems.length });
        setItems(retryItems);
        setImages(retryImages);
        setImportErrors(result.errors.map((item) => `${item.materialName} · ${item.supplierName}：${item.message}`));
        setOperationError(message);
        toast.warning(t("导入完成：新增 {c} 条、更新 {u} 条，{e} 条失败", { c: result.created, u: result.updated, e: result.errors.length }));
        onImported();
        return;
      } else {
        toast.success(t("导入完成：新增 {c} 条、更新 {u} 条", { c: result.created, u: result.updated }));
      }
      onImported();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("导入失败");
      setOperationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy && !aiBusy && !parseBusy) onClose(); }}>
      <DialogContent className="proc-horizon-overlay gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">{t("批量导入厂家报价")}</DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-400">{t("同商品同供应商多行自动合并为阶梯报价；已有报价将被整条覆盖。")}</DialogDescription>
        </DialogHeader>

        <div aria-label={t("导入进度")} className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/70 px-6 py-2.5">
          {[t("选择文件"), t("核对识别结果"), t("导入生效")].map((label, index) => {
            const step = index + 1;
            const complete = step < currentStep;
            const active = step === currentStep;
            return (
              <div key={label} className={cn("flex items-center gap-2 text-xs", active ? "font-semibold text-[#002fa7]" : complete ? "text-emerald-700" : "text-slate-400")}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", active ? "border-[#002fa7] bg-[#002fa7] text-white" : complete ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
                  {complete ? <CheckCircle2 className="size-3" /> : step}
                </span>
                <span className="truncate">{label}</span>
              </div>
            );
          })}
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <Input ref={fileRef} type="file" accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp,.bmp" disabled={busy || parseBusy || aiBusy} className="hidden" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; void pick(picked); }} />
          {/* 点击或拖拽上传：dragOver 必须 preventDefault 才能触发 drop */}
          <button
            type="button"
            disabled={busy || parseBusy || aiBusy}
            aria-busy={parseBusy || aiBusy}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (busy || parseBusy || aiBusy) return;
              const dropped = e.dataTransfer.files?.[0];
              if (!dropped) return;
              if (!/\.(xlsx|xls|png|jpe?g|webp|bmp)$/i.test(dropped.name)) { toast.error(t("请拖入表格（.xlsx/.xls）或表格图片（.png/.jpg）")); return; }
              void pick(dropped);
            }}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8] disabled:cursor-wait disabled:opacity-70",
              dragging ? "border-[#8fa9e8] bg-[#eef3ff]" : "border-slate-200 hover:border-[#8fa9e8] hover:bg-slate-50/60",
            )}
          >
            <FileSpreadsheet className={cn("size-7", dragging ? "text-[#002fa7]" : "text-slate-300")} />
            {parseBusy || aiBusy ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-[#002fa7]"><Loader2 className="size-4 animate-spin" />{parseBusy ? t("正在解析表格…") : t("正在识别报价…")}</span>
            ) : file ? (
              <span className="max-w-full truncate text-sm font-medium text-slate-700">{file.name}</span>
            ) : (
              <span className="text-sm text-slate-600">{t("点击选择或拖拽文件到此处（xlsx / xls / 表格截图）")}</span>
            )}
              <span className="text-pretty text-[11px] text-slate-400">{t("业务报价表原样导入：自动识别列名、提取商品图片、跳过总计行；表格图片走 OCR + AI 识别")}</span>
          </button>
          <div className="mt-2 flex items-center justify-between">
            {file ? (
              <button
                type="button"
                disabled={busy || parseBusy || aiBusy}
                onClick={rerunRecognition}
                title={t("规则解析不理想时，让 AI 通读表格重新抽取报价")}
                className="inline-flex items-center gap-1 rounded-lg border border-[#cbd8f6] bg-[#eef3ff] px-2.5 py-1 text-xs font-medium text-[#002fa7] hover:bg-[#e3ebff] disabled:opacity-60"
              >
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t(aiBusy ? "AI 识别中…" : "AI 智能识别")}
              </button>
            ) : <span />}
            <button type="button" onClick={() => void downloadQuoteBookTemplate()} className="text-xs text-[#002fa7] hover:underline">{t("下载标准模板")}</button>
          </div>

          {aiInfo && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#dce5fa] bg-[#eef3ff] px-3 py-2 text-pretty text-xs text-[#002fa7]">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />{aiInfo}
            </div>
          )}
          {operationError && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{operationError}
            </div>
          )}

          {(items.length > 0 || parseErrors.length > 0 || importErrors.length > 0 || warnings.length > 0) && (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span className="text-emerald-600">{t("新增报价 {count} 条", { count: preview.created })}</span>
                <span className="text-[#002fa7]">{t("覆盖更新 {count} 条", { count: preview.updated })}</span>
                <span className={cn(preview.newMaterials.length > 0 ? "text-amber-600" : "text-slate-400")}>{t("新建商品 {count} 个", { count: preview.newMaterials.length })}</span>
                {imageCount > 0 && <span className="text-slate-500">{t("商品图片 {count} 张", { count: imageCount })}</span>}
                {historyCount > 0 && <span className="text-slate-500">{t("历史轮次 {count} 条", { count: historyCount })}</span>}
                <span className={cn(warnings.length > 0 ? "text-amber-500" : "text-slate-400")}>{t("提示 {count} 条", { count: warnings.length })}</span>
                <span className={cn(parseErrors.length > 0 ? "text-rose-500" : "text-slate-400")}>{t("跳过 {count} 行", { count: parseErrors.length })}</span>
                {importErrors.length > 0 && <span className="text-rose-600">{t("导入失败 {count} 条", { count: importErrors.length })}</span>}
              </div>
              {imageCount > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {imagePreviewUrls.map((url, i) => url && (
                    <img key={i} src={url} alt={t("第 {index} 张报价图片预览", { index: i + 1 })} className="size-9 rounded border border-slate-200 object-cover" />
                  )).filter(Boolean).slice(0, 10)}
                  <span className="text-[11px] text-slate-400">{t("导入时随报价保存")}</span>
                </div>
              )}
              {isXls && imageCount === 0 && items.length > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                  {t("⚠ 旧版 .xls 格式无法提取表格里的商品图片：请在 Excel/WPS 里「另存为 .xlsx」后重新上传，即可带图导入。")}
                </p>
              )}
              {!isXls && imageCount === 0 && items.length > 0 && file != null && (
                <p className="mt-2 text-[11px] text-slate-400">{t("未在表格中检测到可提取的商品图片（支持 Excel 浮动图与 WPS 嵌入图）。")}</p>
              )}
              {preview.newMaterials.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">{t("以下商品在物料库中不存在，导入时将自动创建并进入审核队列：")}{preview.newMaterials.slice(0, 8).join("、")}{preview.newMaterials.length > 8 ? "…" : ""}</p>
              )}
              {warnings.length > 0 && (
                <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-amber-600">
                  {warnings.slice(0, 12).map((msg, i) => <li key={i}>{msg}</li>)}
                  {warnings.length > 12 && <li>{t("…共 {count} 条提示", { count: warnings.length })}</li>}
                </ul>
              )}
              {parseErrors.length > 0 && (
                <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-rose-500">
                  {parseErrors.slice(0, 12).map((msg, i) => <li key={i}>{msg}</li>)}
                  {parseErrors.length > 12 && <li>{t("…共 {count} 行跳过", { count: parseErrors.length })}</li>}
                </ul>
              )}
              {importErrors.length > 0 && (
                <ul aria-label={t("待重试报价的失败原因")} className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-rose-600">
                  {importErrors.slice(0, 12).map((msg, i) => <li key={i}>{msg}</li>)}
                  {importErrors.length > 12 && <li>{t("…共 {count} 条导入失败", { count: importErrors.length })}</li>}
                </ul>
              )}
              <p className="mt-2 text-pretty text-[11px] text-slate-400">{t(importErrors.length > 0
                ? "导入失败的报价已保留在当前列表，可根据原因修正后重试；解析阶段的「跳过」行不会导入。"
                : "「提示」行的数据已纳入导入；「跳过」行不会导入。识别不理想可点上方「AI 智能识别」。")}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <span aria-live="polite" className="min-w-0 truncate text-xs tabular-nums text-slate-400">{busy ? t("正在写入 {count} 条报价，请勿关闭", { count: items.length }) : items.length > 0 ? t("已识别 {count} 条，核对后再导入", { count: items.length }) : t("请选择文件开始")}</span>
          <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={busy || aiBusy || parseBusy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</button>
          <button type="button" disabled={busy || aiBusy || parseBusy || items.length === 0} onClick={() => void apply()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? t("正在导入…") : t("确认导入 {count} 条", { count: items.length })}
          </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
