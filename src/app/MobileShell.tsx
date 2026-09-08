import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { BarChart3, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "./auth";
import { isProductionWorkspace, isUsCollabWorkspace } from "./lib/rdApi";
import { initI18n, t, useI18n } from "./lib/i18n";
import { hasPermission } from "./lib/permissions";
import { cn } from "./components/ui/utils";
import { Toaster } from "./components/ui/sonner";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/ui/sheet";
import { SiteRecordFooter } from "./components/SiteRecordFooter";
import {
  closeMobileOverlay,
  isCurrentMobileOverlay,
  pushMobileOverlayState,
  useMobileOverlayBack,
} from "./hooks/useMobileOverlay";

const MENU_OVERLAY = "mobile-shell-menu";

/**
 * 移动端布局（独立路由树 `/m` 的外壳）：
 *  - 自带鉴权守卫（未登录跳 /login），与桌面同一套 AuthProvider，不重复登录态。
 *  - 不复用桌面 `Root`（那层写死 min-w-1024 + 侧边栏），所以桌面端零影响。
 *  - 顶栏 + 抽屉菜单（移动页面切换 / 退出）；内容区用 `Outlet` 渲染移动页。
 *  - 最小高度用 100dvh（避开 iOS 地址栏吃掉 100vh，同时允许长页面把备案栏推到内容末尾）。
 *  - 横向间距用固定 px：顶栏 `px-4`(16px) 与内容区 gutter 完全一致，标题与正文同一条左边线。
 */
export function MobileLayout() {
  useI18n(); // 订阅语言切换（移动壳文案已 t() 化）
  const { user, hydrated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // 移动路由树不经过桌面 Root：自行初始化 i18n（拉用户语言偏好 + 英文字典）
  useEffect(() => {
    void initI18n();
  }, []);

  // 给 <html> 打上路由标记：解除全局 theme.css 对桌面强加的 min-width:1024 与 body 锁滚动。
  // 仅在 /m 挂载期间生效，离开即还原，桌面端零影响（详见 theme.css 末尾 .mobile-route 覆盖）。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("mobile-route");
    return () => root.classList.remove("mobile-route");
  }, []);

  useMobileOverlayBack(menuOpen, MENU_OVERLAY, () => setMenuOpen(false));

  if (!hydrated) {
    return (
      <div className="horizon-theme hz-page flex min-h-[100dvh] min-w-0 items-center justify-center bg-background px-4 text-center text-sm text-muted-foreground" role="status">
        正在恢复登录状态...
      </div>
    );
  }
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search + location.hash }}
      />
    );
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };

  const initial = (user.name?.trim()?.[0] ?? "研").toUpperCase();
  const isChatAnalytics = location.pathname.startsWith("/m/chat-analytics");
  const isProduction = isProductionWorkspace();
  const returnsToUsCollab = location.pathname.startsWith("/us-collab-m")
    || new URLSearchParams(location.search).get("from") === "us-collab";
  const cockpitPath = returnsToUsCollab ? "/us-collab-m" : isProduction ? "/production-m" : "/m";
  const cockpitLabel = returnsToUsCollab
    ? t("协同任务驾驶舱")
    : isProduction
      ? t("生产驾驶舱")
      : t("研发任务驾驶舱");
  const shellTitle = isChatAnalytics
    ? "AI 使用与反馈"
    : cockpitLabel;
  const shellSubtitle = isChatAnalytics ? "管理移动视图" : t("移动协作视图");

  const goTo = (path: string) => {
    const replaceOverlayEntry = isCurrentMobileOverlay(MENU_OVERLAY);
    setMenuOpen(false);
    navigate(path, { replace: replaceOverlayEntry });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const closeMenu = () => closeMobileOverlay(MENU_OVERLAY, () => setMenuOpen(false));

  const handleMenuOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (!menuOpen) {
        pushMobileOverlayState(MENU_OVERLAY);
        setMenuOpen(true);
      }
      return;
    }
    if (menuOpen) closeMenu();
  };

  return (
    <div className="horizon-theme hz-page min-h-[100dvh] min-w-0 overflow-x-hidden bg-card text-on-surface-variant">
      <div className="flex min-h-[100dvh] flex-col bg-card">
        <Sheet open={menuOpen} onOpenChange={handleMenuOpenChange}>
          <header className="flex shrink-0 items-center justify-between border-b border-[#e9edf7] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary font-black text-white shadow-sm" aria-hidden="true">
                {isChatAnalytics ? <BarChart3 size={19} /> : <span className="text-base">{isUsCollabWorkspace() ? "协" : isProduction ? "产" : "研"}</span>}
              </span>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[17px] font-bold text-foreground">
                  {shellTitle}
                </div>
                <div className="text-[11px] font-medium text-muted-foreground">
                  {shellSubtitle}
                </div>
              </div>
            </div>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="打开菜单"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                aria-controls="mobile-shell-navigation"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl text-primary active:bg-accent"
              >
                <Menu size={22} aria-hidden="true" />
              </button>
            </SheetTrigger>
          </header>

          <main className="flex-1 bg-background">
            <Outlet />
          </main>

          <div className="border-t border-[#e9edf7] bg-white [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:justify-center [&_a]:rounded-lg [&_a]:px-2 [&_a]:active:text-primary">
            <SiteRecordFooter tone="horizon" className="pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-none" />
          </div>

          <SheetContent
            id="mobile-shell-navigation"
            side="right"
            className="h-dvh w-[min(20rem,calc(100vw-1rem))] gap-0 overflow-hidden border-[#e0e5f2] bg-white p-0 horizon-portal [&>button:last-child]:hidden"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-[#e9edf7] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-primary" aria-hidden="true">
                  {initial}
                </span>
              )}
              <SheetHeader className="min-w-0 flex-1 gap-0.5 p-0 text-left">
                <SheetTitle className="truncate text-[15px] font-bold text-foreground">
                  {user.name || "未命名用户"}
                </SheetTitle>
                <SheetDescription className="truncate text-xs font-medium text-muted-foreground">
                  {user.roleName || t("移动工作台导航")}
                </SheetDescription>
              </SheetHeader>
              <SheetClose asChild>
                <button type="button" aria-label="关闭菜单" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-primary active:bg-accent">
                  <X size={21} aria-hidden="true" />
                </button>
              </SheetClose>
            </header>

            <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-label="移动端页面导航">
              <button
                type="button"
                onClick={() => goTo(cockpitPath)}
                aria-current={!isChatAnalytics ? "page" : undefined}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold",
                  !isChatAnalytics ? "bg-accent text-primary" : "text-on-surface-variant active:bg-background",
                )}
              >
                <LayoutDashboard size={19} className="shrink-0" aria-hidden="true" />
                {cockpitLabel}
              </button>
              {hasPermission(user.permissions, "page:chat-analytics") && (
                <button
                  type="button"
                  onClick={() => goTo(returnsToUsCollab ? "/m/chat-analytics?from=us-collab" : "/m/chat-analytics")}
                  aria-current={isChatAnalytics ? "page" : undefined}
                  className={cn(
                    "mt-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold",
                    isChatAnalytics ? "bg-accent text-primary" : "text-on-surface-variant active:bg-background",
                  )}
                >
                  <BarChart3 size={19} className="shrink-0" aria-hidden="true" />
                  AI 使用与反馈
                </button>
              )}
            </nav>
            <div className="border-t border-[#e9edf7] px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-red-600 active:bg-red-50"
              >
                <LogOut size={19} className="shrink-0" aria-hidden="true" />
                {t("退出登录")}
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* /m 独立路由树没有桌面 Root 的 Toaster，这里补一份，备注提交等反馈才能弹出 */}
        <Toaster richColors position="top-center" />
      </div>
    </div>
  );
}
