import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useAuth } from "../auth";
import { isNavItemActive, navGroups } from "../routesConfig";
import { t, useI18n } from "../lib/i18n";
import { useLayoutChromeActions, useLayoutChromeState } from "../lib/layoutChrome";
import { cn } from "./ui/utils";
import { useVisibleNavigation } from "../lib/useVisibleNavigation";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import logo from "../../assets/logo.png";
import { Button } from "./ui/button";

/** 被用户收起的菜单分组（存分组 label）。默认全展开，只记收起的那些。 */
const NAV_GROUP_COLLAPSED_KEY = "inogi-nav-collapsed-groups";

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(NAV_GROUP_COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function persistCollapsedGroups(groups: Set<string>) {
  try {
    window.localStorage.setItem(NAV_GROUP_COLLAPSED_KEY, JSON.stringify([...groups]));
  } catch {
    /* 隐私模式写不了 localStorage，忽略即可，不影响本次会话 */
  }
}

export function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { lang } = useI18n(); // 订阅语言切换（菜单 label 走 t()，中文即 key 全站菜单一处生效）
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { immersive, sidebarCollapsed } = useLayoutChromeState();
  const collapsed = !mobile && sidebarCollapsed;
  const { toggleSidebar } = useLayoutChromeActions();
  const visibleGroups = useVisibleNavigation();
  const sidebarRef = useRef<HTMLElement>(null);
  const navScrollRef = useRef<HTMLElement>(null);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      persistCollapsedGroups(next);
      return next;
    });
  }, []);

  // 目标页所在分组是收起的就自动展开——否则跳过去只看到一片收起的分组，当前页在哪都不知道。
  // 初值取 null 而不是 pathname：首屏与刷新同样要展开当前页所在分组，那恰恰是最需要它的场景。
  // 之后只在路由「变化」时做，用户手动收起当前分组不会被立刻顶开。
  const lastPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    const owner = navGroups.find((group) => group.items.some((item) => isNavItemActive(item, pathname)));
    if (!owner) return;
    setCollapsedGroups((current) => {
      if (!current.has(owner.label)) return current;
      const next = new Set(current);
      next.delete(owner.label);
      persistCollapsedGroups(next);
      return next;
    });
  }, [pathname]);

  const userInitial = user?.name?.trim().slice(0, 1) || "U";

  // 沉浸模式不仅要把侧栏裁出画面，也要切断内部链接和按钮的键盘访问。
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (immersive) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
  }, [immersive]);

  // 刷新或路由跳转后，浏览器会保留当前路由，但侧栏自身的滚动位置会回到顶部。
  // 只调整侧栏滚动容器，确保当前激活菜单可见，不影响页面主体和用户正常滚动。
  useLayoutEffect(() => {
    if (immersive) return;

    const nav = navScrollRef.current;
    if (!nav) return;

    const keepActiveItemVisible = () => {
      if (!nav.clientWidth || !nav.clientHeight) return;
      const activeItem = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!activeItem) return;

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
    };

    keepActiveItemVisible();
    let lastWidth = nav.clientWidth;
    let lastHeight = nav.clientHeight;
    const resizeObserver = new ResizeObserver(() => {
      const width = nav.clientWidth;
      const height = nav.clientHeight;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      keepActiveItemVisible();
    });
    resizeObserver.observe(nav);
    return () => resizeObserver.disconnect();
  }, [collapsed, collapsedGroups, immersive, visibleGroups, pathname]);

  return (
    <div
      className={cn(
        "rd-horizon-sidebar-frame relative h-full shrink-0",
        mobile ? "w-full" : immersive ? "w-0" : collapsed ? "w-[76px]" : "w-64 min-[1920px]:w-[280px]",
      )}
    >
      <div className="h-full w-full overflow-hidden">
        <aside
          ref={sidebarRef}
          aria-hidden={immersive || undefined}
          data-collapsed={collapsed ? "true" : "false"}
          data-mobile={mobile || undefined}
          className={cn(
            "rd-horizon-global-sidebar flex h-full flex-col border-r",
            mobile ? "w-full" : collapsed ? "w-[76px] items-center" : "w-64 min-[1920px]:w-[280px]",
          )}
        >
          <div
            className={cn(
              "rd-horizon-sidebar-brand flex h-20 w-full shrink-0 items-center border-b",
              collapsed ? "justify-center px-2" : "gap-3 px-5",
              mobile && "pr-12",
            )}
          >
            <img
              className={cn("rd-horizon-sidebar-logo shrink-0 rounded-lg object-contain", collapsed ? "size-10" : "size-11")}
              src={logo}
              alt="INOGI AI"
            />
            {!collapsed && (
              <div className="min-w-0 whitespace-nowrap">
                <div className="rd-horizon-sidebar-brand-title truncate text-base font-bold">INOGI AI</div>
                <div className="rd-horizon-sidebar-brand-subtitle mt-0.5 truncate text-xs font-medium">Office Console</div>
              </div>
            )}
          </div>

          <nav
            ref={navScrollRef}
            data-sidebar-scroll-container
            aria-label={lang === "en" ? "Primary navigation" : "主导航"}
            className={cn(
              "rd-horizon-sidebar-scroll min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden py-4",
              collapsed ? "space-y-3 px-2 [scrollbar-gutter:stable_both-edges]" : "space-y-5 px-3",
            )}
          >
            {visibleGroups.map((group, groupIndex) => {
              const collapsible = group.items.length > 1;
              const groupClosed = collapsible && !collapsed && collapsedGroups.has(group.label);
              return (
                <Collapsible key={group.label} open={!groupClosed} onOpenChange={() => toggleGroup(group.label)}>
                  {collapsed && groupIndex > 0 && (
                    <div className="rd-horizon-sidebar-separator mx-auto mb-3 h-px w-7" />
                  )}
                  {!collapsed && (
                    collapsible ? (
                      <CollapsibleTrigger asChild>
                        <Button variant="unstyled"
                          type="button"
                          title={groupClosed
                            ? (lang === "en" ? "Expand group" : "展开该分组")
                            : (lang === "en" ? "Collapse group" : "收起该分组")}
                          className="rd-horizon-sidebar-group-trigger mb-1.5 flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span className="truncate">{t(group.label)}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {groupClosed && (
                              <span className="rd-horizon-sidebar-group-count rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums">
                                {group.items.length}
                              </span>
                            )}
                            <ChevronDown className={cn("size-3.5", groupClosed && "-rotate-90")} aria-hidden="true" />
                          </span>
                        </Button>
                      </CollapsibleTrigger>
                    ) : (
                      <div className="rd-horizon-sidebar-group-label mb-1.5 flex min-h-8 items-center px-3 text-xs font-semibold">
                        {t(group.label)}
                      </div>
                    )
                  )}
                  <CollapsibleContent>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const isActive = isNavItemActive(item, pathname);
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            title={t(item.label)}
                            onClick={onNavigate}
                            aria-label={collapsed ? t(item.label) : undefined}
                            aria-current={isActive ? "page" : undefined}
                            data-active={isActive ? "true" : "false"}
                            className={cn(
                              "rd-horizon-sidebar-item group flex min-h-11 cursor-pointer items-center rounded-xl border text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                              collapsed ? "mx-auto size-11 justify-center p-0" : "w-full gap-2 px-3",
                            )}
                          >
                            <span className="rd-horizon-sidebar-item-icon flex size-8 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                              <item.icon className="size-[18px]" />
                            </span>
                            {!collapsed && <span className="min-w-0 truncate">{t(item.label)}</span>}
                          </Link>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </nav>

          <div className="rd-horizon-sidebar-user w-full shrink-0 border-t px-3 py-3">
            <div
              className={cn("flex min-w-0 items-center rounded-xl", collapsed ? "mx-auto size-11 justify-center" : "gap-3 px-2 py-1")}
              title={collapsed ? `${t("当前用户")}: ${user?.name ?? "-"}` : undefined}
            >
              <span className="rd-horizon-sidebar-user-avatar flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                {userInitial}
              </span>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="rd-horizon-sidebar-user-name truncate text-[13px] font-semibold">{user?.name ?? "-"}</div>
                  <div className="rd-horizon-sidebar-user-role truncate text-xs">
                    {user?.roleName ? t(user.roleName) : t("无角色")}
                  </div>
                  <div className="rd-horizon-sidebar-user-email truncate text-[10px]">{user?.email ?? ""}</div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {!immersive && !mobile && (
        <Button variant="unstyled"
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed
            ? (lang === "en" ? "Expand sidebar" : "展开侧边栏")
            : (lang === "en" ? "Collapse sidebar" : "收起侧边栏")}
          title={collapsed
            ? (lang === "en" ? "Expand sidebar" : "展开侧边栏")
            : (lang === "en" ? "Collapse sidebar" : "收起侧边栏")}
          className="rd-horizon-sidebar-toggle group absolute -right-3.5 top-1/2 z-50 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronLeft className={cn("size-4", collapsed && "rotate-180")} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
