import { X, ChevronDown, ChevronRight, ExternalLink, FileText, History, MoreVertical, PackageCheck, Trash2, Undo2, UserCog } from "lucide-react";

import { AutoTranslatedText } from "../../components/TranslatableText";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { routePath } from "../../lib/routePaths";
import { taskRequester, type Material, type ProcurementTask } from "../data";
import { workspaceArrivals } from "../procurementWorkspaceModel";
import { isSampleTask } from "../sampleWorkspaceModel";
import { SampleProductImage } from "../samples/SampleProductImage";
import { BusinessLinePill, PersonAvatar, StatusPill, procurementNextAction, rollbackTargetsOf, useProcCan } from "./common";
import { ProcurementDecisionPanel } from "./ProcurementDecisionPanel";
import { RdDeliverySnapshotPanel } from "./RdDeliverySnapshotPanel";
import { nextPermissionOf, removalModeOf } from "./taskActions";

export interface ProcWorkspaceTaskPanelProps {
  task: ProcurementTask | null;
  materials?: Material[];
  blocked?: boolean;
  onClose?: () => void;
  onOpenDetail: (task: ProcurementTask, action?: "rollback" | "logs") => void;
  onNext: (task: ProcurementTask) => void;
  onReassign: (task: ProcurementTask) => void;
  onRemove: (task: ProcurementTask) => void;
  onNavigateRelated: (path: string) => void;
}

/** Read-only selection summary; mutations continue through the existing task action handlers. */
export function ProcWorkspaceTaskPanel({ task, materials = [], blocked = false, onClose, onOpenDetail, onNext, onReassign, onRemove, onNavigateRelated }: ProcWorkspaceTaskPanelProps) {
  const { t } = useI18n();
  const can = useProcCan();

  if (!task) {
    return (
      <aside aria-label={t("当前任务详情")} className="proc-workspace-task-panel proc-s01-panel-empty flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card p-5">
        <h2 className="text-balance text-sm font-semibold text-foreground">{t("当前任务详情")}</h2>
        <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">{t("从任务列表选择一项，查看订单、样品与下一步操作。")}</p>
      </aside>
    );
  }

  const nextAction = procurementNextAction(task);
  const material = task.materialId ? materials.find((item) => item.id === task.materialId) : undefined;
  const requester = taskRequester(task);
  const orders = workspaceArrivals([task]);
  const sampleFacts = getProcSampleFacts(task);
  const showSample = isSampleTask(task);
  const showDelivery = task.source === "rd" || Boolean(task.rdTransferSnapshots?.length);
  const canAdvance = Boolean(nextAction && can(nextPermissionOf(task)));
  const canRollback = can("proc-task:rollback") && rollbackTargetsOf(task.status, task.method, task).length > 0;
  const removalMode = removalModeOf(task);
  const canRemove = can("proc-task:delete") && removalMode !== "review";
  const canOpenRd = Boolean(task.rdTaskId?.trim()) && (can("page:rd-task-management") || can("page:rd-my-workspace"));
  const currentTester = sampleFacts.evidence.roundId === task.sampleTest?.roundId && sampleFacts.state === "confirmed"
    ? task.sampleTest?.testerName?.trim() : null;
  const quantityText = (value: number) => `${Number.isFinite(value) && value >= 0 ? value.toLocaleString() : t("待核对")} ${t(task.unit)}`;
  const paymentLabel = task.paymentStatus === "paid" ? t("已付款") : task.paymentStatus === "partial" ? t("部分付款") : task.paymentStatus === "unpaid" ? t("未付款") : t("待确认");

  return (
    <aside aria-label={t("当前任务详情")} className="proc-workspace-task-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="proc-s01-panel-header shrink-0 border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-balance text-sm font-semibold text-foreground">{t("任务详情")}</h2>
          <div className="flex items-center gap-1"><DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" disabled={blocked} aria-label={t("更多任务操作")} className="size-8 shrink-0 rounded-lg"><MoreVertical className="size-4" aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="data-[state=open]:animate-none data-[state=closed]:animate-none">
              <DropdownMenuItem disabled={blocked} onSelect={() => onOpenDetail(task, "logs")}><History className="size-4" aria-hidden="true" />{t("操作记录")}</DropdownMenuItem>
              {canRollback ? <DropdownMenuItem disabled={blocked} onSelect={() => onOpenDetail(task, "rollback")}><Undo2 className="size-4" aria-hidden="true" />{t("回退")}</DropdownMenuItem> : null}
              {can("proc-task:reassign") ? <DropdownMenuItem disabled={blocked} onSelect={() => onReassign(task)}><UserCog className="size-4" aria-hidden="true" />{t("转派")}</DropdownMenuItem> : null}
              {canRemove ? <DropdownMenuItem disabled={blocked} variant="destructive" onSelect={() => onRemove(task)}><Trash2 className="size-4" aria-hidden="true" />{t(removalMode === "cancel" ? "取消任务" : "删除")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>{onClose && <Button type="button" variant="ghost" size="icon" aria-label={t("关闭任务详情")} onClick={onClose} className="size-8"><X className="size-4" /></Button>}</div>
        </div>
        <div className="proc-s01-panel-product flex items-start gap-3">
          <div className="proc-s01-panel-image size-20 shrink-0 [&_.proc-sample-product-image]:size-full"><SampleProductImage key={task.id} task={task} material={material} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-balance text-base font-semibold leading-6 text-foreground"><AutoTranslatedText text={task.materialName} /></h3>
            <p className="mt-1 break-words text-pretty text-xs leading-5 text-muted-foreground"><AutoTranslatedText text={task.spec || t("规格未填写")} /></p>
            <p className="mt-1 break-all text-xs tabular-nums leading-5 text-muted-foreground">{task.code}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={task.status} /><BusinessLinePill line={task.businessLine} /><span className="text-xs text-muted-foreground">{t(task.method === "inquiry" ? "询价采购" : "电商直购")}</span></div>
      </header>

      <div className="proc-s01-panel-body cockpit-scroll min-h-0 flex-1 overflow-y-auto">
        <section aria-label={t("需求与协作")} className="proc-s01-panel-section border-b border-border p-4">
          <h3 className="text-balance text-sm font-semibold text-foreground">{t("需求与协作")}</h3>
          <dl className="proc-s01-detail-facts mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="min-w-0"><dt className="text-muted-foreground">{t("采购负责人")}</dt><dd className="mt-2 flex items-center gap-2 font-semibold"><PersonAvatar name={task.buyer?.trim() || t("未指派")} />{task.buyer?.trim() || t("未指派")}</dd></div>
            <SummaryFact label={t("需求部门")} value={requester.dept?.trim() || t("未填写")} />
            <SummaryFact label={t("需求提出")} value={requester.name?.trim() || t("未填写")} />
            <SummaryFact label={t("所属业务")} value={t(showSample ? "样品确认" : "采购执行")} />
          </dl>
        </section>

        <section aria-label={t("采购与到货")} className="proc-s01-panel-section border-b border-border p-4">
          <h3 className="text-balance text-sm font-semibold text-foreground">{t("采购与到货")}</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <SummaryFact label={t("需求数量")} value={quantityText(task.quantity)} numeric />
            <SummaryFact label={t("已到货数量")} value={quantityText(task.arrivedQty)} numeric />
            <SummaryFact label={t("需求日期")} value={task.needDate || t("待确认")} numeric />
            <SummaryFact label={t("采购截止日期")} value={task.deadline || t("待确认")} numeric />
            <SummaryFact label={t("预计到货日期")} value={task.expectedArrivalDate || t("待确认")} numeric />
            <SummaryFact label={t("付款状态")} value={paymentLabel} />
            {task.paymentDate ? <SummaryFact label={t("付款日期")} value={task.paymentDate} numeric /> : null}
          </dl>
        </section>

        <section aria-label={t("最新进展")} className="proc-s01-panel-section border-b border-border p-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{t("最新进展")}</h3><Button variant="ghost" size="sm" disabled={blocked} onClick={() => onOpenDetail(task, "logs")} className="text-xs text-primary">{t("查看全部")}</Button></div>
          {task.logs?.length ? <ul className="divide-y divide-border">{[...task.logs].sort((a, b) => (Date.parse(b.createdAt || b.at) || 0) - (Date.parse(a.createdAt || a.at) || 0)).slice(0, 2).map((log, index) => <li key={log.id || index} className="py-3"><p className="text-xs text-muted-foreground">{log.at} {log.actor}</p><p className="mt-1 text-sm leading-6 whitespace-pre-wrap break-words">{log.text}</p></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{t("暂无进展记录")}</p>}
        </section>
        {!blocked && <ProcurementDecisionPanel key={task.id} task={task} compact />}

        <section aria-label={t("供应商与订单")} className="proc-s01-panel-section border-b border-border p-4">
          <div className="flex items-baseline justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-foreground">{t("供应商与订单")}</h3><span className="text-xs tabular-nums text-muted-foreground">{t("{count} 行", { count: orders.length })}</span></div>
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

        {showSample ? <section aria-label={t("样品与测试")} className="proc-s01-panel-section border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-foreground">{t("样品与测试")}</h3><span className="text-xs font-medium text-primary">{t(sampleFacts.label)}</span></div>
          <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">{t(sampleFacts.description)}</p>
          {currentTester ? <p className="mt-2 text-pretty text-xs text-muted-foreground">{t("测试人员")}：{currentTester}</p> : null}
          {can("page:proc-cockpit") ? <Button type="button" variant="outline" disabled={blocked} onClick={() => onNavigateRelated(`${routePath("page:proc-cockpit", "/proc-cockpit")}?tab=samples&sample=${encodeURIComponent(task.id)}`)} className="mt-3 min-h-10 rounded-lg text-xs"><PackageCheck className="size-4" aria-hidden="true" />{t("打开样品协同")}<ExternalLink className="size-3.5" aria-hidden="true" /></Button> : null}
        </section> : null}

        {showDelivery || canOpenRd ? <section aria-label={t("研发关联资料")} className="proc-s01-panel-section p-4">
          {canOpenRd ? <Button type="button" variant="outline" disabled={blocked} onClick={() => onNavigateRelated(`/rd-task/${encodeURIComponent(task.rdTaskId!.trim())}`)} className="mb-3 min-h-10 max-w-full rounded-lg text-xs"><FileText className="size-4" aria-hidden="true" /><span className="truncate">{t("查看关联研发任务")}</span><ExternalLink className="size-3.5" aria-hidden="true" /></Button> : null}
          {showDelivery ? <Collapsible key={task.id} disabled={blocked}>
            <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="group min-h-10 w-full justify-between rounded-lg px-2 text-xs"><span>{t("研发交付版本")}</span><span className="ml-auto tabular-nums text-muted-foreground">{task.rdTransferSnapshots?.length || 0}</span><ChevronDown className="size-4 group-data-[state=open]:rotate-180" aria-hidden="true" /></Button></CollapsibleTrigger>
            <CollapsibleContent className="pt-2"><RdDeliverySnapshotPanel task={task} compact /></CollapsibleContent>
          </Collapsible> : null}
        </section> : null}
      </div>

      <footer className="proc-s01-panel-footer flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card p-4" aria-label={t("任务操作")}>
        <Button type="button" variant="outline" disabled={blocked} onClick={() => onOpenDetail(task)} className="min-h-10 flex-1 rounded-lg px-3 text-xs">{t("完整详情")}</Button>
        {can("proc-task:reassign") && <Button type="button" variant="outline" disabled={blocked} onClick={() => onReassign(task)} className="min-h-10 flex-1 text-xs"><UserCog className="size-3.5" />{t("转派")}</Button>}
        {canAdvance ? <Button type="button" disabled={blocked} onClick={() => onNext(task)} className="min-h-10 flex-1 rounded-lg px-3 text-xs">{t(nextAction!)}<ChevronRight className="size-3.5" aria-hidden="true" /></Button> : null}
      </footer>
    </aside>
  );
}

function SummaryFact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className={cn("mt-1 break-words font-medium text-foreground", numeric ? "tabular-nums" : "text-pretty")}>{value}</dd></div>;
}
