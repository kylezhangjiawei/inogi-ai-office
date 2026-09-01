// 历史价格对比弹窗（任务详情与物料详情共用）：按物料过滤报价，支持按供应商分组、按时间/单价排序，顶部趋势折线。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownUp, BadgeCheck, CalendarDays, CircleDollarSign, History } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Toggle } from "../../components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { cn } from "../../components/ui/utils";
import { listQuotations, type Quotation } from "../../lib/procurementApi";
import { fmtMoney } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

type SortKey = "date" | "price";

function fmtQuotationPrice(price: number, currency: string): string {
  if (currency === "CNY") return fmtMoney(price);
  return `${currency} ${price.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function TrendLine({ rows }: { rows: Quotation[] }) {
  const { t } = useI18n();
  const pts = [...rows].sort((a, b) => (a.quoteDate ?? "").localeCompare(b.quoteDate ?? ""));
  if (pts.length < 2) return null;
  const currency = pts[0]?.currency ?? "CNY";
  const w = 460, h = 84, pad = 10;
  const prices = pts.map((p) => p.unitPrice);
  const min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const co = pts.map((p, i) => ({ x: pad + (i * (w - pad * 2)) / (pts.length - 1), y: pad + (1 - (p.unitPrice - min) / span) * (h - pad * 2), p }));
  const path = co.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={t("{currency} 历史报价价格趋势", { currency })} className="w-full">
      <title>{t("{currency} 历史报价价格趋势", { currency })}</title>
      <path d={path} fill="none" stroke="#002fa7" strokeWidth={2} />
      {co.map((c) => (
        <g key={c.p.id}>
          <circle cx={c.x} cy={c.y} r={3} fill="#002fa7" />
          <text x={c.x} y={c.y - 6} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">{c.p.unitPrice.toFixed(2)}</text>
        </g>
      ))}
    </svg>
  );
}

export function PriceHistoryModal({ materialName, open, onClose }: { materialName: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [groupBySupplier, setGroupBySupplier] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(true);
  const [currency, setCurrency] = useState("");
  // 报价按物料名跨任务聚合，弹窗打开时才拉取
  const [rows, setRows] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const nextRows = await listQuotations({ materialName });
      if (requestId === requestIdRef.current) setRows(nextRows);
    } catch (caught) {
      if (requestId === requestIdRef.current) {
        setRows([]);
        setError(caught instanceof Error ? caught.message : t("历史报价加载失败"));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [materialName, t]);
  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load, open]);
  const currencies = useMemo(
    () => Array.from(new Set(rows.map((row) => row.currency || "CNY"))).sort(),
    [rows],
  );
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] ?? "CNY";
  const comparableRows = useMemo(
    () => rows.filter((row) => (row.currency || "CNY") === activeCurrency),
    [activeCurrency, rows],
  );
  const sorted = useMemo(() => {
    const arr = [...comparableRows].sort((a, b) => (sortKey === "date" ? (a.quoteDate ?? "").localeCompare(b.quoteDate ?? "") : a.unitPrice - b.unitPrice));
    return asc ? arr : arr.reverse();
  }, [comparableRows, sortKey, asc]);
  const grouped = useMemo(() => {
    const m = new Map<string, Quotation[]>();
    for (const r of sorted) { if (!m.has(r.supplierName)) m.set(r.supplierName, []); m.get(r.supplierName)!.push(r); }
    return Array.from(m.entries());
  }, [sorted]);
  const lowest = comparableRows.length ? comparableRows.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const latest = comparableRows.length ? comparableRows.reduce((a, b) => ((a.quoteDate ?? "") >= (b.quoteDate ?? "") ? a : b)) : null;
  const average = comparableRows.length ? comparableRows.reduce((sum, row) => sum + row.unitPrice, 0) / comparableRows.length : 0;
  const supplierCount = new Set(comparableRows.map((row) => row.supplierName)).size;
  if (!open) return null;
  const toggleSort = (k: SortKey) => { if (sortKey === k) setAsc((v) => !v); else { setSortKey(k); setAsc(true); } };
  const Row = ({ r }: { r: Quotation }) => (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="max-w-52 px-3 py-2 text-slate-600"><span className="block truncate" title={r.supplierName}>{r.supplierName}</span>{r.isSelected && <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700"><BadgeCheck className="size-3" />{t('已选定')}</span>}</td>
      <td className={cn("px-3 py-2 font-semibold tabular-nums", lowest && r === lowest ? "text-emerald-700" : "text-slate-800")}>{fmtQuotationPrice(r.unitPrice, r.currency)}{lowest && r === lowest && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-emerald-700"><BadgeCheck className="size-3" />{t('该币种最低')}</span>}</td>
      <td className="px-3 py-2 tabular-nums text-slate-500">{t('{n} 天', { n: r.leadTimeDays })}</td>
      <td className="px-3 py-2 tabular-nums text-slate-500">{r.quoteDate}</td>
    </tr>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="proc-horizon-overlay gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle className="flex text-balance text-base font-bold text-slate-900">{t('历史价格对比')} ·&nbsp;<AutoTranslatedText text={materialName} /></DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-400">{t('跨供应商历史报价，支持分组与排序对比')}</DialogDescription>
        </DialogHeader>
        <div className="px-6 py-4">
          {loading ? (
            <div className="space-y-3 py-2" aria-label={t("正在加载历史报价")}>
              <div className="grid grid-cols-4 gap-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 rounded-xl bg-slate-100" />)}</div>
              <div className="h-28 rounded-xl bg-slate-100" />
              <div className="h-48 rounded-xl bg-slate-100" />
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center"><AlertTriangle className="size-6 text-rose-600" /><p className="max-w-md text-pretty text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</button></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center"><History className="size-6 text-slate-300" /><p className="text-pretty text-sm text-slate-400">{t('该物料暂无历史报价，可先在采购任务中录入供应商报价。')}</p><button type="button" onClick={onClose} className="material-button-secondary px-3 py-2 text-xs">{t("关闭并返回")}</button></div>
          ) : (
            <>
              {currencies.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                  <span className="text-xs font-semibold text-amber-900">{t("比较币种")}</span>
                  <ToggleGroup type="single" value={activeCurrency} onValueChange={(value) => { if (value) setCurrency(value); }} aria-label={t("历史报价比较币种")} variant="outline" size="sm">
                    {currencies.map((code) => <ToggleGroupItem key={code} value={code} className="h-7 px-2 text-xs tabular-nums data-[state=on]:border-[#cbd8f6] data-[state=on]:bg-white data-[state=on]:text-[#002fa7]">{code}</ToggleGroupItem>)}
                  </ToggleGroup>
                  <span className="text-pretty text-[11px] text-amber-800">{t("缺少汇率时不同币种不直接比较；以下指标、趋势和最低价均只基于所选币种。")}</span>
                </div>
              )}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { icon: CircleDollarSign, label: t("历史最低"), value: lowest ? fmtQuotationPrice(lowest.unitPrice, activeCurrency) : "—", detail: lowest?.supplierName ?? "—" },
                  { icon: CalendarDays, label: t("最近报价"), value: latest ? fmtQuotationPrice(latest.unitPrice, activeCurrency) : "—", detail: latest?.quoteDate ?? "—" },
                  { icon: ArrowDownUp, label: t("历史均价"), value: fmtQuotationPrice(average, activeCurrency), detail: t("基于 {count} 条同币种报价", { count: comparableRows.length }) },
                  { icon: History, label: t("供应商覆盖"), value: t("{count} 家", { count: supplierCount }), detail: t("共 {count} 条同币种记录", { count: comparableRows.length }) },
                ].map((item) => <div key={item.label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5"><div className="flex items-center gap-1.5 text-[11px] text-slate-500"><item.icon className="size-3.5" />{item.label}</div><strong className="mt-1 block truncate text-sm tabular-nums text-slate-900" title={item.value}>{item.value}</strong><span className="mt-0.5 block truncate text-[10px] text-slate-400" title={item.detail}>{item.detail}</span></div>)}
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1 text-xs font-medium text-slate-500">{t('{currency} 价格趋势（按时间）', { currency: activeCurrency })}</div>
                <TrendLine rows={comparableRows} />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Toggle pressed={groupBySupplier} onPressedChange={setGroupBySupplier} variant="outline" size="sm" className="h-8 rounded-lg border-slate-200 px-3 text-xs data-[state=on]:border-[#cbd8f6] data-[state=on]:bg-[#eef3ff] data-[state=on]:text-[#002fa7]">{t('按供应商分组')}</Toggle>
                <ToggleGroup type="single" value={sortKey} variant="outline" size="sm" aria-label={t("报价排序")}>
                  <ToggleGroupItem value="date" onClick={() => toggleSort("date")} className="h-8 rounded-l-lg px-2 text-xs tabular-nums data-[state=on]:text-[#002fa7]"><ArrowDownUp className="size-3" />{t('时间')}{sortKey === "date" ? (asc ? "↑" : "↓") : ""}</ToggleGroupItem>
                  <ToggleGroupItem value="price" onClick={() => toggleSort("price")} className="h-8 rounded-r-lg px-2 text-xs tabular-nums data-[state=on]:text-[#002fa7]"><ArrowDownUp className="size-3" />{t('单价')}{sortKey === "price" ? (asc ? "↑" : "↓") : ""}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <ScrollArea className="mt-3 h-72 rounded-xl border border-slate-100">
                {groupBySupplier ? (
                  grouped.map(([sup, list]) => (
                    <div key={sup}>
                      <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-500">{sup} · {t('{count} 条', { count: list.length })}</div>
                      <table className="w-full text-sm">
                        <caption className="sr-only">{t("{supplier}的{currency}历史报价", { supplier: sup, currency: activeCurrency })}</caption>
                        <thead className="sr-only"><tr><th scope="col">{t('供应商')}</th><th scope="col">{t('单价')}</th><th scope="col">{t('交期')}</th><th scope="col">{t('报价日期')}</th></tr></thead>
                        <tbody>{list.map((r) => <Row key={r.id} r={r} />)}</tbody>
                      </table>
                    </div>
                  ))
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("{material}的{currency}历史报价", { material: materialName, currency: activeCurrency })}</caption>
                    <thead><tr className="bg-slate-50 text-left text-xs text-slate-500"><th scope="col" className="px-3 py-2 font-medium">{t('供应商')}</th><th scope="col" className="px-3 py-2 font-medium">{t('单价')}</th><th scope="col" className="px-3 py-2 font-medium">{t('交期')}</th><th scope="col" className="px-3 py-2 font-medium">{t('报价日期')}</th></tr></thead>
                    <tbody>{sorted.map((r) => <Row key={r.id} r={r} />)}</tbody>
                  </table>
                )}
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
