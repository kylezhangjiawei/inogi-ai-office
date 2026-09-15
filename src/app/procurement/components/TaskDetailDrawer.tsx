import { procurementAttachmentPreview } from "../../lib/attachmentAccess";
// 采购任务详情抽屉：步骤条(询价长/直购短) + 下一步操作卡 + 基本信息 + 报价 + 样品测试 + 下单付款 + 到货 + 日志。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ChevronDown, Eye, ExternalLink, FolderTree, History, Paperclip, Pencil, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../components/ui/utils";
import { AttachmentPreviewDialog, type PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { BusinessLinePill, DIRECT_FLOW, FREE_SAMPLE_ONLY_STATUSES, INQUIRY_FLOW, MethodPill, PROC_STATUS_META, PersonAvatar, QUOTE_RESETTABLE_STATUSES, SourcePill, StatusPill, fmtMoney, rollbackCleanupHintOf, rollbackTargetsOf, useBuyerDirectory, useProcCan } from "./common";
import { nextPermissionOf, useProcTaskAction } from "./taskActions";
import { EditTaskModal } from "./modals";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { MoveTaskDialog } from "./MoveTaskDialog";
import { applyProcTaskUpdate, captureProcurementScope, refreshProcurement, taskRequester, useProcurementData, type ProcurementTask } from "../data";
import { getProcTask, listQuotations, rejectProcTask, resetProcTaskQuotations, rollbackProcTask, unlinkPurchaseOrder, type ProcLog, type ProcStatus, type Quotation } from "../../lib/procurementApi";
import { toast } from "sonner";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { TaskCriticalMaterials } from "./TaskCriticalMaterials";
import { SAMPLE_TEST_RESULT_LABELS } from "./ProcSampleTestDialog";
import { RdDeliverySnapshotPanel } from "./RdDeliverySnapshotPanel";
import { getProcSampleFacts } from "../../lib/procSampleFacts";
import { isSampleTask } from "../sampleWorkspaceModel";
import { routePath } from "../../lib/routePaths";


function Info({ label, value }: { label: string; value: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{t(label)}</span>
      <span className="min-w-0 break-words text-pretty text-slate-700">{value}</span>
    </div>
  );
}

function restoreConfirmationFocus(event: Event, opener: HTMLButtonElement | null, section: HTMLElement | null, header: HTMLElement | null) {
  event.preventDefault();
  const target = opener?.isConnected && !opener.disabled ? opener : section?.isConnected ? section : header;
  target?.focus();
}

function formatProcLogTime(log: ProcLog): string {
  if (log.createdAt) {
    const date = new Date(log.createdAt);
    if (Number.isFinite(date.getTime())) return date.toLocaleString(undefined, {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }
  return log.at || "";
}

export function TaskDetailDrawer({ task, onClose, initialAction, onNavigateRelated }: { task: ProcurementTask; onClose: () => void; initialAction?: "rollback" | "logs"; onNavigateRelated?: (path: string) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { materials } = useProcurementData();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const drawerHeaderRef = useRef<HTMLDivElement>(null);
  const quoteSectionRef = useRef<HTMLDivElement>(null);
  const purchaseOrdersSectionRef = useRef<HTMLDivElement>(null);
  const resetQuoteTriggerRef = useRef<HTMLButtonElement>(null);
  const rollbackTriggerRef = useRef<HTMLButtonElement>(null);
  const logsSectionRef = useRef<HTMLDivElement>(null);
  const logsTriggerRef = useRef<HTMLButtonElement>(null);
  const logsFocusRequestRef = useRef<string | null>(null);
  const initialActionHandledRef = useRef<string | null>(null);
  const unlinkOrderTriggerRef = useRef<HTMLButtonElement | null>(null);
  const can = useProcCan();
  const { deptOf } = useBuyerDirectory();
  const taskAction = useProcTaskAction();
  const requester = taskRequester(task);
  const buyerLabel = task.buyer?.trim() || t("未指派");
  const awaitingTest = task.status === "testing" && task.sampleTest && !task.sampleTest.result;
  const sampleFacts = getProcSampleFacts(task);
  const showSample = isSampleTask(task);
  const meta = PROC_STATUS_META[task.status];
  const flow = task.method === "direct" ? DIRECT_FLOW : INQUIRY_FLOW;
  const curIdx = flow.indexOf(task.status);
  // 报价维护错了要能重做。已下单及之后不给：那时单价已随采购单出去，改这里会与 T+ 对不上
  // 报价读写状态和任务流转分开显示，网络失败时允许在原位重试。
  const canResetQuotes = can("proc-task:select-quote") && QUOTE_RESETTABLE_STATUSES.includes(task.status);
  const [resetting, setResetting] = useState(false);
  const [resetReason, setResetReason] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const submitResetQuotes = async () => {
    const requestScope = captureProcurementScope();
    setResetBusy(true);
    try {
      const updated = await resetProcTaskQuotations(task.id, resetReason.trim() || undefined);
      applyProcTaskUpdate(updated, requestScope);
      void refreshProcurement();
      toast.success(t("已清空报价并退回「待询价」，可重新维护"));
      setResetting(false);
      setResetReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("重新维护失败"));
    } finally {
      setResetBusy(false);
    }
  };
  // 打开时绑定任务和原状态；更新中的任务必须重新读取、选择，不静默换成新的 from_status。
  const [rollbackSnapshot, setRollbackSnapshot] = useState<Pick<ProcurementTask, "id" | "code" | "status" | "method" | "source" | "rdTaskId"> | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ProcStatus | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackNeedsRefresh, setRollbackNeedsRefresh] = useState(false);
  const rollbackBusyRef = useRef(false);
  const rollbackFirstTargetRef = useRef<HTMLButtonElement>(null);
  const rollbackTitleRef = useRef<HTMLHeadingElement>(null);
  const rollbackRefreshFocusRef = useRef<typeof rollbackSnapshot>(null);
  const currentTaskRef = useRef(task);
  currentTaskRef.current = task;
  const rollbackTargets = rollbackTargetsOf(rollbackSnapshot?.status ?? task.status, rollbackSnapshot?.method ?? task.method, rollbackSnapshot ?? task);
  const canRollback = can("proc-task:rollback") && rollbackTargetsOf(task.status, task.method, task).length > 0;
  const rollbackStale = Boolean(rollbackSnapshot && (rollbackSnapshot.id !== task.id || rollbackSnapshot.status !== task.status || rollbackSnapshot.method !== task.method || rollbackSnapshot.source !== task.source || rollbackSnapshot.rdTaskId !== task.rdTaskId));
  const rollbackHints = rollbackTarget ? rollbackCleanupHintOf(rollbackTarget) : [];
  // 刷新成功会移除当前聚焦的重试按钮；等新节点提交到 DOM 后，把焦点留在回退框内。
  useEffect(() => {
    const refreshedSnapshot = rollbackRefreshFocusRef.current;
    if (!refreshedSnapshot || rollbackBusy) return;
    rollbackRefreshFocusRef.current = null;
    if (refreshedSnapshot !== rollbackSnapshot || refreshedSnapshot.id !== task.id || rollbackStale || rollbackNeedsRefresh) return;
    const firstTarget = rollbackFirstTargetRef.current;
    const focusTarget = firstTarget?.isConnected && !firstTarget.matches(":disabled") ? firstTarget : rollbackTitleRef.current;
    if (focusTarget?.isConnected) focusTarget.focus();
  }, [rollbackSnapshot, rollbackBusy, rollbackStale, rollbackNeedsRefresh, task.id]);
  const openRollback = () => {
    if (!canRollback || rollbackBusyRef.current || taskAction.busy) return;
    rollbackRefreshFocusRef.current = null;
    setRollbackSnapshot({ id: task.id, code: task.code, status: task.status, method: task.method, source: task.source, rdTaskId: task.rdTaskId });
    setRollbackTarget(null);
    setRollbackReason("");
    setRollbackError(null);
    setRollbackNeedsRefresh(false);
  };
  useEffect(() => {
    if (!initialAction) return;
    const requestKey = `${task.id}:${initialAction}`;
    if (initialActionHandledRef.current === requestKey) return;
    initialActionHandledRef.current = requestKey;
    if (initialAction === "rollback") {
      openRollback();
    } else {
      logsFocusRequestRef.current = task.id;
      setLogsOpen(true);
    }
  }, [initialAction, task.id]);
  useEffect(() => {
    if (!logsOpen || logsFocusRequestRef.current !== task.id) return;
    logsFocusRequestRef.current = null;
    logsTriggerRef.current?.focus({ preventScroll: true });
    logsSectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [logsOpen, task.id]);
  const closeRollback = () => {
    if (rollbackBusyRef.current) return;
    rollbackRefreshFocusRef.current = null;
    setRollbackSnapshot(null);
    setRollbackTarget(null);
    setRollbackReason("");
    setRollbackError(null);
    setRollbackNeedsRefresh(false);
  };
  const reloadRollbackTask = async () => {
    if (!rollbackSnapshot || rollbackBusyRef.current || rollbackSnapshot.id !== currentTaskRef.current.id) return;
    const requestScope = captureProcurementScope();
    rollbackBusyRef.current = true;
    setRollbackBusy(true);
    setRollbackTarget(null);
    setRollbackReason("");
    try {
      const latest = await getProcTask(rollbackSnapshot.id);
      if (latest.id !== currentTaskRef.current.id) return;
      applyProcTaskUpdate(latest, requestScope);
      const refreshedSnapshot = { id: latest.id, code: latest.code, status: latest.status, method: latest.method, source: latest.source, rdTaskId: latest.rdTaskId };
      rollbackRefreshFocusRef.current = refreshedSnapshot;
      setRollbackSnapshot(refreshedSnapshot);
      setRollbackNeedsRefresh(false);
      setRollbackError(null);
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : t("任务刷新失败，请重试"));
      setRollbackNeedsRefresh(true);
    } finally {
      rollbackBusyRef.current = false;
      setRollbackBusy(false);
    }
  };
  const submitRollback = async () => {
    const reason = rollbackReason.trim();
    const requestScope = captureProcurementScope();
    if (!rollbackSnapshot || !rollbackTarget || rollbackBusyRef.current || rollbackNeedsRefresh || !can("proc-task:rollback")) return;
    if (rollbackSnapshot.id !== currentTaskRef.current.id || rollbackSnapshot.status !== currentTaskRef.current.status || rollbackSnapshot.method !== currentTaskRef.current.method || rollbackSnapshot.source !== currentTaskRef.current.source || rollbackSnapshot.rdTaskId !== currentTaskRef.current.rdTaskId) {
      setRollbackError(t("任务已更新，请刷新后重新选择回退节点"));
      setRollbackNeedsRefresh(true);
      setRollbackTarget(null);
      return;
    }
    if (!rollbackTargets.includes(rollbackTarget) || reason.length < 2 || reason.length > 200) {
      setRollbackError(t("请选择回退节点，并填写 2–200 字的回退原因"));
      return;
    }
    rollbackBusyRef.current = true;
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      const updated = await rollbackProcTask(rollbackSnapshot.id, rollbackTarget, reason, rollbackSnapshot.status);
      applyProcTaskUpdate(updated, requestScope);
      void refreshProcurement();
      toast.success(updated.status === "pending_rd_review"
        ? t("已退回研发，任务已移出采购列表；原研发人员继续转采购后将重新分配采购负责人")
        : t("已回退到「{status}」", { status: t(PROC_STATUS_META[updated.status].label) }));
      setRollbackSnapshot(null);
      setRollbackTarget(null);
      setRollbackReason("");
      if (updated.status === "pending_rd_review") onClose();
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : t("回退失败"));
      setRollbackNeedsRefresh(true);
      setRollbackTarget(null);
    } finally {
      rollbackBusyRef.current = false;
      setRollbackBusy(false);
    }
  };
  // 研发流转的待处理任务走「审核」语义：通过=确认提交，驳回须理由并删除采购任务
  const isRdReview = task.source === "rd" && task.status === "pending_confirm";
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  // 登记错的采购单/出样单要能撤回，否则打样多轮之后列表里全是废关联
  const [unlinking, setUnlinking] = useState<ProcurementTask["purchaseOrders"][number] | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const submitUnlink = async () => {
    if (!unlinking) return;
    setUnlinkBusy(true);
    try {
      await unlinkPurchaseOrder(task.id, unlinking.id);
      await refreshProcurement();
      toast.success(t("已撤销该采购单关联"));
      setUnlinking(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("撤销失败"));
    } finally {
      setUnlinkBusy(false);
    }
  };
  const submitReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) { toast.error(t("请填写驳回理由")); return; }
    setRejectBusy(true);
    try {
      await rejectProcTask(task.id, reason);
      await refreshProcurement();
      toast.success(t("已驳回并删除采购任务，已通知研发对接人与超级管理员"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("驳回失败"));
    } finally {
      setRejectBusy(false);
    }
  };
  // 当前任务报价与跨任务历史价分开读取，避免把历史报价误显示成当前候选。
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [historyQuotes, setHistoryQuotes] = useState<Quotation[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quoteLoadVersion, setQuoteLoadVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setQuotesLoading(true);
    setQuotesError(null);
    void Promise.all([
      listQuotations({ taskId: task.id }),
      listQuotations({ materialId: task.materialId ?? undefined, materialName: task.materialId ? undefined : task.materialName }),
    ])
      .then(([taskQuotes, materialQuotes]) => {
        if (!alive) return;
        setQuotes(taskQuotes);
        setHistoryQuotes(materialQuotes);
      })
      .catch((cause) => {
        if (!alive) return;
        setQuotes([]);
        setHistoryQuotes([]);
        setQuotesError(cause instanceof Error ? cause.message : t("供应商报价加载失败"));
      })
      .finally(() => {
        if (alive) setQuotesLoading(false);
      });
    return () => { alive = false; };
  }, [quoteLoadVersion, task.id, task.materialId, task.materialName, task.updatedAt, t]);
  const histLow = historyQuotes.length ? historyQuotes.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const selectedQuotes = quotes.filter((q) => q.isSelected);
  // 报价金额是「确认那一刻」的快照，不随后来改动的下单数量重算（例如出样 1 件确认、批量 500 件下单）。
  // 两个数字并排显示很容易被读成总价，这里点破口径。
  const quotedQuantity = selectedQuotes.reduce((sum, q) => sum + (q.quantity ?? 0), 0);
  const quoteQuantityMismatch = quotedQuantity > 0 && quotedQuantity !== task.quantity;
  const pct = task.quantity > 0
    ? Math.min(100, Math.max(0, Math.round((task.arrivedQty / task.quantity) * 100)))
    : 0;
  // 是否已进入下单阶段（此前「下单与付款」「到货记录」还没有内容，不展示）
  const orderStage = ["pending_purchase", "priced", "in_transit", "partial_arrival", "completed"].includes(task.status);
  const canCheckSampleStatus = task.method === "inquiry"
    && (FREE_SAMPLE_ONLY_STATUSES.includes(task.status) || (task.status === "testing" && task.sampleStatusNeedsReview === true))
    && task.purchaseOrders.some((order) => order.freeSample)
    && !task.purchaseOrders.some((order) => !order.freeSample)
    && task.arrivedQty === 0
    && can("proc-task:inquiry");
  const materialSummary = [task.materialName, task.spec, `${task.quantity}${task.unit}`].filter(Boolean).join(" · ");

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !rollbackBusyRef.current) onClose(); }}>
      <SheetContent
        side="right"
        className="horizon-theme horizon-portal proc-horizon-drawer w-full max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-[720px]"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected && openerRef.current !== document.body) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}
      >
        {/* 头部（pr-8 给自带关闭 X 留位） */}
        <SheetHeader className="block border-b border-slate-100 px-6 py-4">
          <div ref={drawerHeaderRef} tabIndex={-1} className="flex flex-wrap items-start justify-between gap-2 pr-8 sm:flex-nowrap">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
              <SheetTitle className="min-w-0 break-words text-balance text-lg font-bold tabular-nums text-slate-900">{task.code}</SheetTitle>
              <StatusPill status={task.status} />
              <BusinessLinePill line={task.businessLine} />
              <SourcePill source={task.source} />
              <MethodPill method={task.method} />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {/* 归类是整理动作，终态任务也允许移动——历史任务同样需要能归到正确的子系统下 */}
              {(can("proc-task:create") || can("proc-task:reassign")) && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMoveOpen(true)} title={t('移动到其他类目')} className="h-7 rounded-lg px-2.5 text-xs text-slate-600"><FolderTree className="h-3.5 w-3.5" />{t('移动归类')}</Button>
              )}
              {canRollback && (
                <Button ref={rollbackTriggerRef} type="button" variant="outline" size="sm" disabled={rollbackBusy || taskAction.busy} onClick={openRollback} title={t('回退到更早的流程节点')} className="h-7 rounded-lg border-amber-200 px-2.5 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"><Undo2 className="h-3.5 w-3.5" />{t('回退')}</Button>
              )}
              {/* 终态任务只读；状态流转走「下一步」操作卡，这里只改任务信息 */}
              {!["completed", "cancelled"].includes(task.status) && can("proc-task:create") && (
                <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)} title={t('编辑任务信息')} className="h-7 rounded-lg px-2.5 text-xs text-slate-600"><Pencil className="h-3.5 w-3.5" />{t('编辑')}</Button>
              )}
            </div>
          </div>
          <div className="mt-1 text-pretty text-sm tabular-nums text-slate-500" title={materialSummary}>
            <AutoTranslatedText as="div" className="line-clamp-2 break-words" text={materialSummary} />
          </div>
          {/* 步骤条 */}
          <div className="mt-4 flex items-center overflow-x-auto pb-1">
            {flow.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums", i < curIdx ? "bg-emerald-500 text-white" : i === curIdx ? "bg-primary text-white" : "bg-slate-100 text-slate-400")}>{i + 1}</span>
                  <span className={cn("whitespace-nowrap text-[10px]", i === curIdx ? "font-semibold text-primary" : "text-slate-400")}>{t(PROC_STATUS_META[s].label)}</span>
                </div>
                {i < flow.length - 1 && <div className={cn("mx-1 h-0.5 w-5", i < curIdx ? "bg-emerald-400" : "bg-slate-200")} />}
              </div>
            ))}
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-6 py-4">
          {canCheckSampleStatus && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-pretty text-sm font-medium text-amber-800">{t("已有免费样品登记，请核实当前到样状态")}</p>
              <p className="mt-1 text-pretty text-xs leading-5 text-amber-700">{t("历史登记可能仍停在询价阶段，或曾跳过待到样。请核实记录属于本轮且样品尚未收到，再修正状态；已经收到的样品无需修正。")}</p>
              <Button type="button" variant="outline" disabled={taskAction.busy} onClick={() => taskAction.repairSampleStatus(task)} className="mt-3 rounded-lg border-amber-200 bg-white text-sm text-amber-800">
                {t("样品未到，修正为待到样")}
              </Button>
            </div>
          )}
          {/* 下一步操作卡：动作码由系统管理配置到角色，无权限者只读。
              研发流转的待处理任务是「审核」语义：通过（确认提交）或驳回（理由必填，删除采购任务并通知）。 */}
          {meta.next && can(nextPermissionOf(task)) && (
            <div className="proc-horizon-next-step rounded-xl border border-[var(--primary-soft-border)] bg-accent p-4">
              <div className="text-xs font-semibold text-primary">{t('下一步 · 责任人：')}{task.status === "testing" ? task.sampleTest?.testerName || t("待指定研发测试人员") : buyerLabel}</div>
              <p className="mt-1 text-pretty text-sm text-slate-700">
                {isRdReview
                  ? t('研发流转需求待审核：通过后进入询价流程；驳回将删除采购任务，并通知研发对接人与超级管理员。')
                  : task.status === "testing"
                    ? awaitingTest
                      ? t("已通知 {name} 进行测试，等待本人确认结论后回传供应链。", { name: task.sampleTest!.testerName })
                      : t("请指定研发测试人员，系统会发送测试待办。")
                    : t('当前状态「{status}」，下一步：{next}。', { status: t(meta.label), next: t(meta.next) })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" disabled={taskAction.busy || rejectBusy} onClick={() => taskAction.runNext(task)} className="material-button-primary rounded-lg px-4 py-2 text-sm disabled:opacity-60">
                  {t(isRdReview ? '审核通过' : awaitingTest ? '调整测试人员' : meta.next)}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-4 w-4" />}
                </Button>
                {/* 询价阶段登记免费样品后进入待到样；已有待到样任务可继续登记本轮出样信息。 */}
                {(task.status === "pending_sample" || FREE_SAMPLE_ONLY_STATUSES.includes(task.status)) && can("proc-task:order") && (
                  <Button type="button" variant="outline" disabled={taskAction.busy} onClick={() => taskAction.linkSampleOrder(task)} className="rounded-lg border-[var(--primary-soft-border)] bg-white px-4 py-2 text-sm text-primary hover:bg-accent hover:text-primary-hover">
                    {t(task.status === "pending_sample" ? '登记出样单' : '登记免费样品来货')}
                  </Button>
                )}
                {isRdReview && (
                  <AlertDialog open={rejecting} onOpenChange={setRejecting}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" disabled={taskAction.busy || rejectBusy} className="rounded-lg border-rose-200 bg-white px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                        {t('驳回')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="horizon-theme horizon-portal proc-horizon-overlay rounded-2xl border-rose-100 sm:max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-balance text-slate-900">{t('驳回并删除采购任务')}</AlertDialogTitle>
                        <AlertDialogDescription className="text-pretty leading-relaxed">
                          {t('驳回后，该任务会立即从采购驾驶舱移除，并通知研发对接人与超级管理员。研发任务仍可修改后再次转采购。')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div>
                        <label htmlFor="proc-task-reject-reason" className="mb-1.5 block text-sm font-medium text-slate-700">{t('驳回理由（必填）')}</label>
                        <Textarea
                          id="proc-task-reject-reason"
                          autoFocus
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder={t('请说明需要研发调整的内容')}
                          className="min-h-24 resize-none rounded-xl border-rose-200 focus-visible:ring-rose-200"
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={rejectBusy} className="rounded-lg">{t('取消')}</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={rejectBusy || !rejectReason.trim()}
                          onClick={(event) => { event.preventDefault(); void submitReject(); }}
                          className="rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                        >
                          {rejectBusy ? t('提交中…') : t('确认驳回并删除')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          )}

          {/* 基本信息 */}
          <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-balance text-sm font-semibold text-slate-700">{t('基本信息')}</div>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              <div>
                <Info label="物料 / 规格" value={<AutoTranslatedText text={[task.materialName, task.spec].filter(Boolean).join(" · ")} />} />
                <Info label="数量" value={<span className="tabular-nums">{task.quantity.toLocaleString()} {t(task.unit)}</span>} />
                <Info label="需求日期" value={<span className="tabular-nums">{task.needDate}</span>} />
                {task.deadline && <Info label="Deadline" value={<span className="tabular-nums">{task.deadline}</span>} />}
              </div>
              <div>
                <Info label="需求提出人" value={
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={requester.name} size="xs" />
                    <span className="font-medium">{requester.name}</span>
                    <span className="text-xs text-slate-400">{t(requester.dept)}</span>
                  </span>
                } />
                <Info label="采购负责人" value={
                  <span className="inline-flex items-center gap-1.5">
                    <PersonAvatar name={buyerLabel} size="xs" />
                    <span className="font-medium">{buyerLabel}</span>
                    {task.buyer && deptOf(task.buyer) ? (
                      <span className="text-xs text-slate-400">{t(deptOf(task.buyer) ?? '')}</span>
                    ) : null}
                  </span>
                } />
                {task.rdContact && <Info label="研发对接人" value={task.rdContact} />}
                {task.source === "rd" && task.rdTaskTitle && <Info label="关联研发任务" value={<span><AutoTranslatedText className="text-primary" text={task.rdTaskTitle} />{task.rdTaskId && <span className="ml-1 text-[11px] tabular-nums text-slate-400">{task.rdTaskId}</span>}</span>} />}
                {task.method === "direct" && task.purchaseLink && <Info label="商品链接" value={<a href={task.purchaseLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('打开链接')} <ExternalLink className="size-3.5" /></a>} />}
              </div>
            </div>
            {task.consumableNote && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{t('低值易耗品：')}<AutoTranslatedText text={task.consumableNote} /></div>}
          </div>

          <TaskCriticalMaterials task={task} materials={materials} />

          {(task.source === "rd" || Boolean(task.rdTransferSnapshots?.length)) && (
            <RdDeliverySnapshotPanel task={task} className="proc-horizon-drawer-section" />
          )}

          {/* 样品测试区：仅展示已产生的数据 */}
          {showSample && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-balance text-sm font-semibold text-slate-700">{t('样品与测试')}</h3>
                {can("page:proc-cockpit") && <Button type="button" variant="outline" disabled={taskAction.busy || rollbackBusy || resetBusy || rejectBusy} onClick={() => { onClose(); (onNavigateRelated ?? navigate)(`${routePath("page:proc-cockpit", "/proc-cockpit")}?tab=samples&sample=${encodeURIComponent(task.id)}`); }} className="min-h-10 gap-1.5 rounded-lg border-[var(--primary-soft-border)] text-xs font-semibold text-primary hover:bg-accent">
                  {t('打开样品协同')}<ExternalLink className="size-3.5" aria-hidden="true" />
                </Button>}
              </div>
              {selectedQuotes.length > 0 && (
                <Info
                  label="已确认报价"
                  value={(
                    <span className="space-y-1">
                      {selectedQuotes.map((quote) => (
                        <span key={quote.id} className="block">
                          {quote.materialName} · {quote.supplierName} · {quote.quantity != null ? `${quote.quantity.toLocaleString()} ${t(task.unit)} · ` : ""}{quote.currency === "CNY" ? fmtMoney(quote.lineTotal ?? quote.unitPrice) : `${quote.currency} ${quote.lineTotal ?? quote.unitPrice}`} · {t("交期 {count} 天", { count: quote.leadTimeDays })}
                        </span>
                      ))}
                    </span>
                  )}
                />
              )}
              <Info label="到样状态" value={t(sampleFacts.label)} />
              <p className="mb-3 mt-1 text-pretty text-xs leading-5 text-slate-500">{t(sampleFacts.description)}</p>
              <Info label="测试人员" value={task.sampleTest?.testerName || t("尚未指定")} />
              <Info label={task.sampleTest?.result && sampleFacts.state !== "confirmed" ? "上次测试结论" : "测试结论"} value={task.sampleTest?.result ? t(SAMPLE_TEST_RESULT_LABELS[task.sampleTest.result]) : t(task.status === "testing" ? "等待研发确认" : "尚无研发确认记录")} />
              {task.sampleTest?.note && <Info label="结论说明" value={<span className="whitespace-pre-wrap">{task.sampleTest.note}</span>} />}
              {task.sampleTest?.confirmedByName && <Info label="确认人" value={task.sampleTest.confirmedByName} />}
              {task.sampleTest?.confirmedAt && <Info label="确认时间" value={new Date(task.sampleTest.confirmedAt).toLocaleString()} />}
            </div>
          )}

          {/* 研发转采购时携带的图纸/说明：随采购任务展示，读取地址由后端按 OSS key 动态重签。 */}
          {task.attachmentList.length > 0 && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-balance text-sm font-semibold text-slate-700">{t("需求附件（{count}）", { count: task.attachmentList.length })}</div>
              <ul className="space-y-2">
                {task.attachmentList.map((attachment) => {
                  const className = "flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:border-[var(--primary-soft-border)] hover:bg-accent hover:text-primary";
                  return (
                    <li key={attachment.id}>
                      <button
                        type="button"
                        className={cn(className, "w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40")}
                        aria-label={t("预览附件：{name}", { name: attachment.fileName })}
                        onClick={() => setPreviewAttachment(procurementAttachmentPreview(task.id, attachment))}
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                        {attachment.fileSize > 0 && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{attachment.fileSize >= 1024 * 1024 ? `${(attachment.fileSize / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(attachment.fileSize / 1024)} KB`}</span>}
                        <Eye className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 报价区（询价）：加载、失败和空态都给出明确下一步。 */}
          {task.method === "inquiry" && quotesLoading ? (
            <div aria-label={t("正在加载供应商报价")} className="proc-horizon-drawer-section space-y-2 rounded-xl border border-slate-100 p-4">
              <div className="h-4 w-32 rounded bg-slate-100" />
              <div className="h-12 rounded-lg bg-slate-50" />
              <div className="h-12 rounded-lg bg-slate-50" />
            </div>
          ) : task.method === "inquiry" && quotesError ? (
            <div role="alert" className="proc-horizon-drawer-section flex flex-col items-start rounded-xl border border-rose-200 bg-rose-50 p-4">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-700"><AlertTriangle className="size-4" />{t("供应商报价加载失败")}</span>
              <p className="mt-1 text-pretty text-xs text-rose-600">{quotesError}</p>
              <button type="button" onClick={() => setQuoteLoadVersion((version) => version + 1)} className="material-button-secondary mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"><RefreshCw className="size-3.5" />{t("重新加载报价")}</button>
            </div>
          ) : task.method === "inquiry" && quotes.length === 0 ? (
            <div className="proc-horizon-drawer-section rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-semibold text-slate-600">{t("暂无供应商报价")}</p>
              <p className="mt-1 text-pretty text-xs text-slate-500">{t("请通过上方下一步操作维护报价；完成后会在这里展示价格、交期与确认状态。")}</p>
            </div>
          ) : null}
          {task.method === "inquiry" && !quotesLoading && !quotesError && quotes.length > 0 && (
            <div className="space-y-3">
              {histLow && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--primary-soft-border)] bg-accent px-4 py-2.5 text-xs text-slate-600">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                      <History className="size-4 shrink-0 text-primary" />
                      <span>{t('该物料历史最低')}</span>
                      <b className="shrink-0 whitespace-nowrap text-emerald-600">{fmtMoney(histLow.unitPrice)}</b>
                    </div>
                    <p className="mt-1 break-words text-pretty tabular-nums" title={`${histLow.supplierName} · ${histLow.quoteDate}`}>{histLow.supplierName} · {histLow.quoteDate}</p>
                  </div>
                  <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('历史价格')}</button>
                </div>
              )}
              <div className="proc-horizon-drawer-section rounded-xl border border-slate-100">
                <div ref={quoteSectionRef} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                  <span className="text-sm font-semibold tabular-nums text-slate-700">{t('供应商报价（{count}）', { count: quotes.length })}</span>
                  {/* 维护错价格此前只能作废整条任务重建，这里提供重做入口；已下单之后不再允许改 */}
                  {canResetQuotes && (
                    <button
                      ref={resetQuoteTriggerRef}
                      type="button"
                      onClick={() => setResetting(true)}
                      className="shrink-0 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {t('重新维护')}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {quotes.map((q) => (
                    <li key={q.id} className={cn("px-4 py-2.5", q.isSelected && "bg-emerald-50/40")}>
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="min-w-0 basis-full break-words text-pretty text-sm font-medium text-slate-700" title={q.supplierName}>{q.supplierName}</span>
                          <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">{q.currency === "CNY" ? fmtMoney(q.unitPrice) : `${q.currency} ${q.unitPrice}`}</span>
                          {q.channel === "quote-book" && <span className="shrink-0 whitespace-nowrap rounded-full border border-[var(--primary-soft-border)] bg-accent px-2 py-0.5 text-[11px] text-primary">{t('报价库')}</span>}
                          {q.isSelected && <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">{t('已确认')}</span>}
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-400">{t('交期 {count} 天', { count: q.leadTimeDays })}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-400">
                        {q.quantity != null && <span>{t('采购数量')} {q.quantity.toLocaleString()} {t(task.unit)}</span>}
                        {q.lineTotal != null && <span className="font-medium text-slate-600">{t('行金额')} {q.currency === "CNY" ? fmtMoney(q.lineTotal) : `${q.currency} ${q.lineTotal}`}</span>}
                        {q.minOrderQty != null && <span>{t('起订量')} {q.minOrderQty.toLocaleString()}</span>}
                        {q.validUntil && <span>{t('有效期至 {date}', { date: q.validUntil })}</span>}
                        {q.note && <span className="min-w-0 basis-full break-words text-pretty" title={q.note}>{q.note}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {task.quotationTotal != null && (
                  <div className="space-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs tabular-nums text-slate-600">
                    <div className="flex justify-between">
                      <span>{t('报价小计')}</span>
                      <b>{task.quotationCurrency === "CNY" ? fmtMoney(task.quotationSubtotal ?? 0) : `${task.quotationCurrency ?? ""} ${task.quotationSubtotal ?? 0}`}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('减：折扣金额')}</span>
                      <b>- {task.quotationCurrency === "CNY" ? fmtMoney(task.quotationDiscount ?? 0) : `${task.quotationCurrency ?? ""} ${task.quotationDiscount ?? 0}`}</b>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm text-primary">
                      <b>{t('最终总价')}</b>
                      <b>{task.quotationCurrency === "CNY" ? fmtMoney(task.quotationTotal) : `${task.quotationCurrency ?? ""} ${task.quotationTotal}`}</b>
                    </div>
                    {quoteQuantityMismatch && (
                      <p className="border-t border-slate-200 pt-1.5 text-pretty text-[11px] leading-relaxed text-amber-600">
                        {t('报价按 {quoted} {unit} 确认，本任务当前采购数量为 {actual} {unit}；金额不随数量重算，实际以畅捷通 T+ 采购单为准。', {
                          quoted: quotedQuantity.toLocaleString(),
                          actual: task.quantity.toLocaleString(),
                          unit: t(task.unit),
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 下单与付款 / 到货记录：仅在任务进入下单阶段后展示，前期阶段无内容不占位 */}
          {orderStage && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-balance text-sm font-semibold text-slate-700">{t('下单与付款')}</div>
              <Info label="付款状态" value={task.paymentStatus === "paid" ? t("已付款") : task.paymentStatus === "partial" ? <>{t('部分付款{note}', { note: '' })}{task.paymentNote ? <> (<AutoTranslatedText text={task.paymentNote} />)</> : null}</> : t("未付款")} />
              {task.paymentDate && <Info label="付款日期" value={task.paymentDate} />}
              {task.expectedArrivalDate && <Info label="预计到货" value={task.expectedArrivalDate} />}
            </div>
          )}

          {/* 采购单关联：出样单（含免费来样）在「待到样」就登记，所以不跟 orderStage 走，有就显示 */}
          {task.purchaseOrders.length > 0 && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100">
              <div ref={purchaseOrdersSectionRef} tabIndex={-1} className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                <span className="tabular-nums">{t('采购单关联（{count}）', { count: task.purchaseOrders.length })}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {task.purchaseOrders.map((po) => (
                  <li key={po.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {po.freeSample ? (
                          <span className="rounded-full border border-[var(--primary-soft-border)] bg-accent px-2 py-0.5 text-[11px] text-primary">{t('免费样品')}</span>
                        ) : (
                          <b className="text-sm font-medium tabular-nums text-slate-800">{po.tpOrderNo}</b>
                        )}
                        <AutoTranslatedText className="truncate text-sm text-slate-600" text={po.supplierName || t('未指定供应商')} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-400">
                        <span>{t('采购数量')} {po.orderedQty.toLocaleString()} {t(task.unit)}</span>
                        <span>{t('已到')} {po.receivedQty.toLocaleString()}</span>
                        {po.etaDate && <span>{t(po.freeSample ? '预计到样' : '预计到货')} {po.etaDate}</span>}
                        {po.orderDate && <span>{t('下单')} {po.orderDate}</span>}
                      </div>
                    </div>
                    {can("proc-task:order") && (
                      <button
                        type="button"
                        onClick={(event) => { unlinkOrderTriggerRef.current = event.currentTarget; setUnlinking(po); }}
                        title={t('撤销该关联')}
                        aria-label={t('撤销采购单关联')}
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(orderStage || task.arrivedQty > 0) && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-balance text-sm font-semibold text-slate-700">{t('到货记录')}</div>
              <div role="progressbar" aria-label={t('到货进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} /></div>
              <div className="text-xs tabular-nums text-slate-500">{t('已到货')} <b>{task.arrivedQty.toLocaleString()}</b> / {task.quantity.toLocaleString()}{t(task.unit)} ({pct}%)</div>
            </div>
          )}

          {/* 操作日志 */}
          <Collapsible ref={logsSectionRef} open={logsOpen} onOpenChange={setLogsOpen} className="proc-horizon-drawer-section scroll-mt-4 rounded-xl border border-slate-100">
            <CollapsibleTrigger ref={logsTriggerRef} className="flex w-full items-center justify-between px-4 py-2.5 text-balance text-sm font-semibold tabular-nums text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">{t('操作日志（{count}）', { count: task.logs.length })}<ChevronDown className={cn("size-4 text-slate-400", logsOpen && "rotate-180")} /></CollapsibleTrigger>
            <CollapsibleContent>
              {task.logs.length > 0 ? (
                <ul className="space-y-2 border-t border-slate-100 px-4 py-3">
                  {task.logs.map((log, index) => (
                    <li key={log.id ?? `${log.at}-${index}`} className="min-w-0 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="break-words text-xs font-semibold text-slate-700">{log.actor?.trim() || t("操作人未记录")}</span>
                        <time dateTime={log.createdAt || undefined} className="text-xs tabular-nums text-slate-400">{formatProcLogTime(log) || t("时间未记录")}</time>
                      </div>
                      {(log.fromStatus || log.toStatus) ? <div className="text-xs text-slate-500">
                        {log.fromStatus ? t(PROC_STATUS_META[log.fromStatus]?.label ?? log.fromStatus) : t("未记录")}
                        <span aria-label={t("变更为")} className="px-1.5">→</span>
                        {log.toStatus ? t(PROC_STATUS_META[log.toStatus]?.label ?? log.toStatus) : t("未记录")}
                      </div> : null}
                      <AutoTranslatedText as="p" className="min-w-0 break-words text-pretty text-xs leading-5 text-slate-600" text={log.text} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-slate-100 px-4 py-4 text-pretty text-xs text-slate-500">{t("暂无操作记录；任务流转后会在这里留下时间和操作说明。")}</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
        </ScrollArea>
        <PriceHistoryModal materialId={task.materialId} materialName={task.materialName} open={historyOpen} onClose={() => setHistoryOpen(false)} />
        {taskAction.modal}
        {moveOpen && (
        <MoveTaskDialog
          taskIds={[task.id]}
          productId={task.productId}
          currentNodeId={task.treeNodeId ?? null}
          onClose={() => setMoveOpen(false)}
          onMoved={() => { void refreshProcurement(); }}
        />
      )}
      <AlertDialog open={Boolean(unlinking)} onOpenChange={(o) => { if (!o && !unlinkBusy) setUnlinking(null); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => restoreConfirmationFocus(event, unlinkOrderTriggerRef.current, purchaseOrdersSectionRef.current, drawerHeaderRef.current)} className="horizon-theme horizon-portal proc-horizon-overlay rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{t('撤销采购单关联？')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-relaxed">
              {unlinking?.freeSample
                ? t('将移除这条免费样品登记（{supplier}），任务状态和已登记的到货数量不受影响。', { supplier: unlinking?.supplierName || t('未指定供应商') })
                : t('将移除采购单 {no} 的关联，T+ 里的单据不受影响；该单已同步的到货量会一并从本任务移除。', { no: unlinking?.tpOrderNo ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinkBusy} className="rounded-lg">{t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlinkBusy}
              onClick={(event) => { event.preventDefault(); void submitUnlink(); }}
              className="rounded-lg bg-rose-600 hover:bg-rose-700"
            >
              {unlinkBusy ? t('处理中…') : t('撤销关联')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetting} onOpenChange={(o) => { if (!o && !resetBusy) { setResetting(false); setResetReason(""); } }}>
        <AlertDialogContent onCloseAutoFocus={(event) => restoreConfirmationFocus(event, resetQuoteTriggerRef.current, quoteSectionRef.current, drawerHeaderRef.current)} className="horizon-theme horizon-portal proc-horizon-overlay rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{t('重新维护报价？')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-relaxed tabular-nums">
              {t('将清空本任务已确认的 {count} 条报价与总价，并把任务退回「待询价」，之后可重新从报价库选择。物料主数据上的最新参考价不会回滚，会在下次确认报价时更新。', { count: quotes.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label htmlFor="proc-task-reset-quote-reason" className="mb-1.5 block text-sm font-medium text-slate-700">{t("重新维护原因（选填）")}</label>
            <Textarea
              id="proc-task-reset-quote-reason"
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
              placeholder={t('会记入操作留痕，便于后续追溯')}
              className="min-h-[72px] rounded-lg text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetBusy} className="rounded-lg">{t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetBusy}
              onClick={(event) => { event.preventDefault(); void submitResetQuotes(); }}
              className="rounded-lg bg-amber-600 hover:bg-amber-700"
            >
              {resetBusy ? t('处理中…') : t('清空并重新维护')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(rollbackSnapshot)} onOpenChange={(open) => { if (!open) closeRollback(); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => restoreConfirmationFocus(event, rollbackTriggerRef.current, null, drawerHeaderRef.current)} className="horizon-theme horizon-portal proc-horizon-overlay max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle ref={rollbackTitleRef} tabIndex={-1} className="text-balance text-slate-900">{t('回退任务到更早的节点')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-relaxed">
              {t('任务 {code}，当前状态「{status}」。请选择同一流程中更早的节点。', { code: rollbackSnapshot?.code ?? task.code, status: t(PROC_STATUS_META[rollbackSnapshot?.status ?? task.status].label) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(rollbackError || rollbackStale || rollbackNeedsRefresh) && (
            <div role="alert" className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {rollbackError && <p>{rollbackError}</p>}
              <p>{rollbackSnapshot?.id !== task.id ? t('当前任务已切换，请关闭后重新打开回退') : t('请先刷新最新任务，再重新选择节点。不会自动重试回退。')}</p>
              {rollbackSnapshot?.id === task.id && <Button type="button" variant="outline" size="sm" disabled={rollbackBusy} onClick={() => void reloadRollbackTask()} className="rounded-lg bg-white text-slate-700"><RefreshCw className="size-3.5" />{rollbackBusy ? t('刷新中…') : t('刷新任务后重新选择')}</Button>}
            </div>
          )}
          <fieldset disabled={rollbackBusy || rollbackStale || rollbackNeedsRefresh || !can("proc-task:rollback")} className="min-w-0 space-y-3 disabled:opacity-60">
            <legend className="mb-2 text-sm font-medium text-slate-700">{t('回退到')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {rollbackTargets.map((target, index) => (
                <button ref={index === 0 ? rollbackFirstTargetRef : undefined} key={target} type="button" aria-pressed={rollbackTarget === target} onClick={() => setRollbackTarget(target)} className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50", rollbackTarget === target ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:bg-amber-50")}>
                  {t(PROC_STATUS_META[target].label)}
                </button>
              ))}
            </div>
            {rollbackTargets.length === 0 && <p className="text-sm text-slate-500">{t('当前状态没有可回退的节点')}</p>}
            {rollbackTarget && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                {rollbackHints.length > 0 ? <>
                  <p className="font-semibold">{t('回退到「{status}」将清除以下数据，且不可恢复：', { status: t(PROC_STATUS_META[rollbackTarget].label) })}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">{rollbackHints.map((hint) => <li key={hint}>{t(hint)}</li>)}</ul>
                  <p className="mt-1.5">{t('免费样品来货登记、T+ 原始单据和物料主数据上的最新参考价会保留。')}</p>
                  {rollbackTarget === "pending_rd_review" && <p className="mt-1.5 font-medium">{t('任务将离开采购列表并退回研发；原研发人员可直接继续转采购，系统会重新分配采购负责人。')}</p>}
                </> : <p>{t('报价、采购单关联与到货记录保持不变。')}</p>}
              </div>
            )}
            <div>
              <label htmlFor="proc-task-rollback-reason" className="mb-1.5 block text-sm font-medium text-slate-700">{t('回退原因（必填，2–200 字）')}</label>
              <Textarea id="proc-task-rollback-reason" value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} placeholder={t('请说明回退原因，会记入操作留痕')} aria-describedby="proc-task-rollback-reason-count" className="min-h-[72px] rounded-lg text-sm" />
              <p id="proc-task-rollback-reason-count" className={cn("mt-1 text-right text-xs tabular-nums", rollbackReason.trim().length > 200 ? "text-rose-600" : "text-slate-400")}>{rollbackReason.trim().length}/200</p>
            </div>
          </fieldset>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackBusy} className="rounded-lg">{t('取消')}</AlertDialogCancel>
            <AlertDialogAction disabled={rollbackBusy || rollbackStale || rollbackNeedsRefresh || !can("proc-task:rollback") || !rollbackTarget || rollbackReason.trim().length < 2 || rollbackReason.trim().length > 200} onClick={(event) => { event.preventDefault(); void submitRollback(); }} className="rounded-lg bg-amber-600 text-white hover:bg-amber-700">
              {rollbackBusy ? t('处理中…') : t('确认回退')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editOpen && <EditTaskModal task={task} onClose={() => setEditOpen(false)} />}
      {previewAttachment ? (
        <AttachmentPreviewDialog attachment={previewAttachment} attachments={task.attachmentList.map((attachment) => procurementAttachmentPreview(task.id, attachment))} onClose={() => setPreviewAttachment(null)} />
      ) : null}
      </SheetContent>
    </Sheet>
  );
}
