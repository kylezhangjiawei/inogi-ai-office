import { createContext, useContext } from "react";

/**
 * 应用外壳（全局顶栏 Header + 侧边栏 Sidebar）的显隐控制。
 *
 * 由 Root 提供，供 Sidebar / Header 以及经 <Outlet> 渲染的页面（如研发驾驶舱）跨层共享：
 *  - immersive 沉浸模式：滚动任务流时隐藏顶栏 + 整体滑出侧边栏，整屏看任务（领导审查诉求）。
 *  - sidebarCollapsed 手动收起：用户点按把侧边栏收成图标轨道（持久化 localStorage）。
 *
 * 刻意拆成 State / Actions 两个 Context：
 *  - State（immersive / sidebarCollapsed）会频繁变化，只给轻量的 Sidebar / Header 订阅。
 *  - Actions（setter）引用恒定，给重型驾驶舱页订阅——这样滚动收起/展开切 immersive 时
 *    不会把整页 union 数百条任务的驾驶舱重渲一遍。
 * 非 Root 树（移动端 /m、登录页等）消费 Actions 时走 no-op 兜底，避免崩溃。
 */
export type LayoutChromeState = {
  immersive: boolean;
  sidebarCollapsed: boolean;
};

export type LayoutChromeActions = {
  /** 进入/退出沉浸模式（隐藏顶栏 + 滑出侧栏）。 */
  setImmersive: (v: boolean) => void;
  /** 手动设定侧栏是否收起（图标轨道）。 */
  setSidebarCollapsed: (v: boolean) => void;
  /** 手动切换侧栏收起/展开。 */
  toggleSidebar: () => void;
};

export const LayoutChromeStateContext = createContext<LayoutChromeState>({
  immersive: false,
  sidebarCollapsed: false,
});

const NOOP_ACTIONS: LayoutChromeActions = {
  setImmersive: () => {},
  setSidebarCollapsed: () => {},
  toggleSidebar: () => {},
};

export const LayoutChromeActionsContext = createContext<LayoutChromeActions>(NOOP_ACTIONS);

export function useLayoutChromeState(): LayoutChromeState {
  return useContext(LayoutChromeStateContext);
}

export function useLayoutChromeActions(): LayoutChromeActions {
  return useContext(LayoutChromeActionsContext);
}

/** 侧栏手动收起状态的 localStorage 键（用户偏好，跨刷新保持）。 */
export const SIDEBAR_COLLAPSED_KEY = "inogi-sidebar-collapsed";
