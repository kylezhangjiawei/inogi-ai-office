// 历史价格对比弹窗（任务详情与物料详情共用）：按物料过滤报价，支持按供应商分组、按时间/单价排序，顶部趋势折线。
import { useMemo, useState } from "react";
import { ArrowDownUp, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { QUOTATIONS, type Quotation } from "../../../mock/procurement";
import { fmtMoney } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

type SortKey = "date" | "price";

function TrendLine({ rows }: { rows: Quotation[] }) {
  const pts = [...rows].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
  if (pts.length < 2) return null;
  const w = 460, h = 84, pad = 10;
  const prices = pts.map((p) => p.unitPrice);
  const min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const co = pts.map((p, i) => ({ x: pad + (i * (w - pad * 2)) / (pts.length - 1), y: pad + (1 - (p.unitPrice - min) / span) * (h - pad * 2), p }));
  const path = co.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="w-full">
      <path d={path} fill="none" stroke="#6D5CFF" strokeWidth={2} />
      {co.map((c) => (
        <g key={c.p.quoteDate + c.p.supplierName}>
          <circle cx={c.x} cy={c.y} r={3} fill="#6D5CFF" />
          <text x={c.x} y={c.y - 6} textAnchor="middle" className="fill-slate-500 text-[9px]">{c.p.unitPrice.toFixed(2)}</text>
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
  const rows = useMemo(() => QUOTATIONS.filter((q) => q.materialName === materialName), [materialName]);
  const sorted = useMemo(() => {
    const arr = [...rows].sort((a, b) => (sortKey === "date" ? a.quoteDate.localeCompare(b.quoteDate) : a.unitPrice - b.unitPrice));
    return asc ? arr : arr.reverse();
  }, [rows, sortKey, asc]);
  const grouped = useMemo(() => {
    const m = new Map<string, Quotation[]>();
    for (const r of sorted) { if (!m.has(r.supplierName)) m.set(r.supplierName, []); m.get(r.supplierName)!.push(r); }
    return Array.from(m.entries());
  }, [sorted]);
  const lowest = rows.length ? rows.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  if (!open) return null;
  const toggleSort = (k: SortKey) => { if (sortKey === k) setAsc((v) => !v); else { setSortKey(k); setAsc(true); } };
  const Row = ({ r }: { r: Quotation }) => (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 text-slate-600">{r.supplierName}{r.isSelected && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">{t('已选定')}</span>}</td>
      <td className={cn("px-3 py-2 font-semibold tabular-nums", lowest && r === lowest ? "text-emerald-600" : "text-slate-800")}>{fmtMoney(r.unitPrice)}{lowest && r === lowest && <span className="ml-1 text-[10px] text-emerald-500">{t('最低')}</span>}</td>
      <td className="px-3 py-2 tabular-nums text-slate-500">{t('{n} 天', { n: r.leadTimeDays })}</td>
      <td className="px-3 py-2 tabular-nums text-slate-500">{r.quoteDate}</td>
    </tr>
  );
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="flex text-base font-bold text-slate-900">{t('历史价格对比')} ·&nbsp;<AutoTranslatedText text={materialName} /></h3>
            <p className="mt-0.5 text-xs text-slate-400">{t('跨供应商历史报价，支持分组与排序对比')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-4">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{t('该物料暂无历史报价')}</div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1 text-xs font-medium text-slate-500">{t('价格趋势（按时间）')}</div>
                <TrendLine rows={rows} />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" onClick={() => setGroupBySupplier((v) => !v)} className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", groupBySupplier ? "border-indigo-200 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{groupBySupplier ? `✓ ${t('按供应商分组')}` : t('按供应商分组')}</button>
                <div className="flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => toggleSort("date")} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1", sortKey === "date" ? "border-indigo-200 text-indigo-600" : "border-slate-200 text-slate-500")}><ArrowDownUp className="h-3 w-3" />{t('时间')}{sortKey === "date" ? (asc ? "↑" : "↓") : ""}</button>
                  <button type="button" onClick={() => toggleSort("price")} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1", sortKey === "price" ? "border-indigo-200 text-indigo-600" : "border-slate-200 text-slate-500")}><ArrowDownUp className="h-3 w-3" />{t('单价')}{sortKey === "price" ? (asc ? "↑" : "↓") : ""}</button>
                </div>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-100">
                {groupBySupplier ? (
                  grouped.map(([sup, list]) => (
                    <div key={sup}>
                      <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">{sup} · {t('{count} 条', { count: list.length })}</div>
                      <table className="w-full text-sm"><tbody>{list.map((r, i) => <Row key={i} r={r} />)}</tbody></table>
                    </div>
                  ))
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-left text-xs text-slate-500"><th className="px-3 py-2 font-medium">{t('供应商')}</th><th className="px-3 py-2 font-medium">{t('单价')}</th><th className="px-3 py-2 font-medium">{t('交期')}</th><th className="px-3 py-2 font-medium">{t('报价日期')}</th></tr></thead>
                    <tbody>{sorted.map((r, i) => <Row key={i} r={r} />)}</tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
