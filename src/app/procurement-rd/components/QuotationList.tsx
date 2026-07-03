// 场景3 · 报价区：历史价格提示卡 + 报价列表 + 录报价 + 选定并要样。
import { useMemo, useState } from "react";
import { CheckCircle2, History, Plus } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import { SUPPLIERS } from "../data/mockData";
import type { Requirement } from "../data/types";
import { fmtMoney } from "./common";

export function QuotationList({ req, onOpenHistory }: { req: Requirement; onOpenHistory: () => void }) {
  const { priceHistory } = useProc();
  const [adding, setAdding] = useState(false);
  const [supplier, setSupplier] = useState(SUPPLIERS[2]);
  const [price, setPrice] = useState("3.50");
  const [leadDays, setLeadDays] = useState("12");

  const canQuote = req.status === "pending_inquiry" || req.status === "inquiring";
  const canSelect = req.status === "inquiring";

  const hist = useMemo(() => priceHistory.filter((r) => r.material === req.materialName), [priceHistory, req.materialName]);
  const histLow = hist.length ? hist.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const histRecent = hist.length ? [...hist].sort((a, b) => b.date.localeCompare(a.date))[0] : null;

  const submitQuote = () => {
    const p = Number(price);
    const l = Number(leadDays);
    if (!supplier || !p || !l) return;
    procActions.addQuote(req.id, { supplier, unitPrice: p, leadDays: l });
    setAdding(false);
    setPrice("3.50");
    setLeadDays("12");
  };

  return (
    <div className="space-y-3">
      {/* 历史价格提示卡 */}
      <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <History className="h-4 w-4 text-indigo-500" />
          {histLow && histRecent ? (
            <span>
              该物料历史最低 <b className="text-emerald-600">{fmtMoney(histLow.unitPrice)}</b>（{histLow.supplier}，{histLow.date}） · 最近{" "}
              <b className="text-slate-700">{fmtMoney(histRecent.unitPrice)}</b>
            </span>
          ) : (
            <span>该物料为首次采购，暂无历史成交价，可参考同类物料历史价格对比</span>
          )}
        </div>
        <button type="button" onClick={onOpenHistory} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline">
          历史价格
        </button>
      </div>

      {/* 报价列表 */}
      <div className="rounded-xl border border-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-sm font-semibold text-slate-700">供应商报价（{req.quotes.length}）</span>
          {canQuote && (
            <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">
              <Plus className="h-3.5 w-3.5" />
              录报价
            </button>
          )}
        </div>

        {adding && (
          <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              供应商
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700">
                {SUPPLIERS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              单价(¥)
              <input value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-24 rounded-md border border-slate-200 px-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              交期(天)
              <input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} className="h-8 w-20 rounded-md border border-slate-200 px-2 text-sm" />
            </label>
            <button type="button" onClick={submitQuote} className="material-button-primary h-8 px-3 text-xs">
              保存报价
            </button>
          </div>
        )}

        {req.quotes.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-400">暂无报价，点击「录报价」录入</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {req.quotes.map((q) => (
              <li key={q.id} className={cn("flex items-center justify-between px-4 py-2.5", q.selected && "bg-emerald-50/40")}>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">{q.supplier}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(q.unitPrice)}</span>
                  <span className="text-xs text-slate-400">交期 {q.leadDays} 天</span>
                  {q.requestedSample && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-600">
                      <CheckCircle2 className="h-3 w-3" />
                      已选定要样
                    </span>
                  )}
                </div>
                {canSelect && !q.selected && (
                  <button type="button" onClick={() => procActions.selectForSample(req.id, q.id)} className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700">
                    选定并要样
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
