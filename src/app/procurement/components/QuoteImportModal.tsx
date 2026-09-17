// 报价库批量导入弹窗：选文件/拖拽 → 规则解析预览（错误/提示分级、商品图提取）→ AI 识别兜底 → 确认应用。
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { CheckCircle2, FileSpreadsheet, Loader2, Search, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../components/ui/utils";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../lib/i18n";
import {
  aiParseSupplierQuotes,
  importSupplierQuotes,
  ocrParseSupplierQuotes,
  uploadProcurementAttachment,
  type ImportSupplierQuoteItem,
  type QuoteBookRow,
} from "../../lib/procurementApi";
import { downloadQuoteBookTemplate, fileToSheetText, normalizeQuoteImportTiers, parseQuoteBookFile } from "../quoteBookXlsx";
import { selectFailedQuoteImportEntries } from "../procurementLogic";

// 分组 key 分隔符：商品名可含空格，用 NUL 防拼接碰撞
const SEP = String.fromCharCode(0);

/** Read-only recognition results, shared by the import dialog and isolated visual checks. */
export function QuoteImportPreview({ items, existingRows, imageUrls = [] }: {
  items: ImportSupplierQuoteItem[];
  existingRows: QuoteBookRow[];
  imageUrls?: Array<string | undefined>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const existing = useMemo(() => ({
    materials: new Set(existingRows.map((row) => row.name)),
    quotes: new Set(existingRows.flatMap((row) => row.quotes.map((quote) => `${row.name}${SEP}${quote.supplierName}`))),
  }), [existingRows]);
  const matching = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return items.map((item, index) => ({ item, index })).filter(({ item }) => !keyword ||
      [item.materialName, item.supplierName, item.supplierModel, item.spec].some((value) => value?.toLocaleLowerCase().includes(keyword)));
  }, [items, search]);
  const totalPages = Math.max(1, Math.ceil(matching.length / 20));
  const pageSafe = Math.min(page, totalPages);
  if (pageSafe !== page) setPage(pageSafe);
  const formatPrice = (value: number, currency: string) => `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  const changePage = (next: number) => {
    setPage(next);
    headingRef.current?.focus();
  };
  return (
    <section aria-label={t("逐条核对报价")} className="mt-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-balance text-sm font-semibold text-slate-800 outline-none">{t("逐条核对报价")}</h3>
        <span aria-live="polite" className="text-xs tabular-nums text-slate-500">{t("匹配 {count} / {total} 条", { count: matching.length, total: items.length })}</span>
      </div>
      <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{t("请逐条核对识别结果；如需修改，请修正文件后重新选择。筛选仅用于核对，不会改变导入范围。")}</p>
      <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{t("已存在商品沿用物料库中的规格、分类与单位；仅新增商品使用文件中的资料。")}</p>
      <div className="relative mt-2">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} aria-label={t("搜索待导入报价")} placeholder={t("搜索商品 / 厂家 / 型号")} className="h-9 pl-9 pr-10 text-sm" />
        {search && <Button type="button" variant="ghost" size="icon" aria-label={t("清空搜索")} onClick={() => { setSearch(""); setPage(1); searchRef.current?.focus(); }} className="absolute right-0.5 top-0.5 size-8"><X className="size-4" /></Button>}
      </div>
      <ol className="mt-3 space-y-3">
        {matching.slice((pageSafe - 1) * 20, pageSafe * 20).map(({ item, index }) => {
          const currency = item.currency || "CNY";
          const isNewMaterial = !existing.materials.has(item.materialName);
          const isUpdate = existing.quotes.has(`${item.materialName}${SEP}${item.supplierName}`);
          return (
            <li key={`${index}:${item.materialName}:${item.supplierName}`} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex min-w-0 items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <span className="pt-0.5 text-xs tabular-nums text-slate-500">{index + 1}</span>
                {imageUrls[index] && <img src={imageUrls[index]} alt={t("第 {index} 张报价图片预览", { index: index + 1 })} loading="lazy" className="size-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />}
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold text-slate-800">{item.materialName}</div>
                  <div className="mt-0.5 break-words text-xs text-slate-600">{item.supplierName}</div>
                </div>
                <span className={cn("max-w-28 shrink-0 rounded-md border px-2 py-1 text-center text-xs", isUpdate ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600")}>{t(isUpdate ? "覆盖已有报价" : "新增报价")}</span>
              </div>
              <div className="min-w-0 space-y-3 px-3 py-3">
                {isNewMaterial && <p className="text-pretty text-xs text-amber-700">{t("新商品，导入后进入审核队列")}</p>}
                <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
                  {[
                    [t("规格"), item.spec || "—"],
                    [t("厂家型号 / 品牌"), item.supplierModel || "—"],
                    [t("分类"), item.category || "—"],
                    [t("单位"), item.unit || "—"],
                    [t("币种 / 税费"), `${currency} · ${t(item.taxIncluded === false ? "不含税" : "含税价")}`],
                    [t("交期"), item.leadTimeDays ? t("{n} 天", { n: item.leadTimeDays }) : t("交期未填写")],
                    [t("报价日期"), item.quoteDate || t("未填写")],
                    [t("有效期至"), item.validUntil || t("长期有效")],
                  ].map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-start gap-2"><dt className="break-words text-slate-500">{label}</dt><dd className="min-w-0 break-words tabular-nums text-slate-800">{value}</dd></div>)}
                </dl>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">{t("阶梯报价")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {normalizeQuoteImportTiers(item.tiers).map((tier, tierIndex) => <div key={tierIndex} className="flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums"><span className="min-w-0 break-words text-slate-500">{tier.minQty > 0 ? `≥ ${tier.minQty.toLocaleString()}${item.unit ? ` ${item.unit}` : ""}` : t("不限起订")}</span><span className="min-w-0 break-all font-semibold text-slate-800">{formatPrice(tier.unitPrice, currency)}</span></div>)}
                  </div>
                </div>
                {item.historyPrices && item.historyPrices.length > 0 && <div><div className="mb-1.5 text-xs font-medium text-slate-600">{t("历史轮次价格")}</div><ul className="space-y-1 text-xs tabular-nums text-slate-600">{item.historyPrices.map((history, historyIndex) => <li key={historyIndex} className="flex flex-wrap gap-x-2 break-words"><span>{history.label || t("第 {index} 轮", { index: historyIndex + 1 })}</span><span>{history.minQty ? `≥ ${history.minQty.toLocaleString()}` : t("不限起订")}</span><span className="break-all">{formatPrice(history.unitPrice, currency)}</span></li>)}</ul></div>}
                {item.note && <p className="break-words text-pretty text-xs leading-5 text-slate-600"><span className="mr-2 text-slate-500">{t("备注")}</span>{item.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {matching.length === 0 && <div className="rounded-xl border border-slate-100 px-4 py-6 text-center text-sm text-slate-500"><p>{t("没有匹配的报价")}</p><Button type="button" variant="link" onClick={() => { setSearch(""); setPage(1); searchRef.current?.focus(); }} className="mt-1 text-xs">{t("清空搜索")}</Button></div>}
      {totalPages > 1 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-auto text-xs tabular-nums text-slate-500">{t("第 {page} / {total} 页", { page: pageSafe, total: totalPages })}</span><Button type="button" variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => changePage(pageSafe - 1)}>{t("上一页")}</Button><Button type="button" variant="outline" size="sm" disabled={pageSafe >= totalPages} onClick={() => changePage(pageSafe + 1)}>{t("下一页")}</Button></div>}
    </section>
  );
}

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
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
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
      <DialogContent
        closeDisabled={busy || aiBusy || parseBusy}
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus(); }
        }}
        className="proc-horizon-overlay proc-quote-import flex flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 py-4 pr-16">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">{t("批量导入厂家报价")}</DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-500">{t("同商品同供应商多行自动合并为阶梯报价；已有报价将被整条覆盖。")}</DialogDescription>
        </DialogHeader>

        <div aria-label={t("导入进度")} className="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/70 px-6 py-2.5">
          {[t("选择文件"), t("核对识别结果"), t("导入生效")].map((label, index) => {
            const step = index + 1;
            const complete = step < currentStep;
            const active = step === currentStep;
            return (
              <div key={label} aria-current={active ? "step" : undefined} className={cn("flex items-center gap-2 text-xs", active ? "font-semibold text-primary" : complete ? "text-emerald-700" : "text-slate-500")}>
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", active ? "border-primary bg-primary text-white" : complete ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
                  {complete ? <CheckCircle2 className="size-3" /> : step}
                </span>
                <span className="min-w-0 text-pretty">{label}</span>
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words px-6 py-4">
          <Input ref={fileRef} type="file" accept=".xlsx,.xls,.png,.jpg,.jpeg,.webp,.bmp" disabled={busy || parseBusy || aiBusy} className="hidden" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; void pick(picked); }} />
          {/* 点击或拖拽上传：dragOver 必须 preventDefault 才能触发 drop */}
          <Button variant="unstyled"
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
              if (!/\.(xlsx|xls|png|jpe?g|webp|bmp)$/i.test(dropped.name)) { const message = t("请拖入表格（.xlsx/.xls）或表格图片（.png/.jpg）"); setOperationError(message); toast.error(message); return; }
              void pick(dropped);
            }}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-70",
              dragging ? "border-primary/40 bg-accent" : "border-slate-200 hover:border-primary/40 hover:bg-slate-50/60",
            )}
          >
            <FileSpreadsheet className={cn("size-7", dragging ? "text-primary" : "text-muted-foreground")} />
            {parseBusy || aiBusy ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-primary"><Loader2 className="size-4 animate-spin" />{parseBusy ? t("正在解析表格…") : t("正在识别报价…")}</span>
            ) : file ? (
              <span className="max-w-full break-all text-sm font-medium text-slate-700">{file.name}</span>
            ) : (
              <span className="text-sm text-slate-600">{t("点击选择或拖拽文件到此处（xlsx / xls / 表格截图）")}</span>
            )}
              <span className="text-pretty text-[11px] text-slate-500">{t("业务报价表原样导入：自动识别列名、提取商品图片、跳过总计行；表格图片走 OCR + AI 识别")}</span>
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {file ? (
              <Button variant="unstyled"
                type="button"
                disabled={busy || parseBusy || aiBusy}
                onClick={rerunRecognition}
                title={t("规则解析不理想时，让 AI 通读表格重新抽取报价")}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t(aiBusy ? "AI 识别中…" : "AI 智能识别")}
              </Button>
            ) : <span />}
            <Button variant="unstyled" type="button" onClick={() => void downloadQuoteBookTemplate().catch((err: unknown) => setOperationError(err instanceof Error ? err.message : t("下载失败")))} className="text-xs text-primary hover:underline">{t("下载标准模板")}</Button>
          </div>

          {aiInfo && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--primary-soft-border)] bg-accent px-3 py-2 text-pretty text-xs text-primary">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />{aiInfo}
            </div>
          )}

          {(items.length > 0 || parseErrors.length > 0 || importErrors.length > 0 || warnings.length > 0) && (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span className="text-emerald-600">{t("新增报价 {count} 条", { count: preview.created })}</span>
                <span className="text-primary">{t("覆盖更新 {count} 条", { count: preview.updated })}</span>
                <span className={cn(preview.newMaterials.length > 0 ? "text-amber-600" : "text-slate-500")}>{t("新建商品 {count} 个", { count: preview.newMaterials.length })}</span>
                {imageCount > 0 && <span className="text-slate-500">{t("商品图片 {count} 张", { count: imageCount })}</span>}
                {historyCount > 0 && <span className="text-slate-500">{t("历史轮次 {count} 条", { count: historyCount })}</span>}
                <span className={cn(warnings.length > 0 ? "text-amber-500" : "text-slate-500")}>{t("提示 {count} 条", { count: warnings.length })}</span>
                <span className={cn(parseErrors.length > 0 ? "text-rose-500" : "text-slate-500")}>{t("跳过 {count} 行", { count: parseErrors.length })}</span>
                {importErrors.length > 0 && <span className="text-rose-600">{t("导入失败 {count} 条", { count: importErrors.length })}</span>}
              </div>
              {imageCount > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {imagePreviewUrls.map((url, i) => url && (
                    <img key={i} src={url} alt={t("第 {index} 张报价图片预览", { index: i + 1 })} className="size-9 rounded border border-slate-200 object-cover" />
                  )).filter(Boolean).slice(0, 10)}
                  <span className="text-[11px] text-slate-500">{t("导入时随报价保存")}</span>
                </div>
              )}
              {isXls && imageCount === 0 && items.length > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                  {t("⚠ 旧版 .xls 格式无法提取表格里的商品图片：请在 Excel/WPS 里「另存为 .xlsx」后重新上传，即可带图导入。")}
                </p>
              )}
              {!isXls && imageCount === 0 && items.length > 0 && file != null && (
                <p className="mt-2 text-[11px] text-slate-500">{t("未在表格中检测到可提取的商品图片（支持 Excel 浮动图与 WPS 嵌入图）。")}</p>
              )}
              {preview.newMaterials.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">{t("以下商品在物料库中不存在，导入时将自动创建并进入审核队列：")}{preview.newMaterials.slice(0, 8).join("、")}{preview.newMaterials.length > 8 ? "…" : ""}</p>
              )}
              {warnings.length > 0 && (
                <ul tabIndex={0} aria-label={t("提示 {count} 条", { count: warnings.length })} className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {warnings.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              )}
              {parseErrors.length > 0 && (
                <ul tabIndex={0} aria-label={t("跳过 {count} 行", { count: parseErrors.length })} className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {parseErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              )}
              {importErrors.length > 0 && (
                <ul tabIndex={0} aria-label={t("待重试报价的失败原因")} className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {importErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              )}
              <p className="mt-2 text-pretty text-[11px] text-slate-500">{t(importErrors.length > 0
                ? "导入失败的报价已保留在当前列表，可根据原因修正后重试；解析阶段的「跳过」行不会导入。"
                : "「提示」行的数据已纳入导入；「跳过」行不会导入。识别不理想可点上方「AI 智能识别」。")}</p>
            </div>
          )}
          {items.length > 0 && <QuoteImportPreview items={items} existingRows={rows} imageUrls={imagePreviewUrls} />}
        </div>

        {operationError && <div role="alert" className="max-h-24 shrink-0 overflow-y-auto border-t border-rose-200 bg-rose-50 px-6 py-2 text-pretty text-xs text-rose-700"><span className="break-words">{operationError}</span></div>}
        <div className="proc-quote-import-footer flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <span aria-live="polite" className="min-w-0 flex-1 basis-40 text-pretty text-xs tabular-nums text-slate-500">{busy ? t("正在写入 {count} 条报价，请勿关闭", { count: items.length }) : items.length > 0 ? t("已识别 {count} 条，核对后再导入", { count: items.length }) : t("请选择文件开始")}</span>
          <div className="flex shrink-0 items-center gap-2">
          <Button variant="unstyled" type="button" disabled={busy || aiBusy || parseBusy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</Button>
          <Button variant="unstyled" type="button" disabled={busy || aiBusy || parseBusy || items.length === 0} onClick={() => void apply()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? t("正在导入…") : t("确认导入 {count} 条", { count: items.length })}
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
