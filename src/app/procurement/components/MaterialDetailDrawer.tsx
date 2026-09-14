// 物料详情抽屉：主数据摘要 + 库存风险 + 到货时间线 + 历史价格 + 关联采购任务 + 审核区。
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Pencil,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { reviewMaterial } from "../../lib/procurementApi";
import { isTaskOfMaterial, materialAggregates, refreshProcurement, useProcurementData, type Material } from "../data";
import { ImageLightbox, StatusPill, fmtMoney, useProcCan } from "./common";
import { materialSupplyRisk, type MaterialSupplyRisk } from "./MaterialTable";
import { MaterialFormModal } from "./modals";
import { PriceHistoryModal } from "./PriceHistoryModal";

const RISK_STYLE: Record<MaterialSupplyRisk, string> = {
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  low: "border-amber-200 bg-amber-50 text-amber-700",
  shortage: "border-rose-200 bg-rose-50 text-rose-700",
  unsynced: "border-slate-200 bg-slate-50 text-slate-600",
};

function Info({ label, value, numeric = false, fullWidth = false }: { label: string; value: React.ReactNode; numeric?: boolean; fullWidth?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn("proc-horizon-material-info grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-slate-100 py-2 last:border-b-0", fullWidth && "col-span-full")}>
      <dt className="text-xs text-slate-500">{t(label)}</dt>
      <dd className={cn("min-w-0 break-words text-sm font-medium text-slate-800", numeric && "tabular-nums")}>{value}</dd>
    </div>
  );
}

function ReviewBadge({ material }: { material: Material }) {
  const { t } = useI18n();
  const config = material.reviewStatus === "pending"
    ? { label: "待审核", className: "border-amber-200 bg-amber-50 text-amber-700", Icon: AlertTriangle }
    : material.reviewStatus === "rejected"
      ? { label: "已驳回", className: "border-rose-200 bg-rose-50 text-rose-700", Icon: AlertTriangle }
      : { label: "已通过", className: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  const Icon = config.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", config.className)}>
      <Icon aria-hidden="true" className="size-3" />
      {t(config.label)}
    </span>
  );
}

export function MaterialDetailDrawer({ material, onClose, onOpenTask }: { material: Material; onClose: () => void; onOpenTask: (taskId: string) => void }) {
  const { t } = useI18n();
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewPending, setReviewPending] = useState<"approved" | "rejected" | null>(null);
  const reviewBusy = reviewPending !== null;
  const [reviewError, setReviewError] = useState<string | null>(null);
  const can = useProcCan();
  const { tasks } = useProcurementData();

  const { inTransit, taskCount } = useMemo(
    () => materialAggregates(tasks, material),
    [material, tasks],
  );
  const related = useMemo(
    () => tasks.filter((t) => isTaskOfMaterial(t, material)),
    [material, tasks],
  );
  const arrivals = useMemo(
    () => related
      .filter((task) => task.arrivedQty > 0)
      .map((task) => ({ code: task.code, qty: task.arrivedQty, date: task.expectedArrivalDate ?? task.needDate })),
    [related],
  );
  const warehouses = material.warehouses ?? [];
  const inventoryReady = Boolean(material.tpInventoryCode?.trim() && material.inventorySyncedAt);
  const inventorySyncedDate = material.inventorySyncedAt ? new Date(material.inventorySyncedAt) : null;
  const inventorySyncedLabel = inventorySyncedDate && !Number.isNaN(inventorySyncedDate.getTime())
    ? inventorySyncedDate.toLocaleString(i18nLocale(), {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    : material.inventorySyncedAt ?? "—";
  const risk = materialSupplyRisk(material, inTransit);
  const RiskIcon = risk.Icon;

  // 审核就在详情里做：审核人此时能看到规格、库存、历史价格和关联任务等完整上下文。
  const decide = async (reviewStatus: "approved" | "rejected") => {
    setReviewPending(reviewStatus);
    setReviewError(null);
    try {
      await reviewMaterial(material.id, reviewStatus, reviewNote.trim() || undefined);
      await refreshProcurement();
      toast.success(t(reviewStatus === "approved" ? "已通过审核" : "已驳回"));
      setReviewNote("");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("审核失败");
      setReviewError(message);
      toast.error(message);
    } finally {
      setReviewPending(null);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="proc-horizon-drawer proc-horizon-material-drawer w-full max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-[680px]"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}
      >
        <SheetHeader className="proc-horizon-material-drawer-header border-b border-slate-200 bg-slate-50/60 px-5 py-4 pr-14 sm:px-6 sm:pr-16">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="min-w-0 break-words text-balance text-lg font-bold text-slate-900">
                  <AutoTranslatedText as="span" text={material.name} />
                </SheetTitle>
                {material.isSpecial && <span className="rounded-md border border-[var(--primary-soft-border)] bg-accent px-1.5 py-0.5 text-[11px] font-medium text-primary">{t("特殊物料")}</span>}
                <ReviewBadge material={material} />
              </div>
              <div title={material.spec || "—"}>
                <AutoTranslatedText as="div" className="mt-1 line-clamp-2 break-words text-sm text-slate-600" text={material.spec || "—"} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-500">
                <span className="min-w-0 break-all">{t("ERP 编码")}：{material.erpCode || "—"}</span>
                <span className="min-w-0 break-all">{t("T+ 编码")}：{material.tpInventoryCode || t("未关联")}</span>
              </div>
            </div>
            {can("proc-task:create") && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)} className="h-10 shrink-0 rounded-lg px-2.5 text-xs text-slate-700">
                <Pencil aria-hidden="true" className="size-3.5" />
                {t("编辑")}
              </Button>
            )}
          </div>
        </SheetHeader>

        {/* Keep Radix's table-sized content wrapper from expanding to the warehouse table width. */}
        <ScrollArea className="proc-horizon-material-drawer-scroll min-h-0 min-w-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block [&>[data-slot=scroll-area-viewport]>div]:!min-w-0 [&>[data-slot=scroll-area-viewport]>div]:w-full">
          <div className="proc-horizon-material-drawer-body min-w-0 w-full max-w-full space-y-4 px-4 py-4 sm:px-6">
            {material.reviewStatus === "pending" && can("material:review") && (
              <section aria-labelledby="material-review-title" aria-describedby={reviewError ? "material-review-error" : undefined} aria-busy={reviewBusy} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="material-review-title" className="text-balance text-sm font-semibold text-amber-900">{t("待审核物料")}</h3>
                  <span className="text-[11px] text-amber-700">
                    {t(material.reviewSource === "import" ? "来源：批量导入" : material.reviewSource === "manual" ? "来源：手工新建" : "来源：任务沉淀")}
                  </span>
                </div>
                <p className="mt-1 text-pretty text-xs text-amber-800">{t("请核对主数据、库存风险、历史价格与关联任务后决定；驳回原因会写入审核记录。")}</p>
                <label htmlFor="material-review-note" className="mt-3 block">
                  <span className="mb-1 block text-[11px] font-semibold text-amber-900">{t("审核意见")}</span>
                  <Input
                    id="material-review-note"
                    value={reviewNote}
                    onChange={(event) => { setReviewNote(event.target.value); setReviewError(null); }}
                    disabled={reviewBusy}
                    placeholder={t("补充审核备注或驳回原因（可选）")}
                    className="h-9 border-amber-200 bg-white text-sm focus-visible:ring-amber-400/30"
                  />
                </label>
                {reviewError && <p role="alert" id="material-review-error" className="mt-2 break-words text-pretty text-xs font-medium text-rose-700">{reviewError}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" size="sm" disabled={reviewBusy} onClick={() => void decide("approved")} className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700">
                    {reviewPending === "approved" && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                    {reviewPending === "approved" ? t("处理中") : t("通过审核")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={reviewBusy} onClick={() => void decide("rejected")} className="h-8 border-rose-200 bg-white px-3 text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800">
                    {reviewPending === "rejected" && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
                    {reviewPending === "rejected" ? t("处理中") : t("驳回")}
                  </Button>
                </div>
              </section>
            )}

            {material.reviewNote && (
              <section
                aria-labelledby="material-review-record-title"
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4",
                  material.reviewStatus === "rejected"
                    ? "border-rose-200 bg-rose-50/60"
                    : "border-slate-200 bg-slate-50",
                )}
              >
                <AlertTriangle
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    material.reviewStatus === "rejected" ? "text-rose-600" : "text-slate-500",
                  )}
                />
                <div className="min-w-0">
                  <h3
                    id="material-review-record-title"
                    className={cn(
                      "text-sm font-semibold",
                      material.reviewStatus === "rejected" ? "text-rose-900" : "text-slate-900",
                    )}
                  >
                    {t(material.reviewStatus === "rejected" ? "驳回原因" : "审核意见")}
                  </h3>
                  <AutoTranslatedText
                    as="p"
                    className={cn(
                      "mt-1 break-words text-pretty text-sm",
                      material.reviewStatus === "rejected" ? "text-rose-800" : "text-slate-700",
                    )}
                    text={material.reviewNote}
                  />
                </div>
              </section>
            )}

            <section aria-labelledby="material-summary-title" className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 id="material-summary-title" className="text-balance text-sm font-semibold text-slate-900">{t("物料摘要")}</h3>
                <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium", RISK_STYLE[risk.tone])} title={t(risk.detail)}>
                  <RiskIcon aria-hidden="true" className="size-3.5" />
                  {t(risk.label)}
                </span>
              </div>
              <div className="proc-horizon-material-summary-layout grid min-w-0 grid-cols-1 gap-4" data-has-image={Boolean(material.imageUrl)}>
                {material.imageUrl ? (
                  <button
                    type="button"
                    onClick={() => setImageOpen(true)}
                    aria-label={t("预览{name}的商品图片", { name: material.name })}
                    className="group relative size-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <img src={material.imageUrl} alt={t("{name}商品图片", { name: material.name })} loading="lazy" className="size-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 px-2 py-1 text-center text-[10px] font-medium text-white">{t("点击预览")}</span>
                  </button>
                ) : null}
                <dl className="proc-horizon-material-facts grid min-w-0 grid-cols-1 gap-x-5">
                  {material.spec ? <Info label="规格型号" value={<AutoTranslatedText text={material.spec} />} fullWidth /> : null}
                  <Info label="单位" value={t(material.unit || "—")} />
                  <Info label="分类" value={<AutoTranslatedText text={material.category || "未分类"} />} />
                  <Info label="产品线" value={<AutoTranslatedText text={material.productLine || "—"} />} />
                  <Info label="物料属性" value={t(material.isSpecial ? "特殊物料" : material.isConsumable ? "耗材" : "常规物料")} />
                  <Info label="最新报价" value={<><span className="break-words">{fmtMoney(material.latestPrice)}</span>{material.latestSupplier ? <AutoTranslatedText as="span" className="mt-0.5 block break-words text-xs font-normal text-slate-500" text={material.latestSupplier} /> : null}</>} numeric />
                  <Info label="报价日期" value={material.latestQuoteDate ?? "—"} numeric />
                </dl>
              </div>
              {material.remark && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="text-[11px] font-semibold text-slate-500">{t("备注")}</div>
                  <AutoTranslatedText as="p" className="mt-1 break-words text-pretty text-sm text-slate-700" text={material.remark} />
                </div>
              )}
            </section>

            <section aria-labelledby="material-inventory-title" className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Warehouse aria-hidden="true" className="size-4 text-primary" />
                  <h3 id="material-inventory-title" className="text-balance text-sm font-semibold text-slate-900">{t("库存与供应")}</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={t("查看库存口径说明")} className="rounded-md text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                        <HelpCircle aria-hidden="true" className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">{t("现存量、可用量和安全库存来自最近一次 T+ 同步；采购在途与关联任务由系统任务实时汇总。")}</TooltipContent>
                  </Tooltip>
                </div>
                <span className="min-w-0 break-words text-[11px] tabular-nums text-slate-500" title={material.inventorySyncedAt || undefined}>
                  {inventoryReady ? t("同步于 {time}", { time: inventorySyncedLabel }) : t("库存数据待同步")}
                </span>
              </div>

              <div className="proc-horizon-material-inventory-stats mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200">
                {[
                  { label: t("现存量"), value: material.stockQty.toLocaleString(), className: "text-slate-900" },
                  { label: t("可用量"), value: inventoryReady ? material.availableQty.toLocaleString() : "—", className: risk.tone === "shortage" || risk.tone === "low" ? "text-rose-700" : "text-slate-900" },
                  { label: t("安全库存"), value: material.safeStock.toLocaleString(), className: "text-slate-900" },
                  { label: t("采购在途"), value: inTransit.toLocaleString(), className: inTransit > 0 ? "text-primary" : "text-slate-900" },
                ].map((item) => (
                  <div key={item.label} className="min-w-0 border-b border-r border-slate-100 px-3 py-2.5 last:border-r-0">
                    <div className={cn("break-words text-lg font-bold tabular-nums", item.className)}>{item.value}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.label}</div>
                  </div>
                ))}
              </div>

              {warehouses.length > 0 ? (
                <div className="mt-3 min-w-0 w-full max-w-full overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label={t("分仓库存明细")} tabIndex={0}>
                  <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-0 text-xs">
                    <caption className="sr-only">{t("分仓现存量与可用量")}</caption>
                    <colgroup><col className="w-48" /><col /><col /></colgroup>
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold">{t("仓库")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("现存量")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">{t("可用量")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouses.map((warehouse) => (
                        <tr key={warehouse.name} className="border-t border-slate-100">
                          <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-3 py-2 text-slate-800" title={warehouse.name}><AutoTranslatedText className="line-clamp-2 break-words" text={warehouse.name} /></td>
                          <td className="break-words border-t border-slate-100 px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{warehouse.stock.toLocaleString()}</td>
                          <td className="break-words border-t border-slate-100 px-3 py-2 text-right tabular-nums text-slate-700">{warehouse.available.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-pretty text-xs text-slate-500">{t("暂无分仓库存；完成 T+ 关联并同步后可查看仓库明细。")}</p>
              )}

              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-2 text-[11px] font-semibold text-slate-600">{t("最近到货")}</div>
                {arrivals.length === 0 ? (
                  <p className="text-xs text-slate-500">{t("暂无已登记的到货记录")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {arrivals.map((arrival, index) => (
                      <li key={`${arrival.code}-${arrival.date}-${index}`} className="grid grid-cols-[auto_90px_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-600">
                        <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" />
                        <span className="tabular-nums">{arrival.date}</span>
                        <span className="truncate" title={arrival.code}>{arrival.code}</span>
                        <span className="font-semibold tabular-nums text-slate-900">+{arrival.qty.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--primary-soft-border)] bg-accent px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <TrendingUp aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <div>
                  <h3 className="text-balance text-sm font-semibold text-slate-900">{t("历史价格对比")}</h3>
                  <p className="text-pretty text-[11px] text-slate-600">{t("查看跨供应商报价与价格趋势")}</p>
                </div>
              </div>
              <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{t("打开对比")}</button>
            </section>

            <section aria-labelledby="material-related-title" className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 id="material-related-title" className="text-balance text-sm font-semibold text-slate-900">{t("关联采购任务")}</h3>
                <span className="text-xs font-semibold tabular-nums text-slate-500">{taskCount}</span>
              </div>
              {related.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-pretty text-xs text-slate-500">{t("暂无关联采购任务；后续任务关联此物料后会自动显示在这里。")}</div>
              ) : (
                <ul className="space-y-2">
                  {related.map((task) => (
                    <li key={task.id}>
                      <button type="button" onClick={() => onOpenTask(task.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-[var(--primary-soft-border)] hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                        <span className="min-w-0 flex-1 basis-48">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 break-all font-semibold tabular-nums text-slate-800">{task.code}</span>
                            <span className="text-xs tabular-nums text-slate-500">{task.quantity.toLocaleString()} {t(task.unit)}</span>
                          </span>
                          <span className="mt-1 block break-words text-[11px] tabular-nums text-slate-500">
                            {task.expectedArrivalDate ? `${t("预计到货")} ${task.expectedArrivalDate}` : `${t("需求日期")} ${task.needDate ?? "—"}`}
                          </span>
                        </span>
                        <StatusPill status={task.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>

        <PriceHistoryModal materialId={material.id} materialName={material.name} open={historyOpen} onClose={() => setHistoryOpen(false)} />
        {editOpen && <MaterialFormModal material={material} onClose={() => setEditOpen(false)} />}
        {imageOpen && material.imageUrl && (
          <ImageLightbox
            url={material.imageUrl}
            alt={t("{name}商品图片预览", { name: material.name })}
            onClose={() => setImageOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
