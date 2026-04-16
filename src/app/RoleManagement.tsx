import React, { useState } from "react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const initialRoles = [
  { name: "系统管理员", scope: "全模块可见，可维护用户与权限", permissions: ["用户管理", "角色权限", "流程配置", "通知中心"] },
  { name: "部门主管", scope: "本部门业务可见，可审批与分配", permissions: ["工单审批", "项目看板", "报销审核", "任务分配"] },
  { name: "业务专员", scope: "执行角色，可提交并查看本人内容", permissions: ["提交工单", "上传资料", "查看任务", "维护记录"] },
];

type DialogMode = "save" | "permission" | null;

export function RoleManagement() {
  const [activeRole, setActiveRole] = useState(initialRoles[0].name);
  const [enabledPermissions, setEnabledPermissions] = useState<Record<string, boolean>>(
    Object.fromEntries(initialRoles.flatMap((role) => role.permissions.map((permission) => [`${role.name}-${permission}`, true]))),
  );
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedPermission, setSelectedPermission] = useState("");

  const currentRole = initialRoles.find((role) => role.name === activeRole) ?? initialRoles[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Permission Matrix</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">角色与权限</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">把权限页补成带角色说明、权限确认弹窗和模板保存的后台矩阵，便于完整演示角色配置流程。</p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="material-card p-4">
          <div className="space-y-3">
            {initialRoles.map((role) => (
              <button
                key={role.name}
                onClick={() => setActiveRole(role.name)}
                className={cn(
                  "w-full rounded-[20px] border border-slate-100 px-4 py-4 text-left transition",
                  activeRole === role.name ? "bg-blue-50 text-blue-700 ring-2 ring-blue-200" : "bg-slate-50/70 text-slate-700",
                )}
              >
                <div className="font-semibold">{role.name}</div>
                <div className="mt-1 text-sm opacity-80">{role.scope}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="material-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-slate-900">{currentRole.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{currentRole.scope}</p>
            </div>
            <button className="material-button-primary" onClick={() => setDialogMode("save")}>
              保存权限
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {currentRole.permissions.map((permission) => {
              const key = `${currentRole.name}-${permission}`;
              const enabled = enabledPermissions[key];
              return (
                <div key={permission} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="text-left text-sm font-semibold text-slate-800 hover:text-primary"
                      onClick={() => {
                        setSelectedPermission(permission);
                        setDialogMode("permission");
                      }}
                    >
                      {permission}
                    </button>
                    <button
                      className={cn("rounded-full px-3 py-1 text-xs font-semibold", enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600")}
                      onClick={() => {
                        setEnabledPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
                        toast.success(`${permission} 已${enabled ? "关闭" : "开启"}`);
                      }}
                    >
                      {enabled ? "已开启" : "已关闭"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="material-card p-6">
          <h3 className="text-slate-900">当前角色说明</h3>
          <div className="mt-4 rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
            <div className="text-lg font-semibold text-slate-900">{currentRole.name}</div>
            <div className="mt-3 text-sm leading-7 text-slate-600">{currentRole.scope}</div>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["权限数量", `${currentRole.permissions.length} 项核心权限`],
              ["变更影响", "会影响左侧菜单、路由入口和审批能力"],
              ["建议流程", "先调整模板，再同步到具体用户"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-2 text-sm text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <Dialog open={dialogMode === "save"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>保存权限模板</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>角色：{currentRole.name}</div>
            <div>将同步保存当前权限开关状态，并生成版本快照。</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success(`${currentRole.name} 权限模板已保存`); }}>
            确认保存
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "permission"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>权限说明</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>权限项：{selectedPermission}</div>
            <div>说明：开启后该角色可进入对应模块并执行相关操作。</div>
            <div>建议：权限调整后同步检查菜单和数据范围。</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
