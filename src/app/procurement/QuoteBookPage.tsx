// 供应商报价库：树形维护同一商品跨厂家的报价与起订量阶梯价（商品行 → 厂家子行 chips）。
// 商品即物料（复用物料主数据），历史采购价格复用 PriceHistoryModal 跨任务聚合。
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet, History, Pencil, Plus, Search, Store, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../components/ui/utils";
import { useI18n } from "../lib/i18n";
import {
  clearMaterialQuotes,
  deleteSupplierQuote,
  listQuoteBook,
  type QuoteBookRow,
  type SupplierQuote,
} from "../lib/procurementApi";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { Button } from "../components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "../components/ui/pagination";
import { ImageLightbox, PageHeader, useConfirmDialog, useProcCan } from "./components/common";
import { PriceHistoryModal } from "./components/PriceHistoryModal";
import { QuoteFormDrawer } from "./components/QuoteFormDrawer";
import { QuoteImportModal } from "./components/QuoteImportModal";
import { MaterialFormModal } from "./components/modals";
import { downloadQuoteBookTemplate, exportQuoteBookXlsx } from "./quoteBookXlsx";
import { AutoTranslatedText } from "../components/TranslatableText";
import { useSearchParams } from "react-router";

/** 起订量展示：1000 → 1k；0（不限）由调用侧配 t("不限") 文案。 */
export function fmtMinQty(qty: number): string {
  if (qty >= 1000 && qty % 1000 === 0) return `${qty / 1000}k`;
  return qty.toLocaleString();
}

/** 报价金额：CNY 用 ¥，其他币种带币码前缀。 */
export function fmtQuotePrice(price: number, currency: string): string {
  const text = price.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency === "CNY" ? `¥${text}` : `${currency} ${text}`;
}

const PAGE_SIZE = 50;

function isExpired(quote: SupplierQuote, today: string): boolean {
  return Boolean(quote.validUntil && quote.validUntil < today);
}

/** 商品全场最低价：跨厂家跨档位取最小单价（过期报价不参与）。 */
function lowestOf(row: QuoteBookRow, today: string): { quote: SupplierQuote; price: number; minQty: number } | null {
  let best: { quote: SupplierQuote; price: number; minQty: number } | null = null;
  for (const q of row.quotes) {
    if (isExpired(q, today)) continue;
    for (const tier of q.tiers) {
      if (!best || tier.unitPrice < best.price) best = { quote: q, price: tier.unitPrice, minQty: tier.minQty };
    }
  }
  return best;
}

function TierChips({ quote, bestPrice, today }: { quote: SupplierQuote; bestPrice: number | null; today: string }) {
  const expired = isExpired(quote, today);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {quote.tiers.map((tier) => {
        const isBest = !expired && bestPrice != null && tier.unitPrice === bestPrice;
        return (
          <span
            key={tier.minQty}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
              isBest ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600",
              expired && "opacity-50",
            )}
          >
            {tier.minQty > 0 && <span className="text-slate-400">{fmtMinQty(tier.minQty)}</span>}
            <span className="font-semibold">{fmtQuotePrice(tier.unitPrice, quote.currency)}</span>
          </span>
        );
      })}
    </div>
  );
}

export function QuoteBookPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const focusedMaterialId = searchParams.get("materialId");
  const focusedMaterialName = searchParams.get("materialName");
  const focusedSearch = searchParams.get("search");
  const focusedAction = searchParams.get("action");
  const focusHandledRef = useRef("");
  const [rows, setRows] = useState<QuoteBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  // 默认只显示已有报价的商品：物料主数据（T+ 同步）有数千条，全列出会淹没报价库主视角
  const [showAll, setShowAll] = useState(false);
  const [onlyExpired, setOnlyExpired] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // 抽屉：material 必有；quote 有则编辑、无则新增
  const [drawer, setDrawer] = useState<{ material: QuoteBookRow; quote?: SupplierQuote } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const can = useProcCan();
  // 独立操作码优先，过渡期兼容任务询价码（与后端 @Permissions 双码任一命中保持一致）
  const canWrite = can("quote-book:manage") || can("proc-task:inquiry");
  const { confirm: confirmAction, confirmDialog } = useConfirmDialog();
  const today = new Date().toISOString().slice(0, 10);

  const reload = () => {
    listQuoteBook()
      .then((list) => { setRows(list); setError(""); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    let alive = true;
    listQuoteBook()
      .then((list) => { if (alive) { setRows(list); setError(""); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "加载失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 从采购任务“无合适报价”跳转时，直接定位对应物料并打开新增厂家报价抽屉。
  useEffect(() => {
    if (loading || rows.length === 0 || (!focusedMaterialId && !focusedMaterialName && !focusedSearch)) return;
    const focusKey = `${focusedMaterialId ?? ""}:${focusedMaterialName ?? ""}:${focusedSearch ?? ""}:${focusedAction ?? ""}`;
    if (focusHandledRef.current === focusKey) return;
    if (!focusedMaterialId && !focusedMaterialName && focusedSearch) {
      focusHandledRef.current = focusKey;
      setSearch(focusedSearch);
      return;
    }
    const material = rows.find((row) =>
      focusedMaterialId ? row.id === focusedMaterialId : row.name === focusedMaterialName,
    );
    focusHandledRef.current = focusKey;
    if (!material) return;
    setShowAll(true);
    setSearch(material.name);
    setExpanded((current) => new Set(current).add(material.id));
    if (focusedAction === "add" && canWrite) setDrawer({ material });
  }, [canWrite, focusedAction, focusedMaterialId, focusedMaterialName, focusedSearch, loading, rows]);

  const removeQuote = (quote: SupplierQuote) =>
    confirmAction({
      title: t("删除厂家报价"),
      desc: t("确定删除 {name} 的这条报价吗？", { name: quote.supplierName }),
      tone: "danger",
      actionLabel: t("删除"),
      onConfirm: () => {
        void deleteSupplierQuote(quote.id)
          .then(() => { toast.success(t("报价已删除")); reload(); })
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("删除失败")));
      },
    });
  const clearMaterial = (row: QuoteBookRow) =>
    confirmAction({
      title: t("移出报价库"),
      desc: t("确定把「{name}」移出报价库吗？其下 {count} 条厂家报价将全部删除，物料主数据不受影响。", { name: row.name, count: row.quotes.length }),
      tone: "danger",
      actionLabel: t("移出"),
      onConfirm: () => {
        void clearMaterialQuotes(row.id)
          .then(() => { toast.success(t("已移出报价库")); reload(); })
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("删除失败")));
      },
    });

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = rows.filter((row) => {
      // 默认视角只看已报价商品；搜索时放开到全库（搜型号通常是为了给它添加报价）
      if (!showAll && !kw && row.quotes.length === 0) return false;
      if (category && row.category !== category) return false;
      if (onlyExpired && !row.quotes.some((q) => isExpired(q, today))) return false;
      if (!kw) return true;
      return (
        row.name.toLowerCase().includes(kw) ||
        row.spec.toLowerCase().includes(kw) ||
        row.quotes.some((q) => q.supplierName.toLowerCase().includes(kw) || q.supplierModel.toLowerCase().includes(kw))
      );
    });
    // 已有报价的商品排前面：报价库主视角是维护比价，缺报价长尾沉底
    return list.sort((a, b) => Number(b.quotes.length > 0) - Number(a.quotes.length > 0));
  }, [rows, search, category, showAll, onlyExpired, today]);

  // 物料量在千级，树形表按商品行分页
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, category, showAll, onlyExpired]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // 按厂家名/厂家型号搜索时命中行自动展开，否则用户看不到命中的子行；仅商品名命中不强制展开
  const kw = search.trim().toLowerCase();
  const hitsSupplier = (row: QuoteBookRow) =>
    kw.length > 0 &&
    row.quotes.some((q) => q.supplierName.toLowerCase().includes(kw) || q.supplierModel.toLowerCase().includes(kw));
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const quotedCount = rows.filter((r) => r.quotes.length > 0).length;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col p-4">
      <PageHeader
        Icon={Store}
        badge={t("采购管理")}
        title={t("供应商报价库")}
        description={t("同一商品跨厂家比价：维护各厂家的报价与起订量阶梯价，绿色为全场最低。")}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {can("proc-task:create") && (
              <button type="button" onClick={() => setCreateOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
                <Plus className="h-4 w-4" />{t("新增商品")}
              </button>
            )}
            {canWrite && (
              <button type="button" onClick={() => setImportOpen(true)} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
                <Upload className="h-4 w-4" />{t("批量导入")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!filtered.some((r) => r.quotes.length > 0)) { toast.warning(t("当前没有厂家报价可导出，请先录入或导入报价")); return; }
                void exportQuoteBookXlsx(filtered)
                  .then((n) => toast.success(t("已导出 {count} 行报价", { count: n })))
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : t("导出失败")));
              }}
              className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
            >
              <Download className="h-4 w-4" />{t("导出")}
            </button>
            {canWrite && (
              <button type="button" onClick={() => void downloadQuoteBookTemplate()} className="material-button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
                <FileSpreadsheet className="h-4 w-4" />{t("下载模板")}
              </button>
            )}
          </div>
        }
      />

      {/* 工具条：搜索 + 分类 + 缺报价/过期过滤 */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("搜索型号 / 规格 / 厂家")}
            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-300"
          />
        </div>
        {/* "all" 哨兵：Radix SelectItem 不允许空字符串 value，全站同款约定 */}
        <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-44 rounded-lg border-slate-200 bg-white text-sm text-slate-600">
            <SelectValue placeholder={t("全部分类")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("全部分类")}</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} />
          {t("显示全部商品（含未报价）")}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <Checkbox checked={onlyExpired} onCheckedChange={(v) => setOnlyExpired(v === true)} />
          {t("只看已过期")}
        </label>
        <span className="ml-auto text-xs text-slate-400">
          {t("共 {total} 个商品，{quoted} 个已有报价", { total: rows.length, quoted: quotedCount })}
        </span>
      </div>

      {/* 树形表：商品行（可展开）→ 厂家子行（阶梯 chips） */}
      {error ? (
        <div className="material-card py-12 text-center text-sm text-red-500">{error}</div>
      ) : loading ? (
        <div className="material-card py-12 text-center text-sm text-slate-400">{t("加载中")}…</div>
      ) : (
        /* 卡片占满剩余高度：表格区内部滚动，分页条固定在卡片底部（对齐物料库表格布局） */
        <div className="material-card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("型号 / 名称")}</th>
                <th className="px-3 py-2.5 font-medium">{t("分类")}</th>
                <th className="px-3 py-2.5 font-medium">{t("单位")}</th>
                <th className="px-3 py-2.5 font-medium">{t("厂家")}</th>
                <th className="px-3 py-2.5 font-medium">{t("全场最低")}</th>
                <th className="px-3 py-2.5 font-medium">{t("最近采购价")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    {!showAll && !search.trim() && quotedCount === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="text-sm text-slate-400">{t("报价库还是空的：导入业务报价表，或搜索商品逐条添加厂家报价")}</span>
                        {canWrite && (
                          <button type="button" onClick={() => setImportOpen(true)} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                            <Upload className="h-4 w-4" />{t("批量导入报价")}
                          </button>
                        )}
                        <button type="button" onClick={() => setShowAll(true)} className="text-xs text-indigo-600 hover:underline">{t("或显示全部商品（含未报价）")}</button>
                      </div>
                    ) : (
                      <span className="text-slate-400">{t("没有匹配的商品")}</span>
                    )}
                  </td>
                </tr>
              )}
              {pageRows.map((row) => {
                const open = expanded.has(row.id) || hitsSupplier(row);
                const best = lowestOf(row, today);
                return (
                  <QuoteBookMaterialRows
                    key={row.id}
                    row={row}
                    open={open}
                    best={best}
                    today={today}
                    canWrite={canWrite}
                    onToggle={() => toggle(row.id)}
                    onHistory={() => setHistoryFor(row.name)}
                    onAddQuote={() => setDrawer({ material: row })}
                    onEditQuote={(quote) => setDrawer({ material: row, quote })}
                    onDeleteQuote={removeQuote}
                    onClear={() => clearMaterial(row)}
                    onPreviewImage={setPreviewImage}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-slate-100 bg-white px-4 py-2">
            <span className="text-xs text-slate-400">{t("第 {page} / {total} 页", { page: pageSafe, total: totalPages })}</span>
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem><Button type="button" variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)} className="h-8 rounded-lg border-slate-200 text-xs text-slate-600">{t("上一页")}</Button></PaginationItem>
                <PaginationItem><Button type="button" variant="outline" size="sm" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)} className="h-8 rounded-lg border-slate-200 text-xs text-slate-600">{t("下一页")}</Button></PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}

      <PriceHistoryModal materialName={historyFor ?? ""} open={historyFor != null} onClose={() => setHistoryFor(null)} />
      {drawer && (
        <QuoteFormDrawer
          material={{ id: drawer.material.id, name: drawer.material.name, unit: drawer.material.unit }}
          quote={drawer.quote}
          onClose={() => setDrawer(null)}
          onSaved={reload}
        />
      )}
      {/* 新增商品复用物料表单（商品即物料）；关闭后刷新树，把新商品带进报价库 */}
      {createOpen && <MaterialFormModal onClose={() => { setCreateOpen(false); reload(); }} />}
      {importOpen && <QuoteImportModal rows={rows} onClose={() => setImportOpen(false)} onImported={reload} />}
      {previewImage && <ImageLightbox url={previewImage} onClose={() => setPreviewImage(null)} />}
      {confirmDialog}
    </div>
  );
}

function QuoteBookMaterialRows({
  row, open, best, today, canWrite, onToggle, onHistory, onAddQuote, onEditQuote, onDeleteQuote, onClear, onPreviewImage,
}: {
  row: QuoteBookRow;
  open: boolean;
  best: { quote: SupplierQuote; price: number; minQty: number } | null;
  today: string;
  canWrite: boolean;
  onToggle: () => void;
  onHistory: () => void;
  onAddQuote: () => void;
  onEditQuote: (quote: SupplierQuote) => void;
  onDeleteQuote: (quote: SupplierQuote) => void;
  onClear: () => void;
  onPreviewImage: (url: string) => void;
}) {
  const { t } = useI18n();
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Caret className={cn("h-4 w-4 shrink-0", row.quotes.length ? "text-slate-400" : "text-slate-200")} />
            {row.imageUrl && (
              <img
                src={row.imageUrl}
                alt=""
                title={t("点击查看商品图片")}
                onClick={(event) => { event.stopPropagation(); onPreviewImage(row.imageUrl!); }}
                className="h-10 w-10 shrink-0 cursor-zoom-in rounded-lg border border-slate-200 bg-white object-cover"
              />
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-800"><AutoTranslatedText text={row.name} /></div>
              {row.spec && <div className="truncate text-xs text-slate-400">{row.spec}</div>}
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-slate-500">{row.category || "—"}</td>
        <td className="px-3 py-2.5 text-slate-500">{row.unit || "—"}</td>
        <td className="px-3 py-2.5">
          {row.quotes.length > 0 ? (
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{t("{count} 家", { count: row.quotes.length })}</span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">{t("缺报价")}</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {best ? (
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums text-emerald-600">{fmtQuotePrice(best.price, best.quote.currency)}</span>
              <span className="text-xs text-slate-400">{best.quote.supplierName} · {best.minQty > 0 ? fmtMinQty(best.minQty) : t("不限")}</span>
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {row.latestPrice != null ? (
            <div className="flex items-baseline gap-1.5">
              <span className="tabular-nums text-slate-700">{fmtQuotePrice(row.latestPrice, "CNY")}</span>
              {row.latestQuoteDate && <span className="text-xs text-slate-400">{row.latestQuoteDate}</span>}
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1.5">
            {canWrite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddQuote(); }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
              >
                <Plus className="h-3.5 w-3.5" />{t("添加厂家")}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onHistory(); }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <History className="h-3.5 w-3.5" />{t("历史价格")}
            </button>
            {/* 默认常显：按报价数隐藏会让操作列在行与行之间忽宽忽窄，也让人以为这行不能移出。
                没有报价时置灰——后端只删厂家报价，此时点下去是 0 删除的空操作。 */}
            {canWrite && (
              <button
                type="button"
                disabled={row.quotes.length === 0}
                title={row.quotes.length === 0
                  ? t("该商品还没有厂家报价，无需移出")
                  : t("移出报价库：删除其下全部厂家报价")}
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent disabled:hover:text-slate-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && row.quotes.map((quote) => {
        const expired = isExpired(quote, today);
        return (
          <tr key={quote.id} className="border-t border-slate-50 bg-slate-50/40">
            <td className="py-2 pl-12 pr-4">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
                {quote.imageUrl && (
                  <img
                    src={quote.imageUrl}
                    alt=""
                    title={t("点击查看商品图片")}
                    onClick={(e) => { e.stopPropagation(); onPreviewImage(quote.imageUrl!); }}
                    className="h-9 w-9 shrink-0 cursor-zoom-in rounded-md border border-slate-200 object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-slate-700">{quote.supplierName}</div>
                  {quote.supplierModel && <div className="truncate text-xs text-slate-400">{quote.supplierModel}</div>}
                </div>
              </div>
            </td>
            <td colSpan={2} className="px-3 py-2">
              <TierChips quote={quote} bestPrice={best?.price ?? null} today={today} />
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">
              {quote.leadTimeDays > 0 ? t("交期 {n} 天", { n: quote.leadTimeDays }) : "—"}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">
              {quote.note ? <AutoTranslatedText text={quote.note} /> : !quote.taxIncluded ? t("不含税") : "—"}
            </td>
            <td className="px-3 py-2 text-xs">
              <div className="text-slate-500">{quote.quoteDate ?? "—"}</div>
              {quote.validUntil && (
                <div className={cn(expired ? "font-medium text-red-500" : "text-slate-400")}>
                  {expired ? t("已过期 {date}", { date: quote.validUntil }) : t("有效至 {date}", { date: quote.validUntil })}
                </div>
              )}
            </td>
            <td className="px-3 py-2">
              {canWrite && (
                <div className="flex items-center justify-end gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={t("编辑")} onClick={() => onEditQuote(quote)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t("编辑")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={t("删除")} onClick={() => onDeleteQuote(quote)} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t("删除")}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </td>
          </tr>
        );
      })}
      {open && row.quotes.length === 0 && (
        <tr className="border-t border-slate-50 bg-slate-50/40">
          <td colSpan={7} className="py-3 pl-12 text-xs text-slate-400">{t("该商品还没有厂家报价")}</td>
        </tr>
      )}
    </>
  );
}
