import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { BarChart3, LayoutDashboard, LogOut, Menu } from "lucide-react";
import { useAuth } from "./auth";
import { isProductionWorkspace, isUsCollabWorkspace } from "./lib/rdApi";
import { initI18n, t, useI18n } from "./lib/i18n";
import { hasPermission } from "./lib/permissions";
import { cn } from "./components/ui/utils";
import { Toaster } from "./components/ui/sonner";
import { SiteRecordFooter } from "./components/SiteRecordFooter";
import {
  closeMobileOverlay,
  isCurrentMobileOverlay,
  pushMobileOverlayState,
  useBodyScrollLock,
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

  useBodyScrollLock(menuOpen);
  useMobileOverlayBack(menuOpen, MENU_OVERLAY, () => setMenuOpen(false));

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileOverlay(MENU_OVERLAY, () => setMenuOpen(false));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-sm text-slate-500">
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

  const openMenu = () => {
    pushMobileOverlayState(MENU_OVERLAY);
    setMenuOpen(true);
  };

  const closeMenu = () => closeMobileOverlay(MENU_OVERLAY, () => setMenuOpen(false));

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 font-black text-white shadow-[0_4px_12px_-4px_rgba(79,70,229,0.5)]">
            {isChatAnalytics ? <BarChart3 size={18} /> : <span className="text-base">{isUsCollabWorkspace() ? "协" : isProduction ? "产" : "研"}</span>}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[17px] font-bold text-slate-900">
              {shellTitle}
            </div>
            <div className="text-[11px] font-medium text-slate-400">
              {shellSubtitle}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={openMenu}
          aria-label="打开菜单"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100"
        >
          <Menu size={22} />
        </button>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <SiteRecordFooter className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />

      {menuOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="移动端菜单" onClick={closeMenu}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
          <div
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
            style={{ maxHeight: "calc(100dvh - max(1.5rem, env(safe-area-inset-top)) - env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">
                  {initial}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold text-slate-900">
                  {user.name || "未命名用户"}
                </div>
                {user.roleName && (
                  <div className="truncate text-xs font-medium text-slate-400">
                    {user.roleName}
                  </div>
                )}
              </div>
            </div>
            <nav className="p-2" aria-label="移动端页面导航">
              <button
                type="button"
                onClick={() => goTo(cockpitPath)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold",
                  !isChatAnalytics ? "bg-indigo-50 text-indigo-700" : "text-slate-600 active:bg-slate-100",
                )}
              >
                <LayoutDashboard size={19} className="shrink-0" />
                {cockpitLabel}
              </button>
              {hasPermission(user.permissions, "page:chat-analytics") && (
                <button
                  type="button"
                  onClick={() => goTo(returnsToUsCollab ? "/m/chat-analytics?from=us-collab" : "/m/chat-analytics")}
                  className={cn(
                    "mt-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold",
                    isChatAnalytics ? "bg-indigo-50 text-indigo-700" : "text-slate-600 active:bg-slate-100",
                  )}
                >
                  <BarChart3 size={19} className="shrink-0" />
                  AI 使用与反馈
                </button>
              )}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className={cn(
                "flex w-full items-center gap-3 border-t border-slate-100 px-5 py-4 text-left text-sm font-semibold text-red-600 active:bg-red-50",
              )}
            >
              <LogOut size={19} className="shrink-0" />
              {t("退出登录")}
            </button>
          </div>
        </div>
      )}

      {/* /m 独立路由树没有桌面 Root 的 Toaster，这里补一份，备注提交等反馈才能弹出 */}
      <Toaster richColors position="top-center" />
    </div>
  );
}
