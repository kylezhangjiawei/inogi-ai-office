// 物料卡（复刻子系统全景卡风格）：三格大数字 + 分类/审核 tag + 最新报价 + 历史价对比入口。
import { cn } from "../../components/ui/utils";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { materialAggregates, PROCUREMENT_TASKS, type Material } from "../../../mock/procurement";
import { fmtMoney } from "./common";

export function MaterialCard({ material, onOpen, onOpenTasks, onOpenHistory }: {
  material: Material;
  onOpen: (m: Material) => void;
  onOpenTasks: (m: Material) => void;
  onOpenHistory: (m: Material) => void;
}) {
  const { t } = useI18n();
  const { inTransit, taskCount } = materialAggregates(material.name);
  const hasActiveTask = PROCUREMENT_TASKS.some((t) => t.materialName === material.name && !["completed", "cancelled"].includes(t.status));
  const isShortage = material.stockQty === 0 && hasActiveTask;
  const isPending = material.reviewStatus === "pending";

  return (
    <button
      type="button"
      onClick={() => onOpen(material)}
      className={cn("material-card w-full p-4 text-left transition hover:shadow-md", isPending && "opacity-70")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {isShortage && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
            <AutoTranslatedText as="span" className="truncate text-sm font-semibold text-slate-900" text={material.name} />
          </div>
          <AutoTranslatedText as="div" className="truncate text-xs text-slate-400" text={material.spec} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AutoTranslatedText as="span" className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500" text={t(material.category.trim())} />
          {isPending ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{t("待审核")}</span> : <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{t("已审核")}</span>}
        </div>
      </div>

      {/* 三格大数字 */}
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-50/70 py-2 text-center">
        <div><div className={cn("text-lg font-bold tabular-nums", isShortage ? "text-red-600" : "text-slate-900")}>{material.stockQty.toLocaleString()}</div><div className="text-[10px] text-slate-400">{t("库存")}</div></div>
        <div><div className="text-lg font-bold tabular-nums text-indigo-600">{inTransit.toLocaleString()}</div><div className="text-[10px] text-slate-400">{t("在途")}</div></div>
        <div><div className="text-lg font-bold tabular-nums text-slate-900">{taskCount}</div><div className="text-[10px] text-slate-400">{t("关联任务")}</div></div>
      </div>

      <div className="mt-2 truncate text-xs text-slate-500">
        {t("最新报价")} <b className="text-slate-700">{fmtMoney(material.latestPrice)}</b>{material.latestSupplier ? ` · ${material.latestSupplier}` : ""}{material.latestQuoteDate ? ` · ${material.latestQuoteDate}` : ""}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpenHistory(material); }} className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">{t("历史价格对比")} →</span>
        <span className="flex items-center gap-2">
          {material.isSpecial && <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">{t("特殊物料")}</span>}
          {taskCount > 0 && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpenTasks(material); }} className="cursor-pointer text-[11px] text-slate-400 hover:text-indigo-600">{t("关联任务 {count}", { count: taskCount })} →</span>}
        </span>
      </div>
    </button>
  );
}
