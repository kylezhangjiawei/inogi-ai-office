import React from "react";
import { NavLink } from "react-router";
import { useAuth } from "../auth";
import { hasPermission } from "../lib/permissions";
import { navGroups } from "../routesConfig";
import { cn } from "./ui/utils";
import logo from '../../assets/logo.png'

export function Sidebar() {
  const { user } = useAuth();
  const userPermissions = user?.permissions ?? [];

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.requiredPermission ||
          hasPermission(userPermissions, item.requiredPermission),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-white/70 bg-[linear-gradient(180deg,#fcfdff_0%,#f4f8fd_100%)] px-4 py-5 min-[1920px]:w-[324px]">
      <div className="material-card material-glow mb-5 p-4">
        <div className="mb-5 flex items-center gap-3">

            <img className="flex h-14 w-14 items-center justify-center rounded-[4px] " src={logo} alt="" />
          <div>
            <div className="text-lg font-bold tracking-tight text-slate-900">INOGI AI</div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Office Console</div>
          </div>
        </div>

        <div className="rounded-[24px] bg-[linear-gradient(145deg,#e7f2ff_0%,#f9fbff_55%,#e8f8f5_100%)] px-4 py-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">当前用户</div>
          <div className="flex items-end justify-between gap-3">
            <div className="truncate text-sm font-bold tracking-tight text-slate-900">{user?.name ?? "—"}</div>
            <span className="material-chip shrink-0 bg-white/85 text-primary shadow-sm">{user?.roleName ?? "无角色"}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 truncate">{user?.email ?? ""}</p>
        </div>
      </div>

      <nav className="material-scrollbar flex-1 space-y-4 overflow-y-auto pr-1">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{group.label}</div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/" || item.path === "/ops-center"}
                  className={({ isActive }) =>
                    cn(
                      "material-nav-item justify-between border",
                      isActive
                        ? "border-blue-100 bg-[linear-gradient(135deg,#edf4ff_0%,#e1efff_72%,#eefaf8_100%)] text-primary shadow-[0_14px_28px_rgba(25,118,210,0.14)]"
                        : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/85",
                    )
                  }
                >
                  {({ isActive }) => (
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
                          isActive ? "bg-white text-primary shadow-[0_8px_18px_rgba(25,118,210,0.12)]" : "bg-slate-100/80 text-slate-500",
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                      </div>
                      <span className="truncate font-medium">{item.label}</span>
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
