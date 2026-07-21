// 采购任务卡（瀑布流）：复刻研发任务卡外壳——左彩边/附件预览/转派删除/主日期/进度条/下一步/负责人。
import { ExternalLink } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { taskRequester, type ProcurementTask } from "../../../mock/procurement";
import { BusinessLinePill, MainDateBadge, MethodPill, PROC_STATUS_META, PersonAvatar, SourcePill, StatusPill, stageToast } from "./common";

export function ProcurementTaskCard({ task, onOpen }: { task: ProcurementTask; onOpen: (t: ProcurementTask) => void }) {
  const { t } = useI18n();
  const meta = PROC_STATUS_META[task.status];
  const requester = taskRequester(task);
  const pct = task.quantity > 0 ? Math.round((task.arrivedQty / task.quantity) * 100) : 0;
  const isPendingConfirm = task.status === "pending_confirm";
  const leftBar = task.priority === "high" ? "bg-red-400" : task.priority === "medium" ? "bg-amber-400" : "bg-slate-300";
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        "material-card relative w-full overflow-hidden p-4 text-left transition hover:shadow-md",
        isPendingConfirm && "ring-2 ring-rose-300",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", isPendingConfirm ? "bg-rose-400" : leftBar)} />

      {isPendingConfirm && (
        <div className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600">● {t('待采购确认提交（研发流转）')}</div>
      )}

      {/* 时间标 + 转派/删除 */}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>{task.code}</span>
        <span className="flex items-center gap-2">
          <span role="button" tabIndex={0} onClick={(e) => stop(e, stageToast)} className="cursor-pointer rounded px-1 py-0.5 hover:bg-slate-50 hover:text-slate-600">{t('转派')}</span>
          <span role="button" tabIndex={0} onClick={(e) => stop(e, stageToast)} className="cursor-pointer rounded px-1 py-0.5 hover:bg-rose-50 hover:text-rose-600">{t('删除')}</span>
        </span>
      </div>

      {/* 附件预览占位 */}
      {task.attachments > 0 && (
        <div className="mt-2 flex gap-1.5">
          {Array.from({ length: Math.min(task.attachments, 3) }).map((_, i) => (
            <span key={i} className="flex h-12 w-16 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-400">{t('图纸')}{i + 1}</span>
          ))}
        </div>
      )}

      {/* pills */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <BusinessLinePill line={task.businessLine} />
        <SourcePill source={task.source} />
        <MethodPill method={task.method} />
        <StatusPill status={task.status} />
      </div>

      {/* 标题 */}
      <div className="mt-2 text-sm font-semibold text-slate-900">
        <AutoTranslatedText text={task.materialName} /> · <AutoTranslatedText text={task.spec} /> <span className="text-slate-400">× {task.quantity}{t(task.unit)}</span>
      </div>

      {/* 主日期（最大字号） */}
      <div className="mt-2"><MainDateBadge task={task} big /></div>

      {/* 付款 · 到货 */}
      <div className="mt-1.5 text-[11px] text-slate-500">
        {task.paymentDate ? <>{t('付款')} {task.paymentDate}{task.paymentNote ? <>（<AutoTranslatedText text={task.paymentNote} />）</> : null}</> : t('未付款')}
        {" · "}{t('到货')} <span className="tabular-nums">{task.arrivedQty.toLocaleString()} / {task.quantity.toLocaleString()}</span>
      </div>

      {/* 进度条 */}
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
      </div>

      {/* 下一步 + 负责人 */}
      <div className="mt-3 flex items-center justify-between">
        {meta.next ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => stop(e, () => (task.method === "direct" && task.status === "pending_purchase" ? window.open(task.purchaseLink, "_blank") : stageToast()))}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
              isPendingConfirm ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-indigo-600 text-white hover:bg-indigo-700",
            )}
          >
            {t(meta.next)}
            {task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-3 w-3" />}
          </span>
        ) : (
          <span className={cn("text-xs font-medium", task.status === "completed" ? "text-emerald-600" : "text-slate-400")}>{t(meta.label)}</span>
        )}
        {/* 需求提出人 → 采购负责人（同一人时只显示一个） */}
        <span className="flex items-center gap-1.5 text-xs text-slate-600">
          {requester.name !== task.buyer && (
            <>
              <span className="flex items-center gap-1" title={`${t('需求提出')} · ${t(requester.dept)}`}>
                <span className="text-[10px] text-slate-400">{t('提出')}</span>
                <PersonAvatar name={requester.name} size="xs" />
                {requester.name}
              </span>
              <span className="text-slate-300">→</span>
            </>
          )}
          <span className="flex items-center gap-1" title={t('采购负责人')}>
            {requester.name !== task.buyer && <span className="text-[10px] text-slate-400">{t('采购')}</span>}
            <PersonAvatar name={task.buyer} size="xs" />
            {task.buyer}
          </span>
        </span>
      </div>
      {task.consumableNote && <div className="mt-1 text-[10px] text-slate-400">· <AutoTranslatedText text={task.consumableNote} /></div>}
    </button>
  );
}
