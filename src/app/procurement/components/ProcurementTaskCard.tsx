// 采购任务共享卡：驾驶舱与个人工作台共用，视觉结构对齐研发任务驾驶舱。
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  ExternalLink,
  Flame,
  MoreVertical,
  Paperclip,
  Settings2,
  Trash2,
  UserCog,
} from "lucide-react";

import { AutoTranslatedText } from "../../components/TranslatableText";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import { isImagePreviewSource, MobileImagePreviewLink } from "../../components/MobileZoomableImage";
import { useI18n } from "../../lib/i18n";
import { isProcurementTaskOverdue, taskMainDate, taskRequester, type Material, type ProcurementTask } from "../data";
import { BusinessLinePill, MethodPill, PROC_STATUS_META, PersonAvatar, SourcePill, StatusPill, useProcCan } from "./common";
import { DECISION_STATUSES, nextPermissionOf, removalModeOf } from "./taskActions";
import { TaskCriticalMaterials, TaskCriticalMaterialsEditor } from "./TaskCriticalMaterials";

const PRIORITY_TONE = {
  high: { label: "高优先", className: "bg-rose-50 text-rose-700" },
  medium: { label: "中优先", className: "bg-amber-50 text-amber-700" },
  low: { label: "低优先", className: "bg-slate-100 text-slate-600" },
} as const;

export function ProcurementTaskCard({ task, materials, onOpen, onNext, onReassign, onRemove }: {
  task: ProcurementTask;
  materials: Material[];
  onOpen: (task: ProcurementTask) => void;
  onNext?: (task: ProcurementTask) => void;
  onReassign?: (task: ProcurementTask) => void;
  onRemove?: (task: ProcurementTask) => void;
}) {
  const { t } = useI18n();
  const can = useProcCan();
  const meta = PROC_STATUS_META[task.status];
  const requester = taskRequester(task);
  const mainDate = taskMainDate(task);
  const overdue = isProcurementTaskOverdue(task);
  const progress = task.quantity > 0
    ? Math.min(100, Math.max(0, Math.round((task.arrivedQty / task.quantity) * 100)))
    : 0;
  const priority = PRIORITY_TONE[task.priority];
  const isPendingConfirm = task.status === "pending_confirm";
  const latestLog = task.logs.at(-1)?.text?.trim() || t("暂无流程更新");
  const previewAttachments = task.attachmentList.slice(0, 3);
  const canAdvance = Boolean(meta.next && can(nextPermissionOf(task)) && onNext);
  const canConfigureCriticalMaterials = can("proc-task:create");
  // 菜单项文案跟着实际处置动作走：履约中是「取消任务」，其余是「删除」，待研发审核则不给入口
  const removalMode = removalModeOf(task);

  const runWithoutOpening = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <TaskCriticalMaterialsEditor task={task} materials={materials}>
      {({ openEditor }) => (
        <article
      onClick={() => onOpen(task)}
      className={cn(
        "group relative w-full cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_12px_28px_-12px_rgba(79,70,229,0.28)]",
        isPendingConfirm && "border-rose-200 ring-1 ring-rose-200",
      )}
    >
      <div className="flex min-h-[220px] min-w-0 flex-col gap-2.5 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
            <BusinessLinePill line={task.businessLine} />
            <SourcePill source={task.source} />
            <MethodPill method={task.method} />
            <StatusPill status={task.status} />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {task.attachments > 0 ? (
              <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-indigo-50 px-2 text-[10px] font-semibold text-indigo-700">
                <Paperclip className="size-3" />
                {t("附件")} <span className="tabular-nums">{task.attachments}</span>
              </span>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                  aria-label={t("更多操作")}
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40" onClick={(event) => event.stopPropagation()}>
                <DropdownMenuItem onSelect={() => onOpen(task)}>
                  <ArrowRight className="size-4" />
                  {t("查看任务")}
                </DropdownMenuItem>
                {canConfigureCriticalMaterials ? (
                  <DropdownMenuItem onSelect={openEditor}>
                    <Settings2 className="size-4" />
                    {t("库存设置")}
                  </DropdownMenuItem>
                ) : null}
                {canAdvance ? (
                  <DropdownMenuItem onSelect={() => onNext?.(task)}>
                    <ChevronRight className="size-4" />
                    {t(meta.next!)}
                  </DropdownMenuItem>
                ) : null}
                {can("proc-task:reassign") && onReassign ? (
                  <DropdownMenuItem onSelect={() => onReassign(task)}>
                    <UserCog className="size-4" />
                    {t("转派")}
                  </DropdownMenuItem>
                ) : null}
                {can("proc-task:delete") && onRemove && removalMode !== "review" ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => onRemove(task)}>
                    <Trash2 className="size-4" />
                    {removalMode === "cancel" ? t("取消任务") : t("删除")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="font-semibold tabular-nums">{task.code}</span>
          {isPendingConfirm ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">
              <span className="size-1.5 rounded-full bg-rose-500" />
              {t("待采购确认")}
            </span>
          ) : null}
        </div>

        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-slate-900">
          <AutoTranslatedText text={task.materialName} />
          {task.spec ? <> · <AutoTranslatedText text={task.spec} /></> : null}
          <span className="ml-1 text-xs font-semibold text-slate-400">
            × <span className="tabular-nums">{task.quantity.toLocaleString()}</span>{t(task.unit)}
          </span>
        </h3>

        <AutoTranslatedText
          as="p"
          text={latestLog}
          className="line-clamp-2 min-h-10 text-pretty text-xs leading-5 text-slate-500"
        />

        {previewAttachments.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {previewAttachments.map((attachment) => {
              const isImage = isImagePreviewSource(
                attachment.mimeType,
                attachment.fileName,
                attachment.fileUrl,
              );
              return (
                <div key={attachment.id} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {isImage ? (
                    <MobileImagePreviewLink
                      src={attachment.fileUrl}
                      alt={attachment.fileName}
                      title={attachment.fileName}
                      className="block"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <img src={attachment.fileUrl} alt={attachment.fileName} loading="lazy" className="h-16 w-full object-cover" />
                    </MobileImagePreviewLink>
                  ) : (
                    <div className="flex h-16 items-center justify-center text-slate-400"><Paperclip className="size-4" /></div>
                  )}
                  <p className="truncate px-1.5 py-1 text-[9px] text-slate-500">{attachment.fileName}</p>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-500">
          <span>
            {task.paymentDate ? `${t("付款")} ${task.paymentDate}` : t("未付款")}
          </span>
          <span>
            {t("到货")} <strong className="tabular-nums text-slate-700">{task.arrivedQty.toLocaleString()} / {task.quantity.toLocaleString()}</strong>
          </span>
        </div>

        <TaskCriticalMaterials task={task} materials={materials} />

        {canAdvance ? (
          <button
            type="button"
            onClick={(event) => runWithoutOpening(event, () => onNext?.(task))}
            className={cn(
              "inline-flex w-fit cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
              isPendingConfirm ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-indigo-600 text-white hover:bg-indigo-700",
            )}
          >
            {t(meta.next!)}
            {DECISION_STATUSES.includes(task.status) ? <ChevronRight className="size-3" /> : null}
            {task.method === "direct" && task.status === "pending_purchase" ? <ExternalLink className="size-3" /> : null}
          </button>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-0.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", progress >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${progress}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">{progress}%</span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", priority.className)}>
            <Flame className="size-3" />
            {t(priority.label)}
          </span>
          {mainDate.date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3 text-slate-400" />
              {t(mainDate.label)}：<span className="tabular-nums">{mainDate.date.slice(5)}</span>
            </span>
          ) : null}
          {overdue ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600">
              <AlertTriangle className="size-3" />
              {t("逾期")}
            </span>
          ) : null}

          <Tooltip>
          <button
            type="button"
            onClick={(event) => runWithoutOpening(event, () => onOpen(task))}
            className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
            aria-label={t("查看任务")}
          >
            {t("查看")} <ArrowRight className="size-3" />
          </button>

            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-400">
                <PersonAvatar name={task.buyer} size="xs" />
                <span className="max-w-[72px] truncate font-medium text-slate-600">{task.buyer}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {requester.name === task.buyer
                ? t("采购负责人")
                : `${t("需求提出")}：${requester.name} → ${t("采购负责人")}：${task.buyer}`}
            </TooltipContent>
          </Tooltip>
        </div>

        {task.consumableNote ? (
          <AutoTranslatedText as="p" text={task.consumableNote} className="truncate text-[10px] text-slate-400" />
        ) : null}
      </div>
        </article>
      )}
    </TaskCriticalMaterialsEditor>
  );
}
