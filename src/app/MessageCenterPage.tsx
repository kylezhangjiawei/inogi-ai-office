"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Loader2,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "./auth";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import {
  fetchRdMessages,
  fetchRdPerformanceReports,
  parseRdDiscussionMention,
  patchRdMessage,
  rdDiscussionMentionHref,
  updateRdTask,
  RD_MESSAGE_CATEGORY_LABELS,
  RD_MESSAGE_SOURCE_LABELS,
  type RdDiscussionMentionBody,
  type RdMessage,
  type RdMessageCategory,
  type RdMessageSource,
  type RdPerformanceReport,
} from "./lib/rdApi";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { AutoTranslatedText } from "./components/TranslatableText";
import { approveRdProcurementTransfer, rejectRdProcurementTransfer } from "./lib/procurementApi";
import { announceProcurementRefresh } from "./procurement/data";

// ── Parsed message body types ────────────────────────────────────────────────

type ReviewRequestBody = {
  type: "review_request";
  review_type: "result" | "collaboration" | "proposal" | "due_date" | "abandon" | "procurement_transfer";
  task_id: string;
  task_title: string;
  submitter_name: string;
  submitter_user_id?: string;
  rd_task_id?: string;
  procurement_code?: string;
  material_name?: string;
  specification?: string | null;
  quantity?: number;
  unit?: string | null;
  procurement_method_label?: string;
  note?: string;
  pending_collaborators?: Array<{ name: string; role?: string }>;
  current_progress?: number;
  pending_due_date?: string;
  current_due_date?: string;
};

type ReviewResultBody = {
  type: "review_result";
  review_type?: "procurement_transfer";
  review_stage?: "rd_gate";
  result: "approved" | "rejected";
  task_id: string;
  task_title: string;
  reviewer_name: string;
  reason?: string;
  note?: string;
  procurement_code?: string;
  material_name?: string;
  quantity?: number;
  unit?: string;
  buyer_name?: string;
};

type PerfSelfAssessmentBody = {
  type: "perf_self_assessment";
  report_id: string;
  month: string;
  period_label: string;
  user_name: string;
};

type ProcurementReviewResultBody = {
  type: "procurement_review_result";
  result: "approved" | "rejected";
  task_id: string;
  procurement_task_id: string;
  procurement_code: string;
  rd_task_id?: string;
  rd_task_title?: string;
  material_name: string;
  specification?: string | null;
  quantity: number;
  unit?: string | null;
  procurement_method: "direct" | "inquiry";
  procurement_method_label: string;
  requester_name?: string | null;
  requester_department?: string | null;
  rd_contact?: string | null;
  reviewer_name: string;
  reason?: string | null;
  priority?: string | null;
  need_date?: string | null;
  deadline?: string | null;
  next_status_label?: string | null;
  task_deleted: boolean;
  next_action: string;
  route?: string | null;
  action_label?: string | null;
  recipient_reason?: string | null;
};

type ProcurementAssignmentBody = {
  type: "procurement_assignment";
  task_id: string;
  procurement_task_id: string;
  procurement_code: string;
  rd_task_id?: string;
  rd_task_title?: string;
  material_name: string;
  specification?: string | null;
  quantity: number;
  unit?: string | null;
  procurement_method_label: string;
  assigned_by: string;
  route?: string;
  action_label?: string;
  next_action: string;
};

type ParsedBody =
  | ReviewRequestBody
  | ReviewResultBody
  | ProcurementReviewResultBody
  | ProcurementAssignmentBody
  | PerfSelfAssessmentBody
  | RdDiscussionMentionBody
  | { type: "unknown"; raw: string };

const MESSAGE_CHIP_CLASS = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium";

function parseBody(raw: string): ParsedBody {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.type === "review_request") return obj as unknown as ReviewRequestBody;
    if (obj.type === "review_result") return obj as unknown as ReviewResultBody;
    if (obj.type === "procurement_review_result") return obj as unknown as ProcurementReviewResultBody;
    if (obj.type === "procurement_assignment") return obj as unknown as ProcurementAssignmentBody;
    if (obj.type === "perf_self_assessment") return obj as unknown as PerfSelfAssessmentBody;
    if (obj.type === "discussion_mention") return parseRdDiscussionMention(raw) ?? { type: "unknown", raw };
    return { type: "unknown", raw };
  } catch {
    return { type: "unknown", raw };
  }
}

/** 消息卡片上的来源标签。后端新增来源而前端标签表未同步时，兜底显示原始值，不留空白。 */
function SourceChip({ source }: { source: RdMessage["source"] }) {
  const label = RD_MESSAGE_SOURCE_LABELS[source] ?? source;
  return <span className={cn(MESSAGE_CHIP_CLASS, "border-slate-200 bg-slate-100 text-slate-600")}>{t(label)}</span>;
}

/** “待审核”在统计卡片和列表筛选中必须使用完全相同的口径。 */
function isPendingReviewMessage(message: RdMessage): boolean {
  return message.handled !== true && parseBody(message.body).type === "review_request";
}

// ── Reject reason dialog ─────────────────────────────────────────────────────

function RejectDialog({
  taskTitle,
  submitting,
  actionError,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  taskTitle: string;
  submitting: boolean;
  actionError: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  useI18n();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(t("请填写打回原因。"));
      return;
    }
    setReasonError(null);
    onConfirm(trimmed);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="horizon-portal sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="text-balance text-slate-900">{t("打回审核")}</DialogTitle>
          <DialogDescription className="text-pretty">
            {t("任务：")}<AutoTranslatedText className="font-medium text-slate-700" text={taskTitle} />
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="message-reject-reason" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t("打回原因")} <span className="text-red-600" aria-hidden="true">*</span>
          </Label>
          <Textarea
            autoFocus
            id="message-reject-reason"
            className="min-h-28 resize-y"
            placeholder={t("请填写打回原因，申请人将收到通知...")}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? "message-reject-reason-error" : undefined}
            disabled={submitting}
          />
          {reasonError ? <p id="message-reject-reason-error" className="mt-1.5 text-xs text-red-600" role="alert">{reasonError}</p> : null}
          {actionError ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-pretty text-xs text-red-700" role="alert">{actionError}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>{t("取消")}</Button>
          <Button type="button" className="bg-red-600 text-white hover:bg-red-700" onClick={submit} disabled={submitting}>
            {submitting ? t("提交中…") : t("确认打回")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single message card ───────────────────────────────────────────────────────

function ApproveDialog({
  taskTitle,
  taskId,
  reviewType,
  submitterName,
  pendingDueDate,
  currentDueDate,
  submitting,
  actionError,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  taskTitle: string;
  taskId: string;
  reviewType: "result" | "collaboration" | "proposal" | "due_date" | "abandon" | "procurement_transfer";
  submitterName: string;
  pendingDueDate?: string;
  currentDueDate?: string;
  submitting: boolean;
  actionError: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  useI18n();
  const reviewTypeLabel =
    reviewType === "procurement_transfer"
      ? t("转采购审核")
      : reviewType === "collaboration"
      ? t("协作变更审核")
      : reviewType === "proposal"
      ? t("立项审核")
      : reviewType === "due_date"
      ? t("截止日期变更审核")
      : reviewType === "abandon"
      ? t("放弃任务审核")
      : t("成果审核");

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <AlertDialogContent className="horizon-portal sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance text-slate-900">{t("确认审核通过")}</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">{reviewTypeLabel}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <p className="text-pretty text-sm leading-6 text-slate-700">
            {t("确认通过「")}<AutoTranslatedText className="font-semibold text-slate-900" text={taskTitle} />{t("」？")}
          </p>
          <dl className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div><dt className="inline font-medium text-slate-500">{t("任务编号：")}</dt><dd className="inline tabular-nums">{taskId}</dd></div>
            <div><dt className="inline font-medium text-slate-500">{t("提交人：")}</dt><dd className="inline">{submitterName || t("未识别")}</dd></div>
            {reviewType === "due_date" && pendingDueDate ? (
              <div><dt className="inline font-medium text-slate-500">{t("截止日期：")}</dt><dd className="inline tabular-nums">{currentDueDate || t("未设置")} → {pendingDueDate}</dd></div>
            ) : null}
          </dl>
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-pretty text-xs leading-5 text-[#002fa7]">
            {reviewType === "procurement_transfer"
              ? t("通过后申请才会进入采购驾驶舱，并按采购部门负载分配采购负责人。")
              : reviewType === "collaboration"
              ? t("通过后协作变更会立即生效，并通知申请人员。")
              : reviewType === "proposal"
              ? t("通过后任务将正式立项并进入进行中状态，同时通知发起人。")
              : reviewType === "due_date"
              ? t("通过后任务的截止日期将更新为申请值，并回到进行中状态。")
              : reviewType === "abandon"
              ? t("通过后该任务将被移除（等同删除），不可恢复，并通知申请人。")
              : t("通过后任务会进入审核通过状态，并通知对应申请人员。")}
          </p>
          {actionError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-pretty text-xs text-red-700" role="alert">{actionError}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>{t("再看看")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#002fa7] text-white hover:bg-[#002581]"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {submitting ? <Loader2 className="size-4" aria-hidden="true" /> : <ThumbsUp className="size-4" aria-hidden="true" />}
            {submitting ? t("处理中") : t("确认通过")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MessageCard({
  msg,
  canReview,
  isApproving,
  onOpen,
  onApprove,
  onReject,
  onSelfAssess,
  onHandle,
}: {
  msg: RdMessage;
  canReview: boolean;
  isApproving: boolean;
  onOpen: (msg: RdMessage) => void;
  onApprove: (msg: RdMessage, body: ReviewRequestBody, trigger: HTMLElement) => void;
  onReject: (msg: RdMessage, body: ReviewRequestBody, trigger: HTMLElement) => void;
  onSelfAssess: (msg: RdMessage, body: PerfSelfAssessmentBody, trigger: HTMLElement) => void;
  onHandle: (msg: RdMessage) => void;
}) {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const body = useMemo(() => parseBody(msg.body), [msg.body]);
  // 视频完成通知：meta 带跳转信息，点击后跳视频库并定位该视频
  const videoMeta = (msg.meta && typeof msg.meta === "object" ? (msg.meta as Record<string, unknown>) : null);
  const videoJump =
    videoMeta && videoMeta.kind === "video_done" && typeof videoMeta.video_id === "string"
      ? {
          route: typeof videoMeta.route === "string" ? videoMeta.route : "/video-library",
          videoId: videoMeta.video_id as string,
        }
      : null;
  const openVideo = () => {
    if (!videoJump) return;
    onOpen(msg); // 标记已读
    navigate(`${videoJump.route}?video=${encodeURIComponent(videoJump.videoId)}`);
  };

  const timeLabel = useMemo(() => {
    try {
      const d = new Date(msg.created_at);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return t("刚刚");
      if (mins < 60) return t("{n} 分钟前", { n: mins });
      const hours = Math.floor(mins / 60);
      if (hours < 24) return t("{n} 小时前", { n: hours });
      const days = Math.floor(hours / 24);
      if (days === 1) return t("昨天");
      if (days < 7) return t("{n} 天前", { n: days });
      return d.toLocaleDateString(i18nLocale());
    } catch {
      return "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.created_at, lang]);

  if (body.type === "discussion_mention") {
    const openDiscussion = () => {
      onOpen(msg);
      navigate(rdDiscussionMentionHref(body, { notificationId: msg.id, createdAt: msg.created_at }));
    };
    return (
      <article className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-[#002fa7] bg-[#002fa7] text-white")}>
            {msg.read ? t("已读") : t("提及你")}
          </span>
          <span className={cn(MESSAGE_CHIP_CLASS, "border-blue-200 bg-white text-[#002fa7]")}>{t("受邀参与")}</span>
          {msg.handled && <span className={cn(MESSAGE_CHIP_CLASS, "border-emerald-200 bg-emerald-50 text-emerald-700")}>{t("已处理")}</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>
        <div className="mt-2 text-sm font-bold text-slate-900">{body.task_title}</div>
        <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-700">
          <span className="font-semibold text-[#002fa7]">{body.actor_name}</span>
          {t(" 在讨论中提到了你：")}
          {body.excerpt}
        </p>
        <p className="mt-1.5 text-[10px] text-slate-500">
          {t("进入原消息所在讨论；打开即标为已读。你只会加入当前线程。")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openDiscussion}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#002fa7] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#002581] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {t("查看并回复")}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          {!msg.handled && (
            <button
              type="button"
              onClick={() => onHandle(msg)}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("标记已处理")}
            </button>
          )}
        </div>
      </article>
    );
  }

  if (body.type === "review_request") {
    const rb = body;
    const reviewTypeLabel = rb.review_type === "procurement_transfer" ? t("转采购申请") : rb.review_type === "collaboration" ? t("协作申请") : rb.review_type === "proposal" ? t("立项申请") : rb.review_type === "due_date" ? t("截止日期变更") : rb.review_type === "abandon" ? t("放弃任务") : t("成果提交");
    const isHandled = msg.handled === true;

    return (
      <article
        className={cn("cursor-pointer rounded-xl border p-4", isHandled ? "border-slate-200 bg-slate-50/60" : "border-blue-200 bg-blue-50/40")}
        onClick={() => onOpen(msg)}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className={cn(MESSAGE_CHIP_CLASS, "border-blue-200 bg-blue-100 text-[#002fa7]")}>{t("审核申请")}</span>
            <span className={cn(MESSAGE_CHIP_CLASS, rb.review_type === "abandon" ? "border-red-200 bg-red-50 text-red-700" : rb.review_type === "procurement_transfer" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-white text-[#002fa7]")}>
              {reviewTypeLabel}
            </span>
            {!msg.read && !isHandled && (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />
            )}
            {isHandled && (
              <span className={cn(MESSAGE_CHIP_CLASS, "border-emerald-200 bg-emerald-50 text-emerald-700")}>{t("已处理")}</span>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>

        <AutoTranslatedText as="div" className="mb-1 font-semibold text-slate-900" text={rb.task_title} />
        <div className="mb-3 text-sm text-slate-600">
          <span className="text-slate-500">{t("提交人：")}</span>{rb.submitter_name}
          {rb.review_type === "result" && typeof rb.current_progress === "number" && (
            <span className="ml-3 text-slate-500">{t("完成度：")}<span className="font-medium text-slate-700">{rb.current_progress}%</span></span>
          )}
          {rb.review_type === "due_date" && rb.pending_due_date && (
            <span className="ml-3 text-slate-500">{t("截止日期：")}<span className="font-medium text-slate-700">{rb.current_due_date || t("未设置")} → {rb.pending_due_date}</span></span>
          )}
        </div>

        {rb.review_type === "procurement_transfer" && (
          <div className="mb-3 grid gap-2 rounded-xl border border-blue-200 bg-white p-3 text-xs text-slate-600 sm:grid-cols-2">
            <div>{t("采购编号：")}<span className="font-mono font-semibold text-slate-800">{rb.procurement_code}</span></div>
            <div>{t("采购方式：")}<span className="font-semibold text-slate-800">{rb.procurement_method_label}</span></div>
            <div>{t("物料：")}<AutoTranslatedText className="font-semibold text-slate-800" text={[rb.material_name, rb.specification].filter(Boolean).join(" · ")} /></div>
            <div>{t("数量：")}<span className="font-semibold text-slate-800">{rb.quantity} {rb.unit}</span></div>
          </div>
        )}

        {rb.note && (
          <AutoTranslatedText as="p" className="mb-3 rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200" text={rb.note} />
        )}

        {Array.isArray(rb.pending_collaborators) && rb.pending_collaborators.length > 0 && (
          <div className="mb-3 text-sm text-slate-600">
            <span className="text-slate-500">{t("申请协作者：")}</span>
            {rb.pending_collaborators.map((c, i) => (
              <span key={i} className="ml-1 font-medium text-slate-700">{c.name}{c.role ? `（${c.role}）` : ""}</span>
            ))}
          </div>
        )}

        {canReview && !isHandled && (
          <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={isApproving}
              className="inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-lg bg-[#002fa7] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#002581] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation();
                onApprove(msg, rb, event.currentTarget);
              }}
            >
              {isApproving
                ? <><Loader2 className="size-4" aria-hidden="true" />{t("处理中")}</>
                : <><ThumbsUp className="h-4 w-4" />{t("批准")}</>
              }
            </button>
            <button
              type="button"
              className="inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50"
              onClick={(event) => {
                event.stopPropagation();
                onReject(msg, rb, event.currentTarget);
              }}
            >
              <ThumbsDown className="h-4 w-4" />
              {t("打回")}
            </button>
          </div>
        )}
        {!msg.read && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#002fa7] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(msg);
            }}
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t("标记为已读")}
          </button>
        )}
        {rb.review_type === "procurement_transfer" && rb.rd_task_id && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#002fa7] hover:underline"
            onClick={(event) => { event.stopPropagation(); onOpen(msg); navigate(`/rd-task/${encodeURIComponent(rb.rd_task_id!)}`); }}
          >
            {t("查看原研发任务")}<ArrowRight className="size-3.5" />
          </button>
        )}
      </article>
    );
  }

  if (body.type === "procurement_review_result") {
    const approved = body.result === "approved";
    const openRelatedTask = () => {
      onOpen(msg);
      if (body.route?.startsWith("/")) navigate(body.route);
    };
    const facts = [
      { label: t("采购编号"), value: body.procurement_code },
      { label: t("采购方式"), value: body.procurement_method_label },
      { label: t("数量"), value: `${body.quantity} ${body.unit ?? ""}`.trim() },
      { label: t("规格"), value: body.specification },
      { label: t("需求提出人"), value: [body.requester_name, body.requester_department].filter(Boolean).join(" · ") },
      { label: t("研发对接人"), value: body.rd_contact },
      { label: t("接收原因"), value: body.recipient_reason },
      { label: t("审核人"), value: body.reviewer_name },
      { label: t("需求日期"), value: body.need_date },
      { label: t("截止日期"), value: body.deadline },
      { label: t("当前状态"), value: approved ? body.next_status_label : t("采购任务已删除") },
    ].filter((item) => item.value !== null && item.value !== undefined && item.value !== "");

    return (
      <article className={cn("rounded-xl border bg-white p-4", approved ? "border-emerald-200" : "border-red-200")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>
            {msg.read ? t("已读") : t("未读")}
          </span>
          <SourceChip source={msg.source} />
          <span className={cn(MESSAGE_CHIP_CLASS, approved ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-red-200 bg-red-100 text-red-700")}>
            {approved ? t("审核通过") : t("审核打回")}
          </span>
          <span className={cn(MESSAGE_CHIP_CLASS, "border-slate-200 bg-slate-100 text-slate-600")}>{t("转采购审核")}</span>
          {msg.handled && <span className={cn(MESSAGE_CHIP_CLASS, "border-slate-200 bg-slate-100 text-slate-500")}>{t("已处理")}</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="size-3.5" />
            {timeLabel}
          </span>
        </div>

        <div className="mt-4 border-b border-slate-100 pb-4">
          <p className="font-mono text-xs tabular-nums text-slate-400">{body.procurement_code}</p>
          <AutoTranslatedText as="div" className="mt-1 text-balance text-base font-semibold text-slate-900" text={body.material_name} />
          {body.rd_task_title && (
            <p className="mt-1 text-pretty text-xs text-slate-500">
              {t("来源研发任务：")}<AutoTranslatedText text={body.rd_task_title} />
            </p>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-xs text-slate-400">{item.label}</dt>
              <dd className="mt-0.5 text-pretty text-sm font-medium text-slate-700">
                <AutoTranslatedText text={String(item.value)} />
              </dd>
            </div>
          ))}
        </dl>

        {!approved && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs font-semibold text-red-700">{t("打回原因")}</p>
            <AutoTranslatedText as="p" className="mt-1 whitespace-pre-wrap text-pretty text-sm leading-6 text-red-800" text={body.reason || t("未填写打回原因")} />
          </div>
        )}

        <div className={cn("mt-3 rounded-xl border px-4 py-3", approved ? "border-emerald-100 bg-emerald-50" : "border-slate-200 bg-slate-50")}>
          <p className={cn("text-xs font-semibold", approved ? "text-emerald-700" : "text-slate-600")}>{t("下一步")}</p>
          <AutoTranslatedText as="p" className="mt-1 text-pretty text-sm leading-6 text-slate-700" text={body.next_action} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {body.route?.startsWith("/") && (
            <button
              type="button"
              onClick={openRelatedTask}
              className={cn(
                "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                approved ? "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-400" : "bg-slate-800 hover:bg-slate-900 focus-visible:ring-slate-400",
              )}
            >
              {t(body.action_label || (approved ? "查看采购任务" : "查看原研发任务"))}
              <ArrowRight className="size-3.5" />
            </button>
          )}
          {!msg.handled && (
            <button
              type="button"
              onClick={() => onHandle(msg)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              <CheckCircle2 className="size-3.5" />
              {t("标记已处理")}
            </button>
          )}
        </div>
      </article>
    );
  }

  if (body.type === "procurement_assignment") {
    const openTask = () => {
      onOpen(msg);
      if (body.route?.startsWith("/")) navigate(body.route);
    };
    return (
      <article className="rounded-xl border border-blue-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>{msg.read ? t("已读") : t("未读")}</span>
          <SourceChip source={msg.source} />
          <span className={cn(MESSAGE_CHIP_CLASS, "border-blue-200 bg-blue-100 text-[#002fa7]")}>{t("新任务分配")}</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400"><Clock3 className="size-3.5" />{timeLabel}</span>
        </div>
        <div className="mt-4 border-b border-slate-100 pb-4">
          <p className="font-mono text-xs text-slate-400">{body.procurement_code}</p>
          <AutoTranslatedText as="div" className="mt-1 text-base font-semibold text-slate-900" text={body.material_name} />
          {body.rd_task_title && <p className="mt-1 text-xs text-slate-500">{t("来源研发任务：")}<AutoTranslatedText text={body.rd_task_title} /></p>}
        </div>
        <dl className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-400">{t("采购方式")}</dt><dd className="mt-0.5 text-sm font-medium text-slate-700">{body.procurement_method_label}</dd></div>
          <div><dt className="text-xs text-slate-400">{t("数量")}</dt><dd className="mt-0.5 text-sm font-medium text-slate-700">{body.quantity} {body.unit ?? ""}</dd></div>
          {body.specification && <div><dt className="text-xs text-slate-400">{t("规格")}</dt><dd className="mt-0.5 text-sm font-medium text-slate-700"><AutoTranslatedText text={body.specification} /></dd></div>}
          <div><dt className="text-xs text-slate-400">{t("分配人")}</dt><dd className="mt-0.5 text-sm font-medium text-slate-700">{body.assigned_by}</dd></div>
        </dl>
        <AutoTranslatedText as="p" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#002fa7]" text={body.next_action} />
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
          {body.route?.startsWith("/") && <Button type="button" size="sm" onClick={openTask}>{t(body.action_label || "打开采购任务")}<ArrowRight className="size-3.5" /></Button>}
          {!msg.handled && <Button type="button" size="sm" variant="outline" onClick={() => onHandle(msg)}><CheckCircle2 className="size-3.5" />{t("标记已处理")}</Button>}
        </div>
      </article>
    );
  }

  if (body.type === "review_result") {
    const rb = body;
    const approved = rb.result === "approved";

    return (
      <article
        className={cn("cursor-pointer rounded-xl border p-4", approved ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40")}
        onClick={() => onOpen(msg)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(msg);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className={cn(MESSAGE_CHIP_CLASS, approved ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-red-200 bg-red-100 text-red-700")}>
              {approved ? t("已批准") : t("已打回")}
            </span>
            <span className={cn(MESSAGE_CHIP_CLASS, "border-slate-200 bg-slate-100 text-slate-600")}>
              {rb.review_type === "procurement_transfer" ? t("转采购前置审核") : t("审核结果")}
            </span>
            {!msg.read && (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>

        <AutoTranslatedText as="div" className="mb-1 font-semibold text-slate-900" text={rb.task_title} />
        <div className="mb-2 text-sm text-slate-600">
          <span className="text-slate-500">{t("审核人：")}</span>{rb.reviewer_name}
        </div>

        {rb.review_type === "procurement_transfer" && (
          <div className="mb-3 grid gap-2 rounded-xl border border-blue-200 bg-white p-3 text-xs text-slate-600 sm:grid-cols-2">
            <div>{t("采购编号：")}<span className="font-mono font-semibold text-slate-800">{rb.procurement_code}</span></div>
            <div>{t("数量：")}<span className="font-semibold text-slate-800">{rb.quantity} {rb.unit}</span></div>
            {rb.buyer_name && <div className="sm:col-span-2">{t("采购负责人：")}<span className="font-semibold text-slate-800">{rb.buyer_name}</span></div>}
          </div>
        )}

        {rb.reason && (
          <p className={cn("rounded-lg px-3 py-2 text-sm ring-1", approved ? "bg-white/80 text-slate-600 ring-slate-200" : "bg-white/80 text-red-700 ring-red-200")}>
            <span className="font-medium">{approved ? t("备注：") : t("打回原因：")}</span><AutoTranslatedText text={rb.reason} />
          </p>
        )}
        {rb.note && (
          <AutoTranslatedText as="p" className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200" text={rb.note} />
        )}
      </article>
    );
  }

  if (body.type === "perf_self_assessment") {
    const pb = body;
    const isHandled = msg.handled === true;
    return (
      <article
        className={cn("rounded-xl border p-4", isHandled ? "border-slate-200 bg-slate-50/60" : "border-blue-200 bg-blue-50/40")}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className={cn(MESSAGE_CHIP_CLASS, "border-blue-200 bg-blue-100 text-[#002fa7]")}>{t("绩效自评")}</span>
            {!msg.read && !isHandled && <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />}
            {isHandled && <span className={cn(MESSAGE_CHIP_CLASS, "border-emerald-200 bg-emerald-50 text-emerald-700")}>{t("已提交")}</span>}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>
        <div className="mb-1 font-semibold text-slate-900">{pb.period_label}{t("月度绩效自评")}</div>
        <div className="mb-3 text-sm text-slate-600">{t("你的 {p} 月度绩效已生成，请完成 5 维自评（交付 / 质量 / 协作 / 主动性 / 规范）。", { p: pb.period_label })}</div>
        <div className="mt-2 flex border-t border-slate-100 pt-4">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#002fa7] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#002581]"
            onClick={(event) => {
              event.stopPropagation();
              onSelfAssess(msg, pb, event.currentTarget);
            }}
          >
            {isHandled ? t("查看 / 修改自评") : t("去自评")}
          </button>
        </div>
      </article>
    );
  }

  // Unknown / plain text message
  const rb = body as { type: "unknown"; raw: string };
  return (
    <article
      className={cn(
        "cursor-pointer rounded-xl border bg-white p-4",
        videoJump ? "border-blue-200 hover:bg-blue-50/40" : "border-slate-200",
      )}
      onClick={() => (videoJump ? openVideo() : onOpen(msg))}
      onKeyDown={(event) => {
        if (videoJump) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(msg);
        }
      }}
      role={videoJump ? undefined : "button"}
      tabIndex={videoJump ? undefined : 0}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn(MESSAGE_CHIP_CLASS, msg.read ? "border-slate-200 bg-slate-100 text-slate-500" : "border-red-200 bg-red-50 text-red-600")}>
            {msg.read ? t("已读") : t("未读")}
          </span>
          <SourceChip source={msg.source} />
          <span className={cn(MESSAGE_CHIP_CLASS, "border-slate-200 bg-slate-100 text-slate-600")}>{t("系统消息")}</span>
          {!msg.read && (
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />
          )}
        </div>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <Clock3 className="h-3.5 w-3.5" />
          {timeLabel}
        </span>
      </div>
      {msg.subject && <AutoTranslatedText as="div" className="mb-1 font-semibold text-slate-900" text={msg.subject} />}
      <AutoTranslatedText as="p" className="text-sm text-slate-600" text={rb.raw || msg.body} />
      {videoJump && (
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#002fa7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#002581]"
          onClick={(event) => {
            event.stopPropagation();
            openVideo();
          }}
        >
          <PlayCircle className="h-4 w-4" />
          {t("查看视频")}
        </button>
      )}
    </article>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

/** 一次向服务端取多少条。关键字搜索与未读/类型标签仍在已加载的集合上做，
 *  这个只决定「往回追多远的历史」，与下面每屏显示几条的 MESSAGE_PAGE_SIZE 无关。 */
const MESSAGE_FETCH_SIZE = 200;

/** 筛选项展示顺序：待办排最前，用户进来最先要处理的就是它 */
const CATEGORY_ORDER: RdMessageCategory[] = ["todo", "result", "mention", "notice"];
const SOURCE_ORDER: RdMessageSource[] = [
  "rd", "us-collab", "production", "procurement", "video", "performance", "assistant",
];

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** 一行可多选的筛选胶囊。全不选 = 不筛，语义上等同「全部」。 */
function FilterChipRow<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
  onClear: () => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
      <legend className="mr-1 w-10 shrink-0 text-xs font-semibold text-slate-600">{label}</legend>
      <button
        type="button"
        onClick={onClear}
        aria-pressed={selected.length === 0}
        className={cn(
          "cursor-pointer rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          selected.length === 0
            ? "border-blue-200 bg-blue-50 font-semibold text-[#002fa7]"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
        )}
      >
        {t("全部")}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={selected.includes(option.value)}
          onClick={() => onToggle(option.value)}
          className={cn(
            "cursor-pointer rounded-full border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            selected.includes(option.value)
              ? "border-blue-200 bg-blue-50 font-semibold text-[#002fa7]"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

type FilterType = "all" | "unread" | "review_request" | "review_result";

const filterLabels: Record<FilterType, string> = {
  all: "全部",
  unread: "未读",
  review_request: "待审核",
  review_result: "审核结果",
};

// 消息列表每页条数
const MESSAGE_PAGE_SIZE = 8;

export function MessageCenterPage() {
  useI18n();
  const { user } = useAuth();
  const [messages, setMessages] = useState<RdMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // 空数组 = 不筛。这两个走服务端，改动会触发重新拉取（见 loadMessages 依赖）
  const [sourceFilter, setSourceFilter] = useState<RdMessageSource[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<RdMessageCategory[]>([]);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [page, setPage] = useState(1);

  // Reject dialog state
  const [rejectTarget, setRejectTarget] = useState<{ msg: RdMessage; body: ReviewRequestBody } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ msg: RdMessage; body: ReviewRequestBody } | null>(null);
  const [approving, setApproving] = useState<string | null>(null); // message id being approved
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // 绩效自评弹窗状态
  const [selfAssessReport, setSelfAssessReport] = useState<RdPerformanceReport | null>(null);
  const [selfAssessLoading, setSelfAssessLoading] = useState(false);
  const [selfAssessMsgId, setSelfAssessMsgId] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const selfAssessTriggerRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const canReview = user
    ? user.permissions.includes("*")
      || user.permissions.includes("rd-task:edit")
      || user.permissions.includes("rd-task:reassign")
      || user.permissions.includes("rd-procurement:review")
    : false;
  const canReviewMessage = useCallback((body: ReviewRequestBody) => {
    if (!user) return false;
    if (body.review_type === "procurement_transfer") {
      return user.permissions.includes("*") || user.permissions.includes("rd-procurement:review");
    }
    return user.permissions.includes("*")
      || user.permissions.includes("rd-task:edit")
      || user.permissions.includes("rd-task:reassign");
  }, [user]);

  // Load messages（首屏 / 刷新：始终回到最新一页，丢弃已翻出的更早内容）
  const loadMessages = useCallback(async () => {
    if (!user?.id) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchRdMessages({
        recipient_id: user.id,
        limit: MESSAGE_FETCH_SIZE,
        source: sourceFilter,
        category: categoryFilter,
      });
      if (requestId !== loadRequestRef.current) return;
      // Sort newest first
      setMessages(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setHasMore(data.length === MESSAGE_FETCH_SIZE);
      setPage(1); // 换筛选条件后停在旧页码会显示空列表
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      const message = err instanceof Error ? err.message : t("加载消息失败");
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [user?.id, sourceFilter, categoryFilter]);

  // 翻更早的一页：游标取当前最后一条的 (created_at, id)。
  // 表化前这里是一次性拉 200 条封顶，再早的历史在界面上根本够不着。
  const loadEarlier = useCallback(async () => {
    if (!user?.id) return;
    const oldest = messages[messages.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const older = await fetchRdMessages({
        recipient_id: user.id,
        limit: MESSAGE_FETCH_SIZE,
        before_created_at: oldest.created_at,
        before_id: oldest.id,
        source: sourceFilter,
        category: categoryFilter,
      });
      setHasMore(older.length === MESSAGE_FETCH_SIZE);
      if (older.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...older.filter((m) => !seen.has(m.id))];
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("加载更早消息失败");
      setLoadMoreError(message);
      toast.error(message);
    } finally {
      setLoadingMore(false);
    }
  }, [user?.id, messages, sourceFilter, categoryFilter]);

  useEffect(() => {
    void loadMessages();

    // Immediately refresh when another tab/panel submits a review request or message state changes.
    const onReviewSubmitted = () => { void loadMessages(); };
    const onMessagesUpdated = () => { void loadMessages(); };
    window.addEventListener('rd:review-submitted', onReviewSubmitted);
    window.addEventListener('rd:messages-updated', onMessagesUpdated);

    // Also refresh when the page becomes visible (e.g. switching back from another tab)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadMessages();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timer = window.setInterval(() => { void loadMessages(); }, 60_000);

    return () => {
      loadRequestRef.current += 1;
      window.removeEventListener('rd:review-submitted', onReviewSubmitted);
      window.removeEventListener('rd:messages-updated', onMessagesUpdated);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  // Derived counts
  const unreadCount = useMemo(() => messages.filter((m) => !m.read).length, [messages]);
  const pendingReviewCount = useMemo(
    () => messages.filter(isPendingReviewMessage).length,
    [messages],
  );
  const handledCount = useMemo(() => messages.filter((message) => message.handled === true).length, [messages]);

  const markMessageRead = useCallback((msg: RdMessage) => {
    if (msg.read) return;
    setMessages((prev) => prev.map((item) => (item.id === msg.id ? { ...item, read: true } : item)));
    void patchRdMessage(msg.id, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch((error: unknown) => {
        setMessages((previous) => previous.map((item) => item.id === msg.id ? { ...item, read: msg.read } : item));
        toast.error(error instanceof Error ? error.message : t("消息已读状态更新失败"));
      });
  }, []);

  const markMessageHandled = useCallback((msg: RdMessage) => {
    setMessages((prev) => prev.map((item) => (
      item.id === msg.id ? { ...item, read: true, handled: true } : item
    )));
    void patchRdMessage(msg.id, { read: true, handled: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch((error: unknown) => {
        setMessages((prev) => prev.map((item) => (
          item.id === msg.id ? { ...item, handled: msg.handled, read: msg.read } : item
        )));
        toast.error(error instanceof Error ? error.message : t("消息处理状态更新失败"));
      });
  }, []);

  // 打开绩效自评：先标已读，按消息携带的月份拉取本人当月绩效，再开评分弹窗。
  const openSelfAssess = useCallback(
    async (msg: RdMessage, body: PerfSelfAssessmentBody, trigger: HTMLElement) => {
      selfAssessTriggerRef.current = trigger;
      markMessageRead(msg);
      if (!user?.id) return;
      setSelfAssessMsgId(msg.id);
      setSelfAssessLoading(true);
      try {
        const list = await fetchRdPerformanceReports({ user_id: user.id, month: body.month, limit: 1 });
        const r = list[0] ?? null;
        if (!r) {
          toast.error(t("未找到对应的绩效报表，可能已被重新生成"));
          window.requestAnimationFrame(() => selfAssessTriggerRef.current?.focus());
          return;
        }
        setSelfAssessReport(r);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("读取绩效失败，请稍后重试"));
        window.requestAnimationFrame(() => selfAssessTriggerRef.current?.focus());
      } finally {
        setSelfAssessLoading(false);
      }
    },
    [user?.id, markMessageRead],
  );

  // Filtered messages
  const filteredMessages = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return messages.filter((m) => {
      const parsed = parseBody(m.body);
      // Filter tab
      if (filter === "unread" && m.read) return false;
      if (filter === "review_request" && !isPendingReviewMessage(m)) return false;
      if (filter === "review_result" && parsed.type !== "review_result" && parsed.type !== "procurement_review_result") return false;

      if (!q) return true;

      // Keyword search across subject and body content
      const searchText = [
        m.subject ?? "",
        m.body,
        parsed.type === "review_request" ? (parsed as ReviewRequestBody).task_title : "",
        parsed.type === "review_request" ? (parsed as ReviewRequestBody).submitter_name : "",
        parsed.type === "review_result" ? (parsed as ReviewResultBody).task_title : "",
        parsed.type === "review_result" ? (parsed as ReviewResultBody).reviewer_name : "",
        parsed.type === "procurement_review_result" ? parsed.material_name : "",
        parsed.type === "procurement_review_result" ? parsed.procurement_code : "",
        parsed.type === "procurement_review_result" ? parsed.reviewer_name : "",
        parsed.type === "discussion_mention" ? parsed.task_title : "",
        parsed.type === "discussion_mention" ? parsed.actor_name : "",
        parsed.type === "discussion_mention" ? parsed.excerpt : "",
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(q);
    });
  }, [messages, filter, keyword]);

  // 切换筛选 / 搜索时回到第一页
  useEffect(() => {
    setPage(1);
  }, [filter, keyword]);

  // 分页（safePage 兜底防止筛选后页码越界）
  const totalPages = Math.max(1, Math.ceil(filteredMessages.length / MESSAGE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedMessages = useMemo(
    () => filteredMessages.slice((safePage - 1) * MESSAGE_PAGE_SIZE, safePage * MESSAGE_PAGE_SIZE),
    [filteredMessages, safePage],
  );
  const visibleStart = filteredMessages.length === 0 ? 0 : (safePage - 1) * MESSAGE_PAGE_SIZE + 1;
  const visibleEnd = Math.min(safePage * MESSAGE_PAGE_SIZE, filteredMessages.length);

  const requestApprove = useCallback((msg: RdMessage, body: ReviewRequestBody, trigger: HTMLElement) => {
    dialogTriggerRef.current = trigger;
    setApproveError(null);
    setApproveTarget({ msg, body });
  }, []);

  const requestReject = useCallback((msg: RdMessage, body: ReviewRequestBody, trigger: HTMLElement) => {
    dialogTriggerRef.current = trigger;
    setRejectError(null);
    setRejectTarget({ msg, body });
  }, []);

  const restoreDialogFocus = useCallback((event: Event) => {
    event.preventDefault();
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      else searchInputRef.current?.focus();
    });
  }, []);

  // Approve handler
  const handleApproveConfirm = useCallback(
    async () => {
      if (!approveTarget) return;
      const { msg, body } = approveTarget;
      setApproving(msg.id);
      setApproveError(null);
      try {
        if (body.review_type === "procurement_transfer") {
          await approveRdProcurementTransfer(body.task_id);
          announceProcurementRefresh();
        } else {
          await updateRdTask(body.task_id, {
            _review_action: "approve",
            _reviewer_name: user?.name,
          } as Parameters<typeof updateRdTask>[1]);
        }
        await patchRdMessage(msg.id, { handled: true, read: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, handled: true, read: true } : m)),
        );
        window.dispatchEvent(new CustomEvent("rd:review-submitted"));
        toast.success(t("任务「{title}」审核已批准", { title: body.task_title }));
        setApproveTarget(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("操作失败");
        setApproveError(message);
        toast.error(message);
      } finally {
        setApproving(null);
      }
    },
    [approveTarget, user?.name],
  );

  // Reject handler
  const handleReject = useCallback(
    async (reason: string) => {
      if (!rejectTarget) return;
      const { msg, body } = rejectTarget;
      setRejecting(msg.id);
      setRejectError(null);
      try {
        if (body.review_type === "procurement_transfer") {
          await rejectRdProcurementTransfer(body.task_id, reason);
          announceProcurementRefresh();
        } else {
          await updateRdTask(body.task_id, {
            _review_action: "reject",
            _reviewer_name: user?.name,
            _reject_reason: reason,
          } as Parameters<typeof updateRdTask>[1]);
        }
        await patchRdMessage(msg.id, { handled: true, read: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, handled: true, read: true } : m)),
        );
        window.dispatchEvent(new CustomEvent("rd:review-submitted"));
        toast.success(t("任务「{title}」已打回", { title: body.task_title }));
        setRejectTarget(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("操作失败");
        setRejectError(message);
        toast.error(message);
      } finally {
        setRejecting(null);
      }
    },
    [rejectTarget, user?.name],
  );

  const filtersActive = filter !== "all" || Boolean(keyword.trim()) || sourceFilter.length > 0 || categoryFilter.length > 0;
  const clearFilters = () => {
    setKeyword("");
    setFilter("all");
    setSourceFilter([]);
    setCategoryFilter([]);
    setPage(1);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const closeSelfAssessDialog = () => {
    setSelfAssessReport(null);
    setSelfAssessMsgId(null);
    const trigger = selfAssessTriggerRef.current;
    selfAssessTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      else searchInputRef.current?.focus();
    });
  };

  return (
    <main className="horizon-theme hz-page min-w-0">
      <div className="hz-page-inner min-w-0 space-y-3">
        <HorizonPageHeader
          Icon={BellRing}
          eyebrow="WORK CENTER · MESSAGE INBOX"
          title={t("消息中心")}
          description={t("统一处理审核申请、审核结果、系统通知、讨论提及和绩效自评任务。")}
          meta={(
            <>
              <span>{canReview ? t("审核工作台") : t("个人收件箱")}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{loading && messages.length === 0 ? t("正在同步") : t("已加载 {n} 条", { n: messages.length })}</span>
            </>
          )}
          actions={(
            <Button type="button" variant="outline" onClick={() => void loadMessages()} disabled={loading}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {loading ? t("同步中…") : t("刷新消息")}
            </Button>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={MessageSquare} label={t("总消息")} value={loading && messages.length === 0 ? "—" : messages.length} note={hasMore ? t("已加载，仍有更早消息") : t("当前筛选范围内已全部加载")} tone="brand" />
          <HorizonMetric Icon={BellRing} label={t("未读")} value={loading && messages.length === 0 ? "—" : unreadCount} note={unreadCount > 0 ? t("需要查看或确认") : t("当前没有未读消息")} tone={unreadCount > 0 ? "warning" : "success"} />
          <HorizonMetric Icon={AlertTriangle} label={t("待审核")} value={loading && messages.length === 0 ? "—" : pendingReviewCount} note={canReview ? t("可在列表中直接处理") : t("当前账号仅可查看")} tone={pendingReviewCount > 0 ? "warning" : "neutral"} />
          <HorizonMetric Icon={CheckCircle2} label={t("已处理")} value={loading && messages.length === 0 ? "—" : handledCount} note={t("当前已加载消息统计")} tone="success" />
        </HorizonMetricGrid>

        {selfAssessLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#002fa7]" role="status" aria-live="polite">
            <Loader2 className="size-4" aria-hidden="true" />
            <span>{t("正在读取绩效报表，完成后将打开自评窗口…")}</span>
          </div>
        ) : null}

        <section className="hz-surface min-w-0 overflow-hidden" aria-labelledby="message-workbench-title">
          <HorizonSectionHeader
            Icon={MessageSquare}
            title={t("消息工作台")}
            description={t("筛选已加载消息，或按分类与来源向服务端重新读取完整范围。")}
            trailing={(
              <span className="text-xs text-slate-500">
                {t("显示")} <span className="font-semibold text-slate-700 tabular-nums">{filteredMessages.length}</span> / {messages.length}
              </span>
            )}
          />
          <h2 id="message-workbench-title" className="sr-only">{t("消息工作台")}</h2>

          <div className="grid min-w-0 gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1fr)_200px_auto] lg:items-end">
            <div className="min-w-0">
              <Label htmlFor="message-center-search" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("搜索消息")}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  id="message-center-search"
                  className="pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={t("标题、任务、人员、采购编号或正文")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="message-status-filter" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("消息状态")}</Label>
              <NativeSelect id="message-status-filter" className="w-full" value={filter} onChange={(event) => setFilter(event.target.value as FilterType)}>
                {(Object.keys(filterLabels) as FilterType[]).map((key) => <option key={key} value={key}>{t(filterLabels[key])}</option>)}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" onClick={clearFilters} disabled={!filtersActive}>
              <Filter className="size-4" aria-hidden="true" />
              {t("清除筛选")}
            </Button>
          </div>

          <div className="space-y-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
            <FilterChipRow
              label={t("分类")}
              options={CATEGORY_ORDER.map((value) => ({ value, label: t(RD_MESSAGE_CATEGORY_LABELS[value]) }))}
              selected={categoryFilter}
              onToggle={(value) => setCategoryFilter((previous) => toggleIn(previous, value))}
              onClear={() => setCategoryFilter([])}
            />
            <FilterChipRow
              label={t("来源")}
              options={SOURCE_ORDER.map((value) => ({ value, label: t(RD_MESSAGE_SOURCE_LABELS[value]) }))}
              selected={sourceFilter}
              onToggle={(value) => setSourceFilter((previous) => toggleIn(previous, value))}
              onClear={() => setSourceFilter([])}
            />
          </div>

          {loadError && messages.length > 0 ? (
            <div className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <p className="text-pretty text-xs text-amber-800">{loadError} {t("当前继续显示上一次成功加载的消息。")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadMessages()}>{t("重新读取")}</Button>
            </div>
          ) : null}

          <div className="min-w-0 p-3 sm:p-4" aria-busy={loading}>
            {loading && messages.length === 0 ? (
              <div className="space-y-3" role="status" aria-label={t("正在加载消息")}>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 bg-white p-4" aria-hidden="true">
                    <div className="flex gap-2"><span className="h-6 w-14 rounded-full bg-slate-100" /><span className="h-6 w-20 rounded-full bg-slate-100" /></div>
                    <div className="mt-3 h-4 w-2/3 rounded bg-slate-100" />
                    <div className="mt-2 h-3 w-full rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : loadError && messages.length === 0 ? (
              <HorizonEmptyState
                Icon={RefreshCw}
                title={t("消息读取失败")}
                description={loadError}
                action={<Button type="button" variant="outline" onClick={() => void loadMessages()}><RefreshCw className="size-4" aria-hidden="true" />{t("重新读取")}</Button>}
              />
            ) : filteredMessages.length === 0 ? (
              <HorizonEmptyState
                Icon={filtersActive ? Search : MessageSquare}
                title={filtersActive ? t("没有匹配的消息") : t("暂无消息")}
                description={filtersActive ? t("调整状态、分类、来源或关键词后重试。") : t("新审核、提及和系统通知会集中显示在这里。")}
                action={filtersActive ? <Button type="button" variant="outline" onClick={clearFilters}>{t("清除筛选")}</Button> : <Button type="button" variant="outline" onClick={() => void loadMessages()}>{t("刷新消息")}</Button>}
              />
            ) : (
              <div className="space-y-3" aria-live="polite">
                {pagedMessages.map((message) => {
                  const parsed = parseBody(message.body);
                  return (
                    <MessageCard
                      key={message.id}
                      msg={message}
                      canReview={parsed.type === "review_request" ? canReviewMessage(parsed) : canReview}
                      isApproving={approving === message.id}
                      onOpen={markMessageRead}
                      onApprove={requestApprove}
                      onReject={requestReject}
                      onSelfAssess={openSelfAssess}
                      onHandle={markMessageHandled}
                    />
                  );
                })}
              </div>
            )}

            {!loading && filteredMessages.length > 0 ? (
              <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4" aria-label={t("消息分页")}>
                <div className="text-xs text-slate-500 tabular-nums">{t("显示")} {visibleStart}-{visibleEnd} / {t("共 {n} 条", { n: filteredMessages.length })}</div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1} aria-label={t("上一页")}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <span className="min-w-16 px-2 text-center text-xs font-semibold text-slate-600 tabular-nums">{safePage} / {totalPages}</span>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages} aria-label={t("下一页")}>
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            ) : null}

            {!loading && hasMore && safePage === totalPages ? (
              <div className="mt-3 text-center">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadEarlier()} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="size-3.5" aria-hidden="true" /> : <Clock3 className="size-3.5" aria-hidden="true" />}
                  {loadingMore ? t("加载中…") : t("加载更早的消息")}
                </Button>
                {loadMoreError ? <p className="mt-2 text-pretty text-xs text-red-600" role="alert">{loadMoreError}</p> : null}
              </div>
            ) : null}
          </div>
        </section>

        {canReview ? (
          <aside className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#002fa7]" aria-hidden="true" />
            <p className="text-pretty text-sm leading-6 text-slate-700">{t("作为审核员，您可以直接批准或打回研发及转采购审核申请。打回时必须填写原因，申请人会收到处理结果。")}</p>
          </aside>
        ) : null}
      </div>

      {rejectTarget ? (
        <RejectDialog
          taskTitle={rejectTarget.body.task_title}
          submitting={rejecting === rejectTarget.msg.id}
          actionError={rejectError}
          onConfirm={handleReject}
          onClose={() => { if (!rejecting) { setRejectTarget(null); setRejectError(null); } }}
          onCloseAutoFocus={restoreDialogFocus}
        />
      ) : null}

      {approveTarget ? (
        <ApproveDialog
          taskTitle={approveTarget.body.task_title}
          taskId={approveTarget.body.review_type === "procurement_transfer" ? approveTarget.body.rd_task_id || approveTarget.body.procurement_code || approveTarget.body.task_id : approveTarget.body.task_id}
          reviewType={approveTarget.body.review_type}
          submitterName={approveTarget.body.submitter_name}
          pendingDueDate={approveTarget.body.pending_due_date}
          currentDueDate={approveTarget.body.current_due_date}
          submitting={approving === approveTarget.msg.id}
          actionError={approveError}
          onConfirm={handleApproveConfirm}
          onClose={() => { if (!approving) { setApproveTarget(null); setApproveError(null); } }}
          onCloseAutoFocus={restoreDialogFocus}
        />
      ) : null}

      <RDPerformanceScoreDialog
        open={Boolean(selfAssessReport)}
        onClose={closeSelfAssessDialog}
        report={selfAssessReport}
        mode="self"
        onSubmitted={() => {
          if (selfAssessMsgId) {
            void patchRdMessage(selfAssessMsgId, { handled: true, read: true })
              .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("绩效消息状态更新失败")));
          }
          void loadMessages();
        }}
      />
    </main>
  );
}
