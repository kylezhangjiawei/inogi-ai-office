import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, MessageSquareText, Search, Settings, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { getRoleLabel, useAuth } from "../auth";
import { routeTitleMap } from "../routesConfig";
import { useUserAvatar } from "../lib/userAvatar";
import { fetchRdMessages, patchRdMessage, type RdMessage } from "../lib/rdApi";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Parse the message body to a human-readable summary line. */
function getMsgSummary(msg: RdMessage): string {
  try {
    const b = JSON.parse(msg.body) as Record<string, unknown>;
    if (b.type === "review_request") {
      const reviewType = b.review_type === "collaboration" ? "协作申请" : b.review_type === "proposal" ? "立项申请" : "成果提交";
      return `【${reviewType}】${String(b.submitter_name ?? "")} 提交了任务「${String(b.task_title ?? "")}」`;
    }
    if (b.type === "review_result") {
      const resultLabel = b.result === "approved" ? "✅ 已批准" : "❌ 已打回";
      return `${resultLabel} 任务「${String(b.task_title ?? "")}」`;
    }
  } catch {
    // fallthrough
  }
  return msg.subject ?? msg.body.slice(0, 60);
}

function resolveRouteTitle(pathname: string) {
  const directTitle = routeTitleMap[pathname];
  if (directTitle) return directTitle;

  const matchedPath = Object.keys(routeTitleMap)
    .filter((path) => path !== "/" && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  return matchedPath ? routeTitleMap[matchedPath] : "系统首页";
}

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const avatar = useUserAvatar(user?.id);
  const [open, setOpen] = useState(false);
  const [rdMessages, setRdMessages] = useState<RdMessage[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const loadRdMessages = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await fetchRdMessages({ recipient_id: user.id, limit: 50 });
      setRdMessages(
        data
          .filter((message) => !message.handled)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      );
      window.dispatchEvent(new CustomEvent("rd:messages-updated"));
    } catch {
      // silent — header should not disrupt UX on failure
    }
  }, [user?.id]);

  useEffect(() => {
    void loadRdMessages();
    // Poll every 60s for new messages
    pollRef.current = setInterval(() => { void loadRdMessages(); }, 60_000);
    // Immediately refresh when a review is submitted from any page
    const onReviewSubmitted = () => { void loadRdMessages(); };
    window.addEventListener('rd:review-submitted', onReviewSubmitted);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener('rd:review-submitted', onReviewSubmitted);
    };
  }, [loadRdMessages]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [open]);

  const markMessageRead = useCallback((messageId: string) => {
    setRdMessages((prev) => prev.map((item) => (item.id === messageId ? { ...item, read: true } : item)));
    void patchRdMessage(messageId, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {});
  }, []);

  const unreadCount = useMemo(() => rdMessages.filter((m) => !m.read).length, [rdMessages]);
  const previewMessages = useMemo(() => rdMessages.slice(0, 5), [rdMessages]);

  const title = useMemo(() => resolveRouteTitle(location.pathname), [location.pathname]);
  const breadcrumb = useMemo(
    () => (location.pathname === "/" ? ["首页", "系统总览"] : ["首页", title]),
    [location.pathname, title],
  );
  return (
    <header className="relative z-40 border-b border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.72))] px-6 py-4 backdrop-blur-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <div className="hidden h-14 w-1 rounded-full bg-[linear-gradient(180deg,#42a5f5_0%,#1976d2_100%)] xl:block" />
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
              <span>{breadcrumb[0]}</span>
              <span>/</span>
              <span className="truncate font-medium text-slate-700">{breadcrumb[1]}</span>
            </div>
            <div>
              <h1 className="truncate text-[1.65rem] font-bold tracking-tight text-slate-900">{title}</h1>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:flex-1 xl:flex-row xl:items-center xl:justify-end">
          <div className="relative min-w-0 flex-1 xl:max-w-[340px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索工单、文档、人员、项目..." className="material-input pl-11 pr-4" />
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-3 xl:shrink-0 xl:flex-nowrap">
            <div className="rounded-[20px] bg-white/85 px-4 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Today</div>
              <div className="text-sm font-semibold text-slate-700">{today}</div>
            </div>

            <button className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-primary">
              <Settings className="h-5 w-5" />
            </button>

            <button
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-primary"
              onClick={() => setOpen((value) => !value)}
              aria-label="打开通知预览"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-2 top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-[4px] border border-slate-200 bg-white/94 px-3 py-2 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  aria-label="打开用户菜单"
                >
                  <div className="h-11 w-11 overflow-hidden rounded-[4px] ring-2 ring-blue-50">
                    {avatar ? (
                      <img src={avatar} alt={user?.name ?? "User"} className="h-full w-full object-cover" />
                    ) : (
                      <ImageWithFallback
                        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop"
                        alt={user?.name ?? "User"}
                      />
                    )}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="truncate text-sm font-semibold text-slate-800">{user?.name ?? "访客"}</div>
                    <div className="truncate text-xs text-slate-500">{user ? getRoleLabel(user.roleName) : "未登录"}</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="w-72 rounded-[4px] border-slate-200 bg-white/98 p-2 shadow-[0_18px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2.5 text-slate-700 focus:bg-blue-50 focus:text-blue-700" onSelect={() => navigate("/profile")}>
                  <UserRound className="h-4 w-4" />
                  <span>个人中心</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2.5 text-slate-700 focus:bg-blue-50 focus:text-blue-700" onSelect={() => navigate("/message-center")}>
                  <MessageSquareText className="h-4 w-4" />
                  <span>消息中心</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-100" />
                <DropdownMenuItem
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-red-600 focus:bg-red-50 focus:text-red-700"
                  onSelect={async () => {
                    await logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {open ? (
        <div className="absolute right-3 top-full z-[90] mt-2 w-[min(380px,calc(100vw-24px))] rounded-[18px] border border-slate-200 bg-white/98 p-4 shadow-[0_24px_54px_rgba(15,23,42,0.18)] backdrop-blur-xl md:right-6 md:rounded-[24px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              消息通知
              {unreadCount > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </span>
          </div>
          <div className="space-y-2">
            {previewMessages.length === 0 ? (
              <div className="py-4 text-center text-sm text-slate-400">暂无消息</div>
            ) : (
              previewMessages.map((msg) => (
                <button
                  type="button"
                  key={msg.id}
                  onClick={() => {
                    markMessageRead(msg.id);
                    setOpen(false);
                    navigate("/message-center");
                  }}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-2xl bg-slate-50/80 px-4 py-3 text-left text-sm leading-6 text-slate-600 transition hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  <span
                    className={[
                      "mt-1.5 inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-semibold leading-none",
                      msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600 ring-1 ring-red-100",
                    ].join(" ")}
                  >
                    {msg.read ? "已读" : "未读"}
                  </span>
                  <span className={msg.read ? "min-w-0 flex-1 text-slate-500" : "min-w-0 flex-1 font-medium text-slate-800"}>
                    {getMsgSummary(msg)}
                  </span>
                  {!msg.read ? (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                  ) : null}
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/message-center");
            }}
            className="mt-3 w-full cursor-pointer rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            查看全部消息
          </button>
        </div>
      ) : null}
    </header>
  );
}
