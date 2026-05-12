import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { authFetch } from "./lib/authSession";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";
import { PERMISSION_GROUPS } from "./lib/permissions";

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  _count?: { users: number };
  createdAt: string;
  updatedAt: string;
};

type RoleFormData = {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
};

const EMPTY_FORM: RoleFormData = { name: "", description: "", permissions: [] };

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiListRoles(): Promise<Role[]> {
  const res = await authFetch("/api/roles");
  if (!res.ok) throw new Error("获取角色列表失败");
  return res.json() as Promise<Role[]>;
}

async function apiSaveRole(payload: RoleFormData): Promise<Role> {
  const res = await authFetch("/api/roles", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      description: payload.description || undefined,
      permissions: payload.permissions,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? "保存失败");
    throw new Error(msg);
  }
  return res.json() as Promise<Role>;
}

async function apiDeleteRole(id: string): Promise<void> {
  const res = await authFetch(`/api/roles/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "删除失败");
  }
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

function PermissionMatrix({
  selected,
  onChange,
  isWildcard,
}: {
  selected: string[];
  onChange: (permissions: string[]) => void;
  isWildcard: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggleGroup(label: string) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function togglePermission(code: string) {
    if (selected.includes(code)) {
      onChange(selected.filter((p) => p !== code));
    } else {
      onChange([...selected, code]);
    }
  }

  function toggleGroupAll(codes: string[]) {
    const allSelected = codes.every((c) => selected.includes(c));
    if (allSelected) {
      onChange(selected.filter((p) => !codes.includes(p)));
    } else {
      const merged = Array.from(new Set([...selected, ...codes]));
      onChange(merged);
    }
  }

  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => {
        const groupCodes = group.permissions.map((p) => p.code);
        const selectedCount = groupCodes.filter((c) => selected.includes(c) || isWildcard).length;
        const allSelected = isWildcard || selectedCount === groupCodes.length;
        const isOpen = !collapsed[group.label];

        return (
          <div key={group.label} className="rounded-2xl border border-slate-100 overflow-hidden">
            <div
              className={cn(
                "flex items-center justify-between px-4 py-3 cursor-pointer transition-colors",
                allSelected ? "bg-blue-50" : "bg-slate-50/70",
              )}
              onClick={() => toggleGroup(group.label)}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={isWildcard}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (!isWildcard) toggleGroupAll(groupCodes);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 rounded border-slate-300 text-primary"
                />
                <span className="text-sm font-semibold text-slate-700">{group.label}</span>
                <span className="text-xs text-slate-400">
                  {isWildcard ? groupCodes.length : selectedCount}/{groupCodes.length}
                </span>
              </div>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </div>

            {isOpen && (
              <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 md:grid-cols-3">
                {group.permissions.map((perm) => {
                  const checked = isWildcard || selected.includes(perm.code);
                  return (
                    <label
                      key={perm.code}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm transition-colors",
                        checked ? "border-blue-200 bg-blue-50/60" : "border-slate-100 hover:bg-slate-50",
                        isWildcard && "opacity-60 cursor-default",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isWildcard}
                        onChange={() => {
                          if (!isWildcard) togglePermission(perm.code);
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary"
                      />
                      <div>
                        <div className="font-medium text-slate-800">{perm.label}</div>
                        {perm.description && (
                          <div className="mt-0.5 text-xs text-slate-400">{perm.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

type DialogMode = "create" | "edit" | "deleteConfirm" | null;

export function RoleManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiListRoles();
      setRoles(data);
      if (!activeRoleId && data.length > 0) {
        setActiveRoleId(data[0].id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [activeRoleId]);

  useEffect(() => {
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRole = roles.find((r) => r.id === activeRoleId) ?? roles[0] ?? null;
  const isWildcard = activeRole?.permissions.includes("*") ?? false;

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogMode("create");
  }

  function openEdit(role: Role) {
    setSelectedRole(role);
    setForm({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: role.permissions,
    });
    setDialogMode("edit");
  }

  function openDelete(role: Role) {
    setSelectedRole(role);
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRole(null);
  }

  async function handleSaveRole() {
    if (!form.name.trim()) {
      toast.error("角色名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const saved = await apiSaveRole(form);
      setRoles((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...saved };
          return next;
        }
        return [saved, ...prev];
      });
      setActiveRoleId(saved.id);
      toast.success(form.id ? "角色已更新" : "角色已创建");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickSavePermissions(role: Role, permissions: string[]) {
    try {
      const saved = await apiSaveRole({
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions,
      });
      setRoles((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
      toast.success("权限已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function handleDeleteRole() {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await apiDeleteRole(selectedRole.id);
      setRoles((prev) => prev.filter((r) => r.id !== selectedRole.id));
      setActiveRoleId(null);
      toast.success("角色已删除");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <section className="material-card p-4 sm:p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <span className="material-chip bg-blue-50 text-blue-700">Permission Matrix</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-[2rem]">角色与权限</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              配置角色的页面访问权限与操作权限。权限变更实时生效——用户下次刷新 Token 后即可感知。
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              className="material-button-secondary w-full justify-center sm:w-fit"
              onClick={() => void loadRoles()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </button>
            <PermissionGuard permission="role:create">
              <button className="material-button-primary w-full justify-center sm:w-fit" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                新建角色
              </button>
            </PermissionGuard>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-6">
        {/* Role list */}
        <div className="material-card p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">加载中...</div>
          ) : roles.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">暂无角色</div>
          ) : (
            <div className="space-y-2">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className={cn(
                    "group flex items-start justify-between rounded-[20px] border px-4 py-4 transition cursor-pointer",
                    activeRoleId === role.id
                      ? "border-blue-200 bg-blue-50 ring-2 ring-blue-200"
                      : "border-slate-100 bg-slate-50/70 hover:border-slate-200",
                  )}
                  onClick={() => setActiveRoleId(role.id)}
                >
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "font-semibold truncate",
                        activeRoleId === role.id ? "text-blue-700" : "text-slate-700",
                      )}
                    >
                      {role.name}
                      {role.permissions.includes("*") && (
                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          超级
                        </span>
                      )}
                    </div>
                    {role.description && (
                      <div className="mt-1 text-xs text-slate-400 line-clamp-2">{role.description}</div>
                    )}
                    <div className="mt-1.5 text-xs text-slate-400">
                      {role._count?.users ?? 0} 名用户 ·{" "}
                      {role.permissions.includes("*") ? "全部权限" : `${role.permissions.length} 项权限`}
                    </div>
                  </div>
                  {!role.permissions.includes("*") && (
                    <div className="ml-2 flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <PermissionGuard permission="role:edit">
                        <button
                          className="rounded-lg p-1.5 hover:bg-white"
                          onClick={(e) => { e.stopPropagation(); openEdit(role); }}
                          title="编辑角色"
                        >
                          <Pencil className="h-3.5 w-3.5 text-slate-500" />
                        </button>
                      </PermissionGuard>
                      <PermissionGuard permission="role:delete">
                        <button
                          className="rounded-lg p-1.5 hover:bg-red-50"
                          onClick={(e) => { e.stopPropagation(); openDelete(role); }}
                          title="删除角色"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </PermissionGuard>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Permission matrix for active role */}
        <div className="material-card min-w-0 p-4 sm:p-6">
          {!activeRole ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">
              请从左侧选择角色
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900">{activeRole.name}</h3>
                  {activeRole.description && (
                    <p className="mt-1 text-sm text-slate-500">{activeRole.description}</p>
                  )}
                  {isWildcard && (
                    <p className="mt-2 rounded-xl bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                      该角色拥有超级权限（*），可访问所有功能。若要限制权限，请编辑角色并手动指定权限列表。
                    </p>
                  )}
                </div>
                {!isWildcard && (
                  <PermissionGuard permission="role:edit">
                    <button
                      className="material-button-primary shrink-0"
                      onClick={() => openEdit(activeRole)}
                    >
                      <Pencil className="h-4 w-4" />
                      编辑角色
                    </button>
                  </PermissionGuard>
                )}
              </div>

              <PermissionMatrix
                selected={activeRole.permissions}
                isWildcard={isWildcard}
                onChange={(permissions) => {
                  // Optimistic update local state
                  setRoles((prev) =>
                    prev.map((r) =>
                      r.id === activeRole.id ? { ...r, permissions } : r,
                    ),
                  );
                  void handleQuickSavePermissions(activeRole, permissions);
                }}
              />
            </>
          )}
        </div>
      </section>

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onClose={closeDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{dialogMode === "edit" ? "编辑角色" : "新建角色"}</DialogTitle>
        <DialogContent dividers>
          <div className="mb-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                角色名称 <span className="text-red-500">*</span>
              </label>
              <input
                className="material-input w-full"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="请输入角色名称"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">角色说明</label>
              <textarea
                className="material-input w-full resize-none"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="简要说明该角色的职责范围"
              />
            </div>
          </div>

          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            权限配置
          </div>
          <PermissionMatrix
            selected={form.permissions}
            isWildcard={form.permissions.includes("*")}
            onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
          />
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button
            className="material-button-primary"
            onClick={() => void handleSaveRole()}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存角色"}
          </button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={dialogMode === "deleteConfirm"} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>确认删除角色</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm text-slate-600">
            即将永久删除角色 <strong>{selectedRole?.name}</strong>。
            {(selectedRole?._count?.users ?? 0) > 0 && (
              <span className="mt-2 block text-red-600">
                该角色下仍有 {selectedRole?._count?.users} 名用户，请先移除或重新分配后再删除。
              </span>
            )}
          </p>
        </DialogContent>
        <DialogActions>
          <button className="material-button-secondary" onClick={closeDialog} disabled={saving}>
            取消
          </button>
          <button
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            onClick={() => void handleDeleteRole()}
            disabled={saving || (selectedRole?._count?.users ?? 0) > 0}
          >
            {saving ? "删除中..." : "确认删除"}
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
