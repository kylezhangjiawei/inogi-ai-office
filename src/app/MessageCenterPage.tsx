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
import { cn } from "./components/ui/utils";
import {
  fetchRdMessages,
  fetchRdPerformanceReports,
  parseRdDiscussionMention,
  patchRdMessage,
  rdDiscussionMentionHref,
  updateRdTask,
  type RdDiscussionMentionBody,
  type RdMessage,
  type RdPerformanceReport,
} from "./lib/rdApi";
import { RDPerformanceScoreDialog } from "./RDPerformanceScoreDialog";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { AutoTranslatedText } from "./components/TranslatableText";

// ── Parsed message body types ────────────────────────────────────────────────

type ReviewRequestBody = {
  type: "review_request";
  review_type: "result" | "collaboration" | "proposal" | "due_date" | "abandon";
  task_id: string;
  task_title: string;
  submitter_name: string;
  submitter_user_id?: string;
  note?: string;
  pending_collaborators?: Array<{ name: string; role?: string }>;
  current_progress?: number;
  pending_due_date?: string;
  current_due_date?: string;
};

type ReviewResultBody = {
  type: "review_result";
  result: "approved" | "rejected";
  task_id: string;
  task_title: string;
  reviewer_name: string;
  reason?: string;
};

type PerfSelfAssessmentBody = {
  type: "perf_self_assessment";
  report_id: string;
  month: string;
  period_label: string;
  user_name: string;
};

type ParsedBody =
  | ReviewRequestBody
  | ReviewResultBody
  | PerfSelfAssessmentBody
  | RdDiscussionMentionBody
  | { type: "unknown"; raw: string };

function parseBody(raw: string): ParsedBody {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.type === "review_request") return obj as unknown as ReviewRequestBody;
    if (obj.type === "review_result") return obj as unknown as ReviewResultBody;
    if (obj.type === "perf_self_assessment") return obj as unknown as PerfSelfAssessmentBody;
    if (obj.type === "discussion_mention") return parseRdDiscussionMention(raw) ?? { type: "unknown", raw };
    return { type: "unknown", raw };
  } catch {
    return { type: "unknown", raw };
  }
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
  reviewType: "result" | "collaboration" | "proposal" | "due_date" | "abandon";
  submitterName: string;
  pendingDueDate?: string;
  currentDueDate?: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useI18n();
  const reviewTypeLabel =
    reviewType === "collaboration"
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
              {reviewType === "collaboration"
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
    const reviewTypeLabel = rb.review_type === "collaboration" ? t("协作申请") : rb.review_type === "proposal" ? t("立项申请") : rb.review_type === "due_date" ? t("截止日期变更") : rb.review_type === "abandon" ? t("放弃任务") : t("成果提交");
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
            <span className={cn("material-chip", approved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
              {approved ? t("已批准") : t("已打回")}
            </span>
            <span className="material-chip bg-slate-100 text-slate-600">{t("审核结果")}</span>
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

        {rb.reason && (
          <p className={cn("rounded-lg px-3 py-2 text-sm ring-1", approved ? "bg-white/80 text-slate-600 ring-slate-200" : "bg-white/80 text-red-700 ring-red-200")}>
            <span className="font-medium">{approved ? t("备注：") : t("打回原因：")}</span><AutoTranslatedText text={rb.reason} />
          </p>
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
    ? user.permissions.includes("*") || user.permissions.includes("rd-task:edit") || user.permissions.includes("rd-task:reassign")
    : false;

  // Load messages
  const loadMessages = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await fetchRdMessages({ recipient_id: user.id, limit: 200 });
      // Sort newest first
      setMessages(data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("加载消息失败"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

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
      if (filter === "review_result" && parsed.type !== "review_result") return false;

      if (!q) return true;

      // Keyword search across subject and body content
      const searchText = [
        m.subject ?? "",
        m.body,
        parsed.type === "review_request" ? (parsed as ReviewRequestBody).task_title : "",
        parsed.type === "review_request" ? (parsed as ReviewRequestBody).submitter_name : "",
        parsed.type === "review_result" ? (parsed as ReviewResultBody).task_title : "",
        parsed.type === "review_result" ? (parsed as ReviewResultBody).reviewer_name : "",
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
        await updateRdTask(body.task_id, {
          _review_action: "approve",
          _reviewer_name: user?.name,
        } as Parameters<typeof updateRdTask>[1]);
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
        await updateRdTask(body.task_id, {
          _review_action: "reject",
          _reviewer_name: user?.name,
          _reject_reason: reason,
        } as Parameters<typeof updateRdTask>[1]);
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
            {pagedMessages.map((msg) => (
              <MessageCard
                key={msg.id}
                msg={msg}
                canReview={canReview}
                isApproving={approving === msg.id}
                onOpen={markMessageRead}
                onApprove={requestApprove}
                onReject={(m, b) => setRejectTarget({ msg: m, body: b })}
                onSelfAssess={openSelfAssess}
                onHandle={markMessageHandled}
              />
            ))}
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
          taskId={approveTarget.body.task_id}
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
