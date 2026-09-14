import { ChevronDown, ChevronRight, ExternalLink, FileText, History, MoreVertical, PackageCheck, Trash2, Undo2, UserCog } from "lucide-react";

import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { routePath } from "../../lib/routePaths";
import { taskRequester, type ProcurementTask } from "../data";
import { workspaceArrivals } from "../procurementWorkspaceModel";
import { isSampleTask } from "../sampleWorkspaceModel";
import { BusinessLinePill, PROC_STATUS_META, StatusPill, rollbackTargetsOf, useProcCan } from "./common";
import { RdDeliverySnapshotPanel } from "./RdDeliverySnapshotPanel";
import { nextPermissionOf, removalModeOf } from "./taskActions";

export interface ProcWorkspaceTaskPanelProps {
  task: ProcurementTask | null;
  blocked?: boolean;
  onOpenDetail: (task: ProcurementTask, action?: "rollback" | "logs") => void;
  onNext: (task: ProcurementTask) => void;
  onReassign: (task: ProcurementTask) => void;
  onRemove: (task: ProcurementTask) => void;
  onNavigateRelated: (path: string) => void;
}

/** Read-only selection summary; mutations continue through the existing task action handlers. */
export function ProcWorkspaceTaskPanel({ task, blocked = false, onOpenDetail, onNext, onReassign, onRemove, onNavigateRelated }: ProcWorkspaceTaskPanelProps) {
  const { t } = useI18n();
  const can = useProcCan();

  if (!task) {
    return (
      <aside aria-label={t("当前任务详情")} className="min-w-0 rounded-xl border border-border bg-card p-5">
        <h2 className="text-balance text-sm font-semibold text-foreground">{t("当前任务详情")}</h2>
        <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">{t("从任务列表选择一项，查看订单、样品与下一步操作。")}</p>
      </aside>
    );
  }

  const meta = PROC_STATUS_META[task.status];
  const requester = taskRequester(task);
  const orders = workspaceArrivals([task]);
  const sampleFacts = getProcSampleFacts(task);
  const showSample = isSampleTask(task);
  const showDelivery = task.source === "rd" || Boolean(task.rdTransferSnapshots?.length);
  const canAdvance = Boolean(meta.next && can(nextPermissionOf(task)));
  const canRollback = can("proc-task:rollback") && rollbackTargetsOf(task.status, task.method, task).length > 0;
  const removalMode = removalModeOf(task);
  const canRemove = can("proc-task:delete") && removalMode !== "review";
  const canOpenRd = Boolean(task.rdTaskId?.trim()) && (can("page:rd-task-management") || can("page:rd-my-workspace"));
  const currentTester = sampleFacts.evidence.roundId === task.sampleTest?.roundId && sampleFacts.state === "confirmed"
    ? task.sampleTest?.testerName?.trim() : null;

  return (
    <aside aria-label={t("当前任务详情")} className="proc-workspace-task-panel min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-balance text-sm font-semibold text-foreground">{t("当前任务")}</h2>
          <StatusPill status={task.status} />
        </div>
        <p className="mt-3 break-all text-xs tabular-nums text-muted-foreground">{task.code}</p>
        <h3 className="mt-1 break-words text-balance text-base font-semibold leading-6 text-foreground"><AutoTranslatedText text={task.materialName} /></h3>
        <p className="mt-1 break-words text-pretty text-xs leading-5 text-muted-foreground"><AutoTranslatedText text={task.spec || t("规格未填写")} /></p>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2" aria-label={t("任务操作")}>
          <Button type="button" variant="outline" disabled={blocked} onClick={() => onOpenDetail(task)} className="min-h-10 rounded-lg px-3 text-xs">{t("完整详情")}</Button>
          {canAdvance ? <Button type="button" disabled={blocked} onClick={() => onNext(task)} className="min-h-10 rounded-lg px-3 text-xs">{t(meta.next!)}<ChevronRight className="size-3.5" aria-hidden="true" /></Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" disabled={blocked} aria-label={t("更多任务操作")} className="size-10 rounded-lg"><MoreVertical className="size-4" aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="data-[state=open]:animate-none data-[state=closed]:animate-none">
              <DropdownMenuItem disabled={blocked} onSelect={() => onOpenDetail(task, "logs")}><History className="size-4" aria-hidden="true" />{t("操作记录")}</DropdownMenuItem>
              {canRollback ? <DropdownMenuItem disabled={blocked} onSelect={() => onOpenDetail(task, "rollback")}><Undo2 className="size-4" aria-hidden="true" />{t("回退")}</DropdownMenuItem> : null}
              {can("proc-task:reassign") ? <DropdownMenuItem disabled={blocked} onSelect={() => onReassign(task)}><UserCog className="size-4" aria-hidden="true" />{t("转派")}</DropdownMenuItem> : null}
              {canRemove ? <DropdownMenuItem disabled={blocked} variant="destructive" onSelect={() => onRemove(task)}><Trash2 className="size-4" aria-hidden="true" />{t(removalMode === "cancel" ? "取消任务" : "删除")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section aria-label={t("采购需求")} className="border-b border-border p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2"><BusinessLinePill line={task.businessLine} /><span className="text-xs text-muted-foreground">{t(task.method === "inquiry" ? "询价采购" : "电商直购")}</span></div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <SummaryFact label={t("需求数量")} value={`${Number.isFinite(task.quantity) && task.quantity >= 0 ? task.quantity.toLocaleString() : t("待核对")} ${t(task.unit)}`} numeric />
          <SummaryFact label={t("需求日期")} value={task.needDate || t("待确认")} numeric />
          <SummaryFact label={t("采购截止日期")} value={task.deadline || t("待确认")} numeric />
          <SummaryFact label={t("采购负责人")} value={task.buyer?.trim() || t("未指派")} />
          <SummaryFact label={t("需求提出")} value={requester.name?.trim() || t("未填写")} />
          <SummaryFact label={t("需求部门")} value={requester.dept?.trim() || t("未填写")} />
        </dl>
      </section>

      <section aria-label={t("关联订单")} className="border-b border-border p-4">
        <div className="flex items-baseline justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-foreground">{t("关联订单")}</h3><span className="text-xs tabular-nums text-muted-foreground">{t("{count} 行", { count: orders.length })}</span></div>
        {orders.length ? <ul className="mt-3 divide-y divide-border">
          {orders.slice(0, 3).map((order) => (
            <li key={order.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words text-pretty text-xs font-medium text-foreground">{order.supplier || t("供应商未确定")}</p>
                {order.freeSample ? <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-primary">{t("免费样品")}</span> : null}
              </div>
              <p className="mt-1 break-all text-xs tabular-nums leading-5 text-muted-foreground">{order.orderNo || t(order.freeSample ? "无正式采购单号" : "单号待确认")}{order.lineNo ? ` · ${t("行号")} ${order.lineNo}` : order.freeSample ? "" : ` · ${t("行号待确认")}`}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <SummaryFact label={t("已下单")} value={`${order.orderedQty === null ? t("待核对") : order.orderedQty.toLocaleString()} ${t(order.unit)}`} numeric />
                <SummaryFact label={t("已收数量")} value={`${order.receivedQty === null ? t("待核对") : order.receivedQty.toLocaleString()} ${t(order.unit)}`} numeric />
                <SummaryFact label={t("未收数量")} value={`${order.remainingQty === null ? t("待核对") : order.remainingQty.toLocaleString()} ${t(order.unit)}`} numeric />
                <SummaryFact label={t("预计到货")} value={order.etaDate || t("待确认")} numeric />
              </dl>
            </li>
          ))}
        </ul> : <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t("尚未关联采购订单。下单后可在完整详情中核对订单与到货数量。")}</p>}
        {orders.length > 3 ? <Button type="button" variant="ghost" disabled={blocked} onClick={() => onOpenDetail(task)} className="mt-3 min-h-10 w-full rounded-lg text-xs">{t("查看全部 {count} 行订单", { count: orders.length })}<ChevronRight className="size-3.5" aria-hidden="true" /></Button> : null}
      </section>

      {showSample ? <section aria-label={t("样品与测试")} className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-foreground">{t("样品与测试")}</h3><span className="text-xs font-medium text-primary">{t(sampleFacts.label)}</span></div>
        <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t(sampleFacts.description)}</p>
        {currentTester ? <p className="mt-2 text-pretty text-xs text-muted-foreground">{t("测试人员")}：{currentTester}</p> : null}
        {can("page:proc-cockpit") ? <Button type="button" variant="outline" disabled={blocked} onClick={() => onNavigateRelated(`${routePath("page:proc-cockpit", "/proc-cockpit")}?tab=samples&sample=${encodeURIComponent(task.id)}`)} className="mt-3 min-h-10 rounded-lg text-xs"><PackageCheck className="size-4" aria-hidden="true" />{t("打开样品协同")}<ExternalLink className="size-3.5" aria-hidden="true" /></Button> : null}
      </section> : null}

      {showDelivery || canOpenRd ? <section aria-label={t("研发关联资料")} className="p-4">
        {canOpenRd ? <Button type="button" variant="outline" disabled={blocked} onClick={() => onNavigateRelated(`/rd-task/${encodeURIComponent(task.rdTaskId!.trim())}`)} className="mb-3 min-h-10 max-w-full rounded-lg text-xs"><FileText className="size-4" aria-hidden="true" /><span className="truncate">{t("查看关联研发任务")}</span><ExternalLink className="size-3.5" aria-hidden="true" /></Button> : null}
        {showDelivery ? <Collapsible key={task.id} disabled={blocked}>
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group min-h-10 w-full justify-between rounded-lg px-2 text-xs"><span>{t("研发交付版本")}</span><span className="ml-auto tabular-nums text-muted-foreground">{task.rdTransferSnapshots?.length || 0}</span><ChevronDown className="size-4 group-data-[state=open]:rotate-180" aria-hidden="true" /></Button></CollapsibleTrigger>
          <CollapsibleContent className="pt-2"><RdDeliverySnapshotPanel task={task} compact /></CollapsibleContent>
        </Collapsible> : null}
      </section> : null}
    </aside>
  );
}

function SummaryFact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className={cn("mt-1 break-words font-medium text-foreground", numeric ? "tabular-nums" : "text-pretty")}>{value}</dd></div>;
}
