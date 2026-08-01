import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircleMore, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { RDTaskConversation, type RdFocusedDiscussionAnchor } from "./RDTaskConversation";
import { patchRdMessage, type RdDiscussionAnchorType } from "./lib/rdApi";
import { t, useI18n } from "./lib/i18n";

function parseAnchorType(value: string | null): RdDiscussionAnchorType {
  if (value === "progress_note" || value === "message") return value;
  return "task";
}

export function RDDiscussionInvitePage() {
  useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { taskId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [handled, setHandled] = useState(false);
  const mobile = location.pathname.startsWith("/m/") || location.pathname.startsWith("/us-collab-m/");
  const anchorType = parseAnchorType(searchParams.get("anchor_type"));
  const anchorId = searchParams.get("anchor_id");
  const notificationId = searchParams.get("notification_id");
  const focusMessageId = searchParams.get("message_id");
  const taskTitle = searchParams.get("task_title") || taskId;
  const inviterName = searchParams.get("actor_name") || t("任务成员");

  const focusAnchor = useMemo<RdFocusedDiscussionAnchor>(() => ({
    type: anchorType,
    id: anchorId,
    author: inviterName,
    preview: searchParams.get("excerpt") || "",
    createdAt: searchParams.get("created_at") || undefined,
  }), [anchorId, anchorType, inviterName, searchParams]);

  useEffect(() => {
    if (!notificationId) return;
    void patchRdMessage(notificationId, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {});
  }, [notificationId]);

  const markHandled = useCallback(() => {
    if (!notificationId || handled) return;
    setHandled(true);
    void patchRdMessage(notificationId, { handled: true, read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => setHandled(false));
  }, [handled, notificationId]);

  const close = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(mobile ? (location.pathname.startsWith("/us-collab") ? "/us-collab-m" : "/m") : "/message-center");
  };

  const title = anchorType === "progress_note"
    ? t("关于这条进度的讨论")
    : anchorType === "message"
      ? t("消息讨论")
      : t("任务讨论");

  return (
    <div className={mobile ? "flex h-full min-h-0 flex-col bg-white" : "flex h-full min-h-[620px] flex-col p-4 lg:p-5"}>
      <section className={mobile
        ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
        : "mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
      }>
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2.5 sm:px-3.5">
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label={t("返回")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <MessageCircleMore className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-bold text-slate-900">{title}</h1>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold text-indigo-700">
                {t("受邀参与")}
              </span>
            </div>
            <p className="truncate text-[10px] text-slate-500">{taskTitle}</p>
          </div>
          <span className="hidden items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 sm:inline-flex">
            <ShieldCheck className="h-3 w-3" />
            {t("仅限本线程")}
          </span>
        </header>

        <RDTaskConversation
          taskId={taskId}
          taskTitle={taskTitle}
          notes={[]}
          mode="task"
          variant={mobile ? "mobile" : "desktop"}
          showHeader={false}
          threadLayout="replace"
          focusAnchor={focusAnchor}
          focusMessageId={focusMessageId}
          onMessageSent={markHandled}
          onCloseFocus={close}
          className="min-h-0 flex-1"
        />
      </section>
    </div>
  );
}

export default RDDiscussionInvitePage;
