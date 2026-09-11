import { RenewableImage } from "../../components/RenewableImage";
import { procurementAttachmentPreview } from "../../lib/attachmentAccess";
// 采购任务共享卡：驾驶舱与个人工作台共用，视觉结构对齐研发任务驾驶舱。
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  ExternalLink,
  Flame,
  History,
  MoreVertical,
  Paperclip,
  Settings2,
  Trash2,
  Undo2,
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
import { isImagePreviewSource } from "../../components/MobileZoomableImage";
import { AttachmentPreviewDialog, type PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { useI18n } from "../../lib/i18n";
import { isProcurementTaskOverdue, taskMainDate, taskRequester, type Material, type ProcurementTask } from "../data";
import { BusinessLinePill, PROC_STATUS_META, PersonAvatar, StatusPill, rollbackTargetsOf, useProcCan } from "./common";
import { DECISION_STATUSES, nextPermissionOf, removalModeOf } from "./taskActions";
import { TaskCriticalMaterials, TaskCriticalMaterialsEditor } from "./TaskCriticalMaterials";

const PRIORITY_TONE = {
  high: { label: "高优先", className: "bg-rose-50 text-rose-700" },
  medium: { label: "中优先", className: "bg-amber-50 text-amber-700" },
  low: { label: "低优先", className: "bg-slate-100 text-slate-600" },
} as const;


export function ProcurementTaskCard({ task, materials, onOpen, onNext, onReassign, onRemove, onRollback, onViewLogs, onOverlayOpenChange }: {
  task: ProcurementTask;
  materials: Material[];
  onOpen: (task: ProcurementTask) => void;
  onNext?: (task: ProcurementTask) => void;
  onReassign?: (task: ProcurementTask) => void;
  onRemove?: (task: ProcurementTask) => void;
  onRollback?: (task: ProcurementTask) => void;
  onViewLogs?: (task: ProcurementTask) => void;
  onOverlayOpenChange?: (taskId: string, open: boolean) => void;
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
  const buyerLabel = task.buyer?.trim() || t("未指派");
  const previewAttachments = task.attachmentList.slice(0, 3);
  const allPreviewAttachments = task.attachmentList.map((attachment) => procurementAttachmentPreview(task.id, attachment));
  const hiddenAttachmentCount = Math.max(0, allPreviewAttachments.length - previewAttachments.length);
  const canAdvance = Boolean(meta.next && can(nextPermissionOf(task)) && onNext);
  const canRollback = Boolean(onRollback && can("proc-task:rollback") && rollbackTargetsOf(task.status, task.method, task).length > 0);
  const canConfigureCriticalMaterials = can("proc-task:create");
  // 菜单项文案跟着实际处置动作走：履约中是「取消任务」，其余是「删除」，待研发审核则不给入口
  const removalMode = removalModeOf(task);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [criticalEditorOpen, setCriticalEditorOpen] = useState(false);
  const overlayOpen = Boolean(previewAttachment) || criticalEditorOpen;
  useEffect(() => {
    onOverlayOpenChange?.(task.id, overlayOpen);
    return () => onOverlayOpenChange?.(task.id, false);
  }, [task.id, overlayOpen, onOverlayOpenChange]);
  const titleId = `procurement-task-${task.id}`;

  const runWithoutOpening = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <TaskCriticalMaterialsEditor task={task} materials={materials} onOpenChange={setCriticalEditorOpen}>
      {({ openEditor }) => (
        <>
          <article
      aria-labelledby={titleId}
      data-attention={isPendingConfirm}
      onClick={() => onOpen(task)}
      className={cn(
        "proc-horizon-task-card group relative h-full w-full cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)]",
        isPendingConfirm && "border-rose-200 ring-1 ring-rose-200",
      )}
    >
      <div className="proc-horizon-task-card-body min-h-[220px] min-w-0 px-4 py-3.5">
        <div className="proc-horizon-task-card-head flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="proc-horizon-task-card-context flex min-w-0 flex-1 basis-28 flex-wrap items-center gap-2 overflow-hidden">
            <BusinessLinePill line={task.businessLine} />
            <span className="proc-horizon-task-route truncate text-[11px] font-medium text-slate-500">
              {t(task.source === "rd" ? "研发流转" : "采购自建")} <span aria-hidden="true">·</span> {t(task.method === "inquiry" ? "询价采购" : "电商直购")}
            </span>
          </div>

          <div className="proc-horizon-task-card-actions flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
            <StatusPill status={task.status} />
            {allPreviewAttachments.length > 0 ? (
              <button type="button" onClick={(event) => runWithoutOpening(event, () => setPreviewAttachment(allPreviewAttachments[0]))}
                aria-label={t("查看全部 {count} 个附件", { count: allPreviewAttachments.length })}
                className="proc-horizon-attachment-action inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Paperclip className="size-3" />
                <span className="sr-only">{t("附件")}</span><span className="tabular-nums">{allPreviewAttachments.length}</span>
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="proc-horizon-more-action flex size-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-[var(--primary-soft-border)] hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  aria-label={t("更多操作")}
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="proc-horizon-menu min-w-40 rounded-xl p-1.5 data-[state=open]:animate-none data-[state=closed]:animate-none" onClick={(event) => event.stopPropagation()}>
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

        <div className="proc-horizon-task-card-primary min-w-0">
          <div className="proc-horizon-task-meta flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-slate-400">
            <span className="proc-horizon-task-code font-semibold tabular-nums">{task.code}</span>
            <span className="proc-horizon-task-quantity inline-flex items-baseline gap-1.5 whitespace-nowrap">
              <span>{t("数量")}</span>
              <strong className="text-xs font-semibold tabular-nums text-slate-700">{task.quantity.toLocaleString()} {t(task.unit)}</strong>
            </span>
          </div>

          <h3 id={titleId} title={[task.materialName, task.spec].filter(Boolean).join(" · ")} className="line-clamp-2 text-balance text-[15px] font-bold break-words leading-snug text-slate-900">
            <AutoTranslatedText text={task.materialName} />
            {task.spec ? <> · <AutoTranslatedText text={task.spec} /></> : null}
          </h3>

          <AutoTranslatedText
            as="p"
            text={latestLog}
            className="proc-horizon-task-summary line-clamp-2 text-pretty text-xs leading-5 text-slate-500"
          />

          {previewAttachments.length > 0 ? (
            <section className="space-y-2" aria-label={t("任务附件")}>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{t("附件")} <span className="tabular-nums">{allPreviewAttachments.length}</span></span>
                {hiddenAttachmentCount > 0 && <button type="button"
                  onClick={(event) => runWithoutOpening(event, () => setPreviewAttachment(allPreviewAttachments[0]))}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {t("查看全部（另 {count} 个）", { count: hiddenAttachmentCount })}<ChevronRight className="size-3.5" />
                </button>}
              </div>
            <div className="proc-horizon-task-attachments grid grid-cols-3 gap-2">
              {previewAttachments.map((attachment) => {
                const isImage = isImagePreviewSource(
                  attachment.mimeType,
                  attachment.fileName,
                  attachment.fileUrl,
                );
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    className="group/attachment min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={t("预览附件：{name}", { name: attachment.fileName })}
                    title={attachment.fileName}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewAttachment(procurementAttachmentPreview(task.id, attachment));
                    }}
                  >
                    {isImage ? (
                      // 缩略图优先用后端给的 OSS 实时缩放地址（同一对象 375KB → 13.5KB）：
                      // 列表仅加载缩略图，点开预览时才用原图；contain 保留图纸全貌。
                      <RenewableImage resourceKey={`proc-thumb:${task.id}:${attachment.id}`} refresh={async () => { const latest = await procurementAttachmentPreview(task.id, attachment).refresh!(); return latest.thumbUrl || latest.url; }} src={attachment.thumbUrl ?? attachment.fileUrl} alt={attachment.fileName} loading="lazy" decoding="async" className="h-24 w-full bg-slate-50 object-contain p-1" />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-slate-400"><Paperclip className="size-6" /></div>
                    )}
                    <p className="truncate border-t border-slate-200/70 px-2 py-1.5 text-[11px] text-slate-500 group-hover/attachment:text-primary">{attachment.fileName}</p>
                  </button>
                );
              })}
            </div>
            </section>
          ) : null}
        </div>

        <div className="proc-horizon-task-card-secondary min-w-0">
          <div className="proc-horizon-fulfillment flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-500">
            <span className="proc-horizon-payment inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="proc-horizon-payment-status" data-payment-status={task.paymentStatus}>
                {task.paymentStatus === "paid" ? t("已付款") : task.paymentStatus === "partial" ? t("部分付款") : t("未付款")}
              </span>
              {task.paymentDate ? <time dateTime={task.paymentDate} className="proc-horizon-payment-date tabular-nums">{task.paymentDate}</time> : null}
            </span>
            <span>
              {t("到货")} <strong className="tabular-nums text-slate-700">{task.arrivedQty.toLocaleString()} / {task.quantity.toLocaleString()}</strong>
            </span>
          </div>

          <TaskCriticalMaterials task={task} materials={materials} compact />

          {task.consumableNote ? (
            <AutoTranslatedText as="p" text={task.consumableNote} className="truncate text-xs text-slate-500" />
          ) : null}

          <div className="mt-auto flex flex-col gap-2.5">
            {canAdvance ? (
              <button
                type="button"
                onClick={(event) => runWithoutOpening(event, () => onNext?.(task))}
                className={cn(
                  "inline-flex w-fit cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isPendingConfirm ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-primary text-white hover:bg-primary-hover",
                )}
              >
                {t(meta.next!)}
                {DECISION_STATUSES.includes(task.status) ? <ChevronRight className="size-3" /> : null}
                {task.method === "direct" && task.status === "pending_purchase" ? <ExternalLink className="size-3" /> : null}
              </button>
            ) : null}

            {(canRollback || onViewLogs) ? (
              <div className="flex flex-wrap items-center gap-2">
                {canRollback ? <button type="button" onClick={(event) => runWithoutOpening(event, () => onRollback?.(task))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-200 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  aria-label={t("回退任务")}><Undo2 className="size-3.5" aria-hidden="true" />{t("回退")}</button> : null}
                {onViewLogs ? <button type="button" onClick={(event) => runWithoutOpening(event, () => onViewLogs(task))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={t("查看操作记录")}><History className="size-3.5" aria-hidden="true" />{t("操作记录")}</button> : null}
              </div>
            ) : null}

            <div className="proc-horizon-task-progress-row flex items-center gap-2 pt-0.5">
              <span className="shrink-0 text-[10px] font-semibold text-slate-500">{t("到货进度")}</span>
              <div role="progressbar" aria-label={t("到货进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="proc-horizon-task-progress-track h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("proc-horizon-task-progress h-full rounded-full", progress >= 100 ? "bg-emerald-500" : "bg-primary")} data-complete={progress >= 100} style={{ width: `${progress}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-700">{progress}%</span>
            </div>

            <div className="proc-horizon-task-footer flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
              <span data-priority={task.priority} className={cn("proc-horizon-priority inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", priority.className)}>
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
                <TooltipTrigger asChild>
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-400">
                    <PersonAvatar name={buyerLabel} size="xs" />
                    <span className="max-w-[72px] truncate font-medium text-slate-600">{buyerLabel}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {requester.name === buyerLabel
                    ? t("采购负责人")
                    : `${t("需求提出")}：${requester.name} → ${t("采购负责人")}：${buyerLabel}`}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={(event) => runWithoutOpening(event, () => onOpen(task))}
                className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={t("查看任务")}
              >
                {t("查看")} <ArrowRight className="size-3" />
              </button>
            </div>

          </div>
        </div>
      </div>
          </article>
          {previewAttachment ? (
            <AttachmentPreviewDialog attachment={previewAttachment} attachments={allPreviewAttachments} onClose={() => setPreviewAttachment(null)} />
          ) : null}
        </>
      )}
    </TaskCriticalMaterialsEditor>
  );
}
