import React, { useMemo, useState } from "react";
import { Bell, ChevronDown, LogOut, Search, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { getRoleLabel, useAuth } from "../auth";
import { routeTitleMap } from "../routesConfig";
import { ImageWithFallback } from "./figma/ImageWithFallback";

const notifications = [
  "OC-10 注册项目已 3 天未更新，请跟进负责人。",
  "文件《文件控制程序》已更新至 V3.2，请提醒替换旧版。",
  "员工罗成的劳动合同将在 13 天后到期。",
];

function resolveRouteTitle(pathname: string) {
  const directTitle = routeTitleMap[pathname];
  if (directTitle) return directTitle;

  const matchedPath = Object.keys(routeTitleMap)
    .filter((path) => path !== "/" && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  return matchedPath ? routeTitleMap[matchedPath] : "系统首页";
}

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const title = useMemo(() => resolveRouteTitle(location.pathname), [location.pathname]);
  const breadcrumb = useMemo(
    () => (location.pathname === "/" ? ["首页", "系统总览"] : ["首页", title]),
    [location.pathname, title],
  );

  return (
    <header className="relative border-b border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.72))] px-4 py-4 backdrop-blur-xl md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="hidden h-14 w-1 rounded-full bg-[linear-gradient(180deg,#42a5f5_0%,#1976d2_100%)] xl:block" />
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>{breadcrumb[0]}</span>
              <span>/</span>
              <span className="font-medium text-slate-700">{breadcrumb[1]}</span>
            </div>
            <div>
              <h1 className="text-[1.65rem] font-bold tracking-tight text-slate-900">{title}</h1>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[240px] flex-1 lg:w-[340px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索工单、文档、人员、项目..." className="material-input pl-11 pr-4" />
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-[20px] border border-slate-200 bg-white/85 px-4 py-2 text-right shadow-sm md:block">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Today</div>
              <div className="text-sm font-semibold text-slate-700">{today}</div>
            </div>

            <button className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-primary">
              <Settings className="h-5 w-5" />
            </button>

            <button
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-primary"
              onClick={() => setOpen((value) => !value)}
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
            </button>

            <button className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-white/94 px-3 py-2 shadow-sm transition hover:-translate-y-0.5">
              <div className="h-11 w-11 overflow-hidden rounded-2xl ring-2 ring-blue-50">
                <ImageWithFallback
                  src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop"
                  alt={user?.name ?? "User"}
                />
              </div>
              <div className="hidden text-left sm:block">
                <div className="text-sm font-semibold text-slate-800">{user?.name ?? "访客"}</div>
                <div className="text-xs text-slate-500">{user ? getRoleLabel(user.role) : "未登录"}</div>
              </div>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>

            <button
              className="material-button-secondary"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="absolute right-6 top-[92px] z-20 w-[360px] rounded-[24px] border border-slate-200 bg-white/96 p-4 shadow-[0_18px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="mb-3 text-sm font-semibold text-slate-900">系统通知</div>
          <div className="space-y-3">
            {notifications.map((item) => (
              <div key={item} className="rounded-2xl bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-600">
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}
