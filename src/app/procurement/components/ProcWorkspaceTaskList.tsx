import { useMemo } from "react";
import { ArrowRight, Package } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { isImagePreviewSource } from "../../components/MobileZoomableImage";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { isProcurementTaskOverdue, taskMainDate, type Material, type ProcurementTask } from "../data";
import { workspaceSuppliers } from "../procurementWorkspaceModel";
import { PROC_STATUS_META, PriorityBadge, StatusPill, useProcCan } from "./common";
import { DECISION_STATUSES, nextPermissionOf } from "./taskActions";

export function ProcWorkspaceTaskList({ tasks, materials, selectedId, disabled, onSelect, onNext }: {
  tasks: ProcurementTask[];
  materials: Material[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNext: (task: ProcurementTask) => void;
}) {
  const { t } = useI18n();
  const can = useProcCan();
  const materialsById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  return <div className="proc-s01-task-table rounded-xl border border-border bg-card">
    <Table className="proc-s01-table" containerClassName="overflow-visible">
      <TableHeader><TableRow>{["物料 / 规格", "供应商", "需求数量", "当前期限", "状态", "操作"].map((label) => <TableHead key={label} scope="col" className="text-xs">{t(label)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{tasks.map((task) => {
        const material = task.materialId ? materialsById.get(task.materialId) : undefined;
        const imageAttachment = task.attachmentList.find((file) => isImagePreviewSource(file.mimeType, file.fileName, file.fileUrl));
        const image = material?.imageUrl || imageAttachment?.thumbUrl || imageAttachment?.fileUrl;
        const suppliers = workspaceSuppliers(task);
        const date = taskMainDate(task);
        const validDate = date.date && Number.isFinite(date.days);
        const overdue = isProcurementTaskOverdue(task);
        const meta = PROC_STATUS_META[task.status];
        const canAdvance = Boolean(meta.next && can(nextPermissionOf(task)));
        return <TableRow key={task.id} data-state={selectedId === task.id ? "selected" : undefined} className="proc-s01-task-row">
          <TableCell className="proc-s01-material">
            <Button variant="unstyled" type="button" aria-pressed={selectedId === task.id} aria-controls="proc-workspace-current-task" onClick={() => onSelect(task.id)} disabled={disabled} className="flex min-h-11 w-full items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              {image ? <img src={image} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-lg border border-border bg-card object-contain" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Package className="size-5 text-muted-foreground" aria-hidden="true" /></span>}
              <span className="min-w-0"><span className="line-clamp-2 break-words text-sm font-semibold text-foreground">{task.materialName}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{task.spec || t("规格待补充")}</span><span className="mt-1 block break-all text-xs tabular-nums text-muted-foreground">{material?.erpCode ? `${material.erpCode} · ` : ""}{task.code}</span></span>
            </Button>
          </TableCell>
          <TableCell className="proc-s01-supplier"><span className="proc-s01-cell-label">{t("供应商")}</span><span className="line-clamp-2 break-words text-xs">{suppliers.join("、") || t("未确定")}</span></TableCell>
          <TableCell className="proc-s01-quantity"><span className="proc-s01-cell-label">{t("需求数量")}</span><span className="break-words text-xs font-medium tabular-nums">{Number.isFinite(task.quantity) && task.quantity >= 0 ? task.quantity.toLocaleString() : t("待核对")} {task.unit}</span></TableCell>
          <TableCell className="proc-s01-date"><span className="block text-xs text-muted-foreground">{t(date.label === "Deadline" ? "截止日期" : date.label)}</span><span className={cn("mt-1 block text-xs tabular-nums", overdue && "font-medium text-rose-700")}>{validDate ? date.date : t("日期待确认")}</span>{overdue && <span className="mt-1 block text-xs text-rose-700">{t("已逾期")}</span>}</TableCell>
          <TableCell className="proc-s01-status"><div className="flex flex-wrap gap-1.5"><StatusPill status={task.status} />{task.priority === "high" && <PriorityBadge priority={task.priority} />}</div></TableCell>
          <TableCell className="proc-s01-action"><div className="flex flex-wrap gap-1.5"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onSelect(task.id)} className="min-h-9 px-2 text-xs" aria-label={t("查看任务：{name}", { name: task.materialName })}>{t("查看")}</Button>{canAdvance && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onNext(task)} className="min-h-9 h-auto whitespace-normal px-2 text-xs text-primary">{t(DECISION_STATUSES.includes(task.status) ? "查看并处理" : meta.next!)}<ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /></Button>}</div></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
