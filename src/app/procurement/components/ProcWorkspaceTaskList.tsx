import { useMemo, useState } from "react";
import { ArrowRight, Package } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { RenewableImage } from "../../components/RenewableImage";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { isProcurementTaskOverdue, taskMainDate, type Material, type ProcurementTask } from "../data";
import { workspaceSuppliers } from "../procurementWorkspaceModel";
import { sampleProductImage } from "../samples/sampleProductImageSource";
import { PriorityBadge, StatusPill, procurementNextAction, useProcCan } from "./common";
import { DECISION_STATUSES, nextPermissionOf } from "./taskActions";

const COLUMNS = [
  ["code", "任务编号"], ["material", "事项"], ["business", "所属业务"], ["node", "当前节点"],
  ["date", "截止"], ["status", "状态"], ["next", "下一步"], ["action", "操作"],
] as const;

function WorkspaceMaterialImage({ task, material }: { task: ProcurementTask; material?: Material }) {
  const { t } = useI18n();
  const image = sampleProductImage(task, material);
  const [unavailable, setUnavailable] = useState(false);
  return <span className="proc-s01-material-image relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
    {(!image || unavailable) && <Package className="size-5 text-muted-foreground" aria-hidden="true" />}
    {image && <RenewableImage
      resourceKey={`workspace-product:${task.id}:${image.id}`}
      src={image.thumbUrl || image.url}
      refresh={image.refresh ? async () => { const latest = await image.refresh!(); return latest.thumbUrl || latest.url; } : undefined}
      alt="" loading="lazy" decoding="async"
      onError={() => setUnavailable(true)} onLoad={() => setUnavailable(false)}
      className={cn("absolute inset-0 size-full object-contain p-1", unavailable && "opacity-0")}
    />}
    {!image && <span className="sr-only">{t("暂无产品图")}</span>}
  </span>;
}

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
  const quantity = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : t("待核对");
  return <div className="proc-s01-task-table min-h-0">
    <Table className="proc-s01-table" containerClassName="overflow-visible" aria-label={t("个人采购任务")}>
      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>{COLUMNS.map(([column, label]) => <TableHead key={column} scope="col" className={`proc-s01-${column} text-xs`}>{t(label)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{tasks.map((task) => {
        const material = task.materialId ? materialsById.get(task.materialId) : undefined;
        const suppliers = workspaceSuppliers(task);
        const date = taskMainDate(task);
        const validDate = date.date && Number.isFinite(date.days);
        const overdue = isProcurementTaskOverdue(task);
        const nextAction = procurementNextAction(task);
        const canAdvance = Boolean(nextAction && can(nextPermissionOf(task)));
        const remaining = Number.isFinite(task.quantity) && task.quantity >= 0 && Number.isFinite(task.arrivedQty) && task.arrivedQty >= 0 && task.arrivedQty <= task.quantity
          ? task.quantity - task.arrivedQty : null;
        return <TableRow key={task.id} data-task-id={task.id} data-state={selectedId === task.id ? "selected" : undefined} className="proc-s01-task-row" onClick={disabled ? undefined : (event) => { if ( !(event.target as HTMLElement).closest("button, a, input, [role=button]")) onSelect(task.id); }}>
          <TableCell className="proc-s01-code"><span className="break-all text-xs font-semibold text-primary">{task.code}</span></TableCell>
          <TableCell className="proc-s01-material">
            <Button variant="unstyled" type="button" aria-pressed={selectedId === task.id} aria-controls="proc-workspace-current-task" onClick={() => onSelect(task.id)} disabled={disabled} className="flex min-h-12 w-full items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              <WorkspaceMaterialImage key={`${task.id}:${material?.imageUrl ?? ""}`} task={task} material={material} />
              <span className="min-w-0"><span title={task.materialName} className="line-clamp-2 break-words text-sm font-semibold leading-5 text-foreground">{task.materialName}</span><span title={task.spec || undefined} className="mt-0.5 block truncate text-xs text-muted-foreground">{task.spec || t("规格待补充")}</span><span title={material?.erpCode ? `${material.erpCode} · ${task.code}` : task.code} className="mt-0.5 block truncate text-[11px] tabular-nums text-muted-foreground">{material?.erpCode ? `${material.erpCode} · ` : ""}{task.code}</span></span>
            </Button>
            <span className="sr-only">{t("供应商")}{suppliers.join("、") || t("未确定")}{t("需求数量")}{quantity(task.quantity)} {t(task.unit)}{t("已到货")}{quantity(task.arrivedQty)} {t(task.unit)}{t("未到货")}{quantity(remaining)}{remaining !== null && ` ${t(task.unit)}`}</span>
          </TableCell>
          <TableCell className="proc-s01-business"><span className="text-xs">{t(task.businessLine === "rd" ? "研发采购" : "生产采购")}</span><span className="mt-1 block text-xs text-muted-foreground">{t(task.needSample ? "样品确认" : "采购执行")}</span></TableCell>
          <TableCell className="proc-s01-node"><StatusPill status={task.status} /></TableCell>
          <TableCell className="proc-s01-date"><span className="block text-xs text-muted-foreground">{t(date.label === "Deadline" ? "截止日期" : date.label)}</span><span className={cn("mt-1 block text-xs tabular-nums", overdue && "font-medium text-rose-700")}>{validDate ? date.date : t("日期待确认")}</span>{overdue && <span className="mt-1 block text-xs text-rose-700">{t("已逾期")}</span>}</TableCell>
          <TableCell className="proc-s01-status"><div className="flex flex-wrap gap-1.5"><span className={cn("proc-s01-state", overdue && "text-rose-700 bg-rose-50")}>{t(task.status === "completed" ? "已完成" : task.status === "cancelled" ? "已取消" : overdue ? "逾期" : ["pending_confirm", "pending_inquiry", "pending_purchase", "priced"].includes(task.status) ? "待处理" : ["pending_rd_review", "pending_sample", "testing"].includes(task.status) ? "等待他人" : "进行中")}</span>{task.priority === "high" && <PriorityBadge priority={task.priority} />}</div></TableCell>
          <TableCell className="proc-s01-next">{canAdvance && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onNext(task)} className="min-h-8 h-auto whitespace-normal px-2 text-xs text-primary">{t(DECISION_STATUSES.includes(task.status) ? "查看并处理" : nextAction!)}<ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /></Button>}{!canAdvance && <span className="text-xs text-muted-foreground">{nextAction ? t(nextAction) : "—"}</span>}</TableCell>
          <TableCell className="proc-s01-action"><div className="flex flex-wrap items-center gap-1"><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onSelect(task.id)} className="min-h-8 px-2.5 text-xs" aria-label={t("查看任务：{name}", { name: task.materialName })}>{t("查看")}</Button></div></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
