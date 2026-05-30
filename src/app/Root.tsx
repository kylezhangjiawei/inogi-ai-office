import React from "react";
import { Outlet } from "react-router";
import { Header } from "./components/header_1";
import { MateChatBubble } from "./components/MateChatBubble";
import { Toaster } from "./components/ui/sonner";
import { Sidebar } from "./components/sidebar_1";

export function Root() {
  return (
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
        <Toaster richColors position="top-right" />
      </div>
    </div>
  );
}
