"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Clock3,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { fetchRdMessages, patchRdMessage, updateRdTask, type RdMessage } from "./lib/rdApi";

// ── Parsed message body types ────────────────────────────────────────────────

type ReviewRequestBody = {
  type: "review_request";
  review_type: "result" | "collaboration" | "proposal";
  task_id: string;
  task_title: string;
  submitter_name: string;
  submitter_user_id?: string;
  note?: string;
  pending_collaborators?: Array<{ name: string; role?: string }>;
  current_progress?: number;
};

type ReviewResultBody = {
  type: "review_result";
  result: "approved" | "rejected";
  task_id: string;
  task_title: string;
  reviewer_name: string;
  reason?: string;
};

type ParsedBody = ReviewRequestBody | ReviewResultBody | { type: "unknown"; raw: string };

function parseBody(raw: string): ParsedBody {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.type === "review_request") return obj as unknown as ReviewRequestBody;
    if (obj.type === "review_result") return obj as unknown as ReviewResultBody;
    return { type: "unknown", raw };
  } catch {
    return { type: "unknown", raw };
  }
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
        <h3 className="text-base font-bold text-slate-900">打回审核</h3>
        <p className="mt-1 text-sm text-slate-500">
          任务：<span className="font-medium text-slate-700">{taskTitle}</span>
        </p>
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700">打回原因 <span className="text-red-500">*</span></label>
          <textarea
            ref={textareaRef}
            className="material-input mt-1.5 min-h-[100px] resize-y"
            placeholder="请填写打回原因，申请人将收到通知..."
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
            取消
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
          >
            确认打回
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
  submitting,
  onConfirm,
  onClose,
}: {
  taskTitle: string;
  taskId: string;
  reviewType: "result" | "collaboration" | "proposal";
  submitterName: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const reviewTypeLabel = reviewType === "collaboration" ? "协作变更审核" : reviewType === "proposal" ? "立项审核" : "成果审核";

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
          aria-label="关闭确认弹窗"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h3 id="message-center-approve-title" className="text-base font-bold text-slate-900">确认审核通过</h3>
              <p className="mt-1 text-sm text-slate-500">{reviewTypeLabel}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 px-6 py-5">
          <p className="text-sm leading-6 text-slate-700">
            确认通过「<span className="font-semibold text-slate-900">{taskTitle}</span>」？
          </p>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
            <div>任务编号：{taskId}</div>
            <div>提交人：{submitterName || "未识别"}</div>
            <div>
              {reviewType === "collaboration"
                ? "通过后协作变更会立即生效，并通知申请人员。"
                : reviewType === "proposal"
                ? "通过后任务将正式立项并进入进行中状态，同时通知发起人。"
                : "通过后任务会进入审核通过状态，并通知对应申请人员。"}
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
            再看看
          </button>
          <button
            type="button"
            disabled={submitting}
            className="inline-flex min-w-[100px] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onConfirm}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
            {submitting ? "处理中" : "确认通过"}
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
}: {
  msg: RdMessage;
  canReview: boolean;
  isApproving: boolean;
  onOpen: (msg: RdMessage) => void;
  onApprove: (msg: RdMessage, body: ReviewRequestBody) => void;
  onReject: (msg: RdMessage, body: ReviewRequestBody) => void;
}) {
  const body = useMemo(() => parseBody(msg.body), [msg.body]);

  const timeLabel = useMemo(() => {
    try {
      const d = new Date(msg.created_at);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "刚刚";
      if (mins < 60) return `${mins} 分钟前`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} 小时前`;
      const days = Math.floor(hours / 24);
      if (days === 1) return "昨天";
      if (days < 7) return `${days} 天前`;
      return d.toLocaleDateString("zh-CN");
    } catch {
      return "";
    }
  }, [msg.created_at]);

  if (body.type === "review_request") {
    const rb = body;
    const reviewTypeLabel = rb.review_type === "collaboration" ? "协作申请" : rb.review_type === "proposal" ? "立项申请" : "成果提交";
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
              {msg.read ? "已读" : "未读"}
            </span>
            <span className="material-chip bg-blue-100 text-blue-700">审核申请</span>
            <span className={cn("material-chip", rb.review_type === "collaboration" ? "bg-purple-50 text-purple-700" : rb.review_type === "proposal" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700")}>
              {reviewTypeLabel}
            </span>
            {!msg.read && !isHandled && (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="未读" />
            )}
            {isHandled && (
              <span className="material-chip bg-emerald-50 text-emerald-600">已处理</span>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>

        <div className="mb-1 font-semibold text-slate-900">{rb.task_title}</div>
        <div className="mb-3 text-sm text-slate-600">
          <span className="text-slate-500">提交人：</span>{rb.submitter_name}
          {rb.review_type === "result" && typeof rb.current_progress === "number" && (
            <span className="ml-3 text-slate-500">完成度：<span className="font-medium text-slate-700">{rb.current_progress}%</span></span>
          )}
        </div>

        {rb.note && (
          <p className="mb-3 rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
            {rb.note}
          </p>
        )}

        {Array.isArray(rb.pending_collaborators) && rb.pending_collaborators.length > 0 && (
          <div className="mb-3 text-sm text-slate-600">
            <span className="text-slate-500">申请协作者：</span>
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
                ? <><Loader2 className="h-4 w-4 animate-spin" />处理中</>
                : <><ThumbsUp className="h-4 w-4" />批准</>
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
              打回
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
              {msg.read ? "已读" : "未读"}
            </span>
            <span className={cn("material-chip", approved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
              {approved ? "已批准" : "已打回"}
            </span>
            <span className="material-chip bg-slate-100 text-slate-600">审核结果</span>
            {!msg.read && (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="未读" />
            )}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
        </div>

        <div className="mb-1 font-semibold text-slate-900">{rb.task_title}</div>
        <div className="mb-2 text-sm text-slate-600">
          <span className="text-slate-500">审核人：</span>{rb.reviewer_name}
        </div>

        {rb.reason && (
          <p className={cn("rounded-lg px-3 py-2 text-sm ring-1", approved ? "bg-white/80 text-slate-600 ring-slate-200" : "bg-white/80 text-red-700 ring-red-200")}>
            <span className="font-medium">{approved ? "备注：" : "打回原因："}</span>{rb.reason}
          </p>
        )}
      </article>
    );
  }

  // Unknown / plain text message
  const rb = body as { type: "unknown"; raw: string };
  return (
    <article
      className="cursor-pointer rounded-2xl border border-slate-100 bg-white p-5"
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
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("material-chip", msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600")}>
            {msg.read ? "已读" : "未读"}
          </span>
          <span className="material-chip bg-slate-100 text-slate-600">系统消息</span>
          {!msg.read && (
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="未读" />
          )}
        </div>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <Clock3 className="h-3.5 w-3.5" />
          {timeLabel}
        </span>
      </div>
      {msg.subject && <div className="mb-1 font-semibold text-slate-900">{msg.subject}</div>}
      <p className="text-sm text-slate-600">{rb.raw || msg.body}</p>
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

export function MessageCenterPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<RdMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  // Reject dialog state
  const [rejectTarget, setRejectTarget] = useState<{ msg: RdMessage; body: ReviewRequestBody } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ msg: RdMessage; body: ReviewRequestBody } | null>(null);
  const [approving, setApproving] = useState<string | null>(null); // message id being approved

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
      toast.error(err instanceof Error ? err.message : "加载消息失败");
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
    () =>
      messages.filter((m) => {
        if (m.handled) return false;
        try {
          const b = JSON.parse(m.body) as Record<string, unknown>;
          return b.type === "review_request";
        } catch {
          return false;
        }
      }).length,
    [messages],
  );

  const markMessageRead = useCallback((msg: RdMessage) => {
    if (msg.read) return;
    setMessages((prev) => prev.map((item) => (item.id === msg.id ? { ...item, read: true } : item)));
    void patchRdMessage(msg.id, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {});
  }, []);

  // Filtered messages
  const filteredMessages = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return messages.filter((m) => {
      const parsed = parseBody(m.body);
      // Filter tab
      if (filter === "unread" && m.read) return false;
      if (filter === "review_request" && parsed.type !== "review_request") return false;
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
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(q);
    });
  }, [messages, filter, keyword]);

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
        toast.success(`任务「${body.task_title}」审核已批准`);
        setApproveTarget(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败");
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
        toast.success(`任务「${body.task_title}」已打回`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败");
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
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">消息中心</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              汇总审核申请、审核结果和系统通知，管理员可在此直接批准或打回审核请求。
            </p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3">
            {[
              { label: "未读", value: unreadCount, Icon: BellRing, tone: "text-blue-600" },
              { label: "待审核", value: pendingReviewCount, Icon: AlertTriangle, tone: "text-amber-500" },
              { label: "共计", value: messages.length, Icon: MessageSquare, tone: "text-slate-600" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                <item.Icon className={cn("mb-2 h-4 w-4", item.tone)} />
                <div className="text-xl font-bold text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500">{item.label}</div>
              </div>
            ))}
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
              placeholder="搜索消息标题、任务名称..."
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
                <option key={k} value={k}>{filterLabels[k]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => void loadMessages()}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
          </button>
        </div>

        {/* Message list */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {messages.length === 0 ? "暂无消息" : "没有匹配的消息"}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMessages.map((msg) => (
              <MessageCard
                key={msg.id}
                msg={msg}
                canReview={canReview}
                isApproving={approving === msg.id}
                onOpen={markMessageRead}
                onApprove={requestApprove}
                onReject={(m, b) => setRejectTarget({ msg: m, body: b })}
              />
            ))}
          </div>
        )}
      </section>

      {canReview && (
        <section className="material-card-flat flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-500 shrink-0" />
          <p className="text-sm leading-6 text-slate-600">
            作为审核员，您可以在此直接批准或打回研发团队提交的审核申请。打回时请填写原因，申请人将收到通知。
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
          submitting={approving === approveTarget.msg.id}
          onConfirm={handleApproveConfirm}
          onClose={() => {
            if (!approving) setApproveTarget(null);
          }}
        />
      )}
    </div>
  );
}
