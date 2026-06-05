import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { LogOut, Menu } from "lucide-react";
import { useAuth } from "./auth";
import { cn } from "./components/ui/utils";
import { Toaster } from "./components/ui/sonner";

/**
 * 移动端布局（独立路由树 `/m` 的外壳）：
 *  - 自带鉴权守卫（未登录跳 /login），与桌面同一套 AuthProvider，不重复登录态。
 *  - 不复用桌面 `Root`（那层写死 min-w-1024 + 侧边栏），所以桌面端零影响。
 *  - 顶栏 + 抽屉菜单（切换电脑版 / 退出）；内容区用 `Outlet` 渲染移动页。
 *  - 高度用 100dvh（避开 iOS 地址栏吃掉 100vh 的经典坑）。
 *  - 横向间距用固定 px：顶栏 `px-4`(16px) 与内容区 gutter 完全一致，标题与正文同一条左边线。
 */
export function MobileLayout() {
  const { user, hydrated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // 给 <html> 打上路由标记：解除全局 theme.css 对桌面强加的 min-width:1024 与 body 锁滚动。
  // 仅在 /m 挂载期间生效，离开即还原，桌面端零影响（详见 theme.css 末尾 .mobile-route 覆盖）。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("mobile-route");
    return () => root.classList.remove("mobile-route");
  }, []);

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

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 font-black text-white shadow-[0_4px_12px_-4px_rgba(79,70,229,0.5)]">
            <span className="text-base">研</span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[17px] font-bold text-slate-900">
              研发任务驾驶舱
            </div>
            <div className="text-[11px] font-medium text-slate-400">
              移动只读视图
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="打开菜单"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100"
        >
          <Menu size={22} />
        </button>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {menuOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
          <div
            className="absolute right-3 top-3 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
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
            <button
              type="button"
              onClick={handleLogout}
              className={cn(
                "flex w-full items-center gap-3 border-t border-slate-100 px-5 py-4 text-left text-sm font-semibold text-red-600 active:bg-red-50",
              )}
            >
              <LogOut size={19} className="shrink-0" />
              退出登录
            </button>
          </div>
        </div>
      )}

      {/* /m 独立路由树没有桌面 Root 的 Toaster，这里补一份，备注提交等反馈才能弹出 */}
      <Toaster richColors position="top-center" />
    </div>
  );
}
