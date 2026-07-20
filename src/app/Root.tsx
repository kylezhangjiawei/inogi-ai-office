import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { Header } from "./components/header_1";
import { initI18n } from "./lib/i18n";
import { MateChatBubble } from "./components/MateChatBubble";
import { MateChatReminderModal } from "./components/matechat/MateChatReminderModal";
import { Toaster } from "./components/ui/sonner";
import { Sidebar } from "./components/sidebar_1";
import {
  LayoutChromeActionsContext,
  LayoutChromeStateContext,
  SIDEBAR_COLLAPSED_KEY,
  type LayoutChromeActions,
  type LayoutChromeState,
} from "./lib/layoutChrome";

export function Root() {
  // i18n：登录后拉一次用户语言偏好与英文字典（失败静默回退中文缓存，不阻塞启动）
  useEffect(() => {
    void initI18n();
  }, []);

  // 沉浸模式：研发驾驶舱滚动收起顶部概览时上报，联动隐藏全局顶栏 + 滑出侧边栏。
  const [immersive, setImmersive] = useState(false);
  // 侧栏手动收起（图标轨道）：用户偏好，初值读 localStorage、变更即回写。
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const persistCollapsed = useCallback((v: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0");
  }, []);

  // Actions 引用恒定（setImmersive 为 useState 稳定 setter，其余用函数式更新），
  // 让重型驾驶舱订阅 setter 不致随 immersive 抖动而整页重渲。
  const actions = useMemo<LayoutChromeActions>(
    () => ({
      setImmersive,
      setSidebarCollapsed: (v: boolean) => {
        setSidebarCollapsedState(v);
        persistCollapsed(v);
      },
      toggleSidebar: () =>
        setSidebarCollapsedState((c) => {
          const next = !c;
          persistCollapsed(next);
          return next;
        }),
    }),
    [persistCollapsed],
  );

  const state = useMemo<LayoutChromeState>(
    () => ({ immersive, sidebarCollapsed }),
    [immersive, sidebarCollapsed],
  );

  return (
    <LayoutChromeActionsContext.Provider value={actions}>
      <LayoutChromeStateContext.Provider value={state}>
        <div className="h-screen min-w-[1024px] bg-transparent">
          <div className="material-shell flex h-full min-w-[1024px] overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <main className="min-w-0 flex-1 overflow-y-auto overflow-x-auto px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-6">
                <Outlet />
              </main>
            </div>
            <MateChatBubble />
            <MateChatReminderModal />
            <Toaster richColors position="top-right" />
          </div>
        </div>
      </LayoutChromeStateContext.Provider>
    </LayoutChromeActionsContext.Provider>
  );
}
