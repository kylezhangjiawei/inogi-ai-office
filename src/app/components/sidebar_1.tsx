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
          "transition-[width,padding]",
          SIDEBAR_EASE,
          collapsed ? "w-[76px] items-center px-2" : "w-[300px] px-4 min-[1920px]:w-[324px]",
        )}
      >
        {/* 顶部：Logo + 标题 + 当前用户卡。收放不换 DOM——换 DOM 会让文字硬生生闪掉，
            这里靠 logo 尺寸、文字块宽度、用户卡高度（grid 0fr→1fr）一起过渡。 */}
        <div
          className={cn(
            "shrink-0 overflow-hidden transition-[margin,padding,background-color,box-shadow]",
            SIDEBAR_EASE,
            collapsed ? "mb-4 p-0" : "material-card material-glow mb-5 p-4",
          )}
        >
          <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
            <img
              className={cn("shrink-0 rounded-[4px] transition-[height,width]", SIDEBAR_EASE, collapsed ? "h-11 w-11" : "h-14 w-14")}
              src={logo}
              alt="INOGI AI"
            />
            <div
              className={cn(
                "min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity]",
                SIDEBAR_EASE,
                collapsed ? "max-w-0 opacity-0" : "max-w-[220px] opacity-100",
              )}
            >
              <div className="text-lg font-bold tracking-tight text-slate-900">INOGI AI</div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Office Console</div>
            </div>
          </div>

          {/* grid-rows 0fr→1fr：不写死高度也能让整块用户卡平滑收进去 */}
          <div
            className={cn(
              "grid transition-[grid-template-rows,margin-top,opacity]",
              SIDEBAR_EASE,
              collapsed ? "grid-rows-[0fr] opacity-0" : "mt-5 grid-rows-[1fr] opacity-100",
            )}
          >
            <div className="overflow-hidden">
              <div className="rounded-[24px] bg-[linear-gradient(145deg,#eef2ff_0%,#f9fbff_55%,#f3f0ff_100%)] px-4 py-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("当前用户")}</div>
                <div className="flex items-end justify-between gap-3">
                  <div className="truncate text-sm font-bold tracking-tight text-slate-900">{user?.name ?? "—"}</div>
                  <span className="material-chip shrink-0 bg-white/85 text-primary shadow-sm">{user?.roleName ? t(user.roleName) : t("无角色")}</span>
                </div>
                <p className="mt-2 truncate text-xs text-slate-500">{user?.email ?? ""}</p>
              </div>
            </div>
          </div>
        </div>

        <nav
          ref={navScrollRef}
          data-sidebar-scroll-container
          className={cn(
            "material-scrollbar flex-1 overflow-y-auto transition-[margin,padding]",
            SIDEBAR_EASE,
            // 收起态两侧留等宽滚动条槽：否则滚动条只吃右边 11px，图标会整体偏左看着没对齐
            collapsed ? "w-full space-y-2 [scrollbar-gutter:stable_both-edges]" : "-mx-1 space-y-4 px-1",
          )}
        >
          {visibleGroups.map((group, groupIndex) => {
            // 只有一个菜单项的分组（如「总览」）不给折叠开关：收起它省不下高度，只多一个噪点
            const collapsible = group.items.length > 1;
            // 图标轨道模式下没有分组标题，也就没法点开点收，一律按展开渲染
            const groupClosed = collapsible && !collapsed && collapsedGroups.has(group.label);
            return (
            <div key={group.label}>
              {/* 收起态用一条短分隔线代替组标题：线宽从 0 长出来，标题同时收成 0 高 */}
              {groupIndex > 0 ? (
                <div
                  className={cn(
                    "mx-auto h-px bg-slate-200/80 transition-[width,opacity,margin]",
                    SIDEBAR_EASE,
                    collapsed ? "mb-2 w-8 opacity-100" : "mb-0 w-0 opacity-0",
                  )}
                />
              ) : null}
              {/* 组标题：收起态高度归零并淡出。overflow-hidden 只挡住眼睛——按钮照样能 Tab
                  聚焦、回车照样切换并写进 localStorage，展开侧栏才发现分组莫名收起了。
                  所以同时要 aria-hidden / pointer-events-none / tabIndex=-1 三件套。 */}
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
                      className="mb-2 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 transition-colors duration-200 hover:bg-white/80 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none"
                    >
                      <span className="truncate">{t(group.label)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {/* 收起时把条目数摆出来，省得为了看有几项再展开一次 */}
                        <span
                          className={cn(
                            "overflow-hidden rounded-full bg-slate-200/70 text-[10px] leading-none tabular-nums text-slate-500 transition-[max-width,opacity,padding]",
                            SIDEBAR_EASE,
                            groupClosed ? "max-w-[2rem] px-1.5 py-0.5 opacity-100" : "max-w-0 px-0 py-0.5 opacity-0",
                          )}
                        >
                          {group.items.length}
                        </span>
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 transition-transform", SIDEBAR_EASE, groupClosed ? "-rotate-90" : "rotate-0")}
                        />
                      </span>
                    </button>
                  ) : (
                    <div className="mb-2 px-2 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {t(group.label)}
                    </div>
                  )}
                </div>
              </div>

              {/* 分组内容：收起时高度过渡到 0 并淡出；收起后不可点、不可 Tab 进去 */}
              <div
                aria-hidden={groupClosed}
                className={cn(
                  "grid transition-[grid-template-rows,opacity]",
                  SIDEBAR_EASE,
                  groupClosed ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      // 不用 NavLink 的 isActive：聚合入口点进去可能落在别的地址（知识库→
                      // /rd-knowledge-base），NavLink 只认自己的 to，且它会覆盖外部传入的
                      // aria-current，补不上。改用 Link + 统一判定，高亮、无障碍、上面那段
                      // 「滚动到激活项」共用 aria-current 这一个源。
                      const isActive = isNavItemActive(item, pathname);
                      return (
                      <Link
                        key={item.path}
                        to={item.path}
                        title={collapsed ? t(item.label) : undefined}
                        tabIndex={groupClosed ? -1 : undefined}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "material-nav-item border transition-[background-color,border-color,box-shadow,padding]",
                          SIDEBAR_EASE,
                          collapsed
                            ? "justify-center border-transparent bg-transparent px-0 py-0.5 shadow-none"
                            : cn(
                                "justify-between",
                                isActive
                                  ? "border-indigo-100 bg-[linear-gradient(135deg,#eef2ff_0%,#e0e7ff_72%,#f3f0ff_100%)] text-primary shadow-[0_10px_18px_-8px_rgba(79,70,229,0.22)]"
                                  : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/85",
                              ),
                        )}
                      >
                        <div className="flex min-w-0 items-center">
                            <div
                              className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-200 motion-reduce:transition-none",
                                isActive
                                  ? "bg-white text-primary shadow-[0_6px_12px_-4px_rgba(79,70,229,0.16)]"
                                  : "bg-slate-100/80 text-slate-500",
                                collapsed && isActive ? "ring-1 ring-indigo-100" : "",
                                collapsed && !isActive ? "hover:bg-white hover:text-primary" : "",
                              )}
                            >
                              <item.icon className="h-5 w-5" />
                            </div>
                            {/* 标签常驻 DOM：收起时宽度收到 0 并淡出，展开时长回来，避免文字硬闪 */}
                            <span
                              className={cn(
                                "overflow-hidden whitespace-nowrap font-medium transition-[max-width,opacity,margin]",
                                SIDEBAR_EASE,
                                collapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-[200px] opacity-100",
                              )}
                            >
                              {t(item.label)}
                            </span>
                        </div>
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
          {/* 一个箭头转 180°，比换图标更能让人看出「同一个开关的两个状态」 */}
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform",
              SIDEBAR_EASE,
              collapsed ? "rotate-180 group-hover:translate-x-0.5" : "group-hover:-translate-x-0.5",
            )}
          />
        </button>
      )}
    </div>
  );
}
