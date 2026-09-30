// 历史价格对比弹窗（任务详情与物料详情共用）：按物料过滤报价，支持按供应商分组、按时间/单价排序，顶部趋势折线。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownUp, BadgeCheck, CalendarDays, CircleDollarSign, History } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Toggle } from "../../components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { cn } from "../../components/ui/utils";
import { listQuotations, type Quotation } from "../../lib/procurementApi";
import { fmtMoney } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { Button } from "../../components/ui/button";

type SortKey = "date" | "price";
const supplierKey = (row: Quotation) => JSON.stringify(row.supplierId ? ['id', row.supplierId] : ['name', row.supplierName]);

function fmtQuotationPrice(price: number, currency: string): string {
  if (currency === "CNY") return fmtMoney(price);
  return `${currency} ${price.toLocaleString(i18nLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function TrendLine({ rows }: { rows: Quotation[] }) {
  const { t } = useI18n();
  const pts = [...rows].sort((a, b) => (a.quoteDate ?? "").localeCompare(b.quoteDate ?? ""));
  if (pts.length < 2) return null;
  const currency = pts[0]?.currency ?? "CNY";
  const w = 460, h = 84, pad = 20;
  const prices = pts.map((p) => p.unitPrice);
  const min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const co = pts.map((p, i) => ({ x: pad + (i * (w - pad * 2)) / (pts.length - 1), y: pad + (1 - (p.unitPrice - min) / span) * (h - pad * 2), p }));
  const path = co.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("{currency} 历史报价价格趋势", { currency })} className="h-auto w-full text-primary">
      <title>{t("{currency} 历史报价价格趋势", { currency })}</title>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
      {co.map((c, index) => (
        <g key={c.p.id}>
          <title>{c.p.quoteDate} · {fmtQuotationPrice(c.p.unitPrice, currency)}</title>
          <circle cx={c.x} cy={c.y} r={3} fill="currentColor" />
          {co.length <= 6 || index === 0 || index === co.length - 1 ? (
            <text x={c.x} y={c.y - 6} textAnchor={index === 0 ? "start" : index === co.length - 1 ? "end" : "middle"} className="fill-slate-500 text-[9px] tabular-nums">{c.p.unitPrice.toLocaleString(i18nLocale(), { notation: "compact", maximumFractionDigits: 2 })}</text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

export function PriceHistoryModal({ materialId, materialName, open, onClose }: { materialId?: string | null; materialName: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [groupBySupplier, setGroupBySupplier] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(true);
  const [currency, setCurrency] = useState("");
  const exactMaterialId = materialId?.trim() ? materialId : null;
  const scope = JSON.stringify([open, exactMaterialId, materialName]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [result, setResult] = useState<{ scope: string; rows: Quotation[]; error: string } | null>(null);
  // A new material is unread before its effect runs; never paint the previous material's prices.
  const rows = result?.scope === scope ? result.rows : [];
  const loading = open && result?.scope !== scope;
  const error = result?.scope === scope ? result.error : "";
  const requestIdRef = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (!open) return;
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current && scopeRef.current === scope;
    setResult(null);
    if (!exactMaterialId && !materialName.trim()) {
      setResult({ scope, rows: [], error: t("缺少物料标识，无法读取历史报价。") });
      return;
    }
    try {
      const nextRows = await listQuotations(exactMaterialId ? { materialId: exactMaterialId } : { materialName });
      if (!isCurrent()) return;
      if (exactMaterialId && nextRows.some((row) => row.materialId !== exactMaterialId)) {
        throw new Error(t("返回报价的物料身份不一致，请重新读取。"));
      }
      setResult({ scope, rows: nextRows, error: "" });
    } catch (caught) {
      if (isCurrent()) {
        setResult({ scope, rows: [], error: caught instanceof Error ? caught.message : t("历史报价加载失败") });
      }
    }
  }, [exactMaterialId, materialName, open, scope, t]);
  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      setResult(null);
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
    for (const r of sorted) { const key = supplierKey(r); if (!m.has(key)) m.set(key, []); m.get(key)!.push(r); }
    return Array.from(m.entries());
  }, [sorted]);
  const lowest = exactMaterialId && comparableRows.length ? comparableRows.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const latest = comparableRows.length ? comparableRows.reduce((a, b) => ((a.quoteDate ?? "") >= (b.quoteDate ?? "") ? a : b)) : null;
  const average = comparableRows.length ? comparableRows.reduce((sum, row) => sum + row.unitPrice, 0) / comparableRows.length : 0;
  const supplierCount = new Set(comparableRows.map(supplierKey)).size;
  const supplierLabel = (row: Quotation) => new Set(rows.filter(r => r.supplierName === row.supplierName).map(supplierKey)).size > 1
    ? `${row.supplierName}（${row.supplierId ? t('档案') + ' ' + row.supplierId : t('未关联档案')}）` : row.supplierName;
  if (!open) return null;
  const toggleSort = (k: SortKey) => { if (sortKey === k) setAsc((v) => !v); else { setSortKey(k); setAsc(true); } };
  const Row = ({ r }: { r: Quotation }) => (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 text-slate-600"><span className="line-clamp-2 break-words" title={supplierLabel(r)}>{supplierLabel(r)}</span>{r.isSelected && <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700"><BadgeCheck className="size-3" />{t('已选定')}</span>}</td>
      <td className={cn("break-all px-3 py-2 font-semibold tabular-nums", lowest && r === lowest ? "text-emerald-700" : "text-slate-800")}>{fmtQuotationPrice(r.unitPrice, r.currency)}{lowest && r === lowest && <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-emerald-700"><BadgeCheck className="size-3" />{t('该币种已读最低')}</span>}</td>
      <td className="break-words px-3 py-2 tabular-nums text-slate-500">{t('{n} 天', { n: r.leadTimeDays })}</td>
      <td className="break-words px-3 py-2 tabular-nums text-slate-500">{r.quoteDate}</td>
    </tr>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="proc-horizon-overlay proc-price-history flex flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl"
        onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 py-4 pr-14">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">
            {t('历史价格对比')}
            <span title={materialName} className="mt-1 block line-clamp-2 break-words text-sm font-medium text-slate-600"><AutoTranslatedText text={materialName} /></span>
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-500">{t(exactMaterialId ? '按正式物料查询最近最多 200 条报价，以下统计仅基于已读取范围。' : '同名候选报价：最近最多 200 条；未关联正式物料，可能包含不同规格或单位，请核对后再比较价格。')}</DialogDescription>
        </DialogHeader>
        <div className="proc-price-history-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          {loading ? (
            <div role="status" className="space-y-3 py-2" aria-label={t("正在加载历史报价")}>
              <div className="grid grid-cols-4 gap-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 rounded-xl bg-slate-100" />)}</div>
              <div className="h-28 rounded-xl bg-slate-100" />
              <div className="h-48 rounded-xl bg-slate-100" />
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center"><AlertTriangle className="size-6 text-rose-600" /><p className="max-w-full break-words text-pretty text-sm text-rose-700">{error}</p><Button variant="unstyled" type="button" onClick={() => void load()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</Button></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center"><History className="size-6 text-muted-foreground" /><p className="text-pretty text-sm text-muted-foreground">{t(exactMaterialId ? '该正式物料暂无已关联的历史报价。' : '未读取到同名候选报价。')}</p><Button variant="unstyled" type="button" onClick={onClose} className="material-button-secondary px-3 py-2 text-xs">{t("关闭并返回")}</Button></div>
          ) : (
            <>
              <p className="mb-3 text-pretty text-xs text-slate-500">{t("已读取 {count} 条报价，不代表全部历史。", { count: rows.length })}</p>
              {currencies.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                  <span className="text-xs font-semibold text-amber-900">{t("比较币种")}</span>
                  <ToggleGroup type="single" value={activeCurrency} onValueChange={(value) => { if (value) setCurrency(value); }} aria-label={t("历史报价比较币种")} variant="outline" size="sm" className="flex flex-wrap">
                    {currencies.map((code) => <ToggleGroupItem key={code} value={code} className="h-7 px-2 text-xs tabular-nums data-[state=on]:border-[var(--primary-soft-border)] data-[state=on]:bg-white data-[state=on]:text-primary">{code}</ToggleGroupItem>)}
                  </ToggleGroup>
                  <span className="text-pretty text-[11px] text-amber-800">{t(exactMaterialId ? "缺少汇率时不同币种不直接比较；以下指标、趋势和最低价均只基于所选币种。" : "不同币种不直接比较；以下仅显示所选币种的候选报价。")}</span>
                </div>
              )}
              {exactMaterialId && <><div className="proc-price-history-metrics mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { icon: CircleDollarSign, label: t("已读最低"), value: lowest ? fmtQuotationPrice(lowest.unitPrice, activeCurrency) : "—", detail: lowest?.supplierName ?? "—" },
                  { icon: CalendarDays, label: t("最近报价"), value: latest ? fmtQuotationPrice(latest.unitPrice, activeCurrency) : "—", detail: latest?.quoteDate ?? "—" },
                  { icon: ArrowDownUp, label: t("已读均价"), value: fmtQuotationPrice(average, activeCurrency), detail: t("基于 {count} 条同币种报价", { count: comparableRows.length }) },
                  { icon: History, label: t("供应商覆盖"), value: t("{count} 家", { count: supplierCount }), detail: t("共 {count} 条同币种记录", { count: comparableRows.length }) },
                ].map((item) => <div key={item.label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5"><div className="flex items-center gap-1.5 text-[11px] text-slate-500"><item.icon className="size-3.5 shrink-0" />{item.label}</div><strong className="mt-1 block break-all text-sm tabular-nums text-slate-900" title={item.value}>{item.value}</strong><span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={item.detail}>{item.detail}</span></div>)}
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1 text-xs font-medium text-slate-500">{t('{currency} 价格趋势（按时间）', { currency: activeCurrency })}</div>
                {comparableRows.length > 1 ? <TrendLine rows={comparableRows} /> : <p className="py-4 text-pretty text-xs text-slate-500">{t("至少两条报价可显示价格趋势")}</p>}
              </div></>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <Toggle pressed={groupBySupplier} onPressedChange={setGroupBySupplier} variant="outline" size="sm" className="h-8 rounded-lg border-slate-200 px-3 text-xs data-[state=on]:border-[var(--primary-soft-border)] data-[state=on]:bg-accent data-[state=on]:text-primary">{t('按供应商分组')}</Toggle>
                <ToggleGroup type="single" value={sortKey} variant="outline" size="sm" aria-label={t("报价排序")}>
                  <ToggleGroupItem value="date" onClick={() => toggleSort("date")} className="h-8 rounded-l-lg px-2 text-xs tabular-nums data-[state=on]:text-primary"><ArrowDownUp className="size-3" />{t('时间')}{sortKey === "date" ? (asc ? "↑" : "↓") : ""}</ToggleGroupItem>
                  <ToggleGroupItem value="price" onClick={() => toggleSort("price")} className="h-8 rounded-r-lg px-2 text-xs tabular-nums data-[state=on]:text-primary"><ArrowDownUp className="size-3" />{t('单价')}{sortKey === "price" ? (asc ? "↑" : "↓") : ""}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div role="region" aria-label={t("历史报价明细")} tabIndex={0} className="mt-3 max-h-72 overflow-auto overscroll-contain rounded-xl border border-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {groupBySupplier ? (
                  grouped.map(([sup, list]) => (
                    <div key={sup} className="min-w-xl">
                      <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                        <span className="min-w-0 max-w-full break-words" title={supplierLabel(list[0])}>{supplierLabel(list[0])}</span>
                        <span className="shrink-0 tabular-nums">{t('{count} 条', { count: list.length })}</span>
                      </div>
                      <table className="w-full min-w-xl table-fixed text-sm">
                        <caption className="sr-only">{t("{supplier}的{currency}历史报价", { supplier: supplierLabel(list[0]), currency: activeCurrency })}</caption>
                        <colgroup><col className="w-48" /><col className="w-40" /><col className="w-24" /><col className="w-32" /></colgroup>
                        <thead className="sr-only"><tr><th scope="col">{t('供应商')}</th><th scope="col">{t('单价')}</th><th scope="col">{t('交期')}</th><th scope="col">{t('报价日期')}</th></tr></thead>
                        <tbody>{list.map((r) => <Row key={r.id} r={r} />)}</tbody>
                      </table>
                    </div>
                  ))
                ) : (
                  <table className="w-full min-w-xl table-fixed text-sm">
                    <caption className="sr-only">{t("{material}的{currency}历史报价", { material: materialName, currency: activeCurrency })}</caption>
                    <colgroup><col className="w-48" /><col className="w-40" /><col className="w-24" /><col className="w-32" /></colgroup>
                    <thead className="sticky top-0 z-20"><tr className="bg-slate-50 text-left text-xs text-slate-500"><th scope="col" className="sticky left-0 z-30 border-r border-slate-100 bg-slate-50 px-3 py-2 font-medium">{t('供应商')}</th><th scope="col" className="px-3 py-2 font-medium">{t('单价')}</th><th scope="col" className="px-3 py-2 font-medium">{t('交期')}</th><th scope="col" className="px-3 py-2 font-medium">{t('报价日期')}</th></tr></thead>
                    <tbody>{sorted.map((r) => <Row key={r.id} r={r} />)}</tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
