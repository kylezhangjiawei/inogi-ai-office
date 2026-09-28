import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, ExternalLink, FileText, MoreVertical, Settings2, Trash2, UserCog } from "lucide-react";
import { AttachmentPreviewDialog, type PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { isImagePreviewSource } from "../../components/MobileZoomableImage";
import { RenewableImage } from "../../components/RenewableImage";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { cn } from "../../components/ui/utils";
import { procurementAttachmentPreview } from "../../lib/attachmentAccess";
import { useI18n } from "../../lib/i18n";
import { isProcurementTaskOverdue, taskMainDate, type Material, type ProcurementTask } from "../data";
import { BusinessLinePill, PersonAvatar, PriorityBadge, StatusPill, procurementNextAction, useProcCan } from "./common";
import { TaskCriticalMaterialsEditor } from "./TaskCriticalMaterials";
import { DECISION_STATUSES, nextPermissionOf, removalModeOf } from "./taskActions";

interface TaskTableActions {
  selectedTaskId?: string;
  onOpen: (task: ProcurementTask) => void;
  onNext?: (task: ProcurementTask) => void;
  onReassign?: (task: ProcurementTask) => void;
  onRemove?: (task: ProcurementTask) => void;
  onOverlayOpenChange?: (taskId: string, open: boolean) => void;
}

export interface ProcurementTaskTableProps extends TaskTableActions {
  tasks: ProcurementTask[];
  materials: Material[];
}

const COLUMNS = [
  ["task", "采购任务"], ["attachments", "附件"], ["context", "业务线 / 来源"], ["status", "状态"], ["buyer", "采购负责人"],
  ["arrival", "到货进度"], ["payment", "付款"], ["date", "当前期限"], ["priority", "优先级"], ["actions", "操作"],
] as const;

export function ProcurementTaskTable({ tasks, materials, ...actions }: ProcurementTaskTableProps) {
  const { t } = useI18n();
  return <div className="proc-horizon-task-table-wrap rounded-xl border border-border bg-card">
    <Table className="proc-horizon-task-table" containerClassName="overflow-visible" aria-label={t("采购任务列表")}>
      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>{COLUMNS.map(([column, label]) => <TableHead key={column} scope="col" className={`proc-horizon-task-col-${column}`}>{t(label)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {tasks.map((task) => <ProcurementTaskTableRow key={task.id} task={task} materials={materials} {...actions} />)}
        {!tasks.length && <TableRow><TableCell colSpan={COLUMNS.length} className="py-10 text-center text-sm text-muted-foreground">{t("暂无采购任务")}</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>;
}

function ProcurementTaskTableRow({ task, materials, selectedTaskId, onOpen, onNext, onReassign, onRemove, onOverlayOpenChange }: TaskTableActions & { task: ProcurementTask; materials: Material[] }) {
  const { t } = useI18n();
  const can = useProcCan();
  const nextAction = procurementNextAction(task);
  const canAdvance = Boolean(nextAction && can(nextPermissionOf(task)) && onNext);
  const removalMode = removalModeOf(task);
  const mainDate = taskMainDate(task);
  const validDate = mainDate.date && Number.isFinite(mainDate.days);
  const overdue = isProcurementTaskOverdue(task);
  const buyer = task.buyer?.trim() || t("未指派");
  const quantity = (value: number) => Number.isFinite(value) ? value.toLocaleString() : t("待核对");
  const progress = Number.isFinite(task.quantity) && task.quantity > 0 && Number.isFinite(task.arrivedQty)
    ? Math.min(100, Math.max(0, Math.round(task.arrivedQty / task.quantity * 100))) : 0;
  const attachments = task.attachmentList.map((attachment) => procurementAttachmentPreview(task.id, attachment));
  const visibleAttachments = task.attachmentList.slice(0, 2);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [criticalEditorOpen, setCriticalEditorOpen] = useState(false);
  const overlayOpen = Boolean(previewAttachment) || criticalEditorOpen;
  useEffect(() => {
    onOverlayOpenChange?.(task.id, overlayOpen);
    return () => onOverlayOpenChange?.(task.id, false);
  }, [task.id, overlayOpen, onOverlayOpenChange]);

  return <TaskCriticalMaterialsEditor task={task} materials={materials} onOpenChange={setCriticalEditorOpen}>
    {({ openEditor }) => <>
      <TableRow className="proc-horizon-task-table-row cursor-pointer" data-task-id={task.id} data-state={selectedTaskId === task.id ? "selected" : undefined} aria-selected={selectedTaskId === task.id} data-attention={task.status === "pending_confirm"}
        onClick={(event) => {
          if (event.defaultPrevented || (event.target as HTMLElement).closest('button, a, input, select, textarea, [role="menuitem"], [role="dialog"]')) return;
          onOpen(task);
        }}>
        <TableCell className="proc-horizon-task-col-task whitespace-normal">
          <Button type="button" variant="unstyled" onClick={() => onOpen(task)} aria-label={t("查看任务：{name}", { name: task.materialName })}
            title={[task.materialName, task.spec].filter(Boolean).join(" · ")} className="block min-h-9 w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <AutoTranslatedText as="span" text={task.materialName} className="block line-clamp-2 break-words text-sm font-semibold text-foreground" />
            {task.spec && <AutoTranslatedText as="span" text={task.spec} className="mt-1 block line-clamp-2 break-words text-xs text-muted-foreground" />}
          </Button>
          <span className="mt-1 block break-all text-xs tabular-nums text-muted-foreground">{task.code}</span>
        </TableCell>
        <TableCell className="proc-horizon-task-col-attachments">
          {attachments.length ? <>
            <div className="flex items-center gap-1.5">
              {visibleAttachments.map((file, index) => <Button key={file.id} type="button" variant="unstyled"
                aria-label={t("预览附件：{name}", { name: file.fileName })} title={file.fileName} onClick={() => setPreviewAttachment(attachments[index])}
                className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {isImagePreviewSource(file.mimeType, file.fileName, file.fileUrl)
                  ? <RenewableImage resourceKey={`proc-table-thumb:${task.id}:${file.id}`} src={file.thumbUrl || file.fileUrl} alt="" loading="lazy" decoding="async"
                    refresh={async () => { const latest = await attachments[index].refresh!(); return latest.thumbUrl || latest.url; }} className="size-full object-contain p-1" />
                  : <FileText className="size-5" aria-hidden="true" />}
              </Button>)}
              {attachments.length > visibleAttachments.length && <Button type="button" variant="ghost" onClick={() => setPreviewAttachment(attachments[visibleAttachments.length])}
                aria-label={t("查看{name}的 {count} 个附件", { name: task.materialName, count: attachments.length })} className="h-11 min-w-9 px-1.5 text-xs font-medium tabular-nums text-primary">+{attachments.length - visibleAttachments.length}</Button>}
            </div>
            <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{t("{count} 个附件", { count: attachments.length })}</span>
          </> : <span className="text-xs text-muted-foreground">{t("无附件")}</span>}
        </TableCell>
        <TableCell className="proc-horizon-task-col-context"><BusinessLinePill line={task.businessLine} /><span className="mt-1.5 block text-xs text-muted-foreground">{t(task.source === "rd" ? "研发流转" : "采购自建")}</span><span className="mt-1 block text-xs text-muted-foreground">{t(task.method === "inquiry" ? "询价采购" : "电商直购")}</span></TableCell>
        <TableCell className="proc-horizon-task-col-status"><StatusPill status={task.status} /></TableCell>
        <TableCell className="proc-horizon-task-col-buyer"><div className="flex items-center gap-2"><PersonAvatar name={buyer} size="xs" /><span className="max-w-32 truncate text-xs" title={buyer}>{buyer}</span></div></TableCell>
        <TableCell className="proc-horizon-task-col-arrival">
          <p className="text-xs tabular-nums"><span className="font-semibold text-foreground">{quantity(task.arrivedQty)}</span><span className="text-muted-foreground"> / {quantity(task.quantity)} {t(task.unit)}</span></p>
          <div role="progressbar" aria-label={t("{name}到货进度", { name: task.materialName })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
            aria-valuetext={t("已到货 {arrived} / {total} {unit}", { arrived: quantity(task.arrivedQty), total: quantity(task.quantity), unit: t(task.unit) })} className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", progress >= 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${progress}%` }} />
          </div>
        </TableCell>
        <TableCell className="proc-horizon-task-col-payment"><span data-payment-status={task.paymentStatus} className="proc-horizon-payment-status text-xs">{t(task.paymentStatus === "paid" ? "已付款" : task.paymentStatus === "partial" ? "部分付款" : "未付款")}</span>{task.paymentDate && <time dateTime={task.paymentDate} className="mt-1 block text-xs tabular-nums text-muted-foreground">{task.paymentDate}</time>}</TableCell>
        <TableCell className="proc-horizon-task-col-date"><span className="block text-xs text-muted-foreground">{t(mainDate.label === "Deadline" ? "截止日期" : mainDate.label)}</span><span className={cn("mt-1 block text-xs tabular-nums", overdue && "font-medium text-rose-700")}>{validDate ? <time dateTime={mainDate.date}>{mainDate.date}</time> : t("日期待确认")}</span>{overdue && <span className="mt-1 block text-xs font-medium text-rose-700">{t("已逾期")}</span>}</TableCell>
        <TableCell className="proc-horizon-task-col-priority"><PriorityBadge priority={task.priority} /></TableCell>
        <TableCell className="proc-horizon-task-col-actions">
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpen(task)} className="min-h-8 px-2 text-xs">{t("查看")}</Button>
            {canAdvance && <Button type="button" size="sm" onClick={() => onNext?.(task)} className={cn("min-h-8 gap-1 px-2 text-xs", task.status === "pending_confirm" && "bg-rose-600 text-white hover:bg-rose-700")}>
              {t(nextAction!)}{DECISION_STATUSES.includes(task.status) && <ChevronRight className="size-3.5" aria-hidden="true" />}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="size-3.5" aria-hidden="true" />}
            </Button>}
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("更多操作：{name}", { name: task.materialName })}><MoreVertical className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="proc-horizon-menu min-w-40 rounded-xl p-1.5 data-[state=open]:animate-none data-[state=closed]:animate-none">
                <DropdownMenuItem onSelect={() => onOpen(task)}><ArrowRight className="size-4" />{t("查看任务")}</DropdownMenuItem>
                {can("proc-task:create") && <DropdownMenuItem onSelect={openEditor}><Settings2 className="size-4" />{t("库存设置")}</DropdownMenuItem>}
                {can("proc-task:reassign") && onReassign && <DropdownMenuItem onSelect={() => onReassign(task)}><UserCog className="size-4" />{t("转派")}</DropdownMenuItem>}
                {can("proc-task:delete") && onRemove && removalMode !== "review" && <DropdownMenuItem variant="destructive" onSelect={() => onRemove(task)}><Trash2 className="size-4" />{t(removalMode === "cancel" ? "取消任务" : "删除")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
      {previewAttachment && <AttachmentPreviewDialog attachment={previewAttachment} attachments={attachments} onClose={() => setPreviewAttachment(null)} />}
    </>}
  </TaskCriticalMaterialsEditor>;
}
