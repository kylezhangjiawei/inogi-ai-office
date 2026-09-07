// 采购任务详情抽屉：步骤条(询价长/直购短) + 下一步操作卡 + 基本信息 + 报价 + 样品测试 + 下单付款 + 到货 + 日志。
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Eye, ExternalLink, FolderTree, History, Paperclip, Pencil, RefreshCw, Trash2 } from "lucide-react";
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
import { BusinessLinePill, DIRECT_FLOW, FREE_SAMPLE_ONLY_STATUSES, INQUIRY_FLOW, MethodPill, PROC_STATUS_META, PersonAvatar, QUOTE_RESETTABLE_STATUSES, SourcePill, StatusPill, fmtMoney, useBuyerDirectory, useProcCan } from "./common";
import { nextPermissionOf, useProcTaskAction } from "./taskActions";
import { EditTaskModal } from "./modals";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { MoveTaskDialog } from "./MoveTaskDialog";
import { applyProcTaskUpdate, refreshProcurement, taskRequester, useProcurementData, type ProcurementTask } from "../data";
import { listQuotations, rejectProcTask, resetProcTaskQuotations, unlinkPurchaseOrder, type Quotation } from "../../lib/procurementApi";
import { toast } from "sonner";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { TaskCriticalMaterials } from "./TaskCriticalMaterials";

function previewModel(attachment: ProcurementTask["attachmentList"][number]): PreviewableAttachment {
  return {
    id: attachment.id,
    name: attachment.fileName,
    mime: attachment.mimeType,
    size: attachment.fileSize,
    url: attachment.fileUrl,
  };
}

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

export function TaskDetailDrawer({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const { t } = useI18n();
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
  const unlinkOrderTriggerRef = useRef<HTMLButtonElement | null>(null);
  const can = useProcCan();
  const { deptOf } = useBuyerDirectory();
  const taskAction = useProcTaskAction();
  const requester = taskRequester(task);
  const buyerLabel = task.buyer?.trim() || t("未指派");
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
    setResetBusy(true);
    try {
      const updated = await resetProcTaskQuotations(task.id, resetReason.trim() || undefined);
      applyProcTaskUpdate(updated);
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
  const materialSummary = [task.materialName, task.spec, `${task.quantity}${task.unit}`].filter(Boolean).join(" · ");

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
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
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <SheetTitle className="min-w-0 break-words text-balance text-lg font-bold tabular-nums text-slate-900">{task.code}</SheetTitle>
              <StatusPill status={task.status} />
              <BusinessLinePill line={task.businessLine} />
              <SourcePill source={task.source} />
              <MethodPill method={task.method} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* 归类是整理动作，终态任务也允许移动——历史任务同样需要能归到正确的子系统下 */}
              {(can("proc-task:create") || can("proc-task:reassign")) && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMoveOpen(true)} title={t('移动到其他类目')} className="h-7 rounded-lg px-2.5 text-xs text-slate-600"><FolderTree className="h-3.5 w-3.5" />{t('移动归类')}</Button>
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
          {/* 下一步操作卡：动作码由系统管理配置到角色，无权限者只读。
              研发流转的待处理任务是「审核」语义：通过（确认提交）或驳回（理由必填，删除采购任务并通知）。 */}
          {meta.next && can(nextPermissionOf(task)) && (
            <div className="proc-horizon-next-step rounded-xl border border-[var(--primary-soft-border)] bg-accent p-4">
              <div className="text-xs font-semibold text-primary">{t('下一步 · 责任人：')}{task.status === "testing" ? task.rdContact ?? t("研发对接人") : buyerLabel}</div>
              <p className="mt-1 text-pretty text-sm text-slate-700">
                {isRdReview
                  ? t('研发流转需求待审核：通过后进入询价流程；驳回将删除采购任务，并通知研发对接人与超级管理员。')
                  : t('当前状态「{status}」，下一步：{next}。', { status: t(meta.label), next: t(meta.next) })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" disabled={taskAction.busy || rejectBusy} onClick={() => taskAction.runNext(task)} className="material-button-primary rounded-lg px-4 py-2 text-sm disabled:opacity-60">
                  {t(isRdReview ? '审核通过' : meta.next)}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-4 w-4" />}
                </Button>
                {/* 出样单 / 免费样品来货都不是状态流转，只登记关联，任务原地不动：
                    「待到样」是本轮打样的出样单；「待询价 / 询价中」是供应商提前寄的免费样，
                    后者登记后选定报价可直接进「测试中」，省掉一轮空等的「待到样」。 */}
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
                        onClick={() => setPreviewAttachment(previewModel(attachment))}
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

          {/* 样品测试区：仅展示已产生的数据 */}
          {task.needSample && (
            <div className="proc-horizon-drawer-section rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-balance text-sm font-semibold text-slate-700">{t('样品与测试')}</div>
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
              <Info label="到样时间" value={t(["pending_sample"].includes(task.status) ? "待到样" : "已到样")} />
              {(task.status === "testing" || ["priced", "in_transit", "partial_arrival", "completed"].includes(task.status)) && (
                <Info label="测试结论" value={t(task.status === "testing" ? "测试中" : "测试通过")} />
              )}
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
          <Collapsible open={logsOpen} onOpenChange={setLogsOpen} className="proc-horizon-drawer-section rounded-xl border border-slate-100">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-balance text-sm font-semibold tabular-nums text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">{t('操作日志（{count}）', { count: task.logs.length })}<ChevronDown className={cn("size-4 text-slate-400", logsOpen && "rotate-180")} /></CollapsibleTrigger>
            <CollapsibleContent>
              {task.logs.length > 0 ? (
                <ul className="space-y-2 border-t border-slate-100 px-4 py-3">
                  {task.logs.map((log, index) => (
                    <li key={index} className="flex gap-3 text-sm">
                      <span className="w-24 shrink-0 text-xs tabular-nums text-slate-400">{log.at}</span>
                      <AutoTranslatedText className="min-w-0 break-words text-pretty text-slate-600" text={log.text} />
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
        <PriceHistoryModal materialName={task.materialName} open={historyOpen} onClose={() => setHistoryOpen(false)} />
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
      {editOpen && <EditTaskModal task={task} onClose={() => setEditOpen(false)} />}
      {previewAttachment ? (
        <AttachmentPreviewDialog attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      ) : null}
      </SheetContent>
    </Sheet>
  );
}
