// 采购任务详情抽屉：步骤条(询价长/直购短) + 下一步操作卡 + 基本信息 + 报价 + 样品测试 + 下单付款 + 到货 + 日志。
import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, History, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { BusinessLinePill, DIRECT_FLOW, INQUIRY_FLOW, MethodPill, PROC_STATUS_META, PersonAvatar, SourcePill, StatusPill, fmtMoney, stageToast } from "./common";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { QUOTATIONS, taskRequester, type ProcurementTask } from "../../../mock/procurement";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{t(label)}</span>
      <span className="min-w-0 text-slate-700">{value}</span>
    </div>
  );
}

export function TaskDetailDrawer({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const requester = taskRequester(task);
  const meta = PROC_STATUS_META[task.status];
  const flow = task.method === "direct" ? DIRECT_FLOW : INQUIRY_FLOW;
  const curIdx = flow.indexOf(task.status);
  const quotes = useMemo(() => QUOTATIONS.filter((q) => q.materialName === task.materialName), [task.materialName]);
  const histLow = quotes.length ? quotes.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const selected = quotes.find((q) => q.isSelected);
  const pct = task.quantity > 0 ? Math.round((task.arrivedQty / task.quantity) * 100) : 0;
  // 是否已进入下单阶段（此前「下单与付款」「到货记录」还没有内容，不展示）
  const orderStage = ["pending_purchase", "priced", "in_transit", "partial_arrival", "completed"].includes(task.status);

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
          <AutoTranslatedText as="div" className="mt-1 text-sm text-slate-500" text={`${task.materialName} · ${task.spec} · ${task.quantity}${task.unit}`} />
          {/* 步骤条 */}
          <div className="mt-4 flex items-center overflow-x-auto pb-1">
            {flow.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold", i < curIdx ? "bg-emerald-500 text-white" : i === curIdx ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-400")}>{i + 1}</span>
                  <span className={cn("whitespace-nowrap text-[10px]", i === curIdx ? "font-semibold text-indigo-600" : "text-slate-400")}>{t(PROC_STATUS_META[s].label)}</span>
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
              <div className="text-xs font-semibold text-indigo-500">{t('下一步 · 责任人：')}{task.status === "testing" ? task.rdContact ?? t("研发对接人") : task.buyer}</div>
              <p className="mt-1 text-sm text-slate-700">{t('当前状态「{status}」，下一步：{next}。', { status: t(meta.label), next: t(meta.next) })}</p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => (task.method === "direct" && task.status === "pending_purchase" ? window.open(task.purchaseLink, "_blank") : stageToast())} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                  {t(meta.next)}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* 基本信息 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">{t('基本信息')}</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <Info label="物料 / 规格" value={<AutoTranslatedText text={`${task.materialName} · ${task.spec}`} />} />
                <Info label="数量" value={`${task.quantity} ${t(task.unit)}`} />
                <Info label="需求日期" value={task.needDate} />
                {task.deadline && <Info label="Deadline" value={task.deadline} />}
              </div>
              <div>
                <Info label="需求提出人" value={
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={requester.name} size="xs" />
                    <span className="font-medium">{requester.name}</span>
                    <span className="text-xs text-slate-400">{t(requester.dept)}</span>
                  </span>
                } />
                <Info label="采购负责人" value={
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={task.buyer} size="xs" />
                    <span className="font-medium">{task.buyer}</span>
                    <span className="text-xs text-slate-400">{t('采购部')}</span>
                  </span>
                } />
                {task.rdContact && <Info label="研发对接人" value={task.rdContact} />}
                {task.source === "rd" && task.rdTaskTitle && <Info label="关联研发任务" value={<AutoTranslatedText className="text-indigo-600" text={task.rdTaskTitle} />} />}
                {task.method === "direct" && task.purchaseLink && <Info label="商品链接" value={<a href={task.purchaseLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">{t('打开链接')} <ExternalLink className="h-3.5 w-3.5" /></a>} />}
              </div>
            </div>
            {task.consumableNote && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{t('低值易耗品：')}<AutoTranslatedText text={task.consumableNote} /></div>}
          </div>

          {/* 报价区（询价）：仅在已有报价数据时展示 */}
          {task.method === "inquiry" && quotes.length > 0 && (
            <div className="space-y-3">
              {histLow && (
                <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 text-xs text-slate-600">
                  <span className="flex items-center gap-2"><History className="h-4 w-4 text-indigo-500" />{t('该物料历史最低')} <b className="text-emerald-600">{fmtMoney(histLow.unitPrice)}</b> · {histLow.supplierName} · {histLow.quoteDate}</span>
                  <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 font-medium text-indigo-600 hover:underline">{t('历史价格')}</button>
                </div>
              )}
              <div className="rounded-xl border border-slate-100">
                <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{t('供应商报价（{count}）', { count: quotes.length })}</div>
                <ul className="divide-y divide-slate-100">
                  {quotes.map((q, i) => (
                    <li key={i} className={cn("flex items-center justify-between px-4 py-2.5", q.isSelected && "bg-emerald-50/40")}>
                      <span className="flex items-center gap-3"><span className="text-sm font-medium text-slate-700">{q.supplierName}</span><span className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(q.unitPrice)}</span><span className="text-xs text-slate-400">{t('交期 {count} 天', { count: q.leadTimeDays })}</span>{q.isSelected && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">{t('已选定')}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 样品测试区：仅展示已产生的数据 */}
          {task.needSample && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('样品与测试')}</div>
              {selected && <Info label="打样报价" value={t('{supplier} · {price} · 交期 {count} 天', { supplier: selected.supplierName, price: fmtMoney(selected.unitPrice), count: selected.leadTimeDays })} />}
              <Info label="到样时间" value={t(["pending_sample"].includes(task.status) ? "待到样" : "已到样")} />
              {(task.status === "testing" || ["priced", "in_transit", "partial_arrival", "completed"].includes(task.status)) && (
                <Info label="测试结论" value={t(task.status === "testing" ? "测试中" : "测试通过")} />
              )}
            </div>
          )}

          {/* 下单与付款 / 到货记录：仅在任务进入下单阶段后展示，前期阶段无内容不占位 */}
          {orderStage && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('下单与付款')}</div>
              <Info label="付款状态" value={task.paymentStatus === "paid" ? t("已付款") : task.paymentStatus === "partial" ? <>{t('部分付款{note}', { note: '' })}{task.paymentNote ? <> (<AutoTranslatedText text={task.paymentNote} />)</> : null}</> : t("未付款")} />
              {task.paymentDate && <Info label="付款日期" value={task.paymentDate} />}
              {task.expectedArrivalDate && <Info label="预计到货" value={task.expectedArrivalDate} />}
            </div>
          )}

          {(orderStage || task.arrivedQty > 0) && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('到货记录')}</div>
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} /></div>
              <div className="text-xs text-slate-500">{t('已到货')} <b className="tabular-nums">{task.arrivedQty.toLocaleString()}</b> / {task.quantity.toLocaleString()}{t(task.unit)} ({pct}%)</div>
            </div>
          )}

          {/* 操作日志 */}
          <div className="rounded-xl border border-slate-100">
            <button type="button" onClick={() => setLogsOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-700">{t('操作日志（{count}）', { count: task.logs.length })}<ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", logsOpen && "rotate-180")} /></button>
            {logsOpen && <ul className="space-y-2 border-t border-slate-100 px-4 py-3">{task.logs.map((l, i) => <li key={i} className="flex gap-3 text-sm"><span className="w-24 shrink-0 text-xs text-slate-400">{l.at}</span><AutoTranslatedText className="text-slate-600" text={l.text} /></li>)}</ul>}
          </div>
        </div>
      </div>
      <PriceHistoryModal materialName={task.materialName} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
