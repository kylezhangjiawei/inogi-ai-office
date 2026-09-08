import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { Header } from "./components/header_1";
import { initI18n, t, useI18n } from "./lib/i18n";
import { MateChatBubble } from "./components/MateChatBubble";
import { MateChatReminderModal } from "./components/matechat/MateChatReminderModal";
import { Toaster } from "./components/ui/sonner";
import { Sidebar } from "./components/sidebar_1";
import { SiteRecordFooter } from "./components/SiteRecordFooter";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./components/ui/sheet";
import {
  LayoutChromeActionsContext,
  LayoutChromeStateContext,
  SIDEBAR_COLLAPSED_KEY,
  type LayoutChromeActions,
  type LayoutChromeState,
} from "./lib/layoutChrome";

export function Root() {
  useI18n();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  // i18n：登录后拉一次用户语言偏好与英文字典（失败静默回退中文缓存，不阻塞启动）
  useEffect(() => {
    void initI18n();
  }, []);

  useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktopViewport.matches) setMobileNavigationOpen(false);
    };
    desktopViewport.addEventListener("change", closeOnDesktop);
    return () => desktopViewport.removeEventListener("change", closeOnDesktop);
  }, []);

  // 研发驾驶舱联动收起全局顶栏与侧栏。
  const [immersive, setImmersive] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const persistCollapsed = useCallback((value: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  }, []);

  // 保持动作引用稳定，避免重型驾驶舱随布局状态重复渲染。
  const actions = useMemo<LayoutChromeActions>(
    () => ({
      setImmersive: (value: boolean) => {
        setImmersive(value);
        if (value) setMobileNavigationOpen(false);
      },
      setSidebarCollapsed: (value: boolean) => {
        setSidebarCollapsedState(value);
        persistCollapsed(value);
      },
      toggleSidebar: () => setSidebarCollapsedState((collapsed) => {
        const next = !collapsed;
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
        <Sheet open={mobileNavigationOpen && !immersive} onOpenChange={setMobileNavigationOpen}>
          <div className="rd-horizon-app h-dvh min-w-0 bg-transparent">
            <div className="material-shell flex h-full min-w-0 overflow-hidden">
              <div className="rd-horizon-desktop-navigation hidden h-full shrink-0 lg:block">
                <Sidebar />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <Header />
                <main className="rd-horizon-main min-w-0 flex-1 overflow-y-auto overflow-x-auto px-4 py-4 md:px-6 md:py-6">
                  <Outlet />
                </main>
                <SiteRecordFooter tone="horizon" className="backdrop-blur-none" />
              </div>
              <SheetContent
                side="left"
                className="horizon-theme horizon-portal rd-horizon-mobile-sheet h-dvh w-[min(20rem,calc(100vw-24px))] gap-0 p-0 transition-none data-[state=open]:animate-none data-[state=closed]:animate-none"
              >
                <SheetTitle className="sr-only">{t("主导航")}</SheetTitle>
                <SheetDescription className="sr-only">{t("选择要打开的工作页面")}</SheetDescription>
                <Sidebar mobile onNavigate={() => setMobileNavigationOpen(false)} />
              </SheetContent>
              <MateChatBubble />
              <MateChatReminderModal />
              <Toaster richColors position="top-right" />
            </div>
          </div>
        </Sheet>
      </LayoutChromeStateContext.Provider>
    </LayoutChromeActionsContext.Provider>
  );
}
