// 物料详情抽屉：基本信息 + 库存与到货时间线 + 历史价格对比 + 关联采购任务列表 + 待审核物料的审核区。
import { useState } from "react";
import { HelpCircle, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../components/ui/utils";
import { materialAggregates, refreshProcurement, useProcurementData, type Material } from "../data";
import { reviewMaterial } from "../../lib/procurementApi";
import { MaterialFormModal } from "./modals";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { StatusPill, fmtMoney, useProcCan } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  const { t } = useI18n();
  return <div className="flex gap-2 py-0.5 text-sm"><span className="w-24 shrink-0 text-slate-400">{t(label)}</span><span className="text-slate-700">{value}</span></div>;
}

export function MaterialDetailDrawer({ material, onClose, onOpenTask }: { material: Material; onClose: () => void; onOpenTask: (taskId: string) => void }) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const can = useProcCan();
  const { tasks } = useProcurementData();

  // 审核就在详情里做：审核人此时能看到规格/库存/历史价格/关联任务等完整上下文
  const decide = async (reviewStatus: "approved" | "rejected") => {
    setReviewBusy(true);
    try {
      await reviewMaterial(material.id, reviewStatus, reviewNote.trim() || undefined);
      await refreshProcurement();
      toast.success(t(reviewStatus === "approved" ? "已通过审核" : "已驳回"));
      setReviewNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("审核失败"));
    } finally {
      setReviewBusy(false);
    }
  };
  const { inTransit, taskCount } = materialAggregates(tasks, material.name);
  const related = tasks.filter((t) => t.materialName === material.name);
  // 到货时间线（从关联任务的到货聚合，V1 单边只增）
  const arrivals = related.filter((t) => t.arrivedQty > 0).map((t) => ({ code: t.code, qty: t.arrivedQty, date: t.expectedArrivalDate ?? t.needDate }));

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-[640px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <AutoTranslatedText as="span" className="text-lg font-bold text-slate-900" text={material.name} />
              {material.isSpecial && <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-600">{t('特殊物料')}</span>}
              {material.reviewStatus === "pending" ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">{t('待审核')}</span> : <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">{t('已审核')}</span>}
            </div>
            <AutoTranslatedText as="div" className="mt-0.5 text-sm text-slate-500" text={`${material.spec} · ${material.category} · ${material.productLine}`} />
          </div>
          <div className="flex items-center gap-1">
            {can("proc-task:create") && <button type="button" onClick={() => setEditOpen(true)} title={t('编辑物料主数据')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" />{t('编辑')}</button>}
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* 审核区：待审核物料 + 持审核权限者可见；核对下方完整信息后再决定 */}
          {material.reviewStatus === "pending" && can("material:review") && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-amber-800">{t('待审核物料')}</span>
                <span className="text-[11px] text-amber-600">{t(material.reviewSource === "import" ? "来源：批量导入" : material.reviewSource === "manual" ? "来源：手工新建" : "来源：任务沉淀")}</span>
              </div>
              <p className="mt-1 text-xs text-amber-700">{t('请核对下方规格、分类、历史价格与关联任务后决定；驳回原因会写入审核记录。')}</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={t('备注 / 驳回原因（可选）')}
                  className="h-8 flex-1 rounded-lg border border-amber-200 bg-white px-2 text-sm outline-none focus:border-amber-400"
                />
                <button type="button" disabled={reviewBusy} onClick={() => void decide("approved")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {reviewBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('通过')}
                </button>
                <button type="button" disabled={reviewBusy} onClick={() => void decide("rejected")} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-60">{t('驳回')}</button>
              </div>
            </div>
          )}

          {/* 基本信息 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">{t('基本信息')}</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <Info label="ERP 编码" value={material.erpCode} />
                <Info label="单位" value={t(material.unit)} />
                <Info label="分类" value={<AutoTranslatedText text={material.category} />} />
                <Info label="产品线" value={<AutoTranslatedText text={material.productLine} />} />
              </div>
              <div>
                <Info label="是否特殊" value={t(material.isSpecial ? "是" : "否")} />
                <Info label="审核状态" value={
                  material.reviewStatus === "pending"
                    ? t('待审核（来源：{source}）', { source: t(material.reviewSource === "import" ? "批量导入" : material.reviewSource === "manual" ? "手工新建" : "任务沉淀") })
                    : material.reviewStatus === "rejected"
                      ? <>{t('已驳回')}{material.reviewNote && <>（<AutoTranslatedText text={material.reviewNote} />）</>}</>
                      : t("已通过")
                } />
                <Info label="最新报价" value={`${fmtMoney(material.latestPrice)}${material.latestSupplier ? ` · ${material.latestSupplier}` : ""}`} />
                <Info label="报价日期" value={material.latestQuoteDate ?? "—"} />
              </div>
            </div>
          </div>

          {/* 库存与到货时间线 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
              {t('库存与到货')}
              <span className="group relative">
                <HelpCircle className="h-3.5 w-3.5 text-slate-300" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-56 -translate-x-1/2 rounded bg-slate-800 px-2 py-1 text-[10px] leading-4 text-white group-hover:block">{t('V1 单边统计只增不减，不含领用扣减；V2 接 ERP 同步。')}</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-50/70 py-2 text-center">
              <div><div className="text-lg font-bold tabular-nums text-slate-900">{material.stockQty.toLocaleString()}</div><div className="text-[10px] text-slate-400">{t('当前库存')}</div></div>
              <div><div className="text-lg font-bold tabular-nums text-indigo-600">{inTransit.toLocaleString()}</div><div className="text-[10px] text-slate-400">{t('在途')}</div></div>
              <div><div className="text-lg font-bold tabular-nums text-slate-900">{taskCount}</div><div className="text-[10px] text-slate-400">{t('关联任务')}</div></div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {arrivals.length === 0 ? <li className="text-xs text-slate-400">{t('暂无到货记录')}</li> : arrivals.map((a, i) => (
                <li key={i} className="flex items-center gap-3 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="tabular-nums">{a.date}</span><span>{a.code}</span><span className="tabular-nums font-medium">+{a.qty.toLocaleString()}</span></li>
              ))}
            </ul>
          </div>

          {/* 历史价格对比入口 */}
          <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 text-xs text-slate-600">
            <span>{t('历史价格对比（跨供应商 / 趋势）')}</span>
            <button type="button" onClick={() => setHistoryOpen(true)} className="font-medium text-indigo-600 hover:underline">{t('打开对比')} →</button>
          </div>

          {/* 关联采购任务 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">{t('关联采购任务（{count}）', { count: related.length })}</div>
            {related.length === 0 ? <div className="text-xs text-slate-400">{t('暂无关联任务')}</div> : (
              <ul className="space-y-1.5">
                {related.map((task) => (
                  <li key={task.id}>
                    <button type="button" onClick={() => onOpenTask(task.id)} className={cn("flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-sm transition hover:border-indigo-200 hover:bg-indigo-50/40")}>
                      <span className="flex items-center gap-2"><span className="text-slate-600">{task.code}</span><span className="text-xs text-slate-400">× {task.quantity} {t(task.unit)}</span></span>
                      <StatusPill status={task.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <PriceHistoryModal materialName={material.name} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {editOpen && <MaterialFormModal material={material} onClose={() => setEditOpen(false)} />}
    </div>
  );
}
