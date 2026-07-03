// 采购任务详情抽屉：步骤条(询价长/直购短) + 下一步操作卡 + 基本信息 + 报价 + 样品测试 + 下单付款 + 到货 + 日志。
import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, History, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { BusinessLinePill, DIRECT_FLOW, INQUIRY_FLOW, MethodPill, PROC_STATUS_META, PersonAvatar, SourcePill, StatusPill, fmtMoney, stageToast } from "./common";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { QUOTATIONS, type ProcurementTask } from "../../../mock/procurement";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 text-slate-700">{value}</span>
    </div>
  );
}

export function TaskDetailDrawer({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const meta = PROC_STATUS_META[task.status];
  const flow = task.method === "direct" ? DIRECT_FLOW : INQUIRY_FLOW;
  const curIdx = flow.indexOf(task.status);
  const quotes = useMemo(() => QUOTATIONS.filter((q) => q.materialName === task.materialName), [task.materialName]);
  const histLow = quotes.length ? quotes.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const selected = quotes.find((q) => q.isSelected);
  const pct = task.quantity > 0 ? Math.round((task.arrivedQty / task.quantity) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-[720px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">{task.code}</h3>
              <StatusPill status={task.status} />
              <BusinessLinePill line={task.businessLine} />
              <SourcePill source={task.source} />
              <MethodPill method={task.method} />
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-1 text-sm text-slate-500">{task.materialName} · {task.spec} · {task.quantity}{task.unit}</div>
          {/* 步骤条 */}
          <div className="mt-4 flex items-center overflow-x-auto pb-1">
            {flow.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold", i < curIdx ? "bg-emerald-500 text-white" : i === curIdx ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-400")}>{i + 1}</span>
                  <span className={cn("whitespace-nowrap text-[10px]", i === curIdx ? "font-semibold text-indigo-600" : "text-slate-400")}>{PROC_STATUS_META[s].label}</span>
                </div>
                {i < flow.length - 1 && <div className={cn("mx-1 h-0.5 w-5", i < curIdx ? "bg-emerald-400" : "bg-slate-200")} />}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* 下一步操作卡 */}
          {meta.next && (
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
              <div className="text-xs font-semibold text-indigo-500">下一步 · 责任人：{task.status === "testing" ? task.rdContact ?? "研发对接人" : task.buyer}</div>
              <p className="mt-1 text-sm text-slate-700">当前状态「{meta.label}」，下一步：{meta.next}。</p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => (task.method === "direct" && task.status === "pending_purchase" ? window.open(task.purchaseLink, "_blank") : stageToast())} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                  {meta.next}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* 基本信息 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">基本信息</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <Info label="物料 / 规格" value={`${task.materialName} · ${task.spec}`} />
                <Info label="数量" value={`${task.quantity} ${task.unit}`} />
                <Info label="需求日期" value={task.needDate} />
                <Info label="Deadline" value={task.deadline ?? "—"} />
              </div>
              <div>
                <Info label="采购负责人" value={task.buyer} />
                <Info label="研发对接人" value={task.rdContact ?? "—"} />
                {task.source === "rd" && <Info label="关联研发任务" value={<span className="inline-flex items-center gap-1 text-indigo-600">{task.rdTaskTitle} <ExternalLink className="h-3.5 w-3.5" /></span>} />}
                {task.method === "direct" && <Info label="商品链接" value={task.purchaseLink ? <a href={task.purchaseLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">打开链接 <ExternalLink className="h-3.5 w-3.5" /></a> : "—"} />}
              </div>
            </div>
            {task.consumableNote && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">低值易耗品：{task.consumableNote}</div>}
          </div>

          {/* 报价区（询价） */}
          {task.method === "inquiry" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 text-xs text-slate-600">
                <span className="flex items-center gap-2"><History className="h-4 w-4 text-indigo-500" />{histLow ? <>该物料历史最低 <b className="text-emerald-600">{fmtMoney(histLow.unitPrice)}</b> · {histLow.supplierName} · {histLow.quoteDate}</> : "该物料暂无历史报价"}</span>
                <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 font-medium text-indigo-600 hover:underline">历史价格</button>
              </div>
              <div className="rounded-xl border border-slate-100">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                  <span className="text-sm font-semibold text-slate-700">供应商报价（{quotes.length}）</span>
                  <button type="button" onClick={stageToast} className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">录报价</button>
                </div>
                {quotes.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-400">暂无报价</div> : (
                  <ul className="divide-y divide-slate-100">
                    {quotes.map((q, i) => (
                      <li key={i} className={cn("flex items-center justify-between px-4 py-2.5", q.isSelected && "bg-emerald-50/40")}>
                        <span className="flex items-center gap-3"><span className="text-sm font-medium text-slate-700">{q.supplierName}</span><span className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(q.unitPrice)}</span><span className="text-xs text-slate-400">交期 {q.leadTimeDays} 天</span>{q.isSelected && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">已选定</span>}</span>
                        {!q.isSelected && <button type="button" onClick={stageToast} className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700">选定</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* 样品测试区 */}
          {task.needSample && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">样品与测试</div>
              <Info label="打样报价" value={selected ? `${selected.supplierName} · ${fmtMoney(selected.unitPrice)} · 交期${selected.leadTimeDays}天` : "—"} />
              <Info label="到样时间" value={["pending_sample"].includes(task.status) ? "待到样" : "已到样"} />
              <Info label="测试结论" value={task.status === "testing" ? "测试中" : ["priced", "in_transit", "partial_arrival", "completed"].includes(task.status) ? "测试通过" : "—"} />
              {task.status === "testing" && <button type="button" onClick={stageToast} className="mt-2 rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">录入测试结论</button>}
            </div>
          )}

          {/* 下单与付款 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">下单与付款</div>
            <Info label="付款状态" value={task.paymentStatus === "paid" ? "已付款" : task.paymentStatus === "partial" ? `部分付款${task.paymentNote ? `（${task.paymentNote}）` : ""}` : "未付款"} />
            <Info label="付款日期" value={task.paymentDate ?? "—"} />
            <Info label="预计到货" value={task.expectedArrivalDate ?? "—"} />
          </div>

          {/* 到货记录 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">到货记录</span>
              {["priced", "in_transit", "partial_arrival"].includes(task.status) && <button type="button" onClick={stageToast} className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50">登记到货</button>}
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} /></div>
            <div className="text-xs text-slate-500">已到货 <b className="tabular-nums">{task.arrivedQty.toLocaleString()}</b> / {task.quantity.toLocaleString()}{task.unit}（{pct}%）</div>
          </div>

          {/* 操作日志 */}
          <div className="rounded-xl border border-slate-100">
            <button type="button" onClick={() => setLogsOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-700">操作日志（{task.logs.length}）<ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", logsOpen && "rotate-180")} /></button>
            {logsOpen && <ul className="space-y-2 border-t border-slate-100 px-4 py-3">{task.logs.map((l, i) => <li key={i} className="flex gap-3 text-sm"><span className="w-24 shrink-0 text-xs text-slate-400">{l.at}</span><span className="text-slate-600">{l.text}</span></li>)}</ul>}
          </div>
        </div>
      </div>
      <PriceHistoryModal materialName={task.materialName} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
