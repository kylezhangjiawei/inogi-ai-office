import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, Languages, LogOut, Menu, MessageSquareText, Search, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { getRoleLabel, useAuth } from "../auth";
import { DEPT_KBS, routeTitleMap } from "../routesConfig";
import { useDepartmentDirectory } from "../lib/departmentDirectory";
import { useUserAvatar } from "../lib/userAvatar";
import { i18nLocale, setI18nLang, t, useI18n } from "../lib/i18n";
import { AutoTranslatedText } from "./TranslatableText";
import { fetchRdMessages, fetchRdUnreadMessageCount, patchRdMessage, type RdMessage } from "../lib/rdApi";
import { useLayoutChromeState } from "../lib/layoutChrome";
import { routePath } from "../lib/routePaths";
import { cn } from "./ui/utils";
import { useVisibleNavigation } from "../lib/useVisibleNavigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { SheetTrigger } from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** Parse the message body to a human-readable summary line. */
function getMsgSummary(msg: RdMessage): string {
  try {
    const b = JSON.parse(msg.body) as Record<string, unknown>;
    if (b.type === "review_request") {
      const reviewType = b.review_type === "collaboration" ? "协作申请" : b.review_type === "proposal" ? "立项申请" : b.review_type === "due_date" ? "截止日期变更" : b.review_type === "abandon" ? "放弃任务" : "成果提交";
      return `【${reviewType}】${String(b.submitter_name ?? "")} 提交了任务「${String(b.task_title ?? "")}」`;
    }
    if (b.type === "review_result") {
      const resultLabel = b.result === "approved" ? "已批准" : "已打回";
      return `${resultLabel} 任务「${String(b.task_title ?? "")}」`;
    }
    if (b.type === "discussion_mention") {
      return `${String(b.actor_name ?? "任务成员")} 在「${String(b.task_title ?? "任务讨论")}」中提到了你`;
    }
    if (b.type === "procurement_review_result") {
      const resultLabel = b.result === "approved" ? "转采购已通过" : "转采购已打回";
      const code = b.procurement_code ? ` · ${String(b.procurement_code)}` : "";
      return `${resultLabel}${code}「${String(b.material_name ?? "采购需求")}」`;
    }
  } catch {
    // fallthrough
  }
  return msg.subject ?? msg.body.slice(0, 60);
}

function resolveRouteTitle(pathname: string) {
  if (/^\/(?:us-collab-)?rd-discussion\/[^/]+$/.test(pathname)) return "任务讨论";
  const directTitle = routeTitleMap[pathname];
  if (directTitle) return directTitle;

  const matchedPath = Object.keys(routeTitleMap)
    .filter((path) => path !== "/" && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  return matchedPath ? routeTitleMap[matchedPath] : "系统首页";
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { lang } = useI18n();
  const { immersive } = useLayoutChromeState();
  const { nameByCode } = useDepartmentDirectory();
  const avatar = useUserAvatar(user?.id);
  const [open, setOpen] = useState(false);
  const [pageSearchOpen, setPageSearchOpen] = useState(false);
  const [pageSearchText, setPageSearchText] = useState("");
  const visibleGroups = useVisibleNavigation();
  const [rdMessages, setRdMessages] = useState<RdMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageLoadSequenceRef = useRef(0);
  const headerRef = useRef<HTMLElement>(null);
  const today = new Date().toLocaleDateString(i18nLocale(), { year: "numeric", month: "2-digit", day: "2-digit" });
  const rdCockpitSearchEnabled = normalizePath(location.pathname) === normalizePath(routePath("page:rd-task-management", "/rd-task-management"));
  const notificationWorkspace = location.pathname.startsWith("/us-collab")
    ? "us-collab"
    : location.pathname.startsWith("/production-")
      ? "production"
      : "research-development";
  const cockpitKeyword = useMemo(
    () => (rdCockpitSearchEnabled ? new URLSearchParams(location.search).get("q") ?? "" : ""),
    [location.search, rdCockpitSearchEnabled],
  );

  const updateCockpitKeyword = useCallback((value: string) => {
    if (!rdCockpitSearchEnabled) return;
    const params = new URLSearchParams(location.search);
    if (value.trim()) {
      params.set("q", value);
      params.delete("view");
      params.delete("category");
    } else {
      params.delete("q");
    }
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate, rdCockpitSearchEnabled]);

  // 下拉只展示 5 条，就只取 5 条未处理的；未读数走服务端 count。
  // 从前是每 60s 全量拉 50 条回来在前端 filter 出未读数，超过 50 条还会算不准。
  const loadRdMessages = useCallback(async () => {
    if (!user?.id) return;
    const requestSequence = ++messageLoadSequenceRef.current;
    try {
      const [data, counted] = await Promise.all([
        fetchRdMessages({ recipient_id: user.id, limit: 5, handled: false }),
        fetchRdUnreadMessageCount(user.id),
      ]);
      if (requestSequence !== messageLoadSequenceRef.current) return;
      setRdMessages(data);
      setUnreadCount(counted.unread);
      window.dispatchEvent(new CustomEvent("rd:messages-updated"));
    } catch {
      // silent — header should not disrupt UX on failure
    }
  }, [user?.id]);

  useEffect(() => {
    messageLoadSequenceRef.current += 1;
    setOpen(false);
    setRdMessages([]);
    setUnreadCount(0);
    void loadRdMessages();
    // Poll every 60s for new messages
    pollRef.current = setInterval(() => { void loadRdMessages(); }, 60_000);
    // Immediately refresh when a review is submitted from any page
    const onReviewSubmitted = () => { void loadRdMessages(); };
    window.addEventListener('rd:review-submitted', onReviewSubmitted);
    return () => {
      messageLoadSequenceRef.current += 1;
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener('rd:review-submitted', onReviewSubmitted);
    };
  }, [loadRdMessages, notificationWorkspace]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    if (immersive) {
      setOpen(false);
      setPageSearchOpen(false);
      header.setAttribute("inert", "");
    } else {
      header.removeAttribute("inert");
    }
  }, [immersive]);

  const markMessageRead = useCallback((messageId: string) => {
    // 乐观更新徽标：服务端 count 要等下一次轮询才回来，先本地减一避免数字滞留
    setRdMessages((prev) => {
      const target = prev.find((item) => item.id === messageId);
      if (target && !target.read) setUnreadCount((n) => Math.max(0, n - 1));
      return prev.map((item) => (item.id === messageId ? { ...item, read: true } : item));
    });
    void patchRdMessage(messageId, { read: true })
      .then(() => window.dispatchEvent(new CustomEvent("rd:messages-updated")))
      .catch(() => {});
  }, []);

  const previewMessages = rdMessages;

  const title = useMemo(() => {
    const departmentKb = DEPT_KBS.find(
      (item) => location.pathname === `/dept-kb/${item.id}`,
    );
    if (departmentKb) {
      const departmentName = departmentKb.departmentCode
        ? nameByCode(departmentKb.departmentCode, departmentKb.label)
        : departmentKb.label;
      return `${departmentName}知识库`;
    }
    return resolveRouteTitle(location.pathname);
  }, [location.pathname, nameByCode]);
  const breadcrumb = useMemo(
    () => (location.pathname === "/" ? ["首页", "系统总览"] : ["首页", title]),
    [location.pathname, title],
  );
  return (
    <header
      ref={headerRef}
      data-immersive={immersive}
      className={cn(
        "relative z-40 shrink-0 px-4 md:px-6",
        immersive
          ? "pointer-events-none hidden"
          : "py-4",
        "rd-horizon-global-header",
      )}
    >
      <div className="rd-horizon-header-row flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="rd-horizon-header-heading flex min-w-0 items-start gap-4">
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("打开主导航")}
              className="rd-horizon-mobile-nav-trigger flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </SheetTrigger>
          <div className="rd-horizon-header-heading-copy min-w-0 space-y-2">
            <nav aria-label={t("当前位置")} className="rd-horizon-header-breadcrumb flex min-w-0 items-center gap-2 text-sm text-slate-500">
              <span>{t(breadcrumb[0])}</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page" title={t(breadcrumb[1])} className="rd-horizon-header-breadcrumb-current truncate font-medium text-slate-700">{t(breadcrumb[1])}</span>
            </nav>
            <div>
              <h1 title={t(title)} className="rd-horizon-header-title truncate text-balance text-[1.65rem] font-bold text-slate-900">{t(title)}</h1>
            </div>
          </div>
        </div>

        <div className="rd-horizon-header-right flex min-w-0 flex-col gap-3 xl:flex-1 xl:flex-row xl:items-center xl:justify-end">
          <div data-search-kind={rdCockpitSearchEnabled ? "tasks" : "pages"} className="rd-horizon-header-search relative min-w-0 flex-1 xl:max-w-[340px]">
            {rdCockpitSearchEnabled ? (
              <>
                <Search className="rd-horizon-header-search-icon pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  type="search"
                  aria-label={t("搜索任务、编号、负责人、路径")}
                  title={t("搜索任务、编号、负责人、路径")}
                  placeholder={lang === "en" ? "Search tasks…" : "搜索任务…"}
                  value={cockpitKeyword}
                  onChange={(event) => updateCockpitKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      updateCockpitKeyword("");
                      event.currentTarget.blur();
                    }
                  }}
                  className="rd-horizon-header-input material-input pl-11 pr-4"
                />
              </>
            ) : (
              <Dialog open={pageSearchOpen} onOpenChange={(nextOpen) => {
                setPageSearchOpen(nextOpen && !immersive);
                if (!nextOpen) setPageSearchText("");
              }}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    aria-label={lang === "en" ? "Search work pages" : "搜索工作页面"}
                    title={lang === "en" ? "Search work pages" : "搜索工作页面"}
                    className="rd-horizon-header-input rd-horizon-page-search-trigger flex w-full cursor-pointer items-center gap-2.5 px-4 text-left text-sm text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{lang === "en" ? "Search pages" : "搜索页面"}</span>
                  </button>
                </DialogTrigger>
                <DialogContent className="horizon-theme horizon-portal rd-horizon-page-search overflow-hidden rounded-2xl p-0 transition-none data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-lg">
                  <DialogTitle className="sr-only">{t("搜索工作页面")}</DialogTitle>
                  <DialogDescription className="sr-only">{t("输入页面名称，选择后打开对应页面")}</DialogDescription>
                  <Command className="[&_[data-slot=command-input-wrapper]]:h-16 [&_[data-slot=command-input-wrapper]]:px-5">
                    <CommandInput
                      value={pageSearchText}
                      onValueChange={setPageSearchText}
                      placeholder={`${t("搜索工作页面")}…`}
                      aria-label={t("搜索工作页面")}
                      className="h-14 pr-10"
                    />
                    <CommandList className="max-h-[min(24rem,65dvh)] p-2">
                      <CommandEmpty>
                        <p className="text-pretty text-sm text-slate-600">{t("没有找到匹配页面")}</p>
                        <button
                          type="button"
                          onClick={() => setPageSearchText("")}
                          className="mt-3 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {t("清除搜索")}
                        </button>
                      </CommandEmpty>
                      {visibleGroups.map((group) => (
                        <CommandGroup key={group.label} heading={t(group.label)}>
                          {group.items.map((item) => (
                            <CommandItem
                              key={item.path}
                              value={`${t(item.label)} ${item.label} ${t(group.label)} ${item.path}`}
                              onSelect={() => {
                                setPageSearchOpen(false);
                                setPageSearchText("");
                                navigate(item.path);
                              }}
                              className="min-h-11 cursor-pointer rounded-xl px-3"
                            >
                              <span aria-hidden="true"><item.icon className="size-4" /></span>
                              <span className="truncate">{t(item.label)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="rd-horizon-header-tools flex min-w-0 flex-wrap items-center gap-3 xl:shrink-0 xl:flex-nowrap">
            <div className="rd-horizon-header-date hidden rounded-xl xl:block border border-slate-200 bg-slate-50 px-4 py-2 text-right">
              <div className="rd-horizon-header-date-label text-[10px] font-semibold text-slate-500">{t("今天")}</div>
              <div className="rd-horizon-header-date-value tabular-nums text-sm font-semibold text-slate-700">{today}</div>
            </div>

            {/* 语言切换（原设置按钮位）：按用户偏好持久化（中方看中文、美方看英文，同页面各看各的） */}
            <button
              type="button"
              onClick={() => void setI18nLang(lang === "en" ? "zh" : "en")}
              title={lang === "en" ? "Switch to Chinese" : "切换为英文界面"}
              aria-label={lang === "en" ? "Switch to Chinese" : "切换为英文界面"}
              className="rd-horizon-header-control rd-horizon-header-language flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition-colors duration-150 motion-reduce:transition-none hover:border-primary/20 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <Languages className="size-4" aria-hidden="true" />
              {lang === "en" ? "中文" : "EN"}
            </button>

            <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen && !immersive)}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="rd-horizon-header-control rd-horizon-header-notification-trigger relative flex size-11 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors duration-150 motion-reduce:transition-none hover:border-primary/20 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                  aria-label={lang === "en" ? "Open notification preview" : "打开通知预览"}
                  title={lang === "en" ? "Open notification preview" : "打开通知预览"}
                >
                  <Bell className="size-5" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="rd-horizon-header-unread absolute tabular-nums right-2 top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                id="header-notification-preview"
                align="end"
                sideOffset={10}
                collisionPadding={12}
                aria-label={t("消息通知")}
                onCloseAutoFocus={(event) => {
                  if (immersive) event.preventDefault();
                }}
                className="horizon-theme horizon-portal rd-horizon-header-notifications rd-horizon-header-notifications--horizon w-[min(24rem,calc(100vw-24px))] max-h-[min(30rem,72vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">
                    {t("消息通知")}
                    {unreadCount > 0 && (
                      <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount}
                      </span>
                    )}
                  </span>
                </div>
                <div className="space-y-2">
                  {previewMessages.length === 0 ? (
                    <div className="py-4 text-pretty text-center text-sm text-slate-600">{t("暂无消息")}</div>
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
                        className="rd-horizon-header-notification-item flex w-full cursor-pointer items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-left text-sm leading-6 text-slate-600 transition-colors duration-150 motion-reduce:transition-none hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                      >
                        <span
                          className={cn(
                            "mt-1.5 inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-semibold leading-none",
                            msg.read ? "bg-slate-100 text-slate-500" : "bg-red-50 text-red-600 ring-1 ring-red-100",
                          )}
                        >
                          {msg.read ? t("已读") : t("未读")}
                        </span>
                        <AutoTranslatedText
                          text={getMsgSummary(msg)}
                          className={cn("min-w-0 flex-1 text-pretty", msg.read ? "text-slate-500" : "font-medium text-slate-800")}
                        />
                        {!msg.read ? (
                          <span className="mt-2 size-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
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
                  className="rd-horizon-header-view-all mt-3 w-full cursor-pointer rounded-xl border border-primary/20 bg-accent px-3 py-2 text-sm font-semibold text-primary transition-colors duration-150 motion-reduce:transition-none hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                >
                  {t("查看全部消息")}
                </button>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rd-horizon-header-user flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors duration-150 motion-reduce:transition-none hover:border-primary/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                  aria-label={lang === "en" ? "Open user menu" : "打开用户菜单"}
                  title={`${user?.name ?? (lang === "en" ? "Guest" : "访客")} · ${user ? t(getRoleLabel(user.roleName)) : t("未登录")}`}
                >
                  <div className="rd-horizon-header-avatar flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-bold text-primary">
                    {avatar ? (
                      <img src={avatar} alt={user?.name ?? "User"} className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden="true">{user?.name?.trim().slice(0, 1) || "U"}</span>
                    )}
                  </div>
                  <div className="rd-horizon-header-user-copy min-w-0 text-left">
                    <div className="rd-horizon-header-user-name truncate text-sm font-semibold text-slate-800">{user?.name ?? "访客"}</div>
                    <div className="rd-horizon-header-user-role truncate text-xs text-slate-500">{user ? t(getRoleLabel(user.roleName)) : t("未登录")}</div>
                  </div>
                  <ChevronDown className="rd-horizon-header-user-chevron size-4 text-slate-500" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="horizon-theme horizon-portal rd-horizon-header-menu w-72 rounded-xl border-slate-200 bg-white p-2 shadow-lg">
                <DropdownMenuItem className="rd-horizon-header-menu-item cursor-pointer rounded-xl px-3 py-2.5 text-slate-700 focus:bg-accent focus:text-primary" onSelect={() => navigate("/profile")}>
                  <UserRound className="size-4" />
                  <span>{t("个人中心")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="rd-horizon-header-menu-item cursor-pointer rounded-xl px-3 py-2.5 text-slate-700 focus:bg-accent focus:text-primary" onSelect={() => navigate("/message-center")}>
                  <MessageSquareText className="size-4" />
                  <span>{t("消息中心")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-100" />
                <DropdownMenuItem
                  className="rd-horizon-header-menu-danger cursor-pointer rounded-xl px-3 py-2.5 text-red-600 focus:bg-red-50 focus:text-red-700"
                  onSelect={async () => {
                    await logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  <LogOut className="size-4" />
                  <span>{t("退出登录")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

    </header>
  );
}
