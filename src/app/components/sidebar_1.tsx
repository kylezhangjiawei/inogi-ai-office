import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useAuth } from "../auth";
import { hasPermission } from "../lib/permissions";
import { useNavHiddenCodes } from "../lib/permissionCatalogApi";
import { isNavItemActive, navGroups } from "../routesConfig";
import { t, useI18n } from "../lib/i18n";
import { useLayoutChromeActions, useLayoutChromeState } from "../lib/layoutChrome";
import { cn } from "./ui/utils";
import logo from '../../assets/logo.png'

/**
 * 侧栏收放的统一过渡：与外层宽度用同一条缓动曲线与时长，宽度、内边距、文字淡出
 * 才会像一个动作，而不是各走各的。系统开了「减少动态效果」时全部退化为瞬时切换。
 */
const SIDEBAR_EASE = "duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

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

export function Sidebar() {
  const { lang } = useI18n(); // 订阅语言切换（菜单 label 走 t()，中文即 key 全站菜单一处生效）
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { immersive, sidebarCollapsed: collapsed } = useLayoutChromeState();
  const { toggleSidebar } = useLayoutChromeActions();
  const userPermissions = user?.permissions ?? [];
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

  // Nav-hidden codes from the permission catalog.
  // Hidden pages are still accessible but not shown in the sidebar.
  const navHiddenCodes = useNavHiddenCodes(user?.id);

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => {
          // 聚合入口（如部门知识库）：任一页面码有权且未被隐藏就展示
          if (item.requiredPermissionAny?.length) {
            return item.requiredPermissionAny.some(
              (code) => hasPermission(userPermissions, code) && !navHiddenCodes.has(code),
            );
          }
          // Must have the required permission (or no permission required)
          if (item.requiredPermission && !hasPermission(userPermissions, item.requiredPermission)) return false;
          // Must not be marked as nav-hidden in the permission catalog
          if (item.requiredPermission && navHiddenCodes.has(item.requiredPermission)) return false;
          return true;
        }),
    }))
    .filter((group) => group.items.length > 0);

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
    // 外层只负责三态宽度：沉浸模式整体滑出(0)、手动收起成图标轨道(76)、常态(300/324)。
    // relative 让右缘控制钮能跨在边线上；裁剪交给内层，避免把控制钮一并裁掉。
    <div
      className={cn(
        "relative h-full shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        immersive ? "w-0" : collapsed ? "w-[76px]" : "w-[300px] min-[1920px]:w-[324px]",
      )}
    >
      {/* 裁剪层：沉浸态把侧栏内部裁掉，不挤压主内容。 */}
      <div className="h-full w-full overflow-hidden">
        <aside
          ref={sidebarRef}
          aria-hidden={immersive || undefined}
          data-collapsed={collapsed ? "true" : "false"}
          className={cn(
            "rd-horizon-global-sidebar flex h-full flex-col border-r",
            "transition-[width,padding]",
            SIDEBAR_EASE,
            collapsed ? "w-[76px] items-center" : "w-[300px] min-[1920px]:w-[324px]",
          )}
        >
          {/* 品牌区保持单一白色表面，和 Horizon Header 共用色彩令牌。 */}
          <div
            className={cn(
              "rd-horizon-sidebar-brand flex h-[86px] w-full shrink-0 items-center border-b",
              collapsed ? "justify-center px-2" : "gap-3 px-5",
            )}
          >
            <img
              className={cn(
                "rd-horizon-sidebar-logo shrink-0 rounded-[4px] object-contain transition-[height,width]",
                SIDEBAR_EASE,
                collapsed ? "size-10" : "size-11",
              )}
              src={logo}
              alt="INOGI AI"
            />
            <div
              className={cn(
                "min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin]",
                SIDEBAR_EASE,
                collapsed ? "max-w-0 opacity-0" : "max-w-[220px] opacity-100",
              )}
            >
              <div className="rd-horizon-sidebar-brand-title truncate text-base font-bold">INOGI AI</div>
              <div className="rd-horizon-sidebar-brand-subtitle mt-0.5 truncate text-[11px] font-medium">Office Console</div>
            </div>
          </div>

          <nav
            ref={navScrollRef}
            data-sidebar-scroll-container
            aria-label={lang === "en" ? "Primary navigation" : "主导航"}
            className={cn(
              "rd-horizon-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-4",
              SIDEBAR_EASE,
              // 收起态两侧留等宽滚动条槽，否则滚动条会让图标轨道视觉偏心。
              collapsed
                ? "w-full space-y-3 px-2 [scrollbar-gutter:stable_both-edges]"
                : "w-full space-y-4 px-3",
            )}
          >
            {visibleGroups.map((group, groupIndex) => {
              // 只有一个菜单项的分组不给折叠开关；图标轨道没有分组标题，始终展开。
              const collapsible = group.items.length > 1;
              const groupClosed = collapsible && !collapsed && collapsedGroups.has(group.label);
              return (
                <div key={group.label}>
                  {groupIndex > 0 ? (
                    <div
                      className={cn(
                        "rd-horizon-sidebar-separator mx-auto h-px transition-[width,opacity,margin]",
                        SIDEBAR_EASE,
                        collapsed ? "mb-3 w-7 opacity-100" : "mb-0 w-0 opacity-0",
                      )}
                    />
                  ) : null}

                  {/* 隐藏组标题时必须同时切断视觉、指针和键盘访问。 */}
                  <div
                    aria-hidden={collapsed}
                    className={cn(
                      "grid transition-[grid-template-rows,opacity]",
                      SIDEBAR_EASE,
                      collapsed ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                    )}
                  >
                    <div className="overflow-hidden">
                      {collapsible ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.label)}
                          tabIndex={collapsed ? -1 : undefined}
                          aria-expanded={!groupClosed}
                          title={groupClosed
                            ? (lang === "en" ? "Expand group" : "展开该分组")
                            : (lang === "en" ? "Collapse group" : "收起该分组")}
                          className="rd-horizon-sidebar-group-trigger mb-1.5 flex min-h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 text-[11px] font-semibold"
                        >
                          <span className="truncate">{t(group.label)}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span
                              className={cn(
                                "rd-horizon-sidebar-group-count overflow-hidden rounded-full text-[10px] leading-none tabular-nums transition-[max-width,opacity,padding]",
                                SIDEBAR_EASE,
                                groupClosed ? "max-w-[2rem] px-1.5 py-0.5 opacity-100" : "max-w-0 px-0 py-0.5 opacity-0",
                              )}
                            >
                              {group.items.length}
                            </span>
                            <ChevronDown
                              className={cn(
                                "size-3.5 transition-transform",
                                SIDEBAR_EASE,
                                groupClosed ? "-rotate-90" : "rotate-0",
                              )}
                            />
                          </span>
                        </button>
                      ) : (
                        <div className="rd-horizon-sidebar-group-label mb-1.5 flex min-h-7 items-center px-2 text-[11px] font-semibold">
                          {t(group.label)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    aria-hidden={groupClosed}
                    className={cn(
                      "grid transition-[grid-template-rows,opacity]",
                      SIDEBAR_EASE,
                      groupClosed ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          // 聚合入口可能落到另一地址，必须继续复用统一激活判定与 aria-current。
                          const isActive = isNavItemActive(item, pathname);
                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              title={collapsed ? t(item.label) : undefined}
                              tabIndex={groupClosed ? -1 : undefined}
                              aria-current={isActive ? "page" : undefined}
                              data-active={isActive ? "true" : "false"}
                              className={cn(
                                "rd-horizon-sidebar-item group flex min-h-11 items-center rounded-xl border text-[13px] font-medium",
                                collapsed ? "mx-auto size-11 justify-center p-0" : "w-full gap-2.5 px-2.5",
                              )}
                            >
                              <span className="rd-horizon-sidebar-item-icon flex size-9 shrink-0 items-center justify-center rounded-xl">
                                <item.icon className="size-[18px]" />
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 truncate whitespace-nowrap transition-[max-width,opacity,margin]",
                                  SIDEBAR_EASE,
                                  collapsed ? "max-w-0 opacity-0" : "max-w-[218px] opacity-100",
                                )}
                              >
                                {t(item.label)}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>

          {/* 用户信息放到侧栏底部，保留原字段但降低其相对导航的视觉权重。 */}
          <div className="rd-horizon-sidebar-user w-full shrink-0 border-t px-3 py-3">
            <div
              className={cn(
                "flex min-w-0 items-center rounded-xl",
                collapsed ? "mx-auto size-11 justify-center" : "gap-3 px-2 py-1",
              )}
              title={collapsed ? `${t("当前用户")}: ${user?.name ?? "-"}` : undefined}
            >
              <span className="rd-horizon-sidebar-user-avatar flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                {userInitial}
              </span>
              <div
                className={cn(
                  "min-w-0 overflow-hidden transition-[max-width,opacity]",
                  SIDEBAR_EASE,
                  collapsed ? "max-w-0 opacity-0" : "max-w-[220px] opacity-100",
                )}
              >
                <div className="rd-horizon-sidebar-user-name truncate text-[13px] font-semibold">{user?.name ?? "-"}</div>
                <div className="rd-horizon-sidebar-user-role truncate text-[11px]">
                  {user?.roleName ? t(user.roleName) : t("无角色")}
                </div>
                <div className="rd-horizon-sidebar-user-email truncate text-[10px]">{user?.email ?? ""}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* 收起/展开控制钮沿用原有契约：跨在侧栏右缘，并以侧栏全高垂直居中。 */}
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
          className="rd-horizon-sidebar-toggle group absolute -right-3.5 top-1/2 z-50 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-95"
        >
          <ChevronLeft
            className={cn(
              "size-4 transition-transform",
              SIDEBAR_EASE,
              collapsed ? "rotate-180" : "rotate-0",
            )}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}
