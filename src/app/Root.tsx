import React from "react";
import { Outlet } from "react-router";
import { Header } from "./components/header_1";
import { Toaster } from "./components/ui/sonner";
import { Sidebar } from "./components/sidebar_1";

export function Root() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <div className="material-shell flex h-full w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-6">
            <Outlet />
          </main>
        </div>
        <Toaster richColors position="top-right" />
      </div>
    </div>
  );
}
