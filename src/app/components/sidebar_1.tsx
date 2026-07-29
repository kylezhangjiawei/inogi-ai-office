import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../auth";
import { hasPermission } from "../lib/permissions";
import { permissionCatalogApi } from "../lib/permissionCatalogApi";
import { useDepartmentDirectory } from "../lib/departmentDirectory";
import { navGroups } from "../routesConfig";
import { t, useI18n } from "../lib/i18n";
import { useLayoutChromeActions, useLayoutChromeState } from "../lib/layoutChrome";
import { cn } from "./ui/utils";
import logo from '../../assets/logo.png'

export function Sidebar() {
  const { lang } = useI18n(); // 订阅语言切换（菜单 label 走 t()，中文即 key 全站菜单一处生效）
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { immersive, sidebarCollapsed: collapsed } = useLayoutChromeState();
  const { toggleSidebar } = useLayoutChromeActions();
  const { nameByCode } = useDepartmentDirectory();
  const userPermissions = user?.permissions ?? [];
  const navScrollRef = useRef<HTMLElement>(null);

  // Fetch nav-hidden codes from the permission catalog.
  // Hidden pages are still accessible but not shown in the sidebar.
  const [navHiddenCodes, setNavHiddenCodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    permissionCatalogApi
      .getNavHiddenCodes()
      .then((codes) => setNavHiddenCodes(new Set(codes)))
      .catch(() => { /* silently ignore — show all items on error */ });
  }, [user]);

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => {
          // Must have the required permission (or no permission required)
          if (item.requiredPermission && !hasPermission(userPermissions, item.requiredPermission)) return false;
          // Must not be marked as nav-hidden in the permission catalog
          if (item.requiredPermission && navHiddenCodes.has(item.requiredPermission)) return false;
          return true;
        })
        .map((item) =>
          item.departmentCode
            ? {
                ...item,
                label: `${nameByCode(item.departmentCode, item.label.replace(/知识库$/, ""))}知识库`,
              }
            : item,
        ),
    }))
    .filter((group) => group.items.length > 0);

  // 刷新或路由跳转后，浏览器会保留当前路由，但侧栏自身的滚动位置会回到顶部。
  // 只调整侧栏滚动容器，确保当前激活菜单可见，不影响页面主体和用户正常滚动。
  useLayoutEffect(() => {
    if (immersive) return;

    const nav = navScrollRef.current;
    const activeItem = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !activeItem) return;

    const navRect = nav.getBoundingClientRect();
    const activeRect = activeItem.getBoundingClientRect();
    const edgePadding = 8;
    const isFullyVisible =
      activeRect.top >= navRect.top + edgePadding &&
      activeRect.bottom <= navRect.bottom - edgePadding;

    if (isFullyVisible) return;

    const centeredTop =
      nav.scrollTop +
      (activeRect.top - navRect.top) -
      (nav.clientHeight - activeRect.height) / 2;
    const maxScrollTop = Math.max(0, nav.scrollHeight - nav.clientHeight);
    nav.scrollTop = Math.min(maxScrollTop, Math.max(0, centeredTop));
  }, [collapsed, immersive, navHiddenCodes, pathname]);

  return (
    // 外层只负责宽度过渡：沉浸模式整体滑出(0)、手动收起成图标轨道(76)、常态(300/324)。
    // relative 让右缘悬浮圆钮能溢出到边线外；裁剪交给内层，避免把圆钮也裁掉。
    <div
      className={cn(
        "relative h-full shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        immersive ? "w-0" : collapsed ? "w-[76px]" : "w-[300px] min-[1920px]:w-[324px]",
      )}
    >
      {/* 裁剪层：沉浸态把侧栏内部裁掉，形成 off-canvas 滑出，不挤压主内容 */}
      <div className="h-full w-full overflow-hidden">
      <aside
        className={cn(
          "flex h-full flex-col border-r border-white/70 bg-[linear-gradient(180deg,#fcfdff_0%,#f4f8fd_100%)] py-5",
          collapsed ? "w-[76px] items-center px-2" : "w-[300px] px-4 min-[1920px]:w-[324px]",
        )}
      >
        {/* 顶部：Logo（展开态附标题 + 当前用户卡）*/}
        {collapsed ? (
          <div className="mb-4 shrink-0">
            <img className="h-11 w-11 rounded-[4px]" src={logo} alt="INOGI AI" />
          </div>
        ) : (
          <div className="material-card material-glow mb-5 shrink-0 p-4">
            <div className="mb-5 flex items-center gap-3">
              <img className="flex h-14 w-14 items-center justify-center rounded-[4px] " src={logo} alt="" />
              <div>
                <div className="text-lg font-bold tracking-tight text-slate-900">INOGI AI</div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Office Console</div>
              </div>
            </div>

            <div className="rounded-[24px] bg-[linear-gradient(145deg,#eef2ff_0%,#f9fbff_55%,#f3f0ff_100%)] px-4 py-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("当前用户")}</div>
              <div className="flex items-end justify-between gap-3">
                <div className="truncate text-sm font-bold tracking-tight text-slate-900">{user?.name ?? "—"}</div>
                <span className="material-chip shrink-0 bg-white/85 text-primary shadow-sm">{user?.roleName ? t(user.roleName) : t("无角色")}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 truncate">{user?.email ?? ""}</p>
            </div>
          </div>
        )}

        <nav
          ref={navScrollRef}
          data-sidebar-scroll-container
          className={cn(
            "material-scrollbar flex-1 overflow-y-auto",
            collapsed ? "w-full space-y-2" : "-mx-1 space-y-4 px-1",
          )}
        >
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.label}>
              {collapsed ? (
                groupIndex > 0 ? <div className="mx-auto mb-2 h-px w-8 bg-slate-200/80" /> : null
              ) : (
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t(group.label)}</div>
              )}
              <div className="space-y-2">
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/" || item.path === "/ops-center"}
                    title={collapsed ? t(item.label) : undefined}
                    className={({ isActive }) =>
                      collapsed
                        ? "flex items-center justify-center rounded-2xl py-0.5"
                        : cn(
                            "material-nav-item justify-between border",
                            isActive
                              ? "border-indigo-100 bg-[linear-gradient(135deg,#eef2ff_0%,#e0e7ff_72%,#f3f0ff_100%)] text-primary shadow-[0_10px_18px_-8px_rgba(79,70,229,0.22)]"
                              : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/85",
                          )
                    }
                  >
                    {({ isActive }) =>
                      collapsed ? (
                        <div
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
                            isActive
                              ? "bg-white text-primary shadow-[0_6px_12px_-4px_rgba(79,70,229,0.16)] ring-1 ring-indigo-100"
                              : "bg-slate-100/80 text-slate-500 hover:bg-white hover:text-primary",
                          )}
                        >
                          <item.icon className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={cn(
                              "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
                              isActive ? "bg-white text-primary shadow-[0_6px_12px_-4px_rgba(79,70,229,0.16)]" : "bg-slate-100/80 text-slate-500",
                            )}
                          >
                            <item.icon className="h-5 w-5" />
                          </div>
                          <span className="truncate font-medium">{t(item.label)}</span>
                        </div>
                      )
                    }
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      </div>

      {/* 收起/展开切换：悬浮在侧栏右缘、跨边线的圆钮（VS Code / Notion 风）。
          随宽度过渡平滑滑动到新边线；沉浸态侧栏整体滑出时隐藏。 */}
      {!immersive && (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed
            ? (lang === "en" ? "Expand sidebar" : "展开侧边栏")
            : (lang === "en" ? "Collapse sidebar" : "收起侧边栏")}
          title={collapsed
            ? (lang === "en" ? "Expand sidebar" : "展开侧边栏")
            : (lang === "en" ? "Collapse sidebar" : "收起侧边栏")}
          className="group absolute -right-3 top-1/2 z-40 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-[0_2px_10px_rgba(15,23,42,0.12)] transition-all duration-200 hover:scale-105 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 hover:shadow-[0_4px_14px_rgba(79,70,229,0.28)] active:scale-90"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          ) : (
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          )}
        </button>
      )}
    </div>
  );
}
