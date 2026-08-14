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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "./auth";
import { Button } from "./components/ui/button";
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
  return <span className="material-chip bg-slate-100 text-slate-600">{t(label)}</span>;
}

/** “待审核”在统计卡片和列表筛选中必须使用完全相同的口径。 */
function isPendingReviewMessage(message: RdMessage): boolean {
  return message.handled !== true && parseBody(message.body).type === "review_request";
}

// ── Reject reason dialog ─────────────────────────────────────────────────────

function RejectDialog({
  taskTitle,
  onConfirm,
  onClose,
}: {
  taskTitle: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  useI18n();
  const [reason, setReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="text-base font-bold text-slate-900">{t("打回审核")}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {t("任务：")}<AutoTranslatedText className="font-medium text-slate-700" text={taskTitle} />
        </p>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700">{t("打回原因")} <span className="text-red-500">*</span></label>
          <textarea
            ref={textareaRef}
            className="material-input mt-1.5 min-h-[100px] resize-y"
            placeholder={t("请填写打回原因，申请人将收到通知...")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
          >
            {t("确认打回")}
          </button>
        </div>
      </div>
    </div>
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
  onConfirm,
  onClose,
}: {
  taskTitle: string;
  taskId: string;
  reviewType: "result" | "collaboration" | "proposal" | "due_date" | "abandon" | "procurement_transfer";
  submitterName: string;
  pendingDueDate?: string;
  currentDueDate?: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
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
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={submitting ? undefined : onClose}>
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-center-approve-title"
      >
        <button
          type="button"
          disabled={submitting}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onClose}
          aria-label={t("关闭确认弹窗")}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h3 id="message-center-approve-title" className="text-base font-bold text-slate-900">{t("确认审核通过")}</h3>
              <p className="mt-1 text-sm text-slate-500">{reviewTypeLabel}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 px-6 py-5">
          <p className="text-sm leading-6 text-slate-700">
            {t("确认通过「")}<AutoTranslatedText className="font-semibold text-slate-900" text={taskTitle} />{t("」？")}
          </p>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            <div>{t("任务编号：")}{taskId}</div>
            <div>{t("提交人：")}{submitterName || t("未识别")}</div>
            {reviewType === "due_date" && pendingDueDate && (
              <div>{t("截止日期：")}{currentDueDate || t("未设置")} → {pendingDueDate}</div>
            )}
            <div>
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
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClose}
          >
            {t("再看看")}
          </button>
          <button
            type="button"
            disabled={submitting}
            className="inline-flex min-w-[100px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onConfirm}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
            {submitting ? t("处理中") : t("确认通过")}
          </button>
        </div>
      </div>
    </div>
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
  onApprove: (msg: RdMessage, body: ReviewRequestBody) => void;
  onReject: (msg: RdMessage, body: ReviewRequestBody) => void;
  onSelfAssess: (msg: RdMessage, body: PerfSelfAssessmentBody) => void;
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
      <article className="rounded-xl border border-indigo-100 bg-indigo-50/35 p-4 shadow-[0_4px_18px_rgba(79,70,229,0.05)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-indigo-600 text-white")}>
            {msg.read ? t("已读") : t("提及你")}
          </span>
          <span className="material-chip bg-white text-indigo-700 ring-1 ring-indigo-100">{t("受邀参与")}</span>
          {msg.handled && <span className="material-chip bg-emerald-50 text-emerald-700">{t("已处理")}</span>}
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>
        <div className="mt-2 text-sm font-bold text-slate-900">{body.task_title}</div>
        <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-700">
          <span className="font-semibold text-indigo-700">{body.actor_name}</span>
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
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
          >
            {t("查看并回复")}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          {!msg.handled && (
            <button
              type="button"
              onClick={() => onHandle(msg)}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
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
        className={cn("cursor-pointer rounded-2xl border p-5 transition-colors", isHandled ? "border-slate-100 bg-slate-50/60" : "border-blue-100 bg-blue-50/40")}
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
            <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className="material-chip bg-blue-100 text-blue-700">{t("审核申请")}</span>
            <span className={cn("material-chip", rb.review_type === "collaboration" ? "bg-purple-50 text-purple-700" : rb.review_type === "proposal" ? "bg-indigo-50 text-indigo-700" : rb.review_type === "due_date" ? "bg-sky-50 text-sky-700" : rb.review_type === "abandon" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>
              {reviewTypeLabel}
            </span>
            {!msg.read && !isHandled && (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />
            )}
            {isHandled && (
              <span className="material-chip bg-emerald-50 text-emerald-600">{t("已处理")}</span>
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
          <div className="mb-3 grid gap-2 rounded-xl border border-violet-100 bg-white/90 p-3 text-xs text-slate-600 sm:grid-cols-2">
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
              className="inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.stopPropagation();
                onApprove(msg, rb);
              }}
            >
              {isApproving
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t("处理中")}</>
                : <><ThumbsUp className="h-4 w-4" />{t("批准")}</>
              }
            </button>
            <button
              type="button"
              className="inline-flex min-w-[90px] items-center justify-center gap-1.5 rounded-lg border-2 border-red-500 bg-white px-5 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50"
              onClick={(event) => {
                event.stopPropagation();
                onReject(msg, rb);
              }}
            >
              <ThumbsDown className="h-4 w-4" />
              {t("打回")}
            </button>
          </div>
        )}
        {rb.review_type === "procurement_transfer" && rb.rd_task_id && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
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
      <article className={cn("rounded-2xl border bg-white p-5", approved ? "border-emerald-200" : "border-red-200")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
            {msg.read ? t("已读") : t("未读")}
          </span>
          <SourceChip source={msg.source} />
          <span className={cn("material-chip", approved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
            {approved ? t("审核通过") : t("审核打回")}
          </span>
          <span className="material-chip bg-slate-100 text-slate-600">{t("转采购审核")}</span>
          {msg.handled && <span className="material-chip bg-slate-100 text-slate-500">{t("已处理")}</span>}
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
      <article className="rounded-2xl border border-indigo-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>{msg.read ? t("已读") : t("未读")}</span>
          <SourceChip source={msg.source} />
          <span className="material-chip bg-indigo-100 text-indigo-700">{t("新任务分配")}</span>
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
        <AutoTranslatedText as="p" className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800" text={body.next_action} />
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
        className={cn("cursor-pointer rounded-2xl border p-5", approved ? "border-emerald-100 bg-emerald-50/40" : "border-red-100 bg-red-50/40")}
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
            <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className={cn("material-chip", approved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
              {approved ? t("已批准") : t("已打回")}
            </span>
            <span className="material-chip bg-slate-100 text-slate-600">
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
          <div className="mb-3 grid gap-2 rounded-xl border border-violet-100 bg-white/90 p-3 text-xs text-slate-600 sm:grid-cols-2">
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
        className={cn("cursor-pointer rounded-2xl border p-5 transition-colors", isHandled ? "border-slate-100 bg-slate-50/60" : "border-violet-100 bg-violet-50/40")}
        onClick={() => onSelfAssess(msg, pb)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelfAssess(msg, pb);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
              {msg.read ? t("已读") : t("未读")}
            </span>
            <SourceChip source={msg.source} />
            <span className="material-chip bg-violet-100 text-violet-700">{t("绩效自评")}</span>
            {!msg.read && !isHandled && <span className="inline-block h-2 w-2 rounded-full bg-red-500" title={t("未读")} />}
            {isHandled && <span className="material-chip bg-emerald-50 text-emerald-600">{t("已提交")}</span>}
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
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700"
            onClick={(event) => {
              event.stopPropagation();
              onSelfAssess(msg, pb);
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
        "cursor-pointer rounded-2xl border bg-white p-5 transition-colors",
        videoJump ? "border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/40" : "border-slate-100",
      )}
      onClick={() => (videoJump ? openVideo() : onOpen(msg))}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (videoJump) openVideo();
          else onOpen(msg);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
            {msg.read ? t("已读") : t("未读")}
          </span>
          <SourceChip source={msg.source} />
          <span className="material-chip bg-slate-100 text-slate-600">{t("系统消息")}</span>
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
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-8 shrink-0 text-xs font-medium text-slate-400">{label}</span>
      <button
        type="button"
        onClick={onClear}
        className={cn(
          "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
          selected.length === 0
            ? "border-blue-200 bg-blue-50 font-semibold text-blue-700"
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
            "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
            selected.includes(option.value)
              ? "border-blue-200 bg-blue-50 font-semibold text-blue-700"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
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
  const [loadingMore, setLoadingMore] = useState(false);
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

  // 绩效自评弹窗状态
  const [selfAssessReport, setSelfAssessReport] = useState<RdPerformanceReport | null>(null);
  const [selfAssessLoading, setSelfAssessLoading] = useState(false);
  const [selfAssessMsgId, setSelfAssessMsgId] = useState<string | null>(null);

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
    setLoading(true);
    try {
      const data = await fetchRdMessages({
        recipient_id: user.id,
        limit: MESSAGE_FETCH_SIZE,
        source: sourceFilter,
        category: categoryFilter,
      });
      // Sort newest first
      setMessages(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setHasMore(data.length === MESSAGE_FETCH_SIZE);
      setPage(1); // 换筛选条件后停在旧页码会显示空列表
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("加载消息失败"));
    } finally {
      setLoading(false);
    }
  }, [user?.id, sourceFilter, categoryFilter]);

  // 翻更早的一页：游标取当前最后一条的 (created_at, id)。
  // 表化前这里是一次性拉 200 条封顶，再早的历史在界面上根本够不着。
  const loadEarlier = useCallback(async () => {
    if (!user?.id) return;
    const oldest = messages[messages.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
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
      toast.error(err instanceof Error ? err.message : t("加载更早消息失败"));
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

  const markMessageRead = useCallback((msg: RdMessage) => {
    if (msg.read) return;
    setMessages((prev) => prev.map((item) => (item.id === msg.id ? { ...item, read: true } : item)));
    void patchRdMessage(msg.id, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {});
  }, []);

  const markMessageHandled = useCallback((msg: RdMessage) => {
    setMessages((prev) => prev.map((item) => (
      item.id === msg.id ? { ...item, read: true, handled: true } : item
    )));
    void patchRdMessage(msg.id, { read: true, handled: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {
        setMessages((prev) => prev.map((item) => (
          item.id === msg.id ? { ...item, handled: msg.handled, read: msg.read } : item
        )));
      });
  }, []);

  // 打开绩效自评：先标已读，按消息携带的月份拉取本人当月绩效，再开评分弹窗。
  const openSelfAssess = useCallback(
    async (msg: RdMessage, body: PerfSelfAssessmentBody) => {
      markMessageRead(msg);
      if (!user?.id) return;
      setSelfAssessMsgId(msg.id);
      setSelfAssessLoading(true);
      try {
        const list = await fetchRdPerformanceReports({ user_id: user.id, month: body.month, limit: 1 });
        const r = list[0] ?? null;
        if (!r) {
          toast.error(t("未找到对应的绩效报表，可能已被重新生成"));
          return;
        }
        setSelfAssessReport(r);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("读取绩效失败，请稍后重试"));
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

  const requestApprove = useCallback((msg: RdMessage, body: ReviewRequestBody) => {
    setApproveTarget({ msg, body });
  }, []);

  // Approve handler
  const handleApproveConfirm = useCallback(
    async () => {
      if (!approveTarget) return;
      const { msg, body } = approveTarget;
      setApproving(msg.id);
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
        toast.error(err instanceof Error ? err.message : t("操作失败"));
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
      setRejectTarget(null);
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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("操作失败"));
      }
    },
    [rejectTarget, user?.name],
  );

  return (
    <div className="space-y-5">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Message Center</span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">{t("消息中心")}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {t("汇总审核申请、审核结果和系统通知，管理员可在此直接批准或打回审核请求。")}
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2.5 sm:w-auto">
            {([
              { label: "未读", value: unreadCount, Icon: BellRing, filterValue: "unread" as FilterType, iconCls: "bg-blue-50 text-blue-600 group-hover:bg-blue-100", activeCls: "border-blue-300 bg-blue-50/70 ring-1 ring-blue-200" },
              { label: "待审核", value: pendingReviewCount, Icon: AlertTriangle, filterValue: "review_request" as FilterType, iconCls: "bg-amber-50 text-amber-600 group-hover:bg-amber-100", activeCls: "border-amber-300 bg-amber-50/70 ring-1 ring-amber-200" },
              { label: "共计", value: messages.length, Icon: MessageSquare, filterValue: "all" as FilterType, iconCls: "bg-slate-100 text-slate-500 group-hover:bg-slate-200", activeCls: "border-slate-300 bg-slate-50 ring-1 ring-slate-200" },
            ]).map((item) => {
              const active = filter === item.filterValue;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setFilter((cur) => (cur === item.filterValue ? "all" : item.filterValue))}
                  aria-pressed={active}
                  title={t("按「{label}」筛选列表", { label: t(item.label) })}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60 sm:min-w-[118px]",
                    active ? item.activeCls : "border-slate-200/80 bg-white shadow-sm hover:border-slate-300",
                  )}
                >
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors", item.iconCls)}>
                    <item.Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-2xl font-bold leading-none tabular-nums text-slate-900">{item.value}</span>
                    <span className="mt-1 block text-[11px] font-medium text-slate-500">{t(item.label)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="material-card p-5 md:p-6">
        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative block flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("搜索消息标题、任务名称...")}
            />
          </label>
          <label className="relative block w-[180px]">
            <Filter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select
              className="material-input cursor-pointer appearance-none pl-11"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
            >
              {(Object.keys(filterLabels) as FilterType[]).map((k) => (
                <option key={k} value={k}>{t(filterLabels[k])}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => void loadMessages()}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("刷新")}
          </button>
        </div>

        {/* 来源 / 分类筛选：走服务端，对全部历史生效，不只是已加载的这一页 */}
        <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-4">
          <FilterChipRow
            label={t("分类")}
            options={CATEGORY_ORDER.map((value) => ({ value, label: t(RD_MESSAGE_CATEGORY_LABELS[value]) }))}
            selected={categoryFilter}
            onToggle={(value) => setCategoryFilter((prev) => toggleIn(prev, value))}
            onClear={() => setCategoryFilter([])}
          />
          <FilterChipRow
            label={t("来源")}
            options={SOURCE_ORDER.map((value) => ({ value, label: t(RD_MESSAGE_SOURCE_LABELS[value]) }))}
            selected={sourceFilter}
            onToggle={(value) => setSourceFilter((prev) => toggleIn(prev, value))}
            onClear={() => setSourceFilter([])}
          />
        </div>

        {/* Message list */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("加载中...")}</span>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {messages.length === 0 ? t("暂无消息") : t("没有匹配的消息")}
          </div>
        ) : (
          <div className="space-y-3">
            {pagedMessages.map((msg) => {
              const parsed = parseBody(msg.body);
              return (
                <MessageCard
                  key={msg.id}
                  msg={msg}
                  canReview={parsed.type === "review_request" ? canReviewMessage(parsed) : canReview}
                  isApproving={approving === msg.id}
                  onOpen={markMessageRead}
                  onApprove={requestApprove}
                  onReject={(m, b) => setRejectTarget({ msg: m, body: b })}
                  onSelfAssess={openSelfAssess}
                  onHandle={markMessageHandled}
                />
              );
            })}
          </div>
        )}

        {/* 分页 */}
        {!loading && filteredMessages.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-xs tabular-nums text-slate-500">
              {t("显示")} {visibleStart}-{visibleEnd}
              <span className="mx-1 text-slate-300">/</span>
              {t("共 {n} 条", { n: filteredMessages.length })}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage === 1}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={t("上一页")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[64px] px-2 text-center text-xs font-semibold tabular-nums text-slate-600">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage === totalPages}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={t("下一页")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* 翻到已加载集合的末尾后，才向服务端再要更早的一页 */}
        {!loading && hasMore && safePage === totalPages && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => { void loadEarlier(); }}
              disabled={loadingMore}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
              {loadingMore ? t("加载中...") : t("加载更早的消息")}
            </button>
          </div>
        )}
      </section>

      {canReview && (
        <section className="material-card-flat flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-500 shrink-0" />
          <p className="text-sm leading-6 text-slate-600">
            {t("作为审核员，您可以在此直接批准或打回研发团队提交的审核申请。打回时请填写原因，申请人将收到通知。")}
          </p>
        </section>
      )}

      {/* Reject reason dialog */}
      {rejectTarget && (
        <RejectDialog
          taskTitle={rejectTarget.body.task_title}
          onConfirm={handleReject}
          onClose={() => setRejectTarget(null)}
        />
      )}
      {approveTarget && (
        <ApproveDialog
          taskTitle={approveTarget.body.task_title}
          taskId={approveTarget.body.review_type === "procurement_transfer"
            ? approveTarget.body.rd_task_id || approveTarget.body.procurement_code || approveTarget.body.task_id
            : approveTarget.body.task_id}
          reviewType={approveTarget.body.review_type}
          submitterName={approveTarget.body.submitter_name}
          pendingDueDate={approveTarget.body.pending_due_date}
          currentDueDate={approveTarget.body.current_due_date}
          submitting={approving === approveTarget.msg.id}
          onConfirm={handleApproveConfirm}
          onClose={() => {
            if (!approving) setApproveTarget(null);
          }}
        />
      )}

      {/* 拉取绩效中的轻提示 */}
      {selfAssessLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40">
          <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("正在读取绩效…")}
          </div>
        </div>
      )}

      {/* 绩效自评弹窗 */}
      <RDPerformanceScoreDialog
        open={!!selfAssessReport}
        onClose={() => {
          setSelfAssessReport(null);
          setSelfAssessMsgId(null);
        }}
        report={selfAssessReport}
        mode="self"
        onSubmitted={() => {
          if (selfAssessMsgId) {
            void patchRdMessage(selfAssessMsgId, { handled: true, read: true })
              .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
              .catch(() => {});
          }
          void loadMessages();
        }}
      />
    </div>
  );
}
