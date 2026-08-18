// 采购任务详情抽屉：步骤条(询价长/直购短) + 下一步操作卡 + 基本信息 + 报价 + 样品测试 + 下单付款 + 到货 + 日志。
import { useEffect, useState } from "react";
import { ChevronDown, Eye, ExternalLink, FolderTree, History, Paperclip, Pencil } from "lucide-react";
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
import { BusinessLinePill, DIRECT_FLOW, INQUIRY_FLOW, MethodPill, PROC_STATUS_META, PersonAvatar, SourcePill, StatusPill, fmtMoney, useBuyerDirectory, useProcCan } from "./common";
import { nextPermissionOf, useProcTaskAction } from "./taskActions";
import { EditTaskModal } from "./modals";
import { PriceHistoryModal } from "./PriceHistoryModal";
import { MoveTaskDialog } from "./MoveTaskDialog";
import { refreshProcurement, taskRequester, useProcurementData, type ProcurementTask } from "../data";
import { listQuotations, rejectProcTask, type Quotation } from "../../lib/procurementApi";
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
      <span className="min-w-0 text-slate-700">{value}</span>
    </div>
  );
}

export function TaskDetailDrawer({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const { t } = useI18n();
  const { materials } = useProcurementData();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const can = useProcCan();
  const { deptOf } = useBuyerDirectory();
  const taskAction = useProcTaskAction();
  const requester = taskRequester(task);
  const meta = PROC_STATUS_META[task.status];
  const flow = task.method === "direct" ? DIRECT_FLOW : INQUIRY_FLOW;
  const curIdx = flow.indexOf(task.status);
  // 研发流转的待处理任务走「审核」语义：通过=确认提交，驳回须理由并删除采购任务
  const isRdReview = task.source === "rd" && task.status === "pending_confirm";
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
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
  useEffect(() => {
    let alive = true;
    void Promise.all([
      listQuotations({ taskId: task.id }),
      listQuotations({ materialId: task.materialId ?? undefined, materialName: task.materialId ? undefined : task.materialName }),
    ])
      .then(([taskQuotes, materialQuotes]) => {
        if (!alive) return;
        setQuotes(taskQuotes);
        setHistoryQuotes(materialQuotes);
      })
      .catch(() => {
        if (!alive) return;
        setQuotes([]);
        setHistoryQuotes([]);
      });
    return () => { alive = false; };
  }, [task.id, task.materialId, task.materialName, task.updatedAt]);
  const histLow = historyQuotes.length ? historyQuotes.reduce((a, b) => (a.unitPrice <= b.unitPrice ? a : b)) : null;
  const selectedQuotes = quotes.filter((q) => q.isSelected);
  const pct = task.quantity > 0 ? Math.round((task.arrivedQty / task.quantity) * 100) : 0;
  // 是否已进入下单阶段（此前「下单与付款」「到货记录」还没有内容，不展示）
  const orderStage = ["pending_purchase", "priced", "in_transit", "partial_arrival", "completed"].includes(task.status);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[720px] gap-0 p-0 sm:max-w-[720px]" aria-describedby={undefined}>
        {/* 头部（pr-8 给自带关闭 X 留位） */}
        <SheetHeader className="block border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between pr-8">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-lg font-bold text-slate-900">{task.code}</SheetTitle>
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
          <AutoTranslatedText
            as="div"
            className="mt-1 text-sm text-slate-500"
            text={[task.materialName, task.spec, `${task.quantity}${task.unit}`].filter(Boolean).join(" · ")}
          />
          {/* 步骤条 */}
          <div className="mt-4 flex items-center overflow-x-auto pb-1">
            {flow.map((s, i) => (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold", i < curIdx ? "bg-emerald-500 text-white" : i === curIdx ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-400")}>{i + 1}</span>
                  <span className={cn("whitespace-nowrap text-[10px]", i === curIdx ? "font-semibold text-indigo-600" : "text-slate-400")}>{t(PROC_STATUS_META[s].label)}</span>
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
            <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
              <div className="text-xs font-semibold text-indigo-500">{t('下一步 · 责任人：')}{task.status === "testing" ? task.rdContact ?? t("研发对接人") : task.buyer}</div>
              <p className="mt-1 text-sm text-slate-700">
                {isRdReview
                  ? t('研发流转需求待审核：通过后进入询价流程；驳回将删除采购任务，并通知研发对接人与超级管理员。')
                  : t('当前状态「{status}」，下一步：{next}。', { status: t(meta.label), next: t(meta.next) })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button type="button" disabled={taskAction.busy || rejectBusy} onClick={() => taskAction.runNext(task)} className="material-button-primary rounded-lg px-4 py-2 text-sm disabled:opacity-60">
                  {t(isRdReview ? '审核通过' : meta.next)}{task.method === "direct" && task.status === "pending_purchase" && <ExternalLink className="h-4 w-4" />}
                </Button>
                {isRdReview && (
                  <AlertDialog open={rejecting} onOpenChange={setRejecting}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" disabled={taskAction.busy || rejectBusy} className="rounded-lg border-rose-200 bg-white px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                        {t('驳回')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl border-rose-100 sm:max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-slate-900">{t('驳回并删除采购任务')}</AlertDialogTitle>
                        <AlertDialogDescription className="leading-relaxed">
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
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">{t('基本信息')}</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <Info label="物料 / 规格" value={<AutoTranslatedText text={[task.materialName, task.spec].filter(Boolean).join(" · ")} />} />
                <Info label="数量" value={`${task.quantity} ${t(task.unit)}`} />
                <Info label="需求日期" value={task.needDate} />
                {task.deadline && <Info label="Deadline" value={task.deadline} />}
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
                    <PersonAvatar name={task.buyer} size="xs" />
                    <span className="font-medium">{task.buyer}</span>
                    {deptOf(task.buyer) ? (
                      <span className="text-xs text-slate-400">{t(deptOf(task.buyer) ?? '')}</span>
                    ) : null}
                  </span>
                } />
                {task.rdContact && <Info label="研发对接人" value={task.rdContact} />}
                {task.source === "rd" && task.rdTaskTitle && <Info label="关联研发任务" value={<span><AutoTranslatedText className="text-indigo-600" text={task.rdTaskTitle} />{task.rdTaskId && <span className="ml-1 text-[11px] text-slate-400">{task.rdTaskId}</span>}</span>} />}
                {task.method === "direct" && task.purchaseLink && <Info label="商品链接" value={<a href={task.purchaseLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">{t('打开链接')} <ExternalLink className="h-3.5 w-3.5" /></a>} />}
              </div>
            </div>
            {task.consumableNote && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{t('低值易耗品：')}<AutoTranslatedText text={task.consumableNote} /></div>}
          </div>

          <TaskCriticalMaterials task={task} materials={materials} />

          {/* 研发转采购时携带的图纸/说明：随采购任务展示，读取地址由后端按 OSS key 动态重签。 */}
          {task.attachmentList.length > 0 && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t("需求附件（{count}）", { count: task.attachmentList.length })}</div>
              <ul className="space-y-2">
                {task.attachmentList.map((attachment) => {
                  const className = "flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/40 hover:text-indigo-700";
                  return (
                    <li key={attachment.id}>
                      <button
                        type="button"
                        className={cn(className, "w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300")}
                        aria-label={t("预览附件：{name}", { name: attachment.fileName })}
                        onClick={() => setPreviewAttachment(previewModel(attachment))}
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                        {attachment.fileSize > 0 && <span className="shrink-0 text-[10px] text-slate-400">{attachment.fileSize >= 1024 * 1024 ? `${(attachment.fileSize / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(attachment.fileSize / 1024)} KB`}</span>}
                        <Eye className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 报价区（询价）：仅在已有报价数据时展示 */}
          {task.method === "inquiry" && quotes.length > 0 && (
            <div className="space-y-3">
              {histLow && (
                <div className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 text-xs text-slate-600">
                  <span className="flex items-center gap-2"><History className="h-4 w-4 text-indigo-500" />{t('该物料历史最低')} <b className="text-emerald-600">{fmtMoney(histLow.unitPrice)}</b> · {histLow.supplierName} · {histLow.quoteDate}</span>
                  <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 font-medium text-indigo-600 hover:underline">{t('历史价格')}</button>
                </div>
              )}
              <div className="rounded-xl border border-slate-100">
                <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{t('供应商报价（{count}）', { count: quotes.length })}</div>
                <ul className="divide-y divide-slate-100">
                  {quotes.map((q) => (
                    <li key={q.id} className={cn("px-4 py-2.5", q.isSelected && "bg-emerald-50/40")}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="truncate text-sm font-medium text-slate-700">{q.supplierName}</span>
                          <span className="text-sm font-semibold tabular-nums text-slate-900">{q.currency === "CNY" ? fmtMoney(q.unitPrice) : `${q.currency} ${q.unitPrice}`}</span>
                          {q.channel === "quote-book" && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">{t('报价库')}</span>}
                          {q.isSelected && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600">{t('已确认')}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">{t('交期 {count} 天', { count: q.leadTimeDays })}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        {q.quantity != null && <span>{t('采购数量')} {q.quantity.toLocaleString()} {t(task.unit)}</span>}
                        {q.lineTotal != null && <span className="font-medium text-slate-600">{t('行金额')} {q.currency === "CNY" ? fmtMoney(q.lineTotal) : `${q.currency} ${q.lineTotal}`}</span>}
                        {q.minOrderQty != null && <span>{t('起订量')} {q.minOrderQty.toLocaleString()}</span>}
                        {q.validUntil && <span>{t('有效期至 {date}', { date: q.validUntil })}</span>}
                        {q.note && <span className="min-w-0 truncate">{q.note}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                {task.quotationTotal != null && (
                  <div className="space-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>{t('报价小计')}</span>
                      <b>{task.quotationCurrency === "CNY" ? fmtMoney(task.quotationSubtotal ?? 0) : `${task.quotationCurrency ?? ""} ${task.quotationSubtotal ?? 0}`}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('减：折扣金额')}</span>
                      <b>- {task.quotationCurrency === "CNY" ? fmtMoney(task.quotationDiscount ?? 0) : `${task.quotationCurrency ?? ""} ${task.quotationDiscount ?? 0}`}</b>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm text-indigo-700">
                      <b>{t('最终总价')}</b>
                      <b>{task.quotationCurrency === "CNY" ? fmtMoney(task.quotationTotal) : `${task.quotationCurrency ?? ""} ${task.quotationTotal}`}</b>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 样品测试区：仅展示已产生的数据 */}
          {task.needSample && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('样品与测试')}</div>
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
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('下单与付款')}</div>
              <Info label="付款状态" value={task.paymentStatus === "paid" ? t("已付款") : task.paymentStatus === "partial" ? <>{t('部分付款{note}', { note: '' })}{task.paymentNote ? <> (<AutoTranslatedText text={task.paymentNote} />)</> : null}</> : t("未付款")} />
              {task.paymentDate && <Info label="付款日期" value={task.paymentDate} />}
              {task.expectedArrivalDate && <Info label="预计到货" value={task.expectedArrivalDate} />}
            </div>
          )}

          {(orderStage || task.arrivedQty > 0) && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{t('到货记录')}</div>
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} /></div>
              <div className="text-xs text-slate-500">{t('已到货')} <b className="tabular-nums">{task.arrivedQty.toLocaleString()}</b> / {task.quantity.toLocaleString()}{t(task.unit)} ({pct}%)</div>
            </div>
          )}

          {/* 操作日志 */}
          <Collapsible open={logsOpen} onOpenChange={setLogsOpen} className="rounded-xl border border-slate-100">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400">{t('操作日志（{count}）', { count: task.logs.length })}<ChevronDown className={cn("size-4 text-slate-400 transition-transform", logsOpen && "rotate-180")} /></CollapsibleTrigger>
            <CollapsibleContent><ul className="space-y-2 border-t border-slate-100 px-4 py-3">{task.logs.map((l, i) => <li key={i} className="flex gap-3 text-sm"><span className="w-24 shrink-0 text-xs text-slate-400">{l.at}</span><AutoTranslatedText className="text-slate-600" text={l.text} /></li>)}</ul></CollapsibleContent>
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
      {editOpen && <EditTaskModal task={task} onClose={() => setEditOpen(false)} />}
      {previewAttachment ? (
        <AttachmentPreviewDialog attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      ) : null}
      </SheetContent>
    </Sheet>
  );
}
