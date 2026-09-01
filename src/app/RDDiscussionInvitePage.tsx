import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, MessageCircleMore, RefreshCw, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { HorizonEmptyState, HorizonPageHeader } from "./components/horizon/HorizonPage";
import { cn } from "./components/ui/utils";
import { RDTaskConversation, type RdFocusedDiscussionAnchor } from "./RDTaskConversation";
import { patchRdMessage, type RdDiscussionAnchorType } from "./lib/rdApi";
import { t, useI18n } from "./lib/i18n";

function parseAnchorType(value: string | null): RdDiscussionAnchorType {
  if (value === "progress_note" || value === "message") return value;
  return "task";
}

type NotificationSyncMode = "read" | "handled";

type NotificationSyncError = {
  mode: NotificationSyncMode;
  message: string;
};

export function RDDiscussionInvitePage() {
  useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { taskId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [handled, setHandled] = useState(false);
  const [notificationError, setNotificationError] = useState<NotificationSyncError | null>(null);
  const [notificationRetrying, setNotificationRetrying] = useState(false);
  const mountedRef = useRef(true);
  const mobile = location.pathname.startsWith("/m/") || location.pathname.startsWith("/us-collab-m/");
  const usCollab = location.pathname.startsWith("/us-collab");
  const anchorType = parseAnchorType(searchParams.get("anchor_type"));
  const anchorId = searchParams.get("anchor_id");
  const notificationId = searchParams.get("notification_id");
  const notificationContextKey = `${usCollab ? "us-collab" : "rd"}:${notificationId ?? ""}`;
  const notificationContextRef = useRef(notificationContextKey);
  const notificationSyncSeqRef = useRef(0);
  notificationContextRef.current = notificationContextKey;
  const focusMessageId = searchParams.get("message_id");
  const taskTitle = searchParams.get("task_title") || taskId || t("未指定任务");
  const inviterName = searchParams.get("actor_name") || t("任务成员");

  const focusAnchor = useMemo<RdFocusedDiscussionAnchor>(() => ({
    type: anchorType,
    id: anchorId,
    author: inviterName,
    preview: searchParams.get("excerpt") || "",
    createdAt: searchParams.get("created_at") || undefined,
  }), [anchorId, anchorType, inviterName, searchParams]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncNotification = useCallback(async (mode: NotificationSyncMode): Promise<boolean> => {
    if (!notificationId) return true;
    const expectedContext = notificationContextKey;
    const requestSeq = ++notificationSyncSeqRef.current;
    if (mountedRef.current) setNotificationError(null);
    try {
      await patchRdMessage(notificationId, mode === "handled"
        ? { handled: true, read: true }
        : { read: true });
      if (!mountedRef.current || requestSeq !== notificationSyncSeqRef.current || notificationContextRef.current !== expectedContext) return false;
      window.dispatchEvent(new CustomEvent("rd:messages-updated"));
      return true;
    } catch (error) {
      if (mountedRef.current && requestSeq === notificationSyncSeqRef.current && notificationContextRef.current === expectedContext) {
        setNotificationError({
          mode,
          message: error instanceof Error
            ? error.message
            : t(mode === "handled" ? "讨论已发送，但通知处理状态同步失败" : "通知已读状态同步失败"),
        });
      }
      return false;
    }
  }, [notificationContextKey, notificationId]);

  useEffect(() => {
    notificationSyncSeqRef.current += 1;
    setHandled(false);
    setNotificationError(null);
    setNotificationRetrying(false);
  }, [notificationContextKey]);

  useEffect(() => {
    if (!notificationId) return;
    void syncNotification("read");
  }, [notificationId, syncNotification]);

  const markHandled = useCallback(() => {
    if (!notificationId || handled) return;
    setHandled(true);
    void syncNotification("handled").then((success) => {
      if (!success && mountedRef.current) setHandled(false);
    });
  }, [handled, notificationId, syncNotification]);

  const retryNotificationSync = useCallback(async () => {
    if (!notificationError || notificationRetrying) return;
    setNotificationRetrying(true);
    const success = await syncNotification(notificationError.mode);
    if (success && notificationError.mode === "handled" && mountedRef.current) setHandled(true);
    if (mountedRef.current) setNotificationRetrying(false);
  }, [notificationError, notificationRetrying, syncNotification]);

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
    <div className={cn(
      "horizon-theme hz-page min-w-0",
      mobile
        ? "flex min-h-[70dvh] flex-col bg-white pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        : "rd-horizon-module rd-horizon-discussion flex h-full min-h-[620px] flex-col gap-4 p-4 lg:p-5",
    )}>
      {mobile ? (
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2.5 py-2 sm:px-3.5">
          <button
            type="button"
            onClick={close}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label={t("返回")}
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#002fa7] text-white" aria-hidden="true">
            <MessageCircleMore className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-bold text-slate-900">{title}</h1>
              <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#002fa7]">
                {t("受邀参与")}
              </span>
            </div>
            <p className="truncate text-xs text-slate-500">{taskTitle}</p>
          </div>
          <span className="hidden items-center gap-1 text-xs font-semibold text-[#002fa7] sm:inline-flex">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {t("仅限本线程")}
          </span>
        </header>
      ) : (
        <HorizonPageHeader
          Icon={MessageCircleMore}
          eyebrow={usCollab ? t("中美协同 · 任务线程") : t("研发协作 · 任务线程")}
          title={title}
          description={taskTitle}
          meta={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-[#002fa7]" aria-hidden="true" />{t("受邀参与 · 仅限本线程")}</span>}
          actions={(
            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#002fa7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("返回")}
            </button>
          )}
        />
      )}

      <section className={mobile
        ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
        : "rd-horizon-discussion-surface mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      }>
        {!taskId ? (
          <div className="flex min-h-72 flex-1 items-center justify-center p-6" role="alert">
            <HorizonEmptyState
              Icon={AlertTriangle}
              title={t("无法打开任务讨论")}
              description={t("当前链接缺少任务编号，请返回任务或消息中心后重新进入。")}
              action={<button type="button" onClick={close} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#002fa7] px-3 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"><ArrowLeft className="size-4" aria-hidden="true" />{t("返回上一页")}</button>}
            />
          </div>
        ) : (
          <>
            {notificationError ? (
              <div className="mx-3 mt-3 flex shrink-0 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-pretty">{notificationError.message}</span>
                <button
                  type="button"
                  onClick={() => void retryNotificationSync()}
                  disabled={notificationRetrying}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-wait disabled:opacity-60"
                >
                  <RefreshCw className={cn("size-3.5", notificationRetrying && "animate-spin")} aria-hidden="true" />
                  {notificationRetrying ? t("同步中") : t("重试")}
                </button>
              </div>
            ) : null}

            <RDTaskConversation
              key={`discussion-invite:${usCollab ? "us-collab" : "rd"}:${taskId}:${focusAnchor?.type ?? "task"}:${focusAnchor?.id ?? ""}`}
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
              className="rd-horizon-discussion-conversation min-h-0 flex-1"
            />
          </>
        )}
      </section>
    </div>
  );
}

export default RDDiscussionInvitePage;
